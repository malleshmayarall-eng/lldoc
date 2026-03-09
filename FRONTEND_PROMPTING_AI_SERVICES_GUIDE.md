# Frontend Prompting Guide — AI Services Configuration

## Overview

AI services are configurable at multiple levels. Each document type can have
its own AI profile, and individual documents can override any setting. The
config is automatically preserved when documents are branched, duplicated,
or promoted.

| Capability | Description |
|---|---|
| **Document-Type Presets** | Org-level AI profiles per document type (e.g. billing, contract, NDA) |
| **Per-Document Config** | Override any AI service setting on a specific document |
| **Quick Toggle** | Enable/disable individual AI services with one click |
| **Bulk Toggle** | Enable/disable multiple services at once |
| **Reset** | Clear per-document overrides and fall back to preset/factory defaults |
| **Service Status** | Lightweight endpoint for sidebar UI — just enabled/disabled per service |
| **Branch/Duplicate Preservation** | AI config copies automatically with the document |
| **Custom System Prompts** | Per-type and per-document system prompts for all AI calls |
| **AI Focus** | Per-type and per-document focus instructions |

---

## Merge Chain (how final config is resolved)

```
┌──────────────────────────────────────────────┐
│  Factory Defaults                            │
│  (all services enabled, mode = "legal")      │
└──────────────┬───────────────────────────────┘
               ▼
┌──────────────────────────────────────────────┐
│  DocumentTypeAIPreset.services_config        │
│  (org-level per-type overrides)              │
│  e.g. billing: paragraph_scoring OFF,        │
│       data_validation ON with financial mode │
└──────────────┬───────────────────────────────┘
               ▼
┌──────────────────────────────────────────────┐
│  DocumentAIConfig.services_config            │
│  (per-document overrides)                    │
│  e.g. this specific invoice needs chat OFF   │
└──────────────┬───────────────────────────────┘
               ▼
┌──────────────────────────────────────────────┐
│  Effective Config (returned by API)          │
│  = fully resolved, ready for frontend UI     │
└──────────────────────────────────────────────┘
```

The API returns both the raw per-document overrides **and** the fully resolved
`effective_config`, `effective_system_prompt`, and `effective_ai_focus` — so
the frontend never needs to compute the merge itself.

---

## Available AI Services

| Key | Label | Description |
|-----|-------|-------------|
| `document_scoring` | Document Scoring (LLM) | Overall quality/risk scoring via Gemini |
| `paragraph_review` | Paragraph AI Review | Per-paragraph legal/quality review |
| `paragraph_scoring` | Paragraph Scoring (ONNX / LLM) | Per-paragraph numeric scoring |
| `paragraph_rewrite` | Paragraph Rewrite | AI-assisted paragraph rewriting |
| `data_validation` | Data Validation AI | Numerical accuracy, totals, calculations |
| `chat` | AI Chat | Conversational AI assistant |
| `analysis` | Document Analysis | Risk, summary, compliance analysis |
| `generation` | AI Content Generation | Generate document content from prompts |

### Per-Service Config Schema

Each service entry in `services_config` follows this shape:

```json
{
  "enabled": true,
  "mode": "legal",
  "model": "gemini-3-flash-preview",
  "temperature": 0.0,
  "max_tokens": 4000,
  "system_prompt_override": null,
  "options": {}
}
```

Only `enabled` is required. All other fields are optional and service-specific.

**Mode values:** `"legal"` | `"financial"` | `"data"` | `"custom"`

---

## Data Models

### DocumentTypeAIPreset

```
id                UUID (PK)
document_type     string (unique)   — maps to Document.document_type
display_name      string            — human-friendly label
description       text              — explanation for the UI
services_config   JSON              — per-service config dict
system_prompt     text              — prepended to every AI call
ai_focus          text              — AI focus instructions
created_by        FK→User
created_at        datetime
updated_at        datetime
```

### DocumentAIConfig

