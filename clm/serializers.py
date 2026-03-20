"""
CLM Serializers — Simplified Workflow System
=============================================
"""
from rest_framework import serializers

from .models import (
    ActionExecution,
    ActionExecutionResult,
    ActionPlugin,
    DerivedField,
    DocumentCreationResult,
    EventSubscription,
    ExtractedField,
    InputNodeHistory,
    ListenerEvent,
    NodeConnection,
    NodeExecutionLog,
    SheetNodeQuery,
    ValidatorUser,
    ValidationDecision,
    WebhookEvent,
    Workflow,
    WorkflowChatMessage,
    WorkflowCompilation,
    WorkflowDocument,
    WorkflowNode,
    WorkflowUploadLink,
)


# ---------------------------------------------------------------------------
# WorkflowNode
# ---------------------------------------------------------------------------

class WorkflowNodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkflowNode
        fields = [
            'id', 'workflow', 'node_type', 'label',
            'position_x', 'position_y', 'config',
            'last_result', 'document_state',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'last_result', 'document_state', 'created_at', 'updated_at']

    def validate_config(self, value):
        """Validate rule node and action node config structure."""
        node_type = self.initial_data.get(
            'node_type',
            getattr(self.instance, 'node_type', None),
        )
        if node_type == 'rule':
            if not isinstance(value, dict):
                raise serializers.ValidationError("Config must be a JSON object.")
            conditions = value.get('conditions', [])
            if not isinstance(conditions, list):
                raise serializers.ValidationError(
                    "conditions must be a list."
                )
            valid_ops = {'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_contains'}
            for i, cond in enumerate(conditions):
                if not cond.get('field'):
                    raise serializers.ValidationError(
                        f"Condition {i}: 'field' is required."
                    )
                if cond.get('operator') not in valid_ops:
                    raise serializers.ValidationError(
                        f"Condition {i}: operator must be one of {valid_ops}."
                    )
        elif node_type == 'action':
            if not isinstance(value, dict):
                raise serializers.ValidationError("Config must be a JSON object.")
            # plugin key validated at execution time, not creation —
            # user adds the node first, then picks a plugin from the panel.
        elif node_type == 'listener':
            if not isinstance(value, dict):
                raise serializers.ValidationError("Config must be a JSON object.")
            # trigger_type validated at execution time, not creation.
        elif node_type == 'validator':
            if not isinstance(value, dict):
                raise serializers.ValidationError("Config must be a JSON object.")
            # Validator config stores name/description. Users managed via ValidatorUser.
        elif node_type == 'ai':
            if not isinstance(value, dict):
                raise serializers.ValidationError("Config must be a JSON object.")
            # AI node config validated at execution time — user configures
            # model, system_prompt, temperature, output_key from the panel.
        elif node_type == 'doc_create':
            if not isinstance(value, dict):
                raise serializers.ValidationError("Config must be a JSON object.")
            valid_modes = {'template', 'duplicate', 'quick_latex', 'structured'}
            mode = value.get('creation_mode', 'template')
            if mode not in valid_modes:
                raise serializers.ValidationError(
                    f"creation_mode must be one of {valid_modes}."
                )
            mappings = value.get('field_mappings', [])
            if not isinstance(mappings, list):
                raise serializers.ValidationError(
                    "field_mappings must be a list of objects."
                )
            for i, m in enumerate(mappings):
                if not isinstance(m, dict) or not m.get('source_field'):
                    raise serializers.ValidationError(
                        f"field_mappings[{i}]: each entry needs a 'source_field'."
                    )
            if mode == 'duplicate' and not value.get('source_document_id'):
                raise serializers.ValidationError(
                    "source_document_id is required for duplicate mode."
                )
            if mode == 'structured' and not value.get('sections'):
                raise serializers.ValidationError(
                    "sections list is required for structured mode."
                )
        elif node_type == 'sheet':
            if not isinstance(value, dict):
                raise serializers.ValidationError("Config must be a JSON object.")
            valid_modes = {'input', 'storage'}
            mode = value.get('mode', 'storage')
            if mode not in valid_modes:
                raise serializers.ValidationError(
                    f"mode must be one of {valid_modes}."
                )
            if mode == 'storage':
                valid_write_modes = {'append', 'overwrite'}
                wm = value.get('write_mode', 'append')
                if wm not in valid_write_modes:
                    raise serializers.ValidationError(
                        f"write_mode must be one of {valid_write_modes}."
                    )
            # sheet_id validated at execution time — user picks a sheet
            # from the panel after creating the node.
        return value


