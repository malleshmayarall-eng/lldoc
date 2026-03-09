"""
Document Metadata Serializers

Serializers for flexible JSON-based metadata management.
"""

from rest_framework import serializers
from typing import Dict, Any, List, Optional


class MetadataFieldSerializer(serializers.Serializer):
    """Serializer for a single metadata field update."""
    field = serializers.CharField(required=True, help_text="Field path (supports dot notation)")
    value = serializers.JSONField(required=True, help_text="Value to set")
    target = serializers.ChoiceField(
        choices=['document_metadata', 'custom_metadata', 'auto'],
        default='auto',
        help_text="Target metadata store"
    )


class MetadataExtractRequestSerializer(serializers.Serializer):
    """Serializer for metadata extraction request."""
    fields = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        help_text="List of field paths to extract (supports dot notation)"
    )
    include_custom = serializers.BooleanField(default=True)
    include_structured = serializers.BooleanField(default=True)
    format = serializers.ChoiceField(
        choices=['nested', 'flat'],
        default='nested',
        help_text="Output format"
    )


class MetadataUploadSerializer(serializers.Serializer):
    """Serializer for metadata upload/update."""
    metadata = serializers.JSONField(required=True, help_text="Metadata to upload/update")
    target = serializers.ChoiceField(
        choices=['document_metadata', 'custom_metadata', 'auto'],
        default='auto',
        help_text="Target metadata store"
    )
    merge = serializers.BooleanField(
        default=False,
        help_text="Merge with existing metadata (True) or replace (False)"
    )
    create_changelog = serializers.BooleanField(
        default=True,
        help_text="Create changelog entry for this update"
    )


class MetadataBulkUpdateSerializer(serializers.Serializer):
    """Serializer for bulk metadata updates."""
    updates = serializers.ListField(
        child=MetadataFieldSerializer(),
        required=True,
        help_text="List of field updates"
    )
    create_changelog = serializers.BooleanField(
        default=True,
        help_text="Create changelog entry"
    )


class MetadataMergeSerializer(serializers.Serializer):
    """Serializer for metadata merge operation."""
    metadata = serializers.JSONField(required=True, help_text="Metadata to merge")
    target = serializers.ChoiceField(
        choices=['document_metadata', 'custom_metadata', 'both'],
        default='both',
        help_text="Target metadata store(s)"
    )


class MetadataRemoveSerializer(serializers.Serializer):
    """Serializer for metadata removal."""
    fields = serializers.ListField(
        child=serializers.CharField(),
        required=True,
        help_text="List of field paths to remove"
    )
    target = serializers.ChoiceField(
        choices=['document_metadata', 'custom_metadata', 'both'],
        default='both',
        help_text="Target metadata store(s)"
    )


class MetadataResponseSerializer(serializers.Serializer):
    """Serializer for metadata response."""
    document_id = serializers.UUIDField()
    document_metadata = serializers.JSONField()
    custom_metadata = serializers.JSONField()
    extracted_at = serializers.DateTimeField()


class MetadataExtractResponseSerializer(serializers.Serializer):
    """Serializer for metadata extraction response."""
    document_id = serializers.UUIDField()
    extracted_fields = serializers.JSONField()
    missing_fields = serializers.ListField(child=serializers.CharField())
    extracted_at = serializers.DateTimeField()


class MetadataUpdateResponseSerializer(serializers.Serializer):
    """Serializer for metadata update response."""
    document_id = serializers.UUIDField()
    updated_fields = serializers.ListField(child=serializers.CharField())
    updated_at = serializers.DateTimeField()
    changelog_id = serializers.UUIDField(required=False, allow_null=True)


class MetadataBulkUpdateResponseSerializer(serializers.Serializer):
    """Serializer for bulk update response."""
    document_id = serializers.UUIDField()
    successful_updates = serializers.ListField()
    failed_updates = serializers.ListField()
    updated_at = serializers.DateTimeField()


class MetadataSchemaResponseSerializer(serializers.Serializer):
    """Serializer for metadata schema response."""
    document_id = serializers.UUIDField()
    schema = serializers.JSONField()


class MetadataHistoryEntrySerializer(serializers.Serializer):
    """Serializer for a single metadata history entry."""
    id = serializers.UUIDField()
    change_type = serializers.CharField()
    changed_at = serializers.DateTimeField()
    changed_by = serializers.CharField()
    fields_changed = serializers.ListField(child=serializers.CharField())
    description = serializers.CharField()


class MetadataHistoryResponseSerializer(serializers.Serializer):
    """Serializer for metadata history response."""
    document_id = serializers.UUIDField()
    history = MetadataHistoryEntrySerializer(many=True)
