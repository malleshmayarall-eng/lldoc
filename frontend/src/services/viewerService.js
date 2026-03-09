/**
 * Viewer Service — API client for the external document viewer system.
 *
 * This service handles all interactions with the /api/viewer/ endpoints.
 * It supports three authentication modes:
 *
 * 1. PUBLIC   — Just the viewer token in the URL, no auth needed
 * 2. EMAIL_OTP — Send OTP → verify → get session token
 * 3. INVITE_ONLY — Accept invitation → get session token
 *
 * For authenticated viewer calls, the session token is stored in
 * localStorage and sent via Authorization header.
 */

import axios from 'axios';

// Viewer has its own axios instance — no Django session cookies needed
// Uses empty baseURL so requests go through Vite proxy in dev (/api → localhost:8000)
const viewerApi = axios.create({
  baseURL: '',
  headers: { 'Content-Type': 'application/json' },
});

// Attach viewer session token if present
viewerApi.interceptors.request.use((config) => {
  const sessionToken = localStorage.getItem('viewer_session_token');
  if (sessionToken) {
    config.headers.Authorization = `ViewerSession ${sessionToken}`;
  }
  return config;
});

// ─── Session management ────────────────────────────────────────────

/**
 * Store viewer session after OTP/password/invitation verification.
 */
export const setViewerSession = (sessionData) => {
  localStorage.setItem('viewer_session_token', sessionData.session_token);
  localStorage.setItem('viewer_session', JSON.stringify(sessionData));
};

export const getViewerSession = () => {
  const data = localStorage.getItem('viewer_session');
  return data ? JSON.parse(data) : null;
};

export const clearViewerSession = () => {
  localStorage.removeItem('viewer_session_token');
  localStorage.removeItem('viewer_session');
};

export const isViewerAuthenticated = () => {
  return !!localStorage.getItem('viewer_session_token');
};

// ─── Token Resolution ──────────────────────────────────────────────

/**
 * Resolve a viewer token to determine what auth flow to show.
 *
 * @param {string} token - The viewer token from the URL
 * @returns {Promise<{
 *   valid: boolean,
 *   access_mode: 'public'|'email_otp'|'invite_only',
 *   role: string,
 *   document_title: string,
 *   shared_by: string,
 *   requires_password: boolean,
 *   requires_otp: boolean,
 *   requires_invitation_accept: boolean,
 *   allowed_actions: string[],
 *   settings: object,
 *   existing_user: boolean,
 * }>}
 */
export const resolveViewerToken = async (token) => {
  const { data } = await viewerApi.get(`/api/viewer/resolve/${token}/`);
  return data;
};

// ─── Public PDF Access ─────────────────────────────────────────────

/**
 * Get the URL for public PDF viewing (embed in iframe).
 */
export const getPublicPdfUrl = (token, download = false) => {
  return `/api/viewer/public/pdf/${token}/${download ? '?download=1' : ''}`;
};

/**
 * Get the URL for legacy Share model PDF viewing.
 */
export const getLegacyPdfUrl = (token, download = false) => {
  return `/api/viewer/legacy/pdf/${token}/${download ? '?download=1' : ''}`;
};

/**
 * Get the URL for authenticated PDF viewing.
 */
export const getAuthenticatedPdfUrl = (download = false) => {
  const session = localStorage.getItem('viewer_session_token');
  return `/api/viewer/document/pdf/?session=${session}${download ? '&download=1' : ''}`;
};

// ─── OTP Flow ──────────────────────────────────────────────────────

/**
 * Request OTP for email verification.
 *
 * @param {string} viewerToken - The viewer token
 * @param {string} email - Email to send OTP to
 */
export const sendOTP = async (viewerToken, email) => {
  const { data } = await viewerApi.post('/api/viewer/otp/send/', {
    viewer_token: viewerToken,
    email,
  });
  return data;
};

/**
 * Verify OTP and get a viewer session.
 *
 * @param {string} viewerToken - The viewer token
 * @param {string} email - Email used for OTP
 * @param {string} otp - 6-digit OTP code
 * @returns {Promise<{ message: string, session: object }>}
 */
export const verifyOTP = async (viewerToken, email, otp) => {
  const { data } = await viewerApi.post('/api/viewer/otp/verify/', {
    viewer_token: viewerToken,
    email,
    otp,
  });
  if (data.session) {
    setViewerSession(data.session);
  }
  return data;
};

// ─── Password Flow ─────────────────────────────────────────────────

/**
 * Verify password for password-protected tokens.
 *
 * @param {string} viewerToken - The viewer token
 * @param {string} password - Password
 */
export const verifyPassword = async (viewerToken, password) => {
  const { data } = await viewerApi.post('/api/viewer/password/verify/', {
    viewer_token: viewerToken,
    password,
  });
  if (data.session) {
    setViewerSession(data.session);
  }
  return data;
};

// ─── Invitation Flow ───────────────────────────────────────────────

