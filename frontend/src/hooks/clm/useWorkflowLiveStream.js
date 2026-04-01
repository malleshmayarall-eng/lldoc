/**
 * useWorkflowLiveStream — Polling-first live data hook for CLM workflows.
 *
 * Architecture:
 *   1. **Polling is primary** — always works through the Vite proxy (same-origin).
 *   2. **SSE is an optional enhancement** — tried once; if it connects it
 *      delivers lower-latency deltas, but the UI never depends on it.
 *   3. `connected` reflects *data freshness* (poll success), NOT SSE state.
 *   4. `connectionMode` tells the UI what transport is active:
 *        'none' | 'polling' | 'sse'
 *
 * Adaptive polling:
 *   - 2 s while any execution is `executing` / `compiling`
 *   - 5 s otherwise (idle)
 *
 * Failure threshold:
 *   - 3 consecutive poll failures → `connected = false`
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { workflowApi } from '@services/clm/clmApi';

/* ── Tunables ──────────────────────────────────────────────── */
const POLL_INTERVAL_ACTIVE = 2_000;   // ms — during execution
const POLL_INTERVAL_IDLE   = 5_000;   // ms — when idle
const POLL_FAIL_THRESHOLD  = 3;       // consecutive failures before "disconnected"
const SSE_CONNECT_TIMEOUT  = 8_000;   // ms — give up on SSE after this

/* ── SSE URL helper ────────────────────────────────────────── */
function getSSEUrl(workflowId) {
  // In dev the Vite proxy can buffer SSE chunks, so we go direct to Django.
  const loc = window.location;
  const devPorts = ['3000', '3001', '5173', '5174'];
  const base = devPorts.includes(loc.port)
    ? `http://localhost:8000`
    : loc.origin;
  return `${base}/api/clm/workflows/${workflowId}/live-stream/`;
}

/* ── Default empty state ───────────────────────────────────── */
const EMPTY = {
  nodeProgress:       {},
  events:             [],
  currentExecution:   null,
  metrics:            null,
  nodeStatus:         {},
  subscriptionHealth: null,
  workflowInfo:       null,
};

/* ═══════════════════════════════════════════════════════════════
   Hook
   ═══════════════════════════════════════════════════════════ */
