# Copilot Instructions — Drafter Backend# Copilot Instructions — Drafter Backend



## Project Overview## Project Overview

Django 6.0 / DRF backend for an AI-assisted legal document editor. SQLite dev database, Python 3.14, session-based auth (`auth.User`). CSRF is disabled for all `/api/` paths via `drafter/middleware.py` (`DisableCSRFMiddleware`).Django 6.0 / DRF backend for an AI-assisted legal document editor. SQLite dev database, Python 3.14, session-based auth (default `auth.User`). CSRF is disabled for all `/api/` paths via `drafter/middleware.py`.



## Architecture — 10 Django Apps## Architecture — 7 Django Apps



| App | Role | Key files || App | Role | Key files |

|-----|------|-----------||-----|------|-----------|

| **documents** | Core: models, CRUD, export settings, structure (Section→Paragraph→Sentence→LatexCode→Table), branching, quick-latex, dashboard | `models.py` (~6.5k lines), `views.py` (~5.5k), `structure_views.py`, `workflow_views.py`, `branching_views.py`, `quick_latex_views.py`, `partial_save/` || **documents** | Core: models, CRUD, export settings, structure (Section→Paragraph→Sentence) | `models.py` (~6k lines), `views.py` (~7k), `structure_views.py`, `serializers.py` |

| **exporter** | PDF generation pipeline (HTML→xhtml2pdf + pypdf overlay) | `pdf_system.py` (~2.5k lines) || **exporter** | PDF generation pipeline (ReportLab canvas + pypdf overlay) | `pdf_system.py` (~2.5k lines) |

| **aiservices** | Gemini AI integration, document scoring, paragraph analysis | `gemini_ingest.py`, `paragraph_ai/` || **aiservices** | Gemini AI integration, document scoring, paragraph analysis | `gemini_ingest.py`, `paragraph_ai/` |

| **user_management** | Organization, UserProfile, Role, Team, OrganizationDocumentSettings | `models.py` — org access: `request.user.profile.organization` || **user_management** | Organization, UserProfile, Role, Team, OrganizationDocumentSettings | `models.py` — `request.user.profile.organization` is the access pattern |

| **sharing** | Generic sharing via `GenericForeignKey` + role-based access (viewer/commenter/editor) | `Share` model, `HasSharePermission`, `IsOwnerOrSharedWith` || **sharing** | Generic sharing via `GenericForeignKey` + role-based access | `Share` model, `HasSharePermission`, `IsOwnerOrSharedWith` |

| **fileshare** | Google-Drive-like file system (DriveFolder, DriveFile) | Org/team scoped file storage || **fileshare** | Google-Drive-like file system (DriveFolder, DriveFile) | Org/team scoped file storage |

| **dms** | PDF ingestion: stores PDFs in DB, text extraction, fuzzy search | `services.py` — `build_search_index()`, `compute_fuzzy_score()` || **dms** | PDF ingestion: stores PDFs in DB, text extraction, fuzzy search | `services.py` — `build_search_index()`, `compute_fuzzy_score()` |

| **clm** | Contract Lifecycle Management: visual workflow DAG (input→rule→AI→validator→action→output), document extraction, Celery tasks | `models.py` (~1.4k), `views.py` (~4.5k), `node_executor.py`, `tasks.py` |

| **viewer** | Token-based external document access (public/email_otp/invite_only), custom `ViewerUser` auth | `models.py` (ViewerToken, ViewerSession, ViewerComment), `authentication.py` |## Critical Patterns

| **communications** | Centralized alert system (in-app + email), category-based preferences | `models.py` (Alert, AlertPreference), `dispatch.py` — entry point: `send_alert()` |

### UUID Primary Keys Everywhere

## Critical PatternsAll models use `id = models.UUIDField(primary_key=True, default=uuid.uuid4)`. URL routes use `<uuid:pk>`. Never assume integer IDs.



### UUID Primary Keys Everywhere### JSONField Extensibility — `custom_metadata` & `processing_settings`

All models use `id = models.UUIDField(primary_key=True, default=uuid.uuid4)`. URL routes use `<uuid:pk>`. Never assume integer IDs.`Document.custom_metadata` (JSONField) stores arbitrary settings. The `processing_settings` sub-dict inside it is the source of truth for PDF export config (headers, footers, layout). Org-level defaults live in `OrganizationDocumentSettings.preferences.processing_defaults`.



