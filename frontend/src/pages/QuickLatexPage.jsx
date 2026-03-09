/**
 * QuickLatexPage
 *
 * Full-page view for managing Quick LaTeX documents — search, list,
 * create, AI-generate, duplicate, bulk-duplicate.
 *
 * Two modes:
 *  1. List view  — card grid with search/filters
 *  2. Editor view — full QuickLatexEditor for the selected document
 */

import { useCallback, useEffect, useState, useRef } from 'react';
import {
  Check,
  Code,
  Copy,
  FileText,
  Loader2,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  Trash2,
  X,
  Eye,
  Layers,
  ArrowLeft,
  ChevronRight,
} from 'lucide-react';
import useQuickLatex from '../hooks/useQuickLatex';
import quickLatexService from '../services/quickLatexService';
import { QuickLatexEditor } from '../components/quicklatex';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DOC_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'contract', label: 'Contract' },
  { value: 'policy', label: 'Policy' },
  { value: 'nda', label: 'NDA' },
  { value: 'legal_brief', label: 'Legal Brief' },
  { value: 'terms', label: 'Terms & Conditions' },
  { value: 'license', label: 'License' },
  { value: 'other', label: 'Other' },
];

/* ------------------------------------------------------------------ */
/*  Badge                                                              */
/* ------------------------------------------------------------------ */

const Badge = ({ children, color = 'gray' }) => {
  const colors = {
    gray: 'bg-gray-100 text-gray-700',
    blue: 'bg-blue-100 text-blue-700',
    green: 'bg-green-100 text-green-700',
    purple: 'bg-purple-100 text-purple-700',
    amber: 'bg-amber-100 text-amber-700',
    indigo: 'bg-indigo-100 text-indigo-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[color] || colors.gray}`}>
      {children}
    </span>
  );
};

/* ------------------------------------------------------------------ */
/*  QuickLatexCard                                                     */
/* ------------------------------------------------------------------ */

