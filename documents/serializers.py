from rest_framework import serializers
from .models import (
    Document, Section, Paragraph, Sentence, Issue, ChangeLog, DocumentVersion,
    DocumentImage, DocumentAttachment, 
    Table, ImageComponent, DocumentFile, DocumentFileComponent,
    DocumentScore, SectionReference, LatexCode,
    ParagraphHistory
)
from .latexcode_serializers import LatexCodeSerializer
import re
import uuid


def parse_images_from_text(text):
    """
    Parse inline image markers from text.
    
    Format: {{image:image_ref_id:inline_id|alt_text}}
    Example: "Here is the diagram {{image:doc-img-uuid:inline-uuid|Architecture Diagram}} shown above."
    
    Returns list of dicts with parsed image data including metadata.
    """
    if not text:
        return []
    
    # Pattern: {{image:image_ref_id:inline_id|alt_text}}
    # image_ref_id: UUID of DocumentImage (the actual image file)
    # inline_id: UUID of InlineImage metadata record (positioning, sizing, etc.)
    # alt_text: Display text/caption for accessibility
    pattern = r"\{\{image:(?P<image_ref>[^:]+):(?P<inline_id>[^\|]+)\|(?P<alt>[^\}]+)\}\}"
    matches = re.finditer(pattern, text)
    
    images = []
    for match in matches:
        images.append({
            'image_ref_id': match.group('image_ref'),  # DocumentImage UUID
            'inline_id': match.group('inline_id'),     # InlineImage UUID (metadata)
            'alt_text': match.group('alt'),
            'marker': match.group(0),  # Full marker text
            'start': match.start(),
            'end': match.end()
        })
    
    return images


class ParagraphHistorySerializer(serializers.ModelSerializer):
    """Read-only serializer for paragraph edit history timeline."""
    changed_by_username = serializers.SerializerMethodField()
    changed_by_display = serializers.SerializerMethodField()

    class Meta:
        model = ParagraphHistory
        fields = [
            'id', 'paragraph', 'content_snapshot', 'previous_content',
            'change_type', 'change_summary', 'changed_by', 'changed_by_username',
            'changed_by_display', 'created_at', 'metadata_snapshot',
        ]
        read_only_fields = fields

    def get_changed_by_username(self, obj):
        return obj.changed_by.username if obj.changed_by else None

    def get_changed_by_display(self, obj):
        if not obj.changed_by:
            return 'System'
        full = obj.changed_by.get_full_name()
        return full if full.strip() else obj.changed_by.username


class ParagraphWithReferencesSerializer(serializers.ModelSerializer):
    """
    Paragraph serializer (inline reference system has been removed).
    """
    content = serializers.SerializerMethodField()
    
    class Meta:
        model = Paragraph
        fields = [
            'id', 'section', 'content', 'has_edits', 'order',
            'paragraph_type', 'topic'
        ]
        read_only_fields = ['id']
    
    def get_content(self, obj):
        """Get effective content (edited or original)"""
        return obj.get_effective_content()


class SentenceSerializer(serializers.ModelSerializer):
    content = serializers.SerializerMethodField()
    
    class Meta:
        model = Sentence
        fields = ['id', 'content', 'order', 'paragraph']
        read_only_fields = ['id']
    
    def get_content(self, obj):
        return {
            'start': obj.content_start,
            'end': obj.content_end,
            'text': obj.content_text
        }


class ParagraphSerializer(serializers.ModelSerializer):
    content = serializers.SerializerMethodField()
    sentences = SentenceSerializer(many=True, read_only=True)
    content_text = serializers.CharField(required=False, allow_blank=True)
    edited_text = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    # Client ID for frontend mapping
    client_id = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
        write_only=False,
        help_text="Client-side identifier for mapping responses back to local state"
    )
    section = serializers.PrimaryKeyRelatedField(
        queryset=Section.objects.all(),
        required=False,
        allow_null=True,
        help_text="Optional - can be set after creation"
    )
    
    class Meta:
        model = Paragraph
        fields = [
            'id', 'client_id', 'section', 'content', 'content_text', 'edited_text', 
            'has_edits', 'order', 'paragraph_type', 'topic', 'sentences'
        ]
        read_only_fields = ['id']
    
    def create(self, validated_data):
        """Create paragraph and preserve client_id for response."""
        # Extract client_id before creating (not a model field)
        client_id = validated_data.pop('client_id', None)
        
        instance = super().create(validated_data)
        
        # Store client_id temporarily for response
        if client_id:
            instance._client_id = client_id
        
        return instance
    
    def update(self, instance, validated_data):
        """Update paragraph and preserve client_id for response."""
        # Extract client_id before updating (not a model field)
        client_id = validated_data.pop('client_id', None)
        
        instance = super().update(instance, validated_data)
        
        # Store client_id temporarily for response
        if client_id:
            instance._client_id = client_id
        
        return instance
    
    def to_representation(self, instance):
        """Add client_id to response if available."""
        data = super().to_representation(instance)
        
        # Include client_id in response if it was provided
        if hasattr(instance, '_client_id') and instance._client_id:
            data['client_id'] = instance._client_id
        
        return data
    
    def get_content(self, obj):
        return obj.get_effective_content()


class TableSerializer(serializers.ModelSerializer):
    """
    Serializer for Table model with full data structure support.
    """
    # Client ID for frontend mapping
    client_id = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
        write_only=False,
        help_text="Client-side identifier for mapping responses back to local state"
    )
    
    class Meta:
        model = Table
        fields = [
            'id', 'client_id', 'section', 'title', 'description', 'num_columns', 'num_rows',
            'column_headers', 'table_data', 'table_config', 'table_type',
            'has_edits', 'original_data_backup', 'last_modified', 'modified_by',
            'edit_count', 'custom_metadata', 'order', 'is_complex', 'requires_validation'
        ]
        read_only_fields = ['id', 'last_modified', 'edit_count']
    
    def create(self, validated_data):
        """Create table and preserve client_id for response."""
        # Extract client_id before creating (not a model field)
        client_id = validated_data.pop('client_id', None)
        
        instance = super().create(validated_data)
        
        # Store client_id temporarily for response
        if client_id:
            instance._client_id = client_id
        
        return instance
    
    def update(self, instance, validated_data):
        """Update table and preserve client_id for response."""
        # Extract client_id before updating (not a model field)
        client_id = validated_data.pop('client_id', None)
        
        instance = super().update(instance, validated_data)
        
        # Store client_id temporarily for response
        if client_id:
            instance._client_id = client_id
        
        return instance
    
    def to_representation(self, instance):
        """Add client_id to response if available."""
        data = super().to_representation(instance)
        
        # Include client_id in response if it was provided
        if hasattr(instance, '_client_id') and instance._client_id:
            data['client_id'] = instance._client_id
        
        return data


class TableCreateSerializer(serializers.Serializer):
    """
    Serializer for creating a new table with initialization.
    """
    section_id = serializers.CharField(max_length=100)
    title = serializers.CharField(max_length=500, required=False, allow_blank=True, allow_null=True)
    description = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    num_columns = serializers.IntegerField(max_value=64, required=False, allow_null=True)
    num_rows = serializers.IntegerField(required=False, allow_null=True)
    column_labels = serializers.ListField(
        child=serializers.CharField(max_length=200),
        required=False,
        allow_null=True
    )
    table_type = serializers.ChoiceField(
        choices=['data', 'comparison', 'pricing', 'schedule', 'matrix', 'specifications', 'other'],
        default='data'
    )
    order = serializers.IntegerField(required=False, allow_null=True)
    
    def validate(self, data):
        """Set default values for num_columns and num_rows if not provided or invalid"""
        # Default num_columns to 2 if not provided or invalid
        if 'num_columns' not in data or data.get('num_columns') is None or data.get('num_columns', 0) < 1:
            data['num_columns'] = 2
        
        # Ensure num_columns doesn't exceed maximum
        if data['num_columns'] > 64:
            data['num_columns'] = 64
            
        # Default num_rows to 2 if not provided or invalid
        if 'num_rows' not in data or data.get('num_rows') is None or data.get('num_rows', 0) < 1:
            data['num_rows'] = 2
            
        return data


class ImageComponentSerializer(serializers.ModelSerializer):
    """
    Serializer for ImageComponent model.
    Provides image reference details and display properties.
    """
    image_url = serializers.SerializerMethodField()
    image_thumbnail_url = serializers.SerializerMethodField()
    image_name = serializers.SerializerMethodField()
    image_metadata = serializers.SerializerMethodField()
    display_style = serializers.SerializerMethodField()
    # Client ID for frontend mapping
    client_id = serializers.CharField(
        allow_blank=True,
        allow_null=True,
        write_only=False,
        help_text="Client-side identifier for mapping responses back to local state"
    )
    section = serializers.PrimaryKeyRelatedField(
        queryset=Section.objects.all(),
        required=False,
        allow_null=True,
        help_text="Optional - can be set after creation"
    )
    image_reference = serializers.PrimaryKeyRelatedField(
        queryset=DocumentImage.objects.all(),
        required=False,
        allow_null=True,
        help_text="Optional - can be set after creation"
    )
    
    class Meta:
        model = ImageComponent
        fields = [
            'id', 'client_id', 'section', 'image_reference', 'caption', 'alt_text', 'title',
            'figure_number', 'alignment', 'size_mode', 'custom_width_percent',
            'custom_width_pixels', 'custom_height_pixels', 'maintain_aspect_ratio',
            'margin_top', 'margin_bottom', 'margin_left', 'margin_right',
            'show_border', 'border_color', 'border_width', 'link_url',
            'component_type', 'is_visible', 'show_caption', 'show_figure_number',
            'last_modified', 'modified_by', 'created_by', 'created_at',
            'edit_count', 'custom_metadata', 'order',
            # Computed fields
            'image_url', 'image_thumbnail_url', 'image_name', 'image_metadata', 'display_style'
        ]
        read_only_fields = ['id', 'last_modified', 'created_at', 'edit_count',
                           'image_url', 'image_thumbnail_url', 'image_name', 
                           'image_metadata', 'display_style']
    
    def create(self, validated_data):
        """Create image component and preserve client_id for response."""
        # Extract client_id before creating (not a model field)
        client_id = validated_data.pop('client_id', None)
        
        instance = super().create(validated_data)
        
        # Store client_id temporarily for response
        if client_id:
            instance._client_id = client_id
        
        return instance
    
    def update(self, instance, validated_data):
        """Update image component and preserve client_id for response."""
        # Extract client_id before updating (not a model field)
        client_id = validated_data.pop('client_id', None)
        
        instance = super().update(instance, validated_data)
        
        # Store client_id temporarily for response
        if client_id:
            instance._client_id = client_id
        
        return instance
    
    def to_representation(self, instance):
        """Add client_id to response if available."""
        data = super().to_representation(instance)
        
        # Include client_id in response if it was provided
        if hasattr(instance, '_client_id') and instance._client_id:
            data['client_id'] = instance._client_id
        
        return data
    
    def get_image_url(self, obj):
        """Get the full URL of the referenced image."""
        if obj.image_reference and obj.image_reference.image:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.image_reference.image.url)
            return obj.image_reference.image.url
        return None
    
    def get_image_thumbnail_url(self, obj):
        """Get the thumbnail URL if available."""
        if obj.image_reference and obj.image_reference.thumbnail:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.image_reference.thumbnail.url)
            return obj.image_reference.thumbnail.url
        return None
    
    def get_image_name(self, obj):
        """Get the name of the referenced image."""
        if obj.image_reference:
            return obj.image_reference.name
        return None
    
    def get_image_metadata(self, obj):
        """Get metadata from the referenced DocumentImage."""
        if obj.image_reference:
            return {
                'width': obj.image_reference.width,
                'height': obj.image_reference.height,
                'file_size': obj.image_reference.file_size,
                'format': obj.image_reference.format,
                'mime_type': obj.image_reference.mime_type,
                'image_type': obj.image_reference.image_type,
            }
        return None
    
    def get_display_style(self, obj):
        """Get computed display style properties."""
        return obj.get_display_style()


class ImageComponentCreateSerializer(serializers.Serializer):
    """
    Serializer for creating a new image component.
    Simplified — no choices validation; accepts any string for alignment,
    size_mode, and component_type.
    """
    section_id = serializers.CharField(max_length=100)
    image_reference_id = serializers.UUIDField(
        help_text="ID of the DocumentImage to reference"
    )
    caption = serializers.CharField(max_length=500, required=False, allow_blank=True, allow_null=True)
    alt_text = serializers.CharField(max_length=255, required=False, allow_blank=True, allow_null=True)
    title = serializers.CharField(max_length=255, required=False, allow_blank=True, allow_null=True)
    figure_number = serializers.CharField(max_length=50, required=False, allow_blank=True, allow_null=True)
    alignment = serializers.CharField(max_length=20, required=False, default='center')
    size_mode = serializers.CharField(max_length=20, required=False, default='medium')
    custom_width_percent = serializers.FloatField(required=False, allow_null=True, min_value=0, max_value=100)
    custom_width_pixels = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    custom_height_pixels = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    maintain_aspect_ratio = serializers.BooleanField(default=True)
    component_type = serializers.CharField(max_length=50, required=False, default='figure')
    order = serializers.IntegerField(required=False, allow_null=True)
    show_border = serializers.BooleanField(default=False)
    show_caption = serializers.BooleanField(default=True)
    show_figure_number = serializers.BooleanField(default=False)
    link_url = serializers.URLField(required=False, allow_blank=True, allow_null=True)
    is_visible = serializers.BooleanField(default=True)
    custom_metadata = serializers.JSONField(required=False, default=dict)


