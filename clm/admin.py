"""
CLM Admin — Simplified Workflow System
=======================================
"""
from django.contrib import admin

from .models import (
    ActionExecution,
    ActionExecutionResult,
    ActionPlugin,
    ExtractedField,
    ListenerEvent,
    NodeConnection,
    ValidatorUser,
    ValidationDecision,
    Workflow,
    WorkflowDocument,
    WorkflowNode,
)


class WorkflowNodeInline(admin.TabularInline):
    model = WorkflowNode
    extra = 0
    fields = ['node_type', 'label', 'position_x', 'position_y', 'config']


class NodeConnectionInline(admin.TabularInline):
    model = NodeConnection
    extra = 0
    fk_name = 'workflow'
    fields = ['source_node', 'target_node']


@admin.register(Workflow)
class WorkflowAdmin(admin.ModelAdmin):
    list_display = ['name', 'organization', 'is_active', 'last_executed_at', 'updated_at']
    list_filter = ['is_active', 'organization']
    search_fields = ['name']
    readonly_fields = ['extraction_template']
    inlines = [WorkflowNodeInline, NodeConnectionInline]


@admin.register(WorkflowNode)
class WorkflowNodeAdmin(admin.ModelAdmin):
    list_display = ['label', 'node_type', 'workflow', 'position_x', 'position_y']
    list_filter = ['node_type']
    search_fields = ['label']


class ExtractedFieldInline(admin.TabularInline):
    model = ExtractedField
    extra = 0
    fields = ['field_name', 'source', 'standardized_value', 'raw_value', 'confidence', 'is_manually_edited']
    readonly_fields = ['field_name', 'source', 'raw_value', 'confidence']


@admin.register(WorkflowDocument)
class WorkflowDocumentAdmin(admin.ModelAdmin):
    list_display = ['title', 'workflow', 'file_type', 'text_source', 'extraction_status', 'overall_confidence', 'created_at']
    list_filter = ['extraction_status', 'file_type', 'text_source']
    search_fields = ['title']
    readonly_fields = [
        'extracted_metadata', 'extraction_confidence',
        'global_metadata', 'global_confidence',
        'direct_text', 'ocr_text', 'original_text', 'text_source',
    ]
    inlines = [ExtractedFieldInline]


@admin.register(ExtractedField)
class ExtractedFieldAdmin(admin.ModelAdmin):
    list_display = ['field_name', 'source', 'standardized_value', 'confidence', 'document', 'is_manually_edited']
    list_filter = ['source', 'field_name', 'needs_review', 'is_manually_edited']
    search_fields = ['field_name', 'standardized_value', 'raw_value']
    readonly_fields = ['document', 'workflow', 'organization']


# ---------------------------------------------------------------------------
# Action models admin
# ---------------------------------------------------------------------------

@admin.register(ActionPlugin)
class ActionPluginAdmin(admin.ModelAdmin):
    list_display = ['display_name', 'name', 'category', 'icon', 'is_active']
    list_filter = ['category', 'is_active']
    search_fields = ['name', 'display_name']


class ActionExecutionResultInline(admin.TabularInline):
    model = ActionExecutionResult
    extra = 0
    fields = ['document', 'status', 'missing_fields', 'error_message']
    readonly_fields = ['document', 'status', 'missing_fields', 'error_message']


@admin.register(ActionExecution)
class ActionExecutionAdmin(admin.ModelAdmin):
    list_display = [
        'plugin', 'node', 'status', 'total_documents',
        'sent_count', 'skipped_count', 'failed_count', 'created_at',
    ]
    list_filter = ['status', 'plugin']
    readonly_fields = ['settings_used', 'started_at', 'completed_at']
    inlines = [ActionExecutionResultInline]


@admin.register(ActionExecutionResult)
class ActionExecutionResultAdmin(admin.ModelAdmin):
    list_display = ['document', 'status', 'error_message', 'created_at']
    list_filter = ['status']
    search_fields = ['document__title']
    readonly_fields = ['extracted_data', 'plugin_response', 'override_data']


# ---------------------------------------------------------------------------
# Listener models admin
# ---------------------------------------------------------------------------

@admin.register(ListenerEvent)
class ListenerEventAdmin(admin.ModelAdmin):
    list_display = [
        'trigger_type', 'node', 'status', 'document_count',
        'downstream_executed', 'created_at',
    ]
    list_filter = ['trigger_type', 'status', 'downstream_executed']
    search_fields = ['message', 'node__label']
    readonly_fields = [
        'event_data', 'execution_result', 'document_ids',
        'resolved_at', 'resolved_by',
    ]


# ---------------------------------------------------------------------------
# Validation models admin
# ---------------------------------------------------------------------------

@admin.register(ValidatorUser)
class ValidatorUserAdmin(admin.ModelAdmin):
    list_display = ['user', 'node', 'workflow', 'role_label', 'is_active', 'created_at']
    list_filter = ['is_active', 'workflow']
    search_fields = ['user__username', 'user__first_name', 'role_label']


@admin.register(ValidationDecision)
class ValidationDecisionAdmin(admin.ModelAdmin):
    list_display = [
        'assigned_to', 'status', 'document',
        'node', 'workflow', 'decided_at', 'created_at',
    ]
    list_filter = ['status', 'workflow']
    search_fields = [
        'assigned_to__username', 'assigned_to__first_name',
        'document__title', 'note',
    ]
    readonly_fields = ['decided_at']
