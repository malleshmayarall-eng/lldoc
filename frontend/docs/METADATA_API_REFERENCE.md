# Metadata API Reference

All endpoints are scoped to a document and operate on **document-level metadata** stored in `document_metadata`.

## Base Path

```
/api/documents/{id}/metadata/
```

## Endpoints

### 1. Get All Metadata

**GET** `/api/documents/{id}/metadata/`

Retrieve all metadata for a document.

**Query Parameters:**
- `fields` (optional): Comma-separated list of field paths to extract
- `include_custom` (optional, default `true`): Include custom metadata fields
- `include_structured` (optional, default `true`): Include structured metadata
- `format` (optional): `nested` | `flat` - Response format

**Example Request:**
```http
GET /api/documents/123e4567-e89b-12d3-a456-426614174000/metadata/
GET /api/documents/123e4567-e89b-12d3-a456-426614174000/metadata/?format=flat
GET /api/documents/123e4567-e89b-12d3-a456-426614174000/metadata/?fields=Invoice Details.Invoice No,dates.effective_date
```

**Example Response:**
```json
{
  "document_metadata": {
    "Invoice Details": {
      "Invoice No": "INV-2026-001",
      "Invoice Date": "18 March 2026",
      "Due Date": "25 March 2026"
    },
    "dates": {
      "effective_date": "2026-03-18"
    }
  },
  "custom_metadata": {},
  "extracted_at": "2026-02-01T10:30:00Z"
}
```

---

### 2. Extract Specific Fields

**GET** `/api/documents/{id}/metadata/extract/`

Extract specific metadata fields using dot notation.

**Query Parameters:**
- `fields` (required): Comma-separated list of field paths

**Example Request:**
```http
GET /api/documents/123e4567-e89b-12d3-a456-426614174000/metadata/extract/?fields=Invoice Details.Invoice No,dates.effective_date
```

**Example Response:**
```json
{
  "extracted_fields": {
    "Invoice Details.Invoice No": "INV-2026-001",
    "dates.effective_date": "2026-03-18"
  }
}
```

---

### 3. Upload / Update Metadata

**POST** `/api/documents/{id}/metadata/upload/`

Upload or update document metadata. This is the primary endpoint for creating/updating metadata fields.

**Important:** Set `Content-Type: application/json` header.

**Request Body:**
```json
{
  "metadata": {
    "dates.invoice_date": "2026-03-18",
    "dates.due_date": "2026-03-25",
    "legal.seller_gstin": "27AABCB1234C1Z9",
    "legal.buyer_gstin": "36AAFCG5678D1Z2",
    "financial.currency": "INR",
    "financial.subtotal": 64000,
    "financial.total_tax": 11520,
    "financial.grand_total": 75520,
    "terms.payment_due": "Within 7 days from invoice date"
  },
  "target": "document_metadata",
  "create_changelog": true
}
```

**Body Parameters:**
- `metadata` (required): Object with dot-notation field paths as keys
  - Use dot notation for nested fields: `"dates.invoice_date"`
  - Values can be strings, numbers, booleans, or arrays
- `target` (required): Target storage location
  - `"document_metadata"` - Structured metadata (extracted or system-managed)
  - `"custom_metadata"` - Custom user-defined metadata
  - `"auto"` - Automatically determine target (deprecated)
- `create_changelog` (optional, default `false`): Create changelog entry
- `merge` (optional, default `true`): Merge with existing metadata or replace

**Example: Custom Metadata**

For user-defined fields like payment details:

```json
{
  "metadata": {
    "Invoice No": "INV-2026-001",
    "bank_name": "Axis Bank",
    "account_name": "BrightMart Trading Co.",
    "account_number": "123456789012",
    "ifsc_code": "UTIB0000123",
    "amount_in_words": "Seventy-Five Thousand Five Hundred Twenty Rupees Only."
  },
  "target": "custom_metadata",
  "create_changelog": true
}
```

**Example Response:**
```json
{
  "status": "success",
  "updated_fields": [
    "dates.invoice_date",
    "dates.due_date",
    "legal.seller_gstin",
    "legal.buyer_gstin",
    "financial.currency",
    "financial.subtotal",
    "financial.total_tax",
    "financial.grand_total",
    "terms.payment_due"
  ],
  "document_metadata": {
    "dates": {
      "invoice_date": "2026-03-18",
      "due_date": "2026-03-25"
    },
    "legal": {
      "seller_gstin": "27AABCB1234C1Z9",
      "buyer_gstin": "36AAFCG5678D1Z2"
    },
    "financial": {
      "currency": "INR",
      "subtotal": 64000,
      "total_tax": 11520,
      "grand_total": 75520
    },
    "terms": {
      "payment_due": "Within 7 days from invoice date"
    }
  }
}
```

---

### 4. Bulk Update

