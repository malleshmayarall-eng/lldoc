"""
Document Creator Executor — creates editor documents from CLM metadata
=====================================================================
When a ``doc_create`` node is executed, this module:

1. Gets the list of incoming CLM document IDs (from upstream nodes)
2. For each document:
   a. Extracts metadata from ``extracted_metadata`` + ``global_metadata``
   b. Maps source fields → document fields via ``node.config.field_mappings``
   c. Checks required fields for the chosen creation mode
   d. Creates/duplicates an editor ``documents.Document``
   e. Records the result in ``DocumentCreationResult``
3. Stores per-node summary in ``node.last_result``
4. Returns a detailed report for frontend display

Supported creation modes (from ``node.config.creation_mode``):
  - **template**    → ``DocumentDrafter.create_from_template()``
  - **duplicate**   → ``_deep_clone_document()`` from branching_views
  - **quick_latex** → ``_clone_quick_latex()`` or new quick-latex doc
  - **structured**  → ``DocumentDrafter.create_structured_document()``
"""
import logging

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from .models import (
    DocumentCreationResult,
    WorkflowDocument,
    WorkflowNode,
)

logger = logging.getLogger(__name__)

# ─── Field-mapping helpers ──────────────────────────────────────────────────

# Direct model fields on ``documents.Document`` that can be set via metadata
DIRECT_DOCUMENT_FIELDS = {
    'title', 'document_type', 'category', 'jurisdiction', 'governing_law',
    'reference_number', 'project_name', 'term_length', 'auto_renewal',
    'renewal_terms', 'effective_date', 'expiration_date', 'execution_date',
    'author', 'contract_value', 'currency',
}


def _build_mapped_metadata(
    doc: WorkflowDocument,
    field_mappings: list[dict],
) -> dict:
    """
    Combine ``extracted_metadata`` + ``global_metadata`` from the CLM
    document, then apply ``field_mappings`` to produce a dict keyed by
    the *target* document field names.

    Each mapping entry looks like::

        {
            "source_field": "party_1_name",   # key in CLM metadata
            "target_field": "parties[0].name", # destination
        }

    For simple top-level fields (title, governing_law, …) the target
    is the field name itself.  For nested structures (parties, signatories)
    a dotted-path is supported in *target_field*, but the caller is
    responsible for interpreting it — this function returns the flat
    ``{target_field: value}`` map.
    """
    combined: dict = {}
    combined.update(doc.global_metadata or {})
    combined.update(doc.extracted_metadata or {})
    # Document-level convenience keys
    combined.setdefault('document_title', doc.title)
    combined.setdefault('document_id', str(doc.id))
    combined.setdefault('file_type', doc.file_type)

    mapped: dict = {}
    for mapping in field_mappings:
        src = mapping.get('source_field', '').strip()
        tgt = mapping.get('target_field', src).strip()
        if not src:
            continue
        value = combined.get(src)
        if value is not None and str(value).strip():
            mapped[tgt] = value
        else:
            mapped[tgt] = None
    return mapped


def _apply_metadata_to_kwargs(
    mapped: dict,
    template_replacements: dict | None = None,
) -> tuple[dict, dict, dict, dict, list]:
    """
    Split the flat *mapped* dict into:

    * **doc_kwargs** – fields directly settable on ``Document.objects.create()``
    * **replacements** – template ``[[placeholder]]`` replacements
    * **extra_meta** – everything else (goes into ``document_metadata``)
    * **custom_meta** – fields prefixed with ``custom_metadata.`` → stored
      in ``Document.custom_metadata``
    * **parties** – list of party dicts (if any)

    Target field routing:

    * ``custom_metadata.my_key`` → ``custom_meta['my_key']``
    * ``document_metadata.legal.ref`` → ``extra_meta['legal.ref']``
    * Any key in ``DIRECT_DOCUMENT_FIELDS`` → ``doc_kwargs``
    * ``parties*`` → ``parties`` list
    * Everything else → ``extra_meta`` + ``replacements``

    ``template_replacements`` from ``node.config`` can supply static
    values that override (or supplement) mapped values.
    """
    doc_kwargs: dict = {}
    replacements: dict = dict(template_replacements or {})
    extra_meta: dict = {}
    custom_meta: dict = {}
    parties: list = []

    for key, value in mapped.items():
        if value is None:
            continue
        # Route custom_metadata.* fields
        if key.startswith('custom_metadata.'):
            nested_key = key[len('custom_metadata.'):]
            if nested_key:
                custom_meta[nested_key] = value
        # Route document_metadata.* fields
        elif key.startswith('document_metadata.'):
            nested_key = key[len('document_metadata.'):]
            if nested_key:
                extra_meta[nested_key] = value
        elif key in DIRECT_DOCUMENT_FIELDS:
            doc_kwargs[key] = value
        elif key.startswith('parties'):
            # Accumulate into parties list (simple strategy: each
            # mapped party field becomes an entry)
            parties.append({'name': value, 'role': key})
        else:
            # Also add to replacements so templates can interpolate
            replacements[key] = str(value)
            extra_meta[key] = value

    return doc_kwargs, replacements, extra_meta, custom_meta, parties


