/**
 * WorkflowChat — AI chat assistant panel for workflow editing
 * ============================================================
 * Floating slide-out panel that lets users modify their workflow
 * through natural language conversation with the AI assistant.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { workflowApi } from '../api/clmApi';
import notify from '../utils/notify';
import {
  Send, Trash2, X, Bot, User, CheckCircle2,
  XCircle, AlertCircle, Loader2, Sparkles,
  ChevronDown, RotateCcw,
} from 'lucide-react';

/* ── Action badge colours ──────────────────────────────────── */
const ACTION_COLORS = {
  add_node:           'bg-emerald-100 text-emerald-700',
  update_node:        'bg-blue-100 text-blue-700',
  delete_node:        'bg-red-100 text-red-700',
  add_connection:     'bg-purple-100 text-purple-700',
  delete_connection:  'bg-orange-100 text-orange-700',
  add_derived_field:  'bg-amber-100 text-amber-700',
  delete_derived_field: 'bg-rose-100 text-rose-700',
  update_workflow:    'bg-indigo-100 text-indigo-700',
};

const STATUS_ICONS = {
  success: <CheckCircle2 size={12} className="text-emerald-600" />,
  error:   <XCircle size={12} className="text-red-500" />,
  skipped: <AlertCircle size={12} className="text-amber-500" />,
};

