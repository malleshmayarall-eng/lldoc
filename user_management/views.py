from django.shortcuts import render
from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone
from datetime import timedelta
import secrets
import logging
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
    InputNodeCredential,
    DOMAIN_CHOICES,
    ALL_FEATURES,
    get_domain_feature_defaults,
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
    InputNodeCredentialSerializer,
    InputNodeCredentialWriteSerializer,
    DomainChoiceSerializer,
    DomainSettingsSerializer,
    FeatureFlagsSerializer,
)

logger = logging.getLogger(__name__)


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

    # ── Domain & Feature-Flag endpoints ──────────────────────────────

    @action(detail=False, methods=['get'], url_path='domains')
    def list_domains(self, request):
        """
        List all available domain choices with their default feature flags.
        GET /api/organizations/domains/
        """
        DOMAIN_DESCRIPTIONS = {
            'default': 'Full-featured system with all capabilities enabled. No domain-specific restrictions.',
            'procurement': 'Purchase orders, vendor agreements, RFPs, and supply chain workflows.',
            'legal': 'Contracts, NDAs, briefs, and legal review pipelines.',
            'finance': 'Financial reports, compliance documents, and audit workflows.',
            'healthcare': 'Clinical documentation, regulatory compliance, and patient records.',
            'real_estate': 'Leases, purchase agreements, property documents, and closing workflows.',
            'insurance': 'Policies, claims documentation, and underwriting workflows.',
            'technology': 'Technical specs, SOWs, SLAs, and software licensing.',
            'education': 'Curriculum documents, policies, and academic administration.',
            'government': 'Regulatory filings, public records, and inter-agency agreements.',
            'consulting': 'Proposals, engagement letters, and deliverable tracking.',
        }
        data = []
        for value, label in DOMAIN_CHOICES:
            data.append({
                'value': value,
                'label': label,
                'description': DOMAIN_DESCRIPTIONS.get(value, f'{label} document workflows.'),
                'default_features': get_domain_feature_defaults(value),
            })
        serializer = DomainChoiceSerializer(data, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='feature-schema')
    def feature_schema(self, request):
        """
        Return the master feature schema — every category and flag
        that exists in the system, for building settings UIs.
        GET /api/organizations/feature-schema/
        """
        return Response(ALL_FEATURES)

    @action(detail=False, methods=['get', 'patch'], url_path='current/domain-settings')
    def current_domain_settings(self, request):
        """
        GET  → Resolved feature flags for the current user's org.
        PATCH → Update domain and/or feature overrides.

        PATCH body:
            {"domain": "legal"}                          — change domain
            {"feature_overrides": {"apps": {"clm": false}}}  — override a flag
            {"domain": "finance", "feature_overrides": {"editor": {"latex": true}}}
        """
        try:
            organization = request.user.profile.organization
        except Exception:
            return Response({'error': 'Organization not found'},
                            status=status.HTTP_404_NOT_FOUND)

        if request.method.upper() == 'PATCH':
            serializer = DomainSettingsSerializer(data=request.data)
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

            validated = serializer.validated_data
            changed = False

            if 'domain' in validated:
                organization.domain = validated['domain']
                changed = True

            if 'feature_overrides' in validated:
                # Deep-merge new overrides into existing ones.
                current = organization.feature_overrides or {}
                for cat, flags in validated['feature_overrides'].items():
                    current.setdefault(cat, {}).update(flags)
                organization.feature_overrides = current
                changed = True

            if changed:
                organization.save(update_fields=['domain', 'feature_overrides', 'updated_at'])

            # Return the resolved state after save.
            return self._domain_settings_response(organization)

        return self._domain_settings_response(organization)

    @action(detail=False, methods=['post'], url_path='current/reset-feature-overrides')
    def reset_feature_overrides(self, request):
        """
        Reset all feature overrides back to domain defaults.
        POST /api/organizations/current/reset-feature-overrides/
        """
        try:
            organization = request.user.profile.organization
        except Exception:
            return Response({'error': 'Organization not found'},
                            status=status.HTTP_404_NOT_FOUND)

        organization.feature_overrides = {}
        organization.save(update_fields=['feature_overrides', 'updated_at'])
        return self._domain_settings_response(organization)

    @action(detail=False, methods=['get'], url_path='current/feature-flags')
    def current_feature_flags(self, request):
        """
        Lightweight endpoint: returns *only* the resolved boolean flags.
        Designed for the frontend to call on app bootstrap.
        GET /api/organizations/current/feature-flags/
        """
        try:
            organization = request.user.profile.organization
        except Exception:
            return Response({'error': 'Organization not found'},
                            status=status.HTTP_404_NOT_FOUND)

        return Response({
            'domain': organization.domain,
            'flags': organization.get_feature_flags(),
        })

    # ── helpers ──────────────────────────────────────────────────────

    @staticmethod
    def _domain_settings_response(organization):
        """Build the standard domain-settings response payload."""
        domain_label = dict(DOMAIN_CHOICES).get(organization.domain, organization.domain)
        data = {
            'domain': organization.domain,
            'domain_label': domain_label,
            'feature_overrides': organization.feature_overrides,
            'domain_defaults': get_domain_feature_defaults(organization.domain),
            'resolved': organization.get_feature_flags(),
        }
        return Response(FeatureFlagsSerializer(data).data)

    @action(detail=False, methods=['get'], url_path='current/domain-config')
    def current_domain_config(self, request):
        """
        Return domain-specific configuration for the current org.
        Currently only 'procurement' has a rich config; other domains
        return an empty dict.

        GET /api/organizations/current/domain-config/
        """
        try:
            organization = request.user.profile.organization
        except Exception:
            return Response({'error': 'Organization not found'},
                            status=status.HTTP_404_NOT_FOUND)

        if organization.domain == 'procurement':
            from documents.procurement.domain_config import get_procurement_config
            return Response(get_procurement_config())

        return Response({
            'domain': organization.domain,
            'categories': [],
            'quick_actions': [],
            'workflow_presets': [],
            'ui_hints': {},
        })


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

    # ── Input-Node Credentials (saved in profile) ─────────────────────

    @action(detail=False, methods=['get', 'post'], url_path='me/input-credentials')
    def my_input_credentials(self, request):
        """
        GET  → list all saved credentials (secrets redacted).
        POST → create a new credential.
        Optionally filter by ?type=email_inbox|google_drive|…
        """
        try:
            profile = request.user.profile
        except Exception:
            return Response({'error': 'Profile not found'}, status=status.HTTP_404_NOT_FOUND)

        if request.method == 'POST':
            serializer = InputNodeCredentialWriteSerializer(data=request.data)
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
            serializer.save(profile=profile)
            # Return redacted version
            obj = InputNodeCredential.objects.get(pk=serializer.instance.pk)
            return Response(InputNodeCredentialSerializer(obj).data, status=status.HTTP_201_CREATED)

        qs = profile.input_credentials.all()
        cred_type = request.query_params.get('type')
        if cred_type:
            qs = qs.filter(credential_type=cred_type)
        return Response(InputNodeCredentialSerializer(qs, many=True).data)

    @action(detail=False, methods=['get', 'patch', 'delete'],
            url_path=r'me/input-credentials/(?P<cred_id>[0-9a-f-]+)')
    def my_input_credential_detail(self, request, cred_id=None):
        """
        GET    → single credential (redacted).
        PATCH  → update label / credentials.
        DELETE → remove.
        """
        try:
            profile = request.user.profile
        except Exception:
            return Response({'error': 'Profile not found'}, status=status.HTTP_404_NOT_FOUND)

        try:
            obj = profile.input_credentials.get(pk=cred_id)
        except InputNodeCredential.DoesNotExist:
            return Response({'error': 'Credential not found'}, status=status.HTTP_404_NOT_FOUND)

        if request.method == 'DELETE':
            obj.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        if request.method == 'PATCH':
            serializer = InputNodeCredentialWriteSerializer(obj, data=request.data, partial=True)
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
            serializer.save()
            obj.refresh_from_db()
            return Response(InputNodeCredentialSerializer(obj).data)

        return Response(InputNodeCredentialSerializer(obj).data)

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

    def _send_invitation_email(self, invitation):
        if not invitation.email:
            return

        frontend_base = getattr(settings, 'FRONTEND_URL', None) or 'http://localhost:3000'
        invitation_link = f"{frontend_base}/accept-invitation/{invitation.token}"
        subject = f"You are invited to join {invitation.organization.name}"
        message = (
            f"Hello,\n\n"
            f"You have been invited to join {invitation.organization.name} as {invitation.role.display_name or invitation.role.name}.\n"
            f"Please accept the invite by visiting: {invitation_link}\n\n"
            f"Personal message: {invitation.message or 'No message provided.'}\n\n"
            "If you did not request this invitation, please ignore this email.\n"
        )
        html_message = f"""
        <div style='font-family: Arial, sans-serif; max-width: 600px; margin: auto;'>
            <h2>Invitation to join {invitation.organization.name}</h2>
            <p>You were invited as <strong>{invitation.role.display_name or invitation.role.name}</strong>.</p>
            <p>{invitation.message or 'No personal message provided.'}</p>
            <p><a href='{invitation_link}' style='padding: 12px 20px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;'>Accept Invitation</a></p>
            <p style='font-size:12px;color:#666;'>Link expires on {invitation.expires_at.strftime('%Y-%m-%d %H:%M %Z') if invitation.expires_at else 'never'}.</p>
        </div>
        """
        try:
            send_mail(
                subject=subject,
                message=message,
                from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', settings.EMAIL_HOST_USER),
                recipient_list=[invitation.email],
                html_message=html_message,
                fail_silently=False,
            )
            logger.info(f"Invitation email sent to {invitation.email} (token={invitation.token[:12]}...)")
        except Exception as exc:
            logger.error(f"Failed to send invitation email to {invitation.email}: {exc}")

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        expires_at = data.get('expires_at') or (timezone.now() + timedelta(days=7))
        token = secrets.token_urlsafe(32)
        invitation = InvitationToken.objects.create(
            email=data['email'],
            organization=data['organization'],
            role=data['role'],
            message=data.get('message', ''),
            token=token,
            expires_at=expires_at,
            invited_by=getattr(request.user, 'profile', None),
        )

        self._send_invitation_email(invitation)

        return Response(InvitationTokenSerializer(invitation, context={'request': request}).data, status=status.HTTP_201_CREATED)
    
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
        self._send_invitation_email(invitation)
        return Response({'status': 'invitation resent'})

