import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { documentService } from '../services/documentService';
import {
  FileText,
  Search,
  Filter,
  Eye,
  PenTool,
  Users,
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
} from 'lucide-react';

const Documents = () => {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [pageSize, setPageSize] = useState(20);

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

  useEffect(() => {
    loadDocuments();
  }, [currentPage, pageSize, filters, searchQuery]);

  const loadDocuments = async () => {
    try {
      setLoading(true);
      const params = {
        page: currentPage,
        page_size: pageSize,
        search: searchQuery || undefined,
        ...Object.fromEntries(
          Object.entries(filters).filter(([_, v]) => v !== '' && v !== false)
        ),
      };

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
  };

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
    setCurrentPage(1);
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this document?')) {
      try {
        await documentService.deleteDocument(id);
        loadDocuments();
      } catch (error) {
        console.error('Error deleting document:', error);
      }
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

  const activeFiltersCount = Object.values(filters).filter(
    v => v !== '' && v !== false
  ).length + (searchQuery ? 1 : 0);

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
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={openCreateDialog}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                <PenTool className="h-5 w-5" />
                New Document
              </button>
            </div>
          </div>
        </div>

        {/* Search and Filter Bar */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
          {/* Quick Filters */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                Quick Filters
              </span>
              {activeFiltersCount > 0 && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded-md transition-colors"
                >
                  <X className="h-3 w-3" />
                  Clear All
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                onClick={() => {
                  clearFilters();
                }}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  !filters.created_by_me && !filters.assigned_to_me && !filters.shared_with_me
                    ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-sm'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                }`}
              >
                📄 All
              </button>
              <button
                onClick={() => {
                  setFilters(prev => ({
                    ...prev,
                    created_by_me: true,
                    assigned_to_me: false,
                    shared_with_me: false
                  }));
                  setCurrentPage(1);
                }}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  filters.created_by_me && !filters.assigned_to_me && !filters.shared_with_me
                    ? 'bg-gradient-to-r from-purple-600 to-purple-700 text-white shadow-sm'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                }`}
              >
                ✏️ Mine
              </button>
              <button
                onClick={() => {
                  setFilters(prev => ({
                    ...prev,
                    created_by_me: false,
                    assigned_to_me: true,
                    shared_with_me: false
                  }));
                  setCurrentPage(1);
                }}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  filters.assigned_to_me && !filters.created_by_me && !filters.shared_with_me
                    ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-sm'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                }`}
              >
                📋 Assigned
              </button>
              <button
                onClick={() => {
                  setFilters(prev => ({
                    ...prev,
                    created_by_me: false,
                    assigned_to_me: false,
                    shared_with_me: true
                  }));
                  setCurrentPage(1);
                }}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  filters.shared_with_me && !filters.created_by_me && !filters.assigned_to_me
                    ? 'bg-gradient-to-r from-green-600 to-green-700 text-white shadow-sm'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                }`}
              >
                🔗 Shared
              </button>
            </div>
          </div>

          {/* Status Filters */}
          <div className="mb-4">
            <span className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2 block">
              Status
            </span>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              <button
                onClick={() => handleFilterChange('status', '')}
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                  filters.status === ''
                    ? 'bg-gray-800 text-white shadow-sm ring-2 ring-gray-300'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                }`}
              >
                All
              </button>
              <button
                onClick={() => handleFilterChange('status', 'draft')}
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                  filters.status === 'draft'
                    ? 'bg-yellow-500 text-white shadow-sm ring-2 ring-yellow-200'
                    : 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                }`}
              >
                📝 Draft
              </button>
              <button
                onClick={() => handleFilterChange('status', 'under_review')}
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                  filters.status === 'under_review'
                    ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-200'
                    : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                }`}
              >
                👀 Review
              </button>
              <button
                onClick={() => handleFilterChange('status', 'analyzed')}
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                  filters.status === 'analyzed'
                    ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-200'
                    : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                }`}
              >
                🔍 Analyzed
              </button>
              <button
                onClick={() => handleFilterChange('status', 'approved')}
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                  filters.status === 'approved'
                    ? 'bg-green-600 text-white shadow-sm ring-2 ring-green-200'
                    : 'bg-green-50 text-green-700 hover:bg-green-100'
                }`}
              >
                ✅ Approved
              </button>
              <button
                onClick={() => handleFilterChange('status', 'finalized')}
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                  filters.status === 'finalized'
                    ? 'bg-purple-600 text-white shadow-sm ring-2 ring-purple-200'
                    : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
                }`}
              >
                🏁 Final
              </button>
              <button
                onClick={() => handleFilterChange('status', 'executed')}
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                  filters.status === 'executed'
                    ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-200'
                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                ⚡ Done
              </button>
            </div>
          </div>

          {/* Category Filters */}
          <div className="mb-4">
            <span className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2 block">
              Category
            </span>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              {['', 'contract', 'policy', 'report', 'agreement', 'memo', 'other'].map((category) => {
                const icons = {
                  '': '📚',
                  contract: '📜',
                  policy: '📋',
                  report: '📊',
                  agreement: '🤝',
                  memo: '📝',
                  other: '📄'
                };
                return (
                  <button
                    key={category || 'all'}
                    onClick={() => handleFilterChange('category', category)}
                    className={`px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                      filters.category === category
                        ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-200'
                        : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <span className="hidden sm:inline">{icons[category]} </span>
                    {category === '' ? 'All' : category.charAt(0).toUpperCase() + category.slice(1)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sort & Order */}
          <div className="mb-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Sort</span>
              {[
                { value: 'updated_at', label: 'Recent', icon: '🕐' },
                { value: 'created_at', label: 'Created', icon: '📅' },
                { value: 'title', label: 'Title', icon: '🔤' },
                { value: 'status', label: 'Status', icon: '📊' }
              ].map((sort) => (
                <button
                  key={sort.value}
                  onClick={() => handleFilterChange('sort', sort.value)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    filters.sort === sort.value
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {sort.icon} {sort.label}
                </button>
              ))}
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wider ml-2">Order</span>
              <button
                onClick={() => handleFilterChange('order', 'desc')}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  filters.order === 'desc'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                }`}
              >
                ⬇️ Newest
              </button>
              <button
                onClick={() => handleFilterChange('order', 'asc')}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  filters.order === 'asc'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                }`}
              >
                ⬆️ Oldest
              </button>
            </div>
          </div>

          {/* Search & Date Range */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">📅 From</label>
              <input
                type="date"
                value={filters.date_from}
                onChange={(e) => handleFilterChange('date_from', e.target.value)}
                className="w-full px-3 py-2 text-sm border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">📅 To</label>
              <input
                type="date"
                value={filters.date_to}
                onChange={(e) => handleFilterChange('date_to', e.target.value)}
                className="w-full px-3 py-2 text-sm border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">🔍 Search</label>
              <input
                type="text"
                placeholder="Title, content, tags..."
                value={searchQuery}
                onChange={handleSearch}
                className="w-full px-3 py-2 text-sm border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>
          </div>
        </div>

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
                  onClick={() => navigate(`/drafter/${doc.id}`)}
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
                        <h3 className="text-base font-semibold text-gray-900 mb-1 truncate group-hover:text-blue-600 transition-colors">
                          {doc.title}
                        </h3>
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
                        {doc.status.replace('_', ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                      </span>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/drafter/${doc.id}`);
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
    </div>
  );
};

export default Documents;
