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

- **Env vars**: `env.env` in project root, loaded via `python-dotenv` in settings.py
- **Settings module**: `drafter.settings`
- **Celery** (for CLM): `celery -A drafter worker -l info` + `celery -A drafter beat -l info` (requires Redis on `127.0.0.1:6379`)
- **Frontend**: React app in `frontend/`, runs on localhost:5173 (Vite)
- **Tests use**: `APIClient` + `force_authenticate(user=...)`, create `Organization` + `UserProfile` in `setUp()` (see `clm/tests.py` `CLMTestMixin` for the pattern)

## When Adding New Features

1. **New model** → Use UUID PK, add `custom_metadata = JSONField(default=dict, blank=True)` if extensibility needed
2. **New ViewSet in documents** → Add to the appropriate `*_views.py`, register in `documents/urls.py` router **before** the empty-prefix `DocumentViewSet`
3. **New `@action` on DocumentViewSet** → Use `url_path='kebab-case'`, support both GET and PATCH where applicable, return `*_active` booleans for frontend state management
4. **Config in processing_settings** → Use `_merge_config` pattern, honour `__removed__` sentinel, strip in `get_processing_defaults()`
5. **New CLM node type** → Add to `WorkflowNode.NodeType` choices, implement executor in `clm/node_executor.py`, update `rebuild_extraction_template()` if it extracts fields
6. **Alerts from new features** → Use `send_alert(category='app.event', recipient=user, ...)` from `communications.dispatch`
7. **Frontend guides** → Create `FRONTEND_PROMPTING_*_GUIDE.md` in project root with API reference, request/response examples, and React component patterns

## Key File Quick Reference

| What | Where |
|------|-------|
| All document models (~6.5k lines) | `documents/models.py` |
| Document API + ~30 actions | `documents/views.py` `DocumentViewSet` |
| Structure CRUD (sections, paragraphs, tables) | `documents/structure_views.py` |
| Partial save handler registry | `documents/partial_save/registry.py` |
| PDF generation engine | `exporter/pdf_system.py` |
| Config merge + `__removed__` logic | `documents/models.py` `get_processing_defaults()` |
| Organization settings model | `user_management/models.py` `OrganizationDocumentSettings` |
| Sharing permissions | `sharing/permissions.py` `HasSharePermission`, `IsOwnerOrSharedWith` |
| CLM workflow models + DAG | `clm/models.py` (Workflow, WorkflowNode, NodeConnection) |
| CLM workflow execution | `clm/node_executor.py`, `clm/tasks.py` |
| Viewer token auth system | `viewer/authentication.py`, `viewer/permissions.py` |
| Alert dispatch entry point | `communications/dispatch.py` `send_alert()` |
| URL routing (order matters!) | `drafter/urls.py` + `documents/urls.py` |
| Celery config | `drafter/celery.py` + `drafter/settings.py` (bottom) |


Never create migration files manually. Django auto-generates them based on model changes. If you need to modify a migration, edit the generated file in `documents/migrations/` (or the relevant app) and then run `python manage.py migrate --fake <app_name> <migration_name>` to sync the migration state without reapplying it.