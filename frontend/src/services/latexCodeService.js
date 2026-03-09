import api from './api';
import API_ENDPOINTS from '../constants/api';

const API_BASE = '/documents';

/**
 * LaTeX Code Service
 * Handles LaTeX code block CRUD operations within document sections.
 */
const latexCodeService = {
  /**
   * Create a LaTeX code block directly via POST (returns real UUID immediately).
   * Use this for the create-first approach: POST → get ID → add to local state.
   * @param {string} sectionId - Real section UUID
   * @param {Object} data - LaTeX code data
   * @returns {Promise<Object>} Created latex code with server-assigned UUID
   */
  async createLatexCode(sectionId, data = {}) {
    const response = await api.post(`${API_BASE}/latex-codes/`, {
      section_id: sectionId,
      latex_code: data.latex_code ?? '',
      edited_code: data.edited_code ?? '',
      has_edits: data.has_edits ?? false,
      topic: data.topic ?? '',
      custom_metadata: data.custom_metadata ?? {},
      order: data.order ?? 0,
    });
    return response.data;
  },

  /**
   * Get all LaTeX code blocks for a section
   * @param {string} sectionId - Section UUID
   * @returns {Promise<Array>}
   */
  async getLatexCodesInSection(sectionId) {
    const response = await api.get(`${API_BASE}/latex-codes/`, {
      params: { section: sectionId },
    });
    return response.data;
  },

  /**
   * Get a single LaTeX code block by ID
   * @param {string} latexCodeId - LaTeX code UUID
   * @returns {Promise<Object>}
   */
  async getLatexCode(latexCodeId) {
    const response = await api.get(`${API_BASE}/latex-codes/${latexCodeId}/`);
    return response.data;
  },

  /**
   * Update a LaTeX code block
   * @param {string} latexCodeId - LaTeX code UUID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>}
   */
  async updateLatexCode(latexCodeId, updates) {
    const response = await api.patch(`${API_BASE}/latex-codes/${latexCodeId}/`, updates);
    return response.data;
  },

  /**
   * Delete a LaTeX code block
   * @param {string} latexCodeId - LaTeX code UUID
   * @returns {Promise<void>}
   */
  async deleteLatexCode(latexCodeId) {
    await api.delete(`${API_BASE}/latex-codes/${latexCodeId}/`);
  },

  /**
   * Generate LaTeX code using AI (Gemini) for a document.
   * POST /api/ai/documents/<uuid>/generate-latex/
   * @param {string} documentId - Document UUID
   * @param {string} prompt - User prompt describing desired LaTeX
   * @param {Object} [options] - Optional parameters
   * @param {boolean} [options.save=false] - Save to Document.latex_code
   * @param {string} [options.sectionId] - Also create a LatexCode record in this section
   * @param {string} [options.preamble] - Custom LaTeX preamble
   * @param {string} [options.codeType='latex'] - LatexCode.code_type field
   * @param {string} [options.topic] - LatexCode.topic field
   * @returns {Promise<Object>} { status, latex_code, document_id, saved_to_document, latex_code_id }
   */
  async generateLatex(documentId, prompt, options = {}) {
    const response = await api.post(API_ENDPOINTS.AI_CONFIG.GENERATE_LATEX(documentId), {
      prompt,
      save: options.save ?? false,
      section_id: options.sectionId || undefined,
      preamble: options.preamble || undefined,
      code_type: options.codeType || 'latex',
      topic: options.topic || undefined,
    });
    return response.data;
  },
};

export default latexCodeService;
