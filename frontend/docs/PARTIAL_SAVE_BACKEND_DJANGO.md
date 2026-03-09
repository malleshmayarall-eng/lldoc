# Django Backend: Partial Save System (Unified Change Envelope)

This document explains how to implement the **partial-save system** on the Django backend. It complements the frontend change-envelope flow and ETag system already in place.

---

## ✅ Overview

**Goal:** One endpoint that accepts a list of mixed changes and applies them with per-item conflict checks.

**Endpoint:**
```
POST /api/documents/{id}/partial-save/
```

**Payload:**
```json
{
  "changes": [
    {
      "type": "paragraph",
      "op": "update",
      "id": "uuid",
      "base_version": 3,
      "data": { "text": "Updated" }
    },
    {
      "type": "table",
      "op": "update",
      "id": "uuid",
      "base_last_modified": "2026-01-19T10:00:00Z",
      "data": { "table_data": [ ... ] }
    }
  ]
}
```

**Response:**
```json
{
  "updated": [
    {"type": "paragraph", "id": "...", "data": { ... }},
    {"type": "table", "id": "...", "data": { ... }}
  ],
  "deleted": [
    {"type": "image_component", "id": "..."}
  ],
  "conflicts": [
    {"type": "table", "id": "...", "reason": "stale"}
  ]
}
```

---

## ✅ Backend Folder Layout

```
backend/
  documents/
    partial_save/
      __init__.py
      base.py
      registry.py
      section_handler.py
      paragraph_handler.py
      table_handler.py
      image_handler.py
      file_handler.py
```

---

## ✅ Base Handler Contract

`documents/partial_save/base.py`
```python
class ChangeHandler:
    type_name = None

    def validate(self, change):
        return None

    def create(self, document, change, user):
        raise NotImplementedError

    def update(self, document, change, user):
        raise NotImplementedError

    def delete(self, document, change, user):
        raise NotImplementedError
```

---

## ✅ Registry

`documents/partial_save/registry.py`
```python
from .section_handler import SectionHandler
from .paragraph_handler import ParagraphHandler
from .table_handler import TableHandler
from .image_handler import ImageHandler
from .file_handler import FileHandler

HANDLERS = {
    SectionHandler.type_name: SectionHandler(),
    ParagraphHandler.type_name: ParagraphHandler(),
    TableHandler.type_name: TableHandler(),
    ImageHandler.type_name: ImageHandler(),
    FileHandler.type_name: FileHandler(),
}
```

---

## ✅ Endpoint View

`documents/views.py`
```python
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework import status
from .partial_save.registry import HANDLERS

class DocumentViewSet(viewsets.ModelViewSet):
    
    @action(detail=True, methods=['post'])
    def partial_save(self, request, pk=None):
        document = self.get_object()
        changes = request.data.get('changes', [])

        updated = []
        deleted = []
        conflicts = []

        for change in changes:
            change_type = change.get('type')
            op = change.get('op')

            handler = HANDLERS.get(change_type)
            if not handler:
                conflicts.append({
                    'type': change_type,
                    'id': change.get('id'),
                    'reason': 'unknown_type'
                })
                continue

            try:
                if op == 'create':
                    result = handler.create(document, change, request.user)
                    updated.append(result)
                elif op == 'update':
                    result = handler.update(document, change, request.user)
                    if result.get('conflict'):
                        conflicts.append(result)
                    else:
                        updated.append(result)
                elif op == 'delete':
                    result = handler.delete(document, change, request.user)
                    deleted.append(result)
                else:
                    conflicts.append({
                        'type': change_type,
                        'id': change.get('id'),
                        'reason': 'invalid_op'
                    })
            except Exception as exc:
                conflicts.append({
                    'type': change_type,
                    'id': change.get('id'),
                    'reason': 'error',
                    'detail': str(exc)
                })

        status_code = status.HTTP_200_OK
        if changes and len(conflicts) == len(changes):
            status_code = status.HTTP_409_CONFLICT

        return Response({
            'updated': updated,
                status_code = status.HTTP_200_OK
                if changes and len(conflicts) == len(changes):
                    status_code = status.HTTP_409_CONFLICT

                response = Response({
                    'updated': updated,
                    'deleted': deleted,
                    'conflicts': conflicts,
                }, status=status_code)
                response['ETag'] = calculate_document_etag(document)
                return response
if change.get('base_version') and section.version != change['base_version']:
    return {
        'type': 'section',
        'id': str(section.id),
        'conflict': True,
        'reason': 'stale',
        'expected_version': change['base_version'],
        'current_version': section.version,
    }
```

### Example: Last-Modified for Components
```python
client_ts = change.get('base_last_modified')
if client_ts and component.modified_at.isoformat() != client_ts:
    return {
        'type': 'table',
        'id': str(component.id),
        'conflict': True,
        'reason': 'stale',
        'expected_last_modified': client_ts,
        'current_last_modified': component.modified_at.isoformat(),
    }
```

---

## ✅ Minimal Example Handler

`documents/partial_save/paragraph_handler.py`
```python
from .base import ChangeHandler
from ..models import Paragraph
from ..serializers import ParagraphSerializer

class ParagraphHandler(ChangeHandler):
    type_name = 'paragraph'

    def update(self, document, change, user):
        paragraph = Paragraph.objects.select_for_update().get(
            id=change['id'],
            section__document=document
        )

        if change.get('base_version') and paragraph.version != change['base_version']:
            return {
                'type': 'paragraph',
                'id': str(paragraph.id),
                'conflict': True,
                'reason': 'stale',
                'expected_version': change['base_version'],
                'current_version': paragraph.version,
            }

        for key, value in change.get('data', {}).items():
            setattr(paragraph, key, value)

        paragraph.modified_by = user
        paragraph.save()

        return {
            'type': 'paragraph',
            'id': str(paragraph.id),
            'data': ParagraphSerializer(paragraph).data
        }
```

---

## ✅ ETag (Document‑Level)

You should keep **ETag support** on all document endpoints including `partial-save`.

On each response:
- return `ETag` header for the **document**
- validate `If-Match` if provided

```python
response = Response(data)
response['ETag'] = calculate_document_etag(document)
```

---

## ✅ Recommended Response Status

| Case | Status |
|------|--------|
| Some updates + some conflicts | **200 OK** |
| All conflicts | **409 Conflict** |
| Invalid payload | **400 Bad Request** |

---

## ✅ Validation Checklist

- `type` is registered in `HANDLERS`
- `op` is in `{create, update, delete}`
- `id` required for update/delete
- `client_id` required for create if id not present

---

## ✅ Testing Recommendations

1. **Single change** (update paragraph)
2. **Mixed changes** (paragraph + image + table)
3. **Stale version conflict**
4. **All conflicts** → 409
5. **Invalid type/op** → 400

---

## ✅ Summary

- Use **one endpoint** (`partial-save`) for all changes
- Keep **handlers modular**
- Use **per-item conflict checks**
- Continue to support `save-structure` + `edit-full`
- Return document-level ETag for safe concurrency
