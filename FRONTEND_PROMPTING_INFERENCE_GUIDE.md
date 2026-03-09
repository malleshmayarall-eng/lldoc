# Frontend Prompting — Inference System Guide

## Overview

The inference system provides **hierarchical context** to every AI service in the document editor. It has two loops:

- **Read Path** — assembles dense context strings (SELF → LATERAL → PARENT → PATH → ROOT) from cached inference data. Instant, no API call needed when tree is loaded.
- **Write Path** — embeds components, finds cross-component dependencies via MaxSim + cross-encoder, writes lateral edges into a graph. Runs async on save or on-demand.

---

## Architecture

```
┌─ Frontend ────────────────────────────────────────────────────────────┐
│                                                                       │
│  inferenceService.js         useDocumentInference       InferencePanel│
│  ─ API client                ─ state management         ─ UI tree     │
│  ─ all 18 endpoints          ─ tree/stale/edges cache   ─ actions     │
│                               ─ derived maps                          │
│                                                                       │
│  useInferenceContext                                                   │
│  ─ builds context strings from cached tree data                       │
│  ─ getContextForParagraph / Section / Table / Document                │
│  ─ fetchServerContext for full accuracy                                │
│                                                                       │
│  AIChatPanel  ParagraphAiSidebar  AIServicesPanel  ...                │
│  ─ inject inference context into every AI call                        │
└───────────────────────────────────────────────────────────────────────┘
         │
         │  axios (api.js → /api/ai/inference/...)
         ▼
┌─ Backend ─────────────────────────────────────────────────────────────┐
│  aiservices/inference/                                                 │
│    models.py     → ComponentInference, SectionAggregate, LateralEdge  │
│    engine.py     → TreeInferenceEngine (LLM-based bottom-up walk)     │
│    write_path.py → embed → MaxSim → rerank → graph UPSERT            │
│    context_window.py → SELF → LATERAL → PARENT → PATH → ROOT         │
│    views.py      → 18 endpoints                                       │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Files Created

| File | Role |
|------|------|
| `src/constants/api.js` | Added `INFERENCE` section with all 18 endpoint constants |
| `src/services/inferenceService.js` | API client — all inference endpoints, convenience helpers |
| `src/hooks/useDocumentInference.js` | React hook — state management, tree/stale/edges, actions |
| `src/hooks/useInferenceContext.js` | React hook — builds context strings for AI service calls |
| `src/components/InferencePanel.jsx` | Sidebar panel — tree view, stats, actions, write-path status |

---

## API Endpoints (all prefixed `/api/ai/inference/`)

### Trigger Inference (LLM)
| Method | URL | Purpose |
|--------|-----|---------|
| `POST` | `/documents/<id>/infer/` | Full document inference (incremental) |
| `POST` | `/sections/<id>/infer/` | Single section subtree |
| `POST` | `/components/<type>/<id>/infer/` | Single component |

### Read Results
| Method | URL | Purpose |
|--------|-----|---------|
| `GET` | `/documents/<id>/summary/` | Document-level inference summary |
| `GET` | `/documents/<id>/context/` | Pre-built context string |
| `GET` | `/sections/<id>/summary/` | Section aggregate inference |
| `GET` | `/sections/<id>/context/` | Section context string |
| `GET` | `/sections/<id>/components/` | Child component inferences |
| `GET` | `/documents/<id>/tree/` | Full inference tree (single request) |
| `GET` | `/documents/<id>/stale/` | List stale components |

### Write-Path (Lateral Edges)
| Method | URL | Purpose |
|--------|-----|---------|
| `POST` | `/documents/<id>/write-path/` | Run write-path for document |
| `POST` | `/write-path/components/<type>/<id>/` | Single component write-path |
| `GET` | `/lateral-edges/<type>/<id>/` | Edges from a component |
| `GET` | `/documents/<id>/lateral-edges/` | All edges in document |
| `POST` | `/documents/<id>/rebuild-embeddings/` | Re-embed without reranking |
| `GET` | `/documents/<id>/write-path-status/` | Health check |

---

## Service Usage

### `inferenceService.js`

```js
import inferenceService from '../services/inferenceService';
// or named exports:
import { inferDocument, getDocumentTree, runWritePathDocument } from '../services/inferenceService';

