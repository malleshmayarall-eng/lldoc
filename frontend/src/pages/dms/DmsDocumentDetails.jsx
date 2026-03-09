import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, FileText, Download, RefreshCw, ChevronDown, ChevronRight,
  Calendar, User, Tag, Shield, Clock, File, Hash, Globe, Pen,
  CheckCircle2, XCircle, AlertTriangle, Eye, BookOpen, Users,
} from 'lucide-react';
import { dmsService } from '../../services/dmsService';

/* ─── helpers ─── */
const fmtDate = (d) => {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
};
const fmtDateTime = (d) => {
  if (!d) return null;
  try { return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return d; }
};
const fmtSize = (bytes) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
};

/* ─── collapsible section ─── */
const Section = ({ title, icon: Icon, defaultOpen = true, badge, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50/50 transition-colors"
      >
        {Icon && <Icon size={14} className="text-gray-400 shrink-0" />}
        <span className="text-xs font-semibold text-gray-700 flex-1">{title}</span>
        {badge && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">{badge}</span>}
        {open ? <ChevronDown size={12} className="text-gray-400" /> : <ChevronRight size={12} className="text-gray-400" />}
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
};

/* ─── metadata row ─── */
const Row = ({ label, value, highlight, mono }) => {
  if (!value && value !== 0 && value !== false) return null;
  return (
    <div className="flex items-start gap-2 py-1">
      <span className="text-[11px] text-gray-400 w-28 shrink-0">{label}</span>
      <span className={`text-[11px] flex-1 break-all ${highlight ? 'font-semibold text-gray-900' : 'text-gray-600'} ${mono ? 'font-mono' : ''}`}>
        {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
      </span>
    </div>
  );
};

/* ─── status badge ─── */
const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-700',
  under_review: 'bg-yellow-100 text-yellow-800',
  analyzed: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  finalized: 'bg-emerald-100 text-emerald-800',
  active: 'bg-green-100 text-green-700',
  expired: 'bg-red-100 text-red-700',
};

const DmsDocumentDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('info'); // info | text | metadata

  /* ── load document metadata ── */
  const loadDocument = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await dmsService.getDocument(id, { includePdf: false });
      setDoc(data);
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Failed to load document.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  /* ── load PDF blob for preview ── */
  const loadPdf = useCallback(async () => {
    if (!id) return;
    setPdfLoading(true);
    try {
      const blob = await dmsService.downloadDocument(id);
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
    } catch {
      // Fallback: try base64
      try {
        const data = await dmsService.getDocument(id, { includePdf: true });
        if (data?.pdf_base64) {
          setPdfUrl(`data:application/pdf;base64,${data.pdf_base64}`);
        }
      } catch { /* silent */ }
    } finally {
      setPdfLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadDocument();
    loadPdf();
    return () => { if (pdfUrl && pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl); };
  }, [loadDocument, loadPdf]);

  /* ── download ── */
  const handleDownload = async () => {
    if (!id) return;
    try {
      const blob = await dmsService.downloadDocument(id);
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = doc?.original_filename || doc?.title || `document-${id}.pdf`;
      window.document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch { /* silent */ }
  };

  const displayName = doc?.title || doc?.original_filename || 'Untitled Document';
  const statusClass = STATUS_COLORS[doc?.status] || 'bg-gray-100 text-gray-600';

  /* ── collect date fields ── */
  const dates = doc ? [
    { label: 'Uploaded', value: fmtDate(doc.uploaded_date) },
    { label: 'Signed', value: fmtDate(doc.signed_date) },
    { label: 'Effective', value: fmtDate(doc.effective_date) },
    { label: 'Expiration', value: fmtDate(doc.expiration_date) },
    { label: 'Termination', value: fmtDate(doc.termination_date) },
    { label: 'Archived', value: fmtDate(doc.archived_date) },
    { label: 'Renewal', value: fmtDate(doc.renewal_date) },
    { label: 'Renewed', value: fmtDate(doc.renewed_date) },
    { label: 'Created', value: fmtDateTime(doc.created_at) },
    { label: 'Modified', value: fmtDateTime(doc.updated_at) },
  ].filter(d => d.value) : [];

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/dms')}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors shrink-0"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
            <FileText size={16} className="text-blue-500" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-gray-900 truncate">{displayName}</h1>
            <p className="text-[10px] text-gray-400 truncate font-mono">{id}</p>
          </div>
          {doc?.status && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${statusClass}`}>
              {doc.status.replace(/_/g, ' ')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => { loadDocument(); loadPdf(); }}
            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading || pdfLoading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors"
          >
            <Download size={13} /> Download
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Main split layout ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── LEFT: PDF Preview ── */}
        <div className="flex-1 flex flex-col bg-gray-100 min-w-0">
          {pdfLoading && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin mx-auto w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mb-3" />
                <p className="text-sm text-gray-500">Loading PDF preview…</p>
              </div>
            </div>
          )}
          {!pdfLoading && pdfUrl && (
            <iframe
              title="PDF Preview"
              src={pdfUrl}
              className="flex-1 w-full border-0"
            />
          )}
          {!pdfLoading && !pdfUrl && (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <File size={48} className="mx-auto mb-3 text-gray-200" />
                <p className="text-sm font-medium">PDF preview not available</p>
                <button
                  onClick={loadPdf}
                  className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  Try loading again
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT: Metadata Sidebar ── */}
        <div className="w-[380px] shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-hidden">
          {/* Sidebar tabs */}
          <div className="flex border-b border-gray-100 shrink-0">
            {[
              { key: 'info', label: 'Details', icon: Eye },
              { key: 'text', label: 'Text', icon: BookOpen },
              { key: 'metadata', label: 'Raw', icon: Hash },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex-1 flex items-center justify-center gap-1 py-2 text-[11px] font-medium border-b-2 transition-colors
                  ${activeTab === key
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>

          {/* Sidebar content */}
          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
              </div>
            )}

            {!loading && doc && activeTab === 'info' && (
              <div>
                {/* Document Info */}
                <Section title="Document Info" icon={FileText}>
                  <Row label="Title" value={doc.title} highlight />
                  <Row label="Filename" value={doc.original_filename} mono />
                  <Row label="Document ID" value={doc.document_id} mono />
                  <Row label="Document Name" value={doc.document_name} />
                  <Row label="Type" value={doc.document_type} />
                  <Row label="Category" value={doc.category} />
                  <Row label="Status" value={doc.status} />
                  <Row label="File Size" value={fmtSize(doc.file_size)} />
                  <Row label="Pages" value={doc.extracted_pdf_page_count} />
                  <Row label="Content Type" value={doc.content_type} />
                </Section>

                {/* PDF Metadata */}
                <Section title="PDF Metadata" icon={File} defaultOpen={false}>
                  <Row label="PDF Title" value={doc.extracted_pdf_title} />
                  <Row label="Author" value={doc.extracted_pdf_author} />
                  <Row label="Subject" value={doc.extracted_pdf_subject} />
                  <Row label="Creator" value={doc.extracted_pdf_creator} />
                  <Row label="Producer" value={doc.extracted_pdf_producer} />
                  <Row label="Keywords" value={doc.extracted_pdf_keywords} />
                </Section>

                {/* Dates */}
                {dates.length > 0 && (
                  <Section title="Dates & Timeline" icon={Calendar} badge={`${dates.length}`}>
                    {dates.map(({ label, value }) => (
                      <Row key={label} label={label} value={value} />
                    ))}
                  </Section>
                )}

                {/* Signing */}
                <Section title="Signing" icon={Pen} defaultOpen={false}>
                  <Row label="Signed" value={doc.signing_is_signed} />
                  <Row label="Signature Type" value={doc.signature_type} />
                </Section>

                {/* Compliance */}
                <Section title="Compliance" icon={Shield} defaultOpen={false}>
                  <Row label="Jurisdiction" value={doc.compliance_jurisdiction} />
                  <Row label="Legal Hold" value={doc.compliance_legal_hold} />
                  <Row label="Retention End" value={fmtDate(doc.compliance_retention_end_date)} />
                  <Row label="Review Due" value={fmtDate(doc.compliance_review_due_date)} />
                  <Row label="Audit Log At" value={fmtDateTime(doc.audit_log_generated_at)} />
                  <Row label="Verify Retention" value={fmtDate(doc.verification_retention_end_date)} />
                </Section>

                {/* Renewal */}
                <Section title="Renewal & Termination" icon={AlertTriangle} defaultOpen={false}>
                  <Row label="Auto Renewal" value={doc.auto_renewal_enabled} />
                  <Row label="Renewal Decision" value={doc.renewal_decision_required} />
                  <Row label="Renewal Date" value={fmtDate(doc.renewal_date)} />
                  <Row label="Renewed" value={fmtDate(doc.renewed_date)} />
                  <Row label="Term. Initiated" value={fmtDate(doc.termination_initiated_date)} />
                  <Row label="Term. Notice Start" value={fmtDate(doc.termination_notice_start_date)} />
                  <Row label="Deletion Eligible" value={fmtDate(doc.deletion_eligible_date)} />
                  <Row label="Deletion Scheduled" value={fmtDate(doc.deletion_scheduled_date)} />
                </Section>

                {/* Signatories */}
                {doc.signatories?.length > 0 && (
                  <Section title="Signatories" icon={Users} badge={`${doc.signatories.length}`}>
                    <div className="space-y-2">
                      {doc.signatories.map((s, i) => (
                        <div key={s.id || i} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                          <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-[10px] font-bold text-blue-600 shrink-0">
                            {(s.name || '?')[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[11px] font-medium text-gray-900 truncate">{s.name || 'Unnamed'}</p>
                            {(s.role || s.organization) && (
                              <p className="text-[10px] text-gray-500 truncate">
                                {[s.role, s.organization].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Notes */}
                {doc.notes && (
                  <Section title="Notes" icon={BookOpen} defaultOpen={false}>
                    <p className="text-[11px] text-gray-600 whitespace-pre-wrap">{doc.notes}</p>
                  </Section>
                )}

                {/* Uploaded By */}
                {(doc.created_by || doc.created_by_name) && (
                  <Section title="Uploaded By" icon={User} defaultOpen={false}>
                    <Row label="User ID" value={doc.created_by} mono />
                    {doc.created_by_name && <Row label="Name" value={doc.created_by_name} />}
                  </Section>
                )}
              </div>
            )}

            {!loading && doc && activeTab === 'text' && (
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-700">Extracted Text</span>
                  {doc.extracted_text && (
                    <span className="text-[10px] text-gray-400">
                      {doc.extracted_text.length.toLocaleString()} chars
                    </span>
                  )}
                </div>
                {doc.extracted_text ? (
                  <div className="bg-gray-50 rounded-lg p-3 text-[11px] text-gray-600 leading-relaxed whitespace-pre-wrap max-h-[calc(100vh-200px)] overflow-y-auto font-mono">
                    {doc.extracted_text}
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-400">
                    <BookOpen size={32} className="mx-auto mb-2 text-gray-200" />
                    <p className="text-xs">No extracted text available</p>
                  </div>
                )}
              </div>
            )}

            {!loading && doc && activeTab === 'metadata' && (
              <div className="p-4">
                <span className="text-xs font-semibold text-gray-700 mb-2 block">Raw Metadata (JSON)</span>
                <pre className="bg-gray-50 rounded-lg p-3 text-[10px] text-gray-600 leading-relaxed whitespace-pre-wrap max-h-[calc(100vh-200px)] overflow-y-auto font-mono">
                  {JSON.stringify(doc.metadata || {}, null, 2)}
                </pre>
                {doc.extracted_pdf_raw_metadata && (
                  <>
                    <span className="text-xs font-semibold text-gray-700 mt-4 mb-2 block">PDF Raw Metadata</span>
                    <pre className="bg-gray-50 rounded-lg p-3 text-[10px] text-gray-600 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto font-mono">
                      {typeof doc.extracted_pdf_raw_metadata === 'string'
                        ? (() => { try { return JSON.stringify(JSON.parse(doc.extracted_pdf_raw_metadata), null, 2); } catch { return doc.extracted_pdf_raw_metadata; } })()
                        : JSON.stringify(doc.extracted_pdf_raw_metadata, null, 2)}
                    </pre>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DmsDocumentDetails;
