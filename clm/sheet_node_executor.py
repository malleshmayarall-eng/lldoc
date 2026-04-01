"""
Sheet Node Executor — CLM ↔ Sheets Integration
================================================

Sheet nodes connect the CLM workflow engine to the Sheets app.
A sheet node can operate in two modes:

  • **input** (read) — Reads rows from a linked Sheet and converts them
    into document metadata dictionaries.  Each row becomes a "virtual"
    metadata record that downstream nodes (rule, AI, action, etc.) can
    consume.  This lets users populate a sheet manually (or from other
    sources) and have the workflow process each row as if it were a
    document.

  • **storage** (write / append) — Receives upstream metadata from
    connected nodes and writes it into the linked Sheet.  Each incoming
    document's metadata is flattened into a row.  The node auto-creates
    columns for any new metadata keys.  Useful for collecting results
    from AI nodes, rule filters, extractors, etc. into a persistent
    tabular view.

Query Counting & Cache
─────────────────────
Every row read or written counts as one "query" (tracked by
``SheetNodeQuery``).  A SHA-256 content hash of each row payload
enables write deduplication: if the exact same data has already been
written to the same row, the write is skipped and recorded as a
cache hit — avoiding redundant DB writes and keeping the query
counter accurate.

Config schema (stored in ``WorkflowNode.config``):
  {
    "sheet_id":     "<UUID of the linked Sheet>",
    "mode":         "input" | "storage",
    "write_mode":   "append" | "overwrite",        // storage mode only
    "column_mapping": {                             // optional explicit mapping
      "metadata_field": "col_key",
      ...
    },
    "auto_columns": true,                           // auto-create cols for unmapped fields
    "include_fields": ["field1", "field2"],         // whitelist (empty = all)
    "exclude_fields": ["field3"],                   // blacklist
  }
"""

import hashlib
import json
import logging
import uuid as _uuid
from typing import Any

