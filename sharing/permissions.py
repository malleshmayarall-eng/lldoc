from rest_framework import permissions
from django.contrib.contenttypes.models import ContentType
from .models import Share
from user_management.models import Team


class HasSharePermission(permissions.BasePermission):
    """
    Check if user has permission to access content via share.
    
    Usage in views:
        permission_classes = [HasSharePermission]
        
    Checks:
    - Direct user share
    - Team share (if user is member)
    - External token access (in request)
    - Content ownership (if model has 'owner' or 'created_by')
    """
    
    def has_object_permission(self, request, view, obj):
        """
        Check if user can access specific object via sharing.
        """
        user = request.user
        
        # Anonymous users need token
        if not user.is_authenticated:
            token = request.GET.get('token') or request.POST.get('token')
            if token:
                return self._check_token_access(obj, token)
            return False
        
        # Check if user owns content (common pattern)
        if hasattr(obj, 'owner') and obj.owner == user:
            return True
        if hasattr(obj, 'created_by') and obj.created_by == user:
            return True
        
        # Check if content is shared with user
        content_type = ContentType.objects.get_for_model(obj)
        
        # Direct user share
        user_share = Share.objects.filter(
            content_type=content_type,
            object_id=str(obj.pk),
            shared_with_user=user,
            is_active=True
        ).first()
        
        if user_share and not user_share.is_expired():
            # Store share in request for role checking
            request.share = user_share
            return True
        
        # Team share - Team.members expects UserProfile, not User
        try:
            user_profile = user.profile
            user_teams = Team.objects.filter(members=user_profile)
        except Exception:
            user_teams = Team.objects.none()
            
        team_share = Share.objects.filter(
            content_type=content_type,
            object_id=str(obj.pk),
            shared_with_team__in=user_teams,
            is_active=True
        ).first()
        
        if team_share and not team_share.is_expired():
            request.share = team_share
            return True
        
        # Check token access for authenticated users too
        token = request.GET.get('token') or request.POST.get('token')
        if token:
            return self._check_token_access(obj, token)
        
        return False
    
    def _check_token_access(self, obj, token):
        """Check if token grants access to object."""
        content_type = ContentType.objects.get_for_model(obj)
        
        share = Share.objects.filter(
            content_type=content_type,
            object_id=str(obj.pk),
            invitation_token=token,
            is_active=True
        ).first()
        
        if share and not share.is_expired():
            return True
        
        return False


class CanManageShares(permissions.BasePermission):
    """
    Check if user can create/modify shares for content.
    
    Usage in views:
        permission_classes = [CanManageShares]
        
    Checks:
    - User owns the content
    - User has 'editor' role share (can re-share)
    - User is admin/staff
    """
    
    def has_permission(self, request, view):
        """Check if user can manage shares in general."""
        # Must be authenticated
        return request.user and request.user.is_authenticated
    
    def has_object_permission(self, request, view, obj):
        """
        Check if user can manage shares for specific content.
        """
        user = request.user
        
        # Staff/admin can manage all shares
        if user.is_staff or user.is_superuser:
            return True
        
        # For Share objects, check if user created the share
        if isinstance(obj, Share):
            return obj.shared_by == user
        
        # For content objects, check ownership
        if hasattr(obj, 'owner') and obj.owner == user:
            return True
        if hasattr(obj, 'created_by') and obj.created_by == user:
            return True
        
        # Check if user has editor role via share
        content_type = ContentType.objects.get_for_model(obj)
        
        editor_share = Share.objects.filter(
            content_type=content_type,
            object_id=str(obj.pk),
            shared_with_user=user,
            role='editor',
            is_active=True
        ).first()
        
        if editor_share and not editor_share.is_expired():
            return True
        
        # Check team editor share - Team.members expects UserProfile, not User
        try:
            user_profile = user.profile
            user_teams = Team.objects.filter(members=user_profile)
        except Exception:
            user_teams = Team.objects.none()
            
        team_editor_share = Share.objects.filter(
            content_type=content_type,
            object_id=str(obj.pk),
            shared_with_team__in=user_teams,
            role='editor',
            is_active=True
        ).first()
        
        if team_editor_share and not team_editor_share.is_expired():
            return True
        
        return False