// Run full inference
const result = await inferenceService.inferDocument(documentId);

// Get tree (all inferences in one request)
const tree = await inferenceService.getDocumentTree(documentId);

// Run write-path
const wp = await inferenceService.runWritePathDocument(documentId, 'sync');

// Get lateral edges for a paragraph
const edges = await inferenceService.getLateralEdges('paragraph', paragraphId);

// Full refresh (inference + write-path)
const { inference, writePath } = await inferenceService.fullRefresh(documentId);

// Health snapshot (staleness + write-path status)
const { stale, writePathStatus } = await inferenceService.getHealthSnapshot(documentId);
```

---

## Hook Usage

### `useDocumentInference(documentId, options?)`

Auto-fetches tree on mount. Returns state + actions + derived maps.

```jsx
import useDocumentInference from '../hooks/useDocumentInference';

function MyComponent({ documentId }) {
  const {
    // State
    tree,              // Full inference tree
    stale,             // Stale components list
    writePathStatus,   // Write-path health
    loading,           // Tree loading
    inferring,         // LLM inference running
    writingPath,       // Write-path running
    error,
    stats,             // { totalSections, totalComponents, totalStale, hasDocumentSummary }

    // Direct lookup by ID
    sectionInferenceMap,    // { sectionId: aggregate }
    componentInferenceMap,  // { componentId: inference }
    staleComponentIds,      // Set<componentId>

    // Getters
    getSectionInference,    // (sectionId) => aggregate | null
    getComponentInference,  // (componentId) => inference | null
    isComponentStale,       // (componentId) => boolean
    getLateralEdgesFor,     // async (type, id) => edges (cached)

    // Actions
    runInference,           // async (opts?) => result
    runWritePath,           // async (asyncMode?) => result
    fullRefresh,            // async (opts?) => { inference, writePath }
    runSectionInference,    // async (sectionId, opts?) => result
    runComponentInference,  // async (type, id, opts?) => result
    fetchTree,              // async () => refresh tree
    fetchStale,             // async () => refresh stale
  } = useDocumentInference(documentId, {
    autoFetchTree: true,    // default true
    pollStaleMs: 30000,     // poll staleness every 30s (0 = off)
  });
}
```

### `useInferenceContext(documentId, options?)`

Extends `useDocumentInference` with context builders for AI prompt injection.

```jsx
import useInferenceContext from '../hooks/useInferenceContext';

function AIChatEnhanced({ documentId, paragraphId, sectionId }) {
  const {
    // All of useDocumentInference, plus:
    getContextForParagraph,   // (paragraphId, sectionId) => context string
    getContextForSection,     // (sectionId) => context string
    getContextForTable,       // (tableId, sectionId) => context string
    getContextForDocument,    // () => context string
    fetchServerContext,       // async (scope, scopeId) => full server context
    prefetchLateral,          // async (type, id) => cache lateral edges
  } = useInferenceContext(documentId);

  const handleChat = async (message) => {
    // Get inference context (instant, from cache)
    const ctx = getContextForParagraph(paragraphId, sectionId);

    // Inject into AI call
    const response = await aiService.chat({
      document_id: documentId,
      scope: 'paragraph',
      scope_id: paragraphId,
      message,
      inference_context: ctx,  // ← dense hierarchical context
    });
  };
}
```

---

## Component Usage

### `InferencePanel`

Drop into any sidebar to show inference state:

```jsx
import InferencePanel from '../components/InferencePanel';

