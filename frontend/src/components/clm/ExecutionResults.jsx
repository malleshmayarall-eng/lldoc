import React, { useState, useMemo } from 'react';
import { getDocumentFileUrl, workflowApi, triggerBlobDownload } from '@services/clm/clmApi';
import { ConfidenceBar, EmptyState, Spinner, Modal } from '@components/clm/ui/SharedUI';
import notify from '@utils/clm/clmNotify';
import {
  Download, CheckCircle2, XCircle, FileText,
  ChevronDown, ChevronRight,
  Zap, AlertTriangle, RotateCcw, Edit3,
  Clock, RefreshCw, Search, ExternalLink,
  Activity, Eye, PlayCircle, Archive, FileOutput,
} from 'lucide-react';

const Dot = () => <span className="w-[3px] h-[3px] rounded-full bg-gray-300 shrink-0 inline-block" />;

function Pill({ children, color = 'gray' }) {
  const c = {
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    amber: 'bg-amber-50 text-amber-600 border-amber-200',
    red: 'bg-red-50 text-red-600 border-red-200',
    sky: 'bg-sky-50 text-sky-600 border-sky-200',
    gray: 'bg-gray-50 text-gray-500 border-gray-200',
    purple: 'bg-purple-50 text-purple-600 border-purple-200',
  };
  return <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold border ${c[color] || c.gray} capitalize`}>{children}</span>;
}


/* ═══════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════ */
export default function ExecutionResults({
  result, nodes, executing, workflowId,
  executionHistory = [], onRefreshHistory,
}) {
  const [retryModal, setRetryModal]             = useState(null);
  const [overrideData, setOverrideData]         = useState({});
  const [retrying, setRetrying]                 = useState(false);
  const [showHistory, setShowHistory]           = useState(false);
  const [loadingExec, setLoadingExec]           = useState(false);
  const [loadedResult, setLoadedResult]         = useState(null);
  const [docSearch, setDocSearch]               = useState('');
  const [downloading, setDownloading]           = useState(null); // 'zip' | 'pdf' | null

  const loadExecution = async (execId) => {
    setLoadingExec(true);
    try {
      const { data } = await workflowApi.executionDetail(workflowId, execId);
      if (data.result_data && Object.keys(data.result_data).length > 0)
        setLoadedResult(data.result_data);
    } catch { notify.error('Failed to load execution'); }
    finally { setLoadingExec(false); }
  };

  const activeResult = result || loadedResult;

  /* ── Executing ── */
  if (executing) return (
    <div className="flex-1 flex flex-col items-center justify-center py-24">
      <div className="relative mb-5">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
          <Activity size={22} className="text-white animate-pulse" />
        </div>
        <div className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-400 rounded-full animate-ping" />
      </div>
      <p className="text-[13px] font-semibold text-gray-800">Running pipeline…</p>
      <p className="text-[11px] text-gray-400 mt-1">Processing documents through nodes</p>
    </div>
  );

  /* ── No result ── */
  if (!activeResult) {
    if (executionHistory.length > 0) return (
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="rounded-2xl bg-white border border-gray-100 p-10 text-center">
          <PlayCircle size={28} className="text-gray-200 mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-[13px] font-medium text-gray-600 mb-0.5">No active run</p>
          <p className="text-[11px] text-gray-400">Pick a past execution below</p>
        </div>
        <HistorySection history={executionHistory} load={loadExecution} loading={loadingExec} refresh={onRefreshHistory} defaultOpen />
      </div>
    );
    return <EmptyState icon="▶️" title="No results yet" description="Execute the workflow to process documents" />;
  }

  /* ── Derived ── */
  const nodeResults     = activeResult.node_results || [];
  const outputDocuments = activeResult.output_documents || [];
  const executionTime   = activeResult.duration_ms || activeResult.execution_time;
  const smartMeta       = activeResult.smart_meta || null;
  const skippedCount    = activeResult.skipped_documents || 0;
  const nrl = Array.isArray(nodeResults) ? nodeResults : Object.entries(nodeResults).map(([id, r]) => ({ node_id: id, ...r }));

  /* Build all docs from output + node_results */
  const allDocs = (() => {
    const m = {};
    (outputDocuments || []).forEach(d => {
      m[String(d.id)] = {
        id: String(d.id), title: d.title, file_type: d.file_type,
        file_size: d.file_size, overall_confidence: d.overall_confidence,
        file: d.file, global_metadata: d.global_metadata,
        extracted_metadata: d.extracted_metadata, isOutput: true,
        executionStatus: d.execution_status || 'executed',
      };
    });
    (nrl || []).forEach(nr => {
      (nr.document_ids || []).forEach(id => { if (!m[id]) m[id] = { id, title: null, isOutput: false, executionStatus: 'executed' }; });
      if (nr.ai?.results) nr.ai.results.forEach(r => { const d = String(r.document_id); if (!m[d]) m[d] = { id: d, title: r.document_title, isOutput: false, executionStatus: 'executed' }; else if (!m[d].title && r.document_title) m[d].title = r.document_title; });
      if (nr.action?.results) nr.action.results.forEach(r => { const d = String(r.document_id); if (!m[d]) m[d] = { id: d, title: r.document_title, isOutput: false, executionStatus: 'executed' }; else if (!m[d].title && r.document_title) m[d].title = r.document_title; });
    });
    return Object.values(m).map(d => ({ ...d, title: d.title || `Doc ${d.id.slice(0, 8)}…` }));
  })();

  const passedDocs = allDocs.filter(d => d.isOutput);
  const executedDocs = passedDocs.filter(d => d.executionStatus === 'executed');
  const unchangedDocs = passedDocs.filter(d => d.executionStatus === 'unchanged');
  const filteredDocs = allDocs.filter(d => !d.isOutput);

  const searchedDocs = docSearch.trim()
    ? passedDocs.filter(d => d.title.toLowerCase().includes(docSearch.toLowerCase()))
    : passedDocs;

  const handleRetry = async (resultId, overrides) => {
    setRetrying(true);
    try {
      const { data } = await workflowApi.actionRetry(workflowId, { result_id: resultId, override_data: overrides });
      data.success ? notify.success(data.message || 'Retried') : notify.error(data.message || 'Failed');
      setRetryModal(null);
    } catch (e) { notify.error('Retry failed: ' + (e.response?.data?.error || e.message)); }
    finally { setRetrying(false); }
  };

  /* ── Bulk download (ZIP / Merged PDF) via output node ── */
  const outputNode = nodes.find(n => n.node_type === 'output');

  const handleBulkDownload = async (format) => {
    if (!outputNode || !workflowId) return;
    setDownloading(format);
    try {
      const res = await workflowApi.nodeDownload(workflowId, outputNode.id, format);
      triggerBlobDownload(res, format === 'pdf' ? 'merged_documents.pdf' : 'documents.zip');
      notify.success(format === 'pdf' ? 'Merged PDF downloaded' : 'ZIP downloaded');
    } catch (e) {
      const msg = e.response?.status === 404 ? 'No files to download' : (e.response?.data?.error || e.message);
      notify.error('Download failed: ' + msg);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-4">

      {/* ═══ Execution Status Banner ═══ */}
      {smartMeta && (
        <div className={`rounded-2xl border p-3.5 ${
          smartMeta.nodes_changed
            ? 'bg-amber-50/80 border-amber-200'
            : skippedCount > 0
              ? 'bg-sky-50/80 border-sky-200'
              : activeResult.message
                ? 'bg-gray-50/80 border-gray-200'
                : 'bg-emerald-50/80 border-emerald-200'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm">
                {smartMeta.nodes_changed ? '⚠️' : activeResult.message ? '✅' : '⚡'}
              </span>
              <div>
                <p className="text-[12px] font-semibold text-gray-800">
                  {smartMeta.nodes_changed
                    ? 'Config Changed — All Re-executed'
                    : activeResult.message
                      ? `All ${passedDocs.length} Document${passedDocs.length !== 1 ? 's' : ''} Up-to-date`
                      : skippedCount > 0
                        ? `${executedDocs.length} Executed · ${unchangedDocs.length} Unchanged`
                        : `${passedDocs.length} Document${passedDocs.length !== 1 ? 's' : ''} Executed`}
                </p>
                {(smartMeta.nodes_changed || activeResult.message) && (
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    {activeResult.message
                      ? 'No changes detected since last run'
                      : `Node config changed — re-executed all ${activeResult.total_documents || 0} documents`}
                  </p>
                )}
              </div>
            </div>
            {smartMeta.total_docs > 0 && (
              <span className="text-[10px] text-gray-400">
                {smartMeta.total_docs} total doc{smartMeta.total_docs !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      )}
      {/* ═══ Documents Table ═══ */}
      <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-xl bg-emerald-50 flex items-center justify-center">
                <CheckCircle2 size={14} className="text-emerald-500" />
              </div>
              <div>
                <h4 className="text-[13px] font-semibold text-gray-800">
                  {passedDocs.length} Document{passedDocs.length !== 1 ? 's' : ''}
                </h4>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {executedDocs.length > 0 && unchangedDocs.length > 0 && (
                    <span className="text-[10px] text-gray-400">
                      {executedDocs.length} executed · {unchangedDocs.length} unchanged
                    </span>
                  )}
                  {filteredDocs.length > 0 && (
                    <>
                      {executedDocs.length > 0 && unchangedDocs.length > 0 && <Dot />}
                      <span className="text-[10px] text-gray-400">{filteredDocs.length} filtered out</span>
                    </>
                  )}
                  {executionTime && (
                    <>
                      {(filteredDocs.length > 0 || (executedDocs.length > 0 && unchangedDocs.length > 0)) && <Dot />}
                      <span className="text-[10px] text-gray-400">{(executionTime / 1000).toFixed(1)}s</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Search */}
              {passedDocs.length > 3 && (
                <div className="relative">
                  <Search size={10} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={docSearch} onChange={e => setDocSearch(e.target.value)}
                    placeholder="Search…"
                    className="w-36 pl-7 pr-2.5 py-1.5 text-[10px] border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300 outline-none"
                  />
                </div>
              )}
              {/* Export */}
              {passedDocs.length > 0 && (
                <div className="flex gap-1">
                  {/* Bulk file downloads */}
                  {outputNode && (
                    <>
                      <button onClick={() => handleBulkDownload('zip')} disabled={!!downloading}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-[10px] font-medium text-gray-500 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 transition-all disabled:opacity-50">
                        {downloading === 'zip' ? <Spinner size="xs" className="text-emerald-500" /> : <Archive size={10} />} ZIP
                      </button>
                      <button onClick={() => handleBulkDownload('pdf')} disabled={!!downloading}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-[10px] font-medium text-gray-500 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 transition-all disabled:opacity-50">
                        {downloading === 'pdf' ? <Spinner size="xs" className="text-indigo-500" /> : <FileOutput size={10} />} Merged PDF
                      </button>
                      <div className="w-px h-5 bg-gray-200 self-center mx-0.5" />
                    </>
                  )}
                  {/* Metadata exports */}
                  <button onClick={() => {
                    const ks = new Set(); outputDocuments.forEach(d => { Object.keys(d.global_metadata||{}).forEach(k=>ks.add(k)); Object.keys(d.extracted_metadata||{}).forEach(k=>ks.add(k)); });
                    const h = ['title','file_type',...ks];
                    const rows = outputDocuments.map(d => { const m={...(d.global_metadata||{}),...(d.extracted_metadata||{})}; return h.map(k=>k==='title'?d.title:k==='file_type'?d.file_type:m[k]??''); });
                    const csv = [h.join(','),...rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(','))].join('\n');
                    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='output.csv'; a.click();
                  }} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-[10px] font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-all">
                    <Download size={10} /> CSV
                  </button>
                  <button onClick={() => {
                    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(outputDocuments,null,2)],{type:'application/json'})); a.download='output.json'; a.click();
                  }} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-[10px] font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-all">
                    <Download size={10} /> JSON
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Table */}
        {searchedDocs.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <FileText size={20} className="text-gray-200 mx-auto mb-2" />
            <p className="text-[11px] text-gray-400">{docSearch ? 'No documents match your search' : 'No documents passed through the pipeline'}</p>
          </div>
        ) : (
          <div className="max-h-[65vh] overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50/90 backdrop-blur-sm border-b border-gray-100">
                  <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2.5 w-8">#</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2.5">Document</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2.5 w-20">Type</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2.5 w-20">Size</th>
                  {unchangedDocs.length > 0 && (
                    <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2.5 w-24">Status</th>
                  )}
                  {searchedDocs.some(d => d.overall_confidence != null) && (
                    <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2.5 w-24">Confidence</th>
                  )}
                  <th className="text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2.5 w-20">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {searchedDocs.map((doc, idx) => {
                  const fUrl = doc.file ? getDocumentFileUrl(doc) : null;
                  return (
                    <tr key={doc.id} className="group hover:bg-emerald-50/30 transition-colors">
                      <td className="px-4 py-2.5 text-[11px] text-gray-300 tabular-nums">{idx + 1}</td>
                      <td className="px-4 py-2.5">
                        <a
                          href={workflowId ? `/documents/${workflowId}/${doc.id}` : '#'}
                          target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-2.5 group/link"
                        >
                          <div className="w-7 h-7 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center group-hover/link:bg-indigo-50 group-hover/link:border-indigo-200 transition-colors shrink-0">
                            <FileText size={13} className="text-gray-400 group-hover/link:text-indigo-500 transition-colors" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[12px] font-medium text-gray-800 truncate group-hover/link:text-indigo-600 transition-colors">
                              {doc.title}
                            </p>
                          </div>
                          <ExternalLink size={10} className="text-gray-300 opacity-0 group-hover/link:opacity-100 transition-opacity shrink-0 ml-1" />
                        </a>
                      </td>
                      <td className="px-4 py-2.5">
                        {doc.file_type && (
                          <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded uppercase">{doc.file_type}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-gray-400 tabular-nums">
                        {doc.file_size ? `${(doc.file_size / 1024).toFixed(1)} KB` : '—'}
                      </td>
                      {unchangedDocs.length > 0 && (
                        <td className="px-4 py-2.5">
                          <Pill color={doc.executionStatus === 'unchanged' ? 'gray' : 'emerald'}>
                            {doc.executionStatus === 'unchanged' ? 'Unchanged' : 'Executed'}
                          </Pill>
                        </td>
                      )}
                      {searchedDocs.some(d => d.overall_confidence != null) && (
                        <td className="px-4 py-2.5">
                          {doc.overall_confidence != null ? <div className="w-16"><ConfidenceBar value={doc.overall_confidence} /></div> : <span className="text-[10px] text-gray-300">—</span>}
                        </td>
                      )}
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-0.5">
                          {fUrl && (
                            <a href={fUrl} target="_blank" rel="noopener noreferrer"
                              className="p-1.5 text-gray-300 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="Download">
                              <Download size={12} />
                            </a>
                          )}
                          {workflowId && (
                            <a href={`/documents/${workflowId}/${doc.id}`} target="_blank" rel="noopener noreferrer"
                              className="p-1.5 text-gray-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="Preview">
                              <Eye size={12} />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══ Created Editor Documents (from doc_create nodes) ═══ */}
      {(() => {
        const dcNodes = nrl.filter(nr => nr.doc_create);
        if (dcNodes.length === 0) return null;
        const allCreated = dcNodes.flatMap(nr => (nr.doc_create?.results || []).filter(r => r.status === 'created'));
        const allSkipped = dcNodes.flatMap(nr => (nr.doc_create?.results || []).filter(r => r.status === 'skipped'));
        const allFailed = dcNodes.flatMap(nr => (nr.doc_create?.results || []).filter(r => r.status === 'failed'));
        const createdDocIds = dcNodes.flatMap(nr => nr.doc_create?.created_document_ids || []);

        return (
          <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-xl bg-indigo-50 flex items-center justify-center">
                  <FileText size={14} className="text-indigo-500" />
                </div>
                <div>
                  <h4 className="text-[13px] font-semibold text-gray-800">
                    Editor Documents Created
                  </h4>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {allCreated.length > 0 && (
                      <span className="text-[10px] text-emerald-600 font-medium">✓ {allCreated.length} created</span>
                    )}
                    {allSkipped.length > 0 && (
                      <><span className="w-[3px] h-[3px] rounded-full bg-gray-300 inline-block" /><span className="text-[10px] text-amber-600 font-medium">⊘ {allSkipped.length} skipped</span></>
                    )}
                    {allFailed.length > 0 && (
                      <><span className="w-[3px] h-[3px] rounded-full bg-gray-300 inline-block" /><span className="text-[10px] text-red-600 font-medium">✕ {allFailed.length} failed</span></>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {allCreated.length > 0 ? (
              <div className="divide-y divide-gray-50">
                {allCreated.map((r, idx) => {
                  const cdm = r.created_document_metadata;
                  const cm = cdm?.custom_metadata || {};
                  const dm = cdm?.document_metadata || {};
                  const hasMeta = Object.keys(cm).length > 0 || Object.keys(dm).length > 0;
                  return (
                    <div key={r.result_id || idx} className="px-4 py-2.5 group hover:bg-indigo-50/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                          <CheckCircle2 size={12} className="text-emerald-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium text-gray-800 truncate">
                            {r.created_document_title || r.source_document_title || 'Untitled'}
                          </p>
                          <p className="text-[10px] text-gray-400">
                            from: {r.source_document_title || 'CLM document'} · {r.creation_mode?.replace(/_/g, ' ')}
                          </p>
                        </div>
                        {r.created_document_id && (
                          <a
                            href={`/drafter/${r.created_document_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-[10px] font-semibold hover:bg-indigo-100 transition-colors shrink-0"
                          >
                            <Edit3 size={10} /> Open in Editor
                            <ExternalLink size={9} className="text-indigo-400" />
                          </a>
                        )}
                      </div>
                      {/* Show actual custom_metadata + document_metadata written to the document */}
                      {hasMeta && (
                        <div className="ml-9 mt-1.5 flex flex-wrap gap-1.5">
                          {Object.entries(cm).map(([k, v]) => (
                            <span key={`cm-${k}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-50 text-[9px]">
                              <span className="text-purple-500 font-semibold">{k}:</span>
                              <span className="text-gray-600 truncate max-w-[120px]">{String(v).slice(0, 60)}</span>
                            </span>
                          ))}
                          {Object.entries(dm).map(([k, v]) => (
                            <span key={`dm-${k}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-50 text-[9px]">
                              <span className="text-sky-500 font-semibold">{k}:</span>
                              <span className="text-gray-600 truncate max-w-[120px]">{String(v).slice(0, 60)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-4 py-6 text-center">
                <p className="text-[11px] text-gray-400">No documents were created in this run</p>
              </div>
            )}

            {/* Skipped / failed details */}
            {(allSkipped.length > 0 || allFailed.length > 0) && (
              <div className="border-t border-gray-100 px-4 py-2.5 space-y-1">
                {allSkipped.map((r, idx) => (
                  <div key={`skip-${idx}`} className="flex items-center gap-2 text-[10px]">
                    <span className="text-amber-500">⊘</span>
                    <span className="text-gray-600 truncate">{r.source_document_title}</span>
                    <span className="text-gray-400 ml-auto">{r.error_message || `Missing: ${(r.missing_fields || []).join(', ')}`}</span>
                  </div>
                ))}
                {allFailed.map((r, idx) => (
                  <div key={`fail-${idx}`} className="flex items-center gap-2 text-[10px]">
                    <span className="text-red-500">✕</span>
                    <span className="text-gray-600 truncate">{r.source_document_title}</span>
                    <span className="text-red-400 ml-auto truncate max-w-[200px]">{r.error_message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ═══ History ═══ */}
      <HistorySection history={executionHistory} load={loadExecution} loading={loadingExec} refresh={onRefreshHistory} show={showHistory} setShow={setShowHistory} />

      {/* ═══ Retry Modal ═══ */}
      <Modal open={!!retryModal} onClose={() => setRetryModal(null)} title={`Fix & Retry — ${retryModal?.docTitle || ''}`} size="md">
        {retryModal && (
          <div className="space-y-4">
            {retryModal.missingFields.length > 0 && (
              <div className="rounded-xl bg-amber-50/80 border border-amber-200/60 p-3.5">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-amber-600 mb-2.5 flex items-center gap-1.5"><AlertTriangle size={12} /> Missing Fields</p>
                {retryModal.missingFields.map(f => (
                  <div key={f} className="mb-2.5 last:mb-0">
                    <label className="block text-[11px] text-gray-600 mb-1 font-medium">{f.replace(/_/g, ' ')}</label>
                    <input value={overrideData[f] || ''} onChange={e => setOverrideData(p => ({ ...p, [f]: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-purple-100 focus:border-purple-300 outline-none" />
                  </div>
                ))}
              </div>
            )}
            <div className="rounded-xl bg-gray-50 border border-gray-100 p-3.5">
              <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2">Extracted Data</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {Object.entries(retryModal.data || {}).map(([k, v]) => (
                  <div key={k} className="text-[11px] flex gap-2"><span className="text-gray-400 min-w-[100px]">{k.replace(/_/g, ' ')}:</span><span className="text-gray-700 font-medium">{v ? String(v) : <span className="text-red-400 italic">null</span>}</span></div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setRetryModal(null)} className="px-4 py-2 text-xs font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors">Cancel</button>
              <button onClick={() => handleRetry(retryModal.resultId, overrideData)} disabled={retrying} className="px-4 py-2 text-xs font-medium text-white bg-purple-600 rounded-xl hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5 transition-colors">
                {retrying ? <Spinner size="sm" className="text-white" /> : <RotateCcw size={12} />} {retrying ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}


/* ═══════════════════════════════════════════════
   Execution History
   ═══════════════════════════════════════════════ */
function HistorySection({ history, load, loading, refresh, show: showProp, setShow: setShowProp, defaultOpen = false }) {
  const [local, setLocal] = useState(defaultOpen);
  const show = setShowProp ? showProp : local;
  const toggle = setShowProp || setLocal;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden">
      <button onClick={() => toggle(!show)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50/40 transition-colors">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center">
            <Clock size={13} className="text-gray-500" />
          </div>
          <h4 className="text-[13px] font-semibold text-gray-800">History</h4>
          {history.length > 0 && <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">{history.length}</span>}
        </div>
        <div className="flex items-center gap-2">
          {refresh && <span role="button" onClick={e => { e.stopPropagation(); refresh(); }} className="p-1 text-gray-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"><RefreshCw size={12} /></span>}
          <div className={`transition-transform duration-200 ${show ? 'rotate-180' : ''}`}>
            <ChevronDown size={14} className="text-gray-300" />
          </div>
        </div>
      </button>
      {show && (
        <div className="border-t border-gray-100 px-4 py-3">
          {history.length === 0 ? (
            <p className="text-[11px] text-gray-400 text-center py-6">No previous executions</p>
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {history.map(ex => (
                <button key={ex.id} onClick={() => load(ex.id)} disabled={loading}
                  className="w-full text-left rounded-xl border border-gray-100 bg-gray-50/30 px-3 py-2.5 hover:bg-indigo-50/40 hover:border-indigo-200 transition-all">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${ex.status === 'completed' ? 'bg-emerald-400' : ex.status === 'running' ? 'bg-blue-400 animate-pulse' : ex.status === 'partial' ? 'bg-amber-400' : 'bg-red-400'}`} />
                      <span className="text-[11px] font-medium text-gray-700 capitalize">{ex.status}</span>
                      <Pill color={ex.mode === 'auto' ? 'sky' : ex.mode === 'batch' ? 'amber' : ex.mode === 'single' ? 'purple' : 'gray'}>{ex.mode}</Pill>
                    </div>
                    <span className="text-[10px] text-gray-400 font-mono">{ex.duration_ms != null ? `${(ex.duration_ms / 1000).toFixed(1)}s` : '—'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                    <span>{ex.total_documents ?? 0} docs</span>
                    {ex.started_at && <><Dot /><span>{new Date(ex.started_at).toLocaleString()}</span></>}
                    {ex.triggered_by_name && <><Dot /><span className="text-gray-400">{ex.triggered_by_name}</span></>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
