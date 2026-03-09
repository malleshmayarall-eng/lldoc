# How to Check if ETag System is Working

## Quick Visual Checks

### ✅ Check 1: Network Tab - ETag Header (Easiest)

1. **Open browser DevTools** (F12 or Right-click → Inspect)
2. **Go to Network tab**
3. **Load or refresh a document** in your app
4. **Find the request** to `/api/documents/{id}/complete/` or `/api/documents/{id}/`
5. **Click on it** and check **Response Headers**

**Look for:**
```
ETag: "a1b2c3d4e5f6"
```

**✅ If you see ETag header** → Backend is working!

---

### ✅ Check 2: Network Tab - 304 Not Modified (Caching Test)

1. **Keep DevTools Network tab open**
2. **Load a document** (first time)
   - Should see: Status `200 OK`
   - Response has full data
3. **Reload the SAME document** (second time)
   - Should see: Status `304 Not Modified` 
   - No response body (cached)
   - Much faster!

**Look for:**
```
Status: 304 Not Modified
Request Headers: If-None-Match: "a1b2c3d4e5f6"
Response Headers: ETag: "a1b2c3d4e5f6"
```

**✅ If you see 304** → Caching is working!

---

### ✅ Check 3: Network Tab - If-Match Header (Save Test)

1. **Load a document**
2. **Make a change** (edit any text)
3. **Click Save**
4. **In Network tab**, find the `save-structure` request
5. **Check Request Headers**

**Look for:**
```
If-Match: "a1b2c3d4e5f6"
```

**✅ If you see If-Match header** → Conflict prevention is working!

---

### ✅ Check 4: Conflict Detection (412 Test)

**Manual Test - Requires 2 Browser Windows:**

1. **Open document** in Chrome Window 1
2. **Open SAME document** in Chrome Window 2 (incognito or another browser)
3. **Window 1**: Edit and save → Should succeed ✅
4. **Window 2**: Edit and save → Should show error ⚠️

**Expected Error Message:**
```
Document has been modified by another user.
Please refresh and try again.
```

**In Network tab, you should see:**
```
Status: 412 Precondition Failed
```

**✅ If you see 412 and error message** → Conflict detection is working!

---

## Browser Console Tests

### Method 1: Quick Test (Recommended)

Open browser console and run:

```javascript
// Import the test utility
import { quickTest } from './utils/testEtag';

// Replace with your actual document ID
quickTest('your-document-id-here');
```

**Expected Output:**
```
⚡ Quick ETag Test
✅ ETag exists: "a1b2c3d4e5f6"
System is working!
```

---

### Method 2: Full Test Suite

```javascript
// Import and run all tests
import { runETagTests } from './utils/testEtag';

// Replace with your actual document ID
runETagTests('your-document-id-here');
```

**Expected Output:**
```
🚀 Starting ETag System Tests
════════════════════════════════════════════════════════

🧪 Test 1: ETag Storage
✅ SUCCESS: ETag stored: "a1b2c3d4e5f6"

🧪 Test 2: 304 Caching
✅ SUCCESS: Cache working, response time: 45.23 ms

🧪 Test 3: 412 Conflict Detection
⚠️ MANUAL TEST REQUIRED

🧪 Test 4: If-Match Header
✓ Next save operation will include: If-Match: "a1b2c3d4e5f6"

🧪 Test 5: ETag Manager State
Stored ETags: 1

════════════════════════════════════════════════════════
📊 TEST SUMMARY
════════════════════════════════════════════════════════
Total: 5/5 tests passed

✅ storage: PASS
✅ caching: PASS
⚠️ conflict: MANUAL
✅ ifMatch: PASS
✅ state: PASS
```

---

### Method 3: Individual Tests

```javascript
import { testETag } from './utils/testEtag';

// Test ETag storage
await testETag.storage('doc-id');

// Test caching
await testETag.caching('doc-id');

// Check current state
testETag.state();
```

---

## Debugging Checklist

### ❌ If ETag NOT in Response Headers

**Problem:** Backend not sending ETag

**Check:**
1. Django backend has ETag middleware enabled
2. View returns proper response (not streaming)
3. Backend logs show ETag generation

**Solution:**
```python
# backend/settings.py
MIDDLEWARE = [
    'django.middleware.http.ConditionalGetMiddleware',
    # ... other middleware
]
```

---

### ❌ If 304 NOT Received on Reload

**Problem:** ETag not being sent in request

**Check:**
1. Console errors in browser
2. `etagManager.getETag(docId)` returns value
3. Network tab shows `If-None-Match` header

**Solution:**
```javascript
// In browser console
import { etagManager } from './utils/etagManager';
etagManager.getETag('your-doc-id'); // Should return ETag string
```

---

### ❌ If If-Match NOT in Save Request

**Problem:** Save operation not using ETag

**Check:**
1. `saveDocumentStructure()` using correct API
2. No errors during save
3. ETag exists before save

**Solution:**
```javascript
// Check ETag before save
const etag = etagManager.getETag(documentId);
console.log('ETag before save:', etag); // Should not be null
```

---

### ❌ If 412 NOT Received on Conflict

**Problem:** Backend not validating ETag

**Check:**
1. Backend has ETag validation
2. If-Match header is being sent
3. Document actually was modified

**Django Backend Check:**
```python
# views.py
from django.views.decorators.http import condition

@condition(etag_func=calculate_etag)
def save_structure(request, pk):
    # Will automatically return 412 if If-Match doesn't match
    ...
```

---

## Real-World Testing Scenarios

### Scenario 1: Normal Editing
```
✅ Load document → ETag stored
✅ Edit content → Changes local only
✅ Save → If-Match sent, success
✅ Reload → 304 (cached, fast)
```

### Scenario 2: Concurrent Editing (Conflict)
```
👤 User A: Load doc (ETag: "v1")
👤 User B: Load doc (ETag: "v1")
👤 User A: Save → Success (ETag: "v2")
👤 User B: Save → 412 Error! (has "v1", but current is "v2")
👤 User B: Sees "Document modified" dialog
👤 User B: Clicks "Refresh" → Gets latest (ETag: "v2")
```

### Scenario 3: Offline/Online
```
✅ Load document → ETag stored + cached
📵 Go offline
✅ Reload → 304 from cache (still works!)
🌐 Go online
✅ Reload → 304 or 200 (gets updates if any)
```

---

## Success Indicators

**System is working if:**

✅ ETag header in response  
✅ 304 status on reload (faster load)  
✅ If-Match header on save  
✅ 412 error on concurrent edit  
✅ User sees conflict dialog  
✅ Scroll position maintained after save  

---

## Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| Always 200, never 304 | ETag not sent | Check `etagManager.getETag()` |
| Always 412 on save | Stale ETag | Call `etagManager.clearETag()` |
| No ETag header | Backend issue | Enable Django middleware |
| No conflict detection | Missing If-Match | Check save operation code |

---

## Quick Diagnosis

Run this in browser console:

```javascript
// Check if system is initialized
console.log('ETag Manager:', typeof etagManager);
console.log('Document Service:', typeof documentService);

// Check current document
const docId = 'your-document-id';
console.log('Current ETag:', etagManager?.getETag(docId));
console.log('Cached Data:', etagManager?.getCache(docId) ? 'Yes' : 'No');

// Test storage
import('./utils/testEtag').then(({ quickTest }) => {
  quickTest(docId);
});
```

**Expected:**
```
ETag Manager: object
Document Service: object
Current ETag: "a1b2c3d4e5f6"
Cached Data: Yes
✅ System is working!
```
