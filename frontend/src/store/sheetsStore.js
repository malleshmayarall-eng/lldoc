/**
 * Sheets Store — Zustand
 *
 * Central state management for the spreadsheet feature.
 */

import { create } from 'zustand';
import { sheetsService } from '../services/sheetsService';
import { SpreadsheetEngine } from '../utils/SpreadsheetEngine';

// ── Client-side type validation (mirrors Sheet.validate_cell_value) ──

const DATE_RE = /^\d{4}-\d{2}-\d{2}$|^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/;
const BOOL_VALS = new Set(['true', 'false', '1', '0', 'yes', 'no']);

/**
 * Validate `rawValue` against a column `colType`.
 * Returns { value: string, type: string, error: string|null }
 */
export function validateCellValue(rawValue, colType) {
  const raw = String(rawValue ?? '').trim();
  if (!raw) return { value: '', type: colType === 'formula' ? 'text' : colType, error: null };

  switch (colType) {
    case 'number':
    case 'currency': {
      const cleaned = raw.replace(/[,$€£₹¥\s]/g, '');
      if (isNaN(Number(cleaned))) return { value: raw, type: 'error', error: `Expected a number but got "${raw}"` };
      return { value: raw, type: 'number', error: null };
    }
    case 'date':
      if (!DATE_RE.test(raw)) return { value: raw, type: 'error', error: `Expected a date (YYYY-MM-DD) but got "${raw}"` };
      return { value: raw, type: 'date', error: null };
    case 'boolean':
      if (!BOOL_VALS.has(raw.toLowerCase())) return { value: raw, type: 'error', error: `Expected true/false but got "${raw}"` };
      return { value: raw, type: 'boolean', error: null };
    case 'json':
      try { JSON.parse(raw); } catch { return { value: raw, type: 'error', error: `Invalid JSON: "${raw.slice(0, 40)}"` }; }
      return { value: raw, type: 'json', error: null };
    case 'formula':
      return { value: raw, type: 'formula', error: null };
    default:
      return { value: raw, type: colType || 'text', error: null };
  }
}

