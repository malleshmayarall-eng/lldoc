/**
 * DuplicateDialog – Modal for creating a single duplicate of a Quick LaTeX
 * document with optional metadata overrides.
 */

import { useState } from 'react';
import { Copy, Layers, X } from 'lucide-react';

const DuplicateDialog = ({ document: doc, onDuplicate, onBulkDuplicate, onClose }) => {
  const [title, setTitle] = useState(`${doc.title} (Copy)`);
  const [overrides, setOverrides] = useState({});

  // Build override fields from document placeholders
  const placeholderKeys = doc.placeholders || [];

  const handleOverrideChange = (key, value) => {
    setOverrides((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Strip empty overrides
    const cleanOverrides = {};
    Object.entries(overrides).forEach(([k, v]) => {
      if (v.trim()) cleanOverrides[k] = v;
    });

    onDuplicate({
      title: title.trim(),
      metadata_overrides: Object.keys(cleanOverrides).length > 0 ? cleanOverrides : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2 text-gray-800 font-semibold">
            <Copy size={18} />
            Duplicate Document
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400">
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Placeholder overrides */}
          {placeholderKeys.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">
                Override placeholder values (optional)
              </p>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {placeholderKeys.map((key) => (
                  <div key={key} className="flex items-center gap-2">
                    <label className="text-xs text-gray-600 min-w-[100px] truncate" title={key}>
                      {key.replace(/_/g, ' ')}
                    </label>
                    <input
                      value={overrides[key] || ''}
                      onChange={(e) => handleOverrideChange(key, e.target.value)}
                      placeholder={doc.document_metadata?.[key] || '—'}
                      className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-xs focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={onBulkDuplicate}
              className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700"
            >
              <Layers size={14} />
              Bulk duplicate…
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-md"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Create Duplicate
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DuplicateDialog;
