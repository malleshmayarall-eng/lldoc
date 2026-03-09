from __future__ import annotations

from typing import Any, Dict, List

from django.utils import timezone

from ..models import Paragraph, ParagraphHistory, Section
from ..serializers import PartialParagraphSerializer
from .base import ChangeHandler


class ParagraphHandler(ChangeHandler):
    type_name = "paragraph"
    change_type_update = "edit_paragraph"
    change_type_create = "manual_edit"
    change_type_delete = "manual_edit"

    def validate(self, change: Dict[str, Any]) -> List[str]:
        errors: List[str] = []
        op = change.get("op")
        data = change.get("data") or {}
        if op in {"create", "update"} and not isinstance(data, dict):
            errors.append("data must be an object")
        if op == "create" and not data.get("section_id") and not data.get("section_client_id"):
            errors.append("section_id or section_client_id is required for paragraph create")
        return errors

    def _check_stale(self, paragraph, change: Dict[str, Any]):
        base_version = change.get("base_version")
        if base_version is not None and hasattr(paragraph, "version"):
            if paragraph.version != base_version:
                return self._build_conflict(
                    change,
                    "stale",
                    expected_version=base_version,
                    current_version=paragraph.version,
                )
        base_last_modified = self._parse_datetime(change.get("base_last_modified"))
        if base_last_modified and paragraph.last_modified:
            if paragraph.last_modified > base_last_modified:
                return self._build_conflict(
                    change,
                    "stale",
                    expected_last_modified=base_last_modified.isoformat(),
                    current_last_modified=paragraph.last_modified.isoformat(),
                )
        return None

    def update(self, document, change: Dict[str, Any], user):
        paragraph = Paragraph.objects.select_for_update().get(
            id=change["id"],
            section__document=document,
        )
        conflict = self._check_stale(paragraph, change)
        if conflict:
            return conflict

        # Capture previous content for history tracking
        previous_content = paragraph.edited_text or paragraph.content_text or ''

        data = change.get("data") or {}
        fields_changed, changes_summary = self._collect_field_changes(paragraph, data)

        if "section_id" in data and data.get("section_id"):
            try:
                paragraph.section = Section.objects.get(id=data.get("section_id"), document=document)
            except Section.DoesNotExist:
                return self._build_conflict(
                    change,
                    "missing_section",
                    missing_section_id=str(data.get("section_id")),
                )
        if "order" in data:
            order_value = self._safe_int(data.get("order"), paragraph.order)
            if order_value is not None:
                paragraph.order = order_value
        if "paragraph_type" in data:
            paragraph.paragraph_type = data.get("paragraph_type") or paragraph.paragraph_type
        if "topic" in data:
            paragraph.topic = data.get("topic") or ""

        if "content" in data:
            paragraph.edited_text = data.get("content")
            paragraph.has_edits = True
            paragraph.edit_count += 1
        elif "edited_text" in data:
            paragraph.edited_text = data.get("edited_text")
            paragraph.has_edits = bool(paragraph.edited_text)
            paragraph.edit_count += 1
        elif "content_text" in data:
            paragraph.content_text = data.get("content_text") or ""

        paragraph.modified_by = user
        paragraph.save()

        # Record paragraph history
        new_content = paragraph.edited_text or paragraph.content_text or ''
        if new_content != previous_content:
            try:
                ParagraphHistory.record(
                    paragraph=paragraph,
                    change_type='edited',
                    user=user,
                    previous_content=previous_content,
                    summary='Paragraph updated via change-envelope partial-save',
                )
            except Exception:
                pass

        self._log_change(
            document=document,
            user=user,
            change_type=self.change_type_update,
            description="Paragraph updated via partial-save",
            fields_changed=fields_changed,
            changes_summary=changes_summary,
            change_summary="Updated paragraph",
            target_paragraph=paragraph,
        )

        return self._build_result(paragraph, PartialParagraphSerializer, change)

    def create(self, document, change: Dict[str, Any], user):
        data = change.get("data") or {}
        try:
            section = Section.objects.get(id=data.get("section_id"), document=document)
        except Section.DoesNotExist:
            return self._build_conflict(
                change,
                "missing_section",
                missing_section_id=str(data.get("section_id")),
            )

        edited_text = data.get("edited_text")
        if data.get("content") is not None:
            edited_text = data.get("content")

        paragraph = Paragraph.objects.create(
            section=section,
            content_text=data.get("content_text") or "",
            edited_text=edited_text,
            has_edits=bool(edited_text),
            order=data.get("order") or 0,
            paragraph_type=data.get("paragraph_type") or "standard",
            topic=data.get("topic") or "",
            modified_by=user,
            edit_count=1 if edited_text else 0,
        )

        # Record paragraph history for creation
        try:
            ParagraphHistory.record(
                paragraph=paragraph,
                change_type='created',
                user=user,
                previous_content='',
                summary='Paragraph created via change-envelope partial-save',
            )
        except Exception:
            pass

        self._log_change(
            document=document,
            user=user,
            change_type=self.change_type_create,
            description="Paragraph created via partial-save",
            fields_changed=["content_text"],
            changes_summary={"content_text": {"old": None, "new": paragraph.content_text}},
            change_summary="Created paragraph",
            target_paragraph=paragraph,
        )

        return self._build_result(paragraph, PartialParagraphSerializer, change)

    def delete(self, document, change: Dict[str, Any], user):
        paragraph = Paragraph.objects.get(id=change["id"], section__document=document)
        paragraph_id = str(paragraph.id)
        # Note: ParagraphHistory uses CASCADE FK, so history records are
        # automatically deleted when the paragraph is removed.
        paragraph.delete()

        self._log_change(
            document=document,
            user=user,
            change_type=self.change_type_delete,
            description="Paragraph deleted via partial-save",
            change_summary="Deleted paragraph",
        )

        return self._build_delete(change, paragraph_id)
