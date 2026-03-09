# AI Services API Guide

This document describes the AI-related endpoints exposed under `/api/ai/` in the backend. It is intended for frontend and integration teams.

## Base URL

`/api/ai/`

All endpoints require authentication and use the standard document sharing permissions (owners + shared users with access).

## Endpoints

### 1) Ingest free-form text into a structured document

**POST** `/api/ai/ingest-text/`

**Request**

```json
{
  "text": "<raw document text>"
}
```

**Response**

```json
{
  "status": "created",
  "document": {
    "id": "<document-uuid>",
    "title": "...",
    "document_metadata": {},
    "sections": []
  }
}
```

### 2) Score a document

**GET** `/api/ai/score-document/<document_id>/`

Returns the latest saved score for a document.

**POST** `/api/ai/score-document/<document_id>/`

Runs the scoring model and persists results.

Optional body:

```json
{
  "document_override": "<optional full text override>"
}
```

**Query params**

- `raw=true` — include raw LLM response.

### 3) Score a document with reasoning

**POST** `/api/ai/score-document-with-reasoning/<document_id>/`

Runs a two-step evaluation (reasoning then scoring) and stores the reasoning.

### 4) Get paragraph metadata + placeholders

**GET** `/api/ai/paragraphs/<paragraph_id>/metadata-placeholders/`

Returns:
- `metadata` (document + paragraph merge)
- `processed_text` (placeholder template)
- `rendered_text` (metadata resolved)
- `placeholders_detected`
- `grammar_status`

**Response**

```json
{
  "document_id": "REQ-2026-001",
  "metadata": {
    "client_name": "TechCorp Inc.",
    "contract_date": "2026-01-20",
    "total_value": "$45,000",
    "currency": "USD"
  },
  "processed_text": "Dear [CLIENT_NAME], we have received your request for the project valued at [TOTAL_VALUE]. We look forward to starting on [CONTRACT_DATE].",
  "rendered_text": "Dear TechCorp Inc., we have received your request for the project valued at $45,000. We look forward to starting on 2026-01-20.",
  "grammar_status": "Corrected",
  "placeholders_detected": ["CLIENT_NAME", "TOTAL_VALUE", "CONTRACT_DATE"]
}
```

### 5) Save paragraph placeholders or raw text

**POST** `/api/ai/paragraphs/<paragraph_id>/apply-placeholders/`

Use one of:

- `raw_text` (preferred if you want grammar normalization + placeholder extraction)
- `processed_text` (placeholder template string)

Optional:

- `placeholders` (overrides for rendering)

**Request (raw text)**

```json
{
  "raw_text": "Dear TechCorp Inc., we have received your request for the project valued at $45,000. We look forward to starting on 2026-01-20."
}
```

**Request (processed text)**

```json
{
  "processed_text": "Dear [CLIENT_NAME], we have received your request for the project valued at [TOTAL_VALUE]. We look forward to starting on [CONTRACT_DATE]."
}
```

**Response**

```json
{
  "document_id": "REQ-2026-001",
  "paragraph_id": "7b6d1f6b-29f1-4ad0-9f3f-1fa1f11eced9",
  "processed_text": "Dear [CLIENT_NAME], we have received your request for the project valued at [TOTAL_VALUE]. We look forward to starting on [CONTRACT_DATE].",
  "grammar_status": "Corrected",
  "already_correct": false,
  "placeholders_detected": ["CLIENT_NAME", "TOTAL_VALUE", "CONTRACT_DATE"],
  "updated_text": "Dear TechCorp Inc., we have received your request for the project valued at $45,000. We look forward to starting on 2026-01-20.",
  "status": "updated"
}
```

### 6) Paragraph AI review (grammar + legal suggestions + scores)

**GET** `/api/ai/paragraphs/<paragraph_id>/ai-review/`

Generates paragraph-level AI insights using Gemini with a strict JSON schema prompt. Returns:

- `processed_text` (placeholder template)
- `rendered_text` (metadata-resolved + grammar-normalized)
- `scores` (grammar, legal risk, clarity, overall)
- `suggestions` (grammar + legal improvement suggestions)

**Response**

```json
{
  "document_id": "REQ-2026-001",
  "paragraph_id": "7b6d1f6b-29f1-4ad0-9f3f-1fa1f11eced9",
  "processed_text": "Dear [CLIENT_NAME], we have received your request for the project valued at [TOTAL_VALUE]. We look forward to starting on [CONTRACT_DATE].",
  "rendered_text": "Dear TechCorp Inc., we have received your request for the project valued at $45,000. We look forward to starting on 2026-01-20.",
  "grammar_status": "Corrected",
  "placeholders_detected": ["CLIENT_NAME", "TOTAL_VALUE", "CONTRACT_DATE"],
  "paragraph_type": "standard",
  "paragraph_metadata": {},
  "scores": {
    "grammar_score": 0.95,
    "legal_risk_score": 1.0,
    "clarity_score": 0.92,
    "overall_score": 0.956
  },
  "suggestions": [
    {
      "id": "legal_replace_may",
      "type": "legal",
      "message": "Replace discretionary language with mandatory language where appropriate.",
      "original": "may",
      "replacement": "shall"
    }
  ]
}
```

