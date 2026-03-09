"""
Viewer App — Permissions

Custom permission classes for viewer access control.
"""

from rest_framework import permissions


class IsViewerAuthenticated(permissions.BasePermission):
    """
    Allow access if the request is authenticated via viewer token/session.
    Works with both ViewerSessionAuthentication and ViewerTokenAuthentication.
    """
    def has_permission(self, request, view):
        return (
            hasattr(request, 'user')
            and request.user
            and getattr(request.user, 'is_viewer', False)
        )


class ViewerCanPerformAction(permissions.BasePermission):
    """
    Check if the viewer's token allows the requested action.
    
    Set `viewer_action` on the view to specify which action is required:
        class MyView(APIView):
            viewer_action = 'download'
    """
    def has_permission(self, request, view):
        user = request.user
        if not getattr(user, 'is_viewer', False):
            return False

        required_action = getattr(view, 'viewer_action', 'view')
        return required_action in (user.allowed_actions or [])


class IsPublicViewerToken(permissions.BasePermission):
    """
    Allow access for public viewer tokens without any authentication.
    Checks the token from query params and validates it.
    """
    def has_permission(self, request, view):
        from .models import ViewerToken

        token_str = request.query_params.get('token')
        if not token_str:
            return False

        try:
            vt = ViewerToken.objects.select_related('document').get(token=token_str)
        except ViewerToken.DoesNotExist:
            return False

        if not vt.can_access() or vt.access_mode != 'public':
            return False

        # Attach to request for downstream use
        request.viewer_token = vt
        return True


class IsOwnerOfViewerToken(permissions.BasePermission):
    """
    Only the creator of a viewer token can manage it.
    Used for token CRUD endpoints.
    """
    def has_object_permission(self, request, view, obj):
        return obj.created_by == request.user