class IsOwnerOrSharedWith(permissions.BasePermission):
    """
    Combined permission: user is owner OR has share access.
    
    Usage in views:
        permission_classes = [IsOwnerOrSharedWith]
        
    This is a convenience permission combining ownership and share checks.
    """
    
    def has_object_permission(self, request, view, obj):
        """Check if user owns content or has share access."""
        user = request.user
        
        # Check ownership
        if hasattr(obj, 'owner') and obj.owner == user:
            return True
        if hasattr(obj, 'created_by') and obj.created_by == user:
            return True
        
        # Check share access
        has_share_perm = HasSharePermission()
        return has_share_perm.has_object_permission(request, view, obj)


class CanAccessByRole(permissions.BasePermission):
    """
    Check if user has specific role access to content.
    
    Usage in views:
        permission_classes = [CanAccessByRole]
        
        # Then in view method:
        if not self.check_role(request, obj, min_role='editor'):
            return Response({'error': 'Editor access required'}, status=403)
    
    Role hierarchy: viewer < commenter < editor
    """
    
    ROLE_HIERARCHY = {
        'viewer': 1,
        'commenter': 2,
        'editor': 3,
    }
    
    def has_object_permission(self, request, view, obj):
        """Basic permission check - user must have some access."""
        has_share_perm = HasSharePermission()
        return has_share_perm.has_object_permission(request, view, obj)
    
    @classmethod
    def check_role(cls, request, obj, min_role='viewer'):
        """
        Check if user has minimum role level for object.
        
        Args:
            request: Django request object
            obj: Content object to check
            min_role: Minimum required role ('viewer', 'commenter', 'editor')
        
        Returns:
            bool: True if user has sufficient role
        """
        user = request.user
        
        # Owner/creator has full access
        if hasattr(obj, 'owner') and obj.owner == user:
            return True
        if hasattr(obj, 'created_by') and obj.created_by == user:
            return True
        
        # Admin/staff has full access
        if user.is_staff or user.is_superuser:
            return True
        
        # Get share from request (set by HasSharePermission)
        share = getattr(request, 'share', None)
        
        if not share:
            # Try to find share - Team.members expects UserProfile, not User
            content_type = ContentType.objects.get_for_model(obj)
            try:
                user_profile = user.profile
                user_teams = Team.objects.filter(members=user_profile)
            except Exception:
                user_teams = Team.objects.none()
            
            share = Share.objects.filter(
                content_type=content_type,
                object_id=str(obj.pk),
                is_active=True
            ).filter(
                models.Q(shared_with_user=user) |
                models.Q(shared_with_team__in=user_teams)
            ).first()
        
        if not share:
            return False
        
        if share.is_expired():
            return False
        
        # Check role hierarchy
        user_role_level = cls.ROLE_HIERARCHY.get(share.role, 0)
        required_role_level = cls.ROLE_HIERARCHY.get(min_role, 0)
        
        return user_role_level >= required_role_level


# Middleware for injecting share-based permissions