export default function useWorkflowLiveStream(workflowId, opts = {}) {
  const { autoConnect = false, includeRecent = false } = opts;

  /* ── Public state ─────────────────────────────────────── */
  const [connected, setConnected]           = useState(false);
  const [connectionMode, setConnectionMode] = useState('none'); // none | polling | sse
  const [sseSupported, setSseSupported]     = useState(false);

  const [nodeProgress, setNodeProgress]           = useState({});
  const [events, setEvents]                       = useState([]);
  const [currentExecution, setCurrentExecution]   = useState(null);
  const [metrics, setMetrics]                     = useState(null);
  const [nodeStatus, setNodeStatus]               = useState([]);
  const [subscriptionHealth, setSubscriptionHealth] = useState([]);
  const [workflowInfo, setWorkflowInfo]           = useState(null);

  /* ── Internal refs ────────────────────────────────────── */
  const pollTimer   = useRef(null);
  const sseRef      = useRef(null);
  const failCount   = useRef(0);
  const active      = useRef(false);   // master on/off
  const lastETag    = useRef(null);    // avoid redundant re-renders
  const mountedRef  = useRef(true);

  /* keep workflowId ref current for timers */
  const wfIdRef = useRef(workflowId);
  useEffect(() => { wfIdRef.current = workflowId; }, [workflowId]);

  /* ──────────────────────────────────────────────────────────
     applySnapshot — merge a dashboard response into state
     ────────────────────────────────────────────────────────── */
  const applySnapshot = useCallback((data) => {
    if (!mountedRef.current) return;

    // Build nodeProgress map from multiple sources:
    // 1. current_execution.node_progress (array, live during execution)
    // 2. node_status (array, per-node last-run summary)
    const np = {};

    // First, seed from node_status (always present)
    if (Array.isArray(data.node_status)) {
      data.node_status.forEach((ns) => {
        np[ns.node_id] = {
          status:      ns.last_status === 'never_run' ? 'pending' : ns.last_status,
          progress:    0,
          duration_ms: ns.last_duration_ms ?? 0,
          label:       ns.label || '',
          node_type:   ns.node_type || '',
          dag_level:   0,
          documents:   {
            total:   ns.total_documents ?? 0,
            ready:   ns.ready_documents ?? 0,
            pending: ns.pending_documents ?? 0,
            failed:  ns.failed_documents ?? 0,
          },
        };
      });
    }

    // Override with live execution progress (more current)
    const execProgress = data.current_execution?.node_progress;
    if (Array.isArray(execProgress)) {
      execProgress.forEach((info) => {
        np[info.node_id] = {
          ...np[info.node_id],
          status:      info.status || 'pending',
          progress:    info.progress_pct ?? info.progress ?? 0,
          duration_ms: info.duration_ms ?? 0,
          label:       info.label || np[info.node_id]?.label || '',
          node_type:   info.node_type || np[info.node_id]?.node_type || '',
          dag_level:   info.dag_level ?? 0,
        };
      });
    }

    setNodeProgress(np);
    setCurrentExecution(data.current_execution ?? null);
    setMetrics(data.live_metrics ?? data.metrics ?? null);
    setWorkflowInfo(data.workflow ?? null);

    if (Array.isArray(data.node_status)) {
      setNodeStatus(data.node_status);
    }

    setSubscriptionHealth(Array.isArray(data.subscription_health) ? data.subscription_health : []);

    if (data.recent_events?.length) {
      setEvents((prev) => {
        const existing = new Set(prev.map((e) => e.created_at + (e.event_type || '')));
        const novel = data.recent_events.filter(
          (e) => !existing.has(e.created_at + (e.event_type || ''))
        );
        if (!novel.length) return prev;
        return [...novel, ...prev].slice(0, 200);
      });
    }
  }, []);

  /* ──────────────────────────────────────────────────────────
     fetchSnapshot — single poll cycle
     ────────────────────────────────────────────────────────── */
  const fetchSnapshot = useCallback(async () => {
    if (!wfIdRef.current) return;
    try {
      const { data } = await workflowApi.liveDashboard(wfIdRef.current);
      applySnapshot(data);
      failCount.current = 0;
      if (mountedRef.current) {
        setConnected(true);
        setConnectionMode((prev) => prev === 'none' ? 'polling' : prev);
      }
    } catch (err) {
      failCount.current++;
      if (failCount.current >= POLL_FAIL_THRESHOLD && mountedRef.current) {
        setConnected(false);
      }
      console.warn(`[LiveStream] poll #${failCount.current} failed:`, err.message);
    }
  }, [applySnapshot]);

  /* ──────────────────────────────────────────────────────────
     Polling loop (adaptive interval)
     ────────────────────────────────────────────────────────── */
  const startPolling = useCallback(() => {
    stopPolling();
    const tick = async () => {
      if (!active.current) return;
      await fetchSnapshot();
      if (!active.current) return;
      // Choose interval based on execution state
      const isActive = currentExecution?.status === 'executing' ||
                       currentExecution?.status === 'compiling';
      const interval = isActive ? POLL_INTERVAL_ACTIVE : POLL_INTERVAL_IDLE;
      pollTimer.current = setTimeout(tick, interval);
    };
    tick();
  }, [fetchSnapshot, currentExecution?.status]);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  /* ──────────────────────────────────────────────────────────
     SSE — optional enhancement (fire-and-forget)
     ────────────────────────────────────────────────────────── */
  const trySSE = useCallback(() => {
    if (!wfIdRef.current || typeof EventSource === 'undefined') return;

    // Don't retry if we already have an SSE open
    if (sseRef.current) return;

    const url = getSSEUrl(wfIdRef.current);
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      console.info('[LiveStream] SSE timed out — polling is sufficient');
    }, SSE_CONNECT_TIMEOUT);

    try {
      const es = new EventSource(url, { withCredentials: true });
      sseRef.current = es;

      es.onopen = () => {
        if (timedOut) return;
        clearTimeout(timeout);
        if (mountedRef.current) {
          setSseSupported(true);
          setConnectionMode('sse');
        }
        console.info('[LiveStream] SSE connected');
      };

      es.onmessage = (ev) => {
        if (!mountedRef.current || !active.current) return;
        try {
          const payload = JSON.parse(ev.data);

          // SSE snapshot replaces state
          if (payload.type === 'snapshot' || payload.type === 'dashboard') {
            applySnapshot(payload.data ?? payload);
            return;
          }

          // SSE incremental event → prepend to event log
          if (payload.event_type || payload.type) {
            setEvents((prev) => [payload, ...prev].slice(0, 200));
          }

          // Node-level updates
          if (payload.node_id && payload.status) {
            setNodeProgress((prev) => ({
              ...prev,
              [payload.node_id]: {
                ...prev[payload.node_id],
                status:      payload.status,
                progress:    payload.progress_pct ?? prev[payload.node_id]?.progress ?? 0,
                duration_ms: payload.duration_ms ?? prev[payload.node_id]?.duration_ms ?? 0,
                label:       payload.node_label ?? prev[payload.node_id]?.label ?? '',
              },
            }));
          }

          // Execution status updates
          if (payload.type === 'execution_started') {
            setCurrentExecution((prev) => ({
              ...prev,
              status: 'executing',
              execution_id: payload.execution_id,
              started_at: payload.timestamp,
            }));
          }
          if (payload.type === 'execution_completed') {
            setCurrentExecution((prev) => ({
              ...prev,
              status: payload.status || 'completed',
              completed_at: payload.timestamp,
            }));
          }
        } catch (e) {
          // Non-JSON SSE data — ignore
        }
      };

      es.onerror = () => {
        clearTimeout(timeout);
        es.close();
        sseRef.current = null;
        if (mountedRef.current) {
          setConnectionMode((m) => (m === 'sse' ? 'polling' : m));
        }
      };
    } catch {
      clearTimeout(timeout);
      sseRef.current = null;
    }
  }, [applySnapshot]);

  const closeSSE = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
  }, []);

  /* ──────────────────────────────────────────────────────────
     connect / disconnect / refresh
     ────────────────────────────────────────────────────────── */
  const connect = useCallback(() => {
    active.current = true;
    failCount.current = 0;
    startPolling();      // always start polling first
    trySSE();            // try SSE as bonus
  }, [startPolling, trySSE]);

  const disconnect = useCallback(() => {
    active.current = false;
    stopPolling();
    closeSSE();
    setConnected(false);
    setConnectionMode('none');
  }, [stopPolling, closeSSE]);

  const refresh = useCallback(() => {
    fetchSnapshot();
  }, [fetchSnapshot]);

  /* ── Auto-connect on mount when workflowId present ────── */
  useEffect(() => {
    mountedRef.current = true;
    if (autoConnect && workflowId) {
      connect();
    }
    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, [workflowId]);  // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Re-connect when workflowId changes ───────────────── */
  useEffect(() => {
    if (!active.current || !workflowId) return;
    // Tear down old SSE and restart polling for new workflow
    closeSSE();
    failCount.current = 0;
    startPolling();
    trySSE();
  }, [workflowId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Adaptive polling speed: restart timer when exec state changes ── */
  useEffect(() => {
    if (!active.current) return;
    // Re-kick the poll loop so it picks up the new interval
    startPolling();
  }, [currentExecution?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ══════════════════════════════════════════════════════════
     Public API
     ═════════════════════════════════════════════════════════ */
  return {
    // Connection
    connected,
    connectionMode,   // 'none' | 'polling' | 'sse'
    sseSupported,

    // Data
    nodeProgress,
    events,
    currentExecution,
    metrics,
    nodeStatus,
    subscriptionHealth,
    workflowInfo,

    // Actions
    connect,
    disconnect,
    refresh,
  };
}
