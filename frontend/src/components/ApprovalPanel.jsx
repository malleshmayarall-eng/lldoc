import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CheckCircle, XCircle, Clock, FileText, ChevronDown,
  ChevronUp, RefreshCw, AlertCircle, Layers,
  Search, Eye, Download, X, Users, Calendar,
  Inbox, CheckCheck, FileType, Info, ExternalLink,
  ChevronRight,
} from 'lucide-react';
import { workflowApi } from '@services/clm/clmApi';

const STATUS_CFG = {
  pending:  { label: 'Pending',  icon: Clock,       badge: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-400' },
  approved: { label: 'Approved', icon: CheckCircle,  badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-400' },
  rejected: { label: 'Rejected', icon: XCircle,      badge: 'bg-red-100 text-red-700',         dot: 'bg-red-400' },
  skipped:  { label: 'Skipped',  icon: AlertCircle,  badge: 'bg-gray-100 text-gray-500',       dot: 'bg-gray-400' },
};

const timeAgo = (ts) => {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  return new Date(ts).toLocaleDateString();
};

const fmtSize = (b) => {
  if (!b) return null;
  const k = 1024;
  const s = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
};

/* ---- MAIN COMPONENT ---- */
const ApprovalPanel = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [search, setSearch] = useState('');
  const [resolving, setResolving] = useState(null);
  const [noteMap, setNoteMap] = useState({});
  const [expanded, setExpanded] = useState({});
  const [selected, setSelected] = useState(new Set());
  const [panel, setPanel] = useState(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelDoc, setPanelDoc] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: d } = await workflowApi.myValidations({
        status: filter !== 'all' ? filter : undefined,
      });
      setData(d);
      const ex = {};
      (d.workflows || []).forEach(w => { ex[w.workflow_id] = true; });
      setExpanded(prev => {
        const m = { ...ex };
        Object.keys(prev).forEach(k => { if (k in m) m[k] = prev[k]; });
        return m;
      });
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleResolve = async (decision, action) => {
    const wfId = decision.workflow || decision._wfId;
    if (!wfId) { setError('Workflow ID unknown'); return; }
    if (action === 'reject' && !(noteMap[decision.id] || '').trim()) {
      setError('Please add a note when rejecting');
      return;
    }
    setResolving(decision.id);
    setError(null);
    try {
      const { data: r } = await workflowApi.resolveValidation(wfId, {
        decision_id: decision.id,
        action,
        note: noteMap[decision.id] || '',
      });
      if (r.success) {
        setNoteMap(p => { const n = { ...p }; delete n[decision.id]; return n; });
        setSelected(p => { const s = new Set(p); s.delete(decision.id); return s; });
        if (panel?.decision?.id === decision.id) { setPanel(null); setPanelDoc(null); }
        fetchData();
      } else {
        setError(r.error || 'Failed');
      }
    } catch (e) {
      setError(e.response?.data?.error || e.response?.data?.detail || 'Failed');
    } finally {
      setResolving(null);
    }
  };

  const handleBulkApprove = async () => {
    if (selected.size === 0) return;
    setError(null);
    const ids = [...selected];
    const byWf = {};
    for (const id of ids) {
      for (const wf of (data?.workflows || [])) {
        if (wf.decisions?.find(d => d.id === id)) {
          (byWf[wf.workflow_id] ??= []).push(id);
          break;
        }
      }
    }
    for (const [wfId, dIds] of Object.entries(byWf)) {
      try {
        await workflowApi.bulkResolveValidation(wfId, {
          decisions: dIds.map(id => ({ decision_id: id, action: 'approve', note: '' })),
        });
      } catch (e) {
        console.error(e);
      }
    }
    setSelected(new Set());
    fetchData();
  };

  const openDetail = async (decision, wfId, wfName) => {
    setPanel({ decision, wfId, wfName });
    setPanelLoading(true);
    setPanelDoc(null);
    try {
      if (decision.document && wfId) {
        const { data: d } = await workflowApi.documentDetail(wfId, decision.document);
        setPanelDoc(d);
      }
    } catch (e) {
      console.error('Detail load failed', e);
    } finally {
      setPanelLoading(false);
    }
  };

  const handleDownload = async (wfId, docId, title) => {
    try {
      const r = await workflowApi.downloadDocument(wfId, docId);
      const url = window.URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = title || 'document';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (_) {
      setError('Download failed');
    }
  };

  const toggleWf = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }));
  const toggleSel = (id) => {
    setSelected(p => {
      const s = new Set(p);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  };
  const selAllWf = (wf) => {
    const pend = (wf.decisions || []).filter(d => d.status === 'pending');
    setSelected(p => {
      const s = new Set(p);
      const all = pend.every(d => s.has(d.id));
      pend.forEach(d => (all ? s.delete(d.id) : s.add(d.id)));
      return s;
    });
  };

  const summary = data?.summary || {};
  const workflows = useMemo(() => {
    let wfs = data?.workflows || [];
    if (search.trim()) {
      const q = search.toLowerCase();
      wfs = wfs
        .map(w => ({
          ...w,
          decisions: (w.decisions || []).filter(d =>
            (d.document_title || '').toLowerCase().includes(q) ||
            (d.node_label || '').toLowerCase().includes(q) ||
            (w.workflow_name || '').toLowerCase().includes(q)
          ),
        }))
        .filter(w => w.decisions.length > 0);
    }
    return wfs;
  }, [data, search]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-emerald-200 border-t-emerald-600" />
          <p className="text-sm text-gray-400">Loading validations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* LEFT: MAIN LIST */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-6">

          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                </div>
                Validator Dashboard
              </h1>
              <p className="text-sm text-gray-500 mt-1.5 ml-[46px]">
                {(summary.pending || 0) > 0
                  ? (summary.pending + ' pending across ' + workflows.length + ' workflow' + (workflows.length !== 1 ? 's' : ''))
                  : 'All caught up \u2014 no pending requests!'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {selected.size > 0 && (
                <button
                  onClick={handleBulkApprove}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 shadow-sm transition-colors"
                >
                  <CheckCheck className="w-4 h-4" />
                  Approve {selected.size}
                </button>
              )}
              <button
                onClick={fetchData}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <RefreshCw className={'w-4 h-4' + (loading ? ' animate-spin' : '')} />
                Refresh
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="text-sm">{error}</span>
              </div>
              <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 text-lg">&times;</button>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { k: 'all',      l: 'Total',    v: summary.total || 0,    c: 'gray',    I: Inbox },
              { k: 'pending',  l: 'Pending',  v: summary.pending || 0,  c: 'amber',   I: Clock,       hl: true },
              { k: 'approved', l: 'Approved', v: summary.approved || 0, c: 'emerald', I: CheckCircle },
              { k: 'rejected', l: 'Rejected', v: summary.rejected || 0, c: 'red',     I: XCircle },
            ].map(function(item) {
              var active = filter === item.k;
              var cm = {
                gray:    { bg: 'bg-gray-50',    t: 'text-gray-700',    b: 'border-gray-200',    r: 'ring-gray-300' },
                amber:   { bg: 'bg-amber-50',   t: 'text-amber-700',   b: 'border-amber-200',   r: 'ring-amber-300' },
                emerald: { bg: 'bg-emerald-50',  t: 'text-emerald-700', b: 'border-emerald-200', r: 'ring-emerald-300' },
                red:     { bg: 'bg-red-50',      t: 'text-red-700',     b: 'border-red-200',     r: 'ring-red-300' },
              }[item.c];
              var IconComp = item.I;
              return (
                <button
                  key={item.k}
                  onClick={() => setFilter(item.k)}
                  className={'rounded-xl border p-4 text-left transition-all ' + cm.bg + ' ' + cm.b + ' ' +
                    (active ? 'ring-2 ' + cm.r + ' shadow-sm' : 'hover:shadow-sm') + ' ' +
                    (item.hl && item.v > 0 && !active ? 'ring-2 ring-amber-300' : '')}
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className={'text-[10px] uppercase tracking-wider font-semibold opacity-60 ' + cm.t}>{item.l}</p>
                    <IconComp className={'w-4 h-4 opacity-40 ' + cm.t} />
                  </div>
                  <p className={'text-2xl font-bold ' + cm.t}>{item.v}</p>
                </button>
              );
            })}
          </div>

          {/* Search + filter pills */}
          <div className="flex items-center gap-3 mb-5">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search documents, workflows, or nodes..."
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {['pending', 'approved', 'rejected', 'all'].map(function(s) {
                return (
                  <button
                    key={s}
                    onClick={() => setFilter(s)}
                    className={'px-3 py-1.5 rounded-md text-xs font-medium transition-colors ' +
                      (filter === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}
                  >
                    {s === 'all' ? 'All' : (STATUS_CFG[s] ? STATUS_CFG[s].label : s)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Empty state */}
          {workflows.length === 0 ? (
            <div className="bg-white rounded-2xl border shadow-sm p-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-emerald-300" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {search ? 'No matching results' : filter === 'pending' ? 'No pending approvals' : 'No ' + filter + ' items'}
              </h3>
              <p className="text-sm text-gray-500">
                {search ? 'Try a different search.' : filter === 'pending' ? "You're all caught up!" : 'Try a different filter.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {workflows.map(function(wf) {
                var isOpen = expanded[wf.workflow_id] !== false;
                var pend = (wf.decisions || []).filter(d => d.status === 'pending');
                var allSel = pend.length > 0 && pend.every(d => selected.has(d.id));

                return (
                  <div key={wf.workflow_id} className="bg-white rounded-2xl border shadow-sm overflow-hidden">
                    {/* Workflow header */}
                    <div
                      onClick={() => toggleWf(wf.workflow_id)}
                      className="bg-gradient-to-r from-emerald-50/80 to-teal-50/80 px-5 py-3.5 flex items-center justify-between border-b cursor-pointer hover:from-emerald-50 hover:to-teal-50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {isOpen
                          ? <ChevronDown className="w-4 h-4 text-emerald-600" />
                          : <ChevronRight className="w-4 h-4 text-emerald-600" />}
                        <Layers className="w-4 h-4 text-emerald-600" />
                        <div>
                          <span className="text-sm font-semibold text-emerald-800">{wf.workflow_name || 'Unnamed Workflow'}</span>
                          <span className="text-[10px] text-gray-400 ml-2">
                            {(wf.decisions ? wf.decisions.length : 0) + ' doc' + ((wf.decisions ? wf.decisions.length : 0) !== 1 ? 's' : '')}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2" onClick={function(e) { e.stopPropagation(); }}>
                        {wf.pending_count > 0 && (
                          <span className="text-[10px] bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-semibold animate-pulse">
                            {wf.pending_count} pending
                          </span>
                        )}
                        {pend.length > 0 && (
                          <button
                            onClick={() => selAllWf(wf)}
                            className={'text-[10px] px-2 py-1 rounded-md transition-colors ' +
                              (allSel ? 'bg-emerald-200 text-emerald-800' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}
                          >
                            {allSel ? 'Deselect' : 'Select All'}
                          </button>
                        )}
                        <Link
                          to={'/clm/workflows/' + wf.workflow_id}
                          className="text-xs text-emerald-600 hover:text-emerald-800 hover:underline flex items-center gap-1"
                        >
                          Open <ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>

                    {/* Decisions */}
                    {isOpen && (
                      <div className="divide-y divide-gray-100">
                        {(wf.decisions || []).map(function(d) {
                          return (
                            <DecisionRow
                              key={d.id}
                              d={d}
                              wfId={wf.workflow_id}
                              wfName={wf.workflow_name}
                              onResolve={handleResolve}
                              resolving={resolving}
                              noteMap={noteMap}
                              setNoteMap={setNoteMap}
                              isSel={selected.has(d.id)}
                              onToggleSel={() => toggleSel(d.id)}
                              onOpenDetail={() => openDetail(d, wf.workflow_id, wf.workflow_name)}
                              isDetailOpen={panel?.decision?.id === d.id}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: DOCUMENT DETAIL SLIDE-OUT */}
      {panel && (
        <DetailPanel
          decision={panel.decision}
          wfId={panel.wfId}
          wfName={panel.wfName}
          loading={panelLoading}
          doc={panelDoc}
          noteMap={noteMap}
          setNoteMap={setNoteMap}
          onResolve={handleResolve}
          resolving={resolving}
          onClose={() => { setPanel(null); setPanelDoc(null); }}
          onDownload={handleDownload}
        />
      )}
    </div>
  );
};


/* ---- DecisionRow ---- */
function DecisionRow(props) {
  var d = props.d;
  var wfId = props.wfId;
  var onResolve = props.onResolve;
  var resolving = props.resolving;
  var noteMap = props.noteMap;
  var setNoteMap = props.setNoteMap;
  var isSel = props.isSel;
  var onToggleSel = props.onToggleSel;
  var onOpenDetail = props.onOpenDetail;
  var isDetailOpen = props.isDetailOpen;

  var showNote = useState(false);
  var showNoteVal = showNote[0];
  var setShowNote = showNote[1];

  var cfg = STATUS_CFG[d.status] || STATUS_CFG.pending;
  var isPending = d.status === 'pending';
  var busy = resolving === d.id;

  return (
    <div className={'transition-colors ' + (isDetailOpen ? 'bg-emerald-50/50 border-l-2 border-l-emerald-500' : isPending ? 'hover:bg-gray-50/50' : '')}>
      <div className="px-5 py-3.5 flex items-center gap-3">
        {isPending ? (
          <label className="shrink-0">
            <input
              type="checkbox"
              checked={isSel}
              onChange={onToggleSel}
              className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
            />
          </label>
        ) : (
          <div className="w-4 shrink-0" />
        )}

        <div className={'w-2.5 h-2.5 rounded-full shrink-0 ' + cfg.dot} />

        <button onClick={onOpenDetail} className="flex-1 min-w-0 text-left group">
          <div className="flex items-center gap-2 mb-0.5">
            <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0 group-hover:text-emerald-500 transition-colors" />
            <span className="text-sm font-medium text-gray-800 truncate group-hover:text-emerald-700 transition-colors">
              {d.document_title || 'Untitled Document'}
            </span>
            <span className={'text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ' + cfg.badge}>
              {cfg.label}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-gray-400 ml-5">
            {d.node_label && (
              <span className="flex items-center gap-1">
                <Layers className="w-3 h-3" /> {d.node_label}
              </span>
            )}
            {d.created_at && (
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" /> {timeAgo(d.created_at)}
              </span>
            )}
            {d.assigned_to_name && (
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" /> {d.assigned_to_name}
              </span>
            )}
          </div>
        </button>

        <button
          onClick={onOpenDetail}
          title="View document details"
          className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors shrink-0"
        >
          <Eye className="w-4 h-4" />
        </button>

        {isPending && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setShowNote(!showNoteVal)}
              title="Add note"
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {showNoteVal ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            <button
              onClick={() => onResolve({ ...d, workflow: wfId }, 'approve')}
              disabled={busy}
              className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 shadow-sm transition-colors"
            >
              {busy ? '...' : 'Approve'}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                if (!(noteMap[d.id] || '').trim()) { setShowNote(true); return; }
                onResolve({ ...d, workflow: wfId }, 'reject');
              }}
              className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
            >
              Reject
            </button>
          </div>
        )}

        {!isPending && d.decided_at && (
          <span className="text-[10px] text-gray-400 shrink-0">
            {d.status === 'approved' ? '\u2713' : '\u2715'} {new Date(d.decided_at).toLocaleDateString()}
          </span>
        )}
      </div>

      {showNoteVal && isPending && (
        <div className="px-5 pb-3 ml-[42px]">
          <input
            value={noteMap[d.id] || ''}
            onChange={e => setNoteMap(p => ({ ...p, [d.id]: e.target.value }))}
            placeholder="Add a note (required for rejection)..."
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
            onKeyDown={e => {
              if (e.key === 'Enter' && (noteMap[d.id] || '').trim()) {
                onResolve({ ...d, workflow: wfId }, 'approve');
              }
            }}
          />
        </div>
      )}
    </div>
  );
}


/* ---- DetailPanel ---- */
function DetailPanel(props) {
  var decision = props.decision;
  var wfId = props.wfId;
  var wfName = props.wfName;
  var loading = props.loading;
  var doc = props.doc;
  var noteMap = props.noteMap;
  var setNoteMap = props.setNoteMap;
  var onResolve = props.onResolve;
  var resolving = props.resolving;
  var onClose = props.onClose;
  var onDownload = props.onDownload;

  var isPending = decision.status === 'pending';
  var busy = resolving === decision.id;
  var cfg = STATUS_CFG[decision.status] || STATUS_CFG.pending;
  var fields = (doc && doc.fields) || (doc && doc.extracted_fields) || [];
  var fileType = ((doc && doc.file_type) || (doc && doc.extension) || '').toLowerCase();
  var uploaded = (doc && doc.uploaded_at) || (doc && doc.created_at) || decision.created_at;
  var pageCount = doc && (doc.page_count || doc.pages);
  var fileSize = doc && doc.file_size;
  var source = (doc && doc.source) || (doc && doc.upload_source) || 'manual';

  return (
    <div className="w-[480px] border-l border-gray-200 bg-white flex flex-col h-full shadow-xl" style={{animation: 'slideIn .2s ease-out'}}>
      {/* header */}
      <div className="bg-gradient-to-r from-emerald-50 to-teal-50 px-5 py-4 border-b flex items-start justify-between shrink-0">
        <div className="flex-1 min-w-0 mr-3">
          <h2 className="text-base font-bold text-gray-900 truncate">
            {decision.document_title || 'Untitled Document'}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
            <Layers className="w-3 h-3" /> {wfName || 'Workflow'}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-white/60 rounded-lg transition-colors shrink-0"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* scrollable body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-emerald-200 border-t-emerald-600" />
          </div>
        ) : (
          <div className="p-5 space-y-5">

            {/* quick info grid */}
            <div className="grid grid-cols-2 gap-3">
              <InfoCard label="Status">
                <span className={'text-xs px-2 py-0.5 rounded-full font-medium ' + cfg.badge}>{cfg.label}</span>
              </InfoCard>
              <InfoCard label="Validator Node">
                <span className="text-sm font-medium text-gray-800">{decision.node_label || 'N/A'}</span>
              </InfoCard>
              <InfoCard label="Requested">
                <span className="text-sm text-gray-700">
                  {decision.created_at
                    ? new Date(decision.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : '\u2014'}
                </span>
              </InfoCard>
              <InfoCard label="Assigned To">
                <span className="text-sm text-gray-700">{decision.assigned_to_name || 'You'}</span>
              </InfoCard>
            </div>

            {/* upload / file info */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5" /> Document Upload Info
              </h3>
              <div className="space-y-2 text-sm">
                {fileType && (
                  <InfoRow label="File Type">
                    <span className="uppercase flex items-center gap-1.5">
                      <FileType className="w-3.5 h-3.5 text-gray-400" /> {fileType}
                    </span>
                  </InfoRow>
                )}
                {uploaded && (
                  <InfoRow label="Uploaded">
                    {new Date(uploaded).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </InfoRow>
                )}
                {fileSize && <InfoRow label="Size">{fmtSize(fileSize)}</InfoRow>}
                {pageCount && <InfoRow label="Pages">{pageCount}</InfoRow>}
                <InfoRow label="Source"><span className="capitalize">{source}</span></InfoRow>
                {doc && doc.original_filename && (
                  <InfoRow label="Original File">
                    <span className="truncate max-w-[200px] inline-block align-bottom">{doc.original_filename}</span>
                  </InfoRow>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                {decision.document && (
                  <button
                    onClick={() => onDownload(wfId, decision.document, decision.document_title)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-100 rounded-lg hover:bg-emerald-200 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" /> Download
                  </button>
                )}
                <Link
                  to={'/clm/documents/' + wfId + '/' + decision.document}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-100 rounded-lg hover:bg-blue-200 transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" /> View Full
                </Link>
              </div>
            </div>

            {/* extracted fields */}
            {fields.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Extracted Fields ({fields.length})
                </h3>
                <div className="bg-gray-50 rounded-xl divide-y divide-gray-200 overflow-hidden">
                  {fields.slice(0, 10).map(function(f, i) {
                    return (
                      <div key={f.id || i} className="px-4 py-2.5 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-gray-600">{f.field_name || f.name || f.key}</p>
                          <p className="text-sm text-gray-900 truncate">{f.value || f.field_value || '\u2014'}</p>
                        </div>
                        {f.confidence != null && (
                          <span className={'text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ' +
                            (f.confidence >= 0.8 ? 'bg-emerald-100 text-emerald-700' :
                            f.confidence >= 0.5 ? 'bg-amber-100 text-amber-700' :
                            'bg-red-100 text-red-700')}>
                            {Math.round(f.confidence * 100)}%
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {fields.length > 10 && (
                    <div className="px-4 py-2 text-center">
                      <Link to={'/clm/documents/' + wfId + '/' + decision.document} className="text-xs text-emerald-600 hover:underline">
                        View all {fields.length} fields
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* metadata */}
            {doc && doc.custom_metadata && Object.keys(doc.custom_metadata).length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Metadata</h3>
                <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
                  {Object.entries(doc.custom_metadata).slice(0, 6).map(function(entry) {
                    var k = entry[0];
                    var v = entry[1];
                    return (
                      <InfoRow key={k} label={k} small>
                        <span className="truncate max-w-[200px] inline-block align-bottom">
                          {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                        </span>
                      </InfoRow>
                    );
                  })}
                </div>
              </div>
            )}

            {/* previous note */}
            {decision.note && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <p className="text-xs font-semibold text-amber-700 mb-1">Previous Note</p>
                <p className="text-sm text-amber-800">{decision.note}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* footer: actions */}
      {isPending && (
        <div className="border-t bg-white px-5 py-4 space-y-3 shrink-0">
          <textarea
            value={noteMap[decision.id] || ''}
            rows={2}
            onChange={e => setNoteMap(p => ({ ...p, [decision.id]: e.target.value }))}
            placeholder="Add your review note (required for rejection)..."
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none resize-none"
          />
          <div className="flex gap-2">
            <button
              disabled={busy || !(noteMap[decision.id] || '').trim()}
              onClick={() => onResolve({ ...decision, workflow: wfId }, 'reject')}
              className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium flex items-center justify-center gap-1.5 transition-colors"
            >
              <XCircle className="w-4 h-4" />
              {busy ? 'Rejecting...' : 'Reject'}
            </button>
            <button
              disabled={busy}
              onClick={() => onResolve({ ...decision, workflow: wfId }, 'approve')}
              className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium flex items-center justify-center gap-1.5 shadow-sm transition-colors"
            >
              <CheckCircle className="w-4 h-4" />
              {busy ? 'Approving...' : 'Approve'}
            </button>
          </div>
        </div>
      )}

      {!isPending && (
        <div className="border-t bg-gray-50 px-5 py-3 shrink-0">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Decision</span>
            <span className={'px-2 py-0.5 rounded-full text-xs font-medium ' + cfg.badge}>
              {cfg.label}
              {decision.decided_at ? (' \u00B7 ' + new Date(decision.decided_at).toLocaleDateString()) : ''}
            </span>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: '@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }'}} />
    </div>
  );
}


/* ---- Tiny helpers ---- */
function InfoCard(props) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-1">{props.label}</p>
      {props.children}
    </div>
  );
}

function InfoRow(props) {
  return (
    <div className={'flex items-center justify-between ' + (props.small ? 'text-xs' : 'text-sm')}>
      <span className="text-gray-500">{props.label}</span>
      <span className="font-medium text-gray-800">{props.children}</span>
    </div>
  );
}


export default ApprovalPanel;
