/**
 * InferencePanel — Modern minimal right-sidebar panel.
 *
 * Design:
 *   • Clean scrollable layout, no icon clutter
 *   • Status dots only (emerald/amber/gray), text labels
 *   • Compact stats bar, document summary, inference tree
 *   • Cache history section showing past inference snapshots
 *   • Cross-reference toggle with legend
 *   • Action buttons: text-only with hover colour shifts
 */

import React, { useCallback, useState, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import useDocumentInference from '../hooks/useDocumentInference';
import InferenceTreeModal from './InferenceTreeModal';

// ── Status dot ────────────────────────────────────────────────────────────────

const Dot = ({ status, size = 'sm' }) => {
  const colors = {
    fresh: 'bg-emerald-500',
    stale: 'bg-amber-400',
    missing: 'bg-gray-300',
    error: 'bg-red-500',
  };
  const sizeClass = size === 'lg' ? 'h-2.5 w-2.5' : 'h-1.5 w-1.5';
  return <span className={`inline-block rounded-full ${sizeClass} ${colors[status] || colors.missing}`} />;
};

// ── Section tree node ─────────────────────────────────────────────────────────

const SectionNode = ({ node, staleComponentIds, depth = 0 }) => {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children?.length > 0;
  const componentCount = node.components?.length || 0;
  const hasAggregate = !!node.aggregate;
  const staleCount = (node.components || []).filter(
    (c) => staleComponentIds.has(c.component_id)
  ).length;

  return (
    <div className="text-[11px]">
      <button
        className="flex items-center gap-1.5 w-full text-left py-1 px-1.5 rounded-md hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        {/* Expand chevron (text only) */}
        <span className="w-3 text-[9px] text-gray-400 flex-shrink-0 select-none">
          {hasChildren ? (expanded ? '▾' : '▸') : ''}
        </span>
        <Dot status={hasAggregate ? (staleCount > 0 ? 'stale' : 'fresh') : 'missing'} />
        <span className="truncate text-gray-700 font-medium flex-1">
          {node.title || 'Untitled'}
        </span>
        {componentCount > 0 && (
          <span className="text-[9px] text-gray-400 tabular-nums flex-shrink-0">
            {componentCount}
            {staleCount > 0 && <span className="text-amber-500 ml-0.5">·{staleCount}</span>}
          </span>
        )}
      </button>

      {expanded && node.components?.length > 0 && (
        <div className="ml-6 border-l border-gray-100 pl-2 py-0.5">
          {node.components.slice(0, 10).map((ci) => (
            <div
              key={ci.id || ci.component_id}
              className="flex items-center gap-1.5 py-0.5 text-[10px] text-gray-500"
            >
              <Dot status={staleComponentIds.has(ci.component_id) ? 'stale' : 'fresh'} />
              <span className="text-gray-400 w-10 flex-shrink-0 truncate">{ci.component_type}</span>
              <span className="truncate">{(ci.summary || '').slice(0, 55)}</span>
            </div>
          ))}
          {node.components.length > 10 && (
            <div className="text-[9px] text-gray-400 pl-4 py-0.5">
              +{node.components.length - 10} more
            </div>
          )}
        </div>
      )}

      {expanded && hasChildren && node.children.map((child) => (
        <SectionNode
          key={child.section_id}
          node={child}
          staleComponentIds={staleComponentIds}
          depth={depth + 1}
        />
      ))}
    </div>
  );
};

// ── History item ──────────────────────────────────────────────────────────────

const HistoryItem = ({ entry, index }) => {
  const date = new Date(entry.timestamp);
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-[10px] text-gray-500 hover:bg-gray-50 rounded transition-colors">
      <Dot status="fresh" />
      <span className="tabular-nums font-medium text-gray-600">{dateStr} {timeStr}</span>
      <span className="ml-auto tabular-nums">
        {entry.stats?.sections || 0}s · {entry.stats?.components || 0}c
      </span>
    </div>
  );
};

// ── Main panel ────────────────────────────────────────────────────────────────

