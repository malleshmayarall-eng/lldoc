from __future__ import annotations

from typing import Any, Dict, List

from ..models import DocumentImage, ImageComponent, Section
from ..serializers import PartialImageComponentSerializer
from .base import ChangeHandler


class ImageHandler(ChangeHandler):
    type_name = "image_component"
    change_type_update = "image_updated"
    change_type_create = "image_updated"
    change_type_delete = "image_updated"

    def validate(self, change: Dict[str, Any]) -> List[str]:
        errors: List[str] = []
        op = change.get("op")
        data = change.get("data") or {}
        if op in {"create", "update"} and not isinstance(data, dict):
            errors.append("data must be an object")
        if op == "create" and not data.get("section_id"):
            errors.append("section_id is required for image create")
        return errors

    def _check_stale(self, image_component, change: Dict[str, Any]):
        base_last_modified = self._parse_datetime(change.get("base_last_modified"))
        if base_last_modified and image_component.last_modified:
            if image_component.last_modified > base_last_modified:
                return self._build_conflict(
                    change,
                    "stale",
                    expected_last_modified=base_last_modified.isoformat(),
                    current_last_modified=image_component.last_modified.isoformat(),
                )
        return None

    def update(self, document, change: Dict[str, Any], user):
        image_component = ImageComponent.objects.select_for_update().get(
            id=change["id"],
            section__document=document,
        )
        conflict = self._check_stale(image_component, change)
        if conflict:
            return conflict

        data = change.get("data") or {}
        fields_changed, changes_summary = self._collect_field_changes(image_component, data)

        if "section_id" in data and data.get("section_id"):
            image_component.section = Section.objects.get(id=data.get("section_id"), document=document)
        if "image_reference_id" in data:
            image_reference = (
                DocumentImage.objects.get(id=data.get("image_reference_id"))
                if data.get("image_reference_id")
                else None
            )
            setattr(image_component, "image_reference", image_reference)
        if "caption" in data:
            image_component.caption = data.get("caption")
        if "alt_text" in data:
            image_component.alt_text = data.get("alt_text")
        if "title" in data:
            image_component.title = data.get("title")
        if "figure_number" in data:
            image_component.figure_number = data.get("figure_number")
        if "alignment" in data:
            image_component.alignment = data.get("alignment") or image_component.alignment
        if "size_mode" in data:
            image_component.size_mode = data.get("size_mode") or image_component.size_mode
        if "custom_width_percent" in data:
            image_component.custom_width_percent = data.get("custom_width_percent")
        if "custom_width_pixels" in data:
            image_component.custom_width_pixels = self._safe_int(
                data.get("custom_width_pixels"), image_component.custom_width_pixels
            )
        if "custom_height_pixels" in data:
            image_component.custom_height_pixels = self._safe_int(
                data.get("custom_height_pixels"), image_component.custom_height_pixels
            )
        if "maintain_aspect_ratio" in data:
            aspect_value = self._safe_bool(
                data.get("maintain_aspect_ratio"), image_component.maintain_aspect_ratio
            )
            if aspect_value is not None:
                image_component.maintain_aspect_ratio = aspect_value
        if "component_type" in data:
            image_component.component_type = data.get("component_type") or image_component.component_type
        if "order" in data:
            order_value = self._safe_int(data.get("order"), image_component.order)
            if order_value is not None:
                image_component.order = order_value
        if "show_border" in data:
            show_border = self._safe_bool(
                data.get("show_border"), image_component.show_border
            )
            if show_border is not None:
                image_component.show_border = show_border
        if "link_url" in data:
            image_component.link_url = data.get("link_url")
        if "metadata" in data:
            image_component.custom_metadata = data.get("metadata") or {}

        image_component.modified_by = user
        image_component.edit_count += 1
        image_component.save()

        self._log_change(
            document=document,
            user=user,
            change_type=self.change_type_update,
            description="Image component updated via partial-save",
            fields_changed=fields_changed,
            changes_summary=changes_summary,
            change_summary="Updated image component",
        )

        return self._build_result(image_component, PartialImageComponentSerializer, change)

    def create(self, document, change: Dict[str, Any], user):
        data = change.get("data") or {}
        section = Section.objects.get(id=data.get("section_id"), document=document)
        image_reference = None
        if data.get("image_reference_id"):
            image_reference = DocumentImage.objects.get(id=data.get("image_reference_id"))

        image_component = ImageComponent.objects.create(
            section=section,
            image_reference=image_reference,
            caption=data.get("caption"),
            alt_text=data.get("alt_text"),
            title=data.get("title"),
            figure_number=data.get("figure_number"),
            alignment=data.get("alignment") or "center",
            size_mode=data.get("size_mode") or "medium",
            custom_width_percent=data.get("custom_width_percent"),
            custom_width_pixels=data.get("custom_width_pixels"),
            custom_height_pixels=data.get("custom_height_pixels"),
            maintain_aspect_ratio=data.get("maintain_aspect_ratio", True),
            component_type=data.get("component_type") or "figure",
            order=data.get("order") or 0,
            show_border=data.get("show_border", False),
            link_url=data.get("link_url"),
            custom_metadata=data.get("metadata") or {},
            created_by=user,
            modified_by=user,
            edit_count=1,
        )

        # Mirror the referenced image to Attachment library (best-effort)
        if image_reference and image_reference.image:
            try:
                from attachments.models import Attachment

                org = None
                try:
                    org = user.profile.organization
                except Exception:
                    pass

                Attachment.objects.create(
                    name=image_reference.name or "Unnamed Image",
                    file_kind="image",
                    image_type=image_reference.image_type or "picture",
                    file=image_reference.image,
                    scope=getattr(image_reference, "scope", "user") or "user",
                    uploaded_by=user,
                    organization=getattr(image_reference, "organization", None) or org,
                    team=getattr(image_reference, "team", None),
                    document=document,
                    file_size=image_reference.file_size,
                    mime_type=image_reference.mime_type,
                    width=image_reference.width,
                    height=image_reference.height,
                    tags=image_reference.tags or [],
                )
            except Exception:
                pass  # Non-critical — attachment mirror is best-effort

        self._log_change(
            document=document,
            user=user,
            change_type=self.change_type_create,
            description="Image component created via partial-save",
            fields_changed=["caption"],
            changes_summary={"caption": {"old": None, "new": image_component.caption}},
            change_summary="Created image component",
        )

        return self._build_result(image_component, PartialImageComponentSerializer, change)

    def delete(self, document, change: Dict[str, Any], user):
        image_component = ImageComponent.objects.get(id=change["id"], section__document=document)
        image_id = str(image_component.id)
        image_component.delete()

        self._log_change(
            document=document,
            user=user,
            change_type=self.change_type_delete,
            description="Image component deleted via partial-save",
            change_summary="Deleted image component",
        )

        return self._build_delete(change, image_id)
