"""
Inference Signals — Auto-propagation on component save
=======================================================

When any document component (Paragraph, Sentence, LatexCode, Table, Section)
is saved, these signal handlers:

1. Mark the corresponding ``ComponentInference`` / ``SectionAggregateInference``
   as stale (set ``is_latest=False``), so the next AI call that requests
   inference context will know it needs refreshing.

2. Walk **up** the tree — parent section aggregates and the document-level
   inference are also marked stale, because their children changed.

3. **Enqueue the write-path** (embed → MaxSim → rerank → graph UPSERT) in a
   background thread so lateral edges stay fresh without blocking the HTTP
   response.  If Celery is available, dispatches as a Celery task instead.

This is **cheap** for steps 1-2 (no LLM calls): only boolean flags.
Step 3 is async and best-effort — failures are logged, never raised.

Registration
~~~~~~~~~~~~
Import this module in ``aiservices/inference/apps.py`` → ``ready()``, or
call ``register_signals()`` explicitly.
"""
import logging
import os
import threading

from django.contrib.contenttypes.models import ContentType
from django.db.models.signals import post_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)

# ── Write-path toggle ────────────────────────────────────────────────────
_WRITE_PATH_ENABLED = os.environ.get('INFERENCE_WRITE_PATH_ENABLED', '').lower() in ('1', 'true', 'yes')
_WRITE_PATH_ASYNC = os.environ.get('INFERENCE_WRITE_PATH_ASYNC', 'thread')  # 'thread' | 'celery' | 'sync'


def _mark_component_stale(instance):
    """Mark the latest ComponentInference for this component as not-latest."""
    from .models import ComponentInference
    try:
        ct = ContentType.objects.get_for_model(instance)
        updated = ComponentInference.objects.filter(
            content_type=ct, object_id=instance.id, is_latest=True,
        ).update(is_latest=False)
        if updated:
            logger.debug('Inference: marked %s %s component inference stale', type(instance).__name__, instance.id)
    except Exception as exc:
        logger.warning('Inference signal _mark_component_stale error: %s', exc)


def _mark_section_aggregate_stale(section):
    """Mark the section aggregate inference (and ancestors) as not-latest."""
    from .models import SectionAggregateInference
    if not section:
        return
    try:
        updated = SectionAggregateInference.objects.filter(
            section=section, is_latest=True,
        ).update(is_latest=False)
        if updated:
            logger.debug('Inference: marked section %s aggregate stale', section.id)
        # Walk up to parent sections
        if section.parent_id:
            _mark_section_aggregate_stale(section.parent)
    except Exception as exc:
        logger.warning('Inference signal _mark_section_aggregate_stale error: %s', exc)


def _mark_document_inference_stale(document):
    """Mark the document-level inference as not-latest."""
    from .models import DocumentInferenceSummary
    if not document:
        return
    try:
        updated = DocumentInferenceSummary.objects.filter(
            document=document, is_latest=True,
        ).update(is_latest=False)
        if updated:
            logger.debug('Inference: marked document %s inference stale', document.id)
    except Exception as exc:
        logger.warning('Inference signal _mark_document_inference_stale error: %s', exc)


def _propagate_staleness(instance, section=None, document=None):
    """
    Full upward propagation:
      component → section aggregate → ancestor aggregates → document summary
    Then enqueue write-path (async, best-effort) to refresh lateral edges.
    """
    _mark_component_stale(instance)
    if section:
        _mark_section_aggregate_stale(section)
    if document:
        _mark_document_inference_stale(document)

    # ── Write-path: refresh lateral edges asynchronously ──
    if _WRITE_PATH_ENABLED and document:
        _enqueue_write_path(instance, document)


def _enqueue_write_path(component, document):
    """
    Dispatch the write-path for *component* in *document*.

    Dispatch strategy (``INFERENCE_WRITE_PATH_ASYNC``):
      * ``thread``  — daemon thread (default, no deps)
      * ``celery``  — Celery task (needs worker running)
      * ``sync``    — synchronous (only for testing / debugging)
    """
    component_id = str(component.id)
    component_type = type(component).__name__
    document_id = str(document.id)

    if _WRITE_PATH_ASYNC == 'celery':
        try:
            from .tasks import run_write_path_task
            run_write_path_task.delay(component_id, component_type, document_id)
            logger.debug('Write-path Celery task queued for %s %s', component_type, component_id)
            return
        except Exception as exc:
            logger.warning('Write-path Celery dispatch failed, falling back to thread: %s', exc)

    if _WRITE_PATH_ASYNC == 'sync':
        _run_write_path_sync(component_id, component_type, document_id)
        return

    # Default: daemon thread
    t = threading.Thread(
        target=_run_write_path_sync,
        args=(component_id, component_type, document_id),
        daemon=True,
        name=f'write-path-{component_type}-{component_id[:8]}',
    )
    t.start()
    logger.debug('Write-path thread started for %s %s', component_type, component_id)


