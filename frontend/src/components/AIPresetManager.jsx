/**
 * AIPresetManager — Admin component for managing document-type AI presets.
 *
 * Full CRUD panel: list presets, create new ones, edit existing, delete.
 * Designed to be embedded in the Settings or OrgAdmin page.
 *
 * Props:
 *   className — (optional) additional CSS classes
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
  Sparkles,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import useAIPresets from '../hooks/useAIPresets';

// ── Service toggle row for preset form ───────────────────────────────────────

const PresetServiceToggle = ({ serviceKey, serviceLabel, config, onChange }) => {
  const enabled = config?.enabled !== false;
  const mode = config?.mode || '';

  const handleToggle = () => {
    onChange(serviceKey, { ...config, enabled: !enabled });
  };

  const handleModeChange = (e) => {
    onChange(serviceKey, { ...config, mode: e.target.value });
  };

  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={handleToggle}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600" />
        </label>
        <span className="text-sm text-gray-900 truncate">{serviceLabel}</span>
      </div>
      <select
        value={mode}
        onChange={handleModeChange}
        className="text-xs px-2 py-1 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="">Default</option>
        <option value="legal">Legal</option>
        <option value="financial">Financial</option>
        <option value="data">Data</option>
        <option value="custom">Custom</option>
      </select>
    </div>
  );
};

// ── Preset Form (create / edit) ──────────────────────────────────────────────

const PresetForm = ({
  initialData,
  availableServices,
  defaultServicesConfig,
  onSave,
  onCancel,
  saving,
}) => {
  const isEditing = !!initialData?.id;

  const [form, setForm] = useState({
    document_type: initialData?.document_type || '',
    display_name: initialData?.display_name || '',
    description: initialData?.description || '',
    system_prompt: initialData?.system_prompt || '',
    ai_focus: initialData?.ai_focus || '',
    services_config: initialData?.services_config || { ...(defaultServicesConfig || {}) },
  });

  const handleServiceChange = (key, value) => {
    setForm((prev) => ({
      ...prev,
      services_config: { ...prev.services_config, [key]: value },
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Document type */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Document Type</label>
        <input
          type="text"
          value={form.document_type}
          onChange={(e) => setForm((p) => ({ ...p, document_type: e.target.value }))}
          placeholder="e.g. billing, contract, nda"
          disabled={isEditing}
          required
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
        />
      </div>

      {/* Display name */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
        <input
          type="text"
          value={form.display_name}
          onChange={(e) => setForm((p) => ({ ...p, display_name: e.target.value }))}
          placeholder="e.g. Billing Documents"
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
        <textarea
          value={form.description}
          onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
          placeholder="How AI services are tuned for this document type"
          rows={2}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
        />
      </div>

      {/* Service toggles */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">AI Services</label>
        <div className="border border-gray-200 rounded-lg p-3">
          {(availableServices || []).map((svc) => (
            <PresetServiceToggle
              key={svc.key}
              serviceKey={svc.key}
              serviceLabel={svc.label}
              config={form.services_config[svc.key] || { enabled: true }}
              onChange={handleServiceChange}
            />
          ))}
        </div>
      </div>

      {/* System prompt */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">System Prompt</label>
        <textarea
          value={form.system_prompt}
          onChange={(e) => setForm((p) => ({ ...p, system_prompt: e.target.value }))}
          placeholder="Custom system prompt for all AI calls on this document type"
          rows={3}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
        />
      </div>

      {/* AI Focus */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">AI Focus</label>
        <textarea
          value={form.ai_focus}
          onChange={(e) => setForm((p) => ({ ...p, ai_focus: e.target.value }))}
          placeholder="What should AI focus on? E.g. 'numerical accuracy, totals, tax calculations'"
          rows={2}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        <button
          type="submit"
          disabled={saving || !form.document_type.trim()}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Saving…' : isEditing ? 'Update Preset' : 'Create Preset'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};

// ── Preset card ──────────────────────────────────────────────────────────────

const PresetCard = ({ preset, onEdit, onDelete }) => {
  const [expanded, setExpanded] = useState(false);
  const enabledCount = useMemo(() => {
    const cfg = preset.services_config || {};
    return Object.values(cfg).filter((s) => s.enabled !== false).length;
  }, [preset.services_config]);
  const totalCount = Object.keys(preset.services_config || {}).length;

  return (
    <div className="border border-gray-200 rounded-lg bg-white hover:border-gray-300 transition-colors">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {preset.display_name || preset.document_type}
            </p>
            <p className="text-xs text-gray-500 truncate">
              Type: <code className="text-xs bg-gray-100 px-1 rounded">{preset.document_type}</code>
              {' · '}
              {enabledCount}/{totalCount} services
            </p>
          </div>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => onEdit(preset)}
            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
            title="Edit preset"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDelete(preset.id)}
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
            title="Delete preset"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3 border-t border-gray-100 pt-3 space-y-2">
          {preset.description && (
            <p className="text-xs text-gray-600">{preset.description}</p>
          )}
          {preset.system_prompt && (
            <div>
              <p className="text-[10px] font-medium text-gray-500 uppercase">System Prompt</p>
              <p className="text-xs text-gray-700 whitespace-pre-wrap mt-0.5">
                {preset.system_prompt}
              </p>
            </div>
          )}
          {preset.ai_focus && (
            <div>
              <p className="text-[10px] font-medium text-gray-500 uppercase">AI Focus</p>
              <p className="text-xs text-gray-700 mt-0.5">{preset.ai_focus}</p>
            </div>
          )}
          <div>
            <p className="text-[10px] font-medium text-gray-500 uppercase mb-1">Services</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(preset.services_config || {}).map(([key, cfg]) => (
                <span
                  key={key}
                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    cfg.enabled !== false
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-gray-100 text-gray-500 line-through'
                  }`}
                >
                  {key.replace(/_/g, ' ')}
                  {cfg.mode ? ` (${cfg.mode})` : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main component ───────────────────────────────────────────────────────────

const AIPresetManager = ({ className = '' }) => {
  const {
    presets,
    defaults,
    loading,
    error,
    createPreset,
    updatePreset,
    deletePreset,
  } = useAIPresets();

  const [showForm, setShowForm] = useState(false);
  const [editingPreset, setEditingPreset] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const availableServices = defaults?.available_services || [];
  const defaultServicesConfig = defaults?.default_services_config || {};

  const handleCreate = () => {
    setEditingPreset(null);
    setShowForm(true);
  };

  const handleEdit = (preset) => {
    setEditingPreset(preset);
    setShowForm(true);
  };

  const handleSave = useCallback(
    async (formData) => {
      setSaving(true);
      try {
        if (editingPreset?.id) {
          await updatePreset(editingPreset.id, formData);
        } else {
          await createPreset(formData);
        }
        setShowForm(false);
        setEditingPreset(null);
      } catch {
        // Error is handled by the hook
      } finally {
        setSaving(false);
      }
    },
    [editingPreset, createPreset, updatePreset]
  );

  const handleDelete = useCallback(
    async (id) => {
      if (deleteConfirm !== id) {
        setDeleteConfirm(id);
        return;
      }
      try {
        await deletePreset(id);
      } catch {
        // Error is handled by the hook
      }
      setDeleteConfirm(null);
    },
    [deleteConfirm, deletePreset]
  );

  const handleCancel = () => {
    setShowForm(false);
    setEditingPreset(null);
  };

  return (
    <div className={`bg-white rounded-lg shadow-sm border border-gray-200 p-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-blue-600" />
          <h2 className="text-lg font-semibold text-gray-900">AI Service Presets</h2>
        </div>
        {!showForm && (
          <button
            onClick={handleCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Preset
          </button>
        )}
      </div>

      <p className="text-sm text-gray-500 mb-4">
        Configure default AI services for each document type. Documents of that type
        will inherit these settings automatically.
      </p>

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="mb-6 border border-blue-200 rounded-lg bg-blue-50/30 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            {editingPreset ? 'Edit Preset' : 'Create New Preset'}
          </h3>
          <PresetForm
            initialData={editingPreset}
            availableServices={availableServices}
            defaultServicesConfig={defaultServicesConfig}
            onSave={handleSave}
            onCancel={handleCancel}
            saving={saving}
          />
        </div>
      )}

      {/* Loading */}
      {loading && !presets.length && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
        </div>
      )}

      {/* Preset list */}
      {!loading && presets.length === 0 && !showForm && (
        <div className="text-center py-8 text-gray-400">
          <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No presets yet. Create one to get started.</p>
        </div>
      )}

      <div className="space-y-2">
        {presets.map((preset) => (
          <PresetCard
            key={preset.id}
            preset={preset}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="mt-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-red-700">Delete this preset? Click again to confirm.</p>
          <button
            onClick={() => setDeleteConfirm(null)}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
};

export default AIPresetManager;
