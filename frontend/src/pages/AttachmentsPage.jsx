import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Paperclip,
  Image as ImageIcon,
  FileText,
  Upload,
  Search,
  Filter,
  Grid,
  List,
  Users,
  Building2,
  User,
  ChevronDown,
  X,
  Eye,
  Download,
  Trash2,
  Clock,
  HardDrive,
  Tag,
  MoreVertical,
  RefreshCw,
  FolderOpen,
  File,
  CheckCircle,
} from 'lucide-react';
import attachmentService from '../services/attachmentService';
import { useAuth } from '../contexts/AuthContext';
import './AttachmentsPage.css';

// ── Helpers ─────────────────────────────────────────────────────────────

const formatSize = (bytes) => {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
};

const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const SCOPE_TABS = [
  { key: 'all', label: 'All Files', icon: FolderOpen },
  { key: 'user', label: 'My Uploads', icon: User },
  { key: 'team', label: 'Team', icon: Users },
  { key: 'organization', label: 'Organization', icon: Building2 },
];

const KIND_FILTERS = [
  { key: 'all', label: 'All', icon: Paperclip },
  { key: 'image', label: 'Images', icon: ImageIcon },
  { key: 'document', label: 'Documents', icon: FileText },
  { key: 'other', label: 'Other', icon: File },
];

const IMAGE_TYPE_OPTIONS = [
  { value: '', label: 'All image types' },
  { value: 'logo', label: 'Logo' },
  { value: 'watermark', label: 'Watermark' },
  { value: 'signature', label: 'Signature' },
  { value: 'stamp', label: 'Stamp/Seal' },
  { value: 'diagram', label: 'Diagram' },
  { value: 'figure', label: 'Figure' },
  { value: 'chart', label: 'Chart' },
  { value: 'screenshot', label: 'Screenshot' },
  { value: 'photo', label: 'Photo' },
  { value: 'picture', label: 'General Picture' },
  { value: 'other', label: 'Other' },
];

// ── Main Component ──────────────────────────────────────────────────────

