import React from 'react';
import { Trash2, Search } from 'lucide-react';
import NodeProgressBar from './NodeProgressBar';

/**
 * Output Node — terminal node showing the filtered document list.
 * Green themed, has a connection-in handle on the left.
 */
export default function OutputNode({ node, isSelected, onSelect, onDragStart, onConnectStart, onConnectEnd, onDelete, processingStatus, onDoubleClick }) {
  const result = node.last_result || {};
  const count = result.count ?? null;

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
          isSelected ? 'border-green-500 shadow-green-100 shadow-md' : 'border-green-200 hover:border-green-400'
        }`}
      >
        {/* Header */}
        <div className="bg-green-50 rounded-t-[10px] px-3 py-2 flex items-center gap-2">
          <span className="text-base">📤</span>
          <span className="text-xs font-semibold text-green-800 truncate flex-1">{node.label || 'Output'}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-green-400 hover:text-green-700 transition-all hover:bg-green-50 rounded"
            title="Inspect"
          ><Search size={12} /></button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-green-400 hover:text-red-500 transition-all hover:bg-red-50 rounded"
            title="Delete"
          ><Trash2 size={12} /></button>
        </div>

        {/* Body */}
        <div className="px-3 py-2.5">
          {count !== null ? (
            <div>
              <p className="text-[11px] text-gray-600">
                <span className="font-bold text-green-700 text-sm">{count}</span> document{count !== 1 ? 's' : ''} matched
              </p>
              <button
                onClick={(e) => { e.stopPropagation(); onSelect(); }}
                className="mt-1.5 w-full text-[10px] px-2 py-1 bg-green-50 text-green-700 rounded-md hover:bg-green-100 font-medium transition-colors"
              >
                View Results →
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-gray-400">Execute workflow to see results</p>
          )}
        </div>

        {/* Processing progress bar */}
        <NodeProgressBar processingStatus={processingStatus} colorClass="from-green-400 to-green-600" />
      </div>

      {/* Connection handle — left only (input) */}
      <div
        className="absolute top-1/2 -left-2.5 w-5 h-5 bg-green-400 border-2 border-white rounded-full -translate-y-1/2 cursor-pointer hover:bg-green-600 transition-colors"
        title="Connect to this node"
        onMouseUp={(e) => { e.stopPropagation(); onConnectEnd(); }}
      />
    </div>
  );
}
