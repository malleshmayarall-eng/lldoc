import React, { useMemo, useState } from 'react';

const normalizeKey = (value) => (value || '')
  .trim()
  .replace(/^\[\[\s*/, '')
  .replace(/\s*\]\]?$/, '');

const MetadataPlaceholderPicker = ({
  isOpen,
  documentMetadata, // Changed from metadata to documentMetadata
  anchorPosition,
  query = '',
  onClose,
  onSelect,
  onCreate,
}) => {
  const [newValue, setNewValue] = useState('');

  const normalizedMetadata = useMemo(() => documentMetadata || {}, [documentMetadata]);

  const rows = useMemo(() => {
    const entries = Object.entries(normalizedMetadata).map(([key, value]) => ({
      key,
      value,
    }));

    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return entries;
    return entries.filter((row) => row.key.toLowerCase().includes(normalizedQuery));
  }, [normalizedMetadata, query]);

  const handleSelect = (key) => {
    if (!key) return;
    onSelect?.(key);
  };

  const handleCreate = () => {
    const key = normalizeKey(query);
    if (!key) return;
    onCreate?.(key, newValue);
    setNewValue('');
  };

  if (!isOpen) return null;

  const panelStyle = anchorPosition
    ? { top: anchorPosition.top, left: anchorPosition.left }
    : undefined;

  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-transparent" onClick={onClose} />
      <div
        className="absolute w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl"
        style={panelStyle}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="text-sm font-semibold text-slate-800">Metadata</div>
          <button
            type="button"
            className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="max-h-28 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Key</th>
                <th className="px-3 py-2 font-semibold">Value</th>
                <th className="px-3 py-2 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length > 0 ? (
                rows.map((row) => (
                  <tr key={row.key} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-900">{row.key}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {row.value == null
                        ? '—'
                        : typeof row.value === 'object'
                          ? JSON.stringify(row.value)
                          : String(row.value)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleSelect(row.key)}
                        className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-100"
                      >
                        Insert
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-3 py-2 text-slate-700" colSpan={3}>
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-semibold text-slate-600">{normalizeKey(query) || 'New field'}</div>
                      <input
                        value={newValue}
                        onChange={(event) => setNewValue(event.target.value)}
                        placeholder="Value"
                        className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                      <button
                        type="button"
                        onClick={handleCreate}
                        className="rounded-md bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                      >
                        Save
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default MetadataPlaceholderPicker;
