/**
 * CLM API Client — Full-featured Workflow System
 * ================================================
 * Covers: workflows, nodes, connections, documents,
 * AI extraction, field management, execution, model status.
 */
import axios from 'axios';

const api = axios.create({
  baseURL: '/api/clm',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// ── Workflows ────────────────────────────────────────────────────────────
export const workflowApi = {
  list:    ()          => api.get('/workflows/'),
  get:     (id)        => api.get(`/workflows/${id}/`),
  create:  (data)      => api.post('/workflows/', data),
  update:  (id, data)  => api.patch(`/workflows/${id}/`, data),
  delete:  (id)        => api.delete(`/workflows/${id}/`),
  duplicate: (id)      => api.post(`/workflows/${id}/duplicate/`),
  rebuildTemplate: (id) => api.post(`/workflows/${id}/rebuild-template/`),

  // AI workflow generation
  generateFromText: (text, answers = null) => {
    const body = { text };
    if (answers && answers.length > 0) body.answers = answers;
    return api.post('/workflows/generate-from-text/', body);
  },

  // Documents
  upload: (id, formData, onUploadProgress) =>
    api.post(`/workflows/${id}/upload/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      ...(onUploadProgress && { onUploadProgress }),
    }),
  tableUpload: (id, formData) =>
    api.post(`/workflows/${id}/table-upload/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  tablePreview: (id, formData) =>
    api.post(`/workflows/${id}/table-preview/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  documents:       (id, params) => api.get(`/workflows/${id}/documents/`, { params }),
  deleteDocument:  (wfId, docId) => api.delete(`/workflows/${wfId}/delete-document/${docId}/`),
  reextractDoc:    (wfId, docId, data = {}) => api.post(`/workflows/${wfId}/reextract/${docId}/`, data),
  reextractAll:    (wfId, data = {}) => api.post(`/workflows/${wfId}/reextract-all/`, data),

  // AI Field Discovery — smart extraction
  discoverFields:     (wfId, docId) => api.post(`/workflows/${wfId}/discover-fields/${docId}/`),
  smartExtract:       (wfId, docId) => api.post(`/workflows/${wfId}/smart-extract/${docId}/`),
  smartExtractAll:    (wfId, data = {}) => api.post(`/workflows/${wfId}/smart-extract-all/`, data),

  // Document fields (ExtractedField rows)
  documentFields:  (wfId, docId, params) => api.get(`/workflows/${wfId}/document-fields/${docId}/`, { params }),
  documentDetail:  (wfId, docId) => api.get(`/workflows/${wfId}/document-detail/${docId}/`),
  editField:       (wfId, fieldId, data) => api.patch(`/workflows/${wfId}/edit-field/${fieldId}/`, data),
  editMetadata:    (wfId, docId, data) => api.patch(`/workflows/${wfId}/edit-metadata/${docId}/`, data),

  // Field options (dropdowns)
  fieldOptions:    (wfId, params) => api.get(`/workflows/${wfId}/field-options/`, { params }),

  // Document summary
  documentSummary: (wfId) => api.get(`/workflows/${wfId}/document-summary/`),

  // AI extraction
  extractDocument: (wfId, data) => api.post(`/workflows/${wfId}/extract-document/`, data),
  extractAll:      (wfId, data) => api.post(`/workflows/${wfId}/extract-all/`, data),
  extractText:     (wfId, data) => api.post(`/workflows/${wfId}/extract-text/`, data),

  // Execute workflow
  execute: (id, data = {}) => api.post(`/workflows/${id}/execute/`, data),

  // Smart execution: nodes config change detection
  nodesStatus:      (id) => api.get(`/workflows/${id}/nodes-status/`),
  executionRecords: (id, params) => api.get(`/workflows/${id}/execution-records/`, { params }),

  // Execution history
  executionHistory: (id, params) => api.get(`/workflows/${id}/execution-history/`, { params }),
  executionDetail:  (id, execId) => api.get(`/workflows/${id}/execution-detail/${execId}/`),

  // Document journey (trace through nodes)
  documentJourney:  (wfId, docId, params) => api.get(`/workflows/${wfId}/document-journey/${docId}/`, { params }),

  // Node inspect (rich per-node execution detail)
  nodeInspect:      (wfId, nodeId, params) => api.get(`/workflows/${wfId}/node-inspect/${nodeId}/`, { params }),

  // Auto-execute toggle
  getAutoExecute:    (id) => api.get(`/workflows/${id}/auto-execute/`),
  setAutoExecute:    (id, enabled) => api.patch(`/workflows/${id}/auto-execute/`, { auto_execute_on_upload: enabled }),

  // Webhook ingest — external document ingestion + auto-execute
  webhookIngest: (id, formData) =>
    api.post(`/workflows/${id}/webhook-ingest/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  // Action plugins
  actionPlugins:      () => api.get('/workflows/action-plugins/'),
  executeAction:      (wfId, nodeId, data = {}) => api.post(`/workflows/${wfId}/execute-action/${nodeId}/`, data),
  actionResults:      (wfId, params) => api.get(`/workflows/${wfId}/action-results/`, { params }),
  actionExecution:    (wfId, execId) => api.get(`/workflows/${wfId}/action-execution/${execId}/`),
  actionRetry:        (wfId, data) => api.post(`/workflows/${wfId}/action-retry/`, data),
  actionRetryAll:     (wfId, execId) => api.post(`/workflows/${wfId}/action-retry-all/${execId}/`),

  // Document Creator (doc_create) nodes
  docCreateResults:   (wfId, params) => api.get(`/workflows/${wfId}/doc-create-results/`, { params }),
  editorTemplates:    () => api.get('/workflows/editor-templates/'),
  editorDocuments:    (params) => api.get('/workflows/editor-documents/', { params }),
  editorDocumentFields: (docId) => api.get(`/workflows/editor-document-fields/${docId}/`),

  // AI nodes
  aiModels:           () => api.get('/workflows/ai-models/'),

  // Document types (for input node type-specific extraction templates)
  documentTypes:      () => api.get('/workflows/document-types/'),

  // Listener nodes
  listenerTriggers:  () => api.get('/workflows/listener-triggers/'),
  checkListener:     (wfId, nodeId, data = {}) => api.post(`/workflows/${wfId}/check-listener/${nodeId}/`, data),
  resolveListener:   (wfId, data) => api.post(`/workflows/${wfId}/resolve-listener/`, data),
  listenerEvents:    (wfId, params) => api.get(`/workflows/${wfId}/listener-events/`, { params }),
  pendingApprovals:  () => api.get('/workflows/pending-approvals/'),
  checkInbox:        (wfId, nodeId) => api.post(`/workflows/${wfId}/check-inbox/${nodeId}/`),
  emailStatus:       (wfId, nodeId) => api.get(`/workflows/${wfId}/email-status/${nodeId}/`),

  // Cloud source integrations
  testConnection:    (wfId, nodeId) => api.post(`/workflows/${wfId}/test-connection/${nodeId}/`),

  // Validation nodes
  orgUsers:               (params) => api.get('/workflows/org-users/', { params }),
  validatorUsers:         (wfId, params) => api.get(`/workflows/${wfId}/validator-users/`, { params }),
  addValidatorUser:       (wfId, data) => api.post(`/workflows/${wfId}/validator-users/`, data),
  removeValidatorUser:    (wfId, data) => api.delete(`/workflows/${wfId}/validator-users/`, { data }),
  resolveValidation:      (wfId, data) => api.post(`/workflows/${wfId}/resolve-validation/`, data),
  bulkResolveValidation:  (wfId, data) => api.post(`/workflows/${wfId}/bulk-resolve-validation/`, data),
  validationStatus:       (wfId, params) => api.get(`/workflows/${wfId}/validation-status/`, { params }),
  myValidations:          (params) => api.get('/workflows/my-validations/', { params }),

  // Model management
  modelStatus:     () => api.get('/workflows/model-status/'),
  preloadModel:    (data = {}) => api.post('/workflows/preload-model/', data),

  // AI Chat assistant
  chatHistory:     (id) => api.get(`/workflows/${id}/chat/`),
  chatSend:        (id, data) => api.post(`/workflows/${id}/chat/`, data),
  chatClear:       (id) => api.delete(`/workflows/${id}/chat-clear/`),
  chatApply:       (id, messageId) => api.post(`/workflows/${id}/chat-apply/`, { message_id: messageId }),

  // Workflow optimizer
  optimizePreview: (id) => api.get(`/workflows/${id}/optimize-workflow/`),
  optimizeApply:   (id) => api.post(`/workflows/${id}/optimize-workflow/`, { apply: true }),

  // Downloads
  downloadDocument: (wfId, docId) =>
    api.get(`/workflows/${wfId}/download-document/${docId}/`, { responseType: 'blob' }),
  nodeDownload: (wfId, nodeId, format = 'zip') =>
    api.get(`/workflows/${wfId}/node-download/${nodeId}/`, {
      params: { export: format },
      responseType: 'blob',
    }),

  // Upload links (shareable public upload pages)
  uploadLinks:       (id) => api.get(`/workflows/${id}/upload-links/`),
  createUploadLink:  (id, data = {}) => api.post(`/workflows/${id}/upload-links/`, data),
  updateUploadLink:  (id, linkId, data) => api.patch(`/workflows/${id}/upload-links/${linkId}/`, data),
  deleteUploadLink:  (id, linkId) => api.delete(`/workflows/${id}/upload-links/${linkId}/`),
};

// ── Nodes ────────────────────────────────────────────────────────────────
export const nodeApi = {
  list:   (workflowId) => api.get('/nodes/', { params: { workflow: workflowId } }),
  get:    (id)         => api.get(`/nodes/${id}/`),
  create: (data)       => api.post('/nodes/', data),
  update: (id, data)   => api.patch(`/nodes/${id}/`, data),
  delete: (id)         => api.delete(`/nodes/${id}/`),
};

// ── Connections ──────────────────────────────────────────────────────────
export const connectionApi = {
  list:   (workflowId) => api.get('/connections/', { params: { workflow: workflowId } }),
  create: (data)       => api.post('/connections/', data),
  delete: (id)         => api.delete(`/connections/${id}/`),
};

// ── Helpers ──────────────────────────────────────────────────────────────

// ── Public Upload API (no auth needed) ───────────────────────────────────
export const publicUploadApi = {
  /** Get workflow info for the upload page */
  getInfo: (token) => api.get(`/public/upload/${token}/`),

  /** Upload files to a public upload link */
  upload: (token, formData, onUploadProgress) =>
    api.post(`/public/upload/${token}/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      ...(onUploadProgress && { onUploadProgress }),
    }),

  /** Send OTP code to email or phone */
  sendOtp: (token, identifier) =>
    api.post(`/public/upload/${token}/send-otp/`, { identifier }),

  /** Verify OTP code → returns session_token */
  verifyOtp: (token, identifier, code) =>
    api.post(`/public/upload/${token}/verify-otp/`, { identifier, code }),
};

/** Get the download URL for a document's file */
export function getDocumentFileUrl(doc) {
  if (!doc?.file) return null;
  if (doc.file.startsWith('http')) return doc.file;
  // Ensure the path is absolute so it resolves against the host, not the current route
  if (!doc.file.startsWith('/')) return `/${doc.file}`;
  return doc.file;
}

/**
 * Trigger browser download from an Axios blob response.
 * Usage: triggerBlobDownload(response, 'merged.pdf')
 */
export function triggerBlobDownload(response, fallbackName = 'download') {
  const disposition = response.headers?.['content-disposition'] || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : fallbackName;
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export default api;
