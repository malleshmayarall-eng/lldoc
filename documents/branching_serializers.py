"""
Serializers for the Master Document & Branching system.

Covers:
- MasterDocument CRUD + search
- DocumentBranch CRUD
- Document duplication
- AI-assisted master document creation
"""

from rest_framework import serializers
from .models import Document, MasterDocument, DocumentBranch


# ─────────────────────────────────────────────────────────────────────────────
# MasterDocument
# ─────────────────────────────────────────────────────────────────────────────

class MasterDocumentListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for listing / searching master documents."""
    created_by_username = serializers.SerializerMethodField()
    template_document_title = serializers.SerializerMethodField()

    class Meta:
        model = MasterDocument
        fields = [
            'id', 'name', 'description', 'category', 'document_type',
            'tags', 'is_public', 'is_system',
            'branch_count', 'duplicate_count', 'last_branched_at',
            'created_by', 'created_by_username',
            'template_document', 'template_document_title',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'branch_count', 'duplicate_count', 'last_branched_at',
            'created_at', 'updated_at',
        ]

    def get_created_by_username(self, obj):
        return obj.created_by.username if obj.created_by else None

    def get_template_document_title(self, obj):
        return obj.template_document.title if obj.template_document else None


class MasterDocumentDetailSerializer(serializers.ModelSerializer):
    """Full serializer including all config fields."""
    created_by_username = serializers.SerializerMethodField()
    template_document_title = serializers.SerializerMethodField()
    branches = serializers.SerializerMethodField()

    class Meta:
        model = MasterDocument
        fields = [
            'id', 'name', 'description',
            'template_document', 'template_document_title',
            'category', 'document_type', 'tags',
            'default_metadata', 'default_custom_metadata', 'default_parties',
            'style_preset',
            'ai_system_prompt', 'ai_generation_notes',
            'default_ai_service_config', 'default_ai_system_prompt',
            'default_ai_service_prompts', 'default_ai_focus',
            'is_public', 'is_system',
            'branch_count', 'duplicate_count', 'last_branched_at',
            'created_by', 'created_by_username',
            'branches',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'branch_count', 'duplicate_count', 'last_branched_at',
            'created_at', 'updated_at',
        ]

    def get_created_by_username(self, obj):
        return obj.created_by.username if obj.created_by else None

    def get_template_document_title(self, obj):
        return obj.template_document.title if obj.template_document else None

    def get_branches(self, obj):
        """Return the most recent 20 branches for the detail view."""
        qs = obj.branches.select_related('document', 'created_by').order_by('-created_at')[:20]
        return DocumentBranchListSerializer(qs, many=True).data


class MasterDocumentCreateSerializer(serializers.ModelSerializer):
    """
    Create a new MasterDocument.

    Accepts:
    - All master-level fields (name, description, category, etc.)
    - `template_document` (UUID) to link an existing Document as the template
    """
    class Meta:
        model = MasterDocument
        fields = [
            'name', 'description',
            'template_document',
            'category', 'document_type', 'tags',
            'default_metadata', 'default_custom_metadata', 'default_parties',
            'style_preset',
            'ai_system_prompt', 'ai_generation_notes',
            'default_ai_service_config', 'default_ai_system_prompt',
            'default_ai_service_prompts', 'default_ai_focus',
            'is_public',
        ]

    def validate_name(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("Name is required.")
        return value.strip()


class MasterDocumentUpdateSerializer(serializers.ModelSerializer):
    """Partial-update serializer – all fields optional."""
    class Meta:
        model = MasterDocument
        fields = [
            'name', 'description',
            'template_document',
            'category', 'document_type', 'tags',
            'default_metadata', 'default_custom_metadata', 'default_parties',
            'style_preset',
            'ai_system_prompt', 'ai_generation_notes',
            'default_ai_service_config', 'default_ai_system_prompt',
            'default_ai_service_prompts', 'default_ai_focus',
            'is_public',
        ]
        extra_kwargs = {f: {'required': False} for f in fields}


# ─────────────────────────────────────────────────────────────────────────────
# DocumentBranch
# ─────────────────────────────────────────────────────────────────────────────

class DocumentBranchListSerializer(serializers.ModelSerializer):
    """Lightweight branch listing."""
    document_title = serializers.SerializerMethodField()
    created_by_username = serializers.SerializerMethodField()
    master_name = serializers.SerializerMethodField()

    class Meta:
        model = DocumentBranch
        fields = [
            'id', 'branch_name', 'branch_type', 'status', 'branch_notes',
            'master', 'master_name',
            'source_document', 'document', 'document_title',
            'metadata_overrides', 'style_overrides',
            'created_by', 'created_by_username',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'document', 'source_document', 'created_at', 'updated_at',
        ]

    def get_document_title(self, obj):
        return obj.document.title if obj.document else None

    def get_created_by_username(self, obj):
        return obj.created_by.username if obj.created_by else None

    def get_master_name(self, obj):
        return obj.master.name if obj.master else None


class DocumentBranchDetailSerializer(DocumentBranchListSerializer):
    """Full branch detail with the full document payload embedded."""
    document_data = serializers.SerializerMethodField()

    class Meta(DocumentBranchListSerializer.Meta):
        fields = DocumentBranchListSerializer.Meta.fields + ['document_data']

    def get_document_data(self, obj):
        if not obj.document:
            return None
        from .serializers import DocumentSerializer
        return DocumentSerializer(obj.document).data


# ─────────────────────────────────────────────────────────────────────────────
# Action serializers (input validation)
# ─────────────────────────────────────────────────────────────────────────────

class CreateBranchSerializer(serializers.Serializer):
    """
    Input for creating a branch from a master document.

    Required: branch_name
    Optional: metadata_overrides, style_overrides, title_override,
              include_content (default True), branch_notes
    """
    branch_name = serializers.CharField(max_length=255)
    branch_notes = serializers.CharField(required=False, allow_blank=True, default='')
    title_override = serializers.CharField(required=False, allow_blank=True, default='')
    metadata_overrides = serializers.JSONField(required=False, default=dict)
    style_overrides = serializers.JSONField(required=False, default=dict)
    custom_metadata_overrides = serializers.JSONField(required=False, default=dict)
    parties_override = serializers.JSONField(required=False, default=list)
    include_content = serializers.BooleanField(required=False, default=True)


class DuplicateDocumentSerializer(serializers.Serializer):
    """
    Input for duplicating an arbitrary document (not necessarily from a master).

    Required: source_document (UUID of the document to copy)
    Optional: title, metadata_overrides, include_structure (copy sections/paragraphs)
    """
    source_document = serializers.UUIDField()
    title = serializers.CharField(required=False, allow_blank=True, default='')
    branch_name = serializers.CharField(required=False, allow_blank=True, default='')
    metadata_overrides = serializers.JSONField(required=False, default=dict)
    custom_metadata_overrides = serializers.JSONField(required=False, default=dict)
    include_structure = serializers.BooleanField(required=False, default=True)
    include_images = serializers.BooleanField(required=False, default=False)
    duplicate_notes = serializers.CharField(required=False, allow_blank=True, default='')


class AIGenerateMasterSerializer(serializers.Serializer):
    """
    Input for AI-assisted master document creation.

    Provide either `prompt` (free-form text describing the document you want)
    or `raw_text` (existing text to structure), plus optional master-level fields.
    """
    # One of these is required
    prompt = serializers.CharField(required=False, allow_blank=True, default='')
    raw_text = serializers.CharField(required=False, allow_blank=True, default='')

    # Master document fields
    name = serializers.CharField(required=False, allow_blank=True, default='')
    description = serializers.CharField(required=False, allow_blank=True, default='')
    category = serializers.CharField(required=False, default='contract')
    document_type = serializers.CharField(required=False, default='contract')
    tags = serializers.JSONField(required=False, default=list)
    default_metadata = serializers.JSONField(required=False, default=dict)
    default_parties = serializers.JSONField(required=False, default=list)
    style_preset = serializers.JSONField(required=False, default=dict)
    ai_system_prompt = serializers.CharField(required=False, allow_blank=True, default='')

    def validate(self, attrs):
        if not attrs.get('prompt') and not attrs.get('raw_text'):
            raise serializers.ValidationError(
                "Either 'prompt' or 'raw_text' must be provided."
            )
        return attrs


class AIGenerateBranchContentSerializer(serializers.Serializer):
    """
    Input for AI-assisted content generation on a branch.
    """
    prompt = serializers.CharField(
        help_text="Describe the modifications / content to generate for this branch"
    )
    merge_strategy = serializers.ChoiceField(
        choices=['replace', 'append', 'merge_sections'],
        default='replace',
        required=False,
    )


class BranchSearchSerializer(serializers.Serializer):
    """Query params for searching masters & branches."""
    q = serializers.CharField(required=False, allow_blank=True, default='')
    category = serializers.CharField(required=False, allow_blank=True, default='')
    document_type = serializers.CharField(required=False, allow_blank=True, default='')
    tags = serializers.CharField(required=False, allow_blank=True, default='',
                                 help_text="Comma-separated tags")
    created_by = serializers.CharField(required=False, allow_blank=True, default='')
    include_public = serializers.BooleanField(required=False, default=True)
    ordering = serializers.ChoiceField(
        choices=['name', '-name', 'created_at', '-created_at',
                 'updated_at', '-updated_at', 'branch_count', '-branch_count'],
        default='-updated_at',
        required=False,
    )