const AttachmentsPage = () => {
  const { user } = useAuth();

  // ── State ─────────────────────────────────────────────────────────
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);

  // Filters
  const [scopeTab, setScopeTab] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');
  const [imageTypeFilter, setImageTypeFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('grid');

  // Upload
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadScope, setUploadScope] = useState('user');
  const fileInputRef = useRef(null);

  // Preview
  const [previewItem, setPreviewItem] = useState(null);

  // Context menu
  const [contextMenu, setContextMenu] = useState(null);

  // ── Fetch data ────────────────────────────────────────────────────

  const fetchAttachments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (scopeTab !== 'all') params.scope = scopeTab;
      if (kindFilter !== 'all') params.file_kind = kindFilter;
      if (imageTypeFilter) params.image_type = imageTypeFilter;
      if (searchTerm.trim()) params.search = searchTerm.trim();

      const data = await attachmentService.list(params);

      let items = [];
      if (Array.isArray(data)) {
        items = data;
      } else if (data?.results) {
        items = data.results;
      }

      setAttachments(items);
    } catch (err) {
      console.error('Failed to load attachments:', err);
      setError('Failed to load attachments. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [scopeTab, kindFilter, imageTypeFilter, searchTerm]);

  const fetchSummary = useCallback(async () => {
    try {
      const data = await attachmentService.summary();
      setSummary(data);
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    fetchAttachments();
  }, [fetchAttachments]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  // ── Upload handler ────────────────────────────────────────────────

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setUploading(true);
    try {
      for (const file of files) {
        const isImage = file.type.startsWith('image/');
        await attachmentService.upload(file, {
          name: file.name.replace(/\.[^.]+$/, ''),
          file_kind: isImage ? 'image' : 'document',
          scope: uploadScope,
        });
      }
      setUploadOpen(false);
      fetchAttachments();
      fetchSummary();
    } catch (err) {
      console.error('Upload failed:', err);
      setError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Delete handler ────────────────────────────────────────────────

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this attachment? This cannot be undone.')) return;
    try {
      await attachmentService.delete(id);
      setAttachments((prev) => prev.filter((a) => a.id !== id));
      fetchSummary();
    } catch (err) {
      console.error('Delete failed:', err);
      setError('Failed to delete attachment.');
    }
  };

  // ── Filtered / grouped ───────────────────────────────────────────

  const filteredAttachments = useMemo(() => {
    // The API handles filtering, but we also do client-side search
    // in case the user types faster than the debounce
    if (!searchTerm.trim()) return attachments;
    const q = searchTerm.toLowerCase();
    return attachments.filter(
      (a) =>
        (a.name || '').toLowerCase().includes(q) ||
        (a.description || '').toLowerCase().includes(q) ||
        (a.mime_type || '').toLowerCase().includes(q)
    );
  }, [attachments, searchTerm]);

  const stats = useMemo(() => {
    const images = filteredAttachments.filter((a) => a.file_kind === 'image').length;
    const docs = filteredAttachments.filter((a) => a.file_kind === 'document').length;
    const others = filteredAttachments.length - images - docs;
    const totalSize = filteredAttachments.reduce((s, a) => s + (a.file_size || 0), 0);
    return { images, docs, others, totalSize, total: filteredAttachments.length };
  }, [filteredAttachments]);

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="attachments-page">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="attachments-header">
        <div className="header-left">
          <div className="header-icon">
            <Paperclip className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Attachments</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Manage images &amp; documents across your workspace
            </p>
          </div>
        </div>
        <div className="header-actions">
          <button
            onClick={() => { fetchAttachments(); fetchSummary(); }}
            className="btn-icon"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button onClick={() => setUploadOpen(true)} className="btn-primary">
            <Upload className="h-4 w-4" />
            Upload
          </button>
        </div>
      </div>

      {/* ── Stats Bar ──────────────────────────────────────────────── */}
      {summary && (
        <div className="stats-bar">
          <div className="stat-chip">
            <Paperclip className="h-3.5 w-3.5 text-blue-500" />
            <span className="font-medium">{summary.total ?? stats.total}</span>
            <span className="text-gray-500">Total</span>
          </div>
          <div className="stat-chip">
            <ImageIcon className="h-3.5 w-3.5 text-emerald-500" />
            <span className="font-medium">{summary.images ?? stats.images}</span>
            <span className="text-gray-500">Images</span>
          </div>
          <div className="stat-chip">
            <FileText className="h-3.5 w-3.5 text-amber-500" />
            <span className="font-medium">{summary.documents ?? stats.docs}</span>
            <span className="text-gray-500">Documents</span>
          </div>
          <div className="stat-chip">
            <HardDrive className="h-3.5 w-3.5 text-gray-400" />
            <span className="font-medium">{formatSize(summary.total_size ?? stats.totalSize)}</span>
            <span className="text-gray-500">Storage</span>
          </div>
        </div>
      )}

      {/* ── Scope Tabs ─────────────────────────────────────────────── */}
      <div className="scope-tabs">
        {SCOPE_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setScopeTab(tab.key)}
            className={`scope-tab ${scopeTab === tab.key ? 'active' : ''}`}
          >
            <tab.icon className="h-4 w-4" />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ── Toolbar (search + kind filters + view) ─────────────────── */}
      <div className="toolbar">
        <div className="toolbar-left">
          {/* Search */}
          <div className="search-box">
            <Search className="h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search attachments..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="clear-btn">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Kind quick-filters */}
          <div className="kind-filters">
            {KIND_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setKindFilter(f.key)}
                className={`kind-chip ${kindFilter === f.key ? 'active' : ''}`}
              >
                <f.icon className="h-3.5 w-3.5" />
                <span>{f.label}</span>
              </button>
            ))}
          </div>

          {/* Image type dropdown (visible when filtering images) */}
          {kindFilter === 'image' && (
            <select
              value={imageTypeFilter}
              onChange={(e) => setImageTypeFilter(e.target.value)}
              className="type-dropdown"
            >
              {IMAGE_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="toolbar-right">
          <span className="result-count">{stats.total} items</span>
          <div className="view-toggle">
            <button
              onClick={() => setViewMode('grid')}
              className={viewMode === 'grid' ? 'active' : ''}
              title="Grid view"
            >
              <Grid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={viewMode === 'list' ? 'active' : ''}
              title="List view"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Error ──────────────────────────────────────────────────── */}
      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={() => setError(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Content ────────────────────────────────────────────────── */}
      {loading ? (
        <div className="loading-state">
          <RefreshCw className="h-6 w-6 text-blue-500 animate-spin" />
          <span>Loading attachments…</span>
        </div>
      ) : filteredAttachments.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <Paperclip className="h-10 w-10 text-gray-300" />
          </div>
          <h3>No attachments found</h3>
          <p>
            {searchTerm
              ? 'Try adjusting your search or filters.'
              : 'Upload images and documents to get started.'}
          </p>
          {!searchTerm && (
            <button onClick={() => setUploadOpen(true)} className="btn-primary mt-4">
              <Upload className="h-4 w-4" />
              Upload Files
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        /* ── Grid View ──────────────────────────────────────────── */
        <div className="attachments-grid">
          {filteredAttachments.map((item) => (
            <AttachmentCard
              key={item.id}
              item={item}
              onPreview={() => setPreviewItem(item)}
              onDelete={() => handleDelete(item.id)}
            />
          ))}
        </div>
      ) : (
        /* ── List View ──────────────────────────────────────────── */
        <div className="attachments-list">
          <div className="list-header">
            <span className="col-name">Name</span>
            <span className="col-kind">Type</span>
            <span className="col-scope">Scope</span>
            <span className="col-size">Size</span>
            <span className="col-date">Uploaded</span>
            <span className="col-actions" />
          </div>
          {filteredAttachments.map((item) => (
            <AttachmentRow
              key={item.id}
              item={item}
              onPreview={() => setPreviewItem(item)}
              onDelete={() => handleDelete(item.id)}
            />
          ))}
        </div>
      )}

      {/* ── Upload Modal ───────────────────────────────────────────── */}
      {uploadOpen && (
        <UploadModal
          uploading={uploading}
          uploadScope={uploadScope}
          setUploadScope={setUploadScope}
          fileInputRef={fileInputRef}
          onFileSelect={handleFileSelect}
          onClose={() => setUploadOpen(false)}
        />
      )}

      {/* ── Preview Modal ──────────────────────────────────────────── */}
      {previewItem && (
        <PreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

const AttachmentCard = ({ item, onPreview, onDelete }) => {
  const isImage = item.file_kind === 'image';
  const thumbUrl = item.thumbnail_url || item.url;

  return (
    <div className="attachment-card" onClick={onPreview}>
      <div className="card-thumb">
        {isImage && thumbUrl ? (
          <img src={thumbUrl} alt={item.name} loading="lazy" />
        ) : (
          <div className="card-thumb-icon">
            <FileIcon mimeType={item.mime_type} />
          </div>
        )}
        <div className="card-scope-badge">
          <ScopeBadge scope={item.scope || item.scope_display} />
        </div>
      </div>
      <div className="card-body">
        <h4 className="card-title" title={item.name}>{item.name}</h4>
        <div className="card-meta">
          <span>{formatSize(item.file_size)}</span>
          <span className="dot">·</span>
          <span>{formatDate(item.created_at)}</span>
        </div>
      </div>
      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
        <button onClick={onPreview} title="Preview">
          <Eye className="h-3.5 w-3.5" />
        </button>
        {item.url && (
          <a href={item.url} download title="Download" onClick={(e) => e.stopPropagation()}>
            <Download className="h-3.5 w-3.5" />
          </a>
        )}
        <button onClick={onDelete} title="Delete" className="delete-btn">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

const AttachmentRow = ({ item, onPreview, onDelete }) => {
  const isImage = item.file_kind === 'image';

  return (
    <div className="list-row" onClick={onPreview}>
      <div className="col-name">
        <div className="row-icon">
          {isImage ? (
            <ImageIcon className="h-4 w-4 text-emerald-500" />
          ) : (
            <FileText className="h-4 w-4 text-amber-500" />
          )}
        </div>
        <span className="row-name" title={item.name}>{item.name}</span>
      </div>
      <div className="col-kind">
        <span className="kind-label">{item.file_kind}</span>
      </div>
      <div className="col-scope">
        <ScopeBadge scope={item.scope || item.scope_display} />
      </div>
      <div className="col-size">{formatSize(item.file_size)}</div>
      <div className="col-date">{formatDate(item.created_at)}</div>
      <div className="col-actions" onClick={(e) => e.stopPropagation()}>
        <button onClick={onPreview} title="Preview">
          <Eye className="h-3.5 w-3.5" />
        </button>
        <button onClick={onDelete} title="Delete" className="delete-btn">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

const ScopeBadge = ({ scope }) => {
  const map = {
    user: { label: 'Private', cls: 'scope-user', Icon: User },
    'User (private)': { label: 'Private', cls: 'scope-user', Icon: User },
    team: { label: 'Team', cls: 'scope-team', Icon: Users },
    Team: { label: 'Team', cls: 'scope-team', Icon: Users },
    organization: { label: 'Org', cls: 'scope-org', Icon: Building2 },
    Organization: { label: 'Org', cls: 'scope-org', Icon: Building2 },
    document: { label: 'Doc', cls: 'scope-doc', Icon: FileText },
    'Document-specific': { label: 'Doc', cls: 'scope-doc', Icon: FileText },
  };
  const info = map[scope] || { label: scope || '—', cls: 'scope-user', Icon: User };

  return (
    <span className={`scope-badge ${info.cls}`}>
      <info.Icon className="h-3 w-3" />
      {info.label}
    </span>
  );
};

const FileIcon = ({ mimeType }) => {
  if (!mimeType) return <File className="h-8 w-8 text-gray-400" />;
  if (mimeType.includes('pdf')) return <FileText className="h-8 w-8 text-red-400" />;
  if (mimeType.includes('word') || mimeType.includes('document'))
    return <FileText className="h-8 w-8 text-blue-400" />;
  if (mimeType.includes('sheet') || mimeType.includes('excel'))
    return <FileText className="h-8 w-8 text-green-400" />;
  return <File className="h-8 w-8 text-gray-400" />;
};

// ── Upload Modal ──────────────────────────────────────────────────────

const UploadModal = ({ uploading, uploadScope, setUploadScope, fileInputRef, onFileSelect, onClose }) => {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            <Upload className="h-5 w-5 text-blue-600" />
            Upload Attachments
          </h3>
          <button onClick={onClose} className="close-btn">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="modal-body">
          {/* Scope selector */}
          <div className="scope-selector">
            <label className="label">Visibility</label>
            <div className="scope-options">
              {[
                { key: 'user', label: 'Private', icon: User, desc: 'Only you can see' },
                { key: 'team', label: 'Team', icon: Users, desc: 'Shared with your team' },
                {
                  key: 'organization',
                  label: 'Organization',
                  icon: Building2,
                  desc: 'Everyone in org',
                },
              ].map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setUploadScope(opt.key)}
                  className={`scope-option ${uploadScope === opt.key ? 'active' : ''}`}
                >
                  <opt.icon className="h-5 w-5" />
                  <div>
                    <span className="opt-label">{opt.label}</span>
                    <span className="opt-desc">{opt.desc}</span>
                  </div>
                  {uploadScope === opt.key && (
                    <CheckCircle className="h-4 w-4 text-blue-600 check-icon" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Drop zone */}
          <div
            className="drop-zone"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
            onDragLeave={(e) => e.currentTarget.classList.remove('dragover')}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove('dragover');
              const dt = e.dataTransfer;
              if (dt.files?.length) {
                // Simulate file-input change
                const fakeEvt = { target: { files: dt.files } };
                onFileSelect(fakeEvt);
              }
            }}
          >
            {uploading ? (
              <div className="uploading-state">
                <RefreshCw className="h-8 w-8 text-blue-500 animate-spin" />
                <span>Uploading…</span>
              </div>
            ) : (
              <>
                <Upload className="h-10 w-10 text-gray-300" />
                <p className="drop-text">
                  Drag &amp; drop files here, or <span className="link">browse</span>
                </p>
                <p className="drop-hint">Images, PDFs, Word, Excel — up to 25 MB</p>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.json,.xml,.md,.rtf,.zip"
            onChange={onFileSelect}
            className="hidden"
          />
        </div>
      </div>
    </div>
  );
};

// ── Preview Modal ─────────────────────────────────────────────────────

const PreviewModal = ({ item, onClose }) => {
  const isImage = item.file_kind === 'image';
  const previewUrl = item.url || item.file;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="truncate">
            {isImage ? <ImageIcon className="h-5 w-5 text-emerald-600" /> : <FileText className="h-5 w-5 text-amber-600" />}
            {item.name}
          </h3>
          <button onClick={onClose} className="close-btn">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="preview-body">
          {isImage && previewUrl ? (
            <img src={previewUrl} alt={item.name} className="preview-image" />
          ) : (
            <div className="preview-placeholder">
              <FileIcon mimeType={item.mime_type} />
              <p className="text-gray-500 mt-2">Preview not available</p>
            </div>
          )}
        </div>

        <div className="preview-footer">
          <div className="preview-meta">
            <span><ScopeBadge scope={item.scope || item.scope_display} /></span>
            <span>{formatSize(item.file_size)}</span>
            <span>{item.mime_type}</span>
            <span>{formatDate(item.created_at)}</span>
          </div>
          {previewUrl && (
            <a href={previewUrl} download className="btn-primary">
              <Download className="h-4 w-4" />
              Download
            </a>
          )}
        </div>
      </div>
    </div>
  );
};

export default AttachmentsPage;
