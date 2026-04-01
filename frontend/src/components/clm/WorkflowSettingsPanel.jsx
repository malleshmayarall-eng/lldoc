/**
 * WorkflowSettingsPanel — Slide-out panel for workflow settings + event triggers
 * ==============================================================================
 * Tabs: General · Execution · Validation · Event Triggers
 *
 * API:
 *  GET   /workflows/:id/workflow-settings/
 *  PATCH /workflows/:id/workflow-settings/
 *  GET   /workflows/:id/event-triggers/
 *  POST  /workflows/:id/event-triggers/
 *  PATCH /workflows/:id/event-triggers/:tid/
 *  DELETE /workflows/:id/event-triggers/:tid/
 *  GET   /workflows/trigger-types/
 */
import React, { useState, useEffect, useCallback } from 'react';
import { workflowApi } from '@services/clm/clmApi';
import notify from '@utils/clm/clmNotify';
import {
  X, Save, Settings, Zap, Shield, Play,
  Plus, Trash2, ChevronDown, ChevronRight,
  Clock, Globe, FileUp, Mail, Table2, Activity,
  FileText, Terminal, ToggleLeft, ToggleRight,
  Copy, ExternalLink, RefreshCw, AlertCircle, Loader2,
} from 'lucide-react';

/* ── Trigger type icons ──────────────────────── */
const TRIGGER_ICONS = {
  webhook: Globe, schedule: Clock, file_upload: FileUp,
  email: Mail, sheet_update: Table2, field_change: Activity,
  document_status: FileText, api_call: Terminal, manual: Play,
};

/* ── Tiny toggle ──────────────────────────────── */
function Toggle({ value, onChange, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`relative w-9 h-5 rounded-full transition-colors ${
        value ? 'bg-indigo-500' : 'bg-gray-300'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-4' : ''}`} />
    </button>
  );
}

