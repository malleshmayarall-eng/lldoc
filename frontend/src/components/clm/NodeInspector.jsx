import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  X, CheckCircle2, XCircle, AlertCircle,
  Loader2, ChevronDown, ChevronRight, Search,
  ArrowUpRight, ArrowDownRight, ArrowUp, ArrowDown, ArrowUpDown,
  Brain, Zap, Filter,
  Download, FileText, FolderArchive, Table, ExternalLink,
} from 'lucide-react';
import { workflowApi, triggerBlobDownload } from '@services/clm/clmApi';

/* ================================================================
   NodeInspector — minimal, table-driven inspection overlay.
   Shows per-document expected-vs-received data in a horizontally
   scrollable table with clean row colouring & inline detail.
   ================================================================ */
export default function NodeInspector({ workflowId, nodeId, onClose }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [filter, setFilter]   = useState('all');
  const [query, setQuery]     = useState('');
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    if (!workflowId || !nodeId) return;
    setLoading(true);
    setError(null);
    workflowApi.nodeInspect(workflowId, nodeId)
      .then(({ data: d }) => setData(d))
      .catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [workflowId, nodeId]);

  const docs = useMemo(() => {
    if (!data?.documents) return [];
    let list = data.documents;
    if (filter === 'passed')   list = list.filter((d) =>  d.passed);
    if (filter === 'filtered') list = list.filter((d) => !d.passed);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((d) => d.title?.toLowerCase().includes(q) || d.id?.includes(q));
    }
    return list;
  }, [data, filter, query]);

  const nt = NT[data?.node?.node_type] || NT.output;
  const s  = data?.summary;

  if (!workflowId || !nodeId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl border border-gray-200/60 w-[860px] max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="flex items-center justify-center py-24 gap-2">
            <Loader2 size={20} className="animate-spin text-gray-400" />
            <span className="text-sm text-gray-400">Loading…</span>
          </div>
        ) : error ? (
          <div className="p-10 text-center space-y-3">
            <AlertCircle size={28} className="mx-auto text-red-400" />
            <p className="text-sm text-red-600">{error}</p>
            <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600 underline">Close</button>
          </div>
        ) : data ? (
          <>
            {/* ═══ Header ═══ */}
            <div className={`flex items-center gap-3 px-5 py-3.5 border-b ${nt.bg}`}>
              <span className="text-xl">{nt.icon}</span>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold text-gray-900 truncate">{data.node.label}</h2>
                <p className="text-[11px] text-gray-500">{nt.label} · {data.node.id.slice(0, 8)}</p>
              </div>
              {s && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Chip color="blue">{s.total_incoming} in</Chip>
                  <Chip color="emerald">{s.total_passed} pass</Chip>
                  {s.total_filtered > 0 && <Chip color="red">{s.total_filtered} out</Chip>}
                  {s.model      && <Chip color="rose">{s.model}</Chip>}
                  {s.plugin     && <Chip color="purple">{s.plugin}</Chip>}
                  {s.conditions_count != null && <Chip color="amber">{s.conditions_count} rules · {s.boolean_operator}</Chip>}
                </div>
              )}
              {s && (
                <div className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                  s.pass_rate === 100 ? 'bg-emerald-100 text-emerald-700'
                    : s.pass_rate >= 50 ? 'bg-amber-100 text-amber-700'
                    : 'bg-red-100 text-red-700'
                }`}>
                  {s.pass_rate}%
                </div>
              )}
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-black/5 text-gray-400 hover:text-gray-700">
                <X size={16} />
              </button>
            </div>

            <Topology data={data} />

            {data.node.node_type === 'rule' && s?.conditions_preview?.length > 0 && (
              <ConditionsStrip conditions={s.conditions_preview} boolOp={s.boolean_operator} />
            )}

            {data.node.node_type === 'ai' && s?.ai_fields_created?.length > 0 && (
              <AIFieldsStrip fields={s.ai_fields_created} format={s.output_format} />
            )}

            {/* ═══ Filter bar ═══ */}
            <div className="px-5 py-2 border-b flex items-center gap-2 bg-gray-50/60">
              <FilterTabs
                counts={{
                  all:      data.documents?.length || 0,
                  passed:   data.documents?.filter((d) =>  d.passed).length || 0,
                  filtered: data.documents?.filter((d) => !d.passed).length || 0,
                }}
                active={filter}
                onChange={setFilter}
              />
              <div className="flex-1" />
              <DownloadMenu workflowId={workflowId} nodeId={nodeId} />
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search docs…"
                  className="pl-7 pr-3 py-1.5 text-xs border rounded-lg w-44 bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                />
              </div>
            </div>

            {/* ═══ Table ═══ */}
            <div className="flex-1 overflow-y-auto">
              {docs.length === 0 ? (
                <div className="py-16 text-center text-sm text-gray-400">
                  {data.documents?.length === 0 ? 'No documents in this execution' : 'No documents match'}
                </div>
              ) : (
                <DocTable
                  docs={docs}
                  nodeType={data.node.node_type}
                  summary={s}
                  expandedId={expandedId}
                  onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
                  workflowId={workflowId}
                />
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}


/* ── Constants ── */
const NT = {
  input:      { icon: '📥', bg: 'bg-blue-50/60',    label: 'Input' },
  rule:       { icon: '⚙️', bg: 'bg-amber-50/60',   label: 'Rule' },
  listener:   { icon: '👂', bg: 'bg-cyan-50/60',    label: 'Listener' },
  validator:  { icon: '✅', bg: 'bg-emerald-50/60', label: 'Validator' },
  action:     { icon: '⚡', bg: 'bg-purple-50/60',  label: 'Action' },
  ai:         { icon: '🧪', bg: 'bg-rose-50/60',    label: 'AI' },
  and_gate:   { icon: '∩',  bg: 'bg-orange-50/60',  label: 'AND Gate' },
  doc_create: { icon: '📄', bg: 'bg-indigo-50/60',  label: 'Doc Create' },
  sheet:      { icon: '📊', bg: 'bg-cyan-50/60',    label: 'Sheet' },
  output:     { icon: '📤', bg: 'bg-green-50/60',   label: 'Output' },
};

const OP_LABELS = { eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', contains: '∋', not_contains: '∌' };


/* ── Atoms ── */
function Chip({ children, color = 'gray' }) {
  const styles = {
    blue: 'bg-blue-100/80 text-blue-700', emerald: 'bg-emerald-100/80 text-emerald-700',
    red: 'bg-red-100/80 text-red-700', rose: 'bg-rose-100/80 text-rose-700',
    purple: 'bg-purple-100/80 text-purple-700', amber: 'bg-amber-100/80 text-amber-700',
    gray: 'bg-gray-100 text-gray-600',
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${styles[color] || styles.gray}`}>{children}</span>;
}

