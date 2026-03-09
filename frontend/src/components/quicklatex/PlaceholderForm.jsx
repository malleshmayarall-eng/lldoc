/**
 * PlaceholderForm – Displays detected [[placeholder]] keys from the LaTeX code
 * and lets the user fill in metadata values for each.
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Save, Settings2, AlertCircle, CheckCircle2 } from 'lucide-react';

const PlaceholderForm = ({
  placeholders = [],
  documentMetadata = {},
  onUpdate,
  onRefresh,
}) => {
  const [values, setValues] = useState({});
  const [dirty, setDirty] = useState(false);

  // Normalise: API returns [{key, current_value, has_value}] or plain strings
  const keys = placeholders.map((p) => (typeof p === 'string' ? p : p.key));

  // Sync incoming metadata into local values
  useEffect(() => {
    const initial = {};
    placeholders.forEach((p) => {
      const k = typeof p === 'string' ? p : p.key;
      initial[k] = documentMetadata[k] ?? (typeof p === 'object' ? p.current_value : '') ?? '';
    });
    setValues(initial);
    setDirty(false);
  }, [placeholders, documentMetadata]);

  const handleChange = useCallback((key, val) => {
    setValues((prev) => ({ ...prev, [key]: val }));
    setDirty(true);
  }, []);

  const handleSave = useCallback(() => {
    onUpdate?.(values);
    setDirty(false);
  }, [values, onUpdate]);

  const filledCount = keys.filter((k) => values[k]?.trim?.()).length;
  const totalCount = keys.length;

  if (totalCount === 0) {
    return (
      <div className="text-center py-6 text-gray-400">
        <Settings2 size={28} className="mx-auto mb-2 opacity-50" />
        <p className="text-sm font-medium text-gray-500">No placeholders detected</p>
        <p className="text-xs mt-1 max-w-[200px] mx-auto">
          Add <code className="bg-gray-100 px-1 rounded text-gray-600">{'[[key]]'}</code> patterns in your LaTeX code to create fillable fields.
        </p>
        <button
          onClick={onRefresh}
          className="mt-3 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 mx-auto"
        >
          <RefreshCw size={12} />
          Re-scan code
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {filledCount === totalCount ? (
            <CheckCircle2 size={13} className="text-green-500" />
          ) : (
            <AlertCircle size={13} className="text-amber-500" />
          )}
          <span>
            {filledCount}/{totalCount} filled
          </span>
        </div>
        <button
          onClick={onRefresh}
          className="p-1 rounded hover:bg-gray-100 text-gray-400"
          title="Re-scan for placeholders"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Fields */}
      {keys.map((key) => (
        <div key={key}>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            {key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </label>
          <input
            value={values[key] || ''}
            onChange={(e) => handleChange(key, e.target.value)}
            placeholder={`Enter ${key.replace(/_/g, ' ')}...`}
            className={`w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
              values[key]?.trim() ? 'border-green-200 bg-green-50/30' : 'border-gray-200'
            }`}
          />
        </div>
      ))}

      {/* Save */}
      {dirty && (
        <button
          onClick={handleSave}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
        >
          <Save size={14} />
          Save Placeholder Values
        </button>
      )}
    </div>
  );
};

export default PlaceholderForm;