class SectionSerializer(serializers.ModelSerializer):
    paragraphs = ParagraphSerializer(many=True, read_only=True)
    tables = TableSerializer(many=True, read_only=True)
    image_components = ImageComponentSerializer(many=True, read_only=True)
    file_components = serializers.SerializerMethodField()
    children = serializers.SerializerMethodField()
    content_text = serializers.CharField(required=False, allow_blank=True)
    edited_text = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    metadata = serializers.JSONField(source='custom_metadata', required=False)
    # Client ID for frontend mapping
    client_id = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
        write_only=False,
        help_text="Client-side identifier for mapping responses back to local state"
    )
    document = serializers.PrimaryKeyRelatedField(
        queryset=Document.objects.all(),
        required=False,
        allow_null=True,
        help_text="Optional - can be set after creation"
    )
    parent = serializers.PrimaryKeyRelatedField(
        queryset=Section.objects.all(),
        required=False,
        allow_null=True
    )
    
    class Meta:
        model = Section
        fields = [
            'id', 'client_id', 'document', 'parent', 'title', 'content_text', 'edited_text',
            'has_edits', 'section_type', 'order', 'depth_level', 'metadata', 'paragraphs', 'tables', 
            'image_components', 'file_components', 'children'
        ]
        read_only_fields = ['id']
    
    def create(self, validated_data):
        """Create section and preserve client_id for response."""
        # Extract client_id before creating (not a model field)
        client_id = validated_data.pop('client_id', None)
        
        instance = super().create(validated_data)
        
        # Store client_id temporarily for response
        if client_id:
            instance._client_id = client_id
        
        return instance
    
    def update(self, instance, validated_data):
        """Update section and preserve client_id for response."""
        # Extract client_id before updating (not a model field)
        client_id = validated_data.pop('client_id', None)
        
        instance = super().update(instance, validated_data)
        
        # Store client_id temporarily for response
        if client_id:
            instance._client_id = client_id
        
        return instance
    
    def to_representation(self, instance):
        """Add client_id to response if available."""
        data = super().to_representation(instance)

        # Paragraph-level metadata is no longer exposed
        data.pop('metadata', None)
        
        # Include client_id in response if it was provided
        if hasattr(instance, '_client_id') and instance._client_id:
            data['client_id'] = instance._client_id
        
        return data
    
    def get_file_components(self, obj):
        """Get file components for this section."""
        file_components = obj.file_components.all()
        return DocumentFileComponentSerializer(file_components, many=True, context=self.context).data
    
    def get_children(self, obj):
        children = obj.children.all()
        return SectionSerializer(children, many=True, context=self.context).data


class SectionReferenceSerializer(serializers.ModelSerializer):
    """
    Serializer for reading section references with full referenced section data.
    """
    referenced_section_data = serializers.SerializerMethodField()
    referenced_document_data = serializers.SerializerMethodField()
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    can_access = serializers.SerializerMethodField()
    
    class Meta:
        model = SectionReference
        fields = [
            'id', 'source_document', 'referenced_section', 'order',
            'position_description', 'created_by', 'created_by_username',
            'created_at', 'modified_at', 'note', 'include_full_content',
            'referenced_section_data', 'referenced_document_data', 'can_access'
        ]
        read_only_fields = ['id', 'created_at', 'modified_at']
    
    def get_referenced_section_data(self, obj):
        """Get detailed data about the referenced section."""
        section = obj.referenced_section
        return {
            'id': section.id,
            'title': section.title,
            'content': section.get_effective_content() if obj.include_full_content else section.title,
            'section_type': section.section_type,
            'order': section.order,
            'depth_level': section.depth_level,
            'has_edits': section.has_edits,
        }
    
    def get_referenced_document_data(self, obj):
        """Get data about the document containing the referenced section."""
        doc = obj.get_referenced_document()
        return {
            'id': str(doc.id),
            'title': doc.title,
            'created_by': doc.created_by.username if doc.created_by else None,
            'created_at': doc.created_at.isoformat() if hasattr(doc, 'created_at') else None,
        }
    
    def get_can_access(self, obj):
        """Check if the current user can access the referenced section."""
        request = self.context.get('request')
        if request and request.user:
            return obj.can_access(request.user)
        return False


class SectionReferenceCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating/updating section references with access control validation.
    """
    class Meta:
        model = SectionReference
        fields = [
            'id', 'source_document', 'referenced_section', 'order',
            'position_description', 'note', 'include_full_content'
        ]
        read_only_fields = ['id']
    
    def validate(self, data):
        """
        Validate that:
        1. User has access to both source and referenced documents
        2. Referenced section exists and is from a different document
        3. No circular references
        """
        request = self.context.get('request')
        user = request.user if request else None
        
        if not user:
            raise serializers.ValidationError("User must be authenticated")
        
        source_doc = data.get('source_document')
        referenced_section = data.get('referenced_section')
        
        # Import Share model and ContentType
        from django.contrib.contenttypes.models import ContentType
        from sharing.models import Share
        
        # Get Document content type
        doc_content_type = ContentType.objects.get_for_model(source_doc.__class__)
        
        # Check source document access
        source_access = (
            source_doc.created_by == user or
            Share.objects.filter(
                content_type=doc_content_type,
                object_id=str(source_doc.id),
                shared_with_user=user
            ).exists()
        )
        if not source_access:
            raise serializers.ValidationError({
                'source_document': 'You do not have access to this document'
            })
        
        # Check referenced document access
        referenced_doc = referenced_section.document
        referenced_access = (
            referenced_doc.created_by == user or
            Share.objects.filter(
                content_type=doc_content_type,
                object_id=str(referenced_doc.id),
                shared_with_user=user
            ).exists()
        )
        if not referenced_access:
            raise serializers.ValidationError({
                'referenced_section': 'You do not have access to the document containing this section'
            })
        
        # Prevent self-referencing (section from same document)
        if source_doc.id == referenced_doc.id:
            raise serializers.ValidationError({
                'referenced_section': 'Cannot reference a section from the same document'
            })
        
        # Check for duplicate reference (same section, same order)
        if not self.instance:  # Only check on create
            existing = SectionReference.objects.filter(
                source_document=source_doc,
                referenced_section=referenced_section,
                order=data.get('order', 0)
            ).exists()
            
            if existing:
                raise serializers.ValidationError({
                    'referenced_section': 'This section reference already exists at this position'
                })
        
        return data
    
    def create(self, validated_data):
        """Set the created_by field to the current user."""
        request = self.context.get('request')
        if request and request.user:
            validated_data['created_by'] = request.user
        return super().create(validated_data)


class IssueSerializer(serializers.ModelSerializer):
    location = serializers.SerializerMethodField()
    position = serializers.SerializerMethodField()
    
    class Meta:
        model = Issue
        fields = [
            'id', 'issue_type', 'severity', 'title', 
            'description', 'suggestion', 'location', 
            'position', 'status', 'detected_at', 'updated_at'
        ]
    
    def get_location(self, obj):
        return {
            'sectionId': obj.section.id if obj.section else None,
            'paragraphId': obj.paragraph.id if obj.paragraph else None
        }
    
    def get_position(self, obj):
        if obj.position_start is not None and obj.position_end is not None:
            return {
                'start': obj.position_start,
                'end': obj.position_end
            }
        return None


class DocumentSerializer(serializers.ModelSerializer):
    sections = SectionSerializer(many=True, read_only=True)
    issues = IssueSerializer(many=True, read_only=True)
    metadata = serializers.SerializerMethodField()
    
    class Meta:
        model = Document
        fields = [
            'id', 'title', 'raw_text', 'current_text',
            'document_mode',
            'is_latex_code', 'latex_code',
            'document_type', 'category', 'jurisdiction', 'governing_law',
            'author', 'parties', 'signatories',
            'effective_date', 'expiration_date', 'execution_date',
            'reference_number', 'project_name', 'term_length', 'auto_renewal',
            'custom_metadata', 'document_metadata',
            'sections', 'issues', 'metadata'
        ]
        read_only_fields = ['id', 'sections', 'issues', 'metadata']
        extra_kwargs = {
            'raw_text': {'required': False, 'default': ''},
            'current_text': {'required': False, 'default': ''},
            'document_type': {'required': False},
            'category': {'required': False},
            'jurisdiction': {'required': False, 'allow_blank': True, 'allow_null': True},
            'governing_law': {'required': False, 'allow_blank': True, 'allow_null': True},
            'author': {'required': False, 'allow_blank': True, 'allow_null': True},
            'parties': {'required': False},
            'signatories': {'required': False},
            'effective_date': {'required': False, 'allow_null': True},
            'expiration_date': {'required': False, 'allow_null': True},
            'execution_date': {'required': False, 'allow_null': True},
            'reference_number': {'required': False, 'allow_blank': True, 'allow_null': True},
            'project_name': {'required': False, 'allow_blank': True, 'allow_null': True},
            'term_length': {'required': False, 'allow_blank': True, 'allow_null': True},
            'auto_renewal': {'required': False},
            'custom_metadata': {'required': False},
            'document_metadata': {'required': False},
        }
    
    def get_metadata(self, obj):
        return {
            'createdAt': obj.created_at.isoformat(),
            'updatedAt': obj.updated_at.isoformat(),
            'type': obj.document_type,
            'author': obj.author,
            'version': obj.version,
            **obj.custom_metadata
        }


class DocumentScoreSerializer(serializers.ModelSerializer):
    created_by = serializers.StringRelatedField()
    document = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = DocumentScore
        fields = [
            'id', 'document', 'created_by', 'final_aggregated_score', 'overall_risk_category',
            'human_review_required', 'review_trigger_reason', 'review_priority',
            'core_score_dimensions', 'operational_commercial_intelligence',
            'clause_level_review', 'ai_governance_trust_metrics', 'score_rationale',
            'analysis_timestamp'
        ]
        read_only_fields = fields

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Optionally expose raw LLM payload if the client requested it
        include_raw = self.context.get('include_raw') if isinstance(self.context, dict) else False
        if include_raw:
            data['raw_llm_output'] = instance.raw_llm_output
            data['raw_llm_text'] = instance.raw_llm_text
        return data


class DocumentCreateSerializer(serializers.Serializer):
    content = serializers.CharField()
    type = serializers.CharField(required=False, default='text')
    title = serializers.CharField(required=False, default='Untitled Document')
    author = serializers.CharField(required=False, allow_blank=True)
    is_latex_code = serializers.BooleanField(required=False, default=False)
    latex_code = serializers.CharField(required=False, allow_blank=True)


class IssueUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=['accept', 'reject', 'ignore'])


class TemplateDocumentSerializer(serializers.Serializer):
    """Serializer for creating documents from templates"""
    template_name = serializers.ChoiceField(
        choices=['service_agreement', 'nda', 'employment_contract', 'lease_agreement', 'licensing_agreement']
    )
    title = serializers.CharField(required=False)
    metadata = serializers.JSONField(required=False, default=dict)
    replacements = serializers.JSONField(required=False, default=dict)


class StructuredDocumentSerializer(serializers.Serializer):
    """Serializer for creating custom structured documents"""
    title = serializers.CharField()
    sections = serializers.ListField(
        child=serializers.DictField(),
        help_text="List of sections with 'title' and 'content' or 'paragraphs'"
    )
    metadata = serializers.JSONField(required=False, default=dict)


class ChangeLogSerializer(serializers.ModelSerializer):
    """Serializer for document change history"""
    changed_by = serializers.StringRelatedField()
    
    class Meta:
        model = ChangeLog
        fields = [
            'id', 'document', 'changed_by', 'changed_at',
            'change_type', 'section_id', 'paragraph_id',
            'description', 'old_value', 'new_value'
        ]
        read_only_fields = ['id', 'changed_at']


class DocumentVersionSerializer(serializers.ModelSerializer):
    """Serializer for document versions"""
    created_by = serializers.StringRelatedField()
    
    class Meta:
        model = DocumentVersion
        fields = [
            'id', 'document', 'version_name', 'content_snapshot',
            'created_by', 'created_at', 'notes'
        ]
        read_only_fields = ['id', 'created_at']


class FullDocumentEditSerializer(serializers.Serializer):
    """
    Comprehensive serializer for editing all document fields in one request.
    Supports metadata, images, attachments, sections, paragraphs, and all other fields.
    """
    # Core Metadata
    title = serializers.CharField(required=False)
    author = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    version = serializers.CharField(required=False)
    document_type = serializers.CharField(required=False)
    
    # Version Management
    version_number = serializers.IntegerField(required=False)
    major_version = serializers.IntegerField(required=False)
    minor_version = serializers.IntegerField(required=False)
    patch_version = serializers.IntegerField(required=False)
    is_draft = serializers.BooleanField(required=False)
    version_label = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    version_notes = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    
    # Parties and Stakeholders
    parties = serializers.JSONField(required=False)
    signatories = serializers.JSONField(required=False)
    
    # Document Structure Metadata
    effective_date = serializers.DateField(required=False, allow_null=True)
    expiration_date = serializers.DateField(required=False, allow_null=True)
    execution_date = serializers.DateField(required=False, allow_null=True)
    governing_law = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    
    # Header Information
    reference_number = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    project_name = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    
    # Financial Terms
    contract_value = serializers.DecimalField(max_digits=15, decimal_places=2, required=False, allow_null=True)
    currency = serializers.CharField(required=False)
    payment_terms = serializers.JSONField(required=False)
    
    # Term and Renewal
    term_length = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    auto_renewal = serializers.BooleanField(required=False)
    renewal_terms = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    notice_period = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    
    # Legal Provisions
    liability_cap = serializers.DecimalField(max_digits=15, decimal_places=2, required=False, allow_null=True)
    indemnification_clauses = serializers.JSONField(required=False)
    insurance_requirements = serializers.JSONField(required=False)
    
    # Termination and Exit
    termination_clauses = serializers.JSONField(required=False)
    termination_for_convenience = serializers.BooleanField(required=False)
    
    # Compliance and Regulations
    regulatory_requirements = serializers.JSONField(required=False)
    compliance_certifications = serializers.JSONField(required=False)
    
    # Confidentiality
    confidentiality_period = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    nda_type = serializers.ChoiceField(
        choices=['mutual', 'unilateral', 'none'],
        required=False,
        allow_null=True
    )
    
    # Dispute Resolution
    dispute_resolution_method = serializers.ChoiceField(
        choices=['arbitration', 'mediation', 'litigation', 'negotiation'],
        required=False,
        allow_null=True
    )
    arbitration_location = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    
    # Document Classification
    category = serializers.ChoiceField(
        choices=['contract', 'policy', 'regulation', 'legal_brief', 'terms', 'nda', 'license', 'other'],
        required=False
    )
    jurisdiction = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    status = serializers.ChoiceField(
        choices=['draft', 'under_review', 'done'],
        required=False
    )
    
    # File Upload and Attachments
    source_file_name = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    source_file_type = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    source_file_size = serializers.IntegerField(required=False, allow_null=True)
    attachments = serializers.JSONField(required=False)
    
    # Scanned/Image documents
    is_scanned = serializers.BooleanField(required=False)
    ocr_confidence = serializers.FloatField(required=False, allow_null=True)
    page_count = serializers.IntegerField(required=False, allow_null=True)
    
    # Document Images (UUIDs to link existing images or upload new ones)
    logo_image_id = serializers.UUIDField(required=False, allow_null=True)
    watermark_image_id = serializers.UUIDField(required=False, allow_null=True)
    background_image_id = serializers.UUIDField(required=False, allow_null=True)
    header_icon_id = serializers.UUIDField(required=False, allow_null=True)
    footer_icon_id = serializers.UUIDField(required=False, allow_null=True)
    
    # Custom metadata
    custom_metadata = serializers.JSONField(required=False)
    
    # Related documents
    related_documents = serializers.JSONField(required=False)
    
    # Auto-save
    auto_save_enabled = serializers.BooleanField(required=False)
    
    # Change summary for this edit
    change_summary = serializers.CharField(required=False, allow_blank=True)


# ============ IMAGE UPLOAD SERIALIZERS ============

class DocumentImageSerializer(serializers.ModelSerializer):
    """Serializer for image uploads and retrieval."""
    
    url = serializers.SerializerMethodField()
    thumbnail_url = serializers.SerializerMethodField()
    type_display = serializers.SerializerMethodField()
    uploaded_by_username = serializers.SerializerMethodField()
    scope_display = serializers.SerializerMethodField()
    team_name = serializers.SerializerMethodField()
    organization_name = serializers.SerializerMethodField()
    
    class Meta:
        model = DocumentImage
        fields = [
            'id', 'name', 'image_type', 'type_display', 'caption', 'description',
            'image', 'thumbnail', 'url', 'thumbnail_url',
            'width', 'height', 'file_size', 'format', 'mime_type',
            'document',
            'uploaded_by', 'uploaded_by_username', 'uploaded_at', 'updated_at',
            'is_public', 'usage_count', 'last_used_at', 'tags', 'metadata',
            'scope', 'scope_display', 'organization', 'organization_name',
            'team', 'team_name',
        ]
        read_only_fields = [
            'id', 'url', 'thumbnail_url', 'type_display',
            'width', 'height', 'file_size', 'format', 'mime_type',
            'uploaded_at', 'updated_at', 'usage_count', 'last_used_at',
            'uploaded_by', 'uploaded_by_username',
            'scope_display', 'organization_name', 'team_name',
        ]
    
    def get_url(self, obj):
        return obj.get_url()
    
    def get_thumbnail_url(self, obj):
        return obj.get_thumbnail_url()
    
    def get_type_display(self, obj):
        return obj.get_image_type_display()
    
    def get_uploaded_by_username(self, obj):
        return obj.uploaded_by.username if obj.uploaded_by else None
    
    def get_scope_display(self, obj):
        return obj.get_scope_display() if hasattr(obj, 'get_scope_display') else obj.scope
    
    def get_team_name(self, obj):
        return obj.team.name if obj.team else None
    
    def get_organization_name(self, obj):
        return obj.organization.name if obj.organization else None
    
    def create(self, validated_data):
        """Auto-set uploaded_by from request context."""
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            validated_data['uploaded_by'] = request.user
        return super().create(validated_data)


class ImageUploadSerializer(serializers.ModelSerializer):
    """Simplified serializer for image uploads."""
    
    class Meta:
        model = DocumentImage
        fields = [
            'name', 'image_type', 'image', 'caption', 'description',
            'document', 'is_public', 'tags', 'scope', 'team',
        ]
    
    def validate_image(self, value):
        """Validate image file."""
        # Check file size (max 10MB)
        max_size = 10 * 1024 * 1024  # 10MB
        if value.size > max_size:
            raise serializers.ValidationError(
                f"Image file too large. Maximum size is 10MB. Your file is {value.size / (1024*1024):.2f}MB"
            )
        
        # Check file type
        allowed_types = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
        content_type = getattr(value, 'content_type', '')
        if content_type and content_type not in allowed_types:
            raise serializers.ValidationError(
                f"Invalid image type. Allowed types: JPEG, PNG, GIF, WEBP. Got: {content_type}"
            )
        
        return value
    
    def create(self, validated_data):
        """Auto-set uploaded_by from request context."""
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            validated_data['uploaded_by'] = request.user
        return super().create(validated_data)


class ImageListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for listing images."""
    
    url = serializers.SerializerMethodField()
    thumbnail_url = serializers.SerializerMethodField()
    type_display = serializers.SerializerMethodField()
    
    class Meta:
        model = DocumentImage
        fields = [
            'id', 'name', 'image_type', 'type_display', 'caption',
            'url', 'thumbnail_url', 'width', 'height', 'file_size',
            'uploaded_at', 'usage_count', 'is_public', 'tags'
        ]
    
    def get_url(self, obj):
        return obj.get_url()
    
    def get_thumbnail_url(self, obj):
        return obj.get_thumbnail_url()
    
    def get_type_display(self, obj):
        return obj.get_image_type_display()