<InferencePanel documentId={documentId} />
```

Shows:
- Stats bar (sections, components, stale count)
- Document summary
- Write-path status badge
- Action buttons: Infer / Edges / Full Refresh
- Collapsible tree with staleness indicators

---

## Wiring Into Existing AI Services

Each AI service should inject inference context into its API calls. The context is a dense string that the backend prepends to the LLM prompt.

### Pattern: AI Chat

```jsx
// In AIChatPanel.jsx
import useInferenceContext from '../hooks/useInferenceContext';

// Inside component:
const { getContextForParagraph, getContextForSection, getContextForDocument }
  = useInferenceContext(documentId);

// When sending chat:
const ctx = scope === 'paragraph'
  ? getContextForParagraph(scopeId, sectionId)
  : scope === 'section'
    ? getContextForSection(scopeId)
    : getContextForDocument();

await aiService.chat({
  document_id: documentId,
  scope,
  scope_id: scopeId,
  message,
  inference_context: ctx,
});
```

### Pattern: Paragraph AI Review

```jsx
// Prefetch lateral edges when paragraph is selected
useEffect(() => {
  if (paragraphId) prefetchLateral('paragraph', paragraphId);
}, [paragraphId]);

// Context is auto-injected by the backend (it reads inference from DB)
// The frontend just needs the tree loaded for staleness indicators
const isStale = isComponentStale(paragraphId);
```

### Pattern: Document Scoring

```jsx
// Document scoring uses document-level context
const ctx = getContextForDocument();
await aiService.scoreDocument(documentId, { inference_context: ctx });
```

---

## Staleness Indicators

Use `isComponentStale(componentId)` or `staleComponentIds` to show visual indicators:

```jsx
// In ParagraphRenderer or SectionHeader
const isStale = isComponentStale(paragraphId);

<div className={isStale ? 'border-l-2 border-amber-400' : ''}>
  {/* paragraph content */}
  {isStale && (
    <span className="text-xs text-amber-500" title="Inference is stale — content changed since last analysis">
      ⚡
    </span>
  )}
</div>
```

---

## Lateral Edges in UI

Show cross-component dependencies discovered by the write-path:

```jsx
const edges = await getLateralEdgesFor('paragraph', paragraphId);
// edges = { component_id, component_type, total_edges, critical_edges, contextual_edges, edges: [...] }

{edges?.edges?.map(edge => (
  <div key={edge.id} className={edge.edge_type === 'critical' ? 'text-red-600' : 'text-blue-600'}>
    <span className="font-medium">{edge.edge_type === 'critical' ? '🔴' : '🔵'}</span>
    {edge.target_label}: {edge.target_summary}
  </div>
))}
```

---

## Full AI Service Integration Map

| AI Service | Backend Endpoint | Context Source | Integration |
|------------|-----------------|----------------|-------------|
| **AI Chat** | `POST /ai/chat/` | `getContextForParagraph/Section/Document` | Inject `inference_context` in request body |
| **AI Chat Edit** | `POST /ai/chat-edit/` | `getContextForSection` | Same pattern |
| **Paragraph Review** | `GET /ai/paragraphs/<id>/ai-review/` | Auto (backend reads inference DB) | Show staleness badge |
| **Paragraph Scoring** | Local ONNX (MiniLM6) | N/A (runs in browser) | Independent |
| **Document Scoring** | `POST /ai/score-document/<id>/` | `getContextForDocument` | Inject context |
| **LaTeX Generation** | `POST /ai/documents/<id>/generate-latex/` | `getContextForSection` | Inject context |
| **Content Generation** | `POST /ai/generate-from-prompt/` | `getContextForDocument` | Inject context |

---

## Recommended Lifecycle

1. **Document opens** → `useDocumentInference` auto-fetches tree + stale + write-path status
2. **User edits paragraph** → backend signal marks inference stale → write-path runs async
3. **AI service call** → `useInferenceContext` builds context string from cached tree
4. **User clicks "Infer"** → full LLM inference runs, tree refreshes
5. **User clicks "Edges"** → write-path runs, lateral edges created/refreshed
6. **User clicks "Full"** → inference + write-path in sequence
