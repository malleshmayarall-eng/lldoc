import React from 'react';
import { Trash2, Search } from 'lucide-react';
import NodeProgressBar from './NodeProgressBar';

/**
 * Action Node — executes a plugin (email, WhatsApp, SMS, webhook)
 * for each incoming document in a for-loop.
 * Purple themed, shows plugin name and last execution stats on-canvas.
 */
export default function ActionNode({ node, isSelected, onSelect, onDragStart, onConnectStart, onConnectEnd, onDelete, processingStatus, onDoubleClick }) {
  const config = node.config || {};
  const pluginName = config.plugin || '';
  const pluginSettings = config.settings || {};
  const lastResult = node.last_result || {};

  const pluginLabels = {
    send_email: { icon: '📧', label: 'Send Email' },
    send_whatsapp: { icon: '💬', label: 'WhatsApp' },
    send_sms: { icon: '📱', label: 'Send SMS' },
    webhook: { icon: '🔗', label: 'Webhook' },
  };
  const pl = pluginLabels[pluginName] || { icon: '⚡', label: pluginName || 'No plugin' };

  const hasSent = lastResult.sent > 0;
  const hasSkipped = lastResult.skipped > 0;
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
          isSelected ? 'border-purple-500 shadow-purple-100 shadow-md' : 'border-purple-200 hover:border-purple-400'
        }`}
      >
        {/* Header */}
        <div className="bg-purple-50 rounded-t-[10px] px-3 py-2 flex items-center gap-2">
          <span className="text-base">{pl.icon}</span>
          <span className="text-xs font-semibold text-purple-800 truncate flex-1">{node.label || 'Action'}</span>
          {pluginName && (
            <span className="text-[10px] bg-purple-200 text-purple-800 px-1.5 rounded-full">{pl.label}</span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-purple-400 hover:text-purple-700 transition-all hover:bg-purple-50 rounded"
            title="Inspect"
          ><Search size={12} /></button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-purple-400 hover:text-red-500 transition-all hover:bg-red-50 rounded"
            title="Delete"
          ><Trash2 size={12} /></button>
        </div>

        {/* Body */}
        <div className="px-3 py-2">
          {!pluginName ? (
            <p className="text-[11px] text-gray-400 italic">No plugin — click to configure</p>
          ) : (
            <div className="space-y-1">
              {/* Show settings summary */}
              {pluginSettings.subject_template && (
                <p className="text-[10px] text-gray-500 truncate">
                  <span className="text-purple-500">Subject:</span> {pluginSettings.subject_template}
                </p>
              )}
              {pluginSettings.message_template && (
                <p className="text-[10px] text-gray-500 truncate">
                  <span className="text-purple-500">Msg:</span> {pluginSettings.message_template.slice(0, 50)}…
                </p>
              )}
              {pluginSettings.webhook_url && (
                <p className="text-[10px] text-gray-500 truncate">
                  <span className="text-purple-500">URL:</span> {pluginSettings.webhook_url}
                </p>
              )}
              {/* Last execution stats */}
              {(hasSent || hasSkipped || hasFailed) && (
                <div className="flex gap-2 mt-1 text-[10px] font-medium">
                  {hasSent && <span className="text-emerald-600">✓ {lastResult.sent}</span>}
                  {hasSkipped && <span className="text-amber-600">⊘ {lastResult.skipped}</span>}
                  {hasFailed && <span className="text-red-600">✕ {lastResult.failed}</span>}
                </div>
              )}
              {lastResult.count != null && !hasSent && !hasSkipped && !hasFailed && (
                <p className="text-[11px] text-gray-400">{lastResult.count} docs in pipeline</p>
              )}
            </div>
          )}
        </div>

        {/* Processing progress bar */}
        <NodeProgressBar processingStatus={processingStatus} colorClass="from-purple-400 to-purple-600" />
      </div>

      {/* Connection handles */}
      <div
        className="absolute top-1/2 -left-2.5 w-5 h-5 bg-purple-400 border-2 border-white rounded-full -translate-y-1/2 cursor-pointer hover:bg-purple-600 transition-colors"
        title="Connect to this node"
        onMouseUp={(e) => { e.stopPropagation(); onConnectEnd(); }}
      />
      <div
        className="absolute top-1/2 -right-2.5 w-5 h-5 bg-purple-400 border-2 border-white rounded-full -translate-y-1/2 cursor-pointer hover:bg-purple-600 transition-colors"
        title="Drag to connect"
        onMouseDown={(e) => { e.stopPropagation(); onConnectStart(); }}
      />
    </div>
  );
}
