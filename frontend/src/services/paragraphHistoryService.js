import api from './api';
import { API_ENDPOINTS } from '@constants/api';

/**
 * Paragraph History Service
 * 
 * Fetches the edit timeline for a paragraph and supports restoring
 * a paragraph to a previous state.
 */
const paragraphHistoryService = {
  /**
   * Get the edit history for a specific paragraph.
   * Returns entries sorted newest-first.
   *
   * @param {string} paragraphId - UUID of the paragraph
   * @returns {Promise<Array>} history entries
   */
  getHistory: async (paragraphId) => {
    const response = await api.get(API_ENDPOINTS.PARAGRAPH_HISTORY.BY_PARAGRAPH(paragraphId));
    return response.data?.results ?? response.data;
  },

  /**
   * Get a single history entry by its ID.
   *
   * @param {string} historyId - UUID of the history entry
   * @returns {Promise<Object>} history entry
   */
  getEntry: async (historyId) => {
    const response = await api.get(API_ENDPOINTS.PARAGRAPH_HISTORY.BY_ID(historyId));
    return response.data;
  },

  /**
   * Restore a paragraph to the state captured in a history entry.
   *
   * @param {string} historyId - UUID of the history entry to restore
   * @returns {Promise<{status: string, paragraph: Object}>}
   */
  restore: async (historyId) => {
    const response = await api.post(API_ENDPOINTS.PARAGRAPH_HISTORY.RESTORE(historyId));
    return response.data;
  },
};

export default paragraphHistoryService;
