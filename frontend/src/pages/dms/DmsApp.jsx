import { useState, useEffect, useCallback, useRef } from 'react';
import { FileStack, HelpCircle, Upload, RefreshCw } from 'lucide-react';
import DmsFilterBar from './components/DmsFilterBar';
import DmsDocumentGrid from './components/DmsDocumentGrid';
import DmsUploadPanel from './components/DmsUploadPanel';
import DmsAlertsPanel from './components/DmsAlertsPanel';
import DmsApiGuide from './components/DmsApiGuide';
import { dmsService } from '../../services/dmsService';

const DmsApp = () => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [totalCount, setTotalCount] = useState(0);
  const [filterOptions, setFilterOptions] = useState(null);
  const [metadataKeys, setMetadataKeys] = useState([]);
  const [filters, setFilters] = useState({
    q: '',
    sort_by: 'created_at',
    sort_dir: 'desc',
  });
  const [metadataFilters, setMetadataFilters] = useState([]); // [{key, value}]
  const [viewMode, setViewMode] = useState('grid');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const debounceRef = useRef(null);

  // ── Load filter options + metadata keys once ──
  useEffect(() => {
    (async () => {
      try {
        const [opts, mKeys] = await Promise.all([
          dmsService.getFilterOptions(),
          dmsService.getMetadataKeys(),
        ]);
        setFilterOptions(opts);
        setMetadataKeys(mKeys || []);
      } catch { /* silent */ }
    })();
  }, []);

  // ── Fetch documents (debounced for q, instant for dropdowns) ──
  const fetchDocuments = useCallback(async (currentFilters, currentMeta, currentPage = 1, append = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = { ...currentFilters, page: currentPage };
      // Include metadata filters if any
      if (currentMeta && currentMeta.length > 0) {
        params.metadata_filters = currentMeta;
      }
      const data = await dmsService.listDocuments(params);
      const results = data.results || data || [];
      setDocuments(prev => append ? [...prev, ...results] : results);
      setTotalCount(data.count ?? results.length);
      setHasMore(!!data.next);
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── When filters or metadata filters change → refetch (debounce text search) ──
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const delay = filters.q ? 400 : 0; // debounce only text search
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchDocuments(filters, metadataFilters, 1);
    }, delay);
    return () => clearTimeout(debounceRef.current);
  }, [filters, metadataFilters, fetchDocuments]);

  const handleFilterChange = (newFilters) => {
    setFilters(newFilters);
  };

  const handleLoadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchDocuments(filters, metadataFilters, next, true);
  };

  const handleRefresh = () => {
    setPage(1);
    fetchDocuments(filters, metadataFilters, 1);
    // Also refresh filter options + metadata keys
    dmsService.getFilterOptions().then(setFilterOptions).catch(() => {});
    dmsService.getMetadataKeys().then(setMetadataKeys).catch(() => {});
  };

  const handleUploaded = (doc) => {
    setDocuments((prev) => [doc, ...prev]);
    setTotalCount((c) => c + 1);
    handleRefresh();
  };

  return (
    <div className="min-h-full bg-gray-50/50 px-6 py-6">
      {/* ── Header ── */}
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 p-2.5 text-white shadow-sm">
            <FileStack className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Document Management</h1>
            <p className="text-xs text-gray-500">Organise, search and manage all your PDF documents</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setGuideOpen(true)}
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            title="API Guide"
          >
            <HelpCircle size={16} />
          </button>
          <button
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 shadow-sm transition-colors"
          >
            <Upload size={14} /> Upload PDF
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Alerts — always visible at the top ── */}
      <div className="mb-5">
        <DmsAlertsPanel />
      </div>

      {/* ── Filter Bar ── */}
      <div className="mb-5">
        <DmsFilterBar
          filters={filters}
          onFilterChange={handleFilterChange}
          filterOptions={filterOptions}
          totalCount={totalCount}
          metadataKeys={metadataKeys}
          metadataFilters={metadataFilters}
          onMetadataFiltersChange={setMetadataFilters}
        />
      </div>

      {/* ── Document Grid/List ── */}
      <DmsDocumentGrid
        documents={documents}
        loading={loading}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onSelect={() => {}}
      />

      {/* ── Load More ── */}
      {hasMore && !loading && (
        <div className="text-center mt-4">
          <button
            onClick={handleLoadMore}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium px-4 py-2 rounded-lg hover:bg-blue-50 transition-colors"
          >
            Load more documents…
          </button>
        </div>
      )}

      {/* ── Upload Modal ── */}
      {uploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="max-w-2xl w-full px-4">
            <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b">
                <h3 className="font-semibold text-gray-900">Upload PDF</h3>
                <button onClick={() => setUploadOpen(false)} className="text-sm text-gray-400 hover:text-gray-600">
                  Close
                </button>
              </div>
              <div className="p-5">
                <DmsUploadPanel
                  onUploaded={(doc) => {
                    handleUploaded(doc);
                    setUploadOpen(false);
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── API Guide Modal ── */}
      {guideOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="max-w-3xl w-full px-4">
            <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b">
                <h3 className="font-semibold text-gray-900">DMS API Guide</h3>
                <button onClick={() => setGuideOpen(false)} className="text-sm text-gray-400 hover:text-gray-600">
                  Close
                </button>
              </div>
              <div className="p-5 max-h-[70vh] overflow-y-auto">
                <DmsApiGuide />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DmsApp;
