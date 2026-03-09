/**
 * PromoteToMasterDialog
 *
 * Modal to promote an existing document to a master document.
 * The user picks a document (or the document is pre-selected),
 * gives the master a name/category/tags, and submits.
 */

import { useState, useCallback, useEffect } from 'react';
import { ArrowUpRight, Loader2, Search, X } from 'lucide-react';

const CATEGORY_OPTIONS = [
  { value: 'contract', label: 'Contract' },
  { value: 'policy', label: 'Policy' },
  { value: 'nda', label: 'NDA' },
  { value: 'employment', label: 'Employment' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'terms', label: 'Terms & Conditions' },
  { value: 'memo', label: 'Memo' },
  { value: 'letter', label: 'Letter' },
  { value: 'custom', label: 'Custom' },
];

const PromoteToMasterDialog = ({ documentId: preselectedId, documentTitle, onPromoted, onClose }) => {
  const [form, setForm] = useState({
    document_id: preselectedId || '',
    name: documentTitle ? `${documentTitle} — Master` : '',
    category: 'contract',
    tags: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Search for documents if no preselected doc
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState(
    preselectedId ? { id: preselectedId, title: documentTitle } : null,
  );

  useEffect(() => {
    if (!searchQuery.trim() || preselectedId) return;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const { default: api } = await import('../../services/api');
        const { data } = await api.get('/documents/', { params: { search: searchQuery, page_size: 8 } });
        setSearchResults(data.results || data || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery, preselectedId]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSelectDoc = (doc) => {
    setSelectedDoc(doc);
    setForm((f) => ({
      ...f,
      document_id: doc.id,
      name: f.name || `${doc.title || 'Untitled'} — Master`,
    }));
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleSubmit = useCallback(
    async (e) => {
      e?.preventDefault();
      if (!form.document_id) { setError('Select a document to promote'); return; }
      if (!form.name.trim()) { setError('Name is required'); return; }

      setLoading(true);
      setError(null);

      try {
        const { default: masterService } = await import('../../services/masterService');

        const payload = {
          document_id: form.document_id,
          name: form.name.trim(),
          category: form.category,
        };
        if (form.tags.trim()) {
          payload.tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
        }

        const result = await masterService.promoteToMaster(payload);
        onPromoted?.(result);
        onClose?.();
      } catch (err) {
        setError(err.response?.data?.error || err.response?.data?.detail || err.message);
      } finally {
        setLoading(false);
      }
    },
    [form, onPromoted, onClose],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <ArrowUpRight className="h-5 w-5 text-green-600" />
            <h3 className="text-lg font-bold text-gray-900">Promote to Master</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Document selector */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Document *</label>
            {selectedDoc ? (
              <div className="flex items-center justify-between border border-green-200 bg-green-50 rounded-lg px-3 py-2">
                <span className="text-sm font-medium text-gray-900 truncate">{selectedDoc.title || 'Untitled'}</span>
                {!preselectedId && (
                  <button
                    type="button"
                    onClick={() => { setSelectedDoc(null); setForm((f) => ({ ...f, document_id: '' })); }}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Change
                  </button>
                )}
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="Search documents…"
                  autoFocus
                />
                {(searchResults.length > 0 || searching) && (
                  <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto z-10">
                    {searching ? (
                      <div className="flex items-center gap-2 px-3 py-3 text-sm text-gray-500">
                        <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                      </div>
                    ) : (
                      searchResults.map((doc) => (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => handleSelectDoc(doc)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 truncate"
                        >
                          {doc.title || 'Untitled'}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Master Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Master Name *</label>
            <input
              value={form.name}
              onChange={set('name')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="Name for the master document"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Category</label>
            <select
              value={form.category}
              onChange={set('category')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Tags</label>
            <input
              value={form.tags}
              onChange={set('tags')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="tag1, tag2, tag3"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !form.document_id || !form.name.trim()}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
            {loading ? 'Promoting…' : 'Promote'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PromoteToMasterDialog;
