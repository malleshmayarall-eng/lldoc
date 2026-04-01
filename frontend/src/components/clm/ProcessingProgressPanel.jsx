/**
 * ProcessingProgressPanel — real-time CLM workflow execution monitor.
 *
 * Shows live node-by-node progress via SSE, execution metrics,
 * event log, and node performance stats.
 *
 * Props:
 *   workflowId    — UUID of the workflow
 *   nodes         — array of workflow node objects (from canvas state)
 *   connections   — array of connection objects
 *   executing     — boolean, true when an execution is active
 *   onViewResults — callback to switch to results tab
 */
import React, { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { workflowApi } from '@services/clm/clmApi';
import { Spinner, EmptyState } from '@components/clm/ui/SharedUI';
import useWorkflowLiveStream from '@hooks/clm/useWorkflowLiveStream';
import notify from '@utils/clm/clmNotify';
import {
  Activity, CheckCircle2, XCircle, Clock, AlertTriangle,
  Wifi, WifiOff, RefreshCw, ChevronDown, ChevronRight,
  Zap, FileText, BarChart3, TrendingUp, Timer,
  Circle, ArrowRight, Play, Pause, Radio,
  Eye, Layers, Signal, Wrench,
} from 'lucide-react';

/* ── Pill (matches ExecutionResults style) ─────────────────── */
function Pill({ children, color = 'gray' }) {
  const c = {
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    amber:   'bg-amber-50 text-amber-600 border-amber-200',
    red:     'bg-red-50 text-red-600 border-red-200',
    sky:     'bg-sky-50 text-sky-600 border-sky-200',
    gray:    'bg-gray-50 text-gray-500 border-gray-200',
    purple:  'bg-purple-50 text-purple-600 border-purple-200',
    indigo:  'bg-indigo-50 text-indigo-600 border-indigo-200',
    blue:    'bg-blue-50 text-blue-600 border-blue-200',
  };
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold border ${c[color] || c.gray} capitalize`}>
      {children}
    </span>
  );
}

const Dot = () => <span className="w-[3px] h-[3px] rounded-full bg-gray-300 shrink-0 inline-block" />;

/* ── Node type → icon/color map ────────────────────────────── */
const NODE_STYLES = {
  input:      { icon: '📥', bg: 'bg-blue-50',    border: 'border-blue-200',    text: 'text-blue-700' },
  rule:       { icon: '⚙️', bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700' },
  action:     { icon: '⚡', bg: 'bg-purple-50',  border: 'border-purple-200',  text: 'text-purple-700' },
  validator:  { icon: '✅', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' },
  ai:         { icon: '🧪', bg: 'bg-rose-50',    border: 'border-rose-200',    text: 'text-rose-700' },
  and_gate:   { icon: '∩',  bg: 'bg-orange-50',  border: 'border-orange-200',  text: 'text-orange-700' },
  doc_create: { icon: '📄', bg: 'bg-indigo-50',  border: 'border-indigo-200',  text: 'text-indigo-700' },
  sheet:      { icon: '📊', bg: 'bg-cyan-50',    border: 'border-cyan-200',    text: 'text-cyan-700' },
  output:     { icon: '📤', bg: 'bg-green-50',   border: 'border-green-200',   text: 'text-green-700' },
  listener:   { icon: '👂', bg: 'bg-teal-50',    border: 'border-teal-200',    text: 'text-teal-700' },
  scraper:    { icon: '🕷️', bg: 'bg-gray-50',    border: 'border-gray-200',    text: 'text-gray-700' },
};

const statusIcon = (status) => {
  switch (status) {
    case 'processing': return <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />;
    case 'done':       return <CheckCircle2 size={12} className="text-emerald-500" />;
    case 'error':      return <XCircle size={12} className="text-red-500" />;
    case 'never_run':  return <Circle size={12} className="text-gray-300" />;
    default:           return <Circle size={12} className="text-gray-300" />;
  }
};

function formatDuration(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}


/* ═══════════════════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════════════════ */
export default function ProcessingProgressPanel({
  workflowId,
  nodes = [],
  connections = [],
  executing = false,
  onViewResults,
}) {
  const [expandedSection, setExpandedSection] = useState({ pipeline: true, events: false, metrics: false, health: false });
  const [metricsData, setMetricsData]         = useState(null);
  const [metricsPeriod, setMetricsPeriod]     = useState('24h');
  const [loadingMetrics, setLoadingMetrics]   = useState(false);

  const {
    connected, connectionMode, sseSupported,
    nodeProgress, events, currentExecution,
    metrics, nodeStatus, subscriptionHealth, workflowInfo,
    connect, disconnect, refresh,
  } = useWorkflowLiveStream(workflowId, { autoConnect: true, includeRecent: true });

  /* ── Fetch detailed metrics when section expands ─────────── */
  useEffect(() => {
    if (!expandedSection.metrics || metricsData) return;
    fetchMetrics();
  }, [expandedSection.metrics]);

  const fetchMetrics = async () => {
    setLoadingMetrics(true);
    try {
      const { data } = await workflowApi.liveMetrics(workflowId, { period: metricsPeriod });
      setMetricsData(data);
    } catch (e) {
      console.warn('Failed to load metrics:', e.message);
    } finally {
      setLoadingMetrics(false);
    }
  };

  useEffect(() => {
    if (expandedSection.metrics) fetchMetrics();
  }, [metricsPeriod]);

  /* ── Build ordered pipeline from nodes + connections ─────── */
  const pipeline = useMemo(() => {
    if (!nodes.length) return [];

    // Build adjacency & in-degree for topological sort
    const adj = {};
    const inDeg = {};
    nodes.forEach((n) => { adj[n.id] = []; inDeg[n.id] = 0; });
    connections.forEach((c) => {
      if (adj[c.source_node]) adj[c.source_node].push(c.target_node);
      if (inDeg[c.target_node] !== undefined) inDeg[c.target_node]++;
    });

    // BFS topo-sort → assign levels
    const levels = {};
    const queue = Object.keys(inDeg).filter((id) => inDeg[id] === 0);
    queue.forEach((id) => { levels[id] = 0; });
    while (queue.length) {
      const cur = queue.shift();
      for (const nxt of (adj[cur] || [])) {
        levels[nxt] = Math.max(levels[nxt] || 0, (levels[cur] || 0) + 1);
        inDeg[nxt]--;
        if (inDeg[nxt] === 0) queue.push(nxt);
      }
    }

    // Group by level
    const levelGroups = {};
    nodes.forEach((n) => {
      const lvl = levels[n.id] ?? 0;
      if (!levelGroups[lvl]) levelGroups[lvl] = [];
      levelGroups[lvl].push(n);
    });

    return Object.entries(levelGroups)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([level, levelNodes]) => ({
        level: Number(level),
        nodes: levelNodes,
      }));
  }, [nodes, connections]);

  /* ── Derived stats ──────────────────────────────────────── */
  const completedNodes = Object.values(nodeProgress).filter((n) => n.status === 'done').length;
  const failedNodes    = Object.values(nodeProgress).filter((n) => n.status === 'error').length;
  const processingNodes = Object.values(nodeProgress).filter((n) => n.status === 'processing').length;
  const totalNodes     = nodes.length;
  const progressPct    = totalNodes > 0 ? Math.round(((completedNodes + failedNodes) / totalNodes) * 100) : 0;

  const toggleSection = (key) => setExpandedSection((prev) => ({ ...prev, [key]: !prev[key] }));

  /* ══════════════════════════════════════════════════════════════
     RENDER
     ═════════════════════════════════════════════════════════════ */
  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-4">

      {/* ═══ Connection Status Bar ═══ */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {connected ? (
            connectionMode === 'sse' ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200">
                <Radio size={10} className="text-emerald-500 animate-pulse" />
                <span className="text-[10px] font-semibold text-emerald-700">Live (SSE)</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200">
                <Radio size={10} className="text-blue-500 animate-pulse" />
                <span className="text-[10px] font-semibold text-blue-700">Connected</span>
              </div>
            )
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-50 border border-gray-200">
              <WifiOff size={10} className="text-gray-400" />
              <span className="text-[10px] font-semibold text-gray-500">Disconnected</span>
            </div>
          )}
          {workflowInfo?.is_live && (
            <Pill color="emerald">Live Mode</Pill>
          )}
          {workflowInfo?.compilation_status && (
            <Pill color={workflowInfo.compilation_status === 'compiled' ? 'indigo' : 'amber'}>
              {workflowInfo.compilation_status}
            </Pill>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Link
            to="/clm/debug"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-gray-400 hover:text-amber-600 hover:bg-amber-50 border border-transparent hover:border-amber-200 transition-all"
            title="System Debug Console — Celery, Redis, task queue health"
          >
            <Wrench size={10} /> Debug
          </Link>
          <button
            onClick={refresh}
            className="p-1.5 text-gray-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
            title="Refresh snapshot"
          >
            <RefreshCw size={12} />
          </button>
          {!connected && (
            <button
              onClick={connect}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
            >
              <Wifi size={10} /> Reconnect
            </button>
          )}
        </div>
      </div>

      {/* ═══ Current Execution Banner ═══ */}
      {currentExecution ? (
        <div className={`rounded-2xl border p-4 transition-all ${
          currentExecution.status === 'executing' || currentExecution.status === 'compiling'
            ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200'
            : currentExecution.status === 'completed'
              ? 'bg-gradient-to-r from-emerald-50 to-green-50 border-emerald-200'
              : currentExecution.status === 'failed'
                ? 'bg-gradient-to-r from-red-50 to-rose-50 border-red-200'
                : 'bg-gray-50 border-gray-200'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                currentExecution.status === 'executing' ? 'bg-blue-100' :
                currentExecution.status === 'completed' ? 'bg-emerald-100' :
                currentExecution.status === 'failed' ? 'bg-red-100' : 'bg-gray-100'
              }`}>
                {currentExecution.status === 'executing' || currentExecution.status === 'compiling' ? (
                  <Activity size={16} className="text-blue-600 animate-pulse" />
                ) : currentExecution.status === 'completed' ? (
                  <CheckCircle2 size={16} className="text-emerald-600" />
                ) : (
                  <XCircle size={16} className="text-red-600" />
                )}
              </div>
              <div>
                <p className="text-[13px] font-semibold text-gray-800">
                  {currentExecution.status === 'executing' ? 'Executing Pipeline…' :
                   currentExecution.status === 'compiling' ? 'Compiling Workflow…' :
                   currentExecution.status === 'completed' ? 'Execution Complete' :
                   'Execution Failed'}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {currentExecution.mode && <Pill color="sky">{currentExecution.mode}</Pill>}
                  {currentExecution.total_documents != null && (
                    <span className="text-[10px] text-gray-500">{currentExecution.total_documents} docs</span>
                  )}
                  {currentExecution.elapsed_seconds && (
                    <>
                      <Dot />
                      <span className="text-[10px] text-gray-400">{currentExecution.elapsed_seconds}s elapsed</span>
                    </>
                  )}
                  {currentExecution.duration_ms && (
                    <>
                      <Dot />
                      <span className="text-[10px] text-gray-400">{formatDuration(currentExecution.duration_ms)}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            {currentExecution.status === 'completed' && onViewResults && (
              <button
                onClick={onViewResults}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 transition-colors"
              >
                <Eye size={12} /> View Results
              </button>
            )}
          </div>

          {/* Progress bar */}
          {(currentExecution.status === 'executing' || currentExecution.status === 'compiling') && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-500 font-medium">
                  {completedNodes}/{totalNodes} nodes
                  {processingNodes > 0 && <span className="text-blue-600 ml-1">({processingNodes} active)</span>}
                  {failedNodes > 0 && <span className="text-red-500 ml-1">({failedNodes} failed)</span>}
                </span>
                <span className="text-gray-400 font-mono">{progressPct}%</span>
              </div>
              <div className="w-full h-2 bg-white/60 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${Math.max(progressPct, processingNodes > 0 ? 5 : 0)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center">
          <Activity size={24} className="text-gray-200 mx-auto mb-2" strokeWidth={1.5} />
          <p className="text-[12px] font-medium text-gray-500">No active execution</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Execute the workflow to see live progress</p>
        </div>
      )}

      {/* ═══ Pipeline Progress (Collapsible) ═══ */}
      <CollapsibleSection
        title="Pipeline Progress"
        icon={<Layers size={14} className="text-indigo-500" />}
        expanded={expandedSection.pipeline}
        onToggle={() => toggleSection('pipeline')}
        badge={processingNodes > 0 ? `${processingNodes} active` : null}
        badgeColor="blue"
      >
        {pipeline.length === 0 ? (
          <p className="text-[11px] text-gray-400 text-center py-4">No nodes in workflow</p>
        ) : (
          <div className="space-y-1">
            {pipeline.map(({ level, nodes: levelNodes }, levelIdx) => (
              <div key={level}>
                {/* Level header */}
                <div className="flex items-center gap-2 mb-1.5 mt-2 first:mt-0">
                  <span className="text-[9px] uppercase tracking-wider font-bold text-gray-300">
                    Level {level}
                  </span>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>

                {/* Node cards */}
                <div className="space-y-1">
                  {levelNodes.map((node) => {
                    const progress = nodeProgress[node.id];
                    const style = NODE_STYLES[node.node_type] || NODE_STYLES.input;
                    const status = progress?.status || 'waiting';

                    return (
                      <div
                        key={node.id}
                        className={`rounded-xl border p-3 transition-all ${
                          status === 'processing'
                            ? `${style.bg} ${style.border} ring-2 ring-blue-200/50`
                            : status === 'done'
                              ? 'bg-emerald-50/50 border-emerald-200'
                              : status === 'error'
                                ? 'bg-red-50/50 border-red-200'
                                : 'bg-white border-gray-100 opacity-60'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5 min-w-0">
                            {statusIcon(status)}
                            <span className="text-sm">{style.icon}</span>
                            <div className="min-w-0">
                              <p className="text-[12px] font-medium text-gray-800 truncate">
                                {node.label || node.node_type}
                              </p>
                              <p className="text-[9px] text-gray-400 uppercase tracking-wide">
                                {node.node_type.replace(/_/g, ' ')}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {progress?.input_count != null && (
                              <span className="text-[9px] text-gray-400 tabular-nums">
                                {progress.input_count} in
                              </span>
                            )}
                            {progress?.output_count != null && (
                              <>
                                <ArrowRight size={8} className="text-gray-300" />
                                <span className="text-[9px] text-gray-400 tabular-nums">
                                  {progress.output_count} out
                                </span>
                              </>
                            )}
                            {progress?.duration_ms != null && (
                              <span className="text-[10px] font-mono text-gray-400 ml-1">
                                {formatDuration(progress.duration_ms)}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Processing animation bar */}
                        {status === 'processing' && (
                          <div className="mt-2 w-full h-1 bg-white/50 rounded-full overflow-hidden">
                            <div className="h-full w-1/3 bg-gradient-to-r from-blue-400 to-indigo-500 rounded-full animate-progress-slide" />
                          </div>
                        )}

                        {/* Progress percentage */}
                        {status === 'processing' && progress?.progress_pct != null && (
                          <div className="mt-1.5">
                            <div className="flex justify-between text-[9px] mb-0.5">
                              <span className="text-gray-400">Progress</span>
                              <span className="text-blue-600 font-mono">{progress.progress_pct}%</span>
                            </div>
                            <div className="w-full h-1 bg-white/50 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                style={{ width: `${progress.progress_pct}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Error message */}
                        {status === 'error' && progress?.error && (
                          <div className="mt-2 flex items-start gap-1.5 px-2 py-1.5 rounded-lg bg-red-50 border border-red-100">
                            <AlertTriangle size={10} className="text-red-400 shrink-0 mt-0.5" />
                            <p className="text-[10px] text-red-600 line-clamp-2">{progress.error}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Arrow between levels */}
                {levelIdx < pipeline.length - 1 && (
                  <div className="flex justify-center py-1">
                    <ChevronDown size={14} className="text-gray-200" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* ═══ Live Events Log ═══ */}
      <CollapsibleSection
        title="Event Log"
        icon={<Activity size={14} className="text-sky-500" />}
        expanded={expandedSection.events}
        onToggle={() => toggleSection('events')}
        badge={events.length > 0 ? `${events.length}` : null}
        badgeColor="sky"
      >
        {events.length === 0 ? (
          <p className="text-[11px] text-gray-400 text-center py-4">No events yet</p>
        ) : (
          <div className="space-y-0.5 max-h-80 overflow-y-auto">
            {events.slice(0, 50).map((evt, idx) => (
              <EventRow key={idx} event={evt} />
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* ═══ Metrics ═══ */}
      <CollapsibleSection
        title="Performance Metrics"
        icon={<BarChart3 size={14} className="text-purple-500" />}
        expanded={expandedSection.metrics}
        onToggle={() => toggleSection('metrics')}
      >
        {/* Period selector */}
        <div className="flex items-center gap-1 mb-3">
          {['24h', '7d', '30d'].map((p) => (
            <button
              key={p}
              onClick={() => setMetricsPeriod(p)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                metricsPeriod === p
                  ? 'bg-purple-100 text-purple-700'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
              }`}
            >
              {p}
            </button>
          ))}
          {loadingMetrics && <Spinner size="sm" className="text-purple-400 ml-2" />}
        </div>

        {metricsData?.summary ? (
          <div className="space-y-3">
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <MetricCard
                label="Executions"
                value={metricsData.summary.total_executions}
                icon={<Play size={12} />}
                color="indigo"
              />
              <MetricCard
                label="Success Rate"
                value={`${metricsData.summary.success_rate}%`}
                icon={<TrendingUp size={12} />}
                color={metricsData.summary.success_rate >= 90 ? 'emerald' : metricsData.summary.success_rate >= 70 ? 'amber' : 'red'}
              />
              <MetricCard
                label="Avg Duration"
                value={formatDuration(metricsData.summary.avg_duration_ms)}
                icon={<Timer size={12} />}
                color="sky"
              />
              <MetricCard
                label="Docs Processed"
                value={metricsData.summary.total_documents_processed || 0}
                icon={<FileText size={12} />}
                color="purple"
              />
            </div>

            {/* Success / Failed / Partial breakdown */}
            <div className="flex items-center gap-3 px-1">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-[10px] text-gray-500">{metricsData.summary.completed} completed</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-red-400" />
                <span className="text-[10px] text-gray-500">{metricsData.summary.failed} failed</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="text-[10px] text-gray-500">{metricsData.summary.partial} partial</span>
              </div>
            </div>

            {/* Node performance table */}
            {metricsData.node_performance?.length > 0 && (
              <div>
                <h5 className="text-[10px] uppercase tracking-wider font-bold text-gray-400 mb-2">
                  Node Performance
                </h5>
                <div className="rounded-xl border border-gray-100 overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50/80">
                        <th className="text-left text-[9px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-2">Node</th>
                        <th className="text-right text-[9px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-2">Runs</th>
                        <th className="text-right text-[9px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-2">Avg</th>
                        <th className="text-right text-[9px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-2">Docs</th>
                        <th className="text-right text-[9px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-2">Fails</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {metricsData.node_performance.map((np) => {
                        const style = NODE_STYLES[np.node_type] || NODE_STYLES.input;
                        return (
                          <tr key={np.node_id} className="hover:bg-gray-50/50">
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs">{style.icon}</span>
                                <span className="text-[11px] font-medium text-gray-700 truncate max-w-[120px]">{np.label}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right text-[11px] text-gray-600 tabular-nums">{np.executions}</td>
                            <td className="px-3 py-2 text-right text-[11px] text-gray-500 tabular-nums font-mono">{formatDuration(np.avg_duration_ms)}</td>
                            <td className="px-3 py-2 text-right text-[11px] text-gray-500 tabular-nums">{np.total_input_docs}</td>
                            <td className="px-3 py-2 text-right">
                              {np.failure_count > 0 ? (
                                <span className="text-[10px] font-medium text-red-600">{np.failure_count}</span>
                              ) : (
                                <span className="text-[10px] text-gray-300">0</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Hourly distribution (24h only) */}
            {metricsData.hourly_distribution?.length > 0 && (
              <div>
                <h5 className="text-[10px] uppercase tracking-wider font-bold text-gray-400 mb-2">
                  Hourly Activity
                </h5>
                <div className="flex items-end gap-px h-16 px-1">
                  {metricsData.hourly_distribution.map((h, i) => {
                    const max = Math.max(...metricsData.hourly_distribution.map((x) => x.executions), 1);
                    const pct = (h.executions / max) * 100;
                    return (
                      <div
                        key={i}
                        className="flex-1 bg-indigo-200 hover:bg-indigo-400 rounded-t transition-colors cursor-default group relative"
                        style={{ height: `${Math.max(pct, 2)}%` }}
                        title={`${h.hour}: ${h.executions} execution(s)`}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between px-1 mt-1">
                  <span className="text-[8px] text-gray-300">{metricsData.hourly_distribution[0]?.hour}</span>
                  <span className="text-[8px] text-gray-300">{metricsData.hourly_distribution[metricsData.hourly_distribution.length - 1]?.hour}</span>
                </div>
              </div>
            )}
          </div>
        ) : !loadingMetrics ? (
          <p className="text-[11px] text-gray-400 text-center py-4">No metrics available</p>
        ) : null}
      </CollapsibleSection>

      {/* ═══ Subscription Health ═══ */}
      {subscriptionHealth?.length > 0 && (
        <CollapsibleSection
          title="Subscription Health"
          icon={<Signal size={14} className="text-teal-500" />}
          expanded={expandedSection.health}
          onToggle={() => toggleSection('health')}
          badge={subscriptionHealth.filter((s) => s.consecutive_errors > 0).length > 0
            ? `${subscriptionHealth.filter((s) => s.consecutive_errors > 0).length} issues`
            : null}
          badgeColor="red"
        >
          <div className="space-y-1.5">
            {subscriptionHealth.map((sub) => (
              <div
                key={sub.subscription_id}
                className={`rounded-lg border p-2.5 ${
                  sub.consecutive_errors > 0
                    ? 'border-red-200 bg-red-50/50'
                    : sub.status === 'active'
                      ? 'border-emerald-200 bg-emerald-50/30'
                      : 'border-gray-100 bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${
                      sub.status === 'active' ? 'bg-emerald-400' : 'bg-gray-300'
                    }`} />
                    <span className="text-[11px] font-medium text-gray-700">{sub.node_label || 'Subscription'}</span>
                    <Pill color={sub.source_type === 'webhook' ? 'purple' : sub.source_type === 'email' ? 'sky' : 'gray'}>
                      {sub.source_type}
                    </Pill>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-gray-400">
                    <span>{sub.total_events} events</span>
                    <Dot />
                    <span>{sub.total_executions} triggers</span>
                  </div>
                </div>
                {sub.consecutive_errors > 0 && (
                  <div className="mt-1.5 flex items-start gap-1.5">
                    <AlertTriangle size={10} className="text-red-400 shrink-0 mt-0.5" />
                    <span className="text-[10px] text-red-600">
                      {sub.consecutive_errors} consecutive error(s): {sub.last_error}
                    </span>
                  </div>
                )}
                {sub.last_polled_at && (
                  <p className="text-[9px] text-gray-400 mt-1">
                    Last polled: {timeAgo(sub.last_polled_at)}
                    {sub.poll_interval && ` · every ${sub.poll_interval}s`}
                  </p>
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* ═══ Node Status Grid (from snapshot) ═══ */}
      {nodeStatus.length > 0 && !currentExecution && (
        <CollapsibleSection
          title="Node Status"
          icon={<Layers size={14} className="text-gray-400" />}
          expanded={false}
          onToggle={() => toggleSection('nodeStatusGrid')}
        >
          <div className="grid grid-cols-2 gap-1.5">
            {nodeStatus.map((ns) => {
              const style = NODE_STYLES[ns.node_type] || NODE_STYLES.input;
              return (
                <div key={ns.node_id} className={`rounded-lg border border-gray-100 p-2.5 ${style.bg} bg-opacity-30`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs">{style.icon}</span>
                    <span className="text-[11px] font-medium text-gray-700 truncate">{ns.label}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[9px] text-gray-400">
                    <span className={
                      ns.last_status === 'completed' ? 'text-emerald-600' :
                      ns.last_status === 'failed' ? 'text-red-500' : 'text-gray-400'
                    }>
                      {ns.last_status}
                    </span>
                    {ns.last_duration_ms && (
                      <>
                        <Dot />
                        <span className="font-mono">{formatDuration(ns.last_duration_ms)}</span>
                      </>
                    )}
                    {ns.last_run_at && (
                      <>
                        <Dot />
                        <span>{timeAgo(ns.last_run_at)}</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════════════════════════════ */

function CollapsibleSection({ title, icon, expanded: initialExpanded, onToggle, badge, badgeColor, children }) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded);

  const toggle = () => {
    setIsExpanded((prev) => !prev);
    onToggle?.();
  };

  // Sync if parent controls the state
  useEffect(() => { setIsExpanded(initialExpanded); }, [initialExpanded]);

  return (
    <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-gray-50 flex items-center justify-center">{icon}</div>
          <h4 className="text-[13px] font-semibold text-gray-800">{title}</h4>
          {badge && (
            <Pill color={badgeColor || 'gray'}>{badge}</Pill>
          )}
        </div>
        <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
          <ChevronDown size={14} className="text-gray-300" />
        </div>
      </button>
      {isExpanded && (
        <div className="border-t border-gray-100 px-4 py-3">
          {children}
        </div>
      )}
    </div>
  );
}

function EventRow({ event }) {
  const { event_type, data, received_at } = event;

  const eventConfig = {
    execution_started:   { icon: <Play size={10} className="text-blue-500" />,     label: 'Execution started',  color: 'text-blue-600' },
    execution_completed: { icon: <CheckCircle2 size={10} className="text-emerald-500" />, label: 'Execution completed', color: 'text-emerald-600' },
    execution_failed:    { icon: <XCircle size={10} className="text-red-500" />,    label: 'Execution failed',   color: 'text-red-600' },
    node_started:        { icon: <Play size={10} className="text-indigo-400" />,    label: 'Node started',       color: 'text-indigo-500' },
    node_completed:      { icon: <CheckCircle2 size={10} className="text-emerald-400" />, label: 'Node completed', color: 'text-emerald-500' },
    node_failed:         { icon: <XCircle size={10} className="text-red-400" />,    label: 'Node failed',        color: 'text-red-500' },
    node_progress:       { icon: <Activity size={10} className="text-blue-400" />,  label: 'Node progress',      color: 'text-blue-400' },
    document_processed:  { icon: <FileText size={10} className="text-gray-400" />,  label: 'Doc processed',      color: 'text-gray-500' },
    compilation:         { icon: <Zap size={10} className="text-amber-400" />,      label: 'Compilation',        color: 'text-amber-600' },
    live_tick:           { icon: <Radio size={10} className="text-teal-400" />,     label: 'Live tick',          color: 'text-teal-500' },
    metric_update:       { icon: <BarChart3 size={10} className="text-purple-400" />, label: 'Metric update',   color: 'text-purple-500' },
  };

  const cfg = eventConfig[event_type] || { icon: <Circle size={10} className="text-gray-300" />, label: event_type, color: 'text-gray-500' };

  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-50/60 transition-colors">
      <div className="w-5 h-5 rounded-md bg-gray-50 flex items-center justify-center shrink-0">
        {cfg.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-semibold ${cfg.color}`}>{cfg.label}</span>
          {(data?.node_label || data?.label) && (
            <>
              <Dot />
              <span className="text-[10px] text-gray-500 truncate">{data.node_label || data.label}</span>
            </>
          )}
          {data?.duration_ms != null && (
            <>
              <Dot />
              <span className="text-[10px] text-gray-400 font-mono">{formatDuration(data.duration_ms)}</span>
            </>
          )}
        </div>
        {data?.error && (
          <p className="text-[9px] text-red-500 truncate mt-0.5">{data.error}</p>
        )}
      </div>
      <span className="text-[9px] text-gray-300 shrink-0 tabular-nums">
        {received_at ? timeAgo(received_at) : ''}
      </span>
    </div>
  );
}

function MetricCard({ label, value, icon, color = 'gray' }) {
  const colors = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    red:     'bg-red-50 text-red-700 border-red-100',
    amber:   'bg-amber-50 text-amber-700 border-amber-100',
    indigo:  'bg-indigo-50 text-indigo-700 border-indigo-100',
    sky:     'bg-sky-50 text-sky-700 border-sky-100',
    purple:  'bg-purple-50 text-purple-700 border-purple-100',
    gray:    'bg-gray-50 text-gray-700 border-gray-100',
  };
  const iconColors = {
    emerald: 'text-emerald-500',
    red:     'text-red-500',
    amber:   'text-amber-500',
    indigo:  'text-indigo-500',
    sky:     'text-sky-500',
    purple:  'text-purple-500',
    gray:    'text-gray-500',
  };
  return (
    <div className={`rounded-xl border p-3 ${colors[color] || colors.gray}`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={iconColors[color] || iconColors.gray}>{icon}</span>
        <span className="text-[9px] uppercase tracking-wider font-bold opacity-60">{label}</span>
      </div>
      <p className="text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}
