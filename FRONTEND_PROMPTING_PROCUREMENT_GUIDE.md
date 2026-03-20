# Frontend Guide — Procurement Domain

> **Backend version**: Django 6.0 / DRF  
> **Base URL**: `http://localhost:8000/api/`  
> **Domain key**: `procurement`

---

## Overview

The **Procurement** domain is the first fully implemented vertical. It provides:

- **Quick LaTeX** as the **primary** document creation method (not standard editor)
- **10 ready-to-use document templates** (PO, RFP, Vendor Agreement, SOW, NDA, etc.)
- **4 CLM workflow presets** (PO Approval, Vendor Onboarding, RFP Pipeline, Contract Renewal)
- A **modern, minimal UI** that highlights easy features and de-emphasises advanced ones

### Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Quick LaTeX first** | Default `document_mode` is `quick_latex`. Standard editor is secondary. |
| **Easy features highlighted** | AI Chat, PDF Export, Comments, Tables, Approval Workflow are prominent |
| **Advanced features available but not emphasised** | Branching, Section References, Deep AI Analysis hidden by default |
| **CLM is a core module** | Sidebar shows CLM prominently; dashboard has CLM stats widget |
| **Modern minimal** | Clean surfaces, blue accent (#2563EB), minimal chrome, generous whitespace |

---

## API Endpoints

### 1. Domain Config (Categories, Quick Actions, UI Hints)

```
GET /api/organizations/current/domain-config/
```

Returns the full procurement configuration: categories, quick-action cards, workflow presets, and UI layout hints.

**Response** `200`:
```json
{
  "domain": "procurement",
  "categories": [
    {
      "value": "rfp",
      "label": "Request for Proposal",
      "description": "Formal solicitation for vendor bids",
      "icon": "FileSearch"
    },
    {
      "value": "purchase_order",
      "label": "Purchase Order",
      "description": "Official order issued to a vendor",
      "icon": "ShoppingCart"
    },
    ...
  ],
  "quick_actions": [
    {
      "key": "new_po",
      "label": "New Purchase Order",
      "description": "Create a PO from template",
      "template": "procurement_purchase_order",
      "icon": "ShoppingCart",
      "color": "#2563EB"
    },
    ...
  ],
  "workflow_presets": [
    {
      "key": "po_approval",
      "name": "PO Approval Pipeline",
      "description": "Three-tier purchase order approval with value-based routing",
      "icon": "GitBranch",
      "color": "#2563EB"
    },
    ...
  ],
  "ui_hints": {
    "primary_nav": ["documents", "clm", "dms"],
    "secondary_nav": ["fileshare", "communications"],
    "default_document_mode": "quick_latex",
    "toolbar_order": ["export_pdf", "ai_chat", "ai_rewrite", "comments", ...],
    "dashboard_order": ["recent_docs", "workflow_stats", "clm_stats", "team_activity"],
    "theme": {
      "accent": "#2563EB",
      "accent_light": "#DBEAFE",
      "surface": "#FFFFFF",
      "surface_alt": "#F8FAFC",
      "border": "#E2E8F0",
      "text_primary": "#0F172A",
      "text_secondary": "#64748B"
    },
    "empty_states": {
      "documents": {
        "title": "No procurement documents yet",
        "description": "Create your first purchase order, RFP, or vendor agreement.",
        "cta_label": "New Document"
      },
      "clm": {
        "title": "No workflows configured",
        "description": "Set up approval pipelines for POs, vendor onboarding, and more.",
        "cta_label": "Create Workflow"
      }
    }
  }
}
```

### 2. Feature Flags (Bootstrap)

```
GET /api/organizations/current/feature-flags/
```

**Response** `200` (procurement domain):
```json
{
  "domain": "procurement",
  "flags": {
    "apps": {
      "documents": true,
      "clm": true,
      "dms": true,
      "fileshare": true,
      "viewer": true,
      "communications": true,
      "aiservices": true,
      "sharing": true,
      "workflows": true
    },
    "editor": {
      "ai_chat": true,
      "ai_scoring": false,
      "ai_rewrite": true,
      "ai_paragraph_analyze": false,
      "tables": true,
      "latex": false,
      "images": true,
      "file_components": false,
      "section_references": false,
      "branching": false,
      "quick_latex": true,
      "header_footer_pdf": true,
      "header_footer_text": true,
      "export_pdf": true,
      "change_tracking": true,
      "comments": true,
      "approval_workflow": true
    },
    "dashboard": {
      "workflow_stats": true,
      "clm_stats": true,
      "recent_docs": true,
      "team_activity": true,
      "ai_insights": false
    }
  }
}
```

### 3. List Procurement Templates

All seeded templates are Quick LaTeX documents with `status=template` and `custom_metadata.procurement_seed=true`.

```
GET /api/documents/quick-latex/?status=template
```

Or filter by document type:
```
GET /api/documents/quick-latex/?document_type=purchase_order
GET /api/documents/quick-latex/?document_type=rfp
GET /api/documents/quick-latex/?document_type=vendor_agreement
```

### 4. Create Document From Template

```
POST /api/documents/quick-latex/
Content-Type: application/json

{
  "source_document_id": "<template-uuid>",
  "title": "PO-2026-001 — Acme Supplies",
  "document_type": "purchase_order",
  "metadata_overrides": {
    "po_number": "PO-2026-001",
    "vendor_name": "Acme Supplies Inc.",
    "vendor_address": "123 Vendor St, New York, NY",
    "buyer_company": "Our Company Ltd",
    "order_date": "2026-03-11",
    "delivery_date": "2026-04-15",
    "total_amount": "12,500.00"
  }
}
```

The `source_document_id` clones the template's LaTeX code and structure. The `metadata_overrides` fill in the `[[placeholder]]` values.

### 5. CLM Workflow Endpoints

Seeded workflows are fully functional CLM pipelines. Use the standard CLM API:

```
GET /api/clm/workflows/                   — List workflows
GET /api/clm/workflows/<uuid>/            — Get workflow details (nodes + connections)
POST /api/clm/workflows/<uuid>/documents/ — Upload documents into the workflow
POST /api/clm/workflows/<uuid>/execute/   — Execute the workflow
```

---

## Document Template Reference

| Template | `document_type` | Key Metadata Fields |
|----------|----------------|---------------------|
| **Purchase Order** | `purchase_order` | `po_number`, `vendor_name`, `buyer_company`, `total_amount`, `delivery_date` |
| **Request for Proposal** | `rfp` | `rfp_number`, `rfp_title`, `submission_deadline`, `project_budget` |
| **Vendor Agreement** | `vendor_agreement` | `agreement_number`, `vendor_name`, `effective_date`, `termination_date`, `governing_law` |
| **Statement of Work** | `sow` | `sow_number`, `project_name`, `start_date`, `end_date`, `total_value` |
| **Non-Disclosure Agreement** | `nda` | `nda_number`, `party_a_name`, `party_b_name`, `duration_years` |
| **Bid Evaluation** | `bid_evaluation` | `evaluation_number`, `rfp_reference`, `vendor_1`, `vendor_2`, `vendor_3` |
| **Contract Amendment** | `amendment` | `amendment_number`, `original_contract_number`, `description_of_changes` |
| **Request for Quotation** | `rfq` | `rfq_number`, `response_deadline`, `delivery_location` |
| **Goods Receipt Note** | `goods_receipt` | `grn_number`, `po_reference`, `receipt_date`, `warehouse_location` |
| **Invoice** | `invoice` | `invoice_number`, `po_reference`, `due_date`, `total_amount`, `bank_name` |

---

## CLM Workflow Template Reference

### PO Approval Pipeline
```
Upload POs → [PO ≤ $5K] → Manager Approval ──┐
           → [PO $5K–$50K] → Director Approval ──┼→ Send Email → Approved POs
           → [PO > $50K] → VP/CFO Approval ──┘
```
**Use case**: Value-based routing ensures appropriate approval authority.

### Vendor Onboarding
```
Upload NDA ──→ NDA Review ────┐
                              ├→ AND Gate → AI Risk Assessment → Welcome Email → Approved
Upload Qual Docs → Qual Review ┘
```
**Use case**: Both NDA and qualifications must be approved before vendor activation.

### RFP Pipeline
```
Collect Bids → AI Bid Analysis → Compliant Only → Evaluation Committee → Award Notification → Done
```
**Use case**: AI pre-screens bids for compliance, committee reviews shortlist.

### Contract Renewal
```
Expiring Contracts → [Expires ≤ 90 Days] → Renewal Reminder (email)
                                          → Procurement Review → Issue Renewal → Done
```
**Use case**: Proactive renewal management with automated reminders.

---

## React Integration — Modern Minimal UI

### 1. Procurement Dashboard

```tsx
// pages/ProcurementDashboard.tsx
import { useFeatureFlags } from '@/contexts/FeatureFlagContext';
import { useDomainConfig } from '@/hooks/useDomainConfig';

export function ProcurementDashboard() {
  const { isEnabled } = useFeatureFlags();
  const { config, loading } = useDomainConfig();

  if (loading) return <Skeleton className="h-96" />;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      {/* Header — clean, minimal */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Procurement</h1>
        <p className="text-slate-500 mt-1">Manage purchase orders, vendor contracts, and workflows</p>
      </div>

      {/* Quick Actions — large cards */}
      <section>
        <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-4">
          Quick Actions
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {config.quick_actions.map((action) => (
            <QuickActionCard
              key={action.key}
              icon={action.icon}
              label={action.label}
              description={action.description}
              color={action.color}
              onClick={() => createFromTemplate(action.template)}
            />
          ))}
        </div>
      </section>

      {/* Dashboard Widgets — ordered by ui_hints */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {isEnabled('dashboard', 'recent_docs') && <RecentDocumentsWidget />}
        {isEnabled('dashboard', 'workflow_stats') && <WorkflowStatsWidget />}
        {isEnabled('dashboard', 'clm_stats') && <CLMStatsWidget />}
        {isEnabled('dashboard', 'team_activity') && <TeamActivityWidget />}
      </div>
    </div>
  );
}
```

### 2. Quick Action Card Component

```tsx
// components/QuickActionCard.tsx
interface QuickActionCardProps {
  icon: string;
  label: string;
  description: string;
  color: string;
  onClick: () => void;
}

export function QuickActionCard({ icon, label, description, color, onClick }: QuickActionCardProps) {
  const Icon = iconMap[icon]; // Map string → Lucide icon component

  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col items-start p-5 rounded-xl border border-slate-200 
                 bg-white hover:border-blue-300 hover:shadow-md transition-all duration-200
                 text-left"
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
        style={{ backgroundColor: color + '15', color }}
      >
        <Icon className="w-5 h-5" />
      </div>
      <span className="font-medium text-slate-900 text-sm">{label}</span>
      <span className="text-xs text-slate-500 mt-1">{description}</span>
    </button>
  );
}
```

### 3. Template Gallery (New Document Screen)

```tsx
// pages/NewDocument.tsx
import { useDomainConfig } from '@/hooks/useDomainConfig';

export function NewDocument() {
  const { config } = useDomainConfig();
  const [templates, setTemplates] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('all');

  useEffect(() => {
    api.get('/documents/quick-latex/', { params: { status: 'template' } })
      .then(res => setTemplates(res.data.results || res.data));
  }, []);

  const filtered = selectedCategory === 'all'
    ? templates
    : templates.filter(t => t.document_type === selectedCategory);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-semibold text-slate-900">New Document</h1>
      <p className="text-slate-500 mt-1 mb-8">Choose a template to get started</p>

      {/* Category Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        <CategoryTab value="all" label="All" active={selectedCategory === 'all'}
                     onClick={setSelectedCategory} />
        {config.categories.map(cat => (
          <CategoryTab key={cat.value} value={cat.value} label={cat.label}
                       active={selectedCategory === cat.value}
                       onClick={setSelectedCategory} />
        ))}
      </div>

      {/* Template Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(tpl => (
          <TemplateCard
            key={tpl.id}
            title={tpl.title}
            type={tpl.document_type}
            description={tpl.custom_metadata?.template_description}
            onClick={() => createFromTemplate(tpl.id)}
          />
        ))}
      </div>
    </div>
  );
}

function CategoryTab({ value, label, active, onClick }) {
  return (
    <button
      onClick={() => onClick(value)}
      className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors
        ${active
          ? 'bg-blue-600 text-white'
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
    >
      {label}
    </button>
  );
}
```

### 4. Template Card Component

```tsx
// components/TemplateCard.tsx
export function TemplateCard({ title, type, description, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col p-5 rounded-xl border border-slate-200 bg-white
                 hover:border-blue-300 hover:shadow-sm transition-all text-left group"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
          {type.replace('_', ' ')}
        </span>
      </div>
      <h3 className="font-medium text-slate-900 group-hover:text-blue-600 transition-colors">
        {title}
      </h3>
      {description && (
        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{description}</p>
      )}
      <span className="text-xs text-blue-600 font-medium mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
        Use template →
      </span>
    </button>
  );
}
```

### 5. Procurement Sidebar

```tsx
// components/ProcurementSidebar.tsx
import { useFeatureFlags } from '@/contexts/FeatureFlagContext';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import {
  FileText, GitBranch, Database, HardDrive, Bell,
  LayoutDashboard
} from 'lucide-react';

export function ProcurementSidebar() {
  const { isEnabled } = useFeatureFlags();
  const { config } = useDomainConfig();

  const primaryNav = config.ui_hints?.primary_nav || [];
  const secondaryNav = config.ui_hints?.secondary_nav || [];

  return (
    <aside className="w-60 border-r border-slate-200 bg-white flex flex-col h-full">
      {/* Logo / Brand */}
      <div className="px-5 py-4 border-b border-slate-100">
        <span className="text-lg font-semibold text-slate-900">Drafter</span>
        <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">
          Procurement
        </span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {/* Primary */}
        <SidebarLink to="/" icon={LayoutDashboard} label="Dashboard" />

        {primaryNav.includes('documents') && isEnabled('apps', 'documents') && (
          <SidebarLink to="/documents" icon={FileText} label="Documents" />
        )}
        {primaryNav.includes('clm') && isEnabled('apps', 'clm') && (
          <SidebarLink to="/clm" icon={GitBranch} label="Workflows" />
        )}
        {primaryNav.includes('dms') && isEnabled('apps', 'dms') && (
          <SidebarLink to="/dms" icon={Database} label="Document Vault" />
        )}

        {/* Divider */}
        <div className="h-px bg-slate-100 my-3" />

        {/* Secondary */}
        {secondaryNav.includes('fileshare') && isEnabled('apps', 'fileshare') && (
          <SidebarLink to="/drive" icon={HardDrive} label="Drive" />
        )}
        {secondaryNav.includes('communications') && isEnabled('apps', 'communications') && (
          <SidebarLink to="/alerts" icon={Bell} label="Notifications" />
        )}
      </nav>
    </aside>
  );
}

function SidebarLink({ to, icon: Icon, label }) {
  const isActive = location.pathname === to;
  return (
    <a
      href={to}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors
        ${isActive
          ? 'bg-blue-50 text-blue-700'
          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </a>
  );
}
```

### 6. Procurement Editor Toolbar

```tsx
// components/ProcurementEditorToolbar.tsx
import { useFeatureFlags } from '@/contexts/FeatureFlagContext';
import { useDomainConfig } from '@/hooks/useDomainConfig';

export function ProcurementEditorToolbar() {
  const { isEnabled } = useFeatureFlags();
  const { config } = useDomainConfig();
  const toolbarOrder = config.ui_hints?.toolbar_order || [];

  // Map flag keys to toolbar components
  const toolComponents: Record<string, React.ReactNode> = {
    export_pdf: <ExportPDFButton />,
    ai_chat: <AIChatButton />,
    ai_rewrite: <AIRewriteButton />,
    comments: <CommentsButton />,
    approval_workflow: <ApprovalWorkflowButton />,
    tables: <InsertTableButton />,
    images: <InsertImageButton />,
    change_tracking: <ChangeTrackingToggle />,
    header_footer_text: <HeaderFooterTextButton />,
    header_footer_pdf: <HeaderFooterPDFButton />,
  };

  return (
    <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-200 bg-white">
      {/* Always present: basic formatting */}
      <BoldButton />
      <ItalicButton />
      <UnderlineButton />

      <ToolbarDivider />

      {/* Domain-ordered tools — only render if feature flag is on */}
      {toolbarOrder.map(key => {
        if (!isEnabled('editor', key)) return null;
        return <React.Fragment key={key}>{toolComponents[key]}</React.Fragment>;
      })}
    </div>
  );
}
```

### 7. Workflow Preset Cards

```tsx
// pages/CLM/NewWorkflow.tsx
import { useDomainConfig } from '@/hooks/useDomainConfig';

export function NewWorkflow() {
  const { config } = useDomainConfig();

  const createFromPreset = async (presetKey: string) => {
    // The seed command already created these workflows.
    // Navigate to the existing workflow, or clone it:
    const { data: workflows } = await api.get('/clm/workflows/');
    const match = workflows.results.find(w =>
      w.description?.includes('[procurement-seed]') && w.name.includes(presetKey)
    );
    if (match) navigate(`/clm/workflows/${match.id}`);
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-semibold text-slate-900">New Workflow</h1>
      <p className="text-slate-500 mt-1 mb-8">Start with a procurement template or build from scratch</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {config.workflow_presets.map(preset => (
          <button
            key={preset.key}
            onClick={() => createFromPreset(preset.key)}
            className="flex items-start gap-4 p-5 rounded-xl border border-slate-200 bg-white
                       hover:border-blue-300 hover:shadow-sm transition-all text-left"
          >
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: preset.color + '15', color: preset.color }}
            >
              <PresetIcon name={preset.icon} />
            </div>
            <div>
              <h3 className="font-medium text-slate-900">{preset.name}</h3>
              <p className="text-xs text-slate-500 mt-1">{preset.description}</p>
            </div>
          </button>
        ))}
      </div>

      <button className="text-sm text-blue-600 font-medium hover:text-blue-700">
        + Build from scratch
      </button>
    </div>
  );
}
```

### 8. useDomainConfig Hook

```tsx
// hooks/useDomainConfig.ts
import { useState, useEffect } from 'react';
import api from '@/lib/api';

interface DomainConfig {
  domain: string;
  categories: Array<{ value: string; label: string; description: string; icon: string }>;
  quick_actions: Array<{ key: string; label: string; description: string; template: string; icon: string; color: string }>;
  workflow_presets: Array<{ key: string; name: string; description: string; icon: string; color: string }>;
  ui_hints: {
    primary_nav: string[];
    secondary_nav: string[];
    default_document_mode: string;
    toolbar_order: string[];
    dashboard_order: string[];
    theme: Record<string, string>;
    empty_states: Record<string, { title: string; description: string; cta_label: string }>;
  };
}

const EMPTY_CONFIG: DomainConfig = {
  domain: 'general',
  categories: [],
  quick_actions: [],
  workflow_presets: [],
  ui_hints: {
    primary_nav: [],
    secondary_nav: [],
    default_document_mode: 'standard',
    toolbar_order: [],
    dashboard_order: [],
    theme: {},
    empty_states: {},
  },
};

export function useDomainConfig() {
  const [config, setConfig] = useState<DomainConfig>(EMPTY_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/organizations/current/domain-config/')
      .then(res => setConfig(res.data))
      .catch(() => setConfig(EMPTY_CONFIG))
      .finally(() => setLoading(false));
  }, []);

  return { config, loading };
}
```

---

## Seeding Data

Run once after initial setup:

```bash
# Seed templates + workflows for the first active org
python manage.py seed_procurement

# Seed for a specific org
python manage.py seed_procurement --org <org-uuid>

# Re-seed (cleans existing seed data first)
python manage.py seed_procurement --clean
```

This creates:
- **10 Quick LaTeX document templates** with full LaTeX content and `[[placeholder]]` metadata
- **4 CLM workflow DAGs** with nodes and connections, ready to use
- Sets the org's `domain` to `procurement`

---

## Category ↔ Icon Mapping (Lucide)

| Category | Icon name | Colour suggestion |
|----------|-----------|-------------------|
| `rfp` | `FileSearch` | `#7C3AED` violet |
| `rfq` | `Calculator` | `#0284C7` sky |
| `purchase_order` | `ShoppingCart` | `#2563EB` blue |
| `vendor_agreement` | `Handshake` | `#059669` emerald |
| `sow` | `ClipboardList` | `#D97706` amber |
| `nda` | `ShieldCheck` | `#0891B2` cyan |
| `bid_evaluation` | `BarChart3` | `#DC2626` red |
| `amendment` | `FilePen` | `#9333EA` purple |
| `invoice` | `Receipt` | `#EA580C` orange |
| `goods_receipt` | `PackageCheck` | `#16A34A` green |

---

## Feature Flags — What's ON / OFF in Procurement

### Highlighted (easy, always visible)

| Category | Flag | What it does |
|----------|------|-------------|
| `editor` | `quick_latex` | Quick LaTeX document mode — **primary creation method** |
| `editor` | `ai_chat` | AI assistant sidebar |
| `editor` | `ai_rewrite` | AI rewrite suggestions |
| `editor` | `tables` | Table insertion |
| `editor` | `images` | Image insertion |
| `editor` | `comments` | Inline comments |
| `editor` | `export_pdf` | Export to PDF |
| `editor` | `approval_workflow` | Approval workflow panel |
| `editor` | `change_tracking` | Change tracking |
| `apps` | `clm` | Contract Lifecycle Management |

### Hidden by default (advanced)

| Category | Flag | Why hidden |
|----------|------|-----------|
| `editor` | `latex` | Standard LaTeX blocks — use quick_latex instead |
| `editor` | `ai_scoring` | Legal document scoring — not core to procurement |
| `editor` | `ai_paragraph_analyze` | Deep legal analysis — not core |
| `editor` | `branching` | Document branching — advanced feature |
| `editor` | `section_references` | Cross-section refs — advanced |
| `editor` | `file_components` | Embedded files — advanced |
| `dashboard` | `ai_insights` | Legal AI insights — not core |

Org admins can re-enable any hidden feature via `PATCH /api/organizations/current/domain-settings/`.
