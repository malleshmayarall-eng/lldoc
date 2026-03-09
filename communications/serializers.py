"""
alerts/serializers.py
"""
from rest_framework import serializers
from .models import Alert, AlertPreference, CATEGORY_CHOICES, CHANNEL_CHOICES


class AlertSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = Alert
        fields = [
            'id',
            'category',
            'priority',
            'title',
            'message',
            'target_type',
            'target_id',
            'metadata',
            'is_read',
            'read_at',
            'email_sent',
            'channels_delivered',
            'actor',
            'actor_name',
            'created_at',
        ]
        read_only_fields = fields

    def get_actor_name(self, obj) -> str | None:
        if obj.actor:
            name = obj.actor.get_full_name()
            return name if name.strip() else obj.actor.username
        return None


class AlertPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = AlertPreference
        fields = ['id', 'category', 'channel', 'enabled']
        read_only_fields = ['id']

    def validate_category(self, value):
        valid_keys = {k for k, _ in CATEGORY_CHOICES} | {'*'}
        if value not in valid_keys:
            raise serializers.ValidationError(
                f'Unknown category "{value}". '
                f'Valid: {", ".join(sorted(valid_keys))}'
            )
        return value

    def validate_channel(self, value):
        valid = {k for k, _ in CHANNEL_CHOICES}
        if value not in valid:
            raise serializers.ValidationError(
                f'Unknown channel "{value}". Valid: {", ".join(sorted(valid))}'
            )
        return value


class BulkMarkReadSerializer(serializers.Serializer):
    """Accepts an optional list of alert IDs; if empty → mark ALL read."""
    alert_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        default=list,
    )


class AlertCategoriesSerializer(serializers.Serializer):
    """Returns available categories for preference management."""
    key = serializers.CharField()
    label = serializers.CharField()
