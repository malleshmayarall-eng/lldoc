/**
 * SheetFormView — form-based interface for managing sheet rows, columns & analytics.
 *
 * Three cards:
 *  1. Add Row          — dynamic form from column definitions, submit → addRow + bulkUpdate
 *  2. Manage Columns   — add / reorder / delete columns
 *  3. Quick Analytics  — one-click server-side analytics + AI suggestions
 *
 * Plus a Recent Rows panel at the bottom that shows the last N rows.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Plus, Trash2, Columns, BarChart3, Loader2, ChevronDown, ChevronUp,
  Check, X, RefreshCw, Sparkles, ArrowUpDown, GripVertical, Table2,
} from 'lucide-react';
import useSheetsStore from '../../store/sheetsStore';
import { sheetsService } from '../../services/sheetsService';

// ── Helpers ────────────────────────────────────────────────────────

const COLUMN_TYPE_OPTIONS = [
  { value: 'text',     label: 'Text',     icon: 'Aa' },
  { value: 'number',   label: 'Number',   icon: '#' },
  { value: 'currency', label: 'Currency', icon: '$' },
  { value: 'date',     label: 'Date',     icon: '📅' },
  { value: 'boolean',  label: 'Boolean',  icon: '☑' },
  { value: 'select',   label: 'Select',   icon: '▾' },
  { value: 'json',     label: 'JSON',     icon: '{}' },
  { value: 'formula',  label: 'Formula',  icon: 'ƒ' },
];

function inputForType(type) {
  switch (type) {
    case 'number':
    case 'currency':
      return { type: 'number', step: 'any' };
    case 'date':
      return { type: 'date' };
    case 'boolean':
      return { type: 'checkbox' };
    case 'json':
      return { type: 'textarea' };
    default:
      return { type: 'text' };
  }
}

// ── Stat Card ──────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = 'blue' }) {
  const colors = {
    blue:    'from-blue-50 to-blue-100/60 text-blue-700 border-blue-200',
    emerald: 'from-emerald-50 to-emerald-100/60 text-emerald-700 border-emerald-200',
    violet:  'from-violet-50 to-violet-100/60 text-violet-700 border-violet-200',
    amber:   'from-amber-50 to-amber-100/60 text-amber-700 border-amber-200',
  };
  return (
    <div className={`rounded-xl border bg-gradient-to-br p-4 ${colors[color] || colors.blue}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-2xl font-bold mt-1">{value ?? '—'}</p>
      {sub && <p className="text-[10px] mt-0.5 opacity-60">{sub}</p>}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────

export default function SheetFormView() {
  const currentSheet   = useSheetsStore((s) => s.currentSheet);
  const cellValues     = useSheetsStore((s) => s.cellValues);
  const computedValues = useSheetsStore((s) => s.computedValues);
  const addRow         = useSheetsStore((s) => s.addRow);
  const addColumn      = useSheetsStore((s) => s.addColumn);
  const deleteColumn   = useSheetsStore((s) => s.deleteColumn);
  const deleteRow      = useSheetsStore((s) => s.deleteRow);
  const setCellValue   = useSheetsStore((s) => s.setCellValue);
  const saveAllCells   = useSheetsStore((s) => s.saveAllCells);
  const fetchSheetPaginated = useSheetsStore((s) => s.fetchSheetPaginated);
  const pagination     = useSheetsStore((s) => s.pagination);

  const columns = currentSheet?.columns || [];
  const rows    = currentSheet?.rows || [];

  // ── Add Row form state ──────────────────────────────────────────
  const emptyRowData = useMemo(() => {
    const obj = {};
    columns.forEach((c) => { obj[c.key] = c.type === 'boolean' ? false : ''; });
    return obj;
  }, [columns]);

  const [rowFormData, setRowFormData] = useState(emptyRowData);
  const [rowSubmitting, setRowSubmitting] = useState(false);
  const [rowSuccess, setRowSuccess] = useState(false);

  useEffect(() => { setRowFormData(emptyRowData); }, [emptyRowData]);

  const handleRowFieldChange = useCallback((key, value) => {
    setRowFormData((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleAddRow = useCallback(async () => {
    if (!currentSheet) return;
    setRowSubmitting(true);
    try {
      // 1. Create the row
      const totalRows = currentSheet.row_count ?? (currentSheet.rows?.length ?? 0);
      const afterOrder = totalRows > 0 ? totalRows - 1 : -1;
      const { data: newRow } = await sheetsService.addRow(currentSheet.id, afterOrder);

      // 2. Fill cells via bulk-update
      const cells = [];
      for (const col of columns) {
        const val = rowFormData[col.key];
        if (val !== '' && val !== false && val != null) {
          cells.push({
            row_order: newRow.order,
            column_key: col.key,
            raw_value: String(val),
          });
        }
      }
      if (cells.length > 0) {
        await sheetsService.bulkUpdate(currentSheet.id, cells);
      }

      // 3. Re-fetch
      if (pagination) {
        const ps = pagination.pageSize || 100;
        const lastPage = Math.ceil((totalRows + 1) / ps);
        await fetchSheetPaginated(currentSheet.id, ps, { page: lastPage });
      } else {
        await useSheetsStore.getState().fetchSheet(currentSheet.id);
      }

      setRowFormData(emptyRowData);
      setRowSuccess(true);
      setTimeout(() => setRowSuccess(false), 2000);
    } catch (err) {
      console.error('Add row failed:', err);
      alert(err?.response?.data?.error || err.message || 'Failed to add row');
    } finally {
      setRowSubmitting(false);
    }
  }, [currentSheet, columns, rowFormData, emptyRowData, pagination, fetchSheetPaginated]);

  // ── Add Column form state ───────────────────────────────────────
  const [colLabel, setColLabel] = useState('');
  const [colType, setColType] = useState('text');
  const [colAdding, setColAdding] = useState(false);
  const [formulaExpr, setFormulaExpr] = useState('');
  const [showFormulaBuilder, setShowFormulaBuilder] = useState(false);

  // Available columns for the formula builder (non-formula columns only)
  const formulableColumns = useMemo(() => {
    return columns.filter((c) => c.type !== 'formula' && !c.formula);
  }, [columns]);

  const FORMULA_OPERATIONS = [
    { op: '+', label: 'Add (+)' },
    { op: '-', label: 'Subtract (-)' },
    { op: '*', label: 'Multiply (×)' },
    { op: '/', label: 'Divide (÷)' },
  ];

  const FORMULA_FUNCTIONS = [
    { fn: 'SUM',   label: 'SUM',   desc: 'Add all values' },
    { fn: 'AVG',   label: 'AVG',   desc: 'Average' },
    { fn: 'MIN',   label: 'MIN',   desc: 'Minimum value' },
    { fn: 'MAX',   label: 'MAX',   desc: 'Maximum value' },
    { fn: 'COUNT', label: 'COUNT', desc: 'Count values' },
    { fn: 'ABS',   label: 'ABS',   desc: 'Absolute value' },
    { fn: 'ROUND', label: 'ROUND', desc: 'Round to N digits' },
  ];

  const insertColumnRef = useCallback((colKey) => {
    // Insert the column key reference — the backend resolves col_key + {row}
    setFormulaExpr((prev) => prev + colKey + '{row}');
  }, []);

  const insertOperation = useCallback((op) => {
    setFormulaExpr((prev) => prev + op);
  }, []);

  const insertFunction = useCallback((fn) => {
    setFormulaExpr((prev) => prev + fn + '(');
  }, []);

  // When colType changes to/from formula, toggle builder
  useEffect(() => {
    setShowFormulaBuilder(colType === 'formula');
    if (colType !== 'formula') setFormulaExpr('');
  }, [colType]);

  const handleAddColumn = useCallback(async () => {
    if (!colLabel.trim()) return;
    if (colType === 'formula' && !formulaExpr.trim()) return;
    setColAdding(true);
    try {
      const formula = colType === 'formula' ? `=${formulaExpr.trim()}` : undefined;
      await addColumn(colLabel.trim(), colType, formula);
      setColLabel('');
      setColType('text');
      setFormulaExpr('');
    } catch (err) {
      console.error('Add column failed:', err);
    } finally {
      setColAdding(false);
    }
  }, [colLabel, colType, formulaExpr, addColumn]);

  // ── Analytics state ─────────────────────────────────────────────
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(true);

  const fetchAnalytics = useCallback(async () => {
    if (!currentSheet) return;
    setAnalyticsLoading(true);
    try {
      const { data } = await sheetsService.smartAnalytics(currentSheet.id);
      setAnalytics(data);
    } catch (err) {
      console.error('Analytics failed:', err);
      // Fallback to legacy analytics
      try {
        const { data } = await sheetsService.getAnalytics(currentSheet.id);
        setAnalytics(data);
      } catch { /* ignore */ }
    } finally {
      setAnalyticsLoading(false);
    }
  }, [currentSheet]);

  const fetchSuggestions = useCallback(async () => {
    if (!currentSheet || !analytics) return;
    setSuggestionsLoading(true);
    try {
      const payload = analytics.results
        ? { results: analytics.results }
        : { analytics };
      const { data } = await sheetsService.generateSuggestions(currentSheet.id, payload);
      setSuggestions(data);
    } catch (err) {
      console.error('Suggestions failed:', err);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [currentSheet, analytics]);

  // Auto-fetch analytics on mount
  useEffect(() => {
    if (currentSheet?.id && rows.length > 0) fetchAnalytics();
  }, [currentSheet?.id]);

  // ── Recent rows (last 10) ──────────────────────────────────────
  const recentRows = useMemo(() => {
    return [...rows].sort((a, b) => b.order - a.order).slice(0, 10);
  }, [rows]);

  // ── Render ──────────────────────────────────────────────────────

  if (!currentSheet) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        No sheet selected
      </div>
    );
  }

  const rowCount = currentSheet.row_count ?? rows.length;
  const colCount = columns.length;

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50/50">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">

        {/* ── Quick Stats ──────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Rows" value={rowCount} color="blue" />
          <StatCard label="Columns" value={colCount} color="emerald" />
          <StatCard
            label="Filled Cells"
            value={Object.values(cellValues).filter((v) => v != null && v !== '').length}
            sub={`of ${rowCount * colCount}`}
            color="violet"
          />
          <StatCard
            label="Data Types"
            value={[...new Set(columns.map((c) => c.type))].length}
            sub={columns.map((c) => c.type).filter((v, i, a) => a.indexOf(v) === i).join(', ')}
            color="amber"
          />
        </div>

        {/* ── Two-column layout: Add Row + Manage Columns ──── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* ── Add Row Card (3/5 width) ───────────────────── */}
          <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-blue-50/80 to-transparent">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-blue-500 text-white flex items-center justify-center">
                  <Plus className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Add Row</h3>
                  <p className="text-[10px] text-gray-500">Fill in the fields to create a new row</p>
                </div>
              </div>
              {rowSuccess && (
                <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium animate-fade-in">
                  <Check className="h-3.5 w-3.5" /> Added!
                </span>
              )}
            </div>

            <div className="px-5 py-5 space-y-4">
              {columns.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">
                  Add columns first to create rows →
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {columns.filter((c) => !c.formula).map((col) => {
                      const inp = inputForType(col.type);
                      return (
                        <div key={col.key} className="space-y-1.5">
                          <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
                            <span className="text-[10px] text-gray-400 font-mono bg-gray-100 px-1.5 py-0.5 rounded">
                              {col.type === 'number' ? '#' : col.type === 'currency' ? '$' : col.type === 'date' ? '📅' : col.type === 'boolean' ? '☑' : 'Aa'}
                            </span>
                            {col.label}
                          </label>
                          {inp.type === 'checkbox' ? (
                            <label className="inline-flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={!!rowFormData[col.key]}
                                onChange={(e) => handleRowFieldChange(col.key, e.target.checked)}
                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="text-xs text-gray-500">{rowFormData[col.key] ? 'Yes' : 'No'}</span>
                            </label>
                          ) : inp.type === 'textarea' ? (
                            <textarea
                              value={rowFormData[col.key] || ''}
                              onChange={(e) => handleRowFieldChange(col.key, e.target.value)}
                              placeholder={`Enter ${col.label}…`}
                              rows={2}
                              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-300 focus:border-blue-300 outline-none bg-gray-50 hover:bg-white transition-colors resize-none"
                            />
                          ) : (
                            <input
                              type={inp.type}
                              step={inp.step}
                              value={rowFormData[col.key] || ''}
                              onChange={(e) => handleRowFieldChange(col.key, e.target.value)}
                              placeholder={`Enter ${col.label}…`}
                              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-300 focus:border-blue-300 outline-none bg-gray-50 hover:bg-white transition-colors"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={handleAddRow}
                      disabled={rowSubmitting}
                      className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all duration-150 shadow-sm hover:shadow disabled:opacity-50"
                    >
                      {rowSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      {rowSubmitting ? 'Adding…' : 'Add Row'}
                    </button>
                    <button
                      onClick={() => setRowFormData(emptyRowData)}
                      className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Manage Columns Card (2/5 width) ────────────── */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-emerald-50/80 to-transparent">
              <div className="h-8 w-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center">
                <Columns className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Columns</h3>
                <p className="text-[10px] text-gray-500">{colCount} column{colCount !== 1 ? 's' : ''}</p>
              </div>
            </div>

            <div className="px-5 py-4 space-y-3">
              {/* Existing columns list */}
              {columns.length > 0 && (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {columns.map((col) => (
                    <div key={col.key} className="flex items-center gap-2 group py-1.5 px-2.5 rounded-lg hover:bg-gray-50 transition-colors">
                      <span className="text-[10px] text-gray-400 font-mono bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">
                        {col.type}
                      </span>
                      <span className="text-sm text-gray-700 truncate flex-1">{col.label}</span>
                      {col.formula && (
                        <span className="text-[9px] text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded font-mono flex-shrink-0">ƒ</span>
                      )}
                      <button
                        onClick={() => {
                          if (window.confirm(`Delete column "${col.label}"?`)) deleteColumn(col.key);
                        }}
                        className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                        title="Delete column"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new column form */}
              <div className="border-t border-gray-100 pt-3 space-y-2.5">
                <input
                  type="text"
                  value={colLabel}
                  onChange={(e) => setColLabel(e.target.value)}
                  placeholder="Column name…"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-300 focus:border-emerald-300 outline-none bg-gray-50 hover:bg-white transition-colors"
                  onKeyDown={(e) => e.key === 'Enter' && colType !== 'formula' && handleAddColumn()}
                />
                <div className="flex flex-wrap gap-1.5">
                  {COLUMN_TYPE_OPTIONS.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => setColType(t.value)}
                      className={`text-[10px] px-2 py-1 rounded-lg font-medium transition-all ${
                        colType === t.value
                          ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300'
                          : 'text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      <span className="mr-0.5">{t.icon}</span> {t.label}
                    </button>
                  ))}
                </div>

                {/* ── Formula Builder (shown when type = formula) ─── */}
                {showFormulaBuilder && (
                  <div className="space-y-2 p-3 bg-blue-50/50 border border-blue-200 rounded-xl">
                    <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wider">Formula Builder</p>

                    {/* Formula expression input */}
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-500 font-mono text-sm font-bold">=</span>
                      <input
                        type="text"
                        value={formulaExpr}
                        onChange={(e) => setFormulaExpr(e.target.value)}
                        placeholder="e.g. col_0{row}+col_1{row}"
                        className="w-full pl-7 pr-3 py-2 text-sm font-mono border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-300 focus:border-blue-300 outline-none bg-white"
                      />
                    </div>

                    {/* Column chips — click to insert reference */}
                    {formulableColumns.length > 0 && (
                      <div>
                        <p className="text-[9px] text-blue-500 font-medium mb-1">Click a column to insert:</p>
                        <div className="flex flex-wrap gap-1">
                          {formulableColumns.map((c) => (
                            <button
                              key={c.key}
                              type="button"
                              onClick={() => insertColumnRef(c.key)}
                              className="text-[10px] px-2 py-1 bg-white border border-blue-200 text-blue-700 rounded-md hover:bg-blue-100 transition-colors font-medium"
                              title={`Insert ${c.label} (${c.key})`}
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Operations */}
                    <div className="flex items-center gap-1">
                      <p className="text-[9px] text-blue-500 font-medium mr-1">Ops:</p>
                      {FORMULA_OPERATIONS.map((o) => (
                        <button
                          key={o.op}
                          type="button"
                          onClick={() => insertOperation(o.op)}
                          className="w-7 h-7 text-sm font-bold bg-white border border-blue-200 text-blue-700 rounded-md hover:bg-blue-100 transition-colors flex items-center justify-center"
                          title={o.label}
                        >
                          {o.op}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => insertOperation('(')}
                        className="w-7 h-7 text-sm font-bold bg-white border border-gray-200 text-gray-600 rounded-md hover:bg-gray-100 transition-colors flex items-center justify-center"
                      >
                        (
                      </button>
                      <button
                        type="button"
                        onClick={() => insertOperation(')')}
                        className="w-7 h-7 text-sm font-bold bg-white border border-gray-200 text-gray-600 rounded-md hover:bg-gray-100 transition-colors flex items-center justify-center"
                      >
                        )
                      </button>
                    </div>

                    {/* Functions */}
                    <div>
                      <p className="text-[9px] text-blue-500 font-medium mb-1">Functions:</p>
                      <div className="flex flex-wrap gap-1">
                        {FORMULA_FUNCTIONS.map((f) => (
                          <button
                            key={f.fn}
                            type="button"
                            onClick={() => insertFunction(f.fn)}
                            className="text-[10px] px-2 py-1 bg-white border border-blue-200 text-blue-700 rounded-md hover:bg-blue-100 transition-colors font-mono"
                            title={f.desc}
                          >
                            {f.fn}()
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Preview */}
                    {formulaExpr && (
                      <div className="bg-white border border-blue-100 rounded-lg px-3 py-2">
                        <p className="text-[9px] text-gray-400 mb-0.5">Preview:</p>
                        <p className="text-xs font-mono text-blue-800">={formulaExpr}</p>
                        <p className="text-[9px] text-gray-400 mt-1">
                          This formula will be computed automatically. In shared forms it shows as output only.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={handleAddColumn}
                  disabled={colAdding || !colLabel.trim() || (colType === 'formula' && !formulaExpr.trim())}
                  className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-xl transition-all disabled:opacity-40"
                >
                  {colAdding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  {colType === 'formula' ? 'Add Formula Column' : 'Add Column'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Quick Analytics ──────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <button
            onClick={() => setShowAnalytics((p) => !p)}
            className="flex items-center justify-between w-full px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-violet-50/80 to-transparent text-left"
          >
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-violet-500 text-white flex items-center justify-center">
                <BarChart3 className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Quick Analytics</h3>
                <p className="text-[10px] text-gray-500">Server-side statistics & AI insights</p>
              </div>
            </div>
            {showAnalytics ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
          </button>

          {showAnalytics && (
            <div className="px-5 py-5 space-y-5">
              <div className="flex items-center gap-2">
                <button
                  onClick={fetchAnalytics}
                  disabled={analyticsLoading}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-xl transition-all disabled:opacity-50"
                >
                  {analyticsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {analyticsLoading ? 'Analyzing…' : 'Run Analytics'}
                </button>
                {analytics && (
                  <button
                    onClick={fetchSuggestions}
                    disabled={suggestionsLoading}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-xl transition-all disabled:opacity-50"
                  >
                    {suggestionsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {suggestionsLoading ? 'Thinking…' : 'AI Suggestions'}
                  </button>
                )}
              </div>

              {/* Analytics results */}
              {analytics && (
                <div className="space-y-4">
                  {/* Metadata card */}
                  {analytics.metadata && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {analytics.metadata.total_rows != null && (
                        <StatCard label="Total Rows" value={analytics.metadata.total_rows} color="blue" />
                      )}
                      {analytics.metadata.total_columns != null && (
                        <StatCard label="Total Columns" value={analytics.metadata.total_columns} color="emerald" />
                      )}
                      {analytics.metadata.numeric_columns != null && (
                        <StatCard label="Numeric Cols" value={analytics.metadata.numeric_columns} color="violet" />
                      )}
                      {analytics.metadata.text_columns != null && (
                        <StatCard label="Text Cols" value={analytics.metadata.text_columns} color="amber" />
                      )}
                    </div>
                  )}

                  {/* Results table */}
                  {analytics.results && Object.keys(analytics.results).length > 0 && (
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                        <p className="text-xs font-semibold text-gray-600">Analysis Results</p>
                      </div>
                      <div className="max-h-72 overflow-y-auto divide-y divide-gray-100">
                        {Object.entries(analytics.results).map(([key, val]) => (
                          <div key={key} className="flex items-start gap-3 px-4 py-3">
                            <span className="text-[10px] font-mono text-violet-600 bg-violet-50 px-2 py-0.5 rounded flex-shrink-0 mt-0.5">{key}</span>
                            <div className="text-sm text-gray-700 min-w-0 break-words">
                              {typeof val === 'object' ? (
                                <pre className="text-xs text-gray-600 bg-gray-50 p-2 rounded-lg overflow-x-auto">{JSON.stringify(val, null, 2)}</pre>
                              ) : (
                                String(val)
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Errors */}
                  {analytics.errors && analytics.errors.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                      <p className="text-xs font-semibold text-red-600 mb-2">Errors</p>
                      <ul className="space-y-1">
                        {analytics.errors.map((err, i) => (
                          <li key={i} className="text-xs text-red-600">{typeof err === 'string' ? err : JSON.stringify(err)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* AI Suggestions */}
              {suggestions && (
                <div className="border border-amber-200 bg-amber-50/50 rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-200 bg-amber-50">
                    <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                    <p className="text-xs font-semibold text-amber-700">AI Insights</p>
                  </div>
                  <div className="px-4 py-4 text-sm text-gray-700 leading-relaxed">
                    {typeof suggestions === 'string' ? (
                      <p className="whitespace-pre-wrap">{suggestions}</p>
                    ) : suggestions.suggestions ? (
                      <div className="space-y-3">
                        {(Array.isArray(suggestions.suggestions) ? suggestions.suggestions : [suggestions.suggestions]).map((s, i) => (
                          <div key={i} className="flex gap-2">
                            <span className="text-amber-500 font-bold mt-0.5">•</span>
                            <p className="whitespace-pre-wrap">{typeof s === 'string' ? s : JSON.stringify(s)}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <pre className="text-xs bg-white/50 p-3 rounded-lg overflow-x-auto">{JSON.stringify(suggestions, null, 2)}</pre>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Recent Rows ──────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
            <Table2 className="h-4 w-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-900">Recent Rows</h3>
            <span className="text-[10px] text-gray-400 ml-1">
              Showing {recentRows.length} of {rowCount}
            </span>
          </div>

          {recentRows.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-400">
              No rows yet. Use the form above to add your first row.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50/80">
                    <th className="px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider text-left w-12">#</th>
                    {columns.map((col) => (
                      <th key={col.key} className="px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider text-left">
                        {col.label}
                      </th>
                    ))}
                    <th className="px-4 py-2.5 w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recentRows.map((row) => (
                    <tr key={row.id || row.order} className="hover:bg-gray-50/50 transition-colors group">
                      <td className="px-4 py-2.5 text-xs text-gray-400 font-mono">{row.order + 1}</td>
                      {columns.map((col) => {
                        const key = `${row.order}_${col.key}`;
                        const val = computedValues[key] ?? cellValues[key] ?? '';
                        return (
                          <td key={col.key} className="px-4 py-2.5 text-sm text-gray-700 max-w-[200px] truncate">
                            {val || <span className="text-gray-300">—</span>}
                          </td>
                        );
                      })}
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => {
                            if (window.confirm('Delete this row?')) deleteRow(row.order);
                          }}
                          className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                          title="Delete row"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
