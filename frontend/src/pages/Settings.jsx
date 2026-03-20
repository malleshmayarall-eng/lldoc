import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { userService } from '../services/userService';
import {
  Settings as SettingsIcon, Bell, Lock, Globe, Save, FileText, Eye,
  Sparkles, Clock, CheckCircle, AlertCircle, Building, ToggleLeft,
} from 'lucide-react';
import AIPresetManager from '../components/AIPresetManager';
import DomainSettings from '../components/DomainSettings';

// ─── Reusable Components ──────────────────────────────────────────────────────

const SectionCard = ({ title, icon: Icon, description, children }) => (
  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
    <div className="flex items-center gap-2 mb-1">
      {Icon && <Icon className="h-5 w-5 text-gray-600" />}
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
    </div>
    {description && <p className="text-sm text-gray-500 mb-4">{description}</p>}
    {!description && <div className="mb-4" />}
    {children}
  </div>
);

const ToggleRow = ({ label, description, checked, onChange, disabled }) => (
  <div className="flex items-center justify-between py-2">
    <div>
      <p className="text-sm font-medium text-gray-900">{label}</p>
      {description && <p className="text-xs text-gray-500">{description}</p>}
    </div>
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={checked || false}
        onChange={onChange}
        disabled={disabled}
        className="sr-only peer"
      />
      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 peer-disabled:opacity-50"></div>
    </label>
  </div>
);

const SelectRow = ({ label, description, value, onChange, options }) => (
  <div className="py-2">
    <label className="block text-sm font-medium text-gray-900 mb-1">{label}</label>
    {description && <p className="text-xs text-gray-500 mb-2">{description}</p>}
    <select
      value={value || ''}
      onChange={onChange}
      className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  </div>
);

const NumberRow = ({ label, description, value, onChange, min, max, suffix }) => (
  <div className="py-2">
    <label className="block text-sm font-medium text-gray-900 mb-1">{label}</label>
    {description && <p className="text-xs text-gray-500 mb-2">{description}</p>}
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value ?? ''}
        onChange={onChange}
        min={min}
        max={max}
        className="w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
      />
      {suffix && <span className="text-sm text-gray-500">{suffix}</span>}
    </div>
  </div>
);

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

const DEFAULT_VIEW_OPTIONS = [
  { value: 'editor', label: 'Editor' },
  { value: 'preview', label: 'Preview' },
  { value: 'split', label: 'Split View' },
];

const DOC_TYPE_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'contract', label: 'Contract' },
  { value: 'agreement', label: 'Agreement' },
  { value: 'nda', label: 'NDA' },
  { value: 'policy', label: 'Policy' },
  { value: 'memo', label: 'Memo' },
  { value: 'brief', label: 'Brief' },
  { value: 'other', label: 'Other' },
];

const DOC_STATUS_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'draft', label: 'Draft' },
  { value: 'review', label: 'In Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'final', label: 'Final' },
];

const LANGUAGE_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
];

const AI_DASHBOARD_SETTINGS_KEY = 'dashboard_ai_settings';

const DEFAULT_DASHBOARD_AI_SETTINGS = {
  enabled: true,
  provider: 'ollama',
  model: 'llama3.2',
};

// ─── Main Component ───────────────────────────────────────────────────────────

