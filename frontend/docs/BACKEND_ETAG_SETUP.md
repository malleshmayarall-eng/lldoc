# Django Backend ETag Configuration

## Problem
The `/api/documents/{id}/complete/` endpoint is not returning ETag headers.

Current response headers:
```
✅ content-type: application/json
✅ date: Mon, 19 Jan 2026 16:12:10 GMT
❌ etag: MISSING
```

## Solution

You need to add ETag support to your Django backend. Here are the required changes:

---

## Step 1: Enable Django ETag Middleware

**File:** `backend/settings.py` (or wherever your Django settings are)

```python
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    
    # ADD THIS LINE - Enable conditional GET support
    'django.middleware.http.ConditionalGetMiddleware',
    
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]
```

**⚠️ IMPORTANT:** Place it **AFTER** `CommonMiddleware` but **BEFORE** authentication middleware.

---

## Step 2: Add ETag Decorator to Views

**Option A: Using `@condition` decorator (Recommended)**

**File:** `backend/documents/views.py` (or your viewset file)

```python
from django.views.decorators.http import condition
from django.utils.http import http_date
from hashlib import md5
import json

def calculate_document_etag(request, pk=None, *args, **kwargs):
    """
    Calculate ETag based on document's last modified time and content
    """
    try:
        from .models import Document
        document = Document.objects.get(pk=pk)
        
        # Create hash from document data
        content = {
            'id': str(document.id),
            'modified_at': document.modified_at.isoformat() if hasattr(document, 'modified_at') else '',
            'title': document.title,
            'version': getattr(document, 'version', 0),
        }
        
        etag_content = json.dumps(content, sort_keys=True)
        etag_hash = md5(etag_content.encode()).hexdigest()
        
        return f'"{etag_hash}"'  # ETags must be quoted
    except:
        return None

def get_document_last_modified(request, pk=None, *args, **kwargs):
    """
    Get last modified time for document
    """
    try:
        from .models import Document
        document = Document.objects.get(pk=pk)
        return document.modified_at if hasattr(document, 'modified_at') else None
    except:
        return None


# Apply to your view/viewset
class DocumentViewSet(viewsets.ModelViewSet):
    
    @condition(etag_func=calculate_document_etag, last_modified_func=get_document_last_modified)
    def retrieve(self, request, pk=None):
        """Get single document - with ETag support"""
        document = self.get_object()
        serializer = self.get_serializer(document)
        return Response(serializer.data)
    
    @condition(etag_func=calculate_document_etag, last_modified_func=get_document_last_modified)
    @action(detail=True, methods=['get'])
    def complete(self, request, pk=None):
        """Get complete document structure - with ETag support"""
        document = self.get_object()
        # ... your existing complete logic
        return Response(complete_data)
    
    @condition(etag_func=calculate_document_etag)
    @action(detail=True, methods=['post'])
    def save_structure(self, request, pk=None):
        """Save document structure - with ETag validation"""
        document = self.get_object()
        
        # Django will automatically check If-Match header
        # and return 412 if ETag doesn't match
        
        # ... your existing save logic
        
        return Response(saved_data)
```

---

**Option B: Manual ETag in Response (Alternative)**

If decorators don't work with your setup:

```python
from django.utils.http import http_date
from hashlib import md5
import json

class DocumentViewSet(viewsets.ModelViewSet):
    
    @action(detail=True, methods=['get'])
    def complete(self, request, pk=None):
        document = self.get_object()
        
        # Calculate ETag
        content = {
            'id': str(document.id),
            'modified_at': document.modified_at.isoformat() if hasattr(document, 'modified_at') else '',
            'title': document.title,
        }
        etag = md5(json.dumps(content, sort_keys=True).encode()).hexdigest()
        
        # Check If-None-Match (client cache)
        client_etag = request.headers.get('If-None-Match', '').strip('"')
        if client_etag == etag:
            return Response(status=304)  # Not Modified
        
        # Get complete data
        complete_data = self.get_complete_structure(document)
        
        # Create response with ETag
        response = Response(complete_data)
        response['ETag'] = f'"{etag}"'
        response['Cache-Control'] = 'private, must-revalidate'
        
        return response
    
    @action(detail=True, methods=['post'])
    def save_structure(self, request, pk=None):
        document = self.get_object()
        
        # Calculate current ETag
        current_content = {
            'id': str(document.id),
            'modified_at': document.modified_at.isoformat() if hasattr(document, 'modified_at') else '',
        }
        current_etag = md5(json.dumps(current_content, sort_keys=True).encode()).hexdigest()
        
        # Check If-Match (prevent conflicts)
        client_etag = request.headers.get('If-Match', '').strip('"')
        if client_etag and client_etag != current_etag:
            return Response(
                {'detail': 'Document has been modified by another user'},
                status=412  # Precondition Failed
            )
        
        # Save logic
        # ... your existing save code ...
        
        # Calculate new ETag after save
        document.refresh_from_db()
        new_content = {
            'id': str(document.id),
            'modified_at': document.modified_at.isoformat() if hasattr(document, 'modified_at') else '',
        }
        new_etag = md5(json.dumps(new_content, sort_keys=True).encode()).hexdigest()
        
        # Return response with new ETag
        response = Response(saved_data)
        response['ETag'] = f'"{new_etag}"'
        
        return response
```

