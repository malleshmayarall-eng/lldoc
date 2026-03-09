from __future__ import annotations

from typing import Any, Dict, List

from ..serializers import PartialDocumentSerializer
from .base import ChangeHandler


class DocumentHandler(ChangeHandler):
    type_name = "document"
    change_type_update = "manual_edit"
    change_type_create = "manual_edit"
    change_type_delete = "manual_edit"

    def validate(self, change: Dict[str, Any]) -> List[str]:
        errors: List[str] = []
        data = change.get("data") or {}
        if change.get("op") != "update":
            errors.append("only update is supported for document changes")
        if not isinstance(data, dict):
            errors.append("data must be an object")
        return errors

    def update(self, document, change: Dict[str, Any], user):
        if str(change.get("id")) != str(document.id):
            return self._build_conflict(
                change,
                "mismatched_document",
                expected_document_id=str(document.id),
                received_document_id=str(change.get("id")),
            )

        data = change.get("data") or {}
        fields_changed, changes_summary = self._collect_field_changes(document, data)

        if "title" in data:
            document.title = data.get("title")
        if "status" in data and hasattr(document, "status"):
            document.status = data.get("status")
        if "document_type" in data:
            document.document_type = data.get("document_type")
        if "author" in data:
            document.author = data.get("author")
        if "custom_metadata" in data:
            document.custom_metadata = data.get("custom_metadata") or {}
        if "document_metadata" in data and hasattr(document, "document_metadata"):
            document.document_metadata = data.get("document_metadata") or {}
        if "raw_text" in data:
            document.raw_text = data.get("raw_text") or ""
        if "current_text" in data:
            document.current_text = data.get("current_text") or ""

        if hasattr(document, "last_modified_by"):
            document.last_modified_by = user
        if hasattr(document, "modified_by"):
            document.modified_by = user

        document.save()

        self._log_change(
            document=document,
            user=user,
            change_type=self.change_type_update,
            description="Document updated via partial-save",
            fields_changed=fields_changed,
            changes_summary=changes_summary,
            change_summary="Updated document",
        )

        return self._build_result(document, PartialDocumentSerializer, change)

    def create(self, document, change: Dict[str, Any], user):
        raise NotImplementedError("Document create is not supported via partial-save")

    def delete(self, document, change: Dict[str, Any], user):
        raise NotImplementedError("Document delete is not supported via partial-save")
