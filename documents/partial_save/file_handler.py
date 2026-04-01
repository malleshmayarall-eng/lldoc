from __future__ import annotations

from typing import Any, Dict, List

from ..models import DocumentFile, DocumentFileComponent, Section
from ..serializers import PartialFileComponentSerializer
from .base import ChangeHandler


class FileHandler(ChangeHandler):
    type_name = "file_component"
    change_type_update = "manual_edit"
    change_type_create = "attachment_added"
    change_type_delete = "attachment_removed"

    def validate(self, change: Dict[str, Any]) -> List[str]:
        errors: List[str] = []
        op = change.get("op")
        data = change.get("data") or {}
        if op in {"create", "update"} and not isinstance(data, dict):
            errors.append("data must be an object")
        if op == "create":
            if not data.get("section_id"):
                errors.append("section_id is required for file component create")
            if not data.get("file_reference_id"):
                errors.append("file_reference_id is required for file component create")
        return errors

    def _check_stale(self, file_component, change: Dict[str, Any]):
        base_last_modified = self._parse_datetime(change.get("base_last_modified"))
        if base_last_modified and file_component.last_modified:
            if file_component.last_modified > base_last_modified:
                return self._build_conflict(
                    change,
                    "stale",
                    expected_last_modified=base_last_modified.isoformat(),
                    current_last_modified=file_component.last_modified.isoformat(),
                )
        return None

    def update(self, document, change: Dict[str, Any], user):
        file_component = DocumentFileComponent.objects.select_for_update().get(
            id=change["id"],
            section__document=document,
        )
        conflict = self._check_stale(file_component, change)
        if conflict:
            return conflict

        data = change.get("data") or {}
        fields_changed, changes_summary = self._collect_field_changes(file_component, data)

        if "section_id" in data and data.get("section_id"):
            file_component.section = Section.objects.get(id=data.get("section_id"), document=document)
        if "file_reference_id" in data:
            file_reference = (
                DocumentFile.objects.get(id=data.get("file_reference_id"))
                if data.get("file_reference_id")
                else file_component.file_reference
            )
            setattr(file_component, "file_reference", file_reference)
        if "label" in data:
            file_component.label = data.get("label")
        if "description" in data:
            file_component.description = data.get("description")
        if "reference_number" in data:
            file_component.reference_number = data.get("reference_number")
        if "display_mode" in data:
            file_component.display_mode = data.get("display_mode") or file_component.display_mode
        if "alignment" in data:
            file_component.alignment = data.get("alignment") or file_component.alignment
        if "width_percent" in data:
            file_component.width_percent = self._safe_float(
                data.get("width_percent"), file_component.width_percent
            )
        if "height_pixels" in data:
            file_component.height_pixels = self._safe_int(
                data.get("height_pixels"), file_component.height_pixels
            )
        if "margin_top" in data:
            margin_top = self._safe_int(data.get("margin_top"), file_component.margin_top)
            if margin_top is not None:
                file_component.margin_top = margin_top
        if "margin_bottom" in data:
            margin_bottom = self._safe_int(data.get("margin_bottom"), file_component.margin_bottom)
            if margin_bottom is not None:
                file_component.margin_bottom = margin_bottom
        if "page_range" in data:
            file_component.page_range = data.get("page_range")
        if "show_filename" in data:
            show_filename = self._safe_bool(data.get("show_filename"), file_component.show_filename)
            if show_filename is not None:
                file_component.show_filename = show_filename
        if "show_file_size" in data:
            show_file_size = self._safe_bool(data.get("show_file_size"), file_component.show_file_size)
            if show_file_size is not None:
                file_component.show_file_size = show_file_size
        if "show_file_type" in data:
            show_file_type = self._safe_bool(data.get("show_file_type"), file_component.show_file_type)
            if show_file_type is not None:
                file_component.show_file_type = show_file_type
        if "show_download_button" in data:
            show_download = self._safe_bool(
                data.get("show_download_button"), file_component.show_download_button
            )
            if show_download is not None:
                file_component.show_download_button = show_download
        if "show_preview" in data:
            show_preview = self._safe_bool(data.get("show_preview"), file_component.show_preview)
            if show_preview is not None:
                file_component.show_preview = show_preview
        if "open_in_new_tab" in data:
            open_in_new_tab = self._safe_bool(
                data.get("open_in_new_tab"), file_component.open_in_new_tab
            )
            if open_in_new_tab is not None:
                file_component.open_in_new_tab = open_in_new_tab
        if "is_visible" in data:
            is_visible = self._safe_bool(data.get("is_visible"), file_component.is_visible)
            if is_visible is not None:
                file_component.is_visible = is_visible
        if "metadata" in data:
            file_component.custom_metadata = data.get("metadata") or {}
        if "order" in data:
            order_value = self._safe_int(data.get("order"), file_component.order)
            if order_value is not None:
                file_component.order = order_value

        file_component.modified_by = user
        file_component.edit_count += 1
        file_component.save()

        self._log_change(
            document=document,
            user=user,
            change_type=self.change_type_update,
            description="File component updated via partial-save",
            fields_changed=fields_changed,
            changes_summary=changes_summary,
            change_summary="Updated file component",
        )

        return self._build_result(file_component, PartialFileComponentSerializer, change)

    def create(self, document, change: Dict[str, Any], user):
        data = change.get("data") or {}
        section = Section.objects.get(id=data.get("section_id"), document=document)
        file_reference = DocumentFile.objects.get(id=data.get("file_reference_id"))

        file_component = DocumentFileComponent.objects.create(
            section=section,
            file_reference=file_reference,
            label=data.get("label"),
            description=data.get("description"),
            reference_number=data.get("reference_number"),
            display_mode=data.get("display_mode") or "link",
            alignment=data.get("alignment") or "left",
            width_percent=data.get("width_percent"),
            height_pixels=data.get("height_pixels"),
            margin_top=data.get("margin_top", 20),
            margin_bottom=data.get("margin_bottom", 20),
            page_range=data.get("page_range"),
            show_filename=data.get("show_filename", True),
            show_file_size=data.get("show_file_size", True),
            show_file_type=data.get("show_file_type", True),
            show_download_button=data.get("show_download_button", True),
            show_preview=data.get("show_preview", True),
            open_in_new_tab=data.get("open_in_new_tab", True),
            is_visible=data.get("is_visible", True),
            custom_metadata=data.get("metadata") or {},
            order=data.get("order") or 0,
            created_by=user,
            modified_by=user,
            edit_count=1,
        )

        # Mirror the referenced file to Attachment library (best-effort)
        if file_reference and file_reference.file:
            try:
                from attachments.models import Attachment

                org = getattr(file_reference, "organization", None)
                if not org:
                    try:
                        org = user.profile.organization
                    except Exception:
                        pass

                file_kind = "document"
                if file_reference.mime_type and file_reference.mime_type.startswith("image/"):
                    file_kind = "image"

                access_level = getattr(file_reference, "access_level", "user") or "user"
                scope_map = {"user": "user", "team": "team", "organization": "organization"}

                Attachment.objects.create(
                    name=file_reference.name or "Unnamed File",
                    file_kind=file_kind,
                    file=file_reference.file,
                    scope=scope_map.get(access_level, "user"),
                    uploaded_by=user,
                    organization=org,
                    team=getattr(file_reference, "team", None),
                    document=document,
                    file_size=file_reference.file_size,
                    mime_type=file_reference.mime_type,
                    tags=file_reference.tags or [],
                    metadata={"source": "document_file", "document_file_id": str(file_reference.id)},
                )
            except Exception:
                pass  # Non-critical — attachment mirror is best-effort

        self._log_change(
            document=document,
            user=user,
            change_type=self.change_type_create,
            description="File component created via partial-save",
            fields_changed=["label"],
            changes_summary={"label": {"old": None, "new": file_component.label}},
            change_summary="Created file component",
        )

        return self._build_result(file_component, PartialFileComponentSerializer, change)

    def delete(self, document, change: Dict[str, Any], user):
        file_component = DocumentFileComponent.objects.get(
            id=change["id"],
            section__document=document,
        )
        file_id = str(file_component.id)
        file_component.delete()

        self._log_change(
            document=document,
            user=user,
            change_type=self.change_type_delete,
            description="File component deleted via partial-save",
            change_summary="Deleted file component",
        )

        return self._build_delete(change, file_id)
