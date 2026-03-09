import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Plus,
  RefreshCw,
  User,
  X,
} from 'lucide-react';
import PagedDocument from '../components/PagedDocument';
import VersionCompareView from '../components/VersionCompareView';
import AccessBanners from './documentDrafter/components/AccessBanners';
import DocumentHeader from './documentDrafter/components/DocumentHeader';
import RightSidebar from './documentDrafter/components/RightSidebar';
import DocumentViewer from '../components/DocumentViewer';
import TemplateRenderer from '../components/TemplateRenderer';
import { DocumentSectionTree } from '../components/SectionTree';
import FloatingImageToolbar from '../components/FloatingImageToolbar';
import ReferenceDialog from '../components/ReferenceDialog';
import documentService from '../services/documentService';
import sectionService from '../services/sectionService';
import aiService from '../services/aiService';
import useDocumentEditor from '../hooks/useDocumentEditor';
import imageService from '../services/imageService';
import metadataService from '../services/metadataService';
import exportSettingsService from '../services/exportSettingsService';
import aiConfigService from '../services/aiConfigService';
import { paragraphService } from '../services/paragraphs/paragraphService';
import latexCodeService from '../services/latexCodeService';
import tableService from '../services/tableService';
import { imageComponentService } from '../services/imageComponentService';
import { documentFileService } from '../services/documentFileService';
import api from '../services/api';
import { fixImageUrl, validateImageFile } from '../utils/imageUtils';
import { buildSectionComponents, reorderComponents, appendComponent, insertComponentAt } from '../utils/sectionOrdering';
import { SaveCoordinator } from '../utils/saveCoordinator';
import { StaleDataError } from '../utils/etagFetch';
import { ShareDialog, ParagraphHistorySidebar } from '../components';
import { useSharing, useSharePermissions } from '../hooks/useSharing';
import { canEditDocument, getDocumentRole, isSharedDocument } from '../utils/documentPermissions';
import { useAuth } from '../contexts/AuthContext';
import useWorkflowStore from '../store/workflowStore';
import WorkflowAssignment from '../components/WorkflowAssignment';
import { serializePlaceholderHtml } from '../utils/paragraphAiPlaceholderRenderer';
import useMetadataStore from '../store/metadataStore';
import { extractPlaceholderFields } from '../utils/metadataFieldUsageTracker';
import { API_CONFIG } from '../config/app.config';
import useDocumentInference from '../hooks/useDocumentInference';
import useCrossReferences from '../hooks/useCrossReferences';
import useInferenceCache from '../hooks/useInferenceCache';

const PAGE_DIMENSIONS = {
  a4: { widthPx: 794, heightPx: 1123, label: 'A4 (210 × 297 mm)' },
  a3: { widthPx: 1123, heightPx: 1587, label: 'A3 (297 × 420 mm)' },
  letter: { widthPx: 816, heightPx: 1056, label: 'Letter (8.5 × 11 in)' },
  legal: { widthPx: 816, heightPx: 1344, label: 'Legal (8.5 × 14 in)' },
};

const TYPOGRAPHY_SCALES = {
  1.067: 'Major Second (1.067x)',
  1.125: 'Minor Third (1.125x)',
  1.2: 'Major Third (1.2x)',
  1.25: 'Perfect Fourth (1.25x)',
  1.414: 'Augmented Fourth (1.414x)',
  1.5: 'Perfect Fifth (1.5x)',
};

const DEFAULT_PAGE_SETTINGS = {
  size: 'letter',
  orientation: 'portrait',
  fontSize: 14,
  typeScale: 1.2,
  zoom: 100,
  margins: 32,
};

const flattenMetadataObject = (obj, prefix = '') => {
  const flattened = {};
  if (!obj || typeof obj !== 'object') return flattened;

  Object.entries(obj).forEach(([key, value]) => {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(flattened, flattenMetadataObject(value, newKey));
    } else {
      flattened[newKey] = value;
    }
  });

  return flattened;
};