const useSheetsStore = create((set, get) => ({
  // ── State ────────────────────────────────────────────────────────
  sheets: [],
  currentSheet: null,
  cellValues: {},        // { "rowIdx_colKey": rawValue }
  computedValues: {},    // { "rowIdx_colKey": computedValue }
  cellErrors: {},        // { "rowIdx_colKey": errorMsg }
  selectedCell: null,    // { row, col, colKey }
  selectedRange: null,   // { startRow, startCol, endRow, endCol }
  editingCell: null,     // { row, colKey }
  formulaBarValue: '',
  clipboard: null,       // { cells: [...], type: 'copy' | 'cut' }
  undoStack: [],
  redoStack: [],
  loading: false,
  saving: false,
  error: null,
  searchQuery: '',

  // ── Pagination state ─────────────────────────────────────────────
  pagination: null,      // { page, pageSize, totalRows, totalPages, hasNext, hasPrevious }
  loadingMore: false,

  // ── Enterprise server-side sort / filter / scroll ────────────────
  serverSort: null,         // { colKey, direction } or null
  serverFilters: {},        // { col_key: search_text, ... }
  serverSearch: '',         // global text search
  scrollToTarget: null,     // { rowOrder, colKey } — pending scroll target

  // ── Sheet CRUD ───────────────────────────────────────────────────

  fetchSheets: async () => {
    set({ loading: true, error: null });
    try {
      const res = await sheetsService.list();
      set({ sheets: res.data, loading: false });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  fetchSheet: async (id) => {
    set({ loading: true, error: null });
    try {
      const res = await sheetsService.get(id);
      const sheet = res.data;

      // Build cellValues map from rows + cells
      const cellValues = {};
      const computedValues = {};
      for (const row of (sheet.rows || [])) {
        for (const cell of (row.cells || [])) {
          const key = `${row.order}_${cell.column_key}`;
          cellValues[key] = cell.raw_value;
          computedValues[key] = cell.computed_value || cell.raw_value;
        }
      }

      set({
        currentSheet: sheet,
        cellValues,
        computedValues,
        cellErrors: {},
        loading: false,
        selectedCell: null,
        editingCell: null,
      });

      // Run client-side formula evaluation
      get().recomputeFormulas();
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  /**
   * Paginated fetch — single API call to get sheet metadata + first page of rows.
   * Supports enterprise server-side sort/filter/search.
   */
  fetchSheetPaginated: async (id, pageSize = 100, opts = {}) => {
    set({ loading: true, error: null, pagination: null });
    try {
      // Build enterprise params from store state or explicit opts
      const { serverSort, serverFilters, serverSearch: sSearch } = get();
      const rowsOpts = {
        sortBy: opts.sortBy ?? serverSort?.colKey ?? undefined,
        sortDir: opts.sortDir ?? serverSort?.direction ?? undefined,
        filters: opts.filters ?? serverFilters,
        search: opts.search ?? sSearch ?? undefined,
        rowOrder: opts.rowOrder ?? undefined,
      };

      // Single call — paginated_rows now returns sheet metadata + rows
      const rowsRes = await sheetsService.getRows(id, opts.page || 1, pageSize, rowsOpts);
      const { sheet: sheetMeta, rows, page, page_size, total_rows, total_pages,
              has_next, has_previous, target_row_order, target_index_in_page } = rowsRes.data;

      // Build cellValues map from rows
      const cellValues = {};
      const computedValues = {};
      for (const row of (rows || [])) {
        for (const cell of (row.cells || [])) {
          const key = `${row.order}_${cell.column_key}`;
          cellValues[key] = cell.raw_value;
          computedValues[key] = cell.computed_value || cell.raw_value;
        }
      }

      const scrollTarget = target_row_order != null ? {
        rowOrder: target_row_order,
        indexInPage: target_index_in_page,
        colKey: opts.colKey || null,
      } : null;

      // Merge sheet metadata with rows
      const currentSheet = {
        ...(sheetMeta || {}),
        rows,
        row_count: total_rows,
        col_count: sheetMeta?.col_count || (sheetMeta?.columns || []).length,
      };

      set({
        currentSheet,
        cellValues,
        computedValues,
        cellErrors: {},
        loading: false,
        selectedCell: null,
        editingCell: null,
        pagination: {
          page,
          pageSize: page_size,
          totalRows: total_rows,
          totalPages: total_pages,
          hasNext: has_next,
          hasPrevious: has_previous,
        },
        scrollToTarget: scrollTarget,
      });

      get().recomputeFormulas();
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  /**
   * Load next page of rows and merge into existing state.
   * Carries enterprise sort/filter state forward.
   */
  loadMoreRows: async () => {
    const { currentSheet, pagination, loadingMore, serverSort, serverFilters, serverSearch } = get();
    if (!currentSheet || !pagination || !pagination.hasNext || loadingMore) return;

    set({ loadingMore: true });
    try {
      const nextPage = pagination.page + 1;
      const rowsOpts = {
        sortBy: serverSort?.colKey ?? undefined,
        sortDir: serverSort?.direction ?? undefined,
        filters: Object.keys(serverFilters).length ? serverFilters : undefined,
        search: serverSearch || undefined,
      };
      const res = await sheetsService.getRows(currentSheet.id, nextPage, pagination.pageSize, rowsOpts);
      const { rows, page, total_rows, total_pages, has_next, has_previous } = res.data;

      // Merge new rows into cellValues / computedValues
      const newCellValues = { ...get().cellValues };
      const newComputedValues = { ...get().computedValues };
      for (const row of (rows || [])) {
        for (const cell of (row.cells || [])) {
          const key = `${row.order}_${cell.column_key}`;
          newCellValues[key] = cell.raw_value;
          newComputedValues[key] = cell.computed_value || cell.raw_value;
        }
      }

      // Merge rows into currentSheet.rows
      const existingRows = currentSheet.rows || [];
      const mergedRows = [...existingRows, ...rows];

      set({
        currentSheet: { ...currentSheet, rows: mergedRows },
        cellValues: newCellValues,
        computedValues: newComputedValues,
        loadingMore: false,
        pagination: {
          ...pagination,
          page,
          totalRows: total_rows,
          totalPages: total_pages,
          hasNext: has_next,
          hasPrevious: has_previous,
        },
      });

      get().recomputeFormulas();
    } catch (err) {
      set({ error: err.message, loadingMore: false });
    }
  },

  // ── Enterprise Sort / Filter / Search Actions ─────────────────────────

  /**
   * Server-side sort — triggers re-fetch from page 1 with new sort params.
   * @param {string|null} colKey  — column to sort by (null = clear sort)
   * @param {'asc'|'desc'} direction
   */
  setServerSort: (colKey, direction = 'asc') => {
    const { currentSheet, pagination } = get();
    const sort = colKey ? { colKey, direction } : null;
    set({ serverSort: sort, scrollToTarget: null });
    if (currentSheet) {
      get().fetchSheetPaginated(currentSheet.id, pagination?.pageSize || 100, {
        sortBy: sort?.colKey,
        sortDir: sort?.direction,
      });
    }
  },

  /**
   * Server-side column filter — adds/updates a filter for one column.
   * Pass empty string to clear a single column filter.
   */
  setServerFilter: (colKey, value) => {
    const { currentSheet, pagination, serverFilters } = get();
    const updated = { ...serverFilters };
    if (!value && value !== 0) {
      delete updated[colKey];
    } else {
      updated[colKey] = value;
    }
    set({ serverFilters: updated, scrollToTarget: null });
    if (currentSheet) {
      get().fetchSheetPaginated(currentSheet.id, pagination?.pageSize || 100, {
        filters: Object.keys(updated).length ? updated : undefined,
      });
    }
  },

  clearServerFilters: () => {
    const { currentSheet, pagination } = get();
    set({ serverFilters: {}, scrollToTarget: null });
    if (currentSheet) {
      get().fetchSheetPaginated(currentSheet.id, pagination?.pageSize || 100);
    }
  },

  /**
   * Server-side global search — triggers re-fetch with search term.
   */
  setServerSearch: (query) => {
    const { currentSheet, pagination } = get();
    set({ serverSearch: query || '', scrollToTarget: null });
    if (currentSheet) {
      get().fetchSheetPaginated(currentSheet.id, pagination?.pageSize || 100, {
        search: query || undefined,
      });
    }
  },

  /**
   * Scroll to a specific row by row_order.
   * Calls the backend with `row_order` param so it returns the page
   * containing that row, plus the index within the page.
   */
  scrollToRow: async (rowOrder, colKey = null) => {
    const { currentSheet, pagination } = get();
    if (!currentSheet) return;
    try {
      await get().fetchSheetPaginated(currentSheet.id, pagination?.pageSize || 100, {
        rowOrder: rowOrder,
        colKey: colKey,
      });
    } catch (err) {
      console.error('scrollToRow failed:', err);
    }
  },

  clearScrollTarget: () => set({ scrollToTarget: null }),

  createSheet: async (data) => {
    set({ loading: true });
    try {
      const res = await sheetsService.create(data);
      const sheets = [res.data, ...get().sheets];
      set({ sheets, loading: false });
      return res.data;
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  deleteSheet: async (id) => {
    try {
      await sheetsService.delete(id);
      set({ sheets: get().sheets.filter((s) => s.id !== id) });
    } catch (err) {
      set({ error: err.message });
    }
  },

  updateSheetTitle: async (id, title) => {
    try {
      await sheetsService.update(id, { title });
      set((state) => ({
        currentSheet: state.currentSheet ? { ...state.currentSheet, title } : null,
        sheets: state.sheets.map((s) => (s.id === id ? { ...s, title } : s)),
      }));
    } catch (err) {
      set({ error: err.message });
    }
  },

  // ── Cell operations ──────────────────────────────────────────────

  setCellValue: (rowIdx, colKey, rawValue) => {
    // Block manual edits on formula-column cells
    const { currentSheet } = get();
    const colDef = (currentSheet?.columns || []).find((c) => c.key === colKey);
    if (colDef?.formula) return; // column-level formula — read only

    const key = `${rowIdx}_${colKey}`;
    const prevValues = { ...get().cellValues };

    // ── Validate against column type ──
    const colType = colDef?.type || 'text';
    const isFormula = String(rawValue ?? '').startsWith('=');
    const newErrors = { ...get().cellErrors };
    if (!isFormula && rawValue !== '' && rawValue != null) {
      const { error } = validateCellValue(rawValue, colType);
      if (error) {
        newErrors[key] = error;
      } else {
        delete newErrors[key];
      }
    } else {
      delete newErrors[key];
    }

    // Push to undo stack
    const undoStack = [...get().undoStack, { cellValues: prevValues }];
    if (undoStack.length > 50) undoStack.shift();

    set((state) => ({
      cellValues: { ...state.cellValues, [key]: rawValue },
      cellErrors: newErrors,
      undoStack,
      redoStack: [],
    }));

    // Recompute formulas
    get().recomputeFormulas();
  },

  recomputeFormulas: () => {
    const { currentSheet, cellValues } = get();
    if (!currentSheet) return;

    const rowCount = currentSheet.row_count || 0;
    const engine = new SpreadsheetEngine(currentSheet.columns, cellValues);
    const computed = engine.evaluateAll(rowCount);
    const computedObj = {};
    for (const [k, v] of computed.entries()) {
      computedObj[k] = v;
    }

    // Also add non-formula values
    for (const [k, v] of Object.entries(cellValues)) {
      if (!v?.startsWith?.('=')) {
        computedObj[k] = v;
      }
    }

    // Sync any column-level formula cells injected by the engine back into cellValues
    const colFormulaCols = (currentSheet.columns || []).filter((c) => c.formula);
    if (colFormulaCols.length > 0) {
      const updated = { ...cellValues };
      for (const col of colFormulaCols) {
        const template = col.formula.startsWith('=') ? col.formula : `=${col.formula}`;
        for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
          const expanded = template.replace(/\{row\}/gi, String(rowIdx + 1));
          updated[`${rowIdx}_${col.key}`] = expanded;
        }
      }
      set({ computedValues: computedObj, cellValues: updated });
    } else {
      set({ computedValues: computedObj });
    }
  },

  // ── Save to server ───────────────────────────────────────────────

  saveAllCells: async () => {
    const { currentSheet, cellValues } = get();
    if (!currentSheet) return;

    // Build set of formula-column keys — server manages these via apply_column_formulas
    const formulaColKeys = new Set(
      (currentSheet.columns || []).filter((c) => c.formula).map((c) => c.key)
    );

    set({ saving: true });
    try {
      const cells = [];
      for (const [key, rawValue] of Object.entries(cellValues)) {
        const underscoreIdx = key.indexOf('_');
        const rowOrder = parseInt(key.substring(0, underscoreIdx));
        const columnKey = key.substring(underscoreIdx + 1);
        if (formulaColKeys.has(columnKey)) continue; // skip formula-column cells
        if (rawValue !== '' && rawValue !== null && rawValue !== undefined) {
          cells.push({ row_order: rowOrder, column_key: columnKey, raw_value: String(rawValue) });
        }
      }

      if (cells.length > 0) {
        const res = await sheetsService.bulkUpdate(currentSheet.id, cells);
        // Update computed values from server response
        const newComputed = {};
        for (const row of (res.data.rows || [])) {
          for (const cell of (row.cells || [])) {
            newComputed[`${row.order}_${cell.column_key}`] = cell.computed_value || cell.raw_value;
          }
        }
        // Merge server-reported type errors into cellErrors
        const serverErrors = res.data.type_errors || {};
        const newCellErrors = {};
        for (const [errKey, errMsg] of Object.entries(serverErrors)) {
          newCellErrors[errKey] = errMsg;
        }
        set({
          computedValues: { ...get().computedValues, ...newComputed },
          cellErrors: newCellErrors,
        });
      }

      set({ saving: false });
    } catch (err) {
      set({ error: err.message, saving: false });
    }
  },

  // ── Selection ────────────────────────────────────────────────────

  selectCell: (row, col, colKey) => {
    const { cellValues } = get();
    const key = `${row}_${colKey}`;
    set({
      selectedCell: { row, col, colKey },
      formulaBarValue: cellValues[key] || '',
      selectedRange: null,
    });
  },

  setSelectedRange: (range) => set({ selectedRange: range }),

  startEditing: (row, colKey) => {
    const { cellValues } = get();
    const key = `${row}_${colKey}`;
    set({
      editingCell: { row, colKey },
      formulaBarValue: cellValues[key] || '',
    });
  },

  stopEditing: () => set({ editingCell: null }),

  setFormulaBarValue: (value) => set({ formulaBarValue: value }),

  // ── Row / Column management ──────────────────────────────────────

  addRow: async () => {
    const { currentSheet, pagination } = get();
    if (!currentSheet) return;
    try {
      // Always append at the end. Send -1 when the sheet is empty so the
      // backend computes new_order = max(0, -1 + 1) = 0 (first row).
      const totalRows = currentSheet.row_count ?? (currentSheet.rows?.length ?? 0);
      const afterOrder = totalRows > 0 ? totalRows - 1 : -1;
      await sheetsService.addRow(currentSheet.id, afterOrder);

      // Re-fetch: if the sheet is in paginated mode jump to the last page so
      // the newly created row is visible; otherwise use the simple full fetch.
      if (pagination) {
        const pageSize = pagination.pageSize || 100;
        // Total rows after insert is totalRows + 1; last page = ceil / pageSize
        const newTotal = totalRows + 1;
        const lastPage = Math.ceil(newTotal / pageSize);
        await get().fetchSheetPaginated(currentSheet.id, pageSize, { page: lastPage });
      } else {
        await get().fetchSheet(currentSheet.id);
      }
    } catch (err) {
      set({ error: err.message });
    }
  },

  deleteRow: async (rowOrder) => {
    const { currentSheet } = get();
    if (!currentSheet) return;
    try {
      await sheetsService.deleteRow(currentSheet.id, rowOrder);
      await get().fetchSheet(currentSheet.id);
    } catch (err) {
      set({ error: err.message });
    }
  },

  addColumn: async (label, type) => {
    const { currentSheet } = get();
    if (!currentSheet) return;
    try {
      await sheetsService.addColumn(currentSheet.id, { label, type });
      await get().fetchSheet(currentSheet.id);
    } catch (err) {
      set({ error: err.message });
    }
  },

  deleteColumn: async (colKey) => {
    const { currentSheet } = get();
    if (!currentSheet) return;
    try {
      await sheetsService.deleteColumn(currentSheet.id, colKey);
      await get().fetchSheet(currentSheet.id);
    } catch (err) {
      set({ error: err.message });
    }
  },

  updateColumns: async (columns) => {
    const { currentSheet } = get();
    if (!currentSheet) return;
    try {
      await sheetsService.updateColumns(currentSheet.id, columns);
      // Refetch to pick up server-side formula evaluation & propagated cells
      await get().fetchSheet(currentSheet.id);
    } catch (err) {
      set({ error: err.message });
    }
  },

  // ── Undo / Redo ──────────────────────────────────────────────────

  undo: () => {
    const { undoStack, cellValues } = get();
    if (undoStack.length === 0) return;

    const prev = undoStack[undoStack.length - 1];
    set({
      cellValues: prev.cellValues,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...get().redoStack, { cellValues }],
    });
    get().recomputeFormulas();
  },

  redo: () => {
    const { redoStack, cellValues } = get();
    if (redoStack.length === 0) return;

    const next = redoStack[redoStack.length - 1];
    set({
      cellValues: next.cellValues,
      redoStack: redoStack.slice(0, -1),
      undoStack: [...get().undoStack, { cellValues }],
    });
    get().recomputeFormulas();
  },

  // ── Copy / Paste ─────────────────────────────────────────────────

  copySelection: () => {
    const { selectedCell, selectedRange, cellValues } = get();
    if (!selectedCell) return;

    if (selectedRange) {
      const cells = [];
      for (let r = selectedRange.startRow; r <= selectedRange.endRow; r++) {
        const row = [];
        for (let c = selectedRange.startCol; c <= selectedRange.endCol; c++) {
          const colKey = get().currentSheet?.columns[c]?.key;
          row.push({ row: r, colKey, value: cellValues[`${r}_${colKey}`] || '' });
        }
        cells.push(row);
      }
      set({ clipboard: { cells, type: 'copy' } });
    } else {
      set({
        clipboard: {
          cells: [[{
            row: selectedCell.row,
            colKey: selectedCell.colKey,
            value: cellValues[`${selectedCell.row}_${selectedCell.colKey}`] || '',
          }]],
          type: 'copy',
        },
      });
    }
  },

  pasteSelection: () => {
    const { selectedCell, clipboard } = get();
    if (!selectedCell || !clipboard) return;

    const startRow = selectedCell.row;
    const startCol = selectedCell.col;

    for (let r = 0; r < clipboard.cells.length; r++) {
      for (let c = 0; c < clipboard.cells[r].length; c++) {
        const targetRow = startRow + r;
        const targetCol = startCol + c;
        const colKey = get().currentSheet?.columns[targetCol]?.key;
        if (colKey) {
          get().setCellValue(targetRow, colKey, clipboard.cells[r][c].value);
        }
      }
    }
  },

  // ── Search ───────────────────────────────────────────────────────
  setSearchQuery: (q) => set({ searchQuery: q }),

  // ── Server-side search ───────────────────────────────────────────
  searchResults: null,
  searchLoading: false,

  executeSearch: async (params) => {
    const { currentSheet } = get();
    if (!currentSheet) return;
    set({ searchLoading: true });
    try {
      const res = await sheetsService.search(currentSheet.id, params);
      set({ searchResults: res.data, searchLoading: false });
      return res.data;
    } catch (err) {
      set({ error: err.message, searchLoading: false });
    }
  },

  clearSearchResults: () => set({ searchResults: null }),

  // ── Server-side formula evaluation (async) ───────────────────────
  formulaTask: null,

  evaluateFormulasOnServer: async () => {
    const { currentSheet } = get();
    if (!currentSheet) return null;
    try {
      const res = await sheetsService.evaluateFormulas(currentSheet.id);
      const data = res.data;
      if (data.task_id) {
        // Async — store task info for polling
        set({ formulaTask: { id: data.task_id, status: 'running', progress: 0 } });
        return { async: true, taskId: data.task_id };
      }
      // Synchronous — update computed values from response
      if (data.rows) {
        const newComputed = { ...get().computedValues };
        for (const row of data.rows) {
          for (const cell of (row.cells || [])) {
            newComputed[`${row.order}_${cell.column_key}`] = cell.computed_value || cell.raw_value;
          }
        }
        set({ computedValues: newComputed, formulaTask: null });
      }
      return { async: false, evaluated: data.evaluated };
    } catch (err) {
      set({ error: err.message });
      return null;
    }
  },

  updateFormulaTask: (taskData) => set({ formulaTask: taskData }),
  clearFormulaTask: () => set({ formulaTask: null }),

  // ── AI Generate ──────────────────────────────────────────────────

  aiGenerateSheet: async (prompt, rowCount, colCount) => {
    set({ loading: true });
    try {
      const res = await sheetsService.aiGenerate(prompt, rowCount, colCount);
      const sheet = res.data;
      const sheets = [sheet, ...get().sheets];
      set({ sheets, loading: false });
      return sheet;
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  // ── Reset ────────────────────────────────────────────────────────

  reset: () => set({
    currentSheet: null,
    cellValues: {},
    computedValues: {},
    selectedCell: null,
    selectedRange: null,
    editingCell: null,
    formulaBarValue: '',
    clipboard: null,
    undoStack: [],
    redoStack: [],
    error: null,
    pagination: null,
    loadingMore: false,
  }),
}));

export default useSheetsStore;
