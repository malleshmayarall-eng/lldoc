# Document-Only Metadata System - Backend API Requirements

## Overview
The frontend has been updated to use **document-level metadata only**. Paragraph and section-level metadata storage has been removed. All metadata fields are now stored at the document level and referenced via `[[field_name]]` placeholders throughout paragraphs.

## Key Changes

### 1. Metadata Storage Model
- **Before**: Metadata could be stored at document, section, and paragraph levels
- **After**: Metadata is ONLY stored at document level
- **Impact**: Backend should remove paragraph `metadata` and `custom_metadata` fields from storage/API

### 2. Placeholder Resolution
- All `[[field_name]]` placeholders resolve from document metadata only
- No scoped placeholders (removed `[[document.field]]`, `[[section.field]]`, `[[paragraph.field]]`)
- All field names must be unique across the entire document

### 3. Field Usage Tracking
- Frontend tracks which paragraphs use which metadata fields
- This is computed client-side by scanning paragraph content for `[[field_name]]` patterns
- No backend changes needed for tracking

## Required Backend Changes

### API Endpoints to Update

#### 1. GET `/documents/{id}/metadata/`
**No changes required** - already returns document-level metadata

#### 2. POST/PUT `/documents/{id}/metadata/`
**No changes required** - already updates document-level metadata

#### 3. GET `/paragraphs/{id}/` or `/sections/{id}/paragraphs/`
**Changes required**:
- Remove `metadata` field from paragraph response
- Remove `custom_metadata` field from paragraph response
- Keep only `content` field with embedded `[[field_name]]` placeholders

**Before**:
```json
{
  "id": "para-123",
  "content": "The project deadline is [[deadline]]",
  "metadata": {
    "deadline": "2024-12-31"
  }
}
```

**After**:
```json
{
  "id": "para-123",
  "content": "The project deadline is [[deadline]]"
}
```

#### 4. PUT/PATCH `/paragraphs/{id}/`
**Changes required**:
- Reject `metadata` and `custom_metadata` fields if provided
- Only accept `content` updates
- If AI detects metadata, it should be saved to document level instead

**Before** (accepted):
```json
{
  "content": "Updated text",
  "metadata": {
    "new_field": "value"
  }
}
```

**After** (rejected with error):
```json
{
  "error": "Paragraph-level metadata is no longer supported. Use document metadata instead.",
  "code": "METADATA_SCOPE_DEPRECATED"
}
```

#### 5. AI Review Endpoints
When AI detects metadata fields during paragraph review:
- Save detected fields to **document metadata** instead of paragraph metadata
- Return detected fields in response but don't store at paragraph level

**Example AI Response**:
```json
{
  "processed_text": "The [[project_name]] is due on [[deadline]]",
  "metadata_detected": {
    "project_name": "Project Apollo",
    "deadline": "2024-12-31"
  }
}
```

**Backend should**:
1. Return `metadata_detected` in response
2. Automatically save to `documents/{id}/metadata/` (not paragraph)
3. Frontend will also call document metadata update endpoint

### Database Schema Changes

#### Recommended Migration
```python
# Remove metadata columns from paragraphs table
ALTER TABLE paragraphs DROP COLUMN metadata;
ALTER TABLE paragraphs DROP COLUMN custom_metadata;

# Ensure document metadata can handle large JSON
ALTER TABLE documents MODIFY COLUMN metadata JSON;
ALTER TABLE documents MODIFY COLUMN custom_metadata JSON;

# Add index for metadata queries
CREATE INDEX idx_documents_metadata ON documents((metadata->>'$'));
```

#### Keep Backward Compatibility (Alternative)
If you need backward compatibility:
```python
# Mark paragraph metadata columns as deprecated
# Add validation to reject writes to these fields
# Migration script to move existing paragraph metadata to document level

def migrate_paragraph_metadata_to_document():
    for document in Document.objects.all():
        merged_metadata = {}
        for section in document.sections.all():
            for paragraph in section.paragraphs.all():
                if paragraph.metadata:
                    merged_metadata.update(paragraph.metadata)
                if paragraph.custom_metadata:
                    merged_metadata.update(paragraph.custom_metadata)
        
        # Update document metadata
        if merged_metadata:
            document.metadata = {
                **(document.metadata or {}),
                **merged_metadata
            }
            document.save()
        
        # Clear paragraph metadata
        for section in document.sections.all():
            section.paragraphs.update(metadata=None, custom_metadata=None)
```

## Frontend Implementation Complete

### Updated Components
1. **paragraphAiPlaceholderRenderer.js**
   - Simplified to accept `documentMetadata` only
   - Removed scope parsing and merging logic
   - All placeholders resolve from single flat metadata object

