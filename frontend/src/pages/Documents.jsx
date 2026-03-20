import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { documentService } from '../services/documentService';
import { openDocumentInEditor } from '../utils/documentRouting';
import DuplicateDocumentDialog from '../components/masters/DuplicateDocumentDialog';
import PromoteToMasterDialog from '../components/masters/PromoteToMasterDialog';
import { ConfirmModal, Modal } from '../components/clm/ui/SharedUI';
import { useFeatureFlags } from '../contexts/FeatureFlagContext';
import { getDomainFilterCategories } from '../domains';
import {
  FileText,
  Search,
  Eye,
  PenTool,
  Share2,
  ChevronLeft,
  ChevronRight,
  X,
  SlidersHorizontal,
  MessageSquare,
  CheckCircle,
  XCircle,
  AlertTriangle,
  GitBranch,
  Copy,
  Crown,
  ExternalLink,
  Info,
  MoreVertical,
  Pencil,
  Trash2,
  Database,
  Plus,
} from 'lucide-react';

const formatDateTime = (value) => {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatStatusLabel = (status) => (
  (status || 'draft')
    .replace(/_/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
);

/* ─── Operator options for metadata filters ─── */
const METADATA_OPERATORS = [
  { value: 'contains', label: '≈ contains', symbol: '≈' },
  { value: 'eq', label: '= equals', symbol: '=' },
  { value: 'neq', label: '≠ not equal', symbol: '≠' },
  { value: 'lt', label: '< less than', symbol: '<' },
  { value: 'gt', label: '> greater than', symbol: '>' },
];

/* ─── Combobox-like input with suggestions ─── */
const SuggestInput = ({ value, onChange, suggestions = [], placeholder, className = '' }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value || '');
  const wrapRef = useRef(null);

  useEffect(() => { setSearch(value || ''); }, [value]);

  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = suggestions.filter((s) =>
    s.toLowerCase().includes((search || '').toLowerCase())
  ).slice(0, 15);

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <input
        type="text"
        value={search}
        onChange={(e) => { setSearch(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-400 focus:border-transparent bg-white"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-36 overflow-y-auto">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { onChange(s); setSearch(s); setOpen(false); }}
              className="block w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ─── Metadata filter row with operator dropdown ─── */
const MetadataFilterRow = ({ filter, index, metadataKeys, onUpdate, onRemove }) => {
  const selectedKeyObj = metadataKeys.find((mk) => mk.key === filter.key);
  const keySuggestions = metadataKeys.map((mk) => mk.key);
  const valueSuggestions = selectedKeyObj?.sample_values || [];

  return (
    <div className="flex items-center gap-2">
      <SuggestInput
        value={filter.key}
        onChange={(v) => onUpdate(index, { ...filter, key: v })}
        suggestions={keySuggestions}
        placeholder="Key…"
        className="w-44"
      />
      <select
        value={filter.operator || 'contains'}
        onChange={(e) => onUpdate(index, { ...filter, operator: e.target.value })}
        className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-400 focus:border-transparent text-gray-700 font-medium min-w-[120px]"
      >
        {METADATA_OPERATORS.map((op) => (
          <option key={op.value} value={op.value}>{op.label}</option>
        ))}
      </select>
      <SuggestInput
        value={filter.value}
        onChange={(v) => onUpdate(index, { ...filter, value: v })}
        suggestions={valueSuggestions}
        placeholder="Value…"
        className="flex-1 min-w-[140px]"
      />
      <button
        onClick={() => onRemove(index)}
        className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors flex-shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  );
};

const Documents = () => {
  const navigate = useNavigate();
  const { domain } = useFeatureFlags();
  const filterCategories = useMemo(() => getDomainFilterCategories(domain), [domain]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [detailsDoc, setDetailsDoc] = useState(null);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [duplicateTarget, setDuplicateTarget] = useState(null);
  const [promoteTarget, setPromoteTarget] = useState(null);
  const menuRefs = useRef(new Map());

  // Sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Metadata filters
  const [metadataKeys, setMetadataKeys] = useState([]);
  const [metadataFilters, setMetadataFilters] = useState([]); // [{key, operator, value}]
  const [showMetadataPanel, setShowMetadataPanel] = useState(false);

  // Filters
  const [filters, setFilters] = useState({
    status: '',
    category: '',
    created_by_me: false,
    assigned_to_me: false,
    shared_with_me: false,
    date_from: '',
    date_to: '',
    sort: 'updated_at',
    order: 'desc',
  });

  const openCreateDialog = () => {
    window.dispatchEvent(new CustomEvent('openCreateDocumentDialog'));
  };

  // Load metadata keys once on mount
  useEffect(() => {
    (async () => {
      try {
        const keys = await documentService.getDocumentMetadataKeys();
        setMetadataKeys(keys || []);
      } catch { /* silent */ }
    })();
  }, []);

  const loadDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        page: currentPage,
        page_size: pageSize,
        search: searchQuery || undefined,
        ...Object.fromEntries(
          Object.entries(filters).filter(([, v]) => v !== '' && v !== false)
        ),
      };

      // Append metadata filter key/value/operator triplets
      metadataFilters.forEach((mf, i) => {
        if (mf.key?.trim() && mf.value?.trim()) {
          params[`metadata_key_${i}`] = mf.key.trim();
          params[`metadata_value_${i}`] = mf.value.trim();
          params[`metadata_op_${i}`] = mf.operator || 'contains';
        }
      });

      const response = await documentService.getMyDocumentsDashboard(params);
      
      setDocuments(response.documents || []);
      setTotalCount(response.total || 0);
      setTotalPages(response.total_pages || 1);
    } catch (error) {
      console.error('Error loading documents:', error);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [currentPage, pageSize, filters, searchQuery, metadataFilters]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!openMenuId) return;
      const menuNode = menuRefs.current.get(openMenuId);
      if (menuNode && !menuNode.contains(event.target)) {
        setOpenMenuId(null);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [openMenuId]);

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setCurrentPage(1); // Reset to first page when filters change
  };

  const handleSearch = (e) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setFilters({
      status: '',
      category: '',
      created_by_me: false,
      assigned_to_me: false,
      shared_with_me: false,
      date_from: '',
      date_to: '',
      sort: 'updated_at',
      order: 'desc',
    });
    setSearchQuery('');
    setMetadataFilters([]);
    setShowMetadataPanel(false);
    setCurrentPage(1);
  };

  const refreshDocuments = async () => {
    await loadDocuments();
  };

  const beginRename = (doc, event) => {
    event?.stopPropagation();
    setOpenMenuId(null);
    setRenamingId(doc.id);
    setRenameValue(doc.title || '');
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  const submitRename = async (docId) => {
    const trimmed = renameValue.trim();
    const currentDoc = documents.find((doc) => doc.id === docId);
    if (!trimmed || trimmed === currentDoc?.title) {
      cancelRename();
      return;
    }

    try {
      setActionBusy(true);
      await documentService.updateDocument(docId, { title: trimmed }, 'Renamed from documents page');
      setDocuments((prev) => prev.map((doc) => (doc.id === docId ? { ...doc, title: trimmed } : doc)));
      cancelRename();
    } catch (error) {
      console.error('Error renaming document:', error);
      window.alert(error.response?.data?.detail || error.message || 'Unable to rename document.');
    } finally {
      setActionBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    try {
      setActionBusy(true);
      await documentService.deleteDocument(deleteTarget.id);
      setDeleteTarget(null);
      setOpenMenuId(null);
      await refreshDocuments();
    } catch (error) {
      console.error('Error deleting document:', error);
      window.alert(error.response?.data?.detail || error.message || 'Unable to delete document.');
    } finally {
      setActionBusy(false);
    }
  };

  const openDetails = async (doc, event) => {
    event?.stopPropagation();
    setOpenMenuId(null);
    setIsDetailsLoading(true);
    setDetailsError('');
    setDetailsDoc(doc);

    try {
      const fullDoc = await documentService.getDocument(doc.id);
      setDetailsDoc((prev) => ({ ...prev, ...fullDoc }));
    } catch (error) {
      console.error('Error loading document details:', error);
      setDetailsError(error.response?.data?.detail || error.message || 'Unable to load document details.');
    } finally {
      setIsDetailsLoading(false);
    }
  };

  const handleExport = async (id, e) => {
    e.stopPropagation();
    try {
      const blob = await documentService.exportDocument(id, 'docx');
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `document-${id}.docx`;
      a.click();
    } catch (error) {
      console.error('Error exporting document:', error);
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      draft: 'bg-gray-100 text-gray-700',
      under_review: 'bg-yellow-100 text-yellow-700',
      analyzed: 'bg-blue-100 text-blue-700',
      approved: 'bg-green-100 text-green-700',
      finalized: 'bg-purple-100 text-purple-700',
      executed: 'bg-indigo-100 text-indigo-700',
    };
    return badges[status] || 'bg-gray-100 text-gray-700';
  };

  const detailRows = useMemo(() => {
    if (!detailsDoc) return [];
    return [
      { label: 'Title', value: detailsDoc.title || 'Untitled' },
      { label: 'Mode', value: detailsDoc.document_mode === 'quick_latex' ? 'Quick LaTeX' : 'Standard' },
      { label: 'Status', value: formatStatusLabel(detailsDoc.status) },
      { label: 'Category', value: detailsDoc.category || '—' },
      { label: 'Author', value: detailsDoc.author || detailsDoc.created_by || '—' },
      { label: 'Created', value: formatDateTime(detailsDoc.created_at) },
      { label: 'Updated', value: formatDateTime(detailsDoc.updated_at) },
      { label: 'Document ID', value: detailsDoc.id || '—' },
    ];
  }, [detailsDoc]);

  const activeFiltersCount = Object.values(filters).filter(
    v => v !== '' && v !== false
  ).length + (searchQuery ? 1 : 0) + metadataFilters.filter(mf => mf.key && mf.value).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Documents</h1>
              <p className="text-sm text-gray-600 mt-1">
                {totalCount} document{totalCount !== 1 ? 's' : ''} found
                {activeFiltersCount > 0 && (
                  <span className="ml-2 text-blue-600 font-medium">
                    ({activeFiltersCount} filter{activeFiltersCount !== 1 ? 's' : ''} active)
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={openCreateDialog}
              className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-xl hover:bg-blue-700 transition-colors font-medium shadow-sm"
            >
              <PenTool className="h-5 w-5" />
              New Document
            </button>
          </div>
        </div>

        {/* ═══════ QUICK FILTER TABS — always visible ═══════ */}
        <div className="flex items-center gap-2 mb-4">
          {[
            { key: 'all', label: 'All Documents', icon: '📄', active: !filters.created_by_me && !filters.assigned_to_me && !filters.shared_with_me, color: 'blue' },
            { key: 'mine', label: 'Mine', icon: '✏️', active: filters.created_by_me && !filters.assigned_to_me && !filters.shared_with_me, color: 'purple' },
            { key: 'assigned', label: 'Assigned to Me', icon: '📋', active: filters.assigned_to_me && !filters.created_by_me && !filters.shared_with_me, color: 'orange' },
            { key: 'shared', label: 'Shared with Me', icon: '🔗', active: filters.shared_with_me && !filters.created_by_me && !filters.assigned_to_me, color: 'green' },
          ].map((item) => {
            const colorMap = {
              blue: { active: 'bg-blue-600 text-white shadow-md ring-2 ring-blue-200', inactive: 'bg-white text-gray-700 border border-gray-200 hover:border-blue-300 hover:bg-blue-50' },
              purple: { active: 'bg-purple-600 text-white shadow-md ring-2 ring-purple-200', inactive: 'bg-white text-gray-700 border border-gray-200 hover:border-purple-300 hover:bg-purple-50' },
              orange: { active: 'bg-orange-500 text-white shadow-md ring-2 ring-orange-200', inactive: 'bg-white text-gray-700 border border-gray-200 hover:border-orange-300 hover:bg-orange-50' },
              green: { active: 'bg-green-600 text-white shadow-md ring-2 ring-green-200', inactive: 'bg-white text-gray-700 border border-gray-200 hover:border-green-300 hover:bg-green-50' },
            };
            return (
              <button
                key={item.key}
                onClick={() => {
                  if (item.key === 'all') {
                    setFilters(prev => ({ ...prev, created_by_me: false, assigned_to_me: false, shared_with_me: false }));
                  } else {
                    setFilters(prev => ({
                      ...prev,
                      created_by_me: item.key === 'mine',
                      assigned_to_me: item.key === 'assigned',
                      shared_with_me: item.key === 'shared',
                    }));
                  }
                  setCurrentPage(1);
                }}
                className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${
                  item.active ? colorMap[item.color].active : colorMap[item.color].inactive
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </button>
            );
          })}

          {/* Spacer + Toggle advanced filters */}
          <div className="flex-1" />

          <button
            onClick={() => setSidebarOpen(p => !p)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${sidebarOpen ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {activeFiltersCount > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-600 text-white rounded-full">{activeFiltersCount}</span>
            )}
          </button>
        </div>

        {/* ═══════ SEARCH BAR — modern minimal, always visible ═══════ */}
        <div className="relative mb-5">
          <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search documents by title, content, tags…"
            value={searchQuery}
            onChange={handleSearch}
            className="w-full pl-12 pr-12 py-3.5 text-base bg-white border border-gray-200 rounded-2xl shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:shadow-md transition-all placeholder:text-gray-400"
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(''); setCurrentPage(1); }} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 transition-colors">
              <X size={18} />
            </button>
          )}
        </div>

        {/* ════════════════ HORIZONTAL FILTER BAR ════════════════ */}
        {sidebarOpen && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6 space-y-4">

            {/* Row 1: Status + Category */}
            <div className="flex items-start gap-6 flex-wrap">
              {/* Status */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mr-1">Status</span>
                {[
                  { value: '', label: 'All', activeBg: 'bg-gray-800', activeRing: 'ring-gray-300', inactiveBg: 'bg-gray-50', inactiveText: 'text-gray-700' },
                  { value: 'draft', label: '📝 Draft', activeBg: 'bg-yellow-500', activeRing: 'ring-yellow-200', inactiveBg: 'bg-yellow-50', inactiveText: 'text-yellow-700' },
                  { value: 'under_review', label: '👀 Review', activeBg: 'bg-blue-600', activeRing: 'ring-blue-200', inactiveBg: 'bg-blue-50', inactiveText: 'text-blue-700' },
                  { value: 'analyzed', label: '🔍 Analyzed', activeBg: 'bg-indigo-600', activeRing: 'ring-indigo-200', inactiveBg: 'bg-indigo-50', inactiveText: 'text-indigo-700' },
                  { value: 'approved', label: '✅ Approved', activeBg: 'bg-green-600', activeRing: 'ring-green-200', inactiveBg: 'bg-green-50', inactiveText: 'text-green-700' },
                  { value: 'finalized', label: '🏁 Final', activeBg: 'bg-purple-600', activeRing: 'ring-purple-200', inactiveBg: 'bg-purple-50', inactiveText: 'text-purple-700' },
                  { value: 'executed', label: '⚡ Done', activeBg: 'bg-emerald-600', activeRing: 'ring-emerald-200', inactiveBg: 'bg-emerald-50', inactiveText: 'text-emerald-700' },
                ].map((s) => (
                  <button
                    key={s.value || 'all'}
                    onClick={() => handleFilterChange('status', s.value)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      filters.status === s.value
                        ? `${s.activeBg} text-white shadow-sm ring-2 ${s.activeRing}`
                        : `${s.inactiveBg} ${s.inactiveText} hover:opacity-80`
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Separator */}
              <div className="w-px h-8 bg-gray-200 hidden sm:block" />

              {/* Category */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mr-1">Category</span>
                {filterCategories.map((cat) => (
                  <button
                    key={cat.value || 'all'}
                    onClick={() => handleFilterChange('category', cat.value)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      filters.category === cat.value
                        ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-200'
                        : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Row 3: Sort + Order + Date Range + Metadata toggle */}
            <div className="flex items-center gap-4 flex-wrap">
              {/* Sort */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mr-1">Sort</span>
                {[
                  { value: 'updated_at', label: '🕐 Recent' },
                  { value: 'created_at', label: '📅 Created' },
                  { value: 'title', label: '🔤 Title' },
                  { value: 'status', label: '📊 Status' },
                ].map((sort) => (
                  <button
                    key={sort.value}
                    onClick={() => handleFilterChange('sort', sort.value)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      filters.sort === sort.value
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {sort.label}
                  </button>
                ))}
              </div>

              {/* Separator */}
              <div className="w-px h-8 bg-gray-200 hidden sm:block" />

              {/* Order */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mr-1">Order</span>
                <button
                  onClick={() => handleFilterChange('order', 'desc')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    filters.order === 'desc'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  ⬇️ Newest
                </button>
                <button
                  onClick={() => handleFilterChange('order', 'asc')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    filters.order === 'asc'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  ⬆️ Oldest
                </button>
              </div>

              {/* Separator */}
              <div className="w-px h-8 bg-gray-200 hidden sm:block" />

              {/* Date Range */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">📅 From</span>
                <input
                  type="date"
                  value={filters.date_from}
                  onChange={(e) => handleFilterChange('date_from', e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">📅 To</span>
                <input
                  type="date"
                  value={filters.date_to}
                  onChange={(e) => handleFilterChange('date_to', e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Separator */}
              <div className="w-px h-8 bg-gray-200 hidden sm:block" />

              {/* Metadata toggle */}
              <button
                onClick={() => setShowMetadataPanel(p => !p)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  showMetadataPanel || metadataFilters.filter(mf => mf.key && mf.value).length > 0
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                <Database size={13} />
                Metadata
                {metadataFilters.filter(mf => mf.key && mf.value).length > 0 && (
                  <span className="px-1.5 py-0.5 text-[9px] font-bold bg-emerald-200 text-emerald-800 rounded-full">
                    {metadataFilters.filter(mf => mf.key && mf.value).length}
                  </span>
                )}
              </button>

              {/* Clear All */}
              {activeFiltersCount > 0 && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg border border-red-200 transition-colors ml-auto"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear All
                </button>
              )}
            </div>

            {/* Row 4: Metadata filter builder (expandable) */}
            {showMetadataPanel && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Database size={13} className="text-emerald-600" />
                    <span className="text-xs text-gray-700 font-semibold">Metadata Filters</span>
                    <span className="text-[10px] text-gray-400">Filter by document metadata key-value pairs</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {metadataFilters.length > 0 && (
                      <button
                        onClick={() => { setMetadataFilters([]); setShowMetadataPanel(false); }}
                        className="text-[11px] text-red-500 hover:text-red-700 font-medium"
                      >
                        Clear all
                      </button>
                    )}
                    <button
                      onClick={() => setShowMetadataPanel(false)}
                      className="text-gray-300 hover:text-gray-500"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                {/* Metadata filter rows */}
                <div className="space-y-2">
                  {metadataFilters.map((mf, idx) => (
                    <MetadataFilterRow
                      key={idx}
                      filter={mf}
                      index={idx}
                      metadataKeys={metadataKeys}
                      onUpdate={(i, updated) => {
                        const next = [...metadataFilters];
                        next[i] = updated;
                        setMetadataFilters(next);
                      }}
                      onRemove={(i) => {
                        setMetadataFilters(metadataFilters.filter((_, fi) => fi !== i));
                      }}
                    />
                  ))}
                </div>

                {/* Add filter button */}
                <button
                  onClick={() => setMetadataFilters(prev => [...prev, { key: '', operator: 'contains', value: '' }])}
                  className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-700 font-medium px-2 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors"
                >
                  <Plus size={13} />
                  Add metadata filter
                </button>

                {/* Quick key pills when no filters yet */}
                {metadataFilters.length === 0 && metadataKeys.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="text-[10px] text-gray-400">Quick add:</span>
                    {metadataKeys.slice(0, 12).map((mk) => (
                      <button
                        key={mk.key}
                        onClick={() => setMetadataFilters([...metadataFilters, { key: mk.key, operator: 'contains', value: '' }])}
                        className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 transition-all"
                      >
                        {mk.key}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Active metadata filter badges (when panel closed) */}
            {!showMetadataPanel && metadataFilters.filter(mf => mf.key && mf.value).length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-gray-400">Metadata:</span>
                {metadataFilters.filter(mf => mf.key && mf.value).map((mf, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-emerald-100 text-emerald-700">
                    {mf.key} {(METADATA_OPERATORS.find(op => op.value === mf.operator) || METADATA_OPERATORS[0]).symbol} {mf.value}
                    <button onClick={() => setMetadataFilters(prev => prev.filter((_, fi) => fi !== metadataFilters.indexOf(mf)))} className="hover:text-red-500">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}

          </div>
        )}

        {/* Documents List */}
        {documents.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No documents found</h3>
            <p className="text-gray-600 mb-6">
              {activeFiltersCount > 0
                ? 'Try adjusting your filters or search query'
                : 'Get started by creating your first document'}
            </p>
            {activeFiltersCount > 0 ? (
              <button
                onClick={clearFilters}
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                Clear all filters
              </button>
            ) : (
              <button
                onClick={openCreateDialog}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
              >
                <PenTool className="h-5 w-5" />
                Create Document
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Documents List */}
            <div className="space-y-2 mb-6">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md hover:border-blue-300 transition-all cursor-pointer group"
                  onClick={() => openDocumentInEditor(navigate, doc)}
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* Left: Document Info */}
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      {/* Icon */}
                      <div className="flex-shrink-0 bg-gradient-to-br from-blue-50 to-blue-100 p-3 rounded-xl group-hover:from-blue-100 group-hover:to-blue-200 transition-all">
                        <FileText className="h-6 w-6 text-blue-600" />
                      </div>

                      {/* Document Details */}
                      <div className="flex-1 min-w-0">
                        {renamingId === doc.id ? (
                          <div className="mb-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <input
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  submitRename(doc.id);
                                }
                                if (e.key === 'Escape') {
                                  e.preventDefault();
                                  cancelRename();
                                }
                              }}
                              className="w-full max-w-md rounded-lg border border-blue-300 px-3 py-2 text-sm font-medium text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                              autoFocus
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                submitRename(doc.id);
                              }}
                              disabled={actionBusy}
                              className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelRename();
                              }}
                              disabled={actionBusy}
                              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <h3 className="text-base font-semibold text-gray-900 mb-1 truncate group-hover:text-blue-600 transition-colors">
                            {doc.title}
                          </h3>
                        )}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <span className="font-medium text-gray-700">{doc.created_by}</span>
                          </span>
                          <span className="text-gray-300">•</span>
                          <span>{new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                          {doc.category && (
                            <>
                              <span className="text-gray-300">•</span>
                              <span className="px-2 py-0.5 bg-gray-100 rounded-md capitalize text-gray-700 font-medium">
                                {doc.category}
                              </span>
                            </>
                          )}
                          {doc.document_mode === 'quick_latex' && (
                            <>
                              <span className="text-gray-300">•</span>
                              <span className="px-2 py-0.5 bg-violet-100 rounded-md text-violet-700 font-medium">
                                LaTeX
                              </span>
                            </>
                          )}
                          {doc.is_master && (
                            <>
                              <span className="text-gray-300">•</span>
                              <span className="px-2 py-0.5 bg-amber-100 rounded-md text-amber-700 font-medium">
                                Master
                              </span>
                            </>
                          )}
                        </div>

                        {/* Collaboration Badges Row */}
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          {/* Comment count */}
                          {doc.comment_count > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                              <MessageSquare className="h-3 w-3" />
                              {doc.comment_count}
                            </span>
                          )}

                          {/* Share count */}
                          {doc.share_count > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
                              <Share2 className="h-3 w-3" />
                              {doc.share_count}
                            </span>
                          )}

                          {/* Approval summary */}
                          {doc.approval_summary && doc.approval_summary.total > 0 && (
                            <>
                              {doc.approval_summary.approved > 0 && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                                  <CheckCircle className="h-3 w-3" />
                                  {doc.approval_summary.approved} approved
                                </span>
                              )}
                              {doc.approval_summary.rejected > 0 && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
                                  <XCircle className="h-3 w-3" />
                                  {doc.approval_summary.rejected} rejected
                                </span>
                              )}
                              {doc.approval_summary.changes_requested > 0 && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                                  <AlertTriangle className="h-3 w-3" />
                                  {doc.approval_summary.changes_requested} changes
                                </span>
                              )}
                            </>
                          )}

                          {/* Active workflow */}
                          {doc.workflows && doc.workflows.length > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                              <GitBranch className="h-3 w-3" />
                              {doc.workflows[0].status || 'workflow'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: Status and Actions */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {/* Status Badge */}
                      <span
                        className={`px-3 py-1.5 text-xs font-semibold rounded-full ${getStatusBadge(
                          doc.status
                        )}`}
                      >
                        {formatStatusLabel(doc.status)}
                      </span>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openDocumentInEditor(navigate, doc);
                          }}
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Open in editor"
                        >
                          <PenTool className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => handleExport(doc.id, e)}
                          className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                          title="Export document"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <div
                          className="relative"
                          ref={(node) => {
                            if (node) {
                              menuRefs.current.set(doc.id, node);
                            } else {
                              menuRefs.current.delete(doc.id);
                            }
                          }}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId((prev) => (prev === doc.id ? null : doc.id));
                            }}
                            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                            title="More actions"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>

                          {openMenuId === doc.id && (
                            <div className="absolute right-0 top-11 z-20 w-52 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl">
                              {[
                                {
                                  key: 'details',
                                  label: 'Details',
                                  icon: Info,
                                  onClick: (event) => openDetails(doc, event),
                                },
                                {
                                  key: 'rename',
                                  label: 'Rename',
                                  icon: Pencil,
                                  onClick: (event) => beginRename(doc, event),
                                },
                                {
                                  key: 'duplicate',
                                  label: 'Duplicate',
                                  icon: Copy,
                                  onClick: (event) => {
                                    event.stopPropagation();
                                    setOpenMenuId(null);
                                    setDuplicateTarget(doc);
                                  },
                                },
                                {
                                  key: 'master',
                                  label: 'Make master',
                                  icon: Crown,
                                  onClick: (event) => {
                                    event.stopPropagation();
                                    setOpenMenuId(null);
                                    setPromoteTarget(doc);
                                  },
                                  disabled: doc.document_mode === 'quick_latex',
                                },
                                {
                                  key: 'open',
                                  label: 'Open editor',
                                  icon: ExternalLink,
                                  onClick: (event) => {
                                    event.stopPropagation();
                                    setOpenMenuId(null);
                                    openDocumentInEditor(navigate, doc);
                                  },
                                },
                                {
                                  key: 'delete',
                                  label: 'Delete',
                                  icon: Trash2,
                                  onClick: (event) => {
                                    event.stopPropagation();
                                    setOpenMenuId(null);
                                    setDeleteTarget(doc);
                                  },
                                  danger: true,
                                },
                              ].map((action) => {
                                const Icon = action.icon;
                                return (
                                  <button
                                    key={action.key}
                                    onClick={action.onClick}
                                    disabled={action.disabled}
                                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                                      action.danger
                                        ? 'text-red-600 hover:bg-red-50'
                                        : action.disabled
                                          ? 'cursor-not-allowed text-gray-300'
                                          : 'text-gray-700 hover:bg-gray-50'
                                    }`}
                                  >
                                    <Icon className="h-4 w-4" />
                                    <span>{action.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                {/* Results Info */}
                <div className="text-sm text-gray-600">
                  <span className="font-medium text-gray-900">
                    {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, totalCount)}
                  </span>
                  {' '}of{' '}
                  <span className="font-medium text-gray-900">{totalCount}</span>
                </div>

                {/* Page Navigation */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronLeft className="h-5 w-5 text-gray-600" />
                  </button>

                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum;
                      if (totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (currentPage <= 3) {
                        pageNum = i + 1;
                      } else if (currentPage >= totalPages - 2) {
                        pageNum = totalPages - 4 + i;
                      } else {
                        pageNum = currentPage - 2 + i;
                      }

                      return (
                        <button
                          key={pageNum}
                          onClick={() => setCurrentPage(pageNum)}
                          className={`min-w-[36px] h-9 px-3 rounded-lg text-sm font-medium transition-all ${
                            currentPage === pageNum
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronRight className="h-5 w-5 text-gray-600" />
                  </button>
                </div>

                {/* Page Size */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Show:</span>
                  <div className="flex gap-1">
                    {[10, 20, 50, 100].map(size => (
                      <button
                        key={size}
                        onClick={() => {
                          setPageSize(size);
                          setCurrentPage(1);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                          pageSize === size
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {/* end max-w */}

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete document"
        message={deleteTarget ? `Delete "${deleteTarget.title}"? This action cannot be undone.` : ''}
        confirmText={actionBusy ? 'Deleting…' : 'Delete'}
        onConfirm={confirmDelete}
        onCancel={() => !actionBusy && setDeleteTarget(null)}
        variant="danger"
      />

      <Modal
        open={!!detailsDoc}
        onClose={() => {
          setDetailsDoc(null);
          setDetailsError('');
        }}
        title={detailsDoc ? `Document Details — ${detailsDoc.title || 'Untitled'}` : 'Document Details'}
        size="md"
      >
        {isDetailsLoading ? (
          <div className="py-10 text-center text-sm text-gray-500">Loading document details…</div>
        ) : detailsError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {detailsError}
          </div>
        ) : detailsDoc ? (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              {detailRows.map((row) => (
                <div key={row.label} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{row.label}</div>
                  <div className="break-words text-sm font-medium text-gray-900">{row.value}</div>
                </div>
              ))}
            </div>

            {Array.isArray(detailsDoc.tags) && detailsDoc.tags.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Tags</h4>
                <div className="flex flex-wrap gap-2">
                  {detailsDoc.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {detailsDoc.summary && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Summary</h4>
                <p className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm leading-6 text-gray-700">
                  {detailsDoc.summary}
                </p>
              </div>
            )}

            {detailsDoc.description && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Description</h4>
                <p className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm leading-6 text-gray-700">
                  {detailsDoc.description}
                </p>
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      {duplicateTarget && (
        <DuplicateDocumentDialog
          documentId={duplicateTarget.id}
          documentTitle={duplicateTarget.title}
          onDuplicated={refreshDocuments}
          onClose={() => setDuplicateTarget(null)}
        />
      )}

      {promoteTarget && (
        <PromoteToMasterDialog
          documentId={promoteTarget.id}
          documentTitle={promoteTarget.title}
          onPromoted={refreshDocuments}
          onClose={() => setPromoteTarget(null)}
        />
      )}
    </div>
  );
};

export default Documents;
