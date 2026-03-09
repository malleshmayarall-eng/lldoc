from rest_framework import serializers
from .models import AIInteraction, DocumentAnalysisRun, DocumentTypeAIPreset, DocumentAIConfig
from documents.models import ParagraphAIResult


# ─────────────────────────────────────────────────────────────────────────────
# Document-Type AI Preset Serializers
# ─────────────────────────────────────────────────────────────────────────────

class DocumentTypeAIPresetSerializer(serializers.ModelSerializer):
    """Full serializer for document-type AI presets."""
    created_by_username = serializers.SerializerMethodField()

    class Meta:
        model = DocumentTypeAIPreset
        fields = [
            'id', 'document_type', 'display_name', 'description',
            'services_config', 'system_prompt', 'service_prompts', 'ai_focus',
            'created_by', 'created_by_username',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at']

    def get_created_by_username(self, obj):
        return obj.created_by.username if obj.created_by else None


class DocumentTypeAIPresetCreateSerializer(serializers.ModelSerializer):
    """Create / update serializer for document-type AI presets."""
    class Meta:
        model = DocumentTypeAIPreset
        fields = [
            'document_type', 'display_name', 'description',
            'services_config', 'system_prompt', 'service_prompts', 'ai_focus',
        ]

    def validate_document_type(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("document_type is required.")
        return value.strip()


# ─────────────────────────────────────────────────────────────────────────────
# Per-Document AI Config Serializers
# ─────────────────────────────────────────────────────────────────────────────

class DocumentAIConfigSerializer(serializers.ModelSerializer):
    """Full serializer for per-document AI configuration."""
    document_title = serializers.SerializerMethodField()
    document_type = serializers.SerializerMethodField()
    effective_config = serializers.SerializerMethodField()
    effective_system_prompt = serializers.SerializerMethodField()
    effective_service_prompts = serializers.SerializerMethodField()
    effective_ai_focus = serializers.SerializerMethodField()
    preset_config = serializers.SerializerMethodField()

    class Meta:
        model = DocumentAIConfig
        fields = [
            'id', 'document', 'document_title', 'document_type',
            'services_config', 'system_prompt', 'service_prompts', 'ai_focus',
            'effective_config', 'effective_system_prompt',
            'effective_service_prompts', 'effective_ai_focus',
            'preset_config',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'document', 'created_at', 'updated_at',
            'effective_config', 'effective_system_prompt',
            'effective_service_prompts', 'effective_ai_focus', 'preset_config',
        ]

    def get_document_title(self, obj):
        return obj.document.title if obj.document else None

    def get_document_type(self, obj):
        return obj.document.document_type if obj.document else None

    def get_effective_config(self, obj):
        return obj.get_effective_config()

    def get_effective_system_prompt(self, obj):
        return obj.get_effective_system_prompt()

    def get_effective_service_prompts(self, obj):
        return obj.get_effective_service_prompts()

    def get_effective_ai_focus(self, obj):
        return obj.get_effective_ai_focus()

    def get_preset_config(self, obj):
        """Return the document-type preset config for reference."""
        try:
            preset = DocumentTypeAIPreset.objects.get(
                document_type=obj.document.document_type
            )
            return DocumentTypeAIPresetSerializer(preset).data
        except DocumentTypeAIPreset.DoesNotExist:
            return None


class DocumentAIConfigUpdateSerializer(serializers.Serializer):
    """
    Input serializer for updating per-document AI config.
    All fields are optional — only provided fields are applied.
    """
    services_config = serializers.JSONField(required=False)
    system_prompt = serializers.CharField(required=False, allow_blank=True)
    service_prompts = serializers.JSONField(required=False)
    ai_focus = serializers.CharField(required=False, allow_blank=True)


class AIServiceToggleSerializer(serializers.Serializer):
    """
    Quick toggle for enabling / disabling a specific AI service
    on a document.

    POST /api/ai/documents/<uuid>/config/toggle/
    { "service": "paragraph_scoring", "enabled": false }
    """
    service = serializers.CharField(
        help_text="Service name, e.g. 'document_scoring', 'paragraph_scoring'"
    )
    enabled = serializers.BooleanField(
        help_text="Whether to enable or disable the service"
    )


class AIServiceBulkToggleSerializer(serializers.Serializer):
    """
    Bulk toggle for multiple AI services at once.

    POST /api/ai/documents/<uuid>/config/bulk-toggle/
    {
        "toggles": {
            "document_scoring": true,
            "paragraph_scoring": false,
            "data_validation": true
        }
    }
    """
    toggles = serializers.DictField(
        child=serializers.BooleanField(),
        help_text="Dict of service_name → enabled bool"
    )


class AITextIngestSerializer(serializers.Serializer):
    text = serializers.CharField()
    title = serializers.CharField(required=False, default='Untitled Document')
    author = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    user_id = serializers.UUIDField(required=False, allow_null=True)
    document_type = serializers.CharField(required=False, default='contract')


class AIInteractionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AIInteraction
        fields = '__all__'
        read_only_fields = ['id', 'requested_by', 'created_at', 'updated_at']


class DocumentAnalysisRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = DocumentAnalysisRun
        fields = '__all__'
        read_only_fields = ['id', 'requested_by', 'created_at', 'updated_at']


class ParagraphAIResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = ParagraphAIResult
        fields = '__all__'
        read_only_fields = ['id', 'analysis_timestamp']


class ParagraphPlaceholderUpdateSerializer(serializers.Serializer):
    processed_text = serializers.CharField(required=False, allow_blank=True)
    raw_text = serializers.CharField(required=False, allow_blank=True)
    placeholders = serializers.DictField(
        child=serializers.CharField(),
        required=False,
        help_text="Optional placeholder overrides, e.g. {'CLIENT_NAME': 'Acme Inc.'}"
    )

    def validate(self, attrs):
        processed_text = attrs.get('processed_text')
        raw_text = attrs.get('raw_text')
        if not processed_text and not raw_text:
            raise serializers.ValidationError('Either processed_text or raw_text is required.')
        return attrs


class ParagraphAIReviewApplySerializer(serializers.Serializer):
    processed_text = serializers.CharField(required=False, allow_blank=True)
    rendered_text = serializers.CharField(required=False, allow_blank=True)
    suggestions = serializers.ListField(
        child=serializers.DictField(),
        required=False,
        help_text="List of suggestion objects with optional original/replacement fields."
    )

    def validate(self, attrs):
        processed_text = attrs.get('processed_text')
        rendered_text = attrs.get('rendered_text')
        if not processed_text and not rendered_text:
            raise serializers.ValidationError('Either processed_text or rendered_text is required.')
        return attrs
