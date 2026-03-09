# Metadata API Updates - Change Log

## Summary

Updated frontend metadata service and store to use correct request format with explicit `target` parameter and dot-notation field paths.

## Changes Made

### 1. `src/services/metadataService.js`

#### `uploadMetadata()`
**Before:**
```javascript
target: options.target || 'auto',
merge: options.merge ?? false,
create_changelog: options.createChangelog ?? true
```

**After:**
```javascript
target: options.target || 'document_metadata',  // Changed default from 'auto'
merge: options.merge ?? true,                    // Changed default from false
create_changelog: options.createChangelog ?? false  // Changed default from true
```

**Rationale:**
- `'auto'` is deprecated - backend requires explicit `'document_metadata'` or `'custom_metadata'`
- `merge: true` is safer default to preserve existing fields
- `create_changelog: false` reduces overhead for routine updates

#### `bulkUpdate()`
**Before:**
```javascript
bulkUpdate: async (documentId, updates, createChangelog = true) => {
  const payload = {
    updates,  // Wrong property name
    create_changelog: createChangelog
  };
```

**After:**
```javascript
bulkUpdate: async (documentId, metadata, options = {}) => {
  const payload = {
    metadata,  // Correct property name
    target: options.target || 'document_metadata',
    create_changelog: options.createChangelog ?? false
  };
```

**Rationale:**
- Backend expects `metadata` property, not `updates`
- Added `target` parameter for explicit metadata type
- Changed to options object for consistency

#### `mergeMetadata()`
**Before:**
```javascript
mergeMetadata: async (documentId, metadata, target = 'both') => {
```

**After:**
```javascript
mergeMetadata: async (documentId, metadata, target = 'document_metadata') => {
```

**Rationale:**
- `'both'` is not a valid target for merge operations
- Default to `'document_metadata'` for structured data

#### `updateField()`
**Before:**
```javascript
updateField: async (documentId, fieldPath, value, target = 'auto') => {
```

**After:**
```javascript
updateField: async (documentId, fieldPath, value, target = 'document_metadata') => {
```

**Rationale:**
- Removed deprecated `'auto'` target
- Explicit default to `'document_metadata'`

---

### 2. `src/store/metadataStore.js`

#### `updateField()`
**Before:**
```javascript
updateField: async (documentId, fieldPath, value, target = 'auto') => {
```

**After:**
```javascript
updateField: async (documentId, fieldPath, value, target = 'document_metadata') => {
```

**Added JSDoc:**
```javascript
/**
 * @example
 * updateField(docId, 'dates.invoice_date', '2026-03-18', 'document_metadata');
 * updateField(docId, 'Invoice No', 'INV-2026-001', 'custom_metadata');
 */
```

#### `bulkUpdate()`
**Before:**
```javascript
bulkUpdate: async (documentId, updates, createChangelog = true) => {
  const data = await metadataService.bulkUpdate(documentId, updates, createChangelog);
```

**After:**
```javascript
bulkUpdate: async (documentId, metadata, options = {}) => {
  const data = await metadataService.bulkUpdate(documentId, metadata, options);
```

**Added JSDoc:**
```javascript
/**
 * @example
 * bulkUpdate(docId, {
 *   'dates.invoice_date': '2026-03-18',
 *   'financial.grand_total': 75520
 * }, { target: 'document_metadata', createChangelog: true });
 */
```

---

### 3. `src/components/SimpleParagraphEditor.jsx`

#### `handleMetadataCreate()`
**Before:**
```javascript
await updateField(documentId, key, value, 'auto');
```

**After:**
```javascript
// Determine target based on key format
// Use 'custom_metadata' for user-friendly names (e.g., "Invoice No")
// Use 'document_metadata' for dot-notation paths (e.g., "dates.invoice_date")
const target = key.includes('.') ? 'document_metadata' : 'custom_metadata';
await updateField(documentId, key, value, target);
```

**Rationale:**
- Smart detection: dot-notation → `document_metadata`, plain names → `custom_metadata`
- User-created fields go to appropriate storage

#### `handleApplyAiResponse()`
**Before:**
```javascript
await updateField(documentId, key, value, 'auto');
```

**After:**
```javascript
// AI-detected metadata goes to custom_metadata
await updateField(documentId, key, value, 'custom_metadata');
```

**Rationale:**
- AI-detected fields are user-specific, belong in `custom_metadata`

---

## Request Format Examples

### Structured Metadata (document_metadata)

Use dot notation for structured data:

