export const QUICK_LATEX_ROUTE = '/quick-latex';

export function getDocumentEditorRoute(documentOrId, options = {}) {
  const { fallback = null } = options;

  if (!documentOrId) {
    return fallback;
  }

  if (typeof documentOrId === 'string') {
    return `/drafter/${documentOrId}`;
  }

  const documentId = documentOrId.id || documentOrId.document_id;
  if (!documentId) {
    return fallback;
  }

  if (documentOrId.document_mode === 'quick_latex') {
    return `${QUICK_LATEX_ROUTE}?document=${documentId}`;
  }

  return `/drafter/${documentId}`;
}

export function openDocumentInEditor(navigate, documentOrId, navigateOptions) {
  const route = getDocumentEditorRoute(documentOrId);
  if (!route) {
    return null;
  }

  navigate(route, navigateOptions);
  return route;
}