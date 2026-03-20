# Frontend Guide — Domain Settings & Feature Flags

> **Backend version**: Django 6.0 / DRF  
> **Base URL**: `http://localhost:8000/api/`

---

## Overview

Every **Organization** now has a **domain** (industry vertical) that controls which apps, editor tools, and dashboard widgets are enabled. An org admin can customise individual flags on top of the domain defaults.

### Concepts

| Term | Meaning |
|------|---------|
| **Domain** | Industry vertical (`legal`, `finance`, `healthcare`, `real_estate`, `insurance`, `technology`, `education`, `government`, `consulting`, `general`) |
| **Feature flags** | Boolean toggles organised in three categories: `apps`, `editor`, `dashboard` |
| **Domain defaults** | The server-side default flags for each domain (e.g., Healthcare disables CLM) |
| **Feature overrides** | Per-org admin customisations layered on top of domain defaults |
| **Resolved flags** | The final merged result: domain defaults + org overrides |

---

## API Endpoints

### 1. List Available Domains

```
GET /api/organizations/domains/
```

Returns all domain choices with their default feature profiles.

**Response** `200`:
```json
[
  {
    "value": "legal",
    "label": "Legal",
    "default_features": {
      "apps": { "documents": true, "clm": true, "dms": true, ... },
      "editor": { "ai_chat": true, "tables": true, "latex": true, ... },
      "dashboard": { "workflow_stats": true, "clm_stats": true, ... }
    }
  },
  {
    "value": "healthcare",
    "label": "Healthcare",
    "default_features": {
      "apps": { "documents": true, "clm": false, ... },
      "editor": { "latex": false, "quick_latex": false, ... },
      "dashboard": { "clm_stats": false, ... }
    }
  }
]
```

**Use in UI**: Populate the domain dropdown in Settings. Show the `default_features` as a preview when the user hovers/selects a domain.

---

### 2. Feature Schema (Master List)

```
GET /api/organizations/feature-schema/
```

Returns every feature category and flag that exists in the system.

**Response** `200`:
```json
{
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
    "ai_scoring": true,
    "ai_rewrite": true,
    "ai_paragraph_analyze": true,
    "tables": true,
    "latex": true,
    "images": true,
    "file_components": true,
    "section_references": true,
    "branching": true,
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
    "ai_insights": true
  }
}
```

**Use in UI**: Use this to render toggles in the feature-override settings panel. The keys are stable identifiers; the frontend should map them to human-readable labels.

---

### 3. Get Domain Settings (Current Org)

```
GET /api/organizations/current/domain-settings/
```

Returns the current domain, any overrides, and the resolved flags.

**Response** `200`:
```json
{
  "domain": "healthcare",
  "domain_label": "Healthcare",
  "feature_overrides": {
    "apps": { "clm": true }
  },
  "resolved": {
    "apps": { "documents": true, "clm": true, "dms": true, ... },
    "editor": { "latex": false, "quick_latex": false, ... },
    "dashboard": { "clm_stats": false, ... }
  }
}
```

Note: In the example above, Healthcare defaults disable CLM, but the org has overridden `apps.clm` to `true`, so `resolved.apps.clm` is `true`.

---

### 4. Update Domain Settings (Current Org)

```
PATCH /api/organizations/current/domain-settings/
Content-Type: application/json
```

#### Change domain only:
```json
{ "domain": "finance" }
```

#### Override specific flags:
```json
{
  "feature_overrides": {
    "editor": { "latex": true },
    "apps": { "clm": false }
  }
}
```

#### Change domain AND set overrides:
```json
{
  "domain": "legal",
  "feature_overrides": {
    "dashboard": { "clm_stats": false }
  }
}
```

#### Revert an override to domain default:
```json
{
  "feature_overrides": {
    "editor": { "latex": "__removed__" }
  }
}
```

**Response** `200`: Same shape as GET.

**Validation errors** `400`:
```json
{
  "feature_overrides": [
    "Unknown feature category 'foo'. Valid categories: ['apps', 'editor', 'dashboard']"
  ]
}
```

---

### 5. Reset All Overrides

```
POST /api/organizations/current/reset-feature-overrides/
```

Clears all org-level overrides, reverting everything to domain defaults.

**Response** `200`: Same shape as domain-settings GET.

---

### 6. Feature Flags (Lightweight Bootstrap)

```
GET /api/organizations/current/feature-flags/
```

Designed for the frontend to call **once on app init**. Returns only the domain key and the resolved boolean map.

**Response** `200`:
```json
{
  "domain": "healthcare",
  "flags": {
    "apps": { "documents": true, "clm": false, ... },
    "editor": { "ai_chat": true, "latex": false, ... },
    "dashboard": { "workflow_stats": true, "clm_stats": false, ... }
  }
}
```

---

## React Integration Patterns

### 1. Feature Flag Context Provider

