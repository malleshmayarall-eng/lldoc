/**
 * Sharing Service
 * 
 * Provides API methods for the generic sharing system.
 * Supports sharing ANY content type (documents, files, folders, etc.)
 * with users, teams, or external invitations.
 */

import api from './api';
import { API_ENDPOINTS } from '../constants/api';

const normalizeList = (data) => {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.results)) return data.results;
  return [];
};

const normalizeId = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed && !Number.isNaN(Number(trimmed))) return Number(trimmed);
    return value;
  }
  if (typeof value === 'object') {
    const candidate = value.team_id ?? value.teamId ?? value.pk ?? value.id ?? null;
    return normalizeId(candidate);
  }
  return value;
};

const sharingService = {
  // Cache for content type IDs to avoid repeated API calls
  _contentTypeCache: {},

  /**
   * Get content type ID from model name
   * @param {string} modelName - Model name (e.g., 'document', 'file')
   * @returns {Promise<number>} Content type ID
   */
  async getContentTypeId(modelName) {
    // Normalize lookup key
    const key = String(modelName || '').toLowerCase();

    // Return cached value if available
    if (this._contentTypeCache[key]) {
      return this._contentTypeCache[key];
    }

    try {
      const fileShareFirst = ['file', 'fileshare', 'filesharefile', 'folder', 'filesharefolder'].includes(key);
      const endpointsToTry = fileShareFirst
        ? [API_ENDPOINTS.FILESHARE.FILES.CONTENT_TYPES, API_ENDPOINTS.SHARING.CONTENT_TYPES]
        : [API_ENDPOINTS.SHARING.CONTENT_TYPES, API_ENDPOINTS.FILESHARE.FILES.CONTENT_TYPES];

      for (const endpoint of endpointsToTry) {
  const response = await api.get(endpoint);
  const contentTypes = normalizeList(response.data);

        // Cache all content types for future use and create fuzzy keys
  contentTypes.forEach((ct) => {
          const model = ct.model ? String(ct.model).toLowerCase() : '';
          const name = ct.name ? String(ct.name).toLowerCase() : '';
          const appLabel = ct.app_label ? String(ct.app_label).toLowerCase() : '';

          // primary keys
          if (model) this._contentTypeCache[model] = ct.id;
          if (name) this._contentTypeCache[name] = ct.id;
          if (appLabel && model) this._contentTypeCache[`${appLabel}.${model}`] = ct.id;

          // fuzzy fallbacks for common short names
          if (model.includes('file')) this._contentTypeCache.file = ct.id;
          if (model.includes('folder') || model.includes('drivefolder')) this._contentTypeCache.folder = ct.id;
          if (name.includes('file')) this._contentTypeCache.file = ct.id;
          if (name.includes('folder')) this._contentTypeCache.folder = ct.id;
        });

        // Return if we were able to resolve the requested key
        if (this._contentTypeCache[key]) {
          return this._contentTypeCache[key];
        }
      }

      throw new Error(`Content type '${modelName}' not found`);
    } catch (error) {
      console.error('Error fetching content type ID:', error);
      throw error;
    }
  },

  /**
   * Create a new share
   * @param {Object} shareData - Share configuration
   * @param {string} shareData.content_type - Content type (e.g., 'document', 'file')
   * @param {string} shareData.object_id - ID of the content being shared
   * @param {string} shareData.share_type - 'user', 'team', 'email', 'phone', or 'link'
   * @param {string} shareData.role - 'viewer', 'commenter', or 'editor'
   * @param {number} [shareData.shared_with_user] - User ID (for share_type='user')
   * @param {number} [shareData.shared_with_team] - Team ID (for share_type='team')
   * @param {string} [shareData.invitation_email] - Email (for share_type='email')
   * @param {string} [shareData.invitation_phone] - Phone (for share_type='phone')
   * @param {boolean} [shareData.public_link] - True to create public link share
   * @param {string} [shareData.invitation_message] - Custom message
   * @param {string} [shareData.expires_at] - ISO date string for expiration
   * @param {Object} [shareData.metadata] - Additional metadata
   * @returns {Promise<Object>} Created share object
   */
  async createShare(shareData) {
    try {
      // Get content type ID from model name
      const contentTypeId = await this.getContentTypeId(shareData.content_type);
      
      // Transform data to match backend expectations
      const payload = {
        content_type_id: contentTypeId,
        object_id: shareData.object_id,
        role: shareData.role,
        share_type: shareData.share_type,
        invitation_message: shareData.invitation_message,
        expires_at: shareData.expires_at,
        metadata: shareData.metadata
      };

      // Public link share
      if (shareData.public_link || shareData.share_type === 'link') {
        payload.public_link = true;
        payload.share_type = 'link';
      }
      // Add recipient-specific fields based on share_type
      else if (shareData.share_type === 'user' && shareData.shared_with_user) {
        payload.shared_with_user_id = shareData.shared_with_user;
      } else if (shareData.share_type === 'team' && shareData.shared_with_team) {
        payload.shared_with_team_id = normalizeId(shareData.shared_with_team);
      } else if (shareData.share_type === 'email' && shareData.invitation_email) {
        payload.invitation_email = shareData.invitation_email;
      } else if (shareData.share_type === 'phone' && shareData.invitation_phone) {
        payload.invitation_phone = shareData.invitation_phone;
      }

      const response = await api.post('/sharing/shares/', payload);
      return response.data;
    } catch (error) {
      console.error('Error creating share:', error);
      throw error;
    }
  },

  /**
   * Create a public link share (anyone with the link can access)
   * @param {Object} linkData - Public link configuration
   * @param {string} linkData.content_type - Content type (e.g., 'document')
   * @param {string} linkData.object_id - ID of the content being shared
   * @param {string} [linkData.role='viewer'] - Access role: 'viewer', 'commenter', or 'editor'
   * @param {string} [linkData.expires_at] - ISO date string for expiration
   * @param {Object} [linkData.metadata] - Additional metadata
   * @returns {Promise<Object>} Created share with invitation_token and invitation_link
   */
  async createPublicLink(linkData) {
    try {
      const contentTypeId = await this.getContentTypeId(linkData.content_type);
      
      const payload = {
        content_type_id: contentTypeId,
        object_id: linkData.object_id,
        public_link: true,
        role: linkData.role || 'viewer',
        expires_at: linkData.expires_at,
        metadata: linkData.metadata
      };

      const response = await api.post('/sharing/shares/', payload);
      return response.data;
    } catch (error) {
      console.error('Error creating public link:', error);
      throw error;
    }
  },

  /**
   * Get all shares (for current user or filtered)
   * @param {Object} params - Query parameters
   * @param {string} [params.content_type] - Filter by content type
   * @param {string} [params.object_id] - Filter by object ID
   * @param {string} [params.role] - Filter by role
   * @param {string} [params.share_type] - Filter by share type
   * @param {boolean} [params.is_active] - Filter by active status
   * @returns {Promise<Array>} List of shares
   */
  async getShares(params = {}) {
    try {
      const response = await api.get('/sharing/shares/', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching shares:', error);
      throw error;
    }
  },

  /**
   * Get a specific share by ID
   * @param {string} shareId - Share UUID
   * @returns {Promise<Object>} Share object
   */
  async getShare(shareId) {
    try {
      const response = await api.get(`/sharing/shares/${shareId}/`);
      return response.data;
    } catch (error) {
      console.error('Error fetching share:', error);
      throw error;
    }
  },

  /**
   * Get all shares for a specific content item
   * @param {string} contentType - Content type (e.g., 'document')
   * @param {string} objectId - Object ID
   * @returns {Promise<Array>} List of shares for the content
   */
  async getSharesForContent(contentType, objectId) {
    try {
      const response = await api.get(`/sharing/shares/content/${contentType}/${objectId}/`);
      return response.data;
    } catch (error) {
      console.error('Error fetching shares for content:', error);
      throw error;
    }
  },

  /**
   * Update a share
   * @param {string} shareId - Share UUID
   * @param {Object} updates - Fields to update
   * @param {string} [updates.role] - New role
   * @param {string} [updates.expires_at] - New expiration date
   * @param {boolean} [updates.is_active] - Active status
   * @param {Object} [updates.metadata] - Updated metadata
   * @returns {Promise<Object>} Updated share object
   */
  async updateShare(shareId, updates) {
    try {
      const response = await api.patch(`/sharing/shares/${shareId}/`, updates);
      return response.data;
    } catch (error) {
      console.error('Error updating share:', error);
      throw error;
    }
  },

  /**
   * Revoke a share (soft delete - sets is_active=false)
   * @param {string} shareId - Share UUID
   * @returns {Promise<void>}
   */
  async revokeShare(shareId) {
    try {
      await api.delete(`/sharing/shares/${shareId}/`);
    } catch (error) {
      console.error('Error revoking share:', error);
      throw error;
    }
  },

  /**
   * Resend invitation email/SMS for external share
   * @param {string} shareId - Share UUID
   * @returns {Promise<Object>} Response with status
   */
  async resendInvitation(shareId) {
    try {
      const response = await api.post(`/sharing/shares/${shareId}/resend/`);
      return response.data;
    } catch (error) {
      console.error('Error resending invitation:', error);
      throw error;
    }
  },

  /**
   * Accept an external invitation using token
   * @param {string} token - Invitation token
   * @returns {Promise<Object>} Share object and content details
   */
  async acceptInvitation(token) {
    try {
      const response = await api.post('/sharing/shares/accept_invitation/', { token });
      return response.data;
    } catch (error) {
      console.error('Error accepting invitation:', error);
      throw error;
    }
  },

  /**
   * Check if current user has permission to access content
   * @param {string} contentType - Content type
   * @param {string} objectId - Object ID
   * @param {string} [token] - Optional token for external access
   * @returns {Promise<Object>} Permission details and share info
   */
  async checkAccess(contentType, objectId, token = null) {
    try {
      const params = token ? { token } : {};
      const response = await api.get(
        `/sharing/shares/check-access/${contentType}/${objectId}/`,
        { params }
      );
      return response.data;
    } catch (error) {
      console.error('Error checking access:', error);
      throw error;
    }
  },

  /**
   * Get analytics data for shares
   * @param {Object} params - Query parameters
   * @param {number} [params.days] - Number of days to include (default: 30)
   * @param {string} [params.content_type] - Filter by content type
   * @returns {Promise<Object>} Analytics data
   */
  async getAnalytics(params = {}) {
    try {
      const response = await api.get('/sharing/shares/analytics/', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching analytics:', error);
      throw error;
    }
  },

  /**
   * Get access logs for content
   * @param {string} contentType - Content type
   * @param {string} objectId - Object ID
   * @param {Object} params - Query parameters
   * @param {string} [params.access_type] - Filter by access type
   * @param {number} [params.days] - Number of days (default: 30)
   * @returns {Promise<Array>} List of access logs
   */
  async getAccessLogs(contentType, objectId, params = {}) {
    try {
      const response = await api.get(
        `/sharing/shares/access-logs/${contentType}/${objectId}/`,
        { params }
      );
      return response.data;
    } catch (error) {
      console.error('Error fetching access logs:', error);
      throw error;
    }
  },

  /**
   * Search users for sharing (fuzzy search)
   * @param {string} query - Search query
   * @returns {Promise<Array>} List of matching users
   */
  async searchUsers(query) {
    try {
      const response = await api.get('/sharing/users/search/', {
        params: { q: query }
      });
      return normalizeList(response.data);
    } catch (error) {
      console.error('Error searching users:', error);
      throw error;
    }
  },

  /**
   * Search organization users for sharing (recommended for user dropdown)
   * @param {string} query - Search query
   * @param {number} [limit=50] - Max results
   * @returns {Promise<Array>} List of matching users
   */
  async searchOrganizationUsers(query, limit = 50) {
    try {
      const response = await api.get('/sharing/shares/organization-users/', {
        params: { q: query, limit }
      });
      return normalizeList(response.data);
    } catch (error) {
      console.error('Error searching organization users:', error);
      throw error;
    }
  },

  /**
   * Search teams for sharing (fuzzy search)
   * @param {string} query - Search query
   * @returns {Promise<Array>} List of matching teams
   */
  async searchTeams(query) {
    try {
      const response = await api.get('/sharing/teams/search/', {
        params: { q: query }
      });
      return normalizeList(response.data);
    } catch (error) {
      console.error('Error searching teams:', error);
      throw error;
    }
  },

  /**
   * Get list of available teams for current user
   * @returns {Promise<Array>} List of teams
   */
  async getAvailableTeams() {
    try {
      const response = await api.get(API_ENDPOINTS.TEAMS.BASE);
      return normalizeList(response.data);
    } catch (error) {
      console.error('Error fetching teams:', error);
      throw error;
    }
  },

  /**
   * Log content access
   * @param {Object} logData - Access log data
   * @param {string} logData.content_type - Content type
   * @param {string} logData.object_id - Object ID
   * @param {string} logData.access_type - Access type (view, edit, etc.)
   * @param {string} [logData.share_id] - Related share ID
   * @param {Object} [logData.metadata] - Additional metadata
   * @returns {Promise<Object>} Created log entry
   */
  async logAccess(logData) {
    try {
      const response = await api.post('/sharing/shares/log-access/', logData);
      return response.data;
    } catch (error) {
      console.error('Error logging access:', error);
      // Don't throw - logging failures shouldn't break functionality
      return null;
    }
  },

  /**
   * Bulk create shares (multiple users/teams at once)
   * @param {Object} bulkData - Bulk share configuration
   * @param {string} bulkData.content_type - Content type
   * @param {string} bulkData.object_id - Object ID
   * @param {Array<Object>} bulkData.shares - Array of share configurations
   * @returns {Promise<Object>} Results with created shares and errors
   */
  async bulkCreateShares(bulkData) {
    try {
      // Get content type ID from model name
      const contentTypeId = await this.getContentTypeId(bulkData.content_type);
      
      // Transform data to use content_type_id
      const payload = {
        content_type_id: contentTypeId,
        object_id: bulkData.object_id,
        shares: bulkData.shares
      };

      const response = await api.post('/sharing/shares/bulk-create/', payload);
      return response.data;
    } catch (error) {
      console.error('Error bulk creating shares:', error);
      throw error;
    }
  },

  /**
   * Get share link for external access
   * @param {string} shareId - Share UUID
   * @param {string} token - Share token
   * @returns {string} Full share URL with token
   */
  getShareLink(shareId, token) {
    const baseUrl = window.location.origin;
    return `${baseUrl}/shared/${token}`;
  },

  /**
   * Copy share link to clipboard
   * @param {string} shareId - Share UUID
   * @param {string} token - Share token
   * @returns {Promise<boolean>} Success status
   */
  async copyShareLink(shareId, token) {
    try {
      const link = this.getShareLink(shareId, token);
      await navigator.clipboard.writeText(link);
      return true;
    } catch (error) {
      console.error('Error copying share link:', error);
      return false;
    }
  },

  /**
   * Access a document using a public share token
   * @param {string} documentId - Document UUID
   * @param {string} token - Share token
   * @returns {Promise<Object>} Document data with access permissions
   */
  async accessDocumentWithToken(documentId, token) {
    try {
      // Option 1: Query parameter (GET request)
      const response = await api.get(`/documents/${documentId}/?token=${token}`);
      return response.data;
    } catch (error) {
      console.error('Error accessing document with token:', error);
      throw error;
    }
  },

  /**
   * Access a document using a public share token (POST method)
   * @param {string} documentId - Document UUID
   * @param {string} token - Share token
   * @returns {Promise<Object>} Document data with access permissions
   */
  async accessDocumentWithTokenPost(documentId, token) {
    try {
      // Option 2: POST with token in body
      const response = await api.post(`/documents/${documentId}/`, { token });
      return response.data;
    } catch (error) {
      console.error('Error accessing document with token (POST):', error);
      throw error;
    }
  },

  /**
   * Validate a share token without accessing the content
   * @param {string} token - Share token to validate
   * @returns {Promise<Object>} Token validation result with share details
   */
  async validateShareToken(token) {
    try {
      const response = await api.get(`/sharing/shares/validate-token/${token}/`);
      return response.data;
    } catch (error) {
      console.error('Error validating share token:', error);
      throw error;
    }
  },

  /**
   * Get all public links for a specific content item
   * @param {string} contentType - Content type (e.g., 'document')
   * @param {string} objectId - Object ID
   * @returns {Promise<Array>} List of public link shares
   */
  async getPublicLinks(contentType, objectId) {
    try {
      const shares = await this.getSharesForContent(contentType, objectId);
      // Filter for link-type shares only
      return shares.filter(share => share.share_type === 'link');
    } catch (error) {
      console.error('Error fetching public links:', error);
      throw error;
    }
  },

  /**
   * Revoke a public link (disable it)
   * @param {string} shareId - Share UUID
   * @returns {Promise<Object>} Updated share object
   */
  async revokePublicLink(shareId) {
    try {
      return await this.revokeShare(shareId);
    } catch (error) {
      console.error('Error revoking public link:', error);
      throw error;
    }
  },

  /**
   * Update public link settings (role, expiration, etc.)
   * @param {string} shareId - Share UUID
   * @param {Object} updates - Fields to update
   * @param {string} [updates.role] - New role
   * @param {string} [updates.expires_at] - New expiration date
   * @returns {Promise<Object>} Updated share object
   */
  async updatePublicLink(shareId, updates) {
    try {
      return await this.updateShare(shareId, updates);
    } catch (error) {
      console.error('Error updating public link:', error);
      throw error;
    }
  }
};

export default sharingService;
