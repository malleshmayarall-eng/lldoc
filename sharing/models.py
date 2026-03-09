from django.db import models
from django.contrib.auth.models import User
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
import uuid


class Share(models.Model):
    """
    Generic sharing model with role-based access control.
    Can share ANY model (Document, File, Folder, Project, etc.) using GenericForeignKey.
    
    Supports internal (user/team) and external (email/phone) sharing.
    
    SHARING MODES:
    - User: Direct share with registered user
    - Team: Share with entire team
    - Email: External invitation via email
    - Phone: External invitation via SMS/phone
    
    ROLES:
    - Viewer: Read-only access
    - Commenter: Can view and add comments
    - Editor: Full edit access
    
    USAGE:
        # Share document with user
        share = Share.objects.create(
            content_object=document,
            shared_with_user=user,
            role='editor',
            share_type='user',
            shared_by=owner
        )
        
        # Share any model with team
        share = Share.objects.create(
            content_object=project,  # or any other model
            shared_with_team=team,
            role='viewer',
            share_type='team'
        )
    """
    ROLE_CHOICES = [
        ('viewer', 'Viewer - Read Only'),
        ('commenter', 'Commenter - Can Comment'),
        ('editor', 'Editor - Full Edit Access'),
    ]
    
    SHARE_TYPE_CHOICES = [
        ('user', 'Shared with registered user'),
        ('team', 'Shared with team'),
        ('email', 'Shared via email invitation'),
        ('phone', 'Shared via phone invitation'),
        ('link', 'Public shareable link (anyone with link)'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Generic relation - can share ANY model
    content_type = models.ForeignKey(
        ContentType,
        on_delete=models.CASCADE,
        help_text="Type of content being shared (Document, File, Folder, etc.)"
    )
    object_id = models.CharField(
        max_length=255,
        help_text="ID of the content being shared"
    )
    content_object = GenericForeignKey('content_type', 'object_id')
    
    # Internal sharing (registered users/teams)
    shared_with_user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='received_shares',
        help_text="User this content is shared with"
    )
    shared_with_team = models.ForeignKey(
        'user_management.Team',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='received_shares',
        help_text="Team this content is shared with"
    )
    
    # External sharing (invitations)
    invitation_email = models.EmailField(
        null=True,
        blank=True,
        help_text="Email address for external invitation"
    )
    invitation_phone = models.CharField(
        max_length=20,
        null=True,
        blank=True,
        help_text="Phone number for external invitation"
    )
    invitation_token = models.CharField(
        max_length=64,
        unique=True,
        null=True,
        blank=True,
        help_text="Unique secure token for external access"
    )
    invitation_accepted = models.BooleanField(
        default=False,
        help_text="Whether external invitation has been accepted"
    )
    invitation_accepted_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When invitation was accepted"
    )
    invitation_message = models.TextField(
        blank=True,
        help_text="Custom message included in invitation"
    )
    
    # Permissions
    role = models.CharField(
        max_length=20,
        choices=ROLE_CHOICES,
        default='viewer',
        help_text="Access level granted"
    )
    share_type = models.CharField(
        max_length=20,
        choices=SHARE_TYPE_CHOICES,
        default='user',
        help_text="Type of share"
    )
    
    # Metadata
    shared_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_shares',
        help_text="User who created this share"
    )
    shared_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Optional expiration date for external shares"
    )
    is_active = models.BooleanField(
        default=True,
        help_text="Whether this share is currently active"
    )
    
    # Access tracking
    last_accessed_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Last time content was accessed via this share"
    )
    access_count = models.IntegerField(
        default=0,
        help_text="Number of times accessed via this share"
    )
    
    # Additional metadata
    metadata = models.JSONField(
        default=dict,
        blank=True,
        help_text="Additional share-specific metadata"
    )
    
    class Meta:
        indexes = [
            models.Index(fields=['content_type', 'object_id']),
            models.Index(fields=['shared_with_user']),
            models.Index(fields=['shared_with_team']),
            models.Index(fields=['invitation_email']),
            models.Index(fields=['invitation_phone']),
            models.Index(fields=['invitation_token']),
            models.Index(fields=['is_active']),
            models.Index(fields=['shared_at']),
        ]
        # Prevent duplicate shares for the same content + recipient
        constraints = [
            models.UniqueConstraint(
                fields=['content_type', 'object_id', 'shared_with_user'],
                name='unique_user_share',
                condition=models.Q(shared_with_user__isnull=False)
            ),
            models.UniqueConstraint(
                fields=['content_type', 'object_id', 'shared_with_team'],
                name='unique_team_share',
                condition=models.Q(shared_with_team__isnull=False)
            ),
            models.UniqueConstraint(
                fields=['content_type', 'object_id', 'invitation_email'],
                name='unique_email_share',
                condition=models.Q(invitation_email__isnull=False)
            ),
            models.UniqueConstraint(
                fields=['content_type', 'object_id', 'invitation_phone'],
                name='unique_phone_share',
                condition=models.Q(invitation_phone__isnull=False)
            ),
        ]
        ordering = ['-shared_at']
    
    def __str__(self):
        content_str = f"{self.content_type.model} #{self.object_id}"
        if self.shared_with_user:
            return f"{content_str} → {self.shared_with_user.username} ({self.role})"
        elif self.shared_with_team:
            return f"{content_str} → Team: {self.shared_with_team.name} ({self.role})"
        elif self.invitation_email:
            return f"{content_str} → {self.invitation_email} ({self.role})"
        elif self.invitation_phone:
            return f"{content_str} → {self.invitation_phone} ({self.role})"
        return f"Share {self.id}"
    
    def generate_invitation_token(self):
        """Generate cryptographically secure token for external sharing."""
        import secrets
        self.invitation_token = secrets.token_urlsafe(48)
        return self.invitation_token
    
    def is_expired(self):
        """Check if external share has expired."""
        if self.expires_at:
            from django.utils import timezone
            return timezone.now() > self.expires_at
        return False
    
    def can_access(self, user=None, token=None):
        """
        Check if user/token can access this share.
        
        Args:
            user: Django User instance (for registered users)
            token: Invitation token string (for external users)
        
        Returns:
            bool: Whether access is granted
        """
        if not self.is_active or self.is_expired():
            return False
        
        # Registered user access
        if user and self.shared_with_user == user:
            return True
        
        # Team access - check if user's profile is in the team
        if user and self.shared_with_team:
            try:
                user_profile = user.profile
                return self.shared_with_team.members.filter(id=user_profile.id).exists()
            except Exception:
                return False
        
        # External token access
        if token and self.invitation_token == token:
            return True
        
        return False
    
    def record_access(self):
        """Record that content was accessed via this share."""
        from django.utils import timezone
        self.last_accessed_at = timezone.now()
        self.access_count += 1
        self.save(update_fields=['last_accessed_at', 'access_count'])
    
    def get_content_title(self):
        """Get human-readable title of shared content."""
        try:
            if hasattr(self.content_object, 'title'):
                return self.content_object.title
            elif hasattr(self.content_object, 'name'):
                return self.content_object.name
            return str(self.content_object)
        except Exception:
            return f"{self.content_type.model} #{self.object_id}"


