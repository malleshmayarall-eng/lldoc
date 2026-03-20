import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CheckCircle, XCircle, Clock, FileText, ChevronDown,
  ChevronUp, RefreshCw, Filter, AlertCircle, Layers,
} from 'lucide-react';
import { workflowApi } from '@services/clm/clmApi';

/* ================================================================
   ApprovalPanel — /approvals
   ================================================================
   Shows all CLM validation decisions for the logged-in user.
   Fetches from /api/clm/workflows/my-validations/.
   Groups by workflow, shows document info, note field, approve/reject.
   ================================================================ */

const STATUS_CONFIG = {
  pending:  { label: 'Pending',  color: 'amber',   icon: Clock,       bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Approved', color: 'emerald',  icon: CheckCircle, bg: 'bg-emerald-50',  text: 'text-emerald-700', border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'Rejected', color: 'red',      icon: XCircle,     bg: 'bg-red-50',      text: 'text-red-700',     border: 'border-red-200', badge: 'bg-red-100 text-red-700' },
  skipped:  { label: 'Skipped',  color: 'gray',     icon: AlertCircle, bg: 'bg-gray-50',     text: 'text-gray-500',    border: 'border-gray-200', badge: 'bg-gray-100 text-gray-500' },
};

const ApprovalPanel = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [resolving, setResolving] = useState(null);
  const [noteMap, setNoteMap] = useState({});
  const [expandedRows, setExpandedRows] = useState({});
  const [reviewModal, setReviewModal] = useState(null); // decision being reviewed

  // ── Fetch data ──────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: d } = await workflowApi.myValidations({
        status: filter !== 'all' ? filter : undefined,
      });
      setData(d);
    } catch (e) {
      console.error('Failed to load validations:', e);
      setError(e.response?.data?.detail || e.message || 'Failed to load approvals');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Resolve a decision ──────────────────────────────────
  const handleResolve = async (decision, action) => {
    // Find the workflow_id for this decision
    const wfId = decision.workflow;
    if (!wfId) {
      setError('Could not determine workflow for this decision');
      return;
    }

    if (action === 'reject' && !(noteMap[decision.id] || '').trim()) {
      setError('Please add a note when rejecting');
      return;
    }

    setResolving(decision.id);
    setError(null);
    try {
      const { data: result } = await workflowApi.resolveValidation(wfId, {
        decision_id: decision.id,
        action,
        note: noteMap[decision.id] || '',
      });
      if (result.success) {
        setNoteMap(prev => { const n = { ...prev }; delete n[decision.id]; return n; });
        setReviewModal(null);
        fetchData(); // refresh
      } else {
        setError(result.error || 'Failed to resolve');
      }
    } catch (e) {
      setError(e.response?.data?.error || e.response?.data?.detail || 'Failed to resolve');
    } finally {
      setResolving(null);
    }
  };

  // ── Helpers ─────────────────────────────────────────────
  const toggleRow = (id) => setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  const summary = data?.summary || {};
  const workflows = data?.workflows || [];
  const totalPending = summary.pending || 0;
  const allDecisions = workflows.flatMap(w => (w.decisions || []).map(d => ({ ...d, _wf_name: w.workflow_name, _wf_id: w.workflow_id })));

  // ── Loading state ───────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-emerald-200 border-t-emerald-600" />
          <p className="text-sm text-gray-400">Loading approvals…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* ── Header ──────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CheckCircle className="w-6 h-6 text-emerald-600" />
            My Approvals
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {totalPending > 0
              ? `${totalPending} pending ${totalPending === 1 ? 'approval' : 'approvals'} across ${workflows.length} ${workflows.length === 1 ? 'workflow' : 'workflows'}`
              : 'No pending approvals'}
          </p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* ── Error banner ────────────────────────────────── */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 text-lg leading-none">&times;</button>
        </div>
      )}

      {/* ── Summary cards ───────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { key: 'total',    label: 'Total',    value: summary.total || 0,    color: 'gray' },
          { key: 'pending',  label: 'Pending',  value: summary.pending || 0,  color: 'amber', highlight: true },
          { key: 'approved', label: 'Approved', value: summary.approved || 0, color: 'emerald' },
          { key: 'rejected', label: 'Rejected', value: summary.rejected || 0, color: 'red' },
        ].map(c => {
          const colors = {
            gray:    'bg-gray-50 text-gray-700 border-gray-200',
            amber:   'bg-amber-50 text-amber-700 border-amber-200',
            emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
            red:     'bg-red-50 text-red-700 border-red-200',
          };
          return (
            <div key={c.key} className={`rounded-xl border p-4 ${colors[c.color]} ${c.highlight && c.value > 0 ? 'ring-2 ring-amber-300' : ''}`}>
              <p className="text-[10px] uppercase tracking-wider font-semibold opacity-60">{c.label}</p>
              <p className="text-2xl font-bold mt-1">{c.value}</p>
            </div>
          );
        })}
      </div>

      {/* ── Filter tabs ─────────────────────────────────── */}
      <div className="flex items-center gap-1 mb-5 bg-gray-100 rounded-lg p-1 w-fit">
        {['pending', 'approved', 'rejected', 'all'].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded-md text-xs font-medium transition-colors ${
              filter === s
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {s === 'all' ? 'All' : STATUS_CONFIG[s]?.label || s}
          </button>
        ))}
      </div>

      {/* ── Empty state ─────────────────────────────────── */}
      {workflows.length === 0 ? (
        <div className="bg-white rounded-xl border shadow-sm p-16 text-center">
          <CheckCircle className="w-16 h-16 text-gray-200 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {filter === 'pending' ? 'No pending approvals' : `No ${filter} approvals`}
          </h3>
          <p className="text-sm text-gray-500">
            {filter === 'pending' ? "You're all caught up!" : 'Try a different filter.'}
          </p>
        </div>
      ) : (
        /* ── Workflows + decisions ──────────────────────── */
        <div className="space-y-5">
          {workflows.map(wf => (
            <div key={wf.workflow_id} className="bg-white rounded-xl border shadow-sm overflow-hidden">
              {/* Workflow header */}
              <div className="bg-gradient-to-r from-emerald-50 to-teal-50 px-5 py-3.5 flex items-center justify-between border-b">
                <div className="flex items-center gap-3">
                  <Layers className="w-4 h-4 text-emerald-600" />
                  <div>
                    <Link
                      to={`/clm/workflows/${wf.workflow_id}`}
                      className="text-sm font-semibold text-emerald-800 hover:underline"
                    >
                      {wf.workflow_name || 'Unnamed Workflow'}
                    </Link>
                    <p className="text-[10px] text-emerald-600/70 mt-0.5">
                      {wf.decisions?.length || 0} {(wf.decisions?.length || 0) === 1 ? 'decision' : 'decisions'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {wf.pending_count > 0 && (
                    <span className="text-[10px] bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-medium">
                      {wf.pending_count} pending
                    </span>
                  )}
                  <Link
                    to={`/clm/validation/${wf.workflow_id}`}
                    className="text-xs text-emerald-600 hover:text-emerald-800 hover:underline"
                  >
                    Details →
                  </Link>
                </div>
              </div>

              {/* Decisions table */}
              <div className="divide-y">
                {(wf.decisions || []).map(d => {
                  const cfg = STATUS_CONFIG[d.status] || STATUS_CONFIG.pending;
                  const StatusIcon = cfg.icon;
                  const isExpanded = expandedRows[d.id];
                  const isPending = d.status === 'pending';
                  const isCurrentlyResolving = resolving === d.id;

                  return (
                    <div key={d.id} className={`${isPending ? 'hover:bg-gray-50/50' : ''} transition-colors`}>
                      <div className="px-5 py-3.5 flex items-center gap-4">
                        {/* Status icon */}
                        <StatusIcon className={`w-5 h-5 shrink-0 ${cfg.text}`} />

                        {/* Document info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <span className="text-sm font-medium text-gray-800 truncate">
                              {d.document_title || 'Untitled Document'}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${cfg.badge}`}>
                              {cfg.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-gray-400 ml-5">
                            {d.node_label && <span>Node: {d.node_label}</span>}
                            {d.decided_at && (
                              <span>
                                {d.status === 'approved' ? 'Approved' : d.status === 'rejected' ? 'Rejected' : 'Decided'}
                                {' '}{new Date(d.decided_at).toLocaleDateString()}
                              </span>
                            )}
                            {d.note && <span className="italic">"{d.note}"</span>}
                            {d.created_at && isPending && (
                              <span>Requested {new Date(d.created_at).toLocaleDateString()}</span>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        {isPending && (
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => toggleRow(d.id)}
                              className="p-1 text-gray-400 hover:text-gray-600"
                              title="Add note"
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => setReviewModal({ ...d, _wf_id: wf.workflow_id, _wf_name: wf.workflow_name })}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                            >
                              Review
                            </button>
                            <button
                              onClick={() => handleResolve({ ...d, workflow: wf.workflow_id }, 'approve')}
                              disabled={isCurrentlyResolving}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                            >
                              {isCurrentlyResolving ? '…' : '✓ Approve'}
                            </button>
                            <button
                              onClick={() => {
                                if (!(noteMap[d.id] || '').trim()) {
                                  toggleRow(d.id);
                                  setError('Add a note before rejecting');
                                  return;
                                }
                                handleResolve({ ...d, workflow: wf.workflow_id }, 'reject');
                              }}
                              disabled={isCurrentlyResolving}
                              className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
                            >
                              ✕ Reject
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Expanded note input */}
                      {isExpanded && isPending && (
                        <div className="px-5 pb-3 ml-9">
                          <input
                            value={noteMap[d.id] || ''}
                            onChange={(e) => setNoteMap(prev => ({ ...prev, [d.id]: e.target.value }))}
                            placeholder="Add a note (required for rejection)…"
                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Review Modal ────────────────────────────────── */}
      {reviewModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden">
            {/* Modal header */}
            <div className="bg-gradient-to-r from-emerald-50 to-teal-50 px-6 py-4 border-b">
              <h2 className="text-lg font-bold text-gray-900">Review Document</h2>
              <p className="text-sm text-gray-500 mt-0.5">{reviewModal.document_title || 'Untitled Document'}</p>
            </div>

            <div className="p-6 space-y-5">
              {/* Info grid */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500 text-xs mb-0.5">Workflow</p>
                  <p className="font-medium text-gray-800">{reviewModal._wf_name || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-0.5">Validator Node</p>
                  <p className="font-medium text-gray-800">{reviewModal.node_label || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-0.5">Status</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_CONFIG[reviewModal.status]?.badge || 'bg-gray-100 text-gray-500'}`}>
                    {STATUS_CONFIG[reviewModal.status]?.label || reviewModal.status}
                  </span>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-0.5">Requested</p>
                  <p className="font-medium text-gray-800">
                    {reviewModal.created_at ? new Date(reviewModal.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
                  </p>
                </div>
              </div>

              {/* Note input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Note <span className="text-gray-400 font-normal">(required for rejection)</span>
                </label>
                <textarea
                  value={noteMap[reviewModal.id] || ''}
                  onChange={(e) => setNoteMap(prev => ({ ...prev, [reviewModal.id]: e.target.value }))}
                  rows={3}
                  placeholder="Add your review note…"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none resize-none"
                />
              </div>

              {/* Action buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setReviewModal(null)}
                  disabled={resolving === reviewModal.id}
                  className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleResolve({ ...reviewModal, workflow: reviewModal._wf_id }, 'reject')}
                  disabled={resolving === reviewModal.id || !(noteMap[reviewModal.id] || '').trim()}
                  className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium flex items-center justify-center gap-1.5"
                >
                  <XCircle className="w-4 h-4" />
                  {resolving === reviewModal.id ? 'Rejecting…' : 'Reject'}
                </button>
                <button
                  onClick={() => handleResolve({ ...reviewModal, workflow: reviewModal._wf_id }, 'approve')}
                  disabled={resolving === reviewModal.id}
                  className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium flex items-center justify-center gap-1.5"
                >
                  <CheckCircle className="w-4 h-4" />
                  {resolving === reviewModal.id ? 'Approving…' : 'Approve'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Unread alerts badge ─────────────────────────── */}
      {data?.unread_alerts > 0 && (
        <div className="fixed bottom-6 right-6 bg-amber-500 text-white px-4 py-2.5 rounded-full shadow-lg text-sm font-medium flex items-center gap-2 animate-bounce">
          <AlertCircle className="w-4 h-4" />
          {data.unread_alerts} new notification{data.unread_alerts > 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};

export default ApprovalPanel;