```
id                UUID (PK)
document          OneToOne→Document
services_config   JSON              — per-document overrides
system_prompt     text              — per-document prompt override
ai_focus          text              — per-document focus override
created_at        datetime
updated_at        datetime
```

### MasterDocument (added fields)

```
default_ai_service_config   JSON   — pushed to branches on creation
default_ai_system_prompt    text   — pushed to branches on creation
default_ai_focus            text   — pushed to branches on creation
```

---

## API Reference

Base URL: `http://localhost:8000/api/ai/`

### 1. Document-Type AI Presets (Org-Level)

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/presets/` | List all presets |
| `POST` | `/presets/` | Create a preset |
| `GET` | `/presets/<uuid>/` | Get preset detail |
| `PATCH` | `/presets/<uuid>/` | Update preset |
| `DELETE` | `/presets/<uuid>/` | Delete preset |
| `GET` | `/presets/by-type/?document_type=billing` | Get preset for a specific type |
| `GET` | `/presets/defaults/` | Get factory-default config + available services |

#### Create a Preset

```
POST /api/ai/presets/
Content-Type: application/json

{
  "document_type": "billing",
  "display_name": "Billing Documents",
  "description": "Optimised for invoices, receipts, and billing statements",
  "services_config": {
    "document_scoring": { "enabled": true, "mode": "financial" },
    "paragraph_review": { "enabled": true, "mode": "financial" },
    "paragraph_scoring": { "enabled": false },
    "paragraph_rewrite": { "enabled": true },
    "data_validation": {
      "enabled": true,
      "mode": "financial",
      "options": {
        "validate_calculations": true,
        "check_totals": true,
        "currency_format": "USD"
      }
    },
    "chat": { "enabled": true, "mode": "financial" },
    "analysis": { "enabled": true },
    "generation": { "enabled": true }
  },
  "system_prompt": "You are a financial document specialist. Focus on accuracy of numbers, line items, and totals.",
  "ai_focus": "Focus on numerical accuracy, totals, tax calculations, and line-item correctness."
}
```

**Response** `201 Created`:

```json
{
  "id": "a1b2c3d4-...",
  "document_type": "billing",
  "display_name": "Billing Documents",
  "description": "Optimised for invoices, receipts, and billing statements",
  "services_config": { "..." },
  "system_prompt": "You are a financial document specialist...",
  "ai_focus": "Focus on numerical accuracy...",
  "created_by": "uuid-of-user",
  "created_by_username": "john",
  "created_at": "2026-01-20T12:00:00Z",
  "updated_at": "2026-01-20T12:00:00Z"
}
```

#### Get Preset by Document Type

```
GET /api/ai/presets/by-type/?document_type=billing
```

Returns the preset if found. If no preset exists for that type, returns:

```json
{
  "status": "not_found",
  "message": "No preset for document_type \"billing\". Factory defaults apply.",
  "default_config": {
    "document_scoring": { "enabled": true, "mode": "legal" },
    "paragraph_review": { "enabled": true, "mode": "legal" },
    "..."
  }
}
```

#### Get Factory Defaults + Available Services

```
GET /api/ai/presets/defaults/
```

**Response:**

```json
{
  "default_services_config": {
    "document_scoring": { "enabled": true, "mode": "legal" },
    "paragraph_review": { "enabled": true, "mode": "legal" },
    "paragraph_scoring": { "enabled": true, "mode": "legal" },
    "paragraph_rewrite": { "enabled": true, "mode": "legal" },
    "data_validation": { "enabled": false, "mode": "data" },
    "chat": { "enabled": true, "mode": "legal" },
    "analysis": { "enabled": true, "mode": "legal" },
    "generation": { "enabled": true, "mode": "legal" }
  },
  "available_services": [
    { "key": "document_scoring", "label": "Document Scoring (LLM)" },
    { "key": "paragraph_review", "label": "Paragraph AI Review" },
    { "key": "paragraph_scoring", "label": "Paragraph Scoring (ONNX / LLM)" },
    { "key": "paragraph_rewrite", "label": "Paragraph Rewrite" },
    { "key": "data_validation", "label": "Data Validation AI" },
    { "key": "chat", "label": "AI Chat" },
    { "key": "analysis", "label": "Document Analysis" },
    { "key": "generation", "label": "AI Content Generation" }
  ]
}
```

Use this endpoint to populate a preset creation form with toggles pre-set to
factory defaults and the complete list of available service names/labels.

---

### 2. Per-Document AI Config

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/documents/<uuid>/config/` | Get full AI config (auto-creates if missing) |
| `PATCH` | `/documents/<uuid>/config/update/` | Update config (deep-merged) |
| `POST` | `/documents/<uuid>/config/toggle/` | Toggle one service on/off |
| `POST` | `/documents/<uuid>/config/bulk-toggle/` | Toggle multiple services |
| `POST` | `/documents/<uuid>/config/reset/` | Reset to defaults |
| `GET` | `/documents/<uuid>/config/status/` | Quick service status (lightweight) |

