import React, { useState, useEffect, useCallback } from 'react';
import { workflowApi } from '../api/clmApi';
import { StatusBadge, ConfidenceBar, SourceBadge, Spinner, Tabs } from './ui/SharedUI';
import notify from '../utils/notify';
import {
  Save, X, Check, AlertTriangle, Edit3, RotateCcw,
  Filter, ChevronDown, ChevronRight,
} from 'lucide-react';

/**
 * FieldEditor — View and edit individual ExtractedField rows for a document.
 * Shows confidence, raw vs standardized values, manual edit flags, needs_review.
 */
export default function FieldEditor({ workflowId, documentId, onUpdate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState('');
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [editDisplay, setEditDisplay] = useState('');
  const [saving, setSaving] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const fetchFields = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      if (sourceFilter) params.source = sourceFilter;
      const { data: result } = await workflowApi.documentFields(workflowId, documentId, params);
      setData(result);
    } catch {
      notify.error('Failed to load fields');
    } finally {
      setLoading(false);
    }
  }, [workflowId, documentId, sourceFilter]);

  useEffect(() => { fetchFields(); }, [fetchFields]);

  // ── Save Field Edit ────────────────────────────────────────────────────
  const handleSave = async (fieldId) => {
    setSaving(true);
    try {
      const payload = {};
      if (editValue !== undefined) payload.standardized_value = editValue;
      if (editDisplay !== undefined) payload.display_value = editDisplay;
      await workflowApi.editField(workflowId, fieldId, payload);
      notify.success('Field updated');
      setEditingField(null);
      fetchFields();
      onUpdate?.();
    } catch {
      notify.error('Failed to update field');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (field) => {
    setEditingField(field.id);
    setEditValue(field.standardized_value);
    setEditDisplay(field.display_value);
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue('');
    setEditDisplay('');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" className="text-indigo-500" />
      </div>
    );
  }

  if (!data) return null;

  const fields = data.fields || [];
  const globalFields = fields.filter((f) => f.source === 'global');
  const workflowFields = fields.filter((f) => f.source === 'workflow');

  return (
    <div>
      {/* Header info */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <StatusBadge status={data.extraction_status} />
          <SourceBadge source={data.text_source} />
          <span className="text-xs text-gray-400">{fields.length} fields total</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            <input type="checkbox" checked={showRaw} onChange={(e) => setShowRaw(e.target.checked)} className="rounded border-gray-300 text-indigo-600" />
            Show raw values
          </label>
          <div className="flex gap-1">
            {['', 'global', 'workflow'].map((s) => (
              <button
                key={s}
                onClick={() => setSourceFilter(s)}
                className={`px-2 py-1 rounded text-[11px] font-medium ${sourceFilter === s ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
              >
                {s || 'All'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Fields Table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Field</th>
              <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Value</th>
              {showRaw && <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Raw Value</th>}
              <th className="text-center px-4 py-2.5 text-[11px] uppercase tracking-wider text-gray-400 font-semibold w-20">Source</th>
              <th className="text-center px-4 py-2.5 text-[11px] uppercase tracking-wider text-gray-400 font-semibold w-24">Confidence</th>
              <th className="text-center px-4 py-2.5 text-[11px] uppercase tracking-wider text-gray-400 font-semibold w-16">Status</th>
              <th className="text-right px-4 py-2.5 text-[11px] uppercase tracking-wider text-gray-400 font-semibold w-20">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {fields.length === 0 ? (
              <tr>
                <td colSpan={showRaw ? 7 : 6} className="text-center py-8 text-gray-400 text-sm">
                  No extracted fields found
                </td>
              </tr>
            ) : (
              fields.map((field) => (
                <tr
                  key={field.id}
                  className={`group hover:bg-gray-50/50 ${field.needs_review ? 'bg-amber-50/30' : ''} ${field.is_manually_edited ? 'bg-blue-50/20' : ''}`}
                >
                  {/* Field Name */}
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-gray-800 text-xs">{field.field_name.replace(/_/g, ' ')}</span>
                      {field.is_manually_edited && (
                        <span className="text-[9px] px-1 py-0.5 bg-blue-100 text-blue-600 rounded font-medium">edited</span>
                      )}
                      {field.needs_review && (
                        <AlertTriangle size={12} className="text-amber-500" />
                      )}
                    </div>
                  </td>

                  {/* Value (editable) */}
                  <td className="px-4 py-2.5">
                    {editingField === field.id ? (
                      <div className="flex flex-col gap-1">
                        <input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="px-2 py-1 border rounded text-xs w-full focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                          placeholder="Standardized value"
                          autoFocus
                        />
                        <input
                          value={editDisplay}
                          onChange={(e) => setEditDisplay(e.target.value)}
                          className="px-2 py-1 border rounded text-xs w-full focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                          placeholder="Display value (optional)"
                        />
                      </div>
                    ) : (
                      <span className={`text-xs ${field.standardized_value ? 'text-gray-700' : 'text-gray-300 italic'}`}>
                        {field.standardized_value || '(empty)'}
                      </span>
                    )}
                  </td>

                  {/* Raw Value */}
                  {showRaw && (
                    <td className="px-4 py-2.5">
                      <span className="text-xs text-gray-400 font-mono">
                        {field.raw_value || '—'}
                      </span>
                    </td>
                  )}

                  {/* Source */}
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      field.source === 'global' ? 'bg-indigo-50 text-indigo-600' : 'bg-amber-50 text-amber-600'
                    }`}>
                      {field.source}
                    </span>
                  </td>

                  {/* Confidence */}
                  <td className="px-4 py-2.5">
                    <ConfidenceBar value={field.confidence} />
                  </td>

                  {/* Status icons */}
                  <td className="px-4 py-2.5 text-center">
                    {field.needs_review ? (
                      <AlertTriangle size={14} className="inline text-amber-500" />
                    ) : field.standardized_value ? (
                      <Check size={14} className="inline text-emerald-500" />
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-2.5 text-right">
                    {editingField === field.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleSave(field.id)}
                          disabled={saving}
                          className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                          title="Save"
                        >
                          {saving ? <Spinner size="sm" className="text-emerald-500" /> : <Save size={14} />}
                        </button>
                        <button onClick={cancelEdit} className="p-1 text-gray-400 hover:bg-gray-100 rounded" title="Cancel">
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(field)}
                        className="p-1 text-gray-300 hover:text-indigo-600 hover:bg-indigo-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Edit field"
                      >
                        <Edit3 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Summary footer */}
      <div className="flex items-center justify-between mt-3 text-[11px] text-gray-400">
        <span>
          {globalFields.length} global · {workflowFields.length} workflow ·{' '}
          {fields.filter((f) => f.is_manually_edited).length} manually edited ·{' '}
          {fields.filter((f) => f.needs_review).length} need review
        </span>
        {fields.filter((f) => f.needs_review).length > 0 && (
          <span className="flex items-center gap-1 text-amber-600">
            <AlertTriangle size={12} /> Some fields need manual review
          </span>
        )}
      </div>
    </div>
  );
}
