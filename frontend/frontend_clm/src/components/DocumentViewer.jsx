import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { workflowApi, getDocumentFileUrl } from '../api/clmApi';
import { StatusBadge, ConfidenceBar, SourceBadge, Spinner, Tabs } from './ui/SharedUI';
import notify from '../utils/notify';
import {
  ArrowLeft, Info, X, FileText, Calendar, User, Hash, Database,
  ChevronDown, ChevronRight, Download, RefreshCw, Eye, EyeOff,
  CheckCircle2, AlertTriangle, Clock, Layers, ScanText, Braces,
  ZoomIn, ZoomOut, Maximize2, Image, FileSpreadsheet, Presentation,
  FileCode, File, FileType,
} from 'lucide-react';

/* ── File-type helpers ───────────────────────────────────────────────── */
const IMAGE_TYPES = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg']);
const TEXT_TYPES  = new Set(['txt', 'md', 'csv', 'rtf']);
const CODE_TYPES  = new Set(['html', 'htm', 'json', 'xml']);

function getFileTypeGroup(fileType) {
  const ft = (fileType || '').toLowerCase();
  if (ft === 'pdf') return 'pdf';
  if (IMAGE_TYPES.has(ft)) return 'image';
  if (TEXT_TYPES.has(ft)) return 'text';
  if (CODE_TYPES.has(ft)) return 'code';
  if (['xlsx', 'xls', 'csv'].includes(ft)) return 'spreadsheet';
  if (['pptx', 'ppt'].includes(ft)) return 'presentation';
  if (['docx', 'doc', 'odt'].includes(ft)) return 'document';
  return 'other';
}

function getFileIcon(fileType, size = 16) {
  const group = getFileTypeGroup(fileType);
  const props = { size };
  switch (group) {
    case 'pdf':          return <FileText {...props} className="text-red-500" />;
    case 'image':        return <Image {...props} className="text-emerald-500" />;
    case 'spreadsheet':  return <FileSpreadsheet {...props} className="text-green-600" />;
    case 'presentation': return <Presentation {...props} className="text-orange-500" />;
    case 'code':         return <FileCode {...props} className="text-cyan-600" />;
    case 'document':     return <FileText {...props} className="text-blue-500" />;
    case 'text':         return <FileType {...props} className="text-violet-500" />;
    default:             return <File {...props} className="text-gray-500" />;
  }
}

function getFileIconBg(fileType) {
  const group = getFileTypeGroup(fileType);
  switch (group) {
    case 'pdf':          return 'bg-red-50';
    case 'image':        return 'bg-emerald-50';
    case 'spreadsheet':  return 'bg-green-50';
    case 'presentation': return 'bg-orange-50';
    case 'code':         return 'bg-cyan-50';
    case 'document':     return 'bg-blue-50';
    case 'text':         return 'bg-violet-50';
    default:             return 'bg-gray-100';
  }
}

/**
 * DocumentViewer — Full-page PDF viewer with metadata info panel.
 * 
 * Route: /documents/:workflowId/:documentId
 * 
 * Features:
 * - PDF preview (iframe/embed) taking full viewport
 * - Info (ℹ) toggle button to show/hide metadata side panel
 * - Metadata panel shows: document info, global metadata, workflow metadata,
 *   extracted fields, OCR/text stats, confidence scores
 */