**PUT** `/api/documents/{id}/metadata/bulk-update/`

Update multiple metadata fields in a single request. Similar to upload but specifically for bulk operations.

**Request Body:**
```json
{
  "metadata": {
    "dates.invoice_date": "2026-03-18",
    "dates.due_date": "2026-03-25",
    "financial.currency": "INR",
    "financial.subtotal": 64000,
    "financial.total_tax": 11520,
    "financial.grand_total": 75520
  },
  "target": "document_metadata",
  "create_changelog": true
}
```

**Body Parameters:**
- `metadata` (required): Object with dot-notation field paths and values
- `target` (required): `"document_metadata"` or `"custom_metadata"`
- `create_changelog` (optional, default `false`)

**Example Response:**
```json
{
  "status": "success",
  "updated_count": 6,
  "updated_fields": [
    "dates.invoice_date",
    "dates.due_date",
    "financial.currency",
    "financial.subtotal",
    "financial.total_tax",
    "financial.grand_total"
  ]
}
```

---

### 5. Merge Metadata

**PATCH** `/api/documents/{id}/metadata/merge/`

Merge nested metadata structures. Useful for updating specific nested fields without affecting others.

**Request Body:**
```json
{
  "metadata": {
    "Invoice Details": {
      "Invoice Date": "18 March 2026"
    }
  },
  "target": "document_metadata"
}
```

**Body Parameters:**
- `metadata` (required): Nested object to merge
- `target` (optional, default `"document_metadata"`)

**Example Response:**
```json
{
  "status": "success",
  "merged_fields": ["Invoice Details.Invoice Date"],
  "document_metadata": {
    "Invoice Details": {
      "Invoice No": "INV-2026-001",
      "Invoice Date": "18 March 2026",
      "Due Date": "25 March 2026"
    }
  }
}
```

---

### 6. Remove Metadata Fields

**DELETE** `/api/documents/{id}/metadata/remove/`

Remove specific metadata fields from the document.

**Query Parameters:**
- `fields` (required): Comma-separated list of field paths to remove
- `target` (optional, default `"both"`): Where to remove from
  - `"document_metadata"`
  - `"custom_metadata"`
  - `"both"`

**Example Request:**
```http
DELETE /api/documents/123e4567-e89b-12d3-a456-426614174000/metadata/remove/?fields=Invoice Details.Invoice No
DELETE /api/documents/123e4567-e89b-12d3-a456-426614174000/metadata/remove/?fields=Invoice Details.Invoice No,dates.effective_date&target=document_metadata
```

**Example Response:**
```json
{
  "status": "success",
  "removed_fields": ["Invoice Details.Invoice No"],
  "document_metadata": {
    "Invoice Details": {
      "Invoice Date": "18 March 2026",
      "Due Date": "25 March 2026"
    }
  }
}
```

---

### 7. Metadata Schema

**GET** `/api/documents/{id}/metadata/schema/`

Get the metadata schema for the document, including field definitions, types, and validation rules.

**Example Request:**
```http
GET /api/documents/123e4567-e89b-12d3-a456-426614174000/metadata/schema/
```

**Example Response:**
```json
{
  "schema": {
    "Invoice Details": {
      "type": "object",
      "properties": {
        "Invoice No": { "type": "string", "required": true },
        "Invoice Date": { "type": "string", "format": "date" },
        "Due Date": { "type": "string", "format": "date" }
      }
    },
    "dates": {
      "type": "object",
      "properties": {
        "effective_date": { "type": "string", "format": "date" }
      }
    }
  }
}
```

---

### 8. Metadata History

**GET** `/api/documents/{id}/metadata/history/`

Get the change history for document metadata.

**Query Parameters:**
- `limit` (optional): Maximum number of history entries to return
- `field` (optional): Filter history for specific field path

**Example Request:**
```http
GET /api/documents/123e4567-e89b-12d3-a456-426614174000/metadata/history/
GET /api/documents/123e4567-e89b-12d3-a456-426614174000/metadata/history/?field=Invoice Details.Invoice No&limit=10
```

**Example Response:**
```json
{
  "history": [
    {
      "id": "hist-001",
      "timestamp": "2026-02-01T10:30:00Z",
      "user": "user@example.com",
      "action": "update",
      "field": "Invoice Details.Invoice No",
      "old_value": "INV-2026-000",
      "new_value": "INV-2026-001"
    },
    {
      "id": "hist-002",
      "timestamp": "2026-02-01T10:25:00Z",
      "user": "user@example.com",
      "action": "create",
      "field": "Invoice Details.Invoice Date",
      "old_value": null,
      "new_value": "18 March 2026"
    }
  ]
}
```

---

## Placeholder Usage in Content

Metadata fields can be referenced in document content using placeholder syntax: `[[field_name]]`

### Field Name Resolution

When metadata includes nested structures like:

