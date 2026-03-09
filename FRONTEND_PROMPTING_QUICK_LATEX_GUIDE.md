# Quick LaTeX Document — Frontend Guide

## Overview

A **Quick LaTeX Document** is a lightweight document mode (`document_mode='quick_latex'`)
designed for creating documents with LaTeX **or HTML** code. Instead of the full section/paragraph
editor UI, the frontend shows:

1. **A single code editor** (one `LatexCode` block — `code_type` is `'latex'` or `'html'`)
2. **Metadata fields / placeholders** (auto-detected from `[[key]]` in the code — supports spaces/commas in key names)
3. **AI generation tools** (generate/regenerate LaTeX or HTML via a prompt)
4. **Code type switching** (LaTeX ↔ HTML, optionally converting via AI)
5. **Duplicate / bulk-duplicate** (create copies with different metadata — ideal for repositories)

All endpoints live under **`/api/documents/quick-latex/`**.
Render endpoints: `/api/documents/<uuid>/latex/render/` and `/api/documents/<uuid>/html/render/`.

---

## API Reference

### Base URL

```
/api/documents/quick-latex/
```

All requests require **session authentication** (`IsAuthenticated`).

---

### 1. List Quick LaTeX Documents

```
GET /api/documents/quick-latex/
```

Returns only documents where `document_mode='quick_latex'` that the user owns or has been shared with.

**Response:**
```json
[
  {
    "id": "uuid",
    "title": "My Contract Template",
    "document_mode": "quick_latex",
    "is_latex_code": true,
    "latex_code": "\\documentclass{article}...",
    "document_type": "contract",
    "category": "contract",
    "author": "John Doe",
    "status": "draft",
    "parties": [],
    "document_metadata": { "client_name": "Acme Corp" },
    "custom_metadata": {},
    "created_at": "2026-03-01T...",
    "updated_at": "2026-03-01T...",
    "section_id": "uuid-of-section",
    "latex_block": {
      "id": "uuid-of-latexcode",
      "latex_code": "\\documentclass{article}...",
      "edited_code": null,
      "has_edits": false,
      "code_type": "latex",
      "topic": "",
      "custom_metadata": {},
      "order": 0,
      "last_modified": "2026-03-01T...",
      "edit_count": 0
    },
    "placeholders": ["client_name", "contract_value", "effective_date"]
  }
]
```

---

### 2. Create Quick LaTeX Document

```
POST /api/documents/quick-latex/
```

**Body (create from scratch):**
```json
{
  "title": "Service Agreement",
  "latex_code": "\\documentclass{article}\\begin{document}Hello [[client_name]]\\end{document}",
  "document_type": "contract",
  "category": "contract",
  "author": "Jane Smith",
  "document_metadata": {
    "client_name": "Acme Corp",
    "contract_value": "50000"
  },
  "parties": [{"name": "Acme Corp", "role": "Client"}],
  "effective_date": "2026-04-01"
}
```

**Body (create from existing document):**
```json
{
  "title": "Service Agreement v2",
  "source_document_id": "uuid-of-source",
  "metadata_overrides": {
    "client_name": "Globex Inc"
  },
  "custom_metadata_overrides": {}
}
```

**Response:** `201 Created` — full `QuickLatexDocumentSerializer` response.

---

### 3. Retrieve Quick LaTeX Document

```
GET /api/documents/quick-latex/<uuid>/
```

Returns the full document with inline `latex_block` and `placeholders`.

---

### 4. Update (PATCH)

```
PATCH /api/documents/quick-latex/<uuid>/
```

Update document metadata **and/or** the LaTeX code in a single request.

**Body (any subset):**
```json
{
  "title": "Updated Title",
  "latex_code": "\\documentclass{article}...",
  "document_metadata": {
    "client_name": "New Client"
  },
  "author": "Updated Author",
  "effective_date": "2026-06-01"
}
```

Changes to `latex_code` are written to both `Document.latex_code` **and** the `LatexCode` block.

---

### 5. Delete