export default function DocumentViewer() {
  const { workflowId, documentId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [doc, setDoc] = useState(null);
  const [fields, setFields] = useState({ global: [], workflow: [], total_count: 0 });
  const [textStats, setTextStats] = useState(null);
  const [ocrMeta, setOcrMeta] = useState(null);
  const [journey, setJourney] = useState(null);
  const [loading, setLoading] = useState(true);
  const [infoPanelOpen, setInfoPanelOpen] = useState(true);
  const [activeTab, setActiveTab] = useState('metadata');
  const [expandedSections, setExpandedSections] = useState({
    info: true, global: true, workflow: true, fields: true, text: true, confidence: true,
  });

  const returnTo = searchParams.get('from') || `/workflows/${workflowId}`;

  // ── Fetch document detail ──────────────────────────────────────────────
  const fetchDetail = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await workflowApi.documentDetail(workflowId, documentId);
      setDoc(data.document);
      setFields(data.fields);
      setTextStats(data.text_stats);
      setOcrMeta(data.ocr_metadata || data.document?.ocr_metadata || null);
      setJourney(data.journey || null);
    } catch (err) {
      notify.error('Failed to load document');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [workflowId, documentId]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const toggleSection = (key) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const fileUrl = doc ? getDocumentFileUrl(doc) : null;
  // Ensure the URL works — if relative, prefix with origin for the iframe
  // Append PDF viewer params to fit the page in view
  const pdfUrl = fileUrl
    ? (fileUrl.includes('#') ? fileUrl : fileUrl + '#view=FitH')
    : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <Spinner size="lg" className="text-indigo-500" />
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-56px)] gap-4">
        <FileText size={48} className="text-gray-300" />
        <p className="text-gray-500">Document not found</p>
        <button onClick={() => navigate(returnTo)} className="text-indigo-600 text-sm hover:underline">
          ← Go back
        </button>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col">
      {/* ── Top Bar ─────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-3 shrink-0">
        <button
          onClick={() => navigate(returnTo)}
          className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
          title="Go back"
        >
          <ArrowLeft size={18} />
        </button>

        <div className={`w-8 h-8 rounded-lg ${getFileIconBg(doc.file_type)} flex items-center justify-center shrink-0`}>
          {getFileIcon(doc.file_type)}
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-gray-900 truncate">{doc.title}</h1>
          <div className="flex items-center gap-3 text-[11px] text-gray-400">
            <span>{doc.file_type?.toUpperCase()}</span>
            <span>{(doc.file_size / 1024).toFixed(1)} KB</span>
            <span>{new Date(doc.created_at).toLocaleDateString()}</span>
            <StatusBadge status={doc.extraction_status} />
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
              title="Download file"
            >
              <Download size={16} />
            </a>
          )}
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              title="Open in new tab"
            >
              <Maximize2 size={16} />
            </a>
          )}
          <button
            onClick={() => setInfoPanelOpen(!infoPanelOpen)}
            className={`p-2 rounded-lg transition-all flex items-center gap-1.5 text-sm font-medium ${
              infoPanelOpen
                ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-200'
                : 'text-gray-500 hover:text-indigo-600 hover:bg-indigo-50'
            }`}
            title="Toggle document info"
          >
            <Info size={16} />
            <span className="hidden sm:inline">{infoPanelOpen ? 'Hide Info' : 'Info'}</span>
          </button>
        </div>
      </div>

      {/* ── Main Content ─────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* File Viewer */}
        <div className={`flex-1 bg-gray-800 transition-all duration-300 ${infoPanelOpen ? 'mr-0' : ''}`}>
          <FilePreview fileUrl={pdfUrl} doc={doc} />
        </div>

        {/* ── Info Side Panel ─────────────────────────────── */}
        {infoPanelOpen && (
          <div className="w-[420px] bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-hidden">
            {/* Panel Header */}
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Info size={16} className="text-indigo-500" />
                <h2 className="text-sm font-semibold text-gray-800">Document Info</h2>
              </div>
              <button
                onClick={() => setInfoPanelOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              >
                <X size={14} />
              </button>
            </div>

            {/* Panel Tabs */}
            <div className="px-4 pt-3 shrink-0">
              <Tabs
                tabs={[
                  { id: 'overview', label: 'Overview' },
                  { id: 'journey', label: 'Journey' },
                  { id: 'metadata', label: 'Metadata' },
                  { id: 'fields', label: `Fields (${fields.total_count})` },
                  { id: 'ocr', label: 'OCR' },
                  { id: 'text', label: 'Text' },
                ]}
                active={activeTab}
                onChange={setActiveTab}
              />
            </div>

            {/* Panel Content */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {activeTab === 'overview' && (
                <OverviewTab doc={doc} textStats={textStats} fields={fields} ocrMeta={ocrMeta} />
              )}
              {activeTab === 'journey' && (
                <JourneyTab journey={journey} />
              )}
              {activeTab === 'metadata' && (
                <MetadataTab doc={doc} />
              )}
              {activeTab === 'fields' && (
                <FieldsTab fields={fields} />
              )}
              {activeTab === 'ocr' && (
                <OcrTab ocrMeta={ocrMeta} textStats={textStats} doc={doc} />
              )}
              {activeTab === 'text' && (
                <TextTab doc={doc} textStats={textStats} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
   FilePreview — renders the correct preview based on file type
   ═══════════════════════════════════════════════════════════════════════════ */

function FilePreview({ fileUrl, doc }) {
  const [zoom, setZoom] = useState(100);
  const [textContent, setTextContent] = useState(null);
  const [loadingText, setLoadingText] = useState(false);

  const ft = (doc?.file_type || '').toLowerCase();
  const group = getFileTypeGroup(ft);

  // Fetch text content for text/code previews
  useEffect(() => {
    if (!fileUrl || (group !== 'text' && group !== 'code')) return;
    setLoadingText(true);
    fetch(fileUrl)
      .then((res) => res.text())
      .then((text) => setTextContent(text))
      .catch(() => setTextContent(null))
      .finally(() => setLoadingText(false));
  }, [fileUrl, group]);

  if (!fileUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <File size={64} className="text-gray-500" />
        <p className="text-gray-400 text-sm">No file available</p>
      </div>
    );
  }

  // PDF — iframe embed
  if (ft === 'pdf') {
    return (
      <iframe
        src={fileUrl}
        className="w-full h-full border-0"
        title={doc.title}
      />
    );
  }

  // Images — inline <img> with zoom controls
  if (group === 'image') {
    return (
      <div className="relative w-full h-full flex flex-col">
        {/* Zoom toolbar */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-gray-900/80 backdrop-blur rounded-lg px-2 py-1.5 shadow-lg">
          <button
            onClick={() => setZoom((z) => Math.max(25, z - 25))}
            className="p-1 text-gray-300 hover:text-white rounded transition-colors"
            title="Zoom out"
          >
            <ZoomOut size={16} />
          </button>
          <span className="text-xs text-gray-300 font-medium w-12 text-center">{zoom}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(400, z + 25))}
            className="p-1 text-gray-300 hover:text-white rounded transition-colors"
            title="Zoom in"
          >
            <ZoomIn size={16} />
          </button>
          <div className="w-px h-4 bg-gray-600 mx-1" />
          <button
            onClick={() => setZoom(100)}
            className="px-1.5 py-0.5 text-[10px] text-gray-300 hover:text-white rounded transition-colors font-medium"
            title="Reset zoom"
          >
            Fit
          </button>
        </div>

        {/* Image container */}
        <div className="flex-1 overflow-auto flex items-center justify-center p-4">
          <img
            src={fileUrl}
            alt={doc.title}
            className="max-w-none rounded shadow-2xl transition-transform duration-200"
            style={{
              width: zoom === 100 ? 'auto' : `${zoom}%`,
              maxHeight: zoom === 100 ? '100%' : 'none',
              objectFit: 'contain',
            }}
            draggable={false}
          />
        </div>
      </div>
    );
  }

  // Text / Code files — rendered in a code block
  if (group === 'text' || group === 'code') {
    if (loadingText) {
      return (
        <div className="flex items-center justify-center h-full">
          <Spinner size="lg" className="text-indigo-400" />
        </div>
      );
    }
    return (
      <div className="w-full h-full overflow-auto bg-gray-900 p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-gray-400 bg-gray-800 px-2.5 py-1 rounded font-medium uppercase tracking-wide">
            {ft}
          </span>
          <span className="text-xs text-gray-500">
            {textContent ? `${textContent.length.toLocaleString()} characters` : ''}
          </span>
        </div>
        {ft === 'html' || ft === 'htm' ? (
          <iframe
            srcDoc={textContent || ''}
            className="w-full bg-white rounded-lg"
            style={{ minHeight: '80vh' }}
            title={doc.title}
            sandbox="allow-same-origin"
          />
        ) : (
          <pre className="text-sm text-gray-200 font-mono whitespace-pre-wrap leading-relaxed">
            {textContent || '(Empty file)'}
          </pre>
        )}
      </div>
    );
  }

  // All other formats — Download to View card
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6">
      <div className="w-24 h-24 rounded-2xl bg-gray-700/60 flex items-center justify-center">
        {getFileIcon(ft, 48)}
      </div>
      <div className="text-center">
        <p className="text-white text-base font-medium mb-1">{doc.title}</p>
        <p className="text-gray-400 text-sm">
          {ft.toUpperCase()} file · {(doc.file_size / 1024).toFixed(1)} KB
        </p>
      </div>
      <p className="text-gray-500 text-xs max-w-xs text-center">
        Inline preview is not available for {ft.toUpperCase()} files. Download or open in a new tab to view.
      </p>
      <div className="flex items-center gap-3">
        <a
          href={fileUrl}
          download={doc.title}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-500/20"
        >
          <Download size={16} /> Download
        </a>
        <a
          href={fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-5 py-2.5 bg-gray-700 text-gray-200 rounded-lg text-sm font-medium hover:bg-gray-600 transition-colors"
        >
          <Maximize2 size={16} /> Open in New Tab
        </a>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
   Overview Tab — key stats at a glance
   ═══════════════════════════════════════════════════════════════════════════ */

function OverviewTab({ doc, textStats, fields, ocrMeta }) {
  const m = ocrMeta || {};
  return (
    <div className="space-y-4">
      {/* Document Info Card */}
      <InfoSection title="Document Info" icon={<FileText size={14} />} defaultOpen>
        <InfoRow label="Title" value={doc.title} />
        <InfoRow label="Type" value={doc.file_type?.toUpperCase()} />
        <InfoRow label="Size" value={`${(doc.file_size / 1024).toFixed(1)} KB`} />
        <InfoRow label="Uploaded" value={new Date(doc.created_at).toLocaleString()} />
        {doc.uploaded_by_name && <InfoRow label="Uploaded by" value={doc.uploaded_by_name} />}
        <InfoRow label="Last Updated" value={new Date(doc.updated_at).toLocaleString()} />
      </InfoSection>

      {/* Extraction Status Card */}
      <InfoSection title="Extraction Status" icon={<Database size={14} />} defaultOpen>
        <div className="flex items-center gap-2 mb-2">
          <StatusBadge status={doc.extraction_status} />
          <SourceBadge source={doc.text_source} />
        </div>
        <InfoRow label="Overall Confidence" value={
          doc.overall_confidence != null
            ? <ConfidenceBar value={doc.overall_confidence} />
            : <span className="text-gray-400 text-xs">Not available</span>
        } />
        <InfoRow label="Total Fields" value={fields.total_count} />
        <InfoRow label="Global Fields" value={fields.global.length} />
        <InfoRow label="Workflow Fields" value={fields.workflow.length} />
      </InfoSection>

      {/* OCR & File Metadata Card */}
      {Object.keys(m).length > 0 && (
        <InfoSection title="File Analysis" icon={<ScanText size={14} />} defaultOpen>
          {m.page_count > 0 && <InfoRow label="Pages" value={m.page_count} />}
          {m.word_count > 0 && <InfoRow label="Words" value={m.word_count?.toLocaleString()} />}
          {m.language && <InfoRow label="Language" value={_langLabel(m.language)} />}
          {m.is_scanned && (
            <InfoRow label="Scanned" value={
              <span className="inline-flex items-center gap-1 text-amber-600 text-[11px] font-medium">
                <ScanText size={11} /> Yes — OCR applied
              </span>
            } />
          )}
          {m.ocr_confidence > 0 && (
            <InfoRow label="OCR Confidence" value={
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden max-w-[100px]">
                  <div
                    className={`h-full rounded-full ${m.ocr_confidence >= 80 ? 'bg-green-400' : m.ocr_confidence >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                    style={{ width: `${Math.min(m.ocr_confidence, 100)}%` }}
                  />
                </div>
                <span className="text-[11px] text-gray-600 font-medium">{m.ocr_confidence.toFixed(0)}%</span>
              </div>
            } />
          )}
          {m.has_images && <InfoRow label="Has Images" value="Yes" />}
          {m.has_tables && <InfoRow label="Has Tables" value="Yes" />}
          {m.extraction_method && <InfoRow label="Method" value={m.extraction_method} />}
          {m.author && <InfoRow label="Author" value={m.author} />}
          {m.creation_date && <InfoRow label="Created" value={m.creation_date} />}
          {m.dimensions && (
            <InfoRow label="Dimensions" value={`${m.dimensions.width} × ${m.dimensions.height} ${m.dimensions.unit || ''}`} />
          )}
        </InfoSection>
      )}

      {/* Text Stats Card (fallback if no OCR metadata) */}
      {Object.keys(m).length === 0 && (
        <InfoSection title="Text Extraction" icon={<ScanText size={14} />} defaultOpen>
          <InfoRow label="Text Source" value={<SourceBadge source={textStats?.text_source} />} />
          <InfoRow label="Direct Text" value={textStats?.direct_text_length ? `${textStats.direct_text_length.toLocaleString()} chars` : 'None'} />
          <InfoRow label="OCR Text" value={textStats?.ocr_text_length ? `${textStats.ocr_text_length.toLocaleString()} chars` : 'None'} />
        </InfoSection>
      )}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
   Metadata Tab — global + workflow extracted metadata (JSON view)
   ═══════════════════════════════════════════════════════════════════════════ */

function MetadataTab({ doc }) {
  const globalMeta = doc.global_metadata || {};
  const workflowMeta = doc.extracted_metadata || {};
  const globalConf = doc.global_confidence || {};
  const extractionConf = doc.extraction_confidence || {};

  const hasGlobal = Object.keys(globalMeta).length > 0;
  const hasWorkflow = Object.keys(workflowMeta).length > 0;

  return (
    <div className="space-y-4">
      {/* Global Metadata */}
      <InfoSection
        title={`Global Metadata (${Object.keys(globalMeta).length})`}
        icon={<Layers size={14} className="text-blue-500" />}
        defaultOpen
      >
        {hasGlobal ? (
          <div className="space-y-1.5">
            {Object.entries(globalMeta).map(([key, value]) => (
              <MetadataRow
                key={key}
                fieldName={key}
                value={value}
                confidence={globalConf[key]}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">No global metadata extracted yet</p>
        )}
      </InfoSection>

      {/* Workflow Metadata */}
      <InfoSection
        title={`Workflow Metadata (${Object.keys(workflowMeta).length})`}
        icon={<Braces size={14} className="text-amber-500" />}
        defaultOpen
      >
        {hasWorkflow ? (
          <div className="space-y-1.5">
            {Object.entries(workflowMeta).map(([key, value]) => (
              <MetadataRow
                key={key}
                fieldName={key}
                value={value}
                confidence={extractionConf[key]}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">No workflow metadata extracted yet</p>
        )}
      </InfoSection>

      {/* Confidence Scores */}
      {doc.overall_confidence != null && (
        <InfoSection
          title="Confidence Breakdown"
          icon={<CheckCircle2 size={14} className="text-green-500" />}
          defaultOpen={false}
        >
          <InfoRow label="Overall" value={<ConfidenceBar value={doc.overall_confidence} />} />
          {Object.entries(globalConf).length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-[10px] uppercase text-gray-400 font-semibold">Per-field confidence</p>
              {Object.entries(globalConf).map(([key, conf]) => (
                <div key={key} className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500 truncate flex-1">{key.replace(/_/g, ' ')}</span>
                  <span className="text-gray-700 font-medium w-12 text-right">
                    {typeof conf === 'number' ? `${(conf * 100).toFixed(0)}%` : String(conf)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </InfoSection>
      )}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
   Fields Tab — all ExtractedField rows in a table
   ═══════════════════════════════════════════════════════════════════════════ */

function FieldsTab({ fields }) {
  const [filterSource, setFilterSource] = useState('all');

  const displayFields = filterSource === 'all'
    ? [...fields.global, ...fields.workflow]
    : filterSource === 'global'
      ? fields.global
      : fields.workflow;

  return (
    <div className="space-y-3">
      {/* Filter */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setFilterSource('all')}
          className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
            filterSource === 'all' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          All ({fields.total_count})
        </button>
        <button
          onClick={() => setFilterSource('global')}
          className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
            filterSource === 'global' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          Global ({fields.global.length})
        </button>
        <button
          onClick={() => setFilterSource('workflow')}
          className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
            filterSource === 'workflow' ? 'bg-amber-100 text-amber-700' : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          Workflow ({fields.workflow.length})
        </button>
      </div>

      {/* Fields List */}
      {displayFields.length === 0 ? (
        <p className="text-xs text-gray-400 italic py-4 text-center">No fields extracted yet</p>
      ) : (
        <div className="space-y-1">
          {displayFields.map((field) => (
            <div
              key={field.id}
              className="bg-gray-50 rounded-lg px-3 py-2 hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium text-gray-800">
                  {field.field_name.replace(/_/g, ' ')}
                </span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                  field.source === 'global'
                    ? 'bg-blue-100 text-blue-600'
                    : 'bg-amber-100 text-amber-600'
                }`}>
                  {field.source}
                </span>
                {field.is_manually_edited && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-600 font-medium">
                    edited
                  </span>
                )}
                {field.needs_review && (
                  <AlertTriangle size={10} className="text-amber-500" />
                )}
              </div>
              <div className="text-xs text-gray-600">
                {field.display_value || field.standardized_value || field.raw_value || '—'}
              </div>
              {field.confidence > 0 && (
                <div className="mt-1">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          field.confidence >= 0.8 ? 'bg-green-400' : field.confidence >= 0.5 ? 'bg-amber-400' : 'bg-red-400'
                        }`}
                        style={{ width: `${field.confidence * 100}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-400 w-8 text-right">
                      {(field.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
   Text Tab — direct text and OCR text
   ═══════════════════════════════════════════════════════════════════════════ */

function TextTab({ doc, textStats }) {
  const [textType, setTextType] = useState(doc.text_source === 'ocr' ? 'ocr' : 'direct');

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setTextType('direct')}
          className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
            textType === 'direct' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          Direct ({textStats?.direct_text_length?.toLocaleString() || 0} chars)
        </button>
        <button
          onClick={() => setTextType('ocr')}
          className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
            textType === 'ocr' ? 'bg-purple-100 text-purple-700' : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          OCR ({textStats?.ocr_text_length?.toLocaleString() || 0} chars)
        </button>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-gray-400">
        <span>Used for AI extraction:</span>
        <SourceBadge source={doc.text_source} />
      </div>

      <div className="bg-gray-50 rounded-lg p-3 max-h-[calc(100vh-300px)] overflow-y-auto">
        <pre className="text-[11px] text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
          {textType === 'direct'
            ? (doc.direct_text || '(No direct text extracted)')
            : (doc.ocr_text || '(No OCR text extracted)')}
        </pre>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
   OCR Tab — full OCR & file analysis metadata
   ═══════════════════════════════════════════════════════════════════════════ */

const LANG_LABELS = {
  eng: 'English', spa: 'Spanish', fra: 'French', deu: 'German',
  ita: 'Italian', por: 'Portuguese', zho: 'Chinese', jpn: 'Japanese',
  kor: 'Korean', ara: 'Arabic', hin: 'Hindi', rus: 'Russian',
};

function _langLabel(code) {
  return LANG_LABELS[code] || code || '—';
}

function OcrTab({ ocrMeta, textStats, doc }) {
  const m = ocrMeta || {};
  const hasMeta = Object.keys(m).length > 0;

  if (!hasMeta) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <ScanText size={32} className="text-gray-300 mb-2" />
        <p className="text-sm text-gray-500 font-medium">No OCR metadata</p>
        <p className="text-xs text-gray-400 mt-1">
          Re-extract the document to generate OCR & file analysis data
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Quick stats row */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Pages" value={m.page_count || '—'} icon="📄" />
        <StatCard label="Words" value={m.word_count?.toLocaleString() || '—'} icon="📝" />
        <StatCard label="Language" value={_langLabel(m.language)} icon="🌐" />
      </div>

      {/* Scan & OCR Status */}
      <InfoSection title="OCR Analysis" icon={<ScanText size={14} className="text-purple-500" />} defaultOpen>
        <InfoRow label="Scanned Document" value={
          m.is_scanned
            ? <span className="text-amber-600 font-medium text-[11px]">Yes — text extracted via OCR</span>
            : <span className="text-green-600 font-medium text-[11px]">No — native text</span>
        } />
        <InfoRow label="Text Source" value={<SourceBadge source={doc?.text_source} />} />
        <InfoRow label="Extraction Method" value={m.extraction_method || '—'} />
        {m.ocr_confidence > 0 && (
          <InfoRow label="OCR Confidence" value={
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden max-w-[100px]">
                <div
                  className={`h-full rounded-full ${m.ocr_confidence >= 80 ? 'bg-green-400' : m.ocr_confidence >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                  style={{ width: `${Math.min(m.ocr_confidence, 100)}%` }}
                />
              </div>
              <span className="text-[11px] text-gray-600 font-medium">{m.ocr_confidence.toFixed(1)}%</span>
            </div>
          } />
        )}
      </InfoSection>

      {/* Text Stats */}
      <InfoSection title="Text Statistics" icon={<Hash size={14} className="text-blue-500" />} defaultOpen>
        <InfoRow label="Characters" value={m.char_count?.toLocaleString() || '—'} />
        <InfoRow label="Words" value={m.word_count?.toLocaleString() || '—'} />
        <InfoRow label="Lines" value={m.line_count?.toLocaleString() || '—'} />
        <InfoRow label="Text Density" value={
          m.text_density
            ? `${m.text_density.toLocaleString()} chars/page`
            : '—'
        } />
        <InfoRow label="Direct Text" value={
          textStats?.direct_text_length
            ? `${textStats.direct_text_length.toLocaleString()} chars`
            : 'None'
        } />
        <InfoRow label="OCR Text" value={
          textStats?.ocr_text_length
            ? `${textStats.ocr_text_length.toLocaleString()} chars`
            : 'None'
        } />
      </InfoSection>

      {/* Content Analysis */}
      <InfoSection title="Content Analysis" icon={<Layers size={14} className="text-emerald-500" />} defaultOpen>
        <InfoRow label="Has Images" value={m.has_images ? '✅ Yes' : '—  No'} />
        <InfoRow label="Has Tables" value={m.has_tables ? '✅ Yes' : '—  No'} />
        {m.row_count > 0 && <InfoRow label="Table Rows" value={m.row_count.toLocaleString()} />}
        {m.script && <InfoRow label="Script" value={m.script} />}
        {m.rotation != null && m.rotation > 0 && <InfoRow label="Rotation" value={`${m.rotation}°`} />}
      </InfoSection>

      {/* File Properties */}
      {(m.author || m.creation_date || m.producer || m.dimensions) && (
        <InfoSection title="File Properties" icon={<FileText size={14} className="text-gray-500" />} defaultOpen>
          {m.author && <InfoRow label="Author" value={m.author} />}
          {m.creation_date && <InfoRow label="Created" value={m.creation_date} />}
          {m.producer && <InfoRow label="Producer" value={m.producer} />}
          {m.dimensions && (
            <InfoRow label="Dimensions" value={
              `${m.dimensions.width} × ${m.dimensions.height} ${m.dimensions.unit || ''}`
            } />
          )}
        </InfoSection>
      )}

      {/* Raw JSON (collapsed by default) */}
      <InfoSection title="Raw OCR Metadata" icon={<Braces size={14} className="text-gray-400" />} defaultOpen={false}>
        <pre className="text-[10px] text-gray-600 bg-gray-100 rounded-md p-2 overflow-x-auto font-mono whitespace-pre-wrap max-h-60">
          {JSON.stringify(m, null, 2)}
        </pre>
      </InfoSection>
    </div>
  );
}

function StatCard({ label, value, icon }) {
  return (
    <div className="bg-gray-50 rounded-lg p-2.5 text-center">
      <span className="text-sm">{icon}</span>
      <p className="text-sm font-bold text-gray-800 mt-0.5">{value}</p>
      <p className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</p>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
   Journey Tab — workflow execution trace for this document
   ═══════════════════════════════════════════════════════════════════════════ */

function JourneyTab({ journey }) {
  if (!journey) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <Layers size={32} className="text-gray-300 mb-2" />
        <p className="text-sm text-gray-500 font-medium">No execution data</p>
        <p className="text-xs text-gray-400 mt-1">Run the workflow to see how this document flows through the pipeline</p>
      </div>
    );
  }

  const steps = journey.steps || [];
  const reachedOutput = journey.reached_output;

  const typeIcons = {
    input: '📥', rule: '⚙️', listener: '👁', validator: '✅',
    action: '⚡', ai: '🧪', and_gate: '∩', output: '📤',
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className={`rounded-lg p-3 border ${
        reachedOutput
          ? 'bg-emerald-50 border-emerald-200'
          : 'bg-red-50 border-red-200'
      }`}>
        <div className="flex items-center gap-2">
          {reachedOutput ? (
            <CheckCircle2 size={16} className="text-emerald-500" />
          ) : (
            <AlertTriangle size={16} className="text-red-500" />
          )}
          <span className={`text-sm font-semibold ${reachedOutput ? 'text-emerald-800' : 'text-red-800'}`}>
            {reachedOutput ? 'Passed — Reached Output' : 'Filtered Out'}
          </span>
        </div>
        <p className="text-[11px] mt-1 text-gray-500">
          Execution: {journey.execution_status} · {journey.executed_at ? new Date(journey.executed_at).toLocaleString() : '—'}
        </p>
      </div>

      {/* Pipeline mini-dots */}
      <div className="flex items-center justify-center gap-1 py-1">
        {steps.map((step, i) => (
          <React.Fragment key={step.node_id}>
            <span
              className={`w-3 h-3 rounded-full ${step.passed ? 'bg-emerald-400' : 'bg-red-300'}`}
              title={`${step.label}: ${step.passed ? 'passed' : 'filtered'}`}
            />
            {i < steps.length - 1 && (
              <span className={`w-4 h-px ${step.passed && steps[i + 1]?.passed ? 'bg-emerald-300' : 'bg-gray-200'}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Vertical timeline */}
      <div className="relative pl-5 space-y-3">
        {/* Vertical line */}
        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gray-200" />

        {steps.map((step) => (
          <div key={step.node_id} className="relative">
            {/* Dot on line */}
            <span className={`absolute left-0 top-1 w-[15px] h-[15px] rounded-full border-2 flex items-center justify-center text-[8px] ${
              step.passed
                ? 'bg-emerald-100 border-emerald-400'
                : 'bg-red-100 border-red-300'
            }`}>
              {step.passed ? '✓' : '✕'}
            </span>

            <div className="ml-6">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs">{typeIcons[step.node_type] || '●'}</span>
                <span className="text-xs font-medium text-gray-700">{step.label}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                  step.passed ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
                }`}>
                  {step.passed ? 'PASSED' : 'FILTERED'}
                </span>
                <span className="text-[10px] text-gray-400">{step.total_docs} docs total</span>
              </div>

              {/* AI result */}
              {step.ai_result && (
                <div className="mt-1.5 bg-rose-50 rounded-md p-2 border border-rose-100">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-semibold text-rose-500">🧪 AI: {step.ai_result.model}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      step.ai_result.status === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {step.ai_result.status}
                    </span>
                  </div>
                  {step.ai_result.answer != null && (
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] text-gray-500">Answer:</span>
                      <span className={`text-xs font-bold ${
                        step.ai_result.answer === 'yes' || step.ai_result.answer === true ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        {String(step.ai_result.answer).toUpperCase()}
                      </span>
                    </div>
                  )}
                  {step.ai_result.parsed_fields && Object.keys(step.ai_result.parsed_fields).length > 0 && (
                    <div className="space-y-0.5 mt-1">
                      {Object.entries(step.ai_result.parsed_fields).map(([k, v]) => (
                        <div key={k} className="text-[10px] flex gap-1.5">
                          <span className="text-gray-400 shrink-0">{k}:</span>
                          <span className="text-gray-700 font-medium truncate">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {step.ai_result.response && !step.ai_result.parsed_fields && step.ai_result.answer == null && (
                    <p className="text-[10px] text-gray-600 mt-1 whitespace-pre-wrap line-clamp-4">{step.ai_result.response}</p>
                  )}
                  {step.ai_result.status === 'error' && step.ai_result.error && (
                    <p className="text-[10px] text-red-600 mt-1">{step.ai_result.error}</p>
                  )}
                </div>
              )}

              {/* Action result */}
              {step.action_result && (
                <div className="mt-1.5 bg-purple-50 rounded-md p-2 border border-purple-100">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-purple-500">⚡ {step.action_result.plugin}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      step.action_result.status === 'sent' || step.action_result.status === 'retried'
                        ? 'bg-emerald-100 text-emerald-700'
                        : step.action_result.status === 'skipped'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-red-100 text-red-700'
                    }`}>
                      {step.action_result.status}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
   Reusable sub-components
   ═══════════════════════════════════════════════════════════════════════════ */

function InfoSection({ title, icon, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-gray-50 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
      >
        {icon}
        <span className="flex-1 text-left">{title}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && <div className="px-3 pb-3 space-y-1.5">{children}</div>}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-gray-400 shrink-0 w-28">{label}</span>
      <span className="text-gray-700 font-medium break-words flex-1">
        {typeof value === 'object' && React.isValidElement(value) ? value : String(value ?? '—')}
      </span>
    </div>
  );
}

function MetadataRow({ fieldName, value, confidence }) {
  const displayValue = value === null || value === undefined || value === ''
    ? '—'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);

  const isEmpty = displayValue === '—';

  return (
    <div className="bg-white rounded-md px-2.5 py-2 border border-gray-100">
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-[11px] font-medium text-gray-700">
          {fieldName.replace(/_/g, ' ')}
        </span>
        {confidence != null && (
          <span className={`text-[9px] font-medium ml-auto ${
            confidence >= 0.8 ? 'text-green-600' : confidence >= 0.5 ? 'text-amber-600' : 'text-red-500'
          }`}>
            {typeof confidence === 'number' ? `${(confidence * 100).toFixed(0)}%` : confidence}
          </span>
        )}
      </div>
      <p className={`text-xs break-words ${
        isEmpty
          ? 'text-gray-400'
          : 'text-blue-600 underline underline-offset-2 decoration-blue-300 bg-blue-50/60 px-1.5 py-0.5 rounded'
      }`}>
        {displayValue}
      </p>
    </div>
  );
}
