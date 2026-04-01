import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { debugApi } from '@services/clm/clmApi';

// ─── Refresh interval (ms) ────────────────────────────────────────
const POLL_INTERVAL = 8000;  // 8s — backend caches for 10s

// ─── Helpers ───────────────────────────────────────────────────────

function cls(...args) {
  return args.filter(Boolean).join(' ');
}

function StatusDot({ status }) {
  const color = {
    healthy: 'bg-emerald-400',
    online: 'bg-emerald-400',
    completed: 'bg-emerald-400',
    idle: 'bg-emerald-400',
    running: 'bg-blue-400 animate-pulse',
    queued: 'bg-yellow-400',
    partial: 'bg-amber-400',
    failed: 'bg-red-400',
    unreachable: 'bg-red-400',
    no_workers: 'bg-orange-400',
    unknown: 'bg-gray-400',
    error: 'bg-red-500',
  }[status] || 'bg-gray-400';

  return <span className={cls('inline-block w-2.5 h-2.5 rounded-full', color)} />;
}

function Badge({ children, variant = 'default' }) {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';
  const variants = {
    default: 'bg-gray-100 text-gray-700',
    success: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20',
    warning: 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/20',
    danger: 'bg-red-50 text-red-700 ring-1 ring-red-600/20',
    info: 'bg-blue-50 text-blue-700 ring-1 ring-blue-600/20',
  };
  return <span className={cls(base, variants[variant])}>{children}</span>;
}

function statusBadgeVariant(status) {
  return {
    completed: 'success', healthy: 'success', online: 'success', idle: 'success',
    running: 'info', queued: 'info',
    partial: 'warning', no_workers: 'warning',
    failed: 'danger', unreachable: 'danger', error: 'danger',
  }[status] || 'default';
}

