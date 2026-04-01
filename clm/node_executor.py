"""
Workflow Executor — 11-Node System
===================================
Executes a workflow DAG:
  Input → Rule(s) → Listener(s) → Validator(s) → Action(s) → AI(s) → Scraper(s) → AND Gate(s) → Doc Creator(s) → Sheet(s) → Output

Node types:
  • input      — supplies all (or single-doc) workflow documents
  • rule       — filters documents by metadata conditions
  • listener   — gate/watch/approve; inbox/folder triggers
  • validator   — multi-level human approval with dashboards
  • action     — runs plugins (email, WhatsApp, webhook, etc.)
  • ai         — sends each document to an AI model (Gemini/ChatGPT)
  • scraper    — scrapes allowed websites for keywords, enriches doc metadata
  • and_gate   — logic gate: passes docs present in ALL upstream paths (intersection)
  • doc_create — creates/duplicates editor documents from CLM metadata
  • sheet      — reads from or writes to a linked Sheet (input/storage mode)
  • output     — collects the final filtered list

Regular nodes with multiple inputs automatically merge all upstream docs (union),
so a separate OR gate is unnecessary. The AND gate is the only gate type.

Single-document mode:
  When `single_document_ids` is passed, only those documents flow through
  the DAG. Used by listener inbox/folder watchers.
"""
import logging
import re
import uuid as _uuid
from collections import defaultdict, deque
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from django.utils import timezone

from .models import Workflow, WorkflowDocument, WorkflowExecution, WorkflowNode

logger = logging.getLogger(__name__)

# Known file extensions for type detection (shared with views.py upload logic)
_KNOWN_FILE_TYPES = frozenset({
    'pdf', 'docx', 'doc', 'txt', 'csv', 'json', 'xml', 'html', 'md',
    'xlsx', 'xls', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'tif',
    'webp', 'svg', 'rtf', 'odt', 'pptx', 'ppt', 'htm',
})


# ---------------------------------------------------------------------------
# Typed Field Registry — knows every field's type for proper coercion
# ---------------------------------------------------------------------------

# Date formats to try (order matters — most unambiguous first)
_DATE_FORMATS = (
    '%Y-%m-%d',        # 2025-03-15
    '%Y-%m-%dT%H:%M',  # 2025-03-15T14:30
    '%Y-%m-%dT%H:%M:%S', # 2025-03-15T14:30:00
    '%Y/%m/%d',        # 2025/03/15
    '%d-%m-%Y',        # 15-03-2025
    '%d/%m/%Y',        # 15/03/2025
    '%m/%d/%Y',        # 03/15/2025
    '%b %d, %Y',       # Mar 15, 2025
    '%B %d, %Y',       # March 15, 2025
    '%d %b %Y',        # 15 Mar 2025
    '%d %B %Y',        # 15 March 2025
)

# Built-in type hints for well-known field names.
# Keys are substrings — if a field name contains the substring, it gets
# that type unless overridden by the AI node's json_fields definition.
_BUILTIN_TYPE_HINTS: dict[str, str] = {
    # Dates
    'date':       'date',
    'expir':      'date',
    'start':      'date',
    'end_date':   'date',
    'due':        'date',
    'graduation': 'date',
    'created_at': 'date',
    'updated_at': 'date',
    # Numbers
    'amount':     'number',
    'value':      'number',
    'cost':       'number',
    'price':      'number',
    'salary':     'number',
    'rent':       'number',
    'deposit':    'number',
    'fee':        'number',
    'total':      'number',
    'subtotal':   'number',
    'tax_amount': 'number',
    'premium':    'number',
    'deductible': 'number',
    'rate':       'number',
    'count':      'number',
    'score':      'number',
    'years_of':   'number',
    # Booleans
    'auto_renew': 'boolean',
    'is_':        'boolean',
    'has_':       'boolean',
    # Lists (skill/language fields)
    'skills':     'list',
    'languages':  'list',
    'certifications': 'list',
    'tools':      'list',
    'frameworks': 'list',
    'items':      'list',
    'urls':       'list',
}


def _build_field_type_registry(workflow) -> dict[str, str]:
    """
    Build a {field_name: type} registry for the entire workflow.

    Priority (highest first):
      1. AI node json_fields — explicit type declarations
      2. DerivedField definitions — explicit field_type
      3. Built-in type hints — inferred from field name patterns
      4. Fallback: 'string'
    """
    registry: dict[str, str] = {}

    # 1. AI node json_fields (most authoritative)
    for node in workflow.nodes.filter(node_type='ai'):
        config = node.config or {}
        if config.get('output_format') == 'json_extract':
            for jf in config.get('json_fields', []):
                name = jf.get('name', '').strip()
                ftype = jf.get('type', 'string').strip().lower()
                if name:
                    # Normalise type names
                    if ftype in ('int', 'integer', 'float', 'decimal', 'number', 'numeric'):
                        registry[name] = 'number'
                    elif ftype in ('bool', 'boolean'):
                        registry[name] = 'boolean'
                    elif ftype in ('date', 'datetime'):
                        registry[name] = 'date'
                    elif ftype in ('list', 'array'):
                        registry[name] = 'list'
                    else:
                        registry[name] = 'string'

    # 2. DerivedField definitions
    for df in workflow.derived_fields.all():
        if df.name not in registry:
            registry[df.name] = df.field_type or 'string'

    # 3. Built-in type hints (only for fields not already declared)
    # Collect all known field names from the extraction template
    all_fields = set(registry.keys())
    for fname in list((workflow.extraction_template or {}).keys()):
        all_fields.add(fname)
    # Add rule condition fields
    for node in workflow.nodes.filter(node_type='rule'):
        for c in (node.config or {}).get('conditions', []):
            f = c.get('field', '').strip()
            if f:
                all_fields.add(f)

    for fname in all_fields:
        if fname in registry:
            continue
        fname_lower = fname.lower()
        matched = False
        for hint_substring, hint_type in _BUILTIN_TYPE_HINTS.items():
            if hint_substring in fname_lower:
                registry[fname] = hint_type
                matched = True
                break
        if not matched:
            registry[fname] = 'string'

    return registry


# ---------------------------------------------------------------------------
# Condition evaluation helpers — typed, list-aware, date-string-aware
# ---------------------------------------------------------------------------

def _get_nested_value(data: dict, dot_path: str) -> Any:
    """Traverse a nested dict by dot-separated key path."""
    keys = dot_path.split('.')
    current = data
    for key in keys:
        if isinstance(current, dict):
            current = current.get(key)
        else:
            return None
    return current


_SENTINEL = object()  # distinguishes "field is missing" from "field is None"


def _parse_date(value: Any) -> date | None:
    """Try to parse a date from a string, date, or datetime. Returns None on failure."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not isinstance(value, str):
        return None
    s = value.strip()
    if not s:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except (ValueError, TypeError):
            continue
    return None


def _parse_number(value: Any) -> Decimal | None:
    """Try to parse a number from a string or numeric type. Strips $, €, £, commas."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    if isinstance(value, Decimal):
        return value
    if not isinstance(value, str):
        return None
    s = value.strip()
    # Strip common currency symbols and separators
    for ch in ('$', '€', '£', '¥', '₹', ',', ' '):
        s = s.replace(ch, '')
    # Handle suffixes like "50K", "1.2M"
    multiplier = 1
    if s and s[-1] in ('k', 'K'):
        multiplier = 1000
        s = s[:-1]
    elif s and s[-1] in ('m', 'M'):
        multiplier = 1_000_000
        s = s[:-1]
    try:
        return Decimal(s) * multiplier
    except (InvalidOperation, ValueError):
        return None


