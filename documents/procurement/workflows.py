"""
Procurement CLM workflow template definitions.

Each template describes a workflow DAG (nodes + connections) that the
``seed_procurement`` management command will create. The frontend can
also read these via the procurement config API to offer "one-click"
workflow creation.
"""

WORKFLOW_TEMPLATES = [
    # ── 1. PO Approval Pipeline ──────────────────────────────────────
    {
        'key': 'po_approval',
        'name': 'PO Approval Pipeline',
        'description': (
            'Three-tier purchase order approval. Documents are uploaded, '
            'metadata is extracted, value-based rules route POs to the '
            'appropriate approval level, and approved POs trigger email '
            'notifications.'
        ),
        'nodes': [
            {
                'id': 'input_1',
                'node_type': 'input',
                'label': 'Upload POs',
                'position_x': 50,
                'position_y': 250,
                'config': {
                    'document_type': 'purchase_order',
                    'accepted_formats': ['pdf', 'docx'],
                },
            },
            {
                'id': 'rule_low',
                'node_type': 'rule',
                'label': 'PO ≤ $5,000',
                'position_x': 300,
                'position_y': 100,
                'config': {
                    'boolean_operator': 'AND',
                    'conditions': [
                        {'field': 'total_amount', 'operator': 'lte', 'value': '5000'},
                    ],
                },
            },
            {
                'id': 'rule_mid',
                'node_type': 'rule',
                'label': 'PO $5K–$50K',
                'position_x': 300,
                'position_y': 250,
                'config': {
                    'boolean_operator': 'AND',
                    'conditions': [
                        {'field': 'total_amount', 'operator': 'gt', 'value': '5000'},
                        {'field': 'total_amount', 'operator': 'lte', 'value': '50000'},
                    ],
                },
            },
            {
                'id': 'rule_high',
                'node_type': 'rule',
                'label': 'PO > $50K',
                'position_x': 300,
                'position_y': 400,
                'config': {
                    'boolean_operator': 'AND',
                    'conditions': [
                        {'field': 'total_amount', 'operator': 'gt', 'value': '50000'},
                    ],
                },
            },
            {
                'id': 'validator_mgr',
                'node_type': 'validator',
                'label': 'Manager Approval',
                'position_x': 550,
                'position_y': 100,
                'config': {
                    'approval_type': 'single',
                    'instructions': 'Review and approve the purchase order.',
                },
            },
            {
                'id': 'validator_dir',
                'node_type': 'validator',
                'label': 'Director Approval',
                'position_x': 550,
                'position_y': 250,
                'config': {
                    'approval_type': 'sequential',
                    'instructions': 'Manager then Director must approve.',
                },
            },
            {
                'id': 'validator_vp',
                'node_type': 'validator',
                'label': 'VP / CFO Approval',
                'position_x': 550,
                'position_y': 400,
                'config': {
                    'approval_type': 'sequential',
                    'instructions': 'Manager → Director → VP/CFO approval chain.',
                },
            },
            {
                'id': 'action_notify',
                'node_type': 'action',
                'label': 'Send Approval Email',
                'position_x': 800,
                'position_y': 250,
                'config': {
                    'plugin': 'email',
                    'subject': 'PO Approved — {{vendor_name}} #{{po_number}}',
                    'body': 'The purchase order has been approved and is ready for processing.',
                },
            },
            {
                'id': 'output_1',
                'node_type': 'output',
                'label': 'Approved POs',
                'position_x': 1050,
                'position_y': 250,
                'config': {},
            },
        ],
        'connections': [
            {'source': 'input_1', 'target': 'rule_low'},
            {'source': 'input_1', 'target': 'rule_mid'},
            {'source': 'input_1', 'target': 'rule_high'},
            {'source': 'rule_low', 'target': 'validator_mgr'},
            {'source': 'rule_mid', 'target': 'validator_dir'},
            {'source': 'rule_high', 'target': 'validator_vp'},
            {'source': 'validator_mgr', 'target': 'action_notify', 'handle': 'approved'},
            {'source': 'validator_dir', 'target': 'action_notify', 'handle': 'approved'},
            {'source': 'validator_vp', 'target': 'action_notify', 'handle': 'approved'},
            {'source': 'action_notify', 'target': 'output_1'},
        ],
    },

    # ── 2. Vendor Onboarding ─────────────────────────────────────────
    {
        'key': 'vendor_onboarding',
        'name': 'Vendor Onboarding',
        'description': (
            'End-to-end vendor onboarding flow: NDA signing, qualification '
            'document review, vendor agreement execution, and final activation.'
        ),
        'nodes': [
            {
                'id': 'input_nda',
                'node_type': 'input',
                'label': 'Upload NDA',
                'position_x': 50,
                'position_y': 150,
                'config': {
                    'document_type': 'nda',
                    'accepted_formats': ['pdf'],
                },
            },
            {
                'id': 'input_qual',
                'node_type': 'input',
                'label': 'Upload Qualification Docs',
                'position_x': 50,
                'position_y': 350,
                'config': {
                    'document_type': 'qualification',
                    'accepted_formats': ['pdf', 'docx'],
                },
            },
            {
                'id': 'validator_nda',
                'node_type': 'validator',
                'label': 'NDA Review',
                'position_x': 300,
                'position_y': 150,
                'config': {
                    'approval_type': 'single',
                    'instructions': 'Verify NDA is signed and complete.',
                },
            },
            {
                'id': 'validator_qual',
                'node_type': 'validator',
                'label': 'Qualification Review',
                'position_x': 300,
                'position_y': 350,
                'config': {
                    'approval_type': 'single',
                    'instructions': 'Review vendor qualifications, certifications, and references.',
                },
            },
            {
                'id': 'and_gate_1',
                'node_type': 'and_gate',
                'label': 'Both Approved',
                'position_x': 550,
                'position_y': 250,
                'config': {},
            },
            {
                'id': 'ai_risk',
                'node_type': 'ai',
                'label': 'AI Risk Assessment',
                'position_x': 750,
                'position_y': 250,
                'config': {
                    'prompt': 'Assess vendor risk based on qualification documents. Output risk_level (low/medium/high) and summary.',
                    'output_format': 'json_extract',
                    'json_fields': [
                        {'name': 'risk_level', 'description': 'low, medium, or high'},
                        {'name': 'risk_summary', 'description': 'Brief risk assessment'},
                    ],
                },
            },
            {
                'id': 'action_welcome',
                'node_type': 'action',
                'label': 'Welcome Email',
                'position_x': 950,
                'position_y': 250,
                'config': {
                    'plugin': 'email',
                    'subject': 'Welcome — Vendor Onboarding Complete',
                    'body': 'Your vendor onboarding is complete. You are now an approved vendor.',
                },
            },
            {
                'id': 'output_1',
                'node_type': 'output',
                'label': 'Approved Vendors',
                'position_x': 1150,
                'position_y': 250,
                'config': {},
            },
        ],
        'connections': [
            {'source': 'input_nda', 'target': 'validator_nda'},
            {'source': 'input_qual', 'target': 'validator_qual'},
            {'source': 'validator_nda', 'target': 'and_gate_1', 'handle': 'approved'},
            {'source': 'validator_qual', 'target': 'and_gate_1', 'handle': 'approved'},
            {'source': 'and_gate_1', 'target': 'ai_risk'},
            {'source': 'ai_risk', 'target': 'action_welcome'},
            {'source': 'action_welcome', 'target': 'output_1'},
        ],
    },

    # ── 3. RFP Pipeline ──────────────────────────────────────────────
    {
        'key': 'rfp_pipeline',
        'name': 'RFP Pipeline',
        'description': (
            'Full RFP lifecycle: issue → collect vendor bids → AI-assisted '
            'evaluation → approval → award notification.'
        ),
        'nodes': [
            {
                'id': 'input_bids',
                'node_type': 'input',
                'label': 'Collect Vendor Bids',
                'position_x': 50,
                'position_y': 250,
                'config': {
                    'document_type': 'rfp',
                    'accepted_formats': ['pdf', 'docx'],
                },
            },
            {
                'id': 'ai_eval',
                'node_type': 'ai',
                'label': 'AI Bid Analysis',
                'position_x': 300,
                'position_y': 250,
                'config': {
                    'prompt': (
                        'Analyze the vendor bid. Extract: vendor_name, '
                        'proposed_price, delivery_timeline, technical_score (1-10), '
                        'compliance_status (compliant/non-compliant).'
                    ),
                    'output_format': 'json_extract',
                    'json_fields': [
                        {'name': 'vendor_name', 'description': 'Bidding vendor name'},
                        {'name': 'proposed_price', 'description': 'Total proposed price'},
                        {'name': 'delivery_timeline', 'description': 'Proposed delivery timeline'},
                        {'name': 'technical_score', 'description': 'Technical score 1-10'},
                        {'name': 'compliance_status', 'description': 'compliant or non-compliant'},
                    ],
                },
            },
            {
                'id': 'rule_compliant',
                'node_type': 'rule',
                'label': 'Compliant Bids Only',
                'position_x': 550,
                'position_y': 250,
                'config': {
                    'boolean_operator': 'AND',
                    'conditions': [
                        {'field': 'compliance_status', 'operator': 'eq', 'value': 'compliant'},
                    ],
                },
            },
            {
                'id': 'validator_eval',
                'node_type': 'validator',
                'label': 'Evaluation Committee',
                'position_x': 800,
                'position_y': 250,
                'config': {
                    'approval_type': 'committee',
                    'instructions': 'Review AI analysis and score bids. Select winner.',
                },
            },
            {
                'id': 'action_award',
                'node_type': 'action',
                'label': 'Award Notification',
                'position_x': 1050,
                'position_y': 250,
                'config': {
                    'plugin': 'email',
                    'subject': 'RFP Award Notification — {{vendor_name}}',
                    'body': 'Congratulations! Your bid has been selected.',
                },
            },
            {
                'id': 'output_1',
                'node_type': 'output',
                'label': 'Awarded Vendor',
                'position_x': 1300,
                'position_y': 250,
                'config': {},
            },
        ],
        'connections': [
            {'source': 'input_bids', 'target': 'ai_eval'},
            {'source': 'ai_eval', 'target': 'rule_compliant'},
            {'source': 'rule_compliant', 'target': 'validator_eval'},
            {'source': 'validator_eval', 'target': 'action_award', 'handle': 'approved'},
            {'source': 'action_award', 'target': 'output_1'},
        ],
    },

    # ── 4. Contract Renewal ──────────────────────────────────────────
    {
        'key': 'contract_renewal',
        'name': 'Contract Renewal',
        'description': (
            'Automated contract renewal pipeline: expiring contracts are '
            'flagged, reviewed, negotiated, and approved for renewal.'
        ),
        'nodes': [
            {
                'id': 'input_contracts',
                'node_type': 'input',
                'label': 'Expiring Contracts',
                'position_x': 50,
                'position_y': 250,
                'config': {
                    'document_type': 'vendor_agreement',
                    'accepted_formats': ['pdf'],
                },
            },
            {
                'id': 'rule_expiring',
                'node_type': 'rule',
                'label': 'Expires in 90 Days',
                'position_x': 300,
                'position_y': 250,
                'config': {
                    'boolean_operator': 'AND',
                    'conditions': [
                        {'field': 'days_to_expiry', 'operator': 'lte', 'value': '90'},
                    ],
                },
            },
            {
                'id': 'action_reminder',
                'node_type': 'action',
                'label': 'Renewal Reminder',
                'position_x': 550,
                'position_y': 150,
                'config': {
                    'plugin': 'email',
                    'subject': 'Contract Renewal Reminder — {{vendor_name}}',
                    'body': 'The vendor agreement expires in {{days_to_expiry}} days. Please review and initiate renewal.',
                },
            },
            {
                'id': 'validator_review',
                'node_type': 'validator',
                'label': 'Procurement Review',
                'position_x': 550,
                'position_y': 350,
                'config': {
                    'approval_type': 'single',
                    'instructions': 'Review contract terms and decide: renew, renegotiate, or terminate.',
                },
            },
            {
                'id': 'action_renew',
                'node_type': 'action',
                'label': 'Issue Renewal',
                'position_x': 800,
                'position_y': 250,
                'config': {
                    'plugin': 'email',
                    'subject': 'Contract Renewed — {{vendor_name}}',
                    'body': 'The vendor agreement has been renewed.',
                },
            },
            {
                'id': 'output_1',
                'node_type': 'output',
                'label': 'Renewed Contracts',
                'position_x': 1050,
                'position_y': 250,
                'config': {},
            },
        ],
        'connections': [
            {'source': 'input_contracts', 'target': 'rule_expiring'},
            {'source': 'rule_expiring', 'target': 'action_reminder'},
            {'source': 'rule_expiring', 'target': 'validator_review'},
            {'source': 'validator_review', 'target': 'action_renew', 'handle': 'approved'},
            {'source': 'action_renew', 'target': 'output_1'},
        ],
    },
]
