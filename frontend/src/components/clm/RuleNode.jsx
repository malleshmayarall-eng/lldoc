import React from 'react';
import { Trash2, Search } from 'lucide-react';
import NodeProgressBar from './NodeProgressBar';

/**
 * Rule Node — filter node with metadata conditions.
 * Amber themed, shows condition summary on-canvas, has in/out handles.
 */
export default function RuleNode({ node, isSelected, onSelect, onDragStart, onConnectStart, onConnectEnd, onDelete, processingStatus, onDoubleClick }) {
  const config = node.config || {};
  const conditions = config.conditions || [];
  const boolOp = config.boolean_operator || 'AND';

  const opLabels = {
    eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤',
    contains: '∋', not_contains: '∌',
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
          isSelected ? 'border-amber-500 shadow-amber-100 shadow-md' : 'border-amber-200 hover:border-amber-400'
        }`}
      >
        {/* Header */}
        <div className="bg-amber-50 rounded-t-[10px] px-3 py-2 flex items-center gap-2">
          <span className="text-base">⚙️</span>
          <span className="text-xs font-semibold text-amber-800 truncate flex-1">{node.label || 'Rule'}</span>
          <span className="text-[10px] bg-amber-200 text-amber-800 px-1.5 rounded-full">{boolOp}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-amber-400 hover:text-amber-700 transition-all hover:bg-amber-50 rounded"
            title="Inspect"
          ><Search size={12} /></button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-amber-400 hover:text-red-500 transition-all hover:bg-red-50 rounded"
            title="Delete"
          ><Trash2 size={12} /></button>
        </div>

        {/* Conditions preview */}
        <div className="px-3 py-2">
          {conditions.length === 0 ? (
            <p className="text-[11px] text-gray-400 italic">No conditions — click to configure</p>
          ) : (
            <div className="space-y-0.5">
              {conditions.slice(0, 4).map((c, i) => (
                <div key={i} className="flex items-center text-[11px] gap-1">
                  <span className="text-amber-700 font-medium truncate max-w-[80px]">{c.field || '?'}</span>
                  <span className="text-gray-400">{opLabels[c.operator] || c.operator}</span>
                  <span className="text-gray-700 truncate max-w-[60px]">{c.value || '—'}</span>
                </div>
              ))}
              {conditions.length > 4 && (
                <p className="text-[10px] text-gray-400">+{conditions.length - 4} more</p>
              )}
            </div>
          )}
        </div>

        {/* Processing progress bar */}
        <NodeProgressBar processingStatus={processingStatus} colorClass="from-amber-400 to-amber-600" />
      </div>

      {/* Connection handles */}
      <div
        className="absolute top-1/2 -left-2.5 w-5 h-5 bg-amber-400 border-2 border-white rounded-full -translate-y-1/2 cursor-pointer hover:bg-amber-600 transition-colors"
        title="Connect to this node"
        onMouseUp={(e) => { e.stopPropagation(); onConnectEnd(); }}
      />
      <div
        className="absolute top-1/2 -right-2.5 w-5 h-5 bg-amber-400 border-2 border-white rounded-full -translate-y-1/2 cursor-pointer hover:bg-amber-600 transition-colors"
        title="Drag to connect"
        onMouseDown={(e) => { e.stopPropagation(); onConnectStart(); }}
      />
    </div>
  );
}
