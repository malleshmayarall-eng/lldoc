/**
 * API Endpoints
 * Centralized API endpoint definitions matching backend routes.
 *
 * Rules
 * ─────
 * • Every entry here MUST have a matching backend URL route.
 * • Every entry here MUST be consumed by at least one service or component.
 * • Services use `API_ENDPOINTS.*` — never hardcode paths.
 * • All paths are relative to the Axios baseURL (`/api`).
 *
 * Last audited: February 21, 2026
 */

export const API_ENDPOINTS = {
	// ── Authentication ──────────────────────────────────────────────────
	AUTH: {
		LOGIN: '/auth/login/',
		LOGOUT: '/auth/logout/',
		ME: '/auth/me/',
		VERIFY: '/auth/verify/',
		CHANGE_PASSWORD: '/auth/change-password/',
		SEND_LOGIN_OTP: '/auth/send-login-otp/',
		VERIFY_LOGIN_OTP: '/auth/verify-login-otp/',
		TOGGLE_TWO_FACTOR: '/auth/two-factor/toggle/',
		REQUEST_EMAIL_LOGIN_OTP: '/auth/request-email-login-otp/',
	},

	// ── Documents ───────────────────────────────────────────────────────
	DOCUMENTS: {
		BASE: '/documents/',
		BY_ID: (id) => `/documents/${id}/`,
		COMPLETE: (id) => `/documents/${id}/complete/`,
		GRAPH: (id) => `/documents/${id}/graph/`,

		// Listing
		MY_DOCUMENTS: '/documents/my-documents/',
		SHARED_WITH_ME: '/documents/shared-with-me/',
		ORGANIZATION_DOCUMENTS: '/documents/organization-documents/',

		// Creation
		CREATE: '/documents/',
		IMPORT: '/documents/import/',
		CREATE_STRUCTURED: '/documents/create-structured/',
		CREATE_FROM_TEMPLATE: '/documents/create-from-template/',
		TEMPLATES: '/documents/templates/',
		TEMPLATE_DETAIL: (name) => `/documents/templates/${name}/`,

		// Editing
		EDIT_FULL: (id) => `/documents/${id}/edit-full/`,
		PARTIAL_SAVE: (id) => `/documents/${id}/partial-save/`,

		// Versioning
		CHANGELOG: (id) => `/documents/${id}/changelog/`,
		CREATE_VERSION: (id) => `/documents/${id}/create-version/`,
		VERSIONS: (id) => `/documents/${id}/versions/`,
		VERSION_DETAIL: (id, versionId) => `/documents/${id}/versions/${versionId}/`,
		RESTORE_VERSION: (id) => `/documents/${id}/restore-version/`,

		// Export
		EXPORT: (id) => `/documents/${id}/export/`,
		DOWNLOAD_TOKEN: (id) => `/documents/${id}/download-token/`,

		// Status
		DOCUMENT_STATUS: (id) => `/documents/${id}/document-status/`,

		// AI
		ANALYZE: (id) => `/documents/${id}/analyze/`,
		REWRITE: (id) => `/documents/${id}/rewrite/`,

		// Image slots (placeholder mapping)
		IMAGE_SLOTS: (id) => `/documents/${id}/image-slots/`,
		MAP_IMAGE: (id) => `/documents/${id}/map-image/`,
	},

	// ── Sections ────────────────────────────────────────────────────────
	SECTIONS: {
		BASE: '/documents/sections/',
		BY_ID: (id) => `/documents/sections/${id}/`,
		BY_DOCUMENT: (docId) => `/documents/${docId}/sections/`,
	},

	// ── Paragraphs ──────────────────────────────────────────────────────
	PARAGRAPHS: {
		BASE: '/documents/paragraphs/',
		BY_ID: (id) => `/documents/paragraphs/${id}/`,
		EDIT: (docId) => `/documents/${docId}/edit-paragraph/`,
	},

	// ── Paragraph History ───────────────────────────────────────────────
	PARAGRAPH_HISTORY: {
		BASE: '/documents/paragraph-history/',
		BY_ID: (id) => `/documents/paragraph-history/${id}/`,
		BY_PARAGRAPH: (paragraphId) => `/documents/paragraph-history/?paragraph=${paragraphId}`,
		RESTORE: (id) => `/documents/paragraph-history/${id}/restore/`,
	},

	// ── Tables ──────────────────────────────────────────────────────────
	TABLES: {
		BASE: '/documents/tables/',
		BY_ID: (id) => `/documents/tables/${id}/`,
		UPDATE_CELL: (id) => `/documents/tables/${id}/update-cell/`,
		ADD_ROW: (id) => `/documents/tables/${id}/add-row/`,
		DELETE_ROW: (id) => `/documents/tables/${id}/delete-row/`,
		ADD_COLUMN: (id) => `/documents/tables/${id}/add-column/`,
		DELETE_COLUMN: (id) => `/documents/tables/${id}/delete-column/`,
		APPLY_CONFIG: '/documents/tables/apply-config/',
	},

	// ── Users & Organizations ───────────────────────────────────────────
	USERS: {
		BASE: '/users/users/',
		BY_ID: (id) => `/users/users/${id}/`,
	},

	ORGANIZATIONS: {
		BASE: '/users/organizations/',
		BY_ID: (id) => `/users/organizations/${id}/`,
		CURRENT: '/users/organizations/current/',
		DOCUMENT_SETTINGS: (id) => `/users/organizations/${id}/document-settings/`,
	},

	TEAMS: {
		BASE: '/users/teams/',
		BY_ID: (id) => `/users/teams/${id}/`,
	},

	// ── Workflows ───────────────────────────────────────────────────────
	WORKFLOWS: {
		BASE: '/documents/workflows/',
		BY_ID: (id) => `/documents/workflows/${id}/`,
		MY_TASKS: '/documents/workflows/my-tasks/',
		ASSIGNED_BY_ME: '/documents/workflows/assigned-by-me/',
		BY_ORG: (org) => `/documents/workflows/by-org/${org}/`,
		BY_TEAM: (team) => `/documents/workflows/by-team/${team}/`,
		REASSIGN: (id) => `/documents/workflows/${id}/reassign/`,
		COMPLETE: (id) => `/documents/workflows/${id}/complete/`,
		UPDATE_STATUS: (id) => `/documents/workflows/${id}/update-status/`,
	},

	WORKFLOW_APPROVALS: {
		BASE: '/documents/workflow-approvals/',
		BY_ID: (id) => `/documents/workflow-approvals/${id}/`,
		MY_APPROVALS: '/documents/workflow-approvals/my-approvals/',
		APPROVE: (id) => `/documents/workflow-approvals/${id}/approve/`,
		REJECT: (id) => `/documents/workflow-approvals/${id}/reject/`,
	},

	WORKFLOW_COMMENTS: {
		BASE: '/documents/workflow-comments/',
		BY_ID: (id) => `/documents/workflow-comments/${id}/`,
		RESOLVE: (id) => `/documents/workflow-comments/${id}/resolve/`,
	},

	WORKFLOW_NOTIFICATIONS: {
		BASE: '/documents/workflow-notifications/',
		UNREAD: '/documents/workflow-notifications/unread/',
		MARK_READ: (id) => `/documents/workflow-notifications/${id}/mark-read/`,
		MARK_ALL_READ: '/documents/workflow-notifications/mark-all-read/',
	},

	// ── System Alerts (communications app) ──────────────────────────────
	ALERTS: {
		BASE: '/alerts/',
		BY_ID: (id) => `/alerts/${id}/`,
		MARK_READ: (id) => `/alerts/${id}/read/`,
		MARK_ALL_READ: '/alerts/read-all/',
		UNREAD_COUNT: '/alerts/unread-count/',
		CLEAR_READ: '/alerts/clear/',
		PREFERENCES: '/alerts/preferences/',
		CATEGORIES: '/alerts/preferences/categories/',
	},

	// ── FileShare (Suite Drive) ─────────────────────────────────────────
	FILESHARE: {
		FOLDERS: {
			BASE: '/fileshare/folders/',
			MY_ROOT: '/fileshare/folders/my_root/',
			ROOTS: '/fileshare/folders/roots/',
			SHARED_WITH_ME: '/fileshare/folders/shared_with_me/',
			CHILDREN: (id) => `/fileshare/folders/${id}/children/`,
			SHARED_WITH: (id) => `/fileshare/folders/${id}/shared-with/`,
			BY_ID: (id) => `/fileshare/folders/${id}/`,
		},
		FILES: {
			BASE: '/fileshare/files/',
			BY_ID: (id) => `/fileshare/files/${id}/`,
			DOWNLOAD: (id) => `/fileshare/files/${id}/download/`,
			SHARED_WITH: (id) => `/fileshare/files/${id}/shared-with/`,
			CONTENT_TYPES: '/fileshare/files/content_types/',
		},
	},

	SHARING: {
		SHARES: '/sharing/shares/',
		CONTENT_TYPES: '/sharing/shares/content-types/',
	},

	// ── Export Studio (PDF settings, headers/footers) ───────────────────
	EXPORT_STUDIO: {
		EXPORT_SETTINGS: (id) => `/documents/${id}/export-settings/`,
		HEADER_FOOTER: (id) => `/documents/${id}/header-footer/`,
		HEADER_FOOTER_TEMPLATES: (type) => `/documents/header-footer-templates/?type=${type}`,
		UPLOAD_IMAGE: '/documents/images/upload/',
		UPLOAD_PDF_FILE: '/documents/files/upload/',
		PDF_FILES: '/documents/files/?file_type=pdf',
		IMAGES_BY_TYPE: (type) => `/documents/images/by-type/${type}/`,
		APPLY_FILE_CONFIG: '/documents/file-components/apply-config/',

		// Header / Footer PDF Crop Editor
		HF_PDFS: '/documents/header-footer-pdfs/',
		HF_PDF_PAGE_INFO: '/documents/header-footer-pdfs/page-info/',
		HF_PDF_PREVIEW: '/documents/header-footer-pdfs/preview/',
		HF_PDF_AUTO_DETECT: '/documents/header-footer-pdfs/auto-detect/',
		HF_PDF_APPLY: (id) => `/documents/header-footer-pdfs/${id}/apply/`,
		HF_PDF_LIBRARY: '/documents/header-footer-pdfs/my-library/',
	},

	// ── Dashboard ───────────────────────────────────────────────────────
	DASHBOARD: {
		OVERVIEW: '/documents/dashboard/overview/',
		MY_DOCUMENTS: '/documents/dashboard/my-documents/',
		WORKFLOWS: '/documents/dashboard/workflows/',
		SHARED: '/documents/dashboard/shared/',
		SEARCH: '/documents/dashboard/search/',
		STATS: '/documents/dashboard/stats/',
		RECENT_ACTIVITY: '/documents/dashboard/recent-activity/',
	},

	// ── Master Documents & Branching ────────────────────────────────────
	MASTERS: {
		BASE: '/documents/masters/',
		BY_ID: (id) => `/documents/masters/${id}/`,
		BRANCH: (id) => `/documents/masters/${id}/branch/`,
		AI_GENERATE: '/documents/masters/ai-generate/',
		SEARCH: '/documents/masters/search/',
		PROMOTE: '/documents/masters/promote/',
	},

	BRANCHES: {
		BASE: '/documents/branches/',
		BY_ID: (id) => `/documents/branches/${id}/`,
		AI_CONTENT: (id) => `/documents/branches/${id}/ai-content/`,
		DUPLICATE: (id) => `/documents/branches/${id}/duplicate/`,
	},

	DUPLICATE: {
		BASE: '/documents/duplicate/',
		DOCUMENT_ACTION: (id) => `/documents/${id}/duplicate/`,
		PROMOTE_ACTION: (id) => `/documents/${id}/promote-to-master/`,
	},

	// ── Quick LaTeX Documents ───────────────────────────────────────────
	QUICK_LATEX: {
		BASE: '/documents/quick-latex/',
		BY_ID: (id) => `/documents/quick-latex/${id}/`,
		DUPLICATE: (id) => `/documents/quick-latex/${id}/duplicate/`,
		BULK_DUPLICATE: (id) => `/documents/quick-latex/${id}/bulk-duplicate/`,
		AI_GENERATE: (id) => `/documents/quick-latex/${id}/ai-generate/`,
		AI_PREVIEW: '/documents/quick-latex/ai-preview/',
		PLACEHOLDERS: (id) => `/documents/quick-latex/${id}/placeholders/`,
		METADATA: (id) => `/documents/quick-latex/${id}/metadata/`,
		FROM_SOURCE: '/documents/quick-latex/from-source/',
		RENDERED_LATEX: (id) => `/documents/quick-latex/${id}/rendered-latex/`,
		SWITCH_CODE_TYPE: (id) => `/documents/quick-latex/${id}/switch-code-type/`,
		RENDER_HTML: (id) => `/documents/${id}/html/render/`,
		CHAT_HISTORY: (id) => `/documents/quick-latex/${id}/chat-history/`,
		// Image placeholders
		IMAGES: (id) => `/documents/quick-latex/${id}/images/`,
		UPLOAD_IMAGE: (id) => `/documents/quick-latex/${id}/upload-image/`,
		RESOLVE_IMAGES: (id) => `/documents/quick-latex/${id}/resolve-images/`,
		MAP_IMAGE: (id) => `/documents/quick-latex/${id}/map-image/`,
		// File uploads
		FILES: (id) => `/documents/quick-latex/${id}/files/`,
		UPLOAD_FILE: (id) => `/documents/quick-latex/${id}/upload-file/`,
	},

	// ── Attachments Library ─────────────────────────────────────────────
	ATTACHMENTS: {
		BASE: '/attachments/',
		BY_ID: (id) => `/attachments/${id}/`,
		UPLOAD: '/attachments/upload/',
		MY_UPLOADS: '/attachments/my-uploads/',
		TEAM: (teamId) => `/attachments/team/${teamId}/`,
		ORGANIZATION: '/attachments/organization/',
		IMAGES: '/attachments/images/',
		DOCUMENTS: '/attachments/documents/',
		SUMMARY: '/attachments/summary/',
	},

	// ── Section References ──────────────────────────────────────────────
	SECTION_REFERENCES: {
		BASE: '/documents/section-references/',
		BY_ID: (id) => `/documents/section-references/${id}/`,
	},

	// ── Inline References ───────────────────────────────────────────────
	REFERENCES: {
		SEARCH_TARGETS: '/documents/reference-context/',
	},

	// ── AI Service Configuration ────────────────────────────────────────
	AI_CONFIG: {
		// Document-Type AI Presets (org-level)
		PRESETS: {
			BASE: '/ai/presets/',
			BY_ID: (id) => `/ai/presets/${id}/`,
			BY_TYPE: '/ai/presets/by-type/',
			DEFAULTS: '/ai/presets/defaults/',
		},
		// Per-Document AI Config
		DOCUMENT: {
			CONFIG: (docId) => `/ai/documents/${docId}/config/`,
			UPDATE: (docId) => `/ai/documents/${docId}/config/update/`,
			TOGGLE: (docId) => `/ai/documents/${docId}/config/toggle/`,
			BULK_TOGGLE: (docId) => `/ai/documents/${docId}/config/bulk-toggle/`,
			RESET: (docId) => `/ai/documents/${docId}/config/reset/`,
			STATUS: (docId) => `/ai/documents/${docId}/config/status/`,
			SET_TYPE: (docId) => `/ai/documents/${docId}/config/set-type/`,
		},
		// AI LaTeX generation
		GENERATE_LATEX: (docId) => `/ai/documents/${docId}/generate-latex/`,
		// Document types list
		DOCUMENT_TYPES: '/ai/document-types/',
	},

	// ── Inference Engine (hierarchical context + lateral edges) ──────────
	INFERENCE: {
		// Trigger LLM inference
		INFER_DOCUMENT: (docId) => `/ai/inference/documents/${docId}/infer/`,
		INFER_SECTION: (sectionId) => `/ai/inference/sections/${sectionId}/infer/`,
		INFER_COMPONENT: (type, id) => `/ai/inference/components/${type}/${id}/infer/`,

		// Retrieve inference results
		DOCUMENT_SUMMARY: (docId) => `/ai/inference/documents/${docId}/summary/`,
		DOCUMENT_CONTEXT: (docId) => `/ai/inference/documents/${docId}/context/`,
		SECTION_SUMMARY: (sectionId) => `/ai/inference/sections/${sectionId}/summary/`,
		SECTION_CONTEXT: (sectionId) => `/ai/inference/sections/${sectionId}/context/`,
		SECTION_COMPONENTS: (sectionId) => `/ai/inference/sections/${sectionId}/components/`,

		// Tree and staleness
		DOCUMENT_TREE: (docId) => `/ai/inference/documents/${docId}/tree/`,
		DOCUMENT_STALE: (docId) => `/ai/inference/documents/${docId}/stale/`,

		// Write-path (embed → MaxSim → rerank → graph UPSERT)
		WRITE_PATH_DOCUMENT: (docId) => `/ai/inference/documents/${docId}/write-path/`,
		WRITE_PATH_COMPONENT: (type, id) => `/ai/inference/write-path/components/${type}/${id}/`,

		// Lateral edges (cross-component dependencies)
		LATERAL_EDGES_COMPONENT: (type, id) => `/ai/inference/lateral-edges/${type}/${id}/`,
		LATERAL_EDGES_DOCUMENT: (docId) => `/ai/inference/documents/${docId}/lateral-edges/`,

		// Maintenance
		REBUILD_EMBEDDINGS: (docId) => `/ai/inference/documents/${docId}/rebuild-embeddings/`,
		WRITE_PATH_STATUS: (docId) => `/ai/inference/documents/${docId}/write-path-status/`,
	},
};

export default API_ENDPOINTS;