class DocumentReferenceSerializer(serializers.Serializer):
    """Serializer for referenced documents with minimal info"""
    id = serializers.UUIDField()
    title = serializers.CharField()
    document_type = serializers.CharField()
    reference_number = serializers.CharField()
    version = serializers.CharField()


class SectionWithAllContentSerializer(serializers.ModelSerializer):
    """
    Section serializer with ALL content components:
    - Paragraphs
    - Tables
    - Image components
    - Document file components
    - Nested child sections
    """
    paragraphs = ParagraphSerializer(many=True, read_only=True)
    latex_codes = serializers.SerializerMethodField()
    tables = serializers.SerializerMethodField()
    image_components = serializers.SerializerMethodField()
    file_components = serializers.SerializerMethodField()
    children = serializers.SerializerMethodField()
    content_text = serializers.CharField(required=False, allow_blank=True)
    edited_text = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    metadata = serializers.JSONField(source='custom_metadata', required=False)
    
    class Meta:
        model = Section
        fields = [
            'id', 'document', 'parent', 'title', 'content_text', 'edited_text',
            'has_edits', 'section_type', 'order', 'depth_level', 'metadata',
            'paragraphs', 'latex_codes', 'tables', 'image_components', 'file_components', 'children'
        ]
        read_only_fields = ['id']
    
    def get_tables(self, obj):
        """Get all tables in this section"""
        from .models import Table
        tables = Table.objects.filter(section=obj).order_by('order')
        return TableSerializer(tables, many=True).data

    def get_latex_codes(self, obj):
        """Get all LaTeX code blocks in this section"""
        codes = LatexCode.objects.filter(section=obj).order_by('order', 'id')
        return LatexCodeSerializer(codes, many=True, context=self.context).data
    
    def get_image_components(self, obj):
        """Get all image components in this section"""
        from .models import ImageComponent
        components = ImageComponent.objects.filter(section=obj).order_by('order')
        request = self.context.get('request')
        
        result = []
        for comp in components:
            data = {
                'id': comp.id,
                'image_reference': comp.image_reference.id if comp.image_reference else None,
                'caption': comp.caption,
                'alt_text': comp.alt_text,
                'title': comp.title,
                'figure_number': comp.figure_number,
                'alignment': comp.alignment,
                'size_mode': comp.size_mode,
                'custom_width_percent': comp.custom_width_percent,
                'custom_width_pixels': comp.custom_width_pixels,
                'custom_height_pixels': comp.custom_height_pixels,
                'maintain_aspect_ratio': comp.maintain_aspect_ratio,
                'margin_top': comp.margin_top,
                'margin_bottom': comp.margin_bottom,
                'margin_left': comp.margin_left,
                'margin_right': comp.margin_right,
                'show_border': comp.show_border,
                'border_color': comp.border_color,
                'border_width': comp.border_width,
                'link_url': comp.link_url,
                'component_type': comp.component_type,
                'order': comp.order,
                'is_visible': comp.is_visible,
                'show_caption': comp.show_caption,
                'show_figure_number': comp.show_figure_number,
                'custom_metadata': comp.custom_metadata or {},
                'display_style': comp.get_display_style(),
                'image_url': None,
                'image_thumbnail_url': None,
                'image_name': None,
                'image_size': None,
                'image_type': None
            }
            
            if comp.image_reference and comp.image_reference.image:
                if request:
                    data['image_url'] = request.build_absolute_uri(comp.image_reference.image.url)
                    if comp.image_reference.thumbnail:
                        data['image_thumbnail_url'] = request.build_absolute_uri(comp.image_reference.thumbnail.url)
                else:
                    data['image_url'] = comp.image_reference.image.url
                    if comp.image_reference.thumbnail:
                        data['image_thumbnail_url'] = comp.image_reference.thumbnail.url
                data['image_name'] = comp.image_reference.name
                data['image_size'] = comp.image_reference.file_size
                data['image_type'] = comp.image_reference.image_type
            
            result.append(data)
        
        return result
    
    def get_file_components(self, obj):
        """Get all document file components in this section"""
        from .models import DocumentFileComponent
        components = DocumentFileComponent.objects.filter(section=obj).order_by('order')
        request = self.context.get('request')
        
        result = []
        for comp in components:
            data = {
                'id': comp.id,
                'file_reference_id': str(comp.file_reference_id) if comp.file_reference_id else None,
                'label': comp.label,
                'description': comp.description,
                'reference_number': comp.reference_number,
                'display_mode': comp.display_mode,
                'alignment': comp.alignment,
                'order': comp.order,
                'is_visible': comp.is_visible,
                'page_range': comp.page_range,
                'show_filename': comp.show_filename,
                'show_file_size': comp.show_file_size,
                'show_file_type': comp.show_file_type,
                'show_download_button': comp.show_download_button,
                'file_url': None,
                'file_name': None,
                'file_type': None,
                'file_size': None
            }
            
            if comp.file_reference and comp.file_reference.file:
                if request:
                    data['file_url'] = request.build_absolute_uri(comp.file_reference.file.url)
                else:
                    data['file_url'] = comp.file_reference.file.url
                data['file_name'] = comp.file_reference.name
                data['file_type'] = comp.file_reference.file_type
                data['file_size'] = comp.file_reference.file_size
            
            result.append(data)
        
        return result
    
    def get_children(self, obj):
        children = obj.children.all()
        return SectionWithAllContentSerializer(children, many=True, context=self.context).data

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data.pop('metadata', None)
        return data


