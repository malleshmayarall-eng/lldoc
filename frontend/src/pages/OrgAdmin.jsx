import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { adminService } from '../services/adminService';
import { userService } from '../services/userService';
import {
  Building, Users, Shield, Mail, UserPlus, Trash2, Edit3, Save, X, Plus,
  CheckCircle, AlertCircle, ChevronDown, ChevronRight, Search, ToggleLeft,
  RefreshCw, Clock, Globe, Hash, CreditCard, MapPin, FileText, Palette,
  Phone, Eye, EyeOff, Send, Award, Crown, UserX, UserCheck,
} from 'lucide-react';

// ─── Shared UI Components ─────────────────────────────────────────────────────

const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
      {type === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
      {message}
    </div>
  );
};

const Badge = ({ children, color = 'blue' }) => {
  const c = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    gray: 'bg-gray-50 text-gray-600 border-gray-200',
    red: 'bg-red-50 text-red-700 border-red-200',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${c[color] || c.gray}`}>{children}</span>;
};

const TabButton = ({ active, icon: Icon, label, onClick, count }) => (
  <button onClick={onClick} className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${active ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}>
    <Icon className="h-4 w-4 flex-shrink-0" />
    {label}
    {count !== undefined && <span className={`ml-1 px-1.5 py-0.5 text-xs rounded-full ${active ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{count}</span>}
  </button>
);