function Card({ title, icon, children, className = '', ...rest }) {
  return (
    <div {...rest} className={cls('bg-white rounded-xl border border-gray-200 shadow-sm', className)}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        {icon && <span className="text-lg">{icon}</span>}
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function formatDuration(ms) {
  if (!ms && ms !== 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}


// ═══════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════

export default function SystemDebugPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [roundTripMs, setRoundTripMs] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [highlightWorkflowId, setHighlightWorkflowId] = useState(null);
  const intervalRef = useRef(null);
  const location = useLocation();

  // ── Fetch system status ────────────────────────────────────────
  const refresh = useCallback(async () => {
    try {
      const t0 = performance.now();
      const res = await debugApi.systemStatus();
      const t1 = performance.now();
      setRoundTripMs(Math.round(t1 - t0));
      setData(res.data);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to fetch system status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // If a workflowId query param is present, switch to the workflows tab
    const params = new URLSearchParams(location.search);
    const wfId = params.get('workflowId');
    if (wfId) {
      setActiveTab('workflows');
      setHighlightWorkflowId(wfId);
    }
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(refresh, POLL_INTERVAL);
    }
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh, refresh]);

  // ── Tabs ───────────────────────────────────────────────────────
  const tabs = [
    { key: 'overview', label: 'Overview', icon: '📊' },
    { key: 'celery', label: 'Celery Workers', icon: '🐝' },
    { key: 'redis', label: 'Redis', icon: '🔴' },
    { key: 'tasks', label: 'Task Queue', icon: '📋' },
    { key: 'workflows', label: 'Live Workflows', icon: '⚡' },
    { key: 'executions', label: 'Executions', icon: '🕐' },
  ];

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            🛠️ System Debug Console
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Celery · Redis · Task Queue · Live Workflows
            {lastRefresh && (
              <span className="ml-2">
                — last refresh {timeAgo(lastRefresh.toISOString())}
              </span>
            )}
            {data?.response_time_ms != null && (
              <span className="ml-1.5 text-[10px] text-gray-400">
                (server {data.response_time_ms}ms
                {roundTripMs != null && <>, roundtrip {roundTripMs}ms</>}
                {data?.cached && <>, <span className="text-green-500 font-medium">cached</span></>})
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {error && (
            <span className="text-xs text-red-500 bg-red-50 px-2 py-1 rounded">
              ⚠ {error}
            </span>
          )}
          <button
            onClick={refresh}
            className="text-xs px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 transition font-medium"
          >
            ↻ Refresh
          </button>
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={cls(
              'text-xs px-3 py-1.5 rounded-lg border font-medium transition',
              autoRefresh
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-gray-50 border-gray-200 text-gray-500'
            )}
          >
            {autoRefresh ? '● Auto (8s)' : '○ Paused'}
          </button>
        </div>
      </div>

      {/* ── Tab bar ──────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cls(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition',
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            )}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ──────────────────────────────────────────── */}
      {data && (
        <>
          {activeTab === 'overview' && <OverviewTab data={data} />}
          {activeTab === 'celery' && <CeleryTab data={data.celery} />}
          {activeTab === 'redis' && <RedisTab data={data.redis} />}
          {activeTab === 'tasks' && <TaskQueueTab data={data.task_queue} />}
          {activeTab === 'workflows' && (
            <LiveWorkflowsTab data={data.live_workflows} highlightId={highlightWorkflowId} />
          )}
          {activeTab === 'executions' && <ExecutionsTab data={data.recent_executions} taskHistory={data.task_history} />}
        </>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// Overview Tab
// ═══════════════════════════════════════════════════════════════════

function OverviewTab({ data }) {
  const celery = data.celery || {};
  const redis = data.redis || {};
  const queue = data.task_queue || {};
  const history = data.task_history || {};
  const stats = history.stats_24h || {};
  const liveWfs = data.live_workflows || [];

  const summaryCards = [
    {
      label: 'Celery',
      value: celery.status,
      sub: `${celery.total_workers || 0} worker(s)`,
      icon: '🐝',
    },
    {
      label: 'Redis',
      value: redis.status,
      sub: redis.memory?.used_memory_human || '—',
      icon: '🔴',
    },
    {
      label: 'Queue Depth',
      value: queue.total_active ?? 0,
      sub: `${queue.total_reserved || 0} reserved · ${queue.total_scheduled || 0} scheduled`,
      icon: '📋',
    },
    {
      label: 'Live Workflows',
      value: liveWfs.length,
      sub: `${liveWfs.filter((w) => w.is_stuck).length} stuck`,
      icon: '⚡',
    },
    {
      label: '24h Executions',
      value: stats.total ?? 0,
      sub: `${stats.success_rate ?? 0}% success`,
      icon: '📈',
    },
    {
      label: 'Avg Duration',
      value: formatDuration(stats.avg_duration_ms),
      sub: `max ${formatDuration(stats.max_duration_ms)}`,
      icon: '⏱️',
    },
  ];

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {summaryCards.map((card, i) => (
          <div
            key={i}
            className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">{card.icon}</span>
              <span className="text-xs text-gray-500 font-medium">{card.label}</span>
            </div>
            <div className="flex items-center gap-2">
              {typeof card.value === 'string' && (
                <StatusDot status={card.value} />
              )}
              <span className="text-lg font-bold text-gray-900">
                {card.value}
              </span>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Beat schedule */}
      <Card title="Celery Beat Schedule" icon="⏰">
        {data.beat_schedule?.tasks?.length ? (
          <div className="divide-y divide-gray-100">
            {data.beat_schedule.tasks.map((t, i) => (
              <div key={i} className="flex items-center justify-between py-2 text-xs">
                <div>
                  <span className="font-medium text-gray-800">{t.name}</span>
                  <span className="text-gray-400 ml-2">{t.task}</span>
                </div>
                <Badge variant="info">
                  every {typeof t.schedule_seconds === 'number'
                    ? `${t.schedule_seconds}s`
                    : t.schedule_seconds}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">No Beat tasks configured</p>
        )}
      </Card>

      {/* Recent executions mini-table */}
      <Card title="Recent Executions" icon="🕐">
        <RecentExecutionsTable executions={data.recent_executions || []} compact />
      </Card>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// Celery Tab
// ═══════════════════════════════════════════════════════════════════

function CeleryTab({ data }) {
  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Connection info */}
      <Card title="Broker Connection" icon="🔗">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-gray-500">Status</span>
            <div className="flex items-center gap-1.5 mt-0.5 font-medium">
              <StatusDot status={data.status} />
              {data.status}
            </div>
          </div>
          <div>
            <span className="text-gray-500">Workers Online</span>
            <p className="font-medium mt-0.5">{data.total_workers}</p>
          </div>
          <div>
            <span className="text-gray-500">Broker URL</span>
            <p className="font-mono text-gray-700 mt-0.5 break-all">{data.broker_url}</p>
          </div>
          <div>
            <span className="text-gray-500">Result Backend</span>
            <p className="font-mono text-gray-700 mt-0.5 break-all">{data.result_backend}</p>
          </div>
        </div>
        {data.error && (
          <div className="mt-3 p-2 bg-red-50 rounded text-xs text-red-600">{data.error}</div>
        )}
      </Card>

      {/* Per-worker details */}
      {data.workers?.map((w) => (
        <Card key={w.name} title={w.name} icon="🖥️">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <Stat label="Status" value={<><StatusDot status={w.status} /> {w.status}</>} />
            <Stat label="PID" value={w.pid} />
            <Stat label="Active Tasks" value={w.active_tasks} />
            <Stat label="Registered" value={w.registered_tasks} />
            <Stat label="Prefetch" value={w.prefetch_count} />
            <Stat label="Pool" value={w.pool?.impl || '—'} />
            <Stat label="Concurrency" value={w.pool?.max_concurrency || '—'} />
            <Stat label="Clock" value={w.clock} />
          </div>
          {w.active_task_names?.length > 0 && (
            <div className="mt-3">
              <span className="text-[11px] text-gray-500 uppercase tracking-wide">Running now:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {w.active_task_names.map((n, i) => (
                  <Badge key={i} variant="info">{n.split('.').pop()}</Badge>
                ))}
              </div>
            </div>
          )}
        </Card>
      ))}

      {data.workers?.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
          ⚠ No Celery workers are responding. Start a worker with:
          <code className="block mt-1 text-xs font-mono bg-amber-100 rounded px-2 py-1">
            celery -A drafter worker -B -l info
          </code>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// Redis Tab
// ═══════════════════════════════════════════════════════════════════

function RedisTab({ data }) {
  if (!data) return null;

  return (
    <div className="space-y-4">
      <Card title="Connection" icon="🔗">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <Stat label="Status" value={<><StatusDot status={data.status} /> {data.status}</>} />
          <Stat label="Latency" value={data.latency_ms != null ? `${data.latency_ms}ms` : '—'} />
          <Stat label="URL" value={<span className="font-mono break-all">{data.url}</span>} />
          <Stat label="Total Keys" value={data.total_db_keys ?? '—'} />
        </div>
        {data.error && (
          <div className="mt-3 p-2 bg-red-50 rounded text-xs text-red-600">{data.error}</div>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Server Info" icon="📡">
          <div className="grid grid-cols-2 gap-2 text-xs">
            {data.server_info && Object.entries(data.server_info).map(([k, v]) => (
              <Stat key={k} label={k.replace(/_/g, ' ')} value={String(v)} />
            ))}
          </div>
        </Card>

        <Card title="Memory" icon="💾">
          <div className="grid grid-cols-2 gap-2 text-xs">
            {data.memory && Object.entries(data.memory).map(([k, v]) => (
              <Stat key={k} label={k.replace(/_/g, ' ')} value={String(v)} />
            ))}
          </div>
        </Card>

        <Card title="Clients" icon="👥">
          <div className="grid grid-cols-2 gap-2 text-xs">
            {data.clients && Object.entries(data.clients).map(([k, v]) => (
              <Stat key={k} label={k.replace(/_/g, ' ')} value={String(v)} />
            ))}
          </div>
        </Card>

        <Card title="CLM Keys" icon="🔑">
          <div className="grid grid-cols-2 gap-2 text-xs">
            {data.clm_keys && Object.entries(data.clm_keys).map(([k, v]) => (
              <Stat key={k} label={k.replace(/_/g, ' ')} value={String(v)} />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// Task Queue Tab
// ═══════════════════════════════════════════════════════════════════

function TaskQueueTab({ data }) {
  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-blue-50 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-blue-700">{data.total_active}</p>
          <p className="text-xs text-blue-500">Active</p>
        </div>
        <div className="bg-amber-50 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-amber-700">{data.total_reserved}</p>
          <p className="text-xs text-amber-500">Reserved</p>
        </div>
        <div className="bg-purple-50 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-purple-700">{data.total_scheduled}</p>
          <p className="text-xs text-purple-500">Scheduled</p>
        </div>
      </div>

      {data.error && (
        <div className="p-3 bg-red-50 rounded-lg text-xs text-red-600">⚠ {data.error}</div>
      )}

      {/* Active tasks */}
      <Card title={`Active Tasks (${data.active?.length || 0})`} icon="▶️">
        {data.active?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 pr-3">Task</th>
                  <th className="pb-2 pr-3">Worker</th>
                  <th className="pb-2 pr-3">ID</th>
                  <th className="pb-2 pr-3">Args</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.active.map((t, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-3 font-medium">{t.task_name?.split('.').pop()}</td>
                    <td className="py-1.5 pr-3 text-gray-500">{t.worker?.split('@').pop()}</td>
                    <td className="py-1.5 pr-3 font-mono text-gray-400">{t.task_id?.slice(0, 8)}</td>
                    <td className="py-1.5 pr-3 text-gray-400 max-w-[200px] truncate">{t.args}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-gray-400">No active tasks</p>
        )}
      </Card>

      {/* Reserved */}
      <Card title={`Reserved (${data.reserved?.length || 0})`} icon="⏸️">
        {data.reserved?.length ? (
          <div className="flex flex-wrap gap-2">
            {data.reserved.map((t, i) => (
              <Badge key={i} variant="warning">{t.task_name?.split('.').pop()}</Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">No reserved tasks</p>
        )}
      </Card>

      {/* Scheduled */}
      <Card title={`Scheduled (${data.scheduled?.length || 0})`} icon="📅">
        {data.scheduled?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 pr-3">Task</th>
                  <th className="pb-2 pr-3">ETA</th>
                  <th className="pb-2 pr-3">Priority</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.scheduled.map((t, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-3 font-medium">{t.task_name?.split('.').pop()}</td>
                    <td className="py-1.5 pr-3 text-gray-500">{t.eta}</td>
                    <td className="py-1.5 pr-3">{t.priority}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-gray-400">No scheduled tasks</p>
        )}
      </Card>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// Live Workflows Tab
// ═══════════════════════════════════════════════════════════════════

function LiveWorkflowsTab({ data, highlightId }) {
  const workflows = data || [];
  const containerRef = useRef(null);

  if (!workflows.length) {
    return (
      <div className="text-center py-12 text-gray-400 text-sm">
        No live workflows running. Toggle a workflow to live mode from the canvas.
      </div>
    );
  }

  useEffect(() => {
    if (!highlightId || !containerRef.current) return;
    const el = containerRef.current.querySelector(`[data-wf-id="${highlightId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightId]);

  return (
    <div className="space-y-3" ref={containerRef}>
      {workflows.map((wf) => (
        <Card
          key={wf.id}
          data-wf-id={wf.id}
          title={wf.name}
          icon={wf.is_stuck ? '🚨' : '⚡'}
          className={`${wf.is_stuck ? 'ring-2 ring-red-200' : ''} ${wf.id === highlightId ? 'border-2 border-indigo-400 bg-indigo-50' : ''}`}
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <Stat
              label="Execution State"
              value={<><StatusDot status={wf.execution_state} /> {wf.execution_state}</>}
            />
            <Stat
              label="Compilation"
              value={
                <Badge variant={wf.compilation_status === 'compiled' ? 'success' : 'warning'}>
                  {wf.compilation_status}
                </Badge>
              }
            />
            <Stat label="Interval" value={`${wf.live_interval || '—'}s`} />
            <Stat label="Auto Upload" value={wf.auto_execute_on_upload ? 'Yes' : 'No'} />
            <Stat label="Last Executed" value={timeAgo(wf.last_executed_at)} />
            <Stat label="Compiled At" value={timeAgo(wf.compiled_at)} />
          </div>

          {wf.is_stuck && (
            <div className="mt-2 p-2 bg-red-50 rounded text-xs text-red-600">
              ⚠ Possibly stuck — execution_state is <strong>{wf.execution_state}</strong> but no
              running/queued executions found.
            </div>
          )}

          {wf.last_execution && (
            <div className="mt-3 p-2 bg-gray-50 rounded text-xs">
              <span className="font-medium text-gray-600">Last Execution:</span>{' '}
              <Badge variant={statusBadgeVariant(wf.last_execution.status)}>
                {wf.last_execution.status}
              </Badge>{' '}
              — {wf.last_execution.total_documents} docs
              — {formatDuration(wf.last_execution.duration_ms)}
              — mode: {wf.last_execution.mode}
              <span className="text-gray-400 ml-2">{timeAgo(wf.last_execution.started_at)}</span>
            </div>
          )}

          {wf.subscriptions?.length > 0 && (
            <div className="mt-2">
              <span className="text-[11px] text-gray-500 uppercase tracking-wide">Subscriptions:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {wf.subscriptions.map((sub, i) => (
                  <Badge
                    key={i}
                    variant={sub.consecutive_errors > 0 ? 'danger' : 'success'}
                  >
                    {sub.source_type}
                    {sub.consecutive_errors > 0 && ` (${sub.consecutive_errors} errors)`}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// Executions Tab
// ═══════════════════════════════════════════════════════════════════

function ExecutionsTab({ data, taskHistory }) {
  const stats = taskHistory?.stats_24h || {};

  return (
    <div className="space-y-4">
      {/* 24h stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: 'Total', value: stats.total ?? 0, color: 'gray' },
          { label: 'Completed', value: stats.completed ?? 0, color: 'emerald' },
          { label: 'Failed', value: stats.failed ?? 0, color: 'red' },
          { label: 'Partial', value: stats.partial ?? 0, color: 'amber' },
          { label: 'Queued', value: stats.queued ?? 0, color: 'blue' },
          { label: 'Running', value: stats.running ?? 0, color: 'indigo' },
          { label: 'Success Rate', value: `${stats.success_rate ?? 0}%`, color: 'emerald' },
        ].map((s, i) => (
          <div key={i} className={`bg-${s.color}-50 rounded-xl p-2 text-center`}>
            <p className={`text-xl font-bold text-${s.color}-700`}>{s.value}</p>
            <p className={`text-[11px] text-${s.color}-500`}>{s.label}</p>
          </div>
        ))}
      </div>

      <Card title="Recent Executions (24h)" icon="🕐">
        <RecentExecutionsTable executions={data || []} />
      </Card>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// Shared Components
// ═══════════════════════════════════════════════════════════════════

function Stat({ label, value }) {
  return (
    <div>
      <span className="text-gray-500 capitalize">{label}</span>
      <div className="font-medium text-gray-800 mt-0.5 flex items-center gap-1.5">
        {value}
      </div>
    </div>
  );
}

function RecentExecutionsTable({ executions, compact = false }) {
  const list = compact ? executions.slice(0, 8) : executions;

  if (!list.length) {
    return <p className="text-xs text-gray-400">No executions found</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-500 border-b">
            <th className="pb-2 pr-3">Workflow</th>
            <th className="pb-2 pr-3">Status</th>
            <th className="pb-2 pr-3">Mode</th>
            <th className="pb-2 pr-3">Docs</th>
            <th className="pb-2 pr-3">Duration</th>
            <th className="pb-2 pr-3">Started</th>
            {!compact && <th className="pb-2 pr-3">Triggered By</th>}
            {!compact && <th className="pb-2 pr-3">Error</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {list.map((ex) => (
            <tr key={ex.id}>
              <td className="py-1.5 pr-3 font-medium max-w-[180px] truncate">
                {ex.workflow_name}
              </td>
              <td className="py-1.5 pr-3">
                <Badge variant={statusBadgeVariant(ex.status)}>{ex.status}</Badge>
              </td>
              <td className="py-1.5 pr-3 text-gray-500">{ex.mode}</td>
              <td className="py-1.5 pr-3">{ex.total_documents}</td>
              <td className="py-1.5 pr-3">{formatDuration(ex.duration_ms)}</td>
              <td className="py-1.5 pr-3 text-gray-400">{timeAgo(ex.started_at)}</td>
              {!compact && <td className="py-1.5 pr-3 text-gray-400">{ex.triggered_by || '—'}</td>}
              {!compact && (
                <td className="py-1.5 pr-3 text-red-400 max-w-[200px] truncate">
                  {ex.error_excerpt || '—'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