---

## Step 3: Ensure Model Has `modified_at` Field

**File:** `backend/documents/models.py`

```python
from django.db import models

class Document(models.Model):
    # ... existing fields ...
    
    # ADD THESE if not present
    created_at = models.DateTimeField(auto_now_add=True)
    modified_at = models.DateTimeField(auto_now=True)  # Auto-updates on save
    
    # Optional: Version tracking
    version = models.IntegerField(default=1)
    
    def save(self, *args, **kwargs):
        if self.pk:  # If updating existing document
            self.version += 1
        super().save(*args, **kwargs)
```

---

## Step 4: Test Backend

### Test 1: Check ETag in Response

```bash
curl -i http://localhost:8000/api/documents/YOUR-DOC-ID/complete/
```

**Expected Response:**
```
HTTP/1.1 200 OK
Content-Type: application/json
ETag: "a1b2c3d4e5f6"
...
```

### Test 2: Test 304 Not Modified

```bash
# First request - get ETag
ETAG=$(curl -s -i http://localhost:8000/api/documents/YOUR-DOC-ID/complete/ | grep -i etag | cut -d' ' -f2)

# Second request - with If-None-Match
curl -i -H "If-None-Match: $ETAG" http://localhost:8000/api/documents/YOUR-DOC-ID/complete/
```

**Expected Response:**
```
HTTP/1.1 304 Not Modified
ETag: "a1b2c3d4e5f6"
```

### Test 3: Test 412 Conflict

```bash
# Try to save with wrong ETag
curl -i -X POST \
  -H "Content-Type: application/json" \
  -H "If-Match: \"wrong-etag\"" \
  -d '{"title":"Updated"}' \
  http://localhost:8000/api/documents/YOUR-DOC-ID/save-structure/
```

**Expected Response:**
```
HTTP/1.1 412 Precondition Failed
{"detail": "Document has been modified by another user"}
```

---

## Step 5: Verify in Frontend

After backend changes, test in browser:

1. **Open DevTools → Network tab**
2. **Load a document**
3. **Check response headers** - should now see:
   ```
   ETag: "a1b2c3d4e5f6"
   ```

4. **Reload document** - should see:
   ```
   Status: 304 Not Modified
   Request Headers: If-None-Match: "a1b2c3d4e5f6"
   ```

---

## Quick Fix Summary

**Minimum required changes:**

1. ✅ Add `ConditionalGetMiddleware` to `MIDDLEWARE` in `settings.py`
2. ✅ Add `@condition` decorator to `complete()` and `save_structure()` views
3. ✅ Add `modified_at` field to Document model
4. ✅ Restart Django server

---

## Troubleshooting

### Still No ETag Header?

**Check:**
```python
# In Django shell
from documents.models import Document
doc = Document.objects.first()
print(doc.modified_at)  # Should print datetime
```

**Debug view:**
```python
import logging
logger = logging.getLogger(__name__)

@action(detail=True, methods=['get'])
def complete(self, request, pk=None):
    logger.info(f"Request headers: {request.headers}")
    # ... rest of view
    response = Response(data)
    logger.info(f"Response headers: {response}")
    return response
```

### ETag Changes Every Request?

**Problem:** ETag calculation includes volatile data (timestamps, etc.)

**Solution:** Only include stable fields in ETag calculation:
```python
content = {
    'id': str(document.id),
    'title': document.title,
    'sections_count': document.sections.count(),
}
```

### 412 Not Working?

**Check:** If-Match header is being received:
```python
@action(detail=True, methods=['post'])
def save_structure(self, request, pk=None):
    print(f"If-Match header: {request.headers.get('If-Match')}")
    # ... rest of view
```

---

## Resources

- [Django Conditional View Processing](https://docs.djangoproject.com/en/stable/topics/conditional-view-processing/)
- [HTTP ETag Specification](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag)
- [Django Rest Framework Caching](https://www.django-rest-framework.org/api-guide/caching/)

---

## After Backend Setup

Once you see `ETag` header in response:

1. **Frontend will automatically:**
   - ✅ Store ETags from responses
   - ✅ Send If-None-Match on GET (caching)
   - ✅ Send If-Match on POST (conflict prevention)
   - ✅ Handle 304 (use cached data)
   - ✅ Handle 412 (show conflict dialog)

2. **No frontend changes needed** - it's already configured!

---

## Next Steps

1. Add the backend changes above
2. Restart Django server
3. Test in browser DevTools
4. Check for `ETag` header in response
5. Frontend system will activate automatically
