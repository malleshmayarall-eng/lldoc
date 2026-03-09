from django.contrib.contenttypes.models import ContentType
from django.db.models import Q
from sharing.models import Share
from user_management.models import Team


def get_user_profile(user):
    try:
        return user.profile
    except Exception:
        return None


def get_user_teams(user):
    profile = get_user_profile(user)
    if not profile:
        return Team.objects.none()
    return Team.objects.filter(members=profile)


def get_share_queryset_for_user(user, content_type):
    teams = get_user_teams(user)
    return Share.objects.filter(
        Q(shared_with_user=user) | Q(shared_with_team__in=teams),
        content_type=content_type,
        is_active=True,
    )


def get_shared_object_ids(user, model_class):
    content_type = ContentType.objects.get_for_model(model_class)
    return list(get_share_queryset_for_user(user, content_type).values_list('object_id', flat=True))


def get_effective_share(user, obj):
    from fileshare.models import DriveFile, DriveFolder

    content_type = ContentType.objects.get_for_model(obj.__class__)
    share = get_share_queryset_for_user(user, content_type).filter(object_id=str(obj.id)).first()
    if share:
        return share

    folder = None
    if isinstance(obj, DriveFile):
        folder = getattr(obj, 'folder', None)
    elif isinstance(obj, DriveFolder):
        folder = getattr(obj, 'parent', None)

    while folder:
        folder_content_type = ContentType.objects.get_for_model(DriveFolder)
        folder_share = get_share_queryset_for_user(user, folder_content_type).filter(object_id=str(folder.id)).first()
        if folder_share:
            return folder_share
        folder = folder.parent

    return None
