/**
 * ImportTableDialog — modal for importing tables from Drafter documents or LaTeX sources
 *
 * Two tabs:
 *   1) Document Tables — structured Table objects from document sections
 *   2) LaTeX Tables   — parsed \begin{tabular} from LatexCode blocks / quick-latex docs
 */

import { useState, useEffect, useCallback } from 'react';
import {
  X, Search, Table2, FileCode2, Loader2, ChevronRight,
  Rows3, Columns3, Import, Plus,
} from 'lucide-react';
import sheetsService from '../../services/sheetsService';

const TABS = [
  { key: 'document', label: 'Document Tables', icon: Table2 },
  { key: 'latex', label: 'LaTeX Tables', icon: FileCode2 },
];

export default function ImportTableDialog({ open, onClose, sheetId, onImported }) {
  const [tab, setTab] = useState('document');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  // Document tables state
  const [docTables, setDocTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState(null);

  // LaTeX tables state
  const [latexSources, setLatexSources] = useState([]);
  const [selectedLatex, setSelectedLatex] = useState(null); // { sourceId, sourceType, tableIndex }

  // Append toggle
  const [append, setAppend] = useState(false);

  // ── Fetch tables on tab change / search ──────────────────────────

  const fetchDocTables = useCallback(async (q = '') => {
    setLoading(true);
    setError('');
    try {
      const res = await sheetsService.listDocumentTables(q);
      setDocTables(res.data);
    } catch (err) {
      setError('Failed to load document tables');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLatexTables = useCallback(async (q = '') => {
    setLoading(true);
    setError('');
    try {
      const res = await sheetsService.listLatexTables(q);
      setLatexSources(res.data);
    } catch (err) {
      setError('Failed to load LaTeX tables');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelectedTable(null);
    setSelectedLatex(null);
    setError('');
    if (tab === 'document') fetchDocTables(search);
    else fetchLatexTables(search);
  }, [open, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = useCallback(() => {
    if (tab === 'document') fetchDocTables(search);
    else fetchLatexTables(search);
  }, [tab, search, fetchDocTables, fetchLatexTables]);

  // ── Import handlers ──────────────────────────────────────────────

  const handleImportDocTable = useCallback(async () => {
    if (!selectedTable || !sheetId) return;
    setImporting(true);
    setError('');
    try {
      await sheetsService.importDocumentTable(sheetId, selectedTable.table_id, append);
      onImported?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Import failed');
      console.error(err);
    } finally {
      setImporting(false);
    }
  }, [selectedTable, sheetId, append, onImported, onClose]);

  const handleImportLatexTable = useCallback(async () => {
    if (!selectedLatex || !sheetId) return;
    setImporting(true);
    setError('');
    try {
      await sheetsService.importLatexTable(sheetId, {
        sourceType: selectedLatex.sourceType,
        sourceId: selectedLatex.sourceId,
        tableIndex: selectedLatex.tableIndex,
        append,
      });
      onImported?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Import failed');
      console.error(err);
    } finally {
      setImporting(false);
    }
  }, [selectedLatex, sheetId, append, onImported, onClose]);

  if (!open) return null;

  const canImport =
    tab === 'document' ? !!selectedTable : !!selectedLatex;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[600px] max-h-[80vh] flex flex-col">

        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Import className="h-5 w-5 text-blue-500" />
            Import Table
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Tabs ────────────────────────────────────────────────── */}
        <div className="flex border-b border-gray-200 px-6">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setSearch(''); }}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Search bar ──────────────────────────────────────────── */}
        <div className="px-6 pt-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder={
                tab === 'document'
                  ? 'Search tables by name or document title...'
                  : 'Search LaTeX documents...'
              }
              className="w-full h-9 pl-9 pr-3 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none"
            />
          </div>
        </div>

        {/* ── Content ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 pb-2 min-h-[240px]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 text-blue-500 animate-spin" />
            </div>
          ) : tab === 'document' ? (
            <DocumentTableList
              tables={docTables}
              selected={selectedTable}
              onSelect={setSelectedTable}
            />
          ) : (
            <LatexTableList
              sources={latexSources}
              selected={selectedLatex}
              onSelect={setSelectedLatex}
            />
          )}
        </div>

        {/* ── Error ───────────────────────────────────────────────── */}
        {error && (
          <div className="px-6 pb-2">
            <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          </div>
        )}

        {/* ── Footer ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={append}
              onChange={(e) => setAppend(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Append to existing data
          </label>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={tab === 'document' ? handleImportDocTable : handleImportLatexTable}
              disabled={!canImport || importing}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {importing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  Import
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Document Table List ─────────────────────────────────────────── */

function DocumentTableList({ tables, selected, onSelect }) {
  if (!tables.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <Table2 className="h-8 w-8 mb-2" />
        <p className="text-sm">No document tables found</p>
        <p className="text-xs mt-1">Tables from your documents will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {tables.map((t) => {
        const isSelected = selected?.table_id === t.table_id;
        return (
          <button
            key={t.table_id}
            onClick={() => onSelect(t)}
            className={`w-full text-left p-3 rounded-lg border transition-all ${
              isSelected
                ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200'
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {t.title || 'Untitled Table'}
                </p>
                <p className="text-xs text-gray-500 truncate mt-0.5">
                  {t.document_title && (
                    <span className="inline-flex items-center gap-1">
                      <ChevronRight className="h-3 w-3" />
                      {t.document_title}
                      {t.section_title && ` › ${t.section_title}`}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3 ml-3 text-xs text-gray-400 shrink-0">
                <span className="flex items-center gap-1">
                  <Columns3 className="h-3 w-3" />
                  {t.num_columns}
                </span>
                <span className="flex items-center gap-1">
                  <Rows3 className="h-3 w-3" />
                  {t.num_rows}
                </span>
                <span className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] uppercase tracking-wide">
                  {t.table_type}
                </span>
              </div>
            </div>
            {t.column_labels?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {t.column_labels.slice(0, 6).map((lbl, i) => (
                  <span
                    key={i}
                    className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded"
                  >
                    {lbl}
                  </span>
                ))}
                {t.column_labels.length > 6 && (
                  <span className="text-[10px] px-1.5 py-0.5 text-gray-400">
                    +{t.column_labels.length - 6} more
                  </span>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── LaTeX Table List ────────────────────────────────────────────── */

function LatexTableList({ sources, selected, onSelect }) {
  if (!sources.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <FileCode2 className="h-8 w-8 mb-2" />
        <p className="text-sm">No LaTeX tables found</p>
        <p className="text-xs mt-1">LaTeX documents with tabular environments will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {sources.map((src) => (
        <div
          key={`${src.source_type}-${src.source_id}`}
          className="border border-gray-200 rounded-lg overflow-hidden"
        >
          {/* Source header */}
          <div className="px-3 py-2.5 bg-gray-50 flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{src.title}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {src.source_type === 'latex_code' ? 'LaTeX Code Block' : 'LaTeX Document'}
                {src.document_title && ` · ${src.document_title}`}
              </p>
            </div>
            <span className="text-xs text-gray-400 shrink-0 ml-2">
              {src.table_count} table{src.table_count !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Individual tables within this source */}
          <div className="divide-y divide-gray-100">
            {src.tables_preview.map((tbl) => {
              const isSelected =
                selected?.sourceId === src.source_id &&
                selected?.sourceType === src.source_type &&
                selected?.tableIndex === tbl.index;

              return (
                <button
                  key={tbl.index}
                  onClick={() =>
                    onSelect({
                      sourceId: src.source_id,
                      sourceType: src.source_type,
                      tableIndex: tbl.index,
                      title: src.title,
                    })
                  }
                  className={`w-full text-left px-3 py-2 transition-colors flex items-center justify-between ${
                    isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <span className="text-sm text-gray-700">
                    Table {tbl.index + 1}
                  </span>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <Columns3 className="h-3 w-3" />
                      {tbl.cols}
                    </span>
                    <span className="flex items-center gap-1">
                      <Rows3 className="h-3 w-3" />
                      {tbl.rows}
                    </span>
                    {isSelected && (
                      <span className="h-2 w-2 rounded-full bg-blue-500" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
