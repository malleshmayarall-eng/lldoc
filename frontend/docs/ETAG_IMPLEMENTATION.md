# ETag Implementation Guide

## Overview

This document describes the HTTP ETag implementation for optimistic locking and caching in the Document Drafter application. The ETag system prevents lost updates when multiple users edit the same document simultaneously and improves performance by avoiding unnecessary data transfers.

## Architecture

### Core Components

1. **etagManager.js** - Centralized ETag storage and cache management
2. **etagFetch.js** - ETag-aware fetch wrappers with automatic header handling
3. **documentService.js** - API service layer with ETag integration
4. **documentSaveHelpers.js** - Save operations with ETag support
5. **DocumentDrafterNew.jsx** - UI error handling for conflicts

### How It Works

```
┌─────────────────┐
│  User Action    │
│  (Load/Save)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ etagManager     │◄──── Stores ETags by document ID
│  - getETag()    │      Caches response data for 304
│  - setETag()    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ etagFetch()     │◄──── Adds If-Match/If-None-Match headers
│  - GET: 304?    │      Handles 304 (cached) / 412 (conflict)
│  - POST: 412?   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Django Backend  │◄──── Validates ETag
│  - Returns ETag │      Returns 304 if unchanged
│  - Returns 412  │      Returns 412 if stale
└─────────────────┘
```

## HTTP Status Codes

| Code | Meaning | Handling |
|------|---------|----------|
| 200 OK | Successful request, data returned | Store ETag from response headers |
| 304 Not Modified | Data unchanged since last request | Return cached data (no transfer) |
| 412 Precondition Failed | ETag mismatch (stale data) | Prompt user to refresh |

## Request Headers

### Read Operations (GET)
```http
GET /api/documents/{id}/complete/
If-None-Match: "a1b2c3d4e5f6"
```

If data unchanged, server returns:
```http
HTTP/1.1 304 Not Modified
ETag: "a1b2c3d4e5f6"
```

### Write Operations (POST/PATCH)
```http
POST /api/documents/{id}/save-structure/
If-Match: "a1b2c3d4e5f6"
Content-Type: application/json

{ "title": "Updated", "sections": [...] }
```

If data was modified by another user:
```http
HTTP/1.1 412 Precondition Failed
{ "detail": "Document has been modified" }
```

## Code Examples

### Basic Usage (Automatic)

The ETag system works automatically for most operations:

```javascript
// Reading a document
const document = await documentService.getCompleteDocument(documentId);
// ✅ ETag automatically stored from response headers

// Saving a document
await documentService.updateDocument(documentId, data);
// ✅ If-Match header automatically added
// ✅ 412 error thrown if document was modified
```

### Handling Conflicts

```javascript
try {
  await saveDocumentGoldenPath();
} catch (err) {
  if (err.name === 'StaleDataError') {
    // Document was modified by another user
    const refresh = confirm('Document updated by another user. Refresh?');
    if (refresh) {
      await loadCompleteDocument(); // Get latest version
    }
  }
}
```

### Manual ETag Access

```javascript
import { etagManager } from '../utils/etagManager';

// Get stored ETag for a document
const etag = etagManager.getETag(documentId);

// Clear ETag (force fresh fetch)
etagManager.clearETag(documentId);

// Check if response is stale
if (etagManager.isStaleResponse(error)) {
  // Handle 412 conflict
}
```

## Integration Points

### 1. Read Operations

**documentService.js**
- `getDocument()` - Stores ETag from response
- `getCompleteDocument()` - Stores ETag + caches response
- `fetchCompleteStructure()` - Uses cached ETag

**Behavior:**
- First request: Full data transfer, ETag stored
- Subsequent requests: 304 response (no data transfer) if unchanged

### 2. Write Operations

**documentService.js**
- `updateDocument()` - Adds If-Match header, handles 412

**documentSaveHelpers.js**
- `saveDocumentStructure()` - Adds If-Match to save-structure endpoint

**Behavior:**
- Request includes If-Match with current ETag
- 412 error if document was modified by another user
- Success: New ETag stored from response

### 3. UI Error Handling

**DocumentDrafterNew.jsx**
- `saveDocumentGoldenPath()` - Catches StaleDataError
- Shows user-friendly conflict dialog
- Options: Refresh (lose changes) or Cancel (keep editing)

## File Structure

```
frontend/src/
├── utils/
│   ├── etagManager.js          # ETag storage and cache management
│   ├── etagFetch.js            # Fetch wrappers with ETag handling
│   └── documentSaveHelpers.js  # Save operations with ETags
├── services/
│   └── documentService.js      # API layer with ETag integration
└── pages/
    └── DocumentDrafterNew.jsx  # UI conflict handling
```

## API Methods with ETag Support

### Read Operations (If-None-Match)
- ✅ `documentService.getDocument(id)`
- ✅ `documentService.getCompleteDocument(id)`
- ✅ `documentService.fetchCompleteStructure(id)`

### Write Operations (If-Match)
- ✅ `documentService.updateDocument(id, data)`
- ✅ `saveDocumentStructure(id, document)` (save-structure endpoint)
- ⚠️ Image/Table/File services (use save-structure internally)

## Benefits

### 1. Prevent Lost Updates
- User A and User B load same document (ETag: "v1")
- User A saves → Success (ETag: "v2")
- User B tries to save → 412 error (still has "v1")
- User B must refresh to get latest version

### 2. Bandwidth Optimization
- Repeated GET requests return 304 if unchanged
- No data transfer needed, uses cached response
- Faster load times, reduced server load

### 3. Better User Experience
- Clear conflict messages
- User control over conflict resolution
- Prevents silent data loss

## Testing

### Test Scenario 1: Cache Hit (304)
1. Load document → ETag stored
2. Reload same document → 304 response (cached)
3. Verify: No network data transfer

### Test Scenario 2: Conflict (412)
1. Open document in two browser windows
2. Window A: Make changes, save → Success
3. Window B: Make different changes, save → 412 error
4. Verify: Conflict dialog shown

### Test Scenario 3: Scroll Position
1. Load document, scroll to middle
2. Make changes, save
3. Verify: Scroll position maintained after save

## Troubleshooting

### Issue: 412 on every save
**Cause:** ETag not being updated after successful save
**Fix:** Check that `etagManager.setETag()` is called after response

### Issue: 304 not working
**Cause:** ETag not being sent in If-None-Match header
**Fix:** Verify `etagManager.getETag()` returns valid ETag

### Issue: Cached data stale
**Cause:** Cache not cleared when receiving new data
**Fix:** Call `etagManager.clearETag()` or update cache with new data

## Future Enhancements

1. **Optimistic UI Updates**
   - Apply changes immediately, rollback on 412
   - Better perceived performance

2. **Automatic Retry**
   - Refresh and auto-retry on conflict
   - Merge changes intelligently

3. **Conflict Resolution UI**
   - Show diff between versions
   - Allow user to merge changes manually

4. **WebSocket Integration**
   - Real-time notifications of document updates
   - Proactive conflict prevention

## References

- [Django ETag Documentation](https://docs.djangoproject.com/en/stable/topics/conditional-view-processing/)
- [HTTP ETag Specification (RFC 7232)](https://tools.ietf.org/html/rfc7232)
- [MDN: HTTP Conditional Requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Conditional_requests)
