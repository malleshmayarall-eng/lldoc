import React from 'react';
import { Trash2, Search, Check, X } from 'lucide-react';
import NodeProgressBar from './NodeProgressBar';

/**
 * Validator Node — human approval gate with branching output.
 * Emerald themed. Two output handles:
 *   ✓ Approved (green, top-right)  →  downstream "approved" path
 *   ✕ Rejected (red,  bottom-right) →  downstream "rejected" path
 */
export default function ValidatorNode({ node, isSelected, onSelect, onDragStart, onConnectStart, onConnectEnd, onDelete, processingStatus, onDoubleClick }) {
  const config = node.config || {};
  const lastResult = node.last_result || {};

  const userCount = config.user_count || lastResult.count || 0;
  const validatorStatus = lastResult.validator_status || lastResult.status;
  const approved = lastResult.approved ?? 0;
  const pending = lastResult.pending ?? 0;
  const rejected = lastResult.rejected ?? 0;
  const total = lastResult.count ?? 0;

  const statusColors = {
    approved:       'bg-emerald-100 text-emerald-700',
    pending:        'bg-amber-100 text-amber-700',
    rejected:       'bg-red-100 text-red-700',
    no_validators:  'bg-gray-100 text-gray-500',
    error:          'bg-red-100 text-red-600',
  };

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
          isSelected ? 'border-emerald-500 shadow-emerald-100 shadow-md' : 'border-emerald-200 hover:border-emerald-400'
        }`}
      >
        {/* Header */}
        <div className="bg-emerald-50 rounded-t-[10px] px-3 py-2 flex items-center gap-2">
          <span className="text-base">✅</span>
          <span className="text-xs font-semibold text-emerald-800 truncate flex-1">{node.label || 'Validator'}</span>
          {userCount > 0 && (
            <span className="text-[10px] bg-emerald-200 text-emerald-800 px-1.5 rounded-full">{userCount} user{userCount !== 1 ? 's' : ''}</span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-emerald-400 hover:text-emerald-700 transition-all hover:bg-emerald-50 rounded"
            title="Inspect"
          ><Search size={12} /></button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-emerald-400 hover:text-red-500 transition-all hover:bg-red-50 rounded"
            title="Delete"
          ><Trash2 size={12} /></button>
        </div>

        {/* Body */}
        <div className="px-3 py-2">
          {!userCount && !validatorStatus ? (
            <p className="text-[11px] text-gray-400 italic">No users — click to configure</p>
          ) : (
            <div className="space-y-1.5">
              {/* Status badge */}
              {validatorStatus && (
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusColors[validatorStatus] || 'bg-gray-100 text-gray-500'}`}>
                    {validatorStatus.replace(/_/g, ' ')}
                  </span>
                </div>
              )}

              {/* Stats row */}
              {(approved > 0 || pending > 0 || rejected > 0) && (
                <div className="flex items-center gap-2 text-[10px]">
                  {approved > 0 && (
                    <span className="text-emerald-600 font-medium">✓ {approved}</span>
                  )}
                  {pending > 0 && (
                    <span className="text-amber-600 font-medium">⏳ {pending}</span>
                  )}
                  {rejected > 0 && (
                    <span className="text-red-600 font-medium">✕ {rejected}</span>
                  )}
                  {total > 0 && (
                    <span className="text-gray-400">/ {total} docs</span>
                  )}
                </div>
              )}

              {/* Config summary */}
              {config.description && (
                <p className="text-[10px] text-gray-400 truncate">{config.description}</p>
              )}
            </div>
          )}
        </div>

        {/* Processing progress bar */}
        <NodeProgressBar processingStatus={processingStatus} colorClass="from-emerald-400 to-emerald-600" />
      </div>

      {/* Input handle — left center */}
      <div
        className="absolute top-1/2 -left-2.5 w-5 h-5 bg-emerald-400 border-2 border-white rounded-full -translate-y-1/2 cursor-pointer hover:bg-emerald-600 transition-colors"
        title="Connect to this node"
        onMouseUp={(e) => { e.stopPropagation(); onConnectEnd(); }}
      />

      {/* Output handle — Approved (green, upper-right) */}
      <div
        className="absolute -right-2.5 flex items-center gap-1 cursor-pointer group/handle"
        style={{ top: '30%', transform: 'translateY(-50%)' }}
        title="Approved → drag to connect"
        onMouseDown={(e) => { e.stopPropagation(); onConnectStart('approved'); }}
      >
        <div className="w-5 h-5 bg-emerald-400 border-2 border-white rounded-full hover:bg-emerald-600 transition-colors flex items-center justify-center">
          <Check size={10} className="text-white" strokeWidth={3} />
        </div>
        <span className="text-[9px] font-medium text-emerald-600 opacity-0 group-hover:opacity-100 group-hover/handle:opacity-100 transition-opacity pointer-events-none whitespace-nowrap absolute left-6">
          True
        </span>
      </div>

      {/* Output handle — Rejected (red, lower-right) */}
      <div
        className="absolute -right-2.5 flex items-center gap-1 cursor-pointer group/handle"
        style={{ top: '70%', transform: 'translateY(-50%)' }}
        title="Rejected → drag to connect"
        onMouseDown={(e) => { e.stopPropagation(); onConnectStart('rejected'); }}
      >
        <div className="w-5 h-5 bg-red-400 border-2 border-white rounded-full hover:bg-red-600 transition-colors flex items-center justify-center">
          <X size={10} className="text-white" strokeWidth={3} />
        </div>
        <span className="text-[9px] font-medium text-red-500 opacity-0 group-hover:opacity-100 group-hover/handle:opacity-100 transition-opacity pointer-events-none whitespace-nowrap absolute left-6">
          False
        </span>
      </div>
    </div>
  );
}