class AccessLog(models.Model):
    """
    Generic access tracking for any shared content.
    Records all access attempts for analytics, security, and compliance.
    
    USAGE:
        # Log document access
        log = AccessLog.objects.create(
            content_object=document,
            user=user,
            access_type='view',
            ip_address=request.META.get('REMOTE_ADDR'),
            share_id=share.id
        )
    """
    ACCESS_TYPE_CHOICES = [
        ('view', 'Viewed'),
        ('edit', 'Edited'),
        ('comment', 'Commented'),
        ('share', 'Shared'),
        ('download', 'Downloaded'),
        ('print', 'Printed'),
        ('export', 'Exported'),
        ('delete', 'Deleted'),
        ('restore', 'Restored'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Generic relation - can log access to ANY model
    content_type = models.ForeignKey(
        ContentType,
        on_delete=models.CASCADE,
        help_text="Type of content accessed"
    )
    object_id = models.CharField(
        max_length=255,
        help_text="ID of the content accessed"
    )
    content_object = GenericForeignKey('content_type', 'object_id')
    
    # User information
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='access_logs',
        help_text="User who accessed (null for external/anonymous)"
    )
    
    # For external/anonymous access
    access_token = models.CharField(
        max_length=64,
        null=True,
        blank=True,
        help_text="Token used for external access"
    )
    ip_address = models.GenericIPAddressField(
        null=True,
        blank=True,
        help_text="IP address of accessor"
    )
    user_agent = models.TextField(
        blank=True,
        help_text="Browser/client user agent"
    )
    
    # Access details
    access_type = models.CharField(
        max_length=20,
        choices=ACCESS_TYPE_CHOICES,
        default='view',
        help_text="Type of access"
    )
    accessed_at = models.DateTimeField(
        auto_now_add=True,
        help_text="When access occurred"
    )
    
    # Context
    share_id = models.UUIDField(
        null=True,
        blank=True,
        help_text="Share ID that granted access"
    )
    session_id = models.CharField(
        max_length=100,
        null=True,
        blank=True,
        help_text="Session identifier for tracking"
    )
    
    # Additional metadata
    metadata = models.JSONField(
        default=dict,
        blank=True,
        help_text="Additional access metadata (sections viewed, duration, etc.)"
    )
    
    # Result
    success = models.BooleanField(
        default=True,
        help_text="Whether access was successful"
    )
    error_message = models.TextField(
        blank=True,
        help_text="Error message if access failed"
    )
    
    class Meta:
        ordering = ['-accessed_at']
        indexes = [
            models.Index(fields=['content_type', 'object_id', '-accessed_at']),
            models.Index(fields=['user', '-accessed_at']),
            models.Index(fields=['access_token']),
            models.Index(fields=['ip_address']),
            models.Index(fields=['access_type']),
            models.Index(fields=['-accessed_at']),
        ]
    
    def __str__(self):
        user_info = self.user.username if self.user else (f"Token: {self.access_token[:8]}..." if self.access_token else "Anonymous")
        content_str = f"{self.content_type.model} #{self.object_id}"
        return f"{self.access_type} by {user_info} on {content_str}"
    
    def get_content_title(self):
        """Get human-readable title of accessed content."""
        try:
            if hasattr(self.content_object, 'title'):
                return self.content_object.title
            elif hasattr(self.content_object, 'name'):
                return self.content_object.name
            return str(self.content_object)
        except Exception:
            return f"{self.content_type.model} #{self.object_id}"
