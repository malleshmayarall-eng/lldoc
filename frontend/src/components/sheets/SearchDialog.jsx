/**
 * SearchDialog — enterprise search & find-replace dialog for sheets.
 *
 * Features:
 *  - Server-side search across millions of rows
 *  - Column filter checkboxes
 *  - Regex / case-sensitive toggles
 *  - Value filters (gt, lt, eq, neq, between)
 *  - Find & replace with preview mode
 *  - Paginated results
 */

import { useState, useCallback, useRef, useEffect, memo } from 'react';
import {
  Search, X, Replace, ChevronDown, ChevronUp,
  Filter, ToggleLeft, ToggleRight, Loader2,
  AlertCircle, CheckCircle2, Eye, Regex,
  CaseSensitive, ArrowDown, ArrowUp,
} from 'lucide-react';
import sheetsService from '../../services/sheetsService';

const VALUE_FILTER_OPS = [
  { value: '', label: 'None' },
  { value: 'gt', label: '> Greater than' },
  { value: 'lt', label: '< Less than' },
  { value: 'gte', label: '≥ Greater or equal' },
  { value: 'lte', label: '≤ Less or equal' },
  { value: 'eq', label: '= Equal' },
  { value: 'neq', label: '≠ Not equal' },
  { value: 'between', label: '↔ Between' },
];

