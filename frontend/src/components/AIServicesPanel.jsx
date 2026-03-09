/**
 * AIServicesPanel — Per-document AI service toggle panel.
 *
 * Shows each AI service with an on/off toggle, mode badge, and
 * optional system prompt / AI focus editors. Includes a "Reset
 * to defaults" button when custom overrides exist.
 *
 * Props:
 *   documentId  — UUID of the document
 *   compact     — (optional) render compact version for sidebar
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Sparkles,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Loader2,
  Brain,
  FileSearch,
  BarChart3,
  PenLine,
  ShieldCheck,
  MessageSquare,
  Search,
  Wand2,
  FileType,
  Check,
  Network,
  Zap,
} from 'lucide-react';
import useDocumentAIConfig from '../hooks/useDocumentAIConfig';
import useDocumentInference from '../hooks/useDocumentInference';
import aiConfigService from '../services/aiConfigService';

// ── Service metadata ─────────────────────────────────────────────────────────

const SERVICE_META = {
  document_scoring: { label: 'Document Scoring', description: 'Overall quality/risk scoring via LLM', icon: BarChart3, color: 'blue' },
  paragraph_review: { label: 'Paragraph Review', description: 'Per-paragraph legal/quality review', icon: FileSearch, color: 'purple' },
  paragraph_scoring: { label: 'Paragraph Scoring', description: 'Per-paragraph numeric scoring', icon: BarChart3, color: 'indigo' },
  paragraph_rewrite: { label: 'Paragraph Rewrite', description: 'AI-assisted paragraph rewriting', icon: PenLine, color: 'emerald' },
  data_validation: { label: 'Data Validation', description: 'Numerical accuracy & calculations', icon: ShieldCheck, color: 'amber' },
  chat: { label: 'AI Chat', description: 'Conversational AI assistant', icon: MessageSquare, color: 'sky' },
  analysis: { label: 'Document Analysis', description: 'Risk, summary, compliance analysis', icon: Search, color: 'rose' },
  generation: { label: 'Content Generation', description: 'Generate content from prompts', icon: Wand2, color: 'violet' },
  inference: { label: 'Inference Engine', description: 'Hierarchical context & lateral edges', icon: Network, color: 'indigo' },
};

const MODE_COLORS = {
  legal: 'bg-blue-100 text-blue-700',
  financial: 'bg-amber-100 text-amber-700',
  data: 'bg-emerald-100 text-emerald-700',
  custom: 'bg-purple-100 text-purple-700',
};

// ── Toggle component (matches ExportSettingsPanel pattern) ───────────────────

const Toggle = ({ checked, onChange, disabled }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative h-6 w-11 rounded-full border transition-colors ${
      disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
    } ${checked ? 'bg-blue-600 border-blue-600' : 'bg-gray-200 border-gray-300'}`}
  >
    <span
      className={`block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${
        checked ? 'translate-x-5' : 'translate-x-0.5'
      }`}
    />
  </button>
);

// ── Service row ──────────────────────────────────────────────────────────────

const ServiceRow = ({ serviceKey, cfg, onToggle, loading, compact }) => {
  const meta = SERVICE_META[serviceKey] || {
    label: serviceKey,
    description: '',
    icon: Sparkles,
    color: 'gray',
  };
  const Icon = meta.icon;
  const enabled = cfg?.enabled !== false;
  const mode = cfg?.mode;

  return (
    <div
      className={`flex items-center justify-between gap-3 py-2.5 ${
        compact ? 'px-2' : 'px-3'
      } rounded-lg hover:bg-gray-50 transition-colors`}
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <div className={`flex-shrink-0 p-1.5 rounded-md bg-${meta.color}-50`}>
          <Icon className={`h-4 w-4 text-${meta.color}-600`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">{meta.label}</p>
          {!compact && (
            <p className="text-xs text-gray-500 truncate">{meta.description}</p>
          )}
        </div>
        {mode && (
          <span
            className={`flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
              MODE_COLORS[mode] || 'bg-gray-100 text-gray-600'
            }`}
          >
            {mode}
          </span>
        )}
      </div>
      <Toggle checked={enabled} onChange={(val) => onToggle(serviceKey, val)} disabled={loading} />
    </div>
  );
};

// ── Main component ───────────────────────────────────────────────────────────

const AIServicesPanel = ({ documentId, compact = false }) => {
  const {
    config,
    loading,
    error,
    toggleService,
    resetConfig,
    updateConfig,
    setDocumentType,
  } = useDocumentAIConfig(documentId);

  const {
    stats: inferenceStats,
    inferring,
    writingPath,
    runInference,
    runWritePath,
    tree: inferenceTree,
  } = useDocumentInference(documentId);

  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [focusDraft, setFocusDraft] = useState('');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [documentTypes, setDocumentTypes] = useState([]);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [changingType, setChangingType] = useState(false);

  // Fetch available document types
  useEffect(() => {
    aiConfigService.getDocumentTypes()
      .then((data) => setDocumentTypes(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Current document type from config response
  const currentDocType = config?.document_type || '';

  // Filtered type list
  const filteredTypes = documentTypes.filter((t) =>
    !typeFilter || t.display_name.toLowerCase().includes(typeFilter.toLowerCase()) ||
    t.document_type.toLowerCase().includes(typeFilter.toLowerCase())
  );

  // Handle type change
  const handleTypeChange = useCallback(async (newType) => {
    if (!newType || newType === currentDocType) {
      setShowTypeDropdown(false);
      setTypeFilter('');
      return;
    }
    setChangingType(true);
    try {
      await setDocumentType(newType);
      setShowTypeDropdown(false);
      setTypeFilter('');
    } finally {
      setChangingType(false);
    }
  }, [currentDocType, setDocumentType]);

  // Determine if the user has custom overrides
  const hasOverrides =
    config?.services_config && Object.keys(config.services_config).length > 0;
  const hasCustomPrompt = !!(config?.system_prompt || config?.ai_focus);

  // Use effective_config for display (fully resolved)
  const effectiveConfig = config?.effective_config || {};

  // Handle prompt editor open
  const handleOpenPromptEditor = useCallback(() => {
    setPromptDraft(config?.system_prompt || '');
    setFocusDraft(config?.ai_focus || '');
    setShowPromptEditor(true);
  }, [config]);

  // Save prompt + focus
  const handleSavePrompt = useCallback(async () => {
    setSavingPrompt(true);
    try {
      await updateConfig({
        system_prompt: promptDraft,
        ai_focus: focusDraft,
      });
      setShowPromptEditor(false);
    } finally {
      setSavingPrompt(false);
    }
  }, [updateConfig, promptDraft, focusDraft]);

  if (!documentId) return null;

  return (
    <div className="flex flex-col gap-1">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-gray-900">AI Services</h3>
        </div>
        <div className="flex items-center gap-1">
          {(hasOverrides || hasCustomPrompt) && (
            <button
              onClick={resetConfig}
              disabled={loading}
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
              title="Reset to defaults"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
          <p className="text-xs text-red-700 truncate">{error}</p>
        </div>
      )}

      {/* Document Type Selector */}
      <div className="mx-3 relative">
        <label className="block text-[11px] font-medium text-gray-500 mb-1">
          Document Type
        </label>
        <button
          type="button"
          onClick={() => setShowTypeDropdown(!showTypeDropdown)}
          disabled={changingType}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:border-gray-300 bg-white transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <FileType className="h-4 w-4 text-gray-400 flex-shrink-0" />
            <span className="truncate font-medium text-gray-900">
              {changingType ? 'Applying…' : (currentDocType ? currentDocType.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Select type…')}
            </span>
            {config?.preset_config && (
              <span className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                preset
              </span>
            )}
          </div>
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${showTypeDropdown ? 'rotate-180' : ''}`} />
        </button>

        {showTypeDropdown && (
          <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-hidden">
            {/* Search filter */}
            <div className="p-2 border-b border-gray-100">
              <input
                type="text"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                placeholder="Search or enter new type…"
                autoFocus
                className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            {/* Type list */}
            <div className="max-h-48 overflow-y-auto">
              {filteredTypes.map((t) => (
                <button
                  key={t.document_type}
                  type="button"
                  onClick={() => handleTypeChange(t.document_type)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors ${
                    t.document_type === currentDocType ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{t.display_name}</p>
                    {t.description && (
                      <p className="text-[11px] text-gray-500 truncate">{t.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {t.has_preset && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                        optimised
                      </span>
                    )}
                    {t.document_type === currentDocType && (
                      <Check className="h-4 w-4 text-blue-600" />
                    )}
                  </div>
                </button>
              ))}
              {/* Create custom type from filter text */}
              {typeFilter.trim() && !filteredTypes.some((t) => t.document_type === typeFilter.trim().toLowerCase().replace(/\s+/g, '_')) && (
                <button
                  type="button"
                  onClick={() => handleTypeChange(typeFilter.trim().toLowerCase().replace(/\s+/g, '_'))}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-blue-50 border-t border-gray-100 transition-colors"
                >
                  <Sparkles className="h-4 w-4 text-blue-500" />
                  <span className="text-sm text-blue-700">
                    Create type: <span className="font-medium">{typeFilter.trim()}</span>
                  </span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Loading state */}
      {loading && !config && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
        </div>
      )}

      {/* Service toggles */}
      {config && (
        <>
          <div className="divide-y divide-gray-100">
            {Object.entries(effectiveConfig).map(([serviceKey, cfg]) => (
              <ServiceRow
                key={serviceKey}
                serviceKey={serviceKey}
                cfg={cfg}
                onToggle={toggleService}
                loading={loading}
                compact={compact}
              />
            ))}
          </div>

          {/* Preset info */}
          {config.preset_config && (
            <div className="mx-3 mt-1 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg">
              <p className="text-[11px] text-blue-700">
                <span className="font-medium">Preset:</span>{' '}
                {config.preset_config.display_name || config.preset_config.document_type}
              </p>
            </div>
          )}

          {/* Override indicator */}
          {hasOverrides && (
            <div className="mx-3 px-3 py-1.5 bg-amber-50 border border-amber-100 rounded-lg">
              <p className="text-[11px] text-amber-700">
                ⚡ Custom overrides active ({Object.keys(config.services_config).length} service
                {Object.keys(config.services_config).length !== 1 ? 's' : ''})
              </p>
            </div>
          )}

          {/* Inference Engine Status */}
          <div className="mx-3 mt-2 px-3 py-2.5 bg-indigo-50/60 border border-indigo-100 rounded-lg">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <Network className="h-3.5 w-3.5 text-indigo-600" />
                <span className="text-xs font-semibold text-indigo-800">Inference Engine</span>
              </div>
              {inferenceTree?.document_summary && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  active
                </span>
              )}
              {!inferenceTree?.document_summary && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                  no data
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center mb-2">
              <div className="bg-white/70 rounded px-1 py-1">
                <div className="text-sm font-bold tabular-nums text-indigo-700">{inferenceStats.totalSections}</div>
                <div className="text-[9px] text-gray-500">Sections</div>
              </div>
              <div className="bg-white/70 rounded px-1 py-1">
                <div className="text-sm font-bold tabular-nums text-indigo-700">{inferenceStats.totalComponents}</div>
                <div className="text-[9px] text-gray-500">Components</div>
              </div>
              <div className={`rounded px-1 py-1 ${inferenceStats.totalStale > 0 ? 'bg-amber-50' : 'bg-white/70'}`}>
                <div className={`text-sm font-bold tabular-nums ${inferenceStats.totalStale > 0 ? 'text-amber-600' : 'text-indigo-700'}`}>
                  {inferenceStats.totalStale}
                </div>
                <div className="text-[9px] text-gray-500">Stale</div>
              </div>
            </div>
            <div className="flex gap-1.5">
              <button
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-indigo-100 text-indigo-700 hover:bg-indigo-200 disabled:opacity-50 transition-colors"
                onClick={() => runInference({ force: false })}
                disabled={inferring || writingPath}
              >
                {inferring ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                Infer
              </button>
              <button
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-indigo-100 text-indigo-700 hover:bg-indigo-200 disabled:opacity-50 transition-colors"
                onClick={() => runWritePath('sync')}
                disabled={inferring || writingPath}
              >
                {writingPath ? <Loader2 className="h-3 w-3 animate-spin" /> : <Network className="h-3 w-3" />}
                Edges
              </button>
            </div>
          </div>

          {/* System prompt / AI focus section */}
          <div className="mx-3 mt-2">
            <button
              onClick={() =>
                showPromptEditor ? setShowPromptEditor(false) : handleOpenPromptEditor()
              }
              className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
            >
              {showPromptEditor ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              <span className="font-medium text-xs">System Prompt & Focus</span>
              {hasCustomPrompt && (
                <span className="ml-auto text-[10px] text-blue-600 font-medium">Custom</span>
              )}
            </button>

            {showPromptEditor && (
              <div className="mt-2 space-y-3 px-1">
                {/* Effective prompt (read-only) */}
                {config.effective_system_prompt && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5">
                    <p className="text-[10px] font-medium text-gray-500 mb-1">
                      Effective System Prompt (combined)
                    </p>
                    <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">
                      {config.effective_system_prompt}
                    </p>
                  </div>
                )}

                {/* Editable system prompt */}
                <div>
                  <label className="block text-[11px] font-medium text-gray-600 mb-1">
                    Custom System Prompt
                  </label>
                  <textarea
                    value={promptDraft}
                    onChange={(e) => setPromptDraft(e.target.value)}
                    placeholder="Add a custom system prompt for this document..."
                    rows={3}
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
                  />
                </div>

                {/* Editable AI focus */}
                <div>
                  <label className="block text-[11px] font-medium text-gray-600 mb-1">
                    AI Focus
                  </label>
                  <textarea
                    value={focusDraft}
                    onChange={(e) => setFocusDraft(e.target.value)}
                    placeholder="What should AI focus on? E.g. 'numerical accuracy, totals, line items'"
                    rows={2}
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
                  />
                </div>

                <button
                  onClick={handleSavePrompt}
                  disabled={savingPrompt}
                  className="w-full px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {savingPrompt ? 'Saving…' : 'Save Prompt & Focus'}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AIServicesPanel;
