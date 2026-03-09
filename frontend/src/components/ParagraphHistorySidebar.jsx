import React, { useCallback, useEffect, useState } from 'react';
import { X, History, RotateCcw, ChevronDown, ChevronUp, User, Bot, Clock } from 'lucide-react';
import { paragraphHistoryService } from '../services';

// ── helpers ────────────────────────────────────────────────────────────

const CHANGE_TYPE_META = {
  created:   { label: 'Created',   color: 'emerald', icon: '✦' },
  edited:    { label: 'Edited',    color: 'blue',    icon: '✎' },
  restored:  { label: 'Restored',  color: 'amber',   icon: '↺' },
  ai_update: { label: 'AI Update', color: 'violet',  icon: '✦' },
  reorder:   { label: 'Reordered', color: 'gray',    icon: '↕' },
  deleted:   { label: 'Deleted',   color: 'red',     icon: '✕' },
};

const formatDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatFullDate = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
};

/**
 * Minimal word-level diff.
 * Returns an array of { type: 'same'|'added'|'removed', text } segments.
 */
const computeWordDiff = (oldText, newText) => {
  if (!oldText && !newText) return [];
  if (!oldText) return [{ type: 'added', text: newText }];
  if (!newText) return [{ type: 'removed', text: oldText }];

  const oldWords = oldText.split(/(\s+)/);
  const newWords = newText.split(/(\s+)/);

  // Simple LCS-based diff for small texts
  const segments = [];
  let oi = 0;
  let ni = 0;

  while (oi < oldWords.length && ni < newWords.length) {
    if (oldWords[oi] === newWords[ni]) {
      segments.push({ type: 'same', text: oldWords[oi] });
      oi++;
      ni++;
    } else {
      // Look ahead in new for old word
      let foundInNew = -1;
      for (let j = ni + 1; j < Math.min(ni + 10, newWords.length); j++) {
        if (newWords[j] === oldWords[oi]) { foundInNew = j; break; }
      }
      let foundInOld = -1;
      for (let j = oi + 1; j < Math.min(oi + 10, oldWords.length); j++) {
        if (oldWords[j] === newWords[ni]) { foundInOld = j; break; }
      }

      if (foundInNew >= 0 && (foundInOld < 0 || (foundInNew - ni) <= (foundInOld - oi))) {
        // Words added in new
        for (let j = ni; j < foundInNew; j++) {
          segments.push({ type: 'added', text: newWords[j] });
        }
        ni = foundInNew;
      } else if (foundInOld >= 0) {
        // Words removed from old
        for (let j = oi; j < foundInOld; j++) {
          segments.push({ type: 'removed', text: oldWords[j] });
        }
        oi = foundInOld;
      } else {
        segments.push({ type: 'removed', text: oldWords[oi] });
        segments.push({ type: 'added', text: newWords[ni] });
        oi++;
        ni++;
      }
    }
  }
  while (oi < oldWords.length) {
    segments.push({ type: 'removed', text: oldWords[oi++] });
  }
  while (ni < newWords.length) {
    segments.push({ type: 'added', text: newWords[ni++] });
  }
  return segments;
};

// ── DiffView ───────────────────────────────────────────────────────────

const DiffView = ({ previous, current }) => {
  const segments = computeWordDiff(previous || '', current || '');
  if (!segments.length) return <span className="text-gray-400 italic text-xs">No changes</span>;

  return (
    <div className="text-xs leading-relaxed whitespace-pre-wrap break-words">
      {segments.map((seg, i) => {
        if (seg.type === 'same') return <span key={i}>{seg.text}</span>;
        if (seg.type === 'added') return <span key={i} className="bg-emerald-100 text-emerald-800">{seg.text}</span>;
        return <span key={i} className="bg-red-100 text-red-700 line-through">{seg.text}</span>;
      })}
    </div>
  );
};

// ── Timeline Entry ─────────────────────────────────────────────────────