#### Get Document AI Config

```
GET /api/ai/documents/abc12345-.../config/
```

**Response** `200 OK`:

```json
{
  "id": "cfg-uuid-...",
  "document": "abc12345-...",
  "document_title": "Invoice #2024-001",
  "document_type": "billing",
  "services_config": {
    "data_validation": { "enabled": true, "options": { "check_totals": true } }
  },
  "system_prompt": "",
  "ai_focus": "",
  "effective_config": {
    "document_scoring": { "enabled": true, "mode": "financial" },
    "paragraph_review": { "enabled": true, "mode": "financial" },
    "paragraph_scoring": { "enabled": false },
    "paragraph_rewrite": { "enabled": true, "mode": "legal" },
    "data_validation": {
      "enabled": true,
      "mode": "financial",
      "options": { "validate_calculations": true, "check_totals": true }
    },
    "chat": { "enabled": true, "mode": "financial" },
    "analysis": { "enabled": true, "mode": "legal" },
    "generation": { "enabled": true, "mode": "legal" }
  },
  "effective_system_prompt": "You are a financial document specialist...",
  "effective_ai_focus": "Focus on numerical accuracy...",
  "preset_config": {
    "id": "preset-uuid-...",
    "document_type": "billing",
    "display_name": "Billing Documents",
    "services_config": { "..." },
    "system_prompt": "You are a financial document specialist...",
    "ai_focus": "Focus on numerical accuracy...",
    "..."
  },
  "created_at": "2026-01-20T12:00:00Z",
  "updated_at": "2026-01-20T12:00:00Z"
}
```

**Key fields for the frontend:**

| Field | Use |
|-------|-----|
| `services_config` | The raw per-document overrides (what the user explicitly changed) |
| `effective_config` | The fully resolved config (show this in the UI) |
| `effective_system_prompt` | Combined preset + document prompt (display in prompt editor) |
| `effective_ai_focus` | Resolved focus (display in focus editor) |
| `preset_config` | The document-type preset for reference (show "inherited from" info) |

#### Update Document AI Config (Deep Merge)

```
PATCH /api/ai/documents/abc12345-.../config/update/
Content-Type: application/json

{
  "services_config": {
    "paragraph_scoring": { "enabled": false },
    "data_validation": {
      "options": { "currency_format": "EUR" }
    }
  },
  "system_prompt": "Additionally, verify all EU VAT calculations.",
  "ai_focus": "Focus on EU regulatory compliance and VAT accuracy."
}
```

All fields are optional. `services_config` is **deep-merged** — only the keys
you send are updated; existing keys are preserved. Returns the full
`DocumentAIConfigSerializer` response.

#### Toggle One Service

```
POST /api/ai/documents/abc12345-.../config/toggle/
Content-Type: application/json

{
  "service": "paragraph_scoring",
  "enabled": false
}
```

Returns the full config response.

#### Bulk Toggle

