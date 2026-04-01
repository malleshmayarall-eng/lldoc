/**
 * AIChatPanel – Chat-style AI assistant for Quick LaTeX / HTML documents.
 *
 * Shows conversation history (user prompts + AI responses), displays
 * inline code diffs for AI edits, and supports undo per message.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  Sparkles,
  X,
  Send,
  Wand2,
  Pencil,
  User,
  Bot,
  ChevronDown,
  RotateCcw,
  Check,
  Copy,
  Clock,
  Undo2,
  Trash2,
  Plus,
  Minus,
  ChevronRight,
  AlertCircle,
  MessageSquare,
} from 'lucide-react';

const QUICK_ACTIONS = [
  { label: 'NDA', prompt: 'Generate a standard Non-Disclosure Agreement' },
  { label: 'Service Agreement', prompt: 'Generate a professional services agreement' },
  { label: 'Employment Contract', prompt: 'Generate an employment contract' },
  { label: 'Add clause', prompt: 'Add a confidentiality clause' },
  { label: 'Add signatures', prompt: 'Add a signature block for both parties' },
  { label: 'Fix formatting', prompt: 'Fix formatting and improve appearance' },
  { label: 'Add table', prompt: 'Add a summary table of key terms' },
  { label: 'Simplify', prompt: 'Simplify the legal language to be more readable' },
];

/* ── Simple line-level diff ──────────────────────────────────────────── */

/**
 * Compute a simple line-based diff between two strings.
 * Returns array of { type: 'same'|'added'|'removed', text: string }.
 * Uses a basic LCS-inspired approach for readability.
 */
function computeLineDiff(oldText = '', newText = '') {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Simple O(n*m) LCS for line matching — practical for typical doc sizes
  const m = oldLines.length;
  const n = newLines.length;

  // For very large files, fall back to simple side-by-side
  if (m * n > 500000) {
    const result = [];
    const max = Math.max(m, n);
    for (let i = 0; i < max; i++) {
      if (i < m && i < n && oldLines[i] === newLines[i]) {
        result.push({ type: 'same', text: oldLines[i] });
      } else {
        if (i < m) result.push({ type: 'removed', text: oldLines[i] });
        if (i < n) result.push({ type: 'added', text: newLines[i] });
      }
    }
    return result;
  }

  // Build LCS table
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to build diff
  const diff = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diff.push({ type: 'same', text: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.push({ type: 'added', text: newLines[j - 1] });
      j--;
    } else {
      diff.push({ type: 'removed', text: oldLines[i - 1] });
      i--;
    }
  }

  return diff.reverse();
}

/* ── DiffView component ──────────────────────────────────────────────── */