const SectionCard = ({ title, description, action, children }) => (
  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
    {(title || action) && (
      <div className="flex items-center justify-between mb-5">
        <div>
          {title && <h3 className="text-lg font-semibold text-gray-900">{title}</h3>}
          {description && <p className="text-sm text-gray-500 mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
    )}
    {children}
  </div>
);

const EmptyState = ({ icon: Icon, title, description, action }) => (
  <div className="text-center py-12 text-gray-500">
    <Icon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
    <p className="font-medium">{title}</p>
    {description && <p className="text-sm mt-1">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

const ConfirmDialog = ({ open, title, message, onConfirm, onCancel, danger }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6 mx-4">
        <h4 className="text-lg font-semibold text-gray-900 mb-2">{title}</h4>
        <p className="text-sm text-gray-600 mb-5">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={onConfirm} className={`px-4 py-2 text-sm text-white rounded-lg ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

const ROLE_TYPE_COLORS = { system_admin: 'red', org_admin: 'purple', legal_reviewer: 'blue', editor: 'green', viewer: 'amber', guest: 'gray', custom: 'blue' };
const ROLE_TYPE_OPTIONS = [
  { value: 'org_admin', label: 'Organization Admin' },
  { value: 'legal_reviewer', label: 'Legal Reviewer' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'guest', label: 'Guest' },
  { value: 'custom', label: 'Custom' },
];
const ORG_TYPE_OPTIONS = [
  { value: 'law_firm', label: 'Law Firm' }, { value: 'corporation', label: 'Corporation' },
  { value: 'government', label: 'Government' }, { value: 'nonprofit', label: 'Non-Profit' },
  { value: 'individual', label: 'Individual' }, { value: 'other', label: 'Other' },
];
const SUBSCRIPTION_OPTIONS = [
  { value: 'free', label: 'Free' }, { value: 'basic', label: 'Basic' },
  { value: 'professional', label: 'Professional' }, { value: 'enterprise', label: 'Enterprise' },
];

// ─── Main OrgAdmin Component ──────────────────────────────────────────────────

const OrgAdmin = () => {
  const { user } = useAuth();

  // ── Access Guard: only org_admin and system_admin may access ────────
  const isAdmin = user?.role_type === 'org_admin' || user?.role_type === 'system_admin';

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-50">
        <Shield className="h-16 w-16 text-gray-300 mb-4" />
        <h2 className="text-xl font-semibold text-gray-700 mb-2">Access Denied</h2>
        <p className="text-sm text-gray-500 mb-6">You need administrator privileges to access this page.</p>
        <a href="/dashboard" className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
          Go to Dashboard
        </a>
      </div>
    );
  }

  return <OrgAdminContent />;
};

const OrgAdminContent = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('members');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // Data
  const [profile, setProfile] = useState(null);
  const [org, setOrg] = useState(null);
  const [members, setMembers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [roles, setRoles] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [stats, setStats] = useState(null);

  const showToast = useCallback((msg, type = 'success') => setToast({ message: msg, type }), []);

  // ── Load All Data ─────────────────────────────────────────────────────

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      setLoading(true);
      const profileData = await userService.getMyProfile();
      setProfile(profileData);
      const orgId = profileData.organization;
      if (!orgId) throw new Error('No organization');

      const [orgData, membersData, teamsData, rolesData, invData, statsData] = await Promise.all([
        adminService.getOrg(),
        adminService.getMembers(orgId),
        adminService.getTeams(orgId),
        adminService.getRoles(),
        adminService.getInvitations(orgId).catch(() => []),
        adminService.getOrgStats(orgId).catch(() => null),
      ]);
      setOrg(orgData);
      setMembers(Array.isArray(membersData) ? membersData : membersData?.results || []);
      setTeams(Array.isArray(teamsData) ? teamsData : teamsData?.results || []);
      setRoles(Array.isArray(rolesData) ? rolesData : rolesData?.results || []);
      setInvitations(Array.isArray(invData) ? invData : invData?.results || []);
      setStats(statsData);
    } catch (err) {
      console.error('Error loading admin data:', err);
      showToast('Failed to load admin data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const refreshMembers = async () => { if (org) { try { const d = await adminService.getMembers(profile.organization); setMembers(Array.isArray(d) ? d : d?.results || []); } catch {} } };
  const refreshTeams = async () => { if (org) { try { const d = await adminService.getTeams(profile.organization); setTeams(Array.isArray(d) ? d : d?.results || []); } catch {} } };
  const refreshRoles = async () => { try { const d = await adminService.getRoles(); setRoles(Array.isArray(d) ? d : d?.results || []); } catch {} };
  const refreshInvitations = async () => { if (org) { try { const d = await adminService.getInvitations(profile.organization); setInvitations(Array.isArray(d) ? d : d?.results || []); } catch {} } };

  const tabs = [
    { key: 'members', label: 'Members', icon: Users, count: members.length },
    { key: 'teams', label: 'Teams', icon: Users, count: teams.length },
    { key: 'roles', label: 'Roles', icon: Shield, count: roles.length },
    { key: 'invitations', label: 'Invitations', icon: Mail, count: invitations.length },
    { key: 'organization', label: 'Organization', icon: Building },
  ];

  if (loading) {
    return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" /></div>;
  }

  return (
    <div className="p-6 lg:p-8 bg-gray-50 min-h-screen">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-lg flex items-center justify-center text-white font-bold" style={{ backgroundColor: org?.primary_color || '#1E40AF' }}>
              {org?.name?.[0]?.toUpperCase() || 'O'}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Organization Administration</h1>
              <p className="text-sm text-gray-500">{org?.name} · {stats?.active_users || 0} active users · {stats?.total_teams || 0} teams</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-6 scrollbar-thin">
          {tabs.map(t => <TabButton key={t.key} active={activeTab === t.key} icon={t.icon} label={t.label} count={t.count} onClick={() => setActiveTab(t.key)} />)}
        </div>

        {/* ── Tab: Members ──────────────────────────────────────────── */}
        {activeTab === 'members' && (
          <MembersTab members={members} roles={roles} showToast={showToast} refreshMembers={refreshMembers} />
        )}

        {/* ── Tab: Teams ────────────────────────────────────────────── */}
        {activeTab === 'teams' && (
          <TeamsTab teams={teams} members={members} orgId={profile?.organization} showToast={showToast} refreshTeams={refreshTeams} />
        )}

        {/* ── Tab: Roles ────────────────────────────────────────────── */}
        {activeTab === 'roles' && (
          <RolesTab roles={roles} showToast={showToast} refreshRoles={refreshRoles} />
        )}

        {/* ── Tab: Invitations ──────────────────────────────────────── */}
        {activeTab === 'invitations' && (
          <InvitationsTab invitations={invitations} roles={roles} orgId={profile?.organization} showToast={showToast} refreshInvitations={refreshInvitations} />
        )}

        {/* ── Tab: Organization ─────────────────────────────────────── */}
        {activeTab === 'organization' && (
          <OrganizationTab org={org} setOrg={setOrg} showToast={showToast} />
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: Members
// ═══════════════════════════════════════════════════════════════════════════════

const MembersTab = ({ members, roles, showToast, refreshMembers }) => {
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editRole, setEditRole] = useState('');
  const [confirm, setConfirm] = useState(null);

  const filtered = members.filter(m => {
    const q = search.toLowerCase();
    return !q || m.full_name?.toLowerCase().includes(q) || m.user_email?.toLowerCase().includes(q) || m.role_name?.toLowerCase().includes(q);
  });

  const handleChangeRole = async (memberId) => {
    try {
      await adminService.updateMember(memberId, { role: editRole });
      showToast('Role updated');
      setEditingId(null);
      refreshMembers();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to update role', 'error');
    }
  };

  const handleToggleActive = async (member) => {
    try {
      if (member.is_active) {
        await adminService.deactivateMember(member.id);
        showToast('User deactivated');
      } else {
        await adminService.activateMember(member.id);
        showToast('User activated');
      }
      refreshMembers();
    } catch (err) {
      showToast('Failed to update user status', 'error');
    }
  };

  return (
    <SectionCard
      title="Organization Members"
      description={`${members.length} total members`}
      action={
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input type="text" placeholder="Search members..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-64" />
        </div>
      }
    >
      <ConfirmDialog open={!!confirm} title={confirm?.title} message={confirm?.message} danger={confirm?.danger}
        onConfirm={() => { confirm?.action(); setConfirm(null); }} onCancel={() => setConfirm(null)} />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-3 px-3 font-medium text-gray-500">Name</th>
              <th className="text-left py-3 px-3 font-medium text-gray-500">Email</th>
              <th className="text-left py-3 px-3 font-medium text-gray-500">Role</th>
              <th className="text-left py-3 px-3 font-medium text-gray-500">Job Title</th>
              <th className="text-left py-3 px-3 font-medium text-gray-500">Status</th>
              <th className="text-left py-3 px-3 font-medium text-gray-500">Joined</th>
              <th className="text-right py-3 px-3 font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="py-8 text-center text-gray-400">No members found</td></tr>
            ) : filtered.map(m => (
              <tr key={m.id} className="hover:bg-gray-50/50">
                <td className="py-3 px-3 font-medium text-gray-900">{m.full_name || '—'}</td>
                <td className="py-3 px-3 text-gray-600">{m.user_email}</td>
                <td className="py-3 px-3">
                  {editingId === m.id ? (
                    <div className="flex items-center gap-1">
                      <select value={editRole} onChange={e => setEditRole(e.target.value)} className="text-xs border rounded px-2 py-1">
                        {roles.map(r => <option key={r.id} value={r.id}>{r.display_name || r.name}</option>)}
                      </select>
                      <button onClick={() => handleChangeRole(m.id)} className="p-1 text-green-600 hover:bg-green-50 rounded"><CheckCircle className="h-4 w-4" /></button>
                      <button onClick={() => setEditingId(null)} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X className="h-4 w-4" /></button>
                    </div>
                  ) : (
                    <Badge color={ROLE_TYPE_COLORS[m.role_name?.toLowerCase().replace(' ', '_')] || 'blue'}>{m.role_name || '—'}</Badge>
                  )}
                </td>
                <td className="py-3 px-3 text-gray-600">{m.job_title || '—'}</td>
                <td className="py-3 px-3"><Badge color={m.is_active ? 'green' : 'red'}>{m.is_active ? 'Active' : 'Inactive'}</Badge></td>
                <td className="py-3 px-3 text-gray-500">{m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'}</td>
                <td className="py-3 px-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => { setEditingId(m.id); setEditRole(m.role || ''); }} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="Change role">
                      <Shield className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setConfirm({
                        title: m.is_active ? 'Deactivate User' : 'Activate User',
                        message: `Are you sure you want to ${m.is_active ? 'deactivate' : 'activate'} ${m.full_name}?`,
                        danger: m.is_active,
                        action: () => handleToggleActive(m),
                      })}
                      className={`p-1.5 rounded ${m.is_active ? 'text-gray-400 hover:text-red-600 hover:bg-red-50' : 'text-gray-400 hover:text-green-600 hover:bg-green-50'}`}
                      title={m.is_active ? 'Deactivate' : 'Activate'}
                    >
                      {m.is_active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: Teams
// ═══════════════════════════════════════════════════════════════════════════════

const TeamsTab = ({ teams, members, orgId, showToast, refreshTeams }) => {
  const [showForm, setShowForm] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', team_lead: '', is_active: true, is_public: false });
  const [saving, setSaving] = useState(false);
  const [expandedTeam, setExpandedTeam] = useState(null);
  const [teamDetail, setTeamDetail] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const resetForm = () => { setForm({ name: '', description: '', team_lead: '', is_active: true, is_public: false }); setEditingTeam(null); setShowForm(false); };

  const handleSave = async () => {
    if (!form.name.trim()) { showToast('Team name is required', 'error'); return; }
    setSaving(true);
    try {
      const payload = { ...form, organization: orgId };
      if (!payload.team_lead) delete payload.team_lead;
      if (editingTeam) {
        await adminService.updateTeam(editingTeam, payload);
        showToast('Team updated');
      } else {
        await adminService.createTeam(payload);
        showToast('Team created');
      }
      resetForm();
      refreshTeams();
    } catch (err) {
      showToast(err.response?.data?.name?.[0] || err.response?.data?.error || 'Failed to save team', 'error');
    } finally { setSaving(false); }
  };

  const handleEdit = (team) => {
    setForm({ name: team.name, description: team.description || '', team_lead: team.team_lead || '', is_active: team.is_active, is_public: team.is_public });
    setEditingTeam(team.id);
    setShowForm(true);
  };

  const handleDelete = async (teamId) => {
    try { await adminService.deleteTeam(teamId); showToast('Team deleted'); refreshTeams(); } catch { showToast('Failed to delete team', 'error'); }
  };

  const handleExpand = async (teamId) => {
    if (expandedTeam === teamId) { setExpandedTeam(null); setTeamDetail(null); return; }
    try {
      const detail = await adminService.getTeam(teamId);
      setTeamDetail(detail);
      setExpandedTeam(teamId);
    } catch { showToast('Failed to load team details', 'error'); }
  };

  const handleRemoveMember = async (teamId, memberId) => {
    try { await adminService.removeTeamMember(teamId, memberId); showToast('Member removed'); handleExpand(teamId); refreshTeams(); } catch { showToast('Failed to remove member', 'error'); }
  };

  const [addMemberId, setAddMemberId] = useState('');
  const handleAddMember = async (teamId) => {
    if (!addMemberId) return;
    try { await adminService.addTeamMember(teamId, addMemberId); showToast('Member added'); setAddMemberId(''); handleExpand(teamId); refreshTeams(); } catch { showToast('Failed to add member', 'error'); }
  };

  return (
    <div className="space-y-6">
      <ConfirmDialog open={!!confirm} title={confirm?.title} message={confirm?.message} danger
        onConfirm={() => { confirm?.action(); setConfirm(null); }} onCancel={() => setConfirm(null)} />

      <SectionCard
        title="Teams"
        description={`${teams.length} teams in your organization`}
        action={
          <button onClick={() => { resetForm(); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
            <Plus className="h-4 w-4" /> New Team
          </button>
        }
      >
        {/* Create / Edit Form */}
        {showForm && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-4">
            <h4 className="text-sm font-semibold text-gray-700">{editingTeam ? 'Edit Team' : 'Create New Team'}</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Team Name *</label>
                <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="e.g. Corporate Legal Team" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Team Lead</label>
                <select value={form.team_lead} onChange={e => setForm(p => ({ ...p, team_lead: e.target.value }))} className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                  <option value="">No lead assigned</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.full_name} ({m.user_email})</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="Team description..." />
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} className="rounded" /> Active</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_public} onChange={e => setForm(p => ({ ...p, is_public: e.target.checked }))} className="rounded" /> Public</label>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={resetForm} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-100">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                <Save className="h-4 w-4" />{saving ? 'Saving...' : editingTeam ? 'Update Team' : 'Create Team'}
              </button>
            </div>
          </div>
        )}

        {/* Teams List */}
        {teams.length === 0 ? (
          <EmptyState icon={Users} title="No Teams" description="Create your first team to organize collaboration." />
        ) : (
          <div className="space-y-3">
            {teams.map(team => (
              <div key={team.id} className="border border-gray-100 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between p-4 hover:bg-gray-50/50 transition-colors cursor-pointer" onClick={() => handleExpand(team.id)}>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                      <Users className="h-5 w-5 text-indigo-600" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{team.name}</p>
                      <p className="text-xs text-gray-500">{team.team_lead_name ? `Lead: ${team.team_lead_name}` : 'No lead'} · {team.members_count || 0} members</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge color={team.is_active ? 'green' : 'gray'}>{team.is_active ? 'Active' : 'Inactive'}</Badge>
                    {team.is_public && <Badge color="blue">Public</Badge>}
                    <button onClick={e => { e.stopPropagation(); handleEdit(team); }} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"><Edit3 className="h-4 w-4" /></button>
                    <button onClick={e => { e.stopPropagation(); setConfirm({ title: 'Delete Team', message: `Delete "${team.name}"? This cannot be undone.`, action: () => handleDelete(team.id) }); }} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="h-4 w-4" /></button>
                    {expandedTeam === team.id ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                  </div>
                </div>

                {/* Expanded: Members */}
                {expandedTeam === team.id && teamDetail && (
                  <div className="border-t border-gray-100 bg-gray-50/50 p-4">
                    {teamDetail.description && <p className="text-sm text-gray-600 mb-3">{teamDetail.description}</p>}
                    <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Members ({teamDetail.members_list?.length || 0})</h5>
                    {teamDetail.members_list?.length > 0 ? (
                      <div className="space-y-2 mb-3">
                        {teamDetail.members_list.map(mem => (
                          <div key={mem.id} className="flex items-center justify-between bg-white p-2 rounded border border-gray-100">
                            <div className="flex items-center gap-2">
                              <div className="h-7 w-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-medium text-blue-600">{mem.full_name?.[0]}</div>
                              <div>
                                <p className="text-sm font-medium text-gray-900">{mem.full_name}</p>
                                <p className="text-xs text-gray-500">{mem.user_email}</p>
                              </div>
                            </div>
                            <button onClick={() => handleRemoveMember(team.id, mem.id)} className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"><X className="h-3.5 w-3.5" /></button>
                          </div>
                        ))}
                      </div>
                    ) : <p className="text-xs text-gray-400 mb-3">No members yet</p>}

                    {/* Add member */}
                    <div className="flex items-center gap-2">
                      <select value={addMemberId} onChange={e => setAddMemberId(e.target.value)} className="flex-1 px-3 py-1.5 border rounded-md text-sm">
                        <option value="">Select member to add...</option>
                        {members.filter(m => !teamDetail.members_list?.some(tm => tm.id === m.id)).map(m => (
                          <option key={m.id} value={m.id}>{m.full_name} ({m.user_email})</option>
                        ))}
                      </select>
                      <button onClick={() => handleAddMember(team.id)} disabled={!addMemberId} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
                        <UserPlus className="h-3.5 w-3.5" /> Add
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: Roles
// ═══════════════════════════════════════════════════════════════════════════════

const PERMISSION_KEYS = ['create_documents', 'read_documents', 'update_documents', 'delete_documents', 'manage_users', 'manage_teams', 'manage_roles', 'manage_settings', 'share_documents', 'export_documents', 'ai_analysis', 'view_analytics'];

const RolesTab = ({ roles, showToast, refreshRoles }) => {
  const [showForm, setShowForm] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [form, setForm] = useState({ name: '', display_name: '', description: '', role_type: 'viewer', is_active: true, priority: 0, permissions: {} });
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const resetForm = () => { setForm({ name: '', display_name: '', description: '', role_type: 'viewer', is_active: true, priority: 0, permissions: {} }); setEditingRole(null); setShowForm(false); };

  const handleSave = async () => {
    if (!form.name.trim() || !form.display_name.trim()) { showToast('Name and display name are required', 'error'); return; }
    setSaving(true);
    try {
      if (editingRole) {
        await adminService.updateRole(editingRole, form);
        showToast('Role updated');
      } else {
        await adminService.createRole(form);
        showToast('Role created');
      }
      resetForm();
      refreshRoles();
    } catch (err) {
      showToast(err.response?.data?.name?.[0] || 'Failed to save role', 'error');
    } finally { setSaving(false); }
  };

  const handleEdit = (role) => {
    setForm({ name: role.name, display_name: role.display_name, description: role.description || '', role_type: role.role_type, is_active: role.is_active, priority: role.priority || 0, permissions: role.permissions || {} });
    setEditingRole(role.id);
    setShowForm(true);
  };

  const handleDelete = async (roleId) => {
    try { await adminService.deleteRole(roleId); showToast('Role deleted'); refreshRoles(); } catch (err) { showToast(err.response?.data?.detail || 'Failed to delete role (it may be in use)', 'error'); }
  };

  const togglePermission = (key) => {
    setForm(p => ({ ...p, permissions: { ...p.permissions, [key]: !p.permissions[key] } }));
  };

  return (
    <div className="space-y-6">
      <ConfirmDialog open={!!confirm} title={confirm?.title} message={confirm?.message} danger
        onConfirm={() => { confirm?.action(); setConfirm(null); }} onCancel={() => setConfirm(null)} />

      <SectionCard
        title="Roles"
        description="Define roles and permissions for organization members"
        action={
          <button onClick={() => { resetForm(); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
            <Plus className="h-4 w-4" /> New Role
          </button>
        }
      >
        {/* Create / Edit Form */}
        {showForm && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-4">
            <h4 className="text-sm font-semibold text-gray-700">{editingRole ? 'Edit Role' : 'Create New Role'}</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">System Name *</label>
                <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="e.g. senior_editor" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Display Name *</label>
                <input type="text" value={form.display_name} onChange={e => setForm(p => ({ ...p, display_name: e.target.value }))} className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="e.g. Senior Editor" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Role Type</label>
                <select value={form.role_type} onChange={e => setForm(p => ({ ...p, role_type: e.target.value }))} className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                  {ROLE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Priority</label>
                <input type="number" value={form.priority} onChange={e => setForm(p => ({ ...p, priority: parseInt(e.target.value) || 0 }))} className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
              </div>
            </div>

            {/* Permissions Grid */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-2">Permissions</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {PERMISSION_KEYS.map(key => (
                  <label key={key} className="flex items-center gap-2 text-sm cursor-pointer p-2 rounded hover:bg-gray-100">
                    <input type="checkbox" checked={!!form.permissions[key]} onChange={() => togglePermission(key)} className="rounded text-blue-600" />
                    <span className="text-gray-700">{key.replace(/_/g, ' ')}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} className="rounded" /> Active</label>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={resetForm} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-100">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                <Save className="h-4 w-4" />{saving ? 'Saving...' : editingRole ? 'Update Role' : 'Create Role'}
              </button>
            </div>
          </div>
        )}

        {/* Roles List */}
        {roles.length === 0 ? (
          <EmptyState icon={Shield} title="No Roles" description="Create roles to define permissions for your team." />
        ) : (
          <div className="space-y-3">
            {roles.map(role => (
              <div key={role.id} className="flex items-center justify-between p-4 rounded-lg border border-gray-100 hover:border-gray-200 hover:bg-gray-50/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-purple-50 flex items-center justify-center">
                    <Shield className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">{role.display_name || role.name}</p>
                      <Badge color={ROLE_TYPE_COLORS[role.role_type] || 'gray'}>{role.role_type?.replace('_', ' ')}</Badge>
                      {role.is_system_role && <Badge color="amber">System</Badge>}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{role.description || 'No description'} · {role.users_count || 0} users · Priority: {role.priority || 0}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge color={role.is_active ? 'green' : 'gray'}>{role.is_active ? 'Active' : 'Inactive'}</Badge>
                  {!role.is_system_role && (
                    <>
                      <button onClick={() => handleEdit(role)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"><Edit3 className="h-4 w-4" /></button>
                      <button onClick={() => setConfirm({ title: 'Delete Role', message: `Delete "${role.display_name}"? Users with this role will need reassignment.`, action: () => handleDelete(role.id) })} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="h-4 w-4" /></button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: Invitations
// ═══════════════════════════════════════════════════════════════════════════════

const InvitationsTab = ({ invitations, roles, orgId, showToast, refreshInvitations }) => {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ email: '', role: '', message: '' });
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const handleSend = async () => {
    if (!form.email || !form.role) { showToast('Email and role are required', 'error'); return; }
    setSaving(true);
    try {
      await adminService.createInvitation({ ...form, organization: orgId });
      showToast('Invitation sent');
      setForm({ email: '', role: '', message: '' });
      setShowForm(false);
      refreshInvitations();
    } catch (err) {
      showToast(err.response?.data?.email?.[0] || 'Failed to send invitation', 'error');
    } finally { setSaving(false); }
  };

  const handleResend = async (id) => {
    try { await adminService.resendInvitation(id); showToast('Invitation resent'); } catch { showToast('Failed to resend', 'error'); }
  };

  const handleDelete = async (id) => {
    try { await adminService.deleteInvitation(id); showToast('Invitation revoked'); refreshInvitations(); } catch { showToast('Failed to revoke invitation', 'error'); }
  };

  return (
    <div className="space-y-6">
      <ConfirmDialog open={!!confirm} title={confirm?.title} message={confirm?.message} danger
        onConfirm={() => { confirm?.action(); setConfirm(null); }} onCancel={() => setConfirm(null)} />

      <SectionCard
        title="Invitations"
        description="Invite new members to your organization"
        action={
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
            <UserPlus className="h-4 w-4" /> Invite Member
          </button>
        }
      >
        {showForm && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-4">
            <h4 className="text-sm font-semibold text-gray-700">Send Invitation</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
                <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="user@example.com" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Role *</label>
                <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))} className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                  <option value="">Select a role...</option>
                  {roles.map(r => <option key={r.id} value={r.id}>{r.display_name || r.name}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Personal Message (optional)</label>
                <textarea value={form.message} onChange={e => setForm(p => ({ ...p, message: e.target.value }))} rows={2} className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="Welcome to our team..." />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-100">Cancel</button>
              <button onClick={handleSend} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                <Send className="h-4 w-4" />{saving ? 'Sending...' : 'Send Invitation'}
              </button>
            </div>
          </div>
        )}

        {invitations.length === 0 ? (
          <EmptyState icon={Mail} title="No Invitations" description="Invite people to join your organization." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 px-3 font-medium text-gray-500">Email</th>
                  <th className="text-left py-3 px-3 font-medium text-gray-500">Role</th>
                  <th className="text-left py-3 px-3 font-medium text-gray-500">Invited By</th>
                  <th className="text-left py-3 px-3 font-medium text-gray-500">Status</th>
                  <th className="text-left py-3 px-3 font-medium text-gray-500">Sent</th>
                  <th className="text-left py-3 px-3 font-medium text-gray-500">Expires</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invitations.map(inv => (
                  <tr key={inv.id} className="hover:bg-gray-50/50">
                    <td className="py-3 px-3 font-medium text-gray-900">{inv.email}</td>
                    <td className="py-3 px-3"><Badge color="blue">{inv.role_name || '—'}</Badge></td>
                    <td className="py-3 px-3 text-gray-600">{inv.invited_by_name || '—'}</td>
                    <td className="py-3 px-3">
                      {inv.is_used ? <Badge color="green">Used</Badge> : inv.is_expired ? <Badge color="red">Expired</Badge> : <Badge color="amber">Pending</Badge>}
                    </td>
                    <td className="py-3 px-3 text-gray-500">{inv.created_at ? new Date(inv.created_at).toLocaleDateString() : '—'}</td>
                    <td className="py-3 px-3 text-gray-500">{inv.expires_at ? new Date(inv.expires_at).toLocaleDateString() : '—'}</td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {!inv.is_used && !inv.is_expired && (
                          <button onClick={() => handleResend(inv.id)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="Resend"><RefreshCw className="h-4 w-4" /></button>
                        )}
                        <button onClick={() => setConfirm({ title: 'Revoke Invitation', message: `Revoke the invitation sent to ${inv.email}?`, action: () => handleDelete(inv.id) })} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="Revoke"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: Organization Profile
// ═══════════════════════════════════════════════════════════════════════════════

const OrganizationTab = ({ org, setOrg, showToast }) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});

  useEffect(() => { if (org) setForm(extractForm(org)); }, [org]);

  const extractForm = (o) => ({
    name: o?.name || '', legal_name: o?.legal_name || '', organization_type: o?.organization_type || 'other',
    email: o?.email || '', phone: o?.phone || '', website: o?.website || '',
    address_line1: o?.address_line1 || '', address_line2: o?.address_line2 || '',
    city: o?.city || '', state: o?.state || '', postal_code: o?.postal_code || '', country: o?.country || '',
    tax_id: o?.tax_id || '', registration_number: o?.registration_number || '',
    primary_color: o?.primary_color || '#1E40AF', secondary_color: o?.secondary_color || '#3B82F6',
    subscription_plan: o?.subscription_plan || 'free', max_users: o?.max_users ?? 5, max_documents: o?.max_documents ?? 100,
  });

  const handleChange = (e) => { const { name, value } = e.target; setForm(p => ({ ...p, [name]: value })); };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await adminService.updateOrg(form);
      setOrg(updated);
      setEditing(false);
      showToast('Organization updated');
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to save', 'error');
    } finally { setSaving(false); }
  };

  const InfoRow = ({ label, value, icon: Icon }) => (
    <div className="flex items-start justify-between py-2">
      <span className="text-sm text-gray-500 flex items-center gap-1.5">{Icon && <Icon className="h-3.5 w-3.5" />}{label}</span>
      <span className="text-sm text-gray-900 font-medium text-right max-w-[60%]">{value || '—'}</span>
    </div>
  );

  const Field = ({ label, name, type = 'text', icon: Icon, hint }) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{Icon && <Icon className="inline h-3.5 w-3.5 mr-1 text-gray-400" />}{label}</label>
      <input type={type} name={name} value={form[name] || ''} onChange={handleChange} className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
      {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      <SectionCard
        action={
          !editing ? (
            <button onClick={() => setEditing(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
              <Edit3 className="h-4 w-4" /> Edit Organization
            </button>
          ) : null
        }
      >
        {!editing ? (
          <>
            {/* View mode */}
            <div className="flex items-center gap-3 mb-6">
              <div className="h-14 w-14 rounded-lg flex items-center justify-center text-white font-bold text-xl" style={{ backgroundColor: org?.primary_color || '#1E40AF' }}>
                {org?.name?.[0]?.toUpperCase() || 'O'}
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">{org?.name}</h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge color="purple">{ORG_TYPE_OPTIONS.find(o => o.value === org?.organization_type)?.label || org?.organization_type}</Badge>
                  <Badge color="blue">{SUBSCRIPTION_OPTIONS.find(o => o.value === org?.subscription_plan)?.label || org?.subscription_plan} plan</Badge>
                  <Badge color={org?.is_active ? 'green' : 'red'}>{org?.is_active ? 'Active' : 'Inactive'}</Badge>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
              <InfoRow label="Legal Name" value={org?.legal_name} icon={FileText} />
              <InfoRow label="Email" value={org?.email} icon={Mail} />
              <InfoRow label="Phone" value={org?.phone} icon={Phone} />
              <InfoRow label="Website" value={org?.website} icon={Globe} />
              <InfoRow label="Address" value={[org?.address_line1, org?.address_line2].filter(Boolean).join(', ')} icon={MapPin} />
              <InfoRow label="City / State" value={[org?.city, org?.state].filter(Boolean).join(', ')} />
              <InfoRow label="Postal Code" value={org?.postal_code} />
              <InfoRow label="Country" value={org?.country} />
              <InfoRow label="Tax ID" value={org?.tax_id} icon={CreditCard} />
              <InfoRow label="Registration #" value={org?.registration_number} icon={Hash} />
              <InfoRow label="Max Users" value={org?.max_users} />
              <InfoRow label="Max Documents" value={org?.max_documents} />
              <InfoRow label="Active Users" value={org?.active_users_count} icon={Users} />
              <InfoRow label="Created" value={org?.created_at ? new Date(org.created_at).toLocaleDateString() : null} icon={Clock} />
            </div>
          </>
        ) : (
          /* Edit mode */
          <div className="space-y-5">
            <h3 className="text-lg font-semibold text-gray-900">Edit Organization</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Organization Name" name="name" icon={Building} />
              <Field label="Legal Name" name="legal_name" icon={FileText} />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Organization Type</label>
                <select name="organization_type" value={form.organization_type} onChange={handleChange} className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                  {ORG_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Subscription Plan</label>
                <select name="subscription_plan" value={form.subscription_plan} onChange={handleChange} className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                  {SUBSCRIPTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <Field label="Email" name="email" type="email" icon={Mail} />
              <Field label="Phone" name="phone" type="tel" icon={Phone} />
              <Field label="Website" name="website" icon={Globe} />
            </div>

            <h4 className="text-sm font-semibold text-gray-700 pt-2">Address</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Address Line 1" name="address_line1" icon={MapPin} />
              <Field label="Address Line 2" name="address_line2" />
              <Field label="City" name="city" />
              <Field label="State / Province" name="state" />
              <Field label="Postal Code" name="postal_code" />
              <Field label="Country" name="country" />
            </div>

            <h4 className="text-sm font-semibold text-gray-700 pt-2">Registration & Branding</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Tax ID" name="tax_id" icon={CreditCard} />
              <Field label="Registration Number" name="registration_number" icon={Hash} />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><Palette className="inline h-3.5 w-3.5 mr-1 text-gray-400" />Primary Color</label>
                <div className="flex items-center gap-2">
                  <input type="color" name="primary_color" value={form.primary_color} onChange={handleChange} className="h-9 w-12 rounded border border-gray-300 cursor-pointer" />
                  <input type="text" name="primary_color" value={form.primary_color} onChange={handleChange} className="flex-1 px-3 py-2 border rounded-md text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><Palette className="inline h-3.5 w-3.5 mr-1 text-gray-400" />Secondary Color</label>
                <div className="flex items-center gap-2">
                  <input type="color" name="secondary_color" value={form.secondary_color} onChange={handleChange} className="h-9 w-12 rounded border border-gray-300 cursor-pointer" />
                  <input type="text" name="secondary_color" value={form.secondary_color} onChange={handleChange} className="flex-1 px-3 py-2 border rounded-md text-sm" />
                </div>
              </div>
              <Field label="Max Users" name="max_users" type="number" />
              <Field label="Max Documents" name="max_documents" type="number" />
            </div>

            <div className="flex gap-3 justify-end pt-3">
              <button onClick={() => { setEditing(false); setForm(extractForm(org)); }} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 text-sm font-medium">
                <Save className="h-4 w-4" />{saving ? 'Saving...' : 'Save Organization'}
              </button>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default OrgAdmin;
