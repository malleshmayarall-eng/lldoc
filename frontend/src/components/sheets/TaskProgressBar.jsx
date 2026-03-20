/**
 * TaskProgressBar — animated progress bar for async sheet operations.
 *
 * Props:
 *  - task: { status, progress, total_items, completed_items, task_type, error }
 *  - label: optional override label
 *  - onDismiss: callback to dismiss
 *  - compact: if true, renders inline mini-bar
 */

import { memo } from 'react';
import { Loader2, CheckCircle2, XCircle, X } from 'lucide-react';

const TASK_TYPE_LABELS = {
  formula_eval: 'Evaluating Formulas',
  search: 'Searching',
  analytics: 'Running Analytics',
  chart_gen: 'Generating Charts',
  bulk_update: 'Bulk Update',
  export: 'Exporting',
};

const STATUS_COLORS = {
  pending: 'bg-gray-300',
  running: 'bg-indigo-500',
  completed: 'bg-emerald-500',
  failed: 'bg-red-500',
  cancelled: 'bg-gray-400',
};

function TaskProgressBar({ task, label, onDismiss, compact = false }) {
  if (!task) return null;

  const { status, progress = 0, total_items, completed_items, task_type, error } = task;
  const pct = Math.min(100, Math.max(0, Math.round(progress)));
  const taskLabel = label || TASK_TYPE_LABELS[task_type] || 'Processing';
  const barColor = STATUS_COLORS[status] || STATUS_COLORS.running;

  if (compact) {
    return (
      <div className="flex items-center gap-2 min-w-[180px]">
        {status === 'running' && <Loader2 className="h-3 w-3 animate-spin text-indigo-500 flex-shrink-0" />}
        {status === 'completed' && <CheckCircle2 className="h-3 w-3 text-emerald-500 flex-shrink-0" />}
        {status === 'failed' && <XCircle className="h-3 w-3 text-red-500 flex-shrink-0" />}
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[10px] font-mono text-gray-400 min-w-[32px] text-right">{pct}%</span>
        {onDismiss && (status === 'completed' || status === 'failed') && (
          <button onClick={onDismiss} className="p-0.5 hover:bg-gray-200 rounded">
            <X className="h-2.5 w-2.5 text-gray-400" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />}
          {status === 'completed' && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          {status === 'failed' && <XCircle className="h-4 w-4 text-red-500" />}
          {status === 'pending' && <Loader2 className="h-4 w-4 text-gray-400" />}
          <span className="text-sm font-medium text-gray-700">{taskLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-gray-400">{pct}%</span>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="h-3.5 w-3.5 text-gray-400" />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ease-out ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Details row */}
      <div className="flex items-center justify-between text-[11px] text-gray-400">
        {total_items > 0 && (
          <span>{(completed_items || 0).toLocaleString()} / {total_items.toLocaleString()} items</span>
        )}
        {status === 'failed' && error && (
          <span className="text-red-500 truncate max-w-[300px]">{error}</span>
        )}
        {status === 'completed' && (
          <span className="text-emerald-600">Done</span>
        )}
      </div>
    </div>
  );
}

export default memo(TaskProgressBar);
