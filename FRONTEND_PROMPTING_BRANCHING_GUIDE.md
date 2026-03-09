# Frontend Prompting Guide — Master Documents, Branching & Duplication

## Overview

This system provides a production-ready document management layer built on top
of the existing `Document` model. It enables:

| Capability | Description |
|---|---|
| **Master Documents** | Reusable "golden copy" templates that define content, metadata defaults, style presets, and AI generation prompts |
| **Branching** | Create independent document copies from a master, inheriting content & metadata while allowing full divergence |
| **Duplication** | Copy any document (master or not) with optional metadata/style overrides |
| **AI-Assisted Creation** | Generate master documents from a text prompt via Gemini, then branch at scale |
| **Search** | Find masters by name, category, tags, document type |
| **Promote** | Convert any existing document into a master document |

---

## Data Models

### MasterDocument

```
id              UUID (PK)
name            string       — display name
description     text         — usage notes
template_document  FK→Document — the golden-copy document
category        enum         — contract|policy|nda|employment|compliance|terms|memo|letter|custom
document_type   string       — maps to Document.document_type on branches
tags            JSON array   — e.g. ["saas","vendor","real-estate"]
default_metadata      JSON   — merged into every branch's document_metadata
default_custom_metadata JSON — merged into every branch's custom_metadata
default_parties       JSON   — default parties list for branches
style_preset          JSON   — processing_settings pushed to branches
ai_system_prompt      text   — custom Gemini system prompt
ai_generation_notes   text   — free-form AI context
is_public       bool         — visible to all org members
is_system       bool         — system-provided (cannot delete)
branch_count    int          — auto-maintained
duplicate_count int          — auto-maintained
last_branched_at datetime
created_by      FK→User
created_at      datetime
updated_at      datetime
```

### DocumentBranch

```
id              UUID (PK)
master          FK→MasterDocument (nullable)
source_document FK→Document       — the specific document that was cloned
document        OneToOne→Document — the resulting branched document
branch_name     string
branch_notes    text
branch_type     enum  — branch|duplicate|variant|version
status          enum  — active|archived|merged|superseded
metadata_overrides  JSON — overrides applied at creation
style_overrides     JSON — style overrides applied at creation
created_by      FK→User
created_at      datetime
updated_at      datetime
```

---

## API Reference

Base URL: `http://localhost:8000/api/documents/`

### 1. Master Documents CRUD

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/masters/` | List all accessible masters |
| `POST` | `/masters/` | Create a new master |
| `GET` | `/masters/<uuid>/` | Get master detail (includes recent branches) |
| `PATCH` | `/masters/<uuid>/` | Update master fields |
| `DELETE` | `/masters/<uuid>/` | Delete master |

#### Create Master

```http
POST /api/documents/masters/
Content-Type: application/json

{
  "name": "SaaS Service Agreement",
  "description": "Standard SaaS agreement for B2B clients",
  "template_document": "<uuid-of-existing-document>",
  "category": "contract",
  "document_type": "service_agreement",
  "tags": ["saas", "b2b", "service"],
  "default_metadata": {
    "legal": { "governing_law": "Delaware" },
    "financial": { "currency": "USD" }
  },
  "default_parties": [
    { "name": "Acme Corp", "role": "Provider" }
  ],
  "style_preset": {
    "page_size": "Letter",
    "font_family": "Times New Roman",
    "font_size": 12
  },
  "ai_system_prompt": "Generate professional SaaS agreements...",
  "is_public": true
}
```

**Response** `201`:
```json
{
  "id": "<uuid>",
  "name": "SaaS Service Agreement",
  "template_document": "<uuid>",
  "template_document_title": "SaaS Master Agreement v1",
  "branch_count": 0,
  "branches": [],
  ...
}
```

---

### 2. Branch from Master

```http
POST /api/documents/masters/<master-uuid>/branch/
Content-Type: application/json

