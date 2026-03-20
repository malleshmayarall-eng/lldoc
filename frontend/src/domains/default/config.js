/**
 * Default domain configuration
 *
 * This is the baseline config when no specific domain is active.
 * Contains the original legal-focused document types and categories.
 */

export const DOCUMENT_TYPES = [
  { value: 'contract', label: 'Contract' },
  { value: 'agreement', label: 'Agreement' },
  { value: 'nda', label: 'NDA' },
  { value: 'policy', label: 'Policy' },
  { value: 'regulation', label: 'Regulation' },
  { value: 'legal_brief', label: 'Legal Brief' },
  { value: 'terms', label: 'Terms & Conditions' },
  { value: 'license', label: 'License' },
  { value: 'memo', label: 'Memorandum' },
  { value: 'other', label: 'Other' },
];

export const CATEGORIES = [
  { value: 'contract', label: 'Contract / Agreement' },
  { value: 'policy', label: 'Policy Document' },
  { value: 'regulation', label: 'Regulation / Compliance' },
  { value: 'legal_brief', label: 'Legal Brief' },
  { value: 'terms', label: 'Terms & Conditions' },
  { value: 'nda', label: 'Non-Disclosure Agreement' },
  { value: 'license', label: 'License Agreement' },
  { value: 'other', label: 'Other' },
];

/** Category chips shown in the Documents page filter bar */
export const FILTER_CATEGORIES = [
  { value: '', label: '📚 All' },
  { value: 'contract', label: '📜 Contract' },
  { value: 'policy', label: '📋 Policy' },
  { value: 'report', label: '📊 Report' },
  { value: 'agreement', label: '🤝 Agreement' },
  { value: 'memo', label: '📝 Memo' },
  { value: 'other', label: '📄 Other' },
];

export const WORKFLOW_TEMPLATES = [
  {
    key: 'contract_review',
    name: 'Contract Review Pipeline',
    description: 'Standard multi-step contract review and approval',
    icon: 'GitBranch',
    color: '#2563EB',
  },
  {
    key: 'nda_execution',
    name: 'NDA Execution',
    description: 'Quick NDA sign-off workflow',
    icon: 'ShieldCheck',
    color: '#059669',
  },
  {
    key: 'policy_approval',
    name: 'Policy Approval',
    description: 'Policy draft → legal review → executive sign-off',
    icon: 'FileCheck',
    color: '#7C3AED',
  },
];

export const CREATE_DIALOG = {
  /** Title shown in the create-document dialog header */
  title: 'Create a new document',
  subtitle: 'Start blank, from a template, or paste text for AI-assisted creation.',
  /** Default document_type value for new documents */
  defaultDocType: 'contract',
  /** Default category value */
  defaultCategory: 'contract',
  /** Whether to show AI Assist card */
  showAIAssist: true,
  /** Whether to show Quick LaTeX card */
  showQuickLatex: true,
  /** Card order: which creation mode is primary/default */
  cardOrder: ['blank', 'template', 'ai_assist', 'quick_latex'],
};

/**
 * Sidebar configuration for the default domain.
 *
 * navOrder  — null means use the built-in order.
 * newDocumentAction — 'dialog' opens the CreateDocumentDialog.
 */
export const SIDEBAR = {
  navOrder: null,
  newDocumentAction: 'dialog',
  newDocumentLabel: 'New Document',
};

export default {
  DOCUMENT_TYPES,
  CATEGORIES,
  FILTER_CATEGORIES,
  WORKFLOW_TEMPLATES,
  CREATE_DIALOG,
  SIDEBAR,
};
