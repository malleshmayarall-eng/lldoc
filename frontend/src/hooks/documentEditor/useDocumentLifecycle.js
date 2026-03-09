import { useCallback, useEffect, useState } from 'react';
import documentService from '../../services/documentService';

/**
 * useDocumentLifecycle
 *
 * Handles document loading/saving lifecycle for the editor. This hook is the
 * only place that talks to the document APIs for the editor state, keeping
 * the top-level hook lean and focused on composition.
 *
 * Architecture (2025):
 * - Creates/deletes go through direct REST endpoints (real UUID on creation).
 * - Updates are handled by SaveCoordinator → partial-save (debounced).
 * - The `saveDocument` function here is a lightweight fallback that flushes
 *   any pending document-level metadata. The heavy save-structure flow is removed.
 */
export const useDocumentLifecycle = (documentId) => {
  const [completeDocument, setCompleteDocument] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [lastSaveStatus, setLastSaveStatus] = useState(null);
  const [lastSaveError, setLastSaveError] = useState(null);

  /**
   * Normalize backend data to ensure paragraph 'content' field is populated
   */
  const normalizeDocument = useCallback((doc) => {
    if (!doc) return doc;
    
    const normalizeParagraphs = (paragraphs) => {
      if (!paragraphs) return paragraphs;
      return paragraphs.map(para => {
        // Create clean paragraph with ONLY API fields
        const { content_text, edited_text, ...cleanPara } = para;
        return {
          ...cleanPara,
          // API uses 'content' field - ensure it exists
          content: para.content ?? content_text ?? edited_text ?? '',
          topic: para.topic ?? '',
          metadata: para.metadata ?? [],
        };
      });
    };

    const normalizeLatexCodes = (latexCodes) => {
      if (!latexCodes) return latexCodes;
      return latexCodes.map((item) => {
        const { edited_code, ...rest } = item;
        return {
          ...rest,
          edited_code,
          latex_code: item.latex_code ?? edited_code ?? '',
          topic: item.topic ?? '',
          custom_metadata: item.custom_metadata ?? {},
        };
      });
    };
    
    const normalizeSections = (sections) => {
      if (!sections) return sections;

      const flattenSections = (items, acc = []) => {
        (items || []).forEach((section) => {
          if (!section) return;
          acc.push(section);
          if (section.children && section.children.length > 0) {
            flattenSections(section.children, acc);
          }
        });
        return acc;
      };

      const normalizeSection = (section) => ({
        ...section,
        section_type: section.section_type ?? section.type ?? 'clause',
        metadata: section.metadata ?? [],
        paragraphs: normalizeParagraphs(section.paragraphs),
        latex_codes: normalizeLatexCodes(section.latex_codes || section.latex_code_components || section.latexCodes),
        children: [],
      });

      const flat = flattenSections(sections);
      const byKey = new Map();

      flat.forEach((section) => {
        const key = section.id || section.client_id;
        if (!key) return;
        if (!byKey.has(key)) {
          byKey.set(key, normalizeSection(section));
          return;
        }

        const existing = byKey.get(key);
        byKey.set(key, {
          ...existing,
          ...normalizeSection(section),
          children: existing.children,
        });
      });

      const roots = [];
      const seenChild = new Set();

      byKey.forEach((section) => {
        const parentKey = section.parent;
        if (parentKey && byKey.has(parentKey)) {
          const parent = byKey.get(parentKey);
          const childKey = section.id || section.client_id;
          if (!parent.children.find((child) => (child.id || child.client_id) === childKey)) {
            parent.children.push(section);
          }
          seenChild.add(childKey);
        }
      });

      byKey.forEach((section) => {
        const key = section.id || section.client_id;
        if (!seenChild.has(key)) {
          roots.push(section);
        }
      });

      const sortByOrder = (items) => {
        const sorted = [...(items || [])].sort((a, b) => {
          const ao = typeof a?.order === 'number' ? a.order : 0;
          const bo = typeof b?.order === 'number' ? b.order : 0;
          return ao - bo;
        });
        return sorted.map((item) => ({
          ...item,
          children: sortByOrder(item.children || []),
        }));
      };

      return sortByOrder(roots);
    };
    
    return {
      ...doc,
      sections: normalizeSections(doc.sections),
    };
  }, []);

  /**
   * Fetch the full document structure (sections, paragraphs, tables, etc.).
   */
  const loadCompleteDocument = useCallback(async () => {
    if (!documentId || documentId === 'new') return;

    setLoading(true);
    setError(null);

    try {
      const data = await documentService.fetchCompleteStructure(documentId);
      const normalizedData = normalizeDocument(data);
      
      setCompleteDocument(normalizedData);
      setHasChanges(false);
      setLastSaveStatus('success');
      return normalizedData;
    } catch (err) {
      const errorMsg = err.response?.data?.detail || err.message || 'Failed to load document';
      setError(errorMsg);
      console.error('Failed to load document:', err);
      setLastSaveStatus('error');
      setLastSaveError(errorMsg);
      return null;
    } finally {
      setLoading(false);
    }
  }, [documentId, normalizeDocument]);

  useEffect(() => {
    loadCompleteDocument();
  }, [loadCompleteDocument]);

  /**
   * Persist document-level metadata (title, custom_metadata, etc.).
   * Entity-level creates/deletes are already persisted via direct API calls.
   * Entity-level updates are flushed via the SaveCoordinator elsewhere.
   * This function only handles the top-level document PATCH as a safety net.
   */
  const saveDocument = useCallback(async () => {
    if (!completeDocument?.id || saving) return;

    setSaving(true);
    setError(null);
    setLastSaveStatus('saving');

    try {
      // Light metadata-only PATCH — no more full-tree save-structure POST
      await documentService.updateDocument(completeDocument.id, {
        title: completeDocument.title,
        custom_metadata: completeDocument.custom_metadata,
      });

      setHasChanges(false);
      setLastSavedAt(new Date());
      setLastSaveStatus('success');
      setLastSaveError(null);
    } catch (err) {
      const errorMsg = err.response?.data?.detail || err.message || 'Failed to save document';
      setError(errorMsg);
      setLastSaveStatus('error');
      setLastSaveError(errorMsg);
      console.error('Failed to save document:', err);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [completeDocument, saving]);

  return {
    completeDocument,
    setCompleteDocument,
    loading,
    saving,
    error,
    hasChanges,
    setHasChanges,
    lastSavedAt,
    lastSaveStatus,
    lastSaveError,
    loadCompleteDocument,
    saveDocument,
    setError,
  };
};

export default useDocumentLifecycle;