{
  "branch_name": "Acme Corp - Q1 2026",
  "branch_notes": "Customized for Acme Corp Q1 renewal",
  "title_override": "Service Agreement - Acme Corp Q1 2026",
  "metadata_overrides": {
    "dates": { "effective_date": "2026-01-01" },
    "financial": { "contract_value": "120000" }
  },
  "custom_metadata_overrides": {
    "internal_ref": "ACM-2026-Q1"
  },
  "parties_override": [
    { "name": "Acme Corp", "role": "Client" },
    { "name": "Our Company", "role": "Provider" }
  ],
  "style_overrides": {
    "font_family": "Arial"
  },
  "include_content": true
}
```

**Response** `201`:
```json
{
  "id": "<branch-uuid>",
  "branch_name": "Acme Corp - Q1 2026",
  "branch_type": "branch",
  "status": "active",
  "master": "<master-uuid>",
  "master_name": "SaaS Service Agreement",
  "document": "<new-doc-uuid>",
  "document_title": "Service Agreement - Acme Corp Q1 2026",
  "document_data": { /* full Document payload */ },
  ...
}
```

---

### 3. AI-Generate a Master Document

```http
POST /api/documents/masters/ai-generate/
Content-Type: application/json

{
  "prompt": "Create a comprehensive NDA for a technology partnership between two software companies. Include mutual confidentiality, IP protection, and a 2-year term.",
  "name": "Tech Partnership NDA",
  "category": "nda",
  "document_type": "nda",
  "tags": ["technology", "partnership", "mutual-nda"],
  "default_parties": [
    { "name": "Company A", "role": "Disclosing Party" },
    { "name": "Company B", "role": "Receiving Party" }
  ]
}
```

**Response** `201`:
```json
{
  "id": "<master-uuid>",
  "name": "Tech Partnership NDA",
  "template_document": "<generated-doc-uuid>",
  "template_document_title": "Mutual Non-Disclosure Agreement",
  "branches": [],
  ...
}
```

Or use `raw_text` instead of `prompt` to structure existing text:
```json
{
  "raw_text": "MUTUAL NON-DISCLOSURE AGREEMENT\n\nThis Agreement is entered into...",
  "name": "Existing NDA Structured",
  "category": "nda"
}
```

---

### 4. Duplicate Any Document

Two equivalent endpoints:

#### A. Standalone endpoint

```http
POST /api/documents/duplicate/
Content-Type: application/json

{
  "source_document": "<uuid-of-document-to-copy>",
  "title": "Copied Agreement - Client B",
  "branch_name": "Client B Version",
  "metadata_overrides": {
    "legal": { "governing_law": "California" }
  },
  "include_structure": true,
  "include_images": false,
  "duplicate_notes": "Customized for California jurisdiction"
}
```

#### B. Action on DocumentViewSet

```http
POST /api/documents/<uuid>/duplicate/
Content-Type: application/json

{
  "title": "Copied Agreement - Client B",
  "metadata_overrides": { ... }
}
```

**Response** `201`:
```json
{
  "status": "success",
  "document": {
    "id": "<new-doc-uuid>",
    "title": "Copied Agreement - Client B"
  },
  "branch": { /* DocumentBranch record */ },
  "source_document_id": "<original-doc-uuid>"
}
```

---

### 5. Promote Document to Master

#### A. Via Masters endpoint

```http
POST /api/documents/masters/promote/
Content-Type: application/json

{
  "document_id": "<uuid>",
  "name": "My Standard Contract",
  "category": "contract",
  "tags": ["standard", "vendor"]
}
```

#### B. Via Document action

```http
POST /api/documents/<uuid>/promote-to-master/
Content-Type: application/json

{
  "name": "My Standard Contract",
  "category": "contract"
}
```

---

### 6. Branches CRUD

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/branches/` | List user's branches |
| `GET` | `/branches/?master=<uuid>` | List branches for a specific master |
| `GET` | `/branches/?branch_type=branch` | Filter by type |
| `GET` | `/branches/?status=active` | Filter by status |
| `GET` | `/branches/<uuid>/` | Branch detail (includes full document data) |
| `PATCH` | `/branches/<uuid>/` | Update branch metadata/status |
| `DELETE` | `/branches/<uuid>/` | Delete branch (+ document) |
| `DELETE` | `/branches/<uuid>/?keep_document=true` | Delete branch, keep document |

---

### 7. AI Content Generation on Branch

```http
POST /api/documents/branches/<branch-uuid>/ai-content/
Content-Type: application/json

{
  "prompt": "Add a section about data processing and GDPR compliance",
  "merge_strategy": "append"
}
```

