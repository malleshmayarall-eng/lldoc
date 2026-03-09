import React from 'react';
import { Trash2, Search } from 'lucide-react';
import NodeProgressBar from './NodeProgressBar';

/**
 * Listener Node — watches for events, gates for approval, or auto-triggers.
 * Cyan/teal themed, shows trigger type, status badge, and pending approval count.
 */
export default function ListenerNode({ node, isSelected, onSelect, onDragStart, onConnectStart, onConnectEnd, onDelete, processingStatus, onDoubleClick }) {
  const config = node.config || {};
  const triggerType = config.trigger_type || '';
  const lastResult = node.last_result || {};

  const triggerLabels = {
    document_uploaded:    { icon: '📥', label: 'Doc Uploaded' },
    approval_required:    { icon: '✋', label: 'Approval Gate' },
    field_changed:        { icon: '🔍', label: 'Field Condition' },
    all_documents_ready:  { icon: '✅', label: 'All Ready' },
    document_count:       { icon: '📊', label: 'Count Threshold' },
    manual:               { icon: '🖱️', label: 'Manual' },
    schedule:             { icon: '⏰', label: 'Schedule' },
    email_inbox:          { icon: '📧', label: 'Email Inbox' },
    folder_watch:         { icon: '📂', label: 'Folder Watch' },
  };
  const tl = triggerLabels[triggerType] || { icon: '👁', label: triggerType || 'No trigger' };

  const statusColors = {
    pending:    'bg-amber-100 text-amber-700',
    approved:   'bg-emerald-100 text-emerald-700',
    rejected:   'bg-red-100 text-red-700',
    auto_fired: 'bg-cyan-100 text-cyan-700',
    expired:    'bg-gray-100 text-gray-500',
    cancelled:  'bg-gray-100 text-gray-500',
  };

  const eventStatus = lastResult.listener_status || lastResult.status;
  const eventMessage = lastResult.listener_message || lastResult.message;
  const passedCount = lastResult.passed_count ?? lastResult.count;
  const eventId = lastResult.event_id;

  return (
    <div
      className={`absolute select-none group ${isSelected ? 'z-20' : 'z-10'}`}
      style={{ left: node.position_x, top: node.position_y, width: 220 }}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
      onMouseDown={onDragStart}
    >
      <div
        className={`rounded-xl border-2 shadow-sm bg-white transition-all ${
          isSelected ? 'border-cyan-500 shadow-cyan-100 shadow-md' : 'border-cyan-200 hover:border-cyan-400'
        }`}
      >
        {/* Header */}
        <div className="bg-cyan-50 rounded-t-[10px] px-3 py-2 flex items-center gap-2">
          <span className="text-base">{tl.icon}</span>
          <span className="text-xs font-semibold text-cyan-800 truncate flex-1">{node.label || 'Listener'}</span>
          {triggerType && (
            <span className="text-[10px] bg-cyan-200 text-cyan-800 px-1.5 rounded-full">{tl.label}</span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-cyan-400 hover:text-cyan-700 transition-all hover:bg-cyan-50 rounded"
            title="Inspect"
          ><Search size={12} /></button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-cyan-400 hover:text-red-500 transition-all hover:bg-red-50 rounded"
            title="Delete"
          ><Trash2 size={12} /></button>
        </div>

        {/* Body */}
        <div className="px-3 py-2">
          {!triggerType ? (
            <p className="text-[11px] text-gray-400 italic">No trigger — click to configure</p>
          ) : (
            <div className="space-y-1">
              {/* Gate message for approval triggers */}
              {triggerType === 'approval_required' && config.gate_message && (
                <p className="text-[10px] text-gray-500 truncate">
                  <span className="text-cyan-500">Gate:</span> {config.gate_message}
                </p>
              )}

              {/* Field condition info */}
              {triggerType === 'field_changed' && config.watch_field && (
                <p className="text-[10px] text-gray-500 truncate">
                  <span className="text-cyan-500">Watch:</span> {config.watch_field} {config.watch_operator || '='} {config.watch_value}
                </p>
              )}

              {/* Document count threshold */}
              {triggerType === 'document_count' && config.threshold && (
                <p className="text-[10px] text-gray-500">
                  <span className="text-cyan-500">Min:</span> {config.threshold} docs
                </p>
              )}

              {/* Status badge */}
              {eventStatus && (
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusColors[eventStatus] || 'bg-gray-100 text-gray-500'}`}>
                    {eventStatus.replace(/_/g, ' ')}
                  </span>
                  {passedCount != null && (
                    <span className="text-[10px] text-gray-400">{passedCount} docs</span>
                  )}
                </div>
              )}

              {/* Event message */}
              {eventMessage && !eventStatus && (
                <p className="text-[10px] text-gray-400 truncate">{eventMessage}</p>
              )}
            </div>
          )}
        </div>

        {/* Processing progress bar */}
        <NodeProgressBar processingStatus={processingStatus} colorClass="from-cyan-400 to-cyan-600" />
      </div>

      {/* Connection handles */}
      <div
        className="absolute top-1/2 -left-2.5 w-5 h-5 bg-cyan-400 border-2 border-white rounded-full -translate-y-1/2 cursor-pointer hover:bg-cyan-600 transition-colors"
        title="Connect to this node"
        onMouseUp={(e) => { e.stopPropagation(); onConnectEnd(); }}
      />
      <div
        className="absolute top-1/2 -right-2.5 w-5 h-5 bg-cyan-400 border-2 border-white rounded-full -translate-y-1/2 cursor-pointer hover:bg-cyan-600 transition-colors"
        title="Drag to connect"
        onMouseDown={(e) => { e.stopPropagation(); onConnectStart(); }}
      />
    </div>
  );
}
