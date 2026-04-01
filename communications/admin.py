from django.contrib import admin
from .models import Alert, AlertPreference, WebhookEndpoint, WebhookDelivery, NotificationDigest


@admin.register(Alert)
class AlertAdmin(admin.ModelAdmin):
    list_display = [
        'title', 'category', 'priority', 'recipient', 'is_read',
        'is_archived', 'delivery_status', 'email_sent', 'created_at',
    ]
    list_filter = [
        'category', 'priority', 'is_read', 'is_archived',
        'delivery_status', 'email_sent', 'created_at',
    ]
    search_fields = ['title', 'message', 'recipient__username', 'recipient__email']
    readonly_fields = [
        'id', 'created_at', 'channels_requested', 'channels_delivered',
        'email_error', 'dedup_key', 'delivery_attempts', 'last_error',
    ]
    date_hierarchy = 'created_at'

    fieldsets = (
        ('Alert', {
            'fields': ('id', 'recipient', 'actor', 'category', 'priority', 'title', 'message'),
        }),
        ('Target', {
            'fields': ('target_type', 'target_id', 'metadata', 'group_key'),
        }),
        ('Delivery', {
            'fields': (
                'channels_requested', 'channels_delivered', 'delivery_status',
                'email_sent', 'email_error', 'delivery_attempts',
                'max_retries', 'next_retry_at', 'last_error',
            ),
        }),
        ('State', {
            'fields': ('is_read', 'read_at', 'is_archived', 'archived_at', 'expires_at'),
        }),
        ('Dedup', {
            'fields': ('dedup_key',),
            'classes': ('collapse',),
        }),
    )


@admin.register(AlertPreference)
class AlertPreferenceAdmin(admin.ModelAdmin):
    list_display = ['user', 'category', 'channel', 'enabled', 'digest_frequency']
    list_filter = ['channel', 'enabled', 'category', 'digest_frequency']
    search_fields = ['user__username', 'user__email', 'category']


@admin.register(WebhookEndpoint)
class WebhookEndpointAdmin(admin.ModelAdmin):
    list_display = [
        'name', 'user', 'url', 'is_active', 'consecutive_failures',
        'last_success_at', 'created_at',
    ]
    list_filter = ['is_active', 'created_at']
    search_fields = ['name', 'url', 'user__username']
    readonly_fields = [
        'id', 'consecutive_failures', 'last_success_at', 'last_failure_at',
        'last_error', 'created_at', 'updated_at',
    ]


@admin.register(WebhookDelivery)
class WebhookDeliveryAdmin(admin.ModelAdmin):
    list_display = [
        'endpoint', 'alert', 'success', 'response_status',
        'response_time_ms', 'attempt_number', 'created_at',
    ]
    list_filter = ['success', 'response_status', 'created_at']
    readonly_fields = [
        'id', 'endpoint', 'alert', 'request_body', 'request_headers',
        'response_status', 'response_body', 'response_time_ms',
        'success', 'error', 'attempt_number', 'created_at',
    ]
    date_hierarchy = 'created_at'


@admin.register(NotificationDigest)
class NotificationDigestAdmin(admin.ModelAdmin):
    list_display = [
        'user', 'frequency', 'alert_count', 'email_sent', 'sent_at', 'created_at',
    ]
    list_filter = ['frequency', 'email_sent', 'created_at']
    readonly_fields = ['id', 'alert_ids', 'created_at']
    date_hierarchy = 'created_at'
