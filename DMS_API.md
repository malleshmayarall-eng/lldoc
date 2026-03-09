# DMS API Guide

Document Management System (DMS) stores PDFs in the database, extracts metadata, and provides search + retrieval endpoints.

## Base URL

```
/api/dms/
```

## Authentication

All endpoints require an authenticated session (`IsAuthenticated`).

---

## 1) Upload PDF

### Request

`POST /api/dms/documents/`

Content-Type: `multipart/form-data`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `file` | file | ✅ | PDF file to store. |
| `title` | string | ❌ | Optional title override. |
| `metadata` | JSON | ❌ | Custom metadata to merge into extracted metadata. |
| `extract_metadata` | boolean | ❌ | Defaults to `true`. |
| `extract_text` | boolean | ❌ | Defaults to `true`. |

### Response (201)

```json
{
  "id": "uuid",
  "title": "Contract",
  "original_filename": "contract.pdf",
  "content_type": "application/pdf",
  "file_size": 123456,
  "metadata": {
    "title": "Contract",
    "author": "Alice",
    "page_count": 2,
    "raw_metadata": {
      "/Title": "Contract",
      "/Author": "Alice"
    },
    "custom_key": "custom_value"
  },
  "metadata_index": "alice contract custom_value",
  "extracted_text": "First page text…",
  "created_by": 3,
  "created_at": "2026-02-07T12:34:56Z",
  "updated_at": "2026-02-07T12:34:56Z",
  "pdf_base64": null
}
```

---

## 1a) Preflight Upload (Extract Metadata Only)

Use this to upload a PDF, extract metadata + text, and **return results without saving**. This lets the UI collect missing fields before calling the real upload endpoint.

### Request

`POST /api/dms/documents/preflight/`

Content-Type: `multipart/form-data`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `file` | file | ✅ | PDF file to inspect. |
| `title` | string | ❌ | Optional title override. |
| `metadata` | JSON | ❌ | Custom metadata to merge into extracted metadata. |
| `extract_metadata` | boolean | ❌ | Defaults to `true`. |
| `extract_text` | boolean | ❌ | Defaults to `true`. |

### Response (200)

```json
{
  "title": "Contract",
  "original_filename": "contract.pdf",
  "content_type": "application/pdf",
  "file_size": 123456,
  "metadata": {
    "title": "Contract",
    "author": "Alice",
    "page_count": 2,
    "raw_metadata": {
      "/Title": "Contract",
      "/Author": "Alice"
    }
  },
  "extracted_pdf_title": "Contract",
  "extracted_pdf_author": "Alice",
  "extracted_pdf_subject": "",
  "extracted_pdf_creator": "",
  "extracted_pdf_producer": "pypdf",
  "extracted_pdf_keywords": "",
  "extracted_pdf_page_count": 2,
  "extracted_pdf_raw_metadata": "{\"/Title\": \"Contract\", \"/Author\": \"Alice\"}",
  "extracted_text": "First page text…"
}
```

After the user fills required fields, call **Upload PDF** to persist the document.

### Final Upload Metadata Shape

Store extracted PDF metadata in dedicated fields to keep it separate from user-entered fields:

```json
{
  "extracted_pdf_title": "Contract",
  "extracted_pdf_author": "Alice",
  "extracted_pdf_subject": "",
  "extracted_pdf_creator": "",
  "extracted_pdf_producer": "pypdf",
  "extracted_pdf_keywords": "",
  "extracted_pdf_page_count": 2,
  "extracted_pdf_raw_metadata": "{\"/Title\": \"Contract\", \"/Author\": \"Alice\"}",
  "document_id": "string",
  "document_name": "string",
  "document_type": "contract | policy | agreement | certificate | other",
  "category": "string",
  "status": "active | expired | terminated | archived",
  "dates": {
    "uploaded_date": "YYYY-MM-DD",
    "signed_date": "YYYY-MM-DD",
    "effective_date": "YYYY-MM-DD",
    "expiration_date": "YYYY-MM-DD",
    "termination_date": "YYYY-MM-DD",
    "archived_date": "YYYY-MM-DD"
  },
  "signing": {
    "is_signed": true,
    "signature_type": "wet | digital | esign",
    "signatories": [
      {
        "name": "string",
        "role": "string",
        "organization": "string"
      }
    ]
  },
  "compliance": {
    "jurisdiction": "string",
    "retention_end_date": "YYYY-MM-DD",
    "legal_hold": false
  },
  "notes": "string"
}
```

