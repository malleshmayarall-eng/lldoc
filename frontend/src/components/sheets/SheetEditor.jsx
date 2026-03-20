/**
 * SheetEditor — full spreadsheet editor page
 *
 * Combines toolbar, formula bar, and grid.
 * Route: /sheets/:id
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Save, MoreHorizontal, Share2, Copy, Trash2,
  Download, Wand2, GitBranch, Loader2, Table2, Link, X,
  ClipboardCheck, ExternalLink, LayoutDashboard, LayoutGrid, FileText,
} from 'lucide-react';
import useSheetsStore from '../../store/sheetsStore';
import SheetToolbar from './SheetToolbar';
import FormulaBar from './FormulaBar';
import SheetGrid from './SheetGrid';
import SheetFormView from './SheetFormView';
import ImportTableDialog from './ImportTableDialog';
import { IntelligentDashboard } from './dashboard';
import SearchDialog from './SearchDialog';
import TaskProgressBar from './TaskProgressBar';
import { useTaskPoller } from '../../hooks/useTaskPoller';
import sheetsService from '../../services/sheetsService';

export default function SheetEditor() {
  const { id } = useParams();
  const navigate = useNavigate();

  const fetchSheet = useSheetsStore((s) => s.fetchSheet);
  const fetchSheetPaginated = useSheetsStore((s) => s.fetchSheetPaginated);
  const currentSheet = useSheetsStore((s) => s.currentSheet);
  const updateSheetTitle = useSheetsStore((s) => s.updateSheetTitle);
  const saveAllCells = useSheetsStore((s) => s.saveAllCells);
  const loading = useSheetsStore((s) => s.loading);
  const saving = useSheetsStore((s) => s.saving);
  const reset = useSheetsStore((s) => s.reset);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [showWorkflowImport, setShowWorkflowImport] = useState(false);
  const [workflowId, setWorkflowId] = useState('');
  const [showAIPrompt, setShowAIPrompt] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [showTableImport, setShowTableImport] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);

  // View mode: 'grid' (spreadsheet) or 'form' (form-based entry)
  const [viewMode, setViewMode] = useState('grid');

  // Share state
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareLinks, setShareLinks] = useState([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [creatingLink, setCreatingLink] = useState(false);
  const [copiedLinkToken, setCopiedLinkToken] = useState(null);

  // Enterprise search
  const [showSearchDialog, setShowSearchDialog] = useState(false);

  // Formula task polling
  const formulaTask = useSheetsStore((s) => s.formulaTask);
  const updateFormulaTask = useSheetsStore((s) => s.updateFormulaTask);
  const clearFormulaTask = useSheetsStore((s) => s.clearFormulaTask);
  const evaluateFormulasOnServer = useSheetsStore((s) => s.evaluateFormulasOnServer);
  const { task: polledTask, startPolling, cancel: cancelPolling } = useTaskPoller(currentSheet?.id);

  // Sync polled task data into store
  useEffect(() => {
    if (polledTask) {
      updateFormulaTask(polledTask);
      // On completion, refresh sheet to pick up new computed values
      if (polledTask.status === 'completed' && currentSheet?.id) {
        fetchSheetPaginated(currentSheet.id);
      }
    }
  }, [polledTask]);

  // Keyboard shortcut for search: ⌘⇧F
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault();
        setShowSearchDialog(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleNavigateToCell = useCallback((rowOrder, colKey) => {
    // Use server-side scrollToRow to load the page containing this row
    // and scroll the grid to the exact position
    const { scrollToRow } = useSheetsStore.getState();
    scrollToRow(rowOrder, colKey);
  }, []);

  useEffect(() => {
    if (id) fetchSheetPaginated(id);
    return () => reset();
  }, [id, fetchSheetPaginated, reset]);

  useEffect(() => {
    if (currentSheet) setTitleValue(currentSheet.title);
  }, [currentSheet?.title]);

  // Auto-save every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (currentSheet) saveAllCells();
    }, 30000);
    return () => clearInterval(interval);
  }, [currentSheet, saveAllCells]);

  const handleTitleSave = useCallback(() => {
    if (currentSheet && titleValue !== currentSheet.title) {
      updateSheetTitle(currentSheet.id, titleValue);
    }
    setIsEditingTitle(false);
  }, [currentSheet, titleValue, updateSheetTitle]);

  const handleDuplicate = useCallback(async () => {
    if (!currentSheet) return;
    try {
      const res = await sheetsService.duplicate(currentSheet.id);
      navigate(`/sheets/${res.data.id}`);
    } catch (err) {
      console.error('Duplicate failed:', err);
    }
    setShowMenu(false);
  }, [currentSheet, navigate]);

  const handleDelete = useCallback(async () => {
    if (!currentSheet) return;
    if (!window.confirm('Delete this sheet?')) return;
    try {
      await sheetsService.delete(currentSheet.id);
      navigate('/sheets');
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }, [currentSheet, navigate]);

  const handleExport = useCallback(async () => {
    if (!currentSheet) return;
    try {
      const res = await sheetsService.exportMetadata(currentSheet.id);
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentSheet.title}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  }, [currentSheet]);

  // ── CSV handlers ──
  const handleCsvExport = useCallback(async () => {
    if (!currentSheet) return;
    try {
      const res = await sheetsService.exportCsv(currentSheet.id);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentSheet.title || 'sheet'}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('CSV export failed:', err);
    }
  }, [currentSheet]);

  const handleCsvImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file || !currentSheet) return;
      try {
        await sheetsService.importCsv(currentSheet.id, file);
        await fetchSheet(currentSheet.id);
      } catch (err) {
        console.error('CSV import failed:', err);
      }
    };
    input.click();
  }, [currentSheet, fetchSheet]);

  const handleImportWorkflow = useCallback(async () => {
    if (!currentSheet || !workflowId) return;
    try {
      await sheetsService.importWorkflow(currentSheet.id, workflowId);
      await fetchSheet(currentSheet.id);
      setShowWorkflowImport(false);
      setWorkflowId('');
    } catch (err) {
      console.error('Import failed:', err);
    }
  }, [currentSheet, workflowId, fetchSheet]);

  // ── Share handlers ──
  const fetchShareLinks = useCallback(async () => {
    if (!currentSheet) return;
    setShareLoading(true);
    try {
      const { data } = await sheetsService.listShareLinks(currentSheet.id);
      setShareLinks(data);
    } catch (err) {
      console.error('Failed to load share links:', err);
    } finally {
      setShareLoading(false);
    }
  }, [currentSheet]);

  const handleOpenShare = useCallback(() => {
    setShowShareDialog(true);
    fetchShareLinks();
  }, [fetchShareLinks]);

  const handleCreateShareLink = useCallback(async () => {
    if (!currentSheet) return;
    setCreatingLink(true);
    try {
      await sheetsService.createShareLink(currentSheet.id, {
        label: currentSheet.title + ' Form',
      });
      await fetchShareLinks();
    } catch (err) {
      console.error('Failed to create share link:', err);
    } finally {
      setCreatingLink(false);
    }
  }, [currentSheet, fetchShareLinks]);

  const handleCopyLink = useCallback((token) => {
    const url = `${window.location.origin}/sheets/form/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedLinkToken(token);
    setTimeout(() => setCopiedLinkToken(null), 2000);
  }, []);

  const handleToggleLink = useCallback(async (linkId, isActive) => {
    if (!currentSheet) return;
    try {
      await sheetsService.updateShareLink(currentSheet.id, linkId, { is_active: !isActive });
      await fetchShareLinks();
    } catch (err) {
      console.error('Failed to update link:', err);
    }
  }, [currentSheet, fetchShareLinks]);

  const handleDeleteLink = useCallback(async (linkId) => {
    if (!currentSheet) return;
    if (!window.confirm('Delete this share link?')) return;
    try {
      await sheetsService.deleteShareLink(currentSheet.id, linkId);
      await fetchShareLinks();
    } catch (err) {
      console.error('Failed to delete link:', err);
    }
  }, [currentSheet, fetchShareLinks]);

  if (loading && !currentSheet) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center h-12 px-4 border-b border-gray-200 gap-3">
        <button
          onClick={() => navigate('/sheets')}
          className="p-1.5 hover:bg-gray-100 rounded transition-colors text-gray-500"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        {/* Title */}
        {isEditingTitle ? (
          <input
            type="text"
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={(e) => e.key === 'Enter' && handleTitleSave()}
            className="text-base font-semibold text-gray-900 border-b-2 border-blue-500 outline-none bg-transparent px-1"
            autoFocus
          />
        ) : (
          <h1
            className="text-base font-semibold text-gray-900 cursor-pointer hover:text-blue-600 transition-colors truncate max-w-md"
            onClick={() => setIsEditingTitle(true)}
          >
            {currentSheet?.title || 'Loading...'}
          </h1>
        )}

        {/* Save indicator */}
        <div className="flex items-center gap-2 ml-auto text-xs text-gray-400">
          {saving ? (
            <span className="flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Saving...
            </span>
          ) : (
            <span>Auto-saved</span>
          )}
        </div>

        {/* Actions */}

        {/* Grid / Form toggle */}
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => setViewMode('grid')}
            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
              viewMode === 'grid'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            title="Spreadsheet grid"
          >
            <LayoutGrid className="h-3 w-3" />
            Grid
          </button>
          <button
            onClick={() => setViewMode('form')}
            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
              viewMode === 'form'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            title="Form-based entry & analytics"
          >
            <FileText className="h-3 w-3" />
            Form
          </button>
        </div>

        <button
          onClick={saveAllCells}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          <Save className="h-3.5 w-3.5" />
          Save
        </button>

        <button
          onClick={handleOpenShare}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
        >
          <Share2 className="h-3.5 w-3.5" />
          Share
        </button>

        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1.5 hover:bg-gray-100 rounded transition-colors text-gray-500"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>

          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
              <button
                onClick={handleDuplicate}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <Copy className="h-4 w-4" /> Duplicate
              </button>
              <button
                onClick={handleExport}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <Download className="h-4 w-4" /> Export as JSON
              </button>
              <button
                onClick={() => { setShowWorkflowImport(true); setShowMenu(false); }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <GitBranch className="h-4 w-4" /> Import from Workflow
              </button>
              <button
                onClick={() => { setShowTableImport(true); setShowMenu(false); }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <Table2 className="h-4 w-4" /> Import from Document
              </button>
              <div className="h-px bg-gray-100 my-1" />
              <button
                onClick={handleDelete}
                className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
              >
                <Trash2 className="h-4 w-4" /> Delete Sheet
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Body: Grid mode vs Form mode ──────────────────────── */}
      {viewMode === 'grid' ? (
        <>
          {/* ── Toolbar ─────────────────────────────────────────── */}
          <SheetToolbar
            onAIGenerate={() => setShowAIPrompt(true)}
            onImportTable={() => setShowTableImport(true)}
            onExport={handleExport}
            onCsvImport={handleCsvImport}
            onCsvExport={handleCsvExport}
            onDashboard={() => setShowDashboard((p) => !p)}
            dashboardActive={showDashboard}
            onOpenSearch={() => setShowSearchDialog(true)}
            formulaTask={formulaTask}
            onDismissFormulaTask={clearFormulaTask}
          />

          {/* ── Formula Bar ─────────────────────────────────────── */}
          <FormulaBar />

          {/* ── Grid ────────────────────────────────────────────── */}
          <div className="flex-1 min-h-0">
            <SheetGrid />
          </div>
        </>
      ) : (
        /* ── Form View ──────────────────────────────────────────── */
        <SheetFormView />
      )}

      {/* ── Intelligent Dashboard Dialog ────────────────────────── */}
      <IntelligentDashboard
        sheetId={currentSheet?.id}
        open={showDashboard}
        onClose={() => setShowDashboard(false)}
      />

      {/* ── Enterprise Search Dialog ────────────────────────────── */}
      {showSearchDialog && currentSheet && (
        <SearchDialog
          sheetId={currentSheet.id}
          columns={currentSheet.columns || []}
          onClose={() => setShowSearchDialog(false)}
          onNavigateToCell={handleNavigateToCell}
        />
      )}

      {/* ── Status bar ──────────────────────────────────────────── */}
      <div className="h-7 flex items-center justify-between px-4 border-t border-gray-200 bg-gray-50 text-[11px] text-gray-500">
        <span>
          {currentSheet?.row_count || 0} rows × {currentSheet?.col_count || 0} columns
        </span>
        <span>
          {currentSheet?.workflow && (
            <span className="flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              Linked to workflow
            </span>
          )}
        </span>
      </div>

      {/* ── Workflow Import Dialog ───────────────────────────────── */}
      {showWorkflowImport && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-[420px] p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Import Workflow Data</h3>
            <p className="text-sm text-gray-500 mb-4">
              Pull data from a CLM workflow execution into this sheet.
            </p>
            <input
              type="text"
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              placeholder="Workflow ID (UUID)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowWorkflowImport(false)}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleImportWorkflow}
                disabled={!workflowId}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── AI Prompt Dialog ────────────────────────────────────── */}
      {showAIPrompt && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-[420px] p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-purple-500" />
              AI Fill Data
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Describe what data you want to add to this sheet.
            </p>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="e.g., Fill with sample vendor data for 10 suppliers..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-400 focus:border-purple-400 outline-none mb-4 h-24 resize-none"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowAIPrompt(false)}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  // For now this creates a new sheet from prompt
                  // Could be extended to fill current sheet
                  setShowAIPrompt(false);
                }}
                disabled={!aiPrompt}
                className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                Generate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Import Table Dialog ─────────────────────────────────── */}
      <ImportTableDialog
        open={showTableImport}
        onClose={() => setShowTableImport(false)}
        sheetId={currentSheet?.id}
        onImported={() => currentSheet && fetchSheet(currentSheet.id)}
      />

      {/* ── Share Dialog ────────────────────────────────────────── */}
      {showShareDialog && (
        <>
          <div className="fixed inset-0 bg-black/30 z-50" onClick={() => setShowShareDialog(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-[520px] max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <Share2 className="h-4 w-4 text-cyan-600" />
                  <h3 className="text-sm font-semibold text-gray-900">Share as Form</h3>
                </div>
                <button
                  onClick={() => setShowShareDialog(false)}
                  className="p-1 hover:bg-gray-100 rounded transition-colors"
                >
                  <X className="h-4 w-4 text-gray-400" />
                </button>
              </div>

              <div className="px-5 py-4 space-y-4 overflow-y-auto" style={{ maxHeight: '60vh' }}>
                <p className="text-xs text-gray-500">
                  Create a public form link from this sheet. Anyone with the link can submit
                  responses that become new rows in your sheet.
                </p>

                {/* Create new link */}
                <button
                  onClick={handleCreateShareLink}
                  disabled={creatingLink}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {creatingLink ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Link className="h-4 w-4" />
                  )}
                  {creatingLink ? 'Creating…' : 'Create Share Link'}
                </button>

                {/* Existing links */}
                {shareLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                  </div>
                ) : shareLinks.length === 0 ? (
                  <p className="text-center text-xs text-gray-400 py-4">
                    No share links yet. Create one above.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {shareLinks.map((link) => (
                      <div
                        key={link.id}
                        className={`border rounded-xl p-3 transition-colors ${
                          link.is_active ? 'border-cyan-200 bg-cyan-50/50' : 'border-gray-200 bg-gray-50 opacity-60'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-gray-800 truncate">
                              {link.label || 'Share Link'}
                            </p>
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              {link.submission_count} submission{link.submission_count !== 1 ? 's' : ''}
                              {link.max_submissions ? ` / ${link.max_submissions} max` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleCopyLink(link.token)}
                              className="p-1.5 hover:bg-white rounded transition-colors text-gray-500 hover:text-cyan-600"
                              title="Copy link"
                            >
                              {copiedLinkToken === link.token ? (
                                <ClipboardCheck className="h-3.5 w-3.5 text-emerald-500" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <a
                              href={`/sheets/form/${link.token}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 hover:bg-white rounded transition-colors text-gray-500 hover:text-cyan-600"
                              title="Open form"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 mt-2">
                          <button
                            onClick={() => handleToggleLink(link.id, link.is_active)}
                            className={`text-[10px] px-2 py-1 rounded-full font-medium transition-colors ${
                              link.is_active
                                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                            }`}
                          >
                            {link.is_active ? 'Active' : 'Inactive'}
                          </button>
                          <button
                            onClick={() => handleDeleteLink(link.id)}
                            className="text-[10px] px-2 py-1 rounded-full text-red-600 hover:bg-red-50 transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