function SearchDialog({ sheetId, columns = [], onClose, onNavigateToCell }) {
  // Search state
  const [query, setQuery] = useState('');
  const [selectedColumns, setSelectedColumns] = useState([]);
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [valueFilterOp, setValueFilterOp] = useState('');
  const [valueFilterVal, setValueFilterVal] = useState('');
  const [valueFilterVal2, setValueFilterVal2] = useState('');

  // Replace state
  const [showReplace, setShowReplace] = useState(false);
  const [replaceText, setReplaceText] = useState('');
  const [previewMode, setPreviewMode] = useState(true);

  // Results
  const [results, setResults] = useState(null);
  const [replaceResult, setReplaceResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(-1);

  // Filters panel
  const [showFilters, setShowFilters] = useState(false);

  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ── Search ──────────────────────────────────────────────────────

  const doSearch = useCallback(async (pg = 1) => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setReplaceResult(null);
    try {
      const params = {
        query: query.trim(),
        page: pg,
        page_size: 50,
      };
      if (selectedColumns.length > 0) params.columns = selectedColumns;
      if (isRegex) params.is_regex = true;
      if (caseSensitive) params.case_sensitive = true;
      if (valueFilterOp) {
        params.value_filter = { op: valueFilterOp, value: Number(valueFilterVal) };
        if (valueFilterOp === 'between') params.value_filter.value2 = Number(valueFilterVal2);
      }

      const res = await sheetsService.search(sheetId, params);
      setResults(res.data);
      setPage(pg);
      setCurrentMatchIdx(res.data.matches?.length > 0 ? 0 : -1);
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [query, selectedColumns, isRegex, caseSensitive, valueFilterOp, valueFilterVal, valueFilterVal2, sheetId]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        // Navigate to previous match
        navigateMatch(-1);
      } else {
        doSearch(1);
      }
    }
    if (e.key === 'Escape') onClose();
  }, [doSearch, onClose]);

  // ── Navigate between matches ────────────────────────────────────

  const navigateMatch = useCallback((direction) => {
    if (!results?.matches?.length) return;
    const newIdx = (currentMatchIdx + direction + results.matches.length) % results.matches.length;
    setCurrentMatchIdx(newIdx);
    const match = results.matches[newIdx];
    if (match && onNavigateToCell) {
      onNavigateToCell(match.row_order, match.column_key);
    }
  }, [results, currentMatchIdx, onNavigateToCell]);

  // ── Find & Replace ──────────────────────────────────────────────

  const doReplace = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const params = {
        find: query.trim(),
        replace: replaceText,
        is_regex: isRegex,
        case_sensitive: caseSensitive,
        preview: previewMode,
      };
      if (selectedColumns.length > 0) params.columns = selectedColumns;

      const res = await sheetsService.findReplace(sheetId, params);
      setReplaceResult(res.data);
      if (!previewMode) {
        // Refresh search to show updated results
        doSearch(page);
      }
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [query, replaceText, isRegex, caseSensitive, previewMode, selectedColumns, sheetId, doSearch, page]);

  // ── Column toggle ───────────────────────────────────────────────

  const toggleColumn = useCallback((key) => {
    setSelectedColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }, []);

  // ── Render ──────────────────────────────────────────────────────

  const matchCount = results?.total_matches ?? 0;
  const matches = results?.matches ?? [];

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center pt-[10vh]" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-[640px] max-h-[75vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50/50">
          <Search className="h-4 w-4 text-gray-400" />
          <span className="text-sm font-semibold text-gray-700">Enterprise Search</span>
          <div className="ml-auto flex items-center gap-1">
            {matchCount > 0 && (
              <span className="text-[11px] text-gray-400 font-mono mr-2">
                {currentMatchIdx + 1} / {matchCount}
              </span>
            )}
            <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded-lg transition-colors">
              <X className="h-4 w-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Search input row */}
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search cells…"
                className="w-full h-9 pl-3 pr-20 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 outline-none bg-white"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                <button
                  onClick={() => setIsRegex((p) => !p)}
                  title="Regular expression"
                  className={`p-1 rounded transition-colors ${isRegex ? 'bg-indigo-100 text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  <Regex className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setCaseSensitive((p) => !p)}
                  title="Match case"
                  className={`p-1 rounded transition-colors ${caseSensitive ? 'bg-indigo-100 text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  <CaseSensitive className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <button
              onClick={() => doSearch(1)}
              disabled={loading || !query.trim()}
              className="h-9 px-4 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Find
            </button>
            <button
              onClick={() => setShowReplace((p) => !p)}
              title="Find & Replace"
              className={`h-9 px-3 rounded-lg border text-sm font-medium transition-colors ${
                showReplace ? 'bg-amber-50 border-amber-200 text-amber-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              <Replace className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Replace row */}
          {showReplace && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                placeholder="Replace with…"
                className="flex-1 h-9 pl-3 pr-3 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-300 focus:border-amber-300 outline-none bg-white"
              />
              <button
                onClick={() => { setPreviewMode(true); doReplace(); }}
                disabled={loading || !query.trim()}
                className="h-9 px-3 bg-amber-50 text-amber-700 text-sm font-medium rounded-lg border border-amber-200 hover:bg-amber-100 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
              >
                <Eye className="h-3.5 w-3.5" /> Preview
              </button>
              <button
                onClick={() => { setPreviewMode(false); doReplace(); }}
                disabled={loading || !query.trim()}
                className="h-9 px-3 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
              >
                <Replace className="h-3.5 w-3.5" /> Replace All
              </button>
            </div>
          )}

          {/* Toggles: filters, column select */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowFilters((p) => !p)}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                showFilters ? 'bg-indigo-100 text-indigo-600' : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              <Filter className="h-3 w-3" />
              Filters
              {showFilters ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            {selectedColumns.length > 0 && (
              <span className="text-[10px] text-gray-400">
                Searching {selectedColumns.length} column{selectedColumns.length > 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Filters panel */}
          {showFilters && (
            <div className="bg-gray-50 rounded-xl p-3 space-y-3 border border-gray-100">
              {/* Column filter */}
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Columns</p>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {columns.map((col) => (
                    <button
                      key={col.key}
                      onClick={() => toggleColumn(col.key)}
                      className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors ${
                        selectedColumns.includes(col.key)
                          ? 'bg-indigo-100 text-indigo-700 border-indigo-200'
                          : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      {col.label || col.key}
                    </button>
                  ))}
                  {columns.length === 0 && (
                    <span className="text-[11px] text-gray-400">No columns available</span>
                  )}
                </div>
              </div>
              {/* Value filter */}
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Numeric Filter</p>
                <div className="flex items-center gap-2">
                  <select
                    value={valueFilterOp}
                    onChange={(e) => setValueFilterOp(e.target.value)}
                    className="h-7 text-xs border border-gray-200 rounded-lg px-2 bg-white"
                  >
                    {VALUE_FILTER_OPS.map((op) => (
                      <option key={op.value} value={op.value}>{op.label}</option>
                    ))}
                  </select>
                  {valueFilterOp && (
                    <input
                      type="number"
                      value={valueFilterVal}
                      onChange={(e) => setValueFilterVal(e.target.value)}
                      placeholder="Value"
                      className="h-7 w-24 text-xs border border-gray-200 rounded-lg px-2"
                    />
                  )}
                  {valueFilterOp === 'between' && (
                    <>
                      <span className="text-xs text-gray-400">to</span>
                      <input
                        type="number"
                        value={valueFilterVal2}
                        onChange={(e) => setValueFilterVal2(e.target.value)}
                        placeholder="Value 2"
                        className="h-7 w-24 text-xs border border-gray-200 rounded-lg px-2"
                      />
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
          </div>
        )}

        {/* Replace preview result */}
        {replaceResult && (
          <div className="mx-4 mb-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm">
            {replaceResult.preview ? (
              <p className="text-amber-700">
                <Eye className="h-3.5 w-3.5 inline mr-1" />
                Preview: <strong>{replaceResult.would_replace}</strong> cells would be changed
              </p>
            ) : (
              <p className="text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5 inline mr-1" />
                Replaced <strong>{replaceResult.replaced}</strong> cells across <strong>{replaceResult.rows_affected}</strong> rows
              </p>
            )}
          </div>
        )}

        {/* Results list */}
        <div className="flex-1 overflow-y-auto px-4 pb-3">
          {results && matches.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm">
              No matches found for &ldquo;{query}&rdquo;
            </div>
          )}

          {matches.length > 0 && (
            <div className="space-y-1">
              {/* Navigation arrows */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-gray-400">
                  {matchCount.toLocaleString()} matches • Page {page}/{results?.total_pages || 1}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => navigateMatch(-1)}
                    className="p-1 hover:bg-gray-100 rounded transition-colors text-gray-500"
                    title="Previous match (Shift+Enter)"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => navigateMatch(1)}
                    className="p-1 hover:bg-gray-100 rounded transition-colors text-gray-500"
                    title="Next match (Enter)"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {matches.map((m, i) => (
                <button
                  key={`${m.row_order}_${m.column_key}_${i}`}
                  onClick={() => {
                    setCurrentMatchIdx(i);
                    onNavigateToCell?.(m.row_order, m.column_key);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-all ${
                    i === currentMatchIdx
                      ? 'bg-indigo-50 border-indigo-200 ring-1 ring-indigo-200'
                      : 'border-gray-100 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-gray-400">
                      Row {m.row_order} · {m.column_key}
                    </span>
                    {m.value_type && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full">
                        {m.value_type}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-700 mt-0.5 truncate">{m.raw_value}</p>
                </button>
              ))}

              {/* Pagination */}
              {results?.total_pages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-3">
                  <button
                    onClick={() => doSearch(page - 1)}
                    disabled={page <= 1 || loading}
                    className="px-3 py-1 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-gray-400">
                    {page} / {results.total_pages}
                  </span>
                  <button
                    onClick={() => doSearch(page + 1)}
                    disabled={page >= results.total_pages || loading}
                    className="px-3 py-1 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(SearchDialog);