```tsx
// contexts/FeatureFlagContext.tsx
import { createContext, useContext, useEffect, useState } from 'react';
import api from '@/lib/api';

interface FeatureFlags {
  apps: Record<string, boolean>;
  editor: Record<string, boolean>;
  dashboard: Record<string, boolean>;
}

interface FeatureFlagContextValue {
  domain: string;
  flags: FeatureFlags;
  loading: boolean;
  refresh: () => Promise<void>;
  isEnabled: (category: string, feature: string) => boolean;
}

const FeatureFlagContext = createContext<FeatureFlagContextValue | null>(null);

export function FeatureFlagProvider({ children }: { children: React.ReactNode }) {
  const [domain, setDomain] = useState('general');
  const [flags, setFlags] = useState<FeatureFlags>({
    apps: {}, editor: {}, dashboard: {},
  });
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/organizations/current/feature-flags/');
      setDomain(data.domain);
      setFlags(data.flags);
    } catch (err) {
      console.error('Failed to load feature flags', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const isEnabled = (category: string, feature: string) =>
    flags[category as keyof FeatureFlags]?.[feature] ?? false;

  return (
    <FeatureFlagContext.Provider value={{ domain, flags, loading, refresh, isEnabled }}>
      {children}
    </FeatureFlagContext.Provider>
  );
}

export const useFeatureFlags = () => {
  const ctx = useContext(FeatureFlagContext);
  if (!ctx) throw new Error('useFeatureFlags must be used within FeatureFlagProvider');
  return ctx;
};
```

### 2. Conditional Rendering — Sidebar Navigation

```tsx
// components/Sidebar.tsx
import { useFeatureFlags } from '@/contexts/FeatureFlagContext';

export function Sidebar() {
  const { isEnabled } = useFeatureFlags();

  return (
    <nav>
      {/* Documents is always available */}
      <SidebarLink to="/documents" icon={FileText} label="Documents" />

      {isEnabled('apps', 'clm') && (
        <SidebarLink to="/clm" icon={Workflow} label="Contract Lifecycle" />
      )}
      {isEnabled('apps', 'dms') && (
        <SidebarLink to="/dms" icon={Database} label="Document Management" />
      )}
      {isEnabled('apps', 'fileshare') && (
        <SidebarLink to="/drive" icon={HardDrive} label="Drive" />
      )}
      {isEnabled('apps', 'communications') && (
        <SidebarLink to="/alerts" icon={Bell} label="Alerts" />
      )}
    </nav>
  );
}
```

### 3. Conditional Rendering — Editor Toolbar

```tsx
// components/EditorToolbar.tsx
import { useFeatureFlags } from '@/contexts/FeatureFlagContext';

export function EditorToolbar() {
  const { isEnabled } = useFeatureFlags();

  return (
    <Toolbar>
      <BoldButton />
      <ItalicButton />

      {isEnabled('editor', 'tables') && <InsertTableButton />}
      {isEnabled('editor', 'images') && <InsertImageButton />}
      {isEnabled('editor', 'latex') && <InsertLatexButton />}
      {isEnabled('editor', 'ai_chat') && <AIChatButton />}
      {isEnabled('editor', 'ai_scoring') && <AIScoringButton />}
      {isEnabled('editor', 'ai_rewrite') && <AIRewriteButton />}
      {isEnabled('editor', 'comments') && <CommentsButton />}
      {isEnabled('editor', 'export_pdf') && <ExportPDFButton />}
      {isEnabled('editor', 'branching') && <BranchButton />}
      {isEnabled('editor', 'approval_workflow') && <ApprovalButton />}
    </Toolbar>
  );
}
```

### 4. Route Guards

```tsx
// components/FeatureRoute.tsx
import { Navigate } from 'react-router-dom';
import { useFeatureFlags } from '@/contexts/FeatureFlagContext';

interface FeatureRouteProps {
  category: string;
  feature: string;
  children: React.ReactNode;
  fallback?: string;
}

export function FeatureRoute({ category, feature, children, fallback = '/' }: FeatureRouteProps) {
  const { isEnabled, loading } = useFeatureFlags();
  
  if (loading) return <LoadingSpinner />;
  if (!isEnabled(category, feature)) return <Navigate to={fallback} replace />;
  
  return <>{children}</>;
}

// Usage in routes:
<Route path="/clm/*" element={
  <FeatureRoute category="apps" feature="clm">
    <CLMModule />
  </FeatureRoute>
} />
```

### 5. Domain Settings Admin Panel

