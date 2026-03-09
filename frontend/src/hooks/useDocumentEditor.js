import useDocumentActions from './documentEditor/useDocumentActions';
import useDocumentDerivedData from './documentEditor/useDocumentDerivedData';
import useDocumentLifecycle from './documentEditor/useDocumentLifecycle';

/**
 * useDocumentEditor
 *
 * Top-level editor hook that composes lifecycle, derived data, and local CRUD
 * actions into one ergonomic API for the editor screen.
 */
export const useDocumentEditor = (documentId) => {
  // 1) Load/save lifecycle state and helpers.
  const {
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
  } = useDocumentLifecycle(documentId);

  // 2) Derived data (maps, aggregated lists, stats).
  const derived = useDocumentDerivedData(completeDocument);

  // 3) Local CRUD helpers that mutate the in-memory document tree.
  const actions = useDocumentActions({
    completeDocument,
    setCompleteDocument,
    setHasChanges,
    ...derived,
  });

  return {
    // Core state
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

    // Actions
    loadCompleteDocument,
    saveDocument,
    setError,

    // CRUD operations
    ...actions,

    // Computed data
    ...derived,

    // Helper functions
    getComponentsInSection: actions.getComponentsInSection,
    getOrderedComponentsInSection: actions.getOrderedComponentsInSection,
    getSectionById: actions.getSectionById,
    getParagraphById: actions.getParagraphById,
  getLatexCodeById: actions.getLatexCodeById,
    getTableById: actions.getTableById,
    getImageComponentById: actions.getImageComponentById,
    getFileComponentById: actions.getFileComponentById,
  };
};

export default useDocumentEditor;
