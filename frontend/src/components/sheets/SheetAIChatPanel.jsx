/**
 * SheetAIChatPanel – Chat-style AI assistant for editing spreadsheets.
 *
 * Shows conversation history, displays cell-level diffs for proposed
 * changes, and supports approve/reject workflow.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2,
  Sparkles,
  X,
  Send,
  Bot,
  User,
  Check,
  XCircle,
  ChevronDown,
  Trash2,
  Clock,
  ArrowRight,
  Table2,
  Plus,
  Pencil,
  AlertCircle,
  MessageSquare,
} from 'lucide-react';
import useSheetsStore from '../../store/sheetsStore';

/* ── Quick actions for sheets ────────────────────────────────────────── */

const QUICK_ACTIONS = [
  { label: 'Fill sample data', prompt: 'Fill the sheet with realistic sample data based on the column names' },
  { label: 'Add formulas', prompt: 'Add appropriate formulas for calculated columns' },
  { label: 'Sort data', prompt: 'Sort the data by the first column alphabetically' },
  { label: 'Add totals row', prompt: 'Add a totals row at the bottom with SUM formulas for numeric columns' },
  { label: 'Clean data', prompt: 'Clean and normalize the data (fix formatting, trim whitespace)' },
  { label: 'Generate report data', prompt: 'Generate realistic business report data for this sheet structure' },
];

/* ── Cell Changes Preview ────────────────────────────────────────────── */

