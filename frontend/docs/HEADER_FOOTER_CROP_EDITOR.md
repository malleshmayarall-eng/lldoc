# Frontend Prompting Guide — Header / Footer PDF Crop Editor

> **Last updated:** February 2026
> **Related docs:** [HEADER_FOOTER_CROP_API.md](HEADER_FOOTER_CROP_API.md) • [PDF_SETTINGS_API_GUIDE.md](PDF_SETTINGS_API_GUIDE.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Visual Architecture](#visual-architecture)
3. [Complete User Workflow](#complete-user-workflow)
4. [Crop Modal — Visual Elements](#crop-modal--visual-elements)
5. [Horizontal Line Overlay System](#horizontal-line-overlay-system)
6. [Region Types: Header / Footer / Both](#region-types-header--footer--both)
7. [Coordinate Mapping (pts ↔ pixels)](#coordinate-mapping-pts--pixels)
8. [Drag Interaction](#drag-interaction)
9. [Slider + Number Input Sync](#slider--number-input-sync)
10. [Auto-Detect Workflow](#auto-detect-workflow)
11. [Save & Apply Flow](#save--apply-flow)
12. [Library Reuse](#library-reuse)
13. [Active Indicators & Management](#active-indicators--management)
14. [API Endpoints Used](#api-endpoints-used)
15. [React Component Reference](#react-component-reference)
16. [Prompting Guidelines for AI Assistants](#prompting-guidelines-for-ai-assistants)

---

## Overview

The **Crop Editor** lets users upload a PDF (e.g. company letterhead), visually select the header and/or footer strip from its **first page**, and save those strips as reusable `HeaderFooterPDF` records. When applied, the cropped PDF strips are **overlaid** onto the exported document using real PDF merging — preserving text selectability.

### Key Design Decisions

| Decision | Rationale |
|---|---|
| **First page only** | Letterheads are consistent — page 1 always represents the layout |
| **Horizontal lines, not rectangles** | Header = top strip, Footer = bottom strip. Only height varies |
| **Points (pt) as unit** | PDF coordinate system. 1pt = 1/72 inch. A4 = 595.28 × 841.89 pt |
| **Drag + slider dual input** | Drag for visual precision, slider/number for exact values |
| **Shaded overlay regions** | Blue tint = header zone, Purple tint = footer zone |

---

## Visual Architecture

The crop editor is implemented as a **React component** (`HeaderFooterCropEditor`) with three sub-parts:

1. **Panel Card** — source PDF selector, upload, active indicators, action buttons
2. **Library Panel** — previously saved crops with "Apply" buttons
3. **Crop Modal** — full-screen overlay with PDF preview, draggable lines, sliders

### Panel Card Layout
```
┌──────────────────────────────────────────┐
│  📄 Header / Footer PDF   (panel-card)   │
│  ┌────────────────────────────────────┐  │
│  │ Source PDF: [Select a PDF… ▼]      │  │
│  │ [Choose file…]                     │  │
│  │                                    │  │
│  │ ✓ Header: Corporate Header (80pt)  │  │  ← green indicator
│  │   Apply on: [First page only ▼]    │  │
│  │ ✓ Footer: Corporate Footer (60pt)  │  │  ← green indicator
│  │   Apply on: [All pages ▼]          │  │
│  │                                    │  │
│  │ [Open Crop Editor] [Auto-Detect]   │  │
│  └────────────────────────────────────┘  │
│                                          │
│  📚 My Header/Footer Library             │
│  ┌────────────────────────────────────┐  │
│  │ • Corporate Header  80pt  [Apply]  │  │
│  │ • Corporate Footer  60pt  [Apply]  │  │
│  │ [Refresh Library]                  │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

### Crop Modal (full-screen overlay)
```
╔══════════════════════════════════════════════════════╗
║  ✂️ Crop Header / Footer Region                 [✕] ║
║                                                      ║
║  (●) Header only  ( ) Footer only  (●) Both         ║
║                                                      ║
║  ┌──────────────────────────────────────────────┐    ║
║  │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│    ║  ← blue tint
║  │░░░░░░░░░░ HEADER REGION ░░░░░░░░░░░░░░░░░░░░│    ║
║  ├══════════ HEADER ▼ 80pt ═════════════════════┤    ║  ← blue line
║  │                                              │    ║
║  │              PDF CONTENT                     │    ║
║  │              (first page)                    │    ║
║  │                                              │    ║
║  ├══════════ ▲ FOOTER 60pt ═════════════════════┤    ║  ← purple line
║  │▓▓▓▓▓▓▓▓▓ FOOTER REGION ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│    ║
║  │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│    ║  ← purple tint
║  └──────────────────────────────────────────────┘    ║
║                                                      ║
║  ⬒ Header height  [────────●──] [80 ] pt            ║
║  ⬓ Footer height  [──────●────] [60 ] pt            ║
║                                                      ║
║  Header name  [Corporate Header          ]          ║
║  Footer name  [Corporate Footer          ]          ║
║                                                      ║
║            [🔍 Auto-Detect] [Cancel] [💾 Save & Apply]║
╚══════════════════════════════════════════════════════╝
```

---

## Complete User Workflow

### Step 1: Upload a Source PDF
1. User goes to **Export Studio** → **Header & Footer** section
2. Clicks **"Choose file…"** to select a PDF (letterhead, template, etc.)
3. File is uploaded as a `DocumentFile` via `POST /api/documents/files/upload/`
4. The source file dropdown is populated and auto-selected

### Step 2: Open the Crop Editor
1. User clicks **"Open Crop Editor"**
2. Full-screen modal opens with dark backdrop (`rgba(0,0,0,0.88)`)
3. System fetches page info (pts) from `GET /api/documents/header-footer-pdfs/page-info/`
4. System fetches page 1 preview (PNG at 150 DPI) from `GET /api/documents/header-footer-pdfs/preview/`
5. Preview image loads → `requestAnimationFrame` × 2 → overlays position accurately
6. Default: **"Both"** radio selected, sliders at **80pt** each

### Step 3: Adjust Crop Lines
Three ways to adjust:

| Method | How it works |
|---|---|
| **Drag the line** | Grab the blue (header) or purple (footer) line and drag up/down |
| **Move the slider** | Drag the range slider thumb |
| **Type the value** | Enter an exact pt value in the number input |

All three are synced in real-time.

### Step 4: Choose Region Type
| Radio selection | What it saves |
|---|---|
| **Header only** | One `HeaderFooterPDF` with `region_type=header` |
| **Footer only** | One `HeaderFooterPDF` with `region_type=footer` |
| **Both** | TWO records — one header + one footer |

### Step 5: Save & Apply
1. User clicks **"💾 Save & Apply"**
2. For each region: `POST /api/documents/header-footer-pdfs/` then `POST .../apply/`
3. Modal closes, indicators refresh, PDF preview reloads

---

## Crop Modal — Visual Elements

### Colors

| Element | Color |
|---|---|
| Header line | `#38bdf8` (sky-400) with `box-shadow: 0 0 8px rgba(56,189,248,0.7)` |
| Header overlay | `rgba(56,189,248,0.15)` |
| Header label bg | `#38bdf8` with dark text `#0f172a` |
| Footer line | `#6366f1` (indigo-500) with `box-shadow: 0 0 8px rgba(99,102,241,0.7)` |
| Footer overlay | `rgba(99,102,241,0.15)` |
| Footer label bg | `#6366f1` with white text |

---

## Coordinate Mapping (pts ↔ pixels)

```javascript
const scale = imgRef.current.clientHeight / pageHeightPts;
const headerPx = Math.round(headerPts * scale);
const footerPx = Math.round(footerPts * scale);
```

### Why requestAnimationFrame × 2?
When the preview image loads, the browser hasn't necessarily computed its layout yet:
1. First rAF: browser commits the image to the render tree
2. Second rAF: layout is finalized, `clientHeight` returns correct value

---

## Drag Interaction

| Region | Drag direction | Effect |
|---|---|---|
| Header | Drag **down** | Increases header height |
| Header | Drag **up** | Decreases header height |
| Footer | Drag **up** | Increases footer height |
| Footer | Drag **down** | Decreases footer height |

Drag uses pointer events on document, sets `cursor:row-resize` and `userSelect:none`.

---

## API Endpoints Used

| Action | Method | Endpoint |
|---|---|---|
| Upload source PDF | `POST` | `/api/documents/files/upload/` |
| List source files | `GET` | `/api/documents/files/?file_type=pdf` |
| Get page info | `GET` | `/api/documents/header-footer-pdfs/page-info/?source_file_id={id}&page=1` |
| Get page preview | `GET` | `/api/documents/header-footer-pdfs/preview/?source_file_id={id}&page=1&dpi=150` |
| Auto-detect | `GET` | `/api/documents/header-footer-pdfs/auto-detect/?source_file_id={id}&page=1` |
| Create crop | `POST` | `/api/documents/header-footer-pdfs/` |
| Apply to document | `POST` | `/api/documents/header-footer-pdfs/{id}/apply/` |
| My library | `GET` | `/api/documents/header-footer-pdfs/my-library/` |
| Remove from doc | `PATCH` | `/api/documents/{id}/header-footer/` |

---

## React Component Reference

### Components

| Component | File | Purpose |
|---|---|---|
| `HeaderFooterCropEditor` | `src/components/HeaderFooterCropEditor.jsx` | Main panel with upload, indicators, actions, library, and crop modal |
| `CropModal` | (inside HeaderFooterCropEditor) | Full-screen modal with preview image, overlay lines, sliders, save |
| `LibraryPanel` | (inside HeaderFooterCropEditor) | Saved crops library with apply buttons |
| `ActiveIndicator` | (inside HeaderFooterCropEditor) | Green badge showing applied header/footer |
| `PdfPreviewOverlay` | `src/components/PdfPreviewOverlay.jsx` | Draggable lines on the main PDF preview iframe |
| `ExportSettingsPanel` | `src/components/ExportSettingsPanel.jsx` | Contains `HeaderFooterCropEditor` + template fallback |

### Service Methods

| Method | File | Purpose |
|---|---|---|
| `getHfPdfPageInfo()` | `src/services/exportSettingsService.js` | Get page dimensions (pts) |
| `getHfPdfPreview()` | `src/services/exportSettingsService.js` | Get page 1 PNG preview blob |
| `autoDetectHfPdf()` | `src/services/exportSettingsService.js` | Auto-detect header/footer |
| `createHfPdf()` | `src/services/exportSettingsService.js` | Create cropped record |
| `applyHfPdf()` | `src/services/exportSettingsService.js` | Apply record to document |
| `getHfPdfLibrary()` | `src/services/exportSettingsService.js` | List saved crops |

### API Constants

All endpoints are in `src/constants/api.js` → `API_ENDPOINTS.EXPORT_STUDIO`:
- `HF_PDFS`, `HF_PDF_PAGE_INFO`, `HF_PDF_PREVIEW`, `HF_PDF_AUTO_DETECT`, `HF_PDF_APPLY(id)`, `HF_PDF_LIBRARY`

---

## Prompting Guidelines for AI Assistants

### Key Patterns to Follow

- **Always use `updateCropOverlays()` pattern** — in React this is handled by deriving `headerPx`/`footerPx` from `headerPts * scale`
- **Never hardcode pixel values** — always calculate from `scale = imgClientHeight / pageHeightPts`
- **Use `requestAnimationFrame`** when measuring image after load
- **Header uses `top` property**, footer uses `bottom` — they work from opposite edges
- **All overlays use absolute positioning** within a `position:relative` container

### Testing Checklist

- [ ] Overlay lines appear at correct positions when modal opens
- [ ] Dragging header line down increases the blue shaded area
- [ ] Dragging footer line up increases the purple shaded area
- [ ] Slider and number input stay synced during drag
- [ ] Labels show correct pt values during adjustment
- [ ] Switching region type hides/shows correct elements
- [ ] Window resize recalculates overlay positions
- [ ] Auto-detect populates sliders correctly
- [ ] Save & Apply creates records and refreshes indicators
- [ ] Escape key closes the modal
- [ ] Overlap warning appears when regions collide
