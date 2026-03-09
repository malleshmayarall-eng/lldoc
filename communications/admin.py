from django.contrib import admin
from .models import Alert, AlertPreference


@admin.register(Alert)
class AlertAdmin(admin.ModelAdmin):
    list_display = ['title', 'category', 'priority', 'recipient', 'is_read', 'email_sent', 'created_at']
    list_filter = ['category', 'priority', 'is_read', 'email_sent', 'created_at']
    search_fields = ['title', 'message', 'recipient__username', 'recipient__email']
    readonly_fields = ['id', 'created_at', 'channels_delivered', 'email_error']
    date_hierarchy = 'created_at'


@admin.register(AlertPreference)
class AlertPreferenceAdmin(admin.ModelAdmin):
    list_display = ['user', 'category', 'channel', 'enabled']
    list_filter = ['channel', 'enabled', 'category']
    search_fields = ['user__username', 'user__email', 'category']