const DiffView = ({ previousCode, code, maxLines = 30 }) => {
  const [expanded, setExpanded] = useState(false);
  const diff = useMemo(() => computeLineDiff(previousCode, code), [previousCode, code]);

  // Count changes
  const added = diff.filter((d) => d.type === 'added').length;
  const removed = diff.filter((d) => d.type === 'removed').length;

  // Collapse unchanged regions
  const changedLines = diff.filter((d) => d.type !== 'same');
  const displayDiff = expanded ? diff : (() => {
    // Show only changed lines + 2 lines context around each change
    const shown = new Set();
    diff.forEach((_, idx) => {
      if (diff[idx].type !== 'same') {
        for (let k = Math.max(0, idx - 2); k <= Math.min(diff.length - 1, idx + 2); k++) {
          shown.add(k);
        }
      }
    });
    const result = [];
    let lastIdx = -1;
    diff.forEach((line, idx) => {
      if (shown.has(idx)) {
        if (lastIdx !== -1 && idx - lastIdx > 1) {
          const skipped = idx - lastIdx - 1;
          result.push({ type: 'collapse', text: `  ··· ${skipped} unchanged line${skipped > 1 ? 's' : ''} ···` });
        }
        result.push({ ...line, _idx: idx });
        lastIdx = idx;
      }
    });
    // Handle trailing unchanged
    if (lastIdx < diff.length - 1 && lastIdx !== -1) {
      const skipped = diff.length - 1 - lastIdx;
      result.push({ type: 'collapse', text: `  ··· ${skipped} unchanged line${skipped > 1 ? 's' : ''} ···` });
    }
    return result;
  })();

  if (changedLines.length === 0) {
    return (
      <div className="text-[10px] text-gray-400 italic px-2 py-1">
        No visible changes in code.
      </div>
    );
  }

  return (
    <div className="mt-1.5 rounded-lg border border-gray-200 overflow-hidden bg-[#fafafa]">
      {/* Diff header */}
      <div className="flex items-center justify-between px-2 py-1 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center gap-2 text-[10px]">
          {added > 0 && (
            <span className="flex items-center gap-0.5 text-emerald-600">
              <Plus size={9} /> {added}
            </span>
          )}
          {removed > 0 && (
            <span className="flex items-center gap-0.5 text-red-500">
              <Minus size={9} /> {removed}
            </span>
          )}
        </div>
        {diff.length > 10 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-blue-500 hover:text-blue-600 flex items-center gap-0.5"
          >
            <ChevronRight size={9} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
            {expanded ? 'Collapse' : 'Expand all'}
          </button>
        )}
      </div>

      {/* Diff lines */}
      <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
        <pre className="text-[11px] leading-[18px] font-mono">
          {displayDiff.map((line, idx) => {
            if (line.type === 'collapse') {
              return (
                <div
                  key={`c-${idx}`}
                  className="px-2 py-0.5 text-[10px] text-gray-400 bg-gray-50 border-y border-gray-100 text-center italic select-none cursor-pointer hover:bg-gray-100"
                  onClick={() => setExpanded(true)}
                >
                  {line.text}
                </div>
              );
            }
            return (
              <div
                key={idx}
                className={`px-2 whitespace-pre ${
                  line.type === 'added'
                    ? 'bg-emerald-50 text-emerald-800 border-l-2 border-emerald-400'
                    : line.type === 'removed'
                    ? 'bg-red-50 text-red-700 border-l-2 border-red-300 line-through opacity-70'
                    : 'text-gray-500 border-l-2 border-transparent'
                }`}
              >
                <span className="inline-block w-4 text-right mr-2 text-[9px] text-gray-300 select-none">
                  {line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}
                </span>
                {line.text || ' '}
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
};

/* ── Action suggestions for compilation / error follow-ups ───────────── */

const ACTION_SUGGESTIONS = [
  { label: 'Ask AI to fix it', prompt: 'Fix the compilation errors in the current code. Ensure the document compiles without errors.' },
  { label: 'Simplify code', prompt: 'Simplify the LaTeX code to remove any advanced packages or constructs that might cause compilation issues.' },
  { label: 'Undo change', prompt: null },  // handled via onUndo
];

/* ── Single chat message bubble ──────────────────────────────────────── */

const ChatMessage = ({ message, onUndo, onFollowUp }) => {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [showDiff, setShowDiff] = useState(true);
  const [showErrors, setShowErrors] = useState(false);

  const handleCopy = () => {
    if (message.code) {
      navigator.clipboard.writeText(message.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  // Show diff when AI message has both previousCode and code (and they differ)
  const hasDiff = !isUser && !message.error && message.code && message.previousCode != null
    && message.code !== message.previousCode;

  // Show undo button for AI messages that have previousCode
  const canUndo = !isUser && !message.error && message.previousCode != null && message.mode !== 'undo';

  // Action-required state (compilation failure or error)
  const needsAction = !isUser && message.actionRequired;
  const compErrors = message.compilationErrors;

  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {/* AI avatar */}
      {!isUser && (
        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
          needsAction ? 'bg-amber-100' : 'bg-violet-100'
        }`}>
          {needsAction
            ? <AlertCircle size={13} className="text-amber-600" />
            : <Bot size={13} className="text-violet-600" />
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
              : needsAction
              ? 'bg-amber-50 text-amber-800 border border-amber-200 rounded-bl-sm'
              : message.autoFixed
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-bl-sm'
              : message.mode === 'undo'
              ? 'bg-amber-50 text-amber-700 border border-amber-200 rounded-bl-sm'
              : 'bg-gray-100 text-gray-800 rounded-bl-sm'
          }`}
        >
          {message.mode === 'undo' && <Undo2 size={11} className="inline mr-1 -mt-0.5" />}
          {message.text}
        </div>

        {/* Compilation error details (collapsible) */}
        {needsAction && compErrors && (
          <div className="mt-1 px-1">
            {compErrors.errorSummary && (
              <p className="text-[10px] text-amber-700 font-medium mb-1">{compErrors.errorSummary}</p>
            )}
            {compErrors.missingPackages?.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1">
                {compErrors.missingPackages.map((pkg) => (
                  <span key={pkg} className="px-1.5 py-0.5 text-[9px] bg-red-100 text-red-600 rounded font-mono">
                    {pkg}
                  </span>
                ))}
              </div>
            )}
            {compErrors.errorLines?.length > 0 && (
              <>
                <button
                  onClick={() => setShowErrors(!showErrors)}
                  className="text-[10px] text-amber-500 hover:text-amber-700 flex items-center gap-0.5 mb-1"
                >
                  <ChevronRight size={9} className={`transition-transform ${showErrors ? 'rotate-90' : ''}`} />
                  {showErrors ? 'Hide errors' : `Show ${compErrors.errorLines.length} error(s)`}
                </button>
                {showErrors && (
                  <div className="space-y-1 mb-1.5">
                    {compErrors.errorLines.map((e, i) => (
                      <div key={i} className="text-[10px] bg-red-50 border border-red-100 rounded px-2 py-1">
                        {e.line && <span className="font-mono text-red-400 mr-1">L{e.line}</span>}
                        <span className="text-red-700">{e.message}</span>
                        {e.context && <span className="text-red-400 ml-1 italic">{e.context}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Action-required — prompt user for follow-up */}
        {needsAction && onFollowUp && (
          <div className="mt-1.5 px-1">
            <div className="flex items-center gap-1 mb-1.5">
              <MessageSquare size={10} className="text-amber-500" />
              <span className="text-[10px] font-medium text-amber-600">
                {message.error ? 'Something went wrong — what would you like to do?' : 'Your input is needed to resolve this'}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {ACTION_SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => {
                    if (s.prompt === null) {
                      // Undo — use the previousCode from this message or the preceding code message
                      if (message.previousCode != null && onUndo) {
                        onUndo(message.id, message.previousCode);
                      }
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

        {/* Show metadata for AI responses */}
        {!isUser && !message.error && !message.actionRequired && !message.autoFixed && (
          <div className="flex items-center gap-2 mt-1 px-1 flex-wrap">
            {message.mode && message.mode !== 'undo' && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                message.mode === 'edit'
                  ? 'bg-amber-50 text-amber-600'
                  : 'bg-violet-50 text-violet-600'
              }`}>
                {message.mode === 'edit' ? 'edited' : 'generated'}
              </span>
            )}
            {message.codeType && (
              <span className="text-[10px] text-gray-400">{message.codeType.toUpperCase()}</span>
            )}
            {message.code && (
              <button
                onClick={handleCopy}
                className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5"
              >
                {copied ? <Check size={9} /> : <Copy size={9} />}
                {copied ? 'Copied' : 'Copy code'}
              </button>
            )}
            {hasDiff && (
              <button
                onClick={() => setShowDiff(!showDiff)}
                className="text-[10px] text-blue-400 hover:text-blue-600 flex items-center gap-0.5"
              >
                <ChevronRight size={9} className={`transition-transform ${showDiff ? 'rotate-90' : ''}`} />
                {showDiff ? 'Hide diff' : 'Show diff'}
              </button>
            )}
            {canUndo && onUndo && (
              <button
                onClick={() => onUndo(message.id, message.previousCode)}
                className="text-[10px] text-amber-500 hover:text-amber-700 flex items-center gap-0.5 font-medium"
              >
                <Undo2 size={9} />
                Undo
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

        {/* Inline diff view */}
        {hasDiff && showDiff && (
          <DiffView previousCode={message.previousCode} code={message.code} />
        )}

        {/* Timestamp for user messages */}
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

const AIChatPanel = ({
  generating,
  onGenerate,
  onClose,
  onUndo,
  onClearChat,
  hasExistingCode = false,
  codeType = 'latex',
  chatMessages = [],
}) => {
  const [input, setInput] = useState('');
  const [showActions, setShowActions] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length, generating]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim() || generating) return;
    const mode = hasExistingCode ? 'edit' : 'generate';
    onGenerate({
      prompt: input.trim(),
      replace: true,
      mode,
    });
    setInput('');
  };

  const handleQuickAction = (action) => {
    const mode = hasExistingCode ? 'edit' : 'generate';
    onGenerate({
      prompt: action.prompt,
      replace: true,
      mode,
    });
    setShowActions(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleClearChat = () => {
    if (chatMessages.length === 0) return;
    if (window.confirm('Clear all chat history for this document?')) {
      onClearChat?.();
    }
  };

  // Follow-up handler for action-required messages (sends prompt as edit)
  const handleFollowUp = useCallback((prompt) => {
    if (!prompt || generating) return;
    onGenerate({
      prompt,
      replace: true,
      mode: 'edit',
    });
  }, [generating, onGenerate]);

  const hasMessages = chatMessages.length > 0;

  return (
    <div className="flex flex-col h-full border-l border-gray-100 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center">
            <Sparkles size={13} className="text-violet-600" />
          </div>
          <span className="text-sm font-medium text-gray-800">AI Assistant</span>
          {hasExistingCode && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium">
              Edit mode
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {hasMessages && (
            <button
              onClick={handleClearChat}
              className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
              title="Clear chat history"
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
        {!hasMessages && !generating && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-10 h-10 rounded-full bg-violet-50 flex items-center justify-center mb-3">
              <Sparkles size={18} className="text-violet-400" />
            </div>
            <p className="text-sm font-medium text-gray-700 mb-1">
              {hasExistingCode ? 'Edit your document' : 'Create a document'}
            </p>
            <p className="text-xs text-gray-400 mb-4">
              {hasExistingCode
                ? 'Describe the changes you want'
                : 'Describe what to generate'}
            </p>

            {/* Quick actions grid */}
            <div className="flex flex-wrap justify-center gap-1.5 max-w-[280px]">
              {QUICK_ACTIONS.slice(0, hasExistingCode ? 8 : 4).map((a) => (
                <button
                  key={a.label}
                  onClick={() => handleQuickAction(a)}
                  className="px-2.5 py-1 text-[11px] rounded-full bg-gray-50 border border-gray-200 text-gray-600 hover:bg-violet-50 hover:border-violet-200 hover:text-violet-600 transition-colors"
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {chatMessages.map((msg, i) => (
          <ChatMessage
            key={msg.id || i}
            message={msg}
            onUndo={onUndo}
            onFollowUp={handleFollowUp}
          />
        ))}

        {/* Generating indicator */}
        {generating && (
          <div className="flex gap-2 justify-start">
            <div className="w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Bot size={13} className="text-violet-600" />
            </div>
            <div className="px-3 py-2 rounded-xl rounded-bl-sm bg-gray-100 text-gray-500 text-[13px] flex items-center gap-2">
              <Loader2 size={13} className="animate-spin" />
              <span className="animate-pulse">
                {hasExistingCode ? 'Applying changes…' : 'Generating…'}
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick actions toggle (when there are messages) */}
      {hasMessages && (
        <div className={`overflow-hidden transition-all duration-200 border-t border-gray-50 ${showActions ? 'max-h-24 py-2 px-3' : 'max-h-0'}`}>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.label}
                onClick={() => handleQuickAction(a)}
                disabled={generating}
                className="px-2 py-0.5 text-[10px] rounded-full bg-gray-50 border border-gray-200 text-gray-500 hover:bg-violet-50 hover:text-violet-600 disabled:opacity-40 transition-colors"
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
            disabled={generating}
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500 resize-none disabled:opacity-50 disabled:bg-gray-50"
            placeholder={hasExistingCode ? 'Describe changes…' : 'Describe document…'}
            style={{ maxHeight: '80px' }}
          />
          <button
            type="submit"
            disabled={!input.trim() || generating}
            className="p-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            {generating ? (
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
