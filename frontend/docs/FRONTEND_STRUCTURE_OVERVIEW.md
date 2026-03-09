# Frontend Folder & Editor Structure (January 17, 2026)

This document describes the **frontend folder structure** and **where the document editor logic lives**, with a focus on **paragraphs, sections, images, tables, and references**. It’s based on the current code in `/src`.

> Assumptions: when a component name is obvious but not deeply inspected (e.g., `ImageLibraryBrowser.jsx`), the description is inferred from naming and usage in `DocumentDrafterNew.jsx`.

## 🧭 High-level structure

```
frontend/
├─ src/
│  ├─ App.jsx            # Top-level app routes/layout
│  ├─ main.jsx           # React entry point
│  ├─ components/        # Editor UI and reusable widgets
│  ├─ pages/             # Route-level screens
│  ├─ services/          # API clients
│  ├─ hooks/             # Editor data hooks
│  ├─ utils/             # Helpers (save, validation, formatting)
│  ├─ store/             # Zustand stores (workflow, metadata)
│  ├─ contexts/          # Auth context
│  ├─ styles/            # App styles (Tailwind + CSS)
│  ├─ templates/         # Document templates/renderers
│  └─ docs/              # Editor quick references
├─ public/               # Static assets
├─ index.html            # Vite HTML shell
└─ package.json          # Dependencies + scripts
```

## 📄 Core editor entry points

### `src/pages/DocumentDrafterNew.jsx`
**Role:** Main document editor screen. Handles creation, load, edit, save, preview, sharing, and page settings.

Key responsibilities:
- Loads document data via `useDocumentEditor` and `documentService`.
- Runs **“golden-path” save** using `saveDocumentComplete` + `mapSavedStructureToLocal` from `utils/documentSaveHelpers`.
- Provides editing modes (preview vs edit), page settings, citation styles, and sharing permissions.
- Orchestrates the editor layout by wiring:
  - `PagedDocument` (main editor canvas)
  - `DocumentViewer` (read-only view)
  - `SectionTree`, `SectionBrowser` (navigation and drag/drop section references)
  - `TextFormatToolbar`, `ReferenceDialog` (inline references)
  - `DocumentTable`, `ImageComponent`, `DocumentFileComponent`

### `src/hooks/useDocumentEditor.js`
**Role:** State + CRUD operations for the *complete document structure*.

What it does:
- Fetches full structure via `documentService.fetchCompleteStructure()`.
- Maintains local document graph and computed maps:
  - `sectionMap`, `paragraphMap`, `tableMap`, `imageComponentMap`, `fileComponentMap`
- Provides CRUD helpers:
  - `addSection`, `updateSection`, `deleteSection`
  - `addParagraph`, `updateParagraph`, `deleteParagraph`
  - plus similar helpers for tables, images, files

## 🧱 How paragraphs & sections are structured

### `src/components/SectionHeader.jsx`
**Role:** Section title editor with numbering and type selection.

- Handles section numbering (custom metadata or order-based).
- Auto-resizes title field.
- Supports section type selection (clause, schedule, definition, etc.).

### `src/components/DocumentSection.jsx`
**Role:** Renders a section with paragraphs and actions.

- Displays `SectionHeader`.
- Lists paragraphs using `ParagraphEditor`.
- Provides “Add paragraph” and “Delete section” actions.

### `src/components/ParagraphEditor.jsx`
**Role:** Paragraph editing + drag/drop support.

- Handles edit mode vs preview mode.
- Supports text drag/drop and image drop zones.
- Delegates actual rich editing to `RichParagraphEditor`.

### `src/components/RichParagraphEditor.jsx`
**Role:** ContentEditable editor for paragraph text.

- Uses debounced saves (`useDebounce`) to reduce API calls.
- Tracks composition state for IME input.
- On blur, pushes updates immediately.

### `src/components/ParagraphRenderer.jsx`
**Role:** Read-only paragraph rendering.

- Renders paragraph text with layout styles.
- Used for preview mode or viewer displays.

## 🧾 Paged layout & document rendering

### `src/components/PagedDocument.jsx`
**Role:** Document canvas that paginates content by page dimensions.

- Renders sections, paragraphs, images, tables, and file components.
- Supports drag/drop, reorder, add content in section context.
- Works with editor callbacks for updates and insertions.

### `src/components/DocumentViewer.jsx`
**Role:** Read-only viewer for shared or view-only users.

- Renders sections and paragraphs with basic formatting.
- Includes a lightweight toolbar (print/export).

## 🖼️ Images