```
POST /api/ai/documents/abc12345-.../config/bulk-toggle/
Content-Type: application/json

{
  "toggles": {
    "document_scoring": true,
    "paragraph_scoring": false,
    "data_validation": true
  }
}
```

Returns the full config response.

#### Reset to Defaults

```
POST /api/ai/documents/abc12345-.../config/reset/
```

Clears `services_config`, `system_prompt`, and `ai_focus`. The document will
now inherit everything from the document-type preset (or factory defaults if
no preset exists). Returns the full config response.

#### Quick Service Status (Sidebar)

```
GET /api/ai/documents/abc12345-.../config/status/
```

**Response:**

```json
{
  "document_id": "abc12345-...",
  "document_type": "billing",
  "services": {
    "document_scoring": { "enabled": true, "mode": "financial" },
    "paragraph_review": { "enabled": true, "mode": "financial" },
    "paragraph_scoring": { "enabled": false, "mode": "legal" },
    "paragraph_rewrite": { "enabled": true, "mode": "legal" },
    "data_validation": { "enabled": true, "mode": "financial" },
    "chat": { "enabled": true, "mode": "financial" },
    "analysis": { "enabled": true, "mode": "legal" },
    "generation": { "enabled": true, "mode": "legal" }
  },
  "has_custom_config": true,
  "has_custom_prompt": false
}
```

Use this endpoint for the document sidebar/toolbar where you only need to show
toggle switches. It's lighter than the full config endpoint.

---

## Branching & Duplication Behaviour

When a document is **branched** from a master:

1. `MasterDocument.default_ai_service_config` is pushed into the new
   document's `DocumentAIConfig.services_config`
2. `MasterDocument.default_ai_system_prompt` → `DocumentAIConfig.system_prompt`
3. `MasterDocument.default_ai_focus` → `DocumentAIConfig.ai_focus`

When a document is **duplicated**:

1. The source document's `DocumentAIConfig` is deep-copied to the new document
2. All per-document overrides, system prompt, and focus are preserved

When a document is **promoted to master**:

1. The document's `DocumentAIConfig.services_config` → `MasterDocument.default_ai_service_config`
2. `DocumentAIConfig.system_prompt` → `MasterDocument.default_ai_system_prompt`
3. `DocumentAIConfig.ai_focus` → `MasterDocument.default_ai_focus`

**Result:** Users configure AI services once and never have to reconfigure them
when branching, duplicating, or promoting documents.

---

## MasterDocument AI Fields

When creating or updating a master document, the following AI config fields
are available:

```
POST /api/documents/masters/
PATCH /api/documents/masters/<uuid>/

{
  "name": "Standard Invoice Template",
  "template_document": "<uuid>",
  "default_ai_service_config": {
    "document_scoring": { "enabled": true, "mode": "financial" },
    "paragraph_scoring": { "enabled": false },
    "data_validation": { "enabled": true, "mode": "financial" }
  },
  "default_ai_system_prompt": "You are a billing document specialist.",
  "default_ai_focus": "Verify totals, line items, and tax calculations."
}
```

These fields are serialised in `MasterDocumentDetailSerializer`,
`MasterDocumentCreateSerializer`, and `MasterDocumentUpdateSerializer`.

---

## React Component Patterns

### 1. AI Service Toggles Panel

A panel showing toggle switches for each AI service on a document:

