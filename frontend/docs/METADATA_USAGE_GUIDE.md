# Document Metadata System - Usage Guide

## Overview

The document metadata system allows you to define reusable data fields at the document level and reference them throughout your document using `[[field_name]]` placeholders.

## Quick Start

### 1. Create Metadata Fields

**Option A: Using the Metadata Picker (Recommended)**

1. Click in any paragraph
2. Type `[[` to open the metadata picker
3. Type a field name in the search box
4. Click "Save & insert" to create the field and insert the placeholder

**Option B: Using the Metadata Table Editor**

1. Open the document sidebar
2. Navigate to the "Metadata" tab
3. View all existing metadata fields
4. Click "Edit" to modify values
5. See which paragraphs use each field in the "Used In" column

### 2. Use Placeholders in Text

Once a field is created, insert it anywhere in your document:

```
The project [[project_name]] will be completed by [[deadline]].
```

Renders as:
```
The project Apollo Program will be completed by December 31, 2024.
```

### 3. Update Metadata Values

**Global Update**: Changing a metadata value updates ALL paragraphs using that field.

1. Open Metadata Table Editor
2. Find the field you want to update
3. Click "Edit"
4. Change the value
5. Click "Save"
6. ✨ All placeholders across the document update instantly

## Field Usage Tracking

### See Where Fields Are Used

The Metadata Table Editor shows:
- **Field Name**: The placeholder key
- **Value**: Current value
- **Used In**: Number of paragraphs using this field

**Example:**

| Field Name | Value | Used In |
|------------|-------|---------|
| project_name | Apollo Program | 5 paragraphs |
| deadline | 2024-12-31 | 3 paragraphs |
| author | John Doe | Not used |

### Hover Tooltip

Hover over the "Used In" badge to see:
- Section titles
- Paragraph numbers
- Exact locations

## Metadata Picker Features

### Search Existing Fields

Type in the search box to filter fields:
- Search by field name
- Search by value
- Case-insensitive matching

### Create New Fields

1. Type a field name in search (e.g., `budget`)
2. Enter a value in "Field value" input
3. Click "Save & insert"
4. Field is created at document level
5. Placeholder `[[budget]]` inserted at cursor

### Insert Existing Fields

1. Find field in the table
2. Click "Insert" button
3. Placeholder inserted at cursor position

## Best Practices

### Field Naming

✅ **Good:**
- `project_name`
- `client_email`
- `deadline`
- `section_1_title`

❌ **Avoid:**
- Spaces: `project name` → Use `project_name`
- Special chars: `project@name` → Use `project_name`
- Too generic: `date` → Use `submission_date`

### Unique Field Names

Since all metadata is document-wide, field names must be unique:

✅ **Good:**
```
Introduction: The [[intro_date]] marks the beginning.
Conclusion: The [[conclusion_date]] marks the end.
```

❌ **Avoid:**
```
Introduction: The [[date]] marks the beginning.
Conclusion: The [[date]] marks the end.
```
(Both paragraphs would show the same date)

### Organize with Prefixes

For section-specific data, use prefixes:

```
methods_date
methods_author
methods_version

results_date
results_author
results_version
```

## Advanced Usage

### AI-Detected Metadata

When AI reviews a paragraph and detects metadata:
1. Fields are automatically added to document metadata
2. Placeholders are inserted in the paragraph
3. Fields become available document-wide

### Metadata Table Editor Shortcuts

- **Hover + Edit**: Quick edit without clicking
- **Enter**: Save edit
- **Escape**: Cancel edit
- **Usage Count**: Click to see paragraph list (coming soon)

### Bulk Metadata Import

To import multiple fields at once:

1. Open browser console
2. Use the metadata store:

```javascript
const { updateMetadata } = useMetadataStore.getState();

await updateMetadata(documentId, {
  project_name: "Apollo Program",
  deadline: "2024-12-31",
  budget: "$1,000,000",
  status: "Active"
});
```

## Troubleshooting

### Placeholder Not Resolving

**Problem:** Text shows `[[field_name]]` instead of value

**Solutions:**
1. Check field exists in Metadata Table Editor
2. Verify spelling matches exactly
3. Check for extra spaces: `[[ field ]]` vs `[[field]]`

### Field Not Showing in Picker

**Problem:** Created field doesn't appear in picker

**Solutions:**
1. Close and reopen the picker
2. Refresh the document
3. Check browser console for errors

### Usage Count Wrong