2. **SimpleParagraphEditor.jsx**
   - Removed `sectionMetadata` and `paragraphMetadata` props
   - Only accepts `documentMetadata` prop
   - All new metadata created via `[[` picker goes to document level
   - Uses `useMetadataStore.updateField()` to save to document

3. **MetadataPlaceholderPicker.jsx**
   - Shows only document metadata fields
   - Create button saves directly to document metadata

4. **MetadataTableEditor.jsx**
   - Now accepts `sections` prop to track field usage
   - Shows "Used In" column with paragraph count
   - Hover tooltip shows which paragraphs use each field

5. **PagedDocument.jsx**
   - Removed `sectionMetadata` computation
   - Passes only `documentMetadata` to paragraph editors

6. **metadataFieldUsageTracker.js** (NEW)
   - `extractPlaceholderFields()` - Find all `[[field_name]]` in text
   - `buildFieldUsageMap()` - Map field names to paragraph IDs
   - `getAllUsedFields()` - Get all unique field names in document

### New Utilities
```javascript
import { buildFieldUsageMap } from '../utils/metadataFieldUsageTracker';

const usageMap = buildFieldUsageMap(document.sections);
// Returns:
// {
//   "deadline": {
//     fieldName: "deadline",
//     count: 3,
//     paragraphs: [
//       { paragraphId: "p1", sectionIndex: 0, paragraphIndex: 2, sectionTitle: "Introduction" },
//       { paragraphId: "p2", sectionIndex: 1, paragraphIndex: 0, sectionTitle: "Methodology" }
//     ]
//   }
// }
```

## Testing Checklist

### Backend Tests
- [ ] GET paragraph returns no `metadata` or `custom_metadata` fields
- [ ] PUT paragraph with metadata fields returns error
- [ ] AI detected metadata is saved to document level
- [ ] Document metadata API still works as before
- [ ] Migration script successfully moves old paragraph metadata to document

### Frontend Tests
- [ ] Typing `[[` opens metadata picker
- [ ] Picker shows only document metadata
- [ ] Creating new field via picker saves to document
- [ ] Changing metadata value updates all paragraphs using that field
- [ ] MetadataTableEditor shows usage counts correctly
- [ ] Field usage tooltip shows correct paragraph locations

### Integration Tests
- [ ] Create metadata in one paragraph → available in all paragraphs
- [ ] Edit metadata value → all placeholders update immediately
- [ ] Delete metadata field → placeholders show `[[field_name]]` fallback
- [ ] AI review detects field → saves to document → shows in picker

## Migration Path for Existing Documents

### Phase 1: Data Migration (Backend)
1. Run migration script to consolidate paragraph/section metadata → document
2. Handle conflicts (same field name, different values)
3. Backup old metadata before clearing

### Phase 2: API Deprecation (Backend)
1. Add deprecation warnings to paragraph metadata endpoints
2. Return errors for writes to paragraph metadata
3. Continue reading old metadata for backward compatibility

### Phase 3: Cleanup (Backend + Frontend)
1. Remove paragraph metadata columns from database
2. Remove deprecated API endpoints
3. Update API documentation

## Benefits

### Developer Experience
- ✅ Simpler mental model: one source of truth for metadata
- ✅ Easier debugging: metadata is in one place
- ✅ Faster queries: no need to join paragraph/section metadata

### User Experience
- ✅ Change metadata once, updates everywhere
- ✅ See which paragraphs use each field
- ✅ No confusion about scope (document vs section vs paragraph)
- ✅ Unique field names prevent conflicts

### Performance
- ✅ Fewer database queries (no paragraph metadata joins)
- ✅ Smaller payload sizes (no duplicate metadata per paragraph)
- ✅ Faster rendering (single metadata object to render)

## Questions & Edge Cases

### Q: What if user wants paragraph-specific data?
**A**: Use unique field names like `intro_date`, `method_date`, `conclusion_date` instead of scoped `[[paragraph.date]]`

### Q: What about section-specific metadata?
**A**: Same solution - use unique field names like `section1_title`, `section2_title`

### Q: How to handle metadata conflicts during migration?
**A**: 
1. Prefer document-level values
2. For conflicts, append suffix: `field_name_section1`, `field_name_para3`
3. Log conflicts for manual review

### Q: What if AI detects same field name in multiple paragraphs with different values?
**A**: 
1. First occurrence wins (saves to document)
2. Subsequent occurrences with same key are ignored
3. Log warning for user review

## Contact

For questions about this migration, contact the frontend team or review:
- Frontend PR: #XXX
- Backend issue: #YYY
- Design doc: `docs/METADATA_SYSTEM_REDESIGN.md`
