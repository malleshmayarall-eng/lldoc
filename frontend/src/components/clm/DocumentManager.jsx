import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { workflowApi, nodeApi, getDocumentFileUrl } from '@services/clm/clmApi';
import { StatusBadge, ConfidenceBar, SourceBadge, ConfirmModal, Modal, Spinner, EmptyState, Tabs } from '@components/clm/ui/SharedUI';
import FieldEditor from './FieldEditor';
import notify from '@utils/clm/clmNotify';
import {
  Upload, Trash2, RefreshCw, Download, Eye, FileText,
  ChevronDown, ChevronRight, Search, CheckCircle2,
  XCircle, Clock, ScanText, Edit3,
  Image, FileSpreadsheet, Presentation, FileCode, File, FileType,
  Link2, ShieldCheck, User, Share2, Link as LinkIcon, Copy, ExternalLink, Loader2,
  Mail, Globe, Table2, HardDrive, Cloud, CloudCog, Server, Terminal,
  FolderOpen, Database,
} from 'lucide-react';

/* ── File-type icon helper ───────────────────────────────────────────── */
const IMAGE_TYPES_SET = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg']);
function getDocFileIcon(fileType, size = 18) {
  const ft = (fileType || '').toLowerCase();
  if (ft === 'pdf') return <FileText size={size} className="text-red-500" />;
  if (IMAGE_TYPES_SET.has(ft)) return <Image size={size} className="text-emerald-500" />;
  if (['xlsx', 'xls'].includes(ft)) return <FileSpreadsheet size={size} className="text-green-600" />;
  if (['pptx', 'ppt'].includes(ft)) return <Presentation size={size} className="text-orange-500" />;
  if (['html', 'htm', 'json', 'xml'].includes(ft)) return <FileCode size={size} className="text-cyan-600" />;
  if (['docx', 'doc', 'odt'].includes(ft)) return <FileText size={size} className="text-blue-500" />;
  if (['txt', 'md', 'csv', 'rtf'].includes(ft)) return <FileType size={size} className="text-violet-500" />;
  return <File size={size} className="text-gray-500" />;
}

/* ── Source-type metadata ────────────────────────────────────────────── */
const SOURCE_META = {
  upload:       { icon: Upload,          label: 'Upload',        canUpload: true,  canRefresh: false, canReextract: true  },
  bulk_upload:  { icon: Upload,          label: 'Bulk Upload',   canUpload: true,  canRefresh: false, canReextract: true  },
  folder_upload:{ icon: FolderOpen,      label: 'Folder',        canUpload: false, canRefresh: true,  canReextract: true  },
  dms_import:   { icon: Database,        label: 'DMS Import',    canUpload: false, canRefresh: true,  canReextract: true  },
  sheets:       { icon: FileSpreadsheet, label: 'Sheets',        canUpload: false, canRefresh: true,  canReextract: false },
  email_inbox:  { icon: Mail,            label: 'Email Inbox',   canUpload: false, canRefresh: true,  canReextract: false },
  google_drive: { icon: HardDrive,       label: 'Google Drive',  canUpload: false, canRefresh: true,  canReextract: true  },
  dropbox:      { icon: Cloud,           label: 'Dropbox',       canUpload: false, canRefresh: true,  canReextract: true  },
  onedrive:     { icon: CloudCog,        label: 'OneDrive',      canUpload: false, canRefresh: true,  canReextract: true  },
  s3:           { icon: Server,          label: 'S3 Bucket',     canUpload: false, canRefresh: true,  canReextract: true  },
  ftp:          { icon: Terminal,        label: 'FTP / SFTP',    canUpload: false, canRefresh: true,  canReextract: true  },
  url_scrape:   { icon: Globe,           label: 'URL Scrape',    canUpload: false, canRefresh: true,  canReextract: true  },
  table:        { icon: Table2,          label: 'Table',         canUpload: false, canRefresh: true,  canReextract: false },
  webhook:      { icon: Link2,           label: 'Webhook',       canUpload: false, canRefresh: false, canReextract: true  },
};
function getSourceMeta(sourceType) {
  return SOURCE_META[sourceType] || SOURCE_META.upload;
}

/**
 * DocumentManager — full document management panel for a workflow.
 * Renders a collapsible section per input node so the user can upload /
 * refresh / view documents independently for each input.
 */