class CompleteDocumentSerializer(serializers.ModelSerializer):
    """
    Complete document serializer with ALL elements for fast frontend rendering:
    - All sections with nested hierarchy (with tables, images, files)
    - All paragraphs with sentences
    - All inline images with absolute URLs
    - All document images (logo, watermark, etc.)
    - All attachments
    - All inline comments
    - Document metadata
    - Referenced documents
    - Issues/suggestions
    """
    sections = SectionWithAllContentSerializer(many=True, read_only=True)
    issues = IssueSerializer(many=True, read_only=True)
    
    # Document Images with absolute URLs
    logo_url = serializers.SerializerMethodField()
    watermark_url = serializers.SerializerMethodField()
    header_icon_url = serializers.SerializerMethodField()
    footer_icon_url = serializers.SerializerMethodField()
    background_image_url = serializers.SerializerMethodField()
    
    # Attachments
    attachments = serializers.SerializerMethodField()
    
    # Inline Comments
    comments = serializers.SerializerMethodField()
    
    # Referenced documents
    referenced_documents = serializers.SerializerMethodField()
    
    # Section references
    section_references = serializers.SerializerMethodField()

    # LaTeX code blocks
    latex_codes = serializers.SerializerMethodField()
    
    # Complete metadata
    metadata = serializers.SerializerMethodField()
    
    # Stats
    stats = serializers.SerializerMethodField()
    
    class Meta:
        model = Document
        fields = [
            # Core fields
            'id', 'title', 'raw_text', 'author', 'version', 'document_type',
            'document_mode',

            # Nested data
            'sections', 'issues', 'latex_codes',
            
            # Image URLs (SerializerMethodField)
            'logo_url', 'watermark_url', 'header_icon_url', 'footer_icon_url', 'background_image_url',
            
            # Computed fields (SerializerMethodField)
            'attachments', 'comments', 'referenced_documents', 'section_references', 'latex_codes', 'metadata', 'stats',
            
            # Actual model fields
            'effective_date', 'expiration_date', 'execution_date', 'governing_law',
            'reference_number', 'project_name', 'term_length', 'auto_renewal', 'renewal_terms',
            'jurisdiction', 'is_scanned', 'parties', 'signatories', 'related_documents',
            'custom_metadata', 'document_metadata', 'category', 'status', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']
    
    def get_logo_url(self, obj):
        if obj.logo_image and obj.logo_image.image:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.logo_image.image.url)
            return obj.logo_image.image.url
        return None
    
    def get_watermark_url(self, obj):
        if obj.watermark_image and obj.watermark_image.image:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.watermark_image.image.url)
            return obj.watermark_image.image.url
        return None
    
    def get_header_icon_url(self, obj):
        # Safe access: older Document instances may not have header_icon attribute.
        header_icon = getattr(obj, 'header_icon', None)
        if header_icon and getattr(header_icon, 'image', None):
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(header_icon.image.url)
            return header_icon.image.url

        # Fallback: check document override config or template icons
        try:
            # Prefer explicit override config first
            config = obj.get_effective_header_config() if hasattr(obj, 'get_effective_header_config') else {}
            icons = config.get('icons') if isinstance(config, dict) else None
            if icons:
                # Take first valid icon that resolves to a DocumentImage
                for icon_cfg in icons:
                    image_id = icon_cfg.get('image_id')
                    if not image_id:
                        continue
                    try:
                        img = DocumentImage.objects.get(id=image_id)
                        if img and getattr(img, 'image', None):
                            request = self.context.get('request')
                            return request.build_absolute_uri(img.image.url) if request else img.image.url
                    except Exception:
                        continue

            # As a last resort, if a header_template is set, use its first icon
            if getattr(obj, 'header_template', None):
                icons_with_images = obj.header_template.get_icons() if hasattr(obj.header_template, 'get_icons') else []
                if icons_with_images:
                    first = icons_with_images[0].get('image') if isinstance(icons_with_images[0], dict) else None
                    if first and getattr(first, 'image', None):
                        request = self.context.get('request')
                        return request.build_absolute_uri(first.image.url) if request else first.image.url
        except Exception:
            # Fail silently and return None for compatibility
            pass

        return None
    
    def get_footer_icon_url(self, obj):
        footer_icon = getattr(obj, 'footer_icon', None)
        if footer_icon and getattr(footer_icon, 'image', None):
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(footer_icon.image.url)
            return footer_icon.image.url

        try:
            config = obj.get_effective_footer_config() if hasattr(obj, 'get_effective_footer_config') else {}
            icons = config.get('icons') if isinstance(config, dict) else None
            if icons:
                for icon_cfg in icons:
                    image_id = icon_cfg.get('image_id')
                    if not image_id:
                        continue
                    try:
                        img = DocumentImage.objects.get(id=image_id)
                        if img and getattr(img, 'image', None):
                            request = self.context.get('request')
                            return request.build_absolute_uri(img.image.url) if request else img.image.url
                    except Exception:
                        continue

            if getattr(obj, 'footer_template', None):
                icons_with_images = obj.footer_template.get_icons() if hasattr(obj.footer_template, 'get_icons') else []
                if icons_with_images:
                    first = icons_with_images[0].get('image') if isinstance(icons_with_images[0], dict) else None
                    if first and getattr(first, 'image', None):
                        request = self.context.get('request')
                        return request.build_absolute_uri(first.image.url) if request else first.image.url
        except Exception:
            pass

        return None
    
    def get_background_image_url(self, obj):
        if obj.background_image and obj.background_image.image:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.background_image.image.url)
            return obj.background_image.image.url
        return None
    
    def get_attachments(self, obj):
        """Get all attachments with download URLs"""
        attachments = DocumentAttachment.objects.filter(document=obj)
        request = self.context.get('request')
        
        return [{
            'id': str(att.id),
            'name': att.name,
            'file_name': att.file_name,
            'file_type': att.file_type,
            'file_size': att.file_size,
            'attachment_type': att.attachment_type,
            'description': att.description,
            'is_required': att.is_required,
            'reference_in_document': att.reference_in_document,
            'url': request.build_absolute_uri(att.file.url) if request else att.file.url,
            'uploaded_at': att.uploaded_at.isoformat(),
            'uploaded_by': str(att.uploaded_by) if att.uploaded_by else None
        } for att in attachments]
    
    def get_comments(self, obj):
        """
        Get all inline comments on references in this document.
        (Inline reference system has been removed - returns empty list)
        """
        return []
    
    def get_referenced_documents(self, obj):
        """Get referenced/related documents"""
        if obj.related_documents:
            from .models import Document as DocModel
            doc_ids = obj.related_documents
            if isinstance(doc_ids, list):
                # If it's a list of dicts (new format)
                if doc_ids and isinstance(doc_ids[0], dict):
                    return doc_ids
                # If it's a list of UUIDs (old format)
                docs = DocModel.objects.filter(id__in=doc_ids).values(
                    'id', 'title', 'document_type', 'reference_number', 'version'
                )
                return list(docs)
        return []

    def get_latex_codes(self, obj):
        codes = (
            LatexCode.objects.filter(section__document=obj)
            .select_related('section')
            .order_by('section__order', 'order', 'id')
        )
        return LatexCodeSerializer(codes, many=True, context=self.context).data
    
    def get_metadata(self, obj):
        """Complete metadata including timestamps and version info"""
        metadata = {
            'created_at': obj.created_at.isoformat() if obj.created_at else None,
            'updated_at': obj.updated_at.isoformat() if obj.updated_at else None,
            'created_by': str(obj.created_by) if obj.created_by else None,
            'last_modified_by': str(obj.last_modified_by) if obj.last_modified_by else None,
            'version_number': obj.version_number,
            'major_version': obj.major_version,
            'minor_version': obj.minor_version,
            'patch_version': obj.patch_version,
            'is_draft': obj.is_draft,
            'version_label': obj.version_label,
            'version_notes': obj.version_notes,
            'auto_save_enabled': obj.auto_save_enabled,
            'document_metadata': obj.document_metadata or {},
            'custom_metadata': obj.custom_metadata or {}
        }
        
        # Add word count if it exists in the paragraph/sentence model
        # Since Document model doesn't have word_count directly
        if obj.raw_text:
            metadata['word_count'] = len(obj.raw_text.split())
        
        return metadata
    
    def get_section_references(self, obj):
        """
        Get all section references for this document with full referenced section data.
        Only includes references where the user has access to both documents.
        """
        request = self.context.get('request')
        user = request.user if request and hasattr(request, 'user') else None
        
        if not user or not user.is_authenticated:
            return []
        
        # Get all section references for this document
        references = obj.section_references.select_related(
            'referenced_section',
            'referenced_section__document',
            'created_by'
        ).order_by('order')
        
        # Filter to only include references user can access
        accessible_refs = []
        for ref in references:
            if ref.can_access(user):
                accessible_refs.append({
                    'id': str(ref.id),
                    'order': ref.order,
                    'position_description': ref.position_description,
                    'note': ref.note,
                    'include_full_content': ref.include_full_content,
                    'created_at': ref.created_at.isoformat(),
                    'created_by': ref.created_by.username if ref.created_by else None,
                    'referenced_section': {
                        'id': ref.referenced_section.id,
                        'title': ref.referenced_section.title,
                        'content': ref.referenced_section.get_effective_content() if ref.include_full_content else None,
                        'section_type': ref.referenced_section.section_type,
                        'order': ref.referenced_section.order,
                    },
                    'referenced_document': {
                        'id': str(ref.referenced_section.document.id),
                        'title': ref.referenced_section.document.title,
                        'created_by': ref.referenced_section.document.created_by.username if ref.referenced_section.document.created_by else None,
                    }
                })
        
        return accessible_refs
    
    def get_stats(self, obj):
        """Document statistics with comprehensive counts"""
        from .models import Table, ImageComponent, DocumentFileComponent
        
        sections_count = obj.sections.count()
        paragraphs_count = Paragraph.objects.filter(section__document=obj).count()
        
        # Get all sections for filtering components
        sections = obj.sections.all()
        
        # Count components
        tables_count = Table.objects.filter(section__in=sections).count()
        image_components_count = ImageComponent.objects.filter(section__in=sections).count()
        file_components_count = DocumentFileComponent.objects.filter(section__in=sections).count()
        
        issues_count = obj.issues.count()
        
        return {
            'sections_count': sections_count,
            'paragraphs_count': paragraphs_count,
            'tables_count': tables_count,
            'image_components_count': image_components_count,
            'file_components_count': file_components_count,
            'comments_count': 0,  # Inline reference system removed
            'issues_count': issues_count,
            'word_count': len(obj.raw_text.split()) if obj.raw_text else 0,
            'has_attachments': DocumentAttachment.objects.filter(document=obj).exists()
        }


# ============================================================================
class PartialSectionSerializer(serializers.ModelSerializer):
    metadata = serializers.JSONField(source='custom_metadata', required=False)
    document = serializers.PrimaryKeyRelatedField(read_only=True)
    parent = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Section
        fields = [
            'id', 'document', 'parent', 'title', 'content_text', 'edited_text',
            'has_edits', 'section_type', 'order', 'depth_level', 'metadata',
            'version', 'last_modified'
        ]


class PartialParagraphSerializer(serializers.ModelSerializer):
    section = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Paragraph
        fields = [
            'id', 'section', 'content_text', 'edited_text', 'has_edits', 'order',
            'paragraph_type', 'topic', 'last_modified', 'edit_count'
        ]


class PartialTableSerializer(serializers.ModelSerializer):
    metadata = serializers.JSONField(source='custom_metadata', required=False)
    section = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Table
        fields = [
            'id', 'section', 'title', 'description', 'num_columns', 'num_rows',
            'column_headers', 'table_data', 'table_config', 'table_type', 'order',
            'metadata', 'last_modified', 'edit_count', 'has_edits'
        ]


class PartialImageComponentSerializer(serializers.ModelSerializer):
    metadata = serializers.JSONField(source='custom_metadata', required=False)
    section = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = ImageComponent
        fields = [
            'id', 'section', 'image_reference', 'caption', 'alt_text', 'title',
            'figure_number', 'alignment', 'size_mode', 'custom_width_percent',
            'custom_width_pixels', 'custom_height_pixels', 'maintain_aspect_ratio',
            'component_type', 'order', 'show_border', 'link_url', 'metadata',
            'last_modified', 'edit_count', 'is_visible'
        ]


