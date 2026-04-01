from rest_framework import serializers
from django.contrib.auth.models import User
from .models import (
    Organization,
    Role,
    UserProfile,
    Team,
    InvitationToken,
    OrganizationDocumentSettings,
    UserDocumentSettings,
    InputNodeCredential,
    DOMAIN_CHOICES,
    ALL_FEATURES,
    DOMAIN_DEFAULTS,
    get_domain_feature_defaults,
)


class UserSerializer(serializers.ModelSerializer):
    """Serializer for Django User model."""
    full_name = serializers.SerializerMethodField()
    
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'full_name', 'is_active', 'date_joined', 'last_login']
        read_only_fields = ['id', 'date_joined', 'last_login']
    
    def get_full_name(self, obj):
        return obj.get_full_name() or obj.username


class OrganizationSerializer(serializers.ModelSerializer):
    """Serializer for Organization model."""
    active_users_count = serializers.SerializerMethodField()
    feature_flags = serializers.SerializerMethodField()
    
    class Meta:
        model = Organization
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']
    
    def get_active_users_count(self, obj):
        return obj.get_active_users_count()

    def get_feature_flags(self, obj):
        """Resolved feature flags (domain defaults + org overrides)."""
        return obj.get_feature_flags()


class OrganizationListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for organization lists."""
    
    class Meta:
        model = Organization
        fields = ['id', 'name', 'organization_type', 'domain', 'subscription_plan', 'is_active', 'created_at']


class RoleSerializer(serializers.ModelSerializer):
    """Serializer for Role model."""
    users_count = serializers.SerializerMethodField()
    
    class Meta:
        model = Role
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']
    
    def get_users_count(self, obj):
        return obj.users.count()


class RoleListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for role lists."""
    
    class Meta:
        model = Role
        fields = ['id', 'name', 'display_name', 'role_type', 'is_active']


class UserProfileSerializer(serializers.ModelSerializer):
    """Serializer for UserProfile model."""
    user = UserSerializer(read_only=True)
    organization_name = serializers.CharField(source='organization.name', read_only=True)
    role_name = serializers.CharField(source='role.display_name', read_only=True)
    role_type = serializers.CharField(source='role.role_type', read_only=True)
    full_name = serializers.SerializerMethodField()
    
    class Meta:
        model = UserProfile
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at', 'email_verified_at', 
                          'password_changed_at', 'deactivated_at', 'login_count']
    
    def get_full_name(self, obj):
        return obj.get_full_name()


class UserProfileListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for user profile lists."""
    user_email = serializers.EmailField(source='user.email', read_only=True)
    full_name = serializers.SerializerMethodField()
    organization_name = serializers.CharField(source='organization.name', read_only=True)
    role_name = serializers.CharField(source='role.display_name', read_only=True)
    
    class Meta:
        model = UserProfile
        fields = ['id', 'full_name', 'user_email', 'organization_name', 'role_name', 
                 'job_title', 'is_active', 'created_at']
    
    def get_full_name(self, obj):
        return obj.get_full_name()


class OrganizationDocumentSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrganizationDocumentSettings
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at', 'organization']


class UserDocumentSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserDocumentSettings
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at', 'profile']


class InputNodeCredentialSerializer(serializers.ModelSerializer):
    """Serializer for reading saved input-node credentials (secrets redacted)."""
    credentials = serializers.SerializerMethodField()

    class Meta:
        model = InputNodeCredential
        fields = ['id', 'label', 'credential_type', 'credentials', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_credentials(self, obj):
        return obj.redacted


class InputNodeCredentialWriteSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating saved input-node credentials (accepts raw secrets)."""
    class Meta:
        model = InputNodeCredential
        fields = ['id', 'label', 'credential_type', 'credentials', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']


class UserProfileCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating user profiles."""
    username = serializers.CharField(write_only=True)
    email = serializers.EmailField(write_only=True)
    password = serializers.CharField(write_only=True, style={'input_type': 'password'})
    first_name = serializers.CharField(write_only=True, required=False)
    last_name = serializers.CharField(write_only=True, required=False)
    
    class Meta:
        model = UserProfile
        fields = ['username', 'email', 'password', 'first_name', 'last_name', 
                 'organization', 'role', 'job_title', 'department', 'phone']
    
    def create(self, validated_data):
        # Extract user data
        username = validated_data.pop('username')
        email = validated_data.pop('email')
        password = validated_data.pop('password')
        first_name = validated_data.pop('first_name', '')
        last_name = validated_data.pop('last_name', '')
        
        # Create user
        user = User.objects.create_user(
            username=username,
            email=email,
            password=password,
            first_name=first_name,
            last_name=last_name
        )
        
        # Create profile
        profile = UserProfile.objects.create(user=user, **validated_data)
        return profile


class TeamSerializer(serializers.ModelSerializer):
    """Serializer for Team model."""
    team_lead_name = serializers.CharField(source='team_lead.get_full_name', read_only=True)
    organization_name = serializers.CharField(source='organization.name', read_only=True)
    members_count = serializers.SerializerMethodField()
    members_list = UserProfileListSerializer(source='members', many=True, read_only=True)
    
    class Meta:
        model = Team
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']
    
    def get_members_count(self, obj):
        return obj.get_members_count()


class TeamListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for team lists."""
    team_lead_name = serializers.CharField(source='team_lead.get_full_name', read_only=True)
    members_count = serializers.SerializerMethodField()
    
    class Meta:
        model = Team
        fields = ['id', 'name', 'organization', 'team_lead_name', 'members_count', 'is_active', 'created_at']
    
    def get_members_count(self, obj):
        return obj.get_members_count()


class InvitationTokenSerializer(serializers.ModelSerializer):
    """Serializer for InvitationToken model."""
    organization_name = serializers.CharField(source='organization.name', read_only=True)
    role_name = serializers.CharField(source='role.display_name', read_only=True)
    invited_by_name = serializers.CharField(source='invited_by.get_full_name', read_only=True)
    
    class Meta:
        model = InvitationToken
        fields = '__all__'
        read_only_fields = ['id', 'token', 'created_at', 'used_at', 'is_used']


class InvitationCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating invitation tokens."""

    expires_at = serializers.DateTimeField(required=False, allow_null=True)
    
    class Meta:
        model = InvitationToken
        fields = ['email', 'organization', 'role', 'message', 'expires_at']
    
    def create(self, validated_data):
        import secrets
        from datetime import timedelta
        from django.utils import timezone
        
        # Generate secure token
        token = secrets.token_urlsafe(32)
        
        # Set expiry if not provided (default 7 days)
        if 'expires_at' not in validated_data:
            validated_data['expires_at'] = timezone.now() + timedelta(days=7)
        
        # Get invited_by from context
        request = self.context.get('request')
        if request and hasattr(request, 'user'):
            try:
                validated_data['invited_by'] = request.user.profile
            except:
                pass
        
        validated_data['token'] = token
        return super().create(validated_data)


# ──────────────────────────────────────────────────────────────────────
# Domain & Feature-Flag Serializers
# ──────────────────────────────────────────────────────────────────────

class DomainChoiceSerializer(serializers.Serializer):
    """Read-only: lists all available domains with their default feature flags."""
    value = serializers.CharField(help_text="Internal domain key, e.g. 'legal'")
    label = serializers.CharField(help_text="Human-readable label, e.g. 'Legal'")
    description = serializers.CharField(help_text="Short description of the domain", required=False, default='')
    default_features = serializers.DictField(help_text="Default feature flags for this domain")


class DomainSettingsSerializer(serializers.Serializer):
    """
    For PATCH /organizations/current/domain-settings/
    Accepts optional `domain` and/or `feature_overrides`.
    """
    domain = serializers.ChoiceField(choices=DOMAIN_CHOICES, required=False)
    feature_overrides = serializers.JSONField(required=False, default=dict)

    def validate_feature_overrides(self, value):
        """Ensure overrides only contain known categories/flags."""
        if not isinstance(value, dict):
            raise serializers.ValidationError("feature_overrides must be a dict.")
        for category, flags in value.items():
            if category not in ALL_FEATURES:
                raise serializers.ValidationError(
                    f"Unknown feature category '{category}'. "
                    f"Valid categories: {list(ALL_FEATURES.keys())}"
                )
            if not isinstance(flags, dict):
                raise serializers.ValidationError(
                    f"Flags for '{category}' must be a dict."
                )
            for flag_key, flag_val in flags.items():
                if flag_key not in ALL_FEATURES[category]:
                    raise serializers.ValidationError(
                        f"Unknown flag '{flag_key}' in category '{category}'. "
                        f"Valid flags: {list(ALL_FEATURES[category].keys())}"
                    )
                if flag_val not in (True, False, '__removed__'):
                    raise serializers.ValidationError(
                        f"Flag value for '{category}.{flag_key}' must be true, false, "
                        f"or '__removed__'."
                    )
        return value


class FeatureFlagsSerializer(serializers.Serializer):
    """Read-only: the fully-resolved feature flags for the current org."""
    domain = serializers.CharField()
    domain_label = serializers.CharField()
    feature_overrides = serializers.DictField()
    domain_defaults = serializers.DictField(help_text="Raw domain defaults before overrides", required=False, default=dict)
    resolved = serializers.DictField(help_text="Final merged flags after domain defaults + overrides")
