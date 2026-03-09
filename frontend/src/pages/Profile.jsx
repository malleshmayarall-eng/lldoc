import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { userService } from '../services/userService';
import {
  User, Mail, Phone, Briefcase, Building, Save, Shield, Users, Clock,
  Globe, Calendar, MapPin, Hash, CreditCard, Palette, Lock, Eye, EyeOff,
  ChevronRight, Award, Scale, FileText, Smartphone, AlertCircle, CheckCircle,
} from 'lucide-react';

// ─── Reusable Components ──────────────────────────────────────────────────────

const TabButton = ({ active, icon: Icon, label, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
      active
        ? 'bg-blue-50 text-blue-700 border border-blue-200'
        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
    }`}
  >
    <Icon className="h-4 w-4 flex-shrink-0" />
    {label}
  </button>
);

const SectionCard = ({ title, description, children }) => (
  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
    {title && (
      <div className="mb-5">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {description && <p className="text-sm text-gray-500 mt-0.5">{description}</p>}
      </div>
    )}
    {children}
  </div>
);

const FormField = ({ label, icon: Icon, children, hint, className = '' }) => (
  <div className={className}>
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {Icon && <Icon className="inline h-4 w-4 mr-1 text-gray-400" />}
      {label}
    </label>
    {children}
    {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
  </div>
);

const TextInput = ({ value, onChange, name, type = 'text', placeholder, disabled, ...rest }) => (
  <input
    type={type}
    name={name}
    value={value || ''}
    onChange={onChange}
    placeholder={placeholder}
    disabled={disabled}
    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500 text-sm"
    {...rest}
  />
);

const SelectInput = ({ value, onChange, name, options, disabled }) => (
  <select
    name={name}
    value={value || ''}
    onChange={onChange}
    disabled={disabled}
    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500 text-sm"
  >
    {options.map((opt) => (
      <option key={opt.value} value={opt.value}>
        {opt.label}
      </option>
    ))}
  </select>
);

const ToggleSwitch = ({ checked, onChange, disabled }) => (
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
);

const Badge = ({ children, color = 'blue' }) => {
  const colors = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    gray: 'bg-gray-50 text-gray-600 border-gray-200',
    red: 'bg-red-50 text-red-700 border-red-200',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full border ${colors[color] || colors.gray}`}>
      {children}
    </span>
  );
};

const InfoRow = ({ label, value, icon: Icon }) => (
  <div className="flex items-start justify-between py-2">
    <span className="text-sm text-gray-500 flex items-center gap-1.5">
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {label}
    </span>
    <span className="text-sm text-gray-900 font-medium text-right max-w-[60%]">{value || '—'}</span>
  </div>
);

