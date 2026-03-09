/**
 * BulkDuplicateDialog – Spreadsheet-like modal for generating multiple
 * Quick LaTeX documents from a single template by varying metadata.
 */

import { useCallback, useState } from 'react';
import { Layers, Plus, Trash2, X, Loader2 } from 'lucide-react';

const BulkDuplicateDialog = ({ document: doc, placeholders = [], onSubmit, onClose }) => {
  // Each row represents one copy: { title, overrides: { key: value } }
  const [rows, setRows] = useState([
    { title: `${doc.title} — Copy 1`, overrides: {} },
    { title: `${doc.title} — Copy 2`, overrides: {} },
  ]);

  const addRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      { title: `${doc.title} — Copy ${prev.length + 1}`, overrides: {} },
    ]);
  }, [doc.title]);

  const removeRow = useCallback((idx) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const updateTitle = useCallback((idx, val) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, title: val } : r)));
  }, []);

  const updateOverride = useCallback((idx, key, val) => {
    setRows((prev) =>
      prev.map((r, i) =>
        i === idx ? { ...r, overrides: { ...r.overrides, [key]: val } } : r
      )
    );
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    const copies = rows.map((row) => {
      const cleanOverrides = {};
      Object.entries(row.overrides).forEach(([k, v]) => {
        if (v.trim()) cleanOverrides[k] = v;
      });
      return {
        title: row.title.trim(),
        metadata_overrides: Object.keys(cleanOverrides).length > 0 ? cleanOverrides : undefined,
      };
    });
    onSubmit(copies);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl mx-4 max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-indigo-600" />
            <span className="font-semibold text-gray-800">Bulk Duplicate</span>
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
              {rows.length} copies
            </span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400">
            <X size={18} />
          </button>
        </div>

        {/* Table */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-auto p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wider">
                  <th className="pb-2 pr-2 w-8">#</th>
                  <th className="pb-2 pr-2 min-w-[180px]">Title</th>
                  {placeholders.map((key) => (
                    <th key={key} className="pb-2 pr-2 min-w-[120px]">
                      {key.replace(/_/g, ' ')}
                    </th>
                  ))}
                  <th className="pb-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row, idx) => (
                  <tr key={idx} className="group">
                    <td className="py-1.5 pr-2 text-xs text-gray-400 align-top pt-3">
                      {idx + 1}
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        value={row.title}
                        onChange={(e) => updateTitle(idx, e.target.value)}
                        required
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:ring-1 focus:ring-blue-500"
                      />
                    </td>
                    {placeholders.map((key) => (
                      <td key={key} className="py-1.5 pr-2">
                        <input
                          value={row.overrides[key] || ''}
                          onChange={(e) => updateOverride(idx, key, e.target.value)}
                          placeholder={doc.document_metadata?.[key] || '—'}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:ring-1 focus:ring-blue-500"
                        />
                      </td>
                    ))}
                    <td className="py-1.5">
                      {rows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeRow(idx)}
                          className="p-1 rounded text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <button
              type="button"
              onClick={addRow}
              className="mt-2 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700"
            >
              <Plus size={13} />
              Add row
            </button>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 bg-gray-50 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-md"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 flex items-center gap-1.5"
            >
              <Layers size={14} />
              Create {rows.length} Copies
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default BulkDuplicateDialog;
