/**
 * notificationService.js
 * ──────────────────────
 * Wraps the centralized communications/alerts API (/api/alerts/).
 *
 * These are system-wide notifications (document shares, workflow
 * assignments, system messages, etc.) stored in the communications
 * Alert model — separate from the older WorkflowNotification and
 * ViewerAlert models.
 */
import api from './api';
import { API_ENDPOINTS } from '../constants/api';

const notificationService = {
  /**
   * Fetch all alerts (paginated, filterable).
   * @param {Object} params – { category, priority, is_read, target_type, target_id }
   */
  getAlerts: async (params = {}) => {
    const response = await api.get(API_ENDPOINTS.ALERTS.BASE, { params });
    return response.data;
  },

  /**
   * Fetch a single alert by ID.
   */
  getAlert: async (id) => {
    const response = await api.get(API_ENDPOINTS.ALERTS.BY_ID(id));
    return response.data;
  },

  /**
   * Mark a single alert as read.
   */
  markRead: async (id) => {
    const response = await api.patch(API_ENDPOINTS.ALERTS.MARK_READ(id));
    return response.data;
  },

  /**
   * Mark all (or a list of) alerts as read.
   * @param {string[]} [alertIds] – optional list; omit to mark ALL read.
   */
  markAllRead: async (alertIds = []) => {
    const response = await api.patch(API_ENDPOINTS.ALERTS.MARK_ALL_READ, {
      alert_ids: alertIds,
    });
    return response.data;
  },

  /**
   * Get the unread badge count.
   * @returns {{ unread_count: number }}
   */
  getUnreadCount: async () => {
    const response = await api.get(API_ENDPOINTS.ALERTS.UNREAD_COUNT);
    return response.data;
  },

  /**
   * Delete all read alerts (housekeeping).
   */
  clearRead: async () => {
    const response = await api.delete(API_ENDPOINTS.ALERTS.CLEAR_READ);
    return response.data;
  },

  /**
   * List user's notification preferences.
   */
  getPreferences: async () => {
    const response = await api.get(API_ENDPOINTS.ALERTS.PREFERENCES);
    return response.data;
  },

  /**
   * Create or update a preference (upsert by category + channel).
   */
  setPreference: async ({ category, channel, enabled }) => {
    const response = await api.post(API_ENDPOINTS.ALERTS.PREFERENCES, {
      category,
      channel,
      enabled,
    });
    return response.data;
  },

  /**
   * List available alert categories.
   */
  getCategories: async () => {
    const response = await api.get(API_ENDPOINTS.ALERTS.CATEGORIES);
    return response.data;
  },
};

export default notificationService;
