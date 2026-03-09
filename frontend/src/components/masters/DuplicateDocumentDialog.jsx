/**
 * DuplicateDocumentDialog
 *
 * Modal dialog for duplicating any document.
 * Can be imported and used from multiple pages (Documents, Masters, etc.)
 */

import { useState, useCallback } from 'react';
import { Copy, Loader2, X } from 'lucide-react';

const DuplicateDocumentDialog = ({ documentId, documentTitle, onDuplicated, onClose }) => {
  const [form, setForm] = useState({
    title: documentTitle ? `${documentTitle} (Copy)` : '',
    include_structure: true,
    include_images: true,
    duplicate_notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: typeof e === 'boolean' ? e : e.target.value }));

  const handleSubmit = useCallback(
    async (e) => {
      e?.preventDefault();
      setLoading(true);
      setError(null);

      try {
        const { default: masterService } = await import('../../services/masterService');

        const payload = {
          source_document: documentId,
          include_structure: form.include_structure,
          include_images: form.include_images,
        };
        if (form.title.trim()) payload.title = form.title.trim();
        if (form.duplicate_notes.trim()) payload.duplicate_notes = form.duplicate_notes.trim();

        // Use standalone duplicate endpoint or the document action
        let result;
        if (documentId) {
          result = await masterService.duplicateDocumentAction(documentId, payload);
        } else {
          result = await masterService.duplicateDocument(payload);
        }

        onDuplicated?.(result);
        onClose?.();
      } catch (err) {
        setError(err.response?.data?.error || err.response?.data?.detail || err.message);
      } finally {
        setLoading(false);
      }
    },
    [form, documentId, onDuplicated, onClose],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Copy className="h-5 w-5 text-blue-600" />
            <h3 className="text-lg font-bold text-gray-900">Duplicate Document</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Source */}
          {documentTitle && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Source Document</label>
              <p className="text-sm text-gray-900 font-medium truncate">{documentTitle}</p>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">New Document Title</label>
            <input
              value={form.title}
              onChange={set('title')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Title for the duplicate"
              autoFocus
            />
          </div>

          {/* Toggles */}
          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.include_structure}
                onChange={(e) => set('include_structure')(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Include section/paragraph structure</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.include_images}
                onChange={(e) => set('include_images')(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Include images</span>
            </label>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Notes</label>
            <textarea
              value={form.duplicate_notes}
              onChange={set('duplicate_notes')}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Optional notes..."
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
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            {loading ? 'Duplicating…' : 'Duplicate'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DuplicateDocumentDialog;