### Organization Scoping### Config Merge Chain (org defaults → document overrides)

All data is org-scoped. Access pattern: `request.user.profile.organization`. CLM uses a `_get_org(request)` helper in `clm/views.py` with a dev fallback for unauthenticated requests.```

OrganizationDocumentSettings.preferences.processing_defaults

### JSONField Extensibility — `custom_metadata` & `processing_settings`  ↓  deep-merged via Document._merge_config()

`Document.custom_metadata` (JSONField) stores arbitrary settings. The `processing_settings` sub-dict inside it is the source of truth for PDF export config. Org-level defaults live in `OrganizationDocumentSettings.preferences.processing_defaults`.Document.custom_metadata.processing_settings

  ↓  stripped of removal markers

### Config Merge Chain (org defaults → document overrides)get_processing_defaults() → used by exporter

``````

OrganizationDocumentSettings.preferences.processing_defaults

  ↓  deep-merged via Document._merge_config()### `__removed__` Sentinel Pattern

Document.custom_metadata.processing_settingsWhen a user explicitly removes a setting (e.g., header PDF), store `"__removed__"` — **not** `None`, **not** `.pop()`. This prevents org defaults from leaking back through `_merge_config()`. The `get_processing_defaults()` method (models.py ~L1185) strips these before returning. See `views.py` `header_footer` PATCH for the canonical implementation.

  ↓  stripped of removal markers

get_processing_defaults() → used by exporter### Header/Footer Dual System

```Two independent systems coexist per document:

1. **PDF overlay**: Cropped regions from uploaded PDFs → `HeaderFooterPDF` model → stored in `processing_settings.header_pdf` / `footer_pdf`

### `__removed__` Sentinel Pattern2. **Text templates**: `HeaderFooterTemplate` → `Document.header_template` / `Document.header_config` → rendered via `get_effective_header_config()` → `get_rendered_header_config()`

When a user explicitly removes a setting (e.g., header PDF), store `"__removed__"` — **not** `None`, **not** `.pop()`. This prevents org defaults from leaking back through `_merge_config()`. The `get_processing_defaults()` method strips these before returning. See `views.py` `header_footer` PATCH for the canonical implementation.

Page-scope fields (`show_on_all_pages`, `show_on_first_page`, `show_pages`) control visibility per-page. The render engine (`_should_render` / `_should_render_pdf` in `pdf_system.py`) reads them.

### ETag-Based Concurrency Control

`DocumentViewSet` implements optimistic concurrency via `_get_document_etag()` / `_check_if_match()`. The frontend sends `If-Match` / `If-None-Match` headers. CORS exposes `ETag` via `CORS_EXPOSE_HEADERS`. Returns `412 Precondition Failed` on mismatch.### View File Organization

- `documents/views.py` — `DocumentViewSet` (huge, ~30 `@action` endpoints), plus `IssueViewSet`, `DocumentImageViewSet`, search viewsets

### Partial Save System (Change Envelope)- `documents/structure_views.py` — `SectionViewSet`, `ParagraphViewSet`, `SentenceViewSet`, `TableViewSet`, `HeaderFooterPDFViewSet`, `DocumentFileViewSet`

Editing uses `POST /api/documents/<id>/partial-save/` with a typed handler registry in `documents/partial_save/`. Each handler (SectionHandler, ParagraphHandler, TableHandler, LatexCodeHandler, ImageHandler, FileHandler) extends `ChangeHandler` base class. The old `bulk-save` endpoint is deprecated.- `documents/workflow_views.py` — `DocumentWorkflowViewSet`, approval/comment/notification viewsets

- `documents/metadata_views.py` — Registered manually in `drafter/urls.py` (before the router!) to avoid URL conflicts

### Header/Footer Dual System

Two independent systems coexist per document:### URL Routing Caveat

1. **PDF overlay**: Cropped regions from uploaded PDFs → `HeaderFooterPDF` model → stored in `processing_settings.header_pdf` / `footer_pdf`In `documents/urls.py`, `DocumentViewSet` is registered with an **empty prefix** (`router.register(r'', DocumentViewSet)`) — it **must** be registered last. Specific viewsets (search, sections, images, etc.) are registered first. The metadata endpoints are registered as explicit paths in `drafter/urls.py` **before** the `include('documents.urls')` to prevent the empty-prefix catch-all from intercepting them.

