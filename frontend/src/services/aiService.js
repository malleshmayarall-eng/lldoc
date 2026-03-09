import api from './api';

const aiService = {
  ingestText: async ({ text }) => {
    const response = await api.post('/ai/ingest-text/', { text });
    return response.data;
  },
  analyzeText: async ({ text }) => {
    const response = await api.post('/ai/analyze-text/', { text });
    return response.data;
  },
  generateFromPrompt: async ({ prompt, document_type }) => {
    const response = await api.post('/ai/generate-from-prompt/', { prompt, document_type });
    return response.data;
  },
  getDocumentQuestions: async ({ document_type, template_name, context }) => {
    const response = await api.post('/ai/document-questions/', { document_type, template_name, context });
    return response.data;
  },
  scoreDocument: async (documentId, { raw = false } = {}) => {
    if (!documentId) throw new Error('documentId is required');
    const response = await api.post(`/ai/score-document/${documentId}/`, null, {
      params: raw ? { raw: true } : undefined,
    });
    return response.data;
  },
  getDocumentScore: async (documentId, { raw = false } = {}) => {
    if (!documentId) throw new Error('documentId is required');
    const response = await api.get(`/ai/score-document/${documentId}/`, {
      params: raw ? { raw: true } : undefined,
    });
    return response.data;
  },

  /**
   * AI Chat — scoped to document / section / paragraph / table.
   * @param {{ document_id: string, scope: string, scope_id?: string, message: string, conversation_history?: Array }} params
   */
  chat: async ({ document_id, scope, scope_id, message, conversation_history }) => {
    const response = await api.post('/ai/chat/', {
      document_id,
      scope,
      scope_id: scope_id || null,
      message,
      conversation_history: conversation_history || [],
    });
    return response.data;
  },

  /**
   * AI Chat Edit — asks AI to rewrite content and apply it to the document.
   * Works for section, paragraph, and table scopes.
   * @param {{ document_id: string, scope: string, scope_id: string, instruction: string, conversation_history?: Array, preview?: boolean }} params
   */
  chatApplyEdit: async ({ document_id, scope, scope_id, instruction, conversation_history, preview }) => {
    const response = await api.post('/ai/chat-edit/', {
      document_id,
      scope,
      scope_id,
      instruction,
      conversation_history: conversation_history || [],
      preview: !!preview,
    });
    return response.data;
  },
};

export default aiService;
