import React from 'react';
import { Trash2, Search } from 'lucide-react';
import NodeProgressBar from './NodeProgressBar';

/**
 * GateNode — AND logic gate node.
 *
 * Visual design:
 *   Multiple input handles (stacked) on the LEFT  → convergence point
 *   Single output handle on the RIGHT              → merged result
 *
 * AND (orange): passes docs present in ALL upstream paths (set intersection ∩)
 *
 * Note: A separate OR gate is unnecessary because regular nodes with multiple
 * inputs already merge all upstream docs (union) automatically.
 */
export default function GateNode({ node, isSelected, onSelect, onDragStart, onConnectStart, onConnectEnd, onDelete, processingStatus, onDoubleClick }) {
  const lastResult = node.last_result || {};

  const hasResult = lastResult.count != null;
  const parentCount = lastResult.parent_count || 0;

  // Show 2-4 stacked input handles to visually signal "multiple inputs"
  const inputHandleCount = Math.max(2, Math.min(parentCount || 2, 4));
  const handleSpacing = 18;
  const totalHandleHeight = (inputHandleCount - 1) * handleSpacing;

  return (
    <div
      className={`absolute select-none group ${isSelected ? 'z-20' : 'z-10'}`}
      style={{ left: node.position_x, top: node.position_y, width: 200 }}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
      onMouseDown={onDragStart}
    >
      <div
        className={`rounded-xl border-2 shadow-sm bg-white transition-all ${
          isSelected
            ? 'border-orange-500 shadow-orange-100 shadow-md'
            : 'border-orange-200 hover:border-orange-400'
        }`}
      >
        {/* Header */}
        <div className="bg-orange-50 rounded-t-[10px] px-3 py-2 flex items-center gap-2">
          <span className="text-base font-bold" style={{ fontFamily: 'serif' }}>∩</span>
          <span className="text-xs font-semibold text-orange-800 truncate flex-1">
            {node.label || 'AND Gate'}
          </span>
          <span className="text-[10px] bg-orange-200 text-orange-800 px-1.5 py-0.5 rounded-full font-bold tracking-wide">
            AND
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-orange-400 hover:text-orange-700 transition-all hover:bg-orange-50 rounded"
            title="Inspect"
          ><Search size={12} /></button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-orange-800 hover:text-red-500 transition-all hover:bg-red-50 rounded"
            title="Delete"
          ><Trash2 size={12} /></button>
        </div>

        {/* Body */}
        <div className="px-3 py-2">
          {/* Merge behavior label */}
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-orange-600">
              INTERSECTION — docs in ALL paths
            </span>
          </div>

          {/* Visual merge indicator: multiple bars → arrow → single bar */}
          <div className="flex items-center gap-2 mb-1.5">
            <div className="flex flex-col gap-0.5">
              {[...Array(Math.min(inputHandleCount, 3))].map((_, i) => (
                <div key={i} className="w-6 h-1 rounded-full bg-orange-200" />
              ))}
            </div>
            <span className="text-sm text-orange-600">→</span>
            <div className="w-8 h-1.5 rounded-full bg-orange-400" />
          </div>

          {/* Last execution stats */}
          {hasResult && (
            <div className="space-y-0.5 mt-1 pt-1 border-t border-gray-100">
              <div className="flex items-center gap-2 text-[10px] font-medium">
                <span className="text-emerald-600">✓ {lastResult.count} passed</span>
                {lastResult.blocked > 0 && (
                  <span className="text-gray-400">✕ {lastResult.blocked} blocked</span>
                )}
              </div>
              {parentCount > 0 && (
                <p className="text-[10px] text-gray-400">
                  {parentCount} input path{parentCount !== 1 ? 's' : ''}
                  {lastResult.total_upstream ? ` · ${lastResult.total_upstream} total docs` : ''}
                </p>
              )}
            </div>
          )}

          {!hasResult && (
            <p className="text-[11px] text-gray-300 italic mt-1">Connect 2+ paths → run</p>
          )}
        </div>

        {/* Processing progress bar */}
        <NodeProgressBar processingStatus={processingStatus} colorClass="from-orange-400 to-orange-600" />
      </div>

      {/* ── Multiple INPUT handles (left side, stacked) ── */}
      {[...Array(inputHandleCount)].map((_, i) => {
        const yOffset = 50 - totalHandleHeight / 2 + i * handleSpacing;
        return (
          <div
            key={`in-${i}`}
            className="absolute -left-2.5 w-4 h-4 bg-orange-400 hover:bg-orange-600 border-2 border-white rounded-full cursor-pointer transition-colors"
            style={{ top: `calc(${yOffset}%)` }}
            title={`Input ${i + 1} — connect upstream`}
            onMouseUp={(e) => { e.stopPropagation(); onConnectEnd(); }}
          />
        );
      })}

      {/* ── Single OUTPUT handle (right side, centered) ── */}
      <div
        className="absolute top-1/2 -right-2.5 w-5 h-5 bg-orange-500 hover:bg-orange-700 border-2 border-white rounded-full -translate-y-1/2 cursor-pointer transition-colors"
        title="Output — drag to connect downstream"
        onMouseDown={(e) => { e.stopPropagation(); onConnectStart(); }}
      >
        <span className="absolute inset-0 flex items-center justify-center text-white text-[8px] font-bold">→</span>
      </div>
    </div>
  );
}
