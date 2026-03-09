from rest_framework import serializers
from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone
from .models import Share, AccessLog
from user_management.models import Team


class UserBasicSerializer(serializers.ModelSerializer):
    """Minimal user info for sharing interfaces."""
    full_name = serializers.SerializerMethodField()
    
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'full_name']
        read_only_fields = fields
    
    def get_full_name(self, obj):
        return obj.get_full_name() or obj.username


class TeamBasicSerializer(serializers.ModelSerializer):
    """Minimal team info for sharing interfaces."""
    member_count = serializers.SerializerMethodField()
    
    class Meta:
        model = Team
        fields = ['id', 'name', 'description', 'member_count']
        read_only_fields = fields
    
    def get_member_count(self, obj):
        return obj.members.count()


class AccessLogSerializer(serializers.ModelSerializer):
    """Serializer for access log entries (read-only)."""
    user_info = UserBasicSerializer(source='user', read_only=True)
    content_title = serializers.SerializerMethodField()
    content_type_name = serializers.SerializerMethodField()
    
    class Meta:
        model = AccessLog
        fields = [
            'id',
            'content_type',
            'object_id',
            'content_title',
            'content_type_name',
            'user',
            'user_info',
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
        read_only_fields = fields
    
    def get_content_title(self, obj):
        return obj.get_content_title()
    
    def get_content_type_name(self, obj):
        return obj.content_type.model


class ShareSerializer(serializers.ModelSerializer):
    """Full share serializer for read operations."""
    shared_with_user_info = UserBasicSerializer(source='shared_with_user', read_only=True)
    shared_with_team_info = TeamBasicSerializer(source='shared_with_team', read_only=True)
    shared_by_info = UserBasicSerializer(source='shared_by', read_only=True)
    content_title = serializers.SerializerMethodField()
    content_type_name = serializers.SerializerMethodField()
    is_expired = serializers.SerializerMethodField()
    can_be_accepted = serializers.SerializerMethodField()
    
    class Meta:
        model = Share
        fields = [
            'id',
            'content_type',
            'object_id',
            'content_title',
            'content_type_name',
            'shared_with_user',
            'shared_with_user_info',
            'shared_with_team',
            'shared_with_team_info',
            'invitation_email',
            'invitation_phone',
            'invitation_token',
            'invitation_accepted',
            'invitation_accepted_at',
            'invitation_message',
            'role',
            'share_type',
            'shared_by',
            'shared_by_info',
            'shared_at',
            'expires_at',
            'is_active',
            'is_expired',
            'can_be_accepted',
            'last_accessed_at',
            'access_count',
            'metadata',
        ]
        read_only_fields = [
            'id',
            'shared_at',
            'invitation_accepted',
            'invitation_accepted_at',
            'last_accessed_at',
            'access_count',
        ]
    
    def get_content_title(self, obj):
        return obj.get_content_title()
    
    def get_content_type_name(self, obj):
        return obj.content_type.model
    
    def get_is_expired(self, obj):
        return obj.is_expired()
    
    def get_can_be_accepted(self, obj):
        """Check if this share can be accepted (external invitation not yet accepted)."""
        return (
            obj.share_type in ['email', 'phone'] and
            not obj.invitation_accepted and
            not obj.is_expired() and
            obj.is_active
        )


class CreateShareSerializer(serializers.Serializer):
    """Serializer for creating new shares."""
    # Content to share
    content_type_id = serializers.IntegerField(
        required=True,
        help_text="ContentType ID of the model being shared"
    )
    object_id = serializers.CharField(
        required=True,
        max_length=255,
        help_text="ID of the object being shared"
    )
    
    # Share target (one of these must be provided)
    shared_with_user_id = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="User ID to share with"
    )
    shared_with_team_id = serializers.UUIDField(
        required=False,
        allow_null=True,
        help_text="Team ID to share with"
    )
    invitation_email = serializers.EmailField(
        required=False,
        allow_null=True,
        help_text="Email for external invitation"
    )
    invitation_phone = serializers.CharField(
        required=False,
        allow_null=True,
        max_length=20,
        help_text="Phone for external invitation"
    )
    public_link = serializers.BooleanField(
        required=False,
        default=False,
        help_text="Create a public shareable link (anyone with link can access)"
    )
    
    # Share settings
    role = serializers.ChoiceField(
        choices=Share.ROLE_CHOICES,
        default='viewer',
        help_text="Access level to grant"
    )
    invitation_message = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text="Custom message for invitation"
    )
    expires_at = serializers.DateTimeField(
        required=False,
        allow_null=True,
        help_text="Optional expiration date"
    )
    metadata = serializers.JSONField(
        required=False,
        default=dict,
        help_text="Additional metadata"
    )
    
    def validate(self, data):
        """Ensure exactly one share target is provided or public_link is True."""
        targets = [
            data.get('shared_with_user_id'),
            data.get('shared_with_team_id'),
            data.get('invitation_email'),
            data.get('invitation_phone'),
        ]
        target_count = sum(1 for t in targets if t)
        
        # If public_link is True, no specific target needed
        if data.get('public_link'):
            if target_count > 0:
                raise serializers.ValidationError(
                    "Cannot specify both public_link and a specific share target"
                )
            # Public links are valid, continue validation
        else:
            # Not a public link, require a specific target
            if target_count == 0:
                raise serializers.ValidationError(
                    "Must provide one of: shared_with_user_id, shared_with_team_id, "
                    "invitation_email, invitation_phone, or set public_link=true"
                )
            if target_count > 1:
                raise serializers.ValidationError(
                    "Can only provide one share target at a time"
                )
        
        # Validate content exists
        try:
            content_type = ContentType.objects.get(id=data['content_type_id'])
            model_class = content_type.model_class()
            if not model_class.objects.filter(pk=data['object_id']).exists():
                raise serializers.ValidationError({
                    'object_id': f"{content_type.model} with id '{data['object_id']}' not found. "
                                f"Please verify the {content_type.model} exists."
                })
        except ContentType.DoesNotExist:
            raise serializers.ValidationError({
                'content_type_id': f"Invalid content_type_id: {data.get('content_type_id')}. "
                                  f"Use GET /api/sharing/shares/content-types/ to get valid IDs."
            })
        
        # Validate user exists
        if data.get('shared_with_user_id'):
            if not User.objects.filter(id=data['shared_with_user_id']).exists():
                raise serializers.ValidationError("User not found")
        
        # Validate team exists
        if data.get('shared_with_team_id'):
            if not Team.objects.filter(id=data['shared_with_team_id']).exists():
                raise serializers.ValidationError("Team not found")
        
        # Prevent editor role on public links (anyone with link)
        if data.get('public_link') and data.get('role') == 'editor':
            raise serializers.ValidationError({
                'role': "Public links cannot grant editor access. "
                        "Use 'viewer' or 'commenter' instead."
            })
        
        # Validate expiration is in future
        if data.get('expires_at') and data['expires_at'] <= timezone.now():
            raise serializers.ValidationError("Expiration date must be in the future")
        
        return data
    
    def create(self, validated_data):
        """
        Create or update share for the same user/team/email/phone.
        Prevents duplicate shares by updating existing ones.
        """
        # Check if this is a public link
        is_public_link = validated_data.pop('public_link', False)
        
        # Determine share type
        if is_public_link:
            share_type = 'link'
        elif validated_data.get('shared_with_user_id'):
            share_type = 'user'
            user_id = validated_data.pop('shared_with_user_id')
        elif validated_data.get('shared_with_team_id'):
            share_type = 'team'
            team_id = validated_data.pop('shared_with_team_id')
        elif validated_data.get('invitation_email'):
            share_type = 'email'
        elif validated_data.get('invitation_phone'):
            share_type = 'phone'
        
        # Get content type
        content_type = ContentType.objects.get(id=validated_data.pop('content_type_id'))
        object_id = validated_data.pop('object_id')
        
        # Build lookup dict to check for existing share
        lookup_dict = {
            'content_type': content_type,
            'object_id': object_id,
            'share_type': share_type,
        }
        
        # Add specific lookup field based on share type
        if share_type == 'user':
            shared_with_user = User.objects.get(id=user_id)
            lookup_dict['shared_with_user'] = shared_with_user
        elif share_type == 'team':
            shared_with_team = Team.objects.get(id=team_id)
            lookup_dict['shared_with_team'] = shared_with_team
        elif share_type == 'email':
            lookup_dict['invitation_email'] = validated_data.get('invitation_email')
        elif share_type == 'phone':
            lookup_dict['invitation_phone'] = validated_data.get('invitation_phone')
        
        # Use update_or_create to prevent duplicates
        defaults = {
            'shared_by': self.context['request'].user,
            'is_active': True,  # Reactivate if was inactive
            **validated_data
        }
        
        share, created = Share.objects.update_or_create(
            **lookup_dict,
            defaults=defaults
        )
        
        # Generate token for external shares and public links if newly created
        if created and share_type in ['email', 'phone', 'link']:
            share.generate_invitation_token()
            share.save()
        
        return share