/* ── Single action badge ───────────────────────────────────── */
function ActionBadge({ action, result }) {
  const label = (action.action || '').replace(/_/g, ' ');
  const color = ACTION_COLORS[action.action] || 'bg-gray-100 text-gray-600';
  const icon = result ? STATUS_ICONS[result.status] : null;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${color}`}>
      {icon}
      {label}
      {action.label && <span className="opacity-70">: {action.label}</span>}
      {action.node_type && <span className="opacity-70">({action.node_type})</span>}
    </span>
  );
}

/* ── Message bubble ────────────────────────────────────────── */
function ChatMessage({ msg, actionResults }) {
  const isUser = msg.role === 'user';
  const [showActions, setShowActions] = useState(false);
  const actions = msg.actions || [];

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white ${
        isUser ? 'bg-indigo-500' : 'bg-gradient-to-br from-violet-500 to-purple-600'
      }`}>
        {isUser ? <User size={14} /> : <Sparkles size={14} />}
      </div>

      {/* Bubble */}
      <div className={`max-w-[85%] flex flex-col gap-1`}>
        <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-indigo-500 text-white rounded-br-md'
            : 'bg-gray-100 text-gray-800 rounded-bl-md'
        }`}>
          {msg.content}
        </div>

        {/* Action badges */}
        {actions.length > 0 && (
          <div className="mt-1">
            <button
              onClick={() => setShowActions(!showActions)}
              className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-1"
            >
              <ChevronDown size={10} className={`transition-transform ${showActions ? 'rotate-180' : ''}`} />
              {actions.length} action{actions.length !== 1 ? 's' : ''}
              {msg.actions_applied && (
                <span className="text-emerald-500 flex items-center gap-0.5">
                  <CheckCircle2 size={10} /> applied
                </span>
              )}
            </button>
            {showActions && (
              <div className="flex flex-wrap gap-1 mt-1">
                {actions.map((a, i) => (
                  <ActionBadge
                    key={i}
                    action={a}
                    result={actionResults?.[i]}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Timestamp */}
        <span className={`text-[10px] text-gray-400 ${isUser ? 'text-right' : ''}`}>
          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}

/* ── Main chat panel ───────────────────────────────────────── */
export default function WorkflowChat({ workflowId, onWorkflowUpdate, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [lastActionResults, setLastActionResults] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  /* ── Scroll to bottom ───────────────── */
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  /* ── Load history ───────────────────── */
  const loadHistory = useCallback(async () => {
    try {
      setLoadingHistory(true);
      const { data } = await workflowApi.chatHistory(workflowId);
      setMessages(data.messages || []);
    } catch (err) {
      console.error('Failed to load chat history:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, [workflowId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  /* ── Focus input on mount ───────────── */
  useEffect(() => {
    if (!loadingHistory) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [loadingHistory]);

  /* ── Send message ───────────────────── */
  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    // Optimistically add user message
    const tempUserMsg = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setInput('');
    setSending(true);

    try {
      const { data } = await workflowApi.chatSend(workflowId, {
        message: text,
        auto_apply: true,
      });

      // Replace temp message with real ones from response & add assistant reply
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempUserMsg.id);
        const userMsg = {
          id: `user-${Date.now()}`,
          role: 'user',
          content: text,
          created_at: new Date().toISOString(),
        };
        const assistantMsg = {
          id: data.message_id,
          role: 'assistant',
          content: data.reply,
          actions: data.actions || [],
          actions_applied: data.actions_applied,
          created_at: new Date().toISOString(),
        };
        return [...withoutTemp, userMsg, assistantMsg];
      });

      setLastActionResults(data.action_results || null);

      // If actions were applied, notify parent to refresh workflow state
      if (data.actions_applied && data.actions?.length > 0) {
        onWorkflowUpdate?.();
        notify.success(`Applied ${data.actions.length} action${data.actions.length !== 1 ? 's' : ''}`);
      }
    } catch (err) {
      console.error('Chat send failed:', err);
      const errMsg = err.response?.data?.error || err.message || 'Failed to send message';
      notify.error(errMsg);
      // Remove temp message on failure
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
      setInput(text); // restore input
    } finally {
      setSending(false);
    }
  };

  /* ── Clear chat ─────────────────────── */
  const handleClear = async () => {
    if (!window.confirm('Clear all chat messages?')) return;
    try {
      await workflowApi.chatClear(workflowId);
      setMessages([]);
      notify.success('Chat cleared');
    } catch (err) {
      notify.error('Failed to clear chat');
    }
  };

  /* ── Key handler ────────────────────── */
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /* ── Suggestions ────────────────────── */
  const suggestions = [
    'What does my workflow look like?',
    'Add a rule node to filter documents',
    'Connect the input to the output',
    'Set the document type to contract',
    'Add an AI node for risk scoring',
  ];

  return (
    <div className="flex flex-col h-full bg-white">
      {/* ── Header ──────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-gradient-to-r from-violet-50 to-purple-50 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <Sparkles size={16} className="text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">AI Assistant</h3>
            <p className="text-[10px] text-gray-500">Edit your workflow with natural language</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleClear}
            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            title="Clear chat"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="Close chat"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ── Messages ────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {loadingHistory ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-gray-400" />
          </div>
        ) : messages.length === 0 ? (
          /* Empty state with suggestions */
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center mb-3">
              <Bot size={24} className="text-purple-500" />
            </div>
            <h4 className="text-sm font-medium text-gray-700 mb-1">Workflow AI Assistant</h4>
            <p className="text-xs text-gray-400 mb-4 max-w-[220px]">
              Describe what you want to change and I'll update your workflow.
            </p>
            <div className="space-y-1.5 w-full">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => { setInput(s); inputRef.current?.focus(); }}
                  className="w-full text-left px-3 py-2 text-xs text-gray-600 bg-gray-50 hover:bg-indigo-50 hover:text-indigo-700 rounded-lg transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <ChatMessage
              key={msg.id || i}
              msg={msg}
              actionResults={
                i === messages.length - 1 && msg.role === 'assistant'
                  ? lastActionResults
                  : null
              }
            />
          ))
        )}

        {/* Typing indicator */}
        {sending && (
          <div className="flex gap-2.5">
            <div className="shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <Sparkles size={14} className="text-white" />
            </div>
            <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input ───────────────────── */}
      <div className="shrink-0 border-t bg-white px-3 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe a change…"
            rows={1}
            className="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 max-h-24"
            disabled={sending}
            style={{
              height: 'auto',
              minHeight: '36px',
              maxHeight: '96px',
            }}
            onInput={(e) => {
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 96) + 'px';
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="shrink-0 w-9 h-9 rounded-xl bg-indigo-500 text-white flex items-center justify-center hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5 text-center">
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
