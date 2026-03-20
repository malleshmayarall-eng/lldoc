import { useState, useEffect, useCallback } from 'react';
import { userService } from '../services/userService';
import { useFeatureFlags } from '../contexts/FeatureFlagContext';
import {
  Globe,
  RotateCcw,
  Save,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ToggleLeft,
  ToggleRight,
  Loader2,
  Info,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Category labels & colours                                          */
/* ------------------------------------------------------------------ */

const CATEGORY_META = {
  apps: { label: 'Applications', color: 'blue', description: 'Control which major apps appear in navigation' },
  editor: { label: 'Document Editor', color: 'purple', description: 'Control which editor toolbar features are available' },
  dashboard: { label: 'Dashboard', color: 'green', description: 'Control which dashboard widgets are visible' },
};

/* ------------------------------------------------------------------ */
/*  Toast                                                              */
/* ------------------------------------------------------------------ */

const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3500);
    return () => clearTimeout(timer);
  }, [onClose]);
  return (
    <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
      type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
    }`}>
      {type === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
      {message}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Feature Toggle Row                                                 */
/* ------------------------------------------------------------------ */

const FeatureToggle = ({ featureKey, schema, currentValue, defaultValue, onChange }) => {
  const isOverridden = currentValue !== undefined && currentValue !== null;
  const effectiveValue = isOverridden ? currentValue : defaultValue;

  return (
    <div className="flex items-center justify-between py-2.5 px-3 rounded-md hover:bg-gray-50 transition-colors">
      <div className="flex-1 min-w-0 mr-4">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-900">{schema?.label || featureKey}</p>
          {isOverridden && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
              override
            </span>
          )}
        </div>
        {schema?.description && (
          <p className="text-xs text-gray-500 mt-0.5">{schema.description}</p>
        )}
      </div>
      <button
        onClick={() => onChange(featureKey, !effectiveValue)}
        className="flex-shrink-0 focus:outline-none"
        title={effectiveValue ? 'Click to disable' : 'Click to enable'}
      >
        {effectiveValue ? (
          <ToggleRight className="h-6 w-6 text-blue-600" />
        ) : (
          <ToggleLeft className="h-6 w-6 text-gray-400" />
        )}
      </button>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Category Accordion                                                 */
/* ------------------------------------------------------------------ */

const CategorySection = ({ categoryKey, schema, defaults, overrides, onToggle }) => {
  const [expanded, setExpanded] = useState(true);
  const meta = CATEGORY_META[categoryKey] || { label: categoryKey, color: 'gray', description: '' };
  const features = schema?.[categoryKey] || {};
  const categoryDefaults = defaults?.[categoryKey] || {};
  const categoryOverrides = overrides?.[categoryKey] || {};

  const enabledCount = Object.keys(features).filter((k) => {
    const override = categoryOverrides[k];
    return override !== undefined ? override : (categoryDefaults[k] !== false);
  }).length;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
          <div className="text-left">
            <h3 className="text-sm font-semibold text-gray-900">{meta.label}</h3>
            <p className="text-xs text-gray-500">{meta.description}</p>
          </div>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-${meta.color}-100 text-${meta.color}-700`}>
          {enabledCount}/{Object.keys(features).length} enabled
        </span>
      </button>

      {expanded && (
        <div className="px-3 py-2 divide-y divide-gray-50">
          {Object.entries(features).map(([featureKey, featureSchema]) => (
            <FeatureToggle
              key={featureKey}
              featureKey={featureKey}
              schema={featureSchema}
              currentValue={categoryOverrides[featureKey]}
              defaultValue={categoryDefaults[featureKey] !== false}
              onChange={(key, value) => onToggle(categoryKey, key, value)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main DomainSettings Component                                      */
/* ------------------------------------------------------------------ */

const DomainSettings = () => {
  const { refresh: refreshFlags } = useFeatureFlags();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Data from API
  const [domains, setDomains] = useState([]);
  const [schema, setSchema] = useState({});
  const [currentDomain, setCurrentDomain] = useState('default');
  const [domainDefaults, setDomainDefaults] = useState({});
  const [overrides, setOverrides] = useState({});
  const [dirty, setDirty] = useState(false);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
  }, []);

  // ── Load ──────────────────────────────────────────────────────────

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    try {
      setLoading(true);

      const [domainsRes, schemaRes, settingsRes] = await Promise.all([
        userService.getDomainChoices(),
        userService.getFeatureSchema(),
        userService.getDomainSettings(),
      ]);

      setDomains(domainsRes || []);
      setSchema(schemaRes?.features || {});
      setCurrentDomain(settingsRes?.domain || 'default');
      setDomainDefaults(settingsRes?.domain_defaults || {});
      setOverrides(settingsRes?.feature_overrides || {});
    } catch (err) {
      console.error('Failed to load domain settings:', err);
      showToast('Failed to load domain settings', 'error');
    } finally {
      setLoading(false);
    }
  };

  // ── Domain change ─────────────────────────────────────────────────

  const handleDomainChange = async (newDomain) => {
    try {
      setSaving(true);
      const result = await userService.updateDomainSettings({ domain: newDomain });
      setCurrentDomain(result.domain);
      setDomainDefaults(result.domain_defaults || {});
      setOverrides(result.feature_overrides || {});
      setDirty(false);
      await refreshFlags();
      showToast(`Domain changed to ${newDomain}`);
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to change domain', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Toggle override ───────────────────────────────────────────────

  const handleToggle = (category, feature, value) => {
    setOverrides((prev) => ({
      ...prev,
      [category]: {
        ...(prev[category] || {}),
        [feature]: value,
      },
    }));
    setDirty(true);
  };

  // ── Save overrides ────────────────────────────────────────────────

  const handleSave = async () => {
    try {
      setSaving(true);
      const result = await userService.updateDomainSettings({ feature_overrides: overrides });
      setOverrides(result.feature_overrides || {});
      setDirty(false);
      await refreshFlags();
      showToast('Feature overrides saved');
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Reset overrides ───────────────────────────────────────────────

  const handleReset = async () => {
    if (!confirm('Reset all feature overrides to domain defaults?')) return;
    try {
      setSaving(true);
      await userService.resetFeatureOverrides();
      setOverrides({});
      setDirty(false);
      await refreshFlags();
      showToast('Feature overrides reset to domain defaults');
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to reset', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Loading ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  const selectedDomainMeta = domains.find((d) => d.value === currentDomain);

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Domain Selector */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-1">
          <Globe className="h-5 w-5 text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-900">Organization Domain</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Choose the primary domain for your organization. This determines the default feature set, templates, and UI configuration.
        </p>

        {/* Dropdown selector */}
        <div className="max-w-md">
          <select
            value={currentDomain}
            onChange={(e) => handleDomainChange(e.target.value)}
            disabled={saving}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed appearance-none"
            style={{ backgroundImage: "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")", backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}
          >
            {domains.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        {/* Selected domain info */}
        {selectedDomainMeta && (
          <div className="mt-3 flex items-start gap-2 text-sm">
            <CheckCircle className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <p className="text-gray-600">
              <span className="font-medium text-gray-900">{selectedDomainMeta.label}</span>
              {selectedDomainMeta.description && (
                <span className="text-gray-500"> — {selectedDomainMeta.description}</span>
              )}
            </p>
          </div>
        )}
      </div>

      {/* Info Banner */}
      <div className="flex items-start gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
        <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-blue-900">Domain: {selectedDomainMeta?.label || currentDomain}</p>
          <p className="text-xs text-blue-700 mt-0.5">
            Toggles below are <strong>overrides</strong> on top of the domain defaults.
            Items marked <span className="inline-flex items-center px-1 py-0 rounded text-[10px] font-medium bg-amber-100 text-amber-700">override</span> differ from the domain default.
          </p>
        </div>
      </div>

      {/* Feature Categories */}
      {Object.keys(CATEGORY_META).map((categoryKey) =>
        schema[categoryKey] ? (
          <CategorySection
            key={categoryKey}
            categoryKey={categoryKey}
            schema={schema}
            defaults={domainDefaults}
            overrides={overrides}
            onToggle={handleToggle}
          />
        ) : null,
      )}

      {/* Action Buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleReset}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <RotateCcw className="h-4 w-4" />
          Reset to Domain Defaults
        </button>

        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save Feature Overrides'}
        </button>
      </div>
    </div>
  );
};

export default DomainSettings;
