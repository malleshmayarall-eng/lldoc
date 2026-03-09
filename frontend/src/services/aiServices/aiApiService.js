import api from '../api';
import aiService from '../aiService';
import paragraphAiService from '../paragraphs/paragraphAiService';
import { buildQueryParams } from './utils';

const aiApiService = {
  // Core AI endpoints (backwards-compatible)
  ingestText: aiService.ingestText,
  scoreDocument: aiService.scoreDocument,
  getDocumentScore: aiService.getDocumentScore,

  // Paragraph AI endpoints
  paragraph: paragraphAiService,

  // Generic AI endpoint helpers for additional API routes
  get: async (path, params = {}) => {
    if (!path) throw new Error('path is required');
    const response = await api.get(path, { params: buildQueryParams(params) });
    return response.data;
  },

  post: async (path, payload, params = {}) => {
    if (!path) throw new Error('path is required');
    const response = await api.post(path, payload ?? null, {
      params: buildQueryParams(params),
    });
    return response.data;
  },
};

export default aiApiService;