# ---------------------------------------------------------------------------
# NodeConnection
# ---------------------------------------------------------------------------

class NodeConnectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = NodeConnection
        fields = ['id', 'workflow', 'source_node', 'target_node', 'source_handle', 'created_at']
        read_only_fields = ['id', 'created_at']

    def validate(self, data):
        if data['source_node'] == data['target_node']:
            raise serializers.ValidationError("Cannot connect a node to itself.")
        if data['source_node'].workflow_id != data['target_node'].workflow_id:
            raise serializers.ValidationError("Both nodes must belong to the same workflow.")
        return data


# ---------------------------------------------------------------------------
# Workflow (includes nested nodes & connections for detail view)
# ---------------------------------------------------------------------------

class WorkflowSerializer(serializers.ModelSerializer):
    nodes = WorkflowNodeSerializer(many=True, read_only=True)
    connections = NodeConnectionSerializer(many=True, read_only=True)
    document_count = serializers.SerializerMethodField()
    derived_field_count = serializers.SerializerMethodField()

    class Meta:
        model = Workflow
        fields = [
            'id', 'name', 'description', 'is_active',
            'extraction_template', 'canvas_state',
            'auto_execute_on_upload', 'is_live', 'live_interval',
            'execution_state', 'current_execution_id',
            'nodes', 'connections', 'document_count',
            'derived_field_count',
            'last_executed_at', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'extraction_template', 'last_executed_at',
            'execution_state', 'current_execution_id',
            'created_at', 'updated_at',
        ]

    def get_document_count(self, obj):
        return obj.documents.count()

    def get_derived_field_count(self, obj):
        return obj.derived_fields.count()


class WorkflowListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list views."""
    node_count = serializers.SerializerMethodField()
    document_count = serializers.SerializerMethodField()

    class Meta:
        model = Workflow
        fields = [
            'id', 'name', 'description', 'is_active',
            'auto_execute_on_upload', 'is_live', 'live_interval',
            'execution_state', 'current_execution_id',
            'node_count', 'document_count',
            'last_executed_at', 'created_at', 'updated_at',
        ]

    def get_node_count(self, obj):
        return obj.nodes.count()

    def get_document_count(self, obj):
        return obj.documents.count()


# ---------------------------------------------------------------------------
# WorkflowDocument
# ---------------------------------------------------------------------------

class WorkflowDocumentSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.SerializerMethodField()
    field_count = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowDocument
        fields = [
            'id', 'workflow', 'title', 'file', 'file_type', 'file_size',
            'file_hash',
            'direct_text', 'ocr_text', 'original_text', 'text_source',
            'ocr_metadata',
            'global_metadata', 'global_confidence',
            'extracted_metadata', 'extraction_confidence',
            'overall_confidence', 'extraction_status',
            'uploaded_by', 'uploaded_by_name', 'field_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'file_size', 'file_hash',
            'direct_text', 'ocr_text', 'original_text', 'text_source',
            'ocr_metadata',
            'global_metadata', 'global_confidence',
            'extracted_metadata', 'extraction_confidence',
            'overall_confidence', 'extraction_status',
            'uploaded_by', 'uploaded_by_name', 'field_count',
            'created_at', 'updated_at',
        ]

    def get_uploaded_by_name(self, obj):
        if obj.uploaded_by:
            return obj.uploaded_by.get_full_name() or obj.uploaded_by.username
        return None

    def get_field_count(self, obj):
        return obj.extracted_fields.count() if hasattr(obj, 'extracted_fields') else 0

    def validate_file(self, value):
        max_size = 20 * 1024 * 1024  # 20 MB
        if value.size > max_size:
            raise serializers.ValidationError("File size cannot exceed 20 MB.")
        return value


class WorkflowDocumentUploadSerializer(serializers.ModelSerializer):
    """Minimal serializer for upload endpoint."""
    class Meta:
        model = WorkflowDocument
        fields = ['id', 'title', 'file', 'file_type']
        read_only_fields = ['id']

    def validate_file(self, value):
        max_size = 20 * 1024 * 1024
        if value.size > max_size:
            raise serializers.ValidationError("File size cannot exceed 20 MB.")
        return value


# ---------------------------------------------------------------------------
# AI Extraction request/response serializers
# ---------------------------------------------------------------------------

class TextExtractionRequestSerializer(serializers.Serializer):
    """Extract metadata from raw text (no file upload needed)."""
    text = serializers.CharField(
        help_text='The raw text to extract metadata from.',
    )
    template = serializers.JSONField(
        help_text='NuExtract template: {"field_name": "", ...}',
    )


class DocumentExtractionRequestSerializer(serializers.Serializer):
    """Re-extract metadata for an existing document."""
    document_id = serializers.UUIDField(
        help_text='ID of the WorkflowDocument to re-extract.',
    )
    template = serializers.JSONField(
        required=False,
        help_text='Optional override template. If omitted, uses workflow extraction_template.',
    )


class BatchExtractionRequestSerializer(serializers.Serializer):
    """Re-extract metadata for multiple documents."""
    document_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        help_text='Specific document IDs. If omitted, re-extracts all pending/failed docs.',
    )
    template = serializers.JSONField(
        required=False,
        help_text='Optional override template.',
    )


class MetadataEditSerializer(serializers.Serializer):
    """Manual edit of a document's extracted metadata."""
    extracted_metadata = serializers.JSONField(
        required=False,
        help_text='Updated workflow-specific metadata — merges with existing.',
    )
    global_metadata = serializers.JSONField(
        required=False,
        help_text='Updated global metadata — merges with existing.',
    )

    def validate(self, data):
        if not data.get('extracted_metadata') and not data.get('global_metadata'):
            raise serializers.ValidationError(
                "Provide at least one of 'extracted_metadata' or 'global_metadata'."
            )
        return data


class ExtractionResultSerializer(serializers.Serializer):
    """Response from an extraction operation."""
    global_metadata = serializers.JSONField(required=False)
    global_confidence = serializers.JSONField(required=False)
    global_overall_confidence = serializers.FloatField(required=False)
    extracted_data = serializers.JSONField()
    confidence = serializers.JSONField(required=False)
    workflow_confidence = serializers.JSONField(required=False)
    workflow_overall_confidence = serializers.FloatField(required=False)
    overall_confidence = serializers.FloatField()
    needs_review = serializers.BooleanField(default=False)
    chunks_processed = serializers.IntegerField(default=1)
    ocr_metadata = serializers.JSONField(required=False)


# ---------------------------------------------------------------------------
# ExtractedField — central table serializers
# ---------------------------------------------------------------------------

class ExtractedFieldSerializer(serializers.ModelSerializer):
    document_title = serializers.CharField(source='document.title', read_only=True)

    class Meta:
        model = ExtractedField
        fields = [
            'id', 'document', 'document_title', 'workflow',
            'field_name', 'source',
            'raw_value', 'standardized_value', 'display_value',
            'confidence', 'needs_review', 'is_manually_edited',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'document', 'document_title', 'workflow',
            'source', 'raw_value', 'confidence',
            'created_at', 'updated_at',
        ]


class ExtractedFieldEditSerializer(serializers.Serializer):
    """Edit a single extracted field value."""
    standardized_value = serializers.CharField(
        required=False, allow_blank=True,
        help_text='New standardized value for the field.',
    )
    display_value = serializers.CharField(
        required=False, allow_blank=True,
        help_text='New display value for the field.',
    )