class SharePermissionMiddleware:
    """
    Middleware to inject share information into requests.
    
    This middleware checks if the current request has share access
    and attaches the share and role to the request object.
    
    Installation:
        Add to MIDDLEWARE in settings.py:
        'sharing.permissions.SharePermissionMiddleware'
    
    Usage in views:
        if hasattr(request, 'share'):
            role = request.share.role
            # Use role to control access
    """
    
    def __init__(self, get_response):
        self.get_response = get_response
    
    def __call__(self, request):
        # Attach share checker methods to request
        request.has_share_access = lambda obj: self._has_share_access(request, obj)
        request.get_share_role = lambda obj: self._get_share_role(request, obj)
        
        response = self.get_response(request)
        return response
    
    def _has_share_access(self, request, obj):
        """Check if request has share access to object."""
        permission = HasSharePermission()
        return permission.has_object_permission(request, None, obj)
    
    def _get_share_role(self, request, obj):
        """
        Get user's role for object via share.
        
        Returns:
            str: Role ('viewer', 'commenter', 'editor') or None
        """
        user = request.user
        
        if not user.is_authenticated:
            return None
        
        # Owner/creator has implicit 'editor' role
        if hasattr(obj, 'owner') and obj.owner == user:
            return 'editor'
        if hasattr(obj, 'created_by') and obj.created_by == user:
            return 'editor'
        
        # Get share - Team.members expects UserProfile, not User
        content_type = ContentType.objects.get_for_model(obj)
        try:
            user_profile = user.profile
            user_teams = Team.objects.filter(members=user_profile)
        except Exception:
            user_teams = Team.objects.none()
        
        share = Share.objects.filter(
            content_type=content_type,
            object_id=str(obj.pk),
            is_active=True
        ).filter(
            models.Q(shared_with_user=user) |
            models.Q(shared_with_team__in=user_teams)
        ).first()
        
        if share and not share.is_expired():
            return share.role
        
        return None


# Utility functions for permission checking


def can_user_access(user, obj, token=None):
    """
    Check if user can access object (ownership or share).
    
    Args:
        user: Django User instance
        obj: Content object to check
        token: Optional invitation token for external access
    
    Returns:
        bool: True if user can access
    """
    # Owner/creator check
    if hasattr(obj, 'owner') and obj.owner == user:
        return True
    if hasattr(obj, 'created_by') and obj.created_by == user:
        return True
    
    # Share check
    content_type = ContentType.objects.get_for_model(obj)
    
    if user.is_authenticated:
        # Team.members expects UserProfile, not User
        try:
            user_profile = user.profile
            user_teams = Team.objects.filter(members=user_profile)
        except Exception:
            user_teams = Team.objects.none()
        
        share_exists = Share.objects.filter(
            content_type=content_type,
            object_id=str(obj.pk),
            is_active=True
        ).filter(
            models.Q(shared_with_user=user) |
            models.Q(shared_with_team__in=user_teams)
        ).exists()
        
        if share_exists:
            return True
    
    # Token check
    if token:
        token_share = Share.objects.filter(
            content_type=content_type,
            object_id=str(obj.pk),
            invitation_token=token,
            is_active=True
        ).first()
        
        if token_share and not token_share.is_expired():
            return True
    
    return False


def get_user_role(user, obj):
    """
    Get user's role for object.
    
    Args:
        user: Django User instance
        obj: Content object to check
    
    Returns:
        str: Role ('viewer', 'commenter', 'editor') or None
        
    Handles edge cases:
    - Missing user profiles (returns None for teams)
    - Expired shares (filtered out in query)
    - Deleted objects (returns None)
    - Anonymous users (returns None)
    """
    if not obj:
        return None
        
    # Owner/creator has implicit 'editor' role
    if hasattr(obj, 'owner') and obj.owner == user:
        return 'editor'
    if hasattr(obj, 'created_by') and obj.created_by == user:
        return 'editor'
    
    if not user or not user.is_authenticated:
        return None
    
    # Get user's teams (Team.members expects UserProfile, not User)
    try:
        user_profile = user.profile
        user_teams = Team.objects.filter(members=user_profile)
    except Exception:
        # If user has no profile, they can't be in teams
        user_teams = Team.objects.none()
    
    # Get share
    try:
        content_type = ContentType.objects.get_for_model(obj)
    except Exception:
        # If we can't get content type, deny access
        return None
    
    # Filter for active, non-expired shares
    from django.utils import timezone
    share = Share.objects.filter(
        content_type=content_type,
        object_id=str(obj.pk),
        is_active=True
    ).filter(
        models.Q(shared_with_user=user) |
        models.Q(shared_with_team__in=user_teams)
    ).filter(
        models.Q(expires_at__isnull=True) |  # No expiration
        models.Q(expires_at__gt=timezone.now())  # Or not expired yet
    ).first()
    
    if share:
        return share.role
    
    return None


# Import models for Q lookups
from django.db import models
