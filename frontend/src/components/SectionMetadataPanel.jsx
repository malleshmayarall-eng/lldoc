import React, { useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';

const createRowId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const createRow = (row = {}) => ({
  id: row.id || createRowId(),
  key: row.key ?? '',
  value: row.value ?? '',
});

/**
 * SectionMetadataPanel - floating metadata editor for a section.
 */
const SectionMetadataPanel = ({
  isOpen,
  onClose,
  section,
  onSave,
}) => {
  const initialRows = useMemo(() => {
    if (Array.isArray(section?.metadata) && section.metadata.length > 0) {
      return section.metadata.map((row) => createRow(row));
    }
    if (section?.metadata && typeof section.metadata === 'object') {
      return Object.entries(section.metadata).map(([key, value]) =>
        createRow({ key, value })
      );
    }
    return [createRow()];
  }, [section]);

  const [rows, setRows] = useState(initialRows);

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  if (!isOpen) return null;

  const handleRowChange = (index, field, value) => {
    setRows((prev) =>
      prev.map((row, idx) => (idx === index ? { ...row, [field]: value } : row))
    );
  };

  const handleAddRow = () => {
    setRows((prev) => [...prev, createRow()]);
  };

  const handleRemoveRow = (index) => {
    setRows((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSave = () => {
    const cleaned = rows.reduce((acc, row) => {
      const key = row.key?.trim() || '';
      if (!key) return acc;
      acc[key] = row.value ?? '';
      return acc;
    }, {});
    onSave?.(cleaned);
    onClose?.();
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="absolute right-6 top-24 w-[320px] max-w-[90vw] rounded-xl border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-800">Section metadata</div>
            <div className="text-xs text-gray-500">
              {section?.title ? `Section: ${section.title}` : 'No title set'}
            </div>
          </div>
          <button
            type="button"
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
            onClick={onClose}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
          <div className="space-y-3">
            {rows.map((row, index) => (
              <div key={row.id} className="flex items-center gap-2">
                <input
                  value={row.key}
                  onChange={(e) => handleRowChange(index, 'key', e.target.value)}
                  placeholder="Field"
                  className="w-1/2 rounded border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  value={row.value}
                  onChange={(e) => handleRowChange(index, 'value', e.target.value)}
                  placeholder="Value"
                  className="w-1/2 rounded border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveRow(index)}
                  className="rounded p-1 text-gray-500 hover:bg-gray-100"
                  title="Remove"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={handleAddRow}
            className="mt-3 flex items-center gap-2 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            <Plus size={12} /> Add row
          </button>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
          >
            Save metadata
          </button>
        </div>
      </div>
    </div>
  );
};

export default SectionMetadataPanel;
