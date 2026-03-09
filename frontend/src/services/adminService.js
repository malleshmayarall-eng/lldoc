import api from './api';

/**
 * Admin-level API service for organization management.
 * Covers: members, teams, roles, invitations, org profile, org document settings.
 */
export const adminService = {
  // ── Organization Profile ───────────────────────────────────────────

  /** GET /users/organizations/current/ */
  getOrg: async () => {
    const response = await api.get('/users/organizations/current/');
    return response.data;
  },

  /** PATCH /users/organizations/current/ */
  updateOrg: async (data) => {
    const response = await api.patch('/users/organizations/current/', data);
    return response.data;
  },

  /** GET /users/organizations/{id}/stats/ */
  getOrgStats: async (orgId) => {
    const response = await api.get(`/users/organizations/${orgId}/stats/`);
    return response.data;
  },

  // ── Organization Document Settings ─────────────────────────────────

  /** GET /users/organizations/{id}/document-settings/ */
  getOrgDocSettings: async (orgId) => {
    const response = await api.get(`/users/organizations/${orgId}/document-settings/`);
    return response.data;
  },

  /** PATCH /users/organizations/{id}/document-settings/ */
  updateOrgDocSettings: async (orgId, data) => {
    const response = await api.patch(`/users/organizations/${orgId}/document-settings/`, data);
    return response.data;
  },

  // ── Members ────────────────────────────────────────────────────────

  /** GET /users/organizations/{id}/users/ */
  getMembers: async (orgId) => {
    const response = await api.get(`/users/organizations/${orgId}/users/`);
    return response.data;
  },

  /** PATCH /users/users/{profileId}/ — update member profile (role, is_active, etc.) */
  updateMember: async (profileId, data) => {
    const response = await api.patch(`/users/users/${profileId}/`, data);
    return response.data;
  },

  /** POST /users/users/{profileId}/deactivate/ */
  deactivateMember: async (profileId) => {
    const response = await api.post(`/users/users/${profileId}/deactivate/`);
    return response.data;
  },

  /** POST /users/users/{profileId}/activate/ */
  activateMember: async (profileId) => {
    const response = await api.post(`/users/users/${profileId}/activate/`);
    return response.data;
  },

  // ── Teams ──────────────────────────────────────────────────────────

  /** GET /users/teams/?organization={orgId} */
  getTeams: async (orgId) => {
    const response = await api.get('/users/teams/', { params: { organization: orgId } });
    return response.data;
  },

  /** POST /users/teams/ */
  createTeam: async (data) => {
    const response = await api.post('/users/teams/', data);
    return response.data;
  },

  /** GET /users/teams/{id}/ */
  getTeam: async (teamId) => {
    const response = await api.get(`/users/teams/${teamId}/`);
    return response.data;
  },

  /** PATCH /users/teams/{id}/ */
  updateTeam: async (teamId, data) => {
    const response = await api.patch(`/users/teams/${teamId}/`, data);
    return response.data;
  },

  /** DELETE /users/teams/{id}/ */
  deleteTeam: async (teamId) => {
    const response = await api.delete(`/users/teams/${teamId}/`);
    return response.data;
  },

  /** POST /users/teams/{id}/add_member/ */
  addTeamMember: async (teamId, userId) => {
    const response = await api.post(`/users/teams/${teamId}/add_member/`, { user_id: userId });
    return response.data;
  },

  /** POST /users/teams/{id}/remove_member/ */
  removeTeamMember: async (teamId, userId) => {
    const response = await api.post(`/users/teams/${teamId}/remove_member/`, { user_id: userId });
    return response.data;
  },

  // ── Roles ──────────────────────────────────────────────────────────

  /** GET /users/roles/ */
  getRoles: async () => {
    const response = await api.get('/users/roles/');
    return response.data;
  },

  /** POST /users/roles/ */
  createRole: async (data) => {
    const response = await api.post('/users/roles/', data);
    return response.data;
  },

  /** GET /users/roles/{id}/ */
  getRole: async (roleId) => {
    const response = await api.get(`/users/roles/${roleId}/`);
    return response.data;
  },

  /** PATCH /users/roles/{id}/ */
  updateRole: async (roleId, data) => {
    const response = await api.patch(`/users/roles/${roleId}/`, data);
    return response.data;
  },

  /** DELETE /users/roles/{id}/ */
  deleteRole: async (roleId) => {
    const response = await api.delete(`/users/roles/${roleId}/`);
    return response.data;
  },

  // ── Invitations ────────────────────────────────────────────────────

  /** GET /users/invitations/?organization={orgId} */
  getInvitations: async (orgId) => {
    const response = await api.get('/users/invitations/', { params: { organization: orgId } });
    return response.data;
  },

  /** POST /users/invitations/ */
  createInvitation: async (data) => {
    const response = await api.post('/users/invitations/', data);
    return response.data;
  },

  /** POST /users/invitations/{id}/resend/ */
  resendInvitation: async (invitationId) => {
    const response = await api.post(`/users/invitations/${invitationId}/resend/`);
    return response.data;
  },

  /** DELETE /users/invitations/{id}/ */
  deleteInvitation: async (invitationId) => {
    const response = await api.delete(`/users/invitations/${invitationId}/`);
    return response.data;
  },
};

export default adminService;