/* ── Section wrapper ──────────────────────────── */
function Section({ title, children }) {
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</h4>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

/* ── Form row helper ──────────────────────────── */
function Row({ label, hint, children }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/* ================================================================
   Main panel
   ================================================================ */
export default function WorkflowSettingsPanel({ workflowId, onClose, onUpdate }) {
  const [tab, setTab] = useState('general');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Settings data
  const [settings, setSettings] = useState({});
  const [triggerMode, setTriggerMode] = useState('manual');
  const [autoExecute, setAutoExecute] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [liveInterval, setLiveInterval] = useState(60);

  // Event triggers
  const [triggers, setTriggers] = useState([]);
  const [triggerTypes, setTriggerTypes] = useState([]);
  const [triggerModes, setTriggerModes] = useState([]);
  const [showNewTrigger, setShowNewTrigger] = useState(false);
  const [expandedTrigger, setExpandedTrigger] = useState(null);

  // Dirty tracking
  const [dirty, setDirty] = useState(false);

  /* ── Fetch ────────────────────────── */
  const fetchSettings = useCallback(async () => {
    try {
      const { data } = await workflowApi.getSettings(workflowId);
      setSettings(data.workflow_settings || {});
      setTriggerMode(data.trigger_mode || 'manual');
      setAutoExecute(data.auto_execute_on_upload || false);
      setIsLive(data.is_live || false);
      setLiveInterval(data.live_interval || 60);
    } catch (e) {
      notify.error('Failed to load settings');
    }
  }, [workflowId]);

  const fetchTriggers = useCallback(async () => {
    try {
      const { data } = await workflowApi.eventTriggers(workflowId);
      setTriggers(data.triggers || []);
    } catch (e) {
      notify.error('Failed to load triggers');
    }
  }, [workflowId]);

  const fetchTriggerTypes = useCallback(async () => {
    try {
      const { data } = await workflowApi.triggerTypes();
      setTriggerTypes(data.trigger_types || []);
      setTriggerModes(data.trigger_modes || []);
    } catch (e) { /* silent */ }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchSettings(), fetchTriggers(), fetchTriggerTypes()]);
      setLoading(false);
    })();
  }, [fetchSettings, fetchTriggers, fetchTriggerTypes]);

  /* ── Patch helpers ─────────────────── */
  const updateSetting = (section, key, value) => {
    setSettings(prev => ({
      ...prev,
      [section]: { ...(prev[section] || {}), [key]: value },
    }));
    setDirty(true);
  };

  const getSetting = (section, key, fallback) => {
    return settings?.[section]?.[key] ?? fallback;
  };

  /* ── Save ──────────────────────────── */
  const handleSave = async () => {
    setSaving(true);
    try {
      await workflowApi.updateSettings(workflowId, {
        settings,
        trigger_mode: triggerMode,
        auto_execute_on_upload: autoExecute,
        live_interval: liveInterval,
      });
      notify.success('Settings saved');
      setDirty(false);
      onUpdate?.();
    } catch (e) {
      notify.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  /* ── Trigger CRUD ──────────────────── */
  const handleCreateTrigger = async (data) => {
    try {
      await workflowApi.createEventTrigger(workflowId, data);
      notify.success('Trigger created');
      setShowNewTrigger(false);
      fetchTriggers();
    } catch (e) {
      notify.error('Failed to create trigger');
    }
  };

  const handleToggleTrigger = async (trigger) => {
    try {
      await workflowApi.updateEventTrigger(workflowId, trigger.id, {
        is_active: !trigger.is_active,
      });
      fetchTriggers();
    } catch (e) {
      notify.error('Failed to update trigger');
    }
  };

  const handleDeleteTrigger = async (triggerId) => {
    if (!confirm('Delete this trigger?')) return;
    try {
      await workflowApi.deleteEventTrigger(workflowId, triggerId);
      notify.success('Trigger deleted');
      fetchTriggers();
    } catch (e) {
      notify.error('Failed to delete trigger');
    }
  };

  const copyWebhookUrl = (url) => {
    navigator.clipboard.writeText(window.location.origin + url);
    notify.success('Webhook URL copied');
  };

  /* ── Tabs config ───────────────────── */
  const tabs = [
    { id: 'general',    label: 'General',    icon: <Settings size={14} /> },
    { id: 'execution',  label: 'Execution',  icon: <Play size={14} /> },
    { id: 'validation', label: 'Validation', icon: <Shield size={14} /> },
    { id: 'events',     label: 'Events',     icon: <Zap size={14} /> },
  ];

  if (loading) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="text-sm font-semibold text-gray-800">Workflow Settings</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* ── Header ──── */}
      <div className="flex items-center justify-between px-5 py-3 border-b bg-gray-50/80">
        <div className="flex items-center gap-2">
          <Settings size={16} className="text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-800">Workflow Settings</h3>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save
            </button>
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* ── Tabs ──── */}
      <div className="flex border-b px-4">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-200'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ── Content ──── */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

        {/* ═══ GENERAL ═══ */}
        {tab === 'general' && (
          <>
            <Section title="Trigger Mode">
              <div className="grid grid-cols-2 gap-2">
                {triggerModes.map(m => (
                  <button
                    key={m.value}
                    onClick={() => { setTriggerMode(m.value); setDirty(true); }}
                    className={`px-3 py-2.5 rounded-lg text-xs font-medium border text-left transition-all ${
                      triggerMode === m.value
                        ? 'bg-indigo-50 text-indigo-700 border-indigo-300 ring-1 ring-indigo-200'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Description & Tags">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Long Description</label>
                <textarea
                  value={getSetting('general', 'description_long', '')}
                  onChange={e => updateSetting('general', 'description_long', e.target.value)}
                  rows={3}
                  className="w-full text-sm border rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 resize-none"
                  placeholder="Describe what this workflow does…"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Tags (comma-separated)</label>
                <input
                  type="text"
                  value={(getSetting('general', 'tags', []) || []).join(', ')}
                  onChange={e => updateSetting('general', 'tags', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
                  className="w-full text-sm border rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                  placeholder="contracts, hr, finance"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={getSetting('general', 'color', '#6366f1')}
                      onChange={e => updateSetting('general', 'color', e.target.value)}
                      className="w-8 h-8 rounded border cursor-pointer"
                    />
                    <span className="text-xs text-gray-400">{getSetting('general', 'color', '#6366f1')}</span>
                  </div>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">Icon</label>
                  <input
                    type="text"
                    value={getSetting('general', 'icon', '')}
                    onChange={e => updateSetting('general', 'icon', e.target.value)}
                    className="w-full text-sm border rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                    placeholder="📋 or icon name"
                  />
                </div>
              </div>
            </Section>

            <Section title="Quick Toggles">
              <Row label="Auto-execute on upload" hint="Run the workflow when new documents are uploaded">
                <Toggle value={autoExecute} onChange={v => { setAutoExecute(v); setDirty(true); }} />
              </Row>
              <Row label="Live interval (seconds)" hint="How often the live scheduler checks for new work">
                <input
                  type="number"
                  value={liveInterval}
                  onChange={e => { setLiveInterval(Math.max(10, +e.target.value || 10)); setDirty(true); }}
                  min={10}
                  className="w-20 text-sm border rounded-lg px-2 py-1.5 text-right focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                />
              </Row>
            </Section>
          </>
        )}

        {/* ═══ EXECUTION ═══ */}
        {tab === 'execution' && (
          <>
            <Section title="Retry Behaviour">
              <Row label="Retry on failure" hint="Automatically retry failed nodes">
                <Toggle
                  value={getSetting('execution', 'retry_on_failure', false)}
                  onChange={v => updateSetting('execution', 'retry_on_failure', v)}
                />
              </Row>
              {getSetting('execution', 'retry_on_failure', false) && (
                <>
                  <Row label="Max retries">
                    <input
                      type="number"
                      value={getSetting('execution', 'max_retries', 3)}
                      onChange={e => updateSetting('execution', 'max_retries', Math.max(1, +e.target.value || 1))}
                      min={1} max={10}
                      className="w-20 text-sm border rounded-lg px-2 py-1.5 text-right focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                    />
                  </Row>
                  <Row label="Retry delay (seconds)">
                    <input
                      type="number"
                      value={getSetting('execution', 'retry_delay_seconds', 30)}
                      onChange={e => updateSetting('execution', 'retry_delay_seconds', Math.max(5, +e.target.value || 5))}
                      min={5}
                      className="w-20 text-sm border rounded-lg px-2 py-1.5 text-right focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                    />
                  </Row>
                </>
              )}
            </Section>

            <Section title="Timeouts">
              <Row label="Execution timeout (minutes)" hint="0 = no timeout">
                <input
                  type="number"
                  value={getSetting('execution', 'timeout_minutes', 0)}
                  onChange={e => updateSetting('execution', 'timeout_minutes', Math.max(0, +e.target.value || 0))}
                  min={0}
                  className="w-20 text-sm border rounded-lg px-2 py-1.5 text-right focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                />
              </Row>
              <Row label="Parallel nodes" hint="Execute independent nodes in parallel">
                <Toggle
                  value={getSetting('execution', 'parallel_nodes', true)}
                  onChange={v => updateSetting('execution', 'parallel_nodes', v)}
                />
              </Row>
            </Section>

            <Section title="Notifications">
              <Row label="Notify on completion">
                <Toggle
                  value={getSetting('execution', 'notify_on_complete', true)}
                  onChange={v => updateSetting('execution', 'notify_on_complete', v)}
                />
              </Row>
              <Row label="Notify on failure">
                <Toggle
                  value={getSetting('execution', 'notify_on_failure', true)}
                  onChange={v => updateSetting('execution', 'notify_on_failure', v)}
                />
              </Row>
            </Section>
          </>
        )}

        {/* ═══ VALIDATION ═══ */}
        {tab === 'validation' && (
          <>
            <Section title="Approval Rules">
              <Row label="Approval rule" hint="How many validators must approve">
                <select
                  value={getSetting('validation', 'approval_rule', 'any')}
                  onChange={e => updateSetting('validation', 'approval_rule', e.target.value)}
                  className="text-sm border rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                >
                  <option value="any">Any one approves</option>
                  <option value="all">All must approve</option>
                  <option value="majority">Majority vote</option>
                </select>
              </Row>
              <Row label="Require note on reject" hint="Force validators to leave a comment">
                <Toggle
                  value={getSetting('validation', 'require_note', false)}
                  onChange={v => updateSetting('validation', 'require_note', v)}
                />
              </Row>
            </Section>

            <Section title="Auto-approval">
              <Row label="Auto-approve timeout (hours)" hint="0 = disabled. Auto-approve if no response.">
                <input
                  type="number"
                  value={getSetting('validation', 'auto_approve_timeout_hours', 0)}
                  onChange={e => updateSetting('validation', 'auto_approve_timeout_hours', Math.max(0, +e.target.value || 0))}
                  min={0}
                  className="w-20 text-sm border rounded-lg px-2 py-1.5 text-right focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                />
              </Row>
            </Section>

            <Section title="Notification Channels">
              <Row label="Email notifications">
                <Toggle
                  value={(getSetting('validation', 'notification_channels', ['email']) || []).includes('email')}
                  onChange={v => {
                    const channels = getSetting('validation', 'notification_channels', ['email']) || [];
                    const next = v ? [...new Set([...channels, 'email'])] : channels.filter(c => c !== 'email');
                    updateSetting('validation', 'notification_channels', next);
                  }}
                />
              </Row>
              <Row label="In-app notifications">
                <Toggle
                  value={(getSetting('validation', 'notification_channels', ['email']) || []).includes('in_app')}
                  onChange={v => {
                    const channels = getSetting('validation', 'notification_channels', ['email']) || [];
                    const next = v ? [...new Set([...channels, 'in_app'])] : channels.filter(c => c !== 'in_app');
                    updateSetting('validation', 'notification_channels', next);
                  }}
                />
              </Row>
            </Section>
          </>
        )}

        {/* ═══ EVENTS ═══ */}
        {tab === 'events' && (
          <>
            {/* Active triggers list */}
            <Section title={`Event Triggers (${triggers.length})`}>
              {triggers.length === 0 ? (
                <div className="text-center py-6 text-gray-400">
                  <Zap size={28} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No event triggers configured</p>
                  <p className="text-xs mt-1">Add triggers to auto-run this workflow on events</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {triggers.map(trigger => {
                    const Icon = TRIGGER_ICONS[trigger.trigger_type] || Zap;
                    const isExpanded = expandedTrigger === trigger.id;
                    return (
                      <div key={trigger.id} className={`border rounded-lg overflow-hidden transition-all ${trigger.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
                        {/* Trigger header */}
                        <div
                          className="flex items-center gap-3 px-3 py-2.5 bg-white cursor-pointer hover:bg-gray-50"
                          onClick={() => setExpandedTrigger(isExpanded ? null : trigger.id)}
                        >
                          <Icon size={16} className={trigger.is_active ? 'text-indigo-500' : 'text-gray-400'} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-700 truncate">
                              {trigger.name || trigger.trigger_type_display}
                            </p>
                            <p className="text-[10px] text-gray-400">
                              {trigger.trigger_type_display} · {trigger.total_triggers} triggers · {trigger.total_executions} runs
                            </p>
                          </div>
                          <Toggle value={trigger.is_active} onChange={() => handleToggleTrigger(trigger)} />
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteTrigger(trigger.id); }}
                            className="text-gray-300 hover:text-red-500 p-1"
                          >
                            <Trash2 size={14} />
                          </button>
                          {isExpanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                        </div>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <div className="px-3 py-3 bg-gray-50/70 border-t border-gray-100 space-y-2 text-xs">
                            {trigger.webhook_url && (
                              <div>
                                <p className="text-gray-500 mb-1">Webhook URL</p>
                                <div className="flex items-center gap-2 bg-white border rounded px-2 py-1.5">
                                  <code className="text-[11px] text-gray-600 flex-1 truncate">{window.location.origin}{trigger.webhook_url}</code>
                                  <button onClick={() => copyWebhookUrl(trigger.webhook_url)} className="text-gray-400 hover:text-indigo-500">
                                    <Copy size={12} />
                                  </button>
                                </div>
                              </div>
                            )}
                            {trigger.webhook_token && (
                              <div>
                                <p className="text-gray-500 mb-1">Token</p>
                                <code className="text-[11px] text-gray-500 bg-white border rounded px-2 py-1 block truncate">{trigger.webhook_token}</code>
                              </div>
                            )}
                            {trigger.config && Object.keys(trigger.config).length > 0 && (
                              <div>
                                <p className="text-gray-500 mb-1">Configuration</p>
                                <pre className="text-[11px] text-gray-500 bg-white border rounded px-2 py-1.5 max-h-32 overflow-auto">{JSON.stringify(trigger.config, null, 2)}</pre>
                              </div>
                            )}
                            {trigger.last_triggered_at && (
                              <p className="text-gray-400">Last triggered: {new Date(trigger.last_triggered_at).toLocaleString()}</p>
                            )}
                            {trigger.last_error && (
                              <div className="flex items-start gap-1.5 text-red-500 bg-red-50 rounded px-2 py-1.5">
                                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                                <span className="text-[11px]">{trigger.last_error}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add trigger button or form */}
              {!showNewTrigger ? (
                <button
                  onClick={() => setShowNewTrigger(true)}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 border-2 border-dashed border-gray-200 rounded-lg text-xs font-medium text-gray-500 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50/30 transition-colors"
                >
                  <Plus size={14} /> Add Trigger
                </button>
              ) : (
                <NewTriggerForm
                  triggerTypes={triggerTypes}
                  onSubmit={handleCreateTrigger}
                  onCancel={() => setShowNewTrigger(false)}
                />
              )}
            </Section>
          </>
        )}
      </div>

      {/* ── Footer ──── */}
      {dirty && (
        <div className="px-5 py-3 border-t bg-amber-50/80 flex items-center justify-between">
          <span className="text-xs text-amber-700 flex items-center gap-1.5">
            <AlertCircle size={12} /> Unsaved changes
          </span>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save Changes
          </button>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   New Trigger Form (inline)
   ================================================================ */
function NewTriggerForm({ triggerTypes, onSubmit, onCancel }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('webhook');
  const [config, setConfig] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const selectedSchema = triggerTypes.find(t => t.value === type)?.config_schema || {};

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    await onSubmit({ name, trigger_type: type, config, is_active: true });
    setSubmitting(false);
  };

  const updateConfig = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  return (
    <form onSubmit={handleSubmit} className="border rounded-lg p-3 bg-white space-y-3">
      <div className="flex items-center justify-between">
        <h5 className="text-xs font-semibold text-gray-700">New Trigger</h5>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600">
          <X size={14} />
        </button>
      </div>

      <div>
        <label className="text-xs text-gray-500 mb-1 block">Name (optional)</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full text-sm border rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
          placeholder="e.g. Daily contract scan"
        />
      </div>

      <div>
        <label className="text-xs text-gray-500 mb-1 block">Trigger Type</label>
        <div className="grid grid-cols-3 gap-1.5">
          {triggerTypes.map(t => {
            const Icon = TRIGGER_ICONS[t.value] || Zap;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => { setType(t.value); setConfig({}); }}
                className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg text-[10px] font-medium border transition-all ${
                  type === t.value
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>
        {selectedSchema.description && (
          <p className="text-[10px] text-gray-400 mt-1.5">{selectedSchema.description}</p>
        )}
      </div>

      {/* Dynamic config fields from schema */}
      {selectedSchema.fields?.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs text-gray-500 block">Configuration</label>
          {selectedSchema.fields.map(field => (
            <div key={field.key}>
              <label className="text-[11px] text-gray-500 mb-0.5 block">{field.label}</label>
              {field.type === 'select' ? (
                <select
                  value={config[field.key] || field.default || ''}
                  onChange={e => updateConfig(field.key, e.target.value)}
                  className="w-full text-sm border rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                >
                  {field.options?.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : field.type === 'number' ? (
                <input
                  type="number"
                  value={config[field.key] || field.default || ''}
                  onChange={e => updateConfig(field.key, +e.target.value)}
                  className="w-full text-sm border rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                  placeholder={field.placeholder}
                />
              ) : (
                <input
                  type={field.type === 'password' ? 'password' : field.type === 'email' ? 'email' : 'text'}
                  value={config[field.key] || ''}
                  onChange={e => updateConfig(field.key, e.target.value)}
                  className="w-full text-sm border rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                  placeholder={field.placeholder}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5"
        >
          {submitting ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Create Trigger
        </button>
      </div>
    </form>
  );
}
