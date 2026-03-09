import api from './api';
import { API_ENDPOINTS } from '../constants/api';

const normalizeListResponse = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (Array.isArray(value.results)) return value.results;
  if (Array.isArray(value.data)) return value.data;
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.data?.results)) return value.data.results;
  if (Array.isArray(value.data?.data)) return value.data.data;
  return [];
};

const exportSettingsService = {
  getExportSettings: async (documentId) => {
    const response = await api.get(API_ENDPOINTS.EXPORT_STUDIO.EXPORT_SETTINGS(documentId));
    return response.data;
  },

  updateExportSettings: async (documentId, payload) => {
    const response = await api.patch(API_ENDPOINTS.EXPORT_STUDIO.EXPORT_SETTINGS(documentId), payload);
    return response.data;
  },

  getHeaderFooterSettings: async (documentId) => {
    const response = await api.get(API_ENDPOINTS.EXPORT_STUDIO.HEADER_FOOTER(documentId));
    return response.data;
  },

  getMetadataSnapshot: async (documentId) => {
    const response = await api.get(API_ENDPOINTS.EXPORT_STUDIO.HEADER_FOOTER(documentId));
    return response.data;
  },

  getHeaderFooterTemplates: async (type) => {
    const response = await api.get(API_ENDPOINTS.EXPORT_STUDIO.HEADER_FOOTER_TEMPLATES(type));
    return normalizeListResponse(response.data);
  },

  uploadImage: async ({ file, imageType, name, documentId }) => {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('image_type', imageType);
    if (name) formData.append('name', name);
    if (documentId) formData.append('document', documentId);

    const response = await api.post(API_ENDPOINTS.EXPORT_STUDIO.UPLOAD_IMAGE, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  listImagesByType: async (type) => {
    const response = await api.get(API_ENDPOINTS.EXPORT_STUDIO.IMAGES_BY_TYPE(type));
    return response.data;
  },

  updateDocumentImages: async (documentId, payload) => {
    const response = await api.patch(API_ENDPOINTS.DOCUMENTS.EDIT_FULL(documentId), payload);
    return response.data;
  },

  applyTableConfig: async (documentId, tableConfig) => {
    const response = await api.post(API_ENDPOINTS.TABLES.APPLY_CONFIG, {
      document_id: documentId,
      table_config: tableConfig,
    });
    return response.data;
  },

  applyFileConfig: async (documentId, fileConfig) => {
    const response = await api.post(API_ENDPOINTS.EXPORT_STUDIO.APPLY_FILE_CONFIG, {
      document_id: documentId,
      file_config: fileConfig,
    });
    return response.data;
  },

  getCurrentOrganization: async () => {
    const response = await api.get(API_ENDPOINTS.ORGANIZATIONS.CURRENT);
    return response.data;
  },

  getOrganizationDocumentSettings: async (organizationId) => {
    const response = await api.get(API_ENDPOINTS.ORGANIZATIONS.DOCUMENT_SETTINGS(organizationId));
    return response.data;
  },

  getDownloadToken: async (documentId) => {
    const response = await api.get(`/documents/${documentId}/download-token/`);
    return response.data;
  },

  // --- PDF Header / Footer overlay ---

  uploadPdfFile: async ({ file, name, documentId }) => {
    const formData = new FormData();
    formData.append('file', file);
    if (name) formData.append('name', name);
    if (documentId) formData.append('document', documentId);

    const response = await api.post(API_ENDPOINTS.EXPORT_STUDIO.UPLOAD_PDF_FILE, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  listPdfFiles: async () => {
    const response = await api.get(API_ENDPOINTS.EXPORT_STUDIO.PDF_FILES);
    return normalizeListResponse(response.data);
  },

  updateHeaderFooter: async (documentId, payload) => {
    const response = await api.patch(
      API_ENDPOINTS.EXPORT_STUDIO.HEADER_FOOTER(documentId),
      payload
    );
    return response.data;
  },

  // --- Header / Footer PDF Crop Editor ---

  /** Get page dimensions (pts) for a source PDF page */
  getHfPdfPageInfo: async ({ sourceFileId, page = 1 }) => {
    const response = await api.get(API_ENDPOINTS.EXPORT_STUDIO.HF_PDF_PAGE_INFO, {
      params: { source_file_id: sourceFileId, page },
    });
    return response.data;
  },

  /** Get a PNG preview of a source PDF page at given DPI */
  getHfPdfPreview: async ({ sourceFileId, page = 1, dpi = 150 }) => {
    const response = await api.get(API_ENDPOINTS.EXPORT_STUDIO.HF_PDF_PREVIEW, {
      params: { source_file_id: sourceFileId, page, dpi },
      responseType: 'blob',
    });
    return response.data; // Blob
  },

  /** Auto-detect header/footer boundaries for a source PDF page */
  autoDetectHfPdf: async ({ sourceFileId, page = 1 }) => {
    const response = await api.get(API_ENDPOINTS.EXPORT_STUDIO.HF_PDF_AUTO_DETECT, {
      params: { source_file_id: sourceFileId, page },
    });
    return response.data;
  },

  /** Create a cropped HeaderFooterPDF record */
  createHfPdf: async (payload) => {
    // payload: { source_file_id, region_type, name, page, crop_top_offset, crop_height }
    const response = await api.post(API_ENDPOINTS.EXPORT_STUDIO.HF_PDFS, payload);
    return response.data;
  },

  /** Apply a HeaderFooterPDF record to a document */
  applyHfPdf: async (hfPdfId, { documentId, showOnFirstPage = true }) => {
    const response = await api.post(API_ENDPOINTS.EXPORT_STUDIO.HF_PDF_APPLY(hfPdfId), {
      document_id: documentId,
      show_on_first_page: showOnFirstPage,
    });
    return response.data;
  },

  /** List the user's saved header/footer PDF library */
  getHfPdfLibrary: async () => {
    const response = await api.get(API_ENDPOINTS.EXPORT_STUDIO.HF_PDF_LIBRARY);
    return normalizeListResponse(response.data);
  },
};

export default exportSettingsService;
