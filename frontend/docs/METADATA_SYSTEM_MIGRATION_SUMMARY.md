# Document-Only Metadata System - Implementation Summary

## What Changed

### Core Principle
**BEFORE**: Metadata could exist at document, section, and paragraph levels  
**AFTER**: Metadata exists ONLY at document level

### User Flow
1. User types `[[` in any paragraph → metadata picker opens
2. User searches existing fields or creates new one
3. New metadata is saved to **document level** automatically
4. Placeholder `[[field_name]]` is inserted at cursor
5. Changing metadata value **anywhere** updates **all paragraphs** using that field

## Files Modified

### 1. Core Utilities

#### `src/utils/paragraphAiPlaceholderRenderer.js`
- **Changed**: `applyPlaceholdersToHtml(html, documentMetadata)` - now accepts flat document metadata object
- **Removed**: Scope parsing logic (`document.field`, `section.field`, `paragraph.field`)
- **Simplified**: `buildPlaceholderMaps()` now only processes document metadata

#### `src/utils/metadataFieldUsageTracker.js` (NEW)
- **Purpose**: Track which paragraphs use which metadata fields
- **Functions**:
  - `extractPlaceholderFields(content)` - Extract all `[[field_name]]` from text
  - `buildFieldUsageMap(sections)` - Map field names → paragraph locations
  - `getAllUsedFields(sections)` - Get all unique field names in document
  - `getParagraphsUsingField(fieldName, sections)` - Find paragraphs using a specific field

### 2. Components

#### `src/components/SimpleParagraphEditor.jsx`
- **Removed**: `sectionMetadata` prop, `paragraphMetadata` state, `localMetadataOverrides` state
- **Changed**: Only accepts `documentMetadata` prop
- **Changed**: `handleMetadataCreate()` always saves to document via `updateField(documentId, key, value)`
- **Removed**: Paragraph-level metadata merging logic
- **Import Added**: `useMetadataStore` for direct document metadata updates

#### `src/components/MetadataPlaceholderPicker.jsx`
- **Changed**: Prop `metadata` → `documentMetadata`
- **Changed**: Flattens only document metadata (no scope handling)

#### `src/components/MetadataTableEditor.jsx`
- **Added**: `sections` prop to track field usage
- **Added**: "Used In" column showing paragraph count per field
- **Added**: Tooltip showing which paragraphs use each field
- **Import Added**: `buildFieldUsageMap` from field usage tracker

#### `src/components/PagedDocument.jsx`
- **Removed**: `sectionMetadata` computation in `renderParagraph()`
- **Changed**: Only passes `documentMetadata` to `SimpleParagraphEditor`

#### `src/components/TemplateRenderer.jsx`
- **Removed**: `sectionMetadata` computation in `renderParagraph()`
- **Changed**: Only passes `documentMetadata` to `SimpleParagraphEditor`

#### `src/components/DocumentSection.jsx`
- **Removed**: `sectionMetadata` computation
- **Removed**: `mergeMetadataSources` import (no longer needed)
- **Changed**: Only passes `documentMetadata` to `SimpleParagraphEditor`

#### `src/components/DocumentViewer.jsx`
- **Removed**: `sectionMetadata` parameter from `renderParagraphContent()`
- **Changed**: Only passes `documentMetadata` to `ParagraphAiRenderer`

#### `src/components/ParagraphAiRenderer.jsx`
- **Removed**: `sectionMetadata` prop
- **Removed**: Scoped metadata object creation
- **Changed**: Directly uses `documentMetadata` in `applyPlaceholdersToHtml()`

### 3. Documentation

#### `docs/BACKEND_API_METADATA_CHANGES.md` (NEW)
Complete guide for backend developers including:
- API endpoint changes required
- Database migration strategy
- Testing checklist
- Example responses
- Migration path for existing documents

## Migration Impact

### Frontend (Complete ✅)
- All components updated to use document-only metadata
- All placeholder resolution uses document metadata
- All metadata creation saves to document level
- Field usage tracking implemented

### Backend (Required ⚠️)
See `docs/BACKEND_API_METADATA_CHANGES.md` for:
- Remove paragraph `metadata` and `custom_metadata` fields
- Update API to reject paragraph metadata writes
- Migration script to consolidate existing metadata to document level
- Update AI review endpoints to save detected metadata to document

## Key Benefits

### Developer
- ✅ Single source of truth for metadata
- ✅ No complex scope resolution logic
- ✅ Easier to debug and reason about
- ✅ Fewer database queries

### User
- ✅ Change metadata once, updates everywhere
- ✅ See which paragraphs use each field
- ✅ No confusion about metadata scope
- ✅ Consistent behavior across document

### Performance
- ✅ Fewer API calls (no paragraph metadata fetches)
- ✅ Smaller payloads (no duplicate metadata per paragraph)
- ✅ Faster rendering (single metadata object)

## Testing Checklist

### Metadata Picker
- [ ] Typing `[[` opens picker
- [ ] Picker shows only document metadata fields
- [ ] Search filters fields correctly
- [ ] Creating new field saves to document
- [ ] Selecting field inserts placeholder at cursor

### Metadata Updates
- [ ] Changing field value in MetadataTableEditor updates all paragraphs
- [ ] AI-detected metadata saves to document level
- [ ] Creating field in one paragraph makes it available in all paragraphs

### Field Usage Tracking
- [ ] MetadataTableEditor shows correct usage count
- [ ] Hover tooltip shows correct paragraph locations
- [ ] Unused fields show "Not used" label
- [ ] Usage count updates when placeholders added/removed

### Rendering
- [ ] Placeholders resolve from document metadata
- [ ] Editing metadata value updates rendered placeholders immediately
- [ ] Missing metadata fields show `[[field_name]]` fallback
- [ ] No console errors about missing scoped metadata

## Rollback Plan

If issues arise, to rollback:

1. **Revert commits**: All changes are in a single PR/commit range
2. **Restore mergeMetadataSources usage**: Re-add scope merging
3. **Restore paragraph metadata props**: Add back `sectionMetadata`, `paragraphMetadata`
4. **Backend**: Keep paragraph metadata columns intact

## Next Steps

1. ✅ Frontend implementation complete
2. ⏳ Backend API updates (see `BACKEND_API_METADATA_CHANGES.md`)
3. ⏳ Database migration script
4. ⏳ Integration testing
5. ⏳ User acceptance testing
6. ⏳ Production deployment

## Questions?

Contact: Frontend team  
Documentation: `docs/BACKEND_API_METADATA_CHANGES.md`  
Issue tracking: #XXX
