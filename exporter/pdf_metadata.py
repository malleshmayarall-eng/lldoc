from __future__ import annotations

import json
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, Optional

from django.utils import timezone


def _safe_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    return str(value)


def format_pdf_date(value: Optional[datetime]) -> Optional[str]:
    if not value:
        return None
    if hasattr(value, "tzinfo") and value.tzinfo:
        value = value.astimezone(dt_timezone.utc)
    return value.strftime("D:%Y%m%d%H%M%S+00'00'")


def build_search_metadata(document) -> Dict[str, Any]:
    if hasattr(document, "get_search_metadata"):
        try:
            return document.get_search_metadata()
        except Exception:
            return {}
    return {}


def _flatten_dict(data: Dict[str, Any], prefix: str = "") -> Dict[str, Any]:
    flat: Dict[str, Any] = {}
    for key, value in data.items():
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            flat.update(_flatten_dict(value, path))
        else:
            flat[path] = value
    return flat


def _filter_metadata(data: Dict[str, Any], enabled: Dict[str, bool], prefix: str = "") -> Dict[str, Any]:
    if not isinstance(data, dict):
        return data
    filtered: Dict[str, Any] = {}
    for key, value in data.items():
        path = f"{prefix}.{key}" if prefix else key
        if path in enabled and enabled[path] is False:
            continue
        if isinstance(value, dict):
            nested = _filter_metadata(value, enabled, path)
            if nested:
                filtered[key] = nested
        else:
            if enabled.get(path, True):
                filtered[key] = value
    return filtered


def build_custom_metadata_payload(document) -> Dict[str, Any]:
    document_metadata = getattr(document, "document_metadata", {})
    if not isinstance(document_metadata, dict):
        document_metadata = {}
    custom_metadata = getattr(document, "custom_metadata", {})
    if not isinstance(custom_metadata, dict):
        custom_metadata = {}

    # Remove document processing settings from metadata embedded in PDF
    custom_metadata = {key: value for key, value in custom_metadata.items() if key != "processing_settings"}

    enabled_fields: Dict[str, bool] = {}
    processing_settings = custom_metadata.get("processing_settings") if isinstance(custom_metadata, dict) else {}
    if isinstance(processing_settings, dict):
        metadata_fields = processing_settings.get("metadata_fields")
        if isinstance(metadata_fields, dict):
            enabled_fields = metadata_fields.get("enabled") or {}

    filtered_document_metadata = _filter_metadata(document_metadata, enabled_fields)
    filtered_custom_metadata = _filter_metadata(custom_metadata, enabled_fields)
    combined_flat = _flatten_dict({**filtered_document_metadata, **filtered_custom_metadata})

    return {
        "document_id": str(getattr(document, "id", "")),
        "document_metadata": filtered_document_metadata,
        "custom_metadata": filtered_custom_metadata,
        "metadata_flat": combined_flat,
        "search_metadata": build_search_metadata(document),
    }


def build_pdf_info(document) -> Dict[str, str]:
    info: Dict[str, str] = {}
    title = _safe_str(getattr(document, "title", None))
    if title:
        info["title"] = title

    author = getattr(document, "author", None)
    if not author and getattr(document, "created_by", None):
        try:
            author = document.created_by.get_full_name() or document.created_by.username
        except Exception:
            author = None
    author = _safe_str(author)
    if author:
        info["author"] = author

    subject = _safe_str(getattr(document, "document_type", None) or getattr(document, "summary", None))
    if subject:
        info["subject"] = subject

    keywords = getattr(document, "tags", None)
    if isinstance(keywords, (list, tuple)):
        keywords = ", ".join([str(item) for item in keywords if item])
    keywords = _safe_str(keywords)
    if keywords:
        info["keywords"] = keywords

    info["creator"] = "AI Drafter"
    info["producer"] = "AI Drafter"

    created_at = getattr(document, "created_at", None)
    updated_at = getattr(document, "updated_at", None)
    created_str = format_pdf_date(created_at)
    updated_str = format_pdf_date(updated_at or created_at)
    if created_str:
        info["creation_date"] = created_str
    if updated_str:
        info["mod_date"] = updated_str

    info["custom_metadata"] = json.dumps(build_custom_metadata_payload(document), default=str)
    return info


def build_pdf_metadata(document) -> Dict[str, str]:
    info = build_pdf_info(document)
    metadata: Dict[str, str] = {}

    if info.get("title"):
        metadata["/Title"] = info["title"]
    if info.get("author"):
        metadata["/Author"] = info["author"]
    if info.get("subject"):
        metadata["/Subject"] = info["subject"]
    if info.get("keywords"):
        metadata["/Keywords"] = info["keywords"]
    if info.get("creator"):
        metadata["/Creator"] = info["creator"]
    if info.get("producer"):
        metadata["/Producer"] = info["producer"]
    if info.get("creation_date"):
        metadata["/CreationDate"] = info["creation_date"]
    if info.get("mod_date"):
        metadata["/ModDate"] = info["mod_date"]
    if info.get("custom_metadata"):
        metadata["/CustomMetadata"] = info["custom_metadata"]

    return metadata
