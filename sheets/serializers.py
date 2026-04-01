"""
Sheets app — serializers.py
"""

from rest_framework import serializers
from .models import Sheet, SheetRow, SheetCell, SheetShareLink, SheetFormSubmission, SheetDashboard, SheetTask


class SheetCellSerializer(serializers.ModelSerializer):
    class Meta:
        model = SheetCell
        fields = [
            'id', 'column_key', 'raw_value', 'computed_value',
            'value_type', 'formula', 'metadata', 'updated_at',
        ]
        read_only_fields = ['id', 'computed_value', 'updated_at']


class SheetRowSerializer(serializers.ModelSerializer):
    cells = SheetCellSerializer(many=True, read_only=True)

    class Meta:
        model = SheetRow
        fields = ['id', 'order', 'metadata', 'workflow_run_id', 'cells', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']


class SheetListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list view."""
    created_by_name = serializers.SerializerMethodField()
    row_count = serializers.IntegerField(read_only=True)
    col_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Sheet
        fields = [
            'id', 'title', 'description', 'row_count', 'col_count',
            'is_archived', 'workflow', 'unique_columns',
            'created_by', 'created_by_name',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at']

    def get_created_by_name(self, obj):
        u = obj.created_by
        return f"{u.first_name} {u.last_name}".strip() or u.username


class SheetDetailSerializer(serializers.ModelSerializer):
    """Full serializer with rows + cells for the editor view.
    Empty rows (no cells or all blank) are excluded from the response."""
    rows = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Sheet
        fields = [
            'id', 'title', 'description', 'columns', 'rows',
            'custom_metadata', 'settings_json', 'workflow',
            'is_archived', 'row_count', 'col_count', 'unique_columns',
            'created_by', 'created_by_name',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at']

    def get_rows(self, obj):
        """Return all rows, including empty ones (no cells yet).
        Previously empty rows were filtered out, which caused newly added rows
        to disappear from the grid before any cell was filled in.
        Ordered descending by order so latest rows appear first."""
        rows_qs = obj.rows.order_by('-order').prefetch_related('cells')
        return SheetRowSerializer(rows_qs, many=True).data

    def get_created_by_name(self, obj):
        u = obj.created_by
        return f"{u.first_name} {u.last_name}".strip() or u.username


class BulkCellUpdateSerializer(serializers.Serializer):
    """
    Payload for bulk cell updates:
    { "cells": [ { "row_order": 0, "column_key": "col_0", "raw_value": "Hello" }, ... ] }
    """
    row_order = serializers.IntegerField()
    column_key = serializers.CharField(max_length=50)
    raw_value = serializers.CharField(allow_blank=True, default='')
    metadata = serializers.JSONField(required=False, default=dict)


class AIGenerateSheetSerializer(serializers.Serializer):
    """Payload for AI-assisted sheet creation."""
    prompt = serializers.CharField()
    row_count = serializers.IntegerField(required=False, default=10)
    col_count = serializers.IntegerField(required=False, default=5)


class AIEditSheetSerializer(serializers.Serializer):
    """Payload for AI-assisted sheet editing / filling."""
    prompt = serializers.CharField(help_text="Describe what to change or fill")
    conversation_history = serializers.ListField(
        child=serializers.DictField(),
        required=False,
        default=list,
        help_text="Previous conversation messages for context",
    )


class ImportWorkflowDataSerializer(serializers.Serializer):
    """Import data from a CLM workflow execution."""
    workflow_id = serializers.UUIDField()
    include_inputs = serializers.BooleanField(default=True)
    include_outputs = serializers.BooleanField(default=True)


class ImportDocumentTableSerializer(serializers.Serializer):
    """Import a Table from a drafter document into this sheet."""
    table_id = serializers.UUIDField()
    append = serializers.BooleanField(
        default=False,
        help_text="If true, append rows to existing sheet data. If false, replace.",
    )


class ImportLatexTableSerializer(serializers.Serializer):
    """Import tabular data parsed from a LaTeX code block or document."""
    source_type = serializers.ChoiceField(
        choices=['latex_code', 'document'],
        help_text="'latex_code' = specific LatexCode block, 'document' = Document.latex_code field",
    )
    source_id = serializers.UUIDField(
        help_text="UUID of LatexCode or Document depending on source_type",
    )
    table_index = serializers.IntegerField(
        default=0,
        help_text="Which \\begin{tabular} environment to import (0-based) if multiple exist",
    )
    append = serializers.BooleanField(default=False)


class DocumentTableListItemSerializer(serializers.Serializer):
    """Lightweight serializer for listing importable tables."""
    table_id = serializers.UUIDField(source='id')
    title = serializers.CharField(allow_blank=True, allow_null=True)
    table_type = serializers.CharField()
    num_columns = serializers.IntegerField()
    num_rows = serializers.IntegerField()
    column_labels = serializers.SerializerMethodField()
    document_id = serializers.SerializerMethodField()
    document_title = serializers.SerializerMethodField()
    section_title = serializers.SerializerMethodField()

    def get_column_labels(self, obj):
        return [h.get('label', '') for h in (obj.column_headers or [])]

    def get_document_id(self, obj):
        if obj.section and obj.section.document:
            return str(obj.section.document.id)
        return None

    def get_document_title(self, obj):
        if obj.section and obj.section.document:
            return obj.section.document.title
        return None

    def get_section_title(self, obj):
        if obj.section:
            return obj.section.title
        return None


class LatexTableListItemSerializer(serializers.Serializer):
    """Lightweight serializer for listing LaTeX sources that contain tables."""
    source_id = serializers.UUIDField(source='id')
    source_type = serializers.CharField()
    title = serializers.CharField()
    table_count = serializers.IntegerField()
    tables_preview = serializers.ListField(child=serializers.DictField())
    document_id = serializers.SerializerMethodField()
    document_title = serializers.SerializerMethodField()

    def get_document_id(self, obj):
        return str(obj.get('doc_id', '')) if isinstance(obj, dict) else None

    def get_document_title(self, obj):
        return obj.get('doc_title', '') if isinstance(obj, dict) else None


# ─── Sheet Sharing Serializers ──────────────────────────────────────

class SheetShareLinkSerializer(serializers.ModelSerializer):
    """Full serializer for share link management."""
    form_url = serializers.SerializerMethodField()
    sheet_title = serializers.CharField(source='sheet.title', read_only=True)

    class Meta:
        model = SheetShareLink
        fields = [
            'id', 'token', 'sheet', 'sheet_title', 'label', 'description',
            'is_active', 'access_type', 'expires_at', 'max_submissions',
            'submission_count', 'form_columns', 'workflow', 'workflow_node',
            'form_url', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'token', 'submission_count', 'created_at', 'updated_at',
        ]

    def get_form_url(self, obj):
        return f"/sheets/form/{obj.token}"


class SheetShareLinkCreateSerializer(serializers.Serializer):
    """Payload for creating a share link."""
    label = serializers.CharField(required=False, default='', allow_blank=True)
    description = serializers.CharField(required=False, default='', allow_blank=True)
    access_type = serializers.ChoiceField(
        choices=SheetShareLink.AccessType.choices,
        default='public',
    )
    expires_at = serializers.DateTimeField(required=False, allow_null=True)
    max_submissions = serializers.IntegerField(required=False, allow_null=True)
    form_columns = serializers.ListField(
        child=serializers.CharField(), required=False, default=list,
    )
    workflow = serializers.UUIDField(required=False, allow_null=True)
    workflow_node = serializers.UUIDField(required=False, allow_null=True)


class SheetFormSubmissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = SheetFormSubmission
        fields = [
            'id', 'share_link', 'sheet', 'row', 'data',
            'submitter_identifier', 'created_at',
        ]
        read_only_fields = [
            'id', 'share_link', 'sheet', 'row',
            'submitter_identifier', 'created_at',
        ]


class PublicFormSubmitSerializer(serializers.Serializer):
    """Payload submitted by a public form visitor."""
    data = serializers.DictField(child=serializers.CharField(allow_blank=True))
    submitter_identifier = serializers.CharField(
        required=False, default='', allow_blank=True,
    )


# ─── Intelligent Dashboard Serializers ──────────────────────────────

class SheetDashboardSerializer(serializers.ModelSerializer):
    """Full serializer for intelligent dashboard configs."""
    sheet_title = serializers.CharField(source='sheet.title', read_only=True)

    class Meta:
        model = SheetDashboard
        fields = [
            'id', 'sheet', 'sheet_title', 'title', 'chart_config',
            'prompt_used', 'generation_status', 'retry_count',
            'error_log', 'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'sheet', 'generation_status', 'retry_count',
            'error_log', 'created_at', 'updated_at',
        ]


# ─── Task Progress Serializers ──────────────────────────────────────

class SheetTaskSerializer(serializers.ModelSerializer):
    """Progress tracker for async sheet operations."""

    class Meta:
        model = SheetTask
        fields = [
            'id', 'sheet', 'task_type', 'status', 'progress',
            'total_items', 'completed_items', 'message',
            'result', 'error', 'created_at', 'updated_at',
        ]
        read_only_fields = fields


# ─── Lightweight row serializer for large sheets ────────────────────

class SheetRowLightSerializer(serializers.Serializer):
    """
    Ultra-light row serializer that avoids model introspection overhead.
    For paginated APIs returning 10K+ rows.
    """
    id = serializers.UUIDField()
    order = serializers.IntegerField()
    cells = serializers.SerializerMethodField()

    def get_cells(self, obj):
        """Return cells as a flat dict: { col_key: { raw, computed, type } }."""
        result = {}
        for cell in obj.cells.all():
            result[cell.column_key] = {
                'r': cell.raw_value,
                'c': cell.computed_value or cell.raw_value,
                't': cell.value_type,
            }
        return result