const DocumentDrafter = ({ onDocumentLoad }) => {
  const { id } = useParams();
  const navigate = useNavigate();

  // Create-on-new state
  const [creatingDocument, setCreatingDocument] = useState(false);
  const hasCreatedRef = React.useRef(false);
  // Simple 400ms dedup for direct-API creates (tables, etc.) — not for partial-save items
  const recentCreateRef = useRef(new Map());

  const {
    completeDocument,
    setCompleteDocument,
    loading,
    error,
    saving,
    hasChanges,
    setHasChanges,
    lastSavedAt,
    lastSaveStatus,
    lastSaveError,
    loadCompleteDocument,
  saveDocument,
  addSection: addSectionLocal,
  updateSection: updateSectionLocal,
  deleteSection: deleteSectionLocal,
  addParagraph: addParagraphLocal,
  updateParagraph: updateParagraphLocal,
  deleteParagraph: deleteParagraphLocal,
  reorderParagraphs: reorderParagraphsLocal,
  handleImageDrop: handleImageDropLocal,
    setError,
    // Complete API data - all components indexed and ready to use
    sections,           // Root-level sections (tree structure)
    flatSections,       // All sections flattened
  allParagraphs,      // All paragraphs across all sections
  allLatexCodes,      // All LaTeX code blocks across all sections
    allTables,          // All tables across all sections
    allImageComponents, // All image components across all sections
    allFileComponents,  // All file components across all sections
    comments,           // Document comments
    issues,             // Document issues
    attachments,        // Document attachments
    stats,              // Document statistics (sections_count, paragraphs_count, tables_count, etc.)
    metadata,           // Document metadata (version, draft status, timestamps, etc.)
    // Helper functions for efficient lookups
    getComponentsInSection,
    getSectionById,
  getParagraphById,
  getLatexCodeById,
    getTableById,
    getImageComponentById,
    getFileComponentById,
    // Maps for O(1) lookups
    sectionMap,
  paragraphMap,
  latexCodeMap,
    tableMap,
    imageComponentMap,
    fileComponentMap,
    // Section-specific component maps (pre-built from Complete API)
  sectionParagraphs,
  sectionLatexCodes: completeSectionLatexCodes,
    sectionTables: completeSectionTables,
    sectionImages: completeSectionImages,
    sectionFiles: completeSectionFiles,
    sectionComponents,
  } = useDocumentEditor(id);

  const {
    metadata: documentMetadataStore,
    loadMetadata: loadDocumentMetadata,
    uploadMetadata: uploadDocumentMetadata,
  } = useMetadataStore();

  // ── Inference + Cross-reference + Cache hooks ──────────────────────
  const inference = useDocumentInference(id && id !== 'new' ? id : null);
  const crossRef = useCrossReferences(id && id !== 'new' ? id : null);
  const inferenceCache = useInferenceCache(id && id !== 'new' ? id : null, completeDocument);

  // Auto-infer on load when document has changed since last cache
  const autoInferTriggeredRef = useRef(false);
  useEffect(() => {
    if (
      !autoInferTriggeredRef.current &&
      inferenceCache.hasDocumentChanged &&
      completeDocument?.sections?.length > 0 &&
      !inference.inferring &&
      !inference.loading
    ) {
      autoInferTriggeredRef.current = true;
      inference.runInference({ force: false }).then((result) => {
        if (result && inference.tree) {
          inferenceCache.persistTree(inference.tree);
        }
      });
    }
  }, [inferenceCache.hasDocumentChanged, completeDocument, inference.inferring, inference.loading]);

  // Persist tree to cache whenever inference tree updates
  useEffect(() => {
    if (inference.tree?.tree && !inference.inferring) {
      inferenceCache.persistTree(inference.tree);
    }
  }, [inference.tree, inference.inferring]);

  // Sidebar state — declare early so it can be used in crossRefBundle
  const [activeSidebar, setActiveSidebar] = useState(null);

  // Build cross-ref prop bundle for PagedDocument — granular deps so it
  // re-creates whenever any cross-ref state actually changes.
  const crossRefBundle = useMemo(() => {
    if (!crossRef) return null;
    return {
      enabled: crossRef.enabled,
      sourceId: crossRef.sourceId,
      sourceType: crossRef.sourceType,
      edges: crossRef.edges,
      edgeCountMap: crossRef.edgeCountMap,
      selectSource: crossRef.selectSource,
      clearSource: crossRef.clearSource,
      toggle: crossRef.toggle,
      // Inference actions for inline section/paragraph buttons
      runSectionInference: inference?.runSectionInference,
      runComponentInference: inference?.runComponentInference,
      openInferencePanel: () => setActiveSidebar('inference'),
    };
  }, [
    crossRef?.enabled,
    crossRef?.sourceId,
    crossRef?.sourceType,
    crossRef?.edges,
    crossRef?.edgeCountMap,
    crossRef?.selectSource,
    crossRef?.clearSource,
    crossRef?.toggle,
    inference?.runSectionInference,
    inference?.runComponentInference,
    setActiveSidebar,
  ]);

  useEffect(() => {
    if (!id || id === 'new') return;
    loadDocumentMetadata(id).catch((err) => {
      console.error('Failed to load document metadata:', err);
    });
  }, [id, loadDocumentMetadata]);

  // Fetch AI service status for per-document ONNX gating
  useEffect(() => {
    if (!id || id === 'new') return;
    aiConfigService.getServiceStatus(id)
      .then((data) => setAiServiceStatus(data))
      .catch(() => { /* fail-open: leave null → scoring enabled */ });
  }, [id]);

  // Handle /drafter/new: create a fresh document then redirect to its id
  useEffect(() => {
    if (id !== 'new' || hasCreatedRef.current) return;

    const createDoc = async () => {
      setCreatingDocument(true);
      setError(null);
      try {
        // Use import endpoint (text-based) to avoid model validation quirks
        const doc = await documentService.importDocument(
          'Untitled Document',
          '# Untitled Document\n\nStart writing here...'
        );
        const newId = doc?.id || doc?.document_id;

        if (!newId) {
          throw new Error('Failed to create document - no ID returned');
        }

        hasCreatedRef.current = true;
        navigate(`/drafter/${newId}`, { replace: true, state: { justCreated: true } });
      } catch (err) {
        console.error('Error creating new document:', err);
        console.error('Error response:', err.response?.data);
        const errorMsg = err.response?.data?.detail 
          || err.response?.data?.error
          || (typeof err.response?.data === 'string' ? err.response.data : null)
          || err.message 
          || 'Failed to create document';
        setError(errorMsg);
      } finally {
        setCreatingDocument(false);
      }
    };

    createDoc();
  }, [id, navigate, setError]);

  // Check permissions for this document FIRST (before using isViewer)
  // First try useSharePermissions hook, then fall back to document.share_info
  const sharePermissions = useSharePermissions('document', completeDocument?.id) || {};
  
  // Use share_info from document as fallback if available
  const canEdit = sharePermissions.canEdit ?? (completeDocument ? canEditDocument(completeDocument) : true);
  const canShare = sharePermissions.canShare ?? !isSharedDocument(completeDocument);
  const canComment = sharePermissions.canComment ?? (completeDocument?.share_info?.can_comment !== false);
  const role = sharePermissions.role ?? (completeDocument ? getDocumentRole(completeDocument) : null);
  
  // Determine user access level and enforce appropriate mode
  const isViewer = role === 'viewer';
  const isCommenter = role === 'commenter';
  const isEditor = role === 'editor';
  const isOwner = role === 'owner' || !role; // No role means owner
  const canModifyContent = canEdit && !isViewer;

  // Preview mode - but viewers are ALWAYS in view mode
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  
  // Force view mode for viewers (now isViewer is defined)
  const effectiveViewMode = isViewer ? true : isPreviewMode;
  
  const isExportStudio = activeSidebar === 'export';

  // ── Review-comments state (per-element badges + focused sidebar) ──
  const [reviewCommentCounts, setReviewCommentCounts] = useState({});   // { elementId: { total, unresolved, target_type } }
  const [focusedReviewElement, setFocusedReviewElement] = useState(null); // { id, type } or null

  const handleCommentCountsLoaded = useCallback((counts) => {
    setReviewCommentCounts(counts || {});
  }, []);

  const handleOpenReviewComments = useCallback((elementId, elementType) => {
    setFocusedReviewElement({ id: elementId, type: elementType });
    setActiveSidebar('review-comments');
  }, []);

  const handleClearReviewFocus = useCallback(() => {
    setFocusedReviewElement(null);
  }, []);

  // Load review-comment counts on mount (so badges show before sidebar opens)
  useEffect(() => {
    if (!completeDocument?.id) return;
    const fetchCounts = async () => {
      try {
        const { data } = await api.get(`/viewer/review-comments/${completeDocument.id}/`);
        if (data.counts_by_element) setReviewCommentCounts(data.counts_by_element);
      } catch {
        // Silently ignore — badges just won't show
      }
    };
    fetchCounts();
  }, [completeDocument?.id]);

  const [sidebarTab, setSidebarTab] = useState('document');
  const [sidebarImages, setSidebarImages] = useState([]);
  const [loadingSidebarImages, setLoadingSidebarImages] = useState(false);
  const [imageSearchQuery, setImageSearchQuery] = useState('');
  const [imageTypeFilter, setImageTypeFilter] = useState('');
  const [imageSlots, setImageSlots] = useState([]);
  const [imageSlotsLoading, setImageSlotsLoading] = useState(false);
  const [pendingImageSectionId, setPendingImageSectionId] = useState(null);
  const [pendingImageInsertAfter, setPendingImageInsertAfter] = useState(null);
  const [pendingDocumentSectionId, setPendingDocumentSectionId] = useState(null);
  const [pendingDocumentInsertAfter, setPendingDocumentInsertAfter] = useState(null);
  const [pendingReferenceSectionId, setPendingReferenceSectionId] = useState(null);
  const [pendingReferenceInsertAfter, setPendingReferenceInsertAfter] = useState(null);
  const [selectedImageComponent, setSelectedImageComponent] = useState(null);
  const [imageToolbarAnchor, setImageToolbarAnchor] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [pageSettings, setPageSettings] = useState(DEFAULT_PAGE_SETTINGS);
  const [citationStyle, setCitationStyle] = useState('inline'); // Citation style for references - 'inline' shows just the text

  // ── AI Service Config (per-document gating) ──────────────────────────
  const [aiServiceStatus, setAiServiceStatus] = useState(null);
  // paragraph_scoring is a local ONNX model — gate it purely on the frontend
  const aiScoringEnabled = aiServiceStatus?.services?.paragraph_scoring?.enabled !== false;
  const [metadataViewMode, setMetadataViewMode] = useState('form'); // 'form' or 'table'
  
  // New formatting & reference states
  const [showReferenceDialog, setShowReferenceDialog] = useState(false);
  const [selectedSection, setSelectedSection] = useState(null);
  const [activeEditorNode, setActiveEditorNode] = useState(null);

  // ── Auto-show cross-reference arcs when editing a component ─────────
  // When user focuses a paragraph/section/table editor, automatically
  // enable cross-ref mode and select the focused component as source.
  // This shows all lateral edge arcs from the active component.
  const handleActiveEditorChange = useCallback((editorNode) => {
    setActiveEditorNode(editorNode);
    if (!editorNode || !crossRef) return;

    // Extract the component ID from the closest data-metadata-id wrapper
    const metadataEl = editorNode.closest?.('[data-metadata-id]');
    const sectionEl = editorNode.closest?.('[data-section-id]');
    const componentId = metadataEl?.getAttribute('data-metadata-id') ||
                        sectionEl?.getAttribute('data-section-id');

    if (!componentId) {
      console.debug('[CrossRef] No component ID found on focused element');
      return;
    }

    // Determine component type from DOM context
    let componentType = 'paragraph';
    if (sectionEl && !metadataEl) {
      componentType = 'section';
    } else if (editorNode.closest?.('[data-table-id]') || editorNode.closest?.('.document-table')) {
      componentType = 'table';
    } else if (editorNode.closest?.('[data-latex-id]') || editorNode.closest?.('.latex-editor')) {
      componentType = 'latex_code';
    }

    console.debug('[CrossRef] Focus →', componentType, componentId);

    // Enable cross-refs and select this component as source.
    // Always call enable() first, then selectSource() — both are
    // separate dispatches but React batches them in event handlers.
    crossRef.enable();
    crossRef.selectSource(componentId, componentType);
  }, [crossRef?.enable, crossRef?.selectSource]);

  const [showSectionTree, setShowSectionTree] = useState(false);
  const [metadataSidebar, setMetadataSidebar] = useState({
    open: false,
    type: null,
    id: null,
    label: '',
    metadata: {},
  });
  // Paragraph history sidebar state
  const [historySidebar, setHistorySidebar] = useState({
    open: false,
    paragraphId: null,
    label: '',
  });
  // AI Chat sidebar state
  const [aiChatScope, setAiChatScope] = useState({
    scope: 'document',
    scopeId: null,
    scopeLabel: '',
  });
  const [metadataConnector, setMetadataConnector] = useState(null);
  const metadataSidebarRef = useRef(null);
  const layoutRef = useRef(null);
  const contentScrollRef = useRef(null);
  const formatSelectionRef = useRef(null);
  const pdfPreviewContainerRef = useRef(null);
  const exportPreviewUrlRef = useRef(null);
  const refreshPreviewTimerRef = useRef(null);
  const handleTableUpdateRef = useRef(null);
  const [pdfPreviewHeight, setPdfPreviewHeight] = useState(600);

  // Template state
  const [templateId, setTemplateId] = useState('modern');
  const [useTemplateRenderer, setUseTemplateRenderer] = useState(false);
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [exportSettings, setExportSettings] = useState(null);
  const [exportSettingsDraft, setExportSettingsDraft] = useState(null);
  const [exportSettingsLoading, setExportSettingsLoading] = useState(false);
  const [exportSettingsError, setExportSettingsError] = useState(null);
  const [exportSettingsSaving, setExportSettingsSaving] = useState(false);
  const [exportSettingsDirty, setExportSettingsDirty] = useState(false);
  const [exportTemplates, setExportTemplates] = useState({ headers: [], footers: [] });
  const [exportImages, setExportImages] = useState({ logo: [], watermark: [], background: [] });
  const [exportPdfFiles, setExportPdfFiles] = useState([]);
  const [exportProcessingDefaults, setExportProcessingDefaults] = useState(null);
  const [exportMetadataSnapshot, setExportMetadataSnapshot] = useState(null);
  const [exportPreviewKey, setExportPreviewKey] = useState(0);
  const [exportPreviewBlobUrl, setExportPreviewBlobUrl] = useState(null);
  const [exportPreviewLoading, setExportPreviewLoading] = useState(false);
  const [pdfPreviewBlobUrl, setPdfPreviewBlobUrl] = useState(null);
  const [downloadToken, setDownloadToken] = useState(null);

  // AI review scoring state
  const [aiScore, setAiScore] = useState(null);
  const [aiScoreLoading, setAiScoreLoading] = useState(false);
  const [aiScoreError, setAiScoreError] = useState(null);

  const normalizeAiReviewCallouts = useCallback((score) => {
    const items = Array.isArray(score?.clause_level_review) ? score.clause_level_review : [];
    return items
      .map((item, index) => {
        if (!item) return null;
        const sectionId = item.section_id || item.sectionId || item.section || null;
        const paragraphId = item.paragraph_id || item.paragraphId || item.paragraph || null;
        if (!sectionId && !paragraphId) return null;
        return {
          id: item.id || item.clause_id || `ai-review-${sectionId || 'section'}-${paragraphId || 'paragraph'}-${index}`,
          sectionId,
          paragraphId,
          title: item.clause_type || item.clause_id || item.title || `Clause ${index + 1}`,
          severity: item.severity || item.priority || 'Review',
          summary: item.summary || item.issue_summary || item.issue || item.rationale || '',
          suggestion: item.suggested_revision || item.suggested_change || item.recommendation || item.suggestion || '',
          sectionPath: item.section_path || item.source_location || '',
        };
      })
      .filter(Boolean);
  }, []);

  const aiReviewCallouts = useMemo(() => {
    const fromScore = normalizeAiReviewCallouts(aiScore);
    if (fromScore.length) return fromScore;
    return completeDocument?.ai_review_callouts || [];
  }, [aiScore, completeDocument?.ai_review_callouts, normalizeAiReviewCallouts]);

  const handleToggleSectionTree = useCallback(() => {
    setShowSectionTree((prev) => !prev);
  }, []);

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!activeEditorNode || !activeEditorNode.contains(selection.anchorNode)) return;
      formatSelectionRef.current = range.cloneRange();
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [activeEditorNode]);

  useEffect(() => {
    if (!aiScore) return;
    const callouts = normalizeAiReviewCallouts(aiScore);
    if (!callouts.length) return;
    setCompleteDocument((prev) => (prev ? { ...prev, ai_review_callouts: callouts } : prev));
  }, [aiScore, normalizeAiReviewCallouts, setCompleteDocument]);

  // Sharing state
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showAccessManager, setShowAccessManager] = useState(false);
  
  // Section Browser state
  // Section browser now uses activeSidebar: 'sections'
  
  // Format toolbar state
  const [showFormatToolbar, setShowFormatToolbar] = useState(false);
  const [toolbarTextColor, setToolbarTextColor] = useState('#000000');
  const [toolbarBackgroundColor, setToolbarBackgroundColor] = useState('#ffffff');
  const [toolbarOpacity, setToolbarOpacity] = useState(1);
  const [toolbarFontSize, setToolbarFontSize] = useState(14);
  
  // Table state - track tables per section
  const [sectionTables, setSectionTables] = useState({});
  const [loadingTables, setLoadingTables] = useState({});

  // LaTeX Code state - track LaTeX blocks per section
  const [sectionLatexCodeBlocks, setSectionLatexCodeBlocks] = useState({});
  
  // Image Component state - track image components per section
  const [sectionImageComponents, setSectionImageComponents] = useState({});
  
  // Document File Component state - track document components per section
  const [sectionDocumentComponents, setSectionDocumentComponents] = useState({});
  const [now, setNow] = useState(() => new Date());
  // ── Centralized Save Coordinator ──
  // Replaces partialSaveQueueRef, sectionIdMapRef, pendingSectionCreatesRef,
  // inFlightCreatesRef, bufferedEditsRef with a single orchestrator.
  const saveCoordinatorRef = useRef(null);
  // Mutable callback refs so the coordinator always calls the latest closure
  const saveResultCallbackRef = useRef(null);
  const saveErrorCallbackRef = useRef(null);
  const etagAlertRef = useRef(false);
  const draftSaveTimerRef = useRef(null);
  const [partialSaveStatus, setPartialSaveStatus] = useState('idle');
  const [partialSaveConflict, setPartialSaveConflict] = useState(null);

  // Lazily initialize the SaveCoordinator (once per component lifetime)
  if (!saveCoordinatorRef.current) {
    saveCoordinatorRef.current = new SaveCoordinator({
      getDocumentId: () => completeDocument?.id ?? null,
      onSaveResult: (result) => {
        if (saveResultCallbackRef.current) saveResultCallbackRef.current(result);
      },
      onSaveError: (error) => {
        if (saveErrorCallbackRef.current) saveErrorCallbackRef.current(error);
      },
      onConflict: (msg) => setPartialSaveConflict(msg),
      onStatusChange: (status) => setPartialSaveStatus(status),
      debounceMs: 1200,
    });
  }
  // Keep getDocumentId always returning the latest id
  saveCoordinatorRef.current._getDocumentId = () => completeDocument?.id ?? null;

  const draftStorageKey = useMemo(
    () => (completeDocument?.id ? `documentDraft:${completeDocument.id}` : null),
    [completeDocument?.id]
  );

  const persistDraftToStorage = useCallback(
    (doc) => {
      if (!draftStorageKey || !doc) return;
      try {
        localStorage.setItem(
          draftStorageKey,
          JSON.stringify({ updatedAt: Date.now(), document: doc })
        );
      } catch (error) {
        console.warn('Failed to persist document draft:', error);
      }
    },
    [draftStorageKey]
  );

  const cloneExportDraft = useCallback((value) => {
    if (typeof structuredClone === 'function') {
      return structuredClone(value || {});
    }
    return JSON.parse(JSON.stringify(value || {}));
  }, []);

  const normalizeExportSettings = useCallback(
    (value, defaultsOverride) => {
      const base = value || {};
      const defaults = defaultsOverride ?? exportProcessingDefaults ?? {};
      const processing = base.processing_settings || {};
      const defaultProcessing = defaults?.processing_settings || defaults || {};
      return {
        ...base,
        header_template: base.header_template ?? null,
        footer_template: base.footer_template ?? null,
        header_config: base.header_config || {},
        footer_config: base.footer_config || {},
        custom_metadata: base.custom_metadata || {},
        processing_settings: {
          ...defaultProcessing,
          ...processing,
          pdf_layout: {
            ...(defaultProcessing.pdf_layout || {}),
            ...(processing.pdf_layout || {}),
          },
          table_config: {
            ...(defaultProcessing.table_config || {}),
            ...(processing.table_config || {}),
          },
          file_config: {
            ...(defaultProcessing.file_config || {}),
            ...(processing.file_config || {}),
          },
          pdf_images: {
            ...(defaultProcessing.pdf_images || {}),
            ...(processing.pdf_images || {}),
          },
          metadata_fields: {
            ...(defaultProcessing.metadata_fields || {}),
            ...(processing.metadata_fields || {}),
            enabled: {
              ...(defaultProcessing.metadata_fields?.enabled || {}),
              ...(processing.metadata_fields?.enabled || {}),
            },
          },
          pdf_security: {
            enabled: false,
            user_password: null,
            owner_password: null,
            ...(defaultProcessing.pdf_security || {}),
            ...(processing.pdf_security || {}),
          },
          pdf_text_protection: {
            enabled: false,
            mode: 'rasterize',
            dpi: 200,
            remove_metadata: true,
            encryption_key: null,
            ...(defaultProcessing.pdf_text_protection || {}),
            ...(processing.pdf_text_protection || {}),
          },
          header_pdf: processing.header_pdf ?? defaultProcessing.header_pdf ?? null,
          footer_pdf: processing.footer_pdf ?? defaultProcessing.footer_pdf ?? null,
        },
      };
    },
    [exportProcessingDefaults]
  );

  const updateExportSetting = useCallback((path, value) => {
    setExportSettingsDraft((prev) => {
      const draft = normalizeExportSettings(prev || {});
      const next = cloneExportDraft(draft);
      const segments = Array.isArray(path) ? path : [path];
      let cursor = next;
      segments.forEach((segment, index) => {
        if (index === segments.length - 1) {
          cursor[segment] = value;
          return;
        }
        if (!cursor[segment] || typeof cursor[segment] !== 'object') {
          cursor[segment] = {};
        }
        cursor = cursor[segment];
      });
      return next;
    });
    setExportSettingsDirty(true);
  }, [cloneExportDraft, normalizeExportSettings]);

  const backendBaseUrl = API_CONFIG.BACKEND_URL?.replace(/\/$/, '') || 'http://localhost:8000';
  const downloadTokenParam = downloadToken ? `download_token=${encodeURIComponent(downloadToken)}` : '';
  const pdfPreviewUrl = completeDocument?.id
    ? `${backendBaseUrl}/documents/${completeDocument.id}/download-pdf/${downloadTokenParam ? `?${downloadTokenParam}` : ''}`
    : null;
  const pdfDownloadUrl = completeDocument?.id
    ? `${backendBaseUrl}/documents/${completeDocument.id}/download-pdf/?download=1${downloadTokenParam ? `&${downloadTokenParam}` : ''}`
    : null;

  const exportPreviewUrl = useMemo(() => {
    if (!completeDocument?.id) return null;
    return `${backendBaseUrl}/documents/${completeDocument.id}/download-pdf/${downloadTokenParam ? `?${downloadTokenParam}` : ''}`;
  }, [backendBaseUrl, completeDocument?.id, downloadTokenParam]);

  // Keep ref in sync so the useEffect can read the latest URL without depending on it
  useEffect(() => {
    exportPreviewUrlRef.current = exportPreviewUrl;
  }, [exportPreviewUrl]);

  const fetchDownloadToken = useCallback(async () => {
    if (!completeDocument?.id) return null;
    try {
      const response = await exportSettingsService.getDownloadToken(completeDocument.id);
      const token = response?.download_token || null;
      setDownloadToken(token);
      return token;
    } catch (error) {
      setDownloadToken(null);
      return null;
    }
  }, [completeDocument?.id]);

  useEffect(() => {
    let isActive = true;
    if (!completeDocument?.id) {
      setDownloadToken(null);
      return undefined;
    }

    const loadToken = async () => {
      const token = await fetchDownloadToken();
      if (!isActive) return;
      setDownloadToken(token);
    };

    loadToken();
    return () => {
      isActive = false;
    };
  }, [completeDocument?.id, fetchDownloadToken]);

  useEffect(() => {
    let isActive = true;
    const url = exportPreviewUrlRef.current;
    if (!url || !isExportStudio) {
      setExportPreviewBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setExportPreviewLoading(false);
      return undefined;
    }

    setExportPreviewLoading(true);
    const loadExportPreview = async () => {
      try {
        const response = await api.get(url, {
          responseType: 'blob',
          withCredentials: true,
        });
        if (!isActive) return;
        const objectUrl = URL.createObjectURL(response.data);
        setExportPreviewBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return objectUrl;
        });
      } catch (error) {
        if (!isActive) return;
        setExportPreviewBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
      } finally {
        if (isActive) setExportPreviewLoading(false);
      }
    };

    loadExportPreview();
    return () => {
      isActive = false;
    };
    // Only re-run when the key bumps or studio visibility changes.
    // URL is read from ref so token changes alone don't cause duplicate fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportPreviewKey, isExportStudio]);

  useEffect(() => {
    let isActive = true;
    if (!showPdfPreview || !pdfPreviewUrl) {
      setPdfPreviewBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return undefined;
    }

    const loadPdfPreview = async () => {
      try {
        const response = await api.get(pdfPreviewUrl, {
          responseType: 'blob',
          withCredentials: true,
        });
        if (!isActive) return;
        const objectUrl = URL.createObjectURL(response.data);
        setPdfPreviewBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return objectUrl;
        });
      } catch (error) {
        if (!isActive) return;
        setPdfPreviewBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
      }
    };

    loadPdfPreview();
    return () => {
      isActive = false;
    };
  }, [pdfPreviewUrl, showPdfPreview]);

  const handleOpenPdfPreview = useCallback(() => {
    if (!completeDocument?.id) return;
    setIsPreviewMode(false);
    setUseTemplateRenderer(false);
    setShowPdfPreview(true);
  }, [completeDocument?.id]);

  const handleOpenExportStudio = useCallback(() => {
    setShowPdfPreview(false);
    setIsPreviewMode(false);
    setUseTemplateRenderer(false);
    setActiveSidebar((prev) => (prev === 'export' ? null : 'export'));
  }, []);

  const handleStatusChange = useCallback(async (newStatus) => {
    if (!completeDocument?.id) return;
    try {
      const result = await documentService.updateDocumentStatus(completeDocument.id, newStatus);
      setCompleteDocument((prev) => prev ? { ...prev, status: result.status } : prev);
    } catch (err) {
      console.error('Failed to update document status:', err);
      setError(err.response?.data?.error || 'Failed to update status');
    }
  }, [completeDocument?.id, setCompleteDocument, setError]);

  const refreshExportPreview = useCallback(async () => {
    // Debounce: coalesce rapid calls (e.g. header PDF height + opacity + toggle)
    // into a single preview refresh after a short delay.
    if (refreshPreviewTimerRef.current) {
      clearTimeout(refreshPreviewTimerRef.current);
    }
    return new Promise((resolve) => {
      refreshPreviewTimerRef.current = setTimeout(async () => {
        refreshPreviewTimerRef.current = null;
        await fetchDownloadToken();
        setExportPreviewKey((prev) => prev + 1);
        resolve();
      }, 600);
    });
  }, [fetchDownloadToken]);

  const fetchProcessingDefaults = useCallback(async (settings) => {
    const processing = settings?.processing_settings || {};
    if (Object.keys(processing).length > 0) return null;
    try {
      const org = await exportSettingsService.getCurrentOrganization();
      const organizationId = org?.id || org?.organization?.id || org?.organization_id || org?.organization?.organization_id;
      if (!organizationId) return null;
      const orgSettings = await exportSettingsService.getOrganizationDocumentSettings(organizationId);
      return orgSettings?.preferences?.processing_defaults || null;
    } catch (error) {
      return null;
    }
  }, []);

  const loadExportSettings = useCallback(async () => {
    if (!completeDocument?.id) return;
    setExportSettingsLoading(true);
    setExportSettingsError(null);
    try {
      const settings = await exportSettingsService.getExportSettings(completeDocument.id);
      const dropdowns = settings?.dropdowns || {};
      const hasDropdowns = Boolean(
        dropdowns?.header_templates || dropdowns?.footer_templates || dropdowns?.images
      );

      const [headers, footers, logos, watermarks, backgrounds, metadataSnapshot, pdfFiles] = await Promise.all([
        hasDropdowns ? Promise.resolve(dropdowns?.header_templates || []) : exportSettingsService.getHeaderFooterTemplates('header'),
        hasDropdowns ? Promise.resolve(dropdowns?.footer_templates || []) : exportSettingsService.getHeaderFooterTemplates('footer'),
        hasDropdowns ? Promise.resolve(dropdowns?.images?.logo || []) : exportSettingsService.listImagesByType('logo'),
        hasDropdowns ? Promise.resolve(dropdowns?.images?.watermark || []) : exportSettingsService.listImagesByType('watermark'),
        hasDropdowns ? Promise.resolve(dropdowns?.images?.background || []) : exportSettingsService.listImagesByType('background'),
        exportSettingsService.getMetadataSnapshot(completeDocument.id),
        exportSettingsService.listPdfFiles().catch(() => []),
      ]);

      const defaults = await fetchProcessingDefaults(settings);
      if (defaults) {
        setExportProcessingDefaults(defaults);
      }
      const normalized = normalizeExportSettings(settings, defaults);
      setExportSettings(normalized);
      setExportSettingsDraft(cloneExportDraft(normalized));
      setExportSettingsDirty(false);
      setExportTemplates({ headers: headers || [], footers: footers || [] });
      setExportImages({ logo: logos || [], watermark: watermarks || [], background: backgrounds || [] });
      setExportPdfFiles(pdfFiles || []);
      setExportMetadataSnapshot(metadataSnapshot || null);
    } catch (error) {
      setExportSettingsError(error?.response?.data?.detail || error.message || 'Failed to load export settings');
    } finally {
      setExportSettingsLoading(false);
    }
  }, [cloneExportDraft, completeDocument?.id, fetchProcessingDefaults, normalizeExportSettings]);

  const handleSaveExportSettings = useCallback(async () => {
    if (!completeDocument?.id || !exportSettingsDraft) return;
    setExportSettingsSaving(true);
    setExportSettingsError(null);
    try {
      const ps = exportSettingsDraft.processing_settings || {};
      const payload = {
        processing_settings: ps,
        header_template: ps.header_pdf?.file_id ? null : (exportSettingsDraft.header_template ?? null),
        footer_template: ps.footer_pdf?.file_id ? null : (exportSettingsDraft.footer_template ?? null),
        header_config: exportSettingsDraft.header_config || {},
        footer_config: exportSettingsDraft.footer_config || {},
        custom_metadata: exportSettingsDraft.custom_metadata || {},
      };
      await exportSettingsService.updateExportSettings(completeDocument.id, payload);
      const refreshed = await exportSettingsService.getExportSettings(completeDocument.id);
      const normalized = normalizeExportSettings(refreshed);
      setExportSettings(normalized);
      setExportSettingsDraft(cloneExportDraft(normalized));
      setExportSettingsDirty(false);
      refreshExportPreview();
    } catch (error) {
      setExportSettingsError(error?.response?.data?.detail || error.message || 'Failed to save export settings');
    } finally {
      setExportSettingsSaving(false);
    }
  }, [cloneExportDraft, completeDocument?.id, exportSettingsDraft, normalizeExportSettings, refreshExportPreview]);

  const handleResetExportSettings = useCallback(() => {
    if (!exportSettings) return;
    setExportSettingsDraft(cloneExportDraft(exportSettings));
    setExportSettingsDirty(false);
  }, [cloneExportDraft, exportSettings]);

  // Auto-save metadata field toggles: metadata field changes should save immediately
  // to keep preview and downstream systems in sync. Debounce slightly to avoid
  // rapid consecutive saves when the user toggles multiple fields quickly.
  useEffect(() => {
    if (!completeDocument?.id) return undefined;
    let timer = null;
    try {
      const enabledMap = exportSettingsDraft?.processing_settings?.metadata_fields?.enabled;
      // stringify to create stable dependency value
      const key = enabledMap ? JSON.stringify(enabledMap) : null;
      if (!key) return undefined;
      // Small debounce before saving
      timer = window.setTimeout(() => {
        // Only save if there are unsaved changes
        if (exportSettingsDraft && exportSettingsDirty) {
          void handleSaveExportSettings();
        }
      }, 450);
    } catch (e) {
      // ignore serialization errors
    }

    return () => {
      if (timer) window.clearTimeout(timer);
    };
    // We purposefully watch the JSON of enabled map so updates to keys trigger
    // this effect. Also include exportSettingsDirty to avoid saving when draft
    // is programmatically set (load/reset).
  }, [completeDocument?.id, exportSettingsDraft?.processing_settings?.metadata_fields?.enabled ? JSON.stringify(exportSettingsDraft.processing_settings.metadata_fields.enabled) : null, exportSettingsDirty, handleSaveExportSettings]);

  const handleUploadExportImage = useCallback(
    async (file, imageType) => {
      if (!completeDocument?.id || !file) return;
      try {
        await exportSettingsService.uploadImage({
          file,
          imageType,
          name: file.name,
          documentId: completeDocument.id,
        });
        const updated = await exportSettingsService.listImagesByType(imageType);
        setExportImages((prev) => ({ ...prev, [imageType]: updated || [] }));
      } catch (error) {
        setExportSettingsError(error?.response?.data?.detail || error.message || 'Failed to upload image');
      }
    },
    [completeDocument?.id]
  );

  const handleUploadPdfFile = useCallback(
    async (file) => {
      if (!completeDocument?.id || !file) return null;
      try {
        const uploaded = await exportSettingsService.uploadPdfFile({
          file,
          name: file.name,
          documentId: completeDocument.id,
        });
        const refreshedFiles = await exportSettingsService.listPdfFiles().catch(() => []);
        setExportPdfFiles(refreshedFiles);
        return uploaded;
      } catch (error) {
        setExportSettingsError(error?.response?.data?.detail || error.message || 'Failed to upload PDF file');
        return null;
      }
    },
    [completeDocument?.id]
  );

  const handleSaveHeaderFooterPdf = useCallback(
    async (type, config) => {
      if (!completeDocument?.id) return;
      setExportSettingsSaving(true);
      try {
        const payload = type === 'header' ? { header_pdf: config } : { footer_pdf: config };
        await exportSettingsService.updateHeaderFooter(completeDocument.id, payload);
        // Sync the draft with the new config
        updateExportSetting(['processing_settings', type === 'header' ? 'header_pdf' : 'footer_pdf'], config);
        // Disable corresponding template when PDF is active
        if (config) {
          updateExportSetting([type === 'header' ? 'header_template' : 'footer_template'], null);
        }
        refreshExportPreview();
      } catch (error) {
        setExportSettingsError(error?.response?.data?.detail || error.message || 'Failed to save header/footer PDF');
      } finally {
        setExportSettingsSaving(false);
      }
    },
    [completeDocument?.id, refreshExportPreview, updateExportSetting]
  );

  const handleRemoveHeaderFooterPdf = useCallback(
    async (type) => {
      if (!completeDocument?.id) return;
      setExportSettingsSaving(true);
      try {
        const payload = type === 'header' ? { header_pdf: null } : { footer_pdf: null };
        await exportSettingsService.updateHeaderFooter(completeDocument.id, payload);
        updateExportSetting(['processing_settings', type === 'header' ? 'header_pdf' : 'footer_pdf'], null);
        refreshExportPreview();
      } catch (error) {
        setExportSettingsError(error?.response?.data?.detail || error.message || 'Failed to remove header/footer PDF');
      } finally {
        setExportSettingsSaving(false);
      }
    },
    [completeDocument?.id, refreshExportPreview, updateExportSetting]
  );

  useEffect(() => {
    if (activeSidebar !== 'export') return;
    loadExportSettings();
  }, [activeSidebar, loadExportSettings]);

  // Track PDF preview container height for the draggable overlay
  useEffect(() => {
    const el = pdfPreviewContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry?.contentRect?.height) setPdfPreviewHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const findSectionByAnyId = useCallback(
    (sectionId) => {
      if (!sectionId) return null;
      const direct = getSectionById?.(sectionId);
      if (direct) return direct;

      const stack = [...(completeDocument?.sections || [])];
      while (stack.length) {
        const current = stack.shift();
        if (!current) continue;
        if (current.id === sectionId || current.client_id === sectionId) {
          return current;
        }
        if (current.children?.length) {
          stack.push(...current.children);
        }
      }

      return null;
    },
    [completeDocument?.sections, getSectionById]
  );

  const findParagraphByAnyId = useCallback(
    (paragraphId) => {
      if (!paragraphId) return null;
      const direct = getParagraphById?.(paragraphId);
      if (direct) return direct;

      const sectionValues = Array.from(sectionParagraphs?.values?.() || []);
      for (const list of sectionValues) {
        const found = list?.find((para) => para.id === paragraphId || para.client_id === paragraphId);
        if (found) return found;
      }
      return null;
    },
    [getParagraphById, sectionParagraphs]
  );

  const findSectionIdForParagraph = useCallback(
    (paragraphId) => {
      if (!paragraphId) return null;
      const stack = [...(completeDocument?.sections || [])];
      while (stack.length) {
        const section = stack.shift();
        if (!section) continue;
        const paragraphs = section.paragraphs || [];
        if (paragraphs.some((para) => para.id === paragraphId || para.client_id === paragraphId)) {
          return section.id || section.client_id || null;
        }
        if (section.children?.length) {
          stack.push(...section.children);
        }
      }
      return null;
    },
    [completeDocument?.sections]
  );

  const findLatexCodeByAnyId = useCallback(
    (latexId) => {
      if (!latexId) return null;
      const direct = getLatexCodeById?.(latexId);
      if (direct) return direct;

  const sectionValues = Object.values(sectionLatexCodeBlocks || {});
      for (const list of sectionValues) {
        const found = list?.find((latex) => latex.id === latexId || latex.client_id === latexId);
        if (found) return found;
      }
      return null;
    },
    [getLatexCodeById, sectionLatexCodeBlocks]
  );

  const findSectionIdForLatexCode = useCallback(
    (latexId) => {
      if (!latexId) return null;
  const entries = Object.entries(sectionLatexCodeBlocks || {});
      for (const [sectionKey, list] of entries) {
        if (list?.some((latex) => latex.id === latexId || latex.client_id === latexId)) {
          return sectionKey;
        }
      }
      return null;
    },
    [sectionLatexCodeBlocks]
  );

  const enqueuePartialChange = useCallback(
    (change) => {
      saveCoordinatorRef.current.enqueue(change);
      setHasChanges(true);
    },
    [setHasChanges]
  );

  useEffect(() => {
    if (!completeDocument || !draftStorageKey) return;
    if (draftSaveTimerRef.current) {
      window.clearTimeout(draftSaveTimerRef.current);
    }
    draftSaveTimerRef.current = window.setTimeout(() => {
      persistDraftToStorage(completeDocument);
    }, 600);

    return () => {
      if (draftSaveTimerRef.current) {
        window.clearTimeout(draftSaveTimerRef.current);
      }
    };
  }, [completeDocument, draftStorageKey, persistDraftToStorage]);

  const updateSectionLatexCodesInDocument = useCallback(
    (sectionId, latexUpdater) => {
      if (!sectionId) return;
      setCompleteDocument((prev) => {
        if (!prev) return prev;

        const updateSections = (sections) => (sections || []).map((section) => {
          const key = section?.id || section?.client_id;
          if (key === sectionId) {
            const currentLatex = section.latex_codes || section.latex_code_components || [];
            const nextLatex = latexUpdater(currentLatex);
            return {
              ...section,
              latex_codes: nextLatex,
              latex_code_components: nextLatex,
            };
          }
          if (section?.children?.length) {
            return { ...section, children: updateSections(section.children) };
          }
          return section;
        });

        return {
          ...prev,
          sections: updateSections(prev.sections || []),
        };
      });
    },
    [setCompleteDocument]
  );

  const addSection = useCallback(
    async (sectionDataOrType, insertIndex = -1, parentId = null, depthLevel) => {
      if (!completeDocument?.id) return null;

      const isTypeString = typeof sectionDataOrType === 'string';
      const baseData = isTypeString ? {} : (sectionDataOrType || {});
      const sectionType = isTypeString ? sectionDataOrType : baseData.section_type;

      // 1. POST to server first to get a real UUID
      let saved;
      try {
        saved = await sectionService.createSection(completeDocument.id, {
          title: baseData.title || 'Section Name Here ..',
          content_text: baseData.content_text ?? '',
          order: typeof insertIndex === 'number' && insertIndex >= 0 ? insertIndex : (baseData.order ?? 0),
          depth_level: depthLevel ?? baseData.depth_level ?? 1,
          section_type: sectionType || 'clause',
          metadata: baseData.metadata ?? {},
          parent: parentId || null,
        });
      } catch (error) {
        console.error('Failed to create section via API:', error);
        setError(error?.message || 'Failed to create section');
        return null;
      }

      const savedId = saved?.id || saved?.section?.id;
      if (!savedId) {
        setError('Server returned no section ID');
        return null;
      }

      // 2. Inject the real ID into the data so addSectionLocal uses it
      const sectionPayload = {
        ...baseData,
        id: savedId,
        title: baseData.title || 'Section Name Here ..',
        content_text: baseData.content_text ?? '',
        order: typeof insertIndex === 'number' && insertIndex >= 0 ? insertIndex : (baseData.order ?? 0),
        depth_level: depthLevel ?? baseData.depth_level ?? 1,
        section_type: sectionType || 'clause',
        metadata: baseData.metadata ?? {},
      };

      // 3. Add to local state with the real ID
      const newSection = addSectionLocal(sectionPayload, insertIndex, parentId, depthLevel);
      if (newSection) {
        // Ensure local state has the real ID
        updateSectionLocal(newSection.client_id || newSection.id, { id: savedId });
      }

      setHasChanges(true);
      return newSection ? { ...newSection, id: savedId } : null;
    },
    [addSectionLocal, completeDocument?.id, setHasChanges, setError, updateSectionLocal]
  );

  const updateSection = useCallback(
    (sectionId, updates) => {
      const resolveSection = () => {
        const direct = getSectionById?.(sectionId);
        if (direct) return direct;
        const stack = [...(completeDocument?.sections || [])];
        while (stack.length) {
          const current = stack.shift();
          if (!current) continue;
          if (current.id === sectionId || current.client_id === sectionId) {
            return current;
          }
          if (current.children?.length) {
            stack.push(...current.children);
          }
        }
        return null;
      };
      const section = resolveSection();
      updateSectionLocal(sectionId, updates);

      if (!sectionId) return;
      const resolvedId = section?.id || sectionId;
      const payload = {
        title: updates?.title ?? section?.title,
        content_text: updates?.content_text ?? section?.content_text ?? '',
        order: updates?.order ?? section?.order,
        depth_level: updates?.depth_level ?? section?.depth_level,
        section_type: updates?.section_type ?? section?.section_type,
        metadata: updates?.metadata ?? section?.metadata ?? {},
        parent: section?.parent || section?.parent_id || null,
        document: completeDocument?.id,
      };

      void (async () => {
        try {
          await sectionService.updateSection(resolvedId, payload);
        } catch (error) {
          console.error('Failed to update section via API:', error);
          setError(error?.message || 'Failed to update section');
        }
      })();

      setHasChanges(true);
    },
    [getSectionById, completeDocument?.sections, completeDocument?.id, updateSectionLocal, setError, setHasChanges]
  );

  const deleteSection = useCallback(
    (sectionId) => {
      const resolveSection = () => {
        const direct = getSectionById?.(sectionId);
        if (direct) return direct;
        const stack = [...(completeDocument?.sections || [])];
        while (stack.length) {
          const current = stack.shift();
          if (!current) continue;
          if (current.id === sectionId || current.client_id === sectionId) {
            return current;
          }
          if (current.children?.length) {
            stack.push(...current.children);
          }
        }
        return null;
      };
      const section = resolveSection();

      // Clean up local state maps for this section
      const sectionKey = section?.id || section?.client_id || sectionId;
      setSectionTables((prev) => {
        const { [sectionKey]: _, ...rest } = prev;
        return rest;
      });
      setSectionImageComponents((prev) => {
        const { [sectionKey]: _, ...rest } = prev;
        return rest;
      });
      setSectionLatexCodeBlocks((prev) => {
        const { [sectionKey]: _, ...rest } = prev;
        return rest;
      });
      setSectionDocumentComponents((prev) => {
        const { [sectionKey]: _, ...rest } = prev;
        return rest;
      });

      // Remove from local tree
      deleteSectionLocal(sectionId);

      // All sections now have real server IDs (create-first pattern)
      const realId = section?.id;
      if (!realId) return;

      // Call server delete directly (fire-and-forget) rather than enqueue,
      // because section deletes are destructive and should not be batched/deferred.
      void (async () => {
        try {
          await sectionService.deleteSection(realId);
        } catch (error) {
          console.error('Failed to delete section via API:', error);
          setError(error?.response?.data?.detail || error?.message || 'Failed to delete section');
        }
      })();

      // Also remove any queued changes that reference this section
      const queue = saveCoordinatorRef.current._queue;
      const pendingChanges = queue.pending.filter((change) => {
        const refSection = change?.data?.section_id;
        return refSection === realId || refSection === sectionKey;
      });
      // Re-build queue without orphaned changes
      if (pendingChanges.length > 0) {
        const kept = queue.pending.filter((change) => {
          const refSection = change?.data?.section_id;
          if (refSection === realId || refSection === sectionKey) return false;
          if (change.type === 'section' && change.id === realId) return false;
          return true;
        });
        queue.clear();
        kept.forEach((change) => queue.add(change));
      }

      setHasChanges(true);
    },
    [getSectionById, completeDocument?.sections, deleteSectionLocal, setError, setHasChanges, setSectionTables, setSectionImageComponents, setSectionLatexCodeBlocks, setSectionDocumentComponents]
  );

  const addParagraph = useCallback(
    async (sectionId, paragraphData = {}, options = {}) => {
      if (!sectionId) return null;

      // Resolve the section's real ID
      const section = getSectionById?.(sectionId) || (() => {
        const stack = [...(completeDocument?.sections || [])];
        while (stack.length) {
          const current = stack.shift();
          if (!current) continue;
          if (current.id === sectionId || current.client_id === sectionId) return current;
          if (current.children?.length) stack.push(...current.children);
        }
        return null;
      })();
      const resolvedSectionId = section?.id || sectionId;

      // Determine order
      const resolvedData = typeof paragraphData === 'string'
        ? { content: paragraphData }
        : (paragraphData || {});
      const insertAfter = typeof options.insertAfter === 'number'
        ? options.insertAfter
        : (typeof resolvedData.insertAfter === 'number' ? resolvedData.insertAfter : null);

      const existingParagraphs = section?.paragraphs || [];
      const nextOrder = typeof resolvedData.order === 'number'
        ? resolvedData.order
        : (typeof insertAfter === 'number' ? insertAfter + 1 : existingParagraphs.length);

      // 1. POST to server first to get a real UUID
      let saved;
      try {
        saved = await paragraphService.createParagraph(resolvedSectionId, {
          content: resolvedData.content ?? '',
          content_text: resolvedData.content ?? '',
          order: nextOrder,
          paragraph_type: resolvedData.paragraph_type || 'standard',
        });
      } catch (error) {
        console.error('Failed to create paragraph via API:', error);
        return null;
      }

      const savedId = saved?.id;
      if (!savedId) return null;

      // 2. Add to local state with the real server ID
      const dataWithRealId = {
        ...resolvedData,
        id: savedId,
        order: nextOrder,
      };
      const newParagraph = addParagraphLocal(sectionId, dataWithRealId, options);
      if (newParagraph) {
        // Ensure local copy has the real ID
        updateParagraphLocal(newParagraph.client_id || newParagraph.id, { id: savedId });
      }

      return newParagraph ? { ...newParagraph, id: savedId } : null;
    },
    [addParagraphLocal, updateParagraphLocal, getSectionById, completeDocument?.sections]
  );

  const updateParagraph = useCallback(
    (paragraphId, updates) => {
      const paragraph = findParagraphByAnyId(paragraphId);
      // Always update local state immediately for responsive UI
      updateParagraphLocal(paragraphId, updates);

      if (!paragraphId) return;
      const resolvedId = paragraph?.id || paragraphId;
      const resolvedSectionId =
        updates?.section_id ||
        updates?.sectionId ||
        paragraph?.section ||
        paragraph?.section_id ||
        findSectionIdForParagraph(paragraphId);

      const serializedData = {
        ...updates,
        section_id: resolvedSectionId ? String(resolvedSectionId) : undefined,
      };

      enqueuePartialChange({
        type: 'paragraph',
        op: 'update',
        id: resolvedId,
        base_version: paragraph?.version,
        base_last_modified: paragraph?.updated_at || paragraph?.modified_at,
        data: serializedData,
      });
    },
    [findParagraphByAnyId, updateParagraphLocal, enqueuePartialChange, findSectionIdForParagraph]
  );

  const deleteParagraph = useCallback(
    (paragraphId) => {
      const paragraph = findParagraphByAnyId(paragraphId);
      deleteParagraphLocal(paragraphId);

      if (!paragraph?.id) return;

      // Direct API delete — fire-and-forget for robustness
      void (async () => {
        try {
          await paragraphService.deleteParagraph(paragraph.id);
        } catch (error) {
          console.error('Failed to delete paragraph via API:', error);
        }
      })();
    },
    [findParagraphByAnyId, deleteParagraphLocal]
  );

  const reorderParagraphs = useCallback(
    (sectionId, fromIndex, toIndex) => {
      reorderParagraphsLocal(sectionId, fromIndex, toIndex);
    },
    [reorderParagraphsLocal]
  );

  const addLatexCode = useCallback(
    async (sectionId, latexData = {}, options = {}) => {
      if (!sectionId) return null;
      const insertAfter = typeof options.insertAfter === 'number'
        ? options.insertAfter
        : (typeof latexData?.insertAfter === 'number' ? latexData.insertAfter : null);

      const sectionComponentList = (sectionComponents instanceof Map
        ? sectionComponents.get(sectionId)
        : sectionComponents?.[sectionId]) || [];

      const nextOrder = typeof insertAfter === 'number'
        ? insertAfter + 1
        : Math.max(
          -1,
          ...Object.values(sectionLatexCodeBlocks[sectionId] || []).map((item) => item?.order ?? -1),
          ...sectionComponentList.map((component) => component?.order ?? -1)
        ) + 1;

      // 1. POST to server first to get a real UUID
      let saved;
      try {
        saved = await latexCodeService.createLatexCode(sectionId, {
          latex_code: latexData?.latex_code ?? '',
          edited_code: latexData?.edited_code ?? '',
          has_edits: latexData?.has_edits ?? false,
          topic: latexData?.topic ?? '',
          custom_metadata: latexData?.custom_metadata ?? {},
          order: nextOrder,
        });
      } catch (error) {
        console.error('Failed to create latex code via API:', error);
        return null;
      }

      const newLatex = {
        id: saved.id,
        latex_code: latexData?.latex_code ?? '',
        edited_code: latexData?.edited_code ?? '',
        has_edits: latexData?.has_edits ?? false,
        topic: latexData?.topic ?? '',
        custom_metadata: latexData?.custom_metadata ?? {},
        order: nextOrder,
      };

      // 2. Add to local state with the real ID
      const buildNextLatexList = (existing = []) => {
        const bumped = existing.map((item) => {
          const current = item?.order ?? item?.order_index;
          if (typeof insertAfter === 'number' && typeof current === 'number' && current >= nextOrder) {
            return { ...item, order: current + 1, order_index: current + 1 };
          }
          return item;
        });
        const nextList = [...bumped];
        if (typeof insertAfter === 'number') {
          const insertIndex = Math.min(Math.max(insertAfter + 1, 0), nextList.length);
          nextList.splice(insertIndex, 0, { ...newLatex });
        } else {
          nextList.push({ ...newLatex });
        }
        return nextList;
      };

      setSectionLatexCodeBlocks((prev) => ({
        ...prev,
        [sectionId]: buildNextLatexList(prev[sectionId] || []),
      }));

      updateSectionLatexCodesInDocument(sectionId, (current) => buildNextLatexList(current || []));

      setHasChanges(true);
      return newLatex;
    },
    [sectionComponents, sectionLatexCodeBlocks, setSectionLatexCodeBlocks, updateSectionLatexCodesInDocument, setHasChanges]
  );

  /**
   * Add a new LaTeX code block with the AI prompt panel pre-opened.
   * Creates a blank block via addLatexCode, then marks it for AI generation.
   */
  const addAILatexCode = useCallback(
    async (sectionId, options = {}) => {
      const newLatex = await addLatexCode(sectionId, {
        latex_code: '',
        topic: '',
        custom_metadata: { ai_prompt_open: true },
      }, options);
      return newLatex;
    },
    [addLatexCode]
  );

  const updateLatexCode = useCallback(
    (latexId, updates = {}) => {
      const existing = findLatexCodeByAnyId(latexId);
      if (!existing) return;

      const sectionId =
        updates?.section_id ||
        updates?.sectionId ||
        findSectionIdForLatexCode(latexId);

      const nextLatex = {
        ...existing,
        ...updates,
        latex_code: updates?.latex_code ?? updates?.edited_code ?? existing?.latex_code ?? '',
        edited_code: updates?.edited_code ?? updates?.latex_code ?? existing?.edited_code ?? '',
        has_edits: updates?.has_edits ?? true,
      };

      if (sectionId) {
        setSectionLatexCodeBlocks((prev) => ({
          ...prev,
          [sectionId]: (prev?.[sectionId] || []).map((latex) =>
            (latex.id === latexId || latex.client_id === latexId) ? nextLatex : latex
          ),
        }));

        updateSectionLatexCodesInDocument(sectionId, (current) =>
          (current || []).map((latex) =>
            (latex.id === latexId || latex.client_id === latexId) ? nextLatex : latex
          )
        );
      }

      const resolvedId = existing?.id || latexId;
      const resolvedSectionId = sectionId ? String(sectionId) : undefined;

      const serializedData = {
        edited_code: nextLatex.edited_code ?? nextLatex.latex_code ?? '',
        has_edits: true,
        latex_code: nextLatex.latex_code ?? '',
        order: nextLatex.order ?? 0,
        topic: nextLatex.topic ?? '',
        custom_metadata: nextLatex.custom_metadata ?? {},
        section_id: resolvedSectionId,
      };

      enqueuePartialChange({
        type: 'latex_code',
        op: 'update',
        id: resolvedId,
        data: serializedData,
      });

      setHasChanges(true);
    },
    [findLatexCodeByAnyId, findSectionIdForLatexCode, setSectionLatexCodeBlocks, updateSectionLatexCodesInDocument, enqueuePartialChange, setHasChanges]
  );

  const deleteLatexCode = useCallback(
    (latexId) => {
      const existing = findLatexCodeByAnyId(latexId);
      if (!existing) return;

      const sectionId = findSectionIdForLatexCode(latexId);
      if (sectionId) {
        setSectionLatexCodeBlocks((prev) => ({
          ...prev,
          [sectionId]: (prev?.[sectionId] || []).filter(
            (latex) => latex.id !== latexId && latex.client_id !== latexId
          ),
        }));

        updateSectionLatexCodesInDocument(sectionId, (current) =>
          (current || []).filter((latex) => latex.id !== latexId && latex.client_id !== latexId)
        );
      }

      if (existing?.id) {
        // Direct API delete — fire-and-forget for robustness
        void (async () => {
          try {
            await latexCodeService.deleteLatexCode(existing.id);
          } catch (error) {
            console.error('Failed to delete latex code via API:', error);
          }
        })();
      }

      setHasChanges(true);
    },
    [findLatexCodeByAnyId, findSectionIdForLatexCode, setSectionLatexCodeBlocks, updateSectionLatexCodesInDocument, setHasChanges]
  );

  const handleImageDrop = useCallback(
    (...args) => handleImageDropLocal(...args),
    [handleImageDropLocal]
  );

  const extractScorePayload = (response) => response?.score || response?.data?.score || response?.result?.score || response?.score_object || response;

  const handleRunAiScore = useCallback(async ({ raw = false } = {}) => {
    if (!completeDocument?.id) return;
    setActiveSidebar('ai-review');
    setAiScoreLoading(true);
    setAiScoreError(null);
    try {
      const response = await aiService.scoreDocument(completeDocument.id, { raw });
      const score = extractScorePayload(response);
      setAiScore(score);
      setActiveSidebar('ai-review');
    } catch (error) {
      setAiScoreError(error?.response?.data?.detail || error?.message || 'Failed to score document');
    } finally {
      setAiScoreLoading(false);
    }
  }, [completeDocument?.id]);

  const handleFetchAiScore = useCallback(async ({ raw = false } = {}) => {
    if (!completeDocument?.id) return;
    setActiveSidebar('ai-review');
    setAiScoreLoading(true);
    setAiScoreError(null);
    try {
      const response = await aiService.getDocumentScore(completeDocument.id, { raw });
      const score = extractScorePayload(response);
      setAiScore(score);
      setActiveSidebar('ai-review');
    } catch (error) {
      setAiScoreError(error?.response?.data?.detail || error?.message || 'Failed to fetch AI score');
    } finally {
      setAiScoreLoading(false);
    }
  }, [completeDocument?.id, setActiveSidebar]);

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const applyPartialSaveResult = useCallback(
    (result) => {
      if (!result) return;
      const items = [
        ...(Array.isArray(result?.created) ? result.created : []),
        ...(Array.isArray(result?.updated) ? result.updated : []),
      ];
      if (items.length === 0) return;

      const resolveSectionKey = (data) => {
        const candidate = data?.section_id;
        if (!candidate) return null;
        return String(candidate);
      };

      const upsertById = (list, data) => {
        const next = Array.isArray(list) ? [...list] : [];
        const idx = next.findIndex(
          (item) => item?.id === data?.id || item?.client_id === data?.client_id
        );
        const merged = {
          ...(idx >= 0 ? next[idx] : {}),
          ...data,
          id: data?.id ?? (idx >= 0 ? next[idx]?.id : undefined),
          client_id: data?.client_id ?? (idx >= 0 ? next[idx]?.client_id : undefined),
        };
        if (idx >= 0) {
          next[idx] = merged;
        } else {
          next.push(merged);
        }
        return next;
      };

      const updateSectionByKey = (sections, sectionKey, updater) =>
        (sections || []).map((section) => {
          const key = section?.id || section?.client_id;
          if (key === sectionKey) {
            return updater(section);
          }
          if (section?.children?.length) {
            return { ...section, children: updateSectionByKey(section.children, sectionKey, updater) };
          }
          return section;
        });

      items.forEach((item) => {
        const type = item?.type || item?.data?.type;
        const data = item?.data || item;
        if (!type || !data) return;

        if (type === 'section') {
          const id = data?.id || item?.id;
          const clientId = data?.client_id || item?.client_id;
          setCompleteDocument((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              sections: updateSectionByKey(prev.sections, clientId || id, (section) => ({
                ...section,
                ...data,
                id: id || section.id,
                client_id: clientId || section.client_id,
              })),
            };
          });
          if (clientId && id && clientId !== id) {
            setSectionTables((prev) => {
              if (!prev || !prev[clientId]) return prev;
              const { [clientId]: moved, ...rest } = prev;
              return { ...rest, [id]: moved };
            });
            setSectionImageComponents((prev) => {
              if (!prev || !prev[clientId]) return prev;
              const { [clientId]: moved, ...rest } = prev;
              return { ...rest, [id]: moved };
            });
            setSectionDocumentComponents((prev) => {
              if (!prev || !prev[clientId]) return prev;
              const { [clientId]: moved, ...rest } = prev;
              return { ...rest, [id]: moved };
            });
          }
          return;
        }

        const sectionKey = resolveSectionKey(data);
        if (!sectionKey) return;

        if (type === 'paragraph') {
          const normalized = {
            ...data,
            id: data?.id || item?.id,
            client_id: data?.client_id || item?.client_id,
            content: data?.content_text ?? data?.content ?? data?.edited_text ?? '',
            order: data?.order ?? data?.order_index ?? 0,
            style: data?.style ?? 'normal',
            topic: data?.topic ?? '',
            metadata: data?.metadata ?? [],
          };
          setCompleteDocument((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              sections: updateSectionByKey(prev.sections, sectionKey, (section) => ({
                ...section,
                paragraphs: upsertById(section.paragraphs, normalized),
              })),
            };
          });
          return;
        }

        if (type === 'latex_code') {
          const normalized = {
            ...data,
            id: data?.id || item?.id,
            client_id: data?.client_id || item?.client_id,
            latex_code: data?.latex_code ?? data?.edited_code ?? '',
            edited_code: data?.edited_code ?? data?.latex_code ?? '',
            has_edits: data?.has_edits ?? Boolean(data?.edited_code),
            order: data?.order ?? data?.order_index ?? 0,
            topic: data?.topic ?? '',
            custom_metadata: data?.custom_metadata ?? {},
          };
          setSectionLatexCodeBlocks((prev) => ({
            ...prev,
            [sectionKey]: upsertById(prev?.[sectionKey], normalized),
          }));
          setCompleteDocument((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              sections: updateSectionByKey(prev.sections, sectionKey, (section) => ({
                ...section,
                latex_codes: upsertById(section.latex_codes || section.latex_code_components, normalized),
              })),
            };
          });
          return;
        }

        if (type === 'table') {
          const resolvedHeaders = data?.data?.headers ?? data?.column_headers ?? [];
          const resolvedRows = data?.data?.rows ?? data?.table_data ?? [];
          const normalized = {
            ...data,
            id: data?.id || item?.id,
            client_id: data?.client_id || item?.client_id,
            caption: data?.caption ?? data?.title ?? '',
            table_type: data?.table_type ?? data?.type ?? 'data',
            order: data?.order ?? data?.order_index ?? 0,
            num_columns: data?.num_columns ?? resolvedHeaders.length,
            num_rows: data?.num_rows ?? resolvedRows.length,
            column_headers: resolvedHeaders,
            table_data: resolvedRows,
            data: { headers: resolvedHeaders, rows: resolvedRows },
          };
          setSectionTables((prev) => ({
            ...prev,
            [sectionKey]: upsertById(prev?.[sectionKey], normalized),
          }));
          setCompleteDocument((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              sections: updateSectionByKey(prev.sections, sectionKey, (section) => ({
                ...section,
                tables: upsertById(section.tables || section.table_components, normalized),
                table_components: upsertById(section.table_components || section.tables, normalized),
              })),
            };
          });
          return;
        }

        if (type === 'image_component') {
          const normalized = {
            ...data,
            id: data?.id || item?.id,
            client_id: data?.client_id || item?.client_id,
            order: data?.order ?? data?.order_index ?? 0,
          };
          setSectionImageComponents((prev) => ({
            ...prev,
            [sectionKey]: upsertById(prev?.[sectionKey], normalized),
          }));
          setCompleteDocument((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              sections: updateSectionByKey(prev.sections, sectionKey, (section) => ({
                ...section,
                image_components: upsertById(section.image_components, normalized),
              })),
            };
          });
          return;
        }

        if (type === 'file_component') {
          const normalized = {
            ...data,
            id: data?.id || item?.id,
            client_id: data?.client_id || item?.client_id,
            order: data?.order ?? data?.order_index ?? 0,
          };
          setSectionDocumentComponents((prev) => ({
            ...prev,
            [sectionKey]: upsertById(prev?.[sectionKey], normalized),
          }));
          setCompleteDocument((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              sections: updateSectionByKey(prev.sections, sectionKey, (section) => ({
                ...section,
                file_components: upsertById(section.file_components, normalized),
              })),
            };
          });
        }
      });
    },
    [setCompleteDocument, setSectionTables, setSectionLatexCodeBlocks, setSectionImageComponents, setSectionDocumentComponents]
  );

  // ── Wire SaveCoordinator callbacks (must be defined after applyPartialSaveResult) ──
  saveResultCallbackRef.current = (result) => {
    applyPartialSaveResult(result);
    etagAlertRef.current = false;
    setPartialSaveConflict(null);
    const coordinator = saveCoordinatorRef.current;
    setHasChanges(coordinator.size > 0);
  };
  saveErrorCallbackRef.current = (error) => {
    setError(error?.message || 'Auto-save failed');
  };

  const flushPartialSave = useCallback(async () => {
    await saveCoordinatorRef.current.flush();
  }, []);

  const saveActiveParagraphForAi = useCallback(async () => {
    if (!activeEditorNode) return null;
    const container = activeEditorNode.closest?.('[data-metadata-id]');
    const paragraphId = container?.getAttribute?.('data-metadata-id');
    if (!paragraphId) return null;

    const paragraph = findParagraphByAnyId(paragraphId);
    if (!paragraph) return null;

    const serialized = serializePlaceholderHtml(activeEditorNode.innerHTML || '');
    const currentContent = paragraph?.content ?? paragraph?.content_text ?? '';
    if (serialized !== currentContent) {
      updateParagraph(paragraphId, { content: serialized });
      await flushPartialSave();
    }

    return paragraph;
  }, [activeEditorNode, findParagraphByAnyId, updateParagraph, flushPartialSave]);

  const handleResolvePartialConflict = useCallback(async () => {
    saveCoordinatorRef.current.reset();
    setPartialSaveConflict(null);
    etagAlertRef.current = false;
    try {
      await loadCompleteDocument();
      setHasChanges(false);
    } catch (error) {
      setError('Failed to refresh document. Please reload the page.');
    }
  }, [loadCompleteDocument, setHasChanges, setError]);

  // The SaveCoordinator handles debounced auto-flush internally.
  // We only keep a periodic backup interval (every 8s) as a safety net.
  useEffect(() => {
    const interval = setInterval(() => {
      if (saveCoordinatorRef.current.size > 0) {
        saveCoordinatorRef.current.flush();
      }
    }, 8000);

    return () => clearInterval(interval);
  }, []);

  // Dispose the coordinator's internal timer on unmount
  useEffect(() => {
    return () => {
      saveCoordinatorRef.current?.dispose();
    };
  }, []);

  const getSectionMapValue = (mapValue, key) => {
    if (!mapValue || !key) return undefined;
    if (mapValue instanceof Map) return mapValue.get(key);
    return mapValue[key];
  };

  const getComponentsByType = (section, type) => {
    if (!Array.isArray(section?.components)) return [];
    return section.components
      .filter((component) => component?.type === type)
      .map((component) => component?.data || component);
  };

  const resolveSectionList = (mapValue, sectionKey, fallback = []) => {
    const mapped = getSectionMapValue(mapValue, sectionKey);
    if (Array.isArray(mapped)) {
      return mapped.length > 0 ? mapped : fallback;
    }
    return mapped || fallback;
  };

  const hydrateSectionsForSave = useCallback((sections = [], overrides = {}) => {
    const paragraphMap = overrides.sectionParagraphs ?? sectionParagraphs;
  const latexMap = overrides.sectionLatexCodes ?? sectionLatexCodeBlocks;
    const tableMap = overrides.sectionTables ?? sectionTables ?? completeSectionTables;
    const imageMap = overrides.sectionImageComponents ?? sectionImageComponents;
    const fileMap = overrides.sectionDocumentComponents ?? sectionDocumentComponents;

    return sections
      .map((section) => {
        if (!section) return null;
        const sectionKey = section.id || section.client_id;
    const paragraphs = resolveSectionList(paragraphMap, sectionKey, section.paragraphs || []);
    const latexCodes = resolveSectionList(
      latexMap,
      sectionKey,
      section.latex_codes || section.latex_code_components || getComponentsByType(section, 'latex_code')
    );
    const tables = resolveSectionList(tableMap, sectionKey, section.tables || section.table_components || []);
    const images = resolveSectionList(imageMap, sectionKey, section.images || section.image_components || []);
    const fileFallback = section.file_components || section.files || getComponentsByType(section, 'file');
    const files = resolveSectionList(fileMap, sectionKey, fileFallback || []);
    const references = section.section_references || section.references || getComponentsByType(section, 'section_reference');

        const next = {
          ...section,
          paragraphs,
          latex_codes: latexCodes,
          tables,
          images,
          image_components: images,
          file_components: files,
          section_references: references,
        };

        if (section.children?.length) {
          next.children = hydrateSectionsForSave(section.children, overrides);
        }

        return next;
      })
      .filter(Boolean)
  }, [sectionTables, completeSectionTables, sectionDocumentComponents, sectionImageComponents, sectionParagraphs, sectionLatexCodeBlocks]);

  // Golden-path save: flush pending updates via SaveCoordinator.
  // With API-first creates/deletes, all entities already exist in the database
  // with real UUIDs. The only thing left is to flush any queued content updates
  // (paragraph text changes, title edits, reorders, etc.) via partial-save.
  const saveDocumentGoldenPath = useCallback(async (overrides = {}) => {
    if (!completeDocument?.id) return;

    // Save current scroll position
    const scrollPosition = window.scrollY || window.pageYOffset;

    try {
      // Flush any pending SaveCoordinator changes (update-only partial-save)
      if (saveCoordinatorRef.current.size > 0) {
        await saveCoordinatorRef.current.flush();
      }

      setHasChanges(false);
      etagAlertRef.current = false;
    } catch (err) {
      console.error('❌ Golden-path save failed:', err);
      
      // Handle ETag conflict (412 Precondition Failed)
      if (err?.name === 'StaleDataError' || err?.response?.status === 412) {
        if (!etagAlertRef.current) {
          setError('Document is out of sync. Please refresh before saving.');
          setHasChanges(true);
          etagAlertRef.current = true;
        }
      } else {
        // Other errors
        setError(err?.response?.data?.detail || err?.message || 'Save failed');
        setHasChanges(true);
      }
      
      throw err;
    }
  }, [completeDocument, setError, setHasChanges]);

  const saveDocumentAndSync = useCallback(async (overrides = {}) => {
    if (!completeDocument?.id) return;
    await saveDocumentGoldenPath(overrides);
    await loadCompleteDocument();
  }, [completeDocument?.id, saveDocumentGoldenPath, loadCompleteDocument]);

  const saveDocumentWrapper = useCallback(async () => {
    if (!saveDocument || !completeDocument?.id) return;
    await saveDocument();
    await loadCompleteDocument();
  }, [completeDocument?.id, saveDocument, loadCompleteDocument]);
  
  // Workflow state
  const [showWorkflowAssignment, setShowWorkflowAssignment] = useState(false);
  const { user } = useAuth();
  const { workflows, fetchWorkflows, loading: workflowLoading } = useWorkflowStore();
  const workflowsLoading = workflowLoading?.workflows || false;

  // Versioning state
  const [versions, setVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState(null);
  const [versionForm, setVersionForm] = useState({
    version_number: '',
    version_name: '',
    change_summary: '',
    is_major_version: false,
  });

  const normalizeVersions = useCallback((data) => {
    const list = Array.isArray(data)
      ? data
      : data?.versions || data?.results || data?.items || [];
    return (list || []).filter(Boolean);
  }, []);

  const loadVersions = useCallback(async () => {
    if (!completeDocument?.id) return;
    setVersionsLoading(true);
    setVersionsError(null);
    try {
      const data = await documentService.getVersions(completeDocument.id);
      setVersions(normalizeVersions(data));
    } catch (error) {
      setVersionsError(error?.message || 'Failed to load versions');
    } finally {
      setVersionsLoading(false);
    }
  }, [completeDocument?.id, normalizeVersions]);

  const handleCreateVersion = useCallback(async () => {
    if (!completeDocument?.id) return;
    try {
      await documentService.createVersion(completeDocument.id, {
        version_number: versionForm.version_number || undefined,
        version_name: versionForm.version_name || undefined,
        change_summary: versionForm.change_summary || undefined,
        is_major_version: versionForm.is_major_version || false,
      });
      setVersionForm({
        version_number: '',
        version_name: '',
        change_summary: '',
        is_major_version: false,
      });
      await loadVersions();
    } catch (error) {
      setVersionsError(error?.message || 'Failed to create version');
    }
  }, [completeDocument?.id, versionForm, loadVersions]);

  const handleRestoreVersion = useCallback(async (versionId) => {
    if (!completeDocument?.id || !versionId) return;
    try {
      await documentService.restoreVersion(completeDocument.id, versionId);
      await loadCompleteDocument();
      await loadVersions();
      setHasChanges(false);
    } catch (error) {
      setVersionsError(error?.message || 'Failed to restore version');
    }
  }, [completeDocument?.id, loadCompleteDocument, loadVersions, setHasChanges]);

  // Change log state
  const [changeLog, setChangeLog] = useState([]);
  const [changeLogLoading, setChangeLogLoading] = useState(false);
  const [changeLogError, setChangeLogError] = useState(null);
  const [auditTab, setAuditTab] = useState('timeline');
  const [compareVersionId, setCompareVersionId] = useState(null);
  const [compareVersion, setCompareVersion] = useState(null);
  const [compareLeftVersionId, setCompareLeftVersionId] = useState(null);
  const [compareLeftVersion, setCompareLeftVersion] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState(null);

  const loadChangeLog = useCallback(async () => {
    if (!completeDocument?.id) return;
    setChangeLogLoading(true);
    setChangeLogError(null);
    try {
      const data = await documentService.getChangelog(completeDocument.id);
      const entries = Array.isArray(data)
        ? data
        : data?.results || data?.changes || data?.history || [];
      setChangeLog(entries);
    } catch (error) {
      setChangeLogError(error?.message || 'Failed to load history');
    } finally {
      setChangeLogLoading(false);
    }
  }, [completeDocument?.id]);

  const selectCompareVersion = useCallback(async (versionId, { side } = {}) => {
    if (!completeDocument?.id || !versionId) return;
    setCompareLoading(true);
    setCompareError(null);
    setAuditTab('compare');
    if (side === 'left') {
      setCompareLeftVersionId(versionId);
    } else {
      setCompareVersionId(versionId);
    }
    try {
      const response = await documentService.getVersion(completeDocument.id, versionId, {
        include_content: true,
      });
      const selected = response?.version ?? response;
      if (!selected) {
        throw new Error('Selected version not found');
      }
      if (side === 'left') {
        setCompareLeftVersion(selected);
      } else {
        setCompareVersion(selected);
      }
    } catch (error) {
      setCompareError(error?.message || 'Failed to load version for comparison');
    } finally {
      setCompareLoading(false);
    }
  }, [completeDocument?.id]);

  const handleCompareVersion = useCallback(
    (versionId) => selectCompareVersion(versionId, { side: 'right' }),
    [selectCompareVersion]
  );

  const handleCompareLeftVersion = useCallback(
    (versionId) => selectCompareVersion(versionId, { side: 'left' }),
    [selectCompareVersion]
  );

  const handleClearLeftVersion = useCallback(() => {
    setCompareLeftVersionId(null);
    setCompareLeftVersion(null);
  }, []);

  const handleExitCompare = useCallback(() => {
    setCompareVersionId(null);
    setCompareVersion(null);
    setCompareLeftVersionId(null);
    setCompareLeftVersion(null);
    setCompareError(null);
  }, []);

  const buildCompareDocument = useCallback((version) => {
    if (!version) return null;

    const source = version?.version ? version.version : version;

    const tryParse = (maybe) => {
      if (!maybe) return null;
      if (typeof maybe === 'string') {
        // If it's a JSON string, attempt to parse to an object
        try {
          const parsed = JSON.parse(maybe);
          return parsed;
        } catch (e) {
          return null;
        }
      }
      if (typeof maybe === 'object') return maybe;
      return null;
    };

    if (source?.metadata_snapshot?.sections) {
      return {
        ...completeDocument,
        ...source.metadata_snapshot,
        metadata: source.metadata_snapshot.metadata || source.metadata_snapshot.metadata_snapshot,
        stats: source.metadata_snapshot.stats,
      };
    }

    const candidates = [
      'content',
      'document',
      'snapshot',
      'document_snapshot',
      'document_content',
      'data',
      // fallback to the whole version object
    ];

    let content = null;
    for (const key of candidates) {
      if (Object.prototype.hasOwnProperty.call(source, key) && source[key] != null) {
        const parsed = tryParse(source[key]);
        if (parsed) {
          // If parsed/document object itself contains a nested document, prefer that
          if (parsed.document && parsed.document.sections) {
            content = parsed.document;
            break;
          }
          if (Array.isArray(parsed.sections) || parsed.sections) {
            content = parsed;
            break;
          }
        }
      }
    }

    // If still not found, try parsing top-level fields (sometimes API returns a JSON string on the version itself)
    if (!content) {
      const parsedTop = tryParse(source);
      if (parsedTop && (Array.isArray(parsedTop.sections) || parsedTop.sections)) {
        content = parsedTop;
      }
    }

    if (!content) return null;

    return {
      ...completeDocument,
      ...content,
      id: completeDocument?.id || content.id,
      title: content.title || completeDocument?.title,
      metadata: content.metadata || completeDocument?.metadata,
    };
  }, [completeDocument]);

  const compareLeftDocument = useMemo(
    () => buildCompareDocument(compareLeftVersion),
    [buildCompareDocument, compareLeftVersion]
  );

  const compareRightDocument = useMemo(
    () => buildCompareDocument(compareVersion),
    [buildCompareDocument, compareVersion]
  );

  const showCompareView = Boolean(
    compareVersionId || compareLeftVersionId || compareRightDocument || compareLeftDocument
  );

  useEffect(() => {
    if (activeSidebar !== 'audit') return;
    if (auditTab === 'versions' || auditTab === 'compare') {
      loadVersions();
    }
  }, [activeSidebar, auditTab, loadVersions]);

  useEffect(() => {
    if (activeSidebar !== 'audit') return;
    if (auditTab === 'timeline') {
      loadChangeLog();
    }
  }, [activeSidebar, auditTab, loadChangeLog]);
  
  // Filter workflows for this document
  // Convert both to strings for comparison since document ID could be UUID string
  const documentWorkflows = workflows.filter(w => 
    String(w.document) === String(completeDocument?.id)
  );
  
  // Debug logging
  // console.log('📋 Workflow Debug:', {
  //   totalWorkflows: workflows.length,
  //   documentId: completeDocument?.id,
  //   documentWorkflows: documentWorkflows.length,
  //   workflowsLoading,
  //   allWorkflows: workflows.map(w => ({ id: w.id, document: w.document }))
  // });
  
  // Sync Complete API data to component state for PagedDocument compatibility
  // The Complete API hook already builds section-specific maps - use them directly!
  useEffect(() => {
    if (loading || !completeDocument?.id) return;

    const normalizeSectionMap = (value) => {
      if (!value) return {};
      if (value instanceof Map) {
        const obj = {};
        value.forEach((tables, key) => {
          obj[key] = tables;
        });
        return obj;
      }
      if (typeof value === 'object') {
        return value;
      }
      return {};
    };

    const mergeSectionMap = (prev, nextMap) => {
      if (!prev || Object.keys(prev).length === 0) {
        return nextMap;
      }
      const merged = { ...prev };
      Object.entries(nextMap).forEach(([sectionId, items]) => {
        if (Array.isArray(items) && items.length > 0) {
          merged[sectionId] = items;
        } else if (!merged[sectionId]) {
          merged[sectionId] = items || [];
        }
      });
      return merged;
    };
    
    // Use the pre-built maps from Complete API hook
    // These are already in the exact format PagedDocument expects
    if (completeSectionTables) {
      const normalizedTables = normalizeSectionMap(completeSectionTables);
      setSectionTables((prev) => mergeSectionMap(prev, normalizedTables));
    }
    
    if (completeSectionImages) {
      const normalizedImages = normalizeSectionMap(completeSectionImages);
      setSectionImageComponents((prev) => mergeSectionMap(prev, normalizedImages));
    }
    
    if (completeSectionFiles) {
      const normalizedFiles = normalizeSectionMap(completeSectionFiles);
      setSectionDocumentComponents((prev) => mergeSectionMap(prev, normalizedFiles));
    }

    if (completeSectionLatexCodes) {
      const normalizedLatex = normalizeSectionMap(completeSectionLatexCodes);
  setSectionLatexCodeBlocks((prev) => mergeSectionMap(prev, normalizedLatex));
    }
  }, [completeDocument?.id, completeSectionTables, completeSectionImages, completeSectionFiles, completeSectionLatexCodes, loading]);
  
  // Fetch workflows for this document
  useEffect(() => {
    if (completeDocument?.id) {
      fetchWorkflows({ document: completeDocument.id });
    }
  }, [completeDocument?.id, fetchWorkflows]);

  // Document view states based on user role
  const documentViewState = {
    mode: isViewer ? 'view-only' : isCommenter ? 'comment-only' : 'full-edit',
    canEdit: canModifyContent,
    canComment: canComment,
    canShare: canShare,
    canDelete: isOwner,
    showEditTools: !isViewer,
    showCommentTools: isCommenter || isEditor || isOwner,
    showSaveButton: canModifyContent,
    role: role || 'owner'
  };

  const getSectionTypeByDepth = (depth) => {
    const map = ['body', 'clause', 'clause', 'clause', 'clause', 'clause'];
    return map[depth] || 'clause';
  };

  const getDepthIndexForSection = (sectionId) => {
    const recurse = (sections, depthIndex = 0) => {
      for (const section of sections || []) {
        if (section.id === sectionId) return depthIndex;
        if (section.children?.length) {
          const childDepth = recurse(section.children, depthIndex + 1);
          if (typeof childDepth === 'number') return childDepth;
        }
      }
      return null;
    };
    const depth = recurse(completeDocument?.sections || [], 0);
    return typeof depth === 'number' ? depth : 0;
  };

  const flattenStructuredMetadata = useCallback((obj, prefix = '') => {
    if (!obj || typeof obj !== 'object') return {};
    return Object.entries(obj).reduce((acc, [key, value]) => {
      const nextKey = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return { ...acc, ...flattenStructuredMetadata(value, nextKey) };
      }
      // Serialize arrays of objects to readable strings so inputs don't show [object Object]
      if (Array.isArray(value)) {
        const serialized = value
          .map((item) =>
            typeof item === 'object' && item !== null
              ? Object.values(item).filter(Boolean).join(' — ')
              : String(item),
          )
          .join(', ');
        return { ...acc, [nextKey]: serialized };
      }
      return { ...acc, [nextKey]: value };
    }, {});
  }, []);

  const flattenedDocumentMetadata = useMemo(() => (
    flattenStructuredMetadata(documentMetadataStore?.document_metadata || {})
  ), [documentMetadataStore?.document_metadata, flattenStructuredMetadata]);

  const flattenedCustomMetadata = useMemo(() => (
    documentMetadataStore?.custom_metadata || {}
  ), [documentMetadataStore?.custom_metadata]);

  const mergedFlatMetadata = useMemo(() => (
    {
      ...flattenedDocumentMetadata,
      ...flattenedCustomMetadata,
    }
  ), [flattenedDocumentMetadata, flattenedCustomMetadata]);

  const getMetadataForFields = useCallback((fields) => {
    return (fields || []).reduce((acc, field) => {
      acc[field] = mergedFlatMetadata[field] ?? '';
      return acc;
    }, {});
  }, [mergedFlatMetadata]);

  const findSectionByIdInTree = useCallback((sections, sectionId) => {
    for (const section of sections || []) {
      const key = section.id || section.client_id;
      if (key === sectionId) return section;
      if (section.children?.length) {
        const found = findSectionByIdInTree(section.children, sectionId);
        if (found) return found;
      }
    }
    return null;
  }, []);

  const findParagraphByIdInTree = useCallback((sections, paragraphId) => {
    for (const section of sections || []) {
      const paragraphs = section.paragraphs || [];
      for (const paragraph of paragraphs) {
        const key = paragraph.id || paragraph.client_id;
        if (key === paragraphId) return paragraph;
      }
      if (section.children?.length) {
        const found = findParagraphByIdInTree(section.children, paragraphId);
        if (found) return found;
      }
    }
    return null;
  }, []);

  const collectParagraphsFromSection = useCallback((section) => {
    if (!section) return [];
    const paragraphs = [...(section.paragraphs || [])];
    (section.children || []).forEach((child) => {
      paragraphs.push(...collectParagraphsFromSection(child));
    });
    return paragraphs;
  }, []);

  const getScopedMetadataForSidebar = useCallback((payload) => {
    if (!payload?.type) return {};

    if (payload.type === 'table') {
      return payload.metadata || {};
    }

    if (payload.type === 'latex') {
      // Extract [[field]] from the LaTeX code and pre-fill with document metadata
      const latexBlock = findLatexCodeByAnyId(payload.id);
      const latexContent = latexBlock?.latex_code || latexBlock?.edited_code || '';
      const fields = extractPlaceholderFields(latexContent);
      // Merge: document-level values + any previously saved per-block values
      const docValues = fields.length > 0 ? getMetadataForFields(fields) : {};
      const savedValues = payload.metadata || {};
      // Also include any manually-added keys from savedValues not in detected fields
      const allKeys = new Set([...fields, ...Object.keys(savedValues)]);
      const merged = {};
      for (const key of allKeys) {
        merged[key] = savedValues[key] || docValues[key] || '';
      }
      return merged;
    }

    if (payload.type === 'paragraph') {
      const paragraph = findParagraphByIdInTree(completeDocument?.sections || [], payload.id);
      const fields = extractPlaceholderFields(paragraph?.content || '');
      const scopedFields = fields.length > 0 ? fields : Object.keys(mergedFlatMetadata);
      return getMetadataForFields(scopedFields);
    }

    if (payload.type === 'section') {
      const section = findSectionByIdInTree(completeDocument?.sections || [], payload.id);
      const sectionParagraphs = collectParagraphsFromSection(section);
      const fieldSet = new Set();
      sectionParagraphs.forEach((paragraph) => {
        extractPlaceholderFields(paragraph?.content || '').forEach((field) => fieldSet.add(field));
      });
      const scopedFields = fieldSet.size > 0 ? Array.from(fieldSet) : Object.keys(mergedFlatMetadata);
      return getMetadataForFields(scopedFields);
    }

    return mergedFlatMetadata;
  }, [
    collectParagraphsFromSection,
    completeDocument?.sections,
    findLatexCodeByAnyId,
    findParagraphByIdInTree,
    findSectionByIdInTree,
    getMetadataForFields,
    mergedFlatMetadata,
  ]);

  const hideMetadataSidebar = useCallback(() => {
    setMetadataSidebar({
      open: false,
      type: null,
      id: null,
      label: '',
      metadata: {},
    });
    setMetadataConnector(null);
  }, []);

  const openMetadataSidebar = useCallback((payload) => {
    if (!payload?.id || !payload?.type) return;

    const resolvedMetadata = getScopedMetadataForSidebar(payload);

    setMetadataSidebar({
      open: true,
      type: payload.type,
      id: payload.id,
      label: payload.label || '',
      metadata: resolvedMetadata,
    });
    setActiveSidebar('metadata');
  }, [getScopedMetadataForSidebar]);

  // ── Paragraph history sidebar ────────────────────────────────────────
  const openHistorySidebar = useCallback((payload) => {
    if (!payload?.id) return;
    setHistorySidebar({
      open: true,
      paragraphId: payload.id,
      label: payload.label || 'Paragraph',
    });
  }, []);

  const closeHistorySidebar = useCallback(() => {
    setHistorySidebar({ open: false, paragraphId: null, label: '' });
  }, []);

  // ── AI Chat sidebar ────────────────────────────────────────────────
  const openAiChat = useCallback((payload = {}) => {
    setAiChatScope({
      scope: payload.scope || 'document',
      scopeId: payload.scopeId || null,
      scopeLabel: payload.scopeLabel || '',
    });
    setActiveSidebar('ai-chat');
  }, []);

  // Called when AIChatPanel accepts/edits a recommendation —
  // applies directly via frontend partial save (updateParagraph / updateSection)
  // so there is NO second backend AI call; the preview data is used as-is.
  const handleAiChatEdit = useCallback(async (data) => {
    if (!data || data.status !== 'ok') return;

    if (data.scope === 'paragraph' && data.updated) {
      // Single paragraph — use updateParagraph which does
      // updateParagraphLocal + enqueuePartialChange (auto-save)
      updateParagraph(data.scope_id, {
        edited_text: data.updated.edited_text,
        has_edits: true,
      });
    } else if (data.scope === 'table' && data.updated) {
      // Table — find the section that owns this table, then update via handleTableUpdate
      const tableId = data.scope_id;
      const upd = data.updated;

      // Resolve section id — prefer from backend response, fallback to searching sectionTables
      let ownerSectionId = upd.section_id || null;
      if (!ownerSectionId) {
        for (const [secId, tables] of Object.entries(sectionTables)) {
          if ((tables || []).some((t) => String(t.id || t.client_id) === String(tableId))) {
            ownerSectionId = secId;
            break;
          }
        }
      }

      if (ownerSectionId) {
        // Find the existing table to merge with (preserves local fields like order, client_id, etc.)
        const existingTable = (sectionTables[ownerSectionId] || []).find(
          (t) => String(t.id || t.client_id) === String(tableId)
        );

        // Build frontend-compatible table object with data.headers / data.rows format
        const headers = (upd.column_headers || []).map((h) =>
          typeof h === 'object' ? h : { id: String(h), label: String(h) }
        );
        const headerIds = headers.map((h) => h.id || h.label);
        const rows = (upd.table_data || []).map((row) => {
          if (Array.isArray(row)) return row;
          if (row && row.cells) {
            return headerIds.map((colId) => row.cells[colId] ?? '');
          }
          return headerIds.map(() => '');
        });

        const nextTable = {
          ...(existingTable || {}),
          id: tableId,
          caption: upd.title || upd.caption || existingTable?.caption || '',
          title: upd.title || '',
          description: upd.description || '',
          table_type: upd.table_type || existingTable?.table_type || 'data',
          column_headers: upd.column_headers || [],
          table_data: upd.table_data || [],
          num_columns: upd.num_columns || headers.length,
          num_rows: upd.num_rows || rows.length,
          has_edits: true,
          data: {
            headers: headers.map((h) => (typeof h === 'object' ? h.label || h.id : h)),
            rows,
          },
        };

        handleTableUpdateRef.current?.(ownerSectionId, tableId, nextTable);
      } else {
        console.warn('AI table edit: could not find owning section for table', tableId);
      }
    } else if (data.scope === 'section' && data.updated) {
      const upd = data.updated;
      if (upd.paragraphs && Array.isArray(upd.paragraphs)) {
        // Section with paragraphs — update each existing one via partial save
        upd.paragraphs.forEach((p) => {
          if (p.id && !p.is_new) {
            updateParagraph(p.id, {
              edited_text: p.edited_text,
              has_edits: true,
            });
          }
        });

        // New paragraphs proposed by AI → add via addParagraph (local + enqueue)
        upd.paragraphs
          .filter((p) => p.is_new || !p.id)
          .forEach((p) => {
            addParagraph(data.scope_id, {
              edited_text: p.edited_text,
              content_text: p.content_text || p.edited_text,
              has_edits: true,
              order: p.order,
            });
          });
      } else {
        // Section with no paragraphs — update section directly (local + API)
        updateSection(data.scope_id, {
          edited_text: upd.edited_text,
          has_edits: true,
          content_text: upd.content_text,
        });
      }

      // Refresh document from server to ensure full sync after section edits
      try {
        await loadCompleteDocument();
      } catch (err) {
        console.warn('Failed to refresh document after AI edit:', err);
      }
    }
  }, [updateParagraph, updateSection, addParagraph, loadCompleteDocument, sectionTables]);

  const handleHistoryRestored = useCallback((restoredParagraph) => {
    // Update the paragraph in the local document state
    if (!restoredParagraph?.id) return;
    setCompleteDocument((prev) => {
      if (!prev?.sections) return prev;
      const sections = prev.sections.map((section) => ({
        ...section,
        paragraphs: (section.paragraphs || []).map((p) =>
          String(p.id) === String(restoredParagraph.id)
            ? { ...p, content: restoredParagraph.content ?? restoredParagraph.content_text, content_text: restoredParagraph.content_text, edited_text: restoredParagraph.edited_text, has_edits: restoredParagraph.has_edits, topic: restoredParagraph.topic ?? p.topic }
            : p
        ),
      }));
      return { ...prev, sections };
    });
    setHasChanges(true);
  }, []);

  useEffect(() => {
    if (!metadataSidebar.open) return;
    if (metadataSidebar.type === 'paragraph' || metadataSidebar.type === 'section' || metadataSidebar.type === 'latex') {
      const scopedMetadata = getScopedMetadataForSidebar(metadataSidebar);
      setMetadataSidebar((prev) => ({
        ...prev,
        metadata: scopedMetadata,
      }));
    }
  }, [getScopedMetadataForSidebar, metadataSidebar.open, metadataSidebar.type]);

  const closeMetadataSidebar = useCallback(() => {
    hideMetadataSidebar();
    setActiveSidebar((prev) => (prev === 'metadata' ? null : prev));
  }, [hideMetadataSidebar]);

  const updateMetadataConnector = useCallback(() => {
    if (!metadataSidebar.open || !metadataSidebar.id || !metadataSidebar.type || activeSidebar !== 'metadata') {
      setMetadataConnector(null);
      return;
    }

    const container = layoutRef.current;
    const panel = metadataSidebarRef.current;
    const anchor = document.querySelector(
      `[data-metadata-anchor="${metadataSidebar.type}"][data-metadata-id="${metadataSidebar.id}"]`
    );

    if (!container || !panel || !anchor) {
      setMetadataConnector(null);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();

    const startX = anchorRect.right - containerRect.left;
    const startY = anchorRect.top + anchorRect.height / 2 - containerRect.top;
    const endX = panelRect.left - containerRect.left;
    const endY = panelRect.top + panelRect.height / 2 - containerRect.top;

    setMetadataConnector({
      startX,
      startY,
      endX,
      endY,
      width: containerRect.width,
      height: containerRect.height,
    });
  }, [metadataSidebar]);

  useEffect(() => {
    updateMetadataConnector();
  }, [metadataSidebar, updateMetadataConnector]);

  useEffect(() => {
    if (!metadataSidebar.open || activeSidebar !== 'metadata') return;
    const handle = () => updateMetadataConnector();
    const scrollEl = contentScrollRef.current;

    window.addEventListener('resize', handle);
    scrollEl?.addEventListener('scroll', handle, { passive: true });

    return () => {
      window.removeEventListener('resize', handle);
      scrollEl?.removeEventListener('scroll', handle);
    };
  }, [metadataSidebar.open, activeSidebar, updateMetadataConnector]);

  useEffect(() => {
    if (activeSidebar !== 'metadata' && metadataSidebar.open) {
      hideMetadataSidebar();
    }
  }, [activeSidebar, metadataSidebar.open, hideMetadataSidebar]);

  const updateSectionTablesInDocument = useCallback((sectionId, tableUpdater) => {
    setCompleteDocument((prev) => {
      if (!prev) return prev;

      const updateSections = (sections) => (sections || []).map((section) => {
        const key = section.id || section.client_id;
        if (key === sectionId) {
          const currentTables = section.tables || section.table_components || [];
          const nextTables = tableUpdater(currentTables);
          return { ...section, tables: nextTables, table_components: nextTables };
        }
        if (section.children?.length) {
          return { ...section, children: updateSections(section.children) };
        }
        return section;
      });

      return {
        ...prev,
        sections: updateSections(prev.sections || []),
      };
    });
  }, [setCompleteDocument]);

  const updateSectionComponentsInDocument = useCallback((sectionId, componentUpdater) => {
    setCompleteDocument((prev) => {
      if (!prev) return prev;

      const updateSections = (sections) => (sections || []).map((section) => {
        const key = section.id || section.client_id;
        if (key !== sectionId) {
          if (section.children?.length) {
            return { ...section, children: updateSections(section.children) };
          }
          return section;
        }

        const currentComponents = buildSectionComponents(section);
        const nextComponents = componentUpdater(currentComponents).map((component, index) => {
          const updated = { ...component, order: index };
          if (updated.data) {
            updated.data.order = index;
            updated.data.order_index = index;
          }
          return updated;
        });

        const nextParagraphs = nextComponents
          .filter((component) => component.type === 'paragraph')
          .map((component) => component.data);
        const nextLatexCodes = nextComponents
          .filter((component) => component.type === 'latex_code')
          .map((component) => component.data);
        const nextTables = nextComponents
          .filter((component) => component.type === 'table')
          .map((component) => component.data);
        const nextImages = nextComponents
          .filter((component) => component.type === 'image')
          .map((component) => component.data);
        const nextFiles = nextComponents
          .filter((component) => component.type === 'file' || component.type === 'document_reference')
          .map((component) => component.data);
        const nextReferences = nextComponents
          .filter((component) => component.type === 'section_reference')
          .map((component) => component.data);
        const nextComments = nextComponents
          .filter((component) => component.type === 'comment')
          .map((component) => component.data);

        return {
          ...section,
          components: nextComponents,
          paragraphs: nextParagraphs,
          latex_codes: nextLatexCodes,
          tables: nextTables,
          table_components: nextTables,
          image_components: nextImages,
          file_components: nextFiles,
          section_references: nextReferences,
          comments: nextComments,
        };
      });

      return {
        ...prev,
        sections: updateSections(prev.sections || []),
      };
    });
  }, [setCompleteDocument, buildSectionComponents]);

  const updateSectionImageComponentInDocument = useCallback(
    (sectionId, componentId, updates) => {
      if (!sectionId || !componentId) return;
      updateSectionComponentsInDocument(sectionId, (components) =>
        components.map((component) => {
          if (component.type !== 'image') return component;
          const data = component.data || {};
          const dataId = data.id || data.client_id;
          if (dataId !== componentId) return component;
          return {
            ...component,
            data: {
              ...data,
              ...updates,
            },
          };
        })
      );
    },
    [updateSectionComponentsInDocument]
  );

  const handleMetadataSave = useCallback(async (nextMetadata) => {
    if (!metadataSidebar.open || !metadataSidebar.id) return;

    if (metadataSidebar.type === 'section' || metadataSidebar.type === 'paragraph') {
      const previousMetadata = metadataSidebar.metadata || {};
      const removedKeys = Object.keys(previousMetadata).filter((key) => !(key in nextMetadata));

      const documentPayload = {};
      const customPayload = {};

      Object.entries(nextMetadata || {}).forEach(([key, value]) => {
        if (key.includes('.')) {
          documentPayload[key] = value;
        } else {
          customPayload[key] = value;
        }
      });

      try {
        if (Object.keys(documentPayload).length > 0) {
          await uploadDocumentMetadata(id, documentPayload, {
            target: 'document_metadata',
            merge: true,
            createChangelog: true,
          });
        }

        if (Object.keys(customPayload).length > 0) {
          await uploadDocumentMetadata(id, customPayload, {
            target: 'custom_metadata',
            merge: true,
            createChangelog: true,
          });
        }

        const removedDocumentKeys = removedKeys.filter((key) => key.includes('.'));
        const removedCustomKeys = removedKeys.filter((key) => !key.includes('.'));

        if (removedDocumentKeys.length > 0) {
          await metadataService.removeFields(id, removedDocumentKeys, 'document_metadata');
        }

        if (removedCustomKeys.length > 0) {
          await metadataService.removeFields(id, removedCustomKeys, 'custom_metadata');
        }

  await loadDocumentMetadata(id);
  setHasChanges(true);
      } catch (err) {
        console.error('Metadata update failed:', err);
      }
    } else if (metadataSidebar.type === 'table') {
      const tableId = metadataSidebar.id;
      const sectionId = Object.keys(sectionTables || {}).find((key) =>
        (sectionTables[key] || []).some(
          (table) => (table.id || table.client_id) === tableId
        )
      );

      if (sectionId) {
        setSectionTables((prev) => {
          const tables = prev[sectionId] || [];
          const updated = tables.map((table) =>
            (table.id || table.client_id) === tableId
              ? { ...table, metadata: nextMetadata }
              : table
          );
          return { ...prev, [sectionId]: updated };
        });

        updateSectionTablesInDocument(sectionId, (tables) =>
          (tables || []).map((table) =>
            (table.id || table.client_id) === tableId
              ? { ...table, metadata: nextMetadata }
              : table
          )
        );

        setHasChanges(true);
      }
    } else if (metadataSidebar.type === 'latex') {
      const latexId = metadataSidebar.id;
      // Save metadata into the LatexCode's custom_metadata.metadata_values via updateLatexCode
      const existing = findLatexCodeByAnyId(latexId);
      if (existing) {
        updateLatexCode(latexId, {
          custom_metadata: {
            ...(existing.custom_metadata || {}),
            metadata_values: nextMetadata,
          },
        });
      }

      // Also push values to document-level custom_metadata so render can resolve them
      const customPayload = {};
      Object.entries(nextMetadata || {}).forEach(([key, value]) => {
        if (value) customPayload[key] = value;
      });
      if (Object.keys(customPayload).length > 0) {
        try {
          await uploadDocumentMetadata(id, customPayload, {
            target: 'custom_metadata',
            merge: true,
            createChangelog: false,
          });
        } catch (err) {
          console.error('Failed to push LaTeX metadata to document:', err);
        }
      }
      setHasChanges(true);
    }

    setMetadataSidebar((prev) => ({ ...prev, metadata: nextMetadata }));
  }, [
    id,
    metadataSidebar,
    sectionTables,
    updateSectionTablesInDocument,
    findLatexCodeByAnyId,
    updateLatexCode,
    setHasChanges,
    uploadDocumentMetadata,
    loadDocumentMetadata,
  ]);

  const handleAddSubsectionInline = (parentId, currentDepth, insertAfter = -1) => {
    const findParentSection = (sections, targetId) => {
      for (const section of sections || []) {
        if (section.id === targetId || section.client_id === targetId) {
          return section;
        }
        if (section.children?.length) {
          const found = findParentSection(section.children, targetId);
          if (found) return found;
        }
      }
      return null;
    };

    const parentSection = parentId
      ? findParentSection(completeDocument?.sections || [], parentId)
      : null;
    const parentDepthLevel = typeof parentSection?.depth_level === 'number'
      ? parentSection.depth_level
      : (typeof currentDepth === 'number' ? currentDepth + 1 : 1);

    const childDepthLevel = parentDepthLevel + 1;
    const type = getSectionTypeByDepth(Math.max(0, childDepthLevel - 1));

    console.log('🎯 handleAddSubsectionInline:', {
      parentId,
      currentDepth,
      parentDepthLevel,
      childDepthLevel,
      type,
    });

    const insertIndex = typeof insertAfter === 'number' && insertAfter >= 0
      ? insertAfter + 1
      : -1;
    return addSection(type, insertIndex, parentId, childDepthLevel);
  };

  const handleAddSiblingInline = ({ parentId, insertAfter = -1, depth, sectionId }) => {
    const findParentSection = (sections, targetId) => {
      for (const section of sections || []) {
        if (section.id === targetId || section.client_id === targetId) {
          return section;
        }
        if (section.children?.length) {
          const found = findParentSection(section.children, targetId);
          if (found) return found;
        }
      }
      return null;
    };

    const resolveSiblingIndex = () => {
      if (!sectionId) return -1;
      const siblings = parentId
        ? findParentSection(completeDocument?.sections || [], parentId)?.children || []
        : completeDocument?.sections || [];
      return siblings.findIndex(
        (section) => section.id === sectionId || section.client_id === sectionId
      );
    };

    // depth is the CURRENT section's 0-based depth
    // Sibling should have same depth_level
    const depthLevel = depth + 1; // Convert 0-based to 1-based
    const type = getSectionTypeByDepth(depth);
    const resolvedInsertAfter = typeof insertAfter === 'number' && insertAfter >= 0
      ? insertAfter
      : resolveSiblingIndex();
    const insertIndex = typeof resolvedInsertAfter === 'number' && resolvedInsertAfter >= 0
      ? resolvedInsertAfter + 1
      : -1;
    return addSection(type, insertIndex, parentId || null, depthLevel);
  };

  const getImageUrl = useCallback((url) => fixImageUrl(url) || '', []);

  const loadSidebarImages = async (scope = 'document', search = '', type = '') => {
    setLoadingSidebarImages(true);
    try {
      const params = { upload_scope: scope };
      if (scope === 'document' && id) {
        params.document = id;
      }
      if (search.trim()) {
        params.search = search.trim();
      }
      if (type) {
        params.image_type = type;
      }
      const response = await imageService.getImages(params);
      const images = Array.isArray(response) ? response : response?.results || [];
      setSidebarImages(images);
    } catch (err) {
      console.error('Error loading sidebar images:', err);
      setSidebarImages([]);
    } finally {
      setLoadingSidebarImages(false);
    }
  };

  const fetchImageSlots = async () => {
    if (!id || id === 'new') return;
    setImageSlotsLoading(true);
    try {
      const data = await documentService.getImageSlots(id);
      setImageSlots(data.image_slots || []);

      // Update document_metadata locally with the image URL map
      // so the placeholder renderer can resolve [[image:UUID]] to <img> tags
      if (data.image_url_map && Object.keys(data.image_url_map).length > 0) {
        setCompleteDocument((prev) => {
          if (!prev) return prev;
          const urlMap = {};
          for (const [uid, info] of Object.entries(data.image_url_map)) {
            urlMap[uid] = info.url || info;
          }
          const prevMeta = prev.document_metadata || {};
          // Only update if the map actually changed
          const prevUrlMap = prevMeta._image_url_map || {};
          const changed = JSON.stringify(prevUrlMap) !== JSON.stringify(urlMap);
          if (!changed) return prev;
          return {
            ...prev,
            document_metadata: {
              ...prevMeta,
              _image_url_map: urlMap,
            },
          };
        });
      }
    } catch (err) {
      console.error('Error fetching image slots:', err);
      setImageSlots([]);
    } finally {
      setImageSlotsLoading(false);
    }
  };

  const handleMapImage = async (placeholderName, imageId) => {
    try {
      const result = await documentService.mapImage(id, placeholderName, imageId);
      // Refresh image slots
      await fetchImageSlots();
      // Reload document so _image_url_map in metadata is refreshed
      // and paragraph renderers can resolve [[image:UUID]] to <img> tags
      await loadCompleteDocument();
    } catch (err) {
      console.error('Error mapping image:', err);
      alert('Failed to map image. Please try again.');
    }
  };

  const handleImageUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const validationError = validateImageFile(file);
    if (validationError) {
      alert(validationError);
      return;
    }

    setUploadingImage(true);
    try {
      await imageService.uploadImage(file, {
        name: file.name,
        imageType: 'picture',
        documentId: sidebarTab === 'document' ? id : undefined,
        uploadScope: sidebarTab,
        isPublic: sidebarTab === 'team',
      });
      await loadSidebarImages(sidebarTab, imageSearchQuery, imageTypeFilter);
    } catch (err) {
      console.error('Error uploading image:', err);
      alert(err.response?.data?.detail || 'Failed to upload image');
    } finally {
      setUploadingImage(false);
      event.target.value = '';
    }
  };

  // Image handling removed - all done through text editing now

  // Formatting handlers
  const handleApplyFormat = async (formatData) => {
    if (!selectedSection) return;
    
    try {
      const currentFormatting = selectedSection.custom_metadata?.formatting || {};
      const updatedFormatting = { ...currentFormatting, ...formatData };
      
      const sectionKey = selectedSection.id || selectedSection.client_id;
      if (!sectionKey) return;

      await updateSection(sectionKey, {
        custom_metadata: {
          ...selectedSection.custom_metadata,
          formatting: updatedFormatting,
        },
      });

      // Don't reload after edits; rely on local state + bulk save to sync.
    } catch (err) {
      console.error('Error applying format:', err);
      alert('Failed to apply formatting');
    }
  };

  const applyInlineStyle = (style) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      if (activeEditorNode) {
        Object.assign(activeEditorNode.style, style);
      }
      return;
    }
    const range = selection.getRangeAt(0);
    if (range.collapsed) {
      if (activeEditorNode) {
        Object.assign(activeEditorNode.style, style);
      }
      return;
    }

    if (activeEditorNode && !activeEditorNode.contains(selection.anchorNode)) return;

    const span = document.createElement('span');
    Object.assign(span.style, style);

    try {
      range.surroundContents(span);
    } catch (error) {
      const contents = range.extractContents();
      span.appendChild(contents);
      range.insertNode(span);
    }

    selection.removeAllRanges();
    selection.addRange(range);
  };

  const handleRichTextCommand = async (command, value) => {
    if (!activeEditorNode) return;
    activeEditorNode.focus();

    const selection = window.getSelection();
    if ((!selection || selection.rangeCount === 0 || selection.isCollapsed) && formatSelectionRef.current) {
      selection?.removeAllRanges();
      selection?.addRange(formatSelectionRef.current);
    }

    switch (command) {
      case 'bold':
        document.execCommand('bold');
        break;
      case 'italic':
        document.execCommand('italic');
        break;
      case 'underline':
        document.execCommand('underline');
        break;
      case 'unorderedList':
        document.execCommand('insertUnorderedList');
        break;
      case 'orderedList':
        document.execCommand('insertOrderedList');
        break;
      case 'fontSize': {
        setToolbarFontSize(value);
        applyInlineStyle({ fontSize: `${value}px` });

        if (activeEditorNode) {
          const fonts = activeEditorNode.querySelectorAll('font');
          fonts.forEach((node) => {
            const span = document.createElement('span');
            span.style.fontSize = `${value}px`;
            span.innerHTML = node.innerHTML;
            node.replaceWith(span);
          });

          const selection = window.getSelection();
          const anchor = selection?.anchorNode;
          const listItem = anchor ? anchor.parentElement?.closest('li') : null;
          if (listItem) {
            listItem.style.fontSize = `${value}px`;
          }
        }
        break;
      }
      case 'textColor':
        setToolbarTextColor(value);
        document.execCommand('foreColor', false, value);
        break;
      case 'backgroundColor':
        setToolbarBackgroundColor(value);
        document.execCommand('hiliteColor', false, value);
        break;
      case 'opacity':
        setToolbarOpacity(value);
        applyInlineStyle({ opacity: value });
        break;
      case 'copy':
        if (navigator.clipboard?.writeText) {
          const selection = window.getSelection();
          await navigator.clipboard.writeText(selection?.toString() || '');
        } else {
          document.execCommand('copy');
        }
        break;
      case 'paste':
        if (navigator.clipboard?.readText) {
          const pasted = await navigator.clipboard.readText();
          if (pasted) {
            document.execCommand('insertText', false, pasted);
          }
        } else {
          document.execCommand('paste');
        }
        break;
      default:
        break;
    }

    activeEditorNode.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const handleInsertReference = () => {
    setShowReferenceDialog(true);
  };

  const handleOpenTextSearch = () => {
    // Dispatch event to open global text search dialog
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'F',
      shiftKey: true,
      ctrlKey: true,
      metaKey: true
    }));
  };

  const handleAddReference = async (reference) => {
    const targetSection = pendingReferenceSectionId
      ? findSectionByAnyId(pendingReferenceSectionId)
      : selectedSection;
    if (!targetSection) return;
    try {
      const referenceId = reference.id || `temp_ref_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const referenceData = {
        ...reference,
        id: reference.id,
        client_id: reference.client_id || referenceId,
        order: typeof pendingReferenceInsertAfter === 'number'
          ? pendingReferenceInsertAfter + 1
          : reference?.order,
      };

      updateSectionComponentsInDocument(targetSection.id || targetSection.client_id, (components) =>
        insertComponentAt(components, {
          type: 'section_reference',
          data: referenceData,
          id: referenceData.id || referenceData.client_id,
        }, pendingReferenceInsertAfter)
      );

      setHasChanges(true);
      setShowReferenceDialog(false);
      setPendingReferenceSectionId(null);
      setPendingReferenceInsertAfter(null);
    } catch (err) {
      console.error('Error adding reference:', err);
      alert('Failed to add reference');
    }
  };

  const [referencesSidebar, setReferencesSidebar] = useState({ loading: false, items: [], error: null });

  const scrollToSectionTarget = useCallback((sectionId) => {
    if (!sectionId) return;
    const scrollContainer = contentScrollRef.current;
    const target = document.querySelector(`[data-section-id="${sectionId}"]`);
    if (!target) return;
    if (scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const offsetTop = targetRect.top - containerRect.top + scrollContainer.scrollTop;
      const desiredTop = Math.max(0, offsetTop - containerRect.height / 3);
      scrollContainer.scrollTo({ top: desiredTop, behavior: 'smooth' });
    } else {
      try {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) {
        target.scrollIntoView();
      }
    }
    try {
      target.focus?.();
    } catch (e) {}
  }, [contentScrollRef]);

  const handleSectionSelect = (section) => {
    setSelectedSection(section);
    const sectionId = section?.id || section?.client_id;
    if (sectionId) {
      requestAnimationFrame(() => scrollToSectionTarget(sectionId));
    }
  };

  /**
   * Handle section reordering from drag-and-drop
   * Updates local state and marks document as having changes
   */
  const handleSectionReorder = useCallback((reorderedSections) => {
    console.log('🔄 Section reorder triggered:', reorderedSections);
    
    // Update completeDocument with new section order
    if (completeDocument) {
      const updated = {
        ...completeDocument,
        sections: reorderedSections
      };
      
      // Update state through the document editor hook
      // This should mark the document as having changes
      setCompleteDocument(updated);
      
      // Mark as having changes so Save button becomes active
      setHasChanges(true);
      
      console.log('✅ Sections reordered - document marked as dirty');
    }
  }, [completeDocument, setCompleteDocument, setHasChanges]);

  /**
   * Handle table creation (default to a 1x1 table when no data provided)
   */
  const handleCreateTable = useCallback(async (sectionId, tableData = {}) => {
    try {
      const insertAfter = typeof tableData.insertAfter === 'number' ? tableData.insertAfter : null;
      const isDefaultTable = !tableData
        || (Object.keys(tableData).length === 0)
        || (!tableData.title && !tableData.tableType && !tableData.rows && !tableData.columns && !(tableData.columnNames?.length));
      if (isDefaultTable) {
        const dedupeKey = `table:${sectionId}:${insertAfter ?? 'end'}`;
        const now = Date.now();
        const last = recentCreateRef.current.get(dedupeKey);
        if (last && now - last < 400) {
          return null;
        }
        recentCreateRef.current.set(dedupeKey, now);
      }

      const columnCount = Number.isInteger(tableData.columns)
        ? Math.max(1, tableData.columns)
        : (Array.isArray(tableData.columnNames) && tableData.columnNames.length > 0
          ? tableData.columnNames.length
          : 1);
      const headers = Array.isArray(tableData.columnNames) && tableData.columnNames.length > 0
        ? tableData.columnNames
        : Array.from({ length: columnCount }, () => '');
      const rowCount = Number.isInteger(tableData.rows) ? Math.max(1, tableData.rows) : 1;
      const rows = Array.from({ length: rowCount }, () => headers.map(() => ''));

      const sectionComponentList = (sectionComponents instanceof Map
        ? sectionComponents.get(sectionId)
        : sectionComponents?.[sectionId]) || [];
      const nextOrder = typeof insertAfter === 'number'
        ? insertAfter + 1
        : Math.max(
          -1,
          ...Object.values(sectionTables[sectionId] || []).map((t) => t?.order ?? -1),
          ...sectionComponentList.map((component) => component?.order ?? -1)
        ) + 1;

      // 1. POST to server first to get a real UUID
      const saved = await tableService.createTable(sectionId, {
        title: tableData.title || '',
        table_type: tableData.tableType || 'data',
        order: nextOrder,
        num_columns: headers.length,
        num_rows: rows.length,
        column_headers: headers,
        table_data: rows,
        data: { headers, rows },
      });

      const newTable = {
        id: saved.id,
        caption: tableData.title || '',
        title: saved.title ?? tableData.title ?? '',
        table_type: saved.table_type ?? tableData.tableType ?? 'data',
        order: nextOrder,
        data: { headers, rows },
        column_headers: saved.column_headers ?? headers,
        table_data: saved.table_data ?? rows,
      };

      // 2. Add to local state with the real ID
      setSectionTables((prev) => {
        const existing = prev[sectionId] || [];
        const bumped = existing.map((table) => {
          const current = table?.order ?? table?.order_index;
          if (typeof insertAfter === 'number' && typeof current === 'number' && current >= nextOrder) {
            return { ...table, order: current + 1, order_index: current + 1 };
          }
          return table;
        });
        const nextTables = [...bumped];
        if (typeof insertAfter === 'number') {
          const insertIndex = Math.min(Math.max(insertAfter + 1, 0), nextTables.length);
          nextTables.splice(insertIndex, 0, { ...newTable });
        } else {
          nextTables.push({ ...newTable });
        }
        return {
          ...prev,
          [sectionId]: nextTables,
        };
      });

      updateSectionComponentsInDocument(sectionId, (components) =>
        insertComponentAt(components, { type: 'table', data: newTable, id: newTable.id }, insertAfter)
      );

      updateSectionTablesInDocument(sectionId, (tables) => {
        const bumped = (tables || []).map((table) => {
          const current = table?.order ?? table?.order_index;
          if (typeof insertAfter === 'number' && typeof current === 'number' && current >= nextOrder) {
            return { ...table, order: current + 1, order_index: current + 1 };
          }
          return table;
        });
        return [...bumped, { ...newTable }];
      });

      setHasChanges(true);

      return newTable;
    } catch (err) {
      console.error('❌ Error creating table:', err);
      alert(err.message || 'Failed to create table');
      throw err;
    }
  }, [updateSectionTablesInDocument, updateSectionComponentsInDocument, setHasChanges, sectionTables, sectionComponents]);

  /**
   * Handle table updates
   */
  const handleTableUpdate = useCallback((sectionId, tableId, nextTable) => {
    // Always update local state immediately for responsive UI
    setSectionTables((prev) => {
      const tables = prev[sectionId] || [];
      const updated = tables.map((table) =>
        (table.id || table.client_id) === tableId ? nextTable : table
      );
      return { ...prev, [sectionId]: updated };
    });

    updateSectionTablesInDocument(sectionId, (tables) =>
      tables.map((table) =>
        (table.id || table.client_id) === tableId ? nextTable : table
      )
    );

    const resolvedId = tableId;

    // Serialize table data cleanly for the backend
    const headers = nextTable?.data?.headers ?? nextTable?.column_headers ?? [];
    const rows = nextTable?.data?.rows ?? nextTable?.table_data ?? [];
    const captionValue = nextTable?.caption ?? nextTable?.title ?? '';
    const serializedData = {
      title: captionValue,   // backend Table model field
      caption: captionValue, // alias accepted by TableHandler
      table_type: nextTable?.table_type ?? nextTable?.type ?? 'data',
      order: nextTable?.order ?? nextTable?.order_index ?? 0,
      num_columns: headers.length,
      num_rows: rows.length,
      column_headers: headers,
      table_data: rows,
      data: { headers, rows },
      section_id: String(sectionId),
    };

    enqueuePartialChange({
      type: 'table',
      op: 'update',
      id: resolvedId,
      data: serializedData,
    });

    setHasChanges(true);
  }, [updateSectionTablesInDocument, sectionTables, enqueuePartialChange]);
  handleTableUpdateRef.current = handleTableUpdate;

  /**
   * Handle table deletion
   */
  const handleTableDelete = useCallback((sectionId, tableId) => {
    if (!confirm('Are you sure you want to delete this table?')) return;

    const existingTable = (sectionTables[sectionId] || []).find(
      (table) => (table.id || table.client_id) === tableId
    );

    setSectionTables((prev) => ({
      ...prev,
      [sectionId]: (prev[sectionId] || []).filter(
        (table) => (table.id || table.client_id) !== tableId
      ),
    }));

    updateSectionTablesInDocument(sectionId, (tables) =>
      tables.filter((table) => (table.id || table.client_id) !== tableId)
    );

    // Also remove from unified components list
    updateSectionComponentsInDocument(sectionId, (components) =>
      components.filter((component) => {
        if (component.type !== 'table') return true;
        const dataId = component.data?.id || component.data?.client_id || component.id;
        return dataId !== tableId;
      })
    );

    if (existingTable?.id) {
      // Direct API delete — fire-and-forget for robustness
      void (async () => {
        try {
          await tableService.deleteTable(existingTable.id);
        } catch (error) {
          console.error('Failed to delete table via API:', error);
        }
      })();
    }

    setHasChanges(true);
  }, [updateSectionTablesInDocument, updateSectionComponentsInDocument, sectionTables, setHasChanges]);

  /**
   * Handle table reordering (move up/down within a section)
   */
  const handleTableMove = useCallback((sectionId, fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;

    setSectionTables((prev) => {
      const tables = [...(prev[sectionId] || [])].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0)
      );
      if (toIndex < 0 || toIndex >= tables.length) return prev;
      const [moved] = tables.splice(fromIndex, 1);
      tables.splice(toIndex, 0, moved);
      const reordered = tables.map((table, idx) => ({ ...table, order: idx }));
      return { ...prev, [sectionId]: reordered };
    });

    updateSectionTablesInDocument(sectionId, (tables) => {
      const list = [...(tables || [])].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0)
      );
      if (toIndex < 0 || toIndex >= list.length) return list;
      const [moved] = list.splice(fromIndex, 1);
      list.splice(toIndex, 0, moved);
      return list.map((table, idx) => ({ ...table, order: idx }));
    });

    const movedTable = (sectionTables[sectionId] || []).find(
      (_, idx) => idx === fromIndex
    );
    if (movedTable?.id) {
      enqueuePartialChange({
        type: 'table',
        op: 'update',
        id: movedTable.id,
        data: {
          ...movedTable,
          order: toIndex,
          section_id: String(sectionId),
        },
      });
    }

    setHasChanges(true);
  }, [updateSectionTablesInDocument, setHasChanges, sectionTables, enqueuePartialChange]);

  const handleSectionComponentMove = useCallback((sectionId, fromIndex, toIndex) => {
    const section = getSectionById(sectionId);
    if (!section) return;

    const nextComponents = reorderComponents(buildSectionComponents(section), fromIndex, toIndex);

    updateSectionComponentsInDocument(sectionId, () => nextComponents);

    setSectionTables((prev) => ({
      ...prev,
      [sectionId]: nextComponents
        .filter((component) => component.type === 'table')
        .map((component) => component.data),
    }));

  setSectionLatexCodeBlocks((prev) => ({
      ...prev,
      [sectionId]: nextComponents
        .filter((component) => component.type === 'latex_code')
        .map((component) => component.data),
    }));

    setSectionImageComponents((prev) => ({
      ...prev,
      [sectionId]: nextComponents
        .filter((component) => component.type === 'image')
        .map((component) => component.data),
    }));

    setSectionDocumentComponents((prev) => ({
      ...prev,
      [sectionId]: nextComponents
        .filter((component) => component.type === 'file' || component.type === 'document_reference')
        .map((component) => component.data),
    }));

    setHasChanges(true);
  }, [getSectionById, buildSectionComponents, updateSectionComponentsInDocument, setHasChanges, setSectionTables, setSectionLatexCodeBlocks, setSectionImageComponents, setSectionDocumentComponents]);

  const getImageReferenceId = useCallback((image) => {
    if (!image) return null;
    const candidate =
      image.image_reference_id ||
      image.image_reference ||
      image.image_id ||
      image.imageId ||
      image.document_image_id ||
      image.document_image?.id ||
      image.image?.id ||
      image.image?.uuid;

    if (candidate && typeof candidate === 'object') {
      return candidate.id || candidate.uuid || null;
    }

    return candidate || null;
  }, []);

  // REMOVED: buildFullSaveSections, getAllSectionsForSave, saveDocumentComplete flow.
  // Creates/deletes now use direct API calls; updates use SaveCoordinator → partial-save.
  // saveDocumentGoldenPath simply flushes the coordinator.

  /**
   * Handle adding an image from library to the document
   */
  const handleAddImageToDocument = useCallback(async (image, sectionId, order = 0, options = {}) => {
    try {
      const insertAfter = typeof options.insertAfter === 'number' ? options.insertAfter : null;
      const resolvedOrder = typeof insertAfter === 'number' ? insertAfter + 1 : order;

      // 1. POST to server first to get a real UUID
      const saved = await imageComponentService.createImageComponentDirect(sectionId, {
        image_reference_id: image.id,
        caption: image.caption || image.name || '',
        alt_text: image.name || 'Document image',
        component_type: image.image_type || 'figure',
        size_mode: 'medium',
        alignment: 'center',
        order: resolvedOrder,
        show_caption: true,
        show_figure_number: false,
      });

      const componentData = {
        id: saved.id,
        image_reference_id: image.id,
        caption: image.caption || image.name || '',
        alt_text: image.name || 'Document image',
        component_type: image.image_type || 'figure',
        size_mode: 'medium',
        alignment: 'center',
        order: resolvedOrder,
        show_caption: true,
        show_figure_number: false,
        image_url: saved.image_url,
        image_thumbnail_url: saved.image_thumbnail_url,
      };

      // 2. Add to local state with the real ID
      const nextImageMap = {
        ...sectionImageComponents,
        [sectionId]: (sectionImageComponents[sectionId] || []).map((component) => {
          const current = component?.order ?? component?.order_index;
          if (typeof insertAfter === 'number' && typeof current === 'number' && current >= resolvedOrder) {
            return { ...component, order: current + 1, order_index: current + 1 };
          }
          return component;
        })
      };
      const nextImages = [...nextImageMap[sectionId]];
      if (typeof insertAfter === 'number') {
        const insertIndex = Math.min(Math.max(insertAfter + 1, 0), nextImages.length);
        nextImages.splice(insertIndex, 0, componentData);
      } else {
        nextImages.push(componentData);
      }
      nextImageMap[sectionId] = nextImages;

      setSectionImageComponents(nextImageMap);

      updateSectionImageComponentInDocument(sectionId, componentData.id, componentData);

      updateSectionComponentsInDocument(sectionId, (components) =>
        insertComponentAt(components, {
          type: 'image',
          data: componentData,
          id: componentData.id,
        }, insertAfter)
      );

      setHasChanges(true);
      return componentData;
    } catch (err) {
      console.error('❌ Error adding image to document:', err);
      alert(err.response?.data?.detail || 'Failed to add image');
      throw err;
    }
  }, [insertComponentAt, sectionImageComponents, setHasChanges, setSectionImageComponents, updateSectionComponentsInDocument, updateSectionImageComponentInDocument]);

  /**
   * Handle image component updates
   */
  const handleImageComponentUpdate = useCallback(async (componentId, updates, options = {}) => {
    try {
      const findSectionIdByImage = (sections = []) => {
        for (const section of sections) {
          if (!section) continue;
          const sectionKey = section.id || section.client_id;
          const images = section.images || section.image_components || [];
          if (images.some((image) => image?.id === componentId || image?.client_id === componentId)) {
            return sectionKey;
          }
          if (section.children?.length) {
            const childMatch = findSectionIdByImage(section.children);
            if (childMatch) return childMatch;
          }
        }
        return null;
      };

      const sectionId =
        Object.keys(sectionImageComponents).find((sid) =>
          sectionImageComponents[sid]?.some((component) =>
            component?.id === componentId || component?.client_id === componentId
          )
        ) ||
        findSectionIdByImage(completeDocument?.sections || []);

      if (!sectionId) {
        throw new Error('Section not found for image component');
      }

      const nextImageMap = {
        ...sectionImageComponents,
        [sectionId]: (sectionImageComponents[sectionId] || []).map(component =>
          (component.id === componentId || component.client_id === componentId)
            ? { ...component, ...updates }
            : component
        )
      };

      setSectionImageComponents(nextImageMap);

      updateSectionImageComponentInDocument(sectionId, componentId, updates);

      const resolvedId = componentId;
      enqueuePartialChange({
        type: 'image_component',
        op: 'update',
        id: resolvedId,
        data: {
          ...updates,
          section_id: String(sectionId),
        },
      });
      setHasChanges(true);
    } catch (err) {
      console.error('Error updating image component:', err);
      if (!options.silent) {
        alert('Failed to update image');
      }
    }
  }, [completeDocument?.sections, sectionImageComponents, setHasChanges, setSectionImageComponents, updateSectionImageComponentInDocument, enqueuePartialChange, getImageComponentById]);

  const handleOpenImageSidebar = useCallback((sectionId, insertAfter = null) => {
    setPendingImageSectionId(sectionId);
    setPendingImageInsertAfter(insertAfter);
    setActiveSidebar('images');
  }, []);

  /**
   * Handle adding a document file from library to the document
   */
  const handleAddDocumentToDocument = useCallback(async (documentFile, sectionId, order = 0, options = {}) => {
    try {
      const insertAfter = typeof options.insertAfter === 'number' ? options.insertAfter : null;
      const resolvedOrder = typeof insertAfter === 'number' ? insertAfter + 1 : order;

      // 1. POST to server first to get a real UUID
      const saved = await documentFileService.createComponent(sectionId, {
        file_reference_id: documentFile.id,
        label: documentFile.name || documentFile.label,
        description: documentFile.description,
        display_mode: documentFile.file_type === 'pdf' ? 'embed' : 'link',
        order: resolvedOrder,
      });

      const componentWithOrder = {
        id: saved.id,
        file_reference_id: documentFile.id,
        file_reference: documentFile.id,
        file_metadata: {
          file_type: documentFile.file_type,
          file_size_display: documentFile.file_size_display,
          name: documentFile.name,
        },
        file_url: documentFile.file || documentFile.file_url,
        label: documentFile.name || documentFile.label,
        description: documentFile.description,
        display_mode: documentFile.file_type === 'pdf' ? 'pages' : 'link',
        show_description: Boolean(documentFile.description),
        show_file_type: true,
        show_file_size: true,
        show_label: true,
        show_download_link: true,
        show_download_button: true,
        show_preview: documentFile.file_type === 'pdf',
        open_in_new_tab: true,
        download_enabled: true,
        preview_enabled: documentFile.file_type === 'pdf',
        page_range: documentFile.page_range ?? documentFile.pageRange,
        order: resolvedOrder,
      };

      // 2. Add to local state with the real ID
      const nextDocumentMap = {
        ...sectionDocumentComponents,
        [sectionId]: (sectionDocumentComponents[sectionId] || []).map((component) => {
          const current = component?.order ?? component?.order_index;
          if (typeof insertAfter === 'number' && typeof current === 'number' && current >= resolvedOrder) {
            return { ...component, order: current + 1, order_index: current + 1 };
          }
          return component;
        })
      };

      const nextDocuments = [...nextDocumentMap[sectionId]];
      if (typeof insertAfter === 'number') {
        const insertIndex = Math.min(Math.max(insertAfter + 1, 0), nextDocuments.length);
        nextDocuments.splice(insertIndex, 0, componentWithOrder);
      } else {
        nextDocuments.push(componentWithOrder);
      }
      nextDocumentMap[sectionId] = nextDocuments;

      setSectionDocumentComponents(nextDocumentMap);

      updateSectionComponentsInDocument(sectionId, (components) =>
        insertComponentAt(components, {
          type: 'file',
          data: componentWithOrder,
          id: componentWithOrder.id,
        }, insertAfter)
      );

      setHasChanges(true);

      return componentWithOrder;
    } catch (err) {
      console.error('❌ Error adding document to section:', err);
      alert(err.response?.data?.detail || 'Failed to add document');
      throw err;
    }
  }, [insertComponentAt, sectionDocumentComponents, setHasChanges, setSectionDocumentComponents, updateSectionComponentsInDocument]);

  const handleOpenDocumentSidebar = useCallback((sectionId, insertAfter = null) => {
    setPendingDocumentSectionId(sectionId);
    setPendingDocumentInsertAfter(insertAfter);
    setActiveSidebar('documents');
  }, []);

  const handleSidebarImageSelect = useCallback(
    (image) => {
      if (!image) return;
      if (pendingImageSectionId) {
        handleAddImageToDocument(image, pendingImageSectionId, undefined, { insertAfter: pendingImageInsertAfter });
        setPendingImageSectionId(null);
        setPendingImageInsertAfter(null);
      }
      setActiveSidebar('images');
    },
    [handleAddImageToDocument, pendingImageSectionId, pendingImageInsertAfter]
  );

  const handleImageComponentSelect = useCallback((image, element) => {
    setSelectedImageComponent(image);
    if (element?.getBoundingClientRect) {
      setImageToolbarAnchor(element.getBoundingClientRect());
    }
  }, []);

  const handleCloseImageToolbar = useCallback(() => {
    setSelectedImageComponent(null);
    setImageToolbarAnchor(null);
  }, []);

  const handleUpdateSelectedImage = useCallback(
    (updates) => {
      if (!selectedImageComponent) return;
      const componentId = selectedImageComponent.id;
      const sectionId = Object.keys(sectionImageComponents).find((sid) =>
        sectionImageComponents[sid]?.some((component) => component.id === componentId)
      );

      if (sectionId) {
        setSectionImageComponents((prev) => ({
          ...prev,
          [sectionId]: (prev[sectionId] || []).map((component) =>
            component.id === componentId ? { ...component, ...updates } : component
          ),
        }));

        updateSectionImageComponentInDocument(sectionId, componentId, updates);
      }

      setSelectedImageComponent((prev) => (prev ? { ...prev, ...updates } : prev));
      setHasChanges(true);
    },
    [sectionImageComponents, selectedImageComponent, setHasChanges, setSectionImageComponents, updateSectionImageComponentInDocument]
  );

  const handleApplySelectedImage = useCallback(() => {
    if (!selectedImageComponent?.id) return;
    handleImageComponentUpdate(selectedImageComponent.id, { ...selectedImageComponent }, { silent: false });
  }, [handleImageComponentUpdate, selectedImageComponent]);

  /**
   * Handle image component deletion
   */
  const handleImageComponentDelete = useCallback(async (componentId) => {
    try {
      const sectionId = Object.keys(sectionImageComponents).find(sid => 
        sectionImageComponents[sid]?.some(c => c.id === componentId || c.client_id === componentId)
      ) || (() => {
        // Fallback: search the completeDocument tree
        const stack = [...(completeDocument?.sections || [])];
        while (stack.length) {
          const section = stack.shift();
          if (!section) continue;
          const key = section.id || section.client_id;
          const images = section.images || section.image_components || [];
          if (images.some((img) => img?.id === componentId || img?.client_id === componentId)) {
            return key;
          }
          if (section.children?.length) stack.push(...section.children);
        }
        return null;
      })();

      if (!sectionId) {
        throw new Error('Section not found for image component');
      }

      // Remove from local sectionImageComponents state
      const nextImageMap = { ...sectionImageComponents };
      Object.keys(nextImageMap).forEach(sectionKey => {
        nextImageMap[sectionKey] = nextImageMap[sectionKey].filter(c => c.id !== componentId && c.client_id !== componentId);
      });
      setSectionImageComponents(nextImageMap);
      
      // Remove from unified components list
      updateSectionComponentsInDocument(sectionId, (components) =>
        components.filter((component) => {
          if (component.type !== 'image') return true;
          const dataId = component.data?.id || component.data?.client_id;
          return dataId !== componentId;
        })
      );

      // Also update the completeDocument.sections tree for image_components
      setCompleteDocument((prev) => {
        if (!prev) return prev;
        const updateSections = (sections) => (sections || []).map((section) => {
          const key = section.id || section.client_id;
          if (key === sectionId) {
            return {
              ...section,
              image_components: (section.image_components || []).filter(
                (img) => img?.id !== componentId && img?.client_id !== componentId
              ),
              images: (section.images || []).filter(
                (img) => img?.id !== componentId && img?.client_id !== componentId
              ),
            };
          }
          if (section.children?.length) {
            return { ...section, children: updateSections(section.children) };
          }
          return section;
        });
        return { ...prev, sections: updateSections(prev.sections || []) };
      });

      const existing = getImageComponentById?.(componentId);
      if (existing?.id) {
        // Direct API delete — fire-and-forget for robustness
        void (async () => {
          try {
            await imageComponentService.deleteImageComponentDirect(existing.id);
          } catch (error) {
            console.error('Failed to delete image component via API:', error);
          }
        })();
      }

      setHasChanges(true);
    } catch (err) {
      console.error('Error deleting image component:', err);
      alert('Failed to remove image');
    }
  }, [sectionImageComponents, setHasChanges, setSectionImageComponents, updateSectionComponentsInDocument, getImageComponentById]);

  const handleSidebarDocumentSelect = useCallback(
    (documentFile) => {
      if (!documentFile) return;
      if (pendingDocumentSectionId) {
        handleAddDocumentToDocument(documentFile, pendingDocumentSectionId, undefined, { insertAfter: pendingDocumentInsertAfter });
        setPendingDocumentSectionId(null);
        setPendingDocumentInsertAfter(null);
      }
      setActiveSidebar('documents');
    },
    [handleAddDocumentToDocument, pendingDocumentSectionId, pendingDocumentInsertAfter]
  );

  /**
   * Handle document component updates
   */
  const handleDocumentComponentUpdate = useCallback(async (componentId, updates) => {
    try {
      const sectionId = Object.keys(sectionDocumentComponents).find(sid => 
        sectionDocumentComponents[sid]?.some(c => c.id === componentId || c.client_id === componentId)
      );

      if (!sectionId) {
        throw new Error('Section not found for document component');
      }

      const nextDocumentMap = {
        ...sectionDocumentComponents,
        [sectionId]: (sectionDocumentComponents[sectionId] || []).map(component =>
          (component.id === componentId || component.client_id === componentId)
            ? { ...component, ...updates }
            : component
        )
      };

      setSectionDocumentComponents(nextDocumentMap);

      updateSectionComponentsInDocument(sectionId, (components) =>
        components.map((component) => {
          if (component.type !== 'file' && component.type !== 'document_reference') return component;
          const dataId = component.data?.id || component.data?.client_id;
          if (dataId !== componentId) return component;
          return {
            ...component,
            data: { ...component.data, ...updates },
          };
        })
      );

      const resolvedId = componentId;
      enqueuePartialChange({
        type: 'file_component',
        op: 'update',
        id: resolvedId,
        data: {
          ...updates,
          section_id: String(sectionId),
        },
      });

      setHasChanges(true);
    } catch (err) {
      console.error('Error updating document component:', err);
      alert('Failed to update document');
    }
  }, [sectionDocumentComponents, setHasChanges, setSectionDocumentComponents, updateSectionComponentsInDocument, enqueuePartialChange, getFileComponentById]);

  /**
   * Handle document component deletion
   */
  const handleDocumentComponentDelete = useCallback(async (componentId) => {
    try {
      const sectionId = Object.keys(sectionDocumentComponents).find(sid => 
        sectionDocumentComponents[sid]?.some(c => c.id === componentId || c.client_id === componentId)
      ) || (() => {
        // Fallback: search the completeDocument tree
        const stack = [...(completeDocument?.sections || [])];
        while (stack.length) {
          const section = stack.shift();
          if (!section) continue;
          const key = section.id || section.client_id;
          const files = section.file_components || section.files || [];
          if (files.some((f) => f?.id === componentId || f?.client_id === componentId)) {
            return key;
          }
          if (section.children?.length) stack.push(...section.children);
        }
        return null;
      })();

      if (!sectionId) {
        throw new Error('Section not found for document component');
      }

      // Remove from local sectionDocumentComponents state
      const nextDocumentMap = { ...sectionDocumentComponents };
      Object.keys(nextDocumentMap).forEach(sectionKey => {
        nextDocumentMap[sectionKey] = nextDocumentMap[sectionKey].filter(c => c.id !== componentId && c.client_id !== componentId);
      });
      setSectionDocumentComponents(nextDocumentMap);
      
      // Remove from unified components list
      updateSectionComponentsInDocument(sectionId, (components) =>
        components.filter((component) => {
          if (component.type !== 'file' && component.type !== 'document_reference') return true;
          const dataId = component.data?.id || component.data?.client_id;
          return dataId !== componentId;
        })
      );

      // Also update the completeDocument.sections tree for file_components
      setCompleteDocument((prev) => {
        if (!prev) return prev;
        const updateSections = (sections) => (sections || []).map((section) => {
          const key = section.id || section.client_id;
          if (key === sectionId) {
            return {
              ...section,
              file_components: (section.file_components || []).filter(
                (f) => f?.id !== componentId && f?.client_id !== componentId
              ),
              files: (section.files || []).filter(
                (f) => f?.id !== componentId && f?.client_id !== componentId
              ),
            };
          }
          if (section.children?.length) {
            return { ...section, children: updateSections(section.children) };
          }
          return section;
        });
        return { ...prev, sections: updateSections(prev.sections || []) };
      });

      const existing = getFileComponentById?.(componentId);
      if (existing?.id) {
        // Direct API delete — fire-and-forget for robustness
        void (async () => {
          try {
            await documentFileService.deleteComponent(existing.id);
          } catch (error) {
            console.error('Failed to delete file component via API:', error);
          }
        })();
      }

      setHasChanges(true);
    } catch (err) {
      console.error('Error deleting document component:', err);
      alert('Failed to remove document');
    }
  }, [completeDocument?.sections, sectionDocumentComponents, setCompleteDocument, setHasChanges, setSectionDocumentComponents, updateSectionComponentsInDocument, getFileComponentById]);

  useEffect(() => {
    if (activeSidebar === 'images') {
      loadSidebarImages(sidebarTab, imageSearchQuery, imageTypeFilter);
      fetchImageSlots();
    }
    if (activeSidebar === 'properties') {
      fetchImageSlots();
    }
  }, [activeSidebar, sidebarTab, imageTypeFilter]);

  // Fetch image slots on initial document load to populate _image_url_map in metadata
  useEffect(() => {
    if (completeDocument?.id && id && id !== 'new') {
      fetchImageSlots();
    }
  }, [completeDocument?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search for sidebar images
  useEffect(() => {
    if (activeSidebar !== 'images') return;
    const timer = setTimeout(() => {
      loadSidebarImages(sidebarTab, imageSearchQuery, imageTypeFilter);
    }, 300);
    return () => clearTimeout(timer);
  }, [imageSearchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedImageComponent?.id) return;
    const updated = Object.values(sectionImageComponents)
      .flat()
      .find((component) => component.id === selectedImageComponent.id);
    if (updated) {
      setSelectedImageComponent(updated);
    }
  }, [sectionImageComponents, selectedImageComponent?.id]);

  // Notify parent when document ID changes
  useEffect(() => {
    if (onDocumentLoad && id && id !== 'new') {
      onDocumentLoad(id);
    }
  }, [id, onDocumentLoad]);

  // Listen for global text insert events from TextSearchDialog
  useEffect(() => {
    const handleInsertText = (event) => {
      const { text } = event.detail;
      if (!text) return;
      
      // Find the currently focused textarea or the last active textarea
      let textarea = document.activeElement;
      
      // If active element is not a textarea, try to find any textarea with data-paragraph-id
      if (!textarea || textarea.tagName !== 'TEXTAREA') {
        textarea = document.querySelector('textarea[data-paragraph-id]:focus') ||
                   document.querySelector('textarea[data-paragraph-id]');
      }
      
      if (textarea && textarea.tagName === 'TEXTAREA') {
        const start = textarea.selectionStart || 0;
        const end = textarea.selectionEnd || 0;
        const currentText = textarea.value || '';
        
        // Insert text at cursor position
        const newText = currentText.substring(0, start) + text + currentText.substring(end);
        
        // Get paragraph ID from data attribute
        const paragraphId = textarea.getAttribute('data-paragraph-id');
        
        if (paragraphId) {
          // Update the paragraph content
          handleParagraphUpdate(paragraphId, newText);
          
          // Set cursor position after inserted text
          setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(start + text.length, start + text.length);
          }, 0);
        } else {
          // Fallback: just update the textarea value directly
          textarea.value = newText;
          textarea.focus();
          textarea.setSelectionRange(start + text.length, start + text.length);
        }
      }
    };

    window.addEventListener('insertTextFromSearch', handleInsertText);
    return () => window.removeEventListener('insertTextFromSearch', handleInsertText);
  }, []); // No dependencies needed since we're using element queries

  // Keyboard shortcut handler for Cmd+S / Ctrl+S
  useEffect(() => {
    // console.log('🎯 Save keyboard listener attached');
    
    const handleKeyDown = (e) => {
      // Cmd+S (Mac) or Ctrl+S (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        console.log('💾 Save shortcut triggered', { hasChanges, saving });
        if (!hasChanges) {
          console.warn('⚠️ No changes to save');
        } else if (saving) {
          console.warn('⚠️ Already saving...');
        } else {
          saveDocumentAndSync();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      // console.log('🎯 Save keyboard listener removed');
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [hasChanges, saving, saveDocumentGoldenPath]);

  // Global drop handler for creating paragraphs when text is dropped outside textareas
  useEffect(() => {
    const handleGlobalDrop = async (e) => {
      // Check if the drop target is NOT a textarea or inside a textarea container
      const target = e.target;
      const isTextarea = target.tagName === 'TEXTAREA';
      const isInsideTextarea = target.closest('textarea');
  const isInsideParagraphEditor = target.closest('.paragraph-editor-container');
  const sectionContainer = target.closest('[data-section-id]');
      
      // Only handle drops outside of textareas
      if (isTextarea || isInsideTextarea || isInsideParagraphEditor) {
        return;
      }
      
      // Get the dropped text
      const droppedText = e.dataTransfer?.getData('text/plain');
      if (!droppedText) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      console.log('📝 Creating new paragraph with dropped text:', droppedText.substring(0, 50) + '...');
      
      try {
        const targetSectionId = sectionContainer?.getAttribute('data-section-id');
        const fallbackSection = completeDocument?.sections?.[0];

        if (targetSectionId) {
          await addParagraph(targetSectionId, droppedText);
          console.log('✅ Created paragraph in section:', targetSectionId);
        } else if (fallbackSection) {
          await addParagraph(fallbackSection.id, droppedText);
          console.log('✅ Created paragraph in section:', fallbackSection.id);
        } else {
          console.warn('⚠️ No section found to add paragraph');
          alert('Please create a section first before adding paragraphs');
        }
      } catch (error) {
        console.error('❌ Error creating paragraph from drop:', error);
        alert('Failed to create paragraph');
      }
    };
    
    const handleGlobalDragOver = (e) => {
      // Check if we're over a valid drop zone (not a textarea)
      const target = e.target;
      const isTextarea = target.tagName === 'TEXTAREA';
      const isInsideTextarea = target.closest('textarea');
      
      if (!isTextarea && !isInsideTextarea) {
        e.preventDefault(); // Allow drop
      }
    };

    // Add listeners to the document
    document.addEventListener('drop', handleGlobalDrop);
    document.addEventListener('dragover', handleGlobalDragOver);
    
    return () => {
      document.removeEventListener('drop', handleGlobalDrop);
      document.removeEventListener('dragover', handleGlobalDragOver);
    };
  }, [completeDocument, addParagraph]);

  if (creatingDocument || (id === 'new' && !hasCreatedRef.current && loading)) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <RefreshCw className="animate-spin mx-auto mb-4 text-blue-600" size={48} />
          <p className="text-gray-600">{creatingDocument ? 'Creating new document...' : 'Loading complete document...'}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <RefreshCw className="animate-spin mx-auto mb-4 text-blue-600" size={48} />
          <p className="text-gray-600">Loading complete document...</p>
        </div>
      </div>
    );
  }

  if (!completeDocument) return null;

  // Special view-only mode for viewers - use simplified DocumentViewer component
  if (isViewer) {
    const handleExport = async () => {
      try {
        const blob = await documentService.exportDocument(completeDocument.id, 'docx');
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${completeDocument.title || 'document'}.docx`;
        a.click();
      } catch (error) {
        console.error('Export failed:', error);
        alert('Failed to export document');
      }
    };

    const handlePrint = () => {
      window.print();
    };

    return (
      <DocumentViewer
        document={completeDocument}
        pageSettings={{ size: 'a4', orientation: 'portrait' }}
        citationStyle={citationStyle}
        onExport={handleExport}
        onPrint={handlePrint}
        shareInfo={completeDocument?.share_info || { role, shared_by_name: sharePermissions.sharedBy }}
      />
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <DocumentHeader
        navigate={navigate}
        isViewer={isViewer}
        effectiveViewMode={effectiveViewMode}
        isPreviewMode={isPreviewMode}
        setIsPreviewMode={setIsPreviewMode}
  onPreviewClick={handleOpenPdfPreview}
        canModifyContent={canModifyContent}
        addSection={addSection}
        showFormatToolbar={showFormatToolbar}
        setShowFormatToolbar={setShowFormatToolbar}
        loadCompleteDocument={loadCompleteDocument}
        showSectionTree={showSectionTree}
  onToggleSectionTree={handleToggleSectionTree}
        activeSidebar={activeSidebar}
        setActiveSidebar={setActiveSidebar}
        completeDocument={completeDocument}
        citationStyle={citationStyle}
        setCitationStyle={setCitationStyle}
        handleOpenTextSearch={handleOpenTextSearch}
        canShare={canShare}
  saveDocumentGoldenPath={saveDocumentAndSync}
        hasChanges={hasChanges}
        saving={saving}
        lastSaveStatus={lastSaveStatus}
        lastSavedAt={lastSavedAt}
        lastSaveError={lastSaveError}
        documentWorkflows={documentWorkflows}
        stats={stats}
        metadata={metadata}
        aiScoreLoading={aiScoreLoading}
        onRunAiReview={handleRunAiScore}
        onOpenExportStudio={handleOpenExportStudio}
        onOpenAiChat={() => openAiChat({ scope: 'document', scopeId: null, scopeLabel: completeDocument?.title || 'Document' })}
        onRichTextCommand={handleRichTextCommand}
        toolbarTextColor={toolbarTextColor}
        toolbarBackgroundColor={toolbarBackgroundColor}
        toolbarOpacity={toolbarOpacity}
        toolbarFontSize={toolbarFontSize}
        reviewCommentTotalCount={Object.values(reviewCommentCounts).reduce((sum, c) => sum + (c?.total || 0), 0)}
        documentStatus={completeDocument?.status || 'draft'}
        onStatusChange={handleStatusChange}
      />

      {showPdfPreview && pdfPreviewUrl && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-2"
          onClick={() => setShowPdfPreview(false)}
        >
          <div
            className="bg-white rounded-lg h-full w-full shadow-xl flex flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div className="flex items-center gap-3 text-sm font-semibold text-gray-700">
                Preview PDF
                <button
                  onClick={() => window.open(pdfPreviewUrl, '_blank', 'noopener,noreferrer')}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  Open preview
                </button>
                {pdfDownloadUrl && (
                  <button
                    onClick={() => window.open(pdfDownloadUrl, '_blank', 'noopener,noreferrer')}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    Download PDF
                  </button>
                )}
              </div>
              <button
                onClick={() => setShowPdfPreview(false)}
                className="text-gray-500 hover:text-gray-700 px-2 py-1 rounded"
              >
                Close
              </button>
            </div>
            <div className="flex-1 w-full">
              <iframe
                title="Document Preview"
                src={pdfPreviewBlobUrl || pdfPreviewUrl}
                className="w-full h-full border-0"
              />
            </div>
          </div>
        </div>
      )}


      <AccessBanners
        isViewer={isViewer}
        isCommenter={isCommenter}
        completeDocument={completeDocument}
      />

      {partialSaveConflict && (
        <div className="fixed bottom-20 left-4 z-40 bg-yellow-50 border border-yellow-200 text-yellow-900 text-xs px-3 py-2 rounded shadow">
          <div className="font-medium">{partialSaveConflict}</div>
          <button
            onClick={handleResolvePartialConflict}
            className="mt-1 text-yellow-700 hover:text-yellow-900 underline"
          >
            Refresh document
          </button>
        </div>
      )}

  <div className="relative flex-1 overflow-hidden pb-6">
        {!isExportStudio && (
          <div className="absolute bottom-4 left-4 z-40 text-xs text-gray-600 bg-white/90 backdrop-blur px-3 py-1.5 rounded shadow border border-gray-200">
            <div className="font-medium">
              {now.toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </div>
            <div className="text-gray-500">
              {now.toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
              {completeDocument?.metadata?.updated_at && (
                <span className="text-[11px] text-green-800 ml-2">
                  <br />
                  Last saved {new Date(completeDocument.metadata.updated_at).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </div>
          </div>
        )}
        <div
          className={`mx-auto w-full ${isExportStudio ? 'px-32' : 'px-4 md:px-6'} h-full flex flex-col xl:flex-row gap-4 lg:gap-6 relative ${showCompareView ? 'max-w-[98vw]' : ''}`}
          ref={layoutRef}
        >
          {/* Section Tree Panel */}
          {showSectionTree && (
            <div className="w-full md:w-96 lg:w-[440px] min-w-[260px] flex-none bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col resize-x">
              <div className="p-3 border-b border-gray-200 bg-gray-50">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-800">Section Tree</h3>
                  <button
                    onClick={() => setShowSectionTree(false)}
                    className="p-1 hover:bg-gray-200 rounded"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <DocumentSectionTree
                  document={{ title: completeDocument?.title, children: completeDocument?.sections || [] }}
                  maxDepth={10}
                  onSelectSection={handleSectionSelect}
                  selectedSectionId={selectedSection?.id}
                  onAddSection={() => addSection(getSectionTypeByDepth(0), -1, null, 1)}
                  onAddSubsection={handleAddSubsectionInline}
                  onReorderSections={handleSectionReorder}
                  onEditSection={async (sectionId, updates) => {
                    await updateSection(sectionId, updates);
                    // Avoid reload-after-edit: it can reintroduce duplicates/stale subsection trees.
                  }}
                  onDeleteSection={async (sectionId) => {
                    await deleteSection(sectionId);
                    // Avoid reload-after-delete for the same reason; rely on local state.
                  }}
                />
              </div>
            </div>
          )}

          <div
            className={`flex-1 min-w-0 overflow-y-auto overflow-x-auto flex flex-col ${isExportStudio ? 'items-stretch' : 'items-center'} bg-gray-50/60 ${isExportStudio ? 'py-2 md:py-3' : 'py-4 md:py-8'}`}
            ref={contentScrollRef}
            data-document-scroll
          >
            <div
              style={{
                transform: `scale(${pageSettings.zoom / 100})`,
                transformOrigin: 'top center',
                paddingBottom: '100px',
                paddingTop: '20px',
              }}
            >
              {isExportStudio ? (
                <div className="w-full space-y-3">
                  <div
                    ref={pdfPreviewContainerRef}
                    className="relative bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden h-[calc(100vh-220px)]"
                  >
                    {exportPreviewUrl ? (
                      <>
                        <iframe
                          key={exportPreviewKey}
                          title="Export Preview"
                          src={exportPreviewBlobUrl || exportPreviewUrl}
                          className="w-full h-full border-0"
                        />
                        {/* Loading overlay while preview re-generates or settings are saving */}
                        {(exportPreviewLoading || exportSettingsSaving) && (
                          <div className="absolute inset-0 bg-white/70 backdrop-blur-[2px] flex flex-col items-center justify-center z-10">
                            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
                            <span className="mt-3 text-sm font-medium text-gray-600">
                              {exportSettingsSaving ? 'Saving settings…' : 'Refreshing preview…'}
                            </span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="p-6 text-sm text-gray-500">Preview unavailable — missing document id.</div>
                    )}
                  </div>
                </div>
              ) : showCompareView ? (
                <VersionCompareView
                  leftDocument={compareLeftDocument || completeDocument}
                  rightDocument={compareRightDocument || completeDocument}
                  leftVersion={compareLeftVersion}
                  rightVersion={compareVersion}
                  onExit={handleExitCompare}
                  compareLoading={compareLoading}
                  compareError={compareError}
                />
              ) : useTemplateRenderer ? (
                <TemplateRenderer
                  document={completeDocument}
                  templateId={templateId}
                  isPreviewMode={effectiveViewMode}
                  isViewOnly={isViewer}
                  canEdit={canModifyContent}
                  onUpdate={(updates) => {
                    if (!canModifyContent) return;
                    setCompleteDocument((prev) => ({ ...prev, ...updates }));
                    // Persist document-level fields (title, status, etc.) via partial-save
                    const DOC_FIELDS = ['title', 'status', 'document_type', 'author'];
                    const docData = Object.fromEntries(
                      Object.entries(updates).filter(([k]) => DOC_FIELDS.includes(k))
                    );
                    if (Object.keys(docData).length > 0 && completeDocument?.id) {
                      enqueuePartialChange({
                        type: 'document',
                        op: 'update',
                        id: completeDocument.id,
                        data: docData,
                      });
                    }
                    setHasChanges(true);
                  }}
                  onSectionUpdate={updateSection}
                  onSectionDelete={deleteSection}
                  onParagraphUpdate={updateParagraph}
                  onParagraphDelete={deleteParagraph}
                  onLatexCodeUpdate={updateLatexCode}
                  onAddParagraph={addParagraph}
                  onAddSubsection={handleAddSubsectionInline}
                  onAddSiblingSection={handleAddSiblingInline}
                  onImageDrop={handleImageDrop}
                  getImageUrl={getImageUrl}
                  documentId={completeDocument.id}
                  sectionTables={sectionTables}
                  sectionComponents={sectionComponents}
                  onAddTable={(sectionId, tableData) => handleCreateTable(sectionId, tableData)}
                  onTableCreate={handleCreateTable}
                  onTableUpdate={handleTableUpdate}
                  onTableDelete={handleTableDelete}
                  onTableMove={handleTableMove}
                  onComponentMove={handleSectionComponentMove}
                  sectionImageComponents={sectionImageComponents}
                  onAddImageToDocument={handleAddImageToDocument}
                  onOpenImageSidebar={handleOpenImageSidebar}
                  onOpenDocumentSidebar={handleOpenDocumentSidebar}
                  onImageComponentUpdate={handleImageComponentUpdate}
                  onImageComponentDelete={handleImageComponentDelete}
                  onImageComponentSelect={handleImageComponentSelect}
                  selectedImageComponentId={selectedImageComponent?.id}
                  sectionDocumentComponents={sectionDocumentComponents}
                  onAddDocumentToDocument={handleAddDocumentToDocument}
                  onDocumentComponentUpdate={handleDocumentComponentUpdate}
                  onDocumentComponentDelete={handleDocumentComponentDelete}
                  onOpenMetadata={openMetadataSidebar}
                  onAiChat={openAiChat}
                />
              ) : (
                <PagedDocument
                  document={completeDocument}
                  pageSettings={pageSettings}
                  isPreviewMode={effectiveViewMode}
                  isViewOnly={isViewer}
                  canEdit={canModifyContent}
                  citationStyle={citationStyle}
                  onUpdate={(updates) => {
                    if (!canModifyContent) return;
                    setCompleteDocument((prev) => ({ ...prev, ...updates }));
                    // Persist document-level fields (title, status, etc.) via partial-save
                    const DOC_FIELDS = ['title', 'status', 'document_type', 'author'];
                    const docData = Object.fromEntries(
                      Object.entries(updates).filter(([k]) => DOC_FIELDS.includes(k))
                    );
                    if (Object.keys(docData).length > 0 && completeDocument?.id) {
                      enqueuePartialChange({
                        type: 'document',
                        op: 'update',
                        id: completeDocument.id,
                        data: docData,
                      });
                    }
                    setHasChanges(true);
                  }}
                  onSectionUpdate={updateSection}
                  onSectionDelete={deleteSection}
                  onSectionReorder={handleSectionReorder}
                  onParagraphUpdate={updateParagraph}
                  onParagraphDelete={deleteParagraph}
                  onParagraphReorder={reorderParagraphs}
                  onLatexCodeUpdate={updateLatexCode}
                  onLatexCodeDelete={deleteLatexCode}
                  onActiveEditorChange={handleActiveEditorChange}
                  onParagraphAiPartialSave={saveActiveParagraphForAi}
                  onAddParagraph={addParagraph}
                  onAddLatexCode={addLatexCode}
                  onAddAILatexCode={addAILatexCode}
                  onAddSubsection={handleAddSubsectionInline}
                  onAddSiblingSection={handleAddSiblingInline}
                  onImageDrop={handleImageDrop}
                  getImageUrl={getImageUrl}
                  documentId={completeDocument.id}
                  sectionTables={sectionTables}
                  sectionComponents={sectionComponents}
                  onAddTable={(sectionId, tableData) => handleCreateTable(sectionId, tableData)}
                  onTableCreate={handleCreateTable}
                  onTableUpdate={handleTableUpdate}
                  onTableDelete={handleTableDelete}
                  onTableMove={handleTableMove}
                  onComponentMove={handleSectionComponentMove}
                  sectionImageComponents={sectionImageComponents}
                  onAddImageToDocument={handleAddImageToDocument}
                  onOpenImageSidebar={handleOpenImageSidebar}
                  onOpenDocumentSidebar={handleOpenDocumentSidebar}
                  onImageComponentUpdate={handleImageComponentUpdate}
                  onImageComponentDelete={handleImageComponentDelete}
                  onImageComponentSelect={handleImageComponentSelect}
                  selectedImageComponentId={selectedImageComponent?.id}
                  sectionDocumentComponents={sectionDocumentComponents}
                  onAddDocumentToDocument={handleAddDocumentToDocument}
                  onDocumentComponentUpdate={handleDocumentComponentUpdate}
                  onDocumentComponentDelete={handleDocumentComponentDelete}
                  onOpenSectionBrowser={(sectionId, insertAfter = null) => {
                    setPendingReferenceSectionId(sectionId);
                    setPendingReferenceInsertAfter(insertAfter);
                    setActiveSidebar('sections');
                  }}
                  onOpenMetadata={openMetadataSidebar}
                  onOpenHistory={openHistorySidebar}
                  onAiChat={openAiChat}
                  aiReviewCallouts={aiReviewCallouts}
                  reviewCommentCounts={reviewCommentCounts}
                  onOpenReviewComments={handleOpenReviewComments}
                  aiScoringEnabled={aiScoringEnabled}
                  crossRef={crossRefBundle}
                />
              )}
            </div>
          </div>          <div className="w-full xl:w-auto xl:self-stretch">
          <RightSidebar
            activeSidebar={activeSidebar}
            setActiveSidebar={setActiveSidebar}
            metadataSidebar={metadataSidebar}
            metadataSidebarRef={metadataSidebarRef}
            closeMetadataSidebar={closeMetadataSidebar}
            handleMetadataSave={handleMetadataSave}
            metadataViewMode={metadataViewMode}
            setMetadataViewMode={setMetadataViewMode}
            pageSettings={pageSettings}
            setPageSettings={setPageSettings}
            pageDimensions={PAGE_DIMENSIONS}
            typographyScales={TYPOGRAPHY_SCALES}
            sidebarTab={sidebarTab}
            setSidebarTab={setSidebarTab}
            handleImageUpload={handleImageUpload}
            uploadingImage={uploadingImage}
            loadingSidebarImages={loadingSidebarImages}
            sidebarImages={sidebarImages}
            getImageUrl={getImageUrl}
            onSidebarImageSelect={handleSidebarImageSelect}
            pendingImageSectionId={pendingImageSectionId}
            imageSearchQuery={imageSearchQuery}
            imageTypeFilter={imageTypeFilter}
            onImageSearchChange={setImageSearchQuery}
            onImageTypeFilterChange={setImageTypeFilter}
            imageSlots={imageSlots}
            imageSlotsLoading={imageSlotsLoading}
            onMapImage={handleMapImage}
            onRefreshImageSlots={fetchImageSlots}
            onSidebarDocumentSelect={handleSidebarDocumentSelect}
            pendingDocumentSectionId={pendingDocumentSectionId}
            completeDocument={completeDocument}
            referencesSidebar={referencesSidebar}
            documentWorkflows={documentWorkflows}
            workflowsLoading={workflowsLoading}
            setShowWorkflowAssignment={setShowWorkflowAssignment}
            versions={versions}
            versionsLoading={versionsLoading}
            versionsError={versionsError}
            versionForm={versionForm}
            setVersionForm={setVersionForm}
            onCreateVersion={handleCreateVersion}
            onRestoreVersion={handleRestoreVersion}
            changeLog={changeLog}
            changeLogLoading={changeLogLoading}
            changeLogError={changeLogError}
            auditTab={auditTab}
            setAuditTab={setAuditTab}
            onCompareVersion={handleCompareVersion}
            onCompareLeftVersion={handleCompareLeftVersion}
            onClearLeftVersion={handleClearLeftVersion}
            compareVersionId={compareVersionId}
            compareVersion={compareVersion}
            compareLeftVersionId={compareLeftVersionId}
            compareLeftVersion={compareLeftVersion}
            compareLoading={compareLoading}
            compareError={compareError}
            onExitCompare={handleExitCompare}
            canModifyContent={canModifyContent}
            id={id}
            aiScore={aiScore}
            aiScoreLoading={aiScoreLoading}
            aiScoreError={aiScoreError}
            onRunAiReview={handleRunAiScore}
            onFetchAiReview={handleFetchAiScore}
            onOpenAiReview={() => setActiveSidebar('ai-review')}
            exportDraft={exportSettingsDraft}
            exportLoading={exportSettingsLoading}
            exportSaving={exportSettingsSaving}
            exportError={exportSettingsError}
            exportDirty={exportSettingsDirty}
            exportTemplates={exportTemplates}
            exportImages={exportImages}
            exportPdfFiles={exportPdfFiles}
            exportMetadataSnapshot={exportMetadataSnapshot}
            onUpdateExportSetting={updateExportSetting}
            onSaveExportSettings={handleSaveExportSettings}
            onResetExportSettings={handleResetExportSettings}
            onUploadExportImage={handleUploadExportImage}
            onUploadPdfFile={handleUploadPdfFile}
            onSaveHeaderFooterPdf={handleSaveHeaderFooterPdf}
            onRemoveHeaderFooterPdf={handleRemoveHeaderFooterPdf}
            onRefreshExportPreview={refreshExportPreview}
            aiChatScope={aiChatScope.scope}
            aiChatScopeId={aiChatScope.scopeId}
            aiChatScopeLabel={aiChatScope.scopeLabel}
            onAiApplyEdit={handleAiChatEdit}
            focusedReviewElement={focusedReviewElement}
            onClearReviewFocus={handleClearReviewFocus}
            onCommentCountsLoaded={handleCommentCountsLoaded}
            inference={inference}
            crossRef={crossRef}
            inferenceCache={inferenceCache}
          />
          </div>

      {metadataSidebar.open && activeSidebar === 'metadata' && metadataConnector && (
        <svg
          className="pointer-events-none absolute inset-0"
          width={metadataConnector.width}
          height={metadataConnector.height}
          viewBox={`0 0 ${metadataConnector.width} ${metadataConnector.height}`}
        >
          <path
            d={`M ${metadataConnector.startX} ${metadataConnector.startY} C ${metadataConnector.startX + 80} ${metadataConnector.startY}, ${metadataConnector.endX - 80} ${metadataConnector.endY}, ${metadataConnector.endX} ${metadataConnector.endY}`}
            stroke="rgba(79, 70, 229, 0.7)"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      )}
    </div>
    </div>

      {/* Reference Dialog */}
      <ReferenceDialog
        isOpen={showReferenceDialog}
        onClose={() => setShowReferenceDialog(false)}
        availableSections={completeDocument?.sections || []}
        availableParagraphs={completeDocument?.sections?.flatMap((s) =>
          (s.paragraphs || []).map((p) => ({ ...p, section_id: s.id, section_numbering: s.custom_metadata?.numbering, section_title: s.title }))
        ) || []}
        onInsert={handleAddReference}
        sourceSection={selectedSection}
      />

      {/* Share Dialog */}
      {completeDocument?.id && (
        <ShareDialog
          isOpen={showShareDialog}
          onClose={() => setShowShareDialog(false)}
          contentType="document"
          objectId={completeDocument.id}
          contentTitle={completeDocument.title || 'Untitled Document'}
        />
      )}

      {/* Paragraph History Sidebar */}
      <ParagraphHistorySidebar
        isOpen={historySidebar.open}
        paragraphId={historySidebar.paragraphId}
        paragraphLabel={historySidebar.label}
        onClose={closeHistorySidebar}
        onRestored={handleHistoryRestored}
      />

      {error && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-3 z-50">
          <AlertCircle size={20} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-4 hover:bg-red-600 p-1 rounded">
            <X size={18} />
          </button>
        </div>
      )}

      {!isViewer && (
        <FloatingImageToolbar
          isOpen={Boolean(selectedImageComponent)}
          anchorRect={imageToolbarAnchor}
          image={selectedImageComponent}
          onDraftChange={handleUpdateSelectedImage}
          onApply={handleApplySelectedImage}
          onClose={handleCloseImageToolbar}
        />
      )}
      
      {/* Workflow Assignment Modal */}
      {showWorkflowAssignment && completeDocument?.id && (
        <WorkflowAssignment
          documentId={completeDocument.id}
          documentTitle={completeDocument.title || 'Untitled Document'}
          onClose={() => setShowWorkflowAssignment(false)}
          onSuccess={() => {
            setShowWorkflowAssignment(false);
            fetchWorkflows({ document: completeDocument.id });
          }}
        />
      )}
    </div>
  );
};

export default DocumentDrafter;