/* ── Download dropdown menu ── */
function DownloadMenu({ workflowId, nodeId }) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(null);

  const handleDownload = async (format) => {
    setDownloading(format);
    try {
      const res = await workflowApi.nodeDownload(workflowId, nodeId, format);
      const ext = { pdf: '.pdf', zip: '.zip', csv: '.csv' }[format] || '';
      triggerBlobDownload(res, `node_download${ext}`);
    } catch (e) {
      console.error('Download failed:', e);
      alert(e.response?.data?.error || 'Download failed');
    } finally {
      setDownloading(null);
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border rounded-lg hover:bg-gray-50 hover:text-gray-800 transition-colors"
      >
        <Download size={12} />
        Export
        <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-white border rounded-lg shadow-lg py-1 w-44">
            <DownloadOption
              icon={<FileText size={13} />}
              label="Merged PDF"
              desc="Combine all PDFs"
              loading={downloading === 'pdf'}
              onClick={() => handleDownload('pdf')}
            />
            <DownloadOption
              icon={<FolderArchive size={13} />}
              label="ZIP Archive"
              desc="All documents"
              loading={downloading === 'zip'}
              onClick={() => handleDownload('zip')}
            />
            <DownloadOption
              icon={<Table size={13} />}
              label="CSV Export"
              desc="Metadata & results"
              loading={downloading === 'csv'}
              onClick={() => handleDownload('csv')}
            />
          </div>
        </>
      )}
    </div>
  );
}

function DownloadOption({ icon, label, desc, loading, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 disabled:opacity-50 transition-colors"
    >
      <span className="text-gray-400">{loading ? <Loader2 size={13} className="animate-spin" /> : icon}</span>
      <div>
        <div className="text-xs font-medium text-gray-700">{label}</div>
        <div className="text-[10px] text-gray-400">{desc}</div>
      </div>
    </button>
  );
}

