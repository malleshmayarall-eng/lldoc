# Paragraph Placeholder & Metadata API Guide

This guide explains how to use the AI endpoints that convert paragraph text into placeholder-based templates, how to render those templates using paragraph-scoped metadata, and how the frontend should integrate suggestions and UI behavior (underlining placeholders, preventing per-character deletion, and handling suggestion accept/ignore flows).

## Goals

- Convert text values in paragraphs into stable placeholders referencing paragraph-level custom metadata.
- Save the placeholderized text in the paragraph so it can be rendered with up-to-date metadata later.
- Let grammar suggestions be surfaced to the editor UI and allow the user to apply or ignore them; applying a suggestion updates the raw text (using the provided text range) and re-applies placeholder extraction.
- Ensure placeholders are visually distinct (underlined) and behave like atomic tags (cannot be deleted by individual characters; only removable as a whole placeholder).

## High-level flow

1. The frontend requests the paragraph AI endpoint to analyze a paragraph (or sends raw text for processing).
2. The AI returns a `processed_text` containing placeholders (for this project we use double-brackets for paragraph-metadata placeholders: `[[<paragraph_id>.<key>]]`).
3. The frontend stores `processed_text` as the paragraph's authoritative template and updates the paragraph's `custom_metadata` with any detected values.
4. When rendering the paragraph, the frontend replaces placeholders with the latest paragraph-scoped metadata values and displays them underlined, non-deletable by character, and removable as whole tags.
5. Grammar suggestions from the AI are surfaced in the paragraph editor. Each suggestion contains a `range` (start/end) relative to the rendered/raw text. Users can hover/click to see Ignore / Change actions. Choosing Change replaces the range in the raw text, re-submits to the placeholder extractor as needed, and saves results.

## Endpoints (frontend-facing)

### 1) Get paragraph placeholders and metadata

GET /api/ai/paragraphs/<paragraph_id>/metadata-placeholders/

Response (example):

```json
{
  "document_id": "6ca5b26b-778e-416e-8435-6a2afa6f8ef2",
  "paragraph_id": "c415c46f-9f53-4932-b589-38be3695e876",
  "paragraph_type": "standard",
  "paragraph_metadata": {},
  "metadata_detected": {
    "charge_rate": "0.9‰"
  },
  "processed_text": "L/C negotiation will be charged on the basis of [[c415c46f-9f53-4932-b589-38be3695e876.charge_rate]].",
  "rendered_text": "L/C negotiation will be charged on the basis of 0.9‰.",
  "grammar_status": "Unchanged",
  "placeholders_detected": ["charge_rate"],
  "scores": {
    "grammar_score": 1.0,
    "legal_risk_score": 0.9,
    "clarity_score": 1.0,
    "overall_score": 0.97
  },
  "suggestions": [
    {
      "id": "a1b2c3d4-e5f6-4789-9012-34567890abcd",
      "type": "metadata",
      "is_fixable": true,
      "confidence_score": 1.0,
      "range": { "start": 47, "end": 51 },
      "message": "Identified financial charge rate as a metadata placeholder.",
      "original": "0.9‰",
      "replacement": "[[c415c46f-9f53-4932-b589-38be3695e876.charge_rate]]"
    }
  ]
}
```

Notes on the response fields:

- `processed_text`: the template string saved into paragraph storage and used as the authoritative template. Placeholders use the format `[[<paragraph_id>.<key>]]`.
- `rendered_text`: a preview of the paragraph with placeholders substituted using `metadata_detected`.
- `metadata_detected`: key/value pairs the AI found in the paragraph; these should be written to the paragraph's `custom_metadata` in the document store.
- `suggestions`: actionable items the frontend should show to the editor UI. Each suggestion includes a `range` relative to the raw/rendered text and a `replacement` to apply if the user accepts the suggestion.

### 2) Save placeholder text or raw text

POST /api/ai/paragraphs/<paragraph_id>/apply-placeholders/

Request options:

- `raw_text`: the edited paragraph content (preferred when you want grammar normalization and placeholder extraction).
- `processed_text`: a paragraph already containing placeholders.
- Optional `placeholders` to override values for preview rendering.

Response should return the updated `processed_text`, `rendered_text`, `placeholders_detected`, `grammar_status`, and `status` similar to the earlier example.

## Placeholder naming rules and format

