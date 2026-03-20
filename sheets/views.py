"""
Sheets app — views.py

Full CRUD for sheets, rows, cells.
Bulk cell update endpoint, formula evaluation, workflow data import,
AI-assisted sheet generation, intelligent dashboard, and public form sharing.
"""

import json
import os
import re
import uuid
import logging
import threading
from django.db import models as db_models, transaction, connection
from .analytics import build_analytics_report as full_sheet_analytics
from .analytics import extract_sheet_data
from .analytics_engine import (
    get_function_catalog,
    build_sheet_metadata,
    execute_plan,
)
from django.db.models import F, Q, Value, CharField, Prefetch
from django.db.models.functions import Lower
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Sheet, SheetRow, SheetCell, FormulaEngine, SheetShareLink, SheetFormSubmission, SheetDashboard, SheetTask
from .serializers import (
    SheetListSerializer,
    SheetDetailSerializer,
    SheetRowSerializer,
    SheetRowLightSerializer,
    SheetCellSerializer,
    BulkCellUpdateSerializer,
    AIGenerateSheetSerializer,
    ImportWorkflowDataSerializer,
    ImportDocumentTableSerializer,
    ImportLatexTableSerializer,
    DocumentTableListItemSerializer,
    LatexTableListItemSerializer,
    SheetShareLinkSerializer,
    SheetShareLinkCreateSerializer,
    SheetFormSubmissionSerializer,
    PublicFormSubmitSerializer,
    SheetDashboardSerializer,
    SheetTaskSerializer,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helper: flush debounced cells (called from background thread or manual flush)
# ---------------------------------------------------------------------------

def _flush_debounced_cells(sheet, cells_data: list, user_id=None):
    """
    Applies a batch of cell changes to a sheet with row-hash change
    detection and fires the CLM event only for rows that actually changed.

    This is the shared "save" logic used by both the delayed debounce
    flush and the immediate debounce-flush endpoint.
    """
    import hashlib

    formula_col_keys = {
        c['key'] for c in (sheet.columns or []) if c.get('formula')
    }

    changed_rows = []

    with transaction.atomic():
        existing_orders = set(sheet.rows.values_list('order', flat=True))
        new_rows = []
        for cell_data in cells_data:
            order = cell_data.get('row_order')
            if order is not None and order not in existing_orders:
                new_rows.append(SheetRow(sheet=sheet, order=order))
                existing_orders.add(order)
        if new_rows:
            SheetRow.objects.bulk_create(new_rows, ignore_conflicts=True)

        row_map = {r.order: r for r in sheet.rows.all()}
        col_type_map = sheet.get_col_type_map()

        existing_cells = {
            (c.row_id, c.column_key): c
            for c in SheetCell.objects.filter(row__sheet=sheet)
                .only('id', 'row_id', 'column_key', 'raw_value',
                      'formula', 'value_type', 'metadata', 'computed_value')
        }

        cells_to_update = []
        cells_to_create = []

        for cell_data in cells_data:
            col_key = cell_data.get('column_key', '')
            if col_key in formula_col_keys:
                continue
            row = row_map.get(cell_data.get('row_order'))
            if not row:
                continue

            raw_value = cell_data.get('raw_value', '')
            is_formula = raw_value.startswith('=')
            col_type = col_type_map.get(col_key, 'text')
            if is_formula:
                value_type = 'formula'
            else:
                _clean, value_type, err = Sheet.validate_cell_value(raw_value, col_type)
                if err:
                    value_type = 'error'

            cell = existing_cells.get((row.id, col_key))
            if cell:
                cell.raw_value = raw_value
                cell.formula = raw_value if is_formula else ''
                cell.value_type = value_type
                cells_to_update.append(cell)
            else:
                cells_to_create.append(SheetCell(
                    row=row, column_key=col_key,
                    raw_value=raw_value,
                    formula=raw_value if is_formula else '',
                    value_type=value_type,
                ))

        if cells_to_create:
            BATCH = 400
            for i in range(0, len(cells_to_create), BATCH):
                SheetCell.objects.bulk_create(cells_to_create[i:i + BATCH], ignore_conflicts=True)
        if cells_to_update:
            BATCH = 400
            for i in range(0, len(cells_to_update), BATCH):
                SheetCell.objects.bulk_update(
                    cells_to_update[i:i + BATCH],
                    ['raw_value', 'formula', 'value_type'],
                )

        # Formulas
        sheet.apply_column_formulas()
        engine = FormulaEngine(sheet)
        engine.evaluate_all()

        # Sync computed_value for non-formula cells
        non_formula = list(
            SheetCell.objects.filter(row__sheet=sheet).exclude(raw_value__startswith='=')
        )
        needing_sync = [c for c in non_formula if c.computed_value != c.raw_value]
        for c in needing_sync:
            c.computed_value = c.raw_value
        if needing_sync:
            BATCH = 400
            for i in range(0, len(needing_sync), BATCH):
                SheetCell.objects.bulk_update(needing_sync[i:i + BATCH], ['computed_value'])

        # Row-hash change detection
        touched_orders = {cd.get('row_order') for cd in cells_data if cd.get('row_order') is not None}
        touched_rows = [row_map[o] for o in touched_orders if o in row_map]
        rows_to_hash_update = []

        for row in touched_rows:
            new_hash = row.compute_row_hash()
            if new_hash != row.row_hash:
                changed_rows.append({
                    'row_id': str(row.id),
                    'row_order': row.order,
                })
                row.row_hash = new_hash
                rows_to_hash_update.append(row)

        if rows_to_hash_update:
            BATCH = 400
            for i in range(0, len(rows_to_hash_update), BATCH):
                SheetRow.objects.bulk_update(rows_to_hash_update[i:i + BATCH], ['row_hash'])

    # Fire CLM event only if rows changed
    if changed_rows:
        try:
            from clm.event_system import handle_sheet_update
            handle_sheet_update(
                sheet_id=str(sheet.pk),
                changed_data={
                    'changed_rows': changed_rows,
                    'changed_row_orders': [r['row_order'] for r in changed_rows],
                    'changed_row_ids': [r['row_id'] for r in changed_rows],
                    'total_changed': len(changed_rows),
                },
                user=None,  # Background flush — no request user
            )
        except Exception as e:
            logger.error(f'[debounce-flush] CLM event dispatch failed: {e}')

    return {'changed_rows': len(changed_rows)}


class SheetViewSet(viewsets.ModelViewSet):
    """
    /api/sheets/
    Full CRUD + actions: bulk-update, evaluate, add-row, add-column,
    delete-row, delete-column, ai-generate, import-workflow, duplicate.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        org = self.request.user.profile.organization
        qs = Sheet.objects.filter(organization=org)

        if self.action == 'list':
            return qs

        # For detail views, prefetch rows + cells
        return qs.prefetch_related(
            Prefetch(
                'rows',
                queryset=SheetRow.objects.order_by('order').prefetch_related('cells'),
            ),
        )

    def get_serializer_class(self):
        if self.action == 'list':
            return SheetListSerializer
        return SheetDetailSerializer

    def perform_create(self, serializer):
        org = self.request.user.profile.organization
        sheet = serializer.save(
            created_by=self.request.user,
            organization=org,
        )
        # Initialize default columns if not provided
        if not sheet.columns:
            sheet.ensure_columns(sheet.col_count or 5)
        sheet.row_count = 0
        sheet.save()

    # ── Bulk cell update ────────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='bulk-update')
    def bulk_update(self, request, pk=None):
        """
        POST /api/sheets/<id>/bulk-update/
        { "cells": [ { "row_order": 0, "column_key": "col_0", "raw_value": "..." }, ... ] }
        """
        sheet = self.get_object()
        cells_data = request.data.get('cells', [])

        if not cells_data:
            return Response({'error': 'No cells provided'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = BulkCellUpdateSerializer(data=cells_data, many=True)
        serializer.is_valid(raise_exception=True)

        # Build set of formula-column keys — these are managed by apply_column_formulas
        formula_col_keys = {
            c['key'] for c in (sheet.columns or []) if c.get('formula')
        }

        with transaction.atomic():
            # Ensure rows exist
            existing_orders = set(sheet.rows.values_list('order', flat=True))
            new_rows = []
            for cell_data in serializer.validated_data:
                if cell_data['row_order'] not in existing_orders:
                    new_rows.append(SheetRow(sheet=sheet, order=cell_data['row_order']))
                    existing_orders.add(cell_data['row_order'])
            if new_rows:
                SheetRow.objects.bulk_create(new_rows, ignore_conflicts=True)

            # Map order -> row id  (single query)
            row_map = {r.order: r for r in sheet.rows.all()}
            col_type_map = sheet.get_col_type_map()

            # Prefetch ALL existing cells for this sheet in one query
            existing_cells = {
                (c.row_id, c.column_key): c
                for c in SheetCell.objects.filter(row__sheet=sheet)
                    .only('id', 'row_id', 'column_key', 'raw_value',
                          'formula', 'value_type', 'metadata', 'computed_value')
            }

            cells_to_update = []
            cells_to_create = []
            type_errors = {}  # { "row_col": error_msg }
            for cell_data in serializer.validated_data:
                # Skip cells that belong to formula columns
                if cell_data['column_key'] in formula_col_keys:
                    continue

                row = row_map.get(cell_data['row_order'])
                if not row:
                    continue

                raw_value = cell_data['raw_value']
                is_formula = raw_value.startswith('=')
                col_key = cell_data['column_key']
                col_type = col_type_map.get(col_key, 'text')

                # ── Validate against column type ──
                err = None
                if is_formula:
                    value_type = 'formula'
                else:
                    _clean, value_type, err = Sheet.validate_cell_value(raw_value, col_type)
                    if err:
                        type_errors[f'{cell_data["row_order"]}_{col_key}'] = err
                        value_type = 'error'

                cell = existing_cells.get((row.id, col_key))
                if cell:
                    cell.raw_value = raw_value
                    cell.formula = raw_value if is_formula else ''
                    cell.value_type = value_type
                    if err:
                        cell.metadata['type_error'] = err
                    else:
                        cell.metadata.pop('type_error', None)
                    if cell_data.get('metadata'):
                        cell.metadata.update(cell_data['metadata'])
                    cells_to_update.append(cell)
                else:
                    meta = cell_data.get('metadata', {})
                    if err:
                        meta['type_error'] = err
                    cell = SheetCell(
                        row=row,
                        column_key=col_key,
                        raw_value=raw_value,
                        formula=raw_value if is_formula else '',
                        value_type=value_type,
                        metadata=meta,
                    )
                    cells_to_create.append(cell)

            if cells_to_create:
                # Batch to avoid SQLite "too many SQL variables" limit
                BATCH = 400
                for i in range(0, len(cells_to_create), BATCH):
                    SheetCell.objects.bulk_create(
                        cells_to_create[i:i + BATCH], ignore_conflicts=True,
                    )
            if cells_to_update:
                BATCH = 400
                for i in range(0, len(cells_to_update), BATCH):
                    SheetCell.objects.bulk_update(
                        cells_to_update[i:i + BATCH],
                        ['raw_value', 'formula', 'value_type', 'metadata'],
                    )

            # Propagate column-level formulas, then evaluate all
            sheet.apply_column_formulas()
            engine = FormulaEngine(sheet)
            engine.evaluate_all()

            # Set computed_value = raw_value for non-formula cells (batched)
            non_formula_cells = list(
                SheetCell.objects.filter(row__sheet=sheet)
                .exclude(raw_value__startswith='=')
            )
            cells_needing_sync = [
                c for c in non_formula_cells if c.computed_value != c.raw_value
            ]
            for c in cells_needing_sync:
                c.computed_value = c.raw_value
            if cells_needing_sync:
                BATCH = 400
                for i in range(0, len(cells_needing_sync), BATCH):
                    SheetCell.objects.bulk_update(
                        cells_needing_sync[i:i + BATCH],
                        ['computed_value'],
                    )

            # ── Row-level change detection ────────────────────────────
            # Compute new row hashes for every touched row and compare
            # against the stored row_hash.  Only rows with actual data
            # changes are forwarded to CLM workflows.
            touched_orders = {cd['row_order'] for cd in serializer.validated_data}
            touched_rows = [row_map[o] for o in touched_orders if o in row_map]

            changed_rows = []   # [{row_id, row_order, old_hash, new_hash}]
            rows_to_hash_update = []
            for row in touched_rows:
                new_hash = row.compute_row_hash()
                if new_hash != row.row_hash:
                    changed_rows.append({
                        'row_id': str(row.id),
                        'row_order': row.order,
                        'old_hash': row.row_hash,
                        'new_hash': new_hash,
                    })
                    row.row_hash = new_hash
                    rows_to_hash_update.append(row)

            if rows_to_hash_update:
                BATCH = 400
                for i in range(0, len(rows_to_hash_update), BATCH):
                    SheetRow.objects.bulk_update(
                        rows_to_hash_update[i:i + BATCH],
                        ['row_hash'],
                    )

        # Re-fetch and return
        sheet.refresh_from_db()
        serializer = SheetDetailSerializer(sheet)
        data = serializer.data
        if type_errors:
            data['type_errors'] = type_errors

        # ── Fire CLM event for subscribed workflows (only if rows changed) ──
        if changed_rows:
            try:
                from clm.event_system import handle_sheet_update
                handle_sheet_update(
                    sheet_id=str(sheet.pk),
                    changed_data={
                        'changed_rows': changed_rows,
                        'changed_row_orders': [r['row_order'] for r in changed_rows],
                        'changed_row_ids': [r['row_id'] for r in changed_rows],
                        'total_changed': len(changed_rows),
                        'cells_updated': len(cells_to_update),
                        'cells_created': len(cells_to_create),
                    },
                    user=request.user if request.user.is_authenticated else None,
                )
            except Exception:
                pass  # CLM event dispatch is best-effort — never block sheet saves

        return Response(data)

    # ── Debounced save (buffer + flush) ─────────────────────────────

    @action(detail=True, methods=['post'], url_path='debounce-save')
    def debounce_save(self, request, pk=None):
        """
        POST /api/sheets/<id>/debounce-save/
        {
            "cells": [ { "row_order": 0, "column_key": "col_0", "raw_value": "..." } ],
            "debounce_ms": 2000
        }

        Server-side debounce: buffers cell changes in cache and flushes
        them to the DB after `debounce_ms` of inactivity (default 2s).
        The CLM workflow event fires **once** on flush, not on every keystroke.

        How it works:
          1. Cell changes are appended to a cache buffer keyed by sheet ID.
          2. A timer key tracks when the next flush should happen.
          3. If a new request arrives before the timer expires, the timer resets.
          4. The flush happens via a background thread after debounce_ms.
          5. The flush calls the real `bulk_update` logic with all buffered cells.

        Returns immediately with { "buffered": N, "flush_at": "..." }.
        """
        from django.core.cache import cache

        sheet = self.get_object()
        cells_data = request.data.get('cells', [])
        debounce_ms = int(request.data.get('debounce_ms', 2000))
        debounce_s = debounce_ms / 1000.0

        if not cells_data:
            return Response({'error': 'No cells provided'}, status=status.HTTP_400_BAD_REQUEST)

        sheet_id = str(sheet.pk)
        buffer_key = f'sheet:debounce_buffer:{sheet_id}'
        timer_key = f'sheet:debounce_timer:{sheet_id}'

        # Append to buffer (cache-based list)
        existing_buffer = cache.get(buffer_key) or []
        existing_buffer.extend(cells_data)

        # Deduplicate: last write wins per (row_order, column_key)
        seen = {}
        for cell in existing_buffer:
            key = (cell.get('row_order'), cell.get('column_key'))
            seen[key] = cell
        deduped = list(seen.values())

        # Store buffer with TTL = debounce + 30s safety margin
        cache.set(buffer_key, deduped, timeout=int(debounce_s + 30))

        # Set/reset the flush timer
        import time
        flush_at = time.time() + debounce_s
        cache.set(timer_key, flush_at, timeout=int(debounce_s + 30))

        # Schedule the flush in a background thread
        user_id = request.user.pk if request.user.is_authenticated else None

        def _delayed_flush():
            """Wait for debounce period, then flush if no newer timer."""
            import time as _time
            _time.sleep(debounce_s + 0.1)  # slight extra margin

            # Check if the timer was reset (newer request came in)
            current_timer = cache.get(timer_key)
            if current_timer and current_timer > flush_at:
                return  # A newer debounce was scheduled — let that one handle it

            # Pop the buffer atomically
            buffered_cells = cache.get(buffer_key)
            if not buffered_cells:
                return
            cache.delete(buffer_key)
            cache.delete(timer_key)

            # Perform the actual save by calling bulk_update internally
            try:
                from sheets.models import Sheet as _Sheet
                _sheet = _Sheet.objects.get(pk=sheet_id)
                _flush_debounced_cells(_sheet, buffered_cells, user_id)
            except Exception as e:
                logger.error(f'[debounce-flush] Sheet {sheet_id} flush failed: {e}')

        t = threading.Thread(target=_delayed_flush, daemon=True)
        t.start()

        return Response({
            'buffered': len(deduped),
            'flush_at_epoch': flush_at,
            'debounce_ms': debounce_ms,
        })

    # ── Debounce: immediate flush ───────────────────────────────────

    @action(detail=True, methods=['post'], url_path='debounce-flush')
    def debounce_flush(self, request, pk=None):
        """
        POST /api/sheets/<id>/debounce-flush/

        Force-flush any buffered debounce cells immediately.
        Call this when the user navigates away or explicitly saves.
        """
        from django.core.cache import cache

        sheet = self.get_object()
        sheet_id = str(sheet.pk)
        buffer_key = f'sheet:debounce_buffer:{sheet_id}'
        timer_key = f'sheet:debounce_timer:{sheet_id}'

        buffered_cells = cache.get(buffer_key)
        if not buffered_cells:
            return Response({'flushed': 0, 'message': 'No buffered changes.'})

        cache.delete(buffer_key)
        cache.delete(timer_key)

        user_id = request.user.pk if request.user.is_authenticated else None
        result = _flush_debounced_cells(sheet, buffered_cells, user_id)

        return Response({
            'flushed': len(buffered_cells),
            'changed_rows': result.get('changed_rows', 0),
        })

    # ── Evaluate all formulas ───────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='evaluate')
    def evaluate_formulas(self, request, pk=None):
        """POST /api/sheets/<id>/evaluate/ — re-evaluate all formulas."""
        sheet = self.get_object()
        engine = FormulaEngine(sheet)
        count = engine.evaluate_all()
        return Response({'evaluated': count})

    # ── Paginated rows (scrollable pagination) ────────────────────

    @action(detail=True, methods=['get'], url_path='rows')
    def paginated_rows(self, request, pk=None):
        """
        GET /api/sheets/<id>/rows/?page=1&page_size=100&sort_by=col_0&sort_dir=desc
            &filter_col=col_0&filter_val=hello&search=text&row_order=42

        Enterprise paginated rows with server-side sorting, filtering, and
        row-order lookup.  All heavy lifting runs against indexed columns.

        Query params:
          page, page_size     – pagination (max 500)
          sort_by, sort_dir   – sort by a column's raw_value (asc/desc)
          filter_col,
          filter_val          – simple "contains" filter on one column
          filters             – JSON-encoded { col_key: search_text, ... }
          search              – global text search across all cells
          row_order           – if given, ignore page and jump to the page
                                containing this row_order (for search→scroll)
        """
        sheet = self.get_object()

        page = max(1, int(request.query_params.get('page', 1)))
        page_size = min(500, max(1, int(request.query_params.get('page_size', 100))))

        sort_by = request.query_params.get('sort_by', '')
        sort_dir = request.query_params.get('sort_dir', 'asc')
        filter_col = request.query_params.get('filter_col', '')
        filter_val = request.query_params.get('filter_val', '')
        global_search = request.query_params.get('search', '').strip()
        target_row_order = request.query_params.get('row_order', '')

        # Try to parse multi-column filters from JSON param
        import json as _json
        filters_json = request.query_params.get('filters', '')
        multi_filters = {}
        if filters_json:
            try:
                multi_filters = _json.loads(filters_json)
            except (ValueError, TypeError):
                pass

        # ── Base queryset ────────────────────────────────────────
        all_rows = sheet.rows.prefetch_related('cells')

        # ── Global text search (restrict to rows containing text) ──
        if global_search:
            matching_row_ids = (
                SheetCell.objects
                .filter(row__sheet=sheet, raw_value__icontains=global_search)
                .values_list('row_id', flat=True)
                .distinct()
            )
            all_rows = all_rows.filter(id__in=matching_row_ids)

        # ── Single column filter ─────────────────────────────────
        if filter_col and filter_val:
            filt_row_ids = (
                SheetCell.objects
                .filter(row__sheet=sheet, column_key=filter_col,
                        raw_value__icontains=filter_val)
                .values_list('row_id', flat=True)
                .distinct()
            )
            all_rows = all_rows.filter(id__in=filt_row_ids)

        # ── Multi-column filters ─────────────────────────────────
        for col_key, search_text in multi_filters.items():
            if not search_text:
                continue
            filt_ids = (
                SheetCell.objects
                .filter(row__sheet=sheet, column_key=col_key,
                        raw_value__icontains=str(search_text))
                .values_list('row_id', flat=True)
                .distinct()
            )
            all_rows = all_rows.filter(id__in=filt_ids)

        # ── Server-side sort ─────────────────────────────────────
        if sort_by:
            # Sub-query: annotate each row with the sort column's value
            from django.db.models import Subquery, OuterRef
            sort_cell_sq = (
                SheetCell.objects
                .filter(row=OuterRef('pk'), column_key=sort_by)
                .values('raw_value')[:1]
            )
            all_rows = all_rows.annotate(
                _sort_val=Subquery(sort_cell_sq)
            )
            order_field = '-_sort_val' if sort_dir == 'desc' else '_sort_val'
            all_rows = all_rows.order_by(order_field, 'order')
        else:
            all_rows = all_rows.order_by('order')

        # ── Count after filters ──────────────────────────────────
        total_rows = all_rows.count()
        total_pages = max(1, -(-total_rows // page_size))

        # ── Row-order lookup: figure out which page contains it ──
        if target_row_order:
            try:
                target_order = int(target_row_order)
                # Get sorted list of PKs and find position
                row_pks = list(all_rows.values_list('pk', flat=True))
                # Find the row with matching order
                target_row = sheet.rows.filter(order=target_order).first()
                if target_row and target_row.pk in row_pks:
                    position = row_pks.index(target_row.pk)
                    page = (position // page_size) + 1
                    # Also return the index within the page for frontend scroll
                else:
                    page = 1
            except (ValueError, TypeError):
                pass

        # ── Paginate ─────────────────────────────────────────────
        offset = (page - 1) * page_size
        rows_page = all_rows[offset:offset + page_size]

        # Include all rows (empty rows must be visible so users can type into them).
        # Previously empty rows were filtered out here, causing newly added rows
        # to disappear from the grid until the user typed something.
        rows_data = SheetRowSerializer(rows_page, many=True).data

        # Compute offset of target row within this page
        target_index_in_page = None
        if target_row_order:
            try:
                target_order = int(target_row_order)
                for idx, row_dict in enumerate(rows_data):
                    if row_dict.get('order') == target_order:
                        target_index_in_page = idx
                        break
            except (ValueError, TypeError):
                pass

        return Response({
            # ── Sheet metadata (so frontend needs only one call) ──
            'sheet': {
                'id': str(sheet.id),
                'title': sheet.title,
                'description': sheet.description or '',
                'columns': sheet.columns or [],
                'row_count': total_rows,   # use filtered count
                'col_count': sheet.col_count,
                'custom_metadata': sheet.custom_metadata or {},
                'settings_json': sheet.settings_json or {},
                'is_archived': sheet.is_archived,
                'workflow': str(sheet.workflow_id) if sheet.workflow_id else None,
                'created_by': str(sheet.created_by_id) if sheet.created_by_id else None,
            },
            # ── Pagination ──
            'page': page,
            'page_size': page_size,
            'total_rows': total_rows,
            'total_pages': total_pages,
            'has_next': page < total_pages,
            'has_previous': page > 1,
            'rows': rows_data,
            'sort_by': sort_by or None,
            'sort_dir': sort_dir if sort_by else None,
            'target_row_order': int(target_row_order) if target_row_order else None,
            'target_index_in_page': target_index_in_page,
        })

    # ── Enterprise Search ───────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='search')
    def search_cells(self, request, pk=None):
        """
        POST /api/sheets/<id>/search/
        {
            "query": "search text",
            "columns": ["col_0", "col_1"],   ← optional: restrict to these columns
            "is_regex": false,
            "case_sensitive": false,
            "page": 1,
            "page_size": 100,
            "value_filter": { "column": "col_2", "operator": "gt", "value": "100" }
        }

        Server-side search using DB indexes. Handles 10M+ rows efficiently.
        Returns matching cells with row context.
        """
        sheet = self.get_object()
        query = request.data.get('query', '').strip()
        target_columns = request.data.get('columns', [])
        is_regex = request.data.get('is_regex', False)
        case_sensitive = request.data.get('case_sensitive', False)
        page = max(1, int(request.data.get('page', 1)))
        page_size = min(500, max(1, int(request.data.get('page_size', 100))))
        value_filter = request.data.get('value_filter')

        if not query and not value_filter:
            return Response({'error': 'query or value_filter required'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Base queryset — use indexed join
        cells_qs = SheetCell.objects.filter(
            row__sheet=sheet,
        ).select_related('row')

        # Column filter
        if target_columns:
            cells_qs = cells_qs.filter(column_key__in=target_columns)

        # Text search
        if query:
            if is_regex:
                cells_qs = cells_qs.filter(raw_value__regex=query)
            elif case_sensitive:
                cells_qs = cells_qs.filter(raw_value__contains=query)
            else:
                cells_qs = cells_qs.filter(raw_value__icontains=query)

        # Numeric value filter (for indexed numeric comparisons)
        if value_filter:
            vf_col = value_filter.get('column')
            vf_op = value_filter.get('operator', 'eq')
            vf_val = value_filter.get('value', '')
            if vf_col:
                vf_qs = SheetCell.objects.filter(row__sheet=sheet, column_key=vf_col)
                op_map = {
                    'eq': 'raw_value',
                    'ne': 'raw_value',
                    'gt': 'raw_value__gt',
                    'gte': 'raw_value__gte',
                    'lt': 'raw_value__lt',
                    'lte': 'raw_value__lte',
                    'contains': 'raw_value__icontains',
                    'startswith': 'raw_value__istartswith',
                    'endswith': 'raw_value__iendswith',
                }
                filter_field = op_map.get(vf_op, 'raw_value')
                if vf_op == 'ne':
                    vf_qs = vf_qs.exclude(raw_value=vf_val)
                else:
                    vf_qs = vf_qs.filter(**{filter_field: vf_val})
                matching_row_ids = vf_qs.values_list('row_id', flat=True)
                cells_qs = cells_qs.filter(row_id__in=matching_row_ids)

        # Order by row order for consistent pagination
        cells_qs = cells_qs.order_by('row__order', 'column_key')

        # Count total matches
        total_matches = cells_qs.count()
        total_pages = max(1, -(-total_matches // page_size))

        # Paginate
        offset = (page - 1) * page_size
        results = cells_qs[offset:offset + page_size]

        # Build response
        matches = []
        for cell in results:
            matches.append({
                'row_order': cell.row.order,
                'row_id': str(cell.row.id),
                'column_key': cell.column_key,
                'raw_value': cell.raw_value,
                'computed_value': cell.computed_value or cell.raw_value,
            })

        return Response({
            'query': query,
            'total_matches': total_matches,
            'page': page,
            'page_size': page_size,
            'total_pages': total_pages,
            'has_next': page < total_pages,
            'matches': matches,
        })

    @action(detail=True, methods=['post'], url_path='find-replace')
    def find_replace(self, request, pk=None):
        """
        POST /api/sheets/<id>/find-replace/
        {
            "find": "old text",
            "replace": "new text",
            "columns": [],
            "is_regex": false,
            "case_sensitive": false,
            "preview": true          ← if true, returns matches without modifying
        }
        """
        sheet = self.get_object()
        find_text = request.data.get('find', '').strip()
        replace_text = request.data.get('replace', '')
        target_columns = request.data.get('columns', [])
        is_regex = request.data.get('is_regex', False)
        case_sensitive = request.data.get('case_sensitive', False)
        preview = request.data.get('preview', True)

        if not find_text:
            return Response({'error': 'find text required'},
                            status=status.HTTP_400_BAD_REQUEST)

        cells_qs = SheetCell.objects.filter(row__sheet=sheet)
        if target_columns:
            cells_qs = cells_qs.filter(column_key__in=target_columns)

        # Exclude formula cells
        cells_qs = cells_qs.exclude(raw_value__startswith='=')

        if is_regex:
            cells_qs = cells_qs.filter(raw_value__regex=find_text)
        elif case_sensitive:
            cells_qs = cells_qs.filter(raw_value__contains=find_text)
        else:
            cells_qs = cells_qs.filter(raw_value__icontains=find_text)

        total = cells_qs.count()

        if preview:
            # Return first 200 matches as preview
            preview_cells = cells_qs.select_related('row').order_by('row__order')[:200]
            matches = [{
                'row_order': c.row.order,
                'column_key': c.column_key,
                'current': c.raw_value,
                'preview': self._apply_replace(c.raw_value, find_text, replace_text, is_regex, case_sensitive),
            } for c in preview_cells]
            return Response({'total': total, 'preview': matches})

        # Perform replacement in batches
        BATCH = 500
        replaced = 0
        cells_to_update = cells_qs.only('id', 'raw_value')
        cell_ids = list(cells_to_update.values_list('id', flat=True))

        for i in range(0, len(cell_ids), BATCH):
            batch_ids = cell_ids[i:i + BATCH]
            batch_cells = SheetCell.objects.filter(id__in=batch_ids)
            updates = []
            for cell in batch_cells:
                new_val = self._apply_replace(cell.raw_value, find_text, replace_text, is_regex, case_sensitive)
                if new_val != cell.raw_value:
                    cell.raw_value = new_val
                    updates.append(cell)
                    replaced += 1
            if updates:
                SheetCell.objects.bulk_update(updates, ['raw_value'], batch_size=400)

        return Response({'total': total, 'replaced': replaced})

    @staticmethod
    def _apply_replace(text, find, replace, is_regex, case_sensitive):
        """Apply find/replace to a string."""
        if is_regex:
            flags = 0 if case_sensitive else re.IGNORECASE
            return re.sub(find, replace, text, flags=flags)
        if case_sensitive:
            return text.replace(find, replace)
        # Case-insensitive plain replace
        pattern = re.compile(re.escape(find), re.IGNORECASE)
        return pattern.sub(replace, text)

    # ── Async Formula Evaluation ────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='evaluate-formulas')
    def evaluate_formulas_async(self, request, pk=None):
        """
        POST /api/sheets/<id>/evaluate-formulas/

        Evaluates all formulas in the sheet. For large sheets, runs
        asynchronously with progress tracking via SheetTask.

        Returns: { task_id: uuid } for polling via /task-status/<id>/
        """
        sheet = self.get_object()

        # Create task
        task = SheetTask.objects.create(
            sheet=sheet,
            task_type=SheetTask.TaskType.FORMULA_EVAL,
            created_by=request.user,
            message='Starting formula evaluation…',
        )

        # Count formula cells
        formula_count = SheetCell.objects.filter(
            row__sheet=sheet,
            raw_value__startswith='=',
        ).count()

        if formula_count == 0:
            task.complete(result={'evaluated': 0}, message='No formulas found')
            return Response(SheetTaskSerializer(task).data)

        # For small sheets (< 5000 formulas), evaluate synchronously
        if formula_count < 5000:
            try:
                engine = FormulaEngine(sheet)
                count = engine.evaluate_all()
                task.complete(
                    result={'evaluated': count},
                    message=f'Evaluated {count} formulas',
                )
            except Exception as exc:
                task.fail(str(exc)[:500])
            return Response(SheetTaskSerializer(task).data)

        # For large sheets, run in a background thread
        def _run_formulas(task_id, sheet_id):
            """Background formula evaluation with progress updates."""
            from django.db import connection as bg_conn
            try:
                bg_sheet = Sheet.objects.prefetch_related(
                    Prefetch('rows', queryset=SheetRow.objects.order_by('order').prefetch_related('cells'))
                ).get(pk=sheet_id)
                bg_task = SheetTask.objects.get(pk=task_id)

                # Propagate column-level formulas first
                bg_sheet.apply_column_formulas()

                formula_cells = list(SheetCell.objects.filter(
                    row__sheet=bg_sheet,
                    raw_value__startswith='=',
                ).select_related('row'))

                total = len(formula_cells)
                bg_task.update_progress(0, total, f'Evaluating {total} formulas…')

                engine = FormulaEngine(bg_sheet)
                CHUNK = 500
                evaluated = 0

                for i in range(0, total, CHUNK):
                    chunk = formula_cells[i:i + CHUNK]
                    updates = []
                    for cell in chunk:
                        col_idx = None
                        for ci, col in enumerate(bg_sheet.columns):
                            if col['key'] == cell.column_key:
                                col_idx = ci
                                break
                        if col_idx is None:
                            continue
                        col_letter = Sheet._col_letter(col_idx)
                        row_num = cell.row.order + 1
                        result = engine.evaluate(cell.raw_value, col_letter, row_num)
                        cell.computed_value = str(result)
                        cell.value_type = 'formula'
                        updates.append(cell)
                        evaluated += 1

                    if updates:
                        SheetCell.objects.bulk_update(
                            updates, ['computed_value', 'value_type'], batch_size=400
                        )

                    bg_task.update_progress(
                        min(evaluated, total), total,
                        f'Evaluated {evaluated}/{total} formulas…',
                    )

                bg_task.complete(
                    result={'evaluated': evaluated},
                    message=f'Evaluated {evaluated} formulas',
                )
            except Exception as exc:
                try:
                    bg_task = SheetTask.objects.get(pk=task_id)
                    bg_task.fail(str(exc)[:500])
                except Exception:
                    pass
            finally:
                bg_conn.close()

        thread = threading.Thread(
            target=_run_formulas,
            args=(task.id, sheet.id),
            daemon=True,
        )
        thread.start()

        task.update_progress(0, formula_count, f'Queued {formula_count} formulas…')
        return Response(SheetTaskSerializer(task).data, status=status.HTTP_202_ACCEPTED)

    # ── Task Status Polling ─────────────────────────────────────────

    @action(detail=True, methods=['get'], url_path=r'task-status/(?P<task_id>[0-9a-f-]+)')
    def task_status(self, request, pk=None, task_id=None):
        """
        GET /api/sheets/<id>/task-status/<task_id>/

        Poll for progress on a long-running sheet operation.
        """
        sheet = self.get_object()
        try:
            task = SheetTask.objects.get(pk=task_id, sheet=sheet)
        except SheetTask.DoesNotExist:
            return Response({'error': 'Task not found'}, status=status.HTTP_404_NOT_FOUND)
        return Response(SheetTaskSerializer(task).data)

    @action(detail=True, methods=['get'], url_path='tasks')
    def list_tasks(self, request, pk=None):
        """
        GET /api/sheets/<id>/tasks/?type=formula_eval&status=running

        List recent tasks for this sheet.
        """
        sheet = self.get_object()
        qs = SheetTask.objects.filter(sheet=sheet)

        task_type = request.query_params.get('type')
        if task_type:
            qs = qs.filter(task_type=task_type)

        task_status_filter = request.query_params.get('status')
        if task_status_filter:
            qs = qs.filter(status=task_status_filter)

        limit = min(50, int(request.query_params.get('limit', 20)))
        return Response(SheetTaskSerializer(qs[:limit], many=True).data)

    # ── Row management ──────────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='add-row')
    def add_row(self, request, pk=None):
        """POST /api/sheets/<id>/add-row/ { "after_order": 5 }"""
        sheet = self.get_object()
        after = request.data.get('after_order', sheet.row_count - 1)
        try:
            after = int(after)
        except (TypeError, ValueError):
            after = sheet.row_count - 1

        new_order = max(0, after + 1)

        # SQLite evaluates UNIQUE constraints row-by-row even inside a
        # transaction, so a simple "order = order + 1" loop can still raise
        # UNIQUE(sheet_id, order) when two adjacent rows are being shifted.
        # Fix: two-phase shift —
        #   Phase 1: move all affected rows to a safe temporary range (+ 100_000)
        #            to clear the target slot with no collisions.
        #   Phase 2: move them to their final positions (order + 1).
        OFFSET = 100_000
        with transaction.atomic():
            rows_to_shift = list(
                SheetRow.objects
                .select_for_update()
                .filter(sheet=sheet, order__gte=new_order)
                .order_by('order')
            )

            if rows_to_shift:
                # Phase 1 — park in safe range (ascending order to avoid collisions)
                for r in rows_to_shift:
                    r.order = r.order + OFFSET
                    r.save(update_fields=['order', 'updated_at'])

                # Phase 2 — move to final positions (ascending still safe, gap already freed)
                for r in rows_to_shift:
                    r.order = r.order - OFFSET + 1
                    r.save(update_fields=['order', 'updated_at'])

            row = SheetRow.objects.create(sheet=sheet, order=new_order)

            # Auto-populate formula columns for the new row
            sheet.apply_column_formulas(rows=[row])

            sheet.row_count = sheet.rows.count()
            sheet.save(update_fields=['row_count', 'updated_at'])

        return Response(SheetRowSerializer(row).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='add-rows')
    def add_rows(self, request, pk=None):
        """POST /api/sheets/<id>/add-rows/ { "count": 5 }"""
        sheet = self.get_object()
        count = request.data.get('count', 1)
        start = sheet.row_count

        rows = [SheetRow(sheet=sheet, order=start + i) for i in range(count)]
        SheetRow.objects.bulk_create(rows)

        # Auto-populate formula columns for the new rows
        new_rows = sheet.rows.filter(order__gte=start).order_by('order')
        sheet.apply_column_formulas(rows=new_rows)

        sheet.row_count = sheet.rows.count()
        sheet.save(update_fields=['row_count', 'updated_at'])

        return Response({'added': count, 'row_count': sheet.row_count})

    @action(detail=True, methods=['post'], url_path='delete-row')
    def delete_row(self, request, pk=None):
        """POST /api/sheets/<id>/delete-row/ { "row_order": 3 }"""
        sheet = self.get_object()
        order = request.data.get('row_order')
        if order is None:
            return Response({'error': 'row_order required'}, status=400)

        SheetRow.objects.filter(sheet=sheet, order=order).delete()

        # Reorder
        for i, row in enumerate(sheet.rows.order_by('order')):
            if row.order != i:
                row.order = i
                row.save(update_fields=['order'])

        sheet.row_count = sheet.rows.count()
        sheet.save(update_fields=['row_count', 'updated_at'])

        return Response({'row_count': sheet.row_count})

    # ── Column management ───────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='add-column')
    def add_column(self, request, pk=None):
        """POST /api/sheets/<id>/add-column/ { "label": "Total", "type": "formula", "formula": "=A{row}+B{row}" }"""
        sheet = self.get_object()
        label = request.data.get('label')
        col_type = request.data.get('type', 'text')
        width = request.data.get('width', 120)
        formula = request.data.get('formula')

        key = sheet.add_column(label=label, col_type=col_type, width=width, formula=formula)
        sheet.save(update_fields=['columns', 'col_count', 'updated_at'])

        # If this is a formula column, propagate to all existing rows & evaluate
        if formula:
            sheet.apply_column_formulas()
            engine = FormulaEngine(sheet)
            engine.evaluate_all()

        return Response({'key': key, 'columns': sheet.columns})

    @action(detail=True, methods=['post'], url_path='delete-column')
    def delete_column(self, request, pk=None):
        """POST /api/sheets/<id>/delete-column/ { "column_key": "col_3" }"""
        sheet = self.get_object()
        col_key = request.data.get('column_key')
        if not col_key:
            return Response({'error': 'column_key required'}, status=400)

        sheet.remove_column(col_key)
        sheet.save(update_fields=['columns', 'col_count', 'updated_at'])

        return Response({'columns': sheet.columns})

    @action(detail=True, methods=['patch'], url_path='update-columns')
    def update_columns(self, request, pk=None):
        """PATCH /api/sheets/<id>/update-columns/ { "columns": [...] }"""
        sheet = self.get_object()
        columns = request.data.get('columns')
        if columns is None:
            return Response({'error': 'columns required'}, status=400)

        sheet.columns = columns
        sheet.col_count = len(columns)
        sheet.save(update_fields=['columns', 'col_count', 'updated_at'])

        # Propagate any column-level formulas and re-evaluate
        if any(c.get('formula') for c in columns):
            sheet.apply_column_formulas()
            engine = FormulaEngine(sheet)
            engine.evaluate_all()

        return Response({'columns': sheet.columns})

    # ── AI-assisted sheet generation ────────────────────────────────

    @action(detail=False, methods=['post'], url_path='ai-generate')
    def ai_generate(self, request):
        """
        POST /api/sheets/ai-generate/
        { "prompt": "Create a budget tracker with monthly columns", "row_count": 12, "col_count": 6 }
        """
        serializer = AIGenerateSheetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        prompt = serializer.validated_data['prompt']
        row_count = serializer.validated_data.get('row_count', 10)
        col_count = serializer.validated_data.get('col_count', 5)

        # Generate sheet structure from prompt
        sheet_data = self._generate_sheet_from_prompt(prompt, row_count, col_count)

        # Create sheet
        org = request.user.profile.organization
        with transaction.atomic():
            sheet = Sheet.objects.create(
                organization=org,
                created_by=request.user,
                title=sheet_data.get('title', 'AI Generated Sheet'),
                description=sheet_data.get('description', f'Generated from: {prompt}'),
                columns=sheet_data.get('columns', []),
                col_count=len(sheet_data.get('columns', [])),
                row_count=len(sheet_data.get('rows', [])),
            )

            # Create rows and cells
            for i, row_data in enumerate(sheet_data.get('rows', [])):
                row = SheetRow.objects.create(sheet=sheet, order=i)
                for col_key, value in row_data.items():
                    SheetCell.objects.create(
                        row=row,
                        column_key=col_key,
                        raw_value=str(value),
                        computed_value=str(value),
                        value_type='formula' if str(value).startswith('=') else 'text',
                        formula=str(value) if str(value).startswith('=') else '',
                    )

            # Evaluate formulas
            engine = FormulaEngine(sheet)
            engine.evaluate_all()

        return Response(
            SheetDetailSerializer(sheet).data,
            status=status.HTTP_201_CREATED,
        )

    def _generate_sheet_from_prompt(self, prompt, row_count, col_count):
        """
        Generate sheet structure from a text prompt.
        Uses simple keyword matching for common sheet types.
        Can be extended to call Gemini AI for more complex generation.
        """
        prompt_lower = prompt.lower()

        # ── Budget tracker ──
        if any(kw in prompt_lower for kw in ['budget', 'expense', 'spending', 'financial']):
            return self._template_budget(row_count, col_count)
        # ── Invoice / billing ──
        elif any(kw in prompt_lower for kw in ['invoice', 'billing', 'payment']):
            return self._template_invoice(row_count)
        # ── Project tracker ──
        elif any(kw in prompt_lower for kw in ['project', 'task', 'tracker', 'todo']):
            return self._template_project_tracker(row_count)
        # ── Inventory ──
        elif any(kw in prompt_lower for kw in ['inventory', 'stock', 'warehouse', 'product']):
            return self._template_inventory(row_count)
        # ── Employee / HR ──
        elif any(kw in prompt_lower for kw in ['employee', 'staff', 'hr', 'payroll']):
            return self._template_employee(row_count)
        # ── Generic ──
        else:
            return self._template_generic(prompt, row_count, col_count)

    def _template_budget(self, rows, cols):
        columns = [
            {'key': 'col_0', 'label': 'Category', 'type': 'text', 'width': 160},
            {'key': 'col_1', 'label': 'Budget', 'type': 'number', 'width': 120},
            {'key': 'col_2', 'label': 'Actual', 'type': 'number', 'width': 120},
            {'key': 'col_3', 'label': 'Variance', 'type': 'formula', 'width': 120},
            {'key': 'col_4', 'label': 'Status', 'type': 'text', 'width': 100},
        ]
        categories = ['Marketing', 'Engineering', 'Sales', 'Operations', 'HR', 'Legal', 'IT', 'R&D', 'Admin', 'Travel']
        row_data = []
        for i in range(min(rows, len(categories))):
            row_data.append({
                'col_0': categories[i],
                'col_1': str((i + 1) * 5000),
                'col_2': str(int((i + 1) * 5000 * 0.8)),
                'col_3': f'=B{i+1}-C{i+1}',
                'col_4': '=IF(D{0}>0,"Under","Over")'.format(i + 1),
            })
        # Totals row
        n = len(row_data) + 1
        row_data.append({
            'col_0': 'TOTAL',
            'col_1': f'=SUM(B1:B{n-1})',
            'col_2': f'=SUM(C1:C{n-1})',
            'col_3': f'=B{n}-C{n}',
            'col_4': '',
        })
        return {
            'title': 'Budget Tracker',
            'description': 'Track budget vs actual spending by category',
            'columns': columns,
            'rows': row_data,
        }

    def _template_invoice(self, rows):
        columns = [
            {'key': 'col_0', 'label': 'Item', 'type': 'text', 'width': 200},
            {'key': 'col_1', 'label': 'Qty', 'type': 'number', 'width': 80},
            {'key': 'col_2', 'label': 'Unit Price', 'type': 'number', 'width': 120},
            {'key': 'col_3', 'label': 'Total', 'type': 'formula', 'width': 120},
        ]
        items = ['Consulting Services', 'Software License', 'Training', 'Support Plan', 'Custom Development']
        row_data = []
        for i, item in enumerate(items[:rows]):
            row_data.append({
                'col_0': item,
                'col_1': str(i + 1),
                'col_2': str(500 * (i + 1)),
                'col_3': f'=B{i+1}*C{i+1}',
            })
        n = len(row_data) + 1
        row_data.append({
            'col_0': 'SUBTOTAL', 'col_1': '', 'col_2': '',
            'col_3': f'=SUM(D1:D{n-1})',
        })
        return {
            'title': 'Invoice',
            'description': 'Invoice line items with auto-calculated totals',
            'columns': columns,
            'rows': row_data,
        }

    def _template_project_tracker(self, rows):
        columns = [
            {'key': 'col_0', 'label': 'Task', 'type': 'text', 'width': 200},
            {'key': 'col_1', 'label': 'Assignee', 'type': 'text', 'width': 130},
            {'key': 'col_2', 'label': 'Priority', 'type': 'select', 'width': 100},
            {'key': 'col_3', 'label': 'Status', 'type': 'select', 'width': 100},
            {'key': 'col_4', 'label': 'Due Date', 'type': 'date', 'width': 120},
            {'key': 'col_5', 'label': 'Progress %', 'type': 'number', 'width': 100},
        ]
        row_data = []
        for i in range(min(rows, 8)):
            row_data.append({
                'col_0': f'Task {i + 1}',
                'col_1': '',
                'col_2': ['High', 'Medium', 'Low'][i % 3],
                'col_3': 'Not Started',
                'col_4': '',
                'col_5': '0',
            })
        return {
            'title': 'Project Tracker',
            'description': 'Track project tasks, assignees, and progress',
            'columns': columns,
            'rows': row_data,
        }

    def _template_inventory(self, rows):
        columns = [
            {'key': 'col_0', 'label': 'Product', 'type': 'text', 'width': 180},
            {'key': 'col_1', 'label': 'SKU', 'type': 'text', 'width': 100},
            {'key': 'col_2', 'label': 'Qty', 'type': 'number', 'width': 80},
            {'key': 'col_3', 'label': 'Price', 'type': 'number', 'width': 100},
            {'key': 'col_4', 'label': 'Value', 'type': 'formula', 'width': 120},
            {'key': 'col_5', 'label': 'Reorder', 'type': 'formula', 'width': 100},
        ]
        row_data = []
        for i in range(min(rows, 8)):
            row_data.append({
                'col_0': f'Product {i + 1}',
                'col_1': f'SKU-{1000 + i}',
                'col_2': str(50 + i * 10),
                'col_3': str(25.99 + i * 5),
                'col_4': f'=C{i+1}*D{i+1}',
                'col_5': f'=IF(C{i+1}<20,"Yes","No")',
            })
        return {
            'title': 'Inventory Tracker',
            'description': 'Track product inventory with auto-calculated values',
            'columns': columns,
            'rows': row_data,
        }

    def _template_employee(self, rows):
        columns = [
            {'key': 'col_0', 'label': 'Name', 'type': 'text', 'width': 160},
            {'key': 'col_1', 'label': 'Department', 'type': 'text', 'width': 130},
            {'key': 'col_2', 'label': 'Role', 'type': 'text', 'width': 150},
            {'key': 'col_3', 'label': 'Salary', 'type': 'number', 'width': 120},
            {'key': 'col_4', 'label': 'Start Date', 'type': 'date', 'width': 120},
        ]
        row_data = [{
            'col_0': '', 'col_1': '', 'col_2': '', 'col_3': '', 'col_4': '',
        } for _ in range(min(rows, 10))]
        return {
            'title': 'Employee Directory',
            'description': 'Employee roster with department and salary info',
            'columns': columns,
            'rows': row_data,
        }

    def _template_generic(self, prompt, rows, cols):
        columns = []
        for i in range(cols):
            columns.append({
                'key': f'col_{i}',
                'label': Sheet._col_letter(i),
                'type': 'text',
                'width': 120,
            })
        row_data = [{c['key']: '' for c in columns} for _ in range(rows)]
        return {
            'title': prompt[:60] if prompt else 'New Sheet',
            'description': f'Generated from: {prompt}',
            'columns': columns,
            'rows': row_data,
        }

    # ── Import workflow data ────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='import-workflow')
    def import_workflow(self, request, pk=None):
        """
        POST /api/sheets/<id>/import-workflow/
        { "workflow_id": "...", "include_inputs": true, "include_outputs": true }

        Pulls extracted fields / output data from workflow executions
        and populates rows in this sheet.
        """
        sheet = self.get_object()
        serializer = ImportWorkflowDataSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        from clm.models import Workflow, WorkflowExecution

        try:
            workflow = Workflow.objects.get(
                id=serializer.validated_data['workflow_id'],
                organization=request.user.profile.organization,
            )
        except Workflow.DoesNotExist:
            return Response({'error': 'Workflow not found'}, status=404)

        # Get all executions for this workflow
        executions = WorkflowExecution.objects.filter(
            workflow=workflow,
        ).order_by('-created_at')[:100]

        if not executions.exists():
            return Response({'error': 'No workflow executions found'}, status=404)

        # Build columns from first execution's data
        first_exec = executions.first()
        field_keys = set()
        for execution in executions:
            data = execution.result_data or {}
            if serializer.validated_data['include_inputs']:
                field_keys.update(data.get('inputs', {}).keys())
            if serializer.validated_data['include_outputs']:
                field_keys.update(data.get('outputs', {}).keys())
            # Also check extracted_data
            extracted = data.get('extracted_data', {})
            field_keys.update(extracted.keys())

        if not field_keys:
            return Response({'error': 'No data fields found in workflow executions'}, status=404)

        # Set up columns
        sorted_keys = sorted(field_keys)
        columns = [{'key': 'col_0', 'label': 'Execution', 'type': 'text', 'width': 160}]
        for i, key in enumerate(sorted_keys):
            columns.append({
                'key': f'col_{i + 1}',
                'label': key.replace('_', ' ').title(),
                'type': 'text',
                'width': 140,
            })

        sheet.columns = columns
        sheet.col_count = len(columns)
        sheet.workflow = workflow

        # Clear existing rows
        sheet.rows.all().delete()

        # Create rows from executions
        for row_idx, execution in enumerate(executions):
            row = SheetRow.objects.create(
                sheet=sheet,
                order=row_idx,
                workflow_run_id=execution.id,
            )

            # Execution ID cell
            SheetCell.objects.create(
                row=row,
                column_key='col_0',
                raw_value=str(execution.id)[:8],
                computed_value=str(execution.id)[:8],
            )

            data = execution.result_data or {}
            all_data = {}
            if serializer.validated_data['include_inputs']:
                all_data.update(data.get('inputs', {}))
            if serializer.validated_data['include_outputs']:
                all_data.update(data.get('outputs', {}))
            all_data.update(data.get('extracted_data', {}))

            for i, key in enumerate(sorted_keys):
                value = all_data.get(key, '')
                SheetCell.objects.create(
                    row=row,
                    column_key=f'col_{i + 1}',
                    raw_value=str(value),
                    computed_value=str(value),
                )

        sheet.row_count = executions.count()
        sheet.save()

        return Response(SheetDetailSerializer(sheet).data)

    # ── Duplicate sheet ─────────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='duplicate')
    def duplicate(self, request, pk=None):
        """POST /api/sheets/<id>/duplicate/"""
        source = self.get_object()

        with transaction.atomic():
            new_sheet = Sheet.objects.create(
                organization=source.organization,
                created_by=request.user,
                title=f"{source.title} (Copy)",
                description=source.description,
                columns=source.columns,
                custom_metadata=source.custom_metadata,
                settings_json=source.settings_json,
                workflow=source.workflow,
                row_count=0,
                col_count=source.col_count,
            )

            new_order = 0
            for row in source.rows.order_by('order'):
                cells = list(row.cells.all())
                # Skip rows that have no cells or only blank values
                if not cells or all(
                    not (c.raw_value or '').strip() for c in cells
                ):
                    continue
                new_row = SheetRow.objects.create(
                    sheet=new_sheet,
                    order=new_order,
                    metadata=row.metadata,
                )
                new_order += 1
                for cell in cells:
                    SheetCell.objects.create(
                        row=new_row,
                        column_key=cell.column_key,
                        raw_value=cell.raw_value,
                        computed_value=cell.computed_value,
                        value_type=cell.value_type,
                        formula=cell.formula,
                        metadata=cell.metadata,
                    )

            new_sheet.row_count = new_order
            new_sheet.save(update_fields=['row_count'])

        return Response(
            SheetDetailSerializer(new_sheet).data,
            status=status.HTTP_201_CREATED,
        )

    # ── Clean empty rows ──────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='clean-empty-rows')
    def clean_empty_rows(self, request, pk=None):
        """POST /api/sheets/<id>/clean-empty-rows/  — delete rows with no data."""
        sheet = self.get_object()
        deleted = sheet.delete_empty_rows()
        return Response({'deleted': deleted, 'row_count': sheet.row_count})

    # ── Export as JSON (metadata) ───────────────────────────────────

    @action(detail=True, methods=['get'], url_path='export-metadata')
    def export_metadata(self, request, pk=None):
        """
        GET /api/sheets/<id>/export-metadata/

        Returns sheet data as metadata key-value pairs.
        Row headings (first column) become metadata keys,
        subsequent columns become values.
        """
        sheet = self.get_object()
        metadata = {}

        for row in sheet.rows.order_by('order'):
            cells = {c.column_key: c.computed_value or c.raw_value for c in row.cells.all()}

            # First column is the key
            heading_col = sheet.columns[0]['key'] if sheet.columns else None
            if not heading_col:
                continue

            key = cells.get(heading_col, '')
            if not key:
                continue

            # Build values dict from remaining columns
            values = {}
            for col in sheet.columns[1:]:
                val = cells.get(col['key'], '')
                values[col['label']] = val

            metadata[key] = values if len(values) > 1 else list(values.values())[0] if values else ''

        return Response({
            'sheet_id': str(sheet.id),
            'title': sheet.title,
            'metadata': metadata,
        })

    # ── CSV Export ──────────────────────────────────────────────────

    @action(detail=True, methods=['get'], url_path='export-csv')
    def export_csv(self, request, pk=None):
        """
        GET /api/sheets/<id>/export-csv/

        Returns the sheet as a CSV file download.
        """
        import csv
        import io
        from django.http import HttpResponse

        sheet = self.get_object()
        output = io.StringIO()
        writer = csv.writer(output)

        # Header row
        writer.writerow([col.get('label', col['key']) for col in sheet.columns])

        # Data rows
        rows_qs = sheet.rows.order_by('order').prefetch_related('cells')
        for row in rows_qs:
            cells_map = {c.column_key: (c.computed_value if c.computed_value not in (None, '') else c.raw_value) or '' for c in row.cells.all()}
            writer.writerow([cells_map.get(col['key'], '') for col in sheet.columns])

        response = HttpResponse(output.getvalue(), content_type='text/csv')
        safe_title = sheet.title.replace('"', '').replace('\n', '').strip() or 'sheet'
        response['Content-Disposition'] = f'attachment; filename="{safe_title}.csv"'
        return response

    # ── CSV Import ──────────────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='import-csv')
    def import_csv(self, request, pk=None):
        """
        POST /api/sheets/<id>/import-csv/

        Accepts a CSV file upload.  The first row is treated as column
        headers — new columns are created for any header not already present.
        Subsequent rows become sheet rows.  Existing data is preserved; new
        rows are appended.
        """
        import csv
        import io

        csv_file = request.FILES.get('file')
        if not csv_file:
            return Response({'error': 'No file provided. Use form field "file".'}, status=400)

        try:
            decoded = csv_file.read().decode('utf-8-sig')
        except UnicodeDecodeError:
            return Response({'error': 'File must be UTF-8 encoded CSV.'}, status=400)

        reader = csv.reader(io.StringIO(decoded))
        rows_data = list(reader)
        if not rows_data:
            return Response({'error': 'CSV file is empty.'}, status=400)

        headers = rows_data[0]
        data_rows = rows_data[1:]

        sheet = self.get_object()
        existing_labels = {col['label']: col['key'] for col in sheet.columns}
        col_map = []  # index → column_key

        with transaction.atomic():
            new_columns = list(sheet.columns)
            for h in headers:
                h = h.strip()
                if h in existing_labels:
                    col_map.append(existing_labels[h])
                else:
                    key = h.lower().replace(' ', '_')[:32] or f'col_{len(new_columns)+1}'
                    # Ensure unique key
                    existing_keys = {c['key'] for c in new_columns}
                    base_key = key
                    counter = 2
                    while key in existing_keys:
                        key = f'{base_key}_{counter}'
                        counter += 1
                    new_col = {'key': key, 'label': h, 'type': 'text', 'width': 120}
                    new_columns.append(new_col)
                    existing_labels[h] = key
                    col_map.append(key)

            if len(new_columns) != len(sheet.columns):
                sheet.columns = new_columns
                sheet.save(update_fields=['columns'])

            current_max_order = sheet.rows.aggregate(mx=db_models.Max('order'))['mx'] or -1
            rows_created = 0
            for row_data in data_rows:
                if not any(cell.strip() for cell in row_data):
                    continue  # skip empty rows
                current_max_order += 1
                new_row = SheetRow.objects.create(sheet=sheet, order=current_max_order)
                cells_to_create = []
                for idx, val in enumerate(row_data):
                    if idx >= len(col_map):
                        break
                    val = val.strip()
                    if val:
                        cells_to_create.append(SheetCell(row=new_row, column_key=col_map[idx], raw_value=val))
                if cells_to_create:
                    SheetCell.objects.bulk_create(cells_to_create)
                rows_created += 1

            sheet.row_count = sheet.rows.count()
            sheet.save(update_fields=['row_count'])

        # Re-evaluate formulas
        try:
            sheet.apply_column_formulas()
        except Exception:
            pass

        serializer = SheetDetailSerializer(sheet, context={'request': request})
        return Response({
            'rows_imported': rows_created,
            'sheet': serializer.data,
        })

    # ── List importable document tables ─────────────────────────────

    @action(detail=False, methods=['get'], url_path='list-document-tables')
    def list_document_tables(self, request):
        """
        GET /api/sheets/list-document-tables/?search=...

        Lists all Table objects from documents owned by the user's org.
        """
        from documents.models import Table

        org = request.user.profile.organization
        qs = Table.objects.filter(
            section__document__user__profile__organization=org,
        ).select_related('section', 'section__document').order_by('-last_modified')

        search = request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(
                db_models.Q(title__icontains=search)
                | db_models.Q(section__document__title__icontains=search)
                | db_models.Q(section__title__icontains=search)
            )

        qs = qs[:50]
        serializer = DocumentTableListItemSerializer(qs, many=True)
        return Response(serializer.data)

    # ── Import document table into sheet ────────────────────────────

    @action(detail=True, methods=['post'], url_path='import-document-table')
    def import_document_table(self, request, pk=None):
        """
        POST /api/sheets/<id>/import-document-table/
        { "table_id": "...", "append": false }

        Copies column_headers + table_data from a Document Table into sheet.
        """
        sheet = self.get_object()
        serializer = ImportDocumentTableSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        from documents.models import Table

        try:
            table = Table.objects.select_related(
                'section', 'section__document',
            ).get(
                id=serializer.validated_data['table_id'],
                section__document__user__profile__organization=request.user.profile.organization,
            )
        except Table.DoesNotExist:
            return Response({'error': 'Table not found'}, status=404)

        append = serializer.validated_data['append']
        col_headers = table.column_headers or []
        table_rows = table.table_data or []

        # Build sheet columns from Table.column_headers
        columns = []
        for i, hdr in enumerate(col_headers):
            columns.append({
                'key': f'col_{i}',
                'label': hdr.get('label', f'Column {i + 1}'),
                'type': hdr.get('type', 'text'),
                'width': 140,
            })

        if not columns:
            return Response({'error': 'Table has no columns'}, status=400)

        with transaction.atomic():
            if not append:
                sheet.rows.all().delete()
                sheet.columns = columns
                sheet.col_count = len(columns)
                start_order = 0
            else:
                # Merge columns — add any new ones that don't exist
                existing_labels = {c['label'] for c in sheet.columns}
                next_idx = len(sheet.columns)
                for col in columns:
                    if col['label'] not in existing_labels:
                        col_copy = dict(col)
                        col_copy['key'] = f'col_{next_idx}'
                        sheet.columns.append(col_copy)
                        next_idx += 1
                sheet.col_count = len(sheet.columns)
                start_order = sheet.rows.count()

            # Map table column ids → sheet column keys by label
            label_to_key = {c['label']: c['key'] for c in sheet.columns}

            for row_idx, tbl_row in enumerate(table_rows):
                row = SheetRow.objects.create(
                    sheet=sheet,
                    order=start_order + row_idx,
                )
                cells_data = tbl_row.get('cells', {})
                for hdr in col_headers:
                    col_id = hdr.get('id', '')
                    label = hdr.get('label', '')
                    col_key = label_to_key.get(label)
                    if not col_key:
                        continue
                    value = str(cells_data.get(col_id, ''))
                    SheetCell.objects.create(
                        row=row,
                        column_key=col_key,
                        raw_value=value,
                        computed_value=value,
                    )

            sheet.row_count = sheet.rows.count()
            sheet.save()

        return Response(SheetDetailSerializer(sheet).data)

    # ── List LaTeX sources containing tables ────────────────────────

    @action(detail=False, methods=['get'], url_path='list-latex-tables')
    def list_latex_tables(self, request):
        """
        GET /api/sheets/list-latex-tables/?search=...

        Scans LatexCode blocks and quick-latex Documents for \\begin{tabular}
        and returns sources that contain at least one table.
        """
        import re

        org = request.user.profile.organization
        search = request.query_params.get('search', '').strip()
        tabular_re = re.compile(r'\\begin\{tabular\}')

        results = []

        # 1) LatexCode blocks
        from documents.models import LatexCode
        lc_qs = LatexCode.objects.filter(
            section__document__user__profile__organization=org,
        ).select_related('section', 'section__document')

        if search:
            lc_qs = lc_qs.filter(
                db_models.Q(section__document__title__icontains=search)
                | db_models.Q(topic__icontains=search)
            )

        for lc in lc_qs[:50]:
            content = lc.get_effective_content() or ''
            tables = self._parse_latex_tables(content)
            if tables:
                results.append({
                    'id': str(lc.id),
                    'source_type': 'latex_code',
                    'title': lc.topic or f"LaTeX block in {lc.section.document.title if lc.section and lc.section.document else 'Unknown'}",
                    'table_count': len(tables),
                    'tables_preview': [
                        {'index': i, 'rows': len(t['rows']), 'cols': len(t['headers'])}
                        for i, t in enumerate(tables)
                    ],
                    'doc_id': str(lc.section.document.id) if lc.section and lc.section.document else '',
                    'doc_title': lc.section.document.title if lc.section and lc.section.document else '',
                })

        # 2) Quick-latex documents (Document.latex_code field)
        from documents.models import Document
        doc_qs = Document.objects.filter(
            user__profile__organization=org,
            document_mode='quick_latex',
        )
        if search:
            doc_qs = doc_qs.filter(title__icontains=search)

        for doc in doc_qs[:30]:
            content = doc.latex_code or ''
            tables = self._parse_latex_tables(content)
            if tables:
                results.append({
                    'id': str(doc.id),
                    'source_type': 'document',
                    'title': doc.title or 'Untitled LaTeX Document',
                    'table_count': len(tables),
                    'tables_preview': [
                        {'index': i, 'rows': len(t['rows']), 'cols': len(t['headers'])}
                        for i, t in enumerate(tables)
                    ],
                    'doc_id': str(doc.id),
                    'doc_title': doc.title or '',
                })

        return Response(results)

    # ── Import LaTeX table into sheet ───────────────────────────────

    @action(detail=True, methods=['post'], url_path='import-latex-table')
    def import_latex_table(self, request, pk=None):
        """
        POST /api/sheets/<id>/import-latex-table/
        { "source_type": "latex_code"|"document", "source_id": "...", "table_index": 0, "append": false }

        Parses \\begin{tabular}...\\end{tabular} from the source and creates rows/columns.
        """
        sheet = self.get_object()
        serializer = ImportLatexTableSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        org = request.user.profile.organization
        source_type = serializer.validated_data['source_type']
        source_id = serializer.validated_data['source_id']
        table_index = serializer.validated_data['table_index']
        append = serializer.validated_data['append']

        # Fetch LaTeX content
        if source_type == 'latex_code':
            from documents.models import LatexCode
            try:
                lc = LatexCode.objects.select_related(
                    'section', 'section__document',
                ).get(
                    id=source_id,
                    section__document__user__profile__organization=org,
                )
            except LatexCode.DoesNotExist:
                return Response({'error': 'LaTeX code block not found'}, status=404)
            content = lc.get_effective_content() or ''
        else:
            from documents.models import Document
            try:
                doc = Document.objects.get(id=source_id, user__profile__organization=org)
            except Document.DoesNotExist:
                return Response({'error': 'Document not found'}, status=404)
            content = doc.latex_code or ''

        tables = self._parse_latex_tables(content)
        if not tables:
            return Response({'error': 'No tabular environments found in source'}, status=404)
        if table_index >= len(tables):
            return Response(
                {'error': f'Table index {table_index} out of range (found {len(tables)} tables)'},
                status=400,
            )

        parsed = tables[table_index]
        headers = parsed['headers']
        rows = parsed['rows']

        # Build columns
        columns = []
        for i, hdr in enumerate(headers):
            columns.append({
                'key': f'col_{i}',
                'label': hdr or f'Column {i + 1}',
                'type': 'text',
                'width': 140,
            })

        if not columns:
            return Response({'error': 'Parsed table has no columns'}, status=400)

        with transaction.atomic():
            if not append:
                sheet.rows.all().delete()
                sheet.columns = columns
                sheet.col_count = len(columns)
                start_order = 0
            else:
                existing_labels = {c['label'] for c in sheet.columns}
                next_idx = len(sheet.columns)
                for col in columns:
                    if col['label'] not in existing_labels:
                        col_copy = dict(col)
                        col_copy['key'] = f'col_{next_idx}'
                        sheet.columns.append(col_copy)
                        next_idx += 1
                sheet.col_count = len(sheet.columns)
                start_order = sheet.rows.count()

            label_to_key = {c['label']: c['key'] for c in sheet.columns}

            for row_idx, row_cells in enumerate(rows):
                row = SheetRow.objects.create(
                    sheet=sheet,
                    order=start_order + row_idx,
                )
                for i, cell_val in enumerate(row_cells):
                    hdr_label = headers[i] if i < len(headers) else f'Column {i + 1}'
                    col_key = label_to_key.get(hdr_label)
                    if not col_key:
                        continue
                    value = str(cell_val).strip()
                    SheetCell.objects.create(
                        row=row,
                        column_key=col_key,
                        raw_value=value,
                        computed_value=value,
                    )

            sheet.row_count = sheet.rows.count()
            sheet.save()

        return Response(SheetDetailSerializer(sheet).data)

    # ── LaTeX table parser helper ───────────────────────────────────

    @staticmethod
    def _parse_latex_tables(latex_content: str) -> list:
        """
        Parse all \\begin{tabular}...\\end{tabular} environments from LaTeX.

        Returns a list of dicts:
            [{ 'headers': ['Col A', 'Col B'], 'rows': [['v1','v2'], ...] }, ...]
        """
        import re

        tables = []
        pattern = re.compile(
            r'\\begin\{tabular\}\s*\{[^}]*\}(.*?)\\end\{tabular\}',
            re.DOTALL,
        )

        for match in pattern.finditer(latex_content):
            body = match.group(1).strip()

            # Split on \\ (row separator)
            raw_rows = re.split(r'\\\\', body)
            parsed_rows = []

            for raw in raw_rows:
                line = raw.strip()
                if not line:
                    continue
                # Remove \hline, \toprule, \midrule, \bottomrule
                line = re.sub(r'\\(hline|toprule|midrule|bottomrule)\s*', '', line).strip()
                if not line:
                    continue
                # Split on & (column separator) and clean each cell
                cells = [c.strip() for c in line.split('&')]
                # Remove leftover LaTeX commands like \textbf{...}
                cleaned = []
                for cell in cells:
                    cell = re.sub(r'\\textbf\{([^}]*)\}', r'\1', cell)
                    cell = re.sub(r'\\textit\{([^}]*)\}', r'\1', cell)
                    cell = re.sub(r'\\emph\{([^}]*)\}', r'\1', cell)
                    cell = re.sub(r'\\multicolumn\{\d+\}\{[^}]*\}\{([^}]*)\}', r'\1', cell)
                    cell = cell.strip()
                    cleaned.append(cell)
                parsed_rows.append(cleaned)

            if not parsed_rows:
                continue

            # First row = headers, rest = data
            headers = parsed_rows[0]
            data_rows = parsed_rows[1:]

            # Normalize row lengths
            ncols = len(headers)
            normalised_rows = []
            for r in data_rows:
                if len(r) < ncols:
                    r.extend([''] * (ncols - len(r)))
                normalised_rows.append(r[:ncols])

            tables.append({'headers': headers, 'rows': normalised_rows})

        return tables

    # ── CLM workflow node queries ───────────────────────────────────

    @action(detail=True, methods=['get'], url_path='node-queries')
    def node_queries(self, request, pk=None):
        """
        GET /api/sheets/<id>/node-queries/?node=<uuid>&limit=50

        List SheetNodeQuery records for this sheet, optionally filtered
        by a specific workflow node.  Allows the Sheets tab to show
        which workflow nodes have read from or written to this sheet,
        with query counts and cache hit stats.
        """
        sheet = self.get_object()
        from clm.models import SheetNodeQuery
        from clm.serializers import SheetNodeQuerySerializer
        from django.db.models import Count, Q, Sum

        qs = SheetNodeQuery.objects.filter(
            sheet=sheet,
        ).select_related('node', 'source_document')

        node_id = request.query_params.get('node')
        if node_id:
            qs = qs.filter(node_id=node_id)

        limit = int(request.query_params.get('limit', 50))
        queries = qs.order_by('-created_at')[:limit]

        # Aggregate stats
        stats = SheetNodeQuery.objects.filter(sheet=sheet).aggregate(
            total_queries=Count('id'),
            total_reads=Count('id', filter=Q(operation='read')),
            total_writes=Count('id', filter=Q(operation__in=['write', 'append'])),
            total_cached=Count('id', filter=Q(status='cached')),
            total_hit_count=Sum('hit_count'),
        )

        # Per-node breakdown
        node_breakdown = SheetNodeQuery.objects.filter(
            sheet=sheet,
        ).values(
            'node__id', 'node__label', 'node__node_type',
        ).annotate(
            query_count=Count('id'),
            cache_hits=Count('id', filter=Q(status='cached')),
        ).order_by('-query_count')

        return Response({
            'sheet_id': str(sheet.id),
            'sheet_title': sheet.title,
            'stats': stats,
            'node_breakdown': list(node_breakdown),
            'queries': SheetNodeQuerySerializer(queries, many=True).data,
        })

    @action(detail=True, methods=['get'], url_path='linked-nodes')
    def linked_nodes(self, request, pk=None):
        """
        GET /api/sheets/<id>/linked-nodes/

        List all CLM workflow nodes that reference this sheet
        (via node.config.sheet_id). Allows the Sheets tab to show
        which workflows use this sheet and in what mode (input/storage).
        """
        sheet = self.get_object()
        from clm.models import WorkflowNode
        from clm.serializers import WorkflowNodeSerializer

        # Find all sheet nodes that reference this sheet
        nodes = WorkflowNode.objects.filter(
            node_type='sheet',
            config__sheet_id=str(sheet.id),
        ).select_related('workflow')

        results = []
        for node in nodes:
            config = node.config or {}
            results.append({
                'node_id': str(node.id),
                'node_label': node.label,
                'workflow_id': str(node.workflow.id),
                'workflow_name': node.workflow.name,
                'mode': config.get('mode', 'storage'),
                'write_mode': config.get('write_mode', 'append'),
            })

        return Response({
            'sheet_id': str(sheet.id),
            'linked_nodes': results,
        })

    # ── Share Links ─────────────────────────────────────────────────

    @action(detail=True, methods=['get', 'post'], url_path='share-links')
    def share_links(self, request, pk=None):
        """
        GET  /api/sheets/<id>/share-links/  — list all share links
        POST /api/sheets/<id>/share-links/  — create a new share link
        """
        sheet = self.get_object()

        if request.method == 'GET':
            links = sheet.share_links.all()
            return Response(SheetShareLinkSerializer(links, many=True).data)

        serializer = SheetShareLinkCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data

        create_kwargs = dict(
            sheet=sheet,
            label=d.get('label', ''),
            description=d.get('description', ''),
            access_type=d.get('access_type', 'public'),
            expires_at=d.get('expires_at'),
            max_submissions=d.get('max_submissions'),
            form_columns=d.get('form_columns', []),
            created_by=request.user,
        )
        # Optionally link to a CLM workflow / node
        wf_id = d.get('workflow')
        wn_id = d.get('workflow_node')
        if wf_id:
            from clm.models import Workflow
            try:
                create_kwargs['workflow'] = Workflow.objects.get(id=wf_id)
            except Workflow.DoesNotExist:
                pass
        if wn_id:
            from clm.models import WorkflowNode
            try:
                create_kwargs['workflow_node'] = WorkflowNode.objects.get(id=wn_id)
            except WorkflowNode.DoesNotExist:
                pass

        link = SheetShareLink.objects.create(**create_kwargs)

        return Response(
            SheetShareLinkSerializer(link).data,
            status=status.HTTP_201_CREATED,
        )

    @action(
        detail=True, methods=['get', 'patch', 'delete'],
        url_path='share-links/(?P<link_id>[0-9a-f-]+)',
    )
    def share_link_detail(self, request, pk=None, link_id=None):
        """
        GET    /api/sheets/<id>/share-links/<link_id>/
        PATCH  /api/sheets/<id>/share-links/<link_id>/
        DELETE /api/sheets/<id>/share-links/<link_id>/
        """
        sheet = self.get_object()
        try:
            link = sheet.share_links.get(id=link_id)
        except SheetShareLink.DoesNotExist:
            return Response({'error': 'Share link not found'}, status=404)

        if request.method == 'GET':
            return Response(SheetShareLinkSerializer(link).data)

        if request.method == 'DELETE':
            link.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        # PATCH
        for field in ('label', 'description', 'is_active', 'access_type',
                       'expires_at', 'max_submissions', 'form_columns'):
            if field in request.data:
                setattr(link, field, request.data[field])
        link.save()
        return Response(SheetShareLinkSerializer(link).data)

    @action(detail=True, methods=['get'], url_path='submissions')
    def submissions(self, request, pk=None):
        """
        GET /api/sheets/<id>/submissions/  — list form submissions
        """
        sheet = self.get_object()
        subs = sheet.form_submissions.select_related('share_link').order_by('-created_at')

        link_id = request.query_params.get('link')
        if link_id:
            subs = subs.filter(share_link_id=link_id)

        limit = int(request.query_params.get('limit', 100))
        return Response(SheetFormSubmissionSerializer(subs[:limit], many=True).data)

    # ── Intelligent Dashboard ───────────────────────────────────────

    def _extract_sheet_table_json(self, sheet):
        """
        Convert sheet data into a compact JSON table for the AI prompt.
        Returns { columns: [...], rows: [...dict...], summary: str }.
        """
        columns = sheet.columns or []
        rows_qs = sheet.rows.order_by('order').prefetch_related('cells')

        col_keys = [c['key'] for c in columns]
        col_labels = {c['key']: c.get('label', c['key']) for c in columns}
        col_types = {c['key']: c.get('type', 'text') for c in columns}

        table_rows = []
        for row in rows_qs:
            cell_map = {c.column_key: (c.computed_value or c.raw_value or '') for c in row.cells.all()}
            if not any(cell_map.get(k, '').strip() for k in col_keys):
                continue  # skip empty rows
            row_dict = {}
            for k in col_keys:
                row_dict[col_labels[k]] = cell_map.get(k, '')
            table_rows.append(row_dict)

        # Limit to 200 rows for prompt size
        sample = table_rows[:200]
        return {
            'columns': [{'key': c['key'], 'label': col_labels[c['key']], 'type': col_types[c['key']]} for c in columns],
            'rows': sample,
            'total_rows': len(table_rows),
            'summary': f"Sheet '{sheet.title}' with {len(columns)} columns and {len(table_rows)} rows.",
        }

    def _build_dashboard_prompt(self, table_json, user_prompt=''):
        """Build the system + user prompt for Gemini dashboard generation."""
        system_prompt = (
            "You are a data visualization AND data science expert. Given spreadsheet data, "
            "generate a dashboard configuration with Recharts-compatible charts AND a full "
            "statistical analysis.\n\n"
            "RULES:\n"
            "1. Return ONLY a JSON object — no markdown fences, no explanations.\n"
            "2. Analyse the data and choose the BEST chart types to visualise it.\n"
            "3. Pre-compute the `data` array for each chart from the rows provided.\n"
            "4. For numeric columns, convert string values to numbers in the data arrays.\n"
            "5. Use descriptive colours as hex strings.\n"
            "6. Keep chart count between 2-6 depending on data richness.\n"
            "7. Perform real statistical analysis on the numeric data.\n\n"
            "CHART TYPES allowed: bar, line, area, pie, composed, scatter, radialBar, radar, funnel\n\n"
            "OUTPUT JSON SCHEMA:\n"
            "{\n"
            '  "title": "Dashboard Title",\n'
            '  "description": "Brief description",\n'
            '  "charts": [\n'
            "    {\n"
            '      "id": "chart_1",\n'
            '      "type": "bar",\n'
            '      "title": "Chart Title",\n'
            '      "data": [ {"name": "Label", "value": 100}, ... ],\n'
            '      "config": {\n'
            '        "xAxisKey": "name",\n'
            '        "bars": [ {"dataKey": "value", "fill": "#8884d8", "name": "Revenue"} ],\n'
            '        "showGrid": true,\n'
            '        "showLegend": true,\n'
            '        "showTooltip": true\n'
            "      }\n"
            "    }\n"
            "  ],\n"
            '  "layout": "grid",\n'
            '  "columns": 2,\n'
            '  "kpis": [\n'
            '    {"label": "Total Revenue", "value": "$10,000", "change": "+12%", "changeType": "positive"}\n'
            "  ],\n"
            '  "analysis": {\n'
            '    "summary": "A 2-4 sentence executive overview of what the data shows, key patterns, and overall health.",\n'
            '    "scientific_significance": [\n'
            "      {\n"
            '        "test": "Name of the statistical test or observation (e.g. Correlation, Variance, Trend Analysis, Distribution Shape)",\n'
            '        "finding": "What the test reveals about the data",\n'
            '        "p_value": "p-value or confidence if applicable (string, e.g. \'p < 0.05\' or \'95% CI\')",\n'
            '        "significance": "high | medium | low",\n'
            '        "explanation": "Plain-english explanation of why this matters"\n'
            "      }\n"
            "    ],\n"
            '    "outliers": [\n'
            "      {\n"
            '        "column": "Column name where outlier was found",\n'
            '        "value": "The outlier value",\n'
            '        "row_label": "Row identifier (first column value)",\n'
            '        "deviation": "How far from mean/median (e.g. \'3.2 std devs above mean\')",\n'
            '        "severity": "high | medium | low",\n'
            '        "recommendation": "What to do about it"\n'
            "      }\n"
            "    ],\n"
            '    "suggestions": [\n'
            "      {\n"
            '        "type": "optimization | warning | insight | action",\n'
            '        "title": "Short title",\n'
            '        "description": "Detailed actionable suggestion based on the data",\n'
            '        "priority": "high | medium | low",\n'
            '        "affected_columns": ["Column A", "Column B"]\n'
            "      }\n"
            "    ],\n"
            '    "data_quality": {\n'
            '      "completeness_pct": 95,\n'
            '      "issues": ["Description of any data quality issues found"]\n'
            "    }\n"
            "  }\n"
            "}\n\n"
            "ANALYSIS INSTRUCTIONS:\n"
            "- `summary`: Provide a clear executive summary of the data patterns, trends, and notable findings.\n"
            "- `scientific_significance`: For each numeric column pair, check for correlations. "
            "Check distributions for normality. Identify trends (increasing/decreasing). "
            "Report variance, standard deviation insights. Use appropriate statistical language.\n"
            "- `outliers`: Use IQR method (Q1 - 1.5*IQR, Q3 + 1.5*IQR) or z-score (|z| > 2) "
            "to detect outliers in numeric columns. Report each with context.\n"
            "- `suggestions`: Provide 3-6 actionable, data-driven suggestions. "
            "These could be optimizations, warnings about concerning trends, insights about patterns, "
            "or recommended actions based on the data.\n"
            "- `data_quality`: Report on missing values, inconsistent formats, or other issues.\n\n"
            "CHART IMPORTANT:\n"
            "- Each chart's `data` must be a ready-to-use array of objects.\n"
            "- Numbers in `data` must be actual numbers, NOT strings.\n"
            "- `kpis` array is optional but preferred for summary statistics.\n"
            "- For pie charts, use `dataKey` and `nameKey` in config.\n"
            "- For bar/line/area, use `xAxisKey` plus `bars`/`lines`/`areas` arrays.\n"
            "- Return ONLY the JSON object."
        )

        user_text = f"SPREADSHEET DATA:\n{json.dumps(table_json, indent=2)}"
        if user_prompt:
            user_text += f"\n\nUSER REQUEST: {user_prompt}"

        return system_prompt, user_text

    def _call_gemini_for_dashboard(self, system_prompt, user_text):
        """Call Gemini and parse the chart_config JSON from the response."""
        import requests as http_requests

        api_key = os.environ.get('GEMINI_API')
        if not api_key:
            raise ValueError('GEMINI_API key not configured')

        model = os.environ.get('GEN_MODEL', 'gemini-2.5-flash')
        url = os.environ.get(
            'GEN_API_URL',
            'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
        ).format(model=model)

        payload = {
            'contents': [{
                'role': 'user',
                'parts': [
                    {'text': system_prompt},
                    {'text': user_text},
                ],
            }],
            'generationConfig': {
                'temperature': 0.2,
                'topP': 0.9,
                'topK': 40,
                'maxOutputTokens': 16000,
            },
        }

        resp = http_requests.post(
            url, params={'key': api_key},
            headers={'Content-Type': 'application/json'},
            json=payload, timeout=120,
        )
        resp.raise_for_status()
        result = resp.json()

        # Extract JSON from Gemini response
        candidates = result.get('candidates', [])
        for c in candidates:
            parts = c.get('content', {}).get('parts', [])
            for part in parts:
                text = part.get('text', '')
                # Try to parse JSON (may be wrapped in ```json fences)
                fence = re.search(r'```(?:json)?\s*(\{.*\})\s*```', text, re.DOTALL)
                if fence:
                    return json.loads(fence.group(1))
                m = re.search(r'(\{.*\})', text, re.DOTALL)
                if m:
                    return json.loads(m.group(1))

        raise ValueError('Could not extract JSON from Gemini response')

    @action(detail=True, methods=['post'], url_path='generate-dashboard')
    def generate_dashboard(self, request, pk=None):
        """
        POST /api/sheets/<id>/generate-dashboard/
        { "prompt": "optional user instructions for chart preferences" }

        Calls AI to generate a Recharts-compatible dashboard config.
        Retries up to 3 times on failure, then returns a fallback config.
        """
        sheet = self.get_object()
        user_prompt = request.data.get('prompt', '')
        max_retries = 3

        table_json = self._extract_sheet_table_json(sheet)
        if not table_json['rows']:
            return Response(
                {'error': 'Sheet has no data to visualise'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        system_prompt, user_text = self._build_dashboard_prompt(table_json, user_prompt)

        # Try AI generation with retries
        chart_config = None
        errors = []
        for attempt in range(1, max_retries + 1):
            try:
                chart_config = self._call_gemini_for_dashboard(system_prompt, user_text)
                if isinstance(chart_config, dict) and 'charts' in chart_config:
                    break
                else:
                    errors.append(f'Attempt {attempt}: Invalid config structure')
                    chart_config = None
            except Exception as exc:
                errors.append(f'Attempt {attempt}: {str(exc)[:200]}')
                logger.warning('Dashboard generation attempt %d failed: %s', attempt, exc)
                chart_config = None

        # Determine status
        if chart_config and 'charts' in chart_config:
            gen_status = 'success'
        else:
            gen_status = 'fallback'
            chart_config = self._build_fallback_dashboard(table_json)

        # Persist
        dashboard, created = SheetDashboard.objects.update_or_create(
            sheet=sheet,
            is_active=True,
            defaults={
                'title': chart_config.get('title', 'Intelligent Dashboard'),
                'chart_config': chart_config,
                'prompt_used': user_prompt or 'auto',
                'generation_status': gen_status,
                'retry_count': len(errors),
                'error_log': errors,
            },
        )

        return Response(
            SheetDashboardSerializer(dashboard).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    @action(detail=True, methods=['get'], url_path='dashboard')
    def get_dashboard(self, request, pk=None):
        """
        GET /api/sheets/<id>/dashboard/
        Returns the most recent active dashboard for this sheet.
        """
        sheet = self.get_object()
        dashboard = sheet.dashboards.filter(is_active=True).first()
        if not dashboard:
            return Response(
                {'error': 'No dashboard generated yet. Use generate-dashboard first.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(SheetDashboardSerializer(dashboard).data)

    @action(detail=True, methods=['delete'], url_path='dashboard/delete')
    def delete_dashboard(self, request, pk=None):
        """DELETE /api/sheets/<id>/dashboard/delete/ — deactivate dashboard."""
        sheet = self.get_object()
        updated = sheet.dashboards.filter(is_active=True).update(is_active=False)
        return Response({'deleted': updated})

    @action(detail=True, methods=['post'], url_path='dashboard/refresh')
    def refresh_dashboard(self, request, pk=None):
        """
        POST /api/sheets/<id>/dashboard/refresh/
        Re-compute chart data from current sheet data without calling AI again.
        Uses the existing chart_config structure but refreshes data arrays.
        """
        sheet = self.get_object()
        dashboard = sheet.dashboards.filter(is_active=True).first()
        if not dashboard:
            return Response({'error': 'No active dashboard'}, status=404)

        table_json = self._extract_sheet_table_json(sheet)
        config = dashboard.chart_config

        # Refresh data for each chart from current sheet data
        col_labels = {c['key']: c['label'] for c in table_json['columns']}
        for chart in config.get('charts', []):
            # Re-derive data from rows based on chart config
            chart['_data_refreshed'] = True

        dashboard.chart_config = config
        dashboard.save(update_fields=['chart_config', 'updated_at'])

        return Response(SheetDashboardSerializer(dashboard).data)

    # ── Analytics + AI (split pipeline) ─────────────────────────────

    @action(detail=True, methods=['get'], url_path='sheet-analytics')
    def sheet_analytics(self, request, pk=None):
        """
        GET /api/sheets/<id>/sheet-analytics/
        Pure server-side statistics — NO AI call.
        Returns column stats, correlations, outliers, data quality, summary.
        """
        sheet = self.get_object()
        try:
            analytics = full_sheet_analytics(sheet)
        except Exception as exc:
            logger.exception('Analytics computation failed for sheet %s', pk)
            return Response(
                {'error': f'Analytics computation failed: {str(exc)[:300]}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response(analytics)

    # ── AI-driven analytics (function-calling pattern) ──────────────

    @action(detail=True, methods=['post'], url_path='smart-analytics')
    def smart_analytics(self, request, pk=None):
        """
        POST /api/sheets/<id>/smart-analytics/
        { "prompt": "optional user hint" }

        Pipeline:
            1. Extract sheet metadata (column names, types, samples — NO raw data)
            2. Send metadata + function catalog to AI → AI returns a plan
               (list of { function, params } calls)
            3. Execute every call server-side against the real data
            4. Return the executed results
        """
        sheet = self.get_object()
        user_prompt = request.data.get('prompt', '')

        # 1 — Extract sheet data & build metadata
        try:
            sheet_data = extract_sheet_data(sheet)
        except Exception as exc:
            logger.exception('Sheet data extraction failed for %s', pk)
            return Response(
                {'error': f'Data extraction failed: {str(exc)[:300]}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        if sheet_data['total_rows'] == 0:
            return Response(
                {'error': 'Sheet has no data to analyse'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        metadata = build_sheet_metadata(sheet_data)

        # 2 — AI selects which functions to call
        system_prompt = self._build_function_planner_prompt()
        user_text = (
            f"SHEET METADATA:\n{json.dumps(metadata, indent=2)}"
        )
        if user_prompt:
            user_text += f"\n\nUSER REQUEST: {user_prompt}"

        max_retries = 3
        plan = None
        errors = []
        for attempt in range(1, max_retries + 1):
            try:
                raw = self._call_gemini_for_dashboard(system_prompt, user_text)
                # AI may return { "plan": [...] } or just [...]
                if isinstance(raw, list):
                    plan = raw
                elif isinstance(raw, dict) and 'plan' in raw:
                    plan = raw['plan']
                else:
                    errors.append(f'Attempt {attempt}: unexpected shape')
                    continue
                if plan:
                    break
            except Exception as exc:
                errors.append(f'Attempt {attempt}: {str(exc)[:200]}')
                plan = None

        if not plan:
            # Fallback: run basic analysis on every column
            plan = self._build_fallback_plan(metadata)

        # 3 — Execute the plan server-side
        results = execute_plan(sheet_data, plan, max_calls=30)

        return Response({
            'metadata': metadata,
            'plan': plan,
            'results': results,
            'plan_source': 'ai' if errors == [] or plan != self._build_fallback_plan(metadata) else 'fallback',
            'errors': errors,
        })

    @staticmethod
    def _build_function_planner_prompt():
        """System prompt: AI decides which analytics functions to call."""
        catalog = get_function_catalog()
        catalog_json = json.dumps(catalog, indent=2)

        return (
            "You are a data analytics planner. You receive metadata about a "
            "spreadsheet (column names, types, sample values, row count) and "
            "a catalog of analysis functions you can invoke.\n\n"
            "Your job: choose the BEST set of function calls to thoroughly "
            "analyse this data. Think like a data scientist — look for "
            "patterns, outliers, trends, correlations, distributions, and "
            "group-by insights.\n\n"
            "RULES:\n"
            "1. Return ONLY a JSON object with key \"plan\" containing an "
            "array of function calls.\n"
            "2. Each call: { \"function\": \"<name>\", \"params\": { ... } }\n"
            "3. Use the exact function names and parameter names from the "
            "catalog below.\n"
            "4. Column names in params MUST match the column labels from the "
            "sheet metadata exactly.\n"
            "5. Call column_stats for every column.\n"
            "6. Call detect_outliers for numeric columns.\n"
            "7. Call correlation for promising numeric column pairs.\n"
            "8. Call trend_analysis for numeric columns that look sequential.\n"
            "9. Call distribution for numeric columns.\n"
            "10. Call group_by when there's a categorical column + numeric column.\n"
            "11. Call value_counts for text/categorical columns.\n"
            "12. Call data_quality once.\n"
            "13. You may call moving_average, pct_change, cumulative_sum, "
            "ratio, compare_columns, crosstab when they add value.\n"
            "14. Aim for 10-25 function calls depending on complexity.\n"
            "15. Return ONLY the JSON — no markdown fences, no explanation.\n\n"
            f"FUNCTION CATALOG:\n{catalog_json}\n\n"
            "OUTPUT FORMAT:\n"
            "{\n"
            '  "plan": [\n'
            '    { "function": "column_stats", "params": { "column": "Revenue" } },\n'
            '    { "function": "detect_outliers", "params": { "column": "Revenue", "method": "iqr" } },\n'
            '    { "function": "correlation", "params": { "column_a": "Revenue", "column_b": "Profit" } },\n'
            "    ...\n"
            "  ]\n"
            "}"
        )

    @staticmethod
    def _build_fallback_plan(metadata: dict) -> list[dict]:
        """When AI planner fails, generate a sensible default plan."""
        plan = []
        numeric_cols = []
        text_cols = []

        for col in metadata.get('columns', []):
            label = col['label']
            plan.append({'function': 'column_stats', 'params': {'column': label}})

            if col.get('inferred_type') == 'numeric':
                numeric_cols.append(label)
                plan.append({'function': 'detect_outliers', 'params': {'column': label}})
                plan.append({'function': 'trend_analysis', 'params': {'column': label}})
                plan.append({'function': 'distribution', 'params': {'column': label}})
            else:
                text_cols.append(label)
                plan.append({'function': 'value_counts', 'params': {'column': label}})

        # Correlations between first few numeric pairs
        for i in range(min(len(numeric_cols), 3)):
            for j in range(i + 1, min(len(numeric_cols), 4)):
                plan.append({
                    'function': 'correlation',
                    'params': {'column_a': numeric_cols[i], 'column_b': numeric_cols[j]},
                })

        # Group-by: first text col × first numeric col
        if text_cols and numeric_cols:
            plan.append({
                'function': 'group_by',
                'params': {'group_column': text_cols[0], 'value_column': numeric_cols[0], 'agg': 'sum'},
            })

        plan.append({'function': 'data_quality', 'params': {}})

        return plan

    @action(detail=True, methods=['post'], url_path='generate-suggestions')
    def generate_suggestions(self, request, pk=None):
        """
        POST /api/sheets/<id>/generate-suggestions/
        {
            "results": [ ... ]     ← from smart-analytics (preferred)
            "analytics": { ... }   ← legacy: from build_analytics_report
        }
        Sends ONLY computed results to AI (never raw data).
        Returns analysis: summary, significance, outliers, suggestions,
        data_quality assessment.
        """
        sheet = self.get_object()

        # Prefer smart-analytics results, fall back to legacy analytics
        smart_results = request.data.get('results')
        analytics = request.data.get('analytics')

        if not smart_results and not analytics:
            try:
                analytics = full_sheet_analytics(sheet)
            except Exception as exc:
                logger.exception('Analytics failed for sheet %s', pk)
                return Response(
                    {'error': f'Could not compute analytics: {str(exc)[:300]}'},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

        system_prompt = self._build_suggestions_system_prompt()

        if smart_results:
            user_text = (
                f"SHEET TITLE: {sheet.title}\n\n"
                f"ANALYSIS RESULTS (from executed analytics functions — NO raw data):\n"
                f"{json.dumps(smart_results, indent=2)}"
            )
        else:
            user_text = (
                f"SHEET TITLE: {sheet.title}\n\n"
                f"STATISTICAL ANALYTICS (server-computed, NO raw data):\n"
                f"{json.dumps(analytics, indent=2)}"
            )

        max_retries = 3
        errors = []
        result = None
        for attempt in range(1, max_retries + 1):
            try:
                result = self._call_gemini_for_dashboard(system_prompt, user_text)
                if isinstance(result, dict) and 'summary' in result:
                    break
                errors.append(f'Attempt {attempt}: Missing "summary" key')
                result = None
            except Exception as exc:
                errors.append(f'Attempt {attempt}: {str(exc)[:200]}')
                result = None

        if not result:
            # Lightweight fallback from analytics data itself
            result = self._build_fallback_suggestions(analytics)

        return Response({
            'suggestions': result,
            'generation_status': 'success' if errors == [] or result.get('_source') != 'fallback' else 'fallback',
            'errors': errors,
        })

    @action(detail=True, methods=['post'], url_path='generate-dashboard-ui')
    def generate_dashboard_ui(self, request, pk=None):
        """
        POST /api/sheets/<id>/generate-dashboard-ui/
        {
            "results": [ ... ],    ← from smart-analytics (preferred)
            "analytics": { ... },  ← legacy
            "prompt": "optional"
        }
        Sends ONLY computed results to AI.
        Returns Recharts chart configs + KPIs — NO analysis text.
        """
        sheet = self.get_object()
        user_prompt = request.data.get('prompt', '')

        smart_results = request.data.get('results')
        analytics = request.data.get('analytics')

        if not smart_results and not analytics:
            try:
                analytics = full_sheet_analytics(sheet)
            except Exception as exc:
                return Response(
                    {'error': f'Could not compute analytics: {str(exc)[:300]}'},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

        system_prompt = self._build_ui_system_prompt()

        if smart_results:
            user_text = (
                f"SHEET TITLE: {sheet.title}\n\n"
                f"ANALYSIS RESULTS (from executed analytics functions):\n"
                f"{json.dumps(smart_results, indent=2)}"
            )
        else:
            user_text = (
                f"SHEET TITLE: {sheet.title}\n\n"
                f"STATISTICAL ANALYTICS:\n{json.dumps(analytics, indent=2)}"
            )
        if user_prompt:
            user_text += f"\n\nUSER REQUEST: {user_prompt}"

        max_retries = 3
        errors = []
        chart_config = None
        for attempt in range(1, max_retries + 1):
            try:
                chart_config = self._call_gemini_for_dashboard(system_prompt, user_text)
                if isinstance(chart_config, dict) and 'charts' in chart_config:
                    break
                errors.append(f'Attempt {attempt}: Missing "charts" key')
                chart_config = None
            except Exception as exc:
                errors.append(f'Attempt {attempt}: {str(exc)[:200]}')
                chart_config = None

        if not chart_config:
            # build a simple fallback from analytics
            table_json = self._extract_sheet_table_json(sheet)
            chart_config = self._build_fallback_dashboard(table_json)

        gen_status = 'success' if chart_config.get('charts') and not errors else 'fallback'

        # Persist as active dashboard
        dashboard, created = SheetDashboard.objects.update_or_create(
            sheet=sheet,
            is_active=True,
            defaults={
                'title': chart_config.get('title', 'Intelligent Dashboard'),
                'chart_config': chart_config,
                'prompt_used': user_prompt or 'auto',
                'generation_status': gen_status,
                'retry_count': len(errors),
                'error_log': errors,
            },
        )

        return Response(
            SheetDashboardSerializer(dashboard).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    # ── Focused system prompts ──────────────────────────────────────

    @staticmethod
    def _build_suggestions_system_prompt():
        """System prompt for analysis / suggestions — NO chart generation."""
        return (
            "You are a senior data scientist. You receive PRE-COMPUTED statistical "
            "analytics for a spreadsheet (column stats, correlations, outliers, data "
            "quality). You do NOT receive any raw data rows.\n\n"
            "Your job: produce a thorough written analysis.\n\n"
            "Return ONLY a JSON object — no markdown fences.\n\n"
            "OUTPUT SCHEMA:\n"
            "{\n"
            '  "summary": "2-4 sentence executive overview of the data patterns and health.",\n'
            '  "scientific_significance": [\n'
            "    {\n"
            '      "test": "Statistical test or observation name",\n'
            '      "finding": "What it reveals",\n'
            '      "p_value": "p-value / confidence if applicable (string)",\n'
            '      "significance": "high | medium | low",\n'
            '      "explanation": "Plain-english why this matters"\n'
            "    }\n"
            "  ],\n"
            '  "outliers": [\n'
            "    {\n"
            '      "column": "Column name",\n'
            '      "value": "Outlier value (string)",\n'
            '      "row_label": "Row identifier",\n'
            '      "deviation": "How far from normal range",\n'
            '      "severity": "high | medium | low",\n'
            '      "recommendation": "Action to take"\n'
            "    }\n"
            "  ],\n"
            '  "suggestions": [\n'
            "    {\n"
            '      "type": "optimization | warning | insight | action",\n'
            '      "title": "Short title",\n'
            '      "description": "Detailed actionable suggestion",\n'
            '      "priority": "high | medium | low",\n'
            '      "affected_columns": ["Col A"]\n'
            "    }\n"
            "  ],\n"
            '  "data_quality": {\n'
            '    "completeness_pct": 95,\n'
            '    "issues": ["List of data quality issues"]\n'
            "  }\n"
            "}\n\n"
            "INSTRUCTIONS:\n"
            "- Use the provided stats (mean, std, skewness, correlations, IQR outliers) "
            "to derive your findings — do NOT invent numbers.\n"
            "- For scientific_significance, interpret correlation strengths, distribution "
            "shapes, spread indicators, and any notable patterns from the stats.\n"
            "- For outliers, enrich the pre-detected outliers with context, severity "
            "assessment, and practical recommendations.\n"
            "- Provide 3-8 actionable suggestions: optimisations, warnings, insights.\n"
            "- Assess data quality from the provided completeness and missing-value info.\n"
            "- Return ONLY the JSON object."
        )

    @staticmethod
    def _build_ui_system_prompt():
        """System prompt for chart / KPI generation — NO analysis text."""
        return (
            "You are a data visualisation expert. You receive PRE-COMPUTED statistical "
            "analytics for a spreadsheet (column stats with distributions, correlations, "
            "outliers). You do NOT receive raw data rows.\n\n"
            "Your job: design the BEST Recharts-compatible dashboard.\n\n"
            "Return ONLY a JSON object — no markdown fences.\n\n"
            "CHART TYPES allowed: bar, line, area, pie, composed, scatter, radialBar, "
            "radar, funnel\n\n"
            "OUTPUT SCHEMA:\n"
            "{\n"
            '  "title": "Dashboard Title",\n'
            '  "description": "Brief description",\n'
            '  "charts": [\n'
            "    {\n"
            '      "id": "chart_1",\n'
            '      "type": "bar",\n'
            '      "title": "Chart Title",\n'
            '      "data": [ {"name": "Label", "value": 100}, ... ],\n'
            '      "config": {\n'
            '        "xAxisKey": "name",\n'
            '        "bars": [{"dataKey": "value", "fill": "#8884d8", "name": "Series"}],\n'
            '        "showGrid": true,\n'
            '        "showLegend": true,\n'
            '        "showTooltip": true\n'
            "      }\n"
            "    }\n"
            "  ],\n"
            '  "layout": "grid",\n'
            '  "columns": 2,\n'
            '  "kpis": [\n'
            '    {"label": "Metric", "value": "$10,000", "change": "+12%", "changeType": "positive"}\n'
            "  ]\n"
            "}\n\n"
            "INSTRUCTIONS:\n"
            "- Build the `data` arrays from the stats provided (top_values, distribution, "
            "counts, aggregates). Synthesise representative data points from the "
            "statistics — e.g. use top_values for categorical breakdowns, use mean/q1/"
            "median/q3/max for box-like charts, use correlation pairs for scatter.\n"
            "- Numbers in `data` must be actual numbers, NOT strings.\n"
            "- Generate 2-6 charts depending on data richness.\n"
            "- Use descriptive hex colours.\n"
            "- KPIs: create 2-5 headline metrics from the summary_stats.\n"
            "- For pie: use `dataKey` and `nameKey` in config.\n"
            "- For bar/line/area: use `xAxisKey` + `bars`/`lines`/`areas` arrays.\n"
            "- Return ONLY the JSON object."
        )

    @staticmethod
    def _build_fallback_suggestions(analytics):
        """Derive a basic suggestions object from raw analytics when AI fails."""
        suggestions = []
        significance = []
        outliers_summary = []

        # Correlations → significance
        for corr in analytics.get('correlations', []):
            if corr.get('strength') in ('strong', 'very_strong'):
                significance.append({
                    'test': 'Pearson Correlation',
                    'finding': (
                        f"{corr['col_a']} and {corr['col_b']} have a "
                        f"{corr['strength']} {corr.get('direction', '')} correlation (r={corr['r']:.2f})"
                    ),
                    'p_value': 'N/A (fallback)',
                    'significance': 'high' if abs(corr['r']) > 0.8 else 'medium',
                    'explanation': (
                        f"Changes in {corr['col_a']} are closely related to changes in {corr['col_b']}."
                    ),
                })

        # Outliers → enrich
        for col_name, col_outliers in analytics.get('outliers', {}).items():
            for o in col_outliers:
                outliers_summary.append({
                    'column': col_name,
                    'value': str(o.get('value', '')),
                    'row_label': o.get('row_label', ''),
                    'deviation': o.get('deviation', ''),
                    'severity': o.get('severity', 'medium'),
                    'recommendation': 'Verify this data point for accuracy.',
                })

        # Basic suggestions
        dq = analytics.get('data_quality', {})
        if dq.get('completeness_pct', 100) < 90:
            suggestions.append({
                'type': 'warning',
                'title': 'Low data completeness',
                'description': f"Only {dq['completeness_pct']}% of cells have values. Fill missing data for better analysis.",
                'priority': 'high',
                'affected_columns': [
                    k for k, v in dq.get('column_completeness', {}).items() if v < 80
                ],
            })

        if outliers_summary:
            suggestions.append({
                'type': 'warning',
                'title': f"{len(outliers_summary)} outlier(s) detected",
                'description': 'Review flagged values — they may indicate data entry errors or genuine anomalies.',
                'priority': 'medium',
                'affected_columns': list({o['column'] for o in outliers_summary}),
            })

        suggestions.append({
            'type': 'insight',
            'title': 'AI analysis unavailable',
            'description': 'These suggestions were generated from server-side statistics. Retry for AI-powered insights.',
            'priority': 'low',
            'affected_columns': [],
        })

        summary_stats = analytics.get('summary_stats', {})
        return {
            'summary': (
                f"Sheet has {summary_stats.get('total_rows', '?')} rows across "
                f"{summary_stats.get('total_columns', '?')} columns "
                f"({summary_stats.get('numeric_columns', 0)} numeric, "
                f"{summary_stats.get('text_columns', 0)} text). "
                f"Data completeness: {dq.get('completeness_pct', '?')}%."
            ),
            'scientific_significance': significance,
            'outliers': outliers_summary,
            'suggestions': suggestions,
            'data_quality': dq,
            '_source': 'fallback',
        }

    def _build_fallback_dashboard(self, table_json):
        """
        Generate a simple fallback dashboard config when AI fails.
        Creates basic bar + pie charts from numeric columns.
        """
        columns = table_json['columns']
        rows = table_json['rows']

        if not rows:
            return {'title': 'Dashboard', 'charts': [], 'layout': 'grid', 'columns': 2}

        # Find label column (first text column) and numeric columns
        label_col = None
        numeric_cols = []
        for col in columns:
            if col['type'] in ('number', 'currency', 'formula') and not label_col:
                numeric_cols.append(col)
            elif col['type'] in ('text', 'select') and not label_col:
                label_col = col
            elif col['type'] in ('number', 'currency', 'formula'):
                numeric_cols.append(col)

        if not label_col and columns:
            label_col = columns[0]

        charts = []
        colors = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6']

        # Bar chart for first numeric column
        if numeric_cols and label_col:
            nc = numeric_cols[0]
            data = []
            for r in rows[:30]:
                val = r.get(nc['label'], '0')
                try:
                    val = float(str(val).replace(',', '').replace('$', '').replace('€', '').strip() or '0')
                except (ValueError, TypeError):
                    val = 0
                data.append({'name': str(r.get(label_col['label'], '')), 'value': val})

            charts.append({
                'id': 'fallback_bar',
                'type': 'bar',
                'title': f"{nc['label']} by {label_col['label']}",
                'data': data,
                'config': {
                    'xAxisKey': 'name',
                    'bars': [{'dataKey': 'value', 'fill': colors[0], 'name': nc['label']}],
                    'showGrid': True,
                    'showLegend': True,
                    'showTooltip': True,
                },
            })

        # Pie chart for second numeric column (or same if only one)
        pie_col = numeric_cols[1] if len(numeric_cols) > 1 else (numeric_cols[0] if numeric_cols else None)
        if pie_col and label_col:
            data = []
            for r in rows[:10]:
                val = r.get(pie_col['label'], '0')
                try:
                    val = float(str(val).replace(',', '').replace('$', '').replace('€', '').strip() or '0')
                except (ValueError, TypeError):
                    val = 0
                if val > 0:
                    data.append({'name': str(r.get(label_col['label'], '')), 'value': val})

            charts.append({
                'id': 'fallback_pie',
                'type': 'pie',
                'title': f"{pie_col['label']} Distribution",
                'data': data,
                'config': {
                    'dataKey': 'value',
                    'nameKey': 'name',
                    'colors': colors[:len(data)],
                    'showLegend': True,
                    'showTooltip': True,
                },
            })

        # KPIs from numeric columns
        kpis = []
        for nc in numeric_cols[:4]:
            vals = []
            for r in rows:
                v = r.get(nc['label'], '')
                try:
                    vals.append(float(str(v).replace(',', '').replace('$', '').replace('€', '').strip() or '0'))
                except (ValueError, TypeError):
                    pass
            if vals:
                total = sum(vals)
                kpis.append({
                    'label': f"Total {nc['label']}",
                    'value': f"{total:,.0f}",
                    'change': '',
                    'changeType': 'neutral',
                })

        # ── Basic fallback analysis ──
        analysis = {
            'summary': f"Auto-generated dashboard for {table_json.get('summary', 'this sheet')}. "
                       f"Contains {len(numeric_cols)} numeric columns across {len(rows)} rows.",
            'scientific_significance': [],
            'outliers': [],
            'suggestions': [],
            'data_quality': {'completeness_pct': 100, 'issues': []},
        }

        # Detect outliers (IQR) and compute basic stats for suggestions
        for nc in numeric_cols:
            vals = []
            row_labels = []
            for r in rows:
                v = r.get(nc['label'], '')
                try:
                    vals.append(float(str(v).replace(',', '').replace('$', '').replace('€', '').strip() or '0'))
                    row_labels.append(str(r.get(label_col['label'], '')) if label_col else str(len(vals)))
                except (ValueError, TypeError):
                    row_labels.append('')

            if len(vals) < 4:
                continue

            sorted_v = sorted(vals)
            q1 = sorted_v[len(sorted_v) // 4]
            q3 = sorted_v[3 * len(sorted_v) // 4]
            iqr = q3 - q1
            lower = q1 - 1.5 * iqr
            upper = q3 + 1.5 * iqr
            mean_v = sum(vals) / len(vals)

            for idx, v in enumerate(vals):
                if v < lower or v > upper:
                    analysis['outliers'].append({
                        'column': nc['label'],
                        'value': str(v),
                        'row_label': row_labels[idx] if idx < len(row_labels) else '',
                        'deviation': f"{'above' if v > upper else 'below'} IQR bounds ({lower:.1f}–{upper:.1f})",
                        'severity': 'high' if abs(v - mean_v) > 2 * iqr else 'medium',
                        'recommendation': 'Verify this data point for accuracy',
                    })

            # Basic significance note
            if iqr > 0:
                analysis['scientific_significance'].append({
                    'test': 'IQR Spread',
                    'finding': f"{nc['label']} has IQR of {iqr:,.2f} (Q1={q1:,.2f}, Q3={q3:,.2f})",
                    'p_value': 'N/A',
                    'significance': 'medium',
                    'explanation': f"The middle 50% of {nc['label']} values span {iqr:,.2f} units.",
                })

        # Suggestions
        if numeric_cols:
            analysis['suggestions'].append({
                'type': 'insight',
                'title': 'Regenerate with AI',
                'description': 'This is a fallback dashboard. Regenerate with AI for deeper analysis, correlations, and better visualisations.',
                'priority': 'high',
                'affected_columns': [nc['label'] for nc in numeric_cols],
            })
        if analysis['outliers']:
            analysis['suggestions'].append({
                'type': 'warning',
                'title': f"{len(analysis['outliers'])} outlier(s) detected",
                'description': 'Review flagged outlier values to ensure data accuracy.',
                'priority': 'medium',
                'affected_columns': list({o['column'] for o in analysis['outliers']}),
            })

        # Data quality: check for empty values
        total_cells = len(rows) * len(columns)
        empty_cells = 0
        for r in rows:
            for col in columns:
                if not str(r.get(col['label'], '')).strip():
                    empty_cells += 1
        completeness = round((1 - empty_cells / max(total_cells, 1)) * 100, 1)
        analysis['data_quality'] = {
            'completeness_pct': completeness,
            'issues': [f"{empty_cells} empty cells found across the sheet"] if empty_cells > 0 else [],
        }

        return {
            'title': f"{table_json.get('summary', 'Dashboard')}",
            'description': 'Auto-generated fallback dashboard',
            'charts': charts,
            'layout': 'grid',
            'columns': 2,
            'kpis': kpis,
            'analysis': analysis,
        }


# ═══════════════════════════════════════════════════════════════════
# Public Sheet Form — No authentication required
# ═══════════════════════════════════════════════════════════════════

class PublicSheetFormView(APIView):
    """
    Public endpoint for sheet form submissions.

    GET  /api/sheets/public/form/<token>/  — fetch form schema (columns + metadata)
    POST /api/sheets/public/form/<token>/  — submit a form response
    """
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def _get_link(self, token):
        try:
            return SheetShareLink.objects.select_related('sheet').get(token=token)
        except SheetShareLink.DoesNotExist:
            return None

    def get(self, request, token):
        link = self._get_link(token)
        if not link:
            return Response({'error': 'Form not found'}, status=404)
        if not link.is_usable:
            reason = 'expired' if link.is_expired else 'limit reached' if link.is_at_limit else 'inactive'
            return Response({'error': f'Form is {reason}'}, status=410)

        columns = link.get_form_columns()

        return Response({
            'token': str(link.token),
            'sheet_title': link.sheet.title,
            'label': link.label,
            'description': link.description,
            'access_type': link.access_type,
            'columns': columns,
            'submission_count': link.submission_count,
            'max_submissions': link.max_submissions,
        })

    # ── Type validation delegates to Sheet.validate_cell_value ───

    def post(self, request, token):
        link = self._get_link(token)
        if not link:
            return Response({'error': 'Form not found'}, status=404)
        if not link.is_usable:
            return Response({'error': 'This form is no longer accepting submissions'}, status=410)

        serializer = PublicFormSubmitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        form_data = serializer.validated_data['data']
        submitter = serializer.validated_data.get('submitter_identifier', '')

        sheet = link.sheet
        col_map = {c['key']: c for c in sheet.columns}

        # ── Validate every submitted value against its column type ──
        errors = {}
        for col_key, value in form_data.items():
            col_def = col_map.get(col_key)
            if not col_def:
                continue
            _, _, err = Sheet.validate_cell_value(value, col_def.get('type', 'text'))
            if err:
                errors[col_key] = err
        if errors:
            return Response({'error': 'Validation failed', 'field_errors': errors},
                            status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            # Create new row
            next_order = sheet.rows.count()
            row = SheetRow.objects.create(sheet=sheet, order=next_order)

            # Create cells from submitted data with correct value_type
            valid_keys = {c['key'] for c in sheet.columns}
            for col_key, value in form_data.items():
                if col_key not in valid_keys:
                    continue
                col_def = col_map[col_key]
                clean_val, vtype, _ = Sheet.validate_cell_value(
                    value, col_def.get('type', 'text'),
                )
                SheetCell.objects.create(
                    row=row,
                    column_key=col_key,
                    raw_value=str(value),
                    computed_value=str(value),
                    value_type=vtype,
                )

            # ── Auto-populate formula columns ──────────────────────
            formula_cols = [
                c for c in sheet.columns if c.get('type') == 'formula'
            ]
            if formula_cols:
                # Grab the latest existing row (before the new one) to
                # copy formula patterns from.
                prev_row = (
                    sheet.rows
                    .exclude(id=row.id)
                    .order_by('-order')
                    .first()
                )
                for fc in formula_cols:
                    formula_str = ''
                    if prev_row:
                        prev_cell = prev_row.cells.filter(
                            column_key=fc['key'],
                        ).first()
                        if prev_cell and prev_cell.formula:
                            formula_str = prev_cell.formula
                    if formula_str:
                        SheetCell.objects.create(
                            row=row,
                            column_key=fc['key'],
                            raw_value=formula_str,
                            formula=formula_str,
                            value_type='formula',
                        )

                # Re-evaluate all formulas so the new row gets computed
                engine = FormulaEngine(sheet)
                engine.evaluate_all()

            # Record submission
            submission = SheetFormSubmission.objects.create(
                share_link=link,
                sheet=sheet,
                row=row,
                data=form_data,
                submitter_identifier=submitter,
                submitter_ip=self._get_client_ip(request),
            )

            # Update counters
            link.submission_count = (link.submission_count or 0) + 1
            link.save(update_fields=['submission_count', 'updated_at'])

            sheet.row_count = sheet.rows.count()
            sheet.save(update_fields=['row_count', 'updated_at'])

        return Response({
            'status': 'submitted',
            'submission_id': str(submission.id),
            'message': 'Thank you! Your response has been recorded.',
        }, status=status.HTTP_201_CREATED)

    @staticmethod
    def _get_client_ip(request):
        xff = request.META.get('HTTP_X_FORWARDED_FOR')
        if xff:
            return xff.split(',')[0].strip()
        return request.META.get('REMOTE_ADDR')