function StatusPill({ status }) {
  const c = {
    success: 'bg-emerald-100 text-emerald-700', completed: 'bg-emerald-100 text-emerald-700',
    sent: 'bg-emerald-100 text-emerald-700', passed: 'bg-emerald-100 text-emerald-700',
    approved: 'bg-emerald-100 text-emerald-700',
    error: 'bg-red-100 text-red-700', failed: 'bg-red-100 text-red-700', rejected: 'bg-red-100 text-red-700',
    pending: 'bg-amber-100 text-amber-700', partial: 'bg-amber-100 text-amber-700',
    skipped: 'bg-gray-100 text-gray-600', previous_run: 'bg-gray-100 text-gray-600',
  };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${c[status] || 'bg-gray-100 text-gray-600'}`}>{status || '—'}</span>;
}


/* ── Filter Tabs ── */
function FilterTabs({ counts, active, onChange }) {
  const tabs = [
    { id: 'all',      label: 'All',      count: counts.all },
    { id: 'passed',   label: 'Passed',   count: counts.passed,   dot: 'bg-emerald-400' },
    { id: 'filtered', label: 'Filtered', count: counts.filtered, dot: 'bg-red-400' },
  ];
  return (
    <div className="flex gap-0.5 bg-white border p-0.5 rounded-lg">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1.5 ${
            active === t.id ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {t.dot && <span className={`w-1.5 h-1.5 rounded-full ${active === t.id ? 'bg-white/60' : t.dot}`} />}
          {t.label}
          <span className={`text-[10px] ${active === t.id ? 'text-white/70' : 'text-gray-400'}`}>{t.count}</span>
        </button>
      ))}
    </div>
  );
}


/* ── Topology ── */
function Topology({ data }) {
  if (!data.upstream?.length && !data.downstream?.length) return null;
  return (
    <div className="px-5 py-1.5 border-b flex items-center gap-5 text-[11px] text-gray-500">
      {data.upstream?.length > 0 && (
        <div className="flex items-center gap-1.5">
          <ArrowUpRight size={11} className="text-gray-400" />
          {data.upstream.map((u) => <span key={u.id} className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">{u.label}</span>)}
        </div>
      )}
      {data.downstream?.length > 0 && (
        <div className="flex items-center gap-1.5">
          <ArrowDownRight size={11} className="text-gray-400" />
          {data.downstream.map((d) => <span key={d.id} className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">{d.label}</span>)}
        </div>
      )}
    </div>
  );
}


/* ── Strips ── */
function ConditionsStrip({ conditions, boolOp }) {
  return (
    <div className="px-5 py-2 border-b bg-amber-50/30 flex items-center gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
      <span className="text-[10px] font-bold text-amber-700 shrink-0">{boolOp}</span>
      {conditions.map((c, i) => (
        <span key={i} className="shrink-0 text-[10px] px-2 py-1 bg-white border border-amber-200 rounded-lg text-gray-600 flex items-center gap-1">
          <span className="font-semibold text-amber-800">{c.field}</span>
          <span className="text-gray-400">{OP_LABELS[c.operator] || c.operator}</span>
          <span className="text-gray-600">"{c.value}"</span>
        </span>
      ))}
    </div>
  );
}

function AIFieldsStrip({ fields, format }) {
  const fl = { json_extract: 'JSON', yes_no: 'Y/N', text: 'Text' };
  return (
    <div className="px-5 py-2 border-b bg-rose-50/30 flex items-center gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
      <span className="text-[10px] font-bold text-rose-600 shrink-0">{fl[format] || format}</span>
      {fields.map((f) => (
        <span key={f} className="shrink-0 text-[10px] px-2 py-1 bg-white border border-rose-200 rounded-lg font-medium text-gray-700">{f}</span>
      ))}
    </div>
  );
}


/* ================================================================
   DocTable — horizontally-scrollable core table
   ================================================================ */
function DocTable({ docs, nodeType, summary, expandedId, onToggle, workflowId }) {
  const columns = useMemo(() => {
    const cols = [
      { key: 'status', label: '', width: 'w-8' },
      { key: 'title', label: 'Document', width: 'min-w-[180px]' },
      { key: 'reason', label: 'Reason', width: 'min-w-[200px]' },
    ];

    if (nodeType === 'rule') {
      const conds = summary?.conditions_preview || [];
      conds.forEach((c, i) => {
        cols.push({
          key: `cond_${i}`,
          label: `${c.field} ${OP_LABELS[c.operator] || c.operator} "${c.value}"`,
          width: 'min-w-[160px]',
          condition: true,
          condIndex: i,
        });
      });
    }

    if (nodeType === 'ai') {
      cols.push({ key: 'ai_answer', label: 'Answer', width: 'min-w-[80px]' });
      const fields = summary?.ai_fields_created || [];
      fields.forEach((f) => {
        cols.push({ key: `ai_f_${f}`, label: f, width: 'min-w-[140px]', aiField: true, fieldName: f });
      });
    }

    if (nodeType === 'action') {
      cols.push({ key: 'action_plugin', label: 'Plugin', width: 'min-w-[100px]' });
      cols.push({ key: 'action_status', label: 'Status', width: 'min-w-[90px]' });
    }

    if (nodeType === 'validator') {
      cols.push({ key: 'val_status', label: 'Approval', width: 'min-w-[100px]' });
    }

    if (nodeType === 'input') {
      cols.push({ key: 'input_type', label: 'Type', width: 'min-w-[100px]' });
      cols.push({ key: 'input_status', label: 'Extraction', width: 'min-w-[100px]' });
      cols.push({ key: 'input_fields', label: 'Fields', width: 'min-w-[80px]' });
      cols.push({ key: 'input_source', label: 'Source', width: 'min-w-[80px]' });
    }

    if (nodeType === 'and_gate') {
      cols.push({ key: 'gate_status', label: 'Gate', width: 'min-w-[100px]' });
    }

    if (nodeType === 'doc_create') {
      cols.push({ key: 'dc_status', label: 'Status', width: 'min-w-[90px]' });
      cols.push({ key: 'dc_mode', label: 'Mode', width: 'min-w-[100px]' });
      cols.push({ key: 'dc_link', label: 'Editor', width: 'min-w-[120px]' });
    }

    if (nodeType === 'listener') {
      cols.push({ key: 'listener_status', label: 'Status', width: 'min-w-[100px]' });
    }

    return cols;
  }, [nodeType, summary]);

  const cellValue = (doc, col) => {
    if (col.key === 'status')  return null;
    if (col.key === 'title')   return doc.title;
    if (col.key === 'reason')  return doc.reason || '—';

    if (col.condition) {
      const conds = doc.details?.conditions || [];
      const c = conds[col.condIndex];
      return c || '—';
    }

    if (col.key === 'ai_answer') {
      const ans = doc.details?.ai?.answer;
      return ans != null ? String(ans).toUpperCase() : '—';
    }
    if (col.aiField) {
      const fields = doc.details?.ai?.created_fields || {};
      return fields[col.fieldName] != null ? String(fields[col.fieldName]).slice(0, 80) : '—';
    }

    if (col.key === 'action_plugin') return doc.details?.action?.plugin || '—';
    if (col.key === 'action_status') return doc.details?.action?.status || '—';
    if (col.key === 'val_status')    return doc.details?.validator?.status || '—';
    if (col.key === 'input_type')    return doc.details?.input?.document_type?.replace(/_/g, ' ') || '—';
    if (col.key === 'input_status')  return doc.details?.input?.extraction_status || '—';
    if (col.key === 'input_fields')  return doc.details?.input?.field_count ?? '—';
    if (col.key === 'input_source')  return doc.details?.input?.source || '—';
    if (col.key === 'gate_status')    return doc.details?.gate?.status || '—';
    if (col.key === 'dc_status')      return doc.details?.doc_create?.status || '—';
    if (col.key === 'dc_mode')        return doc.details?.doc_create?.creation_mode?.replace(/_/g, ' ') || '—';
    if (col.key === 'dc_link') {
      const docId = doc.details?.doc_create?.created_document_id;
      return docId ? docId : '—';
    }
    if (col.key === 'listener_status') return doc.details?.listener?.status || '—';
    return '—';
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] border-collapse">
        <thead className="sticky top-0 z-10">
          <tr className="bg-gray-50 border-b border-gray-200">
            {columns.map((col) => (
              <th key={col.key} className={`text-left px-3 py-2 text-[10px] uppercase tracking-wider font-semibold text-gray-500 whitespace-nowrap ${col.width}`}>
                {col.label}
              </th>
            ))}
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {docs.map((doc) => (
            <React.Fragment key={doc.id}>
              <tr
                onClick={() => onToggle(doc.id)}
                className={`group border-b cursor-pointer transition-colors ${
                  doc.passed
                    ? 'hover:bg-emerald-50/40 bg-white'
                    : 'hover:bg-red-50/40 bg-red-50/20'
                } ${expandedId === doc.id ? (doc.passed ? 'bg-emerald-50/50' : 'bg-red-50/40') : ''}`}
              >
                {columns.map((col) => (
                  <td key={col.key} className="px-3 py-2.5 align-top whitespace-nowrap">
                    {col.key === 'status' ? (
                      doc.passed
                        ? <CheckCircle2 size={14} className="text-emerald-500" />
                        : <XCircle size={14} className="text-red-400" />
                    ) : col.key === 'title' ? (
                      <div className="max-w-[220px]">
                        <Link
                          to={`/clm/documents/${workflowId}/${doc.id}`}
                          target="_blank"
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-gray-800 truncate block hover:text-indigo-600 transition-colors"
                          title="Open document preview"
                        >
                          <span className="flex items-center gap-1">
                            <span className="truncate">{doc.title}</span>
                            <ExternalLink size={10} className="shrink-0 opacity-0 group-hover:opacity-100 text-indigo-400" />
                          </span>
                        </Link>
                        {doc.file_type && <span className="text-[9px] uppercase text-gray-400">{doc.file_type}</span>}
                      </div>
                    ) : col.key === 'reason' ? (
                      <span className={`text-[11px] ${doc.passed ? 'text-emerald-600' : 'text-red-500'}`}>
                        {cellValue(doc, col)}
                      </span>
                    ) : col.condition ? (
                      <ConditionCell cond={cellValue(doc, col)} />
                    ) : col.key === 'ai_answer' ? (
                      <AnswerCell value={cellValue(doc, col)} />
                    ) : col.key === 'action_status' || col.key === 'val_status' || col.key === 'gate_status' || col.key === 'listener_status' || col.key === 'dc_status' || col.key === 'input_status' ? (
                      <StatusPill status={cellValue(doc, col)} />
                    ) : col.key === 'input_fields' ? (
                      (() => {
                        const count = cellValue(doc, col);
                        return count != null && count !== '—' ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-blue-100 text-blue-700">{count}</span>
                        ) : <span className="text-gray-400">—</span>;
                      })()
                    ) : col.key === 'dc_link' ? (
                      (() => {
                        const docId = cellValue(doc, col);
                        if (!docId || docId === '—') return <span className="text-gray-400">—</span>;
                        return (
                          <a
                            href={`/drafter/${docId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-indigo-50 text-indigo-700 text-[10px] font-medium hover:bg-indigo-100 transition-colors"
                          >
                            📄 Open <ExternalLink size={9} />
                          </a>
                        );
                      })()
                    ) : (
                      <span className="text-gray-600 truncate block max-w-[200px]">{cellValue(doc, col)}</span>
                    )}
                  </td>
                ))}
                <td className="px-2 py-2.5 text-gray-400">
                  {expandedId === doc.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </td>
              </tr>

              {expandedId === doc.id && (
                <tr className={doc.passed ? 'bg-emerald-50/20' : 'bg-red-50/20'}>
                  <td colSpan={columns.length + 1} className="px-5 py-3">
                    <ExpandedDetail doc={doc} nodeType={nodeType} />
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}


/* ── Cell renderers ── */
function ConditionCell({ cond }) {
  if (!cond || cond === '—') return <span className="text-gray-400">—</span>;
  return (
    <div className="flex items-center gap-1.5">
      {cond.result
        ? <CheckCircle2 size={10} className="text-emerald-500 shrink-0" />
        : <XCircle size={10} className="text-red-400 shrink-0" />
      }
      <div className="min-w-0">
        <p className="text-[10px] text-gray-400">expected: <span className="text-gray-700 font-medium">"{cond.expected_value}"</span></p>
        <p className={`text-[10px] ${cond.result ? 'text-emerald-600' : 'text-red-500'}`}>
          received: <span className="font-medium font-mono">{cond.actual_value != null ? `"${String(cond.actual_value).slice(0, 40)}"` : 'null'}</span>
        </p>
      </div>
    </div>
  );
}

function AnswerCell({ value }) {
  if (!value || value === '—') return <span className="text-gray-400">—</span>;
  const yes = value === 'YES' || value === 'TRUE';
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${yes ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
      {value}
    </span>
  );
}


/* ════════════════════════════════════════════════════════════════
   Expanded Detail — shown below a row when clicked
   ════════════════════════════════════════════════════════════════ */
function ExpandedDetail({ doc, nodeType }) {
  const d = doc.details || {};
  return (
    <div className="space-y-3 max-w-full">
      {d.conditions && (
        <DetailSection icon={<Filter size={10} />} title="Condition Evaluation" accent="amber">
          <div className="grid grid-cols-1 gap-1">
            {d.conditions.map((c, i) => (
              <div key={i} className={`flex items-center gap-3 px-3 py-1.5 rounded-lg text-[11px] ${
                c.result ? 'bg-emerald-50 border border-emerald-100' : 'bg-red-50 border border-red-100'
              }`}>
                {c.result ? <CheckCircle2 size={11} className="text-emerald-500 shrink-0" /> : <XCircle size={11} className="text-red-400 shrink-0" />}
                <span className="font-medium text-gray-700 w-28 truncate">{c.field}</span>
                <span className="text-gray-400 w-5 text-center">{OP_LABELS[c.operator] || c.operator}</span>
                <span className="text-gray-600 w-28 truncate">"{c.expected_value}"</span>
                <span className="text-gray-300">→</span>
                <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded truncate ${
                  c.result ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                }`}>
                  {c.actual_value != null ? `"${String(c.actual_value).slice(0, 50)}"` : 'null'}
                </span>
              </div>
            ))}
          </div>
        </DetailSection>
      )}

      {d.ai && (
        <DetailSection icon={<Brain size={10} />} title="AI Result" accent="rose">
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-[11px] flex-wrap">
              {d.ai.model && <><span className="text-gray-400">Model:</span> <span className="font-medium text-gray-700">{d.ai.model}</span></>}
              {d.ai.output_format && <><span className="text-gray-300">·</span> <span className="text-gray-400">Format:</span> <span className="font-medium text-gray-700">{d.ai.output_format}</span></>}
              <StatusPill status={d.ai.status} />
              {d.ai.cache_hit && <span className="text-[9px] px-1.5 py-0.5 bg-sky-100 text-sky-600 rounded">⚡ cached</span>}
            </div>
            {d.ai.answer != null && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400">Answer:</span>
                <AnswerCell value={String(d.ai.answer).toUpperCase()} />
              </div>
            )}
            {d.ai.created_fields && Object.keys(d.ai.created_fields).length > 0 && (
              <div className="overflow-x-auto">
                <table className="text-[10px] border-collapse w-full">
                  <thead><tr className="text-left text-gray-400"><th className="pr-4 py-1 font-semibold">Field</th><th className="py-1 font-semibold">Value</th></tr></thead>
                  <tbody>
                    {Object.entries(d.ai.created_fields).map(([k, v]) => (
                      <tr key={k} className="border-t border-gray-100">
                        <td className="pr-4 py-1 text-rose-600 font-medium">{k}</td>
                        <td className="py-1 text-gray-700 max-w-[300px] truncate">{String(v).slice(0, 100)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {d.ai.error && <p className="text-[10px] text-red-500">Error: {d.ai.error}</p>}
          </div>
        </DetailSection>
      )}

      {d.action && (
        <DetailSection icon={<Zap size={10} />} title="Action Result" accent="purple">
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-gray-400">Plugin:</span>
            <span className="font-medium text-gray-700">{d.action.plugin}</span>
            <StatusPill status={d.action.status} />
          </div>
          {d.action.missing_fields?.length > 0 && (
            <p className="text-[10px] text-amber-600 mt-1 flex items-center gap-1"><AlertCircle size={10} /> Missing: {d.action.missing_fields.join(', ')}</p>
          )}
          {d.action.error_message && <p className="text-[10px] text-red-500 mt-1">Error: {d.action.error_message}</p>}
        </DetailSection>
      )}

      {d.validator && (
        <DetailSection icon={<CheckCircle2 size={10} />} title="Validation" accent="emerald">
          <div className="flex gap-3">
            {d.validator.approved > 0 && <MiniStat label="Approved" value={d.validator.approved} color="emerald" />}
            {d.validator.pending > 0  && <MiniStat label="Pending"  value={d.validator.pending}  color="amber" />}
            {d.validator.rejected > 0 && <MiniStat label="Rejected" value={d.validator.rejected} color="red" />}
          </div>
        </DetailSection>
      )}

      {d.gate && (
        <DetailSection title="Gate" accent="orange">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="font-medium text-gray-700 uppercase">{d.gate.gate_type}</span>
            <StatusPill status={d.gate.status} />
            {d.gate.message && <span className="text-gray-500">{d.gate.message}</span>}
          </div>
        </DetailSection>
      )}

      {d.listener && (
        <DetailSection title="Listener" accent="cyan">
          <div className="flex items-center gap-2 text-[11px]">
            <StatusPill status={d.listener.status} />
            {d.listener.event_id && <span className="text-gray-400 text-[10px]">Event: {d.listener.event_id.slice(0, 8)}</span>}
            {d.listener.message && <span className="text-gray-500">{d.listener.message}</span>}
          </div>
        </DetailSection>
      )}

      {d.doc_create && (
        <DetailSection icon={<FileText size={10} />} title="Editor Document" accent="indigo">
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-[11px] flex-wrap">
              <StatusPill status={d.doc_create.status} />
              {d.doc_create.creation_mode && (
                <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[10px] font-medium">
                  {d.doc_create.creation_mode}
                </span>
              )}
              {d.doc_create.created_document_title && (
                <span className="text-gray-700 font-medium truncate max-w-[200px]">{d.doc_create.created_document_title}</span>
              )}
            </div>
            {d.doc_create.created_document_id && (
              <a
                href={`/drafter/${d.doc_create.created_document_id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors font-medium"
              >
                <ExternalLink size={10} /> Open in Editor
              </a>
            )}
            {d.doc_create.missing_fields?.length > 0 && (
              <p className="text-[10px] text-amber-600 flex items-center gap-1">
                <AlertCircle size={10} /> Missing: {d.doc_create.missing_fields.join(', ')}
              </p>
            )}
            {d.doc_create.error_message && (
              <p className="text-[10px] text-red-500">Error: {d.doc_create.error_message}</p>
            )}

            {/* ── Created Document Metadata (actual custom_metadata + doc fields) ── */}
            {(() => {
              const cdm = d.doc_create.created_document_metadata;
              if (!cdm) return null;

              // Build display rows: doc fields + custom_metadata + document_metadata
              const rows = [];

              // Basic doc fields (non-empty only)
              const basicFields = [
                ['Title', cdm.title],
                ['Type', cdm.document_type],
                ['Category', cdm.category],
                ['Governing Law', cdm.governing_law],
                ['Jurisdiction', cdm.jurisdiction],
                ['Author', cdm.author],
              ];
              basicFields.forEach(([label, val]) => {
                if (val && String(val).trim()) rows.push({ key: label, value: String(val), group: 'doc' });
              });

              // Custom metadata
              const cm = cdm.custom_metadata || {};
              Object.entries(cm).forEach(([k, v]) => {
                if (v != null && String(v).trim()) rows.push({ key: k, value: String(v), group: 'custom' });
              });

              // Document metadata (flattened)
              const dm = cdm.document_metadata || {};
              Object.entries(dm).forEach(([k, v]) => {
                if (v != null && String(v).trim()) rows.push({ key: k, value: String(v), group: 'meta' });
              });

              if (rows.length === 0) return null;

              const groupColors = {
                doc: 'text-gray-500',
                custom: 'text-purple-600',
                meta: 'text-sky-600',
              };
              const groupBadge = {
                custom: <span className="ml-1 px-1 py-0 rounded bg-purple-100 text-purple-600 text-[8px] font-semibold">CUSTOM</span>,
                meta: <span className="ml-1 px-1 py-0 rounded bg-sky-100 text-sky-600 text-[8px] font-semibold">META</span>,
              };

              return (
                <div className="overflow-x-auto">
                  <p className="text-[9px] text-gray-400 uppercase font-semibold mb-1">Document Metadata</p>
                  <table className="text-[10px] border-collapse w-full">
                    <thead>
                      <tr className="text-left text-gray-400">
                        <th className="pr-4 py-1 font-semibold">Field</th>
                        <th className="py-1 font-semibold">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, idx) => (
                        <tr key={idx} className="border-t border-gray-100">
                          <td className={`pr-4 py-1 font-medium whitespace-nowrap ${groupColors[r.group] || 'text-gray-500'}`}>
                            {r.key}{groupBadge[r.group] || null}
                          </td>
                          <td className="py-1 text-gray-700 max-w-[300px] truncate">{r.value.slice(0, 120)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* ── CLM Source Mapping (collapsed by default) ── */}
            {d.doc_create.metadata_used && Object.keys(d.doc_create.metadata_used).length > 0 && (
              <details className="text-[10px]">
                <summary className="text-[9px] text-gray-400 uppercase font-semibold cursor-pointer hover:text-gray-600">
                  CLM Source Mapping ({Object.keys(d.doc_create.metadata_used).length} fields)
                </summary>
                <div className="overflow-x-auto mt-1">
                  <table className="text-[10px] border-collapse w-full">
                    <thead>
                      <tr className="text-left text-gray-400">
                        <th className="pr-4 py-1 font-semibold">Target</th>
                        <th className="py-1 font-semibold">Value from CLM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(d.doc_create.metadata_used).map(([k, v]) => (
                        <tr key={k} className="border-t border-gray-100">
                          <td className="pr-4 py-1 text-indigo-600 font-medium">{k}</td>
                          <td className="py-1 text-gray-700 max-w-[300px] truncate">{v != null ? String(v).slice(0, 100) : <span className="text-gray-300 italic">empty</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        </DetailSection>
      )}

      {d.input && (
        <InputFieldsSheet input={d.input} />
      )}
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════
   InputFieldsSheet — sheet-like metadata viewer for Input nodes
   Shows all extracted + global fields in a spreadsheet-style table
   with search, filter by type/source, sort, and quick stats.
   ════════════════════════════════════════════════════════════════ */
function InputFieldsSheet({ input }) {
  const [fieldSearch, setFieldSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sortBy, setSortBy] = useState('key');
  const [sortDir, setSortDir] = useState('asc');
  const [showEmpty, setShowEmpty] = useState(true);

  const fields = input.all_fields || [];
  const fileInfo = input.file_info || {};

  // Compute type counts
  const typeCounts = useMemo(() => {
    const c = {};
    fields.forEach(f => { c[f.type] = (c[f.type] || 0) + 1; });
    return c;
  }, [fields]);

  // Filter & sort
  const filtered = useMemo(() => {
    let list = [...fields];
    if (!showEmpty) list = list.filter(f => !f.empty);
    if (typeFilter !== 'all') list = list.filter(f => f.type === typeFilter);
    if (sourceFilter !== 'all') list = list.filter(f => f.source === sourceFilter);
    if (fieldSearch.trim()) {
      const q = fieldSearch.toLowerCase();
      list = list.filter(f =>
        f.key.toLowerCase().includes(q) ||
        (f.value || '').toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'key') cmp = a.key.localeCompare(b.key);
      else if (sortBy === 'value') cmp = (a.value || '').localeCompare(b.value || '');
      else if (sortBy === 'type') cmp = a.type.localeCompare(b.type);
      else if (sortBy === 'source') cmp = a.source.localeCompare(b.source);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [fields, fieldSearch, typeFilter, sourceFilter, sortBy, sortDir, showEmpty]);

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };

  const TYPE_BADGES = {
    text:    { bg: 'bg-gray-100',    text: 'text-gray-600',    label: 'Abc' },
    number:  { bg: 'bg-blue-100',    text: 'text-blue-700',    label: '123' },
    boolean: { bg: 'bg-purple-100',  text: 'text-purple-700',  label: 'T/F' },
    list:    { bg: 'bg-amber-100',   text: 'text-amber-700',   label: '[ ]' },
    object:  { bg: 'bg-rose-100',    text: 'text-rose-700',    label: '{ }' },
  };

  const emptyCount = fields.filter(f => f.empty).length;
  const extractedCount = fields.filter(f => f.source === 'extracted').length;
  const globalCount = fields.filter(f => f.source === 'global').length;

  return (
    <div className="rounded-lg border border-blue-200 overflow-hidden">
      {/* ── Header bar ── */}
      <div className="bg-gradient-to-r from-blue-50 to-sky-50 px-3 py-2.5 border-b border-blue-100">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Table size={12} className="text-blue-600" />
            <span className="text-[11px] font-semibold text-gray-800">Extracted Metadata</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold">{fields.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill status={input.extraction_status} />
            {input.document_type && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium">
                {input.document_type.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        </div>

        {/* Summary chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100/80 text-blue-600 font-medium">{extractedCount} extracted</span>
          {globalCount > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-100/80 text-sky-600 font-medium">{globalCount} global</span>}
          {emptyCount > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">{emptyCount} empty</span>}
          {Object.entries(typeCounts).map(([t, c]) => (
            <button
              key={t}
              onClick={() => setTypeFilter(typeFilter === t ? 'all' : t)}
              className={'text-[9px] px-1.5 py-0.5 rounded font-medium transition-colors cursor-pointer ' +
                (typeFilter === t
                  ? (TYPE_BADGES[t]?.bg || 'bg-gray-200') + ' ' + (TYPE_BADGES[t]?.text || 'text-gray-700') + ' ring-1 ring-offset-0 ring-gray-300'
                  : 'bg-white/60 text-gray-400 hover:bg-white')}
            >
              {TYPE_BADGES[t]?.label || t} {c}
            </button>
          ))}
          {fileInfo.file_type && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100/80 text-emerald-600 font-medium uppercase">
              {fileInfo.file_type}
            </span>
          )}
        </div>
      </div>

      {/* ── Search + filters bar ── */}
      <div className="px-3 py-1.5 bg-white border-b flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={fieldSearch}
            onChange={(e) => setFieldSearch(e.target.value)}
            placeholder="Search fields or values..."
            className="w-full pl-6 pr-2 py-1 text-[10px] border rounded-md bg-gray-50 focus:bg-white focus:ring-1 focus:ring-blue-200 focus:border-blue-300 outline-none"
          />
          {fieldSearch && (
            <button onClick={() => setFieldSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
              <X size={9} />
            </button>
          )}
        </div>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="text-[10px] px-1.5 py-1 border rounded-md bg-white text-gray-600 focus:ring-1 focus:ring-blue-200 outline-none"
        >
          <option value="all">All sources</option>
          <option value="extracted">Extracted</option>
          <option value="global">Global</option>
        </select>
        <label className="flex items-center gap-1 text-[10px] text-gray-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showEmpty}
            onChange={(e) => setShowEmpty(e.target.checked)}
            className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Empty
        </label>
        <span className="text-[9px] text-gray-400">{filtered.length}/{fields.length}</span>
      </div>

      {/* ── Spreadsheet table ── */}
      <div className="max-h-[320px] overflow-auto" style={{ scrollbarWidth: 'thin' }}>
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-[11px] text-gray-400">
            {fields.length === 0 ? 'No metadata fields extracted' : 'No fields match your search'}
          </div>
        ) : (
          <table className="w-full text-[10px] border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 border-b">
                <th className="w-8 px-2 py-1.5 text-center text-[9px] text-gray-400 font-semibold">#</th>
                <SortHeader label="Field Name" col="key" sortBy={sortBy} sortDir={sortDir} onClick={handleSort} />
                <SortHeader label="Value" col="value" sortBy={sortBy} sortDir={sortDir} onClick={handleSort} />
                <SortHeader label="Type" col="type" sortBy={sortBy} sortDir={sortDir} onClick={handleSort} width="w-16" />
                <SortHeader label="Source" col="source" sortBy={sortBy} sortDir={sortDir} onClick={handleSort} width="w-18" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((f, i) => {
                const tb = TYPE_BADGES[f.type] || TYPE_BADGES.text;
                return (
                  <tr
                    key={f.key + '-' + i}
                    className={'border-b border-gray-50 transition-colors hover:bg-blue-50/40 ' +
                      (f.empty ? 'opacity-50' : '')}
                  >
                    <td className="px-2 py-1.5 text-center text-[9px] text-gray-300 font-mono">{i + 1}</td>
                    <td className="px-3 py-1.5 font-medium text-gray-700 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate max-w-[180px]" title={f.key}>{f.key}</span>
                        {fieldSearch && f.key.toLowerCase().includes(fieldSearch.toLowerCase()) && (
                          <span className="w-1 h-1 rounded-full bg-amber-400 shrink-0" />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-gray-600">
                      {f.empty ? (
                        <span className="text-gray-300 italic">empty</span>
                      ) : f.type === 'boolean' ? (
                        <span className={'px-1.5 py-0.5 rounded text-[9px] font-bold ' +
                          (f.value === 'True' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>
                          {f.value}
                        </span>
                      ) : f.type === 'number' ? (
                        <span className="font-mono text-blue-700">{f.value}</span>
                      ) : f.type === 'list' ? (
                        <div className="flex items-center gap-1 max-w-[280px] overflow-hidden">
                          {f.value.split(', ').slice(0, 4).map((item, j) => (
                            <span key={j} className="text-[9px] px-1 py-0.5 bg-amber-50 border border-amber-200 rounded text-amber-700 whitespace-nowrap truncate max-w-[80px]">{item}</span>
                          ))}
                          {f.value.split(', ').length > 4 && (
                            <span className="text-[9px] text-gray-400">+{f.value.split(', ').length - 4}</span>
                          )}
                        </div>
                      ) : f.type === 'object' ? (
                        <span className="text-[9px] font-mono text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded max-w-[280px] truncate block" title={f.value}>
                          {f.value.length > 60 ? f.value.slice(0, 60) + '…' : f.value}
                        </span>
                      ) : (
                        <span className="truncate block max-w-[280px]" title={f.value}>{f.value}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <span className={'text-[8px] px-1.5 py-0.5 rounded font-bold ' + tb.bg + ' ' + tb.text}>
                        {tb.label}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <span className={'text-[8px] px-1.5 py-0.5 rounded font-medium ' +
                        (f.source === 'extracted' ? 'bg-blue-50 text-blue-500' : 'bg-sky-50 text-sky-500')}>
                        {f.source}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── File info footer ── */}
      {(fileInfo.file_type || fileInfo.created_at) && (
        <div className="px-3 py-1.5 bg-gray-50/60 border-t flex items-center gap-3 text-[9px] text-gray-400">
          {fileInfo.file_type && <span className="uppercase font-medium">{fileInfo.file_type}</span>}
          {fileInfo.page_count && <span>{fileInfo.page_count} page{fileInfo.page_count !== 1 ? 's' : ''}</span>}
          {fileInfo.file_size && <span>{(fileInfo.file_size / 1024).toFixed(0)} KB</span>}
          {fileInfo.created_at && <span>Uploaded {new Date(fileInfo.created_at).toLocaleDateString()}</span>}
          {input.source && <span className="ml-auto">via {input.source}</span>}
        </div>
      )}
    </div>
  );
}

/* ── SortHeader for InputFieldsSheet ── */
function SortHeader({ label, col, sortBy, sortDir, onClick, width = '' }) {
  const active = sortBy === col;
  return (
    <th
      onClick={() => onClick(col)}
      className={'px-3 py-1.5 text-left text-[9px] uppercase tracking-wider font-semibold text-gray-500 cursor-pointer select-none hover:text-gray-800 transition-colors whitespace-nowrap ' + width}
    >
      <span className="flex items-center gap-0.5">
        {label}
        {active ? (
          sortDir === 'asc'
            ? <ArrowUp size={8} className="text-blue-500" />
            : <ArrowDown size={8} className="text-blue-500" />
        ) : (
          <ArrowUpDown size={8} className="text-gray-300" />
        )}
      </span>
    </th>
  );
}


/* ── Layout helpers ── */
function DetailSection({ icon, title, accent = 'gray', children }) {
  const accents = {
    amber: 'border-amber-200', rose: 'border-rose-200', purple: 'border-purple-200',
    emerald: 'border-emerald-200', orange: 'border-orange-200', cyan: 'border-cyan-200',
    blue: 'border-blue-200', gray: 'border-gray-200', indigo: 'border-indigo-200',
  };
  return (
    <div className={`rounded-lg border ${accents[accent] || accents.gray} p-3`}>
      <p className="text-[10px] uppercase text-gray-400 font-semibold mb-2 flex items-center gap-1.5">{icon} {title}</p>
      {children}
    </div>
  );
}

function MiniStat({ label, value, color }) {
  const c = { emerald: 'bg-emerald-100 text-emerald-700', amber: 'bg-amber-100 text-amber-700', red: 'bg-red-100 text-red-700' };
  return (
    <div className={`px-3 py-1.5 rounded-lg ${c[color] || 'bg-gray-100 text-gray-600'} text-center`}>
      <p className="text-sm font-bold">{value}</p>
      <p className="text-[9px] uppercase font-medium opacity-75">{label}</p>
    </div>
  );
}
