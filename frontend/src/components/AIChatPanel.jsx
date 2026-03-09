import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Send,
  Bot,
  User,
  FileText,
  Layers,
  AlignLeft,
  Table2,
  Loader2,
  Sparkles,
  RotateCcw,
  Copy,
  Check,
  Pencil,
  CheckCircle,
  AlertCircle,
  X,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Brain,
  Zap,
} from 'lucide-react';
import aiService from '../services/aiService';
import useInferenceContext from '../hooks/useInferenceContext';

/* ------------------------------------------------------------------ */
/*  Scope badge colours                                                */
/* ------------------------------------------------------------------ */
const SCOPE_CONFIG = {
  document: { icon: FileText, label: 'Document', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  section:  { icon: Layers,   label: 'Section',  color: 'bg-purple-100 text-purple-700 border-purple-200' },
  paragraph:{ icon: AlignLeft, label: 'Paragraph', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  table:    { icon: Table2,   label: 'Table',     color: 'bg-amber-100 text-amber-700 border-amber-200' },
};

/* ------------------------------------------------------------------ */
/*  Mini table preview for AI recommendations                          */
/* ------------------------------------------------------------------ */
const TablePreview = ({ tableData }) => {
  if (!tableData) return null;
  const headers = (tableData.column_headers || []).map((h) =>
    typeof h === 'object' ? h.label || h.id || '' : String(h || '')
  );
  const headerIds = (tableData.column_headers || []).map((h) =>
    typeof h === 'object' ? h.id || h.label || '' : String(h || '')
  );
  const rows = (tableData.table_data || []).map((row) => {
    if (Array.isArray(row)) return row;
    if (row && row.cells) return headerIds.map((colId) => row.cells[colId] ?? '');
    return headerIds.map(() => '');
  });

  return (
    <div className="text-xs">
      {tableData.title && (
        <div className="font-medium text-gray-700 mb-1">{tableData.title}</div>
      )}
      {headers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr>
                {headers.map((h, i) => (
                  <th key={i} className="border border-gray-300 bg-gray-100 px-1.5 py-1 text-left font-medium text-gray-700 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 10).map((row, ri) => (
                <tr key={ri}>
                  {(Array.isArray(row) ? row : []).map((cell, ci) => (
                    <td key={ci} className="border border-gray-200 px-1.5 py-0.5 text-gray-600 whitespace-nowrap">
                      {String(cell ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length > 10 && (
                <tr>
                  <td colSpan={headers.length} className="border border-gray-200 px-1.5 py-0.5 text-center text-gray-400 italic">
                    … and {rows.length - 10} more rows
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-[10px] text-gray-400 mt-1">
        {headers.length} cols × {rows.length} rows
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Recommendation Preview Card                                        */
/* ------------------------------------------------------------------ */
const RecommendationCard = ({
  preview,
  onAccept,
  onReject,
  onEditAndApply,
  applying,
  accepted,
}) => {
  const [showOriginal, setShowOriginal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState('');

  const aiText = preview?.ai_text || '';
  const originalText = preview?.original_text || '';
  const scopeType = preview?.scope || '';

  useEffect(() => {
    setEditedText(aiText);
    setEditing(false);
    setShowOriginal(false);
  }, [aiText]);

  if (accepted) {
    return (
      <div className="mx-1 mb-3 rounded-xl border border-green-200 bg-green-50 p-3">
        <div className="flex items-center gap-2 text-green-700 text-sm font-medium">
          <CheckCircle size={16} />
          <span>Changes applied to {scopeType} successfully</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-1 mb-3 rounded-xl border border-blue-200 bg-gradient-to-b from-blue-50 to-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-blue-50 border-b border-blue-100">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-blue-600" />
          <span className="text-xs font-semibold text-blue-800">AI Recommendation</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 font-medium">
            {scopeType}
          </span>
        </div>
        <button
          onClick={onReject}
          className="text-gray-400 hover:text-gray-600 transition-colors"
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>

      {/* Toggle original */}
      <div className="px-3 pt-2">
        <button
          onClick={() => setShowOriginal(!showOriginal)}
          className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700 transition-colors mb-2"
        >
          {showOriginal ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          <span>{showOriginal ? 'Hide' : 'Show'} original {scopeType === 'table' ? 'table' : 'text'}</span>
        </button>

        {showOriginal && scopeType === 'table' && preview?.original_table ? (
          <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-2.5 max-h-52 overflow-auto">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Original Table</div>
            <TablePreview tableData={preview.original_table} />
          </div>
        ) : showOriginal && (
          <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-2.5 max-h-40 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Original</div>
            <div
              className="prose prose-xs max-w-none text-xs text-gray-600 leading-relaxed [&_p]:my-0.5"
              dangerouslySetInnerHTML={{ __html: originalText }}
            />
          </div>
        )}
      </div>

      {/* AI Proposed content */}
      <div className="px-3 pb-2">
        <div className="rounded-lg border border-blue-100 bg-white p-2.5 max-h-60 overflow-y-auto">
          <div className="flex items-center gap-1.5 mb-1.5">
            <ArrowRight size={10} className="text-blue-500" />
            <span className="text-[10px] uppercase tracking-wide text-blue-500 font-semibold">Proposed Changes</span>
          </div>
          {editing ? (
            <textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              className="w-full min-h-[100px] text-xs border border-gray-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent resize-y font-mono"
              autoFocus
            />
          ) : scopeType === 'table' && preview?.updated ? (
            <TablePreview tableData={preview.updated} />
          ) : (
            <div
              className="prose prose-xs max-w-none text-xs text-gray-800 leading-relaxed [&_p]:my-0.5 [&_strong]:font-semibold"
              dangerouslySetInnerHTML={{ __html: aiText }}
            />
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-t border-blue-100 bg-blue-50/50">
        {editing ? (
          <>
            <button
              onClick={() => onEditAndApply?.(editedText)}
              disabled={applying || !editedText.trim()}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {applying ? (
                <><Loader2 size={12} className="animate-spin" /><span>Applying…</span></>
              ) : (
                <><CheckCircle size={12} /><span>Apply Edited Version</span></>
              )}
            </button>
            <button
              onClick={() => { setEditing(false); setEditedText(aiText); }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onAccept}
              disabled={applying}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {applying ? (
                <><Loader2 size={12} className="animate-spin" /><span>Applying…</span></>
              ) : (
                <><Check size={12} /><span>Accept</span></>
              )}
            </button>
            <button
              onClick={() => setEditing(true)}
              disabled={applying}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-blue-300 text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
            >
              <Pencil size={12} />
              <span>Edit</span>
            </button>
            <button
              onClick={onReject}
              disabled={applying}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              <X size={12} />
              <span>Reject</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Single chat message bubble                                         */
/* ------------------------------------------------------------------ */
const ChatMessage = ({ message, onCopy }) => {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';

  const handleCopy = () => {
    navigator.clipboard.writeText(message.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
    onCopy?.(message.text);
  };

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-gradient-to-br from-purple-500 to-blue-600 text-white'
        }`}
      >
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>

      {/* Bubble */}
      <div className={`max-w-[85%] ${isUser ? '' : ''}`}>
        <div
          className={`group relative rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
            isUser
              ? 'bg-blue-600 text-white rounded-br-md'
              : 'bg-gray-100 text-gray-800 rounded-bl-md border border-gray-200'
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.text}</p>
          ) : (
            <div
              className="prose prose-sm max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_strong]:font-semibold"
              dangerouslySetInnerHTML={{ __html: message.text }}
            />
          )}
        </div>

        {/* Copy button for AI messages */}
        {!isUser && (
          <div className="flex items-center gap-1.5 mt-1.5 ml-1">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
              title="Copy response"
            >
              {copied ? <Check size={11} className="text-green-600" /> : <Copy size={11} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Typing indicator dots                                              */
/* ------------------------------------------------------------------ */
const TypingIndicator = () => (
  <div className="flex gap-2.5">
    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white">
      <Bot size={14} />
    </div>
    <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3 border border-gray-200">
      <div className="flex gap-1">
        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Suggestion chips                                                   */
/* ------------------------------------------------------------------ */
const SUGGESTIONS = {
  document: [
    'Summarise this document',
    'What are the key obligations?',
    'List all parties and their roles',
    'Identify potential risks',
  ],
  section: [
    'Summarise this section',
    'Simplify the language',
    'Make it more formal',
    'Rewrite in plain English',
    'Suggest improvements',
    'Add more detail',
  ],
  paragraph: [
    'Rewrite in plain English',
    'Make it more concise',
    'Strengthen the wording',
    'Fix grammar and clarity',
    'Make it more formal',
    'Simplify this paragraph',
  ],
  table: [
    'Add a new column',
    'Add a new row',
    'Reformat as bullet points',
    'Sort rows alphabetically',
    'Summarise the data',
    'Merge duplicate rows',
    'Clean up formatting',
  ],
};

/* ------------------------------------------------------------------ */
/*  Main AIChatPanel Component                                         */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/*  Inference context quality bar                                      */
/* ------------------------------------------------------------------ */
const InferenceContextBar = ({ documentId, scope, scopeId }) => {
  const {
    getContextForParagraph,
    getContextForSection,
    getContextForTable,
    getContextForDocument,
    isComponentStale,
    stats,
    tree,
  } = useInferenceContext(documentId);

  const contextInfo = useMemo(() => {
    let ctx = '';
    let stale = false;
    try {
      if (scope === 'paragraph' && scopeId) {
        ctx = getContextForParagraph(scopeId) || '';
        stale = isComponentStale(scopeId);
      } else if (scope === 'section' && scopeId) {
        ctx = getContextForSection(scopeId) || '';
      } else if (scope === 'table' && scopeId) {
        ctx = getContextForTable(scopeId) || '';
        stale = isComponentStale(scopeId);
      } else {
        ctx = getContextForDocument() || '';
      }
    } catch { /* inference may not be ready */ }
    const lines = ctx ? ctx.split('\n').filter(Boolean).length : 0;
    const hasInference = !!tree?.document_summary;
    return { lines, stale, hasInference };
  }, [scope, scopeId, getContextForParagraph, getContextForSection, getContextForTable, getContextForDocument, isComponentStale, tree]);

  if (!contextInfo.hasInference) return null;

  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium border ${
      contextInfo.stale
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : contextInfo.lines > 0
          ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
          : 'bg-gray-50 text-gray-500 border-gray-200'
    }`}>
      <Brain size={10} />
      <span>
        {contextInfo.lines > 0
          ? `${contextInfo.lines} context lines`
          : 'No context'}
        {contextInfo.stale && ' · stale'}
      </span>
      {contextInfo.lines > 0 && !contextInfo.stale && (
        <Zap size={8} className="text-indigo-500" />
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main AIChatPanel Component                                         */
/* ------------------------------------------------------------------ */
const AIChatPanel = ({
  documentId,
  scope = 'document',
  scopeId = null,
  scopeLabel = '',
  onClose,
  onApplyText,
  onApplyEdit,
}) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(true);

  // Recommendation state
  const [recommendation, setRecommendation] = useState(null);
  const [recommendationAccepted, setRecommendationAccepted] = useState(false);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scopeConf = SCOPE_CONFIG[scope] || SCOPE_CONFIG.document;
  const ScopeIcon = scopeConf.icon;
  const canEdit = scope === 'section' || scope === 'paragraph' || scope === 'table';

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, recommendation, recommendationAccepted]);

  // Focus input on mount or scope change
  useEffect(() => {
    inputRef.current?.focus();
  }, [scope, scopeId]);

  // Reset conversation when scope changes
  useEffect(() => {
    setMessages([]);
    setError(null);
    setShowSuggestions(true);
    setRecommendation(null);
    setRecommendationAccepted(false);
  }, [scope, scopeId]);

  // ─── Send message ────────────────────────────────────────────────
  // For editable scopes (section/paragraph) we fire TWO calls in parallel:
  //   1) chat  → conversational AI response (shown as a bubble)
  //   2) chatApplyEdit(preview:true) → AI recommendation (shown as a card)
  // For non-editable scopes we only fire the chat call.
  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || loading) return;

    const userMsg = { role: 'user', text: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setShowSuggestions(false);
    setLoading(true);
    setError(null);
    setRecommendation(null);
    setRecommendationAccepted(false);

    const history = messages.map((m) => ({ role: m.role, text: m.text }));

    // Build promises
    const chatPromise = aiService.chat({
      document_id: documentId,
      scope,
      scope_id: scopeId,
      message: text.trim(),
      conversation_history: history,
    });

    const previewPromise = canEdit && scopeId
      ? aiService.chatApplyEdit({
          document_id: documentId,
          scope,
          scope_id: scopeId,
          instruction: text.trim(),
          conversation_history: history,
          preview: true,
        }).catch(() => null) // Don't fail the whole send if preview fails
      : Promise.resolve(null);

    try {
      const [chatData, previewData] = await Promise.all([chatPromise, previewPromise]);

      // Chat response → message bubble
      if (chatData?.status === 'ok' && chatData.response) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: chatData.response },
        ]);
      } else {
        setError(chatData?.message || 'Unexpected AI response.');
      }

      // Preview response → recommendation card (shown automatically)
      if (previewData?.status === 'ok' && previewData.preview) {
        setRecommendation(previewData);
      }
    } catch (err) {
      const errMsg =
        err?.response?.data?.message || err.message || 'Failed to reach AI service.';
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  }, [documentId, scope, scopeId, messages, loading, canEdit]);

  // ─── Accept recommendation → apply directly via frontend partial save ──
  const handleAcceptRecommendation = useCallback(() => {
    if (!recommendation) return;

    // Pass the preview data directly to the parent — no second backend call.
    // The parent (handleAiChatEdit) will apply via updateParagraphLocal /
    // updateSectionLocal + enqueuePartialChange for auto-save.
    onApplyEdit?.(recommendation);

    setRecommendationAccepted(true);
    setRecommendation(null);
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        text: `<p><em>✅ Changes applied to the ${scope} successfully.</em></p>`,
      },
    ]);
  }, [recommendation, scope, onApplyEdit]);

  // ─── Edit & Apply → user tweaked the AI text, apply custom version ──
  const handleEditAndApply = useCallback((customText) => {
    if (!customText?.trim() || !recommendation) return;

    // Build a synthetic preview payload with the user-edited text
    let editedPreview;

    if (recommendation.scope === 'table' && recommendation.updated) {
      // For table scope — customText is JSON; try to parse it for structured update
      let parsedTable = null;
      try {
        parsedTable = JSON.parse(customText);
      } catch {
        // If user's edit isn't valid JSON, fall back to original updated data
        parsedTable = null;
      }

      if (parsedTable && typeof parsedTable === 'object') {
        editedPreview = {
          ...recommendation,
          ai_text: customText,
          updated: {
            ...recommendation.updated,
            title: parsedTable.title ?? recommendation.updated.title,
            description: parsedTable.description ?? recommendation.updated.description,
            table_type: parsedTable.table_type ?? recommendation.updated.table_type,
            column_headers: parsedTable.column_headers ?? recommendation.updated.column_headers,
            table_data: parsedTable.table_data ?? recommendation.updated.table_data,
            num_columns: (parsedTable.column_headers ?? recommendation.updated.column_headers)?.length ?? recommendation.updated.num_columns,
            num_rows: (parsedTable.table_data ?? recommendation.updated.table_data)?.length ?? recommendation.updated.num_rows,
          },
        };
      } else {
        // Invalid JSON edit — use original recommendation as-is
        editedPreview = { ...recommendation, ai_text: customText };
      }
    } else {
      editedPreview = {
        ...recommendation,
        ai_text: customText,
        // For paragraph scope, override the updated text
        ...(recommendation.scope === 'paragraph' && recommendation.updated
          ? {
              updated: {
                ...recommendation.updated,
                edited_text: customText,
              },
            }
          : {}),
        // For section scope with paragraphs, put all edited text into first paragraph
        // (the parent handler will deal with distributing it)
        ...(recommendation.scope === 'section' && recommendation.updated?.paragraphs
          ? {
              updated: {
                ...recommendation.updated,
                paragraphs: recommendation.updated.paragraphs.map((p, i) =>
                  i === 0 ? { ...p, edited_text: customText } : p
                ),
              },
            }
          : {}),
        // For section scope without paragraphs
        ...(recommendation.scope === 'section' && recommendation.updated && !recommendation.updated.paragraphs
          ? {
              updated: {
                ...recommendation.updated,
                edited_text: customText,
              },
            }
          : {}),
      };
    }

    onApplyEdit?.(editedPreview);

    setRecommendationAccepted(true);
    setRecommendation(null);
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        text: `<p><em>✅ Your edited changes applied to the ${scope} successfully.</em></p>`,
      },
    ]);
  }, [recommendation, scope, onApplyEdit]);

  // ─── Reject recommendation ──
  const handleRejectRecommendation = useCallback(() => {
    setRecommendation(null);
    setRecommendationAccepted(false);
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        text: `<p><em>Recommendation dismissed. You can ask me to try again with different instructions.</em></p>`,
      },
    ]);
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleReset = () => {
    setMessages([]);
    setError(null);
    setShowSuggestions(true);
    setRecommendation(null);
    setRecommendationAccepted(false);
    inputRef.current?.focus();
  };

  const suggestions = SUGGESTIONS[scope] || SUGGESTIONS.document;

  return (
    <div className="flex flex-col h-full">
      {/* Scope badge */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${scopeConf.color}`}>
            <ScopeIcon size={13} />
            <span>{scopeConf.label}</span>
            {scopeLabel && (
              <>
                <span className="text-gray-300">·</span>
                <span className="max-w-[160px] truncate opacity-80">{scopeLabel}</span>
              </>
            )}
          </div>
          <InferenceContextBar documentId={documentId} scope={scope} scopeId={scopeId} />
        </div>
        {canEdit && (
          <p className="text-[10px] text-blue-500 mt-1.5 ml-0.5 flex items-center gap-1">
            <Sparkles size={10} />
            Ask to edit — AI will show a recommendation you can accept, edit, or reject
          </p>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4 min-h-0">
        {/* Empty state */}
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center mb-3">
              <Sparkles size={22} className="text-purple-600" />
            </div>
            <p className="text-sm font-medium text-gray-800 mb-1">AI Assistant</p>
            <p className="text-xs text-gray-500 max-w-[220px]">
              Ask questions about{' '}
              {scope === 'document' ? 'this document' : `this ${scope}`}
              {' '}or request edits and analysis.
            </p>
            {canEdit && (
              <div className="mt-3 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 max-w-[260px]">
                <p className="text-[11px] text-blue-700 font-medium mb-1 flex items-center gap-1">
                  <Pencil size={10} />
                  How to edit with AI:
                </p>
                <ol className="text-[10px] text-blue-600 space-y-0.5 list-decimal list-inside">
                  <li>Describe the change you want</li>
                  <li>Review the AI recommendation</li>
                  <li>Accept, edit, or reject</li>
                </ol>
              </div>
            )}
          </div>
        )}

        {/* Suggestion chips */}
        {showSuggestions && messages.length === 0 && (
          <div className="flex flex-wrap gap-1.5 justify-center">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => sendMessage(s)}
                className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-full text-gray-600 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Message list */}
        {messages.map((msg, i) => (
          <ChatMessage
            key={i}
            message={msg}
            onCopy={onApplyText}
          />
        ))}

        {/* Typing indicator */}
        {loading && <TypingIndicator />}

        {/* Recommendation Preview Card — shown automatically after AI responds */}
        {recommendation && !recommendationAccepted && (
          <RecommendationCard
            preview={recommendation}
            onAccept={handleAcceptRecommendation}
            onReject={handleRejectRecommendation}
            onEditAndApply={handleEditAndApply}
            applying={false}
            accepted={false}
          />
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700 flex items-start gap-2">
            <AlertCircle size={12} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-200 bg-white px-4 py-3">
        {/* Utility row */}
        {messages.length > 0 && (
          <div className="flex items-center justify-end mb-2">
            <button
              onClick={handleReset}
              className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700 transition-colors"
            >
              <RotateCcw size={12} />
              New conversation
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={canEdit ? `Describe the change you want…` : `Ask about this ${scope}…`}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent max-h-24 overflow-y-auto"
            style={{ minHeight: '38px' }}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="flex-shrink-0 w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AIChatPanel;