class DocumentFieldsSummarySerializer(serializers.Serializer):
    """Summary of a document's extracted fields."""
    document_id = serializers.UUIDField()
    document_title = serializers.CharField()
    extraction_status = serializers.CharField()
    text_source = serializers.CharField()
    direct_text_length = serializers.IntegerField()
    ocr_text_length = serializers.IntegerField()
    global_field_count = serializers.IntegerField()
    workflow_field_count = serializers.IntegerField()
    overall_confidence = serializers.FloatField(allow_null=True)


# ---------------------------------------------------------------------------
# Action Plugin serializers
# ---------------------------------------------------------------------------

class ActionPluginSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActionPlugin
        fields = [
            'id', 'name', 'display_name', 'description', 'icon',
            'category', 'required_fields', 'optional_fields',
            'settings_schema', 'is_active', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class ActionExecutionResultSerializer(serializers.ModelSerializer):
    document_title = serializers.CharField(source='document.title', read_only=True)

    class Meta:
        model = ActionExecutionResult
        fields = [
            'id', 'document', 'document_title',
            'status', 'extracted_data', 'missing_fields',
            'plugin_response', 'error_message', 'override_data',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'document', 'document_title', 'status',
            'extracted_data', 'missing_fields', 'plugin_response',
            'error_message', 'created_at', 'updated_at',
        ]


class ActionExecutionSerializer(serializers.ModelSerializer):
    plugin_name = serializers.CharField(source='plugin.display_name', read_only=True)
    plugin_icon = serializers.CharField(source='plugin.icon', read_only=True)
    node_label = serializers.CharField(source='node.label', read_only=True)
    results = ActionExecutionResultSerializer(many=True, read_only=True)

    class Meta:
        model = ActionExecution
        fields = [
            'id', 'workflow', 'node', 'node_label',
            'plugin', 'plugin_name', 'plugin_icon',
            'status', 'total_documents',
            'sent_count', 'skipped_count', 'failed_count',
            'settings_used', 'started_at', 'completed_at',
            'triggered_by', 'results', 'created_at',
        ]
        read_only_fields = ['__all__']


class ActionRetrySerializer(serializers.Serializer):
    """Retry a single action result with optional override data."""
    result_id = serializers.UUIDField(
        help_text='ID of the ActionExecutionResult to retry',
    )
    override_data = serializers.JSONField(
        required=False, default=dict,
        help_text='Override data for missing fields: {"email": "new@example.com"}',
    )


# ---------------------------------------------------------------------------
# Listener Event serializers
# ---------------------------------------------------------------------------

class ListenerEventSerializer(serializers.ModelSerializer):
    node_label = serializers.CharField(source='node.label', read_only=True)
    resolved_by_name = serializers.SerializerMethodField()
    triggered_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ListenerEvent
        fields = [
            'id', 'workflow', 'node', 'node_label',
            'trigger_type', 'status',
            'document_ids', 'document_count',
            'event_data', 'message',
            'resolved_by', 'resolved_by_name',
            'resolution_note', 'resolved_at',
            'downstream_executed', 'execution_result',
            'triggered_by', 'triggered_by_name',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'workflow', 'node', 'node_label',
            'trigger_type', 'document_ids', 'document_count',
            'event_data', 'resolved_by', 'resolved_by_name',
            'resolved_at', 'downstream_executed', 'execution_result',
            'triggered_by', 'triggered_by_name',
            'created_at', 'updated_at',
        ]

    def get_resolved_by_name(self, obj):
        if obj.resolved_by:
            return obj.resolved_by.get_full_name() or obj.resolved_by.username
        return None

    def get_triggered_by_name(self, obj):
        if obj.triggered_by:
            return obj.triggered_by.get_full_name() or obj.triggered_by.username
        return None


class ListenerResolveSerializer(serializers.Serializer):
    """Approve or reject a pending listener event."""
    event_id = serializers.UUIDField(
        help_text='ID of the ListenerEvent to approve/reject',
    )
    action = serializers.ChoiceField(
        choices=['approve', 'reject'],
        help_text='"approve" or "reject"',
    )
    note = serializers.CharField(
        required=False, default='', allow_blank=True,
        help_text='Optional note explaining the decision',
    )


class ListenerTriggerSerializer(serializers.Serializer):
    """Manually trigger a listener node."""
    document_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False, default=list,
        help_text='Specific document IDs. If omitted, uses all upstream documents.',
    )