def _parse_boolean(value: Any) -> bool | None:
    """Parse a boolean from various representations."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if not isinstance(value, str):
        return None
    s = value.strip().lower()
    if s in ('true', 'yes', '1', 'y'):
        return True
    if s in ('false', 'no', '0', 'n'):
        return False
    return None


def _to_string_list(value: Any) -> list[str]:
    """Normalise a value to a list of strings."""
    if isinstance(value, list):
        return [str(v).strip() for v in value]
    if isinstance(value, str):
        # Try JSON parse
        import json as _json
        try:
            parsed = _json.loads(value)
            if isinstance(parsed, list):
                return [str(v).strip() for v in parsed]
        except (ValueError, TypeError):
            pass
        # Comma-separated fallback
        if ',' in value:
            return [v.strip() for v in value.split(',') if v.strip()]
        return [value.strip()] if value.strip() else []
    return [str(value)] if value is not None else []


def _coerce_typed(field_value: Any, compare_value: str, field_type: str) -> tuple:
    """
    Type-aware coercion. Uses the field_type from the registry to coerce
    correctly instead of guessing.

    Returns (coerced_field, coerced_compare, actual_type).
    If coercion fails for the declared type, falls back through the cascade.
    """
    if field_value is None:
        return None, compare_value, 'none'

    # ── Try declared type first ──────────────────────────────────
    if field_type == 'number':
        f_num = _parse_number(field_value)
        c_num = _parse_number(compare_value)
        if f_num is not None and c_num is not None:
            return f_num, c_num, 'number'

    elif field_type == 'date':
        f_date = _parse_date(field_value)
        c_date = _parse_date(compare_value)
        if f_date is not None and c_date is not None:
            return f_date, c_date, 'date'

    elif field_type == 'boolean':
        f_bool = _parse_boolean(field_value)
        c_bool = _parse_boolean(compare_value)
        if f_bool is not None and c_bool is not None:
            return f_bool, c_bool, 'boolean'

    # ── Auto-detection cascade (fallback) ────────────────────────
    # 1. Numeric
    f_num = _parse_number(field_value)
    c_num = _parse_number(compare_value)
    if f_num is not None and c_num is not None:
        return f_num, c_num, 'number'

    # 2. Date (try string dates too!)
    f_date = _parse_date(field_value)
    c_date = _parse_date(compare_value)
    if f_date is not None and c_date is not None:
        return f_date, c_date, 'date'

    # 3. String fallback
    return str(field_value).lower().strip(), compare_value.lower().strip(), 'string'


def _eval_condition(
    metadata: dict,
    field: str,
    operator: str,
    value: str,
    field_type: str = 'string',
) -> bool:
    """
    Evaluate a single condition against document metadata.

    Supports operators:
      eq, neq, gt, gte, lt, lte,
      contains, not_contains,
      in, not_in,
      exists, not_exists,
      regex, starts_with, ends_with

    Properly handles:
      - Typed coercion (number, date, boolean, list, string)
      - List fields (e.g. technical_skills: ["Python", "React"])
      - Date strings from AI node output
      - Currency/suffix numbers ($50K, 1.2M)
    """
    # ── Existence operators (don't need a value) ─────────────────
    if operator == 'exists':
        raw = _get_nested_value(metadata, field)
        if raw is None:
            return False
        if isinstance(raw, str) and not raw.strip():
            return False
        if isinstance(raw, list) and len(raw) == 0:
            return False
        return True

    if operator == 'not_exists':
        raw = _get_nested_value(metadata, field)
        if raw is None:
            return True
        if isinstance(raw, str) and not raw.strip():
            return True
        if isinstance(raw, list) and len(raw) == 0:
            return True
        return False

    field_value = _get_nested_value(metadata, field)

    # ── List-aware contains / not_contains ───────────────────────
    if operator == 'contains':
        if isinstance(field_value, list):
            return any(
                value.lower() == str(item).lower().strip()
                for item in field_value
            )
        return value.lower() in str(field_value or '').lower()

    if operator == 'not_contains':
        if isinstance(field_value, list):
            return not any(
                value.lower() == str(item).lower().strip()
                for item in field_value
            )
        return value.lower() not in str(field_value or '').lower()

    # ── in / not_in — check if field value is in a comma-separated set ──
    if operator == 'in':
        allowed = {v.strip().lower() for v in value.split(',')}
        if isinstance(field_value, list):
            return any(str(item).lower().strip() in allowed for item in field_value)
        return str(field_value or '').lower().strip() in allowed

    if operator == 'not_in':
        disallowed = {v.strip().lower() for v in value.split(',')}
        if isinstance(field_value, list):
            return not any(str(item).lower().strip() in disallowed for item in field_value)
        return str(field_value or '').lower().strip() not in disallowed

    # ── regex ────────────────────────────────────────────────────
    if operator == 'regex':
        try:
            return bool(re.search(value, str(field_value or ''), re.IGNORECASE))
        except re.error:
            logger.warning(f"Invalid regex in condition: {value}")
            return False

    # ── starts_with / ends_with ──────────────────────────────────
    if operator == 'starts_with':
        return str(field_value or '').lower().startswith(value.lower())

    if operator == 'ends_with':
        return str(field_value or '').lower().endswith(value.lower())

    # ── Comparison operators (eq, neq, gt, gte, lt, lte) ─────────
    f_val, c_val, _ = _coerce_typed(field_value, value, field_type)
    if f_val is None:
        return False

    match operator:
        case 'eq':
            return f_val == c_val
        case 'neq':
            return f_val != c_val
        case 'gt':
            return f_val > c_val
        case 'gte':
            return f_val >= c_val
        case 'lt':
            return f_val < c_val
        case 'lte':
            return f_val <= c_val
        case _:
            return False


# ---------------------------------------------------------------------------
# Per-node executors
# ---------------------------------------------------------------------------

def _execute_input_node(node: WorkflowNode, workflow: Workflow, triggered_by=None, execution=None) -> list[str]:
    """
    Input node: returns document IDs for this workflow.

    source_type (in node.config):
      • 'upload'       — (default) returns all completed documents already uploaded
      • 'email_inbox'  — polls IMAP mailbox, creates new WorkflowDocuments
      • 'webhook'      — docs already ingested via webhook endpoint
      • 'google_drive' — fetch from Google Drive folder (service account)
      • 'dropbox'      — fetch from Dropbox folder (access token)
      • 'onedrive'     — fetch from OneDrive/SharePoint (MS Graph)
      • 's3'           — fetch from AWS S3 bucket
      • 'ftp'          — fetch from FTP/SFTP server
      • 'url_scrape'   — fetch documents from URLs

    Production behaviour:
      • Always re-fetches from the current source (fresh load every execution).
      • If source_type changed since last execution, old-source documents are
        archived (soft-delete) so they don't leak into the pipeline.
      • Extraction/OCR results are cached — the source_hash dedup in
        _already_ingested() prevents re-downloading identical files, and
        completed extraction results persist across re-executions.
      • For sheets source: only rows that actually changed (new or updated
        content hash) are returned as output IDs — unchanged rows are
        skipped so downstream nodes don't re-process them.
    """
    config = node.config or {}
    source_type = config.get('source_type', 'upload')
    organization = workflow.organization

    # ------------------------------------------------------------------
    # Detect source-type change → archive stale documents
    # ------------------------------------------------------------------
    last_result = node.last_result or {}
    prev_source = last_result.get('_last_source_type')

    if prev_source and prev_source != source_type:
        # Source changed: archive documents from the previous source so they
        # don't contaminate the new pipeline.  We keep them as 'archived'
        # (not hard-deleted) so switching back can still benefit from cached
        # extraction results via _already_ingested().
        _source_tags = _source_tags_for(prev_source)
        stale_qs = WorkflowDocument.objects.filter(
            workflow=workflow,
            extraction_status__in=('completed', 'pending', 'processing', 'failed'),
        )
        if _source_tags:
            stale_qs = stale_qs.filter(global_metadata___source__in=_source_tags)
        else:
            # Old upload docs: _source='upload' or missing (legacy).
            # Use positive filter instead of exclude to avoid NULL-in-NOT-IN
            # SQL pitfall on SQLite/Postgres with missing JSON keys.
            from django.db.models import Q
            stale_qs = stale_qs.filter(
                Q(global_metadata___source='upload') |
                Q(global_metadata___source__isnull=True)
            )

        archived_count = stale_qs.update(extraction_status='archived')
        if archived_count:
            logger.info(
                f"Input node source changed {prev_source}→{source_type}: "
                f"archived {archived_count} stale docs"
            )

    # Persist current source_type for next execution's change detection
    node.last_result = {**last_result, '_last_source_type': source_type}
    node.save(update_fields=['last_result'])

    # ------------------------------------------------------------------
    # Fetch fresh documents from the current source
    # ------------------------------------------------------------------

    # Track changed doc IDs for sheets source — only these will be
    # returned as output (not all ready docs).  None means "not sheets
    # source" — the normal ready_ids path will be used.
    _sheets_changed_doc_ids = None

    if source_type == 'email_inbox':
        email_host = config.get('email_host', '')
        email_user = config.get('email_user', '')
        if email_host and email_user:
            from .listener_executor import check_email_inbox
            try:
                # auto_execute=False: the outer execute_workflow() will
                # process these docs through the DAG — we just need the
                # inbox fetch, not a recursive single-doc execution.
                inbox_result = check_email_inbox(
                    node=node,
                    user=triggered_by,
                    auto_execute_override=False,
                )
                logger.info(
                    f"Input node email inbox: found {inbox_result.get('found', 0)} new docs, "
                    f"errors: {inbox_result.get('errors', [])}"
                )
            except Exception as e:
                logger.error(f"Input node email inbox check failed: {e}")

    elif source_type in ('google_drive', 'dropbox', 'onedrive', 's3', 'ftp', 'url_scrape'):
        from .source_integrations import fetch_from_source
        try:
            result = fetch_from_source(
                node, workflow, organization, user=triggered_by,
            )
            logger.info(
                f"Input node {source_type}: found {result.get('found', 0)}, "
                f"skipped {result.get('skipped', 0)}, "
                f"errors: {result.get('errors', [])}"
            )
        except Exception as e:
            logger.error(f"Input node {source_type} fetch failed: {e}")

    elif source_type == 'table':
        # Table source: docs are created via table-upload endpoint (pre-parsed).
        # If a google_sheet_url is configured, re-fetch on every execution.
        google_url = config.get('google_sheet_url', '').strip()
        if google_url:
            from .table_parser import parse_table_file, rows_to_workflow_documents
            try:
                parsed = parse_table_file(
                    file_bytes=b'', filename='',
                    google_sheet_url=google_url,
                )
                if parsed['row_count'] > 0:
                    created = rows_to_workflow_documents(
                        parsed=parsed,
                        workflow=workflow,
                        organization=organization,
                        input_node=node,
                        user=triggered_by,
                    )
                    logger.info(
                        f"Input node table (Google Sheets): "
                        f"parsed {parsed['row_count']} rows, "
                        f"created/matched {len(created)} docs"
                    )
            except Exception as e:
                logger.error(f"Input node table Google Sheets fetch failed: {e}")

    elif source_type == 'folder_upload':
        # Folder upload: import files from a DriveFolder (fileshare app).
        # Re-fetches on execution to pick up newly added folder files.
        folder_id = config.get('folder_id', '')
        if folder_id:
            try:
                from fileshare.models import DriveFile
                drive_files = DriveFile.objects.filter(
                    folder_id=folder_id, is_deleted=False,
                    organization=organization,
                )
                for df in drive_files:
                    if not df.file:
                        continue
                    # Dedup by checksum
                    if df.checksum and WorkflowDocument.objects.filter(
                        workflow=workflow, file_hash=df.checksum,
                    ).exists():
                        continue
                    ext = df.name.rsplit('.', 1)[-1].lower() if '.' in df.name else 'other'
                    doc = WorkflowDocument.objects.create(
                        workflow=workflow,
                        organization=organization,
                        title=df.name,
                        file=df.file,
                        file_type=ext if ext in _KNOWN_FILE_TYPES else 'other',
                        file_size=df.file_size or 0,
                        file_hash=df.checksum or '',
                        uploaded_by=triggered_by,
                        input_node=node,
                        global_metadata={'_source': 'folder_upload', '_folder_id': str(folder_id)},
                    )
                    # Mark as completed — extraction will be handled by
                    # a dedicated extract node in the workflow, not the
                    # input node.
                    doc.extraction_status = 'completed'
                    doc.save(update_fields=['extraction_status'])
                logger.info(f"Input node folder_upload: processed folder {folder_id}")
            except Exception as e:
                logger.error(f"Input node folder_upload failed: {e}")

    elif source_type == 'dms_import':
        # DMS import: import documents from the DMS system by document IDs or filters.
        dms_doc_ids = config.get('dms_document_ids', [])
        dms_category = config.get('dms_category', '')
        if dms_doc_ids or dms_category:
            try:
                from dms.models import DmsDocument
                dms_qs = DmsDocument.objects.all()
                if dms_doc_ids:
                    dms_qs = dms_qs.filter(id__in=dms_doc_ids)
                elif dms_category:
                    dms_qs = dms_qs.filter(category=dms_category)

                for dms_doc in dms_qs:
                    # Dedup by title + file_hash
                    content_hash = ''
                    if dms_doc.pdf_data:
                        import hashlib
                        content_hash = hashlib.sha256(dms_doc.pdf_data).hexdigest()
                    if content_hash and WorkflowDocument.objects.filter(
                        workflow=workflow, file_hash=content_hash,
                    ).exists():
                        continue
                    # Create a WorkflowDocument from DMS content
                    from django.core.files.base import ContentFile
                    cf = ContentFile(dms_doc.pdf_data, name=f"{dms_doc.title or 'dms_doc'}.pdf")
                    doc = WorkflowDocument.objects.create(
                        workflow=workflow,
                        organization=organization,
                        title=dms_doc.title or dms_doc.original_filename or str(dms_doc.id),
                        file=cf,
                        file_type='pdf',
                        file_size=dms_doc.file_size or len(dms_doc.pdf_data or b''),
                        file_hash=content_hash,
                        uploaded_by=triggered_by,
                        input_node=node,
                        original_text=dms_doc.extracted_text or '',
                        text_source='direct' if dms_doc.extracted_text else 'none',
                        global_metadata={
                            '_source': 'dms_import',
                            '_dms_document_id': str(dms_doc.id),
                        },
                    )
                    # Mark as completed — extraction will be handled by
                    # a dedicated extract node in the workflow.
                    doc.extraction_status = 'completed'
                    doc.save(update_fields=['extraction_status'])
                logger.info(f"Input node dms_import: imported from DMS")
            except Exception as e:
                logger.error(f"Input node dms_import failed: {e}")

    elif source_type == 'sheets':
        # Sheets import: import rows from a Sheet (sheets app) as documents.
        #
        # PRODUCTION DEDUP via InputNodeRow:
        # On first execution, all rows are ingested and tracked in InputNodeRow.
        # On subsequent executions:
        #   - InputNodeRow.load_hash_map() gives us {row_id: (hash, doc_id)}
        #   - For event-triggered runs, only changed_row_ids are checked
        #   - For manual runs, ALL rows are compared against stored hashes
        #   - Unchanged rows are SKIPPED at the comparison level
        #   - Changed rows UPDATE the existing WorkflowDocument + InputNodeRow
        #   - New rows CREATE a WorkflowDocument + InputNodeRow
        #
        # Only created/updated doc IDs are returned so downstream nodes
        # don't re-process unchanged rows.
        _sheets_changed_doc_ids = []
        sheet_id = config.get('sheet_id', '')
        if sheet_id:
            try:
                from sheets.models import Sheet
                from .models import InputNodeRow

                sheet = Sheet.objects.get(id=sheet_id, organization=organization)

                # ── Filter to only changed rows when event-triggered ──
                _trigger_ctx = getattr(execution, 'trigger_context', None) or {} if execution else {}
                _ctx_changed_row_ids = _trigger_ctx.get('changed_data', {}).get('changed_row_ids') or _trigger_ctx.get('changed_row_ids')
                _ctx_changed_row_orders = _trigger_ctx.get('changed_data', {}).get('changed_row_orders') or _trigger_ctx.get('changed_row_orders')

                rows = sheet.rows.prefetch_related('cells').order_by('order')
                if _ctx_changed_row_ids:
                    rows = rows.filter(id__in=_ctx_changed_row_ids)
                    logger.info(
                        f"Input node sheets: filtering to {len(_ctx_changed_row_ids)} "
                        f"changed row(s) by ID from trigger_context"
                    )
                elif _ctx_changed_row_orders:
                    rows = rows.filter(order__in=_ctx_changed_row_orders)
                    logger.info(
                        f"Input node sheets: filtering to {len(_ctx_changed_row_orders)} "
                        f"changed row(s) by order from trigger_context"
                    )

                # ── Load known-rows hash map from InputNodeRow ────────
                # {row_id_str: (content_hash, doc_id_str)}
                _known_rows = InputNodeRow.load_hash_map(node)

                imported_count = 0
                updated_count = 0
                skipped_count = 0

                for row in rows:
                    # Build metadata from cells
                    row_meta = {}
                    for cell in row.cells.all():
                        col_def = next(
                            (c for c in (sheet.columns or []) if c.get('key') == cell.column_key),
                            None,
                        )
                        label = col_def.get('label', cell.column_key) if col_def else cell.column_key
                        row_meta[label] = cell.computed_value or cell.raw_value or ''

                    if not any(v for v in row_meta.values()):
                        continue  # skip empty rows

                    # Title from first column value or row order
                    title_val = list(row_meta.values())[0] if row_meta else ''
                    title = str(title_val)[:200] or f"Sheet Row {row.order + 1}"

                    # Content hash for dedup/change detection
                    import hashlib, json as _json
                    row_hash = hashlib.sha256(
                        _json.dumps(row_meta, sort_keys=True, default=str).encode()
                    ).hexdigest()

                    global_meta = {
                        '_source': 'sheets',
                        '_sheet_id': str(sheet_id),
                        '_row_order': row.order,
                        '_row_id': str(row.id),
                        **row_meta,
                    }

                    _row_id_str = str(row.id)
                    _known = _known_rows.get(_row_id_str)

                    if _known:
                        # Row already tracked
                        _prev_hash, _prev_doc_id = _known
                        if _prev_hash == row_hash:
                            # Unchanged — skip entirely
                            skipped_count += 1
                            continue

                        # Content changed — update existing WorkflowDocument
                        try:
                            existing = WorkflowDocument.objects.get(id=_prev_doc_id)
                            existing.title = title
                            existing.file_hash = row_hash
                            existing.extracted_metadata = row_meta
                            existing.global_metadata = global_meta
                            existing.extraction_status = 'completed'
                            existing.save(update_fields=[
                                'title', 'file_hash', 'extracted_metadata',
                                'global_metadata', 'extraction_status', 'updated_at',
                            ])
                            # Update InputNodeRow hash
                            InputNodeRow.upsert(
                                node=node, workflow=workflow,
                                row_id=_row_id_str, content_hash=row_hash,
                                document=existing, source_type='sheets',
                                sheet_id=str(sheet_id), row_order=row.order,
                            )
                            updated_count += 1
                            _sheets_changed_doc_ids.append(str(existing.id))
                        except WorkflowDocument.DoesNotExist:
                            # Doc was deleted — re-create
                            new_doc = WorkflowDocument.objects.create(
                                workflow=workflow, organization=organization,
                                title=title, file_type='other', file_hash=row_hash,
                                uploaded_by=triggered_by, input_node=node,
                                extracted_metadata=row_meta, global_metadata=global_meta,
                                extraction_status='completed',
                            )
                            InputNodeRow.upsert(
                                node=node, workflow=workflow,
                                row_id=_row_id_str, content_hash=row_hash,
                                document=new_doc, source_type='sheets',
                                sheet_id=str(sheet_id), row_order=row.order,
                            )
                            imported_count += 1
                            _sheets_changed_doc_ids.append(str(new_doc.id))
                    else:
                        # New row — create doc + track in InputNodeRow
                        new_doc = WorkflowDocument.objects.create(
                            workflow=workflow, organization=organization,
                            title=title, file_type='other', file_hash=row_hash,
                            uploaded_by=triggered_by, input_node=node,
                            extracted_metadata=row_meta, global_metadata=global_meta,
                            extraction_status='completed',
                        )
                        InputNodeRow.upsert(
                            node=node, workflow=workflow,
                            row_id=_row_id_str, content_hash=row_hash,
                            document=new_doc, source_type='sheets',
                            sheet_id=str(sheet_id), row_order=row.order,
                        )
                        imported_count += 1
                        _sheets_changed_doc_ids.append(str(new_doc.id))

                logger.info(
                    f"Input node sheets: sheet {sheet_id} — "
                    f"imported={imported_count}, updated={updated_count}, "
                    f"skipped_unchanged={skipped_count}, "
                    f"tracked_total={len(_known_rows) + imported_count}"
                )
            except Exception as e:
                logger.error(f"Input node sheets import failed: {e}")

    # source_type == 'bulk_upload' and 'upload' — docs are pre-uploaded
    # via the upload/bulk-upload endpoint, nothing to fetch at execution time.

    # ------------------------------------------------------------------
    # Un-archive docs that match the *current* source (in case the user
    # switched away and then switched back — their cached extraction is
    # still valid).
    # ------------------------------------------------------------------
    current_tags = _source_tags_for(source_type)
    if current_tags:
        restored = WorkflowDocument.objects.filter(
            workflow=workflow,
            extraction_status='archived',
            global_metadata___source__in=current_tags,
        ).update(extraction_status='completed')
    else:
        # upload: restore docs with _source='upload' or no _source tag (legacy).
        # Same NULL-safe approach as the fallback query below.
        from django.db.models import Q
        restored = WorkflowDocument.objects.filter(
            workflow=workflow,
            extraction_status='archived',
        ).filter(
            Q(global_metadata___source='upload') |
            Q(global_metadata___source__isnull=True)
        ).update(extraction_status='completed')

    if restored:
        logger.info(f"Restored {restored} cached docs for source {source_type}")

    # ------------------------------------------------------------------
    # For sheets source: return ONLY changed/new doc IDs so that
    # downstream nodes only process rows that actually changed.
    # This prevents re-executing every row on every trigger.
    # ------------------------------------------------------------------
    if _sheets_changed_doc_ids is not None:
        # Still sync document_state so the node knows about all docs
        node.sync_document_state()

        if _sheets_changed_doc_ids:
            logger.info(
                f"Input node sheets: returning {len(_sheets_changed_doc_ids)} "
                f"changed doc IDs (not all ready docs)"
            )
            return _sheets_changed_doc_ids
        else:
            # No rows changed — return empty list so downstream nodes
            # don't re-process anything.
            logger.info(
                "Input node sheets: no rows changed, returning empty list"
            )
            return []

    # ------------------------------------------------------------------
    # Input plugin pipeline — run post-extraction hooks on completed
    # documents that haven't been processed by the plugin pipeline yet.
    # The pipeline runs: post_extract → validate → transform → ready
    # Results are stored in global_metadata._plugin_issues.
    # ------------------------------------------------------------------
    try:
        from .input_plugins.pipeline import run_post_pipeline, run_batch_complete

        # Only run on docs that don't already have a _plugin_processed flag
        plugin_candidates = WorkflowDocument.objects.filter(
            workflow=workflow,
            input_node=node,
            extraction_status='completed',
        ).exclude(
            global_metadata___plugin_processed=True,
        )

        processed_docs = []
        for doc in plugin_candidates:
            try:
                pipeline_result = run_post_pipeline(node=node, document=doc)
                # Mark as plugin-processed to avoid re-running
                gm = dict(doc.global_metadata or {})
                gm['_plugin_processed'] = True
                if pipeline_result.plugin_log:
                    gm['_plugin_log'] = pipeline_result.plugin_log
                doc.global_metadata = gm
                doc.save(update_fields=['global_metadata'])
                processed_docs.append(doc)
            except Exception as e:
                logger.debug(f"Input plugin pipeline error for doc {doc.id}: {e}")

        if processed_docs:
            run_batch_complete(
                node=node,
                documents=processed_docs,
                stats={
                    'total': len(processed_docs),
                    'ready': sum(1 for d in processed_docs if d.extraction_status == 'completed'),
                    'rejected': 0,
                    'failed': sum(1 for d in processed_docs if d.extraction_status == 'failed'),
                    'issues': sum(
                        len((d.global_metadata or {}).get('_plugin_issues', []))
                        for d in processed_docs
                    ),
                },
            )
            logger.info(
                f"Input plugin pipeline: processed {len(processed_docs)} docs "
                f"for node {node.id}"
            )
    except ImportError:
        pass  # Plugin system not available
    except Exception as e:
        logger.debug(f"Input plugin pipeline error (non-fatal): {e}")

    # ------------------------------------------------------------------
    # Sync document_state on the node and return ready_ids.
    # This is the primary return mechanism — the node's document_state
    # tracks which docs are ready for execution.
    # ------------------------------------------------------------------
    node.sync_document_state()
    state = node.document_state or {}
    ready_ids = state.get('ready_ids', [])

    if ready_ids:
        return ready_ids

    # Fallback: if document_state is empty (e.g. legacy docs not linked to
    # a node), query by source tags as before.
    qs = WorkflowDocument.objects.filter(
        workflow=workflow,
        extraction_status='completed',
    )

    if current_tags:
        qs = qs.filter(global_metadata___source__in=current_tags)
    else:
        # upload: include docs with _source='upload' or legacy docs with no tag.
        # NOTE: We cannot use .exclude(global_metadata___source__in=...) because
        # when the JSON key '_source' is missing, JSON_EXTRACT returns NULL,
        # and NOT (NULL IN (...)) evaluates to NULL (not TRUE) in SQL, which
        # incorrectly excludes docs that have no _source tag at all.
        # Instead, we filter positively: _source is 'upload' OR _source key
        # doesn't exist (isnull=True).
        from django.db.models import Q
        qs = qs.filter(
            Q(global_metadata___source='upload') |
            Q(global_metadata___source__isnull=True)
        )

    fallback_ids = [str(uid) for uid in qs.values_list('id', flat=True)]

    # If we got fallback docs, adopt them onto this node so future runs
    # use document_state directly.
    if fallback_ids:
        WorkflowDocument.objects.filter(
            id__in=fallback_ids, input_node__isnull=True,
        ).update(input_node=node)
        node.sync_document_state()

    return fallback_ids


def _source_tags_for(source_type: str) -> list[str]:
    """
    Return the global_metadata._source tag values that correspond to a
    given source_type.  FTP uses both 'ftp' and 'sftp' tags.
    Upload returns an empty list (legacy docs may have no _source).
    """
    _SOURCE_MAP = {
        'email_inbox':    ['email_inbox'],
        'webhook':        ['webhook'],
        'google_drive':   ['google_drive'],
        'dropbox':        ['dropbox'],
        'onedrive':       ['onedrive'],
        's3':             ['s3'],
        'ftp':            ['ftp', 'sftp'],
        'url_scrape':     ['url_scrape'],
        'table':          ['table'],
        'folder_upload':  ['folder_upload'],
        'dms_import':     ['dms_import'],
        'bulk_upload':    ['bulk_upload'],
        'sheets':         ['sheets'],
        'upload':         [],          # upload docs may have no _source or 'upload'
    }
    return _SOURCE_MAP.get(source_type, [])


# All _source tags that are NOT upload — used to exclude non-upload docs
_ALL_NON_UPLOAD_SOURCES = [
    'email_inbox', 'webhook', 'google_drive', 'dropbox',
    'onedrive', 's3', 'ftp', 'sftp', 'url_scrape', 'table',
    'folder_upload', 'dms_import', 'bulk_upload', 'sheets',
]


def _execute_rule_node(
    node: WorkflowNode,
    incoming_ids: list[str],
    field_type_registry: dict[str, str] | None = None,
) -> list[str]:
    """
    Rule node: filters documents by metadata conditions.
    Config: {"boolean_operator": "AND"|"OR", "conditions": [...]}

    Looks up field values from BOTH global_metadata and extracted_metadata
    (workflow-specific). This way, rules can reference standard global fields
    (party_1_name, contract_value, etc.) as well as custom workflow fields.
    """
    config = node.config or {}
    conditions = config.get('conditions', [])
    bool_op = config.get('boolean_operator', 'AND')
    registry = field_type_registry or {}

    if not conditions:
        return incoming_ids  # No conditions = pass-through

    documents = WorkflowDocument.objects.filter(id__in=incoming_ids)
    matched = []

    for doc in documents:
        # Merge both metadata dicts — workflow-specific overrides global
        combined_metadata = {}
        combined_metadata.update(doc.global_metadata or {})
        combined_metadata.update(doc.extracted_metadata or {})

        results = [
            _eval_condition(
                combined_metadata,
                c.get('field', ''),
                c.get('operator', 'eq'),
                c.get('value', ''),
                field_type=registry.get(c.get('field', ''), 'string'),
            )
            for c in conditions
        ]
        if bool_op == 'AND' and all(results):
            matched.append(str(doc.id))
        elif bool_op == 'OR' and any(results):
            matched.append(str(doc.id))

    return matched


def _execute_output_node(node: WorkflowNode, incoming_ids: list[str]) -> list[str]:
    """Output node: pass-through, just collects the final list."""
    return incoming_ids


# ---------------------------------------------------------------------------
# JSON-safe helper — convert UUIDs to strings recursively
# ---------------------------------------------------------------------------

def _make_json_safe(obj):
    """Recursively convert UUID instances to strings for JSON serialization."""
    if isinstance(obj, _uuid.UUID):
        return str(obj)
    if isinstance(obj, dict):
        return {_make_json_safe(k): _make_json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_make_json_safe(item) for item in obj]
    return obj


# ---------------------------------------------------------------------------
# Auto-extraction: dynamically extract missing fields before rule evaluation
# ---------------------------------------------------------------------------

def _get_upstream_produced_fields(
    node_id,
    incoming_map: dict,
    nodes: dict,
) -> set[str]:
    """
    Walk upstream from a node and collect all field names that are produced by
    AI nodes (json_fields), the extraction template, or derived fields.
    """
    produced: set[str] = set()
    visited = set()
    queue = list(incoming_map.get(node_id, []))

    while queue:
        nid = queue.pop()
        if nid in visited:
            continue
        visited.add(nid)
        n = nodes.get(nid)
        if not n:
            continue
        config = n.config or {}

        if n.node_type == 'ai' and config.get('output_format') == 'json_extract':
            for jf in config.get('json_fields', []):
                name = jf.get('name', '').strip()
                if name:
                    produced.add(name)

        if n.node_type == 'input':
            # Input nodes don't run extraction themselves — extraction
            # is handled by dedicated extract (AI) nodes downstream.
            # Include derived fields as they're workflow-level.
            workflow = n.workflow
            for df in workflow.derived_fields.all():
                produced.add(df.name)

        # Continue upstream
        queue.extend(incoming_map.get(nid, []))

    return produced


def _auto_extract_missing_fields(
    node: WorkflowNode,
    incoming_ids: list[str],
    upstream_fields: set[str],
    field_type_registry: dict[str, str],
    triggered_by=None,
) -> dict | None:
    """
    If a rule node references fields that no upstream node produces, create a
    virtual AI extraction request to extract them on-the-fly.

    Returns ai_result dict or None if nothing was needed.
    """
    from .ai_node_executor import execute_ai_node

    config = node.config or {}
    conditions = config.get('conditions', [])

    # Collect fields referenced by conditions that aren't upstream
    missing_fields = []
    for c in conditions:
        field_name = c.get('field', '').strip()
        if not field_name:
            continue
        # Skip nested paths (metadata.X) — they come from global_metadata
        if '.' in field_name:
            continue
        if field_name not in upstream_fields:
            ftype = field_type_registry.get(field_name, 'string')
            missing_fields.append({
                'name': field_name,
                'type': ftype,
                'description': f'Extract the {field_name.replace("_", " ")} from the document.',
            })

    if not missing_fields:
        return None

    logger.info(
        f"Auto-extracting {len(missing_fields)} missing field(s) for rule node "
        f"{node.id}: {[f['name'] for f in missing_fields]}"
    )

    # Create a virtual AI node config (not persisted to DB)
    virtual_node = WorkflowNode(
        id=_uuid.uuid4(),
        workflow=node.workflow,
        node_type='ai',
        label=f'auto_extract_for_{node.label or node.id}',
        config={
            'system_prompt': (
                'You are a precise document field extractor. '
                'Extract the requested fields from the document. '
                'Return ONLY valid JSON. Use null for fields not found. '
                'Do not infer or fabricate values — only extract what is '
                'explicitly stated in the document.'
            ),
            'output_format': 'json_extract',
            'json_fields': missing_fields,
            'include_document_text': True,
            'include_metadata': True,
            'model': 'gemini',
        },
    )

    try:
        result = execute_ai_node(
            node=virtual_node,
            incoming_document_ids=incoming_ids,
            triggered_by=triggered_by,
        )
        return result
    except Exception as e:
        logger.error(f"Auto-extraction failed for rule node {node.id}: {e}")
        return None


# ---------------------------------------------------------------------------
# DAG Executor
# ---------------------------------------------------------------------------

def execute_workflow(
    workflow: Workflow,
    triggered_by=None,
    single_document_ids: list[str] | None = None,
    excluded_document_ids: list[str] | None = None,
    mode: str = 'full',
    smart: bool = False,
    execution: 'WorkflowExecution | None' = None,
) -> dict:
    """
    Execute the full workflow DAG with **parallel level-based execution**.

    Args:
        workflow: Workflow instance to execute.
        triggered_by: User who triggered the execution.
        single_document_ids: If set, ONLY these document IDs flow through the
            DAG (used by listener inbox/folder watchers for single-doc mode).
        excluded_document_ids: Document IDs to EXCLUDE from execution.
        mode: 'full' | 'batch' | 'single' | 'auto'
        execution: Pre-created WorkflowExecution (from async dispatch).
            If None, one is created internally.

    Algorithm:
      1. Build adjacency list from connections
      2. Topological sort (Kahn's algorithm) — grouped into **levels**
      3. Execute each level; independent nodes within a level run in
         parallel via ``ThreadPoolExecutor``
      4. Cache results in each node's last_result field
      5. Save to WorkflowExecution history (incrementally after each node)

    Returns:
      {
        "workflow_id": ...,
        "workflow_name": ...,
        "executed_at": ...,
        "execution_id": ...,
        "extraction_template": {...},
        "node_results": [
          {"node_id": ..., "node_type": ..., "label": ..., "count": N, "document_ids": [...]},
        ],
        "action_results": {...},
        "listener_results": {...},
        "validator_results": {...},
        "output_documents": [...],
      }
    """
    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed
    start_time = time.time()

    from .action_executor import execute_action_node
    from .ai_node_executor import execute_ai_node
    from .document_creator_executor import execute_doc_create_node
    from .gate_executor import execute_and_gate
    from .models import DocumentExecutionRecord

    # ── Lifecycle: compiling ───────────────────────────────────────────
    workflow.execution_state = 'compiling'
    workflow.save(update_fields=['execution_state', 'updated_at'])

    # ── Smart execution: hash-based dedup ──────────────────────────────
    smart_meta = {
        'smart': smart,
        'nodes_changed': False,
        'current_config_hash': '',
        'previous_config_hash': '',
        'skipped_ids': [],       # docs reused from previous run
        'new_ids': [],           # docs that will actually execute
        'total_docs': 0,
    }

    if smart:
        current_hash = workflow.compute_nodes_config_hash(save=True)
        previous_hash = workflow.nodes_config_hash  # after save it's current_hash
        smart_meta['current_config_hash'] = current_hash

        # Check if node config changed since last stored hash
        last_exec = WorkflowExecution.objects.filter(
            workflow=workflow, status__in=['completed', 'partial'],
        ).order_by('-started_at').first()

        # Get the hash that was used in the most recent execution records
        last_record_hash = ''
        if last_exec:
            last_record = DocumentExecutionRecord.objects.filter(
                workflow=workflow, execution=last_exec,
            ).values_list('nodes_config_hash', flat=True).first()
            if last_record:
                last_record_hash = last_record

        smart_meta['previous_config_hash'] = last_record_hash
        nodes_changed = last_record_hash and last_record_hash != current_hash
        smart_meta['nodes_changed'] = bool(nodes_changed)

        if not nodes_changed:
            # Find docs that already have a record with matching config + file hash
            all_docs = list(WorkflowDocument.objects.filter(
                workflow=workflow,
            ).values_list('id', 'file_hash'))

            already_executed = set(
                DocumentExecutionRecord.objects.filter(
                    workflow=workflow,
                    nodes_config_hash=current_hash,
                    status='completed',
                ).values_list('document__id', 'file_hash')
            )

            skip_ids = []
            new_ids = []
            for doc_id, fhash in all_docs:
                if (doc_id, fhash or '') in already_executed:
                    skip_ids.append(str(doc_id))
                else:
                    new_ids.append(str(doc_id))

            smart_meta['skipped_ids'] = skip_ids
            smart_meta['new_ids'] = new_ids
            smart_meta['total_docs'] = len(all_docs)

            if not new_ids:
                # Nothing new to execute — return early with ALL docs (marked unchanged)
                from .serializers import WorkflowDocumentSerializer
                all_wf_docs = WorkflowDocument.objects.filter(
                    id__in=[_uuid.UUID(sid) for sid in skip_ids]
                )
                all_doc_data = WorkflowDocumentSerializer(all_wf_docs, many=True).data
                for d in all_doc_data:
                    d['execution_status'] = 'unchanged'

                # Pull node_results from last execution so full picture is shown
                last_node_results = []
                last_action_results = {}
                last_ai_results = {}
                last_validator_results = {}
                if last_exec and last_exec.result_data:
                    last_node_results = last_exec.result_data.get('node_results', [])
                    last_action_results = last_exec.result_data.get('action_results', {})
                    last_ai_results = last_exec.result_data.get('ai_results', {})
                    last_validator_results = last_exec.result_data.get('validator_results', {})

                duration_ms = int((time.time() - start_time) * 1000)
                # Reset lifecycle state (no actual execution happened)
                workflow.execution_state = 'idle'
                workflow.save(update_fields=['execution_state', 'updated_at'])
                return _make_json_safe({
                    'workflow_id': str(workflow.id),
                    'workflow_name': workflow.name,
                    'executed_at': timezone.now().isoformat(),
                    'execution_id': str(last_exec.id) if last_exec else None,
                    'mode': 'smart',
                    'smart_meta': smart_meta,
                    'extraction_template': workflow.extraction_template,
                    'node_results': last_node_results,
                    'action_results': last_action_results,
                    'ai_results': last_ai_results,
                    'listener_results': {},
                    'validator_results': last_validator_results,
                    'gate_results': {},
                    'scraper_results': {},
                    'output_documents': all_doc_data,
                    'duration_ms': duration_ms,
                    'total_documents': len(all_doc_data),
                    'skipped_documents': len(skip_ids),
                    'message': 'All documents already executed with current config. No changes detected.',
                })
            else:
                # Only execute the new/changed docs
                if single_document_ids is None:
                    single_document_ids = new_ids
                    if mode == 'full':
                        mode = 'smart'
        else:
            # Nodes changed — force full re-execution, mark in meta
            smart_meta['new_ids'] = []  # all docs are "new" (config changed)
            logger.info(
                f'Smart exec: nodes changed for workflow {workflow.id} '
                f'({last_record_hash[:12]}… → {current_hash[:12]}…) — full re-exec'
            )

    # Create execution record (or re-use pre-created async record)
    if execution is None:
        execution = WorkflowExecution.objects.create(
            workflow=workflow,
            status='running',
            mode=mode,
            triggered_by=triggered_by if triggered_by and hasattr(triggered_by, 'pk') and triggered_by.pk else None,
            excluded_document_ids=[str(d) for d in (excluded_document_ids or [])],
        )
    else:
        # Async: pre-created record — mark running
        execution.status = 'running'
        execution.save(update_fields=['status'])

    # Update workflow execution state → compiling is already set above
    workflow.current_execution_id = execution.id
    workflow.save(update_fields=['current_execution_id', 'updated_at'])

    try:  # ── MASTER try/finally — guarantees lifecycle reset on any crash ──
        return _execute_workflow_body(
            workflow=workflow,
            execution=execution,
            mode=mode,
            smart=smart,
            smart_meta=smart_meta,
            single_document_ids=single_document_ids,
            excluded_document_ids=excluded_document_ids,
            start_time=start_time,
            triggered_by=triggered_by,
        )
    except Exception:
        # Mark execution failed if it hasn't been finalised already
        if execution.status in ('queued', 'running'):
            execution.status = 'failed'
            execution.result_data = execution.result_data or {}
            execution.result_data['error'] = 'Execution crashed unexpectedly'
            execution.completed_at = timezone.now()
            execution.duration_ms = int((time.time() - start_time) * 1000)
            execution.save()
        raise
    finally:
        # ALWAYS reset lifecycle state so the workflow never stays stuck
        workflow.refresh_from_db(fields=['execution_state', 'current_execution_id'])
        if str(workflow.current_execution_id) == str(execution.id):
            workflow.execution_state = 'idle'
            workflow.current_execution_id = None
            workflow.save(update_fields=['execution_state', 'current_execution_id', 'updated_at'])


def _execute_workflow_body(
    workflow,
    execution,
    mode,
    smart,
    smart_meta,
    single_document_ids,
    excluded_document_ids,
    start_time,
    triggered_by=None,
):
    """Inner execution body — extracted so the caller can wrap in try/finally."""
    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed

    from .action_executor import execute_action_node
    from .ai_node_executor import execute_ai_node
    from .document_creator_executor import execute_doc_create_node
    from .gate_executor import execute_and_gate
    from .models import DocumentExecutionRecord

    # Build a typed field registry for condition evaluation
    field_type_registry = _build_field_type_registry(workflow)

    organization = workflow.organization

    nodes = {n.id: n for n in workflow.nodes.all()}
    connections = list(workflow.connections.all())

    # ── Snapshot the workflow config at execution time ──────────────────
    # This frozen copy is stored on the execution record so past runs
    # are fully reproducible even after the canvas is later modified.
    # The actual execution uses the LIVE node/connection objects (above),
    # NOT the workflow.extraction_template stored on the model — we
    # rebuild it fresh here to ensure it matches the current canvas.
    workflow.rebuild_extraction_template()
    current_hash = workflow.compute_nodes_config_hash(save=True)

    config_snapshot = {
        'nodes_config_hash': current_hash,
        'extraction_template': workflow.extraction_template,
        'node_configs': [
            {
                'id': str(n.id),
                'type': n.node_type,
                'label': n.label,
                'config': n.config or {},
            }
            for n in nodes.values()
        ],
        'connections': [
            {
                'source': str(c.source_node_id),
                'target': str(c.target_node_id),
                'handle': c.source_handle or '',
            }
            for c in connections
        ],
    }
    execution.config_snapshot = config_snapshot
    execution.save(update_fields=['config_snapshot'])

    # Build adjacency + in-degree
    adj = defaultdict(list)
    in_degree = defaultdict(int)
    incoming_map = defaultdict(list)

    for node_id in nodes:
        in_degree[node_id] = 0

    for conn in connections:
        adj[conn.source_node_id].append(conn.target_node_id)
        in_degree[conn.target_node_id] += 1
        incoming_map[conn.target_node_id].append(conn.source_node_id)

    # Kahn's topological sort — grouped into **parallel levels**
    # Each level contains nodes whose in-degree is 0 at that stage.
    # Nodes within the same level have no inter-dependencies and can
    # run concurrently via ThreadPoolExecutor.
    in_degree_copy = dict(in_degree)
    queue = deque(nid for nid, deg in in_degree_copy.items() if deg == 0)
    topo_levels = []       # list of lists: [[level0_nodes], [level1_nodes], ...]
    topo_order = []        # flat list (for backward compat assertions)

    while queue:
        level = list(queue)
        topo_levels.append(level)
        topo_order.extend(level)
        next_queue = deque()
        for nid in level:
            for neighbor in adj[nid]:
                in_degree_copy[neighbor] -= 1
                if in_degree_copy[neighbor] == 0:
                    next_queue.append(neighbor)
        queue = next_queue

    if len(topo_order) != len(nodes):
        raise ValueError("Workflow contains a cycle — cannot execute.")

    # Execute
    node_outputs = {}
    results = []
    output_doc_ids = []
    action_results = {}
    ai_results = {}
    listener_results = {}
    validator_results = {}
    gate_results = {}
    scraper_results = {}
    doc_create_results = {}
    inference_results = {}
    sheet_results = {}

    # Build exclusion set
    exclude_set = set(str(d) for d in (excluded_document_ids or []))

    # ── Lifecycle: executing ───────────────────────────────────────────
    workflow.execution_state = 'executing'
    workflow.save(update_fields=['execution_state', 'updated_at'])

    # ── Live event: execution started ─────────────────────────────────
    from .live_events import (
        emit_execution_completed,
        emit_execution_started,
        emit_node_completed,
        emit_node_failed,
        emit_node_progress,
        emit_node_started,
    )
    _total_docs_estimate = (
        WorkflowDocument.objects.filter(workflow=workflow).count()
        if not single_document_ids
        else len(single_document_ids)
    )
    emit_execution_started(workflow, execution, mode=mode, total_docs=_total_docs_estimate)
    _live_events_buffer = []  # batch-persist at end

    # ── Rule merging optimisation ──────────────────────────────────────
    # When multiple rule nodes at the same level share identical parent
    # sets (i.e., receive exactly the same incoming_ids), we can merge
    # their conditions into a single evaluation pass per document to
    # avoid redundant metadata lookups.
    #
    # _merged_rules maps a "merged leader" node_id → list of follower
    # node_ids whose conditions are evaluated together.  Followers are
    # skipped during execution; the leader evaluates all conditions and
    # outputs the intersection of documents matching ALL merged rules.
    _merged_rules = {}   # leader_id → [follower_ids]
    _merged_into = {}    # follower_id → leader_id
    for level in topo_levels:
        rule_nodes_in_level = [
            nid for nid in level
            if nodes[nid].node_type == 'rule'
        ]
        if len(rule_nodes_in_level) < 2:
            continue
        # Group by frozenset of parent node IDs
        parent_groups = defaultdict(list)
        for nid in rule_nodes_in_level:
            pset = frozenset(incoming_map.get(nid, []))
            parent_groups[pset].append(nid)
        for pset, group in parent_groups.items():
            if len(group) < 2:
                continue
            leader = group[0]
            followers = group[1:]
            _merged_rules[leader] = followers
            for fid in followers:
                _merged_into[fid] = leader

    # ── Helper: save incremental progress to execution record ─────────
    def _save_progress():
        """Persist current node_summary so polling endpoint can read it."""
        execution.node_summary = [
            {
                'node_id': r['node_id'],
                'node_type': r['node_type'],
                'label': r['label'],
                'count': r['count'],
                'status': 'done',
            }
            for r in results
        ]
        execution.save(update_fields=['node_summary'])

    # ── Level-based execution with parallel independent nodes ─────────
    for level_idx, level in enumerate(topo_levels):
        # Separate nodes that can run in parallel from those that can't.
        # Input nodes must run first (they seed the DAG). Within a level,
        # nodes that have no inter-dependency can run concurrently.
        # We serialise nodes whose types are inherently sequential
        # (input, output, and_gate — they depend on merged upstream state).
        parallel_eligible = []
        sequential_nodes = []
        for node_id in level:
            node = nodes[node_id]
            # Skip merged-away followers (handled by their leader)
            if node_id in _merged_into:
                continue
            if node.node_type in ('input', 'output', 'and_gate'):
                sequential_nodes.append(node_id)
            else:
                parallel_eligible.append(node_id)

        # ── Execute a single node (can be called from thread) ─────
        def _run_one_node(node_id):
            """Execute one node and return (node_id, output_ids, type_results)."""
            node = nodes[node_id]
            local_type_results = {}  # {result_bucket_key: value}
            _node_start = timezone.now()

            # ── Live event: node started ──────────────────────────────
            _input_estimate = 0
            if node.node_type != 'input':
                for pid in incoming_map.get(node_id, []):
                    pout = node_outputs.get(pid, [])
                    if isinstance(pout, dict):
                        for v in pout.values():
                            _input_estimate += len(v) if isinstance(v, list) else 1
                    elif isinstance(pout, list):
                        _input_estimate += len(pout)
            _ns_event = emit_node_started(workflow, execution, node, input_count=_input_estimate, dag_level=level_idx)

            if node.node_type == 'input':
                if single_document_ids:
                    output_ids = [
                        did for did in single_document_ids
                        if str(did) not in exclude_set
                        and WorkflowDocument.objects.filter(id=did, workflow=workflow).exists()
                    ]
                else:
                    output_ids = _execute_input_node(node, workflow, triggered_by=triggered_by, execution=execution)
                    if exclude_set:
                        output_ids = [did for did in output_ids if str(did) not in exclude_set]
            else:
                # Union of all upstream outputs
                parent_ids = incoming_map.get(node_id, [])
                seen = set()
                incoming_ids = []
                for pid in parent_ids:
                    parent_output = node_outputs.get(pid, [])
                    conn_handles = [
                        c.source_handle for c in connections
                        if c.source_node_id == pid and c.target_node_id == node_id
                    ]
                    handle = conn_handles[0] if conn_handles else ''
                    if isinstance(parent_output, dict):
                        if handle and handle in parent_output:
                            doc_list = parent_output[handle]
                        else:
                            doc_list = parent_output.get('approved', [])
                    else:
                        doc_list = parent_output
                    for did in doc_list:
                        if did not in seen:
                            seen.add(did)
                            incoming_ids.append(did)

                if node.node_type == 'rule':
                    upstream_fields = _get_upstream_produced_fields(node_id, incoming_map, nodes)
                    auto_result = _auto_extract_missing_fields(
                        node=node, incoming_ids=incoming_ids,
                        upstream_fields=upstream_fields,
                        field_type_registry=field_type_registry,
                        triggered_by=triggered_by,
                    )
                    if auto_result:
                        local_type_results[f'ai:auto_extract_{node_id}'] = auto_result

                    # If this is a merged leader, evaluate follower conditions too
                    if node_id in _merged_rules:
                        # Start with leader's filtered output
                        output_ids = _execute_rule_node(node, incoming_ids, field_type_registry=field_type_registry)
                        # Intersect with each follower's filter
                        for fid in _merged_rules[node_id]:
                            follower = nodes[fid]
                            follower_ids = _execute_rule_node(follower, output_ids, field_type_registry=field_type_registry)
                            output_ids = follower_ids
                            # Save follower result too
                            follower_result_data = {
                                'count': len(follower_ids),
                                'document_ids': [str(d) for d in follower_ids],
                            }
                            follower.last_result = follower_result_data
                            follower.save(update_fields=['last_result', 'updated_at'])
                    else:
                        output_ids = _execute_rule_node(node, incoming_ids, field_type_registry=field_type_registry)
                elif node.node_type == 'listener':
                    from .listener_executor import evaluate_listener_node
                    try:
                        lr = evaluate_listener_node(node=node, incoming_document_ids=incoming_ids, triggered_by=triggered_by)
                        local_type_results[f'listener:{node_id}'] = lr
                        output_ids = lr.get('passed_document_ids', [])
                    except Exception as e:
                        logger.error(f"Listener node {node_id} failed: {e}")
                        local_type_results[f'listener:{node_id}'] = {'status': 'error', 'message': str(e)}
                        output_ids = []
                elif node.node_type == 'action':
                    output_ids = incoming_ids
                    if node.config and node.config.get('plugin'):
                        try:
                            action_result = execute_action_node(node=node, incoming_document_ids=incoming_ids, triggered_by=triggered_by, workflow_execution=execution)
                            local_type_results[f'action:{node_id}'] = action_result
                        except Exception as e:
                            logger.error(f"Action node {node_id} failed: {e}")
                            local_type_results[f'action:{node_id}'] = {'error': str(e), 'status': 'failed'}
                elif node.node_type == 'validator':
                    from .validation_executor import evaluate_validator_node
                    try:
                        vr = evaluate_validator_node(node=node, incoming_document_ids=incoming_ids, triggered_by=triggered_by)
                        local_type_results[f'validator:{node_id}'] = vr
                        output_ids = {'approved': vr.get('passed_document_ids', []), 'rejected': vr.get('rejected_document_ids', [])}
                    except Exception as e:
                        logger.error(f"Validator node {node_id} failed: {e}")
                        local_type_results[f'validator:{node_id}'] = {'status': 'error', 'message': str(e)}
                        output_ids = {'approved': [], 'rejected': []}
                elif node.node_type == 'ai':
                    output_ids = incoming_ids
                    if node.config and node.config.get('system_prompt'):
                        try:
                            ai_result = execute_ai_node(node=node, incoming_document_ids=incoming_ids, triggered_by=triggered_by)
                            local_type_results[f'ai:{node_id}'] = ai_result
                        except Exception as e:
                            logger.error(f"AI node {node_id} failed: {e}")
                            local_type_results[f'ai:{node_id}'] = {'error': str(e), 'status': 'failed'}
                elif node.node_type == 'and_gate':
                    per_parent = {}
                    for pid in parent_ids:
                        parent_out = node_outputs.get(pid, [])
                        if isinstance(parent_out, dict):
                            conn_handles = [
                                c.source_handle for c in connections
                                if c.source_node_id == pid and c.target_node_id == node_id
                            ]
                            h = conn_handles[0] if conn_handles else ''
                            per_parent[str(pid)] = parent_out.get(h, parent_out.get('approved', []))
                        else:
                            per_parent[str(pid)] = parent_out
                    try:
                        gr = execute_and_gate(node=node, per_parent_ids=per_parent)
                        local_type_results[f'gate:{node_id}'] = gr
                        output_ids = gr.get('passed_document_ids', [])
                    except Exception as e:
                        logger.error(f"AND gate node {node_id} failed: {e}")
                        local_type_results[f'gate:{node_id}'] = {'status': 'error', 'gate_type': 'and', 'message': str(e)}
                        output_ids = []
                elif node.node_type == 'scraper':
                    output_ids = incoming_ids
                    if node.config and node.config.get('urls'):
                        from .scraper_executor import execute_scraper_node
                        try:
                            scraper_result = execute_scraper_node(node=node, incoming_document_ids=incoming_ids, triggered_by=triggered_by)
                            local_type_results[f'scraper:{node_id}'] = scraper_result
                        except Exception as e:
                            logger.error(f"Scraper node {node_id} failed: {e}")
                            local_type_results[f'scraper:{node_id}'] = {'error': str(e), 'status': 'failed'}
                elif node.node_type == 'doc_create':
                    output_ids = incoming_ids
                    try:
                        dc_result = execute_doc_create_node(node=node, incoming_document_ids=incoming_ids, triggered_by=triggered_by, workflow_execution=execution)
                        local_type_results[f'doc_create:{node_id}'] = dc_result
                    except Exception as e:
                        logger.error(f"doc_create node {node_id} failed: {e}")
                        local_type_results[f'doc_create:{node_id}'] = {'error': str(e), 'status': 'failed'}
                elif node.node_type == 'inference':
                    output_ids = incoming_ids
                    try:
                        from .inference_node_executor import execute_inference_node
                        inf_result = execute_inference_node(node=node, incoming_document_ids=incoming_ids, triggered_by=triggered_by)
                        local_type_results[f'inference:{node_id}'] = inf_result
                    except Exception as e:
                        logger.error(f"Inference node {node_id} failed: {e}")
                        local_type_results[f'inference:{node_id}'] = {'error': str(e), 'status': 'failed'}
                elif node.node_type == 'sheet':
                    try:
                        from .sheet_node_executor import execute_sheet_node

                        # Extract changed-row hints from the trigger context
                        # so event-triggered executions only process the rows
                        # that actually changed (detected via row hashing).
                        _trigger_ctx = getattr(execution, 'trigger_context', None) or {}
                        _changed_row_ids = _trigger_ctx.get('changed_row_ids') or None
                        _changed_row_orders = _trigger_ctx.get('changed_row_orders') or None

                        logger.info(
                            f"[sheet-node] Node {node_id}: trigger_context has "
                            f"changed_row_ids={_changed_row_ids}, "
                            f"changed_row_orders={_changed_row_orders}"
                        )

                        # Only apply the filter if this sheet node's sheet
                        # matches the sheet that fired the event.
                        _ctx_sheet_id = _trigger_ctx.get('sheet_id', '')
                        _node_sheet_id = str((node.config or {}).get('sheet_id', ''))
                        if _ctx_sheet_id and _node_sheet_id and str(_ctx_sheet_id) != _node_sheet_id:
                            logger.info(
                                f"[sheet-node] Sheet mismatch: trigger={_ctx_sheet_id}, "
                                f"node={_node_sheet_id} — processing all rows"
                            )
                            _changed_row_ids = None
                            _changed_row_orders = None

                        sheet_result = execute_sheet_node(
                            node=node, incoming_document_ids=incoming_ids,
                            execution=execution, triggered_by=triggered_by,
                            changed_row_ids=_changed_row_ids,
                            changed_row_orders=_changed_row_orders,
                        )
                        local_type_results[f'sheet:{node_id}'] = sheet_result
                        sheet_mode = (node.config or {}).get('mode', 'storage')
                        if sheet_mode == 'input' and sheet_result.get('status') == 'completed':
                            import hashlib as _hl, json as _js
                            from .models import InputNodeRow

                            # ── InputNodeRow dedup (same pattern as source_type='sheets') ──
                            # Instead of loading ALL existing WorkflowDocuments into
                            # Python, we load the lightweight InputNodeRow hash map
                            # and compare per-row.  Only new/changed rows hit the DB.
                            _sheet_node_id = str(sheet_result.get('sheet_id', ''))
                            _known_rows = InputNodeRow.load_hash_map(node)

                            row_doc_ids = []
                            _all_rows = sheet_result.get('rows', [])
                            _total_rows = len(_all_rows)
                            _imported = 0
                            _updated = 0
                            _skipped = 0

                            for _ri, row_entry in enumerate(_all_rows):
                                row_meta = row_entry.get('metadata', {})
                                if not row_meta:
                                    continue
                                row_hash = _hl.sha256(
                                    _js.dumps(row_meta, sort_keys=True, default=str).encode()
                                ).hexdigest()
                                row_order = row_entry.get('row_order', 0)
                                _entry_row_id = str(row_entry.get('row_id', ''))

                                global_meta = {
                                    '_source': 'sheet_node',
                                    '_sheet_id': _sheet_node_id,
                                    '_row_order': row_order,
                                    '_row_id': _entry_row_id,
                                    **row_meta,
                                }

                                title_val = list(row_meta.values())[0] if row_meta else ''
                                title = str(title_val)[:200] or f"Sheet Row {row_order + 1}"

                                _known = _known_rows.get(_entry_row_id) if _entry_row_id else None

                                if _known:
                                    _prev_hash, _prev_doc_id = _known
                                    if _prev_hash == row_hash:
                                        # Row unchanged — skip entirely
                                        _skipped += 1
                                        if _total_rows > 1 and (_ri % 5 == 0 or _ri == _total_rows - 1):
                                            emit_node_progress(
                                                workflow, execution, node,
                                                processed=_ri + 1, total=_total_rows,
                                                dag_level=level_idx,
                                            )
                                        continue

                                    # Content changed — update existing WorkflowDocument
                                    try:
                                        existing = WorkflowDocument.objects.get(id=_prev_doc_id)
                                        existing.title = title
                                        existing.file_hash = row_hash
                                        existing.extracted_metadata = row_meta
                                        existing.global_metadata = global_meta
                                        existing.extraction_status = 'completed'
                                        existing.save(update_fields=[
                                            'title', 'file_hash', 'extracted_metadata',
                                            'global_metadata', 'extraction_status', 'updated_at',
                                        ])
                                        InputNodeRow.upsert(
                                            node=node, workflow=workflow,
                                            row_id=_entry_row_id, content_hash=row_hash,
                                            document=existing, source_type='sheet_node',
                                            sheet_id=_sheet_node_id, row_order=row_order,
                                        )
                                        _updated += 1
                                        row_doc_ids.append(existing.id)
                                    except WorkflowDocument.DoesNotExist:
                                        # Doc deleted — re-create
                                        doc = WorkflowDocument.objects.create(
                                            workflow=workflow, organization=organization,
                                            title=title, file_type='other', file_hash=row_hash,
                                            uploaded_by=triggered_by, input_node=node,
                                            extracted_metadata=row_meta, global_metadata=global_meta,
                                            extraction_status='completed',
                                        )
                                        InputNodeRow.upsert(
                                            node=node, workflow=workflow,
                                            row_id=_entry_row_id, content_hash=row_hash,
                                            document=doc, source_type='sheet_node',
                                            sheet_id=_sheet_node_id, row_order=row_order,
                                        )
                                        _imported += 1
                                        row_doc_ids.append(doc.id)
                                else:
                                    # New row — create doc + track
                                    doc = WorkflowDocument.objects.create(
                                        workflow=workflow, organization=organization,
                                        title=title, file_type='other', file_hash=row_hash,
                                        uploaded_by=triggered_by, input_node=node,
                                        extracted_metadata=row_meta, global_metadata=global_meta,
                                        extraction_status='completed',
                                    )
                                    InputNodeRow.upsert(
                                        node=node, workflow=workflow,
                                        row_id=_entry_row_id, content_hash=row_hash,
                                        document=doc, source_type='sheet_node',
                                        sheet_id=_sheet_node_id, row_order=row_order,
                                    )
                                    _imported += 1
                                    row_doc_ids.append(doc.id)

                                # Emit progress every 5 rows or on the last row
                                if _total_rows > 1 and (_ri % 5 == 0 or _ri == _total_rows - 1):
                                    emit_node_progress(
                                        workflow, execution, node,
                                        processed=_ri + 1, total=_total_rows,
                                        dag_level=level_idx,
                                    )

                            if _skipped > 0 or _updated > 0:
                                logger.info(
                                    f"[sheet-node] Node {node_id}: "
                                    f"imported={_imported}, updated={_updated}, "
                                    f"skipped_unchanged={_skipped}, "
                                    f"tracked_total={len(_known_rows) + _imported}"
                                )
                            output_ids = row_doc_ids
                        else:
                            output_ids = incoming_ids
                    except Exception as e:
                        logger.error(f"Sheet node {node_id} failed: {e}")
                        local_type_results[f'sheet:{node_id}'] = {'error': str(e), 'status': 'failed'}
                        output_ids = incoming_ids
                else:  # output
                    output_ids = _execute_output_node(node, incoming_ids)

            _node_end = timezone.now()
            _node_dur = int((_node_end - _node_start).total_seconds() * 1000)

            # ── Live event: node completed ────────────────────────────
            _out_count = 0
            if isinstance(output_ids, dict):
                for _v in output_ids.values():
                    _out_count += len(_v) if isinstance(_v, list) else 1
            elif isinstance(output_ids, list):
                _out_count = len(output_ids)
            _nc_event = emit_node_completed(
                workflow, execution, node, output_count=_out_count,
                duration_ms=_node_dur, dag_level=level_idx,
            )
            _live_events_buffer.append((_ns_event, _nc_event))

            return node_id, output_ids, local_type_results, _node_start, _node_end

        # ── Process results from one node and integrate into shared state ─
        def _integrate_node_result(node_id, output_ids, local_type_results, node_started=None, node_ended=None):
            """Merge a single node's execution result into the shared accumulators."""
            node = nodes[node_id]
            node_outputs[node_id] = output_ids

            # Distribute type-specific results into the shared dicts
            for key, val in local_type_results.items():
                bucket, nid_str = key.split(':', 1)
                if bucket == 'action':
                    action_results[nid_str] = val
                elif bucket == 'ai':
                    ai_results[nid_str] = val
                elif bucket == 'listener':
                    listener_results[nid_str] = val
                elif bucket == 'validator':
                    validator_results[nid_str] = val
                elif bucket == 'gate':
                    gate_results[nid_str] = val
                elif bucket == 'scraper':
                    scraper_results[nid_str] = val
                elif bucket == 'doc_create':
                    doc_create_results[nid_str] = val
                elif bucket == 'inference':
                    inference_results[nid_str] = val
                elif bucket == 'sheet':
                    sheet_results[nid_str] = val

            # Build result_data for node.last_result
            if isinstance(output_ids, dict):
                flat_ids = []
                for v in output_ids.values():
                    flat_ids.extend(v)
                result_data = {'count': len(flat_ids), 'document_ids': [str(did) for did in flat_ids]}
            else:
                result_data = {'count': len(output_ids), 'document_ids': [str(did) for did in output_ids]}

            # Enrich result_data with type-specific stats
            if node.node_type == 'action' and str(node_id) in action_results:
                ar = action_results[str(node_id)]
                result_data.update({
                    'sent': ar.get('sent', 0), 'skipped': ar.get('skipped', 0),
                    'failed': ar.get('failed', 0), 'action_status': ar.get('status', ''),
                    'execution_id': ar.get('execution_id', ''),
                })
            if node.node_type == 'listener' and str(node_id) in listener_results:
                lr = listener_results[str(node_id)]
                result_data.update({
                    'listener_status': lr.get('status', ''), 'event_id': lr.get('event_id', ''),
                    'listener_message': lr.get('message', ''),
                })
            if node.node_type == 'validator' and str(node_id) in validator_results:
                vr = validator_results[str(node_id)]
                result_data.update({
                    'validator_status': vr.get('status', ''),
                    'approved': len(vr.get('passed_document_ids', [])),
                    'pending': len(vr.get('pending_document_ids', [])),
                    'rejected': len(vr.get('rejected_document_ids', [])),
                })
            if node.node_type == 'ai' and str(node_id) in ai_results:
                air = ai_results[str(node_id)]
                result_data.update({
                    'ai_status': air.get('status', ''), 'ai_model': air.get('model', ''),
                    'output_format': air.get('output_format', 'text'),
                    'processed': air.get('processed', 0), 'failed': air.get('failed', 0),
                    'cache_hits': air.get('cache_hits', 0), 'output_key': air.get('output_key', ''),
                    'json_fields': air.get('json_fields', []),
                })
            if node.node_type == 'and_gate' and str(node_id) in gate_results:
                gr = gate_results[str(node_id)]
                result_data.update({
                    'gate_type': gr.get('gate_type', ''), 'gate_status': gr.get('status', ''),
                    'parent_count': gr.get('parent_count', 0),
                    'total_upstream': gr.get('total_upstream', 0),
                    'blocked': len(gr.get('blocked_document_ids', [])),
                    'gate_message': gr.get('message', ''),
                })
            if node.node_type == 'scraper' and str(node_id) in scraper_results:
                sr = scraper_results[str(node_id)]
                result_data.update({
                    'scraper_status': sr.get('status', ''), 'urls_scraped': sr.get('urls_scraped', 0),
                    'urls_blocked': sr.get('urls_blocked', 0), 'urls_failed': sr.get('urls_failed', 0),
                    'total_snippets': sr.get('total_snippets', 0), 'keywords': sr.get('keywords', []),
                })
            if node.node_type == 'doc_create' and str(node_id) in doc_create_results:
                dcr = doc_create_results[str(node_id)]
                result_data.update({
                    'doc_create_status': dcr.get('status', ''), 'creation_mode': dcr.get('creation_mode', ''),
                    'created': dcr.get('created', 0), 'skipped': dcr.get('skipped', 0),
                    'failed': dcr.get('failed', 0), 'created_document_ids': dcr.get('created_document_ids', []),
                })
            if node.node_type == 'inference' and str(node_id) in inference_results:
                ir = inference_results[str(node_id)]
                result_data.update({
                    'inference_status': ir.get('status', ''), 'inference_scope': ir.get('inference_scope', ''),
                    'inference_model': ir.get('model', ''), 'processed': ir.get('processed', 0),
                    'failed': ir.get('failed', 0), 'inference_hits': ir.get('inference_hits', 0),
                    'output_key': ir.get('output_key', ''),
                })
            if node.node_type == 'sheet' and str(node_id) in sheet_results:
                shr = sheet_results[str(node_id)]
                result_data.update({
                    'sheet_status': shr.get('status', ''), 'sheet_mode': shr.get('mode', ''),
                    'sheet_id': shr.get('sheet_id', ''), 'sheet_title': shr.get('sheet_title', ''),
                    'rows_written': shr.get('rows_written', 0), 'rows_overwritten': shr.get('rows_overwritten', 0),
                    'row_count': shr.get('row_count', 0),
                    'query_count': shr.get('query_count', 0), 'cache_hits': shr.get('cache_hits', 0),
                    'write_mode': shr.get('write_mode', ''),
                })

            node.last_result = result_data
            save_fields = ['last_result', 'updated_at']
            if node.node_type == 'input':
                node.sync_document_state()
            node.save(update_fields=save_fields)

            # Build the rich node_result_entry
            node_result_entry = {
                'node_id': str(node_id), 'node_type': node.node_type,
                'label': node.label or node.node_type.title(),
                'count': result_data['count'], 'document_ids': result_data['document_ids'],
            }
            if node.node_type == 'action' and str(node_id) in action_results:
                ar = action_results[str(node_id)]
                node_result_entry['action'] = {
                    'execution_id': ar.get('execution_id', ''), 'plugin': ar.get('plugin', ''),
                    'status': ar.get('status', ''), 'sent': ar.get('sent', 0),
                    'skipped': ar.get('skipped', 0), 'failed': ar.get('failed', 0),
                    'results': ar.get('results', []),
                }
            if node.node_type == 'listener' and str(node_id) in listener_results:
                lr = listener_results[str(node_id)]
                node_result_entry['listener'] = {
                    'status': lr.get('status', ''), 'event_id': lr.get('event_id'),
                    'message': lr.get('message', ''),
                    'passed_count': len(lr.get('passed_document_ids', [])),
                }
            if node.node_type == 'validator' and str(node_id) in validator_results:
                vr = validator_results[str(node_id)]
                node_result_entry['validator'] = {
                    'status': vr.get('status', ''),
                    'approved': len(vr.get('passed_document_ids', [])),
                    'pending': len(vr.get('pending_document_ids', [])),
                    'rejected': len(vr.get('rejected_document_ids', [])),
                    'message': vr.get('message', ''),
                    'approved_document_ids': [str(d) for d in vr.get('passed_document_ids', [])],
                    'rejected_document_ids': [str(d) for d in vr.get('rejected_document_ids', [])],
                }
            if node.node_type == 'ai' and str(node_id) in ai_results:
                air = ai_results[str(node_id)]
                node_result_entry['ai'] = {
                    'model': air.get('model', ''), 'status': air.get('status', ''),
                    'output_format': air.get('output_format', 'text'),
                    'processed': air.get('processed', 0), 'failed': air.get('failed', 0),
                    'cache_hits': air.get('cache_hits', 0), 'total': air.get('total', 0),
                    'output_key': air.get('output_key', ''), 'json_fields': air.get('json_fields', []),
                    'results': air.get('results', []),
                }
            if node.node_type == 'and_gate' and str(node_id) in gate_results:
                gr = gate_results[str(node_id)]
                node_result_entry['gate'] = {
                    'gate_type': gr.get('gate_type', ''), 'status': gr.get('status', ''),
                    'passed': len(gr.get('passed_document_ids', [])),
                    'blocked': len(gr.get('blocked_document_ids', [])),
                    'total_upstream': gr.get('total_upstream', 0),
                    'parent_count': gr.get('parent_count', 0),
                    'parent_details': gr.get('parent_details', {}),
                    'message': gr.get('message', ''),
                }
            if node.node_type == 'scraper' and str(node_id) in scraper_results:
                sr = scraper_results[str(node_id)]
                node_result_entry['scraper'] = {
                    'status': sr.get('status', ''), 'urls_scraped': sr.get('urls_scraped', 0),
                    'urls_blocked': sr.get('urls_blocked', 0), 'urls_failed': sr.get('urls_failed', 0),
                    'total_snippets': sr.get('total_snippets', 0), 'keywords': sr.get('keywords', []),
                    'results': sr.get('results', []), 'url_results': sr.get('url_results', []),
                }
            if node.node_type == 'doc_create' and str(node_id) in doc_create_results:
                dcr = doc_create_results[str(node_id)]
                node_result_entry['doc_create'] = {
                    'status': dcr.get('status', ''), 'creation_mode': dcr.get('creation_mode', ''),
                    'created': dcr.get('created', 0), 'skipped': dcr.get('skipped', 0),
                    'failed': dcr.get('failed', 0), 'total': dcr.get('total', 0),
                    'created_document_ids': dcr.get('created_document_ids', []),
                    'results': dcr.get('results', []),
                }
            if node.node_type == 'inference' and str(node_id) in inference_results:
                ir = inference_results[str(node_id)]
                node_result_entry['inference'] = {
                    'status': ir.get('status', ''), 'inference_scope': ir.get('inference_scope', ''),
                    'model': ir.get('model', ''), 'output_key': ir.get('output_key', ''),
                    'processed': ir.get('processed', 0), 'failed': ir.get('failed', 0),
                    'inference_hits': ir.get('inference_hits', 0), 'results': ir.get('results', []),
                }
            if node.node_type == 'sheet' and str(node_id) in sheet_results:
                shr = sheet_results[str(node_id)]
                node_result_entry['sheet'] = {
                    'status': shr.get('status', ''), 'mode': shr.get('mode', ''),
                    'sheet_id': shr.get('sheet_id', ''), 'sheet_title': shr.get('sheet_title', ''),
                    'rows_written': shr.get('rows_written', 0), 'row_count': shr.get('row_count', 0),
                    'query_count': shr.get('query_count', 0), 'cache_hits': shr.get('cache_hits', 0),
                    'results': shr.get('results', []),
                }

            results.append(node_result_entry)

            if node.node_type == 'output':
                output_doc_ids.extend(output_ids)

            # Also handle merged followers — create placeholder results so
            # they appear in the execution history
            for fid in _merged_rules.get(node_id, []):
                follower = nodes[fid]
                f_result_data = follower.last_result or result_data
                node_outputs[fid] = output_ids  # same output as leader
                follower_entry = {
                    'node_id': str(fid), 'node_type': 'rule',
                    'label': follower.label or 'Rule',
                    'count': f_result_data.get('count', result_data['count']),
                    'document_ids': f_result_data.get('document_ids', result_data['document_ids']),
                    'merged_with': str(node_id),
                }
                results.append(follower_entry)

            # ── Log node execution for per-node tracking ──────────────
            try:
                from .event_system import log_node_execution
                _log_input_ids = []
                if node.node_type != 'input':
                    for pid in incoming_map.get(node_id, []):
                        pout = node_outputs.get(pid, [])
                        if isinstance(pout, dict):
                            for v in pout.values():
                                _log_input_ids.extend(v if isinstance(v, list) else [v])
                        elif isinstance(pout, list):
                            _log_input_ids.extend(pout)

                _log_status = 'completed'
                _err_msg = ''
                if result_data.get('error'):
                    _log_status = 'failed'
                    _err_msg = str(result_data['error'])[:2000]

                log_node_execution(
                    execution=execution,
                    node=node,
                    workflow=workflow,
                    status=_log_status,
                    input_ids=_log_input_ids,
                    output_ids=output_ids,
                    result_data=result_data,
                    error_message=_err_msg,
                    started_at=node_started,
                    completed_at=node_ended,
                    dag_level=level_idx,
                )
            except Exception as _log_err:
                logger.debug(f"Failed to log node execution: {_log_err}")

            # ── Incremental progress save ─────────────────────────────
            _save_progress()

        # ── Run sequential nodes first (within this level) ────────────
        for node_id in sequential_nodes:
            nid, output_ids, type_results, ns, ne = _run_one_node(node_id)
            _integrate_node_result(nid, output_ids, type_results, ns, ne)

        # ── Run parallel-eligible nodes concurrently ──────────────────
        if len(parallel_eligible) <= 1:
            # Single node or empty — no thread overhead
            for node_id in parallel_eligible:
                nid, output_ids, type_results, ns, ne = _run_one_node(node_id)
                _integrate_node_result(nid, output_ids, type_results, ns, ne)
        else:
            # Parallel execution via ThreadPoolExecutor
            max_workers = min(len(parallel_eligible), 4)  # cap at 4 threads
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                import django.db
                django.db.connections.close_all()  # close DB conns before forking threads
                futures = {
                    executor.submit(_run_one_node, nid): nid
                    for nid in parallel_eligible
                }
                for future in as_completed(futures):
                    try:
                        nid, output_ids, type_results, ns, ne = future.result()
                        _integrate_node_result(nid, output_ids, type_results, ns, ne)
                    except Exception as e:
                        failed_nid = futures[future]
                        logger.error(f"Parallel node {failed_nid} failed: {e}")
                        node = nodes[failed_nid]
                        node_outputs[failed_nid] = []
                        node.last_result = {'count': 0, 'document_ids': [], 'error': str(e)}
                        node.save(update_fields=['last_result', 'updated_at'])
                        results.append({
                            'node_id': str(failed_nid),
                            'node_type': node.node_type,
                            'label': node.label or node.node_type.title(),
                            'count': 0, 'document_ids': [], 'error': str(e),
                        })
                        # Live event: node failed
                        emit_node_failed(workflow, execution, node, error=str(e), dag_level=level_idx)
                        # Log failed node execution
                        try:
                            from .event_system import log_node_execution
                            log_node_execution(
                                execution=execution, node=node, workflow=workflow,
                                status='failed', error_message=str(e)[:2000],
                                dag_level=level_idx,
                            )
                        except Exception:
                            pass
                        _save_progress()

    # Update workflow
    workflow.last_executed_at = timezone.now()
    # (execution_state will be set to idle/completed/failed below)
    workflow.save(update_fields=['last_executed_at'])

    # Fetch final output documents for response
    from .serializers import WorkflowDocumentSerializer
    unique_output_ids = list(dict.fromkeys(output_doc_ids))
    output_docs = WorkflowDocument.objects.filter(id__in=unique_output_ids)
    output_doc_data = list(WorkflowDocumentSerializer(output_docs, many=True).data)

    # Mark newly executed docs
    for d in output_doc_data:
        d['execution_status'] = 'executed'

    # ── Merge skipped (unchanged) documents into output ────────────────
    # When smart mode skipped some docs, include them so full results are shown.
    skipped_ids = smart_meta.get('skipped_ids', []) if smart else []
    if skipped_ids:
        executed_id_set = {str(d['id']) for d in output_doc_data}
        missing_skip_ids = [sid for sid in skipped_ids if sid not in executed_id_set]
        if missing_skip_ids:
            skipped_docs = WorkflowDocument.objects.filter(
                id__in=[_uuid.UUID(sid) for sid in missing_skip_ids]
            )
            skipped_doc_data = WorkflowDocumentSerializer(skipped_docs, many=True).data
            for d in skipped_doc_data:
                d['execution_status'] = 'unchanged'
            output_doc_data.extend(skipped_doc_data)

    # Calculate timing
    duration_ms = int((time.time() - start_time) * 1000)

    # Build response
    response_data = _make_json_safe({
        'workflow_id': str(workflow.id),
        'workflow_name': workflow.name,
        'executed_at': workflow.last_executed_at.isoformat() if workflow.last_executed_at else timezone.now().isoformat(),
        'execution_id': str(execution.id),
        'mode': mode,
        'extraction_template': workflow.extraction_template,
        'node_results': results,
        'action_results': action_results,
        'ai_results': ai_results,
        'listener_results': listener_results,
        'validator_results': validator_results,
        'gate_results': gate_results,
        'scraper_results': scraper_results,
        'sheet_results': sheet_results,
        'output_documents': output_doc_data,
        'duration_ms': duration_ms,
        'total_documents': execution.total_documents,
    })

    # ── Final sync: refresh all input nodes' document_state ──────────
    # During execution, extraction statuses may have changed (pending →
    # completed/failed), or auto-execute may have run.  Sync once at the
    # end so the cached state accurately reflects the DB.
    for node_id in topo_order:
        node = nodes[node_id]
        if node.node_type == 'input':
            try:
                node.sync_document_state()
            except Exception as e:
                logger.warning(f"Post-execute sync_document_state failed for {node_id}: {e}")

    # Determine execution status
    has_failed = any(
        r.get('action', {}).get('status') == 'failed' or
        r.get('ai', {}).get('status') == 'failed' or
        r.get('scraper', {}).get('status') == 'failed'
        for r in results
    )
    has_pending = any(
        r.get('validator', {}).get('pending', 0) > 0 for r in results
    )
    exec_status = 'failed' if has_failed else ('partial' if has_pending else 'completed')

    # Persist execution record
    all_input_ids = []
    for r in results:
        if r.get('node_type') == 'input':
            all_input_ids = r.get('document_ids', [])
            break

    execution.status = exec_status
    execution.total_documents = len(all_input_ids)
    execution.included_document_ids = all_input_ids
    execution.output_document_ids = [str(d) for d in unique_output_ids]
    execution.result_data = _make_json_safe(response_data)
    execution.node_summary = [
        {
            'node_id': r['node_id'],
            'node_type': r['node_type'],
            'label': r['label'],
            'count': r['count'],
        }
        for r in results
    ]
    execution.completed_at = timezone.now()
    execution.duration_ms = duration_ms
    execution.save()

    # ── Lifecycle: completed / failed → idle ───────────────────────────
    workflow.execution_state = 'idle'
    workflow.current_execution_id = None
    workflow.save(update_fields=['execution_state', 'current_execution_id', 'updated_at'])

    # ── Live event: execution completed ───────────────────────────────
    emit_execution_completed(
        workflow, execution, duration_ms=duration_ms,
        total_docs=execution.total_documents,
        output_count=len(unique_output_ids),
    )

    # ── Persist live events to WorkflowLiveEvent table ────────────────
    try:
        from .models import WorkflowLiveEvent
        persist_records = []
        for evt_pair in _live_events_buffer:
            for evt in (evt_pair if isinstance(evt_pair, tuple) else [evt_pair]):
                if evt is not None:
                    persist_records.append(
                        WorkflowLiveEvent.record_from_live_event(
                            evt,
                            workflow_id=str(workflow.id),
                            execution_id=str(execution.id),
                        )
                    )
        if persist_records:
            WorkflowLiveEvent.objects.bulk_create(persist_records, ignore_conflicts=True)
    except Exception as _persist_err:
        logger.debug(f"Failed to persist live events: {_persist_err}")

    # ── Smart execution: record per-document execution results ─────────
    if smart:
        current_hash = smart_meta.get('current_config_hash', '')
        if not current_hash:
            current_hash = workflow.compute_nodes_config_hash(save=True)

        # Build a per-node result snapshot keyed by document
        doc_snapshots = {}  # {doc_id: {node_id: result_summary}}
        for r in results:
            for did in r.get('document_ids', []):
                doc_snapshots.setdefault(did, {})[r['node_id']] = {
                    'node_type': r['node_type'],
                    'label': r['label'],
                }

        # Create / update records for each executed document
        for doc_id_str in all_input_ids:
            try:
                doc = WorkflowDocument.objects.get(id=doc_id_str, workflow=workflow)
                doc_status = 'completed' if exec_status in ('completed', 'partial') else 'failed'
                DocumentExecutionRecord.objects.update_or_create(
                    workflow=workflow,
                    document=doc,
                    nodes_config_hash=current_hash,
                    defaults={
                        'file_hash': doc.file_hash or '',
                        'execution': execution,
                        'status': doc_status,
                        'result_snapshot': doc_snapshots.get(doc_id_str, {}),
                    },
                )
            except WorkflowDocument.DoesNotExist:
                pass

        # Inject smart meta into response
        smart_meta['new_ids'] = all_input_ids
        smart_meta['total_docs'] = len(all_input_ids) + len(smart_meta.get('skipped_ids', []))
        response_data['smart_meta'] = smart_meta
        response_data['skipped_documents'] = len(smart_meta.get('skipped_ids', []))
        response_data['total_documents'] = smart_meta['total_docs']

    return response_data