```tsx
// Hook: useDocumentAIConfig.ts
const useDocumentAIConfig = (documentId: string) => {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchConfig = async () => {
    const res = await fetch(`/api/ai/documents/${documentId}/config/`);
    setConfig(await res.json());
    setLoading(false);
  };

  const toggleService = async (service: string, enabled: boolean) => {
    const res = await fetch(`/api/ai/documents/${documentId}/config/toggle/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service, enabled }),
    });
    setConfig(await res.json());
  };

  const bulkToggle = async (toggles: Record<string, boolean>) => {
    const res = await fetch(`/api/ai/documents/${documentId}/config/bulk-toggle/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toggles }),
    });
    setConfig(await res.json());
  };

  const resetToDefaults = async () => {
    const res = await fetch(`/api/ai/documents/${documentId}/config/reset/`, {
      method: 'POST',
    });
    setConfig(await res.json());
  };

  const updateConfig = async (updates: {
    services_config?: object;
    system_prompt?: string;
    ai_focus?: string;
  }) => {
    const res = await fetch(`/api/ai/documents/${documentId}/config/update/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    setConfig(await res.json());
  };

  useEffect(() => { fetchConfig(); }, [documentId]);

  return { config, loading, toggleService, bulkToggle, resetToDefaults, updateConfig };
};
```

### 2. AI Services Toggle Component

```tsx
const AIServicesPanel = ({ documentId }: { documentId: string }) => {
  const { config, loading, toggleService, resetToDefaults } = useDocumentAIConfig(documentId);

  if (loading) return <Spinner />;

  const effectiveConfig = config.effective_config;
  const hasOverrides = config.services_config && Object.keys(config.services_config).length > 0;

  return (
    <div className="ai-services-panel">
      <div className="header">
        <h3>AI Services</h3>
        {hasOverrides && (
          <button onClick={resetToDefaults} className="text-sm text-gray-500">
            Reset to defaults
          </button>
        )}
      </div>

      {Object.entries(effectiveConfig).map(([service, cfg]) => (
        <div key={service} className="service-row">
          <div>
            <span className="font-medium">{SERVICE_LABELS[service]}</span>
            {cfg.mode && <span className="text-xs text-gray-400 ml-2">{cfg.mode}</span>}
          </div>
          <Toggle
            checked={cfg.enabled}
            onChange={(enabled) => toggleService(service, enabled)}
          />
        </div>
      ))}

      {config.preset_config && (
        <p className="text-xs text-gray-400 mt-2">
          Inheriting from preset: {config.preset_config.display_name}
        </p>
      )}
    </div>
  );
};