```tsx
// pages/Settings/DomainSettings.tsx
import { useState, useEffect } from 'react';
import { useFeatureFlags } from '@/contexts/FeatureFlagContext';
import api from '@/lib/api';

export function DomainSettings() {
  const { refresh } = useFeatureFlags();
  const [settings, setSettings] = useState(null);
  const [domains, setDomains] = useState([]);
  const [schema, setSchema] = useState({});

  useEffect(() => {
    Promise.all([
      api.get('/organizations/current/domain-settings/'),
      api.get('/organizations/domains/'),
      api.get('/organizations/feature-schema/'),
    ]).then(([settingsRes, domainsRes, schemaRes]) => {
      setSettings(settingsRes.data);
      setDomains(domainsRes.data);
      setSchema(schemaRes.data);
    });
  }, []);

  const changeDomain = async (domain: string) => {
    const { data } = await api.patch('/organizations/current/domain-settings/', { domain });
    setSettings(data);
    refresh(); // Update global flags
  };

  const toggleFeature = async (category: string, feature: string, enabled: boolean) => {
    const { data } = await api.patch('/organizations/current/domain-settings/', {
      feature_overrides: { [category]: { [feature]: enabled } }
    });
    setSettings(data);
    refresh();
  };

  const resetOverrides = async () => {
    const { data } = await api.post('/organizations/current/reset-feature-overrides/');
    setSettings(data);
    refresh();
  };

  if (!settings) return <LoadingSpinner />;

  return (
    <div>
      <h2>Domain Settings</h2>

      {/* Domain Dropdown */}
      <Select value={settings.domain} onChange={(e) => changeDomain(e.target.value)}>
        {domains.map(d => (
          <option key={d.value} value={d.value}>{d.label}</option>
        ))}
      </Select>

      {/* Feature Toggles per Category */}
      {Object.entries(schema).map(([category, flags]) => (
        <Section key={category} title={category}>
          {Object.keys(flags).map(flag => {
            const resolved = settings.resolved[category]?.[flag] ?? false;
            const isOverridden = settings.feature_overrides?.[category]?.[flag] !== undefined;
            return (
              <ToggleRow
                key={flag}
                label={flag}
                checked={resolved}
                isOverridden={isOverridden}
                onChange={(val) => toggleFeature(category, flag, val)}
              />
            );
          })}
        </Section>
      ))}

      <Button variant="outline" onClick={resetOverrides}>
        Reset to Domain Defaults
      </Button>
    </div>
  );
}
```

---

## Feature Flag Reference

### `apps` — Controls sidebar modules & route access

| Flag | Controls |
|------|----------|
| `documents` | Core document editor (always true in all domains) |
| `clm` | Contract Lifecycle Management module |
| `dms` | Document Management System (PDF ingestion) |
| `fileshare` | Google-Drive-like file system |
| `viewer` | External document viewer (token-based) |
| `communications` | Alert/notification system |
| `aiservices` | AI services (Gemini integration) |
| `sharing` | Document sharing module |
| `workflows` | Approval/review workflows |

### `editor` — Controls toolbar buttons & editor features

| Flag | Controls |
|------|----------|
| `ai_chat` | AI chat sidebar in editor |
| `ai_scoring` | Document scoring panel |
| `ai_rewrite` | AI rewrite suggestions |
| `ai_paragraph_analyze` | AI paragraph analysis |
| `tables` | Table insertion & editing |
| `latex` | LaTeX code blocks |
| `images` | Image insertion |
| `file_components` | File attachments in document |
| `section_references` | Cross-section references |
| `branching` | Document branching/merging |
| `quick_latex` | Quick LaTeX document mode |
| `header_footer_pdf` | PDF header/footer overlays |
| `header_footer_text` | Text header/footer templates |
| `export_pdf` | PDF export button |
| `change_tracking` | Change tracking / diff view |
| `comments` | Inline comments |
| `approval_workflow` | Approval workflow panel |

### `dashboard` — Controls dashboard widgets

| Flag | Controls |
|------|----------|
| `workflow_stats` | Workflow statistics widget |
| `clm_stats` | CLM pipeline statistics |
| `recent_docs` | Recent documents list |
| `team_activity` | Team activity feed |
| `ai_insights` | AI-generated insights widget |

---

## Domain Defaults at a Glance

| Domain | Disabled by default |
|--------|-------------------|
| **Procurement** | `editor.latex`, `editor.ai_scoring`, `editor.ai_paragraph_analyze`, `editor.branching`, `editor.section_references`, `editor.file_components`, `dashboard.ai_insights` *(Quick LaTeX is primary; CLM is core; see [Procurement Guide](FRONTEND_PROMPTING_PROCUREMENT_GUIDE.md))* |
| **Legal** | *(nothing — all features enabled)* |
| **Finance** | `editor.latex`, `editor.quick_latex` |
| **Healthcare** | `apps.clm`, `editor.latex`, `editor.quick_latex`, `dashboard.clm_stats` |
| **Real Estate** | `editor.latex`, `editor.quick_latex`, `editor.ai_scoring`, `dashboard.clm_stats` |
| **Insurance** | `editor.latex`, `editor.quick_latex` |
| **Technology** | *(nothing — all features enabled)* |
| **Education** | `apps.clm`, `editor.branching`, `dashboard.clm_stats` |
| **Government** | `editor.latex`, `editor.quick_latex` |
| **Consulting** | *(nothing — all features enabled)* |
| **General** | *(nothing — all features enabled, fully customisable)* |
