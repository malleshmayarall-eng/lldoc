# Copilot Instructions — LL-Doc Frontend

## Project Overview

This is a **React 19 + Vite 7** document drafting application ("LL-Doc") that lives inside the Django backend monorepo at `backend/frontend/`. It features a rich document editor with sections, paragraphs, tables, images, file attachments, LaTeX code blocks, inline references, metadata, export-to-PDF, workflow approvals, CLM (Contract Lifecycle Management), DMS (Document Management System), file sharing, and local AI services (ONNX-based). Styling uses **Tailwind CSS 4** with utility classes only — no CSS modules or styled-components.

## Monorepo Context

The frontend lives at `backend/frontend/` alongside the Django backend. The Django backend is documented in `backend/.github/copilot-instructions.md`. Key integration points:

- **API proxy**: Vite dev server proxies `/api` → `http://localhost:8000` (Django)
- **Auth**: Session-based (cookies), `withCredentials: true` on Axios — no JWT tokens
- **CSRF**: Disabled server-side for `/api/` paths — no CSRF token handling needed
- **All backend models use UUID primary keys** — frontend always passes UUIDs as route params and API IDs
- **Backend apps map to frontend modules**: `documents/` → editor + services, `clm/` → CLM pages, `dms/` → DMS pages, `fileshare/` → FileShare pages, `user_management/` → auth + profile + settings

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | React 19.2 (JSX, **no TypeScript**) |
| **Build** | Vite 7.2 with path aliases |
| **Styling** | Tailwind CSS 4.1 — utility classes in JSX `className` |
| **State** | Zustand 5 (`devtools` middleware) for global stores; React hooks for editor state |
| **Routing** | react-router-dom v7 |
| **HTTP** | Axios — session cookies, `withCredentials: true` |
| **Icons** | `lucide-react` — always import individual icons |
| **Drag & Drop** | `@hello-pangea/dnd` |
| **PDF Viewer** | `react-pdf` |
| **Charts** | `recharts` |
| **Local AI** | `@xenova/transformers` + `onnxruntime-web` (MiniLM-L6 model) |
| **Toasts** | `react-hot-toast` |
| **Linting** | ESLint flat config with `react-hooks` + `react-refresh` plugins |

## Path Aliases

Configured in `vite.config.js`. **Always use aliases for imports — never use relative paths climbing out of `src/`.**

| Alias | Path |
|---|---|
| `@` | `src/` |
| `@components` | `src/components/` |
| `@pages` | `src/pages/` |
| `@hooks` | `src/hooks/` |
| `@utils` | `src/utils/` |
| `@services` | `src/services/` |
| `@constants` | `src/constants/` |
| `@config` | `src/config/` |
| `@contexts` | `src/contexts/` |
| `@store` | `src/store/` |
| `@assets` | `src/assets/` |

## Folder Structure

```
src/
├── components/          # Reusable UI components (barrel: index.js)
│   ├── panels/          # Sidebar panel components (BasicInfoPanel, ImagesPanel, AttachmentsPanel)
│   ├── toolbar/         # Toolbar components (FileToolbar)
│   └── clm/             # CLM-specific components (ui/SharedUI.jsx)
├── config/              # App configuration (app.config.js)
├── constants/           # API endpoints (api.js), sharing constants
├── contexts/            # React Contexts (AuthContext.jsx — provides useAuth())
├── hooks/               # Custom hooks (barrel: index.js)
│   ├── documentEditor/  # Decomposed editor hooks (useDocumentActions, useDocumentLifecycle, etc.)
│   └── clm/             # CLM hooks (useUndoRedo)
├── pages/               # Route-level page components
│   ├── documentDrafter/ # Sub-components for the editor page (RightSidebar, DocumentHeader, AccessBanners)
│   ├── clm/             # CLM app entry (ClmApp.jsx)
│   ├── dms/             # DMS pages (DmsApp, DmsDocumentDetails)
│   └── fileshare/       # FileShare page (FileShareApp)
├── services/            # API service layer (barrel: index.js)
│   ├── paragraphs/      # Paragraph-specific services (paragraphService, sentenceService, etc.)
│   ├── aiServices/      # Local AI: ONNX model, tokenizer, paragraph inference
│   └── clm/             # CLM API service (clmApi.js)
├── store/               # Zustand stores
│   ├── metadataStore.js # Document metadata state (344 lines)
│   ├── workflowStore.js # Workflows, approvals, comments, notifications (487 lines)
│   └── documentStore.js # Document list state (legacy class-based + Zustand placeholder)
├── styles/              # Component-specific CSS (tables, citations)
├── templates/           # Document & editor template configs
└── utils/               # Pure utility functions (barrel: index.js)
    └── clm/             # CLM utilities (clmNotify.js)
```

