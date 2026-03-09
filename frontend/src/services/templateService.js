import api from './api';
import { API_ENDPOINTS } from '../constants/api';

/**
 * Template Service - Manages document templates
 * Aligns with backend API v1.0
 */
export const templateService = {
	/**
	 * Get list of available templates
	 */
	getTemplates: async () => {
		const response = await api.get(API_ENDPOINTS.DOCUMENTS.TEMPLATES);
		return response.data;
	},

	/**
	 * Create a document from a template
	 * @param {Object} params
	 * @param {string} params.template_name
	 * @param {string} params.title
	 * @param {Object} params.metadata
	 * @param {Object} params.replacements
	 */
	draftFromTemplate: async ({
		template_name,
		title,
		metadata = {},
		replacements = {},
	}) => {
		const response = await api.post(
			API_ENDPOINTS.DOCUMENTS.CREATE_FROM_TEMPLATE,
			{
				template_name,
				title,
				metadata,
				replacements,
			}
		);
		return response.data;
	},
};

export default templateService;