const CellChangePreview = ({ changes, newColumns, columns }) => {
  const [expanded, setExpanded] = useState(false);
  const maxPreview = expanded ? changes.length : 8;
  const colLabelMap = {};
  for (const c of (columns || [])) {
    colLabelMap[c.key] = c.label || c.key;
  }
  for (const nc of (newColumns || [])) {
    colLabelMap[nc.key] = nc.label || nc.key;
  }

  // Group changes by type
  const newRows = new Set();
  const editedCells = [];
  for (const ch of changes) {
    if (!ch.old_value && ch.new_value) {
      newRows.add(ch.row_order);
    }
    editedCells.push(ch);
  }

  return (
    <div className="mt-2 rounded-lg border border-gray-200 overflow-hidden bg-[#fafafa]">
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center gap-2 text-[10px]">
          <span className="flex items-center gap-1 text-emerald-600 font-medium">
            <Pencil size={9} />
            {changes.length} cell{changes.length !== 1 ? 's' : ''}
          </span>
          {newColumns?.length > 0 && (
            <span className="flex items-center gap-1 text-blue-600 font-medium">
              <Plus size={9} />
              {newColumns.length} new col{newColumns.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {changes.length > 8 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-blue-500 hover:text-blue-600"
          >
            {expanded ? 'Show less' : `Show all (${changes.length})`}
          </button>
        )}
      </div>

      {/* New columns */}
      {newColumns?.length > 0 && (
        <div className="px-2.5 py-1.5 border-b border-gray-100 bg-blue-50/50">
          <div className="text-[10px] text-blue-600 font-medium mb-1">New columns:</div>
          <div className="flex flex-wrap gap-1">
            {newColumns.map((nc) => (
              <span key={nc.key} className="px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded">
                {nc.label || nc.key} ({nc.type || 'text'})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Cell changes table */}
      <div className="overflow-x-auto max-h-[240px] overflow-y-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-2 py-1 text-left text-gray-500 font-medium">Row</th>
              <th className="px-2 py-1 text-left text-gray-500 font-medium">Column</th>
              <th className="px-2 py-1 text-left text-gray-500 font-medium">Old</th>
              <th className="px-2 py-1 text-center text-gray-400 w-5"></th>
              <th className="px-2 py-1 text-left text-gray-500 font-medium">New</th>
            </tr>
          </thead>
          <tbody>
            {editedCells.slice(0, maxPreview).map((ch, idx) => (
              <tr key={idx} className="border-t border-gray-100 hover:bg-gray-50/50">
                <td className="px-2 py-1 text-gray-500 font-mono">{ch.row_order + 1}</td>
                <td className="px-2 py-1 text-gray-700 font-medium">{colLabelMap[ch.column_key] || ch.column_key}</td>
                <td className="px-2 py-1">
                  {ch.old_value ? (
                    <span className="text-red-600 bg-red-50 px-1 py-0.5 rounded line-through">
                      {ch.old_value.length > 20 ? ch.old_value.slice(0, 20) + '…' : ch.old_value}
                    </span>
                  ) : (
                    <span className="text-gray-300 italic">empty</span>
                  )}
                </td>
                <td className="px-2 py-1 text-center">
                  <ArrowRight size={9} className="text-gray-300" />
                </td>
                <td className="px-2 py-1">
                  <span className="text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded font-medium">
                    {ch.new_value.length > 25 ? ch.new_value.slice(0, 25) + '…' : ch.new_value}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ── Single chat message ─────────────────────────────────────────────── */

const ACTION_SUGGESTIONS = [
  { label: 'Provide more details', prompt: 'Let me clarify — ' },
  { label: 'Try a different approach', prompt: 'Instead, could you ' },
  { label: 'Retry', prompt: null },  // re-sends the last user prompt
];

const ChatMessage = ({ message, columns, onFollowUp, lastUserPrompt }) => {
  const isUser = message.role === 'user';
  const [showChanges, setShowChanges] = useState(true);

  const hasChanges = !isUser && !message.error && message.changes?.length > 0;
  const needsAction = !isUser && (message.actionRequired || message.error);

  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {/* AI avatar */}
      {!isUser && (
        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
          needsAction ? 'bg-amber-100' : 'bg-purple-100'
        }`}>
          {needsAction
            ? <AlertCircle size={13} className="text-amber-600" />
            : <Bot size={13} className="text-purple-600" />
          }
        </div>
      )}

      <div className={`max-w-[92%] ${isUser ? 'order-first' : ''}`}>
        <div
          className={`px-3 py-2 rounded-xl text-[13px] leading-relaxed ${
            isUser
              ? 'bg-gray-900 text-gray-100 rounded-br-sm'
              : message.error
              ? 'bg-red-50 text-red-700 border border-red-200 rounded-bl-sm'
              : message.actionRequired
              ? 'bg-amber-50 text-amber-800 border border-amber-200 rounded-bl-sm'
              : message.applied
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-bl-sm'
              : message.rejected
              ? 'bg-amber-50 text-amber-600 border border-amber-200 rounded-bl-sm'
              : 'bg-gray-100 text-gray-800 rounded-bl-sm'
          }`}
        >
          {message.text}
        </div>

        {/* Action required — prompt user for follow-up */}
        {needsAction && onFollowUp && (
          <div className="mt-1.5 px-1">
            <div className="flex items-center gap-1 mb-1.5">
              <MessageSquare size={10} className="text-amber-500" />
              <span className="text-[10px] font-medium text-amber-600">
                {message.error ? 'Something went wrong — what would you like to do?' : 'Your input is needed'}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {ACTION_SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => {
                    if (s.prompt === null) {
                      // Retry: re-send the last user message
                      if (lastUserPrompt) onFollowUp(lastUserPrompt);
                    } else {
                      onFollowUp(s.prompt);
                    }
                  }}
                  className="px-2 py-0.5 text-[10px] rounded-full border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-300 transition-colors"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Metadata */}
        {!isUser && !message.error && !message.actionRequired && (
          <div className="flex items-center gap-2 mt-1 px-1 flex-wrap">
            {message.summary && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-600 font-medium">
                {message.summary}
              </span>
            )}
            {hasChanges && (
              <button
                onClick={() => setShowChanges(!showChanges)}
                className="text-[10px] text-blue-400 hover:text-blue-600 flex items-center gap-0.5"
              >
                <Table2 size={9} />
                {showChanges ? 'Hide changes' : 'Show changes'}
              </button>
            )}
            {message.timestamp && (
              <span className="text-[10px] text-gray-300 ml-auto flex items-center gap-0.5">
                <Clock size={9} />
                {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        )}

        {/* Cell changes preview */}
        {hasChanges && showChanges && (
          <CellChangePreview
            changes={message.changes}
            newColumns={message.newColumns}
            columns={columns}
          />
        )}

        {/* User timestamp */}
        {isUser && message.timestamp && (
          <div className="flex justify-end mt-0.5 px-1">
            <span className="text-[10px] text-gray-300">
              {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="w-6 h-6 rounded-full bg-gray-900 flex items-center justify-center flex-shrink-0 mt-0.5">
          <User size={13} className="text-white" />
        </div>
      )}
    </div>
  );
};

/* ── Main Chat Panel ─────────────────────────────────────────────────── */

export default function SheetAIChatPanel({ onClose }) {
  const [input, setInput] = useState('');
  const [showActions, setShowActions] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const currentSheet = useSheetsStore((s) => s.currentSheet);
  const aiChatMessages = useSheetsStore((s) => s.aiChatMessages);
  const pendingAIChanges = useSheetsStore((s) => s.pendingAIChanges);
  const aiGenerating = useSheetsStore((s) => s.aiGenerating);
  const saving = useSheetsStore((s) => s.saving);
  const aiEditSheet = useSheetsStore((s) => s.aiEditSheet);
  const aiApplyChanges = useSheetsStore((s) => s.aiApplyChanges);
  const aiRejectChanges = useSheetsStore((s) => s.aiRejectChanges);
  const clearAIChat = useSheetsStore((s) => s.clearAIChat);

  const columns = currentSheet?.columns || [];

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiChatMessages.length, aiGenerating]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback((e) => {
    e?.preventDefault();
    if (!input.trim() || aiGenerating) return;
    aiEditSheet(input.trim());
    setInput('');
  }, [input, aiGenerating, aiEditSheet]);

  const handleQuickAction = useCallback((action) => {
    if (aiGenerating) return;
    aiEditSheet(action.prompt);
    setShowActions(false);
  }, [aiGenerating, aiEditSheet]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }, [handleSubmit]);

  const handleClearChat = useCallback(() => {
    if (aiChatMessages.length === 0) return;
    if (window.confirm('Clear all AI chat history?')) {
      clearAIChat();
    }
  }, [aiChatMessages.length, clearAIChat]);

  const hasMessages = aiChatMessages.length > 0;
  const hasPending = !!pendingAIChanges;

  // Derive the last user prompt so we can offer a "Retry" action
  const lastUserPrompt = (() => {
    for (let i = aiChatMessages.length - 1; i >= 0; i--) {
      if (aiChatMessages[i].role === 'user') return aiChatMessages[i].text;
    }
    return '';
  })();

  // When user picks a follow-up action, pre-fill the input (or send directly for retry)
  const handleFollowUp = useCallback((text) => {
    if (!text) return;
    // If the text equals the last user prompt it's a plain retry — send immediately
    if (text === lastUserPrompt) {
      aiEditSheet(text);
    } else {
      // Pre-fill the input and focus so the user can finish their thought
      setInput(text);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [lastUserPrompt, aiEditSheet]);

  return (
    <div className="flex flex-col h-full border-l border-gray-200 bg-white" style={{ width: 380 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center">
            <Sparkles size={13} className="text-purple-600" />
          </div>
          <span className="text-sm font-medium text-gray-800">AI Sheet Editor</span>
        </div>
        <div className="flex items-center gap-1">
          {hasMessages && (
            <button
              onClick={handleClearChat}
              className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
              title="Clear chat"
            >
              <Trash2 size={13} />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 text-gray-400"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {!hasMessages && !aiGenerating && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-10 h-10 rounded-full bg-purple-50 flex items-center justify-center mb-3">
              <Sparkles size={18} className="text-purple-400" />
            </div>
            <p className="text-sm font-medium text-gray-700 mb-1">
              AI Sheet Editor
            </p>
            <p className="text-xs text-gray-400 mb-4">
              Describe changes and preview them before applying
            </p>

            {/* Quick actions grid */}
            <div className="flex flex-wrap justify-center gap-1.5 max-w-[300px]">
              {QUICK_ACTIONS.map((a) => (
                <button
                  key={a.label}
                  onClick={() => handleQuickAction(a)}
                  className="px-2.5 py-1 text-[11px] rounded-full bg-gray-50 border border-gray-200 text-gray-600 hover:bg-purple-50 hover:border-purple-200 hover:text-purple-600 transition-colors"
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {aiChatMessages.map((msg, i) => (
          <ChatMessage
            key={msg.id || i}
            message={msg}
            columns={columns}
            onFollowUp={handleFollowUp}
            lastUserPrompt={lastUserPrompt}
          />
        ))}

        {/* Generating indicator */}
        {aiGenerating && (
          <div className="flex gap-2 justify-start">
            <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Bot size={13} className="text-purple-600" />
            </div>
            <div className="px-3 py-2 rounded-xl rounded-bl-sm bg-gray-100 text-gray-500 text-[13px] flex items-center gap-2">
              <Loader2 size={13} className="animate-spin" />
              <span className="animate-pulse">Analyzing sheet & generating changes…</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Pending changes approve/reject bar */}
      {hasPending && (
        <div className="border-t border-purple-200 bg-purple-50/80 px-3 py-2.5 flex-shrink-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-medium text-purple-700">
              {pendingAIChanges.changes.length} change{pendingAIChanges.changes.length !== 1 ? 's' : ''} pending
            </span>
            <span className="text-[10px] text-purple-500">
              Preview highlighted on grid
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={aiApplyChanges}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {saving ? 'Applying…' : 'Apply Changes'}
            </button>
            <button
              onClick={aiRejectChanges}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              <XCircle size={13} />
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Quick actions toggle */}
      {hasMessages && (
        <div className={`overflow-hidden transition-all duration-200 border-t border-gray-50 ${showActions ? 'max-h-24 py-2 px-3' : 'max-h-0'}`}>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.label}
                onClick={() => handleQuickAction(a)}
                disabled={aiGenerating}
                className="px-2 py-0.5 text-[10px] rounded-full bg-gray-50 border border-gray-200 text-gray-500 hover:bg-purple-50 hover:text-purple-600 disabled:opacity-40 transition-colors"
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-gray-100 px-3 py-2 flex-shrink-0">
        {hasMessages && (
          <button
            onClick={() => setShowActions(!showActions)}
            className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 mb-1.5"
          >
            <ChevronDown size={10} className={`transition-transform ${showActions ? 'rotate-180' : ''}`} />
            Quick actions
          </button>
        )}
        <form onSubmit={handleSubmit} className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={aiGenerating}
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none disabled:opacity-50 disabled:bg-gray-50"
            placeholder="Describe what to change…"
            style={{ maxHeight: '80px' }}
          />
          <button
            type="submit"
            disabled={!input.trim() || aiGenerating}
            className="p-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            {aiGenerating ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