2. **Text templates**: `HeaderFooterTemplate` → `Document.header_template` / `Document.header_config` → rendered via `get_effective_header_config()` → `get_rendered_header_config()`

## Developer Workflow

### Document Modes

`Document.document_mode` field: `'standard'` (default) or `'quick_latex'` (single-section, single-LatexCode-block optimised for LaTeX editing). Quick LaTeX has its own ViewSet at `documents/quick_latex_views.py` registered at `quick-latex/`.```bash

source venv/bin/activate

### CLM Workflow Node Typespython manage.py migrate        # SQLite — no external DB needed

`WorkflowNode.node_type` choices: `input`, `rule`, `listener`, `validator`, `action`, `ai`, `and_gate`, `scraper`, `output`. Connections use `source_handle` for branching (e.g., `"approved"` / `"rejected"` from validator nodes). Workflow config hash (`nodes_config_hash`) tracks DAG shape changes.python manage.py runserver 8000  # http://localhost:8000/api/

python manage.py check           # Validate system integrity

### Viewer Authenticationpython manage.py test documents  # Run tests (APIClient + force_authenticate)

The viewer app has its own auth system separate from Django sessions: `ViewerUser` (lightweight non-Django-User wrapper), `ViewerSessionAuthentication` (header: `Authorization: ViewerSession <token>`), `ViewerTokenAuthentication` (query: `?token=<token>`). Permission classes: `IsViewerAuthenticated`, `ViewerCanPerformAction`.```



### Alerts / Communications- **Env vars**: `env.env` in project root, loaded via `python-dotenv` in settings.py

Use `from communications.dispatch import send_alert` from any app. Supports `send_alert()` (single) and `send_alert_bulk()` (multiple recipients). Categories are dotted strings (e.g., `'document.shared'`, `'workflow.assigned'`, `'clm.task_assigned'`). AlertPreference controls per-user email opt-in/out.- **Settings module**: `drafter.settings` (set `DJANGO_SETTINGS_MODULE=drafter.settings`)

- **Frontend origins**: localhost:3000, 3001, 5173, 5174 (CORS configured)

## URL Routing (Order Matters!)

## When Adding New Features

In `documents/urls.py`, `DocumentViewSet` is registered with an **empty prefix** (`router.register(r'', DocumentViewSet)`) — it **must** be registered last. All other viewsets (search, sections, images, workflows, branches, quick-latex, etc.) are registered first.

1. **New model** → Add to `documents/models.py`, use UUID PK, add `custom_metadata = JSONField(default=dict, blank=True)` if extensibility needed

Metadata endpoints are registered as explicit paths in `drafter/urls.py` **before** `include('documents.urls')` to prevent the empty-prefix catch-all from intercepting them.2. **New ViewSet** → Add to the appropriate `*_views.py`, register in `documents/urls.py` router **before** the empty-prefix `DocumentViewSet`

3. **New `@action` on DocumentViewSet** → Use `url_path='kebab-case'`, support both GET and PATCH where applicable, return `*_active` booleans for frontend state management

Nested routers: `sections/<id>/paragraphs/`, `sections/<id>/tables/`, `paragraphs/<id>/sentences/` via `drf-nested-routers`.4. **Config in processing_settings** → Use `_merge_config` pattern, honour `__removed__` sentinel, strip in `get_processing_defaults()`

5. **Frontend guides** → Create `FRONTEND_PROMPTING_*_GUIDE.md` in project root with API reference, request/response examples, and React component patterns

## View File Organization

- `documents/views.py` — `DocumentViewSet` (~30 `@action` endpoints), `IssueViewSet`, `DocumentImageViewSet`, search viewsets## Key File Quick Reference

- `documents/structure_views.py` — `SectionViewSet`, `ParagraphViewSet`, `SentenceViewSet`, `TableViewSet`, `ImageComponentViewSet`, `DocumentFileViewSet`, `HeaderFooterPDFViewSet`, `ParagraphHistoryViewSet`

- `documents/workflow_views.py` — `DocumentWorkflowViewSet`, approval/comment/notification/decision viewsets| What | Where |

- `documents/branching_views.py` — `MasterDocumentViewSet`, `DocumentBranchViewSet`, `DocumentDuplicateViewSet`|------|-------|