const HistoryEntry = ({ entry, isLatest, onRestore }) => {
  const [expanded, setExpanded] = useState(false);
  const meta = CHANGE_TYPE_META[entry.change_type] || CHANGE_TYPE_META.edited;
  const hasDiff = entry.previous_content && entry.content_snapshot !== entry.previous_content;

  return (
    <div className="relative pl-6">
      {/* Timeline dot */}
      <div
        className={`absolute left-0 top-1.5 w-3 h-3 rounded-full border-2 border-white shadow
          bg-${meta.color}-500`}
        title={meta.label}
      />

      <div className="pb-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold text-${meta.color}-700 bg-${meta.color}-50 border border-${meta.color}-200 rounded-full px-2 py-0.5`}>
              <span>{meta.icon}</span>
              {meta.label}
            </span>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-500">
              {entry.change_type === 'ai_update'
                ? <Bot size={11} className="text-violet-500" />
                : <User size={11} />}
              <span className="font-medium text-gray-700">
                {entry.changed_by_display || 'Unknown'}
              </span>
              <span>·</span>
              <Clock size={10} />
              <span title={formatFullDate(entry.created_at)}>
                {formatDate(entry.created_at)}
              </span>
            </div>
          </div>

          {/* Restore button — don't show for the latest (current) version */}
          {!isLatest && (
            <button
              onClick={() => onRestore(entry)}
              className="flex-shrink-0 flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 hover:bg-amber-100 transition-colors"
              title="Restore paragraph to this version"
            >
              <RotateCcw size={11} />
              Restore
            </button>
          )}
        </div>

        {/* Summary */}
        {entry.change_summary && (
          <p className="mt-1 text-[11px] text-gray-500 italic">{entry.change_summary}</p>
        )}

        {/* Expand / collapse diff */}
        {hasDiff && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-1.5 flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800"
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {expanded ? 'Hide changes' : 'Show changes'}
          </button>
        )}

        {expanded && hasDiff && (
          <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-2">
            <DiffView previous={entry.previous_content} current={entry.content_snapshot} />
          </div>
        )}

        {/* For 'created' entries with no previous content, just show the snapshot */}
        {entry.change_type === 'created' && entry.content_snapshot && (
          <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-2">
            <p className="text-xs text-gray-600 whitespace-pre-wrap break-words">
              {entry.content_snapshot.length > 200
                ? entry.content_snapshot.slice(0, 200) + '…'
                : entry.content_snapshot}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main Sidebar ───────────────────────────────────────────────────────

const ParagraphHistorySidebar = ({
  isOpen,
  paragraphId,
  paragraphLabel,
  onClose,
  onRestored,
}) => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [restoring, setRestoring] = useState(null); // id being restored

  const fetchHistory = useCallback(async () => {
    if (!paragraphId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await paragraphHistoryService.getHistory(paragraphId);
      setHistory(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch paragraph history', err);
      setError('Could not load history');
    } finally {
      setLoading(false);
    }
  }, [paragraphId]);

  useEffect(() => {
    if (isOpen && paragraphId) {
      fetchHistory();
    }
    if (!isOpen) {
      setHistory([]);
      setError(null);
    }
  }, [isOpen, paragraphId, fetchHistory]);

  const handleRestore = async (entry) => {
    if (!window.confirm('Restore paragraph to this version? The current content will be saved as a new history entry.')) return;
    setRestoring(entry.id);
    try {
      const result = await paragraphHistoryService.restore(entry.id);
      // Refresh timeline
      await fetchHistory();
      // Notify parent so it can update paragraph in editor state
      onRestored?.(result.paragraph);
    } catch (err) {
      console.error('Restore failed', err);
      setError('Restore failed — please try again');
    } finally {
      setRestoring(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-96 max-w-full bg-white shadow-xl flex flex-col border-l border-gray-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <History size={16} className="text-blue-600" />
            <h2 className="text-sm font-semibold text-gray-900">Paragraph History</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 text-gray-500"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Label */}
        {paragraphLabel && (
          <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100 truncate">
            {paragraphLabel}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <div className="animate-spin h-4 w-4 border-2 border-blue-400 border-t-transparent rounded-full" />
              Loading history…
            </div>
          )}

          {error && (
            <div className="text-xs text-red-600 bg-red-50 rounded p-2">{error}</div>
          )}

          {!loading && !error && history.length === 0 && (
            <p className="text-xs text-gray-400 italic">No history recorded yet.</p>
          )}

          {/* Timeline */}
          {history.length > 0 && (
            <div className="relative border-l-2 border-gray-200 ml-1.5">
              {history.map((entry, idx) => (
                <HistoryEntry
                  key={entry.id}
                  entry={entry}
                  isLatest={idx === 0}
                  onRestore={handleRestore}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-4 py-2 text-[10px] text-gray-400 text-center">
          {history.length} version{history.length !== 1 ? 's' : ''} recorded
        </div>
      </div>
    </div>
  );
};

export default ParagraphHistorySidebar;
