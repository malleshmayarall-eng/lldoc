/**
 * useQuickLatex – React hook for Quick LaTeX document state management.
 *
 * Provides list, detail, CRUD, duplicate, AI generation, and placeholder
 * management with built-in loading / error states.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';
import quickLatexService from '../services/quickLatexService';

// ── Reducer ──────────────────────────────────────────────────────────────────

const initialState = {
  documents: [],
  selectedDocument: null,
  placeholders: [],
  imageSlots: [],        // [{ name, mapped_image_id, is_mapped }] from AI-suggested image placeholders
  renderedLatex: null,
  previewPages: [],
  previewPdfUrl: null,
  previewLoading: false,
  previewError: null,
  resolvedImages: {},    // { [imageUuid]: { url, thumbnail_url, name, ... } }
  loading: false,
  saving: false,
  generating: false,
  error: null,
  searchQuery: '',
  chatMessages: {},   // { [documentId]: Message[] }
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload, error: null };
    case 'SET_SAVING':
      return { ...state, saving: action.payload };
    case 'SET_GENERATING':
      return { ...state, generating: action.payload };
    case 'SET_ERROR':
      return { ...state, loading: false, saving: false, generating: false, error: action.payload };
    case 'SET_DOCUMENTS':
      return { ...state, loading: false, documents: action.payload };
    case 'SET_SELECTED':
      return { ...state, loading: false, selectedDocument: action.payload };
    case 'UPDATE_SELECTED':
      return {
        ...state,
        saving: false,
        selectedDocument: action.payload,
        documents: state.documents.map((d) =>
          d.id === action.payload.id ? action.payload : d
        ),
      };
    case 'ADD_DOCUMENT':
      return {
        ...state,
        loading: false,
        documents: [action.payload, ...state.documents],
        selectedDocument: action.payload,
      };
    case 'REMOVE_DOCUMENT':
      return {
        ...state,
        documents: state.documents.filter((d) => d.id !== action.payload),
        selectedDocument:
          state.selectedDocument?.id === action.payload ? null : state.selectedDocument,
      };
    case 'SET_PLACEHOLDERS':
      return { ...state, placeholders: action.payload };
    case 'SET_IMAGE_SLOTS':
      return { ...state, imageSlots: action.payload };
    case 'SET_RENDERED':
      return { ...state, renderedLatex: action.payload };
    case 'SET_PREVIEW_LOADING':
      return { ...state, previewLoading: action.payload, previewError: action.payload ? null : state.previewError };
    case 'SET_PREVIEW':
      return { ...state, previewLoading: false, previewPages: action.payload.pages, previewPdfUrl: action.payload.pdfUrl, previewError: null };
    case 'SET_PREVIEW_ERROR':
      // Keep the previous preview pages so the user can still see the last working render
      return { ...state, previewLoading: false, previewError: action.payload };
    case 'CLEAR_PREVIEW':
      return { ...state, previewPages: [], previewPdfUrl: null, previewError: null };
    case 'SET_SEARCH':
      return { ...state, searchQuery: action.payload };
    case 'SET_RESOLVED_IMAGES':
      return { ...state, resolvedImages: { ...state.resolvedImages, ...action.payload } };
    case 'ADD_CHAT_MESSAGE': {
      const { documentId, message } = action.payload;
      const prev = state.chatMessages[documentId] || [];
      return {
        ...state,
        chatMessages: {
          ...state.chatMessages,
          [documentId]: [...prev, message],
        },
      };
    }
    case 'SET_CHAT': {
      const { documentId, messages } = action.payload;
      return {
        ...state,
        chatMessages: {
          ...state.chatMessages,
          [documentId]: messages,
        },
      };
    }
    case 'CLEAR_CHAT': {
      const { [action.payload]: _, ...rest } = state.chatMessages;
      return { ...state, chatMessages: rest };
    }
    default:
      return state;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export default function useQuickLatex() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const chatSaveTimerRef = useRef(null);

  // Auto-save chat history whenever chatMessages changes (debounced)
  useEffect(() => {
    if (chatSaveTimerRef.current) clearTimeout(chatSaveTimerRef.current);
    const docIds = Object.keys(state.chatMessages);
    if (docIds.length === 0) return;
    chatSaveTimerRef.current = setTimeout(() => {
      docIds.forEach((docId) => {
        const msgs = state.chatMessages[docId];
        if (msgs && msgs.length > 0) {
          const toSave = msgs.slice(-50).map((m) => ({
            ...m,
            code: m.code ? m.code.slice(0, 20000) : undefined,
            previousCode: m.previousCode ? m.previousCode.slice(0, 20000) : undefined,
          }));
          quickLatexService.saveChatHistory(docId, toSave).catch(() => {});
        }
      });
    }, 2000);
    return () => { if (chatSaveTimerRef.current) clearTimeout(chatSaveTimerRef.current); };
  }, [state.chatMessages]);

  // ── List ─────────────────────────────────────────────────────────────

  const fetchDocuments = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const data = await quickLatexService.list();
      dispatch({ type: 'SET_DOCUMENTS', payload: Array.isArray(data) ? data : data.results || [] });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err?.response?.data?.detail || err.message });
    }
  }, []);

  // ── Detail ───────────────────────────────────────────────────────────

  const fetchDocument = useCallback(async (id) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const doc = await quickLatexService.get(id);
      dispatch({ type: 'SET_SELECTED', payload: doc });
      // Auto-load chat history for this document
      quickLatexService.loadChatHistory(id).then((res) => {
        const msgs = res?.messages || [];
        if (msgs.length > 0) {
          dispatch({ type: 'SET_CHAT', payload: { documentId: id, messages: msgs } });
        }
      }).catch(() => {});
      return doc;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err?.response?.data?.detail || err.message });
      return null;
    }
  }, []);

  // ── Create ───────────────────────────────────────────────────────────

  const createDocument = useCallback(async (data) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const doc = await quickLatexService.create(data);
      dispatch({ type: 'ADD_DOCUMENT', payload: doc });
      return doc;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err?.response?.data?.detail || err.message });
      return null;
    }
  }, []);

  // ── Update ───────────────────────────────────────────────────────────

  const updateDocument = useCallback(async (id, data) => {
    dispatch({ type: 'SET_SAVING', payload: true });
    try {
      const doc = await quickLatexService.update(id, data);
      dispatch({ type: 'UPDATE_SELECTED', payload: doc });
      return doc;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err?.response?.data?.detail || err.message });
      return null;
    }
  }, []);

  // ── Delete ───────────────────────────────────────────────────────────

  const deleteDocument = useCallback(async (id) => {
    try {
      await quickLatexService.delete(id);
      dispatch({ type: 'REMOVE_DOCUMENT', payload: id });
      return true;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err?.response?.data?.detail || err.message });
      return false;
    }
  }, []);

  // ── Duplicate ────────────────────────────────────────────────────────

  const duplicateDocument = useCallback(async (id, data = {}) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const result = await quickLatexService.duplicate(id, data);
      if (result?.document) {
        dispatch({ type: 'ADD_DOCUMENT', payload: result.document });
      }
      return result;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err?.response?.data?.detail || err.message });
      return null;
    }
  }, []);

  // ── Bulk Duplicate ───────────────────────────────────────────────────

  const bulkDuplicate = useCallback(async (id, copies) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const result = await quickLatexService.bulkDuplicate(id, copies);
      // Refresh the list to include new documents
      await fetchDocuments();
      return result;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err?.response?.data?.detail || err.message });
      return null;
    }
  }, [fetchDocuments]);

  // ── AI Generate ──────────────────────────────────────────────────────

  const aiGenerate = useCallback(async (id, data) => {
    // Capture code BEFORE AI makes changes (for diff / undo)
    const previousCode = state.selectedDocument?.latex_block?.latex_code
      || state.selectedDocument?.latex_code || '';

    // Add user message to chat
    dispatch({
      type: 'ADD_CHAT_MESSAGE',
      payload: {
        documentId: id,
        message: {
          id: `user-${Date.now()}`,
          role: 'user',
          text: data.prompt,
          mode: data.mode || 'generate',
          timestamp: new Date().toISOString(),
        },
      },
    });

    dispatch({ type: 'SET_GENERATING', payload: true });
    try {
      const result = await quickLatexService.aiGenerate(id, data);
      if (result?.document) {
        dispatch({ type: 'UPDATE_SELECTED', payload: result.document });
      }

      // Add AI response to chat (with previousCode for diff/undo)
      const code = result?.latex_code || result?.document?.latex_block?.latex_code || '';
      const codePreview = code.length > 120 ? code.slice(0, 120) + '…' : code;
      const compStatus = result?.compilation_status;

      dispatch({
        type: 'ADD_CHAT_MESSAGE',
        payload: {
          documentId: id,
          message: {
            id: `ai-${Date.now()}`,
            role: 'assistant',
            text: data.mode === 'edit'
              ? `Changes applied.${codePreview ? ` Updated ${code.split('\\n').length} lines.` : ''}`
              : `Document generated.${codePreview ? ` ${code.split('\\n').length} lines of ${result?.code_type || 'code'}.` : ''}`,
            mode: data.mode || 'generate',
            codeType: result?.code_type,
            code,
            previousCode,
            timestamp: new Date().toISOString(),
          },
        },
      });

      // If compilation failed, add a follow-up message prompting the user
      if (compStatus && !compStatus.compiled) {
        dispatch({
          type: 'ADD_CHAT_MESSAGE',
          payload: {
            documentId: id,
            message: {
              id: `comp-err-${Date.now()}`,
              role: 'assistant',
              text: compStatus.message || 'The generated code has compilation errors.',
              actionRequired: true,
              compilationErrors: {
                errorSummary: compStatus.error_summary,
                errorLines: compStatus.error_lines || [],
                missingPackages: compStatus.missing_packages || [],
              },
              previousCode,
              timestamp: new Date().toISOString(),
            },
          },
        });
      } else if (compStatus?.auto_fixed) {
        dispatch({
          type: 'ADD_CHAT_MESSAGE',
          payload: {
            documentId: id,
            message: {
              id: `comp-fix-${Date.now()}`,
              role: 'assistant',
              text: '⚡ Minor issues in the AI output were automatically corrected.',
              autoFixed: true,
              timestamp: new Date().toISOString(),
            },
          },
        });
      }

      dispatch({ type: 'SET_GENERATING', payload: false });
      return result;
    } catch (err) {
      const errorMsg = err?.response?.data?.message || err?.response?.data?.error || err.message;
      // Add error to chat — prompt user for follow-up action
      dispatch({
        type: 'ADD_CHAT_MESSAGE',
        payload: {
          documentId: id,
          message: {
            id: `err-${Date.now()}`,
            role: 'assistant',
            text: `Failed: ${errorMsg}`,
            error: true,
            actionRequired: true,
            timestamp: new Date().toISOString(),
          },
        },
      });
      dispatch({ type: 'SET_ERROR', payload: errorMsg });
      return null;
    }
  }, [state.selectedDocument]);

  // ── Undo AI Edit ─────────────────────────────────────────────────────

  const undoToMessage = useCallback(async (documentId, messageId, previousCode) => {
    if (!previousCode && previousCode !== '') return null;
    dispatch({ type: 'SET_SAVING', payload: true });
    try {
      const result = await quickLatexService.update(documentId, { latex_code: previousCode });
      dispatch({ type: 'UPDATE_SELECTED', payload: result });
      // Add an undo notice to chat
      dispatch({
        type: 'ADD_CHAT_MESSAGE',
        payload: {
          documentId,
          message: {
            id: `undo-${Date.now()}`,
            role: 'assistant',
            text: 'Reverted to the previous version.',
            mode: 'undo',
            timestamp: new Date().toISOString(),
          },
        },
      });
      return result;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err?.response?.data?.detail || err.message });
      return null;
    }
  }, []);

  // ── Chat Persistence ─────────────────────────────────────────────────

  const saveChatHistory = useCallback(async (documentId) => {
    const messages = state.chatMessages[documentId] || [];
    // Strip large code fields for storage (keep only last 50 messages)
    const toSave = messages.slice(-50).map((m) => ({
      ...m,
      // Keep code for diff/undo but trim if excessively large
      code: m.code ? m.code.slice(0, 20000) : undefined,
      previousCode: m.previousCode ? m.previousCode.slice(0, 20000) : undefined,
    }));
    try {
      await quickLatexService.saveChatHistory(documentId, toSave);
    } catch {
      // Silent fail — chat save is non-critical
    }
  }, [state.chatMessages]);

  const loadChatHistory = useCallback(async (documentId) => {
    try {
      const result = await quickLatexService.loadChatHistory(documentId);
      const messages = result?.messages || [];
      if (messages.length > 0) {
        dispatch({ type: 'SET_CHAT', payload: { documentId, messages } });
      }
    } catch {
      // Silent fail — chat load is non-critical
    }
  }, []);

  const deleteChatHistory = useCallback(async (documentId) => {
    dispatch({ type: 'CLEAR_CHAT', payload: documentId });
    try {
      await quickLatexService.deleteChatHistory(documentId);
    } catch {
      // Silent
    }
  }, []);

  // ── Placeholders ─────────────────────────────────────────────────────

  const fetchPlaceholders = useCallback(async (id) => {
    try {
      const result = await quickLatexService.getPlaceholders(id);
      dispatch({ type: 'SET_PLACEHOLDERS', payload: result?.placeholders || [] });
      dispatch({ type: 'SET_IMAGE_SLOTS', payload: result?.image_slots || [] });
      return result;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err?.response?.data?.detail || err.message });
      return null;
    }
  }, []);

  // ── Metadata ─────────────────────────────────────────────────────────

  const updateMetadata = useCallback(async (id, metadata) => {
    dispatch({ type: 'SET_SAVING', payload: true });
    try {
      const doc = await quickLatexService.updateMetadata(id, metadata);
      dispatch({ type: 'UPDATE_SELECTED', payload: doc });
      return doc;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err?.response?.data?.detail || err.message });
      return null;
    }
  }, []);

  // ── Rendered LaTeX ───────────────────────────────────────────────────

  const fetchRenderedLatex = useCallback(async (id) => {
    try {
      const result = await quickLatexService.getRenderedLatex(id);
      dispatch({ type: 'SET_RENDERED', payload: result });
      return result;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err?.response?.data?.detail || err.message });
      return null;
    }
  }, []);

  // ── Resolve Image Placeholders ───────────────────────────────────────

  const resolveImages = useCallback(async (id, imageIds = null) => {
    try {
      const result = await quickLatexService.resolveImages(id, imageIds);
      if (result?.images) {
        dispatch({ type: 'SET_RESOLVED_IMAGES', payload: result.images });
      }
      return result;
    } catch (err) {
      console.error('Failed to resolve images:', err);
      return null;
    }
  }, []);

  // ── Map Named Image Placeholder → Real Image ─────────────────────────

  const mapImage = useCallback(async (id, placeholderName, imageId = null) => {
    try {
      const result = await quickLatexService.mapImage(id, placeholderName, imageId);
      if (result?.document) {
        dispatch({ type: 'UPDATE_SELECTED', payload: result.document });
      }
      if (result?.image_placeholders) {
        // Refresh image slots from the response
        const slots = Object.entries(result.image_placeholders).map(([name, mappedId]) => ({
          name,
          mapped_image_id: mappedId,
          is_mapped: mappedId !== null,
        }));
        dispatch({ type: 'SET_IMAGE_SLOTS', payload: slots });
      }
      return result;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err?.response?.data?.error || err.message });
      return null;
    }
  }, []);

  // ── Visual Preview (render LaTeX/HTML → PNG/PDF) ──────────────────────

  /**
   * Render preview — routes to LaTeX or HTML render endpoint based on code_type.
   * For HTML, also stores the raw HTML in state for instant iframe preview.
   * @param {string} documentId
   * @param {string} code
   * @param {Object} metadata
   * @param {string} codeType - 'latex' | 'html'
   * @param {Object} [processingSettings] - Export studio settings (margins, headers, footers, layout)
   */
  const renderPreview = useCallback(async (documentId, code, metadata = {}, codeType = 'latex', processingSettings = null) => {
    if (!documentId || !code) return null;
    dispatch({ type: 'SET_PREVIEW_LOADING', payload: true });
    try {
      let result;
      if (codeType === 'html') {
        result = await quickLatexService.renderHtmlPreview(documentId, {
          html_code: code,
          metadata,
          ...(processingSettings ? { processing_settings: processingSettings } : {}),
        });
      } else {
        const needsTikz = /\\begin\{tikzpicture\}|\\usetikzlibrary/.test(code);
        const preamble = needsTikz ? '\\usepackage{tikz}' : undefined;
        result = await quickLatexService.renderPreview(documentId, {
          latex_code: code,
          preamble,
          metadata,
          ...(processingSettings ? { processing_settings: processingSettings } : {}),
        });
      }
      if (result?.error) throw new Error(result.error);
      // Build array of page data URIs from preview_pages (multi-page) or fallback to preview_png_base64
      const rawPages = result?.preview_pages || [];
      const pages = rawPages.length > 0
        ? rawPages.map((b64) => `data:image/png;base64,${b64}`)
        : result?.preview_png_base64
          ? [`data:image/png;base64,${result.preview_png_base64}`]
          : [];
      const pdf = result?.pdf_base64 || result?.pdf || null;
      let pdfUrl = null;
      if (pdf) {
        const binary = atob(pdf);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        pdfUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      }
      dispatch({
        type: 'SET_PREVIEW',
        payload: {
          pages,
          pdfUrl,
        },
      });

      // Auto-save the PDF to the server (fire-and-forget)
      if (pdf && documentId) {
        quickLatexService.savePdf(documentId, { pdf_base64: pdf }).catch(() => {});
      }

      return result;
    } catch (err) {
      const data = err?.response?.data || {};
      const errorPayload = {
        message: data.error || data.detail || err?.message || 'Preview render failed',
        errorLines: data.error_lines || [],       // [{line, message, context}]
        missingPackages: data.missing_packages || [],
        rawErrors: data.raw_errors || [],
        memoryError: data.memory_error || false,
        hint: data.hint || null,
      };
      dispatch({ type: 'SET_PREVIEW_ERROR', payload: errorPayload });
      return null;
    }
  }, []);

  const clearPreview = useCallback(() => {
    dispatch({ type: 'CLEAR_PREVIEW' });
  }, []);

  // ── Switch code type ─────────────────────────────────────────────────

  const switchCodeType = useCallback(async (id, codeType, convert = false) => {
    dispatch({ type: 'SET_SAVING', payload: true });
    try {
      const result = await quickLatexService.switchCodeType(id, {
        code_type: codeType,
        convert,
      });
      if (result?.document) {
        dispatch({ type: 'UPDATE_SELECTED', payload: result.document });
      }
      dispatch({ type: 'CLEAR_PREVIEW' });
      return result;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err?.response?.data?.error || err.message });
      return null;
    }
  }, []);

  // ── Search ───────────────────────────────────────────────────────────

  const setSearch = useCallback((query) => {
    dispatch({ type: 'SET_SEARCH', payload: query });
  }, []);

  // Select document
  const selectDocument = useCallback((doc) => {
    dispatch({ type: 'SET_SELECTED', payload: doc });
  }, []);

  // Clear selection
  const clearSelection = useCallback(() => {
    dispatch({ type: 'SET_SELECTED', payload: null });
    dispatch({ type: 'SET_PLACEHOLDERS', payload: [] });
    dispatch({ type: 'SET_IMAGE_SLOTS', payload: [] });
    dispatch({ type: 'SET_RENDERED', payload: null });
  }, []);

  // Clear chat history for a document
  const clearChat = useCallback((documentId) => {
    dispatch({ type: 'CLEAR_CHAT', payload: documentId });
  }, []);

  // Get chat messages for a specific document
  const getChatMessages = useCallback(
    (documentId) => state.chatMessages[documentId] || [],
    [state.chatMessages]
  );

  return {
    ...state,
    fetchDocuments,
    fetchDocument,
    createDocument,
    updateDocument,
    deleteDocument,
    duplicateDocument,
    bulkDuplicate,
    aiGenerate,
    undoToMessage,
    saveChatHistory,
    loadChatHistory,
    deleteChatHistory,
    fetchPlaceholders,
    updateMetadata,
    fetchRenderedLatex,
    resolveImages,
    mapImage,
    renderPreview,
    clearPreview,
    switchCodeType,
    setSearch,
    selectDocument,
    clearSelection,
    clearChat,
    getChatMessages,
  };
}