```
DELETE /api/documents/quick-latex/<uuid>/
```

---

### 6. Duplicate

```
POST /api/documents/quick-latex/<uuid>/duplicate/
```

**Body:**
```json
{
  "title": "Contract for Globex",
  "metadata_overrides": {
    "client_name": "Globex Inc",
    "contract_value": "75000"
  },
  "custom_metadata_overrides": {},
  "parties_override": [{"name": "Globex Inc", "role": "Client"}],
  "duplicate_notes": "Created from repository template"
}
```

**Response:**
```json
{
  "status": "success",
  "document": { ... },
  "source_document_id": "uuid"
}
```

---

### 7. Bulk Duplicate (Repository Pattern)

```
POST /api/documents/quick-latex/<uuid>/bulk-duplicate/
```

Create multiple copies from one template, each with different metadata.
Perfect for repository-driven document generation.

**Body:**
```json
{
  "copies": [
    {
      "title": "Contract - Acme",
      "metadata_overrides": { "client_name": "Acme Corp", "contract_value": "50000" },
      "parties_override": [{"name": "Acme Corp", "role": "Client"}]
    },
    {
      "title": "Contract - Globex",
      "metadata_overrides": { "client_name": "Globex Inc", "contract_value": "75000" },
      "parties_override": [{"name": "Globex Inc", "role": "Client"}]
    },
    {
      "title": "Contract - Initech",
      "metadata_overrides": { "client_name": "Initech", "contract_value": "30000" }
    }
  ]
}
```

**Response:**
```json
{
  "status": "success",
  "source_document_id": "uuid",
  "created": [
    {"id": "uuid-1", "title": "Contract - Acme"},
    {"id": "uuid-2", "title": "Contract - Globex"},
    {"id": "uuid-3", "title": "Contract - Initech"}
  ],
  "count": 3
}
```

---

### 8. AI Generate Code (LaTeX or HTML)

```
POST /api/documents/quick-latex/<uuid>/ai-generate/
```

Generate new code or edit existing code using Gemini AI.

**Body (generate mode):**
```json
{
  "prompt": "Create a professional consulting services agreement",
  "preamble": "",
  "replace": true,
  "code_type": "latex",
  "mode": "generate"
}
```

**Body (edit mode — modifies existing code):**
```json
{
  "prompt": "Add a termination clause after section 3",
  "replace": true,
  "code_type": "latex",
  "mode": "edit"
}
```

- `mode`: `"generate"` (default) — create from scratch. `"edit"` — send existing code to AI with change instructions.
- `replace: true` (default) — replaces existing code.
- `replace: false` — extends existing code with new content (generate mode only).
- `code_type`: `"latex"` (default) or `"html"`.

In edit mode, the backend sends the full existing code (up to 8000 chars) to the AI along with the edit instructions. The AI returns the complete updated document.

**Response:**
```json
{
  "status": "success",
  "latex_code": "<!DOCTYPE html>...",
  "code_type": "html",
  "document": { ... }
}
```

---

### 9. Switch Code Type

```
POST /api/documents/quick-latex/<uuid>/switch-code-type/
```

Switch the code block between LaTeX and HTML mode, optionally converting via AI.

**Body:**
```json
{
  "code_type": "html",
  "convert": true
}
```

- `code_type`: `"latex"` or `"html"` — the target code type.
- `convert`: if `true`, uses AI to convert existing code to the new format. If `false`, just changes the type label without modifying code.

**Response:**
```json
{
  "status": "success",
  "code_type": "html",
  "converted": true,
  "document": { ... }
}
```

---

### 10. Get Placeholders

```
GET /api/documents/quick-latex/<uuid>/placeholders/
```

Lists all `[[key]]` placeholders found in the code with their current values.
Supports keys with **spaces, commas, and special characters** (e.g. `[[Company Name]]`, `[[Client City, State, Zip]]`).

