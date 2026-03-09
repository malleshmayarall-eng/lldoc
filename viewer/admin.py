from django.contrib import admin
from .models import ViewerToken, ViewerOTP, ViewerSession, ViewerAccessLog, ViewerComment, ViewerApproval, ViewerAlert


@admin.register(ViewerToken)
class ViewerTokenAdmin(admin.ModelAdmin):
    list_display = [
        'token_short', 'document', 'access_mode', 'role',
        'recipient_email', 'is_active', 'access_count', 'created_at',
    ]
    list_filter = ['access_mode', 'role', 'is_active']
    search_fields = ['token', 'recipient_email', 'recipient_name']
    readonly_fields = ['token', 'access_count', 'created_at', 'updated_at']

    def token_short(self, obj):
        return f"{obj.token[:16]}…"
    token_short.short_description = 'Token'


@admin.register(ViewerOTP)
class ViewerOTPAdmin(admin.ModelAdmin):
    list_display = ['email', 'viewer_token', 'is_used', 'attempts', 'created_at', 'expires_at']
    list_filter = ['is_used']
    search_fields = ['email']


@admin.register(ViewerSession)
class ViewerSessionAdmin(admin.ModelAdmin):
    list_display = ['session_short', 'email', 'viewer_token', 'is_active', 'created_at', 'expires_at']
    list_filter = ['is_active']
    search_fields = ['email', 'session_token']

    def session_short(self, obj):
        return f"{obj.session_token[:16]}…"
    session_short.short_description = 'Session'


@admin.register(ViewerAccessLog)
class ViewerAccessLogAdmin(admin.ModelAdmin):
    list_display = ['viewer_token', 'document', 'action', 'email', 'ip_address', 'accessed_at']
    list_filter = ['action']
    search_fields = ['email', 'ip_address']
    readonly_fields = ['accessed_at']


@admin.register(ViewerComment)
class ViewerCommentAdmin(admin.ModelAdmin):
    list_display = [
        'author_email', 'target_type', 'text_short', 'document',
        'is_resolved', 'created_at',
    ]
    list_filter = ['target_type', 'is_resolved']
    search_fields = ['author_email', 'author_name', 'text']
    readonly_fields = ['created_at', 'updated_at']

    def text_short(self, obj):
        return (obj.text or '')[:60]
    text_short.short_description = 'Comment'


@admin.register(ViewerApproval)
class ViewerApprovalAdmin(admin.ModelAdmin):
    list_display = [
        'status', 'reviewer_email', 'reviewer_name', 'document',
        'comment_short', 'created_at',
    ]
    list_filter = ['status']
    search_fields = ['reviewer_email', 'reviewer_name', 'comment']
    readonly_fields = ['created_at']

    def comment_short(self, obj):
        return (obj.comment or '')[:60]
    comment_short.short_description = 'Comment'


@admin.register(ViewerAlert)
class ViewerAlertAdmin(admin.ModelAdmin):
    list_display = [
        'alert_type', 'message_short', 'recipient_email',
        'triggered_by_email', 'is_read', 'document', 'created_at',
    ]
    list_filter = ['alert_type', 'is_read']
    search_fields = ['recipient_email', 'triggered_by_email', 'message']
    readonly_fields = ['created_at']

    def message_short(self, obj):
        return (obj.message or '')[:60]
    message_short.short_description = 'Message'
