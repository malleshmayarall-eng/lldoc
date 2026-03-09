"""
Inference Celery Tasks
=======================

Async tasks for the write-path pipeline.  These are dispatched by
``signals.py`` when ``INFERENCE_WRITE_PATH_ASYNC=celery``.

Requires a running Celery worker::

    celery -A drafter worker -l info
"""
import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    name='aiservices.inference.write_path',
    max_retries=2,
    default_retry_delay=30,
    soft_time_limit=120,
    time_limit=180,
    acks_late=True,
)
def run_write_path_task(self, component_id: str, component_type: str, document_id: str):
    """
    Celery task wrapper around the synchronous write-path pipeline.

    Args:
        component_id:   UUID string of the changed component.
        component_type: Model class name (e.g. 'Paragraph', 'Table').
        document_id:    UUID string of the owning document.
    """
    from django.apps import apps
    from documents.models import Document
    from .write_path import run_write_path

    # Resolve document
    document = Document.objects.filter(id=document_id).first()
    if not document:
        logger.warning('Write-path task: document %s not found', document_id)
        return {'status': 'not_found', 'detail': 'document not found'}

    # Resolve component model
    model_map = {
        'Paragraph': ('documents', 'Paragraph'),
        'Sentence': ('documents', 'Sentence'),
        'LatexCode': ('documents', 'LatexCode'),
        'Table': ('documents', 'Table'),
        'Section': ('documents', 'Section'),
    }
    app_model = model_map.get(component_type)
    if not app_model:
        logger.warning('Write-path task: unknown component type %s', component_type)
        return {'status': 'error', 'detail': f'unknown type: {component_type}'}

    Model = apps.get_model(*app_model)
    component = Model.objects.filter(id=component_id).first()
    if not component:
        logger.warning('Write-path task: %s %s not found', component_type, component_id)
        return {'status': 'not_found', 'detail': f'{component_type} not found'}

    try:
        result = run_write_path(component, document)
        return {
            'status': 'ok' if result.success else ('skipped' if result.skipped else 'error'),
            'critical_edges': result.critical_edges,
            'contextual_edges': result.contextual_edges,
            'total_ms': result.total_ms,
            'error': result.error or None,
        }
    except Exception as exc:
        logger.exception('Write-path task failed for %s %s: %s', component_type, component_id, exc)
        raise self.retry(exc=exc)


@shared_task(
    name='aiservices.inference.write_path_document',
    soft_time_limit=600,
    time_limit=900,
    acks_late=True,
)
def run_write_path_document_task(document_id: str):
    """
    Run the full write-path for every component in a document.

    This is the Celery equivalent of ``write_path.run_write_path_for_document()``.
    """
    from documents.models import Document
    from .write_path import run_write_path_for_document

    document = Document.objects.filter(id=document_id).first()
    if not document:
        logger.warning('Write-path document task: document %s not found', document_id)
        return {'status': 'not_found'}

    try:
        result = run_write_path_for_document(document)
        return {
            'status': 'ok',
            'total_components': result.total_components,
            'components_processed': result.components_processed,
            'components_skipped': result.components_skipped,
            'components_failed': result.components_failed,
            'total_edges': result.total_edges,
            'total_ms': result.total_ms,
        }
    except Exception as exc:
        logger.exception('Write-path document task failed for %s: %s', document_id, exc)
        raise
