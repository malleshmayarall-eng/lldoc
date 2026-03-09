from rest_framework import permissions
from fileshare.utils import get_effective_share, get_user_profile, get_user_teams


class FileShareAccessPermission(permissions.BasePermission):
    """Permission that allows access if user owns object or has a share."""

    def has_object_permission(self, request, view, obj):
        if not request.user or not request.user.is_authenticated:
            return False

        if hasattr(obj, 'owner') and obj.owner_id == request.user.id:
            return True

        drive_scope = getattr(obj, 'drive_scope', None)
        if drive_scope == 'team':
            teams = get_user_teams(request.user)
            obj_team = getattr(obj, 'team', None)
            if obj_team and teams.filter(id=obj_team.id).exists():
                return True

        if drive_scope == 'organization':
            profile = get_user_profile(request.user)
            if profile and getattr(obj, 'organization_id', None) == profile.organization_id:
                return True

        share = get_effective_share(request.user, obj)
        if not share:
            return False

        if request.method in permissions.SAFE_METHODS:
            return True

        return share.role == 'editor'
