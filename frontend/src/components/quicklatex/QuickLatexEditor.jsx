/**
 * QuickLatexEditor – Minimal, modern editor for Quick LaTeX / HTML documents.
 *
 * Layout:
 *  Header     → Back, title, action buttons
 *  Meta strip → Always-visible compact metadata (author, type, category, dates)
 *  Main area  → Code editor (left, toggleable) | PDF Preview (centre) | AI Chat (right)
 *  Placeholders → Below code editor when code panel is open, or collapsible strip
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  Code,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  Globe,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  User,
  Zap,
  AlertTriangle,
  ArrowRightLeft,
  Undo2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import PlaceholderForm from './PlaceholderForm';
import AIChatPanel from './AIChatPanel';
import DuplicateDialog from './DuplicateDialog';
import BulkDuplicateDialog from './BulkDuplicateDialog';
import QuickLatexImageSidebar from './QuickLatexImageSidebar';
import ExportSettingsPanel from '../ExportSettingsPanel';

/* ------------------------------------------------------------------ */
/*  ErrorDetails — collapsible compilation error detail panel           */
/* ------------------------------------------------------------------ */

const ErrorDetails = ({ errorLines = [], missingPackages = [] }) => {
  const [expanded, setExpanded] = useState(false);

  if (errorLines.length === 0 && missingPackages.length === 0) return null;

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-gray-600 hover:bg-gray-100 transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Error details ({errorLines.length} {errorLines.length === 1 ? 'error' : 'errors'})
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Missing packages */}
          {missingPackages.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
              <p className="text-[10px] font-medium text-amber-700 mb-0.5">Missing packages:</p>
              <p className="text-[10px] text-amber-600 font-mono">
                {missingPackages.map(p => `\\usepackage{${p}}`).join(', ')}
              </p>
            </div>
          )}
          {/* Error lines */}
          {errorLines.map((err, idx) => (
            <div key={idx} className="bg-white border border-gray-200 rounded px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                {err.line && (
                  <span className="text-[10px] font-mono bg-red-100 text-red-700 px-1.5 py-0.5 rounded flex-shrink-0">
                    L{err.line}
                  </span>
                )}
                <p className="text-[10px] text-gray-700 font-mono leading-relaxed break-all">
                  {err.message}
                </p>
              </div>
              {err.context && (
                <p className="text-[9px] text-gray-400 font-mono mt-1 pl-1 border-l-2 border-gray-200 break-all">
                  {err.context}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};


/* ------------------------------------------------------------------ */
/*  QuickLatexEditor                                                    */
/* ------------------------------------------------------------------ */

const QuickLatexEditor = ({
  document: doc,
  placeholders,
  imageSlots = [],
  renderedLatex,
  previewPages = [],
  previewPdfUrl,
  previewLoading,
  previewError,
  saving,
  generating,
  chatMessages = [],
  resolvedImages = {},
  onUpdate,
  onDelete,
  onDuplicate,
  onBulkDuplicate,
  onAIGenerate,
  onFetchPlaceholders,
  onFetchRendered,
  onRenderPreview,
  onSwitchCodeType,
  onUpdateMetadata,
  onUndoEdit,
  onClearChat,
  onResolveImages,
  onMapImage,
  onBack,
  // Export Studio props
  exportDraft,
  exportLoading,
  exportSaving,
  exportError,
  exportDirty,
  exportTemplates,
  exportImages,
  exportPdfFiles,
  exportMetadataSnapshot,
  onUpdateExportSetting,
  onSaveExportSettings,
  onResetExportSettings,
  onUploadExportImage,
  onUploadExportPdfFile,
  onSaveHeaderFooterPdf,
  onRemoveHeaderFooterPdf,
  onRefreshExportPreview,
}) => {
  // ── Local state ────────────────────────────────────────────────────

  const [latexCode, setLatexCode] = useState('');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [documentType, setDocumentType] = useState('contract');
  const [category, setCategory] = useState('contract');

  const [rightPanel, setRightPanel] = useState(null); // 'ai' | 'images' | 'export' | null  (preview is now the main view)
  const [showCode, setShowCode] = useState(false); // code editor visible
  const [showDuplicate, setShowDuplicate] = useState(false);
  const [showBulkDuplicate, setShowBulkDuplicate] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [codeType, setCodeType] = useState('latex');
  const [switchingCodeType, setSwitchingCodeType] = useState(false);

  const editorRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const previewTimeoutRef = useRef(null);
  const exportSettingsAppliedRef = useRef(false);

  // ── Sync from prop ─────────────────────────────────────────────────

  useEffect(() => {
    if (!doc) return;
    setLatexCode(doc.latex_block?.latex_code || doc.latex_code || '');
    setTitle(doc.title || '');
    setAuthor(doc.author || '');
    setDocumentType(doc.document_type || 'contract');
    setCategory(doc.category || 'contract');
    setCodeType(doc.latex_block?.code_type || 'latex');
    exportSettingsAppliedRef.current = false; // reset when doc changes
  }, [doc?.id]);

  // ── Trigger preview on initial load ────────────────────────────────

  useEffect(() => {
    if (!doc?.id) return;
    const code = doc.latex_block?.latex_code || doc.latex_code || '';
    const ct = doc.latex_block?.code_type || 'latex';
    if (code.trim()) {
      onRenderPreview?.(doc.id, code, doc.latex_block?.custom_metadata?.metadata_values || {}, ct, exportDraft?.processing_settings);
    }
    onFetchPlaceholders?.(doc.id);
  }, [doc?.id]);

  // ── Re-render preview once export settings finish loading ──────────
  // Export settings load asynchronously after the document, so the
  // initial render (above) may fire with exportDraft = null. Once the
  // draft arrives, re-render so the preview reflects margins/headers.

  useEffect(() => {
    if (!doc?.id || !exportDraft?.processing_settings || exportSettingsAppliedRef.current) return;
    exportSettingsAppliedRef.current = true;
    const code = doc.latex_block?.latex_code || doc.latex_code || latexCode || '';
    const ct = doc.latex_block?.code_type || codeType || 'latex';
    if (code.trim()) {
      onRenderPreview?.(doc.id, code, doc.latex_block?.custom_metadata?.metadata_values || {}, ct, exportDraft.processing_settings);
    }
  }, [doc?.id, exportDraft?.processing_settings]);

  // ── Auto-save + auto-preview (debounced) ───────────────────────────

  const handleCodeChange = useCallback((newCode) => {
    setLatexCode(newCode);
    setHasUnsavedChanges(true);

    // Debounced save
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      onUpdate?.(doc.id, { latex_code: newCode, code_type: codeType });
      setHasUnsavedChanges(false);
    }, 1200);

    // Debounced preview — always re-render (preview is main view now)
    if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    previewTimeoutRef.current = setTimeout(() => {
      if (newCode.trim()) {
        onRenderPreview?.(doc.id, newCode, doc.latex_block?.custom_metadata?.metadata_values || {}, codeType, exportDraft?.processing_settings);
      }
    }, 2000);
  }, [doc?.id, codeType, onUpdate, onRenderPreview]);

  // ── Manual save ────────────────────────────────────────────────────

  const handleSave = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    onUpdate?.(doc.id, {
      title,
      author,
      document_type: documentType,
      category,
      latex_code: latexCode,
      code_type: codeType,
    });
    setHasUnsavedChanges(false);
    // Refresh preview after save
    if (latexCode.trim()) {
      setTimeout(() => onRenderPreview?.(doc.id, latexCode, {}, codeType, exportDraft?.processing_settings), 300);
    }
  }, [doc?.id, title, author, documentType, category, latexCode, codeType, onUpdate, onRenderPreview]);

  // Ctrl/Cmd+S
  useEffect(() => {
    const handleKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleSave]);

  // Cleanup
  useEffect(() => () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
  }, []);

  // ── AI Generate callback — refresh code + preview after ────────────

  const handleAIGenerate = useCallback(async (data) => {
    // Pass code_type to AI generation
    const genData = { ...data, code_type: codeType };
    const result = await onAIGenerate?.(doc.id, genData);
    const resultCodeType = result?.code_type || codeType;
    if (result?.code_type) setCodeType(result.code_type);
    if (result?.latex_code) {
      setLatexCode(result.latex_code);
      // Render preview — AI sidebar stays open so user sees changes alongside
      setTimeout(() => {
        onRenderPreview?.(doc.id, result.latex_code, {}, resultCodeType, exportDraft?.processing_settings);
        onFetchPlaceholders?.(doc.id);
      }, 400);
    } else if (result?.document) {
      const newCode = result.document.latex_block?.latex_code || result.document.latex_code || '';
      if (newCode) setLatexCode(newCode);
      setTimeout(() => {
        onRenderPreview?.(doc.id, newCode, {}, resultCodeType, exportDraft?.processing_settings);
        onFetchPlaceholders?.(doc.id);
      }, 400);
    }
  }, [doc?.id, codeType, onAIGenerate, onRenderPreview, onFetchPlaceholders]);

  // ── Undo AI edit callback — revert code + refresh preview ──────────

  const handleUndo = useCallback(async (messageId, previousCode) => {
    if (!doc?.id) return;
    const result = await onUndoEdit?.(doc.id, messageId, previousCode);
    if (result) {
      const reverted = result.latex_block?.latex_code || result.latex_code || previousCode;
      setLatexCode(reverted);
      setTimeout(() => {
        onRenderPreview?.(doc.id, reverted, {}, codeType, exportDraft?.processing_settings);
      }, 400);
    }
  }, [doc?.id, codeType, onUndoEdit, onRenderPreview]);

  // ── Clear chat callback ────────────────────────────────────────────

  const handleClearChat = useCallback(() => {
    if (doc?.id) onClearChat?.(doc.id);
  }, [doc?.id, onClearChat]);

  // ── Switch code type handler ───────────────────────────────────────

  const handleSwitchCodeType = useCallback(async (convert = false) => {
    const newType = codeType === 'latex' ? 'html' : 'latex';
    setSwitchingCodeType(true);
    try {
      const result = await onSwitchCodeType?.(doc.id, newType, convert);
      if (result?.document) {
        const newCode = result.document.latex_block?.latex_code || result.document.latex_code || '';
        setLatexCode(newCode);
        setCodeType(newType);
        // Trigger preview for new code type
        if (newCode.trim()) {
          setTimeout(() => onRenderPreview?.(doc.id, newCode, {}, newType, exportDraft?.processing_settings), 300);
        }
      } else {
        setCodeType(newType);
      }
    } finally {
      setSwitchingCodeType(false);
    }
  }, [doc?.id, codeType, onSwitchCodeType, onRenderPreview]);

  // ── Computed ───────────────────────────────────────────────────────

  const lineCount = useMemo(() => (latexCode || '').split('\n').length, [latexCode]);
  const charCount = useMemo(() => (latexCode || '').length, [latexCode]);

  // Extract image placeholder UUIDs from current code
  const imageplaceholders = useMemo(() => {
    if (!latexCode) return [];
    const matches = latexCode.match(/\[\[image:([0-9a-fA-F-]{36})\]\]/g) || [];
    return [...new Set(matches.map((m) => m.replace('[[image:', '').replace(']]', '')))];
  }, [latexCode]);

  // ── Insert image placeholder into code at cursor ───────────────────

  const handleInsertImagePlaceholder = useCallback((placeholderString) => {
    // If code editor is open and has a cursor, insert at cursor
    if (editorRef.current) {
      const textarea = editorRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newCode = latexCode.slice(0, start) + placeholderString + latexCode.slice(end);
      setLatexCode(newCode);
      handleCodeChange(newCode);

      // Restore cursor position after the inserted text
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + placeholderString.length;
        textarea.focus();
      }, 50);
    } else {
      // Append at end
      const newCode = latexCode + '\n' + placeholderString;
      setLatexCode(newCode);
      handleCodeChange(newCode);
    }

    // Show code editor if not already visible
    if (!showCode) setShowCode(true);
  }, [latexCode, handleCodeChange, showCode]);

  // ── Remove image placeholder from code ─────────────────────────────

  const handleRemoveImagePlaceholder = useCallback((uuid) => {
    const pattern = `[[image:${uuid}]]`;
    const newCode = latexCode.split(pattern).join('');
    setLatexCode(newCode);
    handleCodeChange(newCode);
  }, [latexCode, handleCodeChange]);

  if (!doc) return null;

  const hasPlaceholders = placeholders && placeholders.length > 0;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* ═══════════════════════ TOP BAR ═══════════════════════════════ */}
      <header className="flex items-center justify-between h-12 px-4 border-b border-gray-100 bg-white flex-shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={onBack}
            className="p-1 rounded-md hover:bg-gray-100 text-gray-400 transition-colors"
            aria-label="Back to documents"
          >
            <ArrowLeft size={18} />
          </button>

          <span className="w-px h-5 bg-gray-200" aria-hidden="true" />

          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); setHasUnsavedChanges(true); }}
            onBlur={() => { if (title !== doc.title) onUpdate?.(doc.id, { title }); }}
            className="text-sm font-medium text-gray-900 bg-transparent border-none focus:outline-none focus:ring-0 min-w-[180px] truncate"
            placeholder="Document title…"
            aria-label="Document title"
          />

          {hasUnsavedChanges && (
            <span className="text-[10px] text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded font-medium">
              Unsaved
            </span>
          )}
          {saving && (
            <Loader2 size={14} className="animate-spin text-blue-400" />
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* AI Chat toggle */}
          <button
            onClick={() => setRightPanel(rightPanel === 'ai' ? null : 'ai')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              rightPanel === 'ai'
                ? 'bg-violet-600 text-white'
                : 'text-violet-600 hover:bg-violet-50'
            }`}
          >
            <Sparkles size={13} />
            <span className="hidden sm:inline">AI</span>
            {chatMessages.length > 0 && rightPanel !== 'ai' && (
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
            )}
          </button>

          {/* Images sidebar toggle */}
          <button
            onClick={() => setRightPanel(rightPanel === 'images' ? null : 'images')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              rightPanel === 'images'
                ? 'bg-purple-600 text-white'
                : 'text-purple-600 hover:bg-purple-50'
            }`}
            title="Image library"
          >
            <ImageIcon size={13} />
            <span className="hidden sm:inline">Images</span>
            {imageplaceholders.length > 0 && rightPanel !== 'images' && (
              <span className="min-w-[16px] h-4 flex items-center justify-center rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold px-1">
                {imageplaceholders.length}
              </span>
            )}
          </button>

          {/* Export Studio toggle */}
          <button
            onClick={() => setRightPanel(rightPanel === 'export' ? null : 'export')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              rightPanel === 'export'
                ? 'bg-blue-600 text-white'
                : 'text-blue-600 hover:bg-blue-50'
            }`}
            title="Export Studio — headers, footers, margins, layout"
          >
            <Settings2 size={13} />
            <span className="hidden sm:inline">Export</span>
          </button>

          {/* Code type toggle */}
          <button
            onClick={() => handleSwitchCodeType(false)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (window.confirm(`Convert ${codeType === 'latex' ? 'LaTeX' : 'HTML'} → ${codeType === 'latex' ? 'HTML' : 'LaTeX'} via AI?`)) {
                handleSwitchCodeType(true);
              }
            }}
            disabled={switchingCodeType}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
              codeType === 'html'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
            } hover:shadow-sm disabled:opacity-40`}
            title={`${codeType === 'latex' ? 'LaTeX' : 'HTML'} · Click switch · Right-click convert`}
          >
            {switchingCodeType ? (
              <Loader2 size={12} className="animate-spin" />
            ) : codeType === 'html' ? (
              <Globe size={12} />
            ) : (
              <Code size={12} />
            )}
            <span>{codeType === 'html' ? 'HTML' : 'LaTeX'}</span>
            <ArrowRightLeft size={10} className="opacity-50" />
          </button>

          {/* Duplicate */}
          <button
            onClick={() => setShowDuplicate(true)}
            className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 transition-colors"
            title="Duplicate"
          >
            <Copy size={15} />
          </button>

          {/* Code editor toggle */}
          <button
            onClick={() => setShowCode(!showCode)}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
              showCode
                ? 'bg-gray-900 text-white'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
            title={showCode ? 'Hide code' : 'Show code'}
          >
            <Code size={13} />
            <span className="hidden sm:inline">Code</span>
          </button>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40 transition-colors"
          >
            <Save size={13} />
            Save
          </button>

          {/* Delete */}
          <button
            onClick={() => {
              if (window.confirm('Delete this document permanently?')) onDelete?.(doc.id);
            }}
            className="p-1.5 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </header>

      {/* ═══════════════════ METADATA STRIP (always visible) ═══════════ */}
      <div className="flex items-center gap-3 px-4 py-1.5 border-b border-gray-100 bg-gray-50/60 flex-shrink-0 overflow-x-auto">
        {/* Author */}
        <div className="flex items-center gap-1.5 min-w-0">
          <User size={11} className="text-gray-400 flex-shrink-0" />
          <input
            value={author}
            onChange={(e) => { setAuthor(e.target.value); setHasUnsavedChanges(true); }}
            onBlur={() => { if (author !== doc.author) onUpdate?.(doc.id, { author }); }}
            className="text-[11px] text-gray-700 bg-transparent border-none focus:outline-none focus:ring-0 w-[100px] placeholder-gray-400"
            placeholder="Author…"
          />
        </div>

        <span className="w-px h-4 bg-gray-200 flex-shrink-0" />

        {/* Type */}
        <div className="flex items-center gap-1 min-w-0">
          <FileText size={11} className="text-gray-400 flex-shrink-0" />
          <select
            value={documentType}
            onChange={(e) => { setDocumentType(e.target.value); setHasUnsavedChanges(true); }}
            className="text-[11px] text-gray-700 bg-transparent border-none focus:outline-none focus:ring-0 cursor-pointer pr-4 appearance-none"
          >
            <option value="contract">Contract</option>
            <option value="policy">Policy</option>
            <option value="nda">NDA</option>
            <option value="legal_brief">Legal Brief</option>
            <option value="terms">Terms & Conditions</option>
            <option value="license">License</option>
            <option value="other">Other</option>
          </select>
        </div>

        <span className="w-px h-4 bg-gray-200 flex-shrink-0" />

        {/* Category */}
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value); setHasUnsavedChanges(true); }}
          className="text-[11px] text-gray-600 bg-transparent border-none focus:outline-none focus:ring-0 cursor-pointer pr-4 appearance-none"
        >
          <option value="contract">Contract</option>
          <option value="policy">Policy</option>
          <option value="regulation">Regulation</option>
          <option value="nda">NDA</option>
          <option value="license">License</option>
          <option value="other">Other</option>
        </select>

        <span className="w-px h-4 bg-gray-200 flex-shrink-0" />

        {/* Effective date */}
        <div className="flex items-center gap-1 min-w-0">
          <Calendar size={11} className="text-gray-400 flex-shrink-0" />
          <input
            type="date"
            value={doc.effective_date || ''}
            onChange={(e) => onUpdate?.(doc.id, { effective_date: e.target.value || null })}
            className="text-[11px] text-gray-600 bg-transparent border-none focus:outline-none focus:ring-0 w-[110px]"
            title="Effective date"
          />
        </div>

        {/* Expiry date */}
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-[10px] text-gray-400 flex-shrink-0">→</span>
          <input
            type="date"
            value={doc.expiration_date || ''}
            onChange={(e) => onUpdate?.(doc.id, { expiration_date: e.target.value || null })}
            className="text-[11px] text-gray-600 bg-transparent border-none focus:outline-none focus:ring-0 w-[110px]"
            title="Expiration date"
          />
        </div>

        <span className="w-px h-4 bg-gray-200 flex-shrink-0" />

        {/* Status + version */}
        <div className="flex items-center gap-2 text-[10px] text-gray-400 flex-shrink-0 ml-auto">
          <span className="capitalize text-gray-500">{doc.status}</span>
          <span>v{doc.version}</span>
        </div>
      </div>

      {/* ═══════════════════════ MAIN AREA ═════════════════════════════ */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left panel: Code + Placeholders ──────────────────────────── */}
        {(showCode || hasPlaceholders) && (
          <div className={`flex flex-col min-w-0 ${showCode ? 'w-[45%] max-w-[600px]' : 'w-[280px]'} border-r border-gray-100`}>
            {/* Code Editor */}
            {showCode && (
              <div className="flex flex-col flex-1 min-h-0">
                {/* Editor chrome bar */}
                <div className="flex items-center justify-between px-3 py-1.5 bg-[#1e1e2e] text-gray-400 flex-shrink-0">
                  <div className="flex items-center gap-2 text-[11px]">
                    {codeType === 'html' ? <Globe size={12} className="text-emerald-400" /> : <Code size={12} />}
                    <span className={codeType === 'html' ? 'text-emerald-400' : ''}>{codeType === 'html' ? 'HTML' : 'LaTeX'}</span>
                    <span className="text-gray-600">·</span>
                    <span className="text-gray-600">{lineCount} lines</span>
                    <span className="text-gray-600">·</span>
                    <span className="text-gray-600">{charCount.toLocaleString()} chars</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {doc.latex_block?.edit_count > 0 && (
                      <span className="text-[10px] text-gray-600">
                        {doc.latex_block.edit_count} edits
                      </span>
                    )}
                    <button
                      onClick={() => setShowCode(false)}
                      className="p-0.5 rounded hover:bg-white/10 text-gray-500 transition-colors"
                      title="Hide code"
                    >
                      <EyeOff size={12} />
                    </button>
                  </div>
                </div>

                {/* Code textarea */}
                <textarea
                  ref={editorRef}
                  value={latexCode}
                  onChange={(e) => handleCodeChange(e.target.value)}
                  className={`flex-1 w-full p-4 bg-[#1e1e2e] font-mono text-[13px] resize-none focus:outline-none leading-6 caret-[#cdd6f4] ${
                    codeType === 'html' ? 'text-[#89dceb]' : 'text-[#a6e3a1]'
                  }`}
                  spellCheck={false}
                  style={{ tabSize: 2 }}
                />
              </div>
            )}

            {/* Placeholders section (below code, or standalone — always visible when placeholders exist) */}
            {hasPlaceholders && (
              <div className={`${showCode ? 'border-t border-gray-200 max-h-[40%]' : 'flex-1'} overflow-y-auto bg-white`}>
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 sticky top-0 bg-white z-10">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-gray-600">
                    <Zap size={12} className="text-blue-500" />
                    Placeholder Fields
                    <span className="text-[10px] text-gray-400 font-normal">({placeholders.length})</span>
                  </div>
                </div>
                <div className="p-3">
                  <PlaceholderForm
                    placeholders={placeholders}
                    documentMetadata={doc.document_metadata || {}}
                    onUpdate={(metadata) => {
                      onUpdateMetadata?.(doc.id, metadata);
                      setTimeout(() => {
                        if (latexCode.trim()) {
                          onRenderPreview?.(doc.id, latexCode, metadata, codeType, exportDraft?.processing_settings);
                        }
                        onFetchPlaceholders?.(doc.id);
                      }, 500);
                    }}
                    onRefresh={() => onFetchPlaceholders?.(doc.id)}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PDF Preview (always visible — main centre view) ─────────── */}
        <div className="flex flex-col flex-1 min-w-0 bg-gray-50">
          {/* Preview header */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 bg-white flex-shrink-0">
            <div className="flex items-center gap-2 text-[11px] text-gray-500 font-medium">
              <Eye size={12} />
              Preview
              {codeType === 'html' && <span className="text-emerald-500">(HTML)</span>}
              {previewPages.length > 1 && (
                <span className="text-gray-400">· {previewPages.length} pages</span>
              )}
              {previewLoading && <Loader2 size={11} className="animate-spin text-blue-400" />}
            </div>
            <div className="flex items-center gap-1">
              {previewPdfUrl && (
                <a
                  href={previewPdfUrl}
                  download={`${doc.title || 'document'}.pdf`}
                  className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors"
                  title="Download PDF"
                >
                  <Download size={13} />
                </a>
              )}
              <button
                onClick={() => onRenderPreview?.(doc.id, latexCode, {}, codeType, exportDraft?.processing_settings)}
                disabled={previewLoading}
                className="p-1 rounded hover:bg-gray-100 text-gray-400 disabled:opacity-30 transition-colors"
                title="Refresh"
              >
                <RefreshCw size={13} className={previewLoading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            {/* HTML instant preview (if HTML mode and no rendered pages yet) */}
            {codeType === 'html' && latexCode.trim() && previewPages.length === 0 && !previewLoading && (
              <iframe
                srcDoc={latexCode}
                title="HTML Preview"
                className="w-full h-full border-0"
                sandbox="allow-same-origin"
                style={{ minHeight: '400px' }}
              />
            )}

            {/* Loading state */}
            {previewLoading && previewPages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-gray-300 p-4">
                <Loader2 size={28} className="animate-spin mb-3" />
                <p className="text-xs">Rendering…</p>
              </div>
            )}

            {/* Error state — rich error panel */}
            {previewError && (() => {
              const err = typeof previewError === 'object' ? previewError : { message: previewError };
              const errorLines = err.errorLines || [];
              const missingPkgs = err.missingPackages || [];
              const hasUndoable = chatMessages.length > 0;
              return (
                <div className="flex flex-col gap-3 p-4">
                  {/* Error banner */}
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <div className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <AlertTriangle size={14} className="text-red-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-red-700 mb-0.5">Compilation Error</p>
                        <p className="text-[11px] text-red-600 leading-relaxed">{err.message || 'Render failed'}</p>
                        {err.hint && (
                          <p className="text-[10px] text-amber-600 mt-1 italic">{err.hint}</p>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 mt-2.5 ml-9">
                      <button
                        onClick={() => onRenderPreview?.(doc.id, latexCode, {}, codeType, exportDraft?.processing_settings)}
                        className="text-[11px] text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                      >
                        <RefreshCw size={11} />
                        Retry
                      </button>
                      {hasUndoable && (
                        <button
                          onClick={() => {
                            // Find the last AI message with previous_code and undo it
                            const lastAI = [...chatMessages].reverse().find(m => m.role === 'assistant' && m.previous_code);
                            if (lastAI) handleUndo(lastAI.id, lastAI.previous_code);
                          }}
                          className="text-[11px] text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1 px-2 py-1 rounded hover:bg-amber-50 transition-colors"
                        >
                          <Undo2 size={11} />
                          Undo AI change
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Error details (collapsible) */}
                  {errorLines.length > 0 && (
                    <ErrorDetails errorLines={errorLines} missingPackages={missingPkgs} />
                  )}

                  {/* Show stale preview underneath if available */}
                  {previewPages.length > 0 && (
                    <div className="relative">
                      <div className="absolute inset-0 bg-white/40 z-10 pointer-events-none rounded-md" />
                      <p className="text-[10px] text-gray-400 text-center mb-1">Last working preview</p>
                      {previewPages.map((pageSrc, idx) => (
                        <img
                          key={idx}
                          src={pageSrc}
                          alt={`Page ${idx + 1} (stale)`}
                          className="w-full rounded-md border border-gray-200 shadow-sm bg-white opacity-60"
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Multi-page PDF preview — scrollable list of all pages */}
            {!previewLoading && !previewError && previewPages.length > 0 && (
              <div className="flex flex-col items-center gap-4 p-4">
                {previewPages.map((pageSrc, idx) => (
                  <div key={idx} className="relative w-full max-w-[700px]">
                    {previewPages.length > 1 && (
                      <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] font-medium px-2 py-0.5 rounded-full z-10">
                        {idx + 1} / {previewPages.length}
                      </div>
                    )}
                    <img
                      src={pageSrc}
                      alt={`Page ${idx + 1}`}
                      className="w-full rounded-md border border-gray-200 shadow-sm bg-white"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {!previewLoading && !previewError && previewPages.length === 0 && !(codeType === 'html' && latexCode.trim()) && (
              <div className="flex flex-col items-center justify-center h-full text-gray-300 p-4">
                <BookOpen size={28} className="mb-2 opacity-40" />
                <p className="text-xs text-gray-400">No preview yet</p>
                <p className="text-[10px] text-gray-400 mt-1">
                  {latexCode.trim() ? 'Click refresh to render' : 'Write code or use AI to generate'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── AI Chat Sidebar (alongside preview) ─────────────────────── */}
        {rightPanel === 'ai' && (
          <div className="w-[360px] min-w-[300px] flex-shrink-0 border-l border-gray-200">
            <AIChatPanel
              generating={generating}
              onGenerate={handleAIGenerate}
              onClose={() => setRightPanel(null)}
              onUndo={handleUndo}
              onClearChat={handleClearChat}
              hasExistingCode={!!latexCode.trim()}
              codeType={codeType}
              chatMessages={chatMessages}
            />
          </div>
        )}

        {/* ── Image Sidebar (alongside preview) ──────────────────────── */}
        {rightPanel === 'images' && (
          <div className="w-[320px] min-w-[280px] flex-shrink-0 border-l border-gray-200">
            <QuickLatexImageSidebar
              documentId={doc.id}
              imageplaceholders={imageplaceholders}
              imageSlots={imageSlots}
              resolvedImages={resolvedImages}
              onInsertPlaceholder={handleInsertImagePlaceholder}
              onRemovePlaceholder={handleRemoveImagePlaceholder}
              onMapImage={onMapImage}
              onClose={() => setRightPanel(null)}
              onResolveImages={onResolveImages}
            />
          </div>
        )}

        {/* ── Export Studio Sidebar (alongside preview) ──────────────── */}
        {rightPanel === 'export' && (
          <div className="w-[380px] min-w-[340px] flex-shrink-0 border-l border-gray-200 overflow-y-auto bg-gray-50/40">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-white sticky top-0 z-10">
              <div className="flex items-center gap-2">
                <Settings2 size={14} className="text-blue-600" />
                <span className="text-sm font-semibold text-gray-800">Export Studio</span>
              </div>
              <button
                onClick={() => setRightPanel(null)}
                className="p-1 rounded-md hover:bg-gray-100 text-gray-400 transition-colors"
                aria-label="Close export studio"
              >
                <EyeOff size={14} />
              </button>
            </div>
            <div className="p-3">
              <ExportSettingsPanel
                documentId={doc.id}
                exportDraft={exportDraft}
                exportLoading={exportLoading}
                exportSaving={exportSaving}
                exportError={exportError}
                exportDirty={exportDirty}
                templates={exportTemplates}
                images={exportImages}
                pdfFiles={exportPdfFiles}
                metadataSnapshot={exportMetadataSnapshot}
                onUpdate={onUpdateExportSetting}
                onSave={onSaveExportSettings}
                onReset={onResetExportSettings}
                onUploadImage={onUploadExportImage}
                onUploadPdfFile={onUploadExportPdfFile}
                onSaveHeaderFooterPdf={onSaveHeaderFooterPdf}
                onRemoveHeaderFooterPdf={onRemoveHeaderFooterPdf}
                onRefreshPreview={onRefreshExportPreview}
              />
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════ DIALOGS ═══════════════════════════════ */}
      {showDuplicate && (
        <DuplicateDialog
          document={doc}
          onDuplicate={(data) => { onDuplicate?.(doc.id, data); setShowDuplicate(false); }}
          onBulkDuplicate={() => { setShowDuplicate(false); setShowBulkDuplicate(true); }}
          onClose={() => setShowDuplicate(false)}
        />
      )}

      {showBulkDuplicate && (
        <BulkDuplicateDialog
          document={doc}
          placeholders={placeholders}
          onSubmit={(copies) => { onBulkDuplicate?.(doc.id, copies); setShowBulkDuplicate(false); }}
          onClose={() => setShowBulkDuplicate(false)}
        />
      )}
    </div>
  );
};

/* ── Tiny field wrapper (kept for potential reuse) ───────────────────── */

const FieldGroup = ({ label, children }) => (
  <div>
    <label className="block text-[11px] font-medium text-gray-500 mb-1 uppercase tracking-wider">
      {label}
    </label>
    {children}
  </div>
);

export default QuickLatexEditor;