const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3500);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all ${
      type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
    }`}>
      {type === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
      {message}
    </div>
  );
};

// ─── Timezone & Language Options ──────────────────────────────────────────────

const TIMEZONE_OPTIONS = [
  { value: '', label: 'Select timezone' },
  { value: 'US/Eastern', label: 'US/Eastern (ET)' },
  { value: 'US/Central', label: 'US/Central (CT)' },
  { value: 'US/Mountain', label: 'US/Mountain (MT)' },
  { value: 'US/Pacific', label: 'US/Pacific (PT)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'Europe/London (GMT)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (CET)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (CET)' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (CST)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST)' },
];

const LANGUAGE_OPTIONS = [
  { value: '', label: 'Select language' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'hi', label: 'Hindi' },
];

const DATE_FORMAT_OPTIONS = [
  { value: '', label: 'Select format' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
  { value: 'DD.MM.YYYY', label: 'DD.MM.YYYY' },
];

const ORG_TYPE_OPTIONS = [
  { value: 'law_firm', label: 'Law Firm' },
  { value: 'corporation', label: 'Corporation' },
  { value: 'government', label: 'Government' },
  { value: 'nonprofit', label: 'Non-Profit' },
  { value: 'individual', label: 'Individual' },
  { value: 'other', label: 'Other' },
];

const SUBSCRIPTION_OPTIONS = [
  { value: 'free', label: 'Free' },
  { value: 'basic', label: 'Basic' },
  { value: 'professional', label: 'Professional' },
  { value: 'enterprise', label: 'Enterprise' },
];

const ROLE_TYPE_COLORS = {
  system_admin: 'red',
  org_admin: 'purple',
  legal_reviewer: 'blue',
  editor: 'green',
  viewer: 'amber',
  guest: 'gray',
  custom: 'blue',
};

// ─── Main Component ───────────────────────────────────────────────────────────

const Profile = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('personal');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Data state
  const [profile, setProfile] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [teams, setTeams] = useState([]);

  // Form state
  const [personalForm, setPersonalForm] = useState({});
  const [orgForm, setOrgForm] = useState({});
  const [orgEditing, setOrgEditing] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ old_password: '', new_password: '', confirm_password: '' });
  const [showPasswords, setShowPasswords] = useState({ old: false, new: false, confirm: false });

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
  }, []);

  const isOrgAdmin = profile?.role_name === 'org_admin' ||
    profile?.role?.role_type === 'org_admin' ||
    profile?.role?.role_type === 'system_admin';

  // ── Load Data ─────────────────────────────────────────────────────────────

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    try {
      setLoading(true);
      const profileData = await userService.getMyProfile();
      setProfile(profileData);
      setPersonalForm(extractPersonalForm(profileData));

      // Load org + teams in parallel
      const promises = [];
      if (profileData.organization) {
        promises.push(
          userService.getCurrentOrg().then((org) => {
            setOrganization(org);
            setOrgForm(extractOrgForm(org));
          }).catch(() => {})
        );
      }
      if (profileData.id) {
        promises.push(
          userService.getMyTeams(profileData.id).then(setTeams).catch(() => setTeams([]))
        );
      }
      await Promise.all(promises);
    } catch (error) {
      console.error('Error loading profile:', error);
      showToast('Failed to load profile data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const extractPersonalForm = (data) => ({
    // User model fields
    first_name: data?.user?.first_name || '',
    last_name: data?.user?.last_name || '',
    email: data?.user?.email || '',
    username: data?.user?.username || '',
    // Profile fields
    phone: data?.phone || '',
    mobile: data?.mobile || '',
    job_title: data?.job_title || '',
    department: data?.department || '',
    bar_number: data?.bar_number || '',
    license_state: data?.license_state || '',
    specialization: data?.specialization || '',
    timezone: data?.timezone || '',
    language: data?.language || '',
    date_format: data?.date_format || '',
    notifications_enabled: data?.notifications_enabled ?? true,
    email_notifications: data?.email_notifications ?? true,
  });

  const extractOrgForm = (org) => ({
    name: org?.name || '',
    legal_name: org?.legal_name || '',
    organization_type: org?.organization_type || 'other',
    email: org?.email || '',
    phone: org?.phone || '',
    website: org?.website || '',
    address_line1: org?.address_line1 || '',
    address_line2: org?.address_line2 || '',
    city: org?.city || '',
    state: org?.state || '',
    postal_code: org?.postal_code || '',
    country: org?.country || '',
    tax_id: org?.tax_id || '',
    registration_number: org?.registration_number || '',
    primary_color: org?.primary_color || '#1E40AF',
    secondary_color: org?.secondary_color || '#3B82F6',
    subscription_plan: org?.subscription_plan || 'free',
    max_users: org?.max_users ?? 5,
    max_documents: org?.max_documents ?? 100,
  });

  // ── Save Handlers ─────────────────────────────────────────────────────────

  const handleSavePersonal = async () => {
    setSaving(true);
    try {
      const updated = await userService.updateMyProfile(personalForm);
      setProfile(updated);
      setPersonalForm(extractPersonalForm(updated));
      showToast('Profile updated successfully');
    } catch (error) {
      console.error('Error saving profile:', error);
      showToast(error.response?.data?.error || 'Failed to save profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOrg = async () => {
    setSaving(true);
    try {
      const updated = await userService.updateCurrentOrg(orgForm);
      setOrganization(updated);
      setOrgForm(extractOrgForm(updated));
      setOrgEditing(false);
      showToast('Organization updated successfully');
    } catch (error) {
      console.error('Error saving organization:', error);
      showToast(error.response?.data?.error || 'Failed to save organization', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      showToast('New passwords do not match', 'error');
      return;
    }
    if (passwordForm.new_password.length < 8) {
      showToast('Password must be at least 8 characters', 'error');
      return;
    }
    setSaving(true);
    try {
      await userService.changePassword({
        old_password: passwordForm.old_password,
        new_password: passwordForm.new_password,
      });
      setPasswordForm({ old_password: '', new_password: '', confirm_password: '' });
      showToast('Password changed successfully');
    } catch (error) {
      console.error('Error changing password:', error);
      showToast(error.response?.data?.error || 'Failed to change password', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Form helpers ──────────────────────────────────────────────────────────

  const handlePersonalChange = (e) => {
    const { name, value } = e.target;
    setPersonalForm((prev) => ({ ...prev, [name]: value }));
  };

  const handlePersonalToggle = (name) => {
    setPersonalForm((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const handleOrgChange = (e) => {
    const { name, value } = e.target;
    setOrgForm((prev) => ({ ...prev, [name]: value }));
  };

  const handlePasswordChange = (e) => {
    const { name, value } = e.target;
    setPasswordForm((prev) => ({ ...prev, [name]: value }));
  };

  // ── Tab Definitions ───────────────────────────────────────────────────────

  const tabs = [
    { key: 'personal', label: 'Personal', icon: User },
    { key: 'professional', label: 'Professional', icon: Briefcase },
    { key: 'organization', label: 'Organization', icon: Building },
    { key: 'teams', label: 'Teams', icon: Users },
    { key: 'role', label: 'Role & Permissions', icon: Shield },
    { key: 'security', label: 'Security', icon: Lock },
  ];

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

      <div className="max-w-6xl mx-auto">
        {/* Header + Profile Summary */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <User className="h-8 w-8 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-gray-900">
                {personalForm.first_name} {personalForm.last_name}
              </h1>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <span className="text-sm text-gray-500">{personalForm.email}</span>
                {profile?.role_name && (
                  <Badge color={ROLE_TYPE_COLORS[profile?.role?.role_type] || 'blue'}>
                    {profile.role_name}
                  </Badge>
                )}
                {organization && (
                  <Badge color="purple">{organization.name}</Badge>
                )}
              </div>
              {personalForm.job_title && (
                <p className="text-sm text-gray-500 mt-0.5">
                  {personalForm.job_title}{personalForm.department ? ` · ${personalForm.department}` : ''}
                </p>
              )}
            </div>
            <div className="text-right text-xs text-gray-400 hidden sm:block">
              <p>Joined {profile?.user?.date_joined ? new Date(profile.user.date_joined).toLocaleDateString() : '—'}</p>
              <p>Last login {profile?.user?.last_login ? new Date(profile.user.last_login).toLocaleDateString() : '—'}</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-6 scrollbar-thin">
          {tabs.map((tab) => (
            <TabButton
              key={tab.key}
              active={activeTab === tab.key}
              icon={tab.icon}
              label={tab.label}
              onClick={() => setActiveTab(tab.key)}
            />
          ))}
        </div>

        {/* ── Tab: Personal Information ──────────────────────────────────── */}
        {activeTab === 'personal' && (
          <div className="space-y-6">
            <SectionCard title="Personal Information" description="Your basic account details">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="First Name" icon={User}>
                  <TextInput name="first_name" value={personalForm.first_name} onChange={handlePersonalChange} />
                </FormField>
                <FormField label="Last Name" icon={User}>
                  <TextInput name="last_name" value={personalForm.last_name} onChange={handlePersonalChange} />
                </FormField>
                <FormField label="Email" icon={Mail}>
                  <TextInput name="email" type="email" value={personalForm.email} onChange={handlePersonalChange} />
                </FormField>
                <FormField label="Username" icon={User} hint="Used for login">
                  <TextInput name="username" value={personalForm.username} onChange={handlePersonalChange} />
                </FormField>
                <FormField label="Phone" icon={Phone}>
                  <TextInput name="phone" type="tel" value={personalForm.phone} onChange={handlePersonalChange} placeholder="+1 (555) 000-0000" />
                </FormField>
                <FormField label="Mobile" icon={Smartphone}>
                  <TextInput name="mobile" type="tel" value={personalForm.mobile} onChange={handlePersonalChange} placeholder="+1 (555) 000-0000" />
                </FormField>
              </div>
            </SectionCard>

            <SectionCard title="Preferences" description="Display and notification preferences">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <FormField label="Timezone" icon={Clock}>
                  <SelectInput name="timezone" value={personalForm.timezone} onChange={handlePersonalChange} options={TIMEZONE_OPTIONS} />
                </FormField>
                <FormField label="Language" icon={Globe}>
                  <SelectInput name="language" value={personalForm.language} onChange={handlePersonalChange} options={LANGUAGE_OPTIONS} />
                </FormField>
                <FormField label="Date Format" icon={Calendar}>
                  <SelectInput name="date_format" value={personalForm.date_format} onChange={handlePersonalChange} options={DATE_FORMAT_OPTIONS} />
                </FormField>
              </div>
              <div className="space-y-3 border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Enable Notifications</p>
                    <p className="text-xs text-gray-500">Receive in-app notifications</p>
                  </div>
                  <ToggleSwitch checked={personalForm.notifications_enabled} onChange={() => handlePersonalToggle('notifications_enabled')} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Email Notifications</p>
                    <p className="text-xs text-gray-500">Receive notifications via email</p>
                  </div>
                  <ToggleSwitch checked={personalForm.email_notifications} onChange={() => handlePersonalToggle('email_notifications')} />
                </div>
              </div>
            </SectionCard>

            <div className="flex justify-end">
              <button
                onClick={handleSavePersonal}
                disabled={saving}
                className="bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 text-sm font-medium transition-colors"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Saving...' : 'Save Personal Info'}
              </button>
            </div>
          </div>
        )}

        {/* ── Tab: Professional Details ──────────────────────────────────── */}
        {activeTab === 'professional' && (
          <div className="space-y-6">
            <SectionCard title="Professional Details" description="Your work-related information">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Job Title" icon={Briefcase}>
                  <TextInput name="job_title" value={personalForm.job_title} onChange={handlePersonalChange} placeholder="e.g. Senior Attorney" />
                </FormField>
                <FormField label="Department" icon={Building}>
                  <TextInput name="department" value={personalForm.department} onChange={handlePersonalChange} placeholder="e.g. Corporate Law" />
                </FormField>
              </div>
            </SectionCard>

            <SectionCard title="Legal Credentials" description="Bar admission and specialization">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Bar Number" icon={Hash}>
                  <TextInput name="bar_number" value={personalForm.bar_number} onChange={handlePersonalChange} placeholder="e.g. 12345" />
                </FormField>
                <FormField label="License State" icon={Scale}>
                  <TextInput name="license_state" value={personalForm.license_state} onChange={handlePersonalChange} placeholder="e.g. California" />
                </FormField>
                <FormField label="Specialization" icon={Award}>
                  <TextInput name="specialization" value={personalForm.specialization} onChange={handlePersonalChange} placeholder="e.g. Contract Law" />
                </FormField>
              </div>
            </SectionCard>

            <div className="flex justify-end">
              <button
                onClick={handleSavePersonal}
                disabled={saving}
                className="bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 text-sm font-medium transition-colors"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Saving...' : 'Save Professional Info'}
              </button>
            </div>
          </div>
        )}

        {/* ── Tab: Organization ──────────────────────────────────────────── */}
        {activeTab === 'organization' && (
          <div className="space-y-6">
            {!organization ? (
              <SectionCard>
                <div className="text-center py-8 text-gray-500">
                  <Building className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p className="font-medium">No Organization</p>
                  <p className="text-sm mt-1">You are not currently part of an organization.</p>
                </div>
              </SectionCard>
            ) : (
              <>
                {/* Org Header */}
                <SectionCard>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-lg flex items-center justify-center text-white font-bold text-lg"
                        style={{ backgroundColor: organization.primary_color || '#1E40AF' }}
                      >
                        {organization.name?.[0]?.toUpperCase() || 'O'}
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">{organization.name}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge color="purple">{ORG_TYPE_OPTIONS.find(o => o.value === organization.organization_type)?.label || organization.organization_type}</Badge>
                          <Badge color="blue">{SUBSCRIPTION_OPTIONS.find(o => o.value === organization.subscription_plan)?.label || organization.subscription_plan} plan</Badge>
                        </div>
                      </div>
                    </div>
                    {isOrgAdmin && !orgEditing && (
                      <button
                        onClick={() => setOrgEditing(true)}
                        className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        Edit Organization
                      </button>
                    )}
                  </div>

                  {!orgEditing ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 border-t border-gray-100 pt-4">
                      <InfoRow label="Legal Name" value={organization.legal_name} icon={FileText} />
                      <InfoRow label="Email" value={organization.email} icon={Mail} />
                      <InfoRow label="Phone" value={organization.phone} icon={Phone} />
                      <InfoRow label="Website" value={organization.website} icon={Globe} />
                      <InfoRow label="Address" value={[organization.address_line1, organization.address_line2].filter(Boolean).join(', ')} icon={MapPin} />
                      <InfoRow label="City / State" value={[organization.city, organization.state].filter(Boolean).join(', ')} />
                      <InfoRow label="Postal Code" value={organization.postal_code} />
                      <InfoRow label="Country" value={organization.country} />
                      <InfoRow label="Tax ID" value={organization.tax_id} icon={CreditCard} />
                      <InfoRow label="Registration #" value={organization.registration_number} icon={Hash} />
                      <InfoRow label="Max Users" value={organization.max_users} />
                      <InfoRow label="Max Documents" value={organization.max_documents} />
                      <InfoRow label="Active Users" value={organization.active_users_count} icon={Users} />
                      <InfoRow label="Status" value={organization.is_active ? 'Active' : 'Inactive'} />
                      <InfoRow label="Created" value={organization.created_at ? new Date(organization.created_at).toLocaleDateString() : null} icon={Calendar} />
                    </div>
                  ) : (
                    /* Org Edit Form */
                    <div className="border-t border-gray-100 pt-4 space-y-5">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField label="Organization Name" icon={Building}>
                          <TextInput name="name" value={orgForm.name} onChange={handleOrgChange} />
                        </FormField>
                        <FormField label="Legal Name" icon={FileText}>
                          <TextInput name="legal_name" value={orgForm.legal_name} onChange={handleOrgChange} />
                        </FormField>
                        <FormField label="Organization Type">
                          <SelectInput name="organization_type" value={orgForm.organization_type} onChange={handleOrgChange} options={ORG_TYPE_OPTIONS} />
                        </FormField>
                        <FormField label="Subscription Plan">
                          <SelectInput name="subscription_plan" value={orgForm.subscription_plan} onChange={handleOrgChange} options={SUBSCRIPTION_OPTIONS} />
                        </FormField>
                        <FormField label="Email" icon={Mail}>
                          <TextInput name="email" type="email" value={orgForm.email} onChange={handleOrgChange} />
                        </FormField>
                        <FormField label="Phone" icon={Phone}>
                          <TextInput name="phone" type="tel" value={orgForm.phone} onChange={handleOrgChange} />
                        </FormField>
                        <FormField label="Website" icon={Globe}>
                          <TextInput name="website" value={orgForm.website} onChange={handleOrgChange} placeholder="https://" />
                        </FormField>
                      </div>

                      <h4 className="text-sm font-semibold text-gray-700 pt-2">Address</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField label="Address Line 1" icon={MapPin}>
                          <TextInput name="address_line1" value={orgForm.address_line1} onChange={handleOrgChange} />
                        </FormField>
                        <FormField label="Address Line 2">
                          <TextInput name="address_line2" value={orgForm.address_line2} onChange={handleOrgChange} />
                        </FormField>
                        <FormField label="City">
                          <TextInput name="city" value={orgForm.city} onChange={handleOrgChange} />
                        </FormField>
                        <FormField label="State / Province">
                          <TextInput name="state" value={orgForm.state} onChange={handleOrgChange} />
                        </FormField>
                        <FormField label="Postal Code">
                          <TextInput name="postal_code" value={orgForm.postal_code} onChange={handleOrgChange} />
                        </FormField>
                        <FormField label="Country">
                          <TextInput name="country" value={orgForm.country} onChange={handleOrgChange} />
                        </FormField>
                      </div>

                      <h4 className="text-sm font-semibold text-gray-700 pt-2">Registration & Branding</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField label="Tax ID" icon={CreditCard}>
                          <TextInput name="tax_id" value={orgForm.tax_id} onChange={handleOrgChange} />
                        </FormField>
                        <FormField label="Registration Number" icon={Hash}>
                          <TextInput name="registration_number" value={orgForm.registration_number} onChange={handleOrgChange} />
                        </FormField>
                        <FormField label="Primary Color" icon={Palette}>
                          <div className="flex items-center gap-2">
                            <input type="color" name="primary_color" value={orgForm.primary_color} onChange={handleOrgChange} className="h-9 w-12 rounded border border-gray-300 cursor-pointer" />
                            <TextInput name="primary_color" value={orgForm.primary_color} onChange={handleOrgChange} />
                          </div>
                        </FormField>
                        <FormField label="Secondary Color" icon={Palette}>
                          <div className="flex items-center gap-2">
                            <input type="color" name="secondary_color" value={orgForm.secondary_color} onChange={handleOrgChange} className="h-9 w-12 rounded border border-gray-300 cursor-pointer" />
                            <TextInput name="secondary_color" value={orgForm.secondary_color} onChange={handleOrgChange} />
                          </div>
                        </FormField>
                        <FormField label="Max Users">
                          <TextInput name="max_users" type="number" value={orgForm.max_users} onChange={handleOrgChange} />
                        </FormField>
                        <FormField label="Max Documents">
                          <TextInput name="max_documents" type="number" value={orgForm.max_documents} onChange={handleOrgChange} />
                        </FormField>
                      </div>

                      <div className="flex gap-3 justify-end pt-3">
                        <button onClick={() => { setOrgEditing(false); setOrgForm(extractOrgForm(organization)); }} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                          Cancel
                        </button>
                        <button onClick={handleSaveOrg} disabled={saving} className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 text-sm font-medium transition-colors">
                          <Save className="h-4 w-4" />
                          {saving ? 'Saving...' : 'Save Organization'}
                        </button>
                      </div>
                    </div>
                  )}
                </SectionCard>
              </>
            )}
          </div>
        )}

        {/* ── Tab: Teams ─────────────────────────────────────────────────── */}
        {activeTab === 'teams' && (
          <div className="space-y-6">
            <SectionCard title="Your Teams" description={`You are a member of ${teams.length} team${teams.length !== 1 ? 's' : ''}`}>
              {teams.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Users className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p className="font-medium">No Teams</p>
                  <p className="text-sm mt-1">You haven't been added to any teams yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {teams.map((team) => (
                    <div key={team.id} className="flex items-center justify-between p-4 rounded-lg border border-gray-100 hover:border-gray-200 hover:bg-gray-50/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                          <Users className="h-5 w-5 text-indigo-600" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{team.name}</p>
                          <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                            {team.team_lead_name && <span>Lead: {team.team_lead_name}</span>}
                            <span>·</span>
                            <span>{team.members_count || 0} member{(team.members_count || 0) !== 1 ? 's' : ''}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge color={team.is_active ? 'green' : 'gray'}>{team.is_active ? 'Active' : 'Inactive'}</Badge>
                        {team.is_public && <Badge color="blue">Public</Badge>}
                        <ChevronRight className="h-4 w-4 text-gray-400" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        )}

        {/* ── Tab: Role & Permissions ────────────────────────────────────── */}
        {activeTab === 'role' && (
          <div className="space-y-6">
            <SectionCard title="Your Role" description="Current role assignment and permissions">
              {profile?.role ? (
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-12 w-12 rounded-lg bg-purple-50 flex items-center justify-center">
                      <Shield className="h-6 w-6 text-purple-600" />
                    </div>
                    <div>
                      <h4 className="text-lg font-semibold text-gray-900">{profile.role.display_name || profile.role.name}</h4>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge color={ROLE_TYPE_COLORS[profile.role.role_type] || 'gray'}>{profile.role.role_type?.replace('_', ' ')}</Badge>
                        {profile.role.is_system_role && <Badge color="amber">System Role</Badge>}
                        <Badge color={profile.role.is_active ? 'green' : 'gray'}>{profile.role.is_active ? 'Active' : 'Inactive'}</Badge>
                      </div>
                    </div>
                  </div>
                  {profile.role.description && (
                    <p className="text-sm text-gray-600 mb-4 bg-gray-50 p-3 rounded-lg">{profile.role.description}</p>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 border-t border-gray-100 pt-4">
                    <InfoRow label="Priority" value={profile.role.priority} />
                    <InfoRow label="Created" value={profile.role.created_at ? new Date(profile.role.created_at).toLocaleDateString() : null} icon={Calendar} />
                  </div>

                  {/* Permissions */}
                  {profile.role.permissions && Object.keys(profile.role.permissions).length > 0 && (
                    <div className="mt-5 border-t border-gray-100 pt-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">Permissions</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                        {Object.entries(profile.role.permissions).map(([key, value]) => (
                          <div key={key} className="flex items-center gap-2 text-sm">
                            {value ? (
                              <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-gray-300 flex-shrink-0" />
                            )}
                            <span className={value ? 'text-gray-900' : 'text-gray-400'}>{key.replace(/_/g, ' ')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Shield className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p className="font-medium">No Role Assigned</p>
                  <p className="text-sm mt-1">Contact your organization admin to get a role assigned.</p>
                </div>
              )}
            </SectionCard>
          </div>
        )}

        {/* ── Tab: Security ──────────────────────────────────────────────── */}
        {activeTab === 'security' && (
          <div className="space-y-6">
            {/* Login Info */}
            <SectionCard title="Login Activity" description="Your recent account activity">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
                <InfoRow label="Login Count" value={profile?.login_count} icon={User} />
                <InfoRow label="Last Login IP" value={profile?.last_login_ip} icon={Globe} />
                <InfoRow label="Last Login Location" value={profile?.last_login_location} icon={MapPin} />
                <InfoRow label="Last Login" value={profile?.user?.last_login ? new Date(profile.user.last_login).toLocaleString() : null} icon={Clock} />
                <InfoRow label="Email Verified" value={profile?.email_verified_at ? new Date(profile.email_verified_at).toLocaleDateString() : 'Not verified'} icon={Mail} />
                <InfoRow label="Password Last Changed" value={profile?.password_changed_at ? new Date(profile.password_changed_at).toLocaleDateString() : 'Never'} icon={Lock} />
                <InfoRow label="Account Status" value={profile?.is_active ? 'Active' : 'Deactivated'} />
                <InfoRow label="Verified" value={profile?.is_verified ? 'Yes' : 'No'} />
              </div>
            </SectionCard>

            {/* Two-Factor */}
            <SectionCard title="Two-Factor Authentication">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">Two-Factor Authentication</p>
                  <p className="text-xs text-gray-500">Add an extra layer of security to your account</p>
                </div>
                <Badge color={profile?.two_factor_enabled ? 'green' : 'gray'}>
                  {profile?.two_factor_enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
            </SectionCard>

            {/* Change Password */}
            <SectionCard title="Change Password" description="Enter your current password and choose a new one">
              <div className="max-w-md space-y-4">
                <FormField label="Current Password" icon={Lock}>
                  <div className="relative">
                    <TextInput
                      name="old_password"
                      type={showPasswords.old ? 'text' : 'password'}
                      value={passwordForm.old_password}
                      onChange={handlePasswordChange}
                      placeholder="Enter current password"
                    />
                    <button type="button" onClick={() => setShowPasswords(p => ({ ...p, old: !p.old }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showPasswords.old ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </FormField>
                <FormField label="New Password" icon={Lock} hint="At least 8 characters">
                  <div className="relative">
                    <TextInput
                      name="new_password"
                      type={showPasswords.new ? 'text' : 'password'}
                      value={passwordForm.new_password}
                      onChange={handlePasswordChange}
                      placeholder="Enter new password"
                    />
                    <button type="button" onClick={() => setShowPasswords(p => ({ ...p, new: !p.new }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showPasswords.new ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </FormField>
                <FormField label="Confirm New Password" icon={Lock}>
                  <div className="relative">
                    <TextInput
                      name="confirm_password"
                      type={showPasswords.confirm ? 'text' : 'password'}
                      value={passwordForm.confirm_password}
                      onChange={handlePasswordChange}
                      placeholder="Re-enter new password"
                    />
                    <button type="button" onClick={() => setShowPasswords(p => ({ ...p, confirm: !p.confirm }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showPasswords.confirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </FormField>
                {passwordForm.new_password && passwordForm.confirm_password && passwordForm.new_password !== passwordForm.confirm_password && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> Passwords do not match
                  </p>
                )}
                <div className="pt-2">
                  <button
                    onClick={handleChangePassword}
                    disabled={saving || !passwordForm.old_password || !passwordForm.new_password || !passwordForm.confirm_password}
                    className="bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 text-sm font-medium transition-colors"
                  >
                    <Lock className="h-4 w-4" />
                    {saving ? 'Changing...' : 'Change Password'}
                  </button>
                </div>
              </div>
            </SectionCard>

            {/* Account Lockout Info (read-only) */}
            {(profile?.failed_login_attempts > 0 || profile?.account_locked_until) && (
              <SectionCard title="Account Security Alerts">
                <div className="space-y-2">
                  {profile.failed_login_attempts > 0 && (
                    <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 p-3 rounded-lg">
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                      <span>{profile.failed_login_attempts} failed login attempt{profile.failed_login_attempts !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                  {profile.account_locked_until && (
                    <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 p-3 rounded-lg">
                      <Lock className="h-4 w-4 flex-shrink-0" />
                      <span>Account locked until {new Date(profile.account_locked_until).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </SectionCard>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Profile;
