import api from '../api';

/**
 * Sentence Service - Manages atomic text units
 * Sentences are the smallest units for AI analysis
 */
export const sentenceService = {
  // Get all sentences for a paragraph
  getSentences: async (paragraphId) => {
    const response = await api.get(`/documents/paragraphs/${paragraphId}/sentences/`);
    return response.data;
  },

  // Get single sentence
  getSentence: async (sentenceId) => {
    const response = await api.get(`/documents/sentences/${sentenceId}/`);
    return response.data;
  },

  // Create a new sentence
  createSentence: async (paragraphId, sentenceData) => {
    const response = await api.post(`/documents/paragraphs/${paragraphId}/sentences/`, {
      content_text: sentenceData.content_text,
      content_start: sentenceData.content_start,
      content_end: sentenceData.content_end,
      order: sentenceData.order,
    });
    return response.data;
  },

  // Update sentence
  updateSentence: async (sentenceId, sentenceData) => {
    const response = await api.patch(`/documents/sentences/${sentenceId}/`, sentenceData);
    return response.data;
  },

  // Delete sentence
  deleteSentence: async (sentenceId) => {
    const response = await api.delete(`/documents/sentences/${sentenceId}/`);
    return response.data;
  },
};

export default sentenceService;