class PartialFileComponentSerializer(serializers.ModelSerializer):
    metadata = serializers.JSONField(source='custom_metadata', required=False)
    section = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = DocumentFileComponent
        fields = [
            'id', 'section', 'file_reference', 'label', 'description',
            'reference_number', 'display_mode', 'alignment', 'width_percent',
            'height_pixels', 'margin_top', 'margin_bottom', 'page_range',
            'show_filename', 'show_file_size', 'show_file_type',
            'show_download_button', 'show_preview', 'open_in_new_tab',
            'is_visible', 'metadata', 'order', 'last_modified', 'edit_count'
        ]


class PartialDocumentSerializer(serializers.ModelSerializer):
    """
    Lightweight document serializer for partial-save responses.
    Excludes nested sections/issues to keep payloads small.
    """
    class Meta:
        model = Document
        fields = [
            'id', 'title', 'document_type', 'author', 'status',
            'custom_metadata', 'document_metadata',
            'updated_at',
        ]
        read_only_fields = ['id', 'updated_at']
    
    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Safely handle missing status field
        if 'status' in data and data['status'] is None:
            data.pop('status', None)
        return data


# ============================================================================
# DOCUMENT GRAPH SERIALIZER - Complete hierarchical structure for AI/Frontend
# ============================================================================

class DocumentGraphSentenceSerializer(serializers.ModelSerializer):
    """Optimized sentence serializer for graph representation"""
    
    class Meta:
        model = Sentence
        fields = [
            'id', 'content_text', 'word_count', 'order',
            'contains_legal_term', 'is_obligation', 'is_permission',
            'sentiment_score', 'readability_score', 'custom_metadata'
        ]


class DocumentGraphParagraphSerializer(serializers.ModelSerializer):
    """
    Optimized paragraph serializer with all nested data.
    CRITICAL: Parses inline references from text to ensure NONE are missed.
    """
    sentences = DocumentGraphSentenceSerializer(many=True, read_only=True)
    effective_content = serializers.SerializerMethodField()
    inline_images = serializers.SerializerMethodField()
    inline_references = serializers.SerializerMethodField()  # NEW: Parse from text
    references = serializers.SerializerMethodField()  # OLD: metadata references
    rendered_html = serializers.SerializerMethodField()  # NEW: HTML with styled references
    
    class Meta:
        model = Paragraph
        fields = [
            'id', 'content_text', 'edited_text', 'has_edits',
            'effective_content', 'paragraph_type', 'order',
            'is_ambiguous', 'is_conflicting', 'complexity_score',
            'sentences', 'inline_images',
            'inline_references', 'references', 
            'rendered_html', 'edit_count'
        ]
    
    def get_effective_content(self, obj):
        """Return the content that should be displayed"""
        return obj.get_effective_content()
    
    def get_inline_references(self, obj):
        """
        Inline reference system has been removed.
        """
        return []
    
    def get_rendered_html(self, obj):
        """
        Render paragraph content as HTML (inline reference system removed).
        """
        content = obj.get_effective_content()
        return content or ''
    
    def get_inline_images(self, obj):
        """
        Inline images are no longer supported. This returns an empty list.
        """
        return []
    
    def get_references(self, obj):
        """Inline reference system removed."""
        return []


class DocumentGraphSectionSerializer(serializers.ModelSerializer):
    """Recursive section serializer with complete hierarchy"""
    paragraphs = DocumentGraphParagraphSerializer(many=True, read_only=True)
    tables = serializers.SerializerMethodField()
    image_components = serializers.SerializerMethodField()
    file_components = serializers.SerializerMethodField()
    children = serializers.SerializerMethodField()
    effective_content = serializers.SerializerMethodField()
    references = serializers.SerializerMethodField()
    referenced_by = serializers.SerializerMethodField()
    formatting = serializers.SerializerMethodField()
    numbering = serializers.SerializerMethodField()
    
    class Meta:
        model = Section
        fields = [
            'id', 'title', 'content_text', 'edited_text', 'has_edits',
            'effective_content', 'section_type', 'order', 'depth_level',
            'parent', 'importance_level', 'is_boilerplate',
            'requires_specialist_review', 'tags', 'custom_metadata',
            'numbering', 'references', 'referenced_by', 'formatting',
            'paragraphs', 'tables', 'image_components', 'file_components',
            'children'
        ]
    
    def get_effective_content(self, obj):
        """Return the content that should be displayed"""
        return obj.get_effective_content()
    
    def get_children(self, obj):
        """Recursively serialize child sections"""
        # Use prefetched children if available
        children = obj.children.all()
        return DocumentGraphSectionSerializer(children, many=True, context=self.context).data

    def get_tables(self, obj):
        from .models import Table
        tables = Table.objects.filter(section=obj).order_by('order')
        return TableSerializer(tables, many=True).data

    def get_image_components(self, obj):
        from .models import ImageComponent
        components = ImageComponent.objects.filter(section=obj).order_by('order')
        return ImageComponentSerializer(components, many=True, context=self.context).data

    def get_file_components(self, obj):
        from .models import DocumentFileComponent
        components = DocumentFileComponent.objects.filter(section=obj).order_by('order')
        return DocumentFileComponentSerializer(components, many=True, context=self.context).data
    
    def get_references(self, obj):
        """Extract references from custom_metadata"""
        if obj.custom_metadata and 'references' in obj.custom_metadata:
            return obj.custom_metadata['references']
        return []
    
    def get_referenced_by(self, obj):
        """Extract reverse references from custom_metadata"""
        if obj.custom_metadata and 'referenced_by' in obj.custom_metadata:
            return obj.custom_metadata['referenced_by']
        return []
    
    def get_formatting(self, obj):
        """Extract formatting from custom_metadata"""
        if obj.custom_metadata and 'formatting' in obj.custom_metadata:
            return obj.custom_metadata['formatting']
        return {}
    
    def get_numbering(self, obj):
        """Extract numbering from custom_metadata"""
        if obj.custom_metadata and 'numbering' in obj.custom_metadata:
            return obj.custom_metadata['numbering']
        return None


