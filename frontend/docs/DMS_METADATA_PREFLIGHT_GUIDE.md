# DMS Preflight + Metadata Payload Guide

This guide documents the **new metadata schema** and the **two-step upload flow** used by the DMS UI.

## Overview

The DMS upload flow now runs in two steps:

1. **Preflight**: Upload a PDF to extract metadata **without saving**.
2. **Final Upload**: After the user fills required fields, upload the PDF again with **merged metadata**.

This enables a UI flow where missing fields are filled before the document is persisted.

---

## 1) Preflight Upload (Extract Only)

**Endpoint**: `POST /api/dms/documents/preflight/`

**Content-Type**: `multipart/form-data`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `file` | file | ✅ | PDF file to inspect. |
| `title` | string | ❌ | Optional title override. |
| `metadata` | JSON | ❌ | Custom metadata to merge into extracted metadata. |
| `extract_metadata` | boolean | ❌ | Defaults to `true`. |
| `extract_text` | boolean | ❌ | Defaults to `true`. |

**Response (200)**

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
  "extracted_text": "First page text…"
}
```

---

## 2) Final Upload (Save Document)

**Endpoint**: `POST /api/dms/documents/`

Use the standard upload endpoint, but **include the merged metadata** collected from the UI.

### Final metadata payload structure

The UI sends a single metadata object that includes:

- `extracted_pdf`: the raw extracted metadata returned from preflight
- the user-completed metadata form (see schema below)
- any optional custom JSON entered by the user

```json
{
  "extracted_pdf": {
    "title": "Contract",
    "author": "Alice",
    "page_count": 2,
    "raw_metadata": {
      "/Title": "Contract",
      "/Author": "Alice"
    }
  },
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

> The UI stores extracted metadata under `extracted_pdf` to avoid overwriting user-entered fields.

---

## 5) Document Alerts

Alerts report upcoming milestones based on `effective_date`, `expiration_date`, and `termination_date`.

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

---

## Backend Model Fields for Alerts

Add these fields to the DMS document model to support the full alert set:

```python
# dms/models.py
auto_renewal_enabled = models.BooleanField(default=False)
renewal_date = models.DateField(null=True, blank=True)
renewal_decision_required = models.BooleanField(default=False)
renewed_date = models.DateField(null=True, blank=True)
termination_initiated_date = models.DateField(null=True, blank=True)
termination_notice_start_date = models.DateField(null=True, blank=True)
deletion_eligible_date = models.DateField(null=True, blank=True)
deletion_scheduled_date = models.DateField(null=True, blank=True)
compliance_review_due_date = models.DateField(null=True, blank=True)
audit_log_generated_at = models.DateTimeField(null=True, blank=True)
verification_retention_end_date = models.DateField(null=True, blank=True)
```

After adding fields:

```bash
python manage.py makemigrations dms
python manage.py migrate
```
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

## Frontend Mapping (Reference)

The metadata form and preflight flow are implemented in:

- `src/pages/dms/components/DmsUploadPanel.jsx`
- `src/services/dmsService.js` (preflight + upload)

---

## Notes

- If the backend prefers a different nesting (e.g., merging extracted metadata into the same object), update the UI merge logic in `DmsUploadPanel`.
- `metadata` in preflight can be used to pass custom metadata that should be merged into extracted PDF metadata before showing the form.

---

## Backend: Adding Metadata Fields to the DMS Model

When new metadata fields are introduced, add them to the backend model so they are persisted and searchable.

### 1) Update the model

Example (Django): add JSON fields to store structured metadata and extracted values.

```python
# dms/models.py
from django.db import models

class DmsDocument(models.Model):
  # ... existing fields
  metadata = models.JSONField(default=dict, blank=True)
  extracted_pdf = models.JSONField(default=dict, blank=True)
  search_index = models.TextField(default='', blank=True)
```

### 2) Create and run migrations

```bash
python manage.py makemigrations dms
python manage.py migrate
```

### 3) Backfill `search_index`

If you store combined search text in `search_index`, backfill it from `metadata_index` and `extracted_text`:

```python
# dms/migrations/XXXX_backfill_search_index.py
from django.db import migrations

def forwards(apps, schema_editor):
  DmsDocument = apps.get_model('dms', 'DmsDocument')
  for doc in DmsDocument.objects.all().iterator():
    meta = (doc.metadata_index or '').strip()
    text = (doc.extracted_text or '').strip()
    combined = ' '.join([s for s in (meta, text) if s])
    DmsDocument.objects.filter(pk=doc.pk).update(search_index=combined)

class Migration(migrations.Migration):
  dependencies = [
    ('dms', 'XXXX_previous_migration'),
  ]

  operations = [
    migrations.RunPython(forwards, migrations.RunPython.noop),
  ]
```

### 4) Update serializers / API

- Ensure the create/update serializer accepts the new fields.
- When storing preflight metadata, keep it under `metadata.extracted_pdf` or a dedicated model field (recommended).

### 5) Update API docs

Document the new metadata fields and required formats (dates, enums, arrays) in your DMS API guide.