- `documents/metadata_views.py` — Registered manually in `drafter/urls.py` (before the router!)| All document models | `documents/models.py` |

- `documents/dashboard_views.py` — `DashboardViewSet`| Document API + 30 actions | `documents/views.py` `DocumentViewSet` |

| Structure CRUD (sections, paragraphs) | `documents/structure_views.py` |

## Developer Workflow| PDF generation engine | `exporter/pdf_system.py` |

| Header/footer PDF crop serializers | `documents/serializers.py` (search `HeaderFooterPDF`) |

```bash| Config merge + removal logic | `documents/models.py` `get_processing_defaults()` |

source venv/bin/activate| Organization settings model | `user_management/models.py` `OrganizationDocumentSettings` |

python manage.py migrate        # SQLite — no external DB needed| Sharing permissions | `sharing/permissions.py` `HasSharePermission`, `IsOwnerOrSharedWith` |

python manage.py runserver 8000  # http://localhost:8000/api/| URL routing (order matters!) | `drafter/urls.py` + `documents/urls.py` |

python manage.py check           # Validate system integrity
python manage.py test documents  # Run tests
python manage.py test clm        # CLM tests (model + API + condition eval)
```

# Copilot Instructions — LL-Doc Backend (Django/DRF)

## Big picture

- Monorepo: Django backend lives in `backend/`, React frontend in `backend/frontend/`.
- Django 6 + DRF, SQLite dev DB (`db.sqlite3`), session-cookie auth (`rest_framework.authentication.SessionAuthentication`).
- API surface is split by apps and mounted in `drafter/urls.py` under `/api/*`.

## Key apps & boundaries

- `documents/`: core document model + editor APIs (large `documents/models.py`, `documents/views.py`, `documents/structure_views.py`).
- `exporter/`: PDF generation pipeline (`exporter/pdf_system.py`).
- `clm/`: contract lifecycle workflows (DAG nodes + execution) and Celery tasks (`clm/models.py`, `clm/node_executor.py`, `clm/tasks.py`).
- `dms/`: PDF ingestion/search (`dms/services.py`).
- `sharing/`: generic GFK-based sharing permissions (`sharing/permissions.py`).
- `viewer/`: external-viewer auth (non-Django `ViewerUser`) (`viewer/authentication.py`).
- `communications/`: alerts/notifications entrypoint `send_alert()` (`communications/dispatch.py`).

## Repo-specific conventions (don’t fight them)

- UUID primary keys everywhere; routes typically use `<uuid:pk>`.
- Org scoping is via `request.user.profile.organization` (see `user_management/models.py`). Some CLM views use `_get_org()` with a dev fallback.
- **URL ordering matters**:
  - In `documents/urls.py`, `DocumentViewSet` is registered **last** with an empty prefix: `router.register(r'', DocumentViewSet, ...)`.
  - In `drafter/urls.py`, document metadata endpoints are defined **before** `path('api/documents/', include('documents.urls'))` to avoid being swallowed.
- **Optimistic concurrency uses ETags** in `documents/views.py` (`_get_document_etag()`, `_check_if_match()`); return `412` on mismatch. CORS exposes `ETag` in `drafter/settings.py`.
- **Partial-save is the main editor write path**: `POST /api/documents/<id>/partial-save/` routes to typed handlers in `documents/partial_save/` (registry in `documents/partial_save/registry.py`).
- Export config is stored in `Document.custom_metadata.processing_settings` and deep-merged with org defaults; explicit removals use the sentinel string `"__removed__"` (see `documents/models.py` `get_processing_defaults()`).

## Dev workflows (local)

- Env vars are loaded from `env.env` in project root (`drafter/settings.py`).
- Run server: `python manage.py migrate` then `python manage.py runserver 8000`.
- Tests: `python manage.py test documents` and `python manage.py test clm` (tests commonly use `APIClient` + `force_authenticate`).
- Celery (CLM): worker + beat (Redis on `127.0.0.1:6379`) configured via `drafter/celery.py`.

## Viewer auth gotcha

- Viewer endpoints don’t use Django sessions: they authenticate via `Authorization: ViewerSession <token>` / `Authorization: ViewerToken <token>` or query params (`viewer/authentication.py`).

## Migrations

- Don’t hand-write migrations; generate via Django. If editing a generated migration, follow existing guidance in repo docs.