class UpdateShareSerializer(serializers.Serializer):
    """Serializer for updating existing shares."""
    role = serializers.ChoiceField(
        choices=Share.ROLE_CHOICES,
        required=False,
        help_text="Update access level"
    )
    is_active = serializers.BooleanField(
        required=False,
        help_text="Activate or deactivate share"
    )
    expires_at = serializers.DateTimeField(
        required=False,
        allow_null=True,
        help_text="Update expiration date"
    )
    invitation_message = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text="Update invitation message"
    )
    metadata = serializers.JSONField(
        required=False,
        help_text="Update metadata"
    )
    
    def validate_expires_at(self, value):
        """Ensure expiration is in future if provided."""
        if value and value <= timezone.now():
            raise serializers.ValidationError("Expiration date must be in the future")
        return value
    
    def validate(self, data):
        """Prevent editor role on public link shares."""
        if data.get('role') == 'editor' and self.instance and self.instance.share_type == 'link':
            raise serializers.ValidationError({
                'role': "Public links cannot grant editor access. "
                        "Use 'viewer' or 'commenter' instead."
            })
        return data
    
    def update(self, instance, validated_data):
        """Update share with validated data."""
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        return instance


class AcceptInvitationSerializer(serializers.Serializer):
    """Serializer for accepting external invitations."""
    token = serializers.CharField(
        required=True,
        max_length=64,
        help_text="Invitation token"
    )
    
    def validate_token(self, value):
        """Validate token exists and is valid."""
        try:
            share = Share.objects.get(invitation_token=value)
            
            if share.invitation_accepted:
                raise serializers.ValidationError("Invitation already accepted")
            
            if not share.is_active:
                raise serializers.ValidationError("Share is not active")
            
            if share.is_expired():
                raise serializers.ValidationError("Invitation has expired")
            
            self.context['share'] = share
            return value
            
        except Share.DoesNotExist:
            raise serializers.ValidationError("Invalid invitation token")


class UserSearchSerializer(serializers.Serializer):
    """Serializer for user/team search results."""
    id = serializers.IntegerField()
    type = serializers.CharField()  # 'user' or 'team'
    name = serializers.CharField()
    email = serializers.EmailField(required=False, allow_null=True)
    username = serializers.CharField(required=False, allow_null=True)
    description = serializers.CharField(required=False, allow_null=True)
    member_count = serializers.IntegerField(required=False, allow_null=True)
    similarity = serializers.FloatField(required=False, allow_null=True)


class ShareAnalyticsSerializer(serializers.Serializer):
    """Serializer for share analytics data."""
    total_shares = serializers.IntegerField()
    active_shares = serializers.IntegerField()
    internal_shares = serializers.IntegerField()
    external_shares = serializers.IntegerField()
    pending_invitations = serializers.IntegerField()
    shares_by_role = serializers.DictField()
    shares_by_content_type = serializers.DictField()
    most_shared_content = serializers.ListField()
    recent_activity = serializers.ListField()