export default function DocumentManager({ workflowId, onUpdate }) {
  const [inputNodes, setInputNodes] = useState([]);
  const [nodeDocsMap, setNodeDocsMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [summary, setSummary] = useState(null);

  const [nodeUploading, setNodeUploading] = useState({});
  const [nodeRefreshing, setNodeRefreshing] = useState({});
  const [reextractingIds, setReextractingIds] = useState(new Set());

  const [statusFilter, setStatusFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDocs, setSelectedDocs] = useState(new Set());

  const [confirmDelete, setConfirmDelete] = useState(null);
  const [bulkAction, setBulkAction] = useState(null);
  const [textViewDoc, setTextViewDoc] = useState(null);
  const [fieldEditorDoc, setFieldEditorDoc] = useState(null);

  const [showShareModal, setShowShareModal] = useState(false);
  const [uploadLinks, setUploadLinks] = useState([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [newLinkLabel, setNewLinkLabel] = useState('');
  const [newLinkPassword, setNewLinkPassword] = useState('');
  const [newLinkRequireLogin, setNewLinkRequireLogin] = useState('none');
  const [copiedLinkId, setCopiedLinkId] = useState(null);

  /* ── Fetch ─────────────────────────────────────────────────────────── */
  const fetchInputNodes = useCallback(async () => {
    try {
      const { data } = await nodeApi.list(workflowId);
      const nodes = (Array.isArray(data) ? data : data.results || [])
        .filter(n => n.node_type === 'input');
      setInputNodes(nodes);
      if (nodes.length <= 3) setExpandedNodes(new Set(nodes.map(n => n.id)));
      return nodes;
    } catch {
      notify.error('Failed to load input nodes');
      return [];
    }
  }, [workflowId]);

  const fetchNodeDocs = useCallback(async (nodeId) => {
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      const { data } = await workflowApi.inputNodeDocuments(workflowId, nodeId, params);
      setNodeDocsMap(prev => ({ ...prev, [nodeId]: data }));
    } catch {}
  }, [workflowId, statusFilter]);

  const fetchAllNodeDocs = useCallback(async (nodes) => {
    await Promise.all(nodes.map(n => fetchNodeDocs(n.id)));
  }, [fetchNodeDocs]);

  const fetchSummary = useCallback(async () => {
    try {
      const { data } = await workflowApi.documentSummary(workflowId);
      setSummary(data);
    } catch {}
  }, [workflowId]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const nodes = await fetchInputNodes();
      await Promise.all([fetchAllNodeDocs(nodes), fetchSummary()]);
    } finally {
      setLoading(false);
    }
  }, [fetchInputNodes, fetchAllNodeDocs, fetchSummary]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /* ── Per-node Upload ────────────────────────────────────────────────── */
  const handleNodeUpload = async (nodeId, e) => {
    const files = e.target.files;
    if (!files?.length) return;
    setNodeUploading(prev => ({ ...prev, [nodeId]: true }));
    const form = new FormData();
    for (const f of files) form.append('files', f);
    form.append('input_node_id', nodeId);
    try {
      const { data } = await workflowApi.upload(workflowId, form);
      const count = data.count || files.length;
      const zipInfo = data.zip_expanded;
      const msg = zipInfo
        ? `${count} file(s) uploaded (${zipInfo.files_extracted} from ${zipInfo.archives} ZIP)`
        : `${count} file(s) uploaded & extracting…`;
      notify.success(msg);
      fetchNodeDocs(nodeId);
      fetchSummary();
      onUpdate?.();
    } catch (err) {
      notify.error('Upload failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setNodeUploading(prev => ({ ...prev, [nodeId]: false }));
      e.target.value = '';
    }
  };

  /* ── Per-node Refresh ───────────────────────────────────────────────── */
  const handleNodeRefresh = async (nodeId) => {
    setNodeRefreshing(prev => ({ ...prev, [nodeId]: true }));
    try {
      const { data } = await workflowApi.refreshInput(workflowId, nodeId);
      notify.success(data.message || 'Refreshed');
      fetchNodeDocs(nodeId);
      fetchSummary();
      onUpdate?.();
    } catch (err) {
      notify.error('Refresh failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setNodeRefreshing(prev => ({ ...prev, [nodeId]: false }));
    }
  };

  /* ── Delete ─────────────────────────────────────────────────────────── */
  const handleDelete = async (docId, nodeId) => {
    try {
      await workflowApi.deleteDocument(workflowId, docId);
      notify.success('Document deleted');
      setConfirmDelete(null);
      if (nodeId) fetchNodeDocs(nodeId);
      fetchSummary();
      onUpdate?.();
    } catch {
      notify.error('Delete failed');
    }
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedDocs];
    let deleted = 0;
    for (const id of ids) {
      try { await workflowApi.deleteDocument(workflowId, id); deleted++; } catch {}
    }
    notify.success(`${deleted} document(s) deleted`);
    setSelectedDocs(new Set());
    setBulkAction(null);
    fetchAll();
    onUpdate?.();
  };

  /* ── Re-extract ─────────────────────────────────────────────────────── */
  const handleReextract = async (docId, nodeId) => {
    setReextractingIds(prev => new Set(prev).add(docId));
    try {
      await workflowApi.reextractDoc(workflowId, docId);
      notify.success('Re-extraction complete');
      if (nodeId) fetchNodeDocs(nodeId);
      fetchSummary();
    } catch {
      notify.error('Re-extraction failed');
    } finally {
      setReextractingIds(prev => { const n = new Set(prev); n.delete(docId); return n; });
    }
  };

  const handleBulkReextract = async () => {
    try {
      const { data } = await workflowApi.reextractAll(workflowId, { document_ids: [...selectedDocs] });
      notify.success(`${data.processed} document(s) re-extracted`);
      setBulkAction(null);
      setSelectedDocs(new Set());
      fetchAll();
    } catch {
      notify.error('Bulk re-extraction failed');
    }
  };

  const handleReextractByStatus = async (statusVal) => {
    try {
      const { data } = await workflowApi.reextractAll(workflowId, { status_filter: statusVal });
      notify.success(`${data.processed} document(s) re-extracted`);
      fetchAll();
    } catch {
      notify.error('Re-extraction failed');
    }
  };

  /* ── Selection ──────────────────────────────────────────────────────── */
  const toggleSelect = (id) => {
    setSelectedDocs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleNodeExpand = (nodeId) => {
    setExpandedNodes(prev => { const n = new Set(prev); n.has(nodeId) ? n.delete(nodeId) : n.add(nodeId); return n; });
  };

  /* ── Share / Upload Links ────────────────────────────────────────────── */
  const fetchUploadLinks = async () => {
    setShareLoading(true);
    try {
      const { data } = await workflowApi.uploadLinks(workflowId);
      setUploadLinks(data);
    } catch { notify.error('Failed to load upload links'); }
    finally { setShareLoading(false); }
  };

  const handleCreateLink = async () => {
    try {
      const body = {};
      if (newLinkLabel.trim()) body.label = newLinkLabel.trim();
      if (newLinkPassword.trim()) body.password = newLinkPassword.trim();
      if (newLinkRequireLogin !== 'none') body.require_login = newLinkRequireLogin;
      const { data } = await workflowApi.createUploadLink(workflowId, body);
      setUploadLinks(prev => [data, ...prev]);
      setNewLinkLabel(''); setNewLinkPassword(''); setNewLinkRequireLogin('none');
      notify.success('Upload link created!');
    } catch { notify.error('Failed to create upload link'); }
  };

  const handleDeleteLink = async (linkId) => {
    try {
      await workflowApi.deleteUploadLink(workflowId, linkId);
      setUploadLinks(prev => prev.filter(l => l.id !== linkId));
      notify.success('Link deleted');
    } catch { notify.error('Failed to delete link'); }
  };

  const handleToggleLink = async (linkId, isActive) => {
    try {
      const { data } = await workflowApi.updateUploadLink(workflowId, linkId, { is_active: !isActive });
      setUploadLinks(prev => prev.map(l => l.id === linkId ? data : l));
    } catch { notify.error('Failed to update link'); }
  };

  const getUploadUrl = (token) => `${window.location.origin}/clm/upload/${token}`;
  const copyLink = (token, linkId) => {
    navigator.clipboard.writeText(getUploadUrl(token));
    setCopiedLinkId(linkId);
    setTimeout(() => setCopiedLinkId(null), 2000);
    notify.success('Link copied!');
  };
  const openShareModal = () => { setShowShareModal(true); fetchUploadLinks(); };

  /* ── Aggregate ──────────────────────────────────────────────────────── */
  const totalDocCount = Object.values(nodeDocsMap).reduce((s, d) => s + (d?.document_count || 0), 0);
  const statusCounts = summary?.status_counts || {};

  // Aggregate document_state across all input nodes
  const aggState = Object.values(nodeDocsMap).reduce(
    (acc, d) => {
      const ds = d?.document_state || {};
      acc.ready += ds.ready_count || 0;
      acc.pending += ds.pending_count || 0;
      acc.failed += ds.failed_count || 0;
      acc.total += ds.total_count || 0;
      return acc;
    },
    { ready: 0, pending: 0, failed: 0, total: 0 },
  );

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b bg-white shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold text-gray-900 text-lg">Documents</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {totalDocCount} document{totalDocCount !== 1 ? 's' : ''} across {inputNodes.length} input node{inputNodes.length !== 1 ? 's' : ''}
              {aggState.total > 0 && (
                <> · <span className="text-emerald-500">{aggState.ready} ready</span>
                  {aggState.pending > 0 && <>, <span className="text-amber-500">{aggState.pending} pending</span></>}
                  {aggState.failed > 0 && <>, <span className="text-red-500">{aggState.failed} failed</span></>}
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectedDocs.size > 0 && (
              <div className="flex items-center gap-2 mr-2 px-3 py-1.5 bg-indigo-50 rounded-lg">
                <span className="text-xs font-medium text-indigo-700">{selectedDocs.size} selected</span>
                <button onClick={() => setBulkAction('reextract')} className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 font-medium">
                  <RefreshCw size={12} className="inline mr-1" />Re-extract
                </button>
                <button onClick={() => setBulkAction('delete')} className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 font-medium">
                  <Trash2 size={12} className="inline mr-1" />Delete
                </button>
              </div>
            )}
            <button onClick={openShareModal} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors" title="Create shareable upload link">
              <Share2 size={16} /> Share
              {uploadLinks.length > 0 && <span className="ml-0.5 bg-blue-200 text-blue-800 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{uploadLinks.length}</span>}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search documents…" className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" />
          </div>
          <div className="flex gap-1">
            {[
              { value: '', label: 'All', icon: null },
              { value: 'completed', label: 'Completed', icon: <CheckCircle2 size={12} /> },
              { value: 'pending', label: 'Pending', icon: <Clock size={12} /> },
              { value: 'failed', label: 'Failed', icon: <XCircle size={12} /> },
            ].map((f) => (
              <button key={f.value} onClick={() => setStatusFilter(f.value)} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${statusFilter === f.value ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}>
                {f.icon}{f.label}
                {f.value && statusCounts[f.value] != null && <span className="ml-1 text-[10px] opacity-70">({statusCounts[f.value]})</span>}
              </button>
            ))}
          </div>
          {statusCounts.failed > 0 && (
            <button onClick={() => handleReextractByStatus('failed')} className="ml-auto text-xs px-3 py-1.5 bg-amber-50 text-amber-700 rounded-md font-medium hover:bg-amber-100">
              <RefreshCw size={12} className="inline mr-1" />Retry All Failed
            </button>
          )}
        </div>
      </div>

      {/* Input Node Sections */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Spinner size="lg" className="text-indigo-500" /></div>
        ) : inputNodes.length === 0 ? (
          <EmptyState icon="📄" title="No input nodes" description="This workflow has no input nodes. Add an Input node on the canvas to start uploading documents." />
        ) : (
          inputNodes.map(node => (
            <InputNodeSection
              key={node.id} node={node} workflowId={workflowId}
              nodeData={nodeDocsMap[node.id]}
              expanded={expandedNodes.has(node.id)}
              onToggle={() => toggleNodeExpand(node.id)}
              uploading={!!nodeUploading[node.id]}
              refreshing={!!nodeRefreshing[node.id]}
              reextractingIds={reextractingIds}
              selectedDocs={selectedDocs}
              searchTerm={searchTerm}
              onUpload={(e) => handleNodeUpload(node.id, e)}
              onRefresh={() => handleNodeRefresh(node.id)}
              onSelect={toggleSelect}
              onDelete={(doc) => setConfirmDelete({ ...doc, _nodeId: node.id })}
              onReextract={(docId) => handleReextract(docId, node.id)}
              onViewText={setTextViewDoc}
              onEditFields={setFieldEditorDoc}
              onUpdateDocs={() => { fetchNodeDocs(node.id); fetchSummary(); }}
            />
          ))
        )}
      </div>

      {/* Modals */}
      <ConfirmModal open={!!confirmDelete} title="Delete Document" message={`Delete "${confirmDelete?.title}"? This removes the file and all extracted data permanently.`} confirmText="Delete" variant="danger" onConfirm={() => handleDelete(confirmDelete.id, confirmDelete._nodeId)} onCancel={() => setConfirmDelete(null)} />
      <ConfirmModal open={!!bulkAction} title={bulkAction === 'delete' ? 'Delete Selected' : 'Re-extract Selected'} message={bulkAction === 'delete' ? `Delete ${selectedDocs.size} document(s)?` : `Re-extract ${selectedDocs.size} document(s)?`} confirmText={bulkAction === 'delete' ? 'Delete All' : 'Re-extract All'} variant={bulkAction === 'delete' ? 'danger' : 'primary'} onConfirm={bulkAction === 'delete' ? handleBulkDelete : handleBulkReextract} onCancel={() => setBulkAction(null)} />
      <Modal open={!!textViewDoc} onClose={() => setTextViewDoc(null)} title={`Text — ${textViewDoc?.title}`} size="xl">
        {textViewDoc && <TextViewer doc={textViewDoc} />}
      </Modal>
      <Modal open={!!fieldEditorDoc} onClose={() => { setFieldEditorDoc(null); fetchAll(); }} title={`Fields — ${fieldEditorDoc?.title}`} size="xl">
        {fieldEditorDoc && <FieldEditor workflowId={workflowId} documentId={fieldEditorDoc.id} onUpdate={fetchAll} />}
      </Modal>
      {showShareModal && (
        <ShareModal uploadLinks={uploadLinks} shareLoading={shareLoading} newLinkLabel={newLinkLabel} newLinkPassword={newLinkPassword} newLinkRequireLogin={newLinkRequireLogin} copiedLinkId={copiedLinkId} onSetNewLinkLabel={setNewLinkLabel} onSetNewLinkPassword={setNewLinkPassword} onSetNewLinkRequireLogin={setNewLinkRequireLogin} onCreateLink={handleCreateLink} onDeleteLink={handleDeleteLink} onToggleLink={handleToggleLink} onCopyLink={copyLink} getUploadUrl={getUploadUrl} onClose={() => setShowShareModal(false)} />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   InputNodeSection
   ═══════════════════════════════════════════════════════════════════════════ */
function InputNodeSection({
  node, workflowId, nodeData, expanded, onToggle,
  uploading, refreshing, reextractingIds, selectedDocs, searchTerm,
  onUpload, onRefresh, onSelect, onDelete, onReextract, onViewText, onEditFields, onUpdateDocs,
}) {
  const config = node.config || {};
  const sourceType = config.source_type || 'upload';
  const meta = getSourceMeta(sourceType);
  const SrcIcon = meta.icon;
  const documents = nodeData?.documents || [];
  const docCount = nodeData?.document_count ?? documents.length;
  const isEmail = sourceType === 'email_inbox';

  // Document state from the backend — tracks readiness per node
  const ds = nodeData?.document_state || node.document_state || {};
  const readyCount = ds.ready_count ?? 0;
  const pendingCount = ds.pending_count ?? 0;
  const failedCount = ds.failed_count ?? 0;
  const totalState = ds.total_count ?? docCount;
  const allReady = totalState > 0 && readyCount === totalState;

  const filtered = documents.filter(d => {
    if (searchTerm && !d.title?.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden transition-all hover:border-gray-300">
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-gray-50/60 transition-colors" onClick={onToggle}>
        <span className="text-gray-400">{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${sourceType === 'table' ? 'bg-emerald-50' : isEmail ? 'bg-amber-50' : 'bg-blue-50'}`}>
          <SrcIcon size={16} className={sourceType === 'table' ? 'text-emerald-600' : isEmail ? 'text-amber-600' : 'text-blue-600'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-gray-900 truncate">{node.label || 'Input'}</span>
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${sourceType === 'table' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : isEmail ? 'bg-amber-50 text-amber-600 border border-amber-200' : 'bg-blue-50 text-blue-600 border border-blue-200'}`}>{meta.label}</span>
            {allReady && totalState > 0 && <CheckCircle2 size={14} className="text-emerald-500" title="All documents ready" />}
            {pendingCount > 0 && <Clock size={14} className="text-amber-400" title={`${pendingCount} pending`} />}
            {failedCount > 0 && <XCircle size={14} className="text-red-400" title={`${failedCount} failed`} />}
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {docCount} document{docCount !== 1 ? 's' : ''}
            {totalState > 0 && (
              <>
                {' · '}
                {allReady ? (
                  <span className="text-emerald-500">✓ All ready</span>
                ) : (
                  <>
                    {readyCount > 0 && <span className="text-emerald-500">{readyCount} ready</span>}
                    {pendingCount > 0 && <span className="text-amber-500">{readyCount > 0 ? ', ' : ''}{pendingCount} pending</span>}
                    {failedCount > 0 && <span className="text-red-500">{(readyCount > 0 || pendingCount > 0) ? ', ' : ''}{failedCount} failed</span>}
                  </>
                )}
              </>
            )}
            {isEmail && config.email_user && ` · ${config.email_user}`}
            {sourceType === 'google_drive' && config.google_folder_id && ' · Folder linked'}
            {sourceType === 'table' && config.table_info && ` · ${config.table_info.row_count}r × ${config.table_info.col_count}c`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
          {meta.canUpload && (
            <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${uploading ? 'bg-gray-100 text-gray-400 cursor-wait' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
              {uploading ? <><Spinner size="sm" className="text-white" /> Uploading…</> : <><Upload size={13} /> Upload</>}
              <input type="file" multiple accept=".pdf,.docx,.doc,.txt,.xlsx,.xls,.csv,.pptx,.ppt,.jpg,.jpeg,.png,.gif,.bmp,.tiff,.webp,.html,.htm,.md,.rtf,.odt,.zip" onChange={onUpload} className="hidden" disabled={uploading} />
            </label>
          )}
          {meta.canRefresh && (
            <button onClick={onRefresh} disabled={refreshing} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${refreshing ? 'bg-gray-100 text-gray-400 cursor-wait' : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'}`} title={isEmail ? 'Check inbox' : 'Refresh'}>
              {refreshing ? <><Spinner size="sm" className="text-blue-500" /> Fetching…</> : <><RefreshCw size={13} /> {isEmail ? 'Check Inbox' : 'Refresh'}</>}
            </button>
          )}
          {sourceType === 'webhook' && <span className="text-[10px] text-gray-400 italic">Receives via API</span>}
        </div>
      </div>
      {expanded && (
        <div className="border-t border-gray-100">
          {/* Email state banner — shows cached stats for email_inbox nodes */}
          {isEmail && (
            <div className="px-4 py-2 bg-amber-50/50 border-b border-amber-100 flex items-center gap-4 text-[11px] text-amber-700">
              <Mail size={13} className="text-amber-500 shrink-0" />
              {(() => {
                const es = ds.email_state || nodeData?.email_state || {};
                const seenCount = es.seen_count ?? 0;
                const cumFound = es.cumulative_found ?? 0;
                const cumSkipped = es.cumulative_skipped ?? 0;
                const lastChecked = es.last_checked_at || config.email_last_checked_at || '';
                const lastCheckedLabel = lastChecked ? new Date(lastChecked).toLocaleString() : 'Never';
                return (
                  <>
                    <span><strong>{seenCount}</strong> unique email{seenCount !== 1 ? 's' : ''} seen</span>
                    <span className="text-amber-300">·</span>
                    <span><strong>{cumFound}</strong> ingested</span>
                    <span className="text-amber-300">·</span>
                    <span><strong>{cumSkipped}</strong> skipped (cached)</span>
                    <span className="text-amber-300">·</span>
                    <span>Last checked: {lastCheckedLabel}</span>
                    {config.email_refetch_interval > 0 && (
                      <>
                        <span className="text-amber-300">·</span>
                        <span className="inline-flex items-center gap-1"><Clock size={11} /> Auto-poll every {config.email_refetch_interval}s</span>
                      </>
                    )}
                  </>
                );
              })()}
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-gray-400">
                {documents.length === 0
                  ? meta.canUpload ? 'No documents yet. Upload files to get started.'
                    : isEmail ? 'No emails fetched yet. Click "Check Inbox".'
                    : 'No documents yet. Click "Refresh" to fetch.'
                  : 'No documents match your search.'}
              </p>
            </div>
          ) : (
            <div className="px-4 py-3 space-y-2">
              {filtered.map(doc => (
                <DocumentCard key={doc.id} doc={doc} workflowId={workflowId} selected={selectedDocs.has(doc.id)} reextracting={reextractingIds.has(doc.id)} showReextract={meta.canReextract} onSelect={() => onSelect(doc.id)} onDelete={() => onDelete(doc)} onReextract={() => onReextract(doc.id)} onViewText={() => onViewText(doc)} onEditFields={() => onEditFields(doc)} onUpdate={onUpdateDocs} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   DocumentCard
   ═══════════════════════════════════════════════════════════════════════════ */
function DocumentCard({ doc, workflowId, selected, reextracting, showReextract = true, onSelect, onDelete, onReextract, onViewText, onEditFields }) {
  const fileUrl = getDocumentFileUrl(doc);
  return (
    <div className={`bg-white rounded-lg border transition-all ${selected ? 'ring-2 ring-indigo-200 border-indigo-300' : 'border-gray-200 hover:border-gray-300'}`}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <input type="checkbox" checked={selected} onChange={onSelect} className="rounded border-gray-300 text-indigo-600 shrink-0" />
        <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center shrink-0">{getDocFileIcon(doc.file_type)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-gray-900 truncate">{doc.title}</span>
            <SourceBadge source={doc.text_source} />
            {doc.global_metadata?._source === 'public_upload' && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-50 text-violet-600 border border-violet-200"><Link2 size={10} />Via link</span>}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[11px] text-gray-400">
            <span>{doc.file_type?.toUpperCase()}</span>
            <span>{(doc.file_size / 1024).toFixed(1)} KB</span>
            <span>{new Date(doc.created_at).toLocaleDateString()}</span>
            {doc.field_count > 0 && <span>{doc.field_count} fields</span>}
            {doc.global_metadata?._source === 'public_upload' && doc.global_metadata._uploader_name && <span className="inline-flex items-center gap-1"><User size={10} />{doc.global_metadata._uploader_name}{doc.global_metadata._verified && <ShieldCheck size={10} className="text-emerald-500" />}</span>}
          </div>
        </div>
        <div className="w-20 shrink-0"><ConfidenceBar value={doc.overall_confidence} /></div>
        <StatusBadge status={doc.extraction_status} />
        <div className="flex items-center gap-1 shrink-0">
          <Link to={`/clm/documents/${workflowId}/${doc.id}?from=/clm/workflows/${workflowId}`} className="p-1.5 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-md transition-colors" title="View PDF"><Eye size={14} /></Link>
          {showReextract && (reextracting ? <Spinner size="sm" className="text-blue-500" /> : <button onClick={onReextract} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors" title="Re-extract"><RefreshCw size={14} /></button>)}
          <button onClick={onViewText} className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-md transition-colors" title="View text"><ScanText size={14} /></button>
          <button onClick={onEditFields} className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors" title="Edit fields"><Edit3 size={14} /></button>
          {fileUrl && <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-md transition-colors" title="Download"><Download size={14} /></a>}
          <button onClick={onDelete} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors" title="Delete"><Trash2 size={14} /></button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TextViewer
   ═══════════════════════════════════════════════════════════════════════════ */
function TextViewer({ doc }) {
  const [tab, setTab] = useState(doc.text_source === 'ocr' ? 'ocr' : 'direct');
  const tabs = [
    { id: 'direct', label: `Direct Text (${(doc.direct_text?.length || 0).toLocaleString()} chars)` },
    { id: 'ocr',    label: `OCR Text (${(doc.ocr_text?.length || 0).toLocaleString()} chars)` },
  ];
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
        <div className="flex items-center gap-2 text-xs text-gray-400"><span>Used for extraction:</span><SourceBadge source={doc.text_source} /></div>
      </div>
      <div className="bg-gray-50 rounded-lg p-4 max-h-[60vh] overflow-y-auto">
        <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
          {tab === 'direct' ? (doc.direct_text || '(No direct text)') : (doc.ocr_text || '(No OCR text)')}
        </pre>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ShareModal
   ═══════════════════════════════════════════════════════════════════════════ */
function ShareModal({ uploadLinks, shareLoading, newLinkLabel, newLinkPassword, newLinkRequireLogin, copiedLinkId, onSetNewLinkLabel, onSetNewLinkPassword, onSetNewLinkRequireLogin, onCreateLink, onDeleteLink, onToggleLink, onCopyLink, getUploadUrl, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg pointer-events-auto overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="px-6 py-4 border-b flex items-center justify-between">
            <div className="flex items-center gap-2"><Share2 size={18} className="text-blue-600" /><h2 className="text-base font-bold text-gray-800">Share Upload Link</h2></div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
          </div>
          <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
            <div className="mb-5 bg-blue-50 rounded-xl p-4 border border-blue-100">
              <p className="text-xs font-semibold text-blue-800 mb-3">Create New Upload Link</p>
              <div className="space-y-2">
                <input type="text" value={newLinkLabel} onChange={e => onSetNewLinkLabel(e.target.value)} placeholder="Label (optional)" className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                <input type="text" value={newLinkPassword} onChange={e => onSetNewLinkPassword(e.target.value)} placeholder="Password (optional)" className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                <div>
                  <label className="block text-[11px] font-medium text-blue-700 mb-1">Require verification</label>
                  <select value={newLinkRequireLogin} onChange={e => onSetNewLinkRequireLogin(e.target.value)} className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
                    <option value="none">No verification required</option>
                    <option value="email_otp">Email OTP verification</option>
                    <option value="phone_otp">Phone OTP verification</option>
                  </select>
                </div>
              </div>
              <button onClick={onCreateLink} className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors flex items-center gap-1.5"><LinkIcon size={13} /> Generate Link</button>
            </div>
            {shareLoading ? (
              <div className="flex items-center justify-center py-6"><Loader2 className="w-5 h-5 text-gray-400 animate-spin" /></div>
            ) : uploadLinks.length === 0 ? (
              <div className="text-center py-6 text-sm text-gray-400"><LinkIcon size={24} className="mx-auto mb-2 text-gray-300" />No upload links yet</div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Active Links ({uploadLinks.length})</p>
                {uploadLinks.map(link => (
                  <div key={link.id} className={`border rounded-xl p-4 transition-colors ${link.is_usable ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${link.is_usable ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{link.is_usable ? 'Active' : link.is_expired ? 'Expired' : link.is_at_limit ? 'Limit reached' : 'Disabled'}</span>
                          {link.password && <span className="text-[10px] text-amber-600">🔒 Password</span>}
                          {link.require_login === 'email_otp' && <span className="text-[10px] text-blue-600">📧 Email OTP</span>}
                          {link.require_login === 'phone_otp' && <span className="text-[10px] text-purple-600">📱 Phone OTP</span>}
                        </div>
                        {link.label && <p className="text-sm font-medium text-gray-800 mt-1">{link.label}</p>}
                        <p className="text-[10px] text-gray-400 mt-1 font-mono truncate">{getUploadUrl(link.token)}</p>
                        <p className="text-[10px] text-gray-400 mt-1">{link.upload_count} upload{link.upload_count !== 1 ? 's' : ''} · Created {new Date(link.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => onCopyLink(link.token, link.id)} className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors" title="Copy">{copiedLinkId === link.id ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} />}</button>
                        <a href={getUploadUrl(link.token)} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors" title="Open"><ExternalLink size={14} /></a>
                        <button onClick={() => onToggleLink(link.id, link.is_active)} className={`p-1.5 rounded-lg transition-colors ${link.is_active ? 'hover:bg-amber-50 text-gray-400 hover:text-amber-600' : 'hover:bg-emerald-50 text-gray-400 hover:text-emerald-600'}`} title={link.is_active ? 'Disable' : 'Enable'}><Eye size={14} /></button>
                        <button onClick={() => onDeleteLink(link.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" title="Delete"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="px-6 py-3 border-t bg-gray-50 flex justify-end"><button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Close</button></div>
        </div>
      </div>
    </>
  );
}
