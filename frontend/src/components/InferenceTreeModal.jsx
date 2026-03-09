/**
 * InferenceTreeModal — Full-screen modal showing the document's inference hierarchy.
 *
 * Visualises:
 *   • Document summary (root)
 *   • Section aggregates (nested tree)
 *   • Component inferences (paragraphs, tables, latex, etc.)
 *   • Staleness indicators per node
 *   • Lateral edges (critical/contextual) per component
 *   • Write-path health status
 *
 * Opened from the InferencePanel (tree icon) or the DocumentHeader.
 */

import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  X,
  Brain,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Network,
  Zap,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileText,
  Layers,
  AlignLeft,
  Table2,
  Code2,
  ArrowRight,
  RefreshCw,
  Loader2,
  GitBranch,
  ExternalLink,
} from 'lucide-react';

// ── Staleness dot ───────────────────────────────────────────────────

const StatusDot = ({ status, size = 'sm' }) => {
  const sizes = { sm: 'h-2 w-2', md: 'h-2.5 w-2.5', lg: 'h-3 w-3' };
  const colors = {
    fresh: 'bg-emerald-500',
    stale: 'bg-amber-400 animate-pulse',
    missing: 'bg-gray-300',
    error: 'bg-red-500',
  };
  return (
    <span
      className={`inline-block rounded-full ${sizes[size] || sizes.sm} ${colors[status] || colors.missing}`}
      title={status}
    />
  );
};

// ── Component type icon ─────────────────────────────────────────────

const ComponentIcon = ({ type }) => {
  const map = {
    paragraph: AlignLeft,
    table: Table2,
    latex_code: Code2,
    sentence: FileText,
  };
  const Icon = map[type] || FileText;
  return <Icon className="h-3 w-3 text-gray-400 flex-shrink-0" />;
};

// ── Edge badge ──────────────────────────────────────────────────────

