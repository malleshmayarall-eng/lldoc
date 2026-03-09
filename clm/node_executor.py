"""
Workflow Executor — 10-Node System
===================================
Executes a workflow DAG:
  Input → Rule(s) → Listener(s) → Validator(s) → Action(s) → AI(s) → Scraper(s) → AND Gate(s) → Doc Creator(s) → Output

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
      - Date strings from AI/NuExtract output
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

def _execute_input_node(node: WorkflowNode, workflow: Workflow, triggered_by=None) -> list[str]:
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
            # Old upload docs: _source='upload' or missing (legacy)
            stale_qs = stale_qs.exclude(
                global_metadata___source__in=_ALL_NON_UPLOAD_SOURCES
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

    # Ensure extraction template is built (same as upload flow) so that
    # _run_extraction inside source handlers can actually run AI extraction.
    if not workflow.extraction_template:
        try:
            workflow.rebuild_extraction_template()
        except Exception as e:
            logger.warning(f"Could not rebuild extraction template: {e}")

    if source_type == 'email_inbox':
        email_host = config.get('email_host', '')
        email_user = config.get('email_user', '')
        if email_host and email_user:
            from .listener_executor import check_email_inbox
            try:
                inbox_result = check_email_inbox(node=node, user=triggered_by)
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
        # upload: restore docs with _source='upload' or no _source tag (legacy)
        restored = WorkflowDocument.objects.filter(
            workflow=workflow,
            extraction_status='archived',
        ).exclude(
            global_metadata___source__in=_ALL_NON_UPLOAD_SOURCES
        ).update(extraction_status='completed')

    if restored:
        logger.info(f"Restored {restored} cached docs for source {source_type}")

    # ------------------------------------------------------------------
    # Return only documents that belong to the CURRENT source
    # ------------------------------------------------------------------
    qs = WorkflowDocument.objects.filter(
        workflow=workflow,
        extraction_status='completed',
    )

    if current_tags:
        qs = qs.filter(global_metadata___source__in=current_tags)
    else:
        # upload: include docs with _source='upload' or legacy docs with no tag
        qs = qs.exclude(
            global_metadata___source__in=_ALL_NON_UPLOAD_SOURCES
        )

    return [str(uid) for uid in qs.values_list('id', flat=True)]


def _source_tags_for(source_type: str) -> list[str]:
    """
    Return the global_metadata._source tag values that correspond to a
    given source_type.  FTP uses both 'ftp' and 'sftp' tags.
    Upload returns an empty list (legacy docs may have no _source).
    """
    _SOURCE_MAP = {
        'email_inbox':  ['email_inbox'],
        'webhook':      ['webhook'],
        'google_drive': ['google_drive'],
        'dropbox':      ['dropbox'],
        'onedrive':     ['onedrive'],
        's3':           ['s3'],
        'ftp':          ['ftp', 'sftp'],
        'url_scrape':   ['url_scrape'],
        'table':        ['table'],
        'upload':       [],          # upload docs may have no _source or 'upload'
    }
    return _SOURCE_MAP.get(source_type, [])


# All _source tags that are NOT upload — used to exclude non-upload docs
_ALL_NON_UPLOAD_SOURCES = [
    'email_inbox', 'webhook', 'google_drive', 'dropbox',
    'onedrive', 's3', 'ftp', 'sftp', 'url_scrape', 'table',
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
            # Input nodes trigger NuExtract → all extraction_template fields
            workflow = n.workflow
            for fname in (workflow.extraction_template or {}).keys():
                produced.add(fname)
            # Also include derived fields
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
) -> dict:
    """
    Execute the full workflow DAG.

    Args:
        workflow: Workflow instance to execute.
        triggered_by: User who triggered the execution.
        single_document_ids: If set, ONLY these document IDs flow through the
            DAG (used by listener inbox/folder watchers for single-doc mode).
        excluded_document_ids: Document IDs to EXCLUDE from execution.
        mode: 'full' | 'batch' | 'single' | 'auto'

    Algorithm:
      1. Build adjacency list from connections
      2. Topological sort (Kahn's algorithm)
      3. Execute each node in order
      4. Cache results in each node's last_result field
      5. Save to WorkflowExecution history

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
    start_time = time.time()

    from .action_executor import execute_action_node
    from .ai_node_executor import execute_ai_node
    from .document_creator_executor import execute_doc_create_node
    from .gate_executor import execute_and_gate
    from .models import DocumentExecutionRecord

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

    # Create execution record
    execution = WorkflowExecution.objects.create(
        workflow=workflow,
        status='running',
        mode=mode,
        triggered_by=triggered_by if triggered_by and hasattr(triggered_by, 'pk') and triggered_by.pk else None,
        excluded_document_ids=[str(d) for d in (excluded_document_ids or [])],
    )

    # Build a typed field registry for condition evaluation
    field_type_registry = _build_field_type_registry(workflow)

    nodes = {n.id: n for n in workflow.nodes.all()}
    connections = list(workflow.connections.all())

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

    # Kahn's topological sort
    queue = deque(nid for nid, deg in in_degree.items() if deg == 0)
    topo_order = []

    while queue:
        nid = queue.popleft()
        topo_order.append(nid)
        for neighbor in adj[nid]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

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

    # Build exclusion set
    exclude_set = set(str(d) for d in (excluded_document_ids or []))

    for node_id in topo_order:
        node = nodes[node_id]

        if node.node_type == 'input':
            if single_document_ids:
                # Single-doc mode: only specified documents
                output_ids = [
                    did for did in single_document_ids
                    if str(did) not in exclude_set
                    and WorkflowDocument.objects.filter(id=did, workflow=workflow).exists()
                ]
            else:
                output_ids = _execute_input_node(node, workflow, triggered_by=triggered_by)
                # Apply exclusions
                if exclude_set:
                    output_ids = [did for did in output_ids if str(did) not in exclude_set]
        else:
            # Union of all upstream outputs, respecting source_handle for branching nodes
            parent_ids = incoming_map.get(node_id, [])
            seen = set()
            incoming_ids = []
            for pid in parent_ids:
                parent_output = node_outputs.get(pid, [])
                # Find the connection(s) from this parent → current node
                conn_handles = [
                    c.source_handle for c in connections
                    if c.source_node_id == pid and c.target_node_id == node_id
                ]
                handle = conn_handles[0] if conn_handles else ''
                # If parent output is a dict (branching node like validator),
                # pick the handle-specific list; fall back to 'approved' for
                # backward compat when no handle is specified.
                if isinstance(parent_output, dict):
                    if handle and handle in parent_output:
                        doc_list = parent_output[handle]
                    else:
                        # Legacy connections without a handle get the 'approved' set
                        doc_list = parent_output.get('approved', [])
                else:
                    doc_list = parent_output

                for did in doc_list:
                    if did not in seen:
                        seen.add(did)
                        incoming_ids.append(did)

            if node.node_type == 'rule':
                # Auto-extract missing fields before evaluating conditions
                upstream_fields = _get_upstream_produced_fields(node_id, incoming_map, nodes)
                auto_result = _auto_extract_missing_fields(
                    node=node,
                    incoming_ids=incoming_ids,
                    upstream_fields=upstream_fields,
                    field_type_registry=field_type_registry,
                    triggered_by=triggered_by,
                )
                if auto_result:
                    ai_results[f'auto_extract_{node_id}'] = auto_result
                output_ids = _execute_rule_node(node, incoming_ids, field_type_registry=field_type_registry)
            elif node.node_type == 'listener':
                # Listener nodes: evaluate trigger, gate or pass
                from .listener_executor import evaluate_listener_node
                try:
                    lr = evaluate_listener_node(
                        node=node,
                        incoming_document_ids=incoming_ids,
                        triggered_by=triggered_by,
                    )
                    listener_results[str(node_id)] = lr
                    output_ids = lr.get('passed_document_ids', [])
                except Exception as e:
                    logger.error(f"Listener node {node_id} failed: {e}")
                    listener_results[str(node_id)] = {
                        'status': 'error',
                        'message': str(e),
                    }
                    output_ids = []
            elif node.node_type == 'action':
                # Action nodes: run plugin per-document, pass documents through
                output_ids = incoming_ids  # action nodes pass-through document list
                if node.config and node.config.get('plugin'):
                    try:
                        action_result = execute_action_node(
                            node=node,
                            incoming_document_ids=incoming_ids,
                            triggered_by=triggered_by,
                        )
                        action_results[str(node_id)] = action_result
                    except Exception as e:
                        logger.error(f"Action node {node_id} failed: {e}")
                        action_results[str(node_id)] = {
                            'error': str(e),
                            'status': 'failed',
                        }
            elif node.node_type == 'validator':
                # Validator nodes: multi-level human approval
                # Output is a dict with 'approved' and 'rejected' lists
                # so downstream nodes connected via source_handle can branch.
                from .validation_executor import evaluate_validator_node
                try:
                    vr = evaluate_validator_node(
                        node=node,
                        incoming_document_ids=incoming_ids,
                        triggered_by=triggered_by,
                    )
                    validator_results[str(node_id)] = vr
                    approved_ids = vr.get('passed_document_ids', [])
                    rejected_ids = vr.get('rejected_document_ids', [])
                    # Store as branching dict — downstream routing reads the handle
                    output_ids = {
                        'approved': approved_ids,
                        'rejected': rejected_ids,
                    }
                except Exception as e:
                    logger.error(f"Validator node {node_id} failed: {e}")
                    validator_results[str(node_id)] = {
                        'status': 'error',
                        'message': str(e),
                    }
                    output_ids = {'approved': [], 'rejected': []}
            elif node.node_type == 'ai':
                # AI nodes: send each document to LLM, enrich metadata, pass-through
                output_ids = incoming_ids  # AI nodes pass-through document list
                if node.config and node.config.get('system_prompt'):
                    try:
                        ai_result = execute_ai_node(
                            node=node,
                            incoming_document_ids=incoming_ids,
                            triggered_by=triggered_by,
                        )
                        ai_results[str(node_id)] = ai_result
                    except Exception as e:
                        logger.error(f"AI node {node_id} failed: {e}")
                        ai_results[str(node_id)] = {
                            'error': str(e),
                            'status': 'failed',
                        }
            elif node.node_type == 'and_gate':
                # AND gate needs per-parent doc ID lists (not the union)
                # Resolve branching outputs (validator dicts) via source_handle
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
                    gate_results[str(node_id)] = gr
                    output_ids = gr.get('passed_document_ids', [])
                except Exception as e:
                    logger.error(f"AND gate node {node_id} failed: {e}")
                    gate_results[str(node_id)] = {
                        'status': 'error',
                        'gate_type': 'and',
                        'message': str(e),
                    }
                    output_ids = []
            elif node.node_type == 'scraper':
                # Scraper nodes: scrape URLs, search keywords, enrich docs, pass-through
                output_ids = incoming_ids  # scraper nodes pass-through document list
                if node.config and node.config.get('urls'):
                    from .scraper_executor import execute_scraper_node
                    try:
                        scraper_result = execute_scraper_node(
                            node=node,
                            incoming_document_ids=incoming_ids,
                            triggered_by=triggered_by,
                        )
                        scraper_results[str(node_id)] = scraper_result
                    except Exception as e:
                        logger.error(f"Scraper node {node_id} failed: {e}")
                        scraper_results[str(node_id)] = {
                            'error': str(e),
                            'status': 'failed',
                        }
            elif node.node_type == 'doc_create':
                # Document creator: create/duplicate editor documents, pass-through
                output_ids = incoming_ids  # doc_create nodes pass-through document list
                try:
                    dc_result = execute_doc_create_node(
                        node=node,
                        incoming_document_ids=incoming_ids,
                        triggered_by=triggered_by,
                    )
                    doc_create_results[str(node_id)] = dc_result
                except Exception as e:
                    logger.error(f"doc_create node {node_id} failed: {e}")
                    doc_create_results[str(node_id)] = {
                        'error': str(e),
                        'status': 'failed',
                    }
            elif node.node_type == 'inference':
                # Inference node: hierarchical tree inference, pass-through
                output_ids = incoming_ids
                try:
                    from .inference_node_executor import execute_inference_node
                    inf_result = execute_inference_node(
                        node=node,
                        incoming_document_ids=incoming_ids,
                        triggered_by=triggered_by,
                    )
                    inference_results[str(node_id)] = inf_result
                except Exception as e:
                    logger.error(f"Inference node {node_id} failed: {e}")
                    inference_results[str(node_id)] = {
                        'error': str(e),
                        'status': 'failed',
                    }
            else:  # output
                output_ids = _execute_output_node(node, incoming_ids)

        node_outputs[node_id] = output_ids

        # Cache — handle branching nodes whose output_ids is a dict
        if isinstance(output_ids, dict):
            # Validator branching output: flatten for count/doc_ids display
            flat_ids = []
            for v in output_ids.values():
                flat_ids.extend(v)
            result_data = {
                'count': len(flat_ids),
                'document_ids': [str(did) for did in flat_ids],
            }
        else:
            result_data = {
                'count': len(output_ids),
                'document_ids': [str(did) for did in output_ids],
            }
        # For action nodes, also include action stats
        if node.node_type == 'action' and str(node_id) in action_results:
            ar = action_results[str(node_id)]
            result_data['sent'] = ar.get('sent', 0)
            result_data['skipped'] = ar.get('skipped', 0)
            result_data['failed'] = ar.get('failed', 0)
            result_data['action_status'] = ar.get('status', '')
            result_data['execution_id'] = ar.get('execution_id', '')
        # For listener nodes, include listener status
        if node.node_type == 'listener' and str(node_id) in listener_results:
            lr = listener_results[str(node_id)]
            result_data['listener_status'] = lr.get('status', '')
            result_data['event_id'] = lr.get('event_id', '')
            result_data['listener_message'] = lr.get('message', '')
        # For validator nodes, include validation status
        if node.node_type == 'validator' and str(node_id) in validator_results:
            vr = validator_results[str(node_id)]
            result_data['validator_status'] = vr.get('status', '')
            result_data['approved'] = len(vr.get('passed_document_ids', []))
            result_data['pending'] = len(vr.get('pending_document_ids', []))
            result_data['rejected'] = len(vr.get('rejected_document_ids', []))
        # For AI nodes, include AI processing stats
        if node.node_type == 'ai' and str(node_id) in ai_results:
            air = ai_results[str(node_id)]
            result_data['ai_status'] = air.get('status', '')
            result_data['ai_model'] = air.get('model', '')
            result_data['output_format'] = air.get('output_format', 'text')
            result_data['processed'] = air.get('processed', 0)
            result_data['failed'] = air.get('failed', 0)
            result_data['cache_hits'] = air.get('cache_hits', 0)
            result_data['output_key'] = air.get('output_key', '')
            result_data['json_fields'] = air.get('json_fields', [])
        # For gate nodes, include gate stats
        if node.node_type == 'and_gate' and str(node_id) in gate_results:
            gr = gate_results[str(node_id)]
            result_data['gate_type'] = gr.get('gate_type', '')
            result_data['gate_status'] = gr.get('status', '')
            result_data['parent_count'] = gr.get('parent_count', 0)
            result_data['total_upstream'] = gr.get('total_upstream', 0)
            result_data['blocked'] = len(gr.get('blocked_document_ids', []))
            result_data['gate_message'] = gr.get('message', '')

        # For scraper nodes, include scraper stats
        if node.node_type == 'scraper' and str(node_id) in scraper_results:
            sr = scraper_results[str(node_id)]
            result_data['scraper_status'] = sr.get('status', '')
            result_data['urls_scraped'] = sr.get('urls_scraped', 0)
            result_data['urls_blocked'] = sr.get('urls_blocked', 0)
            result_data['urls_failed'] = sr.get('urls_failed', 0)
            result_data['total_snippets'] = sr.get('total_snippets', 0)
            result_data['keywords'] = sr.get('keywords', [])

        # For doc_create nodes, include creation stats
        if node.node_type == 'doc_create' and str(node_id) in doc_create_results:
            dcr = doc_create_results[str(node_id)]
            result_data['doc_create_status'] = dcr.get('status', '')
            result_data['creation_mode'] = dcr.get('creation_mode', '')
            result_data['created'] = dcr.get('created', 0)
            result_data['skipped'] = dcr.get('skipped', 0)
            result_data['failed'] = dcr.get('failed', 0)
            result_data['created_document_ids'] = dcr.get('created_document_ids', [])

        # For inference nodes, include inference stats
        if node.node_type == 'inference' and str(node_id) in inference_results:
            ir = inference_results[str(node_id)]
            result_data['inference_status'] = ir.get('status', '')
            result_data['inference_scope'] = ir.get('inference_scope', '')
            result_data['inference_model'] = ir.get('model', '')
            result_data['processed'] = ir.get('processed', 0)
            result_data['failed'] = ir.get('failed', 0)
            result_data['inference_hits'] = ir.get('inference_hits', 0)
            result_data['output_key'] = ir.get('output_key', '')

        node.last_result = result_data
        node.save(update_fields=['last_result', 'updated_at'])

        node_result_entry = {
            'node_id': str(node_id),
            'node_type': node.node_type,
            'label': node.label or node.node_type.title(),
            'count': result_data['count'],
            'document_ids': result_data['document_ids'],
        }
        if node.node_type == 'action' and str(node_id) in action_results:
            ar = action_results[str(node_id)]
            node_result_entry['action'] = {
                'execution_id': ar.get('execution_id', ''),
                'plugin': ar.get('plugin', ''),
                'status': ar.get('status', ''),
                'sent': ar.get('sent', 0),
                'skipped': ar.get('skipped', 0),
                'failed': ar.get('failed', 0),
                'results': ar.get('results', []),
            }
        if node.node_type == 'listener' and str(node_id) in listener_results:
            lr = listener_results[str(node_id)]
            node_result_entry['listener'] = {
                'status': lr.get('status', ''),
                'event_id': lr.get('event_id'),
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
                'model': air.get('model', ''),
                'status': air.get('status', ''),
                'output_format': air.get('output_format', 'text'),
                'processed': air.get('processed', 0),
                'failed': air.get('failed', 0),
                'cache_hits': air.get('cache_hits', 0),
                'total': air.get('total', 0),
                'output_key': air.get('output_key', ''),
                'json_fields': air.get('json_fields', []),
                'results': air.get('results', []),
            }
        if node.node_type == 'and_gate' and str(node_id) in gate_results:
            gr = gate_results[str(node_id)]
            node_result_entry['gate'] = {
                'gate_type': gr.get('gate_type', ''),
                'status': gr.get('status', ''),
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
                'status': sr.get('status', ''),
                'urls_scraped': sr.get('urls_scraped', 0),
                'urls_blocked': sr.get('urls_blocked', 0),
                'urls_failed': sr.get('urls_failed', 0),
                'total_snippets': sr.get('total_snippets', 0),
                'keywords': sr.get('keywords', []),
                'results': sr.get('results', []),
                'url_results': sr.get('url_results', []),
            }
        if node.node_type == 'doc_create' and str(node_id) in doc_create_results:
            dcr = doc_create_results[str(node_id)]
            node_result_entry['doc_create'] = {
                'status': dcr.get('status', ''),
                'creation_mode': dcr.get('creation_mode', ''),
                'created': dcr.get('created', 0),
                'skipped': dcr.get('skipped', 0),
                'failed': dcr.get('failed', 0),
                'total': dcr.get('total', 0),
                'created_document_ids': dcr.get('created_document_ids', []),
                'results': dcr.get('results', []),
            }
        if node.node_type == 'inference' and str(node_id) in inference_results:
            ir = inference_results[str(node_id)]
            node_result_entry['inference'] = {
                'status': ir.get('status', ''),
                'inference_scope': ir.get('inference_scope', ''),
                'model': ir.get('model', ''),
                'output_key': ir.get('output_key', ''),
                'processed': ir.get('processed', 0),
                'failed': ir.get('failed', 0),
                'inference_hits': ir.get('inference_hits', 0),
                'results': ir.get('results', []),
            }

        results.append(node_result_entry)

        if node.node_type == 'output':
            output_doc_ids.extend(output_ids)

    # Update workflow
    workflow.last_executed_at = timezone.now()
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
        'output_documents': output_doc_data,
        'duration_ms': duration_ms,
        'total_documents': execution.total_documents,
    })

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