/**
 * Accept an invitation.
 *
 * @param {string} viewerToken - The viewer token
 * @param {string} email - Recipient email
 */
export const acceptInvitation = async (viewerToken, email) => {
  const { data } = await viewerApi.post('/api/viewer/invitation/accept/', {
    viewer_token: viewerToken,
    email,
  });
  if (data.session) {
    setViewerSession(data.session);
  }
  return data;
};

// ─── Authenticated Viewer Endpoints ────────────────────────────────

/**
 * Get document info for the current viewer session.
 */
export const getViewerDocumentInfo = async () => {
  const { data } = await viewerApi.get('/api/viewer/document/');
  return data;
};

/**
 * List all documents shared with the viewer's email.
 */
export const getSharedDocuments = async () => {
  const { data } = await viewerApi.get('/api/viewer/shared-documents/');
  return data;
};

// ─── AI Chat ───────────────────────────────────────────────────────

/**
 * Send an AI chat message as a viewer.
 *
 * @param {object} params
 * @param {string} [params.viewerToken] - For public tokens
 * @param {string} [params.sessionToken] - For authenticated viewers (auto-filled)
 * @param {string} params.message - User message
 * @param {string} [params.scope='document'] - Scope
 * @param {string} [params.scopeId] - Scope ID
 * @param {Array} [params.conversationHistory=[]] - Chat history
 */
export const sendViewerAIChat = async ({
  viewerToken,
  sessionToken,
  message,
  scope = 'document',
  scopeId = null,
  conversationHistory = [],
}) => {
  const payload = {
    message,
    scope,
    scope_id: scopeId,
    conversation_history: conversationHistory,
  };

  if (viewerToken) {
    payload.viewer_token = viewerToken;
  }
  if (sessionToken || localStorage.getItem('viewer_session_token')) {
    payload.session_token = sessionToken || localStorage.getItem('viewer_session_token');
  }

  const { data } = await viewerApi.post('/api/viewer/ai-chat/', payload);
  return data;
};

// ─── Document Structure (for commentators) ─────────────────────────

/**
 * Get document structure tree for commentators.
 * Returns sections → paragraphs → tables → images with comment counts.
 *
 * @param {string} token - The viewer/share token
 */
export const getDocumentStructure = async (token) => {
  const { data } = await viewerApi.get(`/api/viewer/structure/${token}/`);
  return data;
};

// ─── Comments ──────────────────────────────────────────────────────

/**
 * List comments for a document.
 *
 * @param {string} token - The viewer/share token
 * @param {object} [params] - Query params: target_type, target_id, resolved, sort, page, page_size
 */
export const getComments = async (token, params = {}) => {
  const { data } = await viewerApi.get(`/api/viewer/comments/${token}/`, { params });
  return data;
};

/**
 * Create a new comment.
 *
 * @param {object} payload - { viewer_token, target_type, target_id, text, parent_id?, metadata? }
 */
export const createComment = async (payload) => {
  const { data } = await viewerApi.post('/api/viewer/comments/', payload);
  return data;
};

/**
 * Delete a comment (only by the original author).
 *
 * @param {string} commentId - UUID of the comment
 */
export const deleteComment = async (commentId) => {
  const { data } = await viewerApi.delete(`/api/viewer/comments/${commentId}/delete/`);
  return data;
};

/**
 * Resolve/unresolve a comment.
 *
 * @param {string} commentId - UUID of the comment
 * @param {boolean} resolved - true to resolve, false to unresolve
 */
export const resolveComment = async (commentId, resolved = true) => {
  const { data } = await viewerApi.patch(`/api/viewer/comments/${commentId}/resolve/`, { resolved });
  return data;
};

// ─── Document Approval ─────────────────────────────────────────────

/**
 * Submit an approval/rejection decision for a document.
 *
 * @param {object} payload - { viewer_token, status: 'approved'|'rejected'|'changes_requested', comment? }
 */
export const approveDocument = async (payload) => {
  const { data } = await viewerApi.post('/api/viewer/approve/', payload);
  return data;
};

/**
 * List all approval decisions for a document.
 *
 * @param {string} token - The viewer/share token
 */
export const getDocumentApprovals = async (token) => {
  const { data } = await viewerApi.get(`/api/viewer/approvals/${token}/`);
  return data;
};

// ─── Token Management (for document owners) ────────────────────────
// These use the main Django session auth (api with cookies)

import api from './api';

/**
 * Create a new viewer token for a document.
 */
export const createViewerToken = async (payload) => {
  const { data } = await api.post('/viewer/tokens/', payload);
  return data;
};

/**
 * List all viewer tokens created by the current user.
 */
export const listViewerTokens = async () => {
  const { data } = await api.get('/viewer/tokens/');
  return data;
};

/**
 * Get viewer tokens for a specific document.
 */
export const getViewerTokensByDocument = async (documentId) => {
  const { data } = await api.get(`/viewer/tokens/by-document/${documentId}/`);
  return data;
};

