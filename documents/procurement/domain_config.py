"""
Procurement Domain Configuration
=================================

Central registry of document templates, CLM workflow presets, category
taxonomy, and UI hints specific to the **Procurement** vertical.

Consumed by:
  • ``seed_procurement`` management command  — to create DB records
  • Frontend via ``GET /api/organizations/procurement-config/``
  • Any code that needs procurement-specific constants
"""

# ──────────────────────────────────────────────────────────────────────
# Category taxonomy — the document_type values used by procurement
# ──────────────────────────────────────────────────────────────────────

PROCUREMENT_CATEGORIES = [
    {
        'value': 'rfp',
        'label': 'Request for Proposal',
        'description': 'Formal solicitation for vendor bids',
        'icon': 'FileSearch',
    },
    {
        'value': 'rfq',
        'label': 'Request for Quotation',
        'description': 'Price-focused quotation request',
        'icon': 'Calculator',
    },
    {
        'value': 'purchase_order',
        'label': 'Purchase Order',
        'description': 'Official order issued to a vendor',
        'icon': 'ShoppingCart',
    },
    {
        'value': 'vendor_agreement',
        'label': 'Vendor Agreement',
        'description': 'Master service or supply agreement',
        'icon': 'Handshake',
    },
    {
        'value': 'sow',
        'label': 'Statement of Work',
        'description': 'Scope, deliverables, and timelines',
        'icon': 'ClipboardList',
    },
    {
        'value': 'nda',
        'label': 'Non-Disclosure Agreement',
        'description': 'Confidentiality agreement with vendors',
        'icon': 'ShieldCheck',
    },
    {
        'value': 'bid_evaluation',
        'label': 'Bid Evaluation',
        'description': 'Scoring matrix for vendor proposals',
        'icon': 'BarChart3',
    },
    {
        'value': 'amendment',
        'label': 'Contract Amendment',
        'description': 'Modifications to existing contracts',
        'icon': 'FilePen',
    },
    {
        'value': 'invoice',
        'label': 'Invoice',
        'description': 'Vendor payment invoice',
        'icon': 'Receipt',
    },
    {
        'value': 'goods_receipt',
        'label': 'Goods Receipt Note',
        'description': 'Confirmation of delivery received',
        'icon': 'PackageCheck',
    },
]

# ──────────────────────────────────────────────────────────────────────
# Quick-action presets — shown as big cards on the "New Document" screen
# ──────────────────────────────────────────────────────────────────────

QUICK_ACTIONS = [
    {
        'key': 'new_po',
        'label': 'New Purchase Order',
        'description': 'Create a PO from template',
        'template': 'procurement_purchase_order',
        'icon': 'ShoppingCart',
        'color': '#2563EB',       # blue-600
    },
    {
        'key': 'new_rfp',
        'label': 'New RFP',
        'description': 'Draft a request for proposal',
        'template': 'procurement_rfp',
        'icon': 'FileSearch',
        'color': '#7C3AED',       # violet-600
    },
    {
        'key': 'new_vendor_agreement',
        'label': 'New Vendor Agreement',
        'description': 'Standard vendor contract',
        'template': 'procurement_vendor_agreement',
        'icon': 'Handshake',
        'color': '#059669',       # emerald-600
    },
    {
        'key': 'new_sow',
        'label': 'New SOW',
        'description': 'Scope of work document',
        'template': 'procurement_sow',
        'icon': 'ClipboardList',
        'color': '#D97706',       # amber-600
    },
]

# ──────────────────────────────────────────────────────────────────────
# CLM Workflow presets — each defines a template DAG for procurement
# ──────────────────────────────────────────────────────────────────────

WORKFLOW_PRESETS = [
    {
        'key': 'po_approval',
        'name': 'PO Approval Pipeline',
        'description': 'Three-tier purchase order approval with value-based routing',
        'icon': 'GitBranch',
        'color': '#2563EB',
    },
    {
        'key': 'vendor_onboarding',
        'name': 'Vendor Onboarding',
        'description': 'NDA → qualification → agreement → activation',
        'icon': 'UserPlus',
        'color': '#059669',
    },
    {
        'key': 'rfp_pipeline',
        'name': 'RFP Pipeline',
        'description': 'Issue RFP → collect bids → evaluate → award',
        'icon': 'Layers',
        'color': '#7C3AED',
    },
    {
        'key': 'contract_renewal',
        'name': 'Contract Renewal',
        'description': 'Review → negotiate → approve → sign renewal',
        'icon': 'RefreshCw',
        'color': '#D97706',
    },
]

# ──────────────────────────────────────────────────────────────────────
# UI Hints — consumed by frontend for modern minimal layout
# ──────────────────────────────────────────────────────────────────────

UI_HINTS = {
    # Navigation emphasis
    'primary_nav': ['documents', 'clm', 'dms'],
    'secondary_nav': ['fileshare', 'communications'],
    'hidden_nav': [],

    # Default document mode for new documents
    'default_document_mode': 'quick_latex',

    # Editor toolbar: order determines left-to-right position
    'toolbar_order': [
        'export_pdf',
        'ai_chat',
        'ai_rewrite',
        'comments',
        'approval_workflow',
        'tables',
        'images',
        'change_tracking',
        'header_footer_text',
        'header_footer_pdf',
    ],

    # Dashboard widget order
    'dashboard_order': [
        'recent_docs',
        'workflow_stats',
        'clm_stats',
        'team_activity',
    ],

    # Colour palette — modern minimal
    'theme': {
        'accent': '#2563EB',         # blue-600
        'accent_light': '#DBEAFE',   # blue-100
        'surface': '#FFFFFF',
        'surface_alt': '#F8FAFC',    # slate-50
        'border': '#E2E8F0',         # slate-200
        'text_primary': '#0F172A',   # slate-900
        'text_secondary': '#64748B', # slate-500
    },

    # Empty-state messaging
    'empty_states': {
        'documents': {
            'title': 'No procurement documents yet',
            'description': 'Create your first purchase order, RFP, or vendor agreement.',
            'cta_label': 'New Document',
        },
        'clm': {
            'title': 'No workflows configured',
            'description': 'Set up approval pipelines for POs, vendor onboarding, and more.',
            'cta_label': 'Create Workflow',
        },
    },
}


def get_procurement_config() -> dict:
    """Return the full procurement domain configuration for API responses."""
    return {
        'domain': 'procurement',
        'categories': PROCUREMENT_CATEGORIES,
        'quick_actions': QUICK_ACTIONS,
        'workflow_presets': WORKFLOW_PRESETS,
        'ui_hints': UI_HINTS,
    }