# ─── Per-mode creation helpers ──────────────────────────────────────────────

def _create_from_template(
    config: dict,
    mapped: dict,
    user: User,
) -> 'Document':  # noqa: F821
    """Create an editor document from a ``DocumentTemplate``."""
    from documents.document_drafter import DocumentDrafter

    template_name = config.get('template_name', 'service_agreement')
    doc_kwargs, replacements, extra_meta, custom_meta, parties = _apply_metadata_to_kwargs(
        mapped, config.get('template_replacements'),
    )

    # Merge custom_metadata from mappings with static custom_metadata from config
    merged_custom = {**config.get('custom_metadata', {}), **custom_meta}

    metadata = {
        **doc_kwargs,
        'parties': parties or config.get('default_parties', []),
        'document_metadata': extra_meta,
        'custom_metadata': merged_custom,
    }
    return DocumentDrafter.create_from_template(
        template_name=template_name,
        user=user,
        metadata=metadata,
        replacements=replacements,
    )


def _create_from_duplicate(
    config: dict,
    mapped: dict,
    user: User,
) -> 'Document':  # noqa: F821
    """Deep-clone an existing editor document with metadata overrides."""
    from documents.branching_views import _deep_clone_document
    from documents.models import Document

    source_doc_id = config.get('source_document_id')
    if not source_doc_id:
        raise ValueError('source_document_id is required for duplicate mode')

    source = Document.objects.get(id=source_doc_id)
    doc_kwargs, replacements, extra_meta, custom_meta, parties = _apply_metadata_to_kwargs(mapped)

    # Merge custom_metadata from mappings with static custom_metadata from config
    merged_custom = {**config.get('custom_metadata', {}), **custom_meta} or None

    title = doc_kwargs.pop('title', None)
    return _deep_clone_document(
        source,
        user=user,
        title_override=title or '',
        metadata_overrides=extra_meta or None,
        custom_metadata_overrides=merged_custom,
        parties_override=parties or None,
        include_structure=config.get('include_structure', True),
        include_images=config.get('include_images', False),
    )


def _create_quick_latex(
    config: dict,
    mapped: dict,
    user: User,
) -> 'Document':  # noqa: F821
    """
    Create a Quick LaTeX editor document.

    If ``source_document_id`` is provided, clones an existing quick-latex doc.
    Otherwise creates a new one with the supplied latex_code.
    """
    from documents.models import Document
    from documents.quick_latex_views import (
        _clone_quick_latex,
        _ensure_single_latex_block,
    )

    source_doc_id = config.get('source_document_id')
    doc_kwargs, replacements, extra_meta, custom_meta, parties = _apply_metadata_to_kwargs(mapped)

    # Merge custom_metadata from mappings with static custom_metadata from config
    merged_custom = {**config.get('custom_metadata', {}), **custom_meta}

    if source_doc_id:
        source = Document.objects.get(id=source_doc_id)
        title = doc_kwargs.pop('title', None)
        return _clone_quick_latex(
            source,
            user=user,
            title_override=title or '',
            metadata_overrides=extra_meta or None,
            custom_metadata_overrides=merged_custom or None,
            parties_override=parties or None,
        )

    # Create a brand-new quick-latex document
    title = doc_kwargs.pop('title', mapped.get('document_title', 'Untitled LaTeX'))
    latex_code = config.get('latex_code', '')
    code_type = config.get('code_type', 'latex')
    topic = config.get('topic', '')

    doc = Document.objects.create(
        title=title,
        document_mode='quick_latex',
        is_latex_code=True,
        latex_code=latex_code,
        created_by=user,
        last_modified_by=user,
        status='draft',
        is_draft=True,
        author=user.get_full_name() or user.username,
        parties=parties or [],
        document_metadata=extra_meta,
        custom_metadata=merged_custom,
        **{k: v for k, v in doc_kwargs.items() if k in DIRECT_DOCUMENT_FIELDS - {'title'}},
    )
    _ensure_single_latex_block(doc, latex_code=latex_code, code_type=code_type,
                               topic=topic, user=user)
    return doc