```json
{
  "Invoice Details": {
    "Invoice No": "INV-2026-001",
    "Invoice Date": "18 March 2026"
  }
}
```

The following placeholders will resolve:

- `[[Invoice No]]` → `"INV-2026-001"`
- `[[invoice_no]]` → `"INV-2026-001"` (case-insensitive)
- `[[Invoice Details.Invoice No]]` → `"INV-2026-001"` (full path)

### Normalization Rules

The frontend placeholder renderer normalizes field names:
1. **Case-insensitive**: `[[invoice_no]]` matches `Invoice No`
2. **Underscore/space equivalence**: `invoice_no` matches `Invoice No`
3. **Last segment matching**: `[[Invoice No]]` matches `Invoice Details.Invoice No`
4. **Full path support**: `[[Invoice Details.Invoice No]]` for explicit paths

### Example Document Content

**Metadata:**
```json
{
  "document_metadata": {
    "Invoice Details": {
      "Invoice No": "INV-2026-001",
      "Invoice Date": "18 March 2026",
      "Due Date": "25 March 2026"
    },
    "client": {
      "name": "Acme Corporation",
      "email": "billing@acme.com"
    }
  }
}
```

**Paragraph Content (Raw):**
```
Invoice [[Invoice No]] was issued on [[Invoice Date]] to [[name]].
Payment is due by [[Due Date]]. Please contact [[email]] with questions.
```

**Rendered Output:**
```
Invoice INV-2026-001 was issued on 18 March 2026 to Acme Corporation.
Payment is due by 25 March 2026. Please contact billing@acme.com with questions.
```

---

## Frontend Integration

### Using the Metadata Store

```javascript
import useMetadataStore from '../store/metadataStore';

const {
  metadata,
  loading,
  error,
  loadMetadata,
  updateField,
  updateMetadata,
} = useMetadataStore();

// Load metadata
await loadMetadata(documentId);

// Update single field (document_metadata)
await updateField(documentId, 'dates.invoice_date', '2026-03-18', 'document_metadata');

// Update multiple fields in document_metadata
await updateMetadata(documentId, {
  'dates.invoice_date': '2026-03-18',
  'dates.due_date': '2026-03-25',
  'financial.currency': 'INR',
  'financial.subtotal': 64000,
  'financial.total_tax': 11520,
  'financial.grand_total': 75520
}, {
  target: 'document_metadata',
  merge: true,
  createChangelog: true
});

// Update custom metadata separately
await updateMetadata(documentId, {
  'Invoice No': 'INV-2026-001',
  'bank_name': 'Axis Bank',
  'account_name': 'BrightMart Trading Co.',
  'account_number': '123456789012',
  'ifsc_code': 'UTIB0000123',
  'amount_in_words': 'Seventy-Five Thousand Five Hundred Twenty Rupees Only.'
}, {
  target: 'custom_metadata',
  createChangelog: true
});
```

### Using the Metadata Service

```javascript
import metadataService from '../services/metadataService';

// Get metadata
const response = await metadataService.getMetadata(documentId, {
  fields: ['dates.invoice_date', 'financial.grand_total'],
  format: 'nested'
});

// Upload structured metadata
const result = await metadataService.uploadMetadata(documentId, {
  'dates.invoice_date': '2026-03-18',
  'dates.due_date': '2026-03-25',
  'legal.seller_gstin': '27AABCB1234C1Z9',
  'financial.currency': 'INR',
  'financial.grand_total': 75520
}, {
  target: 'document_metadata',
  merge: true,
  createChangelog: true
});

// Upload custom metadata
const customResult = await metadataService.uploadMetadata(documentId, {
  'Invoice No': 'INV-2026-001',
  'bank_name': 'Axis Bank',
  'amount_in_words': 'Seventy-Five Thousand Five Hundred Twenty Rupees Only.'
}, {
  target: 'custom_metadata',
  createChangelog: true
});

// Extract fields
const extracted = await metadataService.extractFields(documentId, [
  'dates.invoice_date',
  'financial.grand_total',
  'Invoice No'
]);
```

---

## Error Responses

All endpoints may return the following error responses:

### 400 Bad Request
```json
{
  "error": "Invalid metadata format",
  "detail": "Field path 'Invoice Details..Invoice No' contains consecutive dots",
  "code": "INVALID_FIELD_PATH"
}
```

### 404 Not Found
```json
{
  "error": "Document not found",
  "detail": "Document with ID '123e4567-e89b-12d3-a456-426614174000' does not exist",
  "code": "DOCUMENT_NOT_FOUND"
}
```

### 422 Unprocessable Entity
```json
{
  "error": "Validation failed",
  "detail": "Field 'Invoice Details.Invoice No' exceeds maximum length of 255 characters",
  "code": "VALIDATION_ERROR"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "detail": "Failed to update metadata",
  "code": "SERVER_ERROR"
}
```

