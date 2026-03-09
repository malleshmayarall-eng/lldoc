from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from django.utils.dateparse import parse_datetime
from django.core.serializers.json import DjangoJSONEncoder
import json
import uuid

from ..models import ChangeLog


class ChangeHandler:
    type_name: str = ""
    change_type_update: str = "manual_edit"
    change_type_create: str = "manual_edit"
    change_type_delete: str = "manual_edit"

    def validate(self, change: Dict[str, Any]) -> List[str]:
        return []

    def create(self, document, change: Dict[str, Any], user):
        raise NotImplementedError

    def update(self, document, change: Dict[str, Any], user):
        raise NotImplementedError

    def delete(self, document, change: Dict[str, Any], user):
        raise NotImplementedError

    def _get_client_id(self, change: Dict[str, Any]) -> Optional[str]:
        return change.get("client_id")

    def _parse_datetime(self, value):
        if value is None:
            return None
        if hasattr(value, "tzinfo"):
            return value
        return parse_datetime(value)

    def _safe_int(self, value, default=None):
        if value is None:
            return default
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def _safe_float(self, value, default=None):
        if value is None:
            return default
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def _safe_bool(self, value, default=None):
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            lowered = value.strip().lower()
            if lowered in {"true", "1", "yes"}:
                return True
            if lowered in {"false", "0", "no"}:
                return False
        return bool(value)

    def _build_conflict(self, change: Dict[str, Any], reason: str, **extra):
        payload = {
            "type": self.type_name,
            "id": str(change.get("id")) if change.get("id") else None,
            "client_id": self._get_client_id(change),
            "conflict": True,
            "reason": reason,
        }
        payload.update(extra)
        return payload

    def _build_result(self, instance, serializer_class, change: Dict[str, Any]):
        payload = {
            "type": self.type_name,
            "id": str(instance.id),
            "data": serializer_class(instance).data,
        }
        client_id = self._get_client_id(change)
        if client_id:
            payload["client_id"] = client_id
        return payload

    def _build_delete(self, change: Dict[str, Any], instance_id: str):
        payload = {
            "type": self.type_name,
            "id": str(instance_id),
        }
        client_id = self._get_client_id(change)
        if client_id:
            payload["client_id"] = client_id
        return payload

    def _collect_field_changes(self, instance, data: Dict[str, Any]) -> Tuple[List[str], Dict[str, Dict[str, Any]]]:
        fields_changed: List[str] = []
        summary: Dict[str, Dict[str, Any]] = {}
        for field, new_value in data.items():
            if not hasattr(instance, field):
                continue
            old_value = getattr(instance, field)
            if old_value != new_value:
                fields_changed.append(field)
                summary[field] = {
                    "old": self._serialize_change_value(old_value),
                    "new": self._serialize_change_value(new_value),
                }
        return fields_changed, summary

    def _serialize_change_value(self, value):
        if value is None:
            return None
        if isinstance(value, uuid.UUID):
            return str(value)
        if hasattr(value, "pk"):
            return str(getattr(value, "pk"))
        try:
            return json.loads(json.dumps(value, cls=DjangoJSONEncoder))
        except TypeError:
            return str(value)

    def _log_change(self, document, user, change_type: str, description: str,
                    fields_changed: Optional[List[str]] = None,
                    changes_summary: Optional[Dict[str, Dict[str, Any]]] = None,
                    change_summary: Optional[str] = None,
                    target_section=None,
                    target_paragraph=None,
                    impact: str = "minor"):
        ChangeLog.log_change(
            document=document,
            change_type=change_type,
            user=user,
            description=description,
            fields_changed=fields_changed or [],
            changes_summary=changes_summary or {},
            change_summary=change_summary,
            impact=impact,
            target_section=target_section,
            target_paragraph=target_paragraph,
        )
