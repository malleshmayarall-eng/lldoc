import React from 'react';
import { Trash2, Search } from 'lucide-react';
import NodeProgressBar from './NodeProgressBar';

/**
 * DocCreateNode — creates editor documents from CLM metadata.
 * Supports modes: template, duplicate, quick_latex, structured.
 * Indigo themed, shows creation mode and last result stats on-canvas.
 */
export default function DocCreateNode({ node, isSelected, onSelect, onDragStart, onConnectStart, onConnectEnd, onDelete, processingStatus, onDoubleClick }) {
  const config = node.config || {};
  const creationMode = config.creation_mode || 'template';
  const templateName = config.template_name || '';
  const mappings = config.field_mappings || [];
  const lastResult = node.last_result || {};

  const modeLabels = {
    template:    { icon: '📄', label: 'From Template' },
    duplicate:   { icon: '📋', label: 'Duplicate' },
    quick_latex: { icon: '📐', label: 'Quick LaTeX' },
    structured:  { icon: '📝', label: 'Structured' },
  };
  const ml = modeLabels[creationMode] || { icon: '📄', label: creationMode };

  const hasCreated = lastResult.created > 0;
  const hasSkipped = lastResult.skipped > 0;
  const hasFailed = lastResult.failed > 0;
  const hasResults = hasCreated || hasSkipped || hasFailed;

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
          isSelected ? 'border-indigo-500 shadow-indigo-100 shadow-md' : 'border-indigo-200 hover:border-indigo-400'
        }`}
      >
        {/* Header */}
        <div className="bg-indigo-50 rounded-t-[10px] px-3 py-2 flex items-center gap-2">
          <span className="text-base">📄</span>
          <span className="text-xs font-semibold text-indigo-800 truncate flex-1">{node.label || 'Doc Create'}</span>
          <span className="text-[10px] bg-indigo-200 text-indigo-800 px-1.5 rounded-full">{ml.label}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-indigo-400 hover:text-indigo-700 transition-all hover:bg-indigo-50 rounded"
            title="Inspect"
          ><Search size={12} /></button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-indigo-400 hover:text-red-500 transition-all hover:bg-red-50 rounded"
            title="Delete"
          ><Trash2 size={12} /></button>
        </div>

        {/* Body */}
        <div className="px-3 py-2">
          {!creationMode || (creationMode === 'template' && !templateName) ? (
            <p className="text-[11px] text-gray-400 italic">No template — click to configure</p>
          ) : (
            <div className="space-y-1">
              {templateName && (
                <p className="text-[10px] text-gray-500 truncate">
                  <span className="text-indigo-500">Template:</span> {templateName.replace(/_/g, ' ')}
                </p>
              )}
              {mappings.length > 0 && (
                <p className="text-[10px] text-gray-500">
                  <span className="text-indigo-500">Mappings:</span> {mappings.length} field{mappings.length !== 1 ? 's' : ''}
                </p>
              )}
              {config.source_document_id && (
                <p className="text-[10px] text-gray-500 truncate">
                  <span className="text-indigo-500">Source:</span> {config.source_document_id.slice(0, 8)}…
                </p>
              )}
            </div>
          )}

          {/* Last result stats */}
          {hasResults && (
            <div className="flex flex-wrap gap-1 mt-1.5 pt-1.5 border-t border-gray-100">
              {hasCreated && (
                <span className="text-[9px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-medium">
                  ✓ {lastResult.created} created
                </span>
              )}
              {hasSkipped && (
                <span className="text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-medium">
                  ⊘ {lastResult.skipped} skipped
                </span>
              )}
              {hasFailed && (
                <span className="text-[9px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-medium">
                  ✕ {lastResult.failed} failed
                </span>
              )}
            </div>
          )}
        </div>

        {/* Progress */}
        <NodeProgressBar status={processingStatus} color="indigo" />

        {/* Connection handles */}
        <div
          className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-indigo-300 bg-white hover:bg-indigo-100 hover:border-indigo-500 cursor-pointer transition-colors"
          onMouseUp={() => onConnectEnd?.()}
          title="Input"
        />
        <div
          className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-indigo-300 bg-white hover:bg-indigo-100 hover:border-indigo-500 cursor-pointer transition-colors"
          onMouseDown={(e) => { e.stopPropagation(); onConnectStart?.(); }}
          title="Output"
        />
      </div>
    </div>
  );
}