- Placeholders are derived from metadata keys and normalized to a stable form during extraction. The format used here is `[[<paragraph_id>.<metadata_key>]]`.
- Example: `charge_rate` becomes `[[c415c46f-9f53-4932-b589-38be3695e876.charge_rate]]` (paragraph-scoped).
- If your system supports document-level metadata in addition to paragraph-level, prefer paragraph-level (`Paragraph.custom_metadata`) for these placeholders to keep templates portable and avoid accidental overrides.

### Placeholder access (global)

All metadata is available throughout the document. Placeholders such as `[[charge_rate]]` or `[CHARGE_RATE]` resolve from the combined metadata pool (document + section + paragraph). If the same key exists in multiple places, the renderer uses the first value it finds in the merged metadata set. To avoid ambiguity, keep metadata keys unique across the document.

## Frontend integration details

Implementation contract (inputs/outputs):

- Input: paragraph object with `id`, `raw_text`, and optional `custom_metadata`.
- Output: UI-rendered paragraph with placeholders replaced by metadata values; suggestion UI when suggestions are present.
- Error modes: missing metadata key → show placeholder with a distinct empty-value styling and a tooltip; invalid suggestion range → ignore and log.

Detection / parsing rules

- To find placeholders, use a regex that matches double-bracketed placeholders: `\\[\\[([^\\]]+)\\]\\]`.
- Extract the inner string `paragraphId.key` and split on the first `.` to get the paragraph id and the metadata key path.

Rendering

- Replace placeholders at render time using the merged metadata scopes (paragraph, section, document).
- Visual styling: underline placeholders with a dotted/solid underline and a `data-placeholder` attribute on the DOM node containing the placeholder token and its metadata key.
- Behavior: make placeholders atomic in the editor so users cannot delete them by deleting characters inside the placeholder. Implementation approaches:
  - If using a rich text editor (Draft.js, Slate, TipTap, ProseMirror, or similar): render placeholders as inline nodes/entities with the editor's atomic/void behavior so they are treated as a single unit.
  - If using plain contenteditable: wrap placeholder text in a non-editable span with contenteditable="false" and provide a small UI affordance to remove the entire placeholder (e.g., an 'x' button on the span). Be careful with copy/paste behavior.

Suggestion UI and apply/ignore flow

- Suggestions returned by the AI should be shown in-line or in a gutter when the user hovers or clicks the suggested text.
- Each suggestion contains a `range` (start/end) referencing the paragraph raw/rendered text. When showing the suggestion, highlight the range (e.g., yellow background) and show a small popup with options: `Ignore` and `Apply` (or `Change`).
- On `Ignore`: mark the suggestion as ignored in the UI (optionally send an analytics event). No change to paragraph text.
- On `Apply`: use the suggestion's `replacement` value and the `range` to update the paragraph's raw text:

  1. Compute new raw text: raw_text = raw_text.slice(0, start) + replacement + raw_text.slice(end)
  2. If the replacement is a placeholder (e.g., `[[<paragraphId>.<key>]]`), update paragraph `custom_metadata` with the value from the suggestion (if provided) or leave the key and expect the backend to extract/update it.
  3. Re-submit the updated `raw_text` to the `apply-placeholders` endpoint to normalize grammar and extract placeholders, or run local placeholder extraction if desired for immediate UX.

Range indexing notes

- The AI's `range` values are character offsets. Ensure the frontend uses the same normalization as the AI when computing ranges (e.g., treat unicode characters, HTML entities, or rich-text markers consistently). If paragraphs contain HTML, the AI may skip grammar normalization; consider sending plain-text to the AI when you need exact range-based edits.
- Ranges are computed server-side against `rendered_text` to avoid offset drift:
  - `range.start`: 0-based index in `rendered_text`
  - `range.end`: exclusive index (`rendered_text[start:end]`)
- If the same `original` substring appears multiple times, the API returns the **first** match. To target a specific occurrence, send a more specific `original` string (include surrounding words) so it’s unique.
- To apply a suggestion via the API, post to `/api/ai/paragraphs/<paragraph_id>/ai-review/apply/` and the API will replace the first matching `original` and return updated `rendered_text` and `processed_text`.

Atomic placeholder deletion

- Provide a UI action to remove a placeholder entirely (for paragraph-level template edits). When user removes a placeholder, delete the whole placeholder token from `processed_text` and, if relevant, remove the corresponding key from `custom_metadata`.

Permissions

