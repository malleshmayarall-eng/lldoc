import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { userService } from '../services/userService';
import {
  Settings as SettingsIcon, Bell, Lock, Globe, Save, FileText, Eye,
  Sparkles, Clock, CheckCircle, AlertCircle, Building, ToggleLeft,
  KeyRound, Plus, Trash2, Pencil, X,
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

// ─── Credential Type Definitions ──────────────────────────────────────────────

const CREDENTIAL_TYPES = [
  { value: 'email_inbox',  label: 'Email / IMAP',        icon: '📧',
    fields: [
      { key: 'email_host', label: 'IMAP Host', placeholder: 'imap.gmail.com' },
      { key: 'email_user', label: 'Email', placeholder: 'contracts@company.com' },
      { key: 'email_password', label: 'App Password', placeholder: '16-char app password', secret: true },
    ]},
  { value: 'google_drive', label: 'Google Drive',        icon: '📁',
    fields: [
      { key: 'google_access', label: 'Access Mode', type: 'select', options: [
        { value: 'public', label: 'Public (API Key)' }, { value: 'private', label: 'Private (Service Account)' },
      ]},
      { key: 'google_api_key', label: 'API Key', placeholder: 'AIzaSy…', secret: true },
      { key: 'google_credentials_json', label: 'Service Account JSON', placeholder: 'Paste JSON…', secret: true, multiline: true },
    ]},
  { value: 'dropbox',      label: 'Dropbox',             icon: '📦',
    fields: [
      { key: 'dropbox_access_token', label: 'Access Token', placeholder: 'OAuth2 access token', secret: true },
    ]},
  { value: 'onedrive',     label: 'OneDrive / SharePoint', icon: '☁️',
    fields: [
      { key: 'onedrive_access_token', label: 'Access Token', placeholder: 'Microsoft Graph Bearer token', secret: true },
      { key: 'onedrive_drive_id', label: 'Drive ID (optional)', placeholder: 'For shared/team drives' },
    ]},
  { value: 's3',           label: 'AWS S3',              icon: '🪣',
    fields: [
      { key: 's3_access_key', label: 'Access Key', placeholder: 'AKIA…' },
      { key: 's3_secret_key', label: 'Secret Key', placeholder: '••••••', secret: true },
      { key: 's3_region', label: 'Region', placeholder: 'us-east-1' },
    ]},
  { value: 'ftp',          label: 'FTP / SFTP',          icon: '🖥️',
    fields: [
      { key: 'ftp_protocol', label: 'Protocol', type: 'select', options: [
        { value: 'ftp', label: 'FTP' }, { value: 'sftp', label: 'SFTP' },
      ]},
      { key: 'ftp_host', label: 'Host', placeholder: 'ftp.company.com' },
      { key: 'ftp_port', label: 'Port', placeholder: '21' },
      { key: 'ftp_user', label: 'Username', placeholder: 'user' },
      { key: 'ftp_password', label: 'Password', placeholder: '••••', secret: true },
    ]},
];

// ─── Input Node Credential Manager ───────────────────────────────────────────

const InputNodeCredentialManager = ({ showToast }) => {
  const [credentials, setCredentials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);     // null=list, 'new'=add, uuid=edit
  const [form, setForm] = useState({ label: '', credential_type: 'email_inbox', credentials: {} });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const data = await userService.getMyInputCredentials();
      setCredentials(data);
    } catch { /* empty */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => {
    setForm({ label: '', credential_type: 'email_inbox', credentials: {} });
    setEditingId('new');
  };

  const openEdit = (cred) => {
    setForm({ label: cred.label, credential_type: cred.credential_type, credentials: { ...cred.credentials } });
    setEditingId(cred.id);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this saved credential?')) return;
    try {
      await userService.deleteInputCredential(id);
      setCredentials(prev => prev.filter(c => c.id !== id));
      showToast?.('Credential deleted');
    } catch {
      showToast?.('Failed to delete', 'error');
    }
  };

  const handleSave = async () => {
    if (!form.label.trim()) { showToast?.('Please enter a label', 'error'); return; }
    setSaving(true);
    try {
      // Strip out masked values (••••••) — don't overwrite with mask
      const cleanCreds = {};
      Object.entries(form.credentials).forEach(([k, v]) => {
        if (v && v !== '••••••') cleanCreds[k] = v;
      });
      const payload = { label: form.label, credential_type: form.credential_type, credentials: cleanCreds };

      if (editingId === 'new') {
        const created = await userService.saveInputCredential(payload);
        setCredentials(prev => [...prev, created]);
        showToast?.('Credential saved');
      } else {
        const updated = await userService.updateInputCredential(editingId, payload);
        setCredentials(prev => prev.map(c => c.id === editingId ? updated : c));
        showToast?.('Credential updated');
      }
      setEditingId(null);
    } catch (e) {
      showToast?.(e.response?.data?.error || e.response?.data?.credentials?.[0] || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const typeDef = CREDENTIAL_TYPES.find(t => t.value === form.credential_type) || CREDENTIAL_TYPES[0];

  if (loading) return null;

  return (
    <SectionCard
      title="Input Node Credentials"
      icon={KeyRound}
      description="Save credentials for email, cloud storage and other input sources. These can be reused across all CLM workflows instead of entering secrets per node."
    >
      {editingId === null ? (
        /* ── List view ── */
        <>
          {credentials.length === 0 ? (
            <p className="text-sm text-gray-400 italic py-3">No saved credentials yet.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {credentials.map(cred => {
                const td = CREDENTIAL_TYPES.find(t => t.value === cred.credential_type);
                return (
                  <div key={cred.id} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-lg">{td?.icon || '🔌'}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{cred.label}</p>
                        <p className="text-xs text-gray-400">{td?.label || cred.credential_type}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => openEdit(cred)}
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={() => handleDelete(cred.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex justify-end mt-4">
            <button onClick={openAdd}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2 text-sm font-medium transition-colors">
              <Plus className="h-4 w-4" /> Add Credential
            </button>
          </div>
        </>
      ) : (
        /* ── Add / Edit form ── */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">{editingId === 'new' ? 'Add Credential' : 'Edit Credential'}</h3>
            <button onClick={() => setEditingId(null)} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Label */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Label</label>
            <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              placeholder="e.g. Work Gmail, Contracts S3"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* Credential type selector */}
          {editingId === 'new' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
              <select value={form.credential_type}
                onChange={e => setForm(f => ({ ...f, credential_type: e.target.value, credentials: {} }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {CREDENTIAL_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Dynamic fields */}
          <div className="space-y-3 bg-gray-50 rounded-lg p-4 border border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{typeDef.icon} {typeDef.label} Fields</p>
            {typeDef.fields.map(field => (
              <div key={field.key}>
                <label className="block text-xs font-medium text-gray-600 mb-1">{field.label}</label>
                {field.type === 'select' ? (
                  <select value={form.credentials[field.key] || field.options?.[0]?.value || ''}
                    onChange={e => setForm(f => ({ ...f, credentials: { ...f.credentials, [field.key]: e.target.value } }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : field.multiline ? (
                  <textarea value={form.credentials[field.key] || ''} rows={3}
                    onChange={e => setForm(f => ({ ...f, credentials: { ...f.credentials, [field.key]: e.target.value } }))}
                    placeholder={field.placeholder}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                ) : (
                  <input type={field.secret ? 'password' : 'text'}
                    value={form.credentials[field.key] || ''}
                    onChange={e => setForm(f => ({ ...f, credentials: { ...f.credentials, [field.key]: e.target.value } }))}
                    placeholder={field.placeholder}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                )}
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditingId(null)}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 text-sm font-medium transition-colors">
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : editingId === 'new' ? 'Save Credential' : 'Update Credential'}
            </button>
          </div>
        </div>
      )}
    </SectionCard>
  );
};

// ─── CLM Integration Plugin Settings ──────────────────────────────────────────

const CLMIntegrationPluginSettings = ({ showToast }) => {
  const [plugins, setPlugins] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import('../services/clm/clmApi').then(({ workflowApi }) => {
      workflowApi.integrationSettings().then(({ data }) => {
        if (!cancelled) {
          // Convert API format to simple { name: enabled } map
          const map = {};
          Object.entries(data.plugins || {}).forEach(([name, info]) => {
            map[name] = { ...info };
          });
          setPlugins(map);
        }
      }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false); });
    });
    return () => { cancelled = true; };
  }, []);

  const toggle = (name) => {
    setPlugins(prev => ({
      ...prev,
      [name]: { ...prev[name], enabled: !prev[name]?.enabled },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { workflowApi } = await import('../services/clm/clmApi');
      const payload = {};
      Object.entries(plugins).forEach(([name, info]) => {
        payload[name] = info.enabled;
      });
      await workflowApi.updateIntegrationSettings(payload);
      showToast?.('Integration plugin settings saved');
    } catch (e) {
      showToast?.(e.response?.data?.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;
  if (Object.keys(plugins).length === 0) return null;

  return (
    <SectionCard
      title="CLM Integration Plugins"
      icon={ToggleLeft}
      description="Enable or disable integration plugins for CLM input nodes. When enabled, these appear as selectable input types on workflow input nodes."
    >
      <div className="space-y-1 divide-y divide-gray-50">
        {Object.entries(plugins).map(([name, info]) => (
          <ToggleRow
            key={name}
            label={`${info.icon || '🔌'} ${info.display_name || name}`}
            description={info.description}
            checked={info.enabled}
            onChange={() => toggle(name)}
          />
        ))}
      </div>
      <div className="flex justify-end mt-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2 text-sm font-medium transition-colors"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Saving…' : 'Save Plugin Settings'}
        </button>
      </div>
    </SectionCard>
  );
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
                  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
                  { value: 'gemini-2.5-pro-preview-05-06', label: 'Gemini 2.5 Pro' },
                ]}
              />
            </div>
          </SectionCard>

          {/* ── Input Node Credentials ─────────────────────────────────── */}
          <InputNodeCredentialManager showToast={showToast} />

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
                  <SelectRow
                    label="Default AI Model"
                    description="Default AI model for CLM workflows, document analysis, and all AI features"
                    value={orgSettings.default_ai_model || 'gemini-2.5-flash'}
                    onChange={(e) => changeOrgSetting('default_ai_model', e.target.value)}
                    options={[
                      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
                      { value: 'gemini-2.5-pro-preview-05-06', label: 'Gemini 2.5 Pro' },
                      { value: 'gpt-4o', label: 'GPT-4o' },
                      { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
                    ]}
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

              {/* ── CLM Integration Plugins ──────────────────────── */}
              <CLMIntegrationPluginSettings showToast={showToast} />

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
