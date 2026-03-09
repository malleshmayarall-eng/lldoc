from django.contrib import admin
from .models import Organization, Role, UserProfile, Team, InvitationToken, LoginOTP


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ['name', 'organization_type', 'subscription_plan', 'is_active', 'created_at']
    list_filter = ['organization_type', 'subscription_plan', 'is_active', 'country']
    search_fields = ['name', 'legal_name', 'email']
    readonly_fields = ['id', 'created_at', 'updated_at']
    
    fieldsets = (
        ('Basic Information', {
            'fields': ('name', 'legal_name', 'organization_type', 'is_active')
        }),
        ('Contact Information', {
            'fields': ('email', 'phone', 'website')
        }),
        ('Address', {
            'fields': ('address_line1', 'address_line2', 'city', 'state', 'postal_code', 'country')
        }),
        ('Business Information', {
            'fields': ('tax_id', 'registration_number')
        }),
        ('Branding', {
            'fields': ('logo', 'primary_color', 'secondary_color')
        }),
        ('Subscription', {
            'fields': ('subscription_plan', 'max_users', 'max_documents')
        }),
        ('Settings', {
            'fields': ('settings',)
        }),
        ('System', {
            'fields': ('id', 'created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ['display_name', 'role_type', 'is_system_role', 'is_active', 'priority']
    list_filter = ['role_type', 'is_system_role', 'is_active']
    search_fields = ['name', 'display_name', 'description']
    readonly_fields = ['id', 'created_at', 'updated_at']
    
    fieldsets = (
        ('Basic Information', {
            'fields': ('name', 'display_name', 'description', 'role_type')
        }),
        ('Permissions', {
            'fields': ('permissions',)
        }),
        ('Settings', {
            'fields': ('is_system_role', 'is_active', 'priority')
        }),
        ('System', {
            'fields': ('id', 'created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ['get_full_name', 'user_email', 'organization', 'role', 'is_active', 'created_at']
    list_filter = ['is_active', 'is_verified', 'role', 'organization', 'two_factor_enabled']
    search_fields = ['user__username', 'user__email', 'user__first_name', 'user__last_name', 'job_title']
    readonly_fields = ['id', 'created_at', 'updated_at', 'email_verified_at', 'password_changed_at']
    
    def user_email(self, obj):
        return obj.user.email
    user_email.short_description = 'Email'
    
    fieldsets = (
        ('User Account', {
            'fields': ('user', 'organization', 'role', 'is_active', 'is_verified')
        }),
        ('Personal Information', {
            'fields': ('job_title', 'department', 'phone', 'mobile', 'avatar')
        }),
        ('Professional Details', {
            'fields': ('bar_number', 'license_state', 'specialization')
        }),
        ('Preferences', {
            'fields': ('timezone', 'language', 'date_format', 'notifications_enabled', 'email_notifications', 'preferences')
        }),
        ('Security', {
            'fields': ('two_factor_enabled', 'password_changed_at', 'force_password_change', 'failed_login_attempts', 'account_locked_until')
        }),
        ('Login Tracking', {
            'fields': ('last_login_ip', 'last_login_location', 'login_count'),
            'classes': ('collapse',)
        }),
        ('System', {
            'fields': ('id', 'created_at', 'updated_at', 'deactivated_at'),
            'classes': ('collapse',)
        }),
    )


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    list_display = ['name', 'organization', 'team_lead', 'is_active', 'is_public', 'get_members_count']
    list_filter = ['organization', 'is_active', 'is_public']
    search_fields = ['name', 'description']
    readonly_fields = ['id', 'created_at', 'updated_at']
    filter_horizontal = ['members']
    
    fieldsets = (
        ('Basic Information', {
            'fields': ('name', 'description', 'organization', 'team_lead')
        }),
        ('Members', {
            'fields': ('members',)
        }),
        ('Settings', {
            'fields': ('is_active', 'is_public')
        }),
        ('System', {
            'fields': ('id', 'created_by', 'created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )


@admin.register(InvitationToken)
class InvitationTokenAdmin(admin.ModelAdmin):
    list_display = ['email', 'organization', 'role', 'is_used', 'is_expired', 'created_at', 'expires_at']
    list_filter = ['is_used', 'is_expired', 'organization', 'role']
    search_fields = ['email', 'token']
    readonly_fields = ['id', 'token', 'created_at', 'used_at']
    
    fieldsets = (
        ('Invitation Details', {
            'fields': ('email', 'organization', 'role', 'message')
        }),
        ('Status', {
            'fields': ('token', 'is_used', 'is_expired', 'used_at')
        }),
        ('Metadata', {
            'fields': ('invited_by', 'created_at', 'expires_at')
        }),
        ('System', {
            'fields': ('id',),
            'classes': ('collapse',)
        }),
    )


@admin.register(LoginOTP)
class LoginOTPAdmin(admin.ModelAdmin):
    list_display = ['user', 'is_used', 'expires_at', 'created_at']
    list_filter = ['is_used']
    search_fields = ['user__email', 'user__username']
    readonly_fields = ['id', 'otp_hash', 'created_at']
    raw_id_fields = ['user']