from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _compute_row_hash(data: dict) -> str:
    """SHA-256 of a deterministically serialised row dict."""
    payload = json.dumps(data, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()


def _get_sheet(node):
    """Resolve the Sheet from node config. Returns (Sheet, error_msg | None)."""
    from sheets.models import Sheet

    config = node.config or {}
    sheet_id = config.get('sheet_id')
    if not sheet_id:
        return None, 'Sheet node has no sheet_id in config'

    try:
        sheet = Sheet.objects.get(id=sheet_id)
        return sheet, None
    except Sheet.DoesNotExist:
        return None, f'Sheet {sheet_id} not found'


def _filter_fields(meta: dict, config: dict) -> dict:
    """Apply include_fields / exclude_fields filters."""
    include = set(config.get('include_fields') or [])
    exclude = set(config.get('exclude_fields') or [])

    if include:
        meta = {k: v for k, v in meta.items() if k in include}
    if exclude:
        meta = {k: v for k, v in meta.items() if k not in exclude}
    return meta


# ---------------------------------------------------------------------------
# READ / INPUT MODE
# ---------------------------------------------------------------------------

def _execute_sheet_input(node, incoming_document_ids, execution=None, triggered_by=None,
                         changed_row_ids=None, changed_row_orders=None):
    """
    Read rows from the linked sheet and return a list of synthetic
    document-metadata dicts.

    If ``changed_row_ids`` or ``changed_row_orders`` are provided (from
    an event-triggered execution), **only those rows** are read — this
    avoids re-processing the entire sheet on every keystroke.  When
    neither is provided (manual run, first execution) all rows are read
    but each row's content hash is compared against the last successful
    READ query for that (node, sheet, row).  Unchanged rows are skipped
    so downstream nodes don't re-process them.

    Each row is recorded as a READ query in SheetNodeQuery.
    """
    from sheets.models import SheetRow, SheetCell
    from .models import SheetNodeQuery

    sheet, err = _get_sheet(node)
    if err:
        return {
            'status': 'error',
            'message': err,
            'row_count': 0,
            'query_count': 0,
            'cache_hits': 0,
            'rows': [],
        }

    config = node.config or {}
    column_mapping = config.get('column_mapping') or {}
    # Build reverse map: col_key → metadata field name
    # If no explicit mapping, use column labels as field names
    col_key_to_field = {}
    for col_def in sheet.columns:
        key = col_def['key']
        if key in {v for v in column_mapping.values()}:
            # Find the metadata field that maps to this col_key
            for mf, ck in column_mapping.items():
                if ck == key:
                    col_key_to_field[key] = mf
                    break
        else:
            # Default: use label (snake_cased) as field name
            label = col_def.get('label', key)
            col_key_to_field[key] = label.lower().replace(' ', '_')

    rows_qs = sheet.rows.order_by('order').prefetch_related('cells')

    # ── Filter to only changed rows when event-triggered ──────────
    if changed_row_ids:
        rows_qs = rows_qs.filter(id__in=changed_row_ids)
        logger.info(
            f"Sheet input node {node.id}: filtering to {len(changed_row_ids)} "
            f"changed row(s) by ID"
        )
    elif changed_row_orders:
        rows_qs = rows_qs.filter(order__in=changed_row_orders)
        logger.info(
            f"Sheet input node {node.id}: filtering to {len(changed_row_orders)} "
            f"changed row(s) by order"
        )

    # ── Pre-load last-read hashes for change detection ────────────
    # When processing all rows (manual execution), compare each row's
    # content hash against the last completed READ query for that row.
    # If the hash matches, the row hasn't changed — skip it.
    _last_read_hashes = {}
    if not changed_row_ids and not changed_row_orders:
        # Load the most recent completed READ hash per row for this node+sheet.
        # We order by -created_at so the first occurrence per row_id is the
        # latest.  Dict insertion deduplicates — first write wins.
        _all_reads = (
            SheetNodeQuery.objects.filter(
                node=node,
                sheet=sheet,
                operation='read',
                status='completed',
            )
            .order_by('-created_at')
            .values_list('row_id', 'content_hash')
        )
        for rid, chash in _all_reads:
            if rid and rid not in _last_read_hashes:
                _last_read_hashes[rid] = chash

        if _last_read_hashes:
            logger.info(
                f"Sheet input node {node.id}: loaded {len(_last_read_hashes)} "
                f"previous read hashes for change detection"
            )

    result_rows = []
    queries = []
    query_count = 0
    cache_hits = 0

    for row in rows_qs:
        row_data = {}
        for cell in row.cells.all():
            field_name = col_key_to_field.get(cell.column_key, cell.column_key)
            # Use computed_value if available (handles formulas), else raw_value
            row_data[field_name] = cell.computed_value or cell.raw_value

        if not any(v for v in row_data.values()):
            continue  # skip empty rows

        content_hash = _compute_row_hash(row_data)
        query_count += 1

        # ── Hash-based change detection: skip unchanged rows ──────
        if _last_read_hashes and row.id in _last_read_hashes:
            if _last_read_hashes[row.id] == content_hash:
                # Row hasn't changed since last read — skip it
                cache_hits += 1
                queries.append(SheetNodeQuery(
                    workflow=node.workflow,
                    node=node,
                    execution=execution,
                    sheet=sheet,
                    operation='read',
                    status='cached',
                    row_order=row.order,
                    row_id=row.id,
                    content_hash=content_hash,
                    row_data=row_data,
                ))
                continue

        queries.append(SheetNodeQuery(
            workflow=node.workflow,
            node=node,
            execution=execution,
            sheet=sheet,
            operation='read',
            status='completed',
            row_order=row.order,
            row_id=row.id,
            content_hash=content_hash,
            row_data=row_data,
        ))

        result_rows.append({
            'row_id': str(row.id),
            'row_order': row.order,
            'metadata': row_data,
        })

    # Bulk-create query records
    if queries:
        SheetNodeQuery.objects.bulk_create(queries, ignore_conflicts=True)

    if cache_hits:
        logger.info(
            f"Sheet input node {node.id}: skipped {cache_hits} unchanged "
            f"row(s) (cache hits), returning {len(result_rows)} changed row(s)"
        )

    return {
        'status': 'completed',
        'mode': 'input',
        'sheet_id': str(sheet.id),
        'sheet_title': sheet.title,
        'row_count': len(result_rows),
        'query_count': query_count,
        'cache_hits': cache_hits,
        'rows': result_rows,
    }


# ---------------------------------------------------------------------------
# WRITE / STORAGE MODE
# ---------------------------------------------------------------------------

def _execute_sheet_storage(
    node, incoming_document_ids, execution=None, triggered_by=None,
):
    """
    Write upstream document metadata into the linked sheet.

    For each incoming document, the extracted metadata (global + workflow)
    is flattened into a row.  The write_mode controls behaviour:
      - 'append': always add a new row (unless unique_columns match → upsert)
      - 'overwrite': match by source_document and update existing row

    When the sheet has ``unique_columns`` defined, append mode becomes
    an upsert: if a row already exists whose unique-column values match
    the incoming data, that row is **updated** instead of creating a
    duplicate.  This prevents duplicate documents, emails, etc.

    Content-hash dedup prevents re-writing identical data (cache hit).
    """
    from sheets.models import Sheet, SheetRow, SheetCell
    from .models import SheetNodeQuery, WorkflowDocument

    sheet, err = _get_sheet(node)
    if err:
        return {
            'status': 'error',
            'message': err,
            'rows_written': 0,
            'query_count': 0,
            'cache_hits': 0,
        }

    config = node.config or {}
    write_mode = config.get('write_mode', 'append')
    column_mapping = config.get('column_mapping') or {}
    auto_columns = config.get('auto_columns', True)

    # Resolve documents
    doc_ids = [
        _uuid.UUID(d) if isinstance(d, str) else d
        for d in incoming_document_ids
    ]
    documents = WorkflowDocument.objects.filter(id__in=doc_ids)

    rows_written = 0
    rows_updated = 0
    rows_overwritten = 0
    cache_hits = 0
    query_count = 0
    queries = []
    results_detail = []

    # Check if the sheet has unique columns for upsert logic
    unique_cols = sheet.unique_columns or []

    with transaction.atomic():
        # ── Overwrite: clear ALL existing rows first ──────────────
        if write_mode == 'overwrite':
            existing_row_count = sheet.rows.count()
            if existing_row_count > 0:
                sheet.rows.all().delete()
                rows_overwritten = existing_row_count
                logger.info(
                    f"Sheet node {node.id}: overwrite mode — cleared "
                    f"{existing_row_count} existing rows from sheet {sheet.id}"
                )

        for doc in documents:
            # Build metadata dict from all sources
            meta = {}
            meta.update(doc.global_metadata or {})
            meta.update(doc.extracted_metadata or {})
            meta['_document_title'] = doc.title
            meta['_document_id'] = str(doc.id)

            meta = _filter_fields(meta, config)
            if not meta:
                continue

            content_hash = _compute_row_hash(meta)
            query_count += 1

            # ── Cache check (skip for overwrite — we already cleared) ──
            if write_mode != 'overwrite':
                existing_query = SheetNodeQuery.objects.filter(
                    node=node,
                    sheet=sheet,
                    content_hash=content_hash,
                    operation__in=['write', 'append'],
                    status='completed',
                ).first()

                if existing_query:
                    existing_query.hit_count += 1
                    existing_query.last_hit_at = timezone.now()
                    existing_query.save(update_fields=['hit_count', 'last_hit_at'])

                    cache_hits += 1
                    queries.append(SheetNodeQuery(
                        workflow=node.workflow,
                        node=node,
                        execution=execution,
                        sheet=sheet,
                        operation='append',
                        status='cached',
                        source_document=doc,
                        content_hash=content_hash,
                        row_data=meta,
                    ))
                    results_detail.append({
                        'document_id': str(doc.id),
                        'document_title': doc.title,
                        'status': 'cached',
                        'content_hash': content_hash[:12],
                    })
                    continue

            # ── Ensure columns exist for all metadata keys ──
            if auto_columns:
                _ensure_columns(sheet, meta, column_mapping)

            # ── Resolve col_key for each metadata field ──
            field_to_col = _build_field_to_col_map(sheet, meta, column_mapping)

            # ── Unique-column upsert check ──────────────────────
            existing_row = None
            if unique_cols and write_mode != 'overwrite':
                existing_row = sheet.find_row_by_unique_values(meta, field_to_col)

            if existing_row:
                # Update the existing row instead of appending
                _update_row_cells(existing_row, meta, field_to_col)
                rows_updated += 1
                queries.append(SheetNodeQuery(
                    workflow=node.workflow,
                    node=node,
                    execution=execution,
                    sheet=sheet,
                    operation='upsert',
                    status='completed',
                    row_order=existing_row.order,
                    row_id=existing_row.id,
                    source_document=doc,
                    content_hash=content_hash,
                    row_data=meta,
                ))
                results_detail.append({
                    'document_id': str(doc.id),
                    'document_title': doc.title,
                    'status': 'updated',
                    'row_order': existing_row.order,
                    'content_hash': content_hash[:12],
                    'matched_unique_columns': unique_cols,
                })
            else:
                # Append new row
                row = _append_row(sheet, meta, field_to_col, doc)
                rows_written += 1
                queries.append(SheetNodeQuery(
                    workflow=node.workflow,
                    node=node,
                    execution=execution,
                    sheet=sheet,
                    operation='append' if write_mode == 'append' else 'write',
                    status='completed',
                    row_order=row.order,
                    row_id=row.id,
                    source_document=doc,
                    content_hash=content_hash,
                    row_data=meta,
                ))
                results_detail.append({
                    'document_id': str(doc.id),
                    'document_title': doc.title,
                    'status': 'written',
                    'row_order': row.order,
                    'content_hash': content_hash[:12],
                })

        # Update sheet row count
        sheet.row_count = sheet.rows.count()
        sheet.save(update_fields=['row_count', 'col_count', 'columns', 'updated_at'])

    # Bulk-create query records
    if queries:
        SheetNodeQuery.objects.bulk_create(queries, ignore_conflicts=True)

    return {
        'status': 'completed',
        'mode': 'storage',
        'write_mode': write_mode,
        'sheet_id': str(sheet.id),
        'sheet_title': sheet.title,
        'rows_written': rows_written,
        'rows_updated': rows_updated,
        'rows_overwritten': rows_overwritten,
        'query_count': query_count,
        'cache_hits': cache_hits,
        'total_documents': len(doc_ids),
        'unique_columns': unique_cols,
        'results': results_detail,
    }


# ---------------------------------------------------------------------------
# Column / row helpers
# ---------------------------------------------------------------------------

def _ensure_columns(sheet, meta: dict, column_mapping: dict):
    """Add missing columns to the sheet for any new metadata keys."""
    existing_keys = {c['key'] for c in sheet.columns}
    existing_labels = {c.get('label', '').lower() for c in sheet.columns}
    # Also include mapped col_keys
    mapped_cols = set(column_mapping.values())

    for field_name in meta:
        # Check if already mapped explicitly
        if field_name in column_mapping:
            target_key = column_mapping[field_name]
            if target_key in existing_keys:
                continue
        # Check if a column with this label already exists
        label = field_name.replace('_', ' ').title()
        if label.lower() in existing_labels:
            continue
        # Detect type from value
        value = meta[field_name]
        col_type = 'text'
        if isinstance(value, (int, float)):
            col_type = 'number'
        elif isinstance(value, bool):
            col_type = 'boolean'
        sheet.add_column(label=label, col_type=col_type, width=140)


def _build_field_to_col_map(sheet, meta: dict, column_mapping: dict) -> dict:
    """
    Build {metadata_field: col_key} mapping.
    Priority: explicit column_mapping > label match > positional.
    """
    result = {}
    label_to_key = {}
    for col in sheet.columns:
        label_to_key[col.get('label', '').lower()] = col['key']

    for field_name in meta:
        if field_name in column_mapping:
            result[field_name] = column_mapping[field_name]
        else:
            label = field_name.replace('_', ' ').title().lower()
            if label in label_to_key:
                result[field_name] = label_to_key[label]
    return result


def _find_row_for_document(sheet, doc):
    """Find an existing row that was written for this document (by metadata)."""
    from sheets.models import SheetRow, SheetCell

    # Look for a cell containing the document ID
    cell = SheetCell.objects.filter(
        row__sheet=sheet,
        raw_value=str(doc.id),
    ).select_related('row').first()
    return cell.row if cell else None


def _append_row(sheet, meta: dict, field_to_col: dict, doc=None):
    """Create a new row at the end of the sheet with the given data."""
    from sheets.models import SheetRow, SheetCell

    max_order = sheet.rows.aggregate(
        max_order=__import__('django').db.models.Max('order')
    )['max_order']
    new_order = (max_order or -1) + 1

    row = SheetRow.objects.create(
        sheet=sheet,
        order=new_order,
        metadata={
            'source': 'clm_sheet_node',
            'document_id': str(doc.id) if doc else '',
        },
    )

    cells = []
    for field_name, value in meta.items():
        col_key = field_to_col.get(field_name)
        if not col_key:
            continue
        cells.append(SheetCell(
            row=row,
            column_key=col_key,
            raw_value=str(value) if value is not None else '',
            computed_value=str(value) if value is not None else '',
            value_type=_detect_cell_type(value),
        ))
    if cells:
        SheetCell.objects.bulk_create(cells, ignore_conflicts=True)

    return row


def _update_row_cells(row, meta: dict, field_to_col: dict):
    """Update existing cells in a row, creating any missing ones."""
    from sheets.models import SheetCell

    existing_cells = {c.column_key: c for c in row.cells.all()}
    to_update = []
    to_create = []

    for field_name, value in meta.items():
        col_key = field_to_col.get(field_name)
        if not col_key:
            continue
        str_val = str(value) if value is not None else ''
        if col_key in existing_cells:
            cell = existing_cells[col_key]
            cell.raw_value = str_val
            cell.computed_value = str_val
            cell.value_type = _detect_cell_type(value)
            to_update.append(cell)
        else:
            to_create.append(SheetCell(
                row=row,
                column_key=col_key,
                raw_value=str_val,
                computed_value=str_val,
                value_type=_detect_cell_type(value),
            ))

    if to_update:
        SheetCell.objects.bulk_update(
            to_update, ['raw_value', 'computed_value', 'value_type'],
        )
    if to_create:
        SheetCell.objects.bulk_create(to_create, ignore_conflicts=True)


def _detect_cell_type(value) -> str:
    """Detect cell value_type from Python type."""
    if isinstance(value, bool):
        return 'boolean'
    if isinstance(value, (int, float)):
        return 'number'
    return 'text'


# ---------------------------------------------------------------------------
# Public entry point — called by node_executor.py
# ---------------------------------------------------------------------------

def execute_sheet_node(
    node,
    incoming_document_ids: list,
    execution=None,
    triggered_by=None,
    changed_row_ids: list | None = None,
    changed_row_orders: list | None = None,
) -> dict:
    """
    Execute a sheet workflow node.

    Dispatches to input (read) or storage (write) mode based on
    node.config['mode'].  Always returns a result dict with stats.

    For input mode, ``changed_row_ids`` / ``changed_row_orders`` allow
    event-triggered executions to process only the rows that actually
    changed (detected via row hashing in the sheet save path).
    """
    config = node.config or {}
    mode = config.get('mode', 'storage')

    if mode == 'input':
        return _execute_sheet_input(
            node=node,
            incoming_document_ids=incoming_document_ids,
            execution=execution,
            triggered_by=triggered_by,
            changed_row_ids=changed_row_ids,
            changed_row_orders=changed_row_orders,
        )
    else:
        return _execute_sheet_storage(
            node=node,
            incoming_document_ids=incoming_document_ids,
            execution=execution,
            triggered_by=triggered_by,
        )