class DocumentGraphSerializer(serializers.ModelSerializer):
    """
    Complete document graph with full hierarchy for AI processing and frontend rendering.
    
    Returns optimized structure with:
    - Document metadata
    - Complete section hierarchy (recursive)
    - All paragraphs with inline images
    - All sentences with linguistic data
    - All references and cross-references
    - All formatting information
    - Document statistics
    - Issues and suggestions
    
    Optimized with select_related and prefetch_related for performance.
    """
    sections = serializers.SerializerMethodField()
    issues = serializers.SerializerMethodField()
    images = serializers.SerializerMethodField()
    attachments = serializers.SerializerMethodField()
    versions = serializers.SerializerMethodField()
    statistics = serializers.SerializerMethodField()
    metadata = serializers.SerializerMethodField()
    reference_map = serializers.SerializerMethodField()
    section_references = serializers.SerializerMethodField()
    comments = serializers.SerializerMethodField()
    
    class Meta:
        model = Document
        fields = [
            'id', 'title', 'document_type', 'category', 'status',
            'version', 'version_number', 'is_draft', 'is_latest_version',
            'author', 'created_by', 'created_at', 'updated_at',
            'effective_date', 'expiration_date', 'execution_date',
            'governing_law', 'jurisdiction', 'reference_number',
            'parties', 'signatories', 'metadata', 'statistics',
            'sections', 'issues', 'images', 'attachments', 'versions', 
            'reference_map', 'section_references', 'comments'
        ]
    
    def get_sections(self, obj):
        """
        Get root sections with complete hierarchy.
        
        Performance: Uses denormalized section_ids index to avoid N+1 queries.
        Fetches all sections in one query using id__in lookup.
        """
        # Use denormalized index if available (after migration 0028)
        if hasattr(obj, 'section_ids') and obj.section_ids:
            # Filter invalid UUIDs from denormalized index
            valid_section_ids = []
            for section_id in obj.section_ids:
                try:
                    valid_section_ids.append(str(uuid.UUID(str(section_id))))
                except (ValueError, TypeError):
                    continue

            if valid_section_ids:
                all_sections = Section.objects.filter(
                    id__in=valid_section_ids
                ).prefetch_related(
                    'paragraphs__sentences',
                    'tables',
                    'image_components',
                    'file_components',
                    'children__paragraphs__sentences'
                ).order_by('order')

                # Filter to root sections only (parent is None)
                root_sections = [s for s in all_sections if s.parent is None]
                if not root_sections:
                    root_sections = obj.sections.filter(parent__isnull=True).prefetch_related(
                        'paragraphs__sentences',
                        'tables',
                        'image_components',
                        'file_components',
                        'children__paragraphs__sentences'
                    ).order_by('order')
            else:
                root_sections = obj.sections.filter(parent__isnull=True).prefetch_related(
                    'paragraphs__sentences',
                    'tables',
                    'image_components',
                    'file_components',
                    'children__paragraphs__sentences'
                ).order_by('order')
        else:
            # Fallback to traditional query for backward compatibility
            root_sections = obj.sections.filter(parent__isnull=True).prefetch_related(
                'paragraphs__sentences',
                'tables',
                'image_components',
                'file_components',
                'children__paragraphs__sentences'
            ).order_by('order')
        
        return DocumentGraphSectionSerializer(root_sections, many=True, context=self.context).data
    
    def get_issues(self, obj):
        """Get all issues grouped by severity"""
        issues = obj.issues.select_related(
            'section', 'paragraph', 'sentence'
        ).order_by('-severity', '-priority', '-detected_at')
        
        issues_data = []
        for issue in issues:
            issues_data.append({
                'id': str(issue.id),
                'type': issue.issue_type,
                'severity': issue.severity,
                'title': issue.title,
                'description': issue.description,
                'suggestion': issue.suggestion,
                'status': issue.status,
                'location': {
                    'section_id': issue.section.id if issue.section else None,
                    'paragraph_id': issue.paragraph.id if issue.paragraph else None,
                    'sentence_id': str(issue.sentence.id) if issue.sentence else None,
                    'position_start': issue.position_start,
                    'position_end': issue.position_end
                },
                'priority': issue.priority,
                'is_blocking': issue.is_blocking,
                'requires_specialist': issue.requires_specialist,
                'detection_confidence': issue.detection_confidence,
                'detected_at': issue.detected_at.isoformat() if issue.detected_at else None
            })
        
        return {
            'total': len(issues_data),
            'critical': [i for i in issues_data if i['severity'] == 'critical'],
            'high': [i for i in issues_data if i['severity'] == 'high'],
            'medium': [i for i in issues_data if i['severity'] == 'medium'],
            'low': [i for i in issues_data if i['severity'] == 'low'],
            'all': issues_data
        }
    
    def get_images(self, obj):
        """Get all images associated with document"""
        images_data = {
            'logo': None,
            'watermark': None,
            'background': None,
            'header_icon': None,
            'footer_icon': None,
            'inline_images': []
        }
        
        # Document-level images
        if obj.logo_image:
            images_data['logo'] = self._serialize_document_image(obj.logo_image)
        if obj.watermark_image:
            images_data['watermark'] = self._serialize_document_image(obj.watermark_image)
        if obj.background_image:
            images_data['background'] = self._serialize_document_image(obj.background_image)
        header_icon = getattr(obj, 'header_icon', None)
        if header_icon:
            images_data['header_icon'] = self._serialize_document_image(header_icon)
        footer_icon = getattr(obj, 'footer_icon', None)
        if footer_icon:
            images_data['footer_icon'] = self._serialize_document_image(footer_icon)
        
        return images_data

    def get_comments(self, obj):
        """Inline comments are currently disabled (returns empty list)."""
        return []
    
    def get_attachments(self, obj):
        """Get all document attachments"""
        attachments = DocumentAttachment.objects.filter(document=obj).order_by('order', 'name')
        return [{
            'id': str(att.id),
            'name': att.name,
            'type': att.attachment_type,
            'description': att.description,
            'file_name': att.file_name,
            'file_type': att.file_type,
            'file_size': att.file_size,
            'file_url': att.file.url if att.file else None,
            'is_required': att.is_required,
            'uploaded_at': att.uploaded_at.isoformat() if att.uploaded_at else None,
            'order': att.order
        } for att in attachments]
    
    def get_versions(self, obj):
        """Get version history summary"""
        versions = DocumentVersion.objects.filter(document=obj).order_by('-created_at')[:10]
        return [{
            'id': str(v.id),
            'version_number': v.version_number,
            'version_name': v.version_name,
            'is_major_version': v.is_major_version,
            'change_summary': v.change_summary,
            'created_by': v.created_by.username if v.created_by else None,
            'created_at': v.created_at.isoformat() if v.created_at else None
        } for v in versions]
    
    def get_statistics(self, obj):
        """Comprehensive document statistics"""
        sections_count = obj.sections.count()
        paragraphs_count = Paragraph.objects.filter(section__document=obj).count()
        sentences_count = Sentence.objects.filter(paragraph__section__document=obj).count()
        issues_count = obj.issues.count()
        critical_issues = obj.issues.filter(severity='critical').count()
        
        # Count sections by type
        sections_by_type = {}
        for section_type, _ in Section.SECTION_TYPES:
            count = obj.sections.filter(section_type=section_type).count()
            if count > 0:
                sections_by_type[section_type] = count
        
        # Count sections by depth
        sections_by_depth = {}
        for depth in range(1, 7):
            count = obj.sections.filter(depth_level=depth).count()
            if count > 0:
                sections_by_depth[f'depth_{depth}'] = count
        
        return {
            'sections_count': sections_count,
            'paragraphs_count': paragraphs_count,
            'sentences_count': sentences_count,
            'attachments_count': DocumentAttachment.objects.filter(document=obj).count(),
            'issues_count': issues_count,
            'critical_issues_count': critical_issues,
            'word_count': len(obj.raw_text.split()) if obj.raw_text else 0,
            'sections_by_type': sections_by_type,
            'sections_by_depth': sections_by_depth,
            'has_edits': obj.sections.filter(has_edits=True).exists() or 
                        Paragraph.objects.filter(section__document=obj, has_edits=True).exists(),
            'completion_percentage': self._calculate_completion_percentage(obj)
        }
    
    def get_metadata(self, obj):
        """All document metadata in structured format"""
        return {
            'document_metadata': obj.document_metadata or {},
            'custom_metadata': obj.custom_metadata or {},
            'parties': obj.parties or [],
            'signatories': obj.signatories or [],
            'dates': {
                'effective_date': obj.effective_date.isoformat() if obj.effective_date else None,
                'expiration_date': obj.expiration_date.isoformat() if obj.expiration_date else None,
                'execution_date': obj.execution_date.isoformat() if obj.execution_date else None,
                'created_at': obj.created_at.isoformat() if obj.created_at else None,
                'updated_at': obj.updated_at.isoformat() if obj.updated_at else None
            },
            'legal': {
                'governing_law': obj.governing_law,
                'jurisdiction': obj.jurisdiction,
                'reference_number': obj.reference_number
            }
        }
    
    def get_reference_map(self, obj):
        """
        Extract and map all references in the document.
        Provides complete relationship graph for AI understanding and frontend navigation.
        """
        return self._build_reference_map(obj)
    
    def get_section_references(self, obj):
        """
        Get all section references for this document.
        Returns references to sections from other documents that are embedded in this document.
        Only includes references where the user has access to both documents.
        """
        request = self.context.get('request')
        user = request.user if request and hasattr(request, 'user') else None
        
        if not user or not user.is_authenticated:
            return []
        
        # Get all section references for this document
        references = obj.section_references.select_related(
            'referenced_section',
            'referenced_section__document',
            'created_by'
        ).order_by('order')
        
        # Filter to only include references user can access
        accessible_refs = []
        for ref in references:
            if ref.can_access(user):
                accessible_refs.append({
                    'id': str(ref.id),
                    'order': ref.order,
                    'position_description': ref.position_description,
                    'note': ref.note,
                    'include_full_content': ref.include_full_content,
                    'created_at': ref.created_at.isoformat(),
                    'created_by': ref.created_by.username if ref.created_by else None,
                    'referenced_section': {
                        'id': ref.referenced_section.id,
                        'title': ref.referenced_section.title,
                        'content': ref.referenced_section.get_effective_content() if ref.include_full_content else None,
                        'section_type': ref.referenced_section.section_type,
                        'order': ref.referenced_section.order,
                    },
                    'referenced_document': {
                        'id': str(ref.referenced_section.document.id),
                        'title': ref.referenced_section.document.title,
                        'created_by': ref.referenced_section.document.created_by.username if ref.referenced_section.document.created_by else None,
                    }
                })
        
        return accessible_refs
    
    def _serialize_document_image(self, img):
        """Helper to serialize DocumentImage"""
        return {
            'id': str(img.id),
            'name': img.name,
            'type': img.image_type,
            'url': img.image.url if img.image else None,
            'thumbnail_url': img.thumbnail.url if img.thumbnail else None,
            'width': img.width,
            'height': img.height,
            'caption': img.caption
        }
    
    def _serialize_inline_image(self, img):
        """Helper to serialize InlineImage - handles both direct image and image_reference"""
        request = self.context.get('request')
        image_url = None
        thumbnail_url = None
        width = None
        height = None
        
        # Priority: direct image field first, then image_reference (ForeignKey to DocumentImage)
        if img.image:
            # Direct ImageField upload
            if request:
                image_url = request.build_absolute_uri(img.image.url)
            else:
                image_url = img.image.url
            # Get dimensions if available
            try:
                width = img.image.width
                height = img.image.height
            except (AttributeError, FileNotFoundError):
                width = img.width_pixels
                height = img.height_pixels
        elif img.image_reference:
            # Reference to DocumentImage (ForeignKey)
            if img.image_reference.image:
                if request:
                    image_url = request.build_absolute_uri(img.image_reference.image.url)
                else:
                    image_url = img.image_reference.image.url
            if img.image_reference.thumbnail:
                if request:
                    thumbnail_url = request.build_absolute_uri(img.image_reference.thumbnail.url)
                else:
                    thumbnail_url = img.image_reference.thumbnail.url
            width = img.image_reference.width
            height = img.image_reference.height
        
        return {
            'id': str(img.id),
            'paragraph_id': str(img.paragraph.id) if img.paragraph else None,
            'image_url': image_url,
            'thumbnail_url': thumbnail_url,
            'caption': img.caption or '',
            'alt_text': img.alt_text or '',
            'width': width or img.width_pixels,
            'height': height or img.height_pixels,
            'alignment': img.alignment,
            'size_mode': img.size_mode,
            'position_in_text': img.position_in_text,
            'order': getattr(img, 'display_order', 0),
            'resize_mode': img.size_mode,  # Alias for compatibility
            'custom_metadata': img.custom_metadata or {}
        }
    
    def _calculate_completion_percentage(self, obj):
        """Calculate document completion percentage based on various factors"""
        total_score = 0
        max_score = 0
        
        # Has title (10 points)
        max_score += 10
        if obj.title and obj.title != "Untitled Document":
            total_score += 10
        
        # Has sections (30 points)
        max_score += 30
        sections_count = obj.sections.count()
        if sections_count > 0:
            total_score += min(30, sections_count * 5)
        
        # Has metadata (20 points)
        max_score += 20
        if obj.document_metadata or obj.custom_metadata:
            total_score += 20
        
        # Has parties (10 points)
        max_score += 10
        if obj.parties:
            total_score += 10
        
        # Has dates (10 points)
        max_score += 10
        date_count = sum([
            bool(obj.effective_date),
            bool(obj.expiration_date),
            bool(obj.execution_date)
        ])
        total_score += (date_count / 3) * 10
        
        # No critical issues (20 points)
        max_score += 20
        critical_issues = obj.issues.filter(severity='critical').count()
        if critical_issues == 0:
            total_score += 20
        elif critical_issues < 3:
            total_score += 10
        
        return round((total_score / max_score) * 100) if max_score > 0 else 0
    
    def _extract_references_from_text(self, text, source_type, source_id):
        """
        Extract inline references from text and return structured data.
        Looks for patterns like [[type:id|display_text]]
        
        Returns list of references with context
        """
        import re
        
        if not text:
            return []
        
        # Pattern to match [[type:id|text]]
        pattern = r'\[\[(\w+):([^|]+)\|([^\]]+)\]\]'
        references = []
        
        for match in re.finditer(pattern, text):
            ref_type = match.group(1)  # section, paragraph, document
            ref_id = match.group(2)    # UUID or ID
            display_text = match.group(3)  # Display text
            
            references.append({
                'source_type': source_type,
                'source_id': source_id,
                'target_type': ref_type,
                'target_id': ref_id,
                'display_text': display_text,
                'start_offset': match.start(),
                'end_offset': match.end(),
                'context_before': text[max(0, match.start() - 50):match.start()],
                'context_after': text[match.end():match.end() + 50]
            })
        
        return references
    
    def _build_reference_map(self, obj):
        """
        Build complete reference map for the entire document.
        Extracts all references from all levels and creates relationship graph.
        
        Returns:
        {
            'references': [list of all references],
            'relationships': {
                'sections_referencing': {section_id: [referenced_ids]},
                'paragraphs_referencing': {para_id: [referenced_ids]},
                'cross_document_refs': [list of external doc refs],
                'internal_refs': [list of internal refs],
                'orphaned_refs': [list of broken references]
            },
            'statistics': {
                'total_references': count,
                'internal_references': count,
                'external_references': count,
                'broken_references': count
            }
        }
        """
        all_references = []
        sections_referencing = {}
        paragraphs_referencing = {}
        cross_document_refs = []
        internal_refs = []
        
        # Extract from document-level text
        if obj.current_text or obj.raw_text:
            text = obj.current_text or obj.raw_text
            doc_refs = self._extract_references_from_text(text, 'document', str(obj.id))
            all_references.extend(doc_refs)
        
        # Extract from sections
        for section in obj.sections.all():
            content = section.get_effective_content()
            section_refs = self._extract_references_from_text(content, 'section', section.id)
            
            if section_refs:
                sections_referencing[section.id] = [
                    {'type': r['target_type'], 'id': r['target_id']} 
                    for r in section_refs
                ]
                all_references.extend(section_refs)
            
            # Extract from paragraphs in section
            for paragraph in section.paragraphs.all():
                para_content = paragraph.get_effective_content()
                para_refs = self._extract_references_from_text(
                    para_content, 'paragraph', paragraph.id
                )
                
                if para_refs:
                    paragraphs_referencing[paragraph.id] = [
                        {'type': r['target_type'], 'id': r['target_id']}
                        for r in para_refs
                    ]
                    all_references.extend(para_refs)
        
        # Classify references
        for ref in all_references:
            if ref['target_type'] == 'document' and ref['target_id'] != str(obj.id):
                cross_document_refs.append(ref)
            else:
                internal_refs.append(ref)
        
        # Find broken references
        orphaned_refs = self._find_broken_references(all_references, obj)
        
        return {
            'references': all_references,
            'relationships': {
                'sections_referencing': sections_referencing,
                'paragraphs_referencing': paragraphs_referencing,
                'cross_document_refs': cross_document_refs,
                'internal_refs': internal_refs,
                'orphaned_refs': orphaned_refs
            },
            'statistics': {
                'total_references': len(all_references),
                'internal_references': len(internal_refs),
                'external_references': len(cross_document_refs),
                'broken_references': len(orphaned_refs),
                'sections_with_refs': len(sections_referencing),
                'paragraphs_with_refs': len(paragraphs_referencing)
            }
        }
    
    def _find_broken_references(self, references, document):
        """Find references that point to non-existent targets"""
        broken = []
        
        for ref in references:
            target_exists = False
            
            if ref['target_type'] == 'section':
                target_exists = Section.objects.filter(
                    id=ref['target_id'],
                    document=document
                ).exists()
            elif ref['target_type'] == 'paragraph':
                target_exists = Paragraph.objects.filter(
                    id=ref['target_id'],
                    section__document=document
                ).exists()
            elif ref['target_type'] == 'document':
                # Check if external document exists and user has access
                # For now, just check if it exists
                target_exists = Document.objects.filter(
                    id=ref['target_id']
                ).exists()
            
            if not target_exists:
                broken.append(ref)
        
        return broken


class UnifiedSearchResultSerializer(serializers.Serializer):
    """
    Serializer for unified search results.
    Returns results from all resource types with metadata.
    """
    resource_type = serializers.CharField(
        help_text="Type of resource: document, section, paragraph, attachment, image, term, version, changelog, review, issue, reference"
    )
    resource_id = serializers.UUIDField(
        help_text="UUID of the resource"
    )
    title = serializers.CharField(
        help_text="Title or name of the resource"
    )
    content = serializers.CharField(
        allow_blank=True,
        help_text="Content text (may be truncated)"
    )
    matched_content = serializers.CharField(
        allow_blank=True,
        help_text="Snippet of content showing where the query matched"
    )
    relevance_score = serializers.FloatField(
        help_text="Relevance score (higher = better match)"
    )
    metadata = serializers.DictField(
        help_text="Resource-specific metadata"
    )
    document_info = serializers.DictField(
        help_text="Information about the parent document"
    )
    section_info = serializers.DictField(
        required=False,
        help_text="Information about the parent section (if applicable)"
    )
    created_at = serializers.DateTimeField(
        help_text="When the resource was created"
    )
    created_by = serializers.CharField(
        allow_null=True,
        help_text="Username of creator"
    )


