"""
Document Metadata Management Views

Provides flexible JSON-based metadata extraction and upload capabilities
for document metadata management. Supports nested structures and custom fields.
"""

from typing import Any, Dict, List
import json
import logging

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Document, ChangeLog
from sharing.permissions import IsOwnerOrSharedWith, get_user_role

logger = logging.getLogger(__name__)


class DocumentMetadataViewSet(viewsets.ViewSet):
    """Document metadata management API."""

    permission_classes = [IsAuthenticated, IsOwnerOrSharedWith]

    def get_document(self, pk):
        document = get_object_or_404(Document, pk=pk)
        self.check_object_permissions(self.request, document)
        return document

    def list(self, request, pk=None):
        """Get all metadata for a document."""
        document = self.get_document(pk)

        fields = request.query_params.get("fields", "").split(",") if request.query_params.get("fields") else None
        include_custom = request.query_params.get("include_custom", "true").lower() == "true"
        include_structured = request.query_params.get("include_structured", "true").lower() == "true"
        output_format = request.query_params.get("format", "nested")

        result = {
            "document_id": str(document.id),
            "document_title": document.title,
            "document_type": getattr(document, "document_type", None),
            "created_at": document.created_at.isoformat() if getattr(document, "created_at", None) else None,
            "created_by": document.created_by.username if getattr(document, "created_by", None) else None,
            "extracted_at": timezone.now().isoformat(),
        }

        if include_structured:
            if fields:
                doc_meta: Dict[str, Any] = {}
                for field in fields:
                    if field.strip():
                        value = document.get_metadata(field.strip())
                        if value is not None:
                            self._set_nested_field(doc_meta, field.strip(), value)
            else:
                doc_meta = document.document_metadata if document.document_metadata else {}

            result["document_metadata"] = doc_meta

        if include_custom:
            if fields:
                custom_meta: Dict[str, Any] = {}
                for field in fields:
                    if field.strip() and document.custom_metadata and field.strip() in document.custom_metadata:
                        custom_meta[field.strip()] = document.custom_metadata[field.strip()]
            else:
                custom_meta = document.custom_metadata if document.custom_metadata else {}

            result["custom_metadata"] = custom_meta

        if output_format == "flat":
            result["metadata_flat"] = self._flatten_dict(
                {**result.get("document_metadata", {}), **result.get("custom_metadata", {})}
            )

        return Response(result, status=status.HTTP_200_OK)

    def get_metadata(self, request, pk=None):
        """Alias for list to support viewset usage."""
        return self.list(request, pk=pk)

    def extract_metadata(self, request, pk=None):
        document = self.get_document(pk)

        fields_param = request.query_params.get("fields", "")
        if not fields_param:
            return Response({"error": "fields parameter is required"}, status=status.HTTP_400_BAD_REQUEST)

        fields = [f.strip() for f in fields_param.split(",") if f.strip()]

        extracted: Dict[str, Any] = {}
        missing: List[str] = []

        for field in fields:
            value = document.get_metadata(field)
            if value is None and field in (document.custom_metadata or {}):
                value = document.custom_metadata[field]

            if value is not None:
                extracted[field] = value
            else:
                missing.append(field)

        return Response(
            {
                "document_id": str(document.id),
                "extracted_fields": extracted,
                "missing_fields": missing,
                "extracted_at": timezone.now().isoformat(),
            },
            status=status.HTTP_200_OK,
        )

    def upload_metadata(self, request, pk=None):
        document = self.get_document(pk)

        user_role = get_user_role(request.user, document)
        if user_role not in ["owner", "editor"]:
            return Response(
                {"error": "You do not have permission to edit this document"},
                status=status.HTTP_403_FORBIDDEN,
            )

        metadata = request.data.get("metadata", {})
        target = request.data.get("target", "auto")
        merge = request.data.get("merge", False)
        create_changelog = request.data.get("create_changelog", True)

        if not metadata:
            return Response({"error": "metadata is required"}, status=status.HTTP_400_BAD_REQUEST)

        old_metadata = {
            "document_metadata": document.document_metadata.copy(),
            "custom_metadata": document.custom_metadata.copy(),
        }

        updated_fields: List[str] = []

        with transaction.atomic():
            if not merge:
                if target in ["document_metadata", "auto"]:
                    document.document_metadata = {}
                if target in ["custom_metadata", "auto"]:
                    document.custom_metadata = {}

            for field_path, value in metadata.items():
                try:
                    if target == "document_metadata" or (target == "auto" and self._is_structured_field(field_path)):
                        document.update_metadata(field_path, value)
                    else:
                        self._set_nested_field(document.custom_metadata, field_path, value)
                        document.save(update_fields=["custom_metadata", "updated_at"])
                    updated_fields.append(field_path)
                except Exception as exc:
                    logger.error("Error updating metadata field %s: %s", field_path, exc)

            if create_changelog and updated_fields:
                ChangeLog.objects.create(
                    document=document,
                    changed_by=request.user,
                    changed_by_username=getattr(request.user, "username", None),
                    change_type="metadata_update",
                    description=f"Updated metadata fields: {', '.join(updated_fields)}",
                    original_content=json.dumps(old_metadata),
                    new_content=json.dumps(
                        {"document_metadata": document.document_metadata, "custom_metadata": document.custom_metadata}
                    ),
                )

        return Response(
            {
                "document_id": str(document.id),
                "updated_fields": updated_fields,
                "updated_at": timezone.now().isoformat(),
            },
            status=status.HTTP_200_OK,
        )

    def bulk_update_metadata(self, request, pk=None):
        document = self.get_document(pk)
        metadata = request.data.get("metadata", {})
        updates = request.data.get("updates")
        target = request.data.get("target", "auto")
        create_changelog = request.data.get("create_changelog", True)

        if not metadata and not updates:
            return Response({"error": "metadata is required"}, status=status.HTTP_400_BAD_REQUEST)

        successful: List[str] = []
        failed: List[Dict[str, Any]] = []

        def apply_update(field, value, effective_target):
            if effective_target == "custom_metadata" or (
                effective_target == "auto" and not self._is_structured_field(field)
            ):
                self._set_nested_field(document.custom_metadata, field, value)
                document.save(update_fields=["custom_metadata", "updated_at"])
            else:
                document.update_metadata(field, value)

        with transaction.atomic():
            if isinstance(metadata, dict) and metadata:
                for field, value in metadata.items():
                    try:
                        apply_update(field, value, target)
                        successful.append(field)
                    except Exception as exc:
                        failed.append({"field": field, "error": str(exc)})

            if isinstance(updates, list):
                for item in updates:
                    try:
                        field = item.get("field")
                        value = item.get("value")
                        item_target = item.get("target", target)
                        if not field:
                            failed.append({"field": None, "error": "field is required"})
                            continue
                        apply_update(field, value, item_target)
                        successful.append(field)
                    except Exception as exc:
                        failed.append({"field": item.get("field"), "error": str(exc)})

            if create_changelog and successful:
                ChangeLog.objects.create(
                    document=document,
                    changed_by=request.user,
                    changed_by_username=getattr(request.user, "username", None),
                    change_type="metadata_bulk_update",
                    description=f"Bulk updated {len(successful)} metadata fields",
                    new_content=json.dumps(
                        {"document_metadata": document.document_metadata, "custom_metadata": document.custom_metadata}
                    ),
                )

        return Response(
            {
                "document_id": str(document.id),
                "updated_fields": successful,
                "failed_fields": failed,
                "updated_at": timezone.now().isoformat(),
            },
            status=status.HTTP_200_OK,
        )

    def merge_metadata(self, request, pk=None):
        document = self.get_document(pk)
        metadata = request.data.get("metadata", {})
        target = request.data.get("target", "both")

        if not metadata:
            return Response({"error": "metadata is required"}, status=status.HTTP_400_BAD_REQUEST)

        merged_fields: List[str] = []

        with transaction.atomic():
            if target in ["document_metadata", "both"]:
                self._deep_merge(document.document_metadata, metadata)
                document.save(update_fields=["document_metadata", "updated_at"])
                merged_fields.extend(self._get_all_keys(metadata))

            if target in ["custom_metadata", "both"]:
                self._deep_merge(document.custom_metadata, metadata)
                document.save(update_fields=["custom_metadata", "updated_at"])
                merged_fields.extend(self._get_all_keys(metadata))

            ChangeLog.objects.create(
                document=document,
                changed_by=request.user,
                changed_by_username=getattr(request.user, "username", None),
                change_type="metadata_merge",
                description=f"Merged metadata into {target}",
                new_content=json.dumps(
                    {"document_metadata": document.document_metadata, "custom_metadata": document.custom_metadata}
                ),
            )

        return Response(
            {
                "document_id": str(document.id),
                "merged_fields": merged_fields,
                "updated_at": timezone.now().isoformat(),
            },
            status=status.HTTP_200_OK,
        )

    def remove_metadata(self, request, pk=None):
        document = self.get_document(pk)
        fields_param = request.query_params.get("fields", "")
        target = request.query_params.get("target", "both")

        if not fields_param:
            return Response({"error": "fields parameter is required"}, status=status.HTTP_400_BAD_REQUEST)

        fields = [f.strip() for f in fields_param.split(",") if f.strip()]
        removed: List[str] = []

        with transaction.atomic():
            for field in fields:
                if target in ["document_metadata", "both"]:
                    if self._remove_nested_field(document.document_metadata, field):
                        document.save(update_fields=["document_metadata", "updated_at"])
                        removed.append(field)

                if target in ["custom_metadata", "both"]:
                    if self._remove_nested_field(document.custom_metadata, field):
                        document.save(update_fields=["custom_metadata", "updated_at"])
                        removed.append(field)

            if removed:
                ChangeLog.objects.create(
                    document=document,
                    changed_by=request.user,
                    changed_by_username=getattr(request.user, "username", None),
                    change_type="metadata_removal",
                    description=f"Removed metadata fields: {', '.join(removed)}",
                    new_content=json.dumps(
                        {"document_metadata": document.document_metadata, "custom_metadata": document.custom_metadata}
                    ),
                )

        return Response(
            {
                "document_id": str(document.id),
                "removed_fields": removed,
                "updated_at": timezone.now().isoformat(),
            },
            status=status.HTTP_200_OK,
        )

    def get_metadata_schema(self, request, pk=None):
        document = self.get_document(pk)
        return Response(
            {
                "document_id": str(document.id),
                "document_metadata": self._generate_schema(document.document_metadata),
                "custom_metadata": self._generate_schema(document.custom_metadata),
                "generated_at": timezone.now().isoformat(),
            },
            status=status.HTTP_200_OK,
        )

    def get_metadata_history(self, request, pk=None):
        document = self.get_document(pk)
        history = ChangeLog.objects.filter(
            document=document,
            change_type__in=["metadata_update", "metadata_bulk_update", "metadata_merge", "metadata_removal"],
        ).order_by("-created_at")

        return Response(
            {
                "document_id": str(document.id),
                "metadata_history": [
                    {
                        "id": str(item.id),
                        "change_type": item.change_type,
                        "description": item.description,
                        "timestamp": item.changed_at.isoformat() if item.changed_at else None,
                        "user": item.changed_by.username if item.changed_by else None,
                    }
                    for item in history
                ],
            },
            status=status.HTTP_200_OK,
        )

    def _flatten_dict(self, data: Dict[str, Any], parent_key: str = "", sep: str = ".") -> Dict[str, Any]:
        items: Dict[str, Any] = {}
        for key, value in (data or {}).items():
            new_key = f"{parent_key}{sep}{key}" if parent_key else str(key)
            if isinstance(value, dict):
                items.update(self._flatten_dict(value, new_key, sep=sep))
            else:
                items[new_key] = value
        return items

    def _set_nested_field(self, data: Dict[str, Any], field_path: str, value: Any) -> None:
        keys = field_path.split(".")
        current = data
        for key in keys[:-1]:
            if key not in current or not isinstance(current[key], dict):
                current[key] = {}
            current = current[key]
        current[keys[-1]] = value

    def _remove_nested_field(self, data: Dict[str, Any], field_path: str) -> bool:
        keys = field_path.split(".")
        current = data
        for key in keys[:-1]:
            if key not in current or not isinstance(current[key], dict):
                return False
            current = current[key]
        if keys[-1] in current:
            del current[keys[-1]]
            return True
        return False

    def _deep_merge(self, target: Dict[str, Any], source: Dict[str, Any]) -> None:
        for key, value in (source or {}).items():
            if isinstance(value, dict) and isinstance(target.get(key), dict):
                self._deep_merge(target[key], value)
            else:
                target[key] = value

    def _get_all_keys(self, data: Dict[str, Any], parent: str = "") -> List[str]:
        keys: List[str] = []
        for key, value in (data or {}).items():
            current = f"{parent}.{key}" if parent else str(key)
            keys.append(current)
            if isinstance(value, dict):
                keys.extend(self._get_all_keys(value, current))
        return keys

    def _generate_schema(self, data: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(data, dict):
            return {}
        schema: Dict[str, Any] = {}
        for key, value in data.items():
            if isinstance(value, dict):
                schema[key] = self._generate_schema(value)
            else:
                schema[key] = type(value).__name__
        return schema

    def _is_structured_field(self, field_path: str) -> bool:
        structured_roots = {"parties", "dates", "financial", "legal", "terms", "provisions"}
        root = field_path.split(".")[0]
        return root in structured_roots
