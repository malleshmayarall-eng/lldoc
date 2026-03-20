/**
 * Procurement domain configuration
 *
 * Document types, categories, and workflow templates specific to the
 * procurement vertical. Mirrors the backend config in
 * documents/procurement/domain_config.py.
 */

export const DOCUMENT_TYPES = [
  { value: 'rfp', label: 'Request for Proposal' },
  { value: 'rfq', label: 'Request for Quotation' },
  { value: 'purchase_order', label: 'Purchase Order' },
  { value: 'vendor_agreement', label: 'Vendor Agreement' },
  { value: 'sow', label: 'Statement of Work' },
  { value: 'nda', label: 'Non-Disclosure Agreement' },
  { value: 'bid_evaluation', label: 'Bid Evaluation' },
  { value: 'amendment', label: 'Contract Amendment' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'goods_receipt', label: 'Goods Receipt Note' },
  { value: 'other', label: 'Other' },
];

export const CATEGORIES = [
  { value: 'rfp', label: 'Request for Proposal' },
  { value: 'rfq', label: 'Request for Quotation' },
  { value: 'purchase_order', label: 'Purchase Order' },
  { value: 'vendor_agreement', label: 'Vendor Agreement' },
  { value: 'sow', label: 'Statement of Work' },
  { value: 'nda', label: 'Non-Disclosure Agreement' },
  { value: 'bid_evaluation', label: 'Bid Evaluation' },
  { value: 'amendment', label: 'Contract Amendment' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'goods_receipt', label: 'Goods Receipt Note' },
  { value: 'other', label: 'Other' },
];

/** Category chips shown in the Documents page filter bar */
export const FILTER_CATEGORIES = [
  { value: '', label: '📚 All' },
  { value: 'purchase_order', label: '🛒 Purchase Order' },
  { value: 'rfp', label: '📄 RFP' },
  { value: 'rfq', label: '💰 RFQ' },
  { value: 'vendor_agreement', label: '🤝 Vendor Agreement' },
  { value: 'sow', label: '📋 SOW' },
  { value: 'nda', label: '🔒 NDA' },
  { value: 'bid_evaluation', label: '📊 Bid Eval' },
  { value: 'amendment', label: '✏️ Amendment' },
  { value: 'invoice', label: '🧾 Invoice' },
  { value: 'goods_receipt', label: '📦 Goods Receipt' },
  { value: 'other', label: '📄 Other' },
];

export const WORKFLOW_TEMPLATES = [
  {
    key: 'po_approval',
    name: 'PO Approval Pipeline',
    description: 'Three-tier purchase order approval with value-based routing',
    icon: 'GitBranch',
    color: '#2563EB',
  },
  {
    key: 'vendor_onboarding',
    name: 'Vendor Onboarding',
    description: 'NDA → qualification → agreement → activation',
    icon: 'UserPlus',
    color: '#059669',
  },
  {
    key: 'rfp_pipeline',
    name: 'RFP Pipeline',
    description: 'Issue RFP → collect bids → evaluate → award',
    icon: 'Layers',
    color: '#7C3AED',
  },
  {
    key: 'contract_renewal',
    name: 'Contract Renewal',
    description: 'Review → negotiate → approve → sign renewal',
    icon: 'RefreshCw',
    color: '#D97706',
  },
];

export const CREATE_DIALOG = {
  title: 'Create procurement document',
  subtitle: 'Start a new PO, RFP, vendor agreement, or use a procurement template.',
  defaultDocType: 'purchase_order',
  defaultCategory: 'purchase_order',
  showAIAssist: true,
  showQuickLatex: true,
  /** Card order: Quick LaTeX first for procurement, blank drafter last */
  cardOrder: ['quick_latex', 'template', 'ai_assist', 'blank'],
};

/**
 * Sidebar configuration for the procurement domain.
 *
 * navOrder  — keys from the sidebar navItems in display order.
 * newDocumentAction — what happens when the "New Document" button is clicked.
 *   'quick_latex' → navigate straight to /quick-latex  (main documentation system)
 *   'dialog'      → open the CreateDocumentDialog (Document Drafter)
 */
export const SIDEBAR = {
  /** Quick LaTeX is the main documentation system, Dashboard right after Home */
  navOrder: [
    'home',
    'procurement_dashboard',
    'quick_latex',
    'documents',
    'sheets',
    'masters',
    'tasks',
    'approvals',
    'profile',
    'settings',
    'admin',
  ],
  /** "New Document" button navigates to Quick LaTeX (main doc system) */
  newDocumentAction: 'quick_latex',
  newDocumentLabel: 'New Document',
  /** Secondary action: "Create Document Drafter" opens the dialog */
  secondaryAction: 'dialog',
  secondaryLabel: 'Create Drafter Document',
};

export default {
  DOCUMENT_TYPES,
  CATEGORIES,
  FILTER_CATEGORIES,
  WORKFLOW_TEMPLATES,
  CREATE_DIALOG,
  SIDEBAR,
};