## Key Architecture Patterns

### API Layer (3-tier)

1. **Endpoints** → `src/constants/api.js` — all URL templates as functions, organized by domain namespace (`DOCUMENTS`, `SECTIONS`, `PARAGRAPHS`, `TABLES`, `FILESHARE`, `EXPORT_STUDIO`, `SHARING`, `WORKFLOWS`, etc.)
2. **Services** → `src/services/*.js` — each service imports `api` (Axios instance from `services/api.js`) and calls endpoints
3. **Components** → import services and call them

**When adding a new API endpoint:**
1. Add the URL to `constants/api.js` under the appropriate namespace
2. Add the service method to the relevant service file in `services/`
3. Import the service in the component that needs it
4. Re-export from `services/index.js` if the service is new

**Service pattern example:**
```js
import api from './api';
import { API_ENDPOINTS } from '@constants/api';

const myService = {
  getItems: async (parentId) => {
    const response = await api.get(API_ENDPOINTS.MY_DOMAIN.LIST(parentId));
    return normalizeListResponse(response);
  },
};
export default myService;
```

The `normalizeListResponse()` helper handles varied API shapes (paginated `.results` arrays vs plain arrays vs single objects).

### State Management

| Store | Purpose | Pattern |
|---|---|---|
| `metadataStore.js` | Document metadata CRUD, schema, history | Zustand `create()` + `devtools()` |
| `workflowStore.js` | Workflows, tasks, approvals, comments, notifications | Zustand `create()` (no devtools) |
| `documentStore.js` | Document list state | Legacy class-based (being migrated to Zustand) |

- **Zustand stores**: Import the hook directly — no providers needed. `import useMetadataStore from '@store/metadataStore'`
- **`useDocumentEditor(documentId)`** (`hooks/useDocumentEditor.js`): Main editor hook that composes `useDocumentLifecycle`, `useDocumentDerivedData`, and `useDocumentActions`. Returns the complete document tree, CRUD actions, derived data, and save state.
- **AuthContext** (`contexts/AuthContext.jsx`): Session-based auth via React Context. Access via `useAuth()` → `{ user, login, register, logout, isAuthenticated, loading }`.

### Document Data Model

The editor works with a **complete document** object containing nested sections, each with ordered components:
- **Sections** have an `order` field and contain components
- **Paragraphs** have `content` (HTML string), `order`, optional `ai_content`, and nested sentences
- **Components** are identified by type and ordered within sections (paragraphs, tables, images, file components, LaTeX code blocks)
- The `PagedDocument` component renders the document in a paged (A4) layout

### ETag / Optimistic Concurrency

`documentService` uses `etagManager` (from `utils/etagManager.js`) for optimistic concurrency on document saves. The `SaveCoordinator` (from `utils/saveCoordinator.js`) and `partialSaveQueue` manage partial/incremental saves.

## Component Conventions

- **Functional components only** — no class components
- **Default exports** for components; named exports for hooks/utilities
- Components that are part of the public API are re-exported from `components/index.js`
- Use `lucide-react` icons; import individually: `import { Save, Download } from 'lucide-react'`
- Keep components in `src/components/` unless they are page-level (then `src/pages/`)
- Sub-components and local helpers can be defined in the same file above the main export
- When creating new components, add them to `components/index.js` if they'll be imported from multiple places

## Styling

- **Tailwind utility classes only** in `className` — no inline `style` objects unless absolutely necessary (e.g., dynamic pixel values for drag positions)
- Custom theme colors in `tailwind.config.js`: `primary-50..900`, `background`, `foreground`, `border`
- Font: Inter (sans), Georgia (serif)
- Use responsive/interactive variants: `hover:`, `focus:`, `transition`, `rounded-xl`, `shadow-sm`
- Prefer `text-sm`, `text-xs` for UI text; `gap-*` and `space-y-*` for spacing
- A few component-specific CSS files exist in `src/styles/` (tables, citations) imported via `index.css`
- `index.css` imports Tailwind via `@import "tailwindcss"` and defines base layer overrides