**Response:**
```json
{
  "placeholders": [
    {"key": "Company Name", "current_value": "Acme Corp", "has_value": true},
    {"key": "Client City, State, Zip", "current_value": null, "has_value": false},
    {"key": "contract_value", "current_value": "50000", "has_value": true}
  ],
  "total": 3
}
```

---

### 11. Update Metadata Only

```
PATCH /api/documents/quick-latex/<uuid>/metadata/
```

Deep-merges the request body into `document_metadata`.

**Body:**
```json
{
  "client_name": "New Corp",
  "financial": {
    "contract_value": "100000",
    "currency": "EUR"
  }
}
```

---

### 12. Rendered Code (Preview Text)

```
GET /api/documents/quick-latex/<uuid>/rendered-latex/
```

Returns the code with all `[[placeholder]]` values replaced from metadata.

**Response:**
```json
{
  "rendered": "\\documentclass{article}\\begin{document}Hello Acme Corp\\end{document}",
  "placeholders_total": 3,
  "placeholders_resolved": 2,
  "placeholders_remaining": ["effective_date"]
}
```

---

### 13. Create from Any Existing Document

```
POST /api/documents/quick-latex/from-source/
```

Convert any standard document into a Quick LaTeX document.

**Body:**
```json
{
  "source_document_id": "uuid-of-any-document",
  "title": "Quick LaTeX version",
  "metadata_overrides": {},
  "custom_metadata_overrides": {}
}
```

---

### 14. Render LaTeX → PDF/PNG

```
POST /api/documents/<uuid>/latex/render/
```

Compiles LaTeX code via XeLaTeX and returns PDF + PNG preview.

**Body:**
```json
{
  "latex_code": "\\documentclass{article}\\begin{document}Hello\\end{document}",
  "preamble": "\\usepackage{tikz}",
  "metadata": { "client_name": "Acme" }
}
```

**Response:**
```json
{
  "document_id": "uuid",
  "pdf_base64": "JVBERi0...",
  "preview_png_base64": "iVBORw0...",
  "preview_dpi": 150
}
```

---

### 15. Render HTML → PDF/PNG

```
POST /api/documents/<uuid>/html/render/
```

Converts HTML code to PDF via xhtml2pdf and returns PDF + PNG preview.
Resolves `[[placeholder]]` metadata before conversion (HTML-escaped values).

**Body:**
```json
{
  "html_code": "<!DOCTYPE html><html><body><h1>Hello [[Company Name]]</h1></body></html>",
  "metadata": { "Company Name": "Acme Corp" }
}
```

If `html_code` is omitted, uses the document's first code block with `code_type='html'`.

**Response:**
```json
{
  "document_id": "uuid",
  "pdf_base64": "JVBERi0...",
  "preview_png_base64": "iVBORw0...",
  "preview_dpi": 150
}
```

---

## React Component Patterns

### Suggested Component Hierarchy

```
<QuickLatexApp>
  ├── <QuickLatexList />                    // GET /quick-latex/
  │   ├── <QuickLatexCard />               // Per document card
  │   └── <CreateQuickLatexButton />       // POST /quick-latex/
  │
  ├── <QuickLatexEditor>                   // GET /quick-latex/:id/
  │   ├── <MetadataDrawer>                 // Left collapsible drawer
  │   │   ├── <PlaceholderForm />          // GET /quick-latex/:id/placeholders/
  │   │   └── <DocumentInfoFields />       // title, author, dates, parties
  │   │
  │   ├── <CodeEditor>                     // Center: dark-themed code textarea
  │   │   └── <textarea />                 // PATCH /quick-latex/:id/ (latex_code)
  │   │
  │   ├── <PreviewPanel>                   // Right panel (togglable)
  │   │   ├── <iframe /> (HTML)            // Instant HTML preview
  │   │   └── <img /> (LaTeX)             // PNG from render endpoint
  │   │
  │   ├── <AIChatPanel>                    // Right panel (togglable, replaces preview)
  │   │   ├── <ChatMessage />             // User/AI message bubbles with timestamps
  │   │   ├── <QuickActions />            // Preset chips (NDA, Add clause, etc.)
  │   │   └── <ChatInput />              // Text input + send button
  │   │
  │   └── <ActionBar>
  │       ├── <DuplicateButton />          // POST /quick-latex/:id/duplicate/
  │       ├── <BulkDuplicateDialog />      // POST /quick-latex/:id/bulk-duplicate/
  │       └── <CodeTypeToggle />           // POST /quick-latex/:id/switch-code-type/
  │
  └── <RepositoryView>                     // For bulk operations
      ├── <TemplateSelector />             // Pick a quick-latex doc as template
      ├── <MetadataSpreadsheet />          // Bulk metadata entry (rows → copies)
      └── <GenerateAllButton />            // POST bulk-duplicate/
```

