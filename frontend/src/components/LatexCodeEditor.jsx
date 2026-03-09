import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Code, GripVertical, Trash2, MessageCircle, Sparkles, Loader2, Table } from 'lucide-react';
import { documentService } from '../services';
import latexCodeService from '../services/latexCodeService';

const LatexCodeEditor = ({
  latexCode,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onFocusEditor,
  isPreviewMode = false,
  isFirst = false,
  isLast = false,
  isDraggable = true,
  sectionId,
  documentId,
  reviewCommentCount = null,
  onOpenReviewComments,
  onOpenMetadata,
}) => {
  const editorRef = useRef(null);
  const latexId = latexCode?.id || latexCode?.client_id;
  const resolvedCode = useMemo(
    () => latexCode?.latex_code ?? latexCode?.edited_code ?? '',
    [latexCode?.latex_code, latexCode?.edited_code]
  );
  const [text, setText] = useState(resolvedCode);
  const [isDragging, setIsDragging] = useState(false);
  const [viewMode, setViewMode] = useState('preview');
  const [previewImage, setPreviewImage] = useState(null);
  const [previewPdfUrl, setPreviewPdfUrl] = useState(null);
  const [previewSource, setPreviewSource] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // AI generation state
  const [showAIPrompt, setShowAIPrompt] = useState(
    () => !!(latexCode?.custom_metadata?.ai_prompt_open)
  );
  const [aiPrompt, setAIPrompt] = useState('');
  const [isAIGenerating, setIsAIGenerating] = useState(false);
  const [aiError, setAIError] = useState(null);
  const aiPromptRef = useRef(null);

  useEffect(() => {
    setText(resolvedCode);
    setPreviewSource(null);
    setPreviewImage(null);
    setPreviewPdfUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
    setPreviewError(null);
  }, [resolvedCode, latexId]);

  useEffect(() => {
    if (!isPreviewMode) return;
    setViewMode('preview');
  }, [isPreviewMode]);

  const buildPdfUrl = useCallback((base64) => {
    if (!base64) return null;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'application/pdf' });
    return URL.createObjectURL(blob);
  }, []);

  const loadPreview = useCallback(async () => {
    if (!documentId) {
      setPreviewError('Document not ready for preview yet.');
      return;
    }
    const source = text ?? resolvedCode;
    const needsTikz = /\\begin\{tikzpicture\}/.test(source) || /\\usetikzlibrary/.test(source);
    const preamble = needsTikz ? '\\usepackage{tikz}' : undefined;
    if (previewSource && previewSource === source && previewImage) return;
    setIsPreviewLoading(true);
    setPreviewError(null);
    try {
      const blockMetadata = latexCode?.custom_metadata?.metadata_values || {};
      const result = await documentService.renderLatex(documentId, {
        latex_code: source,
        preamble,
        metadata: blockMetadata,
      });
      if (result?.error) {
        throw new Error(result.error);
      }
      const png = result?.preview_png_base64 || result?.preview_png || null;
      const pdf = result?.pdf_base64 || result?.pdf || null;
      const nextPdfUrl = pdf ? buildPdfUrl(pdf) : null;
      setPreviewImage(png ? `data:image/png;base64,${png}` : null);
      setPreviewPdfUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return nextPdfUrl;
      });
      setPreviewSource(source);
    } catch (error) {
      const responseMessage = error?.response?.data?.error || error?.response?.data?.detail;
      setPreviewError(responseMessage || error?.message || 'Failed to render LaTeX preview.');
      setPreviewImage(null);
      setPreviewPdfUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return null;
      });
    } finally {
      setIsPreviewLoading(false);
    }
  }, [buildPdfUrl, documentId, latexCode?.custom_metadata?.metadata_values, previewImage, previewSource, resolvedCode, text]);

  useEffect(() => {
    if (viewMode !== 'preview') return;
    void loadPreview();
  }, [loadPreview, viewMode]);

  const trimmed = text.trim();
  const hasBegin = /\\begin\{[^}]+\}/.test(text);
  const hasEnd = /\\end\{[^}]+\}/.test(text);
  const showEmptyWarning = trimmed.length === 0;
  const showPairWarning = trimmed.length > 0 && !(hasBegin && hasEnd);

  const handleBlur = () => {
    if (text === resolvedCode) return;
    onUpdate?.({
      latex_code: text,
      edited_code: text,
      has_edits: true,
      topic: latexCode?.topic ?? '',
    });
  };

  // ── AI LaTeX generation ──
  const handleAIGenerate = useCallback(async () => {
    const prompt = aiPrompt.trim();
    if (!prompt || !documentId) return;
    setIsAIGenerating(true);
    setAIError(null);
    try {
      const result = await latexCodeService.generateLatex(documentId, prompt, {
        save: false,
        sectionId: sectionId || undefined,
        topic: prompt.slice(0, 100),
      });
      if (result?.status === 'success' && result?.latex_code) {
        setText(result.latex_code);
        onUpdate?.({
          latex_code: result.latex_code,
          edited_code: result.latex_code,
          has_edits: true,
          topic: prompt.slice(0, 255),
        });
        setShowAIPrompt(false);
        setAIPrompt('');
        setViewMode('code');
        // Clear preview so it re-renders on next switch
        setPreviewSource(null);
        setPreviewImage(null);
        setPreviewPdfUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
      } else {
        setAIError(result?.message || 'AI did not return valid LaTeX code.');
      }
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'AI generation failed.';
      setAIError(msg);
    } finally {
      setIsAIGenerating(false);
    }
  }, [aiPrompt, documentId, sectionId, onUpdate]);

  useEffect(() => {
    if (showAIPrompt && aiPromptRef.current) {
      aiPromptRef.current.focus();
    }
  }, [showAIPrompt]);

  const handleDragStart = (event) => {
    if (!isDraggable) return;
    setIsDragging(true);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', latexId);
  };

  const handleDragEnd = () => setIsDragging(false);

  return (
    <div
      className={`latex-code-editor-container mb-3 relative group flex items-start gap-2 overflow-visible ${isDragging ? 'opacity-50' : ''}`}
      data-metadata-anchor="latex"
      data-metadata-id={latexId}
      data-latex-id={latexId}
      data-section-id={sectionId}
    >
      {isDraggable && (
        <div
          draggable={true}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          className="flex-shrink-0 mt-2 cursor-move opacity-0 group-hover:opacity-100 transition-opacity"
          title="Drag to reorder"
        >
          <GripVertical size={16} className="text-gray-400" />
        </div>
      )}

      <div className="flex-1 relative">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-600">
            <Code size={14} className="text-gray-500" />
            LaTeX block
          </div>
          <div className="flex items-center gap-2">
            {documentId && (
              <button
                type="button"
                className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors ${
                  showAIPrompt
                    ? 'bg-purple-100 text-purple-700 border-purple-300'
                    : 'bg-purple-50 text-purple-600 border-purple-200 hover:bg-purple-100'
                } ${isAIGenerating ? 'opacity-60 cursor-wait' : ''}`}
                onClick={() => { setShowAIPrompt(!showAIPrompt); setAIError(null); }}
                disabled={isAIGenerating}
                title="Generate LaTeX with AI"
              >
                <Sparkles size={12} />
                AI Generate
              </button>
            )}
            <div className="flex items-center gap-1 rounded border border-gray-200 bg-white text-[11px]">
              <button
                type="button"
                className={`px-2 py-1 ${viewMode === 'code' ? 'bg-blue-50 text-blue-700' : 'text-gray-500'}`}
                onClick={() => setViewMode('code')}
              >
                Code
              </button>
              <button
                type="button"
                className={`px-2 py-1 ${viewMode === 'preview' ? 'bg-blue-50 text-blue-700' : 'text-gray-500'}`}
                onClick={() => setViewMode('preview')}
              >
                Preview
              </button>
            </div>
          </div>
        </div>

        {/* AI Prompt Panel */}
        {showAIPrompt && (
          <div className="mb-3 rounded-lg border border-purple-200 bg-purple-50/50 p-3">
            <div className="flex items-start gap-2">
              <Sparkles size={16} className="text-purple-500 mt-1 flex-shrink-0" />
              <div className="flex-1">
                <label className="text-xs font-medium text-purple-700 mb-1 block">
                  Describe the LaTeX content you want to generate
                </label>
                <textarea
                  ref={aiPromptRef}
                  value={aiPrompt}
                  onChange={(e) => setAIPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleAIGenerate();
                    }
                  }}
                  placeholder="e.g. Create a table comparing contract terms, a mathematical proof, a Gantt chart using pgfgantt..."
                  className="w-full min-h-[60px] rounded border border-purple-200 bg-white p-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 resize-y"
                  disabled={isAIGenerating}
                />
                {aiError && (
                  <div className="mt-1 text-xs text-red-600">{aiError}</div>
                )}
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] text-purple-400">⌘/Ctrl + Enter to generate</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setShowAIPrompt(false); setAIError(null); setAIPrompt(''); }}
                      className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                      disabled={isAIGenerating}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleAIGenerate}
                      disabled={!aiPrompt.trim() || isAIGenerating}
                      className={`flex items-center gap-1 px-3 py-1 text-xs rounded font-medium transition-colors ${
                        !aiPrompt.trim() || isAIGenerating
                          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          : 'bg-purple-600 text-white hover:bg-purple-700'
                      }`}
                    >
                      {isAIGenerating ? (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          Generating…
                        </>
                      ) : (
                        <>
                          <Sparkles size={12} />
                          Generate
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {viewMode === 'code' && (
          <textarea
            ref={editorRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onBlur={handleBlur}
            onFocus={() => onFocusEditor?.(editorRef.current)}
            className="w-full min-h-[120px] rounded border border-gray-300 bg-white p-3 text-sm font-mono text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter LaTeX code..."
          />
        )}

        {viewMode === 'preview' && (
          <div className="rounded border border-gray-200 bg-white p-3">
            {previewPdfUrl && !previewError && (
              <div className="mb-2 flex justify-end">
                <a
                  href={previewPdfUrl}
                  download={`latex-${latexId || 'preview'}.pdf`}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  Download PDF
                </a>
              </div>
            )}
            {isPreviewLoading && (
              <div className="text-xs text-gray-500">Rendering preview…</div>
            )}
            {previewError && (
              <div className="text-xs text-red-500">{previewError}</div>
            )}
            {!isPreviewLoading && !previewError && previewImage && (
              <div className="flex justify-center">
                <img
                  src={previewImage}
                  alt="LaTeX preview"
                  className="max-w-full rounded border border-gray-100"
                />
              </div>
            )}
            {!isPreviewLoading && !previewError && !previewImage && (
              <pre className="whitespace-pre-wrap text-sm font-mono text-gray-700">
                {resolvedCode || 'No LaTeX code.'}
              </pre>
            )}
          </div>
        )}

        {viewMode === 'code' && (showEmptyWarning || showPairWarning) && (
          <div className="mt-2 text-xs text-amber-600">
            {showEmptyWarning
              ? 'LaTeX block is empty.'
              : 'Tip: add matching \\begin{...} and \\end{...} pairs.'}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 pt-1">
        {onMoveUp && (
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            className={`p-1 border rounded ${
              isFirst
                ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-600'
            }`}
            title={isFirst ? "Can't move up (first block)" : 'Move up'}
          >
            <ChevronUp size={12} />
          </button>
        )}
        {onMoveDown && (
          <button
            onClick={onMoveDown}
            disabled={isLast}
            className={`p-1 border rounded ${
              isLast
                ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-600'
            }`}
            title={isLast ? "Can't move down (last block)" : 'Move down'}
          >
            <ChevronDown size={12} />
          </button>
        )}
        {onOpenReviewComments && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenReviewComments(); }}
            className={`p-1 border rounded relative ${
              reviewCommentCount?.unresolved > 0
                ? 'bg-orange-50 hover:bg-orange-100 border-orange-300 text-orange-600'
                : reviewCommentCount?.total > 0
                  ? 'bg-green-50 hover:bg-green-100 border-green-300 text-green-600'
                  : 'bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-400'
            }`}
            title={
              reviewCommentCount?.total
                ? `${reviewCommentCount.total} comment${reviewCommentCount.total !== 1 ? 's' : ''}${reviewCommentCount.unresolved ? ` (${reviewCommentCount.unresolved} open)` : ''}`
                : 'Review comments'
            }
          >
            <MessageCircle size={12} />
            {reviewCommentCount?.total > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full text-[8px] font-bold leading-none text-white bg-orange-500">
                {reviewCommentCount.total}
              </span>
            )}
          </button>
        )}
        {onOpenMetadata && (
          <button
            type="button"
            onClick={() => {
              if (!latexId) return;
              onOpenMetadata({
                type: 'latex',
                id: latexId,
                label: latexCode?.topic || 'LaTeX block',
                metadata: latexCode?.custom_metadata?.metadata_values || {},
              });
            }}
            className="p-1 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-600 rounded"
            title="Edit metadata"
          >
            <Table size={12} />
          </button>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            className="p-1 bg-red-50 hover:bg-red-100 border border-red-200 text-red-500 rounded"
            title="Delete LaTeX block"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
};

export default LatexCodeEditor;