```javascript
await metadataService.uploadMetadata(documentId, {
  'dates.invoice_date': '2026-03-18',
  'dates.due_date': '2026-03-25',
  'legal.seller_gstin': '27AABCB1234C1Z9',
  'financial.currency': 'INR',
  'financial.subtotal': 64000,
  'financial.total_tax': 11520,
  'financial.grand_total': 75520
}, {
  target: 'document_metadata',
  merge: true,
  createChangelog: true
});
```

**Backend receives:**
```json
{
  "metadata": {
    "dates.invoice_date": "2026-03-18",
    "dates.due_date": "2026-03-25",
    "legal.seller_gstin": "27AABCB1234C1Z9",
    "financial.currency": "INR",
    "financial.subtotal": 64000,
    "financial.total_tax": 11520,
    "financial.grand_total": 75520
  },
  "target": "document_metadata",
  "merge": true,
  "create_changelog": true
}
```

### Custom Metadata (custom_metadata)

Use readable names for custom fields:

```javascript
await metadataService.uploadMetadata(documentId, {
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

**Backend receives:**
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

---

## Migration Guide

### Old Code
```javascript
// ❌ Old way (deprecated)
await updateField(documentId, 'Invoice Details.Invoice No', 'INV-001', 'auto');

await bulkUpdate(documentId, [
  { field: 'invoice_no', value: 'INV-001' },
  { field: 'invoice_date', value: '2026-03-18' }
], true);
```

### New Code
```javascript
// ✅ New way (correct)
await updateField(documentId, 'Invoice No', 'INV-001', 'custom_metadata');

await bulkUpdate(documentId, {
  'dates.invoice_date': '2026-03-18',
  'financial.grand_total': 75520
}, {
  target: 'document_metadata',
  createChangelog: true
});
```

---

## Breaking Changes

### 1. `bulkUpdate()` Signature Change

**Old:**
```javascript
bulkUpdate(documentId: string, updates: Array, createChangelog: boolean)
```

**New:**
```javascript
bulkUpdate(documentId: string, metadata: Object, options: { target, createChangelog })
```

### 2. `target` Parameter No Longer Accepts `'auto'`

Must use explicit targets:
- `'document_metadata'` - For structured data with dot notation
- `'custom_metadata'` - For user-defined fields

### 3. Default Values Changed

| Function | Parameter | Old Default | New Default |
|----------|-----------|-------------|-------------|
| `uploadMetadata` | `target` | `'auto'` | `'document_metadata'` |
| `uploadMetadata` | `merge` | `false` | `true` |
| `uploadMetadata` | `create_changelog` | `true` | `false` |
| `updateField` | `target` | `'auto'` | `'document_metadata'` |
| `mergeMetadata` | `target` | `'both'` | `'document_metadata'` |

---

## Testing Checklist

- [x] `metadataService.uploadMetadata()` sends correct JSON format
- [x] `metadataService.bulkUpdate()` uses `metadata` property
- [x] `metadataService.updateField()` uses explicit target
- [x] `metadataStore.updateField()` passes target correctly
- [x] `SimpleParagraphEditor` auto-detects target based on key format
- [x] AI-detected metadata goes to `custom_metadata`
- [x] No lint errors in updated files

---

## Related Documentation

- [Metadata API Reference](./METADATA_API_REFERENCE.md) - Complete API documentation
- [Backend API Changes](./BACKEND_API_METADATA_CHANGES.md) - Backend migration guide
- [Usage Guide](./METADATA_USAGE_GUIDE.md) - User-facing documentation

---

## Deployment Notes

### Backend Requirements
Ensure backend accepts:
- `target: 'document_metadata'` or `target: 'custom_metadata'`
- Dot-notation field paths: `'dates.invoice_date'`
- `metadata` property (not `updates`) in bulk update requests

### Frontend Testing
```javascript
// Test structured metadata
await updateMetadata(docId, {
  'dates.invoice_date': '2026-03-18',
  'financial.grand_total': 75520
}, { target: 'document_metadata' });

// Test custom metadata
await updateMetadata(docId, {
  'Invoice No': 'INV-2026-001',
  'bank_name': 'Axis Bank'
}, { target: 'custom_metadata' });

// Test auto-detection in SimpleParagraphEditor
// Type [[ → create "Invoice No" → saves to custom_metadata
// Type [[ → create "dates.invoice_date" → saves to document_metadata
```

---

## Questions & Support

For issues or questions:
- Review [Metadata API Reference](./METADATA_API_REFERENCE.md)
- Check browser console for API errors
- Verify backend accepts new request format
