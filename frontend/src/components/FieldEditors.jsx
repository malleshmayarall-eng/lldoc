import React from 'react';

export function TextInput({ label, value, onChange, placeholder, disabled }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-700">{label}</label>
      <input
        type="text"
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

export function NumberInput({ label, value, onChange, placeholder, step = 'any' }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-700">{label}</label>
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        step={step}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

export function SelectInput({ label, value, onChange, options = [], placeholder }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-700">{label}</label>
      <select
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value ?? opt} value={opt.value ?? opt}>
            {opt.label ?? opt}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Toggle({ label, checked, onChange }) {
  return (
    <div className="flex items-center space-x-2">
      <label className="text-xs font-medium text-gray-700">{label}</label>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange?.(e.target.checked)}
        className="h-4 w-4"
      />
    </div>
  );
}

export function TextArea({ label, value, onChange, placeholder, rows = 4 }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-700">{label}</label>
      <textarea
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

// Simple list editor for arrays of strings
export function StringListEditor({ label, values = [], onChange, placeholder }) {
  const updateItem = (idx, val) => {
    const next = [...values];
    next[idx] = val;
    onChange?.(next);
  };
  const addItem = () => onChange?.([...(values || []), '']);
  const removeItem = (idx) => {
    const next = values.filter((_, i) => i !== idx);
    onChange?.(next);
  };
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-gray-700">{label}</label>
      <div className="space-y-2">
        {(values || []).map((v, i) => (
          <div key={i} className="flex items-center space-x-2">
            <input
              type="text"
              value={v ?? ''}
              onChange={(e) => updateItem(i, e.target.value)}
              placeholder={placeholder}
              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => removeItem(i)}
              className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addItem}
          className="px-3 py-2 text-xs text-blue-600 hover:bg-blue-50 rounded"
        >
          Add Item
        </button>
      </div>
    </div>
  );
}

// List editor for arrays of objects with field schema
export function ObjectListEditor({ label, items = [], onChange, schema = [] }) {
  const updateField = (idx, key, val) => {
    const next = [...(items || [])];
    next[idx] = { ...(next[idx] || {}), [key]: val };
    onChange?.(next);
  };
  const addItem = () => onChange?.([...(items || []), {}]);
  const removeItem = (idx) => {
    const next = (items || []).filter((_, i) => i !== idx);
    onChange?.(next);
  };
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-gray-700">{label}</label>
      <div className="space-y-3">
        {(items || []).map((item, i) => (
          <div key={i} className="p-3 border border-gray-200 rounded-lg bg-white">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {schema.map((field) => (
                <div key={field.key}>
                  {field.type === 'text' && (
                    <TextInput
                      label={field.label}
                      value={item?.[field.key] ?? ''}
                      onChange={(val) => updateField(i, field.key, val)}
                      placeholder={field.placeholder}
                    />
                  )}
                  {field.type === 'number' && (
                    <NumberInput
                      label={field.label}
                      value={item?.[field.key] ?? ''}
                      onChange={(val) => updateField(i, field.key, val)}
                      placeholder={field.placeholder}
                    />
                  )}
                  {field.type === 'textarea' && (
                    <TextArea
                      label={field.label}
                      value={item?.[field.key] ?? ''}
                      onChange={(val) => updateField(i, field.key, val)}
                      placeholder={field.placeholder}
                      rows={3}
                    />
                  )}
                  {field.type === 'select' && (
                    <SelectInput
                      label={field.label}
                      value={item?.[field.key] ?? ''}
                      onChange={(val) => updateField(i, field.key, val)}
                      options={field.options || []}
                      placeholder={field.placeholder}
                    />
                  )}
                  {field.type === 'toggle' && (
                    <Toggle
                      label={field.label}
                      checked={!!item?.[field.key]}
                      onChange={(val) => updateField(i, field.key, val)}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => removeItem(i)}
                className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addItem}
          className="px-3 py-2 text-xs text-blue-600 hover:bg-blue-50 rounded"
        >
          Add Item
        </button>
      </div>
    </div>
  );
}