def _run_write_path_sync(component_id: str, component_type: str, document_id: str):
    """Load the component + document from DB and run the write-path pipeline."""
    try:
        from django.apps import apps
        from documents.models import Document

        document = Document.objects.filter(id=document_id).first()
        if not document:
            logger.warning('Write-path: document %s not found', document_id)
            return

        # Resolve the component model by name
        model_map = {
            'Paragraph': 'documents.Paragraph',
            'Sentence': 'documents.Sentence',
            'LatexCode': 'documents.LatexCode',
            'Table': 'documents.Table',
            'Section': 'documents.Section',
        }
        app_label_model = model_map.get(component_type)
        if not app_label_model:
            logger.warning('Write-path: unknown component type %s', component_type)
            return

        app_label, model_name = app_label_model.split('.')
        Model = apps.get_model(app_label, model_name)
        component = Model.objects.filter(id=component_id).first()
        if not component:
            logger.warning('Write-path: %s %s not found', component_type, component_id)
            return

        from .write_path import run_write_path
        result = run_write_path(component, document)

        if result.success:
            logger.info(
                'Write-path OK for %s %s — %d critical, %d contextual edges (%.0fms)',
                component_type, component_id[:8],
                result.critical_edges, result.contextual_edges,
                result.total_ms,
            )
        elif result.skipped:
            logger.debug('Write-path skipped for %s %s: %s', component_type, component_id[:8], result.error)
        else:
            logger.warning('Write-path FAILED for %s %s: %s', component_type, component_id[:8], result.error)

    except Exception as exc:
        logger.exception('Write-path unhandled error for %s %s: %s', component_type, component_id, exc)


# ══════════════════════════════════════════════════════════════════════════
# Signal handlers
# ══════════════════════════════════════════════════════════════════════════

def _on_paragraph_save(sender, instance, **kwargs):
    """When a Paragraph is saved, propagate staleness up."""
    section = getattr(instance, 'section', None)
    document = section.document if section else None
    _propagate_staleness(instance, section=section, document=document)


def _on_sentence_save(sender, instance, **kwargs):
    """When a Sentence is saved, propagate staleness up through paragraph → section."""
    paragraph = getattr(instance, 'paragraph', None)
    section = paragraph.section if paragraph else None
    document = section.document if section else None
    # Mark the paragraph's inference stale too
    if paragraph:
        _mark_component_stale(paragraph)
    _propagate_staleness(instance, section=section, document=document)


def _on_latexcode_save(sender, instance, **kwargs):
    """When a LatexCode is saved, propagate staleness up."""
    section = getattr(instance, 'section', None)
    document = section.document if section else None
    _propagate_staleness(instance, section=section, document=document)


def _on_table_save(sender, instance, **kwargs):
    """When a Table is saved, propagate staleness up."""
    section = getattr(instance, 'section', None)
    document = section.document if section else None
    _propagate_staleness(instance, section=section, document=document)


def _on_section_save(sender, instance, **kwargs):
    """When a Section itself is saved (title change, reorder), propagate."""
    document = getattr(instance, 'document', None)
    _mark_section_aggregate_stale(instance)
    # Also propagate to parent
    if instance.parent_id:
        _mark_section_aggregate_stale(instance.parent)
    if document:
        _mark_document_inference_stale(document)


# ══════════════════════════════════════════════════════════════════════════
# Registration
# ══════════════════════════════════════════════════════════════════════════

_registered = False


def register_signals():
    """
    Connect all inference propagation signals.

    Call this from ``AppConfig.ready()`` or import this module at startup.
    Safe to call multiple times — uses a guard flag.
    """
    global _registered
    if _registered:
        return
    _registered = True

    from documents.models import Paragraph, Sentence, LatexCode, Table, Section

    post_save.connect(_on_paragraph_save, sender=Paragraph, dispatch_uid='inference_paragraph_save')
    post_save.connect(_on_sentence_save, sender=Sentence, dispatch_uid='inference_sentence_save')
    post_save.connect(_on_latexcode_save, sender=LatexCode, dispatch_uid='inference_latexcode_save')
    post_save.connect(_on_table_save, sender=Table, dispatch_uid='inference_table_save')
    post_save.connect(_on_section_save, sender=Section, dispatch_uid='inference_section_save')

    logger.info('Inference signals registered for auto-propagation')