### `src/components/ImageComponent.jsx`
**Role:** Renders images in sections with editing controls.

- Handles captions, figure numbers, and accessibility alt text.
- Supports alignment and size settings.
- Toggle visibility, edit settings, and delete from document.

### `src/services/imageComponentService.js`
**Role:** API wrapper for image component CRUD.

- Create, update, delete, reorder, move-to-section.
- Normalizes backend image URLs.

Other related components:
- `ImageLibraryBrowser.jsx`, `ImageUploader.jsx`, `ImageUploadModal.jsx`, `ImageAlignmentToolbar.jsx`.

## 📊 Tables

### `src/components/DocumentTable.jsx`
**Role:** Full table editor inside a document.

- Inline cell editing.
- Add/delete rows/columns.
- CSV import/export.
- Table metadata edits (title).

### `src/components/InlineTableCreator.jsx`
**Role:** Popup to create new tables with size & column setup.

### `src/services/tableService.js`
**Role:** API wrapper for table CRUD + cell edits.

- Supports “save-structure” table creation for temp IDs.
- Cell updates, row/column add/delete, CSV import/export.

## 🔗 Section references & inline references

### `src/components/ReferenceDialog.jsx`
**Role:** Dialog to create cross-references (section/paragraph).

- Searches across accessible documents (`inlineReferenceService.searchTargets`).
- Creates a reference object and inserts inline text if needed.

### `src/components/SectionSidebar.jsx`
**Role:** Section library sidebar for drag/drop references or clones.

- Loads all documents and their section trees.
- Drag actions for “reference” vs “clone”.

### `src/components/SectionReferenceComponent.jsx`
**Role:** Render a reference to another section.

- Supports expanded view + preview content.
- Shows source document and metadata.

### `src/services/inlineReferenceService.js`
**Role:** API for inline references and cross-document search.

### `src/services/referenceService.js`
**Role:** API helper for cross-references between sections/paragraphs.

### `src/services/sectionReferenceService.js`
**Role:** Builds local “section reference” objects (client-side).

## 📎 File attachments & embedded documents

### `src/components/DocumentFileComponent.jsx`
**Role:** Render linked or embedded file components.

- Supports link, embed, download, and referenced document preview.
- Uses `useCompleteDocument` to render referenced document content.

## 🔌 Services (API layer)

Key editor-related services:
- `documentService.js`: list/create/update documents, export, versions.
- `structureService.js`: fetch/save full document structure and outline.
- `paragraphService.js`: paragraph CRUD + split/merge.
- `tableService.js`: table CRUD + cell ops.
- `imageComponentService.js`: image component CRUD + ordering.
- `inlineReferenceService.js`: inline references + search.

## 🔁 Data flow summary (editor POV)

1. **Load**
   - `DocumentDrafterNew` calls `useDocumentEditor(id)`.
   - Hook fetches complete document structure.

2. **Render**
   - `PagedDocument` renders sections.
   - Each section renders paragraphs + tables + images + files.

3. **Edit**
   - Paragraph edits → `RichParagraphEditor` → `onUpdate`.
   - Section title edits → `SectionHeader` → `updateSection`.
   - Table edits → `DocumentTable` → `tableService`.
   - Image edits → `ImageComponent` → `imageComponentService`.

4. **Save**
   - `saveDocumentComplete` posts full structure.
   - `mapSavedStructureToLocal` updates local IDs.

## 📁 Quick index of editor-heavy components

- Paragraphs: `ParagraphEditor.jsx`, `RichParagraphEditor.jsx`, `ParagraphRenderer.jsx`
- Sections: `SectionHeader.jsx`, `SectionTree.jsx`, `SectionBrowser.jsx`
- Tables: `DocumentTable.jsx`, `InlineTableCreator.jsx`, `TableCreator.jsx`
- Images: `ImageComponent.jsx`, `ImageUploadModal.jsx`, `InlineImageControls.jsx`
- References: `ReferenceDialog.jsx`, `SectionReferenceComponent.jsx`, `SectionSidebar.jsx`
- Files: `DocumentFileComponent.jsx`, `FileAttachmentManager.jsx`

## ✅ Where to extend next

- **Paragraph formatting**: Update `RichParagraphEditor.jsx` and `TextFormatToolbar.jsx`.
- **Section numbering logic**: `SectionHeader.jsx` + backend metadata.
- **Table schema changes**: `tableService.js` + `DocumentTable.jsx`.
- **Image settings/UI**: `ImageComponent.jsx` + `imageComponentService.js`.
- **Reference UI**: `ReferenceDialog.jsx` + `inlineReferenceService.js`.