---

## 2) Search Documents

### Request

`POST /api/dms/documents/search/`

Content-Type: `application/json`

```json
{
  "query": "contract",
  "metadata_filters": {
    "author": "Alice",
    "custom_key": "custom_value"
  },
  "include_text": false
}
```

### Efficient Search (Search Bar)

For a single search bar that matches **both metadata and PDF text**, send:

```json
{
  "query": "termination clause",
  "include_text": true,
  "fuzzy": true,
  "min_similarity": 0.6,
  "max_fuzzy_results": 200
}
```

When `include_text=true`, the backend searches a precomputed `search_index` that combines:
- normalized `metadata_index`
- extracted PDF text (first pages)

**Fuzzy search options**
- `fuzzy`: enable similarity matching (`true`/`false`)
- `min_similarity`: float $0..1$ (default `0.6`)
- `max_fuzzy_results`: max candidates scored (default `200`)

### Response (200)

```json
[
  {
    "id": "uuid",
    "title": "Contract",
    "original_filename": "contract.pdf",
    "content_type": "application/pdf",
    "file_size": 123456,
    "metadata": {
      "title": "Contract",
      "author": "Alice",
      "page_count": 2,
      "raw_metadata": {
        "/Title": "Contract",
        "/Author": "Alice"
      },
      "custom_key": "custom_value"
    },
    "metadata_index": "alice contract custom_value",
    "extracted_text": "First page text…",
    "created_by": 3,
    "created_at": "2026-02-07T12:34:56Z",
    "updated_at": "2026-02-07T12:34:56Z",
    "pdf_base64": null
  }
]
```

**Notes**
- `query` searches `metadata_index` (normalized metadata) and optionally `extracted_text` when `include_text=true`.
- `metadata_filters` performs exact JSON containment matching (supports list values).

---

## 3) Retrieve Document Metadata

### Request

`GET /api/dms/documents/<id>/`

Optional query param: `include_pdf=true` to include base64 of the stored PDF.

### Response (200)

Same as upload response, with `pdf_base64` populated only when `include_pdf=true`.

---

## 4) Download PDF

### Request

`GET /api/dms/documents/<id>/download/`

### Response (200)

Binary PDF response with `Content-Disposition` attachment.

---

## 5) Document Alerts

Alerts report upcoming document milestones based on `effective_date`, `expiration_date`, and `termination_date`.

### Alert Types Covered

- Expiring soon (90/60/30/7 days based on `warning_days`)
- Expired
- Auto-renewal upcoming
- Renewal decision required
- Document renewed
- Termination initiated
- Termination notice period started
- Termination effective today
- Document terminated
- Document archived
- Retention period nearing end
- Eligible for deletion
- Deletion scheduled
- Legal hold applied
- Legal hold released
- Audit log generated
- Compliance review due
- Missing mandatory metadata
- Verification data retention limit reached

### 5a) Alerts for a Single Document

`GET /api/dms/documents/<id>/alerts/`

Query params:
- `warning_days` (optional, default `30`)

**Response (200)**

```json
[
  {
    "document_id": "uuid",
    "alert_type": "expiring",
    "message": "Document expires in 10 day(s)",
    "due_date": "2026-02-18"
  }
]
```

### 5b) Alerts for All Documents

`GET /api/dms/documents/alerts/`

Query params:
- `warning_days` (optional, default `30`)

**Response (200)**

```json
[
  {
    "document_id": "uuid",
    "alert_type": "terminating",
    "message": "Document terminates in 5 day(s)",
    "due_date": "2026-02-13"
  }
]
```

---

## Metadata Fields Extracted

The extractor pulls standard PDF metadata keys plus a `page_count` field:
- `title`
- `author`
- `subject`
- `creator`
- `producer`
- `keywords`
- `page_count`
- `raw_metadata` (all original PDF metadata)