class UnifiedSearchResponseSerializer(serializers.Serializer):
    """
    Serializer for the complete search response.
    """
    query = serializers.CharField(
        help_text="The search query that was executed"
    )
    total_count = serializers.IntegerField(
        help_text="Total number of results found"
    )
    results = UnifiedSearchResultSerializer(
        many=True,
        help_text="List of search results"
    )
    resource_type_counts = serializers.DictField(
        help_text="Count of results by resource type"
    )
    fuzzy_search_enabled = serializers.BooleanField(
        required=False,
        default=True,
        help_text="Whether fuzzy search is enabled (always True for unified search)"
    )
    min_score_threshold = serializers.FloatField(
        required=False,
        help_text="Minimum relevance score threshold applied (if any)"
    )
    filtered_count = serializers.IntegerField(
        required=False,
        help_text="Number of results filtered out by min_score threshold"
    )
    message = serializers.CharField(
        required=False,
        help_text="Optional message (e.g., for errors)"
    )


# ============================================================================
# DOCUMENT FILE SERIALIZERS
# ============================================================================

class DocumentFileSerializer(serializers.ModelSerializer):
    """
    Serializer for DocumentFile model.
    Provides file upload, metadata, and access control.
    """
    file_url = serializers.SerializerMethodField()
    file_extension = serializers.SerializerMethodField()
    file_size_display = serializers.SerializerMethodField()
    can_access = serializers.SerializerMethodField()
    uploaded_by_username = serializers.SerializerMethodField()
    organization_name = serializers.SerializerMethodField()
    team_name = serializers.SerializerMethodField()
    
    class Meta:
        model = DocumentFile
        fields = [
            'id', 'file', 'name', 'description', 'file_type', 'category',
            'original_filename', 'file_size', 'mime_type', 'file_hash',
            'access_level', 'uploaded_by', 'uploaded_at', 'updated_at',
            'organization', 'organization_name', 'team', 'team_name',
            'download_count', 'usage_count', 'last_used_at', 'last_downloaded_at',
            'version', 'is_latest_version', 'previous_version',
            'tags', 'metadata', 'is_active', 'is_confidential',
            'requires_signature', 'is_template', 'expires_at',
            # Computed fields
            'file_url', 'file_extension', 'file_size_display', 'can_access',
            'uploaded_by_username'
        ]
        read_only_fields = [
            'id', 'uploaded_at', 'updated_at', 'file_hash', 'original_filename',
            'file_size', 'mime_type', 'download_count', 'usage_count',
            'last_used_at', 'last_downloaded_at', 'file_url', 'file_extension',
            'file_size_display', 'can_access', 'uploaded_by_username',
            'organization_name', 'team_name'
        ]
    
    def get_file_url(self, obj):
        """Get the full URL of the file."""
        if obj.file:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.file.url)
            return obj.file.url
        return None
    
    def get_file_extension(self, obj):
        """Get file extension."""
        return obj.get_file_extension()
    
    def get_file_size_display(self, obj):
        """Get human-readable file size."""
        return obj.get_file_size_display()
    
    def get_can_access(self, obj):
        """Check if current user can access this file."""
        request = self.context.get('request')
        if request and hasattr(request, 'user'):
            return obj.can_access(request.user)
        return False
    
    def get_uploaded_by_username(self, obj):
        """Get username of uploader."""
        if obj.uploaded_by:
            return obj.uploaded_by.username
        return None

    def get_organization_name(self, obj):
        """Get organization name."""
        if obj.organization:
            return obj.organization.name
        return None

    def get_team_name(self, obj):
        """Get team name."""
        if obj.team:
            return obj.team.name
        return None


class DocumentFileUploadSerializer(serializers.Serializer):
    """
    Serializer for uploading new document files.
    Handles file upload with metadata.
    MINIMAL REQUIRED FIELDS: Only 'file' is required!
    """
    file = serializers.FileField(
        help_text="File to upload (REQUIRED)"
    )
    name = serializers.CharField(
        max_length=255,
        required=False,
        allow_blank=True,
        help_text="User-friendly name for the file (auto-generated from filename if not provided)"
    )
    description = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
        help_text="Description of the file"
    )
    file_type = serializers.ChoiceField(
        choices=DocumentFile.FILE_TYPE_CHOICES,
        required=False,
        help_text="Type of file (auto-detected if not provided)"
    )
    category = serializers.ChoiceField(
        choices=DocumentFile.CATEGORY_CHOICES,
        default='other',
        required=False,
        help_text="Category for organization"
    )
    access_level = serializers.ChoiceField(
        choices=DocumentFile.ACCESS_LEVEL_CHOICES,
        default='user',
        required=False,
        help_text="Who can access this file"
    )
    tags = serializers.ListField(
        child=serializers.CharField(max_length=50),
        required=False,
        default=list,
        help_text="Tags for categorization"
    )
    metadata = serializers.JSONField(
        required=False,
        default=dict,
        help_text="Extended metadata"
    )
    version = serializers.CharField(
        max_length=50,
        required=False,
        allow_blank=True,
        allow_null=True,
        help_text="Version of the document"
    )
    is_confidential = serializers.BooleanField(
        default=False,
        required=False,
        help_text="Mark as confidential"
    )
    requires_signature = serializers.BooleanField(
        default=False,
        required=False,
        help_text="Indicates if document requires signatures"
    )
    is_template = serializers.BooleanField(
        default=False,
        required=False,
        help_text="Mark as template for reuse"
    )
    team = serializers.UUIDField(
        required=False,
        allow_null=True,
        help_text="Team UUID — required when access_level='team'"
    )
    
    def create(self, validated_data):
        """Create DocumentFile with uploaded file."""
        from .models import DocumentFile
        import os
        import mimetypes
        
        # Auto-generate name from filename if not provided
        if not validated_data.get('name'):
            uploaded_file = validated_data['file']
            filename = getattr(uploaded_file, 'name', 'Untitled Document')
            validated_data['name'] = os.path.splitext(filename)[0]
        
        # Auto-detect file_type if not provided
        if not validated_data.get('file_type'):
            uploaded_file = validated_data['file']
            filename = getattr(uploaded_file, 'name', '')
            ext = os.path.splitext(filename)[1].lower().lstrip('.')
            
            # Map common extensions to file_type
            ext_map = {
                'pdf': 'pdf',
                'docx': 'docx',
                'doc': 'doc',
                'xlsx': 'xlsx',
                'xls': 'xls',
                'pptx': 'pptx',
                'ppt': 'ppt',
                'txt': 'txt',
                'csv': 'csv',
                'json': 'json',
                'xml': 'xml',
                'zip': 'zip',
                'rar': 'rar',
                'md': 'md',
                'rtf': 'rtf',
                'odt': 'odt',
                'ods': 'ods',
                'odp': 'odp',
            }
            validated_data['file_type'] = ext_map.get(ext, 'other')
        
        # Set uploaded_by from request context
        request = self.context.get('request')
        if request and hasattr(request, 'user'):
            validated_data['uploaded_by'] = request.user

            # Auto-set organization from user profile
            try:
                validated_data.setdefault('organization', request.user.profile.organization)
            except Exception:
                pass

        # Convert team UUID to FK
        team_uuid = validated_data.pop('team', None)
        if team_uuid:
            validated_data['team_id'] = team_uuid
        
        return DocumentFile.objects.create(**validated_data)


class DocumentFileComponentSerializer(serializers.ModelSerializer):
    """
    Serializer for DocumentFileComponent model.
    Provides file reference details and display properties.
    """
    file_url = serializers.SerializerMethodField()
    file_name = serializers.SerializerMethodField()
    file_metadata = serializers.SerializerMethodField()
    display_style = serializers.SerializerMethodField()
    file_info = serializers.SerializerMethodField()
    
    class Meta:
        model = DocumentFileComponent
        fields = [
            'id', 'section', 'file_reference', 'file_reference_id', 'label', 'description',
            'reference_number', 'display_mode', 'alignment',
            'width_percent', 'height_pixels', 'margin_top', 'margin_bottom',
            'page_range',
            'show_filename', 'show_file_size', 'show_file_type',
            'show_download_button', 'show_preview', 'open_in_new_tab',
            'is_visible', 'created_at', 'created_by', 'last_modified',
            'modified_by', 'edit_count', 'custom_metadata', 'order',
            # Computed fields
            'file_url', 'file_name', 'file_metadata', 'display_style', 'file_info'
        ]
        read_only_fields = [
            'id', 'created_at', 'last_modified', 'edit_count',
            'file_url', 'file_name', 'file_metadata', 'display_style', 'file_info'
        ]
    
    def create(self, validated_data):
        """Auto-generate DocumentFileComponent ID if not provided."""
        import time
        
        # Generate unique ID using timestamp
        if 'id' not in validated_data:
            section = validated_data.get('section')
            timestamp = int(time.time() * 1000)  # milliseconds
            order = validated_data.get('order', 0)
            validated_data['id'] = f"{section.id}_file{timestamp}_{order}"
        
        return super().create(validated_data)
    
    def get_file_url(self, obj):
        """Get the full URL of the referenced file."""
        if obj.file_reference and obj.file_reference.file:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.file_reference.file.url)
            return obj.file_reference.file.url
        return None
    
    def get_file_name(self, obj):
        """Get the name of the referenced file."""
        if obj.file_reference:
            return obj.file_reference.name
        return None
    
    def get_file_metadata(self, obj):
        """Get metadata from the referenced DocumentFile."""
        if obj.file_reference:
            return {
                'file_type': obj.file_reference.file_type,
                'category': obj.file_reference.category,
                'file_size': obj.file_reference.file_size,
                'file_size_display': obj.file_reference.get_file_size_display(),
                'mime_type': obj.file_reference.mime_type,
                'original_filename': obj.file_reference.original_filename,
                'file_extension': obj.file_reference.get_file_extension(),
                'version': obj.file_reference.version,
                'is_confidential': obj.file_reference.is_confidential,
                'requires_signature': obj.file_reference.requires_signature,
            }
        return None
    
    def get_display_style(self, obj):
        """Get computed display style properties."""
        return obj.get_display_style()
    
    def get_file_info(self, obj):
        """Get comprehensive file information for rendering."""
        if not obj.file_reference:
            return None
        
        file_ref = obj.file_reference
        return {
            'id': str(file_ref.id),
            'name': file_ref.name,
            'description': file_ref.description,
            'file_type': file_ref.file_type,
            'category': file_ref.category,
            'original_filename': file_ref.original_filename,
            'file_size': file_ref.file_size,
            'file_size_display': file_ref.get_file_size_display(),
            'file_extension': file_ref.get_file_extension(),
            'tags': file_ref.tags,
            'version': file_ref.version,
            'is_confidential': file_ref.is_confidential,
            'download_count': file_ref.download_count,
        }


class DocumentFileComponentCreateSerializer(serializers.Serializer):
    """
    Serializer for creating a new document file component.
    MINIMAL REQUIRED FIELDS: Only section_id and file_reference_id required!
    All other fields have sensible defaults.
    """
    section_id = serializers.CharField(max_length=100)
    file_reference_id = serializers.UUIDField(
        help_text="ID of the DocumentFile to reference"
    )
    label = serializers.CharField(
        max_length=500,
        required=False,
        allow_blank=True,
        allow_null=True,
        help_text="Display label (auto-generated from filename if not provided)"
    )
    description = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
        help_text="Description"
    )
    reference_number = serializers.CharField(
        max_length=100,
        required=False,
        allow_blank=True,
        allow_null=True,
        help_text="Reference number (e.g., 'Exhibit A')"
    )
    display_mode = serializers.ChoiceField(
        choices=['embed', 'link', 'download', 'reference', 'icon'],
        default='link',
        required=False
    )
    alignment = serializers.ChoiceField(
        choices=['left', 'center', 'right'],
        default='left',
        required=False
    )
    order = serializers.IntegerField(
        default=0,
        required=False,
        help_text="Position in section (auto-calculated if not provided)"
    )
    show_filename = serializers.BooleanField(default=True, required=False)
    show_file_size = serializers.BooleanField(default=True, required=False)
    show_file_type = serializers.BooleanField(default=True, required=False)
    show_download_button = serializers.BooleanField(default=True, required=False)
    show_preview = serializers.BooleanField(default=True, required=False)
    open_in_new_tab = serializers.BooleanField(default=True, required=False)
    page_range = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    
    def validate_section_id(self, value):
        """Validate section exists."""
        from .models import Section
        try:
            Section.objects.get(id=value)
        except Section.DoesNotExist:
            raise serializers.ValidationError("Section not found")
        return value
    
    def validate_file_reference_id(self, value):
        """Validate file exists and user has access."""
        from .models import DocumentFile
        try:
            file_obj = DocumentFile.objects.get(id=value)
            
            # Check access
            request = self.context.get('request')
            if request and hasattr(request, 'user'):
                if not file_obj.can_access(request.user):
                    raise serializers.ValidationError("You don't have access to this file")
            
            return value
        except DocumentFile.DoesNotExist:
            raise serializers.ValidationError("File not found")
    
    def create(self, validated_data):
        """Create DocumentFileComponent with auto-generated defaults."""
        from .models import DocumentFileComponent, Section, DocumentFile
        from django.db.models import Max
        
        section = Section.objects.get(id=validated_data.pop('section_id'))
        file_reference = DocumentFile.objects.get(id=validated_data.pop('file_reference_id'))
        
        # Auto-generate label from filename if not provided
        if not validated_data.get('label'):
            validated_data['label'] = file_reference.name
        
        # Auto-calculate order if not provided or is 0
        if 'order' not in validated_data or validated_data.get('order') == 0:
            max_order = DocumentFileComponent.objects.filter(
                section=section
            ).aggregate(Max('order'))['order__max']
            validated_data['order'] = (max_order or -1) + 1
        
        # Set user if available
        request = self.context.get('request')
        if request and hasattr(request, 'user'):
            validated_data['created_by'] = request.user
        
        return DocumentFileComponent.objects.create(
            section=section,
            file_reference=file_reference,
            **validated_data
        )