const QuickLatexCard = ({ doc, onSelect, onDuplicate, onDelete }) => {
  const [menuOpen, setMenuOpen] = useState(false);

  const placeholderCount = doc.placeholders?.length || 0;
  const preview = (doc.latex_block?.latex_code || '').slice(0, 120);

  return (
    <div
      className="group bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer"
      onClick={() => onSelect(doc)}
    >
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="bg-indigo-50 p-1.5 rounded flex-shrink-0">
              <Code size={14} className="text-indigo-600" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900 truncate">{doc.title}</h3>
          </div>

          {/* Action menu */}
          <div className="relative flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              className="p-1 rounded hover:bg-gray-100 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreVertical size={14} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 mt-1 w-40 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-20">
                  <button
                    onClick={(e) => { e.stopPropagation(); onDuplicate?.(doc); setMenuOpen(false); }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Copy size={13} /> Duplicate
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete "${doc.title}"?`)) onDelete?.(doc.id);
                      setMenuOpen(false);
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Meta badges */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          <Badge color="indigo">{doc.document_type || 'contract'}</Badge>
          <Badge color={doc.status === 'draft' ? 'gray' : doc.status === 'finalized' ? 'green' : 'blue'}>
            {doc.status}
          </Badge>
          {placeholderCount > 0 && (
            <Badge color="purple">{placeholderCount} fields</Badge>
          )}
        </div>

        {/* Code preview */}
        {preview && (
          <pre className="text-xs font-mono text-gray-500 bg-gray-50 rounded p-2 mb-2 overflow-hidden leading-relaxed" style={{ maxHeight: '3.6rem' }}>
            {preview}{preview.length >= 120 ? '…' : ''}
          </pre>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-gray-400 pt-1 border-t border-gray-100">
          <span>{doc.author || '—'}</span>
          <span>{new Date(doc.updated_at).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  CreateDialog                                                       */
/* ------------------------------------------------------------------ */

const CreateDialog = ({ onSubmit, onClose, isCreating = false }) => {
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState('contract');
  const [category, setCategory] = useState('contract');
  const [latexCode, setLatexCode] = useState('');
  const [mode, setMode] = useState('blank'); // 'blank' | 'ai' | 'code'
  const [aiPrompt, setAiPrompt] = useState('');

  // ── AI Preview state ──────────────────────────────────────────────
  const [previewCode, setPreviewCode] = useState('');
  const [previewCodeType, setPreviewCodeType] = useState('latex');
  const [previewPlaceholders, setPreviewPlaceholders] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const previewRef = useRef(null);

  const showingPreview = mode === 'ai' && !!previewCode;

  /** Request an AI preview (no document created yet) */
  const handleGeneratePreview = async () => {
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const res = await quickLatexService.aiPreview({
        prompt: aiPrompt.trim(),
        title: title.trim() || 'Untitled Document',
        document_type: docType,
        code_type: 'latex',
      });
      setPreviewCode(res.latex_code || '');
      setPreviewCodeType(res.code_type || 'latex');
      setPreviewPlaceholders(res.placeholders || []);
      // scroll to preview area
      setTimeout(() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    } catch (err) {
      setPreviewError(err?.response?.data?.message || err.message || 'AI generation failed.');
    } finally {
      setPreviewLoading(false);
    }
  };

  /** User accepts the preview — create doc with the AI code baked in */
  const handleAccept = () => {
    // Build initial document_metadata with placeholder keys seeded as empty strings
    const seedMeta = {};
    previewPlaceholders.forEach((key) => { seedMeta[key] = ''; });

    onSubmit({
      title: title.trim(),
      document_type: docType,
      category,
      latex_code: previewCode,
      document_metadata: seedMeta,
    });
  };

  /** Submit handler: for blank / code modes → direct create; for AI mode → preview first */
  const handleSubmit = (e) => {
    e.preventDefault();
    if (mode === 'ai') {
      // If already showing preview, this shouldn't fire (button is Accept instead)
      handleGeneratePreview();
      return;
    }
    onSubmit({
      title: title.trim(),
      document_type: docType,
      category,
      latex_code: mode === 'code' ? (latexCode || undefined) : undefined,
    });
  };

  const PROMPT_SUGGESTIONS = [
    'Draft a Non-Disclosure Agreement between two parties with mutual obligations',
    'Create an employment contract with standard clauses for salary, benefits, and termination',
    'Write a software license agreement for SaaS distribution',
    'Draft a commercial lease agreement for office space',
    'Create a consulting services agreement with payment terms and IP ownership',
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className={`bg-white rounded-xl shadow-2xl mx-4 transition-all duration-300 ${showingPreview ? 'w-full max-w-3xl' : 'w-full max-w-xl'}`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2 font-semibold text-gray-800">
            {showingPreview ? <Eye size={18} className="text-violet-600" /> : <Plus size={18} />}
            {showingPreview ? 'AI Preview — Review Before Creating' : 'New Quick LaTeX Document'}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400" disabled={previewLoading || isCreating}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* ── Form fields (collapsed when showing preview) ── */}
          {!showingPreview && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder="e.g. Standard NDA Template"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Document Type</label>
                  <select
                    value={docType}
                    onChange={(e) => setDocType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  >
                    {DOC_TYPES.filter((t) => t.value).map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  >
                    <option value="contract">Contract</option>
                    <option value="policy">Policy</option>
                    <option value="regulation">Regulation</option>
                    <option value="nda">NDA</option>
                    <option value="license">License</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              {/* ── Start mode selector ── */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">How do you want to start?</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setMode('blank')}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      mode === 'blank'
                        ? 'border-blue-400 bg-blue-50 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <FileText size={18} className={mode === 'blank' ? 'text-blue-600' : 'text-gray-400'} />
                    <p className={`text-xs font-semibold mt-1.5 ${mode === 'blank' ? 'text-blue-700' : 'text-gray-700'}`}>Blank</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">Empty document</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMode('ai'); setPreviewCode(''); setPreviewError(''); }}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      mode === 'ai'
                        ? 'border-violet-400 bg-violet-50 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <Sparkles size={18} className={mode === 'ai' ? 'text-violet-600' : 'text-gray-400'} />
                    <p className={`text-xs font-semibold mt-1.5 ${mode === 'ai' ? 'text-violet-700' : 'text-gray-700'}`}>AI Draft</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">AI writes it for you</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('code')}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      mode === 'code'
                        ? 'border-emerald-400 bg-emerald-50 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <Code size={18} className={mode === 'code' ? 'text-emerald-600' : 'text-gray-400'} />
                    <p className={`text-xs font-semibold mt-1.5 ${mode === 'code' ? 'text-emerald-700' : 'text-gray-700'}`}>Paste Code</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">Your own LaTeX</p>
                  </button>
                </div>
              </div>

              {/* ── AI prompt ── */}
              {mode === 'ai' && (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Describe the document you want <span className="text-violet-500">*</span>
                  </label>
                  <textarea
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    required={mode === 'ai'}
                    placeholder="e.g. Draft a Non-Disclosure Agreement between two companies with mutual obligations, 2-year term, and New York governing law"
                    rows={3}
                    className="w-full px-3 py-2 border border-violet-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-300 focus:border-violet-400 resize-none bg-violet-50/30"
                  />
                  {/* Quick suggestions */}
                  <div className="flex flex-wrap gap-1.5">
                    {PROMPT_SUGGESTIONS.slice(0, 3).map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => { setAiPrompt(s); if (!title) setTitle(s.split(' ').slice(0, 5).join(' ')); }}
                        className="text-[10px] px-2 py-1 rounded-full bg-violet-100 text-violet-700 hover:bg-violet-200 transition-colors truncate max-w-[200px]"
                      >
                        {s.length > 50 ? s.slice(0, 50) + '…' : s}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400 flex items-center gap-1">
                    <Sparkles size={10} className="text-violet-400" />
                    AI will generate a preview first — you can review and accept before the document is created
                  </p>
                </div>
              )}

              {/* ── Manual code ── */}
              {mode === 'code' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Initial LaTeX Code</label>
                  <textarea
                    value={latexCode}
                    onChange={(e) => setLatexCode(e.target.value)}
                    placeholder={"\\documentclass{article}\n\\begin{document}\n\nHello [[client_name]]!\n\n\\end{document}"}
                    rows={5}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
              )}
            </>
          )}

          {/* ── AI Preview panel ── */}
          {showingPreview && (
            <div ref={previewRef} className="space-y-3">
              {/* Compact summary of what's being created */}
              <div className="flex items-center gap-3 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                <span className="font-medium text-gray-800 truncate">{title || 'Untitled'}</span>
                <span className="text-gray-300">·</span>
                <span className="text-xs text-gray-500">{docType}</span>
                <span className="text-gray-300">·</span>
                <span className="text-xs text-violet-600 truncate flex-1">{aiPrompt.length > 80 ? aiPrompt.slice(0, 80) + '…' : aiPrompt}</span>
              </div>

              {/* Extracted placeholders */}
              {previewPlaceholders.length > 0 && (
                <div className="bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
                  <p className="text-[11px] font-medium text-violet-700 mb-1.5">
                    <Tag size={11} className="inline mr-1" />
                    {previewPlaceholders.length} metadata field{previewPlaceholders.length !== 1 ? 's' : ''} detected
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {previewPlaceholders.map((key) => (
                      <span key={key} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-100 text-violet-700">
                        [[{key}]]
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-violet-500 mt-1.5">
                    These will be auto-created as fillable metadata fields in your document.
                  </p>
                </div>
              )}

              {/* Code preview */}
              <div className="relative">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {previewCodeType === 'html' ? 'HTML' : 'LaTeX'} Preview
                  </span>
                  <span className="text-[10px] text-gray-400">{previewCode.split('\n').length} lines</span>
                </div>
                <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs font-mono overflow-auto whitespace-pre-wrap leading-relaxed" style={{ maxHeight: '40vh' }}>
                  {previewCode}
                </pre>
              </div>

              {/* Edit prompt inline */}
              <div className="flex items-center gap-2">
                <input
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Refine your prompt and regenerate..."
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-300 focus:border-violet-400"
                />
                <button
                  type="button"
                  onClick={handleGeneratePreview}
                  disabled={previewLoading || !aiPrompt.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
                >
                  {previewLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Regenerate
                </button>
              </div>
            </div>
          )}

          {/* ── Preview loading overlay ── */}
          {previewLoading && !showingPreview && (
            <div className="flex flex-col items-center gap-2 py-6 text-violet-600">
              <Loader2 size={28} className="animate-spin" />
              <p className="text-sm font-medium">AI is generating a preview…</p>
              <p className="text-[10px] text-gray-400">This may take 10–30 seconds</p>
            </div>
          )}

          {/* ── Preview error ── */}
          {previewError && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {previewError}
            </div>
          )}

          {/* ── Action buttons ── */}
          <div className="flex justify-end gap-2 pt-2">
            {showingPreview ? (
              <>
                <button
                  type="button"
                  onClick={() => { setPreviewCode(''); setPreviewError(''); setPreviewPlaceholders([]); }}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg"
                >
                  <ArrowLeft size={14} className="inline mr-1" />
                  Back to Edit
                </button>
                <button
                  type="button"
                  onClick={handleAccept}
                  disabled={isCreating}
                  className="px-4 py-2 text-sm text-white bg-green-600 hover:bg-green-700 rounded-lg flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                >
                  {isCreating ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Creating…
                    </>
                  ) : (
                    <>
                      <Check size={14} />
                      Accept & Create Document
                    </>
                  )}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating || previewLoading || (mode === 'ai' && !aiPrompt.trim())}
                  className={`px-4 py-2 text-sm text-white rounded-lg flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                    mode === 'ai'
                      ? 'bg-violet-600 hover:bg-violet-700'
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {previewLoading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Generating Preview…
                    </>
                  ) : mode === 'ai' ? (
                    <>
                      <Eye size={14} />
                      Generate Preview
                    </>
                  ) : (
                    <>
                      <Plus size={14} />
                      Create
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  QuickLatexPage                                                     */
/* ------------------------------------------------------------------ */

const QuickLatexPage = () => {
  const {
    documents,
    selectedDocument,
    placeholders,
    imageSlots,
    renderedLatex,
    previewPages,
    previewPdfUrl,
    previewLoading,
    previewError,
    resolvedImages,
    loading,
    saving,
    generating,
    error,
    searchQuery,
    fetchDocuments,
    fetchDocument,
    createDocument,
    updateDocument,
    deleteDocument,
    duplicateDocument,
    bulkDuplicate,
    aiGenerate,
    undoToMessage,
    deleteChatHistory,
    fetchPlaceholders,
    updateMetadata,
    fetchRenderedLatex,
    resolveImages,
    mapImage,
    renderPreview,
    switchCodeType,
    setSearch,
    selectDocument,
    clearSelection,
    getChatMessages,
  } = useQuickLatex();

  const [showCreate, setShowCreate] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');

  // Initial load
  useEffect(() => {
    fetchDocuments();
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleCreate = useCallback(async (data) => {
    setIsCreating(true);
    try {
      // data already contains latex_code if user accepted an AI preview,
      // or is blank/code-mode data — no separate AI step needed.
      const doc = await createDocument(data);
      if (doc?.id) {
        await fetchDocument(doc.id);
      }
      setShowCreate(false);
    } catch (err) {
      console.error('Create failed:', err);
    } finally {
      setIsCreating(false);
    }
  }, [createDocument, fetchDocument]);

  const handleSelectCard = useCallback(async (doc) => {
    await fetchDocument(doc.id);
  }, [fetchDocument]);

  const handleDelete = useCallback(async (id) => {
    await deleteDocument(id);
  }, [deleteDocument]);

  const handleDuplicate = useCallback(async (doc) => {
    await duplicateDocument(doc.id, { title: `${doc.title} (Copy)` });
  }, [duplicateDocument]);

  // ── Filtering ─────────────────────────────────────────────────────────

  const filteredDocs = documents.filter((d) => {
    if (typeFilter && d.document_type !== typeFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        d.title?.toLowerCase().includes(q) ||
        d.author?.toLowerCase().includes(q) ||
        d.document_type?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // ── Editor view ───────────────────────────────────────────────────────

  if (selectedDocument) {
    return (
      <div className="h-full">
        <QuickLatexEditor
          document={selectedDocument}
          placeholders={placeholders}
          imageSlots={imageSlots}
          renderedLatex={renderedLatex}
          previewPages={previewPages}
          previewPdfUrl={previewPdfUrl}
          previewLoading={previewLoading}
          previewError={previewError}
          saving={saving}
          generating={generating}
          chatMessages={getChatMessages(selectedDocument.id)}
          resolvedImages={resolvedImages}
          onUpdate={updateDocument}
          onDelete={(id) => { deleteDocument(id); clearSelection(); }}
          onDuplicate={duplicateDocument}
          onBulkDuplicate={bulkDuplicate}
          onAIGenerate={aiGenerate}
          onFetchPlaceholders={fetchPlaceholders}
          onFetchRendered={fetchRenderedLatex}
          onRenderPreview={renderPreview}
          onSwitchCodeType={switchCodeType}
          onUpdateMetadata={updateMetadata}
          onUndoEdit={undoToMessage}
          onClearChat={deleteChatHistory}
          onResolveImages={resolveImages}
          onMapImage={mapImage}
          onBack={clearSelection}
        />
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-50 p-2 rounded-lg">
            <Code size={22} className="text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Quick LaTeX</h1>
            <p className="text-sm text-gray-500">Create and manage LaTeX documents with AI</p>
          </div>
        </div>

        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          New Document
        </button>
      </div>

      {/* Search + Filters */}
      <div className="flex items-center gap-3 px-6 py-3 bg-white border-b border-gray-100">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents..."
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100 text-gray-400"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-md text-sm text-gray-600"
        >
          {DOC_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        <span className="text-xs text-gray-400">
          {filteredDocs.length} document{filteredDocs.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mt-3 px-4 py-2 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading && documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Loader2 size={32} className="animate-spin mb-3" />
            <p className="text-sm">Loading documents...</p>
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Code size={40} className="mb-3 opacity-50" />
            <p className="text-sm font-medium text-gray-500 mb-1">
              {searchQuery || typeFilter ? 'No matching documents' : 'No Quick LaTeX documents yet'}
            </p>
            <p className="text-xs text-gray-400 mb-4">
              {searchQuery || typeFilter
                ? 'Try adjusting your filters'
                : 'Create your first Quick LaTeX document to get started'}
            </p>
            {!searchQuery && !typeFilter && (
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
              >
                <Plus size={14} />
                Create Document
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredDocs.map((doc) => (
              <QuickLatexCard
                key={doc.id}
                doc={doc}
                onSelect={handleSelectCard}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      {showCreate && (
        <CreateDialog onSubmit={handleCreate} onClose={() => setShowCreate(false)} isCreating={isCreating} />
      )}
    </div>
  );
};

export default QuickLatexPage;