# ---------------------------------------------------------------------------
# Validation serializers
# ---------------------------------------------------------------------------

class ValidatorUserSerializer(serializers.ModelSerializer):
    """User assigned to a validator node."""
    user_name = serializers.SerializerMethodField()
    user_email = serializers.SerializerMethodField()
    user_role = serializers.SerializerMethodField()

    class Meta:
        model = ValidatorUser
        fields = [
            'id', 'node', 'workflow', 'user', 'user_name', 'user_email',
            'user_role', 'role_label', 'is_active',
            'created_at',
        ]
        read_only_fields = ['id', 'workflow', 'user_name', 'user_email', 'user_role', 'created_at']

    def get_user_name(self, obj):
        return obj.user.get_full_name() or obj.user.username

    def get_user_email(self, obj):
        return obj.user.email

    def get_user_role(self, obj):
        try:
            profile = obj.user.profile
            return profile.role.display_name if profile.role else obj.role_label
        except Exception:
            return obj.role_label


class ValidationDecisionSerializer(serializers.ModelSerializer):
    """A single approve/reject decision by a user."""
    assigned_to_name = serializers.SerializerMethodField()
    assigned_to_email = serializers.SerializerMethodField()
    document_title = serializers.SerializerMethodField()
    node_label = serializers.SerializerMethodField()
    workflow_name = serializers.SerializerMethodField()

    class Meta:
        model = ValidationDecision
        fields = [
            'id', 'workflow', 'workflow_name', 'node', 'node_label',
            'document', 'document_title',
            'assigned_to', 'assigned_to_name', 'assigned_to_email',
            'status', 'note', 'decided_at',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'workflow', 'workflow_name', 'node', 'node_label',
            'document', 'document_title',
            'assigned_to', 'assigned_to_name', 'assigned_to_email',
            'decided_at', 'created_at', 'updated_at',
        ]

    def get_assigned_to_name(self, obj):
        return obj.assigned_to.get_full_name() or obj.assigned_to.username

    def get_assigned_to_email(self, obj):
        return obj.assigned_to.email

    def get_document_title(self, obj):
        return obj.document.title if obj.document else None

    def get_node_label(self, obj):
        return obj.node.label if obj.node else None

    def get_workflow_name(self, obj):
        return obj.workflow.name if obj.workflow else None


class ValidationResolveSerializer(serializers.Serializer):
    """Approve or reject a pending validation decision."""
    decision_id = serializers.UUIDField(
        help_text='ID of the ValidationDecision to approve/reject',
    )
    action = serializers.ChoiceField(
        choices=['approve', 'reject'],
        help_text='"approve" or "reject"',
    )
    note = serializers.CharField(
        required=False, default='', allow_blank=True,
        help_text='Optional note explaining the decision',
    )


class BulkValidationResolveSerializer(serializers.Serializer):
    """Approve or reject multiple validation decisions at once."""
    decision_ids = serializers.ListField(
        child=serializers.UUIDField(),
        help_text='List of ValidationDecision IDs',
    )
    action = serializers.ChoiceField(
        choices=['approve', 'reject'],
        help_text='"approve" or "reject"',
    )
    note = serializers.CharField(
        required=False, default='', allow_blank=True,
    )


# ---------------------------------------------------------------------------
# Org User serializer (for validator user dropdown)
# ---------------------------------------------------------------------------

class OrgUserSerializer(serializers.Serializer):
    """Lightweight user info for org member dropdowns."""
    id = serializers.IntegerField(source='user.id')
    user_id = serializers.IntegerField(source='user.id')
    username = serializers.CharField(source='user.username')
    full_name = serializers.SerializerMethodField()
    email = serializers.EmailField(source='user.email')
    role_name = serializers.SerializerMethodField()
    role_type = serializers.SerializerMethodField()
    job_title = serializers.CharField()
    department = serializers.CharField()

    def get_full_name(self, obj):
        name = obj.user.get_full_name()
        return name if name else obj.user.username

    def get_role_name(self, obj):
        return obj.role.display_name if obj.role else 'No Role'

    def get_role_type(self, obj):
        return obj.role.role_type if obj.role else None