**Problem:** "Used In" shows incorrect count

**Solutions:**
1. Refresh the document
2. Check for hidden/deleted paragraphs
3. Verify placeholder syntax is correct: `[[field]]`

## API Reference

### Metadata Store

```javascript
import useMetadataStore from '../store/metadataStore';

const {
  metadata,        // Current document metadata
  loading,         // Loading state
  error,           // Error message
  loadMetadata,    // Load metadata from backend
  updateField,     // Update single field
  updateMetadata,  // Update multiple fields
} = useMetadataStore();
```

### Field Usage Tracker

```javascript
import {
  extractPlaceholderFields,
  buildFieldUsageMap,
  getAllUsedFields,
  getParagraphsUsingField
} from '../utils/metadataFieldUsageTracker';

// Extract fields from text
const fields = extractPlaceholderFields(paragraphContent);
// Returns: ['project_name', 'deadline']

// Build usage map
const usageMap = buildFieldUsageMap(document.sections);
// Returns: { field_name: { count, paragraphs: [...] } }

// Get all fields used in document
const allFields = getAllUsedFields(document.sections);
// Returns: ['project_name', 'deadline', 'author']

// Find paragraphs using specific field
const paragraphs = getParagraphsUsingField('deadline', document.sections);
// Returns: [{ paragraphId, sectionIndex, paragraphIndex, sectionTitle }, ...]
```

### Placeholder Renderer

```javascript
import { applyPlaceholdersToHtml } from '../utils/paragraphAiPlaceholderRenderer';

const html = applyPlaceholdersToHtml(
  'The [[project_name]] is due [[deadline]]',
  { project_name: 'Apollo', deadline: '2024-12-31' }
);
// Returns: HTML with placeholders replaced by values
```

## Examples

### Example 1: Project Proposal

**Metadata:**
```json
{
  "project_name": "Website Redesign",
  "client_name": "Acme Corp",
  "budget": "$50,000",
  "timeline": "3 months",
  "start_date": "2024-01-15",
  "end_date": "2024-04-15"
}
```

**Document:**
```
# Project Proposal

## Overview
This proposal outlines the [[project_name]] project for [[client_name]].

## Timeline
The project will begin on [[start_date]] and complete by [[end_date]], 
spanning approximately [[timeline]].

## Budget
Total estimated budget: [[budget]]
```

**Rendered:**
```
# Project Proposal

## Overview
This proposal outlines the Website Redesign project for Acme Corp.

## Timeline
The project will begin on 2024-01-15 and complete by 2024-04-15, 
spanning approximately 3 months.

## Budget
Total estimated budget: $50,000
```

### Example 2: Research Paper

**Metadata:**
```json
{
  "study_name": "Impact of Sleep on Productivity",
  "sample_size": "500 participants",
  "study_duration": "6 months",
  "primary_researcher": "Dr. Jane Smith",
  "publication_date": "March 2024"
}
```

**Document:**
```
## Methodology
[[study_name]] was conducted over [[study_duration]] with [[sample_size]].

## Results
Our findings from [[study_name]] indicate...

## Author
Lead researcher: [[primary_researcher]]
Publication date: [[publication_date]]
```

### Example 3: Legal Document

**Metadata:**
```json
{
  "party_a": "ABC Corporation",
  "party_b": "XYZ Industries",
  "contract_date": "January 1, 2024",
  "expiration_date": "December 31, 2026",
  "governing_law": "State of California"
}
```

**Document:**
```
This agreement is entered into on [[contract_date]] between 
[[party_a]] ("Party A") and [[party_b]] ("Party B").

The term of this agreement shall commence on [[contract_date]] 
and expire on [[expiration_date]].

This agreement shall be governed by the laws of [[governing_law]].
```

## Tips & Tricks

1. **Use descriptive names**: `submission_deadline` is clearer than `date`
2. **Check usage before deleting**: Use "Used In" column to see impact
3. **Organize with prefixes**: Group related fields (`section1_`, `section2_`)
4. **Test placeholders**: Create field with test value, update to confirm it works
5. **Document your fields**: Keep a list of field names and their purposes

## Related Documentation

- [Backend API Changes](./BACKEND_API_METADATA_CHANGES.md)
- [Migration Summary](./METADATA_SYSTEM_MIGRATION_SUMMARY.md)
- [Original Metadata Specification](./PARAGRAPH_PLACEHOLDER_METADATA_API.md)