const EdgeBadge = ({ edge }) => (
  <div className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full border ${
    edge.edge_type === 'critical'
      ? 'bg-red-50 text-red-700 border-red-200'
      : 'bg-blue-50 text-blue-700 border-blue-200'
  }`}>
    <ArrowRight className="h-2.5 w-2.5" />
    <span className="font-medium">{edge.edge_type}</span>
    <span className="opacity-70">{edge.target_label || edge.target_type || 'component'}</span>
    {edge.score != null && (
      <span className="tabular-nums opacity-60">{(edge.score * 100).toFixed(0)}%</span>
    )}
  </div>
);

// ── Component row in the tree ───────────────────────────────────────

const ComponentRow = ({ component, isStale, lateralEdges, onLoadEdges }) => {
  const [showEdges, setShowEdges] = useState(false);
  const [loadingEdges, setLoadingEdges] = useState(false);
  const edges = lateralEdges || [];

  const handleToggleEdges = async () => {
    if (!showEdges && edges.length === 0 && onLoadEdges) {
      setLoadingEdges(true);
      await onLoadEdges(component.component_type, component.component_id);
      setLoadingEdges(false);
    }
    setShowEdges(!showEdges);
  };

  return (
    <div className="py-1">
      <div className="flex items-center gap-1.5 text-[11px]">
        <StatusDot status={isStale ? 'stale' : 'fresh'} />
        <ComponentIcon type={component.component_type} />
        <span className="text-gray-500 font-medium min-w-[60px]">
          {component.component_type}
        </span>
        <span className="text-gray-700 truncate flex-1">
          {component.summary ? component.summary.slice(0, 80) : '—'}
        </span>
        {component.context_tags?.length > 0 && (
          <span className="text-[9px] text-indigo-500 bg-indigo-50 px-1 py-0.5 rounded">
            {component.context_tags.slice(0, 2).join(', ')}
          </span>
        )}
        <button
          onClick={handleToggleEdges}
          className="flex items-center gap-0.5 text-[9px] text-gray-400 hover:text-indigo-600 transition-colors px-1"
          title="Show lateral edges"
        >
          {loadingEdges ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          ) : (
            <GitBranch className="h-2.5 w-2.5" />
          )}
          {edges.length > 0 && <span>{edges.length}</span>}
        </button>
      </div>
      {showEdges && edges.length > 0 && (
        <div className="ml-7 mt-0.5 flex flex-wrap gap-1">
          {edges.map((edge, i) => (
            <EdgeBadge key={i} edge={edge} />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Section tree node (recursive) ───────────────────────────────────

const SectionTreeNode = ({ node, staleIds, lateralEdgesCache, onLoadEdges, depth = 0 }) => {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children?.length > 0;
  const hasComponents = node.components?.length > 0;
  const agg = node.aggregate;
  const meta = agg?.custom_metadata || {};
  const staleCount = (node.components || []).filter(
    (c) => staleIds.has(c.component_id)
  ).length;
  const totalComponents = node.components?.length || 0;

  return (
    <div>
      {/* Section header */}
      <button
        className="flex items-center gap-1.5 w-full text-left py-1.5 px-2 rounded-md hover:bg-gray-50 transition-colors group"
        onClick={() => setExpanded(!expanded)}
        style={{ paddingLeft: depth * 16 + 8 }}
      >
        {(hasChildren || hasComponents) ? (
          expanded
            ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
            : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
        ) : (
          <span className="h-3.5 w-3.5" />
        )}
        <StatusDot
          status={agg ? (staleCount > 0 ? 'stale' : 'fresh') : 'missing'}
          size="md"
        />
        <Layers className="h-3.5 w-3.5 text-indigo-400" />
        <span className="text-xs font-semibold text-gray-800 truncate flex-1">
          {node.title || 'Untitled'}
        </span>
        {totalComponents > 0 && (
          <span className="text-[10px] text-gray-400 tabular-nums">
            {totalComponents} comp
            {staleCount > 0 && (
              <span className="text-amber-500 ml-1">{staleCount}⚡</span>
            )}
          </span>
        )}
      </button>

      {/* Aggregate summary */}
      {expanded && agg && (
        <div
          className="mx-2 mb-1 text-[10px] text-gray-600 bg-indigo-50/40 rounded px-2 py-1 border-l-2 border-indigo-200"
          style={{ marginLeft: depth * 16 + 32 }}
        >
          {meta.section_purpose && (
            <div><span className="font-semibold text-indigo-600">Purpose:</span> {meta.section_purpose}</div>
          )}
          {agg.summary && !meta.section_purpose && (
            <div className="text-gray-500">{agg.summary.slice(0, 150)}</div>
          )}
          {meta.key_obligations?.length > 0 && (
            <div className="mt-0.5">
              <span className="font-semibold text-indigo-600">Obligations:</span>{' '}
              {meta.key_obligations.slice(0, 3).join('; ')}
            </div>
          )}
          {meta.risk_indicators?.length > 0 && (
            <div className="mt-0.5">
              <span className="font-semibold text-amber-600">Risks:</span>{' '}
              {meta.risk_indicators.slice(0, 3).join('; ')}
            </div>
          )}
        </div>
      )}

      {/* Components */}
      {expanded && hasComponents && (
        <div
          className="border-l border-gray-200 ml-4 pl-2"
          style={{ marginLeft: depth * 16 + 24 }}
        >
          {node.components.map((ci) => (
            <ComponentRow
              key={ci.id || ci.component_id}
              component={ci}
              isStale={staleIds.has(ci.component_id)}
              lateralEdges={lateralEdgesCache[`${ci.component_type}:${ci.component_id}`]?.edges || []}
              onLoadEdges={onLoadEdges}
            />
          ))}
        </div>
      )}

      {/* Child sections */}
      {expanded && hasChildren && node.children.map((child) => (
        <SectionTreeNode
          key={child.section_id}
          node={child}
          staleIds={staleIds}
          lateralEdgesCache={lateralEdgesCache}
          onLoadEdges={onLoadEdges}
          depth={depth + 1}
        />
      ))}
    </div>
  );
};

// ── Main modal ──────────────────────────────────────────────────────

export default function InferenceTreeModal({
  isOpen,
  onClose,
  documentId,
  tree,
  staleComponentIds,
  writePathStatus,
  stats,
  inferring,
  writingPath,
  onRunInference,
  onRunWritePath,
  onFullRefresh,
  getLateralEdgesFor,
}) {
  const [lateralEdgesCache, setLateralEdgesCache] = useState({});
  const [filterStale, setFilterStale] = useState(false);

  // Reset cache when modal opens
  useEffect(() => {
    if (isOpen) setLateralEdgesCache({});
  }, [isOpen]);

  const handleLoadEdges = useCallback(async (componentType, componentId) => {
    const key = `${componentType}:${componentId}`;
    if (lateralEdgesCache[key]) return;
    const data = await getLateralEdgesFor?.(componentType, componentId);
    if (data) {
      setLateralEdgesCache((prev) => ({ ...prev, [key]: data }));
    }
  }, [lateralEdgesCache, getLateralEdgesFor]);

  const busy = inferring || writingPath;
  const docSummary = tree?.document_summary;
  const docMeta = docSummary?.custom_metadata || {};

  // Count totals
  const totalEdges = useMemo(() => {
    if (!writePathStatus?.lateral_edges) return 0;
    return (writePathStatus.lateral_edges.critical || 0) + (writePathStatus.lateral_edges.contextual || 0);
  }, [writePathStatus]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-[90vw] max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-white">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-indigo-100 flex items-center justify-center">
              <Brain className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Inference Tree</h2>
              <p className="text-xs text-gray-500">
                Hierarchical context map — how AI understands this document
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-4 px-6 py-3 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-1.5 text-xs">
            <Layers className="h-3.5 w-3.5 text-indigo-500" />
            <span className="font-bold text-gray-800">{stats.totalSections}</span>
            <span className="text-gray-500">sections</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <FileText className="h-3.5 w-3.5 text-indigo-500" />
            <span className="font-bold text-gray-800">{stats.totalComponents}</span>
            <span className="text-gray-500">components</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            {stats.totalStale > 0 ? (
              <>
                <Zap className="h-3.5 w-3.5 text-amber-500" />
                <span className="font-bold text-amber-600">{stats.totalStale}</span>
                <span className="text-amber-600">stale</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-emerald-600 font-medium">all fresh</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <Network className="h-3.5 w-3.5 text-indigo-500" />
            <span className="font-bold text-gray-800">{totalEdges}</span>
            <span className="text-gray-500">lateral edges</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1 text-[10px] text-gray-500 cursor-pointer">
              <input
                type="checkbox"
                checked={filterStale}
                onChange={(e) => setFilterStale(e.target.checked)}
                className="h-3 w-3 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
              />
              Show stale only
            </label>
            <div className="w-px h-4 bg-gray-300" />
            <button
              onClick={() => onRunInference?.({ force: false })}
              disabled={busy}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-indigo-100 text-indigo-700 hover:bg-indigo-200 disabled:opacity-50 transition-colors"
            >
              {inferring ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
              Infer
            </button>
            <button
              onClick={() => onRunWritePath?.('sync')}
              disabled={busy}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-50 transition-colors"
            >
              {writingPath ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitBranch className="h-3 w-3" />}
              Edges
            </button>
            <button
              onClick={() => onFullRefresh?.()}
              disabled={busy}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-violet-100 text-violet-700 hover:bg-violet-200 disabled:opacity-50 transition-colors"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Full
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Document summary (root node) */}
          {docSummary && (
            <div className="mb-4 p-4 rounded-xl bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-100">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-indigo-600" />
                <h3 className="text-sm font-bold text-indigo-800">
                  {tree.document_title || 'Untitled Document'}
                </h3>
                <StatusDot status="fresh" size="md" />
              </div>
              {docSummary.summary && (
                <p className="text-xs text-gray-700 leading-relaxed mb-2">
                  {docSummary.summary}
                </p>
              )}
              <div className="flex flex-wrap gap-2 text-[10px]">
                {docMeta.document_purpose && (
                  <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                    Purpose: {docMeta.document_purpose.slice(0, 80)}
                  </span>
                )}
                {docMeta.parties_identified?.map((party, i) => (
                  <span key={i} className="bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">
                    {party}
                  </span>
                ))}
                {docMeta.document_type && (
                  <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                    {docMeta.document_type}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Write-path status */}
          {writePathStatus && (
            <div className="mb-4 flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200">
              <Network className="h-4 w-4 text-gray-400" />
              <span className="text-xs text-gray-600">Write-Path</span>
              {writePathStatus.enabled ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <XCircle className="h-4 w-4 text-gray-400" />
              )}
              <span className="text-[10px] text-gray-500">
                {writePathStatus.enabled ? 'enabled' : 'disabled'}
              </span>
              {writePathStatus.lateral_edges && (
                <div className="ml-auto flex items-center gap-2 text-[10px]">
                  <span className="text-red-600 font-medium">
                    {writePathStatus.lateral_edges.critical || 0} critical
                  </span>
                  <span className="text-blue-600 font-medium">
                    {writePathStatus.lateral_edges.contextual || 0} contextual
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Section tree */}
          {tree?.tree?.length > 0 ? (
            <div className="space-y-0.5">
              {tree.tree.map((node) => (
                <SectionTreeNode
                  key={node.section_id}
                  node={node}
                  staleIds={staleComponentIds}
                  lateralEdgesCache={lateralEdgesCache}
                  onLoadEdges={handleLoadEdges}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-16 w-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                <Brain className="h-8 w-8 text-gray-300" />
              </div>
              <p className="text-sm font-medium text-gray-600 mb-1">No inference data yet</p>
              <p className="text-xs text-gray-400 mb-4 max-w-sm">
                Click <strong>Infer</strong> to run the hierarchical inference engine.
                It will analyze every section and component, building a context tree
                that supercharges all AI services.
              </p>
              <button
                onClick={() => onRunInference?.({ force: false })}
                disabled={busy}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {inferring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Run Inference
              </button>
            </div>
          )}
        </div>

        {/* Footer legend */}
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/50 flex items-center gap-4 text-[10px] text-gray-500">
          <div className="flex items-center gap-1">
            <StatusDot status="fresh" /> Fresh
          </div>
          <div className="flex items-center gap-1">
            <StatusDot status="stale" /> Stale
          </div>
          <div className="flex items-center gap-1">
            <StatusDot status="missing" /> No data
          </div>
          <div className="w-px h-3 bg-gray-300" />
          <div className="flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded-full bg-red-200" /> Critical edge
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded-full bg-blue-200" /> Contextual edge
          </div>
        </div>
      </div>
    </div>
  );
}
