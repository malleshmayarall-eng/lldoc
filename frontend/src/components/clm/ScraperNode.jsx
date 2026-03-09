import React from 'react';
import { Trash2, Search } from 'lucide-react';
import NodeProgressBar from './NodeProgressBar';

/**
 * Scraper Node — scrapes allowed websites for keywords, enriches document
 * metadata with extracted text snippets that downstream Rule/AI nodes can use.
 * Teal themed, shows configured URLs and keywords on-canvas.
 */
export default function ScraperNode({ node, isSelected, onSelect, onDragStart, onConnectStart, onConnectEnd, onDelete, processingStatus, onDoubleClick }) {
  const config = node.config || {};
  const urls = config.urls || [];
  const keywords = config.keywords || [];
  const outputKey = config.output_key || 'scraped_data';
  const lastResult = node.last_result || {};

  const urlsScraped = lastResult.urls_scraped || 0;
  const urlsBlocked = lastResult.urls_blocked || 0;
  const urlsFailed = lastResult.urls_failed || 0;
  const totalSnippets = lastResult.total_snippets || 0;
  const hasResults = urlsScraped > 0 || urlsBlocked > 0 || urlsFailed > 0;

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
          isSelected ? 'border-teal-500 shadow-teal-100 shadow-md' : 'border-teal-200 hover:border-teal-400'
        }`}
      >
        {/* Header */}
        <div className="bg-teal-50 rounded-t-[10px] px-3 py-2 flex items-center gap-2">
          <span className="text-base">🌐</span>
          <span className="text-xs font-semibold text-teal-800 truncate flex-1">{node.label || 'Scraper'}</span>
          {urls.length > 0 && (
            <span className="text-[10px] bg-teal-200 text-teal-800 px-1.5 rounded-full">{urls.length} URL{urls.length !== 1 ? 's' : ''}</span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-teal-400 hover:text-teal-700 transition-all hover:bg-teal-50 rounded"
            title="Inspect"
          ><Search size={12} /></button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-teal-400 hover:text-red-500 transition-all hover:bg-red-50 rounded"
            title="Delete"
          ><Trash2 size={12} /></button>
        </div>

        {/* Body */}
        <div className="px-3 py-2">
          {urls.length === 0 && keywords.length === 0 ? (
            <p className="text-[11px] text-gray-400 italic">No URLs — click to configure</p>
          ) : (
            <div className="space-y-1">
              {/* URL previews */}
              {urls.slice(0, 2).map((url, i) => (
                <p key={i} className="text-[10px] text-gray-500 truncate">
                  <span className="text-teal-500">🔗</span> {url.replace(/^https?:\/\//, '').slice(0, 35)}
                </p>
              ))}
              {urls.length > 2 && (
                <p className="text-[10px] text-gray-400">+{urls.length - 2} more URL{urls.length - 2 !== 1 ? 's' : ''}</p>
              )}

              {/* Keywords */}
              {keywords.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {keywords.slice(0, 4).map((kw, i) => (
                    <span key={i} className="text-[9px] px-1.5 py-0.5 bg-teal-100 text-teal-700 rounded-full">{kw}</span>
                  ))}
                  {keywords.length > 4 && (
                    <span className="text-[9px] text-gray-400">+{keywords.length - 4}</span>
                  )}
                </div>
              )}

              {/* Last execution stats */}
              {hasResults && (
                <div className="flex gap-2 mt-1 text-[10px] font-medium">
                  {urlsScraped > 0 && <span className="text-emerald-600">✓ {urlsScraped} scraped</span>}
                  {urlsBlocked > 0 && <span className="text-amber-600">⊘ {urlsBlocked} blocked</span>}
                  {urlsFailed > 0 && <span className="text-red-600">✕ {urlsFailed} failed</span>}
                </div>
              )}
              {totalSnippets > 0 && (
                <p className="text-[10px] text-teal-600 font-medium">{totalSnippets} snippet{totalSnippets !== 1 ? 's' : ''} found</p>
              )}
              {lastResult.count != null && !hasResults && (
                <p className="text-[11px] text-gray-400">{lastResult.count} docs in pipeline</p>
              )}

              {/* Output key */}
              {outputKey && outputKey !== 'scraped_data' && (
                <p className="text-[9px] text-gray-400 mt-0.5">→ {outputKey}</p>
              )}
            </div>
          )}
        </div>

        {/* Processing progress bar */}
        <NodeProgressBar processingStatus={processingStatus} colorClass="from-teal-400 to-teal-600" />
      </div>

      {/* Connection handles */}
      <div
        className="absolute top-1/2 -left-2.5 w-5 h-5 bg-teal-400 border-2 border-white rounded-full -translate-y-1/2 cursor-pointer hover:bg-teal-600 transition-colors"
        title="Connect to this node"
        onMouseUp={(e) => { e.stopPropagation(); onConnectEnd(); }}
      />
      <div
        className="absolute top-1/2 -right-2.5 w-5 h-5 bg-teal-400 border-2 border-white rounded-full -translate-y-1/2 cursor-pointer hover:bg-teal-600 transition-colors"
        title="Drag to connect"
        onMouseDown={(e) => { e.stopPropagation(); onConnectStart(); }}
      />
    </div>
  );
}