## Routing

Defined in `src/App.jsx` — all protected routes are wrapped in `<ProtectedRoute>` inside `<DashboardLayout>`:

| Path | Component | Module |
|---|---|---|
| `/dashboard` | `Dashboard` | Core |
| `/documents` | `Documents` | Core |
| `/drafter/:id` | `DocumentDrafterNew` | Document Editor |
| `/dms` | `DmsApp` | DMS |
| `/dms/documents/:id` | `DmsDocumentDetails` | DMS |
| `/fileshare` | `FileShareApp` | FileShare |
| `/clm/*` | `ClmApp` | CLM (sub-routing) |
| `/profile` | `Profile` | User |
| `/settings` | `Settings` | User |
| `/login`, `/register` | Auth pages | Public |

## Main Editor Page

`src/pages/DocumentDrafterNew.jsx` (~5800 lines) is the primary editor. **It is large and monolithic — avoid adding more logic here.** Instead:
- Extract new features into **dedicated components** in `src/components/`
- Create new **hooks** in `src/hooks/` (or `src/hooks/documentEditor/`) for stateful logic
- Create new **services** in `src/services/` for API calls

The editor page uses:
- **RightSidebar** (`pages/documentDrafter/components/RightSidebar.jsx`) — hosts panels like `ExportSettingsPanel`
- **DocumentHeader** (`pages/documentDrafter/components/DocumentHeader.jsx`) — top bar
- **AccessBanners** (`pages/documentDrafter/components/AccessBanners.jsx`) — sharing/permission banners

## Feature Modules

### Export Studio / Header & Footer

The Export Studio panel (`ExportSettingsPanel.jsx`) manages PDF export config:
- **Mode toggle** per region (None / PDF Overlay / Template)
- **HeaderFooterCropEditor** — PDF upload, crop selection, auto-detect, and a library of saved configs
- **ActiveIndicator** — shows active config with overlay options (height, opacity, page scope)
- API namespace: `API_ENDPOINTS.EXPORT_STUDIO.*`

### CLM (Contract Lifecycle Management)

- Entry: `pages/clm/ClmApp.jsx` — handles sub-routing for CLM
- Components: `components/clm/` — workflow canvas, nodes (AI, Action, Gate, Input, Output, Rule, Scraper, Validator, Listener), document manager, execution results, chat
- Services: `services/clm/clmApi.js`
- Hooks: `hooks/clm/useUndoRedo.js`
- Utils: `utils/clm/clmNotify.js`
- A separate `frontend_clm/` directory at root contains a standalone CLM sub-app (its own Vite + Tailwind project)

### DMS (Document Management System)

- Entry: `pages/dms/DmsApp.jsx` + `DmsDocumentDetails.jsx`
- Components: `pages/dms/components/`
- Service: `services/dmsService.js`

### FileShare (Drive)

- Entry: `pages/fileshare/FileShareApp.jsx`
- Service: `services/fileshareService.js`
- API: `API_ENDPOINTS.FILESHARE.*` (folders + files)

### Local AI Services

- Located in `services/aiServices/`
- Uses `@xenova/transformers` + `onnxruntime-web` with MiniLM-L6 model
- `onnxModelService.js` — model loading/inference
- `paragraphInferenceService.js` — paragraph-level AI analysis
- `aiApiService.js` — server-side AI API calls (Gemini via backend)
- ONNX runtime files served from `public/onnxruntime-web/`

### Sharing System

- Components: `ShareDialog`, `SharesList`, `UserTeamPicker`, `AccessManager`, `PublicLinkDialog`
- Service: `services/sharingService.js`
- Constants: `constants/sharingConstants.js`
- Backend uses `GenericForeignKey` — sharing works across documents, folders, files

### Metadata System

- Components: `MetadataSidebar`, `MetadataFormEditor`, `MetadataTableEditor`, `MetadataPlaceholderPicker`
- Store: `store/metadataStore.js` (Zustand)
- Service: `services/metadataService.js`

### Workflow System

- Components: `ApprovalPanel`, `WorkflowAssignment`, `WorkflowComments`, `NotificationCenter`, `MyTasks`
- Store: `store/workflowStore.js` (Zustand)
- Service: `services/workflowService.js`
- API namespaces: `WORKFLOWS`, `WORKFLOW_APPROVALS`, `WORKFLOW_COMMENTS`, `WORKFLOW_NOTIFICATIONS`

