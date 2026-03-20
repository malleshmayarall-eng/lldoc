/**
 * SheetList — list of all sheets with create, search, and AI generate
 *
 * Route: /sheets
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Search, Table2, Wand2, MoreHorizontal, Trash2, Copy,
  Clock, User, Loader2, FileSpreadsheet, Sparkles, ArrowRight,
  Grid3X3,
} from 'lucide-react';
import useSheetsStore from '../../store/sheetsStore';
import sheetsService from '../../services/sheetsService';

export default function SheetList() {
  const navigate = useNavigate();
  const sheets = useSheetsStore((s) => s.sheets);
  const fetchSheets = useSheetsStore((s) => s.fetchSheets);
  const createSheet = useSheetsStore((s) => s.createSheet);
  const deleteSheet = useSheetsStore((s) => s.deleteSheet);
  const aiGenerateSheet = useSheetsStore((s) => s.aiGenerateSheet);
  const loading = useSheetsStore((s) => s.loading);

  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newRows, setNewRows] = useState(20);
  const [newCols, setNewCols] = useState(6);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiRows, setAiRows] = useState(10);
  const [aiCols, setAiCols] = useState(5);
  const [menuSheet, setMenuSheet] = useState(null);

  useEffect(() => {
    fetchSheets();
  }, [fetchSheets]);

  const handleCreateSheet = useCallback(async () => {
    try {
      const sheet = await createSheet({
        title: newTitle || 'Untitled Sheet',
        row_count: newRows,
        col_count: newCols,
      });
      setShowCreate(false);
      setNewTitle('');
      navigate(`/sheets/${sheet.id}`);
    } catch (err) {
      console.error('Create failed:', err);
    }
  }, [createSheet, newTitle, newRows, newCols, navigate]);

  const handleAICreate = useCallback(async () => {
    try {
      const sheet = await aiGenerateSheet(aiPrompt, aiRows, aiCols);
      setShowAI(false);
      setAiPrompt('');
      navigate(`/sheets/${sheet.id}`);
    } catch (err) {
      console.error('AI generate failed:', err);
    }
  }, [aiGenerateSheet, aiPrompt, aiRows, aiCols, navigate]);

  const handleDuplicate = useCallback(async (id) => {
    try {
      const res = await sheetsService.duplicate(id);
      fetchSheets();
      navigate(`/sheets/${res.data.id}`);
    } catch (err) {
      console.error('Duplicate failed:', err);
    }
  }, [fetchSheets, navigate]);

  const filteredSheets = sheets.filter((s) =>
    !search || s.title.toLowerCase().includes(search.toLowerCase())
  );

  const templates = [
    { icon: '📊', label: 'Budget Tracker', prompt: 'Create a budget tracker with categories' },
    { icon: '🧾', label: 'Invoice', prompt: 'Create an invoice with line items' },
    { icon: '📋', label: 'Project Tracker', prompt: 'Create a project task tracker' },
    { icon: '📦', label: 'Inventory', prompt: 'Create an inventory tracker' },
    { icon: '👥', label: 'Employee Directory', prompt: 'Create an employee directory' },
  ];

  return (
    <div className="h-full flex flex-col bg-gray-50/50">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Grid3X3 className="h-6 w-6 text-emerald-500" />
                Sheets
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Create and manage spreadsheets with formulas, workflow data, and AI
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAI(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
              >
                <Wand2 className="h-4 w-4" />
                AI Create
              </button>
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
                New Sheet
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="mt-4 relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sheets..."
              className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none"
            />
          </div>
        </div>
      </div>

      {/* ── Quick Templates ─────────────────────────────────────── */}
      {sheets.length === 0 && !loading && (
        <div className="max-w-7xl mx-auto px-6 pt-6">
          <p className="text-sm font-medium text-gray-600 mb-3">Quick Start Templates</p>
          <div className="grid grid-cols-5 gap-3">
            {templates.map((t) => (
              <button
                key={t.label}
                onClick={async () => {
                  try {
                    const sheet = await aiGenerateSheet(t.prompt, 10, 5);
                    navigate(`/sheets/${sheet.id}`);
                  } catch (err) {
                    console.error('Template create failed:', err);
                  }
                }}
                className="flex flex-col items-center gap-2 p-4 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-md transition-all group"
              >
                <span className="text-2xl">{t.icon}</span>
                <span className="text-xs font-medium text-gray-700 group-hover:text-blue-600">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Sheet Grid ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-6 py-4 max-w-7xl mx-auto w-full">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
          </div>
        ) : filteredSheets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <FileSpreadsheet className="h-16 w-16 mb-4 text-gray-300" />
            <p className="text-lg font-medium">No sheets yet</p>
            <p className="text-sm mt-1">Create your first sheet to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredSheets.map((sheet) => (
              <div
                key={sheet.id}
                onClick={() => navigate(`/sheets/${sheet.id}`)}
                className="group bg-white border border-gray-200 rounded-xl p-4 cursor-pointer hover:border-blue-300 hover:shadow-lg transition-all relative"
              >
                {/* Preview grid lines */}
                <div className="h-24 bg-gradient-to-br from-gray-50 to-white border border-gray-100 rounded-lg mb-3 overflow-hidden">
                  <div className="grid grid-cols-4 gap-px p-1 h-full">
                    {Array.from({ length: 12 }, (_, i) => (
                      <div
                        key={i}
                        className={`rounded-sm ${i < 4 ? 'bg-emerald-100' : 'bg-gray-100'}`}
                      />
                    ))}
                  </div>
                </div>

                <h3 className="text-sm font-semibold text-gray-900 truncate group-hover:text-blue-600 transition-colors">
                  {sheet.title}
                </h3>

                <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400">
                  <span className="flex items-center gap-1">
                    <Table2 className="h-3 w-3" />
                    {sheet.row_count}×{sheet.col_count}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(sheet.updated_at).toLocaleDateString()}
                  </span>
                </div>

                {sheet.description && (
                  <p className="text-[11px] text-gray-400 mt-1 truncate">{sheet.description}</p>
                )}

                {/* Menu */}
                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuSheet(menuSheet === sheet.id ? null : sheet.id);
                    }}
                    className="p-1 hover:bg-gray-100 rounded"
                  >
                    <MoreHorizontal className="h-4 w-4 text-gray-400" />
                  </button>

                  {menuSheet === sheet.id && (
                    <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDuplicate(sheet.id); setMenuSheet(null); }}
                        className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                      >
                        <Copy className="h-3.5 w-3.5" /> Duplicate
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm('Delete this sheet?')) {
                            deleteSheet(sheet.id);
                          }
                          setMenuSheet(null);
                        }}
                        className="w-full text-left px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Create Sheet Dialog ─────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[440px] p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Grid3X3 className="h-5 w-5 text-emerald-500" />
              Create New Sheet
            </h2>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Name</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="My Sheet"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Rows</label>
                  <input
                    type="number"
                    value={newRows}
                    onChange={(e) => setNewRows(parseInt(e.target.value) || 10)}
                    min={1}
                    max={1000}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 outline-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Columns</label>
                  <input
                    type="number"
                    value={newCols}
                    onChange={(e) => setNewCols(parseInt(e.target.value) || 5)}
                    min={1}
                    max={50}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateSheet}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Create Sheet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── AI Create Dialog ────────────────────────────────────── */}
      {showAI && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[480px] p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-500" />
              AI Sheet Creator
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Describe the sheet you want and AI will create it with columns, sample data, and formulas.
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Describe your sheet</label>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="e.g., Budget tracker with monthly columns and auto-totals..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-400 focus:border-purple-400 outline-none h-28 resize-none"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Rows</label>
                  <input
                    type="number"
                    value={aiRows}
                    onChange={(e) => setAiRows(parseInt(e.target.value) || 10)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-400 outline-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Columns</label>
                  <input
                    type="number"
                    value={aiCols}
                    onChange={(e) => setAiCols(parseInt(e.target.value) || 5)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-400 outline-none"
                  />
                </div>
              </div>

              {/* Quick prompts */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Quick prompts</p>
                <div className="flex flex-wrap gap-2">
                  {templates.map((t) => (
                    <button
                      key={t.label}
                      onClick={() => setAiPrompt(t.prompt)}
                      className="px-2.5 py-1 text-xs bg-gray-100 text-gray-600 rounded-full hover:bg-purple-100 hover:text-purple-700 transition-colors"
                    >
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowAI(false)}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAICreate}
                disabled={!aiPrompt || loading}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                Generate Sheet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