### Fixed Metadata Keys (Recommended for Dropdowns)

Use the following fixed keys when building frontend filters. These are always present in the DMS metadata payload (empty strings when missing):

- `title`
- `author`
- `subject`
- `creator`
- `producer`
- `keywords`
- `page_count`

**Suggested dropdown options**
- **Field**: `author`, `subject`, `keywords`, `creator`, `producer`
- **Operators**: `equals`, `contains`
- **Example filter payload**:

```json
{
  "metadata_filters": {
    "author": "Alice"
  }
}
```

---

## ✅ Complete Metadata Checklist (Frontend Options)

Use this list to build a full “metadata filter” UI. Fields marked **(always present)** are extracted into the DMS payload (empty string when missing). The **custom** fields are optional and come from the `metadata` object supplied on upload.

### Extracted PDF Metadata (always present)
- `title`
- `author`
- `subject`
- `creator`
- `producer`
- `keywords`
- `page_count`
- `raw_metadata` (dictionary of all PDF-native keys)

### Common Custom Metadata (optional)
- `document_type` (e.g., `invoice`, `contract`, `report`)
- `department` (e.g., `legal`, `finance`)
- `client_name`
- `project_name`
- `contract_id`
- `invoice_number`
- `effective_date`
- `expiration_date`
- `status` (e.g., `draft`, `final`, `archived`)
- `tags` (array of strings)

### Suggested Filter UI Options
- **Field selector**: fixed list above
- **Operator**: `equals`, `contains`
- **Value input**: text or dropdown (for known enums like `status`)

### Example Filter Payloads

```json
{
  "metadata_filters": {
    "document_type": "contract",
    "status": "final"
  }
}
```

```json
{
  "metadata_filters": {
    "tags": ["legal", "q1-2026"]
  }
}
```

---

## 📌 Document Model Metadata (Complete List From `documents.models.Document`)

These fields are available in the main `documents` app and are safe to reuse as **fixed metadata options** in DMS if you want a single, consistent filter UI across systems.

### Core Indexed Fields
- `title`
- `author`
- `version`
- `document_type`
- `category`
- `status`
- `reference_number`
- `project_name`
- `governing_law`
- `jurisdiction`
- `effective_date`
- `expiration_date`
- `execution_date`
- `term_length`
- `auto_renewal`
- `renewal_terms`

#### Field Options (from model choices)

- `category` options:
  - `contract` (Contract/Agreement)
  - `policy` (Policy Document)
  - `regulation` (Regulation/Compliance)
  - `legal_brief` (Legal Brief)
  - `terms` (Terms & Conditions)
  - `nda` (Non-Disclosure Agreement)
  - `license` (License Agreement)
  - `other` (Other)

- `status` options:
  - `draft` (Draft)
  - `under_review` (Under Review)
  - `analyzed` (Analyzed)
  - `approved` (Approved)
  - `finalized` (Finalized)

### Parties & Signatories
- `parties` (array)
- `signatories` (array)

### Structured `document_metadata` (nested)
- `dates.effective_date`
- `dates.expiration_date`
- `dates.execution_date`
- `legal.governing_law`
- `legal.jurisdiction`
- `legal.reference_number`
- `financial.contract_value`
- `financial.currency`
- `financial.payment_terms`
- `terms.term_length`
- `terms.auto_renewal`
- `terms.renewal_terms`
- `terms.notice_period`
- `provisions.liability_cap`
- `provisions.indemnification`
- `provisions.insurance`
- `provisions.termination`
- `compliance.regulatory_requirements` (array)
- `compliance.certifications` (array)
- `confidentiality.period`
- `confidentiality.nda_type`
- `dispute_resolution.method`
- `dispute_resolution.location`
- `classification.category`
- `classification.status`
- `classification.tags` (array)

### Custom Metadata
- `custom_metadata` (arbitrary JSON, any keys)

---

## Common Errors

| Status | Meaning | Fix |
| --- | --- | --- |
| 400 | Missing file or invalid payload | Provide a PDF in `file`. |
| 401 | Not authenticated | Login and retry with session cookie. |
| 404 | Document not found | Check the document id. |