const Settings = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [savingUser, setSavingUser] = useState(false);
  const [savingOrg, setSavingOrg] = useState(false);
  const [toast, setToast] = useState(null);

  // User document settings
  const [userSettings, setUserSettings] = useState({
    auto_save_enabled: true,
    auto_save_interval_seconds: 30,
    change_tracking_enabled: true,
    show_change_markers: true,
    default_view: 'editor',
    ai_assist_enabled: true,
    notification_on_mentions: true,
    preferences: {},
  });

  // Org document settings (admin only)
  const [orgSettings, setOrgSettings] = useState(null);
  const [profile, setProfile] = useState(null);
  const [dashboardAISettings, setDashboardAISettings] = useState(DEFAULT_DASHBOARD_AI_SETTINGS);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
  }, []);

  const isOrgAdmin =
    profile?.role_type === 'org_admin' ||
    profile?.role_type === 'system_admin';

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);

      // Load profile first to determine role
      const profileData = await userService.getMyProfile();
      setProfile(profileData);

      // Load user doc settings
      const uds = await userService.getMyDocSettings();
      setUserSettings((prev) => ({ ...prev, ...uds }));

      // Load dashboard AI settings (local)
      try {
        const raw = localStorage.getItem(AI_DASHBOARD_SETTINGS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          setDashboardAISettings((prev) => ({ ...prev, ...parsed }));
        }
      } catch {
        // ignore local parse errors and keep defaults
      }

      // Load org doc settings if admin
      const roleType = profileData?.role_type;
      if (
        profileData?.organization &&
        (roleType === 'org_admin' || roleType === 'system_admin')
      ) {
        try {
          const ods = await userService.getOrgDocSettings(profileData.organization);
          setOrgSettings(ods);
        } catch {
          // Not admin or no settings yet
        }
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      showToast('Failed to load settings', 'error');
    } finally {
      setLoading(false);
    }
  };

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSaveUserSettings = async () => {
    setSavingUser(true);
    try {
      const { id, profile: _, created_at, updated_at, ...payload } = userSettings;
      const updated = await userService.updateMyDocSettings(payload);
      setUserSettings((prev) => ({ ...prev, ...updated }));

      // Persist dashboard AI settings (frontend preference)
      localStorage.setItem(
        AI_DASHBOARD_SETTINGS_KEY,
        JSON.stringify(dashboardAISettings)
      );

      showToast('Document settings saved');
    } catch (error) {
      console.error('Error saving settings:', error);
      showToast(error.response?.data?.error || 'Failed to save settings', 'error');
    } finally {
      setSavingUser(false);
    }
  };

  const handleSaveOrgSettings = async () => {
    if (!orgSettings || !profile?.organization) return;
    setSavingOrg(true);
    try {
      const { id, organization, created_at, updated_at, ...payload } = orgSettings;
      const updated = await userService.updateOrgDocSettings(profile.organization, payload);
      setOrgSettings(updated);
      showToast('Organization document settings saved');
    } catch (error) {
      console.error('Error saving org settings:', error);
      showToast(error.response?.data?.error || 'Failed to save org settings', 'error');
    } finally {
      setSavingOrg(false);
    }
  };

  // ── Handlers ──────────────────────────────────────────────────────────────

  const toggleUserSetting = (key) => {
    setUserSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const changeUserSetting = (key, value) => {
    setUserSettings((prev) => ({ ...prev, [key]: value }));
  };

  const toggleDashboardAISetting = (key) => {
    setDashboardAISettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const changeDashboardAISetting = (key, value) => {
    setDashboardAISettings((prev) => ({ ...prev, [key]: value }));
  };

  const toggleOrgSetting = (key) => {
    setOrgSettings((prev) => (prev ? { ...prev, [key]: !prev[key] } : prev));
  };

  const changeOrgSetting = (key, value) => {
    setOrgSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 lg:p-8 bg-gray-50 min-h-screen">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Settings</h1>
          <p className="text-gray-600">Manage your document and application preferences</p>
        </div>

        <div className="space-y-6">
          {/* ── User Document Settings ──────────────────────────────────── */}
          <SectionCard title="Document Editor" icon={FileText} description="Your personal document editing preferences">
            <div className="space-y-1 divide-y divide-gray-50">
              <ToggleRow
                label="Auto-Save"
                description="Automatically save document changes while editing"
                checked={userSettings.auto_save_enabled}
                onChange={() => toggleUserSetting('auto_save_enabled')}
              />
              {userSettings.auto_save_enabled && (
                <NumberRow
                  label="Auto-Save Interval"
                  description="How often to auto-save (in seconds)"
                  value={userSettings.auto_save_interval_seconds}
                  onChange={(e) => changeUserSetting('auto_save_interval_seconds', parseInt(e.target.value) || 30)}
                  min={5}
                  max={300}
                  suffix="seconds"
                />
              )}
              <ToggleRow
                label="Change Tracking"
                description="Track changes made to documents"
                checked={userSettings.change_tracking_enabled}
                onChange={() => toggleUserSetting('change_tracking_enabled')}
              />
              <ToggleRow
                label="Show Change Markers"
                description="Display visual markers for tracked changes"
                checked={userSettings.show_change_markers}
                onChange={() => toggleUserSetting('show_change_markers')}
              />
              <SelectRow
                label="Default View"
                description="Default document view mode"
                value={userSettings.default_view}
                onChange={(e) => changeUserSetting('default_view', e.target.value)}
                options={DEFAULT_VIEW_OPTIONS}
              />
            </div>
          </SectionCard>

          <SectionCard title="AI & Notifications" icon={Sparkles} description="AI assistance and mention notifications">
            <div className="space-y-1 divide-y divide-gray-50">
              <ToggleRow
                label="AI Assist"
                description="Enable AI-powered writing suggestions and analysis"
                checked={userSettings.ai_assist_enabled}
                onChange={() => toggleUserSetting('ai_assist_enabled')}
              />
              <ToggleRow
                label="Mention Notifications"
                description="Get notified when someone mentions you in a document"
                checked={userSettings.notification_on_mentions}
                onChange={() => toggleUserSetting('notification_on_mentions')}
              />

              <ToggleRow
                label="Dashboard AI Assistant"
                description="Enable AI summary/recommendations card on dashboard"
                checked={dashboardAISettings.enabled}
                onChange={() => toggleDashboardAISetting('enabled')}
              />

              <SelectRow
                label="Dashboard AI Provider"
                description="Choose which provider powers your dashboard assistant"
                value={dashboardAISettings.provider}
                onChange={(e) => changeDashboardAISetting('provider', e.target.value)}
                options={[
                  { value: 'ollama', label: 'Ollama (Local)' },
                  { value: 'gemini', label: 'Gemini (Cloud)' },
                  { value: 'auto', label: 'Auto (Ollama → Gemini)' },
                ]}
              />

              <SelectRow
                label="Dashboard AI Model"
                description="Model name used by provider (e.g. llama3.2, qwen3:8b)"
                value={dashboardAISettings.model}
                onChange={(e) => changeDashboardAISetting('model', e.target.value)}
                options={[
                  { value: 'llama3.2', label: 'llama3.2' },
                  { value: 'qwen3:8b', label: 'qwen3:8b' },
                  { value: 'gemini-2.0-flash', label: 'gemini-2.0-flash' },
                ]}
              />
            </div>
          </SectionCard>

          {/* Save User Settings */}
          <div className="flex justify-end">
            <button
              onClick={handleSaveUserSettings}
              disabled={savingUser}
              className="bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 text-sm font-medium transition-colors"
            >
              <Save className="h-4 w-4" />
              {savingUser ? 'Saving...' : 'Save Document Settings'}
            </button>
          </div>

          {/* ── Organization Document Settings (admin only) ────────────── */}
          {isOrgAdmin && orgSettings && (
            <>
              <div className="border-t border-gray-200 pt-6">
                <div className="flex items-center gap-2 mb-4">
                  <Building className="h-5 w-5 text-purple-600" />
                  <h2 className="text-xl font-bold text-gray-900">Organization Document Defaults</h2>
                </div>
                <p className="text-sm text-gray-500 mb-6">
                  These settings apply as defaults for all members in your organization. Individual users can override some of these in their personal settings.
                </p>
              </div>

              <SectionCard title="Default Document Settings" icon={SettingsIcon} description="Organization-wide document creation defaults">
                <div className="space-y-1 divide-y divide-gray-50">
                  <SelectRow
                    label="Default Document Type"
                    description="Pre-selected document type when creating new documents"
                    value={orgSettings.default_document_type}
                    onChange={(e) => changeOrgSetting('default_document_type', e.target.value)}
                    options={DOC_TYPE_OPTIONS}
                  />
                  <SelectRow
                    label="Default Status"
                    description="Initial status for new documents"
                    value={orgSettings.default_status}
                    onChange={(e) => changeOrgSetting('default_status', e.target.value)}
                    options={DOC_STATUS_OPTIONS}
                  />
                  <SelectRow
                    label="Default Language"
                    description="Default language for new documents"
                    value={orgSettings.default_language}
                    onChange={(e) => changeOrgSetting('default_language', e.target.value)}
                    options={LANGUAGE_OPTIONS}
                  />
                </div>
              </SectionCard>

              <SectionCard title="Versioning & Sharing" icon={Globe} description="Version control and external access policies">
                <div className="space-y-1 divide-y divide-gray-50">
                  <ToggleRow
                    label="Require ETag"
                    description="Require ETag header for conflict detection on saves"
                    checked={orgSettings.require_etag}
                    onChange={() => toggleOrgSetting('require_etag')}
                  />
                  <ToggleRow
                    label="Enable Versioning"
                    description="Keep version history for all documents"
                    checked={orgSettings.enable_versioning}
                    onChange={() => toggleOrgSetting('enable_versioning')}
                  />
                  <ToggleRow
                    label="Allow External Sharing"
                    description="Allow documents to be shared with users outside the organization"
                    checked={orgSettings.allow_external_sharing}
                    onChange={() => toggleOrgSetting('allow_external_sharing')}
                  />
                </div>
              </SectionCard>

              <SectionCard title="Storage & Limits" icon={Lock} description="File retention and size constraints">
                <div className="space-y-1 divide-y divide-gray-50">
                  <NumberRow
                    label="Retention Period"
                    description="Number of days to retain deleted documents"
                    value={orgSettings.retention_days}
                    onChange={(e) => changeOrgSetting('retention_days', parseInt(e.target.value) || 90)}
                    min={1}
                    max={3650}
                    suffix="days"
                  />
                  <NumberRow
                    label="Auto-Save Interval (Org Default)"
                    description="Default auto-save interval for all users"
                    value={orgSettings.auto_save_interval_seconds}
                    onChange={(e) => changeOrgSetting('auto_save_interval_seconds', parseInt(e.target.value) || 30)}
                    min={5}
                    max={300}
                    suffix="seconds"
                  />
                  <NumberRow
                    label="Max File Size"
                    description="Maximum allowed file upload size"
                    value={orgSettings.max_file_size_mb}
                    onChange={(e) => changeOrgSetting('max_file_size_mb', parseInt(e.target.value) || 10)}
                    min={1}
                    max={500}
                    suffix="MB"
                  />
                </div>
              </SectionCard>

              {/* ── AI Service Presets ─────────────────────────────────── */}
              <AIPresetManager />

              {/* Save Org Settings */}
              <div className="flex justify-end">
                <button
                  onClick={handleSaveOrgSettings}
                  disabled={savingOrg}
                  className="bg-purple-600 text-white px-6 py-2.5 rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2 text-sm font-medium transition-colors"
                >
                  <Save className="h-4 w-4" />
                  {savingOrg ? 'Saving...' : 'Save Organization Defaults'}
                </button>
              </div>
            </>
          )}

          {/* ── Domain & Feature Flags (admin only — independent of orgSettings) ── */}
          {isOrgAdmin && (
            <>
              <div className="border-t border-gray-200 pt-6">
                <div className="flex items-center gap-2 mb-4">
                  <Globe className="h-5 w-5 text-blue-600" />
                  <h2 className="text-xl font-bold text-gray-900">Domain &amp; Feature Flags</h2>
                </div>
                <p className="text-sm text-gray-500 mb-6">
                  Choose the organisation domain and control which features are available across the app.
                  Feature toggles override the domain defaults.
                </p>
              </div>

              <DomainSettings />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