# ---------------------------------------------------------------------------
# WorkflowExecution — execution history
# ---------------------------------------------------------------------------

class WorkflowExecutionSerializer(serializers.ModelSerializer):
    triggered_by_name = serializers.SerializerMethodField()

    class Meta:
        from .models import WorkflowExecution
        model = WorkflowExecution
        fields = [
            'id', 'workflow', 'status', 'mode',
            'total_documents', 'included_document_ids',
            'excluded_document_ids', 'output_document_ids',
            'node_summary', 'duration_ms',
            'started_at', 'completed_at',
            'triggered_by', 'triggered_by_name',
        ]
        read_only_fields = fields

    def get_triggered_by_name(self, obj):
        if obj.triggered_by:
            return obj.triggered_by.get_full_name() or obj.triggered_by.username
        return 'System'


class WorkflowExecutionDetailSerializer(serializers.ModelSerializer):
    """Full detail including result_data for single-execution view."""
    triggered_by_name = serializers.SerializerMethodField()

    class Meta:
        from .models import WorkflowExecution
        model = WorkflowExecution
        fields = [
            'id', 'workflow', 'status', 'mode',
            'total_documents', 'included_document_ids',
            'excluded_document_ids', 'output_document_ids',
            'result_data', 'node_summary', 'duration_ms',
            'started_at', 'completed_at',
            'triggered_by', 'triggered_by_name',
        ]
        read_only_fields = fields

    def get_triggered_by_name(self, obj):
        if obj.triggered_by:
            return obj.triggered_by.get_full_name() or obj.triggered_by.username
        return 'System'


# ---------------------------------------------------------------------------
# DerivedField — AI-computed metadata fields
# ---------------------------------------------------------------------------