**merge_strategy options:**
- `replace` — Clear existing sections, generate new ones
- `append` — Add new sections after existing ones
- `merge_sections` — AI-aware merge considering existing section titles

**Response** `200`:
```json
{
  "status": "success",
  "document_id": "<uuid>",
  "branch_id": "<uuid>",
  "sections_created": 3,
  "merge_strategy": "append"
}
```

---

### 8. Duplicate a Branch

```http
POST /api/documents/branches/<branch-uuid>/duplicate/
Content-Type: application/json

{
  "branch_name": "Client C Variation",
  "title": "Service Agreement - Client C",
  "metadata_overrides": {
    "financial": { "contract_value": "75000" }
  }
}
```

---

### 9. Search Masters

```http
GET /api/documents/masters/search/?q=nda&category=nda&tags=technology,mutual-nda&ordering=-branch_count
```

| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Text search on name, description, document_type |
| `category` | string | Filter by master category |
| `document_type` | string | Filter by document_type |
| `tags` | string | Comma-separated tag filter |
| `ordering` | string | `name`, `-name`, `created_at`, `-created_at`, `updated_at`, `-updated_at`, `branch_count`, `-branch_count` |

---

## Workflow Patterns

### Pattern 1: Rapid Document Production

```
1. Create master from AI prompt     →  POST /masters/ai-generate/
2. Review & edit template document  →  PATCH /documents/<template-doc-uuid>/
3. Branch for each client           →  POST /masters/<uuid>/branch/
4. Customize branch metadata        →  PATCH /documents/<branch-doc-uuid>/
5. Export                           →  existing PDF export system
```

### Pattern 2: Promote & Reuse

```
1. Create document normally         →  POST /documents/
2. Edit until satisfied             →  PATCH /documents/<uuid>/
3. Promote to master                →  POST /documents/<uuid>/promote-to-master/
4. Branch for variations            →  POST /masters/<uuid>/branch/
```

### Pattern 3: Quick Duplicate & Customize

```
1. Find a similar document          →  GET /documents/?search=...
2. Duplicate it                     →  POST /documents/<uuid>/duplicate/
3. Update metadata only             →  PATCH /documents/<new-uuid>/
```

### Pattern 4: Style Variants

```
1. Create master with style A       →  POST /masters/
2. Branch with style B overrides    →  POST /masters/<uuid>/branch/ { style_overrides: {...} }
3. Branch with style C overrides    →  POST /masters/<uuid>/branch/ { style_overrides: {...} }
```

---

## React Component Architecture

```
<MasterDocumentManager>
  ├── <MasterDocumentSearch />         — Search bar + category/tag filters
  ├── <MasterDocumentList />           — Grid/list of masters with stats
  │   └── <MasterDocumentCard />       — Shows name, branch count, tags
  ├── <MasterDocumentDetail />         — Full master view + template preview
  │   ├── <BranchCreator />            — Form for creating a new branch
  │   ├── <BranchList />               — List of branches for this master
  │   │   └── <BranchCard />           — Shows branch name, status, doc link
  │   └── <AIGeneratePanel />          — Prompt input for AI content
  ├── <DocumentDuplicateDialog />      — Modal for duplicating any document
  └── <PromoteToMasterDialog />        — Modal for promoting a document
</MasterDocumentManager>
```

---

## Key Implementation Notes

1. **Every branch creates a full Document** — branches are independent Documents tracked via the `DocumentBranch` record. The branch's document is fully editable using all existing Document APIs.

2. **Metadata merge chain**: Master `default_metadata` → branch `metadata_overrides` → document `document_metadata`. Deep-merge is applied at branch creation time.

3. **Style presets** are injected into `document.custom_metadata.processing_settings` — the existing PDF export pipeline picks them up automatically.

4. **AI generation** uses the existing Gemini pipeline (`aiservices/gemini_ingest.py`). The `ai_system_prompt` on the master customizes the AI's behavior for all branches.

5. **Branch traceability** — `DocumentBranch.source_document` always points to the document that was cloned. `DocumentBranch.master` points to the master (if applicable). Standalone duplicates have `master=null`.

6. **Deleting a branch** deletes the branch record AND its document by default. Pass `?keep_document=true` to preserve the document.

7. **`branch_count` and `duplicate_count`** are automatically maintained on the master for dashboard display.