const SERVICE_LABELS: Record<string, string> = {
  document_scoring: 'Document Scoring',
  paragraph_review: 'Paragraph Review',
  paragraph_scoring: 'Paragraph Scoring',
  paragraph_rewrite: 'Paragraph Rewrite',
  data_validation: 'Data Validation',
  chat: 'AI Chat',
  analysis: 'Document Analysis',
  generation: 'Content Generation',
};
```

### 3. Sidebar Quick Status

For a compact sidebar indicator showing which services are active:

```tsx
const AIStatusBadge = ({ documentId }: { documentId: string }) => {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    fetch(`/api/ai/documents/${documentId}/config/status/`)
      .then(r => r.json())
      .then(setStatus);
  }, [documentId]);

  if (!status) return null;

  const enabledCount = Object.values(status.services)
    .filter((s: any) => s.enabled).length;
  const totalCount = Object.keys(status.services).length;

  return (
    <div className="ai-status-badge">
      <span>{enabledCount}/{totalCount} AI services active</span>
      {status.has_custom_config && <span className="dot-custom" title="Custom config" />}
    </div>
  );
};
```

### 4. Preset Management (Admin/Settings Page)

```tsx
const PresetManager = () => {
  const [presets, setPresets] = useState([]);
  const [defaults, setDefaults] = useState(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/ai/presets/').then(r => r.json()),
      fetch('/api/ai/presets/defaults/').then(r => r.json()),
    ]).then(([presetList, factoryDefaults]) => {
      setPresets(presetList);
      setDefaults(factoryDefaults);
    });
  }, []);

  // Use defaults.available_services for the list of toggles
  // Use defaults.default_services_config to pre-populate new preset form
  // ...
};
```

### 5. System Prompt Editor

```tsx
const SystemPromptEditor = ({ documentId }: { documentId: string }) => {
  const { config, updateConfig } = useDocumentAIConfig(documentId);
  const [prompt, setPrompt] = useState('');
  const [focus, setFocus] = useState('');

  useEffect(() => {
    if (config) {
      setPrompt(config.system_prompt || '');
      setFocus(config.ai_focus || '');
    }
  }, [config]);

  const save = () => updateConfig({ system_prompt: prompt, ai_focus: focus });

  return (
    <div>
      <div>
        <label>Custom System Prompt</label>
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} />
        {config?.effective_system_prompt && (
          <details>
            <summary>Effective prompt (combined)</summary>
            <pre>{config.effective_system_prompt}</pre>
          </details>
        )}
      </div>
      <div>
        <label>AI Focus</label>
        <textarea value={focus} onChange={e => setFocus(e.target.value)} />
        {config?.effective_ai_focus && (
          <details>
            <summary>Effective focus (resolved)</summary>
            <pre>{config.effective_ai_focus}</pre>
          </details>
        )}
      </div>
      <button onClick={save}>Save</button>
    </div>
  );
};
```

---

## Workflow Examples

### Example 1: Setting up a "Billing" document type

1. **Create the preset** (admin does this once):
   ```
   POST /api/ai/presets/
   {
     "document_type": "billing",
     "display_name": "Billing Documents",
     "services_config": {
       "paragraph_scoring": { "enabled": false },
       "data_validation": { "enabled": true, "mode": "financial" }
     },
     "system_prompt": "You are a financial document specialist.",
     "ai_focus": "Verify calculations, totals, and line items."
   }
   ```

2. **Any new billing document** automatically inherits this config:
   ```
   GET /api/ai/documents/<billing-doc-uuid>/config/
   → effective_config shows paragraph_scoring OFF, data_validation ON
   ```

3. **User overrides one service** on a specific invoice:
   ```
   POST /api/ai/documents/<invoice-uuid>/config/toggle/
   { "service": "chat", "enabled": false }
   ```

4. **Branch from a master** — AI config flows through automatically.

### Example 2: Quick disable scoring on a contract

```
POST /api/ai/documents/<contract-uuid>/config/toggle/
{ "service": "document_scoring", "enabled": false }
```

### Example 3: Reset a document to its type's defaults

```
POST /api/ai/documents/<uuid>/config/reset/
```

This clears all per-document overrides. The document now inherits fully from
its document-type preset (or factory defaults).

---

## Frontend State Management Tips

1. **Use `effective_config`** for display — it's the resolved truth.
2. **Use `services_config`** to show which settings the user has explicitly
   overridden (highlight with a "customised" badge).
3. **Use `has_custom_config`** from the status endpoint to show a visual
   indicator that this document has custom AI settings.
4. **Use `preset_config`** to display "Inherited from: Billing Documents"
   and let the user see what the preset provides.
5. **After any mutation** (toggle, update, reset), the response includes the
   full updated config — update your local state from the response, don't
   refetch.
6. **Sidebar:** Use the lightweight `/config/status/` endpoint for the
   document list/sidebar where you only need enabled/disabled counts.
7. **Full config page:** Use `/config/` for the detailed settings panel.

---

## Error Handling

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `201` | Preset created |
| `400` | Validation error (e.g. missing `document_type`, invalid service name) |
| `404` | Document or preset not found |

All endpoints require authentication (`IsAuthenticated`).

---

## Quick Reference

| What | Endpoint |
|------|----------|
| List presets | `GET /api/ai/presets/` |
| Create preset | `POST /api/ai/presets/` |
| Get preset by type | `GET /api/ai/presets/by-type/?document_type=X` |
| Factory defaults | `GET /api/ai/presets/defaults/` |
| Get doc AI config | `GET /api/ai/documents/<uuid>/config/` |
| Update doc AI config | `PATCH /api/ai/documents/<uuid>/config/update/` |
| Toggle one service | `POST /api/ai/documents/<uuid>/config/toggle/` |
| Bulk toggle | `POST /api/ai/documents/<uuid>/config/bulk-toggle/` |
| Reset to defaults | `POST /api/ai/documents/<uuid>/config/reset/` |
| Quick status | `GET /api/ai/documents/<uuid>/config/status/` |
