import React from 'react';
import { Trash2, Search } from 'lucide-react';
import NodeProgressBar from './NodeProgressBar';

export default function SheetNode({
  node, isSelected, onSelect, onDragStart,
  onConnectStart, onConnectEnd, onDelete,
  processingStatus, onDoubleClick,
  onOpenSheet,
}) {
  const config = node.config || {};
  const mode = config.mode || 'storage';
  const sheetTitle = config.sheet_title || '';
  const writeMode = config.write_mode || 'append';
  const lastResult = node.last_result || {};

  const isInput = mode === 'input';

  const modeLabels = {
    input:   { icon: '📊', label: 'Auto Read',   desc: 'Reads rows automatically' },
    storage: { icon: '📝', label: writeMode === 'overwrite' ? 'Overwrite' : 'Append', desc: writeMode === 'overwrite' ? 'Clears & rewrites sheet' : 'Appends data to sheet' },
  };
  const ml = modeLabels[mode] || modeLabels.storage;

  // Stats from last execution
  const rowCount = lastResult.row_count ?? 0;
  const rowsWritten = lastResult.rows_written ?? 0;
  const rowsOverwritten = lastResult.rows_overwritten ?? 0;
  const queryCount = lastResult.query_count ?? 0;
  const cacheHits = lastResult.cache_hits ?? 0;
  const hasResults = lastResult.sheet_status === 'completed' || lastResult.sheet_mode;

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
          isSelected
            ? 'border-cyan-500 shadow-cyan-100 shadow-md'
            : 'border-cyan-200 hover:border-cyan-400'
        }`}
      >
        {/* Header */}
        <div className="bg-cyan-50 rounded-t-[10px] px-3 py-2 flex items-center gap-2">
          <span className="text-base">{isInput ? '📊' : '📝'}</span>
          <span className="text-xs font-semibold text-cyan-800 truncate flex-1">
            {node.label || 'Sheet'}
          </span>
          <span className={`text-[10px] px-1.5 rounded-full font-medium ${
            isInput
              ? 'bg-blue-100 text-blue-700'
              : writeMode === 'overwrite'
                ? 'bg-amber-200 text-amber-800'
                : 'bg-cyan-200 text-cyan-800'
          }`}>
            {ml.label}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); if (onOpenSheet) onOpenSheet(); else onDoubleClick?.(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-cyan-400 hover:text-cyan-700 transition-all hover:bg-cyan-50 rounded"
            title="Open sheet"
          ><Search size={12} /></button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-cyan-400 hover:text-red-500 transition-all hover:bg-red-50 rounded"
            title="Delete"
          ><Trash2 size={12} /></button>
        </div>

        {/* Body */}
        <div className="px-3 py-2">
          {!config.sheet_id ? (
            <p className="text-[11px] text-gray-400 italic">No sheet linked</p>
          ) : (
            <div className="space-y-1">
              {/* Sheet title */}
              {sheetTitle && (
                <p className="text-[10px] text-gray-500 truncate">
                  <span className="text-cyan-500">Sheet:</span> {sheetTitle}
                </p>
              )}
              {!sheetTitle && (
                <p className="text-[10px] text-gray-500 truncate">
                  <span className="text-cyan-500">ID:</span> {config.sheet_id.slice(0, 8)}…
                </p>
              )}

              {/* Column mapping count */}
              {config.column_mapping && Object.keys(config.column_mapping).length > 0 && (
                <p className="text-[10px] text-gray-500">
                  <span className="text-cyan-500">Mapping:</span> {Object.keys(config.column_mapping).length} field{Object.keys(config.column_mapping).length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          )}

          {/* Last execution stats */}
          {hasResults && (
            <div className="flex flex-wrap gap-1 mt-1.5 pt-1.5 border-t border-gray-100">
              {isInput && rowCount > 0 && (
                <span className="text-[9px] px-1.5 py-0.5 bg-cyan-100 text-cyan-700 rounded font-medium">
                  📊 {rowCount} row{rowCount !== 1 ? 's' : ''} read
                </span>
              )}
              {!isInput && rowsOverwritten > 0 && (
                <span className="text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-medium">
                  🗑️ {rowsOverwritten} cleared
                </span>
              )}
              {!isInput && rowsWritten > 0 && (
                <span className="text-[9px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-medium">
                  ✓ {rowsWritten} written
                </span>
              )}
              {queryCount > 0 && (
                <span className="text-[9px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-medium">
                  ⚡ {queryCount} quer{queryCount !== 1 ? 'ies' : 'y'}
                </span>
              )}
              {cacheHits > 0 && (
                <span className="text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-medium">
                  ⊘ {cacheHits} cached
                </span>
              )}
              {lastResult.sheet_status === 'completed' && (
                <span className="text-[9px] px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded font-medium">
                  ✓ Executed
                </span>
              )}
            </div>
          )}
        </div>

        {/* Progress */}
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