## Dev Server

```bash
cd frontend
npm install           # Install dependencies
npm run dev           # Starts Vite dev server on localhost:3000
npm run build         # Production build to dist/
npm run lint          # ESLint check
npm run ai:check      # Self-test for AI services
npm run ai:sync-onnx  # Copy ONNX runtime files to public/
```

The Vite dev server proxies `/api` to `http://localhost:8000` (Django backend). The Axios base URL is `/api` in development, `http://localhost:8000/api` in production.

## ESLint Configuration

- Flat config in `eslint.config.js`
- Plugins: `react-hooks`, `react-refresh`
- `no-unused-vars` rule ignores variables starting with uppercase or underscore (`varsIgnorePattern: '^[A-Z_]'`)
- Files: `**/*.{js,jsx}` — no TypeScript

## Important Conventions

1. **No TypeScript** — plain JavaScript only (`.js`, `.jsx`)
2. **Barrel exports** — `components/index.js`, `services/index.js`, `hooks/index.js`, `utils/index.js` re-export modules; always add new modules to the relevant barrel file
3. **Path aliases** — always use `@components/...`, `@services/...`, etc. Never `../../`
4. **UUID IDs everywhere** — all entity IDs from the backend are UUIDs; route params use `:id` (UUID strings)
5. **Session auth** — no JWT, no Authorization header; cookies handle auth automatically via `withCredentials: true`
6. **Error handling** — Axios interceptor in `services/api.js` catches 401s and redirects to `/login`
7. **No test framework** — there are no test scripts or test files configured
8. **Toast notifications** — use `react-hot-toast` for user feedback
9. **Drag & Drop** — use `@hello-pangea/dnd` (not `react-beautiful-dnd`)
10. **React Query** — `@tanstack/react-query` is a dependency but usage is selective; many components still use direct service calls with `useEffect`

## When Making Changes

1. **Check `constants/api.js`** for existing endpoint patterns before adding new ones
2. **Follow existing service method signatures** — async functions returning `response.data`
3. **Use Tailwind utilities** matching the existing design language (`rounded-xl`, `shadow-sm`, `border-gray-200`, etc.)
4. **Keep `DocumentDrafterNew.jsx` lean** — push new logic into hooks/components/services
5. **Add new components to `components/index.js`** if they'll be imported from multiple places
6. **Add new services to `services/index.js`** barrel file
7. **New Zustand stores** → create in `store/`, use `create()` + `devtools()` middleware pattern
8. **New hooks** → add to `hooks/` and export from `hooks/index.js`
9. **CLM features** → keep isolated in `components/clm/`, `pages/clm/`, `services/clm/`, `hooks/clm/`, `utils/clm/`
10. **Always verify** the backend endpoint exists in the Django app before adding frontend integration

## Key File Quick Reference

| What | Where |
|---|---|
| App entry + routing | `src/App.jsx` |
| Auth provider + context | `src/contexts/AuthContext.jsx` |
| Axios instance + interceptors | `src/services/api.js` |
| All API endpoint URLs | `src/constants/api.js` |
| App config (base URL, etc.) | `src/config/app.config.js` |
| Main editor page (huge) | `src/pages/DocumentDrafterNew.jsx` |
| Editor hook (composition root) | `src/hooks/useDocumentEditor.js` |
| Editor sub-hooks | `src/hooks/documentEditor/` |
| All component exports | `src/components/index.js` |
| All service exports | `src/services/index.js` |
| Zustand metadata store | `src/store/metadataStore.js` |
| Zustand workflow store | `src/store/workflowStore.js` |
| PDF export settings panel | `src/components/ExportSettingsPanel.jsx` |
| Header/footer crop editor | `src/components/HeaderFooterCropEditor.jsx` |
| Paged document renderer | `src/components/PagedDocument.jsx` |
| CLM workflow canvas | `src/components/clm/WorkflowCanvas.jsx` |
| ETag manager | `src/utils/etagManager.js` |
| Save coordinator | `src/utils/saveCoordinator.js` |
| Tailwind config | `tailwind.config.js` |
| Vite config + aliases | `vite.config.js` |
| ESLint flat config | `eslint.config.js` |
