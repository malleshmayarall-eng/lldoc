# Paragraph AI API

This document describes the paragraph-level AI endpoints exposed under `/api/ai/`. These endpoints power metadata extraction, grammar cleanup, scoring, and paragraph rendering.

## Base URL

`/api/ai/`

All endpoints require authentication and respect document sharing permissions.

---

## 1) Paragraph AI review (full pipeline)

**GET** `/api/ai/paragraphs/<paragraph_id>/ai-review/`

Runs the paragraph AI pipeline (metadata → rewrite → scoring). If a cached result exists for the current document version and the paragraph hasn’t changed, the cached result is returned.

**Response (example)**

```json
{
  "document_id": "REQ-2026-001",
  "paragraph_id": "7b6d1f6b-29f1-4ad0-9f3f-1fa1f11eced9",
  "paragraph_type": "standard",
  "paragraph_type_detected": "exception",
  "paragraph_ai_result_id": "<ai-result-uuid>",
  "ai_result_cached": true,
  "ai_result_timestamp": "2026-01-21T12:00:00Z",
  "processed_text": "The first exception provides loss-on-sale protection...",
  "grammar_status": "Unchanged",
  "already_correct": true,
  "metadata_detected": {},
  "placeholders_detected": [],
  "scores": {
    "grammar_score": 1.0,
    "clarity_score": 1.0,
    "ambiguity_score": 0.12,
    "legal_risk_score": 0.9,
    "reference_integrity_score": 0.95,
    "enforceability_score": 0.91,
    "structural_validity_score": 0.96,
    "overall_score": 0.97,
    "confidence_score": 0.93,
    "model_version": "paragraph-signal-v1",
    "review": "Short summary of quality.",
    "reasoning": "Brief scoring rationale."
  },
  "suggestions": []
}
```

**Notes**
- `ai_result_cached=true` indicates a saved result was reused.
- `ai_result_timestamp` is the saved AI result timestamp.
- Scores include optional `review` + `reasoning` when provided by the scoring call.

---

## 2) Paragraph AI rewrite (suggestions as input)

**POST** `/api/ai/paragraphs/<paragraph_id>/ai-review/rewrite/`

Accepts `suggestions` from the client and produces a rewritten paragraph plus updated suggestions.

**Request**

```json
{
  "processed_text": "The first exception provides loss on sale protection.",
  "rendered_text": "The first exception provides loss on sale protection.",
  "suggestions": [
    {
      "id": "grammar_fix",
      "type": "grammar",
      "message": "Add hyphen",
      "original": "loss on sale",
      "replacement": "loss-on-sale"
    }
  ]
}
```

**Response**

```json
{
  "document_id": "REQ-2026-001",
  "paragraph_id": "7b6d1f6b-29f1-4ad0-9f3f-1fa1f11eced9",
  "paragraph_type": "standard",
  "processed_text": "The first exception provides loss-on-sale protection.",
  "grammar_status": "Corrected",
  "suggestions": []
}
```

---

## 3) Fetch paragraph AI result (latest for version)

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

---

## 4) Fetch paragraph AI results for a document

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
        "clarity_score": 1.0,
        "ambiguity_score": 0.1,
        "legal_risk_score": 1.0,
        "reference_integrity_score": 0.98,
        "enforceability_score": 0.95,
        "structural_validity_score": 0.96,
        "overall_score": 1.0,
        "confidence_score": 0.93,
        "model_version": "paragraph-signal-v1"
      },
      "suggestions": []
    }
  ]
}
```

---

## 5) Run AI review for updated paragraphs (bulk refresh)

**POST** `/api/ai/documents/<document_id>/paragraph-ai-review/updated/`

Runs paragraph AI review for paragraphs whose state differs from the latest saved AI result in the current
version (edit count or last modified timestamp). Returns only updated results.

**Query params**
- `limit` (optional integer)

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
        "clarity_score": 1.0,
        "ambiguity_score": 0.1,
        "legal_risk_score": 1.0,
        "reference_integrity_score": 0.98,
        "enforceability_score": 0.95,
        "structural_validity_score": 0.96,
        "overall_score": 1.0,
        "confidence_score": 0.93,
        "model_version": "paragraph-signal-v1"
      },
      "suggestions": []
    }
  ],
  "skipped_paragraphs": ["<paragraph-uuid>"]
}
```

---

## 6) Bulk scoring review for document (cached for unchanged)

**POST** `/api/ai/documents/<document_id>/paragraph-ai-scoring/`

Runs the scoring + review prompt for paragraphs that have changed in the current document version.
If a paragraph has not changed, the cached score is returned without calling the model.

**Query params**
- `limit` (optional integer)
- `paragraph_id` (optional, repeatable)

**Response**

```json
{
  "status": "ok",
  "document_id": "REQ-2026-001",
  "version_number": 3,
  "updated_count": 2,
  "skipped_count": 12,
  "results": [
    {
      "paragraph_id": "<paragraph-uuid>",
      "scores": {
        "grammar_score": 1.0,
        "clarity_score": 1.0,
        "ambiguity_score": 0.1,
        "legal_risk_score": 1.0,
        "reference_integrity_score": 0.98,
        "enforceability_score": 0.95,
        "structural_validity_score": 0.96,
        "overall_score": 1.0,
        "confidence_score": 0.93,
        "model_version": "paragraph-signal-v1",
        "review": "Short summary of quality.",
        "reasoning": "Brief scoring rationale."
      },
      "analysis_timestamp": "2026-01-21T12:00:00Z",
      "cached": false
    }
  ],
  "updated_paragraphs": ["<paragraph-uuid>"],
  "skipped_paragraphs": ["<paragraph-uuid>"]
}
```

---

## 7) Render paragraph with current metadata

**GET** `/api/ai/paragraphs/<paragraph_id>/render/`

Renders a paragraph using current `Paragraph.custom_metadata` and placeholder tokens.

**Response**

```json
{
  "document_id": "REQ-2026-001",
  "paragraph_id": "7b6d1f6b-29f1-4ad0-9f3f-1fa1f11eced9",
  "paragraph_type": "standard",
  "paragraph_metadata": {},
  "processed_text": "Dear [[7b6d1f6b-...-client_name]], ...",
  "rendered_text": "Dear TechCorp Inc., ...",
  "placeholders_detected": ["client_name"]
}
```

---

## 8) Placeholder extraction and save (optional helper endpoints)

**GET** `/api/ai/paragraphs/<paragraph_id>/metadata-placeholders/`

**POST** `/api/ai/paragraphs/<paragraph_id>/apply-placeholders/`

These helper endpoints manage placeholder templates for paragraphs and are often used before AI review.

---

## Errors

- `503` when `GEMINI_API` is missing.
- `502` when the Gemini API returns an error (e.g., invalid/expired key).

---

## Notes

- Suggestions include ranges computed server-side against `rendered_text`.
- Cached results are reused when paragraph state and document version match.
- Scores are on a 0.0 to 1.0 scale.
