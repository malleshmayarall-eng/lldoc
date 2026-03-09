from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.db.models import Count, Q
from django.utils import timezone
from datetime import timedelta

from .models import Share, AccessLog
from .serializers import (
    ShareSerializer,
    CreateShareSerializer,
    UpdateShareSerializer,
    AccessLogSerializer,
    AcceptInvitationSerializer,
    UserSearchSerializer,
    ShareAnalyticsSerializer,
    UserBasicSerializer,
    TeamBasicSerializer,
)
from user_management.models import Team, UserProfile


class ShareViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing shares.
    
    Endpoints:
    - GET /shares/ - List all shares (user can access)
    - POST /shares/ - Create new share
    - GET /shares/{id}/ - Get share details
    - PATCH /shares/{id}/ - Update share (role, expiration, etc.)
    - DELETE /shares/{id}/ - Revoke share
    - POST /shares/{id}/resend/ - Resend invitation
    - POST /shares/accept/ - Accept external invitation
    - GET /shares/content/{content_type_id}/{object_id}/ - Get shares for content
    - GET /shares/analytics/ - Get analytics data
    - GET /shares/search_users/ - Search users/teams
    """
    queryset = Share.objects.all()
    permission_classes = [permissions.IsAuthenticated]
    
    def get_permissions(self):
        """Allow unauthenticated access to token validation and invitation acceptance."""
        if self.action in ['validate_token', 'accept_invitation']:
            return [permissions.AllowAny()]
        return super().get_permissions()
    
    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        if self.action == 'create':
            return CreateShareSerializer
        elif self.action in ['update', 'partial_update']:
            return UpdateShareSerializer
        elif self.action == 'accept_invitation':
            return AcceptInvitationSerializer
        elif self.action == 'analytics':
            return ShareAnalyticsSerializer
        elif self.action == 'search_users':
            return UserSearchSerializer
        return ShareSerializer
    
    def get_queryset(self):
        """
        Filter shares based on user permissions.
        Users can see:
        - Shares they created
        - Shares with them directly
        - Shares with their teams
        - Content they own (if implemented)
        """
        user = self.request.user
        
        # Get user's teams (Team.members is ManyToMany to UserProfile)
        try:
            user_profile = user.profile
            user_teams = Team.objects.filter(members=user_profile)
        except Exception:
            # If user has no profile, they can't be in teams
            user_teams = Team.objects.none()
        
        queryset = Share.objects.filter(
            Q(shared_by=user) |  # Shares I created
            Q(shared_with_user=user) |  # Shares with me
            Q(shared_with_team__in=user_teams)  # Shares with my teams
        ).distinct()
        
        # Filter by content type if provided
        content_type_id = self.request.query_params.get('content_type')
        if content_type_id:
            queryset = queryset.filter(content_type_id=content_type_id)

            try:
                content_type = ContentType.objects.get(id=content_type_id)
            except ContentType.DoesNotExist:
                content_type = None

            if content_type and content_type.model in ['drivefile', 'drivefolder']:
                from fileshare.models import DriveFile, DriveFolder

                if content_type.model == 'drivefile':
                    live_ids = DriveFile.objects.filter(is_deleted=False).values_list('id', flat=True)
                else:
                    live_ids = DriveFolder.objects.filter(is_deleted=False).values_list('id', flat=True)

                queryset = queryset.filter(object_id__in=[str(item_id) for item_id in live_ids])
        
        # Filter by object if provided
        object_id = self.request.query_params.get('object_id')
        if object_id:
            queryset = queryset.filter(object_id=object_id)
        
        # Filter by share type
        share_type = self.request.query_params.get('share_type')
        if share_type:
            queryset = queryset.filter(share_type=share_type)
        
        # Filter by active status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')
        
        return queryset.select_related(
            'shared_with_user',
            'shared_with_team',
            'shared_by',
            'content_type'
        )
    
    def perform_create(self, serializer):
        """Create share and send notification."""
        share = serializer.save()
        # TODO: Send notification (email/SMS) - implement in notifications.py
        return share
    
    def perform_destroy(self, instance):
        """Soft delete - mark as inactive instead of deleting."""
        instance.is_active = False
        instance.save()
    
    @action(detail=True, methods=['post'])
    def resend(self, request, pk=None):
        """
        Resend invitation for external shares.
        POST /shares/{id}/resend/
        """
        share = self.get_object()
        
        # Verify share is external and not accepted
        if share.share_type not in ['email', 'phone']:
            return Response(
                {'error': 'Can only resend invitations for external shares'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if share.invitation_accepted:
            return Response(
                {'error': 'Invitation already accepted'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if not share.is_active:
            return Response(
                {'error': 'Share is not active'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if share.is_expired():
            return Response(
                {'error': 'Share has expired'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # TODO: Send notification (implement in notifications.py)
        # from .notifications import send_share_invitation
        # send_share_invitation(share)
        
        return Response({
            'message': 'Invitation resent successfully',
            'share': ShareSerializer(share).data
        })
    
    @action(detail=False, methods=['post'])
    def accept_invitation(self, request):
        """
        Accept external invitation by token.
        POST /shares/accept/
        Body: {"token": "..."}
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        share = serializer.context['share']
        share.invitation_accepted = True
        share.invitation_accepted_at = timezone.now()
        share.save()
        
        # Log access
        AccessLog.objects.create(
            content_object=share.content_object,
            access_token=share.invitation_token,
            access_type='share',
            ip_address=request.META.get('REMOTE_ADDR'),
            user_agent=request.META.get('HTTP_USER_AGENT'),
            share_id=share.id,
            session_id=request.session.session_key,
            metadata={'action': 'invitation_accepted'}
        )
        
        return Response({
            'message': 'Invitation accepted successfully',
            'share': ShareSerializer(share).data
        })
    
    @action(detail=False, methods=['get'])
    def content_shares(self, request):
        """
        Get all shares for specific content.
        GET /shares/content_shares/?content_type_id=X&object_id=Y
        """
        content_type_id = request.query_params.get('content_type_id')
        object_id = request.query_params.get('object_id')
        
        if not content_type_id or not object_id:
            return Response(
                {'error': 'content_type_id and object_id are required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        shares = Share.objects.filter(
            content_type_id=content_type_id,
            object_id=object_id,
            is_active=True
        ).select_related('shared_with_user', 'shared_with_team', 'shared_by')
        
        serializer = ShareSerializer(shares, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'], url_path='content/document/(?P<document_id>[^/.]+)')
    def content_document(self, request, document_id=None):
        """
        Get all shares for a specific document.
        GET /shares/content/document/{document_id}/
        
        Cleaner URL alternative to content_shares endpoint.
        """
        from documents.models import Document
        
        # Get content type for Document
        content_type = ContentType.objects.get_for_model(Document)
        
        # Verify document exists
        if not Document.objects.filter(id=document_id).exists():
            return Response(
                {'error': f'Document with id {document_id} not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get all shares for this document
        shares = Share.objects.filter(
            content_type=content_type,
            object_id=document_id,
            is_active=True
        ).select_related('shared_with_user', 'shared_with_team', 'shared_by')
        
        serializer = ShareSerializer(shares, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='content/file/(?P<file_id>[^/.]+)')
    def content_file(self, request, file_id=None):
        """
        Get all shares for a specific file.
        GET /shares/content/file/{file_id}/
        """
        from fileshare.models import DriveFile

        content_type = ContentType.objects.get_for_model(DriveFile)

        if not DriveFile.objects.filter(id=file_id, is_deleted=False).exists():
            return Response(
                {'error': f'File with id {file_id} not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        shares = Share.objects.filter(
            content_type=content_type,
            object_id=file_id,
            is_active=True
        ).select_related('shared_with_user', 'shared_with_team', 'shared_by')

        serializer = ShareSerializer(shares, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='content/folder/(?P<folder_id>[^/.]+)')
    def content_folder(self, request, folder_id=None):
        """
        Get all shares for a specific folder.
        GET /shares/content/folder/{folder_id}/
        """
        from fileshare.models import DriveFolder

        content_type = ContentType.objects.get_for_model(DriveFolder)

        if not DriveFolder.objects.filter(id=folder_id, is_deleted=False).exists():
            return Response(
                {'error': f'Folder with id {folder_id} not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        shares = Share.objects.filter(
            content_type=content_type,
            object_id=folder_id,
            is_active=True
        ).select_related('shared_with_user', 'shared_with_team', 'shared_by')

        serializer = ShareSerializer(shares, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def analytics(self, request):
        """
        Get sharing analytics.
        GET /shares/analytics/
        """
        user = request.user
        
        # Get user's teams (Team.members is ManyToMany to UserProfile)
        try:
            user_profile = user.profile
            user_teams = Team.objects.filter(members=user_profile)
        except Exception:
            user_teams = Team.objects.none()
        
        # Get shares created by user
        my_shares = Share.objects.filter(shared_by=user)
        
        # Calculate stats
        total_shares = my_shares.count()
        active_shares = my_shares.filter(is_active=True).count()
        
        internal_shares = my_shares.filter(
            share_type__in=['user', 'team']
        ).count()
        
        external_shares = my_shares.filter(
            share_type__in=['email', 'phone']
        ).count()
        
        pending_invitations = my_shares.filter(
            share_type__in=['email', 'phone'],
            invitation_accepted=False,
            is_active=True
        ).count()
        
        # Shares by role
        shares_by_role = dict(
            my_shares.values('role').annotate(count=Count('id')).values_list('role', 'count')
        )
        
        # Shares by content type
        shares_by_content = []
        for ct_data in my_shares.values('content_type__model').annotate(count=Count('id')):
            shares_by_content.append({
                'content_type': ct_data['content_type__model'],
                'count': ct_data['count']
            })
        
        # Most shared content (top 10)
        most_shared = []
        for share_data in my_shares.values(
            'content_type__model', 'object_id'
        ).annotate(
            share_count=Count('id')
        ).order_by('-share_count')[:10]:
            # Try to get content title
            try:
                ct = ContentType.objects.get(model=share_data['content_type__model'])
                obj = ct.get_object_for_this_type(pk=share_data['object_id'])
                title = getattr(obj, 'title', None) or getattr(obj, 'name', None) or str(obj)
            except Exception:
                title = f"{share_data['content_type__model']} #{share_data['object_id']}"
            
            most_shared.append({
                'content_type': share_data['content_type__model'],
                'object_id': share_data['object_id'],
                'title': title,
                'share_count': share_data['share_count']
            })
        
        # Recent activity (last 30 days)
        thirty_days_ago = timezone.now() - timedelta(days=30)
        recent_logs = AccessLog.objects.filter(
            share_id__in=my_shares.values_list('id', flat=True),
            accessed_at__gte=thirty_days_ago
        ).order_by('-accessed_at')[:20]
        
        recent_activity = AccessLogSerializer(recent_logs, many=True).data
        
        data = {
            'total_shares': total_shares,
            'active_shares': active_shares,
            'internal_shares': internal_shares,
            'external_shares': external_shares,
            'pending_invitations': pending_invitations,
            'shares_by_role': shares_by_role,
            'shares_by_content_type': shares_by_content,
            'most_shared_content': most_shared,
            'recent_activity': recent_activity,
        }
        
        return Response(data)
    
    @action(detail=False, methods=['get'])
    def search_users(self, request):
        """
        Search for users and teams to share with.
        GET /shares/search_users/?q=search_term
        
        Note: For fuzzy search, see sharing/search.py
        Basic implementation here uses simple ILIKE search.
        """
        query = request.query_params.get('q', '').strip()
        
        if not query or len(query) < 2:
            return Response(
                {'error': 'Query must be at least 2 characters'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        results = []
        
        # Search users (exclude current user)
        users = User.objects.filter(
            Q(username__icontains=query) |
            Q(email__icontains=query) |
            Q(first_name__icontains=query) |
            Q(last_name__icontains=query)
        ).exclude(id=request.user.id)[:10]
        
        for user in users:
            results.append({
                'id': user.id,
                'type': 'user',
                'name': user.get_full_name() or user.username,
                'email': user.email,
                'username': user.username,
            })
        
        # Search teams (only teams user is member of or public teams)
        teams = Team.objects.filter(
            Q(name__icontains=query) |
            Q(description__icontains=query)
        )[:10]
        
        for team in teams:
            results.append({
                'id': team.id,
                'type': 'team',
                'name': team.name,
                'description': team.description,
                'member_count': team.members.count(),
            })
        
        return Response(results)

    @action(detail=False, methods=['get'])
    def search_teams(self, request):
        """
        Search for teams within the user's organization.
        GET /teams/search/?q=search_term
        """
        query = request.query_params.get('q', '').strip()

        if not query or len(query) < 2:
            return Response(
                {'error': 'Query must be at least 2 characters'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            profile = request.user.profile
        except Exception:
            return Response({'error': 'User profile not found'}, status=status.HTTP_400_BAD_REQUEST)

        teams = Team.objects.filter(
            organization=profile.organization,
        ).filter(
            Q(name__icontains=query) |
            Q(description__icontains=query)
        )[:20]

        results = [
            {
                'id': team.id,
                'type': 'team',
                'name': team.name,
                'description': team.description,
                'member_count': team.members.count(),
            }
            for team in teams
        ]

        return Response(results)

    @action(detail=False, methods=['get'], url_path='organization-users')
    def organization_users(self, request):
        """
        List users in the same organization for dropdowns.
        GET /shares/organization-users/?q=search_term&limit=50
        """
        profile = getattr(request.user, 'profile', None)
        if not profile:
            return Response({'error': 'User profile not found'}, status=status.HTTP_400_BAD_REQUEST)

        query = request.query_params.get('q', '').strip()
        limit = int(request.query_params.get('limit', 50))

        queryset = User.objects.filter(profile__organization=profile.organization, is_active=True)
        queryset = queryset.exclude(id=request.user.id)

        if query:
            queryset = queryset.filter(
                Q(username__icontains=query)
                | Q(email__icontains=query)
                | Q(first_name__icontains=query)
                | Q(last_name__icontains=query)
            )

        users = queryset.order_by('first_name', 'last_name', 'username')[: max(limit, 1)]
        return Response(UserBasicSerializer(users, many=True).data)
    
    @action(detail=False, methods=['get'], url_path='check-access/document/(?P<document_id>[^/.]+)')
    def check_access(self, request, document_id=None):
        """
        Check if user has access to a document.
        GET /shares/check-access/document/<document_id>/
        
        Returns:
            {
                "has_access": true,
                "role": "editor",
                "access_type": "shared",  # "owner", "shared", or "none"
                "can_edit": true,
                "can_comment": true,
                "can_view": true
            }
        """
        from django.contrib.contenttypes.models import ContentType
        from documents.models import Document
        from user_management.models import Team
        from .permissions import get_user_role
        
        user = request.user
        
        if not user.is_authenticated:
            return Response({
                'has_access': False,
                'role': None,
                'access_type': 'none',
                'can_edit': False,
                'can_comment': False,
                'can_view': False,
            })
        
        try:
            document = Document.objects.get(id=document_id)
        except Document.DoesNotExist:
            return Response(
                {'error': 'Document not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Check if owner
        if document.created_by == user:
            return Response({
                'has_access': True,
                'role': 'owner',
                'access_type': 'owner',
                'can_edit': True,
                'can_comment': True,
                'can_view': True,
            })
        
        # Check if shared
        role = get_user_role(user, document)
        
        if role:
            return Response({
                'has_access': True,
                'role': role,
                'access_type': 'shared',
                'can_edit': role == 'editor',
                'can_comment': role in ['editor', 'commenter'],
                'can_view': True,
            })
        
        # No access
        return Response({
            'has_access': False,
            'role': None,
            'access_type': 'none',
            'can_edit': False,
            'can_comment': False,
            'can_view': False,
        })
    
    @action(detail=False, methods=['get'], url_path='validate-token/(?P<token>[^/.]+)')
    def validate_token(self, request, token=None):
        """
        Validate a share token without accepting the invitation.
        GET /shares/validate-token/<token>/
        
        Works for both authenticated and anonymous users.
        Returns share details if token is valid.
        """
        if not token:
            return Response(
                {'valid': False, 'error': 'Token is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            share = Share.objects.select_related(
                'shared_by', 'content_type'
            ).get(invitation_token=token)
        except Share.DoesNotExist:
            return Response(
                {'valid': False, 'error': 'Invalid or unknown token'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        if not share.is_active:
            return Response(
                {'valid': False, 'error': 'This share has been revoked'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        if share.is_expired():
            return Response(
                {'valid': False, 'error': 'This share link has expired'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # Get content title
        content_title = share.get_content_title()
        
        return Response({
            'valid': True,
            'share_id': str(share.id),
            'content_type': share.content_type.model,
            'object_id': share.object_id,
            'content_title': content_title,
            'role': share.role,
            'shared_by': share.shared_by.get_full_name() if share.shared_by else None,
            'shared_at': share.shared_at,
            'expires_at': share.expires_at,
            'invitation_accepted': share.invitation_accepted,
        })

    @action(detail=False, methods=['get'], url_path='content-types')
    def content_types(self, request):
        """
        Get available content types for sharing.
        GET /shares/content-types/
        
        Returns list of content types with their IDs for use in share creation.
        """
        from documents.models import Document
        from fileshare.models import DriveFile, DriveFolder
        
        content_types = []
        
        # Add Document content type
        document_ct = ContentType.objects.get_for_model(Document)
        content_types.append({
            'id': document_ct.id,
            'app_label': document_ct.app_label,
            'model': document_ct.model,
            'name': 'Document',
            'description': 'Legal documents'
        })

        file_ct = ContentType.objects.get_for_model(DriveFile)
        content_types.append({
            'id': file_ct.id,
            'app_label': file_ct.app_label,
            'model': file_ct.model,
            'name': 'Drive File',
            'description': 'Shared drive file'
        })

        folder_ct = ContentType.objects.get_for_model(DriveFolder)
        content_types.append({
            'id': folder_ct.id,
            'app_label': folder_ct.app_label,
            'model': folder_ct.model,
            'name': 'Drive Folder',
            'description': 'Shared drive folder'
        })
        
        # You can add more content types here as needed
        # Example:
        # from another_app.models import AnotherModel
        # another_ct = ContentType.objects.get_for_model(AnotherModel)
        # content_types.append({...})
        
        return Response(content_types)


class AccessLogViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Read-only ViewSet for access logs.
    
    Endpoints:
    - GET /access-logs/ - List access logs
    - GET /access-logs/{id}/ - Get specific log
    """
    queryset = AccessLog.objects.all()
    serializer_class = AccessLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        """
        Filter logs based on user permissions.
        Users can see logs for:
        - Content they own
        - Content shared with them
        """
        user = self.request.user
        
        # Get user's teams (Team.members is ManyToMany to UserProfile)
        try:
            user_profile = user.profile
            user_teams = Team.objects.filter(members=user_profile)
        except Exception:
            user_teams = Team.objects.none()
        
        # Get shares accessible to user
        accessible_share_ids = Share.objects.filter(
            Q(shared_by=user) |
            Q(shared_with_user=user) |
            Q(shared_with_team__in=user_teams)
        ).values_list('id', flat=True)
        
        queryset = AccessLog.objects.filter(
            Q(user=user) |  # User's own access
            Q(share_id__in=accessible_share_ids)  # Access via shares user manages
        )
        
        # Filter by content type if provided
        content_type_id = self.request.query_params.get('content_type')
        if content_type_id:
            queryset = queryset.filter(content_type_id=content_type_id)
        
        # Filter by object if provided
        object_id = self.request.query_params.get('object_id')
        if object_id:
            queryset = queryset.filter(object_id=object_id)
        
        # Filter by access type
        access_type = self.request.query_params.get('access_type')
        if access_type:
            queryset = queryset.filter(access_type=access_type)
        
        # Filter by date range
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')
        if start_date:
            queryset = queryset.filter(accessed_at__gte=start_date)
        if end_date:
            queryset = queryset.filter(accessed_at__lte=end_date)
        
        return queryset.select_related('user', 'content_type')
