import api from './api';

export const userService = {
  // ── Current User (uses /me/ endpoint) ──────────────────────────────

  /** GET /users/users/me/ — full profile with nested user, org, role */
  getMyProfile: async () => {
    const response = await api.get('/users/users/me/');
    return response.data;
  },

  /** PATCH /users/users/me/ — update user fields + profile fields in one call */
  updateMyProfile: async (data) => {
    const response = await api.patch('/users/users/me/', data);
    return response.data;
  },

  /** GET /users/users/{id}/teams/ — teams the current user belongs to */
  getMyTeams: async (profileId) => {
    const response = await api.get(`/users/users/${profileId}/teams/`);
    return response.data;
  },

  // ── Current User Document Settings ─────────────────────────────────

  /** GET /users/users/me/document-settings/ */
  getMyDocSettings: async () => {
    const response = await api.get('/users/users/me/document-settings/');
    return response.data;
  },

  /** PATCH /users/users/me/document-settings/ */
  updateMyDocSettings: async (data) => {
    const response = await api.patch('/users/users/me/document-settings/', data);
    return response.data;
  },

  // ── Current Organization ───────────────────────────────────────────

  /** GET /users/organizations/current/ */
  getCurrentOrg: async () => {
    const response = await api.get('/users/organizations/current/');
    return response.data;
  },

  /** PATCH /users/organizations/current/ */
  updateCurrentOrg: async (data) => {
    const response = await api.patch('/users/organizations/current/', data);
    return response.data;
  },

  /** GET /users/organizations/{id}/stats/ */
  getOrgStats: async (orgId) => {
    const response = await api.get(`/users/organizations/${orgId}/stats/`);
    return response.data;
  },

  /** GET /users/organizations/{id}/users/ */
  getOrgMembers: async (orgId) => {
    const response = await api.get(`/users/organizations/${orgId}/users/`);
    return response.data;
  },

  // ── Organization Document Settings (admin only) ────────────────────

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

  // ── Roles ──────────────────────────────────────────────────────────

  /** GET /users/roles/ */
  getRoles: async () => {
    const response = await api.get('/users/roles/');
    return response.data;
  },

  // ── Password ───────────────────────────────────────────────────────

  /** POST /users/users/me/change-password/ */
  changePassword: async (data) => {
    const response = await api.post('/users/users/me/change-password/', data);
    return response.data;
  },

  // ── Legacy / by-ID helpers (kept for backwards compat) ─────────────

  getProfile: async (userId) => {
    const response = await api.get(`/users/users/${userId}/`);
    return response.data;
  },

  updateProfile: async (userId, userData) => {
    const response = await api.patch(`/users/users/${userId}/`, userData);
    return response.data;
  },

  getUserTeams: async (userId) => {
    const response = await api.get(`/users/users/${userId}/teams/`);
    return response.data;
  },

  getOrganization: async (orgId) => {
    const response = await api.get(`/users/organizations/${orgId}/`);
    return response.data;
  },

  getOrganizationStats: async (orgId) => {
    const response = await api.get(`/users/organizations/${orgId}/stats/`);
    return response.data;
  },

  updateOrganization: async (orgId, orgData) => {
    const response = await api.patch(`/users/organizations/${orgId}/`, orgData);
    return response.data;
  },

  // ── Domain & Feature Flags ─────────────────────────────────────────

  /** GET /users/organizations/domains/ — list available domain choices */
  getDomainChoices: async () => {
    const response = await api.get('/users/organizations/domains/');
    return response.data;
  },

  /** GET /users/organizations/feature-schema/ — full feature schema with labels/descriptions */
  getFeatureSchema: async () => {
    const response = await api.get('/users/organizations/feature-schema/');
    return response.data;
  },

  /** GET /users/organizations/current/domain-settings/ — current org's domain + overrides */
  getDomainSettings: async () => {
    const response = await api.get('/users/organizations/current/domain-settings/');
    return response.data;
  },

  /** PATCH /users/organizations/current/domain-settings/ — update domain and/or feature overrides */
  updateDomainSettings: async (data) => {
    const response = await api.patch('/users/organizations/current/domain-settings/', data);
    return response.data;
  },

  /** POST /users/organizations/current/reset-feature-overrides/ — reset all overrides to domain defaults */
  resetFeatureOverrides: async () => {
    const response = await api.post('/users/organizations/current/reset-feature-overrides/');
    return response.data;
  },

  /** GET /users/organizations/current/feature-flags/ — resolved feature flags for current org */
  getFeatureFlags: async () => {
    const response = await api.get('/users/organizations/current/feature-flags/');
    return response.data;
  },

  /** GET /users/organizations/current/domain-config/ — domain-specific config (templates, workflows, UI hints) */
  getDomainConfig: async () => {
    const response = await api.get('/users/organizations/current/domain-config/');
    return response.data;
  },
};

export default userService;