**Gemini requirement**

These endpoints require `GEMINI_API` to be set in the environment. If it is missing, the API returns `503` with
`Gemini API key not configured.`

### 7) Fetch paragraph AI review result (latest for version)

**GET** `/api/ai/paragraphs/<paragraph_id>/ai-results/`

**Query params**

- `version_number` (optional, defaults to current document version)

**Response**

```json
{
  "status": "ok",
  "version_number": 3,
  "result": {
    "id": "<ai-result-uuid>",
    "document": "<document-uuid>",
    "paragraph": "<paragraph-uuid>",
    "document_version_number": 3,
    "document_version": "3.0",
    "processed_text": "...",
    "rendered_text": "...",
    "scores": {
      "grammar_score": 1.0,
      "legal_risk_score": 1.0,
      "clarity_score": 1.0,
      "overall_score": 1.0
    },
    "suggestions": [],
    "analysis_timestamp": "2026-01-21T12:00:00Z"
  }
}
```

### 8) Fetch paragraph AI results for a document

**GET** `/api/ai/documents/<document_id>/paragraph-ai-results/`

**Query params**

- `version_number` (optional, defaults to current document version)
- `paragraph_id` (optional, repeatable; filters results to specific paragraphs)

**Response**

```json
{
  "status": "ok",
  "version_number": 3,
  "results": [
    {
      "id": "<ai-result-uuid>",
      "paragraph": "<paragraph-uuid>",
      "processed_text": "...",
      "rendered_text": "...",
      "scores": {
        "grammar_score": 1.0,
        "legal_risk_score": 1.0,
        "clarity_score": 1.0,
        "overall_score": 1.0
      },
      "suggestions": []
    }
  ]
}
```

### 9) Run AI review for updated paragraphs (bulk)

**POST** `/api/ai/documents/<document_id>/paragraph-ai-review/updated/`

Runs paragraph AI review for paragraphs whose state differs from the latest saved AI result in the current
document version (edit count or last modified timestamp). Returns only the updated results.

**Query params**

- `limit` (optional, integer; max number of paragraphs to process)

**Response**

```json
{
  "status": "ok",
  "document_id": "REQ-2026-001",
  "version_number": 3,
  "updated_count": 2,
  "skipped_count": 12,
  "updated_results": [
    {
      "paragraph_id": "<paragraph-uuid>",
      "processed_text": "...",
      "rendered_text": "...",
      "scores": {
        "grammar_score": 1.0,
        "legal_risk_score": 1.0,
        "clarity_score": 1.0,
        "overall_score": 1.0
      },
      "suggestions": []
    }
  ],
  "skipped_paragraphs": ["<paragraph-uuid>"]
}
```

### 10) Render paragraph with current metadata (frontend/print)

**GET** `/api/ai/paragraphs/<paragraph_id>/render/`

Use this endpoint after paragraph metadata edits. It re-renders the stored placeholder text with current
`Paragraph.custom_metadata` so the frontend and print flows always display the latest values.

**Response**

```json
{
  "document_id": "REQ-2026-001",
  "paragraph_id": "7b6d1f6b-29f1-4ad0-9f3f-1fa1f11eced9",
  "paragraph_type": "standard",
  "paragraph_metadata": {},
  "processed_text": "Dear [[7b6d1f6b-29f1-4ad0-9f3f-1fa1f11eced9.client_name]], ...",
  "rendered_text": "Dear TechCorp Inc., ...",
  "placeholders_detected": ["client_name"]
}
```

## Placeholder rendering rules

- `processed_text` is the authoritative template string for frontend rendering.
- Placeholder tokens must match normalized metadata keys (uppercase + underscores).
- The frontend should replace placeholders exactly as written in `processed_text` for quick rendering.

## Suggestion range calculation

Ranges are computed server-side against `rendered_text` to avoid AI offset drift.

- `range.start`: 0-based index in `rendered_text`
- `range.end`: exclusive index (`rendered_text[start:end]`)

### Multiple matches

If the same `original` substring appears multiple times, the API returns the **first** match. To target a specific
occurrence, send a more specific `original` string (include surrounding words) so it’s unique.

### Applying a suggestion

Send the updated suggestion back to `/api/ai/paragraphs/<paragraph_id>/ai-review/apply/` and the API will replace
the first matching `original` and return updated `rendered_text` and `processed_text`.

## Metadata sources

Placeholder values are derived from paragraph-level metadata:

- `Paragraph.custom_metadata`

## Notes

- Grammar normalization is intentionally lightweight and skipped for HTML-rich paragraphs.
- If stronger grammar correction is required, integrate an LLM or LanguageTool behind a feature flag.
