from django.shortcuts import render
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from django.contrib.auth.models import User
from .models import (
    Organization,
    Role,
    UserProfile,
    Team,
    InvitationToken,
    OrganizationDocumentSettings,
    UserDocumentSettings,
)
from .serializers import (
    OrganizationSerializer, OrganizationListSerializer,
    RoleSerializer, RoleListSerializer,
    UserProfileSerializer, UserProfileListSerializer, UserProfileCreateSerializer,
    TeamSerializer, TeamListSerializer,
    InvitationTokenSerializer, InvitationCreateSerializer,
    UserSerializer,
    OrganizationDocumentSettingsSerializer,
    UserDocumentSettingsSerializer,
)


class OrganizationViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Organization CRUD operations.
    """
    queryset = Organization.objects.all()
    
    def get_serializer_class(self):
        if self.action == 'list':
            return OrganizationListSerializer
        return OrganizationSerializer
    
    def get_queryset(self):
        queryset = Organization.objects.all()
        
        # Filter by active status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')
        
        # Filter by subscription plan
        plan = self.request.query_params.get('plan')
        if plan:
            queryset = queryset.filter(subscription_plan=plan)
        
        # Search by name
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(name__icontains=search)
        
        return queryset

    @action(detail=False, methods=['get', 'patch'], url_path='current')
    def current(self, request):
        """Get or update the current user's organization."""
        try:
            organization = request.user.profile.organization
        except Exception:
            return Response({'error': 'Organization not found'}, status=status.HTTP_404_NOT_FOUND)

        if request.method.lower() == 'patch':
            serializer = OrganizationSerializer(organization, data=request.data, partial=True)
            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        serializer = OrganizationSerializer(organization)
        return Response(serializer.data)

    @action(detail=True, methods=['get', 'patch'], url_path='document-settings')
    def document_settings(self, request, pk=None):
        """Get or update organization-level document settings."""
        organization = self.get_object()
        settings_obj, _ = OrganizationDocumentSettings.objects.get_or_create(
            organization=organization
        )
        if request.method.lower() == 'patch':
            serializer = OrganizationDocumentSettingsSerializer(
                settings_obj,
                data=request.data,
                partial=True,
            )
            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer = OrganizationDocumentSettingsSerializer(settings_obj)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def users(self, request, pk=None):
        """Get all users in this organization."""
        organization = self.get_object()
        users = organization.user_profiles.all()
        serializer = UserProfileListSerializer(users, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def stats(self, request, pk=None):
        """Get organization statistics."""
        organization = self.get_object()
        stats = {
            'total_users': organization.user_profiles.count(),
            'active_users': organization.user_profiles.filter(is_active=True).count(),
            'total_teams': organization.teams.count(),
            'subscription_plan': organization.subscription_plan,
            'max_users': organization.max_users,
            'max_documents': organization.max_documents,
        }
        return Response(stats)


class RoleViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Role CRUD operations.
    """
    queryset = Role.objects.all()
    
    def get_serializer_class(self):
        if self.action == 'list':
            return RoleListSerializer
        return RoleSerializer
    
    def get_queryset(self):
        queryset = Role.objects.all()
        
        # Filter by active status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')
        
        # Filter by role type
        role_type = self.request.query_params.get('type')
        if role_type:
            queryset = queryset.filter(role_type=role_type)
        
        return queryset
    
    @action(detail=True, methods=['get'])
    def users(self, request, pk=None):
        """Get all users with this role."""
        role = self.get_object()
        users = role.users.all()
        serializer = UserProfileListSerializer(users, many=True)
        return Response(serializer.data)


class UserProfileViewSet(viewsets.ModelViewSet):
    """
    ViewSet for UserProfile CRUD operations.
    """
    queryset = UserProfile.objects.all()
    
    def get_serializer_class(self):
        if self.action == 'create':
            return UserProfileCreateSerializer
        elif self.action == 'list':
            return UserProfileListSerializer
        return UserProfileSerializer
    
    def get_queryset(self):
        queryset = UserProfile.objects.select_related('user', 'organization', 'role')
        
        # Filter by organization
        org_id = self.request.query_params.get('organization')
        if org_id:
            queryset = queryset.filter(organization_id=org_id)
        
        # Filter by role
        role_id = self.request.query_params.get('role')
        if role_id:
            queryset = queryset.filter(role_id=role_id)
        
        # Filter by active status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')
        
        # Search by name or email
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                user__first_name__icontains=search
            ) | queryset.filter(
                user__last_name__icontains=search
            ) | queryset.filter(
                user__email__icontains=search
            )
        
        return queryset

    @action(detail=False, methods=['get', 'patch'], url_path='me')
    def me(self, request):
        """Get or update the current user's profile."""
        try:
            profile = request.user.profile
        except Exception:
            return Response({'error': 'Profile not found'}, status=status.HTTP_404_NOT_FOUND)

        if request.method.lower() == 'patch':
            user_fields = {'first_name', 'last_name', 'email', 'username'}
            user_data = {key: value for key, value in request.data.items() if key in user_fields}
            profile_data = {key: value for key, value in request.data.items() if key not in user_fields}

            serializer = UserProfileSerializer(profile, data=profile_data, partial=True)
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

            if user_data:
                user_serializer = UserSerializer(profile.user, data=user_data, partial=True)
                if not user_serializer.is_valid():
                    return Response(user_serializer.errors, status=status.HTTP_400_BAD_REQUEST)
                user_serializer.save()

            serializer.save()
            profile.refresh_from_db()
            return Response(UserProfileSerializer(profile).data)

        return Response(UserProfileSerializer(profile).data)

    @action(detail=False, methods=['get', 'patch'], url_path='me/document-settings')
    def my_document_settings(self, request):
        """Get or update current user's document settings."""
        try:
            profile = request.user.profile
        except Exception:
            return Response({'error': 'Profile not found'}, status=status.HTTP_404_NOT_FOUND)

        settings_obj, _ = UserDocumentSettings.objects.get_or_create(profile=profile)
        if request.method.lower() == 'patch':
            serializer = UserDocumentSettingsSerializer(
                settings_obj,
                data=request.data,
                partial=True,
            )
            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        serializer = UserDocumentSettingsSerializer(settings_obj)
        return Response(serializer.data)

    @action(detail=False, methods=['post'], url_path='me/change-password')
    def change_password(self, request):
        """Change the current user's password."""
        old_password = request.data.get('old_password')
        new_password = request.data.get('new_password')

        if not old_password or not new_password:
            return Response(
                {'error': 'Both old_password and new_password are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = request.user
        if not user.check_password(old_password):
            return Response(
                {'error': 'Current password is incorrect.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if len(new_password) < 8:
            return Response(
                {'error': 'New password must be at least 8 characters.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(new_password)
        user.save()

        # Update profile tracking fields
        from django.utils import timezone
        try:
            profile = user.profile
            profile.password_changed_at = timezone.now()
            profile.force_password_change = False
            profile.save(update_fields=['password_changed_at', 'force_password_change'])
        except Exception:
            pass

        return Response({'status': 'Password changed successfully.'})

    @action(detail=True, methods=['get', 'patch'], url_path='document-settings')
    def user_document_settings(self, request, pk=None):
        """Get or update document settings for a specific user profile."""
        profile = self.get_object()
        settings_obj, _ = UserDocumentSettings.objects.get_or_create(profile=profile)
        if request.method.lower() == 'patch':
            serializer = UserDocumentSettingsSerializer(
                settings_obj,
                data=request.data,
                partial=True,
            )
            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer = UserDocumentSettingsSerializer(settings_obj)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def teams(self, request, pk=None):
        """Get all teams this user is a member of."""
        profile = self.get_object()
        teams = profile.teams.all()
        serializer = TeamListSerializer(teams, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        """Deactivate a user profile."""
        from django.utils import timezone
        profile = self.get_object()
        profile.is_active = False
        profile.deactivated_at = timezone.now()
        profile.save()
        return Response({'status': 'user deactivated'})
    
    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        """Activate a user profile."""
        profile = self.get_object()
        profile.is_active = True
        profile.deactivated_at = None
        profile.save()
        return Response({'status': 'user activated'})
    
    @action(detail=True, methods=['post'])
    def reset_password(self, request, pk=None):
        """Send password reset email."""
        profile = self.get_object()
        # TODO: Implement password reset email logic
        return Response({'status': 'password reset email sent'})
    
    @action(detail=False, methods=['get'])
    def search(self, request):
        """
        Search for users by name or email.
        GET /users/search/?q=search_term
        
        Returns list of users matching the search term.
        """
        query = request.query_params.get('q', '').strip()
        
        if not query or len(query) < 2:
            return Response(
                {'error': 'Query must be at least 2 characters'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Search in user fields
        profiles = UserProfile.objects.select_related('user', 'organization', 'role').filter(
            user__first_name__icontains=query
        ) | UserProfile.objects.select_related('user', 'organization', 'role').filter(
            user__last_name__icontains=query
        ) | UserProfile.objects.select_related('user', 'organization', 'role').filter(
            user__email__icontains=query
        ) | UserProfile.objects.select_related('user', 'organization', 'role').filter(
            user__username__icontains=query
        )
        
        # Limit results to prevent performance issues
        profiles = profiles.distinct()[:20]
        
        # Serialize results
        results = []
        for profile in profiles:
            results.append({
                'id': str(profile.id),
                'user_id': profile.user.id,
                'username': profile.user.username,
                'email': profile.user.email,
                'first_name': profile.user.first_name,
                'last_name': profile.user.last_name,
                'full_name': f"{profile.user.first_name} {profile.user.last_name}".strip() or profile.user.username,
                'organization': {
                    'id': str(profile.organization.id),
                    'name': profile.organization.name
                } if profile.organization else None,
                'role': profile.role.name if profile.role else None,
                'avatar': profile.avatar.url if profile.avatar else None,
                'job_title': profile.job_title,
                'is_active': profile.is_active,
            })
        
        return Response(results)


class TeamViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Team CRUD operations.
    """
    queryset = Team.objects.all()
    
    def get_serializer_class(self):
        if self.action == 'list':
            return TeamListSerializer
        return TeamSerializer
    
    def get_queryset(self):
        queryset = Team.objects.select_related('organization', 'team_lead')
        
        # Filter by organization
        org_id = self.request.query_params.get('organization')
        if org_id:
            queryset = queryset.filter(organization_id=org_id)
        
        # Filter by active status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')
        
        # Search by name
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(name__icontains=search)
        
        return queryset
    
    @action(detail=True, methods=['post'])
    def add_member(self, request, pk=None):
        """Add a member to the team."""
        team = self.get_object()
        user_id = request.data.get('user_id')
        
        try:
            user_profile = UserProfile.objects.get(id=user_id)
            team.members.add(user_profile)
            return Response({'status': 'member added'})
        except UserProfile.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
    
    @action(detail=True, methods=['post'])
    def remove_member(self, request, pk=None):
        """Remove a member from the team."""
        team = self.get_object()
        user_id = request.data.get('user_id')
        
        try:
            user_profile = UserProfile.objects.get(id=user_id)
            team.members.remove(user_profile)
            return Response({'status': 'member removed'})
        except UserProfile.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)


class InvitationTokenViewSet(viewsets.ModelViewSet):
    """
    ViewSet for InvitationToken CRUD operations.
    """
    queryset = InvitationToken.objects.all()
    
    def get_serializer_class(self):
        if self.action == 'create':
            return InvitationCreateSerializer
        return InvitationTokenSerializer
    
    def get_queryset(self):
        queryset = InvitationToken.objects.select_related('organization', 'role', 'invited_by')
        
        # Filter by organization
        org_id = self.request.query_params.get('organization')
        if org_id:
            queryset = queryset.filter(organization_id=org_id)
        
        # Filter by used status
        is_used = self.request.query_params.get('is_used')
        if is_used is not None:
            queryset = queryset.filter(is_used=is_used.lower() == 'true')
        
        # Filter by expired status
        is_expired = self.request.query_params.get('is_expired')
        if is_expired is not None:
            queryset = queryset.filter(is_expired=is_expired.lower() == 'true')
        
        return queryset
    
    @action(detail=False, methods=['post'])
    def validate_token(self, request):
        """Validate an invitation token."""
        from django.utils import timezone
        token = request.data.get('token')
        
        try:
            invitation = InvitationToken.objects.get(token=token)
            
            if invitation.is_used:
                return Response({'valid': False, 'error': 'Token already used'}, 
                              status=status.HTTP_400_BAD_REQUEST)
            
            if invitation.expires_at < timezone.now():
                invitation.is_expired = True
                invitation.save()
                return Response({'valid': False, 'error': 'Token expired'}, 
                              status=status.HTTP_400_BAD_REQUEST)
            
            serializer = InvitationTokenSerializer(invitation)
            return Response({'valid': True, 'invitation': serializer.data})
        
        except InvitationToken.DoesNotExist:
            return Response({'valid': False, 'error': 'Invalid token'}, 
                          status=status.HTTP_404_NOT_FOUND)
    
    @action(detail=True, methods=['post'])
    def resend(self, request, pk=None):
        """Resend an invitation email."""
        invitation = self.get_object()
        # TODO: Implement email sending logic
        return Response({'status': 'invitation resent'})