class DerivedFieldSerializer(serializers.ModelSerializer):
    class Meta:
        model = DerivedField
        fields = [
            'id', 'workflow', 'name', 'display_name', 'field_type',
            'description', 'computation_hint', 'depends_on',
            'allowed_values', 'include_document_text', 'order',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_name(self, value):
        """Ensure snake_case naming convention."""
        import re
        if not re.match(r'^[a-z][a-z0-9_]*$', value):
            raise serializers.ValidationError(
                "Field name must be snake_case (lowercase letters, digits, "
                "underscores; must start with a letter)."
            )
        return value

    def validate(self, data):
        """Cross-field validation."""
        field_type = data.get(
            'field_type',
            getattr(self.instance, 'field_type', None),
        )
        allowed_values = data.get(
            'allowed_values',
            getattr(self.instance, 'allowed_values', []),
        )
        if field_type == 'category' and not allowed_values:
            raise serializers.ValidationError({
                'allowed_values': 'Category fields must specify allowed_values.',
            })
        return data


class DerivedFieldCreateSerializer(serializers.Serializer):
    """Lightweight serializer for bulk-creating derived fields inline."""
    name = serializers.CharField(max_length=255)
    display_name = serializers.CharField(max_length=255, required=False, default='')
    field_type = serializers.ChoiceField(
        choices=DerivedField.FieldType.choices, default='string',
    )
    description = serializers.CharField(required=False, default='')
    computation_hint = serializers.CharField()
    depends_on = serializers.ListField(
        child=serializers.CharField(), required=False, default=list,
    )
    allowed_values = serializers.ListField(
        child=serializers.CharField(), required=False, default=list,
    )
    include_document_text = serializers.BooleanField(required=False, default=False)
    order = serializers.IntegerField(required=False, default=0)


# ---------------------------------------------------------------------------
# WorkflowChatMessage — AI chat assistant
# ---------------------------------------------------------------------------

class WorkflowChatMessageSerializer(serializers.ModelSerializer):
    created_by_username = serializers.CharField(
        source='created_by.username', read_only=True, default=None,
    )

    class Meta:
        model = WorkflowChatMessage
        fields = [
            'id', 'workflow', 'role', 'content', 'actions',
            'actions_applied', 'model_used', 'token_usage',
            'created_by', 'created_by_username', 'created_at',
        ]
        read_only_fields = [
            'id', 'workflow', 'role', 'actions', 'actions_applied',
            'model_used', 'token_usage', 'created_by', 'created_at',
        ]


class WorkflowChatSendSerializer(serializers.Serializer):
    """Input serializer for sending a chat message."""
    message = serializers.CharField(max_length=4000)
    model = serializers.CharField(max_length=100, required=False, default='gemini-2.0-flash')


# ---------------------------------------------------------------------------
# WorkflowUploadLink — Shareable public upload links
# ---------------------------------------------------------------------------

class WorkflowUploadLinkSerializer(serializers.ModelSerializer):
    """Full serializer for managing upload links (authenticated users)."""
    is_expired = serializers.BooleanField(read_only=True)
    is_at_limit = serializers.BooleanField(read_only=True)
    is_usable = serializers.BooleanField(read_only=True)
    created_by_username = serializers.CharField(
        source='created_by.username', read_only=True, default=None,
    )

    class Meta:
        model = WorkflowUploadLink
        fields = [
            'id', 'token', 'workflow', 'label', 'is_active',
            'require_login', 'password', 'expires_at', 'max_uploads',
            'upload_count', 'input_node',
            'is_expired', 'is_at_limit', 'is_usable',
            'created_by', 'created_by_username',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'token', 'workflow', 'upload_count',
            'created_by', 'created_at', 'updated_at',
        ]


class PublicUploadInfoSerializer(serializers.Serializer):
    """Returned by the public GET endpoint — minimal workflow info."""
    token = serializers.UUIDField()
    workflow_name = serializers.CharField()
    workflow_description = serializers.CharField(allow_blank=True)
    label = serializers.CharField(allow_blank=True)
    requires_password = serializers.BooleanField()
    require_login = serializers.CharField()
    input_node_label = serializers.CharField(allow_blank=True, allow_null=True)


# ---------------------------------------------------------------------------
# DocumentCreationResult — doc_create node outcomes
# ---------------------------------------------------------------------------

class DocumentCreationResultSerializer(serializers.ModelSerializer):
    source_document_title = serializers.CharField(
        source='source_clm_document.title', read_only=True,
    )
    created_document_title = serializers.SerializerMethodField()

    class Meta:
        model = DocumentCreationResult
        fields = [
            'id', 'workflow', 'node',
            'source_clm_document', 'source_document_title',
            'created_document', 'created_document_title',
            'status', 'creation_mode',
            'metadata_used', 'missing_fields', 'error_message',
            'triggered_by', 'created_at',
        ]
        read_only_fields = fields

    def get_created_document_title(self, obj):
        return obj.created_document.title if obj.created_document else None


# ---------------------------------------------------------------------------
# InputNodeHistory — tracks previous input operations per node
# ---------------------------------------------------------------------------

class InputNodeHistorySerializer(serializers.ModelSerializer):
    triggered_by_name = serializers.SerializerMethodField()
    supports_refresh = serializers.BooleanField(read_only=True)
    supports_manage_uploaded = serializers.BooleanField(read_only=True)

    class Meta:
        model = InputNodeHistory
        fields = [
            'id', 'workflow', 'node', 'organization',
            'source_type', 'status',
            'document_count', 'skipped_count', 'failed_count',
            'document_ids', 'source_reference', 'details',
            'supports_refresh', 'supports_manage_uploaded',
            'triggered_by', 'triggered_by_name',
            'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_triggered_by_name(self, obj):
        if obj.triggered_by:
            return obj.triggered_by.get_full_name() or obj.triggered_by.username
        return None


# ---------------------------------------------------------------------------
# SheetNodeQuery — tracks sheet node row-level queries with cache
# ---------------------------------------------------------------------------

class SheetNodeQuerySerializer(serializers.ModelSerializer):
    sheet_title = serializers.SerializerMethodField()
    source_document_title = serializers.SerializerMethodField()

    class Meta:
        model = SheetNodeQuery
        fields = [
            'id', 'workflow', 'node', 'execution',
            'sheet', 'sheet_title',
            'operation', 'status',
            'row_order', 'row_id',
            'source_document', 'source_document_title',
            'content_hash', 'row_data',
            'hit_count', 'last_hit_at',
            'error_message', 'created_at',
        ]
        read_only_fields = fields

    def get_sheet_title(self, obj):
        return obj.sheet.title if obj.sheet else None

    def get_source_document_title(self, obj):
        return obj.source_document.title if obj.source_document else None


# ---------------------------------------------------------------------------
# EventSubscription — event source subscriptions for live workflows
# ---------------------------------------------------------------------------

class EventSubscriptionSerializer(serializers.ModelSerializer):
    node_label = serializers.SerializerMethodField()
    node_type = serializers.SerializerMethodField()

    class Meta:
        model = EventSubscription
        fields = [
            'id', 'workflow', 'node', 'node_label', 'node_type',
            'source_type', 'status', 'source_id',
            'webhook_token', 'poll_interval',
            'last_polled_at', 'next_poll_at',
            'consecutive_errors', 'last_error', 'last_error_at',
            'total_events_received', 'total_executions_triggered',
            'config_snapshot',
            'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_node_label(self, obj):
        return obj.node.label or obj.node.node_type if obj.node else None

    def get_node_type(self, obj):
        return obj.node.node_type if obj.node else None


# ---------------------------------------------------------------------------
# WebhookEvent — inbound event records
# ---------------------------------------------------------------------------

class WebhookEventSerializer(serializers.ModelSerializer):
    subscription_source_type = serializers.SerializerMethodField()
    execution_status = serializers.SerializerMethodField()

    class Meta:
        model = WebhookEvent
        fields = [
            'id', 'subscription', 'subscription_source_type',
            'workflow', 'event_type', 'status',
            'payload', 'headers', 'source_ip',
            'result', 'error_message',
            'execution', 'execution_status',
            'retry_count', 'max_retries',
            'idempotency_key',
            'created_at', 'processed_at',
        ]
        read_only_fields = fields

    def get_subscription_source_type(self, obj):
        return obj.subscription.source_type if obj.subscription else None

    def get_execution_status(self, obj):
        return obj.execution.status if obj.execution else None


# ---------------------------------------------------------------------------
# NodeExecutionLog — per-node per-execution detailed log
# ---------------------------------------------------------------------------

class NodeExecutionLogSerializer(serializers.ModelSerializer):
    node_label = serializers.SerializerMethodField()
    node_type = serializers.SerializerMethodField()

    class Meta:
        model = NodeExecutionLog
        fields = [
            'id', 'execution', 'workflow', 'node',
            'node_label', 'node_type',
            'status',
            'input_document_ids', 'output_document_ids',
            'input_count', 'output_count',
            'result_data', 'error_message', 'error_traceback',
            'started_at', 'completed_at', 'duration_ms',
            'dag_level',
            'created_at',
        ]
        read_only_fields = fields

    def get_node_label(self, obj):
        return obj.node.label or obj.node.node_type if obj.node else None

    def get_node_type(self, obj):
        return obj.node.node_type if obj.node else None


# ---------------------------------------------------------------------------
# WorkflowCompilation — compilation history records
# ---------------------------------------------------------------------------

class WorkflowCompilationSerializer(serializers.ModelSerializer):
    compiled_by_name = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowCompilation
        fields = [
            'id', 'workflow', 'status',
            'node_count', 'connection_count',
            'has_cycle', 'has_input_node', 'has_output_node',
            'subscriptions_created', 'subscription_details',
            'errors', 'warnings',
            'config_hash',
            'compiled_by', 'compiled_by_name',
            'created_at',
        ]
        read_only_fields = fields

    def get_compiled_by_name(self, obj):
        if obj.compiled_by:
            return obj.compiled_by.get_full_name() or obj.compiled_by.username
        return None