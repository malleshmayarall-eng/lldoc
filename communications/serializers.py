"""
communications/serializers.py — REST serializers for the notification system
=============================================================================

Serializers:
  - AlertSerializer            — full alert detail (read-only list/detail)
  - AlertPreferenceSerializer  — user preference CRUD
  - BulkMarkReadSerializer     — bulk mark-read request body
  - BulkArchiveSerializer      — bulk archive request body
  - WebhookEndpointSerializer  — webhook endpoint CRUD
  - WebhookDeliverySerializer  — webhook delivery log (read-only)
  - NotificationStatsSerializer — notification stats response
  - AlertCategoriesSerializer  — category list response
"""
from rest_framework import serializers
from .models import (
    Alert,
    AlertPreference,
    WebhookEndpoint,
    WebhookDelivery,
    NotificationDigest,
    CATEGORY_CHOICES,
    CHANNEL_CHOICES,
    DIGEST_FREQUENCY_CHOICES,
)


class AlertSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()
    category_label = serializers.SerializerMethodField()
    is_expired = serializers.BooleanField(read_only=True)

    class Meta:
        model = Alert
        fields = [
            'id',
            'category',
            'category_label',
            'priority',
            'title',
            'message',
            'target_type',
            'target_id',
            'metadata',
            'dedup_key',
            'group_key',
            'is_read',
            'read_at',
            'is_archived',
            'archived_at',
            'email_sent',
            'delivery_status',
            'channels_requested',
            'channels_delivered',
            'is_expired',
            'expires_at',
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

    def get_category_label(self, obj) -> str:
        from .models import CATEGORY_LOOKUP
        return CATEGORY_LOOKUP.get(obj.category, obj.category)


class AlertCompactSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for list endpoints — fewer fields for performance.
    """
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = Alert
        fields = [
            'id', 'category', 'priority', 'title',
            'target_type', 'target_id', 'group_key',
            'is_read', 'actor_name', 'created_at',
        ]
        read_only_fields = fields

    def get_actor_name(self, obj) -> str | None:
        if obj.actor:
            name = obj.actor.get_full_name()
            return name if name.strip() else obj.actor.username
        return None


class AlertPreferenceSerializer(serializers.ModelSerializer):
    digest_frequency_display = serializers.SerializerMethodField()

    class Meta:
        model = AlertPreference
        fields = [
            'id', 'category', 'channel', 'enabled',
            'digest_frequency', 'digest_frequency_display',
            'quiet_hours_start', 'quiet_hours_end',
        ]
        read_only_fields = ['id']

    def get_digest_frequency_display(self, obj) -> str:
        return dict(DIGEST_FREQUENCY_CHOICES).get(obj.digest_frequency, obj.digest_frequency)

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

    def validate(self, attrs):
        # quiet_hours must have both start and end, or neither
        start = attrs.get('quiet_hours_start')
        end = attrs.get('quiet_hours_end')
        if (start is None) != (end is None):
            raise serializers.ValidationError(
                'quiet_hours_start and quiet_hours_end must both be set or both be null.'
            )
        return attrs


class BulkMarkReadSerializer(serializers.Serializer):
    """Accepts an optional list of alert IDs; if empty → mark ALL read."""
    alert_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        default=list,
    )


class BulkArchiveSerializer(serializers.Serializer):
    """Accepts an optional list of alert IDs to archive."""
    alert_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        default=list,
    )
    # If True, archive all read alerts
    archive_all_read = serializers.BooleanField(required=False, default=False)


class BulkActionSerializer(serializers.Serializer):
    """Generic bulk action on alert IDs."""
    alert_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=True,
        min_length=1,
    )
    action = serializers.ChoiceField(
        choices=['mark_read', 'mark_unread', 'archive', 'unarchive', 'delete'],
    )


class WebhookEndpointSerializer(serializers.ModelSerializer):
    delivery_stats = serializers.SerializerMethodField()

    class Meta:
        model = WebhookEndpoint
        fields = [
            'id', 'name', 'url', 'secret', 'categories', 'custom_headers',
            'is_active', 'consecutive_failures', 'auto_disable_threshold',
            'last_success_at', 'last_failure_at', 'last_error',
            'delivery_stats', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'consecutive_failures', 'last_success_at', 'last_failure_at',
            'last_error', 'delivery_stats', 'created_at', 'updated_at',
        ]
        extra_kwargs = {
            'secret': {'write_only': True},  # Don't expose secret in reads
        }

    def get_delivery_stats(self, obj) -> dict:
        """Quick delivery stats for the last 24 hours."""
        from django.utils import timezone
        cutoff = timezone.now() - timezone.timedelta(hours=24)
        deliveries = obj.deliveries.filter(created_at__gte=cutoff)
        total = deliveries.count()
        success = deliveries.filter(success=True).count()
        return {
            'total_24h': total,
            'success_24h': success,
            'failure_24h': total - success,
            'success_rate': round(success / total * 100, 1) if total > 0 else None,
        }

    def validate_url(self, value):
        if not value.startswith('https://'):
            raise serializers.ValidationError('Webhook URL must use HTTPS.')
        return value


class WebhookDeliverySerializer(serializers.ModelSerializer):
    endpoint_name = serializers.CharField(source='endpoint.name', read_only=True)

    class Meta:
        model = WebhookDelivery
        fields = [
            'id', 'endpoint', 'endpoint_name', 'alert',
            'request_body', 'request_headers',
            'response_status', 'response_body', 'response_time_ms',
            'success', 'error', 'attempt_number', 'created_at',
        ]
        read_only_fields = fields


class NotificationDigestSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationDigest
        fields = [
            'id', 'frequency', 'alert_count', 'alert_ids',
            'period_start', 'period_end',
            'email_sent', 'email_error', 'sent_at', 'created_at',
        ]
        read_only_fields = fields


class NotificationStatsSerializer(serializers.Serializer):
    """Response schema for the notification stats endpoint."""
    total = serializers.IntegerField()
    unread = serializers.IntegerField()
    urgent_unread = serializers.IntegerField()
    high_unread = serializers.IntegerField()
    by_category = serializers.DictField(child=serializers.IntegerField())


class AlertCategoriesSerializer(serializers.Serializer):
    """Returns available categories for preference management."""
    key = serializers.CharField()
    label = serializers.CharField()
    group = serializers.SerializerMethodField()

    def get_group(self, obj) -> str:
        """Extract the top-level group from the dotted key."""
        return obj.get('key', '').split('.')[0].title()


class PreferenceBulkUpdateSerializer(serializers.Serializer):
    """
    Bulk upsert preferences: set many category × channel pairs at once.

    Body: {"preferences": [{"category": "...", "channel": "...", "enabled": true}, ...]}
    """
    preferences = serializers.ListField(
        child=serializers.DictField(),
        min_length=1,
    )

    def validate_preferences(self, value):
        valid_cats = {k for k, _ in CATEGORY_CHOICES} | {'*'}
        valid_channels = {k for k, _ in CHANNEL_CHOICES}
        for item in value:
            if 'category' not in item or 'channel' not in item:
                raise serializers.ValidationError(
                    'Each preference must have "category" and "channel".'
                )
            if item['category'] not in valid_cats:
                raise serializers.ValidationError(f'Unknown category: {item["category"]}')
            if item['channel'] not in valid_channels:
                raise serializers.ValidationError(f'Unknown channel: {item["channel"]}')
        return value