### Key UI Patterns

#### 1. Create New Quick LaTeX Doc
```tsx
const createQuickLatex = async (data: {
  title: string;
  latex_code?: string;
  document_metadata?: Record<string, any>;
}) => {
  const res = await fetch('/api/documents/quick-latex/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
};
```

#### 2. Auto-Detect Placeholders After Code Change
```tsx
// After user edits LaTeX code:
const updateCode = async (docId: string, code: string) => {
  await fetch(`/api/documents/quick-latex/${docId}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latex_code: code }),
  });

  // Refresh placeholder list
  const placeholders = await fetch(
    `/api/documents/quick-latex/${docId}/placeholders/`
  ).then(r => r.json());

  // Update the metadata form to show new placeholders
  setPlaceholders(placeholders.placeholders);
};
```

#### 3. AI Chat Flow (Generate + Edit)
```tsx
// Chat-based AI interaction — messages persist per document
const [chatMessages, setChatMessages] = useState([]);

const sendAIMessage = async (docId: string, prompt: string, hasCode: boolean) => {
  // Add user message
  setChatMessages(prev => [...prev, { role: 'user', text: prompt, timestamp: new Date() }]);

  const mode = hasCode ? 'edit' : 'generate';
  const res = await fetch(`/api/documents/quick-latex/${docId}/ai-generate/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, replace: true, mode }),
  });
  const data = await res.json();

  // Add AI response
  setChatMessages(prev => [...prev, {
    role: 'assistant',
    text: mode === 'edit' ? 'Changes applied.' : 'Document generated.',
    code: data.latex_code,
    codeType: data.code_type,
    timestamp: new Date(),
  }]);

  if (data.status === 'success') {
    setLatexCode(data.latex_code);
  }
};
```

#### 4. Repository / Bulk Duplicate
```tsx
// User fills a spreadsheet-like grid of metadata rows
const bulkGenerate = async (templateId: string, rows: any[]) => {
  const copies = rows.map(row => ({
    title: row.title,
    metadata_overrides: row.metadata,
    parties_override: row.parties,
  }));

  const res = await fetch(
    `/api/documents/quick-latex/${templateId}/bulk-duplicate/`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ copies }),
    }
  );
  return res.json(); // { created: [...], count: N }
};
```

---

## Workflow: Creating Documents from Repositories

1. **Create a template** — Create a Quick LaTeX doc with `[[placeholder]]` markers
2. **AI-generate the template** — Use `ai-generate/` to create professional LaTeX from a prompt
3. **Set up metadata schema** — Call `placeholders/` to see what the template needs
4. **Bulk-duplicate** — Use `bulk-duplicate/` with a spreadsheet of client data
5. **Review & export** — Each copy is an independent document ready for PDF export

---

## Notes

- Quick LaTeX documents still use the standard `Document` model. The `document_mode='quick_latex'` flag is what distinguishes them.
- The existing PDF export pipeline (`/documents/<uuid>/render-pdf/`) works with these documents.
- AI config (`/api/ai/documents/<uuid>/config/`) also works for per-document AI tuning.
- Sharing (`/api/sharing/`) works normally — shared users can see quick-latex docs.
- All standard document list views will also include quick-latex docs. Filter by `document_mode` on the frontend if you want to separate them.
