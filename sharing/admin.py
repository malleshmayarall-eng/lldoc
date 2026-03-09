from django.contrib import admin
from django.utils.html import format_html
from .models import Share, AccessLog


@admin.register(Share)
class ShareAdmin(admin.ModelAdmin):
    """Admin interface for Share model."""
    list_display = [
        'id',
        'content_display',
        'shared_with_display',
        'role',
        'share_type',
        'is_active',
        'shared_at',
        'access_count',
    ]
    list_filter = [
        'role',
        'share_type',
        'is_active',
        'shared_at',
        'content_type',
    ]
    search_fields = [
        'id',
        'shared_with_user__username',
        'shared_with_user__email',
        'shared_with_team__name',
        'invitation_email',
        'invitation_phone',
        'invitation_token',
    ]
    readonly_fields = [
        'id',
        'shared_at',
        'last_accessed_at',
        'access_count',
        'invitation_accepted_at',
    ]
    fieldsets = (
        ('Content', {
            'fields': ('content_type', 'object_id', 'content_object')
        }),
        ('Share Details', {
            'fields': ('role', 'share_type', 'is_active', 'expires_at')
        }),
        ('Internal Sharing', {
            'fields': ('shared_with_user', 'shared_with_team'),
            'classes': ('collapse',)
        }),
        ('External Invitation', {
            'fields': (
                'invitation_email',
                'invitation_phone',
                'invitation_token',
                'invitation_message',
                'invitation_accepted',
                'invitation_accepted_at',
            ),
            'classes': ('collapse',)
        }),
        ('Metadata', {
            'fields': ('shared_by', 'shared_at', 'last_accessed_at', 'access_count', 'metadata')
        }),
    )
    
    def content_display(self, obj):
        """Display content being shared."""
        try:
            title = obj.get_content_title()
            return format_html(
                '<strong>{}</strong><br><small>{}</small>',
                title,
                f"{obj.content_type.model} #{obj.object_id}"
            )
        except Exception:
            return f"{obj.content_type.model} #{obj.object_id}"
    content_display.short_description = 'Content'
    
    def shared_with_display(self, obj):
        """Display who content is shared with."""
        if obj.shared_with_user:
            return format_html(
                '<i class="fas fa-user"></i> {}',
                obj.shared_with_user.username
            )
        elif obj.shared_with_team:
            return format_html(
                '<i class="fas fa-users"></i> {}',
                obj.shared_with_team.name
            )
        elif obj.invitation_email:
            status = '✓' if obj.invitation_accepted else '✉'
            return format_html(
                '{} {}',
                status,
                obj.invitation_email
            )
        elif obj.invitation_phone:
            status = '✓' if obj.invitation_accepted else '📱'
            return format_html(
                '{} {}',
                status,
                obj.invitation_phone
            )
        return '-'
    shared_with_display.short_description = 'Shared With'


@admin.register(AccessLog)
class AccessLogAdmin(admin.ModelAdmin):
    """Admin interface for AccessLog model (read-only)."""
    list_display = [
        'id',
        'content_display',
        'user_display',
        'access_type',
        'success',
        'accessed_at',
        'ip_address',
    ]
    list_filter = [
        'access_type',
        'success',
        'accessed_at',
        'content_type',
    ]
    search_fields = [
        'id',
        'user__username',
        'user__email',
        'access_token',
        'ip_address',
        'session_id',
    ]
    readonly_fields = [
        'id',
        'content_type',
        'object_id',
        'user',
        'access_token',
        'ip_address',
        'user_agent',
        'access_type',
        'accessed_at',
        'share_id',
        'session_id',
        'metadata',
        'success',
        'error_message',
    ]
    date_hierarchy = 'accessed_at'
    
    def has_add_permission(self, request):
        """Disable manual creation - logs are auto-generated."""
        return False
    
    def has_change_permission(self, request, obj=None):
        """Disable editing - logs are immutable."""
        return False
    
    def content_display(self, obj):
        """Display content accessed."""
        try:
            title = obj.get_content_title()
            return format_html(
                '<strong>{}</strong><br><small>{}</small>',
                title,
                f"{obj.content_type.model} #{obj.object_id}"
            )
        except Exception:
            return f"{obj.content_type.model} #{obj.object_id}"
    content_display.short_description = 'Content'
    
    def user_display(self, obj):
        """Display user information."""
        if obj.user:
            return format_html(
                '<i class="fas fa-user"></i> {}',
                obj.user.username
            )
        elif obj.access_token:
            return format_html(
                '<i class="fas fa-key"></i> {}...',
                obj.access_token[:8]
            )
        return 'Anonymous'
    user_display.short_description = 'User'
