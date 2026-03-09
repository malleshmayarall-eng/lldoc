from django.contrib.contenttypes.models import ContentType
from django.db.models import Q
from django.http import FileResponse
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError

from sharing.models import AccessLog, Share
from sharing.serializers import UserBasicSerializer as ShareUserBasicSerializer
from sharing.serializers import TeamBasicSerializer as ShareTeamBasicSerializer
from .models import DriveFolder, DriveFile, DriveFavorite
from .serializers import (
    DriveFolderSerializer,
    DriveFolderCreateSerializer,
    DriveFileSerializer,
    DriveFileUploadSerializer,
    DriveFavoriteSerializer,
)
from .permissions import FileShareAccessPermission
from .utils import get_user_profile, get_shared_object_ids, get_effective_share, get_user_teams


class DriveFolderViewSet(viewsets.ModelViewSet):
    queryset = DriveFolder.objects.filter(is_deleted=False)
    permission_classes = [IsAuthenticated, FileShareAccessPermission]

    def _resolve_drive_scope(self, parent, is_root, root_type, team):
        if parent:
            return parent.drive_scope, parent.team
        if is_root:
            return root_type, team
        return 'personal', None

    def _get_or_create_root(self, *, owner, organization, root_type, name, team=None):
        roots = (
            DriveFolder.objects.filter(
                owner=owner,
                organization=organization,
                is_root=True,
                root_type=root_type,
                team=team,
                is_deleted=False,
            )
            .order_by('created_at')
        )
        root = roots.first()
        if root:
            extras = roots.exclude(id=root.id)
            if extras.exists():
                extras.update(is_deleted=True, deleted_at=timezone.now())
            return root

        return DriveFolder.objects.create(
            owner=owner,
            organization=organization,
            is_root=True,
            root_type=root_type,
            drive_scope=root_type,
            team=team,
            name=name,
        )

    def _get_access_list(self, obj):
        content_type = ContentType.objects.get_for_model(obj.__class__)
        shares = Share.objects.filter(
            content_type=content_type,
            object_id=str(obj.id),
            is_active=True,
        ).select_related('shared_with_user', 'shared_with_team', 'shared_by')

        users = [share.shared_with_user for share in shares if share.shared_with_user]
        teams = [share.shared_with_team for share in shares if share.shared_with_team]

        return {
            'owner': ShareUserBasicSerializer(obj.owner).data if hasattr(obj, 'owner') else None,
            'shared_with_users': ShareUserBasicSerializer(users, many=True).data,
            'shared_with_teams': ShareTeamBasicSerializer(teams, many=True).data,
            'shares': [
                {
                    'id': str(share.id),
                    'role': share.role,
                    'share_type': share.share_type,
                    'shared_with_user': share.shared_with_user.pk if share.shared_with_user else None,
                    'shared_with_team': share.shared_with_team.pk if share.shared_with_team else None,
                    'invitation_email': share.invitation_email,
                    'invitation_phone': share.invitation_phone,
                    'is_active': share.is_active,
                    'expires_at': share.expires_at,
                }
                for share in shares
            ],
        }

    def get_serializer_class(self):
        if self.action in ['create', 'update', 'partial_update']:
            return DriveFolderCreateSerializer
        return DriveFolderSerializer

    def get_queryset(self):
        user = self.request.user
        profile = get_user_profile(user)
        if not profile:
            return DriveFolder.objects.none()

        shared_ids = get_shared_object_ids(user, DriveFolder)
        user_teams = get_user_teams(user)
        query_params = getattr(self.request, 'query_params', self.request.GET)
        parent_id = query_params.get('parent')
        shared_only = query_params.get('shared_only', 'false').lower() == 'true'
        include_team_drive = query_params.get('include_team_drive', 'false').lower() == 'true'
        include_org_drive = query_params.get('include_org_drive', 'false').lower() == 'true'

        shared_root = None
        if parent_id:
            shared_root = DriveFolder.objects.filter(
                id=parent_id,
                owner=user,
                organization=profile.organization,
                is_root=True,
                root_type='shared',
                is_deleted=False,
            ).first()

        if shared_only or shared_root:
            shared_folders = DriveFolder.objects.filter(
                id__in=shared_ids,
                is_deleted=False,
                organization=profile.organization,
            ).exclude(owner=user)

            if include_team_drive:
                team_folders = DriveFolder.objects.filter(
                    is_deleted=False,
                    organization=profile.organization,
                    drive_scope='team',
                    team__in=user_teams,
                ).exclude(owner=user)
                shared_folders = shared_folders | team_folders

            if include_org_drive:
                org_folders = DriveFolder.objects.filter(
                    is_deleted=False,
                    organization=profile.organization,
                    drive_scope='organization',
                ).exclude(owner=user)
                shared_folders = shared_folders | org_folders

            if parent_id and not shared_root:
                shared_folders = shared_folders.filter(parent_id=parent_id)

            return shared_folders.distinct()

        queryset = (
            DriveFolder.objects.filter(
                is_deleted=False,
                organization=profile.organization,
            )
            .filter(
                Q(owner=user)
                | Q(id__in=shared_ids)
                | Q(drive_scope='team', team__in=user_teams)
                | Q(drive_scope='organization')
            )
            .distinct()
        )

        if parent_id:
            queryset = queryset.filter(parent_id=parent_id)

        return queryset

    def perform_create(self, serializer):
        profile = get_user_profile(self.request.user)
        if not profile:
            raise ValidationError('User profile required to create folder')

        parent = serializer.validated_data.get('parent')
        root_type = serializer.validated_data.get('root_type', 'personal')
        is_root = serializer.validated_data.get('is_root', False)
        team = serializer.validated_data.get('team')

        if parent and parent.organization_id != profile.organization_id:
            raise ValidationError('Parent folder does not belong to user organization')

        if parent and parent.owner_id != self.request.user.pk:
            if parent.drive_scope == 'team':
                user_teams = get_user_teams(self.request.user)
                if not parent.team or not user_teams.filter(id=parent.team_id).exists():
                    raise ValidationError('You do not have access to this team drive')
            elif parent.drive_scope == 'organization':
                pass
            else:
                share = get_effective_share(self.request.user, parent)
                if not share or share.role != 'editor':
                    raise ValidationError('You do not have permission to create a folder here')

        if is_root and root_type == 'team':
            user_teams = get_user_teams(self.request.user)
            if not team or not user_teams.filter(id=team.id).exists():
                raise ValidationError('You do not have access to this team')

        drive_scope, drive_team = self._resolve_drive_scope(parent, is_root, root_type, team)

        serializer.save(
            owner=self.request.user,
            organization=profile.organization,
            drive_scope=drive_scope,
            team=drive_team,
        )

    def perform_update(self, serializer):
        instance = serializer.instance
        parent = serializer.validated_data.get('parent', instance.parent)
        is_root = serializer.validated_data.get('is_root', instance.is_root)
        root_type = serializer.validated_data.get('root_type', instance.root_type)
        team = serializer.validated_data.get('team', instance.team)

        drive_scope, drive_team = self._resolve_drive_scope(parent, is_root, root_type, team)
        serializer.save(drive_scope=drive_scope, team=drive_team)

    def perform_destroy(self, instance):
        instance.mark_deleted()
        content_type = ContentType.objects.get_for_model(DriveFolder)
        Share.objects.filter(
            content_type=content_type,
            object_id=str(instance.id),
            is_active=True,
        ).update(is_active=False)

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        folder = self.get_object()
        AccessLog.objects.create(
            content_object=folder,
            user=request.user,
            access_type='view',
            ip_address=request.META.get('REMOTE_ADDR'),
            user_agent=request.META.get('HTTP_USER_AGENT', ''),
            session_id=request.session.session_key,
        )
        return response

    @action(detail=False, methods=['get'])
    def my_root(self, request):
        profile = get_user_profile(request.user)
        if not profile:
            return Response({'error': 'User profile not found'}, status=status.HTTP_400_BAD_REQUEST)

        root = self._get_or_create_root(
            owner=request.user,
            organization=profile.organization,
            root_type='personal',
            name='My Drive',
        )
        serializer = DriveFolderSerializer(root, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def roots(self, request):
        profile = get_user_profile(request.user)
        if not profile:
            return Response({'error': 'User profile not found'}, status=status.HTTP_400_BAD_REQUEST)

        personal_root = self._get_or_create_root(
            owner=request.user,
            organization=profile.organization,
            root_type='personal',
            name='My Drive',
        )

        shared_root = self._get_or_create_root(
            owner=request.user,
            organization=profile.organization,
            root_type='shared',
            name='Shared with me',
        )

        organization_root = self._get_or_create_root(
            owner=request.user,
            organization=profile.organization,
            root_type='organization',
            name=f"{profile.organization.name} Drive",
        )

        team_roots = []
        for team in get_user_teams(request.user):
            team_root = self._get_or_create_root(
                owner=request.user,
                organization=profile.organization,
                root_type='team',
                name=f"{team.name} Drive",
                team=team,
            )
            team_roots.append(team_root)

        return Response({
            'personal': DriveFolderSerializer(personal_root, context={'request': request}).data,
            'shared': DriveFolderSerializer(shared_root, context={'request': request}).data,
            'organization': DriveFolderSerializer(organization_root, context={'request': request}).data,
            'teams': DriveFolderSerializer(team_roots, many=True, context={'request': request}).data,
        })

    @action(detail=False, methods=['get'])
    def shared_with_me(self, request):
        user = request.user
        profile = get_user_profile(user)
        if not profile:
            return Response({'error': 'User profile not found'}, status=status.HTTP_400_BAD_REQUEST)

        shared_folder_ids = get_shared_object_ids(user, DriveFolder)
        shared_file_ids = get_shared_object_ids(user, DriveFile)
        include_team_drive = request.query_params.get('include_team_drive', 'false').lower() == 'true'
        include_org_drive = request.query_params.get('include_org_drive', 'false').lower() == 'true'
        user_teams = get_user_teams(user)

        folders = DriveFolder.objects.filter(
            id__in=shared_folder_ids,
            is_deleted=False,
            organization=profile.organization,
        ).exclude(owner=user)

        files = DriveFile.objects.filter(
            id__in=shared_file_ids,
            is_deleted=False,
            organization=profile.organization,
        ).exclude(owner=user)

        if include_team_drive:
            team_folders = DriveFolder.objects.filter(
                is_deleted=False,
                organization=profile.organization,
                drive_scope='team',
                team__in=user_teams,
            ).exclude(owner=user)
            team_files = DriveFile.objects.filter(
                is_deleted=False,
                organization=profile.organization,
                drive_scope='team',
                team__in=user_teams,
            ).exclude(owner=user)
            folders = (folders | team_folders).distinct()
            files = (files | team_files).distinct()

        if include_org_drive:
            org_folders = DriveFolder.objects.filter(
                is_deleted=False,
                organization=profile.organization,
                drive_scope='organization',
            ).exclude(owner=user)
            org_files = DriveFile.objects.filter(
                is_deleted=False,
                organization=profile.organization,
                drive_scope='organization',
            ).exclude(owner=user)
            folders = (folders | org_folders).distinct()
            files = (files | org_files).distinct()

        return Response({
            'folders': DriveFolderSerializer(folders, many=True, context={'request': request}).data,
            'files': DriveFileSerializer(files, many=True, context={'request': request}).data,
        })

    @action(detail=False, methods=['get'])
    def recent(self, request):
        user = request.user
        limit = int(request.query_params.get('limit', 20))

        folder_type = ContentType.objects.get_for_model(DriveFolder)
        file_type = ContentType.objects.get_for_model(DriveFile)

        logs = AccessLog.objects.filter(
            user=user,
            content_type_id__in=[folder_type.id, file_type.id],
        ).order_by('-accessed_at')[:limit]

        folders = []
        files = []
        for log in logs:
            if log.content_type.id == folder_type.id:
                folder = DriveFolder.objects.filter(id=log.object_id, is_deleted=False).first()
                if folder:
                    folders.append({'item': folder, 'accessed_at': log.accessed_at, 'access_type': log.access_type})
            if log.content_type.id == file_type.id:
                drive_file = DriveFile.objects.filter(id=log.object_id, is_deleted=False).first()
                if drive_file:
                    files.append({'item': drive_file, 'accessed_at': log.accessed_at, 'access_type': log.access_type})

        return Response({
            'folders': [
                {
                    **dict(DriveFolderSerializer(entry['item'], context={'request': request}).data),
                    'accessed_at': entry['accessed_at'],
                    'access_type': entry['access_type'],
                }
                for entry in folders
            ],
            'files': [
                {
                    **dict(DriveFileSerializer(entry['item'], context={'request': request}).data),
                    'accessed_at': entry['accessed_at'],
                    'access_type': entry['access_type'],
                }
                for entry in files
            ],
        })

    @action(detail=True, methods=['get'])
    def children(self, request, pk=None):
        folder = self.get_object()
        if folder.is_root:
            if folder.root_type == 'shared':
                return self.shared_with_me(request)

            if folder.root_type in ['team', 'organization', 'personal']:
                folder_filters = {
                    'parent': folder,
                    'is_deleted': False,
                    'organization': folder.organization,
                    'drive_scope': folder.root_type,
                    'team': folder.team,
                }

                file_filters = {
                    'folder': folder,
                    'is_deleted': False,
                    'organization': folder.organization,
                    'drive_scope': folder.root_type,
                    'team': folder.team,
                }

                if folder.root_type == 'personal':
                    folder_filters['owner'] = request.user
                    file_filters['owner'] = request.user

                folders = DriveFolder.objects.filter(
                    **folder_filters,
                )
                files = DriveFile.objects.filter(
                    **file_filters,
                )

                return Response({
                    'folders': DriveFolderSerializer(folders, many=True, context={'request': request}).data,
                    'files': DriveFileSerializer(files, many=True, context={'request': request}).data,
                })

        children = folder.children.filter(is_deleted=False)
        files = folder.files.filter(is_deleted=False)
        if not children.exists() and not files.exists():
            return Response({'folders': [], 'files': []})
        return Response({
            'folders': DriveFolderSerializer(children, many=True, context={'request': request}).data,
            'files': DriveFileSerializer(files, many=True, context={'request': request}).data,
        })

    @action(detail=True, methods=['get'], url_path='access-list')
    def access_list(self, request, pk=None):
        folder = self.get_object()
        return Response(self._get_access_list(folder))

    @action(detail=True, methods=['get'], url_path='shared-with')
    def shared_with(self, request, pk=None):
        folder = self.get_object()
        return Response(self._get_access_list(folder))


class DriveFileViewSet(viewsets.ModelViewSet):
    queryset = DriveFile.objects.filter(is_deleted=False)
    permission_classes = [IsAuthenticated, FileShareAccessPermission]
    parser_classes = [MultiPartParser, FormParser]

    def get_permissions(self):
        if self.action == 'download':
            return [AllowAny()]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action in ['create', 'update', 'partial_update']:
            return DriveFileUploadSerializer
        return DriveFileSerializer

    def get_queryset(self):
        user = self.request.user
        profile = get_user_profile(user)
        if not profile:
            return DriveFile.objects.none()

        shared_file_ids = get_shared_object_ids(user, DriveFile)
        shared_folder_ids = get_shared_object_ids(user, DriveFolder)
        user_teams = get_user_teams(user)
        query_params = getattr(self.request, 'query_params', self.request.GET)
        folder_id = query_params.get('folder')
        shared_only = query_params.get('shared_only', 'false').lower() == 'true'
        include_team_drive = query_params.get('include_team_drive', 'false').lower() == 'true'
        include_org_drive = query_params.get('include_org_drive', 'false').lower() == 'true'

        shared_root = None
        if folder_id:
            shared_root = DriveFolder.objects.filter(
                id=folder_id,
                owner=user,
                organization=profile.organization,
                is_root=True,
                root_type='shared',
                is_deleted=False,
            ).first()

        if shared_only or shared_root:
            shared_files = DriveFile.objects.filter(
                is_deleted=False,
                organization=profile.organization,
            ).filter(
                Q(id__in=shared_file_ids) | Q(folder_id__in=shared_folder_ids)
            ).exclude(owner=user)

            if include_team_drive:
                team_files = DriveFile.objects.filter(
                    is_deleted=False,
                    organization=profile.organization,
                    drive_scope='team',
                    team__in=user_teams,
                ).exclude(owner=user)
                shared_files = shared_files | team_files

            if include_org_drive:
                org_files = DriveFile.objects.filter(
                    is_deleted=False,
                    organization=profile.organization,
                    drive_scope='organization',
                ).exclude(owner=user)
                shared_files = shared_files | org_files

            if folder_id and not shared_root:
                shared_files = shared_files.filter(folder_id=folder_id)

            return shared_files.distinct()

        queryset = (
            DriveFile.objects.filter(
                is_deleted=False,
                organization=profile.organization,
            )
            .filter(
                Q(owner=user)
                | Q(id__in=shared_file_ids)
                | Q(folder_id__in=shared_folder_ids)
                | Q(drive_scope='team', team__in=user_teams)
                | Q(drive_scope='organization')
            )
            .distinct()
        )

        if folder_id:
            queryset = queryset.filter(folder_id=folder_id)

        return queryset

    def perform_create(self, serializer):
        profile = get_user_profile(self.request.user)
        if not profile:
            raise ValidationError('User profile required to create files')

        folder = serializer.validated_data.get('folder')
        if folder and folder.organization_id != profile.organization_id:
            raise ValidationError('Folder does not belong to user organization')

        if folder and folder.owner_id != self.request.user.pk:
            if folder.drive_scope == 'team':
                user_teams = get_user_teams(self.request.user)
                if not folder.team or not user_teams.filter(id=folder.team_id).exists():
                    raise ValidationError('You do not have permission to add files to this team drive')
            elif folder.drive_scope == 'organization':
                pass
            else:
                share = get_effective_share(self.request.user, folder)
                if not share or share.role != 'editor':
                    raise ValidationError('You do not have permission to add files to this folder')

        drive_scope = folder.drive_scope if folder else 'personal'
        team = folder.team if folder else None

        name = serializer.validated_data.get('name')
        if name:
            base_name = name
            counter = 1
            while DriveFile.objects.filter(
                organization=profile.organization,
                folder=folder,
                name=name,
                is_deleted=False,
            ).exists():
                name = f"{base_name} ({counter})"
                counter += 1
            serializer.validated_data['name'] = name

        serializer.save(
            owner=self.request.user,
            organization=profile.organization,
            drive_scope=drive_scope,
            team=team,
        )

    def perform_update(self, serializer):
        instance = serializer.instance
        folder = serializer.validated_data.get('folder', instance.folder)
        drive_scope = folder.drive_scope if folder else 'personal'
        team = folder.team if folder else None
        serializer.save(drive_scope=drive_scope, team=team)

    def perform_destroy(self, instance):
        instance.mark_deleted()
        content_type = ContentType.objects.get_for_model(DriveFile)
        Share.objects.filter(
            content_type=content_type,
            object_id=str(instance.id),
            is_active=True,
        ).update(is_active=False)

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        drive_file = self.get_object()
        AccessLog.objects.create(
            content_object=drive_file,
            user=request.user,
            access_type='view',
            ip_address=request.META.get('REMOTE_ADDR'),
            user_agent=request.META.get('HTTP_USER_AGENT', ''),
            session_id=request.session.session_key,
        )
        return response

    @action(detail=True, methods=['get'], url_path='access-list')
    def access_list(self, request, pk=None):
        drive_file = self.get_object()
        content_type = ContentType.objects.get_for_model(DriveFile)
        shares = Share.objects.filter(
            content_type=content_type,
            object_id=str(drive_file.id),
            is_active=True,
        ).select_related('shared_with_user', 'shared_with_team', 'shared_by')

        users = [share.shared_with_user for share in shares if share.shared_with_user]
        teams = [share.shared_with_team for share in shares if share.shared_with_team]

        return Response({
            'owner': ShareUserBasicSerializer(drive_file.owner).data,
            'shared_with_users': ShareUserBasicSerializer(users, many=True).data,
            'shared_with_teams': ShareTeamBasicSerializer(teams, many=True).data,
            'shares': [
                {
                    'id': str(share.id),
                    'role': share.role,
                    'share_type': share.share_type,
                    'shared_with_user': share.shared_with_user.pk if share.shared_with_user else None,
                    'shared_with_team': share.shared_with_team.pk if share.shared_with_team else None,
                    'invitation_email': share.invitation_email,
                    'invitation_phone': share.invitation_phone,
                    'is_active': share.is_active,
                    'expires_at': share.expires_at,
                }
                for share in shares
            ],
        })

    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        drive_file = self.get_object()
        if not drive_file.file:
            return Response({'error': 'File not available'}, status=status.HTTP_404_NOT_FOUND)

        share = None
        is_authenticated = request.user and request.user.is_authenticated

        if is_authenticated:
            share = get_effective_share(request.user, drive_file)

        token = request.query_params.get('token')
        if token:
            content_type = ContentType.objects.get_for_model(DriveFile)
            token_share = Share.objects.filter(
                content_type=content_type,
                object_id=str(drive_file.id),
                invitation_token=token,
                is_active=True,
            ).first()
            if token_share and not token_share.is_expired():
                share = token_share

        has_team_access = False
        has_org_access = False
        if is_authenticated:
            if drive_file.drive_scope == 'team' and drive_file.team:
                user_teams = get_user_teams(request.user)
                has_team_access = user_teams.filter(id=drive_file.team_id).exists()
            if drive_file.drive_scope == 'organization':
                profile = get_user_profile(request.user)
                has_org_access = profile and drive_file.organization_id == profile.organization_id

        is_owner = is_authenticated and drive_file.owner_id == request.user.pk

        if not (is_owner or has_team_access or has_org_access or share):
            return Response({'error': 'Access denied'}, status=status.HTTP_403_FORBIDDEN)

        if share:
            share.record_access()
            AccessLog.objects.create(
                content_object=drive_file,
                user=request.user if is_authenticated else None,
                access_type='download',
                ip_address=request.META.get('REMOTE_ADDR'),
                user_agent=request.META.get('HTTP_USER_AGENT', ''),
                share_id=share.id,
                session_id=request.session.session_key,
            )

        response = FileResponse(drive_file.file.open('rb'), as_attachment=True, filename=drive_file.name)
        response['Content-Type'] = drive_file.mime_type or 'application/octet-stream'
        return response

    @action(detail=False, methods=['get'])
    def content_types(self, request):
        file_type = ContentType.objects.get_for_model(DriveFile)
        folder_type = ContentType.objects.get_for_model(DriveFolder)
        return Response({
            'drive_file': file_type.id,
            'drive_folder': folder_type.id,
        })


    @action(detail=True, methods=['get'], url_path='shared-with')
    def shared_with(self, request, pk=None):
        drive_file = self.get_object()
        return self.access_list(request, pk=str(drive_file.id))

class DriveFavoriteViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def list(self, request):
        favorites = DriveFavorite.objects.filter(user=request.user).select_related('content_type')
        folder_type = ContentType.objects.get_for_model(DriveFolder)
        file_type = ContentType.objects.get_for_model(DriveFile)

        folder_ids = [fav.object_id for fav in favorites if fav.content_type.id == folder_type.id]
        file_ids = [fav.object_id for fav in favorites if fav.content_type.id == file_type.id]

        folders = DriveFolder.objects.filter(id__in=folder_ids, is_deleted=False)
        files = DriveFile.objects.filter(id__in=file_ids, is_deleted=False)

        return Response({
            'folders': DriveFolderSerializer(folders, many=True, context={'request': request}).data,
            'files': DriveFileSerializer(files, many=True, context={'request': request}).data,
        })

    def create(self, request):
        serializer = DriveFavoriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        validated_data = serializer.validated_data
        content_type = validated_data.get('content_type') if isinstance(validated_data, dict) else None
        object_id = validated_data.get('object_id') if isinstance(validated_data, dict) else None

        if not content_type or not object_id:
            raise ValidationError('content_type and object_id are required')

        favorite, created = DriveFavorite.objects.get_or_create(
            user=request.user,
            content_type=content_type,
            object_id=str(object_id),
        )

        status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return Response({'id': str(favorite.id)}, status=status_code)

    def destroy(self, request, pk=None):
        DriveFavorite.objects.filter(id=pk, user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