# ═══════════════════════════════════════════════════════════════════════════════
# Header / Footer PDF — manual selection & crop
# ═══════════════════════════════════════════════════════════════════════════════

class HeaderFooterPDFSerializer(serializers.ModelSerializer):
    """Read serializer for HeaderFooterPDF."""
    source_file_name = serializers.SerializerMethodField()
    cropped_file_url = serializers.SerializerMethodField()
    created_by_username = serializers.SerializerMethodField()
    can_access = serializers.SerializerMethodField()

    class Meta:
        from .models import HeaderFooterPDF
        model = HeaderFooterPDF
        fields = [
            'id', 'region_type', 'name', 'description',
            'source_file', 'source_page',
            'cropped_file', 'cropped_file_url',
            'crop_top_offset', 'crop_height', 'region_height',
            'source_page_width', 'source_page_height',
            'auto_detected', 'detection_metadata',
            'access_level', 'created_by', 'created_by_username',
            'created_at', 'updated_at', 'is_active',
            'source_file_name', 'can_access',
        ]
        read_only_fields = [
            'id', 'cropped_file', 'cropped_file_url',
            'source_page_width', 'source_page_height',
            'created_at', 'updated_at',
            'source_file_name', 'can_access', 'created_by_username',
        ]

    def get_source_file_name(self, obj):
        if obj.source_file:
            return obj.source_file.name
        return None

    def get_cropped_file_url(self, obj):
        if obj.cropped_file:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.cropped_file.url)
            return obj.cropped_file.url
        return None

    def get_created_by_username(self, obj):
        if obj.created_by:
            return obj.created_by.username
        return None

    def get_can_access(self, obj):
        request = self.context.get('request')
        if request and hasattr(request, 'user'):
            return obj.can_access(request.user)
        return False


class HeaderFooterPDFCreateSerializer(serializers.Serializer):
    """
    Create a header/footer PDF by cropping a region from a source PDF.

    The frontend workflow:
    1. Upload a source PDF via ``/api/documents/files/`` (existing endpoint).
    2. Call ``GET .../header-footer-pdfs/preview/?source_file_id=<id>&page=1``
       to get a PNG preview + page dimensions.
    3. Let the user draw a rectangle on the preview to select the region.
    4. Call ``POST .../header-footer-pdfs/`` with the crop coordinates.
       The server crops the region and saves the cropped PDF.
    """
    source_file_id = serializers.UUIDField(
        help_text="ID of the source DocumentFile (must be a PDF)",
    )
    region_type = serializers.ChoiceField(
        choices=[('header', 'Header'), ('footer', 'Footer')],
        help_text="Whether this crop is a header or footer",
    )
    name = serializers.CharField(
        max_length=255,
        required=False,
        allow_blank=True,
        default='',
        help_text="Optional display name. Auto-generated from filename + region + height if blank.",
    )
    description = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
        default='',
    )
    page = serializers.IntegerField(
        default=1,
        min_value=1,
        help_text="1-based page number in the source PDF",
    )
    crop_top_offset = serializers.FloatField(
        required=False,
        default=0.0,
        help_text="Distance in points from page top to top of crop rectangle. Required unless use_auto_detect=true.",
    )
    crop_height = serializers.FloatField(
        required=False,
        default=0.0,
        min_value=0.0,
        help_text="Height of crop rectangle in points. Required unless use_auto_detect=true.",
    )
    access_level = serializers.ChoiceField(
        choices=[('user', 'Private'), ('team', 'Team'), ('organization', 'Organization')],
        default='user',
        required=False,
    )
    use_auto_detect = serializers.BooleanField(
        default=False,
        required=False,
        help_text=(
            "If true, ignore crop_top_offset/crop_height and use auto-detection "
            "to compute the crop region automatically."
        ),
    )

    def validate_source_file_id(self, value):
        from .models import DocumentFile
        try:
            doc_file = DocumentFile.objects.get(id=value, is_active=True)
        except DocumentFile.DoesNotExist:
            raise serializers.ValidationError("Source file not found.")
        if doc_file.file_type != 'pdf':
            raise serializers.ValidationError("Source file must be a PDF.")
        request = self.context.get('request')
        if request and not doc_file.can_access(request.user):
            raise serializers.ValidationError("No access to the source file.")
        return value

    def validate(self, data):
        # If use_auto_detect, we don't need crop coordinates (they'll be computed)
        if data.get('use_auto_detect'):
            data.setdefault('crop_top_offset', 0.0)
            data.setdefault('crop_height', 1.0)
        else:
            # Manual crop — crop_height must be positive
            if not data.get('crop_height') or data['crop_height'] <= 0:
                raise serializers.ValidationError({
                    'crop_height': 'crop_height must be greater than 0 for manual crop.'
                })
        return data

    def create(self, validated_data):
        from .models import DocumentFile, HeaderFooterPDF
        from exporter.pdf_system import (
            detect_pdf_header_footer_heights,
            get_pdf_page_info,
            crop_pdf_region,
        )
        from django.core.files.base import ContentFile

        source_file = DocumentFile.objects.get(id=validated_data['source_file_id'])
        source_path = source_file.file.path
        page = validated_data.get('page', 1)
        region_type = validated_data['region_type']
        use_auto = validated_data.get('use_auto_detect', False)

        # Get page info
        page_info = get_pdf_page_info(source_path, page=page)
        if not page_info:
            raise serializers.ValidationError("Could not read source PDF page.")

        page_width = page_info['width_pts']
        page_height = page_info['height_pts']

        detection_metadata = {}

        if use_auto:
            header_h, footer_h = detect_pdf_header_footer_heights(source_path, page=page)
            detection_metadata = {
                'auto_header_height': header_h,
                'auto_footer_height': footer_h,
            }
            if region_type == 'header':
                if header_h <= 0:
                    raise serializers.ValidationError(
                        "Auto-detection could not find a header region. "
                        "Please select the region manually."
                    )
                crop_top_offset = 0.0
                crop_height = header_h
            else:
                if footer_h <= 0:
                    raise serializers.ValidationError(
                        "Auto-detection could not find a footer region. "
                        "Please select the region manually."
                    )
                crop_top_offset = page_height - footer_h
                crop_height = footer_h
        else:
            crop_top_offset = validated_data['crop_top_offset']
            crop_height = validated_data['crop_height']

        # Perform the crop
        cropped_bytes = crop_pdf_region(
            source_path,
            page=page,
            crop_top_offset=crop_top_offset,
            crop_height=crop_height,
            region_type=region_type,
        )
        if not cropped_bytes:
            raise serializers.ValidationError("Failed to crop the selected region.")

        # ── Build unique display name ──────────────────────────────────
        # Format: "Header - Letterhead.pdf - 80pt"  or user-provided name
        import os
        source_filename = os.path.basename(source_file.file.name) if source_file.file else source_file.name
        # Strip extension for cleaner display
        source_stem = os.path.splitext(source_filename)[0] if source_filename else 'PDF'
        height_label = f"{int(crop_height)}pt" if crop_height == int(crop_height) else f"{crop_height:.1f}pt"
        region_label = region_type.capitalize()  # "Header" or "Footer"

        user_name = (validated_data.get('name') or '').strip()
        if user_name:
            display_name = user_name
        else:
            display_name = f"{region_label} - {source_stem} - {height_label}"

        # Build saved filename (filesystem-safe)
        safe_stem = source_stem.replace(' ', '_')[:40]
        filename = f"{region_type}_{safe_stem}_{height_label}_{source_file.id}.pdf"

        request = self.context.get('request')
        obj = HeaderFooterPDF(
            region_type=region_type,
            name=display_name,
            description=validated_data.get('description') or '',
            source_file=source_file,
            source_page=page,
            crop_top_offset=crop_top_offset,
            crop_height=crop_height,
            region_height=crop_height,
            source_page_width=page_width,
            source_page_height=page_height,
            auto_detected=use_auto,
            detection_metadata=detection_metadata,
            access_level=validated_data.get('access_level', 'user'),
            created_by=request.user if request else None,
        )
        obj.cropped_file.save(filename, ContentFile(cropped_bytes), save=False)
        obj.save()
        return obj


class HeaderFooterPDFUpdateSerializer(serializers.Serializer):
    """
    Re-crop an existing HeaderFooterPDF with new coordinates.

    Also allows updating name, description, and access_level.
    """
    name = serializers.CharField(max_length=255, required=False)
    description = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    access_level = serializers.ChoiceField(
        choices=[('user', 'Private'), ('team', 'Team'), ('organization', 'Organization')],
        required=False,
    )
    page = serializers.IntegerField(min_value=1, required=False)
    crop_top_offset = serializers.FloatField(required=False)
    crop_height = serializers.FloatField(min_value=1.0, required=False)
    use_auto_detect = serializers.BooleanField(default=False, required=False)

    def update(self, instance, validated_data):
        from exporter.pdf_system import (
            detect_pdf_header_footer_heights,
            get_pdf_page_info,
            crop_pdf_region,
        )
        from django.core.files.base import ContentFile

        needs_recrop = any(k in validated_data for k in ('crop_top_offset', 'crop_height', 'page', 'use_auto_detect'))

        # Simple metadata updates
        explicit_name = validated_data.get('name')
        if explicit_name is not None:
            instance.name = explicit_name
        if 'description' in validated_data:
            instance.description = validated_data['description']
        if 'access_level' in validated_data:
            instance.access_level = validated_data['access_level']

        if needs_recrop and instance.source_file and instance.source_file.file:
            source_path = instance.source_file.file.path
            page = validated_data.get('page', instance.source_page)
            use_auto = validated_data.get('use_auto_detect', False)

            page_info = get_pdf_page_info(source_path, page=page)
            if not page_info:
                raise serializers.ValidationError("Could not read source PDF page.")

            page_width = page_info['width_pts']
            page_height = page_info['height_pts']

            if use_auto:
                header_h, footer_h = detect_pdf_header_footer_heights(source_path, page=page)
                instance.detection_metadata = {
                    'auto_header_height': header_h,
                    'auto_footer_height': footer_h,
                }
                instance.auto_detected = True
                if instance.region_type == 'header':
                    crop_top_offset = 0.0
                    crop_height = header_h if header_h > 0 else instance.crop_height
                else:
                    crop_top_offset = page_height - footer_h if footer_h > 0 else instance.crop_top_offset
                    crop_height = footer_h if footer_h > 0 else instance.crop_height
            else:
                crop_top_offset = validated_data.get('crop_top_offset', instance.crop_top_offset)
                crop_height = validated_data.get('crop_height', instance.crop_height)
                instance.auto_detected = False

            cropped_bytes = crop_pdf_region(
                source_path,
                page=page,
                crop_top_offset=crop_top_offset,
                crop_height=crop_height,
                region_type=instance.region_type,
            )
            if cropped_bytes:
                import os
                # Regenerate display name if user didn't supply an explicit name
                if explicit_name is None:
                    source_filename = os.path.basename(instance.source_file.file.name) if instance.source_file.file else ''
                    source_stem = os.path.splitext(source_filename)[0] if source_filename else 'PDF'
                    height_label = f"{int(crop_height)}pt" if crop_height == int(crop_height) else f"{crop_height:.1f}pt"
                    region_label = instance.region_type.capitalize()
                    instance.name = f"{region_label} - {source_stem} - {height_label}"

                safe_stem = instance.name.replace(' ', '_')[:60]
                filename = f"{instance.region_type}_{safe_stem}.pdf"
                # Delete old file
                if instance.cropped_file:
                    try:
                        instance.cropped_file.delete(save=False)
                    except Exception:
                        pass
                instance.cropped_file.save(filename, ContentFile(cropped_bytes), save=False)
                instance.crop_top_offset = crop_top_offset
                instance.crop_height = crop_height
                instance.region_height = crop_height
                instance.source_page = page
                instance.source_page_width = page_width
                instance.source_page_height = page_height

        instance.save()
        return instance






