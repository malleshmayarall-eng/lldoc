from __future__ import annotations

from typing import Any, Dict, List

from django.db import transaction

from ..models import Section
from ..serializers import PartialSectionSerializer
from .base import ChangeHandler


class SectionHandler(ChangeHandler):
    type_name = "section"
    change_type_update = "edit_section"
    change_type_create = "manual_edit"
    change_type_delete = "manual_edit"

    def validate(self, change: Dict[str, Any]) -> List[str]:
        errors: List[str] = []
        op = change.get("op")
        data = change.get("data") or {}
        if op in {"create", "update"} and not isinstance(data, dict):
            errors.append("data must be an object")
        if op == "create":
            if not data.get("title"):
                errors.append("title is required for section create")
        return errors

    def update(self, document, change: Dict[str, Any], user):
        section = Section.objects.select_for_update().get(id=change["id"], document=document)
        base_version = change.get("base_version")
        if base_version is not None and section.version != base_version:
            return self._build_conflict(
                change,
                "stale",
                expected_version=base_version,
                current_version=section.version,
            )

        data = change.get("data") or {}
        fields_changed, changes_summary = self._collect_field_changes(section, data)

        if "title" in data:
            section.title = data.get("title")
        if "section_type" in data:
            section.section_type = data.get("section_type") or section.section_type
        if "order" in data:
            order_value = self._safe_int(data.get("order"), section.order)
            if order_value is not None:
                section.order = order_value
        if "depth_level" in data:
            depth_value = self._safe_int(data.get("depth_level"), section.depth_level)
            if depth_value is not None:
                section.depth_level = depth_value
        if "metadata" in data:
            section.custom_metadata = data.get("metadata") or {}
        if "parent_id" in data:
            parent_id = data.get("parent_id")
            section.parent = Section.objects.get(id=parent_id, document=document) if parent_id else None  # type: ignore[assignment]
        if "content" in data:
            section.edited_text = data.get("content")
            section.has_edits = True
        elif "edited_text" in data:
            section.edited_text = data.get("edited_text")
            section.has_edits = bool(section.edited_text)
        elif "content_text" in data:
            section.content_text = data.get("content_text") or ""

        section.modified_by = user
        section.last_modified_by_username = user.username if user else None
        section.save()

        self._log_change(
            document=document,
            user=user,
            change_type=self.change_type_update,
            description="Section updated via partial-save",
            fields_changed=fields_changed,
            changes_summary=changes_summary,
            change_summary="Updated section",
            target_section=section,
        )

        return self._build_result(section, PartialSectionSerializer, change)

    def create(self, document, change: Dict[str, Any], user):
        data = change.get("data") or {}
        parent = None
        if data.get("parent_id"):
            parent = Section.objects.get(id=data.get("parent_id"), document=document)

        edited_text = data.get("edited_text")
        if data.get("content") is not None:
            edited_text = data.get("content")

        section = Section.objects.create(
            document=document,
            parent=parent,
            title=data.get("title") or "Untitled Section",
            content_text=data.get("content_text") or "",
            edited_text=edited_text,
            has_edits=bool(edited_text),
            section_type=data.get("section_type") or "clause",
            order=data.get("order") or 0,
            depth_level=data.get("depth_level") or 0,
            custom_metadata=data.get("metadata") or {},
            modified_by=user,
            last_modified_by_username=user.username if user else None,
        )

        self._log_change(
            document=document,
            user=user,
            change_type=self.change_type_create,
            description="Section created via partial-save",
            fields_changed=["title"],
            changes_summary={"title": {"old": None, "new": section.title}},
            change_summary="Created section",
            target_section=section,
        )

        return self._build_result(section, PartialSectionSerializer, change)

    def delete(self, document, change: Dict[str, Any], user):
        section = Section.objects.get(id=change["id"], document=document)
        section_id = str(section.id)
        section.delete()

        self._log_change(
            document=document,
            user=user,
            change_type=self.change_type_delete,
            description="Section deleted via partial-save",
            change_summary="Deleted section",
        )

        return self._build_delete(change, section_id)
