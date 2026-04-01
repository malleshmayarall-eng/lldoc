import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { workflowApi } from '@services/clm/clmApi';
import notify from '@utils/clm/clmNotify';
import { Spinner } from '@components/clm/ui/SharedUI';

/* ================================================================
   ValidationDashboard — Global + Per-Workflow Validation View
   ================================================================
   /validation          → Global: all pending decisions (card list)
   /validation/:wfId    → Per-workflow: split-pane document reviewer
                           with doc preview on left, approve/reject nav
   ================================================================ */
export default function ValidationDashboard() {
  const { workflowId } = useParams();
  const isGlobal = !workflowId;

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [resolving, setResolving] = useState(null);
  const [noteMap, setNoteMap] = useState({});

  // Per-workflow doc viewer state
  const [selectedDecisionIdx, setSelectedDecisionIdx] = useState(0);
  const [docDetail, setDocDetail] = useState(null);
  const [docLoading, setDocLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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

  // All decisions (pending first, then recent) for the per-workflow view
  const allDecisions = useMemo(() => {
    if (isGlobal || !data) return [];
    const pending = data.pending_decisions || [];
    const recent = data.recent_decisions || [];
    return [...pending, ...recent];
  }, [data, isGlobal]);

  const selectedDecision = allDecisions[selectedDecisionIdx] || null;

  // Fetch document detail when selection changes
  useEffect(() => {
    if (!selectedDecision || !workflowId || isGlobal) return;
    const docId = selectedDecision.document;
    if (!docId) return;

    setDocLoading(true);
    setDocDetail(null);
    workflowApi.documentDetail(workflowId, docId)
      .then(({ data: d }) => setDocDetail(d))
      .catch((e) => {
        console.error('Failed to load document detail:', e);
        setDocDetail(null);
      })
      .finally(() => setDocLoading(false));
  }, [selectedDecision?.id, workflowId, isGlobal]);

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
        // Auto-advance to next pending decision
        if (!isGlobal) {
          const nextPendingIdx = allDecisions.findIndex(
            (d, i) => i > selectedDecisionIdx && d.status === 'pending'
          );
          if (nextPendingIdx >= 0) {
            setSelectedDecisionIdx(nextPendingIdx);
          }
        }
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

  const handleBulkResolve = async (action) => {
    const pendingIds = allDecisions.filter(d => d.status === 'pending').map(d => d.id);
    if (!pendingIds.length) return;
    if (!window.confirm(`${action === 'approve' ? 'Approve' : 'Reject'} all ${pendingIds.length} pending documents?`)) return;

    setResolving('bulk');
    try {
      await workflowApi.bulkResolveValidation(workflowId, {
        decision_ids: pendingIds,
        action,
        note: '',
      });
      notify.success(`All ${pendingIds.length} documents ${action}d`);
      fetchData();
    } catch (e) {
      notify.error(e.response?.data?.error || 'Bulk action failed');
    } finally {
      setResolving(null);
    }
  };

  // Keyboard nav for per-workflow view
  useEffect(() => {
    if (isGlobal || !allDecisions.length) return;
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        setSelectedDecisionIdx(i => Math.max(0, i - 1));
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        setSelectedDecisionIdx(i => Math.min(allDecisions.length - 1, i + 1));
      } else if (e.key === 'a' && selectedDecision?.status === 'pending') {
        e.preventDefault();
        handleResolve(selectedDecision.id, 'approve');
      } else if (e.key === 'r' && selectedDecision?.status === 'pending') {
        e.preventDefault();
        handleResolve(selectedDecision.id, 'reject');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isGlobal, allDecisions, selectedDecisionIdx, selectedDecision]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner size="lg" className="text-emerald-500" />
      </div>
    );
  }

  const summary = data?.summary || {};

  // ── Global View (card-based) ──
  if (isGlobal) {
    return (
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              ✅ My Validations
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Documents pending your approval across all workflows
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

        <GlobalView
          workflows={data?.workflows || []}
          onResolve={handleResolve}
          resolving={resolving}
          noteMap={noteMap}
          setNoteMap={setNoteMap}
        />
      </div>
    );
  }

  // ── Per-Workflow Split-Pane View ──
  const pendingCount = allDecisions.filter(d => d.status === 'pending').length;

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col bg-gray-50">
      {/* ── Top Action Bar ── */}
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center justify-between shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-3">
          <Link to="/clm/validation" className="text-gray-400 hover:text-gray-600 transition-colors text-sm">
            ← All Validations
          </Link>
          <div className="h-4 w-px bg-gray-200" />
          <h1 className="text-sm font-semibold text-gray-800 truncate max-w-[300px]">
            Workflow Validation
          </h1>
          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">
              {pendingCount} pending
            </span>
            <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">
              {allDecisions.length} total
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Document nav */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setSelectedDecisionIdx(i => Math.max(0, i - 1))}
              disabled={selectedDecisionIdx === 0}
              className="p-1.5 rounded-md hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Previous (↑ or K)"
            >
              <svg className="w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <span className="text-[11px] font-mono text-gray-500 px-1.5 min-w-[3rem] text-center">
              {selectedDecisionIdx + 1} / {allDecisions.length}
            </span>
            <button
              onClick={() => setSelectedDecisionIdx(i => Math.min(allDecisions.length - 1, i + 1))}
              disabled={selectedDecisionIdx >= allDecisions.length - 1}
              className="p-1.5 rounded-md hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Next (↓ or J)"
            >
              <svg className="w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>

          <div className="h-5 w-px bg-gray-200" />

          {/* Quick approve/reject for current */}
          {selectedDecision?.status === 'pending' && (
            <>
              <button
                onClick={() => handleResolve(selectedDecision.id, 'approve')}
                disabled={resolving === selectedDecision.id}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm"
                title="Approve (A)"
              >
                {resolving === selectedDecision.id ? (
                  <Spinner size="xs" className="text-white" />
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                )}
                Approve
              </button>
              <button
                onClick={() => handleResolve(selectedDecision.id, 'reject')}
                disabled={resolving === selectedDecision.id}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-100 disabled:opacity-50 transition-colors border border-red-200"
                title="Reject (R)"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                Reject
              </button>
            </>
          )}

          {selectedDecision?.status === 'approved' && (
            <span className="flex items-center gap-1 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-medium border border-emerald-200">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              Approved
            </span>
          )}

          {selectedDecision?.status === 'rejected' && (
            <span className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium border border-red-200">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              Rejected
            </span>
          )}

          <div className="h-5 w-px bg-gray-200" />

          {/* Bulk actions */}
          {pendingCount > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleBulkResolve('approve')}
                disabled={resolving === 'bulk'}
                className="px-3 py-1.5 text-[10px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50 transition-colors"
              >
                Approve All ({pendingCount})
              </button>
              <button
                onClick={() => handleBulkResolve('reject')}
                disabled={resolving === 'bulk'}
                className="px-3 py-1.5 text-[10px] font-medium text-red-500 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
              >
                Reject All
              </button>
            </div>
          )}

          <button onClick={fetchData} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600" title="Refresh">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
        </div>
      </div>

      {/* ── Main Split Pane ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── Left: Document sidebar ── */}
        <div className={`bg-white border-r border-gray-200 flex flex-col shrink-0 transition-all duration-200 ${sidebarCollapsed ? 'w-12' : 'w-72'}`}>
          {/* Sidebar header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100 shrink-0">
            {!sidebarCollapsed && (
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Documents</span>
            )}
            <button
              onClick={() => setSidebarCollapsed(c => !c)}
              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <svg className={`w-3.5 h-3.5 transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </div>

          {/* Document list */}
          <div className="flex-1 overflow-y-auto">
            {allDecisions.map((d, idx) => {
              const isSelected = idx === selectedDecisionIdx;
              const statusColor = {
                pending: 'bg-amber-400',
                approved: 'bg-emerald-400',
                rejected: 'bg-red-400',
                skipped: 'bg-gray-300',
              }[d.status] || 'bg-gray-300';

              if (sidebarCollapsed) {
                return (
                  <button
                    key={d.id}
                    onClick={() => setSelectedDecisionIdx(idx)}
                    className={`w-full flex items-center justify-center py-3 transition-colors ${
                      isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                    title={d.document_title || 'Document'}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${statusColor} ${isSelected ? 'ring-2 ring-blue-400 ring-offset-1' : ''}`} />
                  </button>
                );
              }

              return (
                <button
                  key={d.id}
                  onClick={() => setSelectedDecisionIdx(idx)}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-50 transition-all group ${
                    isSelected
                      ? 'bg-blue-50 border-l-2 border-l-blue-500'
                      : 'hover:bg-gray-50 border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${statusColor}`} />
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs font-medium truncate ${isSelected ? 'text-blue-800' : 'text-gray-800'}`}>
                        {d.document_title || 'Untitled Document'}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                          d.status === 'pending' ? 'bg-amber-100 text-amber-600' :
                          d.status === 'approved' ? 'bg-emerald-100 text-emerald-600' :
                          d.status === 'rejected' ? 'bg-red-100 text-red-600' :
                          'bg-gray-100 text-gray-400'
                        }`}>
                          {d.status}
                        </span>
                        {d.node_label && (
                          <span className="text-[9px] text-gray-400 truncate">{d.node_label}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}

            {allDecisions.length === 0 && (
              <div className="px-4 py-12 text-center">
                <p className="text-3xl mb-2">📋</p>
                <p className="text-xs text-gray-400">No decisions</p>
              </div>
            )}
          </div>

          {/* Keyboard shortcut hint */}
          {!sidebarCollapsed && (
            <div className="px-3 py-2 border-t border-gray-100 bg-gray-50/50 shrink-0">
              <p className="text-[9px] text-gray-400 leading-relaxed">
                <span className="font-mono bg-gray-200 px-1 rounded">↑↓</span> navigate &nbsp;
                <span className="font-mono bg-gray-200 px-1 rounded">A</span> approve &nbsp;
                <span className="font-mono bg-gray-200 px-1 rounded">R</span> reject
              </p>
            </div>
          )}
        </div>

        {/* ── Center: Document Preview ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedDecision ? (
            <>
              {/* Document info strip */}
              <div className="bg-white border-b border-gray-100 px-5 py-2.5 flex items-center justify-between shrink-0">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-gray-900 truncate">
                    {selectedDecision.document_title || 'Document'}
                  </h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    {selectedDecision.node_label && (
                      <span className="text-[10px] text-gray-400">Node: {selectedDecision.node_label}</span>
                    )}
                    {selectedDecision.assigned_to_name && (
                      <span className="text-[10px] text-gray-400">· Assigned to: {selectedDecision.assigned_to_name}</span>
                    )}
                    {selectedDecision.created_at && (
                      <span className="text-[10px] text-gray-400">· {new Date(selectedDecision.created_at).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>

                {/* Note input for pending */}
                {selectedDecision.status === 'pending' && (
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    <input
                      value={noteMap[selectedDecision.id] || ''}
                      onChange={(e) => setNoteMap(prev => ({ ...prev, [selectedDecision.id]: e.target.value }))}
                      placeholder="Add a note…"
                      className="w-56 px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                    />
                  </div>
                )}

                {selectedDecision.status !== 'pending' && selectedDecision.note && (
                  <div className="text-xs text-gray-500 italic ml-4 shrink-0 max-w-[200px] truncate" title={selectedDecision.note}>
                    Note: {selectedDecision.note}
                  </div>
                )}
              </div>

              {/* Document content */}
              <div className="flex-1 overflow-auto bg-gray-50">
                {docLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <Spinner size="lg" className="text-blue-400" />
                      <p className="text-xs text-gray-400 mt-3">Loading document…</p>
                    </div>
                  </div>
                ) : docDetail ? (
                  <DocumentPreview
                    docDetail={docDetail}
                    workflowId={workflowId}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <p className="text-4xl mb-3">📄</p>
                      <p className="text-sm text-gray-400">Could not load document preview</p>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <p className="text-4xl mb-3">📋</p>
                <p className="text-sm text-gray-500">Select a document to review</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


/* ── Document Preview Panel ─────────────────────────────── */
function DocumentPreview({ docDetail, workflowId }) {
  const [viewMode, setViewMode] = useState('text');
  const doc = docDetail?.document;
  const fields = docDetail?.fields;
  const journey = docDetail?.journey;
  const textStats = docDetail?.text_stats;

  if (!doc) return null;

  const hasText = (doc.original_text || doc.direct_text || doc.ocr_text || '').length > 0;
  const hasFile = !!doc.file;
  const hasFields = (fields?.global?.length || 0) + (fields?.workflow?.length || 0) > 0;

  return (
    <div className="h-full flex flex-col">
      {/* View mode tabs */}
      <div className="bg-white border-b border-gray-100 px-4 py-1.5 flex items-center gap-1 shrink-0">
        {hasText && (
          <button
            onClick={() => setViewMode('text')}
            className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
              viewMode === 'text' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            📝 Text Content
          </button>
        )}
        {hasFields && (
          <button
            onClick={() => setViewMode('metadata')}
            className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
              viewMode === 'metadata' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            🏷️ Extracted Fields
          </button>
        )}
        {hasFile && (
          <button
            onClick={() => setViewMode('file')}
            className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
              viewMode === 'file' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            📎 Original File
          </button>
        )}
        {journey && (
          <button
            onClick={() => setViewMode('journey')}
            className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
              viewMode === 'journey' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            🗺️ Journey
          </button>
        )}

        <div className="flex-1" />

        {/* File info */}
        <div className="flex items-center gap-2 text-[10px] text-gray-400">
          {doc.file_type && (
            <span className="uppercase font-medium bg-gray-100 px-1.5 py-0.5 rounded">{doc.file_type}</span>
          )}
          {doc.file_size > 0 && <span>{(doc.file_size / 1024).toFixed(0)} KB</span>}
          {textStats?.text_source && textStats.text_source !== 'none' && (
            <span className="bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded capitalize">{textStats.text_source}</span>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'text' && (
          <div className="max-w-4xl mx-auto px-6 py-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-600">{doc.title}</span>
                <span className="text-[10px] text-gray-400">
                  {(doc.original_text || doc.direct_text || '').length.toLocaleString()} chars
                </span>
              </div>
              <div className="px-5 py-4">
                <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                  {doc.original_text || doc.direct_text || doc.ocr_text || 'No text content available'}
                </pre>
              </div>
            </div>
          </div>
        )}

        {viewMode === 'metadata' && (
          <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">
            {doc.extracted_metadata && Object.keys(doc.extracted_metadata).length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 bg-violet-50 border-b border-gray-100">
                  <span className="text-xs font-semibold text-violet-700">Extracted Metadata</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {Object.entries(doc.extracted_metadata).map(([key, val]) => (
                    <div key={key} className="flex items-start gap-3 px-4 py-2.5">
                      <span className="text-[10px] font-mono text-violet-600 bg-violet-50 px-2 py-0.5 rounded shrink-0 mt-0.5">
                        {key}
                      </span>
                      <div className="text-sm text-gray-700 break-words min-w-0">
                        {typeof val === 'object' ? (
                          <pre className="text-xs text-gray-600 bg-gray-50 p-2 rounded-lg">{JSON.stringify(val, null, 2)}</pre>
                        ) : (
                          String(val)
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {fields?.global?.length > 0 && (
              <FieldTable title="Global Fields" fields={fields.global} />
            )}
            {fields?.workflow?.length > 0 && (
              <FieldTable title="Workflow Fields" fields={fields.workflow} />
            )}

            {doc.overall_confidence != null && (
              <div className="bg-white rounded-xl border p-4 flex items-center gap-4">
                <span className="text-xs font-semibold text-gray-600">Overall Confidence</span>
                <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      doc.overall_confidence >= 0.8 ? 'bg-emerald-500' :
                      doc.overall_confidence >= 0.5 ? 'bg-amber-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${(doc.overall_confidence * 100).toFixed(0)}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-gray-600">{(doc.overall_confidence * 100).toFixed(0)}%</span>
              </div>
            )}
          </div>
        )}

        {viewMode === 'file' && (
          <div className="h-full flex items-center justify-center p-6">
            {doc.file_type === 'pdf' ? (
              <iframe
                src={doc.file}
                className="w-full h-full rounded-xl border border-gray-200 shadow-sm bg-white"
                title={doc.title}
              />
            ) : (
              <div className="text-center">
                <p className="text-4xl mb-3">📎</p>
                <p className="text-sm font-medium text-gray-700 mb-2">{doc.title}</p>
                <p className="text-xs text-gray-400 mb-4">
                  {doc.file_type?.toUpperCase()} · {doc.file_size > 0 ? `${(doc.file_size / 1024).toFixed(0)} KB` : 'Unknown size'}
                </p>
                <a
                  href={`/api/clm/workflows/${workflowId}/download-document/${doc.id}/`}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
                  download
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  Download File
                </a>
              </div>
            )}
          </div>
        )}

        {viewMode === 'journey' && journey && (
          <div className="max-w-4xl mx-auto px-6 py-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 bg-blue-50 border-b border-gray-100 flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-700">Workflow Journey</span>
                <span className="text-[10px] text-blue-500">
                  {journey.reached_output ? '✓ Reached output' : '⏳ In progress'}
                </span>
              </div>
              <div className="p-4 space-y-2">
                {journey.steps?.map((step, i) => (
                  <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${
                    step.passed ? 'bg-emerald-50' : 'bg-gray-50'
                  }`}>
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      step.passed ? 'bg-emerald-500 text-white' : 'bg-gray-300 text-gray-600'
                    }`}>
                      {step.passed ? '✓' : i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800">{step.label || step.node_type}</p>
                      <p className="text-[10px] text-gray-400 capitalize">{step.node_type}</p>
                    </div>
                    {step.ai_result && (
                      <span className="text-[9px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded font-medium">
                        AI: {step.ai_result.status}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


/* ── Field Table ──────────────────────────────────────────── */
function FieldTable({ title, fields }) {
  if (!fields?.length) return null;
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
        <span className="text-xs font-semibold text-gray-600">{title}</span>
        <span className="text-[10px] text-gray-400 ml-2">({fields.length})</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50/50">
              <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2">Field</th>
              <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2">Value</th>
              <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2 w-20">Confidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {fields.map(f => (
              <tr key={f.id} className="hover:bg-gray-50/50">
                <td className="px-4 py-2 text-xs font-medium text-gray-700">{f.field_name || f.key}</td>
                <td className="px-4 py-2 text-xs text-gray-600 max-w-[300px] truncate">{String(f.value ?? '')}</td>
                <td className="px-4 py-2">
                  {f.confidence != null && (
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      f.confidence >= 0.8 ? 'bg-emerald-50 text-emerald-600' :
                      f.confidence >= 0.5 ? 'bg-amber-50 text-amber-600' :
                      'bg-red-50 text-red-600'
                    }`}>
                      {(f.confidence * 100).toFixed(0)}%
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
              className="text-xs text-emerald-600 hover:text-emerald-800 font-medium"
            >
              Open Review →
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


/* ── Decision Row (for global view) ────────────────────── */
function DecisionRow({ decision: d, onResolve, resolving, noteMap, setNoteMap }) {
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

        {isPending && (
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

        {!isPending && d.decided_at && (
          <span className="text-[10px] text-gray-400 shrink-0">
            {new Date(d.decided_at).toLocaleDateString()}
          </span>
        )}
      </div>

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