/**
 * Get details for a specific viewer token.
 */
export const getViewerToken = async (tokenId) => {
  const { data } = await api.get(`/viewer/tokens/${tokenId}/`);
  return data;
};

/**
 * Update a viewer token.
 */
export const updateViewerToken = async (tokenId, payload) => {
  const { data } = await api.patch(`/viewer/tokens/${tokenId}/`, payload);
  return data;
};

/**
 * Revoke (delete) a viewer token.
 */
export const revokeViewerToken = async (tokenId) => {
  await api.delete(`/viewer/tokens/${tokenId}/`);
};

/**
 * Get analytics for a viewer token.
 */
export const getViewerTokenAnalytics = async (tokenId) => {
  const { data } = await api.get(`/viewer/tokens/${tokenId}/analytics/`);
  return data;
};

/**
 * Resend invitation email for a viewer token.
 */
export const resendViewerInvitation = async (tokenId) => {
  const { data } = await api.post(`/viewer/tokens/${tokenId}/resend-invitation/`);
  return data;
};

// ═══════════════════════════════════════════════════════════════════════
// ALERTS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get alerts for the current viewer session on a document.
 * @param {string} token - Viewer token string
 * @returns {{ alerts: Array, unread_count: number }}
 */
export const getAlerts = async (token) => {
  const { data } = await viewerApi.get(`/api/viewer/alerts/${token}/`);
  return data;
};

/**
 * Mark a single alert as read.
 * @param {string} alertId - UUID of the alert
 */
export const markAlertRead = async (alertId) => {
  const { data } = await viewerApi.patch(`/api/viewer/alerts/${alertId}/read/`);
  return data;
};

/**
 * Mark all alerts for a document as read.
 * @param {string} token - Viewer token string
 */
export const markAllAlertsRead = async (token) => {
  const { data } = await viewerApi.patch(`/api/viewer/alerts/${token}/read-all/`);
  return data;
};


// ─── Editor Alerts (document owner — Django session auth) ───────────

/**
 * Get alerts for the logged-in editor/owner.
 * @param {Object} params - Optional filters: is_read, document_id, page, page_size
 * @returns {{ alerts: Array, unread_count: number, total: number }}
 */
export const getEditorAlerts = async (params = {}) => {
  const { data } = await api.get('/viewer/editor-alerts/', { params });
  return data;
};

/**
 * Mark a single editor alert as read.
 * @param {string} alertId - UUID of the alert
 */
export const markEditorAlertRead = async (alertId) => {
  const { data } = await api.patch(`/viewer/editor-alerts/${alertId}/read/`);
  return data;
};

/**
 * Mark all editor alerts as read.
 */
export const markAllEditorAlertsRead = async () => {
  const { data } = await api.patch('/viewer/editor-alerts/read-all/');
  return data;
};


// ─── Share for Approval (document owner — Django session auth) ──────

/**
 * Share a document with emails for approval/commenting.
 * @param {Object} payload - { document_id, emails, role, access_mode, message }
 */
export const shareForApproval = async (payload) => {
  const { data } = await api.post('/viewer/share-for-approval/', payload);
  return data;
};


// ─── Activity Feed (document owner — Django session auth) ───────────

/**
 * Get unified activity feed for a document (comments, approvals, alerts, decisions).
 * @param {string} documentId - UUID of the document
 * @param {Object} params - Optional: { page, page_size }
 * @returns {{ document_id, total, page, page_size, feed: Array }}
 */
export const getDocumentActivityFeed = async (documentId, params = {}) => {
  const { data } = await api.get(`/viewer/activity-feed/${documentId}/`, { params });
  return data;
};

export default {
  // Session
  setViewerSession,
  getViewerSession,
  clearViewerSession,
  isViewerAuthenticated,
  // Token resolution
  resolveViewerToken,
  // Public
  getPublicPdfUrl,
  getLegacyPdfUrl,
  getAuthenticatedPdfUrl,
  // OTP
  sendOTP,
  verifyOTP,
  // Password
  verifyPassword,
  // Invitation
  acceptInvitation,
  // Viewer endpoints
  getViewerDocumentInfo,
  getSharedDocuments,
  // AI Chat
  sendViewerAIChat,
  // Document structure & comments
  getDocumentStructure,
  getComments,
  createComment,
  deleteComment,
  resolveComment,
  // Token management (owner)
  createViewerToken,
  listViewerTokens,
  getViewerTokensByDocument,
  getViewerToken,
  updateViewerToken,
  revokeViewerToken,
  getViewerTokenAnalytics,
  resendViewerInvitation,
  // Alerts (viewer-side)
  getAlerts,
  markAlertRead,
  markAllAlertsRead,
  // Editor alerts (owner-side)
  getEditorAlerts,
  markEditorAlertRead,
  markAllEditorAlertsRead,
  // Share for approval
  shareForApproval,
  // Activity feed
  getDocumentActivityFeed,
};
