import React from 'react';
import { Trash2, Search } from 'lucide-react';
import NodeProgressBar from './NodeProgressBar';

/**
 * AI Node — sends each incoming document to an AI model (Gemini / ChatGPT)
 * with a user-defined system prompt, stores the response in metadata.
 * Rose/pink themed, shows model name and prompt preview on-canvas.
 */
export default function AINode({ node, isSelected, onSelect, onDragStart, onConnectStart, onConnectEnd, onDelete, processingStatus, onDoubleClick }) {
  const config = node.config || {};
  const modelName = config.model || '';
  const systemPrompt = config.system_prompt || '';
  const outputFormat = config.output_format || 'text';
  const outputKey = config.output_key || 'ai_analysis';
  const jsonFields = config.json_fields || [];
  const lastResult = node.last_result || {};

  const modelLabels = {
    'gemini-2.0-flash':  { icon: '✨', label: 'Gemini 2.0 Flash' },
    'gemini-1.5-pro':    { icon: '🧠', label: 'Gemini 1.5 Pro' },
    'gemini-1.5-flash':  { icon: '⚡', label: 'Gemini 1.5 Flash' },
    'gpt-4o':            { icon: '🤖', label: 'GPT-4o' },
    'gpt-4o-mini':       { icon: '🤖', label: 'GPT-4o Mini' },
    'gpt-3.5-turbo':     { icon: '🤖', label: 'GPT-3.5' },
  };
  const ml = modelLabels[modelName] || { icon: '🧪', label: modelName || 'No model' };

  const formatLabels = {
    json_extract: { icon: '📋', label: 'JSON Extract', color: 'bg-indigo-100 text-indigo-700' },
    yes_no:       { icon: '✅', label: 'Yes / No Gate', color: 'bg-amber-100 text-amber-700' },
    text:         { icon: '📝', label: 'Free Text', color: 'bg-gray-100 text-gray-600' },
  };
  const fl = formatLabels[outputFormat] || formatLabels.text;

  const hasProcessed = lastResult.processed > 0;
  const hasFailed = lastResult.failed > 0;

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
          isSelected ? 'border-rose-500 shadow-rose-100 shadow-md' : 'border-rose-200 hover:border-rose-400'
        }`}
      >
        {/* Header */}
        <div className="bg-rose-50 rounded-t-[10px] px-3 py-2 flex items-center gap-2">
          <span className="text-base">🧪</span>
          <span className="text-xs font-semibold text-rose-800 truncate flex-1">{node.label || 'AI'}</span>
          {modelName && (
            <span className="text-[10px] bg-rose-200 text-rose-800 px-1.5 rounded-full">{ml.label}</span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-rose-400 hover:text-rose-700 transition-all hover:bg-rose-50 rounded"
            title="Inspect"
          ><Search size={12} /></button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-rose-400 hover:text-red-500 transition-all hover:bg-red-50 rounded"
            title="Delete"
          ><Trash2 size={12} /></button>
        </div>

        {/* Body */}
        <div className="px-3 py-2">
          {!modelName && !systemPrompt ? (
            <p className="text-[11px] text-gray-400 italic">No model — click to configure</p>
          ) : (
            <div className="space-y-1">
              {/* Output format badge */}
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${fl.color}`}>
                  {fl.icon} {fl.label}
                </span>
              </div>
              {/* Show model */}
              {modelName && (
                <p className="text-[10px] text-gray-500 truncate">
                  <span className="text-rose-500">Model:</span> {ml.icon} {ml.label}
                </p>
              )}
              {/* Prompt preview */}
              {systemPrompt && (
                <p className="text-[10px] text-gray-500 truncate">
                  <span className="text-rose-500">Prompt:</span> {systemPrompt.slice(0, 50)}{systemPrompt.length > 50 ? '…' : ''}
                </p>
              )}
              {/* JSON fields preview */}
              {outputFormat === 'json_extract' && jsonFields.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {jsonFields.slice(0, 3).map((f, i) => (
                    <span key={i} className="text-[9px] bg-indigo-50 text-indigo-600 px-1 py-0.5 rounded font-mono">{f.name}</span>
                  ))}
                  {jsonFields.length > 3 && <span className="text-[9px] text-gray-400">+{jsonFields.length - 3} more</span>}
                </div>
              )}
              {/* Yes/No output key */}
              {outputFormat === 'yes_no' && (
                <p className="text-[10px] text-gray-500 truncate">
                  <span className="text-rose-500">→</span> {outputKey} = yes/no
                </p>
              )}
              {/* Text output key */}
              {outputFormat === 'text' && outputKey && (
                <p className="text-[10px] text-gray-500 truncate">
                  <span className="text-rose-500">→</span> {outputKey}
                </p>
              )}
              {/* Last execution stats */}
              {(hasProcessed || hasFailed) && (
                <div className="flex gap-2 mt-1 text-[10px] font-medium">
                  {hasProcessed && <span className="text-emerald-600">✓ {lastResult.processed}</span>}
                  {hasFailed && <span className="text-red-600">✕ {lastResult.failed}</span>}
                </div>
              )}
              {lastResult.count != null && !hasProcessed && !hasFailed && (
                <p className="text-[11px] text-gray-400">{lastResult.count} docs in pipeline</p>
              )}
            </div>
          )}
        </div>

        {/* Processing progress bar */}
        <NodeProgressBar processingStatus={processingStatus} colorClass="from-rose-400 to-rose-600" />
      </div>

      {/* Connection handles */}
      <div
        className="absolute top-1/2 -left-2.5 w-5 h-5 bg-rose-400 border-2 border-white rounded-full -translate-y-1/2 cursor-pointer hover:bg-rose-600 transition-colors"
        title="Connect to this node"
        onMouseUp={(e) => { e.stopPropagation(); onConnectEnd(); }}
      />
      <div
        className="absolute top-1/2 -right-2.5 w-5 h-5 bg-rose-400 border-2 border-white rounded-full -translate-y-1/2 cursor-pointer hover:bg-rose-600 transition-colors"
        title="Drag to connect"
        onMouseDown={(e) => { e.stopPropagation(); onConnectStart(); }}
      />
    </div>
  );
}
