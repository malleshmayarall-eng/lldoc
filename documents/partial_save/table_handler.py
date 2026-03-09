from __future__ import annotations

from typing import Any, Dict, List

from ..models import Section, Table
from ..serializers import PartialTableSerializer
from .base import ChangeHandler


class TableHandler(ChangeHandler):
    type_name = "table"
    change_type_update = "manual_edit"
    change_type_create = "manual_edit"
    change_type_delete = "manual_edit"

    def validate(self, change: Dict[str, Any]) -> List[str]:
        errors: List[str] = []
        op = change.get("op")
        data = change.get("data") or {}
        if op in {"create", "update"} and not isinstance(data, dict):
            errors.append("data must be an object")
        if op == "create" and not data.get("section_id"):
            errors.append("section_id is required for table create")
        return errors

    def _check_stale(self, table, change: Dict[str, Any]):
        base_last_modified = self._parse_datetime(change.get("base_last_modified"))
        if base_last_modified and table.last_modified:
            if table.last_modified > base_last_modified:
                return self._build_conflict(
                    change,
                    "stale",
                    expected_last_modified=base_last_modified.isoformat(),
                    current_last_modified=table.last_modified.isoformat(),
                )
        return None

    def update(self, document, change: Dict[str, Any], user):
        table = Table.objects.select_for_update().get(
            id=change["id"],
            section__document=document,
        )
        conflict = self._check_stale(table, change)
        if conflict:
            return conflict

        data = change.get("data") or {}
        fields_changed, changes_summary = self._collect_field_changes(table, data)

        if "section_id" in data and data.get("section_id"):
            table.section = Section.objects.get(id=data.get("section_id"), document=document)
        # Accept both 'title' and 'caption' (frontend may send either)
        if "title" in data:
            table.title = data.get("title")
        elif "caption" in data:
            table.title = data.get("caption")
        if "description" in data:
            table.description = data.get("description")
        if "num_columns" in data:
            num_columns = self._safe_int(data.get("num_columns"), table.num_columns)
            if num_columns is not None:
                table.num_columns = num_columns
        if "num_rows" in data:
            num_rows = self._safe_int(data.get("num_rows"), table.num_rows)
            if num_rows is not None:
                table.num_rows = num_rows
        if "column_headers" in data:
            table.column_headers = data.get("column_headers") or []
        if "table_data" in data:
            table.table_data = data.get("table_data") or []
            table.has_edits = True
            table.edit_count += 1
        if "table_config" in data:
            table.table_config = data.get("table_config") or {}
        if "table_type" in data:
            table.table_type = data.get("table_type") or table.table_type
        if "order" in data:
            order_value = self._safe_int(data.get("order"), table.order)
            if order_value is not None:
                table.order = order_value
        if "metadata" in data:
            table.custom_metadata = data.get("metadata") or {}

        table.modified_by = user
        table.save()

        self._log_change(
            document=document,
            user=user,
            change_type=self.change_type_update,
            description="Table updated via partial-save",
            fields_changed=fields_changed,
            changes_summary=changes_summary,
            change_summary="Updated table",
        )

        return self._build_result(table, PartialTableSerializer, change)

    def create(self, document, change: Dict[str, Any], user):
        data = change.get("data") or {}
        section = Section.objects.get(id=data.get("section_id"), document=document)

        table = Table.objects.create(
            section=section,
            title=data.get("title") or data.get("caption"),
            description=data.get("description"),
            num_columns=data.get("num_columns") or 2,
            num_rows=data.get("num_rows") or 1,
            column_headers=data.get("column_headers") or [],
            table_data=data.get("table_data") or [],
            table_config=data.get("table_config") or {},
            table_type=data.get("table_type") or "data",
            order=data.get("order") or 0,
            custom_metadata=data.get("metadata") or {},
            has_edits=bool(data.get("table_data")),
            modified_by=user,
            edit_count=1 if data.get("table_data") else 0,
        )

        self._log_change(
            document=document,
            user=user,
            change_type=self.change_type_create,
            description="Table created via partial-save",
            fields_changed=["title"],
            changes_summary={"title": {"old": None, "new": table.title}},
            change_summary="Created table",
        )

        return self._build_result(table, PartialTableSerializer, change)

    def delete(self, document, change: Dict[str, Any], user):
        table = Table.objects.get(id=change["id"], section__document=document)
        table_id = str(table.id)
        table.delete()

        self._log_change(
            document=document,
            user=user,
            change_type=self.change_type_delete,
            description="Table deleted via partial-save",
            change_summary="Deleted table",
        )

        return self._build_delete(change, table_id)
