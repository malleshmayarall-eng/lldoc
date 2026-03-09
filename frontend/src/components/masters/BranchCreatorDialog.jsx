/**
 * BranchCreatorDialog
 *
 * Modal dialog for creating a new branch from a master document.
 * Fetches the template document's content to extract [[placeholder]] fields,
 * merges with master.default_custom_metadata, and presents a dynamic form
 * so users can fill in values like [[organisation_name]], [[client_address]], etc.
 * Sends them as custom_metadata_overrides on the branch creation request.
 */

import { useState, useCallback, useEffect } from 'react';
import { GitBranch, Loader2, Tag, X } from 'lucide-react';
import { extractPlaceholderFields } from '../../utils/metadataFieldUsageTracker';
import { documentService } from '../../services/documentService';

const BRANCH_TYPES = [
  { value: 'standard', label: 'Standard' },
  { value: 'variant', label: 'Style Variant' },
  { value: 'client_specific', label: 'Client-Specific' },
  { value: 'jurisdiction', label: 'Jurisdiction' },
];

const BranchCreatorDialog = ({ master, onCreated, onClose }) => {
  const [form, setForm] = useState({
    branch_name: '',
    branch_type: 'standard',
    title_override: '',
    branch_notes: '',
    include_content: true,
  });

  // Dynamic custom metadata fields extracted from template [[placeholders]]
  const [customFields, setCustomFields] = useState({});
  const [placeholders, setPlaceholders] = useState([]);
  const [loadingPlaceholders, setLoadingPlaceholders] = useState(false);

  // Add-field row state
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: typeof e === 'boolean' ? e : e.target.value }));

  // ── On mount: fetch template document and extract [[placeholders]] ──
  useEffect(() => {
    if (!master) return;

    const defaults = master.default_custom_metadata || {};
    setCustomFields({ ...defaults });

    if (!master.template_document) {
      // No template doc — just show default_custom_metadata keys
      const fields = Object.keys(defaults).filter((k) => k !== 'processing_settings');
      setPlaceholders(fields);
      return;
    }

    let cancelled = false;
    setLoadingPlaceholders(true);

    (async () => {
      try {
        const doc = await documentService.getCompleteDocument(master.template_document);
        if (cancelled) return;

        const fieldSet = new Set();

        // Extract [[field]] from all paragraph content
        (doc.sections || []).forEach((section) => {
          (section.paragraphs || []).forEach((para) => {
            extractPlaceholderFields(para.content || '').forEach((f) => fieldSet.add(f));
            extractPlaceholderFields(para.edited_text || '').forEach((f) => fieldSet.add(f));
          });
        });

        // Include keys from default_custom_metadata
        Object.keys(defaults).forEach((k) => {
          if (k !== 'processing_settings') fieldSet.add(k);
        });

        // Include keys from the document's own custom_metadata
        const docCustom = doc.custom_metadata || {};
        Object.keys(docCustom).forEach((k) => {
          if (k !== 'processing_settings') fieldSet.add(k);
        });

        const fields = Array.from(fieldSet).sort();
        setPlaceholders(fields);

        // Pre-fill values from doc custom_metadata + master defaults
        setCustomFields((prev) => {
          const merged = { ...prev };
          fields.forEach((f) => {
            if (!(f in merged)) {
              merged[f] = docCustom[f] ?? defaults[f] ?? '';
            }
          });
          return merged;
        });
      } catch {
        // Fallback: show just master defaults
        setPlaceholders(Object.keys(defaults).filter((k) => k !== 'processing_settings'));
      } finally {
        if (!cancelled) setLoadingPlaceholders(false);
      }
    })();

    return () => { cancelled = true; };
  }, [master]);

  const handleAddField = () => {
    const key = newFieldKey.trim().replace(/\s+/g, '_');
    if (!key) return;
    setCustomFields((prev) => ({ ...prev, [key]: newFieldValue.trim() }));
    if (!placeholders.includes(key)) setPlaceholders((prev) => [...prev, key]);
    setNewFieldKey('');
    setNewFieldValue('');
  };

  const handleSubmit = useCallback(
    async (e) => {
      e?.preventDefault();
      if (!form.branch_name.trim()) {
        setError('Branch name is required');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const payload = {
          branch_name: form.branch_name.trim(),
          branch_type: form.branch_type,
          include_content: form.include_content,
        };

        if (form.title_override.trim()) payload.title_override = form.title_override.trim();
        if (form.branch_notes.trim()) payload.branch_notes = form.branch_notes.trim();

        // Build custom_metadata_overrides from filled-in fields
        const customOverrides = {};
        Object.entries(customFields).forEach(([key, value]) => {
          if (value !== '' && value !== null && value !== undefined) {
            customOverrides[key] = value;
          }
        });
        if (Object.keys(customOverrides).length) {
          payload.custom_metadata_overrides = customOverrides;
        }

        // Import service lazily to avoid circular deps
        const { default: masterService } = await import('../../services/masterService');
        const result = await masterService.createBranch(master.id, payload);
        onCreated?.(result);
        onClose?.();
      } catch (err) {
        setError(err.response?.data?.error || err.response?.data?.detail || err.message);
      } finally {
        setLoading(false);
      }
    },
    [form, customFields, master, onCreated, onClose],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-blue-600" />
            <h3 className="text-lg font-bold text-gray-900">Create Branch</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Master name (read-only) */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">From Master</label>
            <p className="text-sm text-gray-900 font-medium">{master?.name}</p>
          </div>

          {/* Branch Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Branch Name *</label>
            <input
              value={form.branch_name}
              onChange={set('branch_name')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Acme Corp — Q2 2025"
              autoFocus
            />
          </div>

          {/* Branch Type */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Branch Type</label>
            <select
              value={form.branch_type}
              onChange={set('branch_type')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {BRANCH_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Title Override */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Title Override</label>
            <input
              value={form.title_override}
              onChange={set('title_override')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Custom document title (optional)"
            />
          </div>

          {/* ── Dynamic custom metadata fields ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase">
                <Tag className="h-3.5 w-3.5" />
                Document Fields
              </label>
              {loadingPlaceholders && (
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  <Loader2 className="h-3 w-3 animate-spin" /> Scanning…
                </span>
              )}
            </div>

            {placeholders.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">
                  Fill values for <code className="bg-gray-100 px-1 py-0.5 rounded text-[10px]">[[field]]</code> placeholders in the template.
                </p>
                {placeholders.map((field) => (
                  <div key={field} className="flex items-center gap-2">
                    <label className="w-40 shrink-0 text-xs font-medium text-gray-600 flex items-center gap-0.5 truncate" title={field}>
                      <span className="text-blue-400 font-mono text-[10px]">[[</span>
                      {field.replace(/_/g, ' ')}
                      <span className="text-blue-400 font-mono text-[10px]">]]</span>
                    </label>
                    <input
                      value={customFields[field] ?? ''}
                      onChange={(e) => setCustomFields((prev) => ({ ...prev, [field]: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder={`Enter ${field.replace(/_/g, ' ')}`}
                    />
                  </div>
                ))}
              </div>
            ) : !loadingPlaceholders ? (
              <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2 text-center">
                No <code>[[placeholder]]</code> fields found. You can add custom fields below.
              </p>
            ) : null}

            {/* Add custom field */}
            <div className="flex items-end gap-2 mt-3">
              <div className="flex-1">
                <label className="text-[10px] text-gray-400 uppercase">Field name</label>
                <input
                  value={newFieldKey}
                  onChange={(e) => setNewFieldKey(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. company_address"
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddField())}
                />
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-gray-400 uppercase">Value</label>
                <input
                  value={newFieldValue}
                  onChange={(e) => setNewFieldValue(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Value"
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddField())}
                />
              </div>
              <button
                type="button"
                onClick={handleAddField}
                disabled={!newFieldKey.trim()}
                className="shrink-0 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-100 disabled:opacity-40"
              >
                + Add
              </button>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Branch Notes</label>
            <textarea
              value={form.branch_notes}
              onChange={set('branch_notes')}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Optional notes about this branch..."
            />
          </div>

          {/* Include Content Toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.include_content}
              onChange={(e) => set('include_content')(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">Include content from template document</span>
          </label>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">
              {error}
            </div>
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
            disabled={loading || !form.branch_name.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
            {loading ? 'Creating…' : 'Create Branch'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BranchCreatorDialog;
