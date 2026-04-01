/**
 * Sheets API service
 *
 * CRUD + actions for the spreadsheet system.
 * Base URL: /api/sheets/
 */

import api from './api';

const BASE = '/sheets';

export const sheetsService = {
  // ── CRUD ──────────────────────────────────────────────────────────

  list: () => api.get(BASE + '/'),
  get: (id) => api.get(`${BASE}/${id}/`),
  create: (data) => api.post(BASE + '/', data),
  update: (id, data) => api.patch(`${BASE}/${id}/`, data),
  delete: (id) => api.delete(`${BASE}/${id}/`),

  // ── Cell operations ───────────────────────────────────────────────

  bulkUpdate: (id, cells) =>
    api.post(`${BASE}/${id}/bulk-update/`, { cells }),

  evaluate: (id) =>
    api.post(`${BASE}/${id}/evaluate/`),

  // ── Row operations ────────────────────────────────────────────────

  addRow: (id, afterOrder) =>
    api.post(`${BASE}/${id}/add-row/`, { after_order: afterOrder }),

  addRows: (id, count) =>
    api.post(`${BASE}/${id}/add-rows/`, { count }),

  deleteRow: (id, rowOrder) =>
    api.post(`${BASE}/${id}/delete-row/`, { row_order: rowOrder }),

  // ── Column operations ─────────────────────────────────────────────

  addColumn: (id, { label, type = 'text', width = 120, formula } = {}) => {
    const payload = { label, type, width };
    if (formula) payload.formula = formula;
    return api.post(`${BASE}/${id}/add-column/`, payload);
  },

  deleteColumn: (id, columnKey) =>
    api.post(`${BASE}/${id}/delete-column/`, { column_key: columnKey }),

  updateColumns: (id, columns) =>
    api.patch(`${BASE}/${id}/update-columns/`, { columns }),

  // ── AI generation ─────────────────────────────────────────────────

  aiGenerate: (prompt, rowCount = 10, colCount = 5) =>
    api.post(`${BASE}/ai-generate/`, {
      prompt,
      row_count: rowCount,
      col_count: colCount,
    }),

  // ── AI edit (Gemini-powered) ──────────────────────────────────────

  /** Propose AI edits on an existing sheet (returns changes, not saved). */
  aiEdit: (id, prompt, conversationHistory = []) =>
    api.post(`${BASE}/${id}/ai-edit/`, {
      prompt,
      conversation_history: conversationHistory,
    }),

  /** Apply approved AI changes to the sheet. */
  aiApply: (id, changes, newColumns = []) =>
    api.post(`${BASE}/${id}/ai-apply/`, {
      changes,
      new_columns: newColumns,
    }),

  // ── Workflow integration ──────────────────────────────────────────

  importWorkflow: (id, workflowId, includeInputs = true, includeOutputs = true) =>
    api.post(`${BASE}/${id}/import-workflow/`, {
      workflow_id: workflowId,
      include_inputs: includeInputs,
      include_outputs: includeOutputs,
    }),

  // ── Document table import ───────────────────────────────────────

  listDocumentTables: (search = '') =>
    api.get(`${BASE}/list-document-tables/`, { params: { search } }),

  importDocumentTable: (sheetId, tableId, append = false) =>
    api.post(`${BASE}/${sheetId}/import-document-table/`, {
      table_id: tableId,
      append,
    }),

  // ── LaTeX table import ──────────────────────────────────────────

  listLatexTables: (search = '') =>
    api.get(`${BASE}/list-latex-tables/`, { params: { search } }),

  importLatexTable: (sheetId, { sourceType, sourceId, tableIndex = 0, append = false }) =>
    api.post(`${BASE}/${sheetId}/import-latex-table/`, {
      source_type: sourceType,
      source_id: sourceId,
      table_index: tableIndex,
      append,
    }),

  // ── Utilities ─────────────────────────────────────────────────────

  duplicate: (id) => api.post(`${BASE}/${id}/duplicate/`),
  exportMetadata: (id) => api.get(`${BASE}/${id}/export-metadata/`),
  cleanEmptyRows: (id) => api.post(`${BASE}/${id}/clean-empty-rows/`),

  // ── Row-level workflow reconciliation ──────────────────────────────

  /** Check for rows with unprocessed changes (hash mismatch). */
  reconcilePendingCheck: (id) =>
    api.get(`${BASE}/${id}/reconcile-pending/`),

  /** Re-trigger workflows for all rows with unprocessed changes. */
  reconcilePendingTrigger: (id) =>
    api.post(`${BASE}/${id}/reconcile-pending/`),

  // ── Unique Columns (workflow dedup) ───────────────────────────────

  /**
   * Get the sheet's unique-column config (used by CLM upsert logic).
   * Returns { unique_columns, labels, available_columns }.
   */
  getUniqueColumns: (id) =>
    api.get(`${BASE}/${id}/unique-columns/`),

  /**
   * Set which columns form the composite unique key for workflow dedup.
   * @param {string[]} columns - array of column keys, e.g. ['col_0', 'col_2']
   */
  setUniqueColumns: (id, columns) =>
    api.patch(`${BASE}/${id}/unique-columns/`, { unique_columns: columns }),

  // ── Paginated rows (scrollable / infinite-scroll) ─────────────────

  /**
   * Enterprise paginated rows with server-side sort, filter, row-order lookup.
   * @param {object} opts - { page, pageSize, sortBy, sortDir, filters, search, rowOrder }
   */
  getRows: (id, page = 1, pageSize = 100, opts = {}) => {
    const params = { page, page_size: pageSize };
    if (opts.sortBy) { params.sort_by = opts.sortBy; params.sort_dir = opts.sortDir || 'asc'; }
    if (opts.filterCol && opts.filterVal) { params.filter_col = opts.filterCol; params.filter_val = opts.filterVal; }
    if (opts.filters && Object.keys(opts.filters).length > 0) {
      params.filters = JSON.stringify(opts.filters);
    }
    if (opts.search) params.search = opts.search;
    if (opts.rowOrder != null) params.row_order = opts.rowOrder;
    return api.get(`${BASE}/${id}/rows/`, { params });
  },

  // ── Intelligent Dashboard ─────────────────────────────────────────

  /** Legacy single-call dashboard (kept for backward compat) */
  generateDashboard: (id, prompt = '') =>
    api.post(`${BASE}/${id}/generate-dashboard/`, { prompt }),

  getDashboard: (id) =>
    api.get(`${BASE}/${id}/dashboard/`),

  deleteDashboard: (id) =>
    api.delete(`${BASE}/${id}/dashboard/delete/`),

  refreshDashboard: (id) =>
    api.post(`${BASE}/${id}/dashboard/refresh/`),

  // ── Split-pipeline: Analytics → Suggestions → UI ──────────────────

  /** Pure server-side statistics (no AI). Legacy path. */
  getAnalytics: (id) =>
    api.get(`${BASE}/${id}/sheet-analytics/`),

  /**
   * Smart analytics — AI picks which functions to run, server executes them.
   * Returns { metadata, plan, results, plan_source, errors }.
   */
  smartAnalytics: (id, prompt = '') =>
    api.post(`${BASE}/${id}/smart-analytics/`, { prompt }),

  /**
   * AI-generated analysis & suggestions.
   * Accepts `results` (from smart-analytics, preferred) or `analytics` (legacy).
   */
  generateSuggestions: (id, { results = null, analytics = null } = {}) =>
    api.post(`${BASE}/${id}/generate-suggestions/`, {
      ...(results ? { results } : {}),
      ...(analytics ? { analytics } : {}),
    }),

  /**
   * AI-generated dashboard chart configs for the frontend renderer.
   * Accepts `results` (from smart-analytics, preferred) or `analytics` (legacy).
   */
  generateDashboardUI: (id, { results = null, analytics = null, prompt = '' } = {}) =>
    api.post(`${BASE}/${id}/generate-dashboard-ui/`, {
      ...(results ? { results } : {}),
      ...(analytics ? { analytics } : {}),
      prompt,
    }),

  // ── CSV Import / Export ───────────────────────────────────────────

  exportCsv: (id) =>
    api.get(`${BASE}/${id}/export-csv/`, { responseType: 'blob' }),

  importCsv: (id, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`${BASE}/${id}/import-csv/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  // ── Share Links ───────────────────────────────────────────────────

  listShareLinks: (id) =>
    api.get(`${BASE}/${id}/share-links/`),

  createShareLink: (id, data = {}) =>
    api.post(`${BASE}/${id}/share-links/`, data),

  getShareLink: (id, linkId) =>
    api.get(`${BASE}/${id}/share-links/${linkId}/`),

  updateShareLink: (id, linkId, data) =>
    api.patch(`${BASE}/${id}/share-links/${linkId}/`, data),

  deleteShareLink: (id, linkId) =>
    api.delete(`${BASE}/${id}/share-links/${linkId}/`),

  listSubmissions: (id, linkId = null) =>
    api.get(`${BASE}/${id}/submissions/`, { params: linkId ? { link: linkId } : {} }),

  // ── Enterprise Search & Find-Replace ───────────────────────────────

  /**
   * Server-side cell search with column filters, regex, pagination.
   * @param {string} id - sheet UUID
   * @param {object} params - { query, columns?, is_regex?, case_sensitive?, value_filter?, page?, page_size? }
   */
  search: (id, params) =>
    api.post(`${BASE}/${id}/search/`, params),

  /**
   * Find & replace across cells. Set preview=true to preview without applying.
   * @param {object} params - { find, replace?, is_regex?, case_sensitive?, columns?, preview? }
   */
  findReplace: (id, params) =>
    api.post(`${BASE}/${id}/find-replace/`, params),

  // ── Enterprise Formula Evaluation ─────────────────────────────────

  /** Trigger server-side formula evaluation (async for large sheets). */
  evaluateFormulas: (id) =>
    api.post(`${BASE}/${id}/evaluate-formulas/`),

  // ── Task Progress (async operations) ──────────────────────────────

  /** Poll a single task's progress. */
  getTaskStatus: (id, taskId) =>
    api.get(`${BASE}/${id}/task-status/${taskId}/`),

  /** List recent tasks for a sheet, optionally filtered by type/status. */
  listTasks: (id, { taskType, status } = {}) =>
    api.get(`${BASE}/${id}/tasks/`, { params: { ...(taskType && { task_type: taskType }), ...(status && { status }) } }),

  // ── Public Form (no auth) ────────────────────────────────────────

  getPublicForm: (token) =>
    api.get(`${BASE}/public/form/${token}/`),

  submitPublicForm: (token, data) =>
    api.post(`${BASE}/public/form/${token}/`, data),
};

export default sheetsService;