def _create_structured(
    config: dict,
    mapped: dict,
    user: User,
) -> 'Document':  # noqa: F821
    """Create a structured editor document from section definitions in config."""
    from documents.document_drafter import DocumentDrafter

    doc_kwargs, replacements, extra_meta, custom_meta, parties = _apply_metadata_to_kwargs(mapped)

    # Merge custom_metadata from mappings with static custom_metadata from config
    merged_custom = {**config.get('custom_metadata', {}), **custom_meta}

    title = doc_kwargs.pop('title', mapped.get('document_title', 'Untitled Document'))
    sections_data = config.get('sections', [])
    if not sections_data:
        raise ValueError('sections list is required for structured mode')

    # Apply replacements to section content
    processed_sections = []
    for section in sections_data:
        content = section.get('content', '')
        for key, value in replacements.items():
            content = content.replace(f'[[{key}]]', str(value))
        processed_sections.append({
            'title': section.get('title', 'Untitled Section'),
            'content': content,
            'paragraphs': section.get('paragraphs'),
        })

    metadata = {
        **doc_kwargs,
        'parties': parties or [],
        'document_metadata': extra_meta,
        'custom_metadata': merged_custom,
    }

    return DocumentDrafter.create_structured_document(
        user=user,
        title=title,
        sections_data=processed_sections,
        metadata=metadata,
    )


# ─── Mode dispatch ──────────────────────────────────────────────────────────

_MODE_HANDLERS = {
    'template': _create_from_template,
    'duplicate': _create_from_duplicate,
    'quick_latex': _create_quick_latex,
    'structured': _create_structured,
}

# Fields that MUST be present in the mapped metadata for each mode.
# Users can extend this via ``node.config.required_fields``.
_MODE_REQUIRED_FIELDS: dict[str, list[str]] = {
    'template': [],           # template has its own defaults
    'duplicate': [],          # source_document_id is in config, not metadata
    'quick_latex': [],
    'structured': [],
}


# ─── Main entry point ──────────────────────────────────────────────────────

