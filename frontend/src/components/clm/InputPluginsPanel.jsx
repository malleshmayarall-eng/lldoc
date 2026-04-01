import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plug, ChevronDown, ChevronUp, Check, X, Play,
  Settings2, AlertTriangle, Loader2, RefreshCw, ToggleLeft, ToggleRight,
  Search, Zap, Shield, Copy, Sparkles, Webhook, ClipboardList,
  Info, Mail, MessageSquare, Users, Plus, Trash2,
} from 'lucide-react';
import axios from 'axios';

const api = axios.create({
  baseURL: '/api/clm',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

/* ── Icon & colour maps ────────────────────────────────────────────── */
const ICONS = {
  normalize: Sparkles, validate: Shield, dedup: Copy, enrich: Zap,
  webhook: Webhook, gmail: Mail, slack: MessageSquare, teams: Users,
  logging: ClipboardList,
};

const CAT_COLORS = {
  transform:   { bg: 'bg-purple-50',  text: 'text-purple-600', badge: 'bg-purple-100 text-purple-700' },
  validation:  { bg: 'bg-amber-50',   text: 'text-amber-600',  badge: 'bg-amber-100 text-amber-700'  },
  integration: { bg: 'bg-blue-50',    text: 'text-blue-600',   badge: 'bg-blue-100 text-blue-700'    },
  monitoring:  { bg: 'bg-gray-50',    text: 'text-gray-600',   badge: 'bg-gray-100 text-gray-700'    },
  custom:      { bg: 'bg-slate-50',   text: 'text-slate-600',  badge: 'bg-slate-100 text-slate-700'  },
};

const catOf = (c) => CAT_COLORS[c] || CAT_COLORS.custom;

/* ================================================================
   InputPluginsPanel
   ================================================================
   Dropdown to add plugins + table of configured plugins with
   inline toggle, reorder, settings, and remove.
   ================================================================ */
export default function InputPluginsPanel({ workflowId, nodeId, onUpdate }) {
  /* ── State ─────────────────────────────────────────────────────── */
  const [plugins, setPlugins]       = useState([]);   // node's configured plugins (enriched)
  const [allPlugins, setAllPlugins] = useState([]);   // full registry list
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [running, setRunning]       = useState(false);
  const [runResult, setRunResult]   = useState(null);
  const [dirty, setDirty]           = useState(false);
  const [expandedRow, setExpandedRow] = useState(null); // plugin name
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  /* ── Fetch available plugins (registry) — only processing plugins ── */
  const fetchAllPlugins = useCallback(async () => {
    try {
      const res = await api.get('/workflows/input-plugins/', { params: { type: 'processing' } });
      setAllPlugins(res.data.plugins || []);
    } catch (err) {
      console.error('Failed to load plugin registry:', err);
    }
  }, []);

  /* ── Fetch node config ───────────────────────────────────────── */
  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get(
        `/workflows/${workflowId}/input-plugins/config/`,
        { params: { node_id: nodeId } },
      );
      setPlugins(res.data.plugins || []);
      setDirty(false);
    } catch (err) {
      console.error('Failed to load input plugins:', err);
    } finally {
      setLoading(false);
    }
  }, [workflowId, nodeId]);

  useEffect(() => { fetchAllPlugins(); fetchConfig(); }, [fetchAllPlugins, fetchConfig]);

  /* ── Save ────────────────────────────────────────────────────── */
  const handleSave = async () => {
    try {
      setSaving(true);
      const payload = plugins.map(p => ({
        name: p.name,
        enabled: p.enabled,
        priority: p.priority,
        settings: p.settings || {},
      }));
      await api.patch(
        `/workflows/${workflowId}/input-plugins/config/`,
        { plugins: payload, node_id: nodeId },
      );
      setDirty(false);
      onUpdate?.();
    } catch (err) {
      console.error('Failed to save input plugin config:', err);
    } finally {
      setSaving(false);
    }
  };

  /* ── Run pipeline ────────────────────────────────────────────── */
  const handleRun = async (force = false) => {
    try {
      setRunning(true);
      setRunResult(null);
      const res = await api.post(
        `/workflows/${workflowId}/input-plugins/run/`,
        { node_id: nodeId, force },
      );
      setRunResult(res.data);
      onUpdate?.();
    } catch (err) {
      setRunResult({ error: err.response?.data?.error || err.message });
    } finally {
      setRunning(false);
    }
  };

  /* ── Mutations ───────────────────────────────────────────────── */
  const togglePlugin = (name) => {
    setPlugins(prev => prev.map(p => p.name === name ? { ...p, enabled: !p.enabled } : p));
    setDirty(true);
  };

  const removePlugin = (name) => {
    setPlugins(prev => prev.filter(p => p.name !== name));
    if (expandedRow === name) setExpandedRow(null);
    setDirty(true);
  };

  const addPlugin = (registryPlugin) => {
    if (plugins.some(p => p.name === registryPlugin.name)) return;
    const maxPriority = plugins.reduce((m, p) => Math.max(m, p.priority || 0), 0);
    const defaults = {};
    Object.entries(registryPlugin.settings_schema || {}).forEach(([k, v]) => {
      defaults[k] = v.default;
    });
    setPlugins(prev => [
      ...prev,
      {
        ...registryPlugin,
        enabled: registryPlugin.default_enabled ?? true,
        priority: maxPriority + 10,
        settings: defaults,
      },
    ]);
    setDropdownOpen(false);
    setSearchTerm('');
    setDirty(true);
  };

  const movePlugin = (index, direction) => {
    const arr = [...plugins];
    const target = index + direction;
    if (target < 0 || target >= arr.length) return;
    [arr[index], arr[target]] = [arr[target], arr[index]];
    arr.forEach((p, i) => { p.priority = (i + 1) * 10; });
    setPlugins(arr);
    setDirty(true);
  };

  const updateSetting = (pluginName, key, value) => {
    setPlugins(prev => prev.map(p =>
      p.name === pluginName ? { ...p, settings: { ...p.settings, [key]: value } } : p
    ));
    setDirty(true);
  };

  /* ── Derived ─────────────────────────────────────────────────── */
  const addedNames = useMemo(() => new Set(plugins.map(p => p.name)), [plugins]);
  const availablePlugins = useMemo(() => {
    let list = allPlugins.filter(p => !addedNames.has(p.name));
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(p =>
        p.display_name?.toLowerCase().includes(q) ||
        p.name?.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [allPlugins, addedNames, searchTerm]);

  const enabledCount = plugins.filter(p => p.enabled).length;

  /* ── Loading ─────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-400 gap-2 text-xs">
        <Loader2 size={14} className="animate-spin" /> Loading plugins…
      </div>
    );
  }

  /* ── Render ──────────────────────────────────────────────────── */
  return (
    <div className="space-y-3">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Plug size={13} className="text-blue-500" />
          <span className="text-xs font-semibold text-gray-700">Processing Plugins</span>
          <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
            {enabledCount}/{plugins.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleRun(false)}
            disabled={running}
            className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
            title="Run pipeline on unprocessed docs"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          </button>
          <button
            onClick={fetchConfig}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-md transition-colors"
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* ── Add Plugin Dropdown ─────────────────────────────────── */}
      <div className="relative">
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs border border-dashed border-gray-300 rounded-xl hover:border-blue-400 hover:bg-blue-50/30 transition-all text-gray-500 hover:text-blue-600"
        >
          <span className="flex items-center gap-1.5">
            <Plus size={12} />
            Add Plugin…
          </span>
          <ChevronDown size={12} className={`transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {dropdownOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => { setDropdownOpen(false); setSearchTerm(''); }}
            />

            {/* Dropdown */}
            <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
              {/* Search */}
              <div className="p-2 border-b border-gray-100">
                <div className="flex items-center gap-1.5 px-2 py-1.5 bg-gray-50 rounded-lg">
                  <Search size={11} className="text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search plugins…"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="flex-1 bg-transparent text-xs outline-none placeholder-gray-400"
                    autoFocus
                  />
                </div>
              </div>

              {/* Options */}
              <div className="max-h-52 overflow-y-auto">
                {availablePlugins.length === 0 ? (
                  <p className="text-center text-[10px] text-gray-400 py-4">
                    {searchTerm ? 'No matching plugins' : 'All plugins added'}
                  </p>
                ) : (
                  availablePlugins.map(p => {
                    const Icon = ICONS[p.name] || Plug;
                    const cat = catOf(p.category);
                    return (
                      <button
                        key={p.name}
                        onClick={() => addPlugin(p)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 transition-colors text-left"
                      >
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${cat.bg} ${cat.text}`}>
                          <Icon size={13} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-800 truncate">
                            {p.display_name}
                          </p>
                          <p className="text-[10px] text-gray-400 truncate leading-tight">
                            {p.description}
                          </p>
                        </div>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full shrink-0 ${cat.badge}`}>
                          {p.category}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Plugin Table ────────────────────────────────────────── */}
      {plugins.length === 0 ? (
        <div className="text-center py-6 text-gray-400">
          <Plug size={20} className="mx-auto mb-1 opacity-40" />
          <p className="text-[10px]">No plugins configured.</p>
          <p className="text-[10px]">Use the dropdown above to add plugins.</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[28px_1fr_64px_48px_24px] gap-0 bg-gray-50 border-b border-gray-200 px-2 py-1.5">
            <span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wide">#</span>
            <span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wide">Plugin</span>
            <span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wide text-center">Type</span>
            <span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wide text-center">On</span>
            <span />
          </div>

          {/* Table rows */}
          {plugins.map((plugin, index) => {
            const Icon = ICONS[plugin.name] || Plug;
            const cat = catOf(plugin.category);
            const isExpanded = expandedRow === plugin.name;
            const schema = plugin.settings_schema || {};
            const hookCount = (plugin.hooks || []).length;

            return (
              <React.Fragment key={plugin.name}>
                {/* ── Main row ─────────────────────────────────── */}
                <div
                  className={`grid grid-cols-[28px_1fr_64px_48px_24px] gap-0 items-center px-2 py-1.5 border-b border-gray-100 transition-colors cursor-pointer group
                    ${!plugin.enabled ? 'opacity-50 bg-gray-50/40' : 'hover:bg-gray-50/60'}
                    ${isExpanded ? 'bg-blue-50/30' : ''}`}
                  onClick={() => setExpandedRow(isExpanded ? null : plugin.name)}
                >
                  {/* Reorder buttons */}
                  <div className="flex flex-col items-center" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => movePlugin(index, -1)}
                      disabled={index === 0}
                      className="text-gray-300 hover:text-gray-500 disabled:opacity-20 leading-none"
                    >
                      <ChevronUp size={9} />
                    </button>
                    <span className="text-[9px] text-gray-400 font-mono leading-none">{index + 1}</span>
                    <button
                      onClick={() => movePlugin(index, 1)}
                      disabled={index === plugins.length - 1}
                      className="text-gray-300 hover:text-gray-500 disabled:opacity-20 leading-none"
                    >
                      <ChevronDown size={9} />
                    </button>
                  </div>

                  {/* Plugin icon + name */}
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${cat.bg} ${cat.text}`}>
                      <Icon size={11} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-gray-800 truncate leading-tight">
                        {plugin.display_name || plugin.name}
                      </p>
                      <p className="text-[9px] text-gray-400 truncate leading-tight">
                        {hookCount} hook{hookCount !== 1 ? 's' : ''} · p{plugin.priority}
                      </p>
                    </div>
                  </div>

                  {/* Category badge */}
                  <div className="flex justify-center">
                    <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${cat.badge}`}>
                      {plugin.category}
                    </span>
                  </div>

                  {/* Toggle */}
                  <div className="flex justify-center" onClick={e => e.stopPropagation()}>
                    <button onClick={() => togglePlugin(plugin.name)} title={plugin.enabled ? 'Disable' : 'Enable'}>
                      {plugin.enabled ? (
                        <ToggleRight size={18} className="text-blue-500" />
                      ) : (
                        <ToggleLeft size={18} className="text-gray-300" />
                      )}
                    </button>
                  </div>

                  {/* Remove */}
                  <div className="flex justify-center" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => removePlugin(plugin.name)}
                      className="p-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove plugin"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>

                {/* ── Expanded settings ────────────────────────── */}
                {isExpanded && (
                  <div className="bg-gray-50/70 border-b border-gray-100 px-3 py-2.5 space-y-2">
                    {/* Description */}
                    <p className="text-[10px] text-gray-500 leading-relaxed">
                      {plugin.description}
                    </p>

                    {/* Hooks row */}
                    <div className="flex flex-wrap gap-1">
                      {(plugin.hooks || []).map(h => (
                        <span key={h} className="text-[8px] px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600 font-mono">
                          {h}
                        </span>
                      ))}
                    </div>

                    {/* Settings table */}
                    {Object.keys(schema).length > 0 && (
                      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                        <div className="grid grid-cols-[1fr_auto] gap-0 bg-gray-100 px-2 py-1 border-b border-gray-200">
                          <span className="text-[8px] font-semibold text-gray-500 uppercase">Setting</span>
                          <span className="text-[8px] font-semibold text-gray-500 uppercase text-right">Value</span>
                        </div>
                        {Object.entries(schema).map(([key, fs]) => {
                          const value = plugin.settings?.[key] ?? fs.default;
                          return (
                            <div
                              key={key}
                              className="grid grid-cols-[1fr_auto] gap-2 items-center px-2 py-1.5 border-b border-gray-50 last:border-b-0"
                            >
                              {/* Label */}
                              <div className="flex items-center gap-1 min-w-0">
                                <span className="text-[10px] text-gray-700 truncate">
                                  {fs.label || key}
                                </span>
                                {fs.description && (
                                  <span className="text-gray-300 cursor-help shrink-0" title={fs.description}>
                                    <Info size={8} />
                                  </span>
                                )}
                              </div>

                              {/* Value control */}
                              <div className="flex justify-end">
                                {fs.type === 'boolean' && (
                                  <button
                                    onClick={() => updateSetting(plugin.name, key, !value)}
                                    className="flex items-center gap-1 text-[10px]"
                                  >
                                    {value
                                      ? <ToggleRight size={16} className="text-blue-500" />
                                      : <ToggleLeft size={16} className="text-gray-300" />
                                    }
                                  </button>
                                )}

                                {fs.type === 'string' && (
                                  <input
                                    type="text"
                                    value={value || ''}
                                    onChange={e => updateSetting(plugin.name, key, e.target.value)}
                                    className="w-36 px-1.5 py-0.5 text-[10px] border border-gray-200 rounded focus:ring-1 focus:ring-blue-200 outline-none text-right"
                                    placeholder={fs.default || '…'}
                                  />
                                )}

                                {fs.type === 'select' && (
                                  <select
                                    value={value || fs.default}
                                    onChange={e => updateSetting(plugin.name, key, e.target.value)}
                                    className="px-1.5 py-0.5 text-[10px] border border-gray-200 rounded focus:ring-1 focus:ring-blue-200 outline-none bg-white"
                                  >
                                    {(fs.options || []).map(opt => (
                                      <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                  </select>
                                )}

                                {fs.type === 'array' && (
                                  <textarea
                                    value={Array.isArray(value) ? value.join('\n') : (value || '')}
                                    onChange={e => {
                                      const lines = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
                                      updateSetting(plugin.name, key, lines);
                                    }}
                                    rows={2}
                                    className="w-36 px-1.5 py-0.5 text-[10px] border border-gray-200 rounded focus:ring-1 focus:ring-blue-200 outline-none font-mono resize-y text-right"
                                    placeholder="One per line…"
                                  />
                                )}

                                {fs.type === 'object' && (
                                  <textarea
                                    value={typeof value === 'object' ? JSON.stringify(value, null, 2) : (value || '{}')}
                                    onChange={e => {
                                      try {
                                        const parsed = JSON.parse(e.target.value);
                                        updateSetting(plugin.name, key, parsed);
                                      } catch { /* ignore until valid JSON */ }
                                    }}
                                    rows={3}
                                    className="w-36 px-1.5 py-0.5 text-[10px] border border-gray-200 rounded focus:ring-1 focus:ring-blue-200 outline-none font-mono resize-y text-right"
                                    placeholder="{}"
                                  />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* ── Run result ──────────────────────────────────────────── */}
      {runResult && (
        <div className={`rounded-xl p-2.5 text-xs border ${
          runResult.error
            ? 'bg-red-50/50 border-red-100 text-red-600'
            : 'bg-emerald-50/50 border-emerald-100 text-emerald-600'
        }`}>
          {runResult.error ? (
            <p className="flex items-center gap-1"><AlertTriangle size={11} /> {runResult.error}</p>
          ) : (
            <>
              <p className="font-medium flex items-center gap-1">
                <Check size={11} />
                Processed {runResult.processed} doc{runResult.processed !== 1 ? 's' : ''}
                {runResult.errors > 0 && `, ${runResult.errors} error${runResult.errors !== 1 ? 's' : ''}`}
              </p>
              {(runResult.results || []).slice(0, 5).map(r => (
                <p key={r.document_id} className="text-[10px] text-gray-500 truncate mt-0.5">
                  {r.status === 'processed' ? '✓' : '✕'} {r.title} — {r.issues || 0} issue{r.issues !== 1 ? 's' : ''}
                </p>
              ))}
              {(runResult.results || []).length > 5 && (
                <p className="text-[10px] text-gray-400 mt-0.5">+{runResult.results.length - 5} more…</p>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Action bar ──────────────────────────────────────────── */}
      <div className="flex gap-2">
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-2 py-2 bg-blue-600 text-white rounded-xl text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1"
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            {saving ? 'Saving…' : 'Save Plugin Config'}
          </button>
        )}
        <button
          onClick={() => handleRun(true)}
          disabled={running}
          className="px-2 py-2 bg-gray-100 text-gray-600 rounded-xl text-xs font-medium hover:bg-gray-200 disabled:opacity-50 transition-colors flex items-center justify-center gap-1"
          title="Force re-run pipeline on ALL documents"
        >
          {running ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          Re-run All
        </button>
      </div>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <p className="text-[9px] text-gray-400 leading-relaxed">
        Pipeline: pre-ingest → post-extract → validate → transform → ready.
        Click a row to configure. Toggle to enable/disable. 🗑 to remove.
        Integration plugins (webhook, email, Slack, Teams) are configured as input types above.
      </p>
    </div>
  );
}
