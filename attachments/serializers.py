from rest_framework import serializers
from .models import Attachment


class AttachmentListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for listing attachments."""

    url = serializers.SerializerMethodField()
    thumbnail_url = serializers.SerializerMethodField()
    uploaded_by_username = serializers.SerializerMethodField()
    scope_display = serializers.SerializerMethodField()
    file_kind_display = serializers.SerializerMethodField()
    image_type_display = serializers.SerializerMethodField()
    team_name = serializers.SerializerMethodField()
    organization_name = serializers.SerializerMethodField()

    class Meta:
        model = Attachment
        fields = [
            'id', 'name', 'file_kind', 'file_kind_display',
            'image_type', 'image_type_display',
            'scope', 'scope_display',
            'url', 'thumbnail_url',
            'file_size', 'mime_type', 'width', 'height',
            'uploaded_by', 'uploaded_by_username',
            'team', 'team_name',
            'organization', 'organization_name',
            'tags', 'created_at',
        ]

    def get_url(self, obj):
        return obj.get_url()

    def get_thumbnail_url(self, obj):
        return obj.get_thumbnail_url()

    def get_uploaded_by_username(self, obj):
        if obj.uploaded_by:
            return obj.uploaded_by.get_full_name() or obj.uploaded_by.username
        return None

    def get_scope_display(self, obj):
        return obj.get_scope_display()

    def get_file_kind_display(self, obj):
        return obj.get_file_kind_display()

    def get_image_type_display(self, obj):
        return obj.get_image_type_display() if obj.image_type else None

    def get_team_name(self, obj):
        return obj.team.name if obj.team else None

    def get_organization_name(self, obj):
        return obj.organization.name if obj.organization else None


class AttachmentDetailSerializer(serializers.ModelSerializer):
    """Full detail serializer."""

    url = serializers.SerializerMethodField()
    thumbnail_url = serializers.SerializerMethodField()
    uploaded_by_username = serializers.SerializerMethodField()
    scope_display = serializers.SerializerMethodField()
    file_kind_display = serializers.SerializerMethodField()
    image_type_display = serializers.SerializerMethodField()
    team_name = serializers.SerializerMethodField()
    organization_name = serializers.SerializerMethodField()
    placeholder = serializers.SerializerMethodField()

    class Meta:
        model = Attachment
        fields = [
            'id', 'name', 'description',
            'file_kind', 'file_kind_display',
            'image_type', 'image_type_display',
            'scope', 'scope_display',
            'file', 'url', 'thumbnail_url',
            'file_size', 'mime_type', 'width', 'height',
            'uploaded_by', 'uploaded_by_username',
            'organization', 'organization_name',
            'team', 'team_name',
            'document',
            'tags', 'metadata',
            'created_at', 'updated_at',
            'placeholder',
        ]
        read_only_fields = [
            'id', 'url', 'thumbnail_url', 'file_size', 'mime_type',
            'width', 'height', 'uploaded_by', 'uploaded_by_username',
            'created_at', 'updated_at', 'placeholder',
        ]

    def get_url(self, obj):
        return obj.get_url()

    def get_thumbnail_url(self, obj):
        return obj.get_thumbnail_url()

    def get_uploaded_by_username(self, obj):
        if obj.uploaded_by:
            return obj.uploaded_by.get_full_name() or obj.uploaded_by.username
        return None

    def get_scope_display(self, obj):
        return obj.get_scope_display()

    def get_file_kind_display(self, obj):
        return obj.get_file_kind_display()

    def get_image_type_display(self, obj):
        return obj.get_image_type_display() if obj.image_type else None

    def get_team_name(self, obj):
        return obj.team.name if obj.team else None

    def get_organization_name(self, obj):
        return obj.organization.name if obj.organization else None

    def get_placeholder(self, obj):
        """Return [[image:<uuid>]] placeholder for images."""
        if obj.file_kind == 'image':
            return f'[[image:{obj.id}]]'
        return None


class AttachmentUploadSerializer(serializers.ModelSerializer):
    """Serializer used for creating / uploading an attachment."""

    class Meta:
        model = Attachment
        fields = [
            'name', 'description', 'file_kind', 'image_type',
            'file', 'scope', 'team', 'document', 'tags',
        ]

    def validate_file(self, value):
        max_size = 25 * 1024 * 1024  # 25 MB
        if value.size > max_size:
            raise serializers.ValidationError(
                f"File too large ({value.size / (1024*1024):.1f} MB). Maximum is 25 MB."
            )
        return value

    def validate(self, attrs):
        scope = attrs.get('scope', 'user')
        if scope == 'team' and not attrs.get('team'):
            raise serializers.ValidationError(
                {'team': "team is required when scope is 'team'."}
            )
        return attrs

    def create(self, validated_data):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            validated_data['uploaded_by'] = request.user
            # Auto-set organization from user profile
            try:
                validated_data['organization'] = request.user.profile.organization
            except Exception:
                pass
        return super().create(validated_data)