def execute_doc_create_node(
    node: WorkflowNode,
    incoming_document_ids: list,
    triggered_by=None,
) -> dict:
    """
    Execute a ``doc_create`` node for every incoming CLM document.

    Args:
        node: ``WorkflowNode`` of type ``'doc_create'`` with config like::

            {
                "creation_mode": "template",
                "template_name": "service_agreement",
                "field_mappings": [
                    {"source_field": "party_1_name", "target_field": "parties[0].name"},
                    {"source_field": "contract_amount", "target_field": "contract_value"},
                ],
                "required_fields": ["party_1_name"],  // optional extras
                "source_document_id": "<uuid>",  // for duplicate / quick_latex clone
                "template_replacements": {"governing_law": "New York"},  // static values
                "sections": [...],  // for structured mode
                "custom_metadata": {},
            }

        incoming_document_ids: list of WorkflowDocument UUIDs from upstream
        triggered_by: User who triggered the workflow (optional)

    Returns:
        dict with summary and per-document results
    """
    config = node.config or {}
    creation_mode = config.get('creation_mode', 'template')

    handler = _MODE_HANDLERS.get(creation_mode)
    if not handler:
        return {
            'error': f'Unknown creation_mode "{creation_mode}"',
            'node_id': str(node.id),
            'status': 'failed',
        }

    field_mappings = config.get('field_mappings', [])
    extra_required = set(config.get('required_fields', []))
    base_required = set(_MODE_REQUIRED_FIELDS.get(creation_mode, []))
    required = base_required | extra_required

    # Resolve user
    user = triggered_by
    if not user:
        user = User.objects.filter(is_superuser=True).first()
    if not user:
        return {
            'error': 'No user available to create documents',
            'node_id': str(node.id),
            'status': 'failed',
        }

    documents = WorkflowDocument.objects.filter(
        id__in=incoming_document_ids,
    ).select_related('workflow')

    results = []
    created = 0
    skipped = 0
    failed = 0

    for doc in documents:
        mapped = _build_mapped_metadata(doc, field_mappings)

        # Check required fields
        missing = [f for f in required if not mapped.get(f)]

        if missing:
            result = DocumentCreationResult.objects.create(
                workflow=node.workflow,
                node=node,
                source_clm_document=doc,
                status='skipped',
                creation_mode=creation_mode,
                metadata_used=mapped,
                missing_fields=missing,
                error_message=f'Missing required fields: {", ".join(missing)}',
                triggered_by=triggered_by,
            )
            skipped += 1
            results.append(_result_to_dict(result, doc))
            continue

        try:
            with transaction.atomic():
                editor_doc = handler(config, mapped, user)

            result = DocumentCreationResult.objects.create(
                workflow=node.workflow,
                node=node,
                source_clm_document=doc,
                created_document=editor_doc,
                status='created',
                creation_mode=creation_mode,
                metadata_used=mapped,
                triggered_by=triggered_by,
            )
            created += 1
            results.append(_result_to_dict(result, doc))

        except Exception as e:
            logger.error(
                "doc_create failed for CLM doc %s on node %s: %s",
                doc.id, node.id, e,
                exc_info=True,
            )
            result = DocumentCreationResult.objects.create(
                workflow=node.workflow,
                node=node,
                source_clm_document=doc,
                status='failed',
                creation_mode=creation_mode,
                metadata_used=mapped,
                error_message=str(e),
                triggered_by=triggered_by,
            )
            failed += 1
            results.append(_result_to_dict(result, doc))

    # Store summary in node.last_result
    if created == len(incoming_document_ids):
        overall_status = 'completed'
    elif created == 0 and skipped == 0:
        overall_status = 'failed'
    elif created == 0:
        overall_status = 'skipped'
    else:
        overall_status = 'partial'

    node.last_result = {
        'count': len(incoming_document_ids),
        'document_ids': [str(d) for d in incoming_document_ids],
        'creation_mode': creation_mode,
        'created': created,
        'skipped': skipped,
        'failed': failed,
        'status': overall_status,
        'created_document_ids': [
            r['created_document_id'] for r in results
            if r.get('created_document_id')
        ],
    }
    node.save(update_fields=['last_result', 'updated_at'])

    return {
        'node_id': str(node.id),
        'creation_mode': creation_mode,
        'status': overall_status,
        'total': len(incoming_document_ids),
        'created': created,
        'skipped': skipped,
        'failed': failed,
        'results': results,
        'created_document_ids': [
            r['created_document_id'] for r in results
            if r.get('created_document_id')
        ],
    }


def _result_to_dict(result: DocumentCreationResult, doc: WorkflowDocument) -> dict:
    """Serialise a ``DocumentCreationResult`` for the API response."""
    data = {
        'result_id': str(result.id),
        'source_document_id': str(doc.id),
        'source_document_title': doc.title,
        'created_document_id': str(result.created_document_id) if result.created_document_id else None,
        'created_document_title': (
            result.created_document.title
            if result.created_document else None
        ),
        'status': result.status,
        'creation_mode': result.creation_mode,
        'metadata_used': result.metadata_used,
        'missing_fields': result.missing_fields,
        'error_message': result.error_message,
    }

    # Enrich with the created document's actual metadata so the frontend
    # can display what was *written* to the editor document, not just
    # what CLM source fields were read.
    if result.created_document:
        created = result.created_document
        cm = created.custom_metadata if isinstance(created.custom_metadata, dict) else {}
        dm = created.document_metadata if isinstance(created.document_metadata, dict) else {}
        # Filter out internal/processing keys for display
        display_cm = {
            k: v for k, v in cm.items()
            if k != 'processing_settings' and not k.startswith('_')
        }
        display_dm = {}
        for k, v in dm.items():
            if isinstance(v, dict):
                for sub_k, sub_v in v.items():
                    if sub_v is not None and str(sub_v).strip():
                        display_dm[f'{k}.{sub_k}'] = sub_v
            elif v is not None and str(v).strip():
                display_dm[k] = v

        data['created_document_metadata'] = {
            'title': created.title,
            'document_type': created.document_type,
            'category': getattr(created, 'category', ''),
            'governing_law': getattr(created, 'governing_law', '') or '',
            'jurisdiction': getattr(created, 'jurisdiction', '') or '',
            'author': getattr(created, 'author', '') or '',
            'custom_metadata': display_cm,
            'document_metadata': display_dm,
        }

    return data