- Endpoints require authentication and use the same access rules as document sharing. The frontend must check access before calling AI endpoints.

Edge cases and caveats

- If a paragraph contains HTML or complex inline tags, the AI's grammar normalization might be skipped to avoid corrupting markup. The frontend can strip tags and send plain-text to the AI for stronger grammar passes, then map ranges back conservatively.
- Copy/paste of placeholders between paragraphs should either map placeholders to the new paragraph id or convert them into plain metadata keys (depending on intended portability). Prefer converting to paragraph-scoped placeholders only when saving.

Developer examples

- Placeholder detection regex (JS):

```js
const placeholderRegex = /\\[\\[([^\\]]+)\\]\\]/g;
// Matches e.g. [[c415c46f-9f53-4932-b589-38be3695e876.charge_rate]]
```

- Replace placeholders for rendering (JS):

```js
function renderWithMetadata(processedText, paragraphId, metadata) {
  return processedText.replace(/\\[\\[([^\\]]+)\\]\\]/g, (match, inner) => {
    // inner looks like "<paragraphId>.<key>" — prefer matching paragraphId or allow key-only if local
    const parts = inner.split('.');
    const key = parts.length > 1 ? parts.slice(1).join('.') : parts[0];
    const value = metadata && metadata[key];
    return value != null ? value : match; // leave placeholder if no value
  });
}
```

## How this integrates with the provided API output

Given the example API output above, the frontend should:

1. Save/merge `metadata_detected` into the paragraph's `custom_metadata` (e.g., add `charge_rate: "0.9‰"`).
2. Set the paragraph's `processed_text` to the returned `processed_text`.
3. Render the paragraph using the paragraph's `processed_text` and the paragraph's `custom_metadata`. Underline the placeholder corresponding to `charge_rate` and render `0.9‰` in the preview.
4. Present the suggestion item in the paragraph's editor UI (highlight the range at 47–51). When the user accepts the suggestion, replace that range in the raw text with the `replacement` and call `apply-placeholders` to persist the placeholderized version.

## Notes on storage

- `processed_text` is the authoritative template string saved with the paragraph. The frontend must treat it as the source of truth for rendering. `raw_text` may still be kept for edit history or undo.
- `custom_metadata` on the paragraph holds the values used to render placeholders.

## Backend changes required for scoped metadata

To resolve `document.*` and `section.*` placeholders inside any paragraph, the frontend needs access to metadata for each scope. Implement the following backend changes (align naming with your API conventions):

1. **Expose document-level metadata in the document payload**
  - Include `document_metadata` and/or `custom_metadata` for the document in the document serializer (or a `metadata` object containing both structured and custom values).
  - Keep metadata lightweight; avoid embedding full section or paragraph objects inside metadata.

2. **Expose section metadata on each section**
  - Ensure every section in the document response includes `metadata` (structured) and/or `custom_metadata` (custom).

3. **Optional roll-up (inheritance aggregation)**
  - If you want section metadata to automatically include metadata detected in its paragraphs, compute a section roll-up (e.g., `section.metadata_rollup`) when saving paragraph updates.
  - If you want document metadata to include metadata from all sections, compute a document roll-up (e.g., `document.metadata_rollup`) when saving section updates.
  - The frontend already resolves unscoped placeholders using paragraph → section → document. Roll-ups are optional, but helpful if you want the backend to precompute inherited values.

4. **AI metadata extraction endpoints**
  - Continue writing `metadata_detected` into `Paragraph.custom_metadata` for paragraph-scoped placeholders.
  - If you later allow AI to target section/document scopes, return a `scope` field per extracted key and persist it at the correct level.

## Next steps and implementation checklist

- [ ] Add `src/utils/paragraphPlaceholders.js` utility with parsing and rendering helpers (detection, renderWithMetadata, applySuggestionRange).
- [ ] Render placeholders as atomic inline nodes in editor component (e.g., `ParagraphRenderer.jsx` / `ParagraphWithCitations.jsx`).
- [ ] Add suggestion popup UI with Ignore / Apply actions and wire to `apply-placeholders` endpoint.
- [ ] Add unit tests for placeholder parsing, rendering fallback behavior, and suggestion application.
- [ ] Run quick build/tests and fix any integration issues.

If you'd like, I can implement the utility file `src/utils/paragraphPlaceholders.js` and a small example integration in `src/components/ParagraphRenderer.jsx` next.

----

Last updated: 2026-01-21