export default function InferencePanel({ documentId, inference: externalInference, crossRef, cache }) {
  const internalInference = useDocumentInference(externalInference ? null : documentId);
  const {
    tree,
    stale,
    writePathStatus,
    loading,
    inferring,
    writingPath,
    error,
    stats,
    staleComponentIds,
    getLateralEdgesFor,
    runInference,
    runWritePath,
    fullRefresh,
    fetchTree,
  } = externalInference || internalInference;

  const [showTree, setShowTree] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const handleRunInference = useCallback(async () => {
    await runInference({ force: false });
  }, [runInference]);

  const handleRunWritePath = useCallback(async () => {
    await runWritePath('sync');
  }, [runWritePath]);

  const handleFullRefresh = useCallback(async () => {
    await fullRefresh();
  }, [fullRefresh]);

  const busy = inferring || writingPath || loading;

  // Cache-aware history
  const history = cache?.history || [];

  // Status label
  const statusLabel = useMemo(() => {
    if (inferring) return { text: 'Inferring…', color: 'text-indigo-600' };
    if (writingPath) return { text: 'Building edges…', color: 'text-emerald-600' };
    if (loading) return { text: 'Loading…', color: 'text-gray-500' };
    if (stats.totalStale > 0) return { text: `${stats.totalStale} stale`, color: 'text-amber-600' };
    if (stats.totalComponents > 0) return { text: 'Up to date', color: 'text-emerald-600' };
    return { text: 'No data', color: 'text-gray-400' };
  }, [inferring, writingPath, loading, stats]);

  if (!documentId) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-gray-400">
        No document selected
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent">

        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-800">Inference</span>
            <span className={`text-[10px] font-medium ${statusLabel.color}`}>{statusLabel.text}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="text-[10px] text-gray-400 hover:text-indigo-600 px-1.5 py-0.5 rounded hover:bg-indigo-50 transition-colors"
              onClick={() => setShowModal(true)}
              title="Full tree view"
            >
              expand
            </button>
            <button
              className="text-[10px] text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-100 transition-colors"
              onClick={fetchTree}
              disabled={busy}
            >
              {loading ? '…' : 'refresh'}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="text-[11px] text-red-600 bg-red-50 p-2 rounded-md">
            {error}
          </div>
        )}

        {/* Stats strip */}
        <div className="flex gap-2">
          {[
            { label: 'Sections', value: stats.totalSections, color: 'text-gray-800' },
            { label: 'Components', value: stats.totalComponents, color: 'text-gray-800' },
            { label: 'Stale', value: stats.totalStale, color: stats.totalStale > 0 ? 'text-amber-600' : 'text-gray-800' },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex-1 bg-gray-50 rounded-md px-2 py-1.5 text-center">
              <div className={`text-base font-bold tabular-nums ${color}`}>{value}</div>
              <div className="text-[9px] text-gray-500 uppercase tracking-wider">{label}</div>
            </div>
          ))}
        </div>

        {/* Document summary */}
        {tree?.document_summary && (
          <div className="text-[11px] text-gray-600 bg-gray-50 rounded-md p-2.5 border border-gray-100">
            <div className="font-medium text-gray-800 mb-1">Summary</div>
            <p className="line-clamp-3 leading-relaxed">{tree.document_summary.summary}</p>
          </div>
        )}

        {/* Write-path status */}
        {writePathStatus && (
          <div className="flex items-center gap-2 text-[11px] px-2 py-1.5 rounded-md bg-gray-50">
            <Dot status={writePathStatus.enabled ? 'fresh' : 'missing'} />
            <span className="text-gray-600">Write-Path</span>
            <span className="ml-auto text-[10px] text-gray-400 tabular-nums">
              {writePathStatus.lateral_edges?.critical || 0} critical · {writePathStatus.lateral_edges?.contextual || 0} contextual
            </span>
          </div>
        )}

        {/* Action buttons — text-only, hover colour */}
        <div className="flex gap-1.5">
          <button
            className="flex-1 py-1.5 rounded-md text-[11px] font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
            onClick={handleRunInference}
            disabled={busy}
          >
            {inferring && <Loader2 className="h-3 w-3 animate-spin" />}
            Infer
          </button>
          <button
            className="flex-1 py-1.5 rounded-md text-[11px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
            onClick={handleRunWritePath}
            disabled={busy}
          >
            {writingPath && <Loader2 className="h-3 w-3 animate-spin" />}
            Edges
          </button>
          <button
            className="flex-1 py-1.5 rounded-md text-[11px] font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
            onClick={handleFullRefresh}
            disabled={busy}
          >
            {(busy && !inferring && !writingPath) && <Loader2 className="h-3 w-3 animate-spin" />}
            Full
          </button>
        </div>

        {/* Cross-reference toggle */}
        {crossRef && (
          <button
            onClick={crossRef.toggle}
            className={`flex items-center gap-2 w-full px-2.5 py-2 rounded-md text-[11px] font-medium transition-colors ${
              crossRef.enabled
                ? 'bg-violet-50 text-violet-700 ring-1 ring-violet-200'
                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
          >
            Cross-References
            <span className={`ml-auto text-[10px] font-bold ${crossRef.enabled ? 'text-violet-600' : 'text-gray-400'}`}>
              {crossRef.enabled ? 'ON' : 'OFF'}
            </span>
            {crossRef.stats?.total > 0 && (
              <span className="text-[9px] tabular-nums text-gray-400">({crossRef.stats.total})</span>
            )}
          </button>
        )}

        {/* Cross-ref legend */}
        {crossRef?.enabled && (
          <div className="flex items-center gap-3 px-2 text-[10px] text-gray-500">
            <span className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-3 rounded-sm bg-red-400" />
              Critical
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-3 rounded-sm bg-blue-400" />
              Contextual
            </span>
          </div>
        )}

        {/* Cache status */}
        {cache && (
          <div className="flex items-center gap-2 text-[10px] text-gray-500 px-1">
            <Dot status={cache.cacheHit ? 'fresh' : 'missing'} />
            <span>{cache.cacheHit ? 'Cached' : 'No cache'}</span>
            {cache.cacheTimestamp && (
              <span className="ml-auto tabular-nums text-gray-400">
                {new Date(cache.cacheTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {cache.staleSectionIds?.size > 0 && (
              <span className="text-amber-500">{cache.staleSectionIds.size} changed</span>
            )}
          </div>
        )}

        {/* ── Inference Tree ──────────────────────────────────────── */}
        <div>
          <button
            className="flex items-center gap-1.5 text-[11px] font-medium text-gray-700 w-full hover:text-gray-900 transition-colors"
            onClick={() => setShowTree(!showTree)}
          >
            <span className="text-[9px] text-gray-400 w-3">{showTree ? '▾' : '▸'}</span>
            Inference Tree
            {tree?.tree && (
              <span className="ml-auto text-[9px] text-gray-400 tabular-nums">
                {tree.tree.length} root{tree.tree.length !== 1 ? 's' : ''}
              </span>
            )}
          </button>

          {showTree && tree?.tree && (
            <div className="mt-1.5 overflow-y-auto border border-gray-100 rounded-md p-1 bg-white" style={{ maxHeight: 'calc(100vh - 480px)', minHeight: '120px' }}>
              {tree.tree.map((node) => (
                <SectionNode
                  key={node.section_id}
                  node={node}
                  staleComponentIds={staleComponentIds}
                />
              ))}
            </div>
          )}

          {showTree && !tree?.tree && !loading && (
            <div className="text-[11px] text-gray-400 text-center py-6">
              <p className="mb-1">No inference data yet</p>
              <p className="text-[10px]">Click <span className="font-medium text-indigo-600">Infer</span> to start</p>
            </div>
          )}
        </div>

        {/* ── Past Inference History ──────────────────────────────── */}
        {history.length > 0 && (
          <div>
            <button
              className="flex items-center gap-1.5 text-[11px] font-medium text-gray-700 w-full hover:text-gray-900 transition-colors"
              onClick={() => setShowHistory(!showHistory)}
            >
              <span className="text-[9px] text-gray-400 w-3">{showHistory ? '▾' : '▸'}</span>
              History
              <span className="ml-auto text-[9px] text-gray-400 tabular-nums">{history.length}</span>
            </button>

            {showHistory && (
              <div className="mt-1 max-h-40 overflow-y-auto border border-gray-100 rounded-md bg-white">
                {history.map((entry, i) => (
                  <HistoryItem key={entry.timestamp || i} entry={entry} index={i} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty history state */}
        {history.length === 0 && cache && (
          <div className="text-[10px] text-gray-400 text-center py-3">
            No inference history yet — run inference to create first snapshot
          </div>
        )}
      </div>

      {/* Full tree modal */}
      <InferenceTreeModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        documentId={documentId}
        tree={tree}
        staleComponentIds={staleComponentIds}
        writePathStatus={writePathStatus}
        stats={stats}
        inferring={inferring}
        writingPath={writingPath}
        onRunInference={runInference}
        onRunWritePath={runWritePath}
        onFullRefresh={fullRefresh}
        getLateralEdgesFor={getLateralEdgesFor}
      />
    </div>
  );
}
