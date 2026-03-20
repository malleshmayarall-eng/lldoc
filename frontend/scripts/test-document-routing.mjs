import assert from 'node:assert/strict';
import {
  QUICK_LATEX_ROUTE,
  getDocumentEditorRoute,
  openDocumentInEditor,
} from '../src/utils/documentRouting.js';

const quickDoc = { id: 'quick-123', document_mode: 'quick_latex' };
const standardDoc = { id: 'std-123', document_mode: 'standard' };

assert.equal(
  getDocumentEditorRoute(quickDoc),
  `${QUICK_LATEX_ROUTE}?document=${quickDoc.id}`,
  'quick_latex documents should resolve to the Quick LaTeX editor route',
);

assert.equal(
  getDocumentEditorRoute(standardDoc),
  `/drafter/${standardDoc.id}`,
  'standard documents should resolve to the standard drafter route',
);

assert.equal(
  getDocumentEditorRoute('plain-id'),
  '/drafter/plain-id',
  'string ids should preserve the standard drafter route fallback',
);

let navigatedTo = null;
let navigateOptions = null;
const navigate = (route, options) => {
  navigatedTo = route;
  navigateOptions = options;
};

openDocumentInEditor(navigate, quickDoc, { replace: true });
assert.equal(
  navigatedTo,
  `${QUICK_LATEX_ROUTE}?document=${quickDoc.id}`,
  'openDocumentInEditor should navigate quick documents to Quick LaTeX',
);
assert.deepEqual(navigateOptions, { replace: true });

console.log('documentRouting tests passed');
