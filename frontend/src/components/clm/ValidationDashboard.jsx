import React, { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { workflowApi } from '@services/clm/clmApi';
import notify from '@utils/clm/clmNotify';
import { Spinner } from '@components/clm/ui/SharedUI';

/* ================================================================
   ValidationDashboard — Global + Per-Workflow Validation View
   ================================================================
   /validation          → Global: all pending decisions for logged-in user
   /validation/:wfId    → Per-workflow: decisions for one workflow
   ================================================================ */
export default function ValidationDashboard() {
  const { workflowId } = useParams();  // undefined for global view
  const isGlobal = !workflowId;

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [resolving, setResolving] = useState(null);
  const [noteMap, setNoteMap] = useState({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (isGlobal) {
        const { data: d } = await workflowApi.myValidations({ status: filter !== 'all' ? filter : undefined });
        setData(d);
      } else {
        const { data: d } = await workflowApi.validationStatus(workflowId);
        setData(d);
      }
    } catch (e) {
      notify.error('Failed to load validations');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [isGlobal, workflowId, filter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleResolve = async (decisionId, action) => {
    setResolving(decisionId);
    try {
      const wfId = workflowId || data?.workflows?.find(w =>
        w.decisions?.some(d => d.id === decisionId)
      )?.workflow_id;

      if (!wfId) {
        notify.error('Workflow not found for this decision');
        return;
      }

      const { data: result } = await workflowApi.resolveValidation(wfId, {
        decision_id: decisionId,
        action,
        note: noteMap[decisionId] || '',
      });
      if (result.success) {
        notify.success(result.message || `Decision ${action}d`);
        fetchData();
      } else {
        notify.error(result.error || 'Failed to resolve');
      }
    } catch (e) {
      notify.error(e.response?.data?.error || 'Failed to resolve');
    } finally {
      setResolving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner size="lg" className="text-emerald-500" />
      </div>
    );
  }

  const summary = data?.summary || {};

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            ✅ {isGlobal ? 'My Validations' : 'Workflow Validations'}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {isGlobal
              ? 'Documents pending your approval across all workflows'
              : 'Validation status for this workflow'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/clm/workflows" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Workflows
          </Link>
          <button onClick={fetchData} className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs hover:bg-gray-200 transition-colors">
            Refresh
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="Total" value={summary.total || 0} color="gray" />
        <SummaryCard label="Pending" value={summary.pending || 0} color="amber" highlight />
        <SummaryCard label="Approved" value={summary.approved || 0} color="emerald" />
        <SummaryCard label="Rejected" value={summary.rejected || 0} color="red" />
      </div>

      {/* Filter tabs */}
      {isGlobal && (
        <div className="flex items-center gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
          {['pending', 'approved', 'rejected', 'all'].map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                filter === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {isGlobal ? (
        <GlobalView
          workflows={data?.workflows || []}
          onResolve={handleResolve}
          resolving={resolving}
          noteMap={noteMap}
          setNoteMap={setNoteMap}
        />
      ) : (
        <WorkflowView
          data={data}
          onResolve={handleResolve}
          resolving={resolving}
          noteMap={noteMap}
          setNoteMap={setNoteMap}
        />
      )}
    </div>
  );
}


/* ── Summary Card ─────────────────────────────────────── */
function SummaryCard({ label, value, color, highlight }) {
  const colors = {
    gray:    'bg-gray-50 text-gray-700 border-gray-200',
    amber:   'bg-amber-50 text-amber-700 border-amber-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red:     'bg-red-50 text-red-700 border-red-200',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color] || colors.gray} ${highlight && value > 0 ? 'ring-2 ring-amber-300' : ''}`}>
      <p className="text-[10px] uppercase tracking-wider font-semibold opacity-60">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}


/* ── Global View — grouped by workflow ─────────────────── */
function GlobalView({ workflows, onResolve, resolving, noteMap, setNoteMap }) {
  if (!workflows.length) {
    return (
      <div className="text-center py-16">
        <p className="text-4xl mb-3">🎉</p>
        <p className="text-gray-500 text-sm">No pending validations</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {workflows.map(wf => (
        <div key={wf.workflow_id} className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="bg-emerald-50 px-4 py-3 flex items-center justify-between border-b">
            <div className="flex items-center gap-2">
              <span className="text-base">📑</span>
              <Link
                to={`/clm/workflows/${wf.workflow_id}`}
                className="text-sm font-semibold text-emerald-800 hover:underline"
              >
                {wf.workflow_name}
              </Link>
              {wf.pending_count > 0 && (
                <span className="text-[10px] bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full font-medium">
                  {wf.pending_count} pending
                </span>
              )}
            </div>
            <Link
              to={`/clm/validation/${wf.workflow_id}`}
              className="text-xs text-emerald-600 hover:text-emerald-800"
            >
              View Details →
            </Link>
          </div>
          <div className="divide-y">
            {wf.decisions.map(d => (
              <DecisionRow
                key={d.id}
                decision={d}
                onResolve={onResolve}
                resolving={resolving}
                noteMap={noteMap}
                setNoteMap={setNoteMap}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}


/* ── Workflow View — per-workflow detail ────────────────── */
function WorkflowView({ data, onResolve, resolving, noteMap, setNoteMap }) {
  const pending = data?.pending_decisions || [];
  const recent = data?.recent_decisions || [];
  const docStatus = data?.document_status || [];

  return (
    <div className="space-y-6">
      {/* Document status */}
      {docStatus.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Document Status</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {docStatus.map(ds => (
              <div key={ds.document_id} className="bg-white rounded-xl border p-3">
                <p className="text-xs font-medium text-gray-800 truncate mb-2">{ds.document_title}</p>
                <div className="flex items-center gap-2 text-[10px]">
                  {ds.approved > 0 && <span className="text-emerald-600 font-medium">✓ {ds.approved}</span>}
                  {ds.pending > 0 && <span className="text-amber-600 font-medium">⏳ {ds.pending}</span>}
                  {ds.rejected > 0 && <span className="text-red-600 font-medium">✕ {ds.rejected}</span>}
                  <span className="text-gray-400">/ {ds.total}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending decisions */}
      {pending.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">
            Pending Decisions <span className="text-amber-600">({pending.length})</span>
          </h2>
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden divide-y">
            {pending.map(d => (
              <DecisionRow
                key={d.id}
                decision={d}
                onResolve={onResolve}
                resolving={resolving}
                noteMap={noteMap}
                setNoteMap={setNoteMap}
              />
            ))}
          </div>
        </div>
      )}

      {/* Recent decisions */}
      {recent.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Recent Decisions</h2>
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden divide-y">
            {recent.map(d => (
              <DecisionRow
                key={d.id}
                decision={d}
                onResolve={onResolve}
                resolving={resolving}
                noteMap={noteMap}
                setNoteMap={setNoteMap}
                readOnly
              />
            ))}
          </div>
        </div>
      )}

      {!pending.length && !recent.length && (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">📋</p>
          <p className="text-gray-500 text-sm">No validation decisions for this workflow</p>
        </div>
      )}
    </div>
  );
}


/* ── Decision Row ──────────────────────────────────────── */
function DecisionRow({ decision: d, onResolve, resolving, noteMap, setNoteMap, readOnly }) {
  const [expanded, setExpanded] = useState(false);
  const isResolving = resolving === d.id;
  const isPending = d.status === 'pending';

  const statusBadge = {
    pending:  'bg-amber-100 text-amber-700',
    approved: 'bg-emerald-100 text-emerald-700',
    rejected: 'bg-red-100 text-red-700',
    skipped:  'bg-gray-100 text-gray-500',
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        {/* Doc info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-medium text-gray-800 truncate">{d.document_title || 'Document'}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusBadge[d.status] || 'bg-gray-100 text-gray-500'}`}>
              {d.status}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-gray-400">
            {d.node_label && <span>Node: {d.node_label}</span>}
            {d.workflow_name && <span>· {d.workflow_name}</span>}
          </div>
        </div>

        {/* Actions */}
        {isPending && !readOnly && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-gray-400 hover:text-gray-600 px-1"
            >
              {expanded ? '▲' : '▼'}
            </button>
            <button
              onClick={() => onResolve(d.id, 'approve')}
              disabled={isResolving}
              className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {isResolving ? '…' : '✓ Approve'}
            </button>
            <button
              onClick={() => onResolve(d.id, 'reject')}
              disabled={isResolving}
              className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 disabled:opacity-50 transition-colors"
            >
              ✕ Reject
            </button>
          </div>
        )}

        {/* Decided info */}
        {!isPending && d.decided_at && (
          <span className="text-[10px] text-gray-400 shrink-0">
            {new Date(d.decided_at).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Expanded: note input */}
      {expanded && isPending && (
        <div className="mt-2 pl-4">
          <input
            value={noteMap[d.id] || ''}
            onChange={(e) => setNoteMap(prev => ({ ...prev, [d.id]: e.target.value }))}
            placeholder="Optional note…"
            className="w-full px-2.5 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
          />
          {d.note && (
            <p className="text-[10px] text-gray-400 mt-1">Previous note: {d.note}</p>
          )}
        </div>
      )}
    </div>
  );
}
