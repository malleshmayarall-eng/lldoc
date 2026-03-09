import React, { useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';

const createRowId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** Ensure value is always a displayable/editable string for the input */
const toDisplayString = (val) => {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) {
    // Array of objects (e.g. parties: [{name, role}]) → readable string
    return val
      .map((item) =>
        typeof item === 'object' && item !== null
          ? Object.values(item).filter(Boolean).join(' — ')
          : String(item),
      )
      .join(', ');
  }
  if (typeof val === 'object') {
    // Flat object → key: value pairs
    return Object.entries(val)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(', ');
  }
  return String(val);
};

const createRow = (row = {}) => ({
  id: row.id || createRowId(),
  key: row.key ?? '',
  value: toDisplayString(row.value),
});

const MetadataSidebar = React.forwardRef(({
  isOpen,
  targetType,
  targetLabel,
  metadata,
  onClose,
  onSave,
  embedded = false,
}, ref) => {
  const initialRows = useMemo(() => {
    if (Array.isArray(metadata) && metadata.length > 0) {
      return metadata.map((row) => createRow(row));
    }
    if (metadata && typeof metadata === 'object') {
      return Object.entries(metadata).map(([key, value]) => createRow({ key, value }));
    }
    return [createRow()];
  }, [metadata]);

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
  };

  const title = targetType === 'section'
    ? 'Section metadata'
    : targetType === 'table'
      ? 'Table metadata'
      : targetType === 'latex'
        ? 'LaTeX block metadata'
        : 'Paragraph metadata';

  const contentClass = embedded ? 'my-auto overflow-y-auto' : 'flex-1 overflow-y-auto';

  const content = (
    <>
      <div className={`${contentClass} px-4 py-3`}>
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={row.id} className="flex items-center gap-2">
              <input
                value={row.key}
                onChange={(e) => handleRowChange(index, 'key', e.target.value)}
                placeholder="Field"
                className="w-1/2 rounded border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                value={row.value}
                onChange={(e) => handleRowChange(index, 'value', e.target.value)}
                placeholder="Value"
                className="w-1/2 rounded border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
          className="rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-700"
        >
          Save metadata
        </button>
      </div>
    </>
  );

  if (embedded) {
    return (
      <div ref={ref} className="flex flex-col">
        {content}
      </div>
    );
  }

  return (
    <aside
      ref={ref}
      className="w-80 min-w-[280px] shrink-0 bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col h-full"
    >
      <div className="p-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-800">{title}</div>
          <div className="text-xs text-gray-500">
            {targetLabel || (targetType === 'section' ? 'No title set' : targetType === 'table' ? 'No caption set' : 'No topic set')}
          </div>
        </div>
        <button
          type="button"
          className="rounded p-1 text-gray-500 hover:bg-gray-200"
          onClick={onClose}
          title="Close"
        >
          <X size={16} />
        </button>
      </div>
      {content}
    </aside>
  );
});

MetadataSidebar.displayName = 'MetadataSidebar';

export default MetadataSidebar;