---

## Best Practices

### 1. Use Dot Notation for Structured Metadata

✅ **Good - Dot notation with lowercase:**
```json
{
  "metadata": {
    "dates.invoice_date": "2026-03-18",
    "dates.due_date": "2026-03-25",
    "financial.currency": "INR",
    "financial.subtotal": 64000
  },
  "target": "document_metadata"
}
```

✅ **Also Good - Custom metadata with readable names:**
```json
{
  "metadata": {
    "Invoice No": "INV-2026-001",
    "bank_name": "Axis Bank",
    "amount_in_words": "Seventy-Five Thousand Five Hundred Twenty Rupees Only."
  },
  "target": "custom_metadata"
}
```

❌ **Avoid - Mixed approaches:**
```json
{
  "metadata": {
    "Invoice Details.Invoice No": "INV-2026-001",
    "invoice_date": "2026-03-18"
  }
}
```

### 2. Separate Structured and Custom Metadata

Send separate requests for `document_metadata` and `custom_metadata`:

```javascript
// First: Structured metadata (dates, financial, legal, etc.)
await updateMetadata(documentId, {
  'dates.invoice_date': '2026-03-18',
  'dates.due_date': '2026-03-25',
  'financial.grand_total': 75520
}, {
  target: 'document_metadata',
  create_changelog: true
});

// Second: Custom metadata (user-defined fields)
await updateMetadata(documentId, {
  'Invoice No': 'INV-2026-001',
  'bank_name': 'Axis Bank',
  'amount_in_words': 'Seventy-Five Thousand Five Hundred Twenty Rupees Only.'
}, {
  target: 'custom_metadata',
  create_changelog: true
});
```

### 3. Merge Instead of Replace

Use `merge: true` to preserve existing fields:

```javascript
await updateMetadata(documentId, {
  'dates.due_date': '2026-03-30'
}, {
  target: 'document_metadata',
  merge: true  // Keeps invoice_date and other existing fields
});
```

### 4. Enable Changelog for Important Changes

```javascript
await updateMetadata(documentId, {
  'financial.grand_total': 75520
}, {
  target: 'document_metadata',
  create_changelog: true  // Track this change in history
});
```

### 5. Use Field Extraction for Performance

Instead of fetching all metadata, extract only what you need:

```javascript
const { extracted_fields } = await metadataService.extractFields(documentId, [
  'dates.invoice_date',
  'financial.grand_total',
  'Invoice No'
]);
```

### 6. Use Appropriate Data Types

Numbers, booleans, and strings are all supported:

```json
{
  "metadata": {
    "financial.subtotal": 64000,         // number
    "financial.grand_total": 75520,      // number
    "dates.invoice_date": "2026-03-18",  // string (date)
    "terms.payment_due": "Within 7 days from invoice date",  // string
    "invoice.is_paid": false             // boolean
  }
}
```

### 7. Handle Errors Gracefully

```javascript
try {
  await updateMetadata(documentId, {
    'dates.invoice_date': '2026-03-18',
    'financial.grand_total': 75520
  }, {
    target: 'document_metadata',
    create_changelog: true
  });
} catch (error) {
  if (error.response?.status === 404) {
    console.error('Document not found');
  } else if (error.response?.status === 422) {
    console.error('Validation error:', error.response.data.detail);
  } else if (error.response?.status === 400) {
    console.error('Invalid request format:', error.response.data.detail);
  } else {
    console.error('Failed to update metadata:', error.message);
  }
}
```

---

## Migration Notes

### Deprecated: Paragraph-Level Metadata

⚠️ **Important:** Paragraph and section-level metadata is no longer supported.

**Old API (Deprecated):**
```http
PUT /api/paragraphs/{id}/
{
  "content": "Updated text",
  "metadata": {
    "field_name": "value"
  }
}
```

**New API:**
```http
POST /api/documents/{id}/metadata/upload/
{
  "metadata": {
    "field_name": "value"
  },
  "target": "document_metadata"
}
```

### Migration Path

1. Extract all paragraph/section metadata
2. Consolidate into document metadata with unique field names
3. Update paragraph content to use `[[field_name]]` placeholders
4. Remove paragraph metadata fields

See `BACKEND_API_METADATA_CHANGES.md` for detailed migration guide.

---

## Related Documentation

- [Backend API Changes](./BACKEND_API_METADATA_CHANGES.md) - Migration guide for backend developers
- [Usage Guide](./METADATA_USAGE_GUIDE.md) - User-facing documentation with examples
- [Migration Summary](./METADATA_SYSTEM_MIGRATION_SUMMARY.md) - Implementation summary

---

## Support

For questions or issues:
- **Frontend**: See `src/store/metadataStore.js` and `src/services/metadataService.js`
- **Backend**: Contact backend team or file an issue
- **Documentation**: See related docs above
