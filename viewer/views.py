"""
Viewer App — Views

Endpoints for external document viewers (and commentators in future).

ENDPOINT SUMMARY:
─────────────────────────────────────────────────────────────────────────
TOKEN MANAGEMENT (requires Django auth — document owner)
  POST   /api/viewer/tokens/                  Create viewer token
  GET    /api/viewer/tokens/                  List my viewer tokens
  GET    /api/viewer/tokens/<id>/             Get token details
  PATCH  /api/viewer/tokens/<id>/             Update token settings
  DELETE /api/viewer/tokens/<id>/             Revoke/delete token

TOKEN INFO (public)
  GET    /api/viewer/resolve/<token>/         Resolve token → access mode, doc info

PUBLIC ACCESS (no auth)
  GET    /api/viewer/public/pdf/<token>/      Stream PDF for public tokens

OTP FLOW (no auth)
  POST   /api/viewer/otp/send/               Send OTP to email
  POST   /api/viewer/otp/verify/             Verify OTP → get session

PASSWORD FLOW (no auth)
  POST   /api/viewer/password/verify/        Verify password → get session

INVITATION FLOW (no auth)
  POST   /api/viewer/invitation/accept/      Accept invitation → get session

AUTHENTICATED VIEWER (viewer session)
  GET    /api/viewer/document/               Get document info for viewer
  GET    /api/viewer/document/pdf/           Stream PDF for authenticated viewer
  GET    /api/viewer/shared-documents/       List all docs shared with this email

AI CHAT (viewer session or public token)
  POST   /api/viewer/ai-chat/               AI chat scoped to viewer permissions

ANALYTICS (requires Django auth — document owner)
  GET    /api/viewer/tokens/<id>/analytics/  Access analytics for a token
─────────────────────────────────────────────────────────────────────────
"""

import secrets
import random
import logging
from datetime import timedelta

from django.contrib.auth.models import User
from django.contrib.auth.hashers import make_password
from django.core.mail import send_mail
from django.conf import settings
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.http import HttpResponse, HttpResponseForbidden
from django.utils import timezone

from rest_framework import viewsets, status, permissions
from rest_framework.decorators import api_view, permission_classes, action, authentication_classes
from rest_framework.response import Response
from rest_framework.views import APIView

from documents.models import Document
from communications.dispatch import send_alert

from .models import ViewerToken, ViewerOTP, ViewerSession, ViewerAccessLog, ViewerComment, ViewerApproval, ViewerAlert
from .serializers import (
    ViewerTokenSerializer,
    CreateViewerTokenSerializer,
    UpdateViewerTokenSerializer,
    OTPSendSerializer,
    OTPVerifySerializer,
    PasswordVerifySerializer,
    InvitationAcceptSerializer,
    SharedDocumentListSerializer,
    ViewerSessionSerializer,
    ViewerAccessLogSerializer,
    ViewerAIChatSerializer,
)
from .authentication import ViewerSessionAuthentication, ViewerTokenAuthentication
from .permissions import IsViewerAuthenticated, ViewerCanPerformAction

logger = logging.getLogger(__name__)

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# TOKEN MANAGEMENT (document owner — Django session auth)
# ═══════════════════════════════════════════════════════════════════════


class ViewerTokenViewSet(viewsets.ModelViewSet):
    """
    CRUD for viewer tokens. Only the document owner can manage these.
    
    Endpoints:
        GET    /api/viewer/tokens/
        POST   /api/viewer/tokens/
        GET    /api/viewer/tokens/<id>/
        PATCH  /api/viewer/tokens/<id>/
        DELETE /api/viewer/tokens/<id>/
        GET    /api/viewer/tokens/<id>/analytics/
        POST   /api/viewer/tokens/<id>/resend-invitation/
    """
    serializer_class = ViewerTokenSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_field = 'pk'

    def get_queryset(self):
        return ViewerToken.objects.filter(
            created_by=self.request.user
        ).select_related('document', 'created_by', 'share')

    def get_serializer_class(self):
        if self.action == 'create':
            return CreateViewerTokenSerializer
        if self.action in ('update', 'partial_update'):
            return UpdateViewerTokenSerializer
        return ViewerTokenSerializer

    def create(self, request, *args, **kwargs):
        """Create a new viewer token."""
        serializer = CreateViewerTokenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        document = Document.objects.get(id=data['document_id'])

        # Build expiry
        expires_at = None
        if data.get('expires_in_hours'):
            expires_at = timezone.now() + timedelta(hours=data['expires_in_hours'])

        # Create token
        vt = ViewerToken(
            document=document,
            access_mode=data['access_mode'],
            role=data.get('role', 'viewer'),
            recipient_email=data.get('recipient_email'),
            recipient_name=data.get('recipient_name', ''),
            expires_at=expires_at,
            max_access_count=data.get('max_access_count'),
            allowed_actions=data.get('allowed_actions', ['view']),
            settings=data.get('settings', {}),
            created_by=request.user,
        )

        # Password protection
        if data.get('password'):
            vt.set_password(data['password'])

        vt.save()

        # Send invitation email if requested
        if data.get('send_invitation') and vt.recipient_email:
            self._send_invitation_email(vt, request)

        return Response(
            ViewerTokenSerializer(vt, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    def partial_update(self, request, *args, **kwargs):
        """Update viewer token settings."""
        vt = self.get_object()
        serializer = UpdateViewerTokenSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        for field in ('is_active', 'expires_at', 'max_access_count',
                      'allowed_actions', 'settings', 'recipient_name'):
            if field in data:
                setattr(vt, field, data[field])

        if 'password' in data:
            if data['password']:
                vt.set_password(data['password'])
            else:
                vt.password_hash = None

        vt.save()
        return Response(ViewerTokenSerializer(vt, context={'request': request}).data)

    def destroy(self, request, *args, **kwargs):
        """Revoke (soft-delete) a viewer token."""
        vt = self.get_object()
        vt.is_active = False
        vt.save(update_fields=['is_active'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ── Custom actions ───────────────────────────────────────────

    @action(detail=True, methods=['get'], url_path='analytics')
    def analytics(self, request, pk=None):
        """Get access analytics for a viewer token."""
        vt = self.get_object()
        logs = ViewerAccessLog.objects.filter(viewer_token=vt).order_by('-accessed_at')[:100]

        return Response({
            'token_id': str(vt.id),
            'total_accesses': vt.access_count,
            'max_access_count': vt.max_access_count,
            'is_active': vt.is_active,
            'is_expired': vt.is_expired(),
            'created_at': vt.created_at,
            'recent_logs': ViewerAccessLogSerializer(logs, many=True).data,
        })

    @action(detail=True, methods=['post'], url_path='resend-invitation')
    def resend_invitation(self, request, pk=None):
        """Resend invitation email for a viewer token."""
        vt = self.get_object()
        if not vt.recipient_email:
            return Response(
                {'error': 'No recipient email on this token.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        self._send_invitation_email(vt, request)
        return Response({'message': 'Invitation resent successfully.'})

    @action(detail=False, methods=['get'], url_path='by-document/(?P<document_id>[^/.]+)')
    def by_document(self, request, document_id=None):
        """List all viewer tokens for a specific document."""
        tokens = self.get_queryset().filter(document_id=document_id)
        serializer = ViewerTokenSerializer(tokens, many=True, context={'request': request})
        return Response(serializer.data)

    # ── Helpers ──────────────────────────────────────────────────

    def _send_invitation_email(self, vt, request):
        """Send invitation email for a viewer token."""
        try:
            base_url = f"{request.scheme}://{request.get_host()}"
            view_url = f"http://localhost:3000/view/{vt.token}"

            sharer_name = request.user.get_full_name() or request.user.username
            doc_title = vt.document.title or 'Untitled Document'

            subject = f"{sharer_name} shared a document with you"
            message = (
                f"Hi{' ' + vt.recipient_name if vt.recipient_name else ''},\n\n"
                f"{sharer_name} has shared \"{doc_title}\" with you.\n\n"
                f"Click below to view:\n{view_url}\n\n"
            )

            if vt.access_mode == 'email_otp':
                message += "You'll need to verify your email with a one-time code.\n\n"
            elif vt.access_mode == 'invite_only':
                message += "Click the link to accept the invitation.\n\n"

            html_message = f"""
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: #1a1a2e; color: white; padding: 20px; text-align: center;">
                    <h2>Document Shared With You</h2>
                </div>
                <div style="padding: 20px; background: #f8f9fa;">
                    <p>Hi{' ' + vt.recipient_name if vt.recipient_name else ''},</p>
                    <p><strong>{sharer_name}</strong> has shared <strong>"{doc_title}"</strong> with you.</p>
                    <p>Access level: <strong>{vt.get_role_display()}</strong></p>
                    <p style="text-align: center; margin: 24px 0;">
                        <a href="{view_url}"
                           style="background: #4CAF50; color: white; padding: 12px 32px;
                                  text-decoration: none; border-radius: 6px; font-size: 16px;">
                            View Document
                        </a>
                    </p>
                    {'<p><em>You will need to verify your email with a one-time code.</em></p>' if vt.access_mode == 'email_otp' else ''}
                    {'<p><em>Click the link to accept the invitation.</em></p>' if vt.access_mode == 'invite_only' else ''}
                    {f'<p><small>This link expires on {vt.expires_at.strftime("%B %d, %Y")}</small></p>' if vt.expires_at else ''}
                </div>
                <div style="text-align: center; padding: 12px; font-size: 12px; color: #666;">
                    Shared via Drafter
                </div>
            </div>
            """

            send_mail(
                subject=subject,
                message=message,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[vt.recipient_email],
                html_message=html_message,
                fail_silently=False,
            )

            vt.invitation_sent = True
            vt.invitation_sent_at = timezone.now()
            vt.save(update_fields=['invitation_sent', 'invitation_sent_at'])

            # Communications alert for document owner (audit trail)
            if vt.created_by:
                send_alert(
                    category='viewer.invitation_sent',
                    recipient=vt.created_by,
                    title=f'Invitation sent to {vt.recipient_email}',
                    message=f'Viewer invitation for "{doc_title}" sent to {vt.recipient_email}.',
                    target_type='document',
                    target_id=str(vt.document_id),
                    metadata={
                        'recipient_email': vt.recipient_email,
                        'access_mode': vt.access_mode,
                        'role': vt.role,
                    },
                    email=False,  # No need to email the owner about their own action
                )

            logger.info(f"Viewer invitation sent to {vt.recipient_email} for token {vt.token[:12]}")
        except Exception as e:
            logger.error(f"Failed to send viewer invitation: {e}")


# ═══════════════════════════════════════════════════════════════════════
# TOKEN RESOLUTION (public — no auth)
# ═══════════════════════════════════════════════════════════════════════


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def resolve_viewer_token(request, token):
    """
    Resolve a viewer token to determine what auth flow the client should use.
    
    Supports BOTH:
      - New ViewerToken model tokens
      - Legacy Share model invitation_token (fallback)
    
    GET /api/viewer/resolve/<token>/
    
    Returns:
        {
            "valid": true,
            "token_type": "viewer_token" | "legacy_share",
            "access_mode": "public" | "email_otp" | "invite_only",
            "role": "viewer",
            "document_title": "Contract Draft",
            "document_id": "uuid",
            "shared_by": "John Doe",
            "requires_password": false,
            "requires_otp": true,
            "requires_invitation_accept": false,
            "allowed_actions": ["view", "ai_chat"],
            "settings": {},
            "expires_at": "2026-03-01T...",
            "invitation_accepted": false,
        }
    """
    # ── Try new ViewerToken first ──
    try:
        vt = ViewerToken.objects.select_related('document', 'created_by').get(token=token)
    except ViewerToken.DoesNotExist:
        vt = None

    if vt:
        if not vt.is_active:
            return Response(
                {'valid': False, 'error': 'This link has been revoked.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        if vt.is_expired():
            return Response(
                {'valid': False, 'error': 'This link has expired.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        if vt.is_max_access_reached():
            return Response(
                {'valid': False, 'error': 'This link has reached its access limit.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        existing_user = False
        if vt.recipient_email:
            existing_user = User.objects.filter(email__iexact=vt.recipient_email).exists()

        result = {
            'valid': True,
            'token_type': 'viewer_token',
            'access_mode': vt.access_mode,
            'role': vt.role,
            'document_id': str(vt.document.id),
            'document_title': vt.document.title,
            'document_type': vt.document.document_type,
            'shared_by': (
                vt.created_by.get_full_name() or vt.created_by.username
            ) if vt.created_by else None,
            'requires_password': bool(vt.password_hash),
            'requires_otp': vt.access_mode == 'email_otp',
            'requires_invitation_accept': (
                vt.access_mode == 'invite_only' and not vt.invitation_accepted
            ),
            'allowed_actions': vt.allowed_actions,
            'settings': {
                k: v for k, v in (vt.settings or {}).items()
                if k in ('branding_message', 'branding_logo_url', 'theme',
                          'require_nda_acceptance', 'nda_text', 'show_page_numbers')
            },
            'expires_at': vt.expires_at,
            'invitation_accepted': vt.invitation_accepted,
            'existing_user': existing_user,
            'recipient_name': vt.recipient_name,
        }

        return Response(result)

    # ── Fallback: try legacy Share model ──
    try:
        from sharing.models import Share
        share = Share.objects.select_related('shared_by', 'content_type').get(
            invitation_token=token
        )
    except Exception:
        return Response(
            {'valid': False, 'error': 'Invalid or unknown link.'},
            status=status.HTTP_404_NOT_FOUND,
        )

    if not share.is_active:
        return Response(
            {'valid': False, 'error': 'This link has been revoked.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    if share.is_expired():
        return Response(
            {'valid': False, 'error': 'This link has expired.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    # Determine access mode from share_type
    if share.share_type == 'link':
        access_mode = 'public'
    elif share.share_type in ('email', 'phone'):
        access_mode = 'invite_only'
    else:
        access_mode = 'public'

    # Map role — normalise legacy 'commenter' → 'commentator' for frontend consistency
    # Safety net: public links (share_type='link') must never grant editor access
    raw_role = share.role or 'viewer'
    if share.share_type == 'link' and raw_role == 'editor':
        raw_role = 'commenter'
    role = 'commentator' if raw_role == 'commenter' else raw_role
    allowed_actions = ['view']
    if raw_role in ('commenter', 'editor'):
        allowed_actions.extend(['ai_chat', 'comment'])
    if raw_role == 'editor':
        allowed_actions.append('edit')

    # Get document info from GenericFK
    content_obj = share.content_object
    doc_title = ''
    doc_id = ''
    doc_type = ''
    if content_obj and hasattr(content_obj, 'title'):
        doc_title = content_obj.title or ''
    if content_obj and hasattr(content_obj, 'id'):
        doc_id = str(content_obj.id)
    if content_obj and hasattr(content_obj, 'document_type'):
        doc_type = content_obj.document_type or ''

    result = {
        'valid': True,
        'token_type': 'legacy_share',
        'access_mode': access_mode,
        'role': role,
        'document_id': doc_id,
        'document_title': doc_title,
        'document_type': doc_type,
        'shared_by': (
            share.shared_by.get_full_name() or share.shared_by.username
        ) if share.shared_by else None,
        'requires_password': False,
        'requires_otp': False,
        'requires_invitation_accept': (
            share.share_type in ('email', 'phone') and not share.invitation_accepted
        ),
        'allowed_actions': allowed_actions,
        'settings': {},
        'expires_at': share.expires_at,
        'invitation_accepted': share.invitation_accepted,
        'existing_user': False,
        'share_id': str(share.id),
    }

    return Response(result)


# ═══════════════════════════════════════════════════════════════════════
# PUBLIC PDF ACCESS (no auth — public tokens only)
# ═══════════════════════════════════════════════════════════════════════


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def public_pdf_view(request, token):
    """
    Stream the PDF for a public viewer token.
    
    GET /api/viewer/public/pdf/<token>/
    
    Query params:
        ?download=1    Force download instead of inline display
    
    For public tokens: serves immediately.
    For password-protected public tokens: requires prior password verification session.
    """
    try:
        vt = ViewerToken.objects.select_related('document').get(token=token)
    except ViewerToken.DoesNotExist:
        return HttpResponseForbidden('Invalid link.')

    if not vt.can_access():
        return HttpResponseForbidden('This link is expired or inactive.')

    if vt.access_mode != 'public':
        return HttpResponseForbidden('This link requires authentication.')

    # Password check: if token has password, require session
    if vt.password_hash:
        session_token = request.GET.get('session') or _extract_session_from_header(request)
        if not session_token:
            return HttpResponseForbidden('Password verification required.')
        try:
            session = ViewerSession.objects.get(
                session_token=session_token,
                viewer_token=vt,
                is_active=True,
            )
            if session.is_expired():
                return HttpResponseForbidden('Session expired.')
        except ViewerSession.DoesNotExist:
            return HttpResponseForbidden('Invalid session.')

    # Generate PDF
    document = vt.document
    pdf_bytes = _generate_pdf(document, request, vt)

    if not pdf_bytes:
        return HttpResponse('PDF generation failed.', status=500)

    # Record access
    vt.record_access(
        ip_address=request.META.get('REMOTE_ADDR'),
        user_agent=request.META.get('HTTP_USER_AGENT', ''),
    )

    # Return PDF
    response = HttpResponse(pdf_bytes, content_type='application/pdf')
    filename = f"{document.title or 'document'}.pdf"
    if request.GET.get('download') == '1':
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
    else:
        response['Content-Disposition'] = f'inline; filename="{filename}"'

    return response


# ═══════════════════════════════════════════════════════════════════════
# LEGACY SHARE PDF (no auth — public share links from old Share model)
# ═══════════════════════════════════════════════════════════════════════


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def legacy_share_pdf_view(request, token):
    """
    Stream PDF for a legacy Share model token (share_type='link').
    
    GET /api/viewer/legacy/pdf/<token>/
    
    Query params:
        ?download=1    Force download
    """
    try:
        from sharing.models import Share
        share = Share.objects.select_related('content_type').get(invitation_token=token)
    except Exception:
        return HttpResponseForbidden('Invalid link.')

    if not share.is_active:
        return HttpResponseForbidden('This link has been revoked.')

    if share.is_expired():
        return HttpResponseForbidden('This link has expired.')

    # For link-type shares, serve directly. For others, require login.
    if share.share_type not in ('link',):
        return HttpResponseForbidden('This link requires authentication.')

    # Get the document from GenericFK
    content_obj = share.content_object
    if not content_obj or not isinstance(content_obj, Document):
        return HttpResponse('Shared content is not a document.', status=400)

    document = content_obj
    pdf_bytes = _generate_pdf(document, request)

    if not pdf_bytes:
        return HttpResponse('PDF generation failed.', status=500)

    # Update access count on share
    share.access_count = (share.access_count or 0) + 1
    share.last_accessed_at = timezone.now()
    share.save(update_fields=['access_count', 'last_accessed_at'])

    response = HttpResponse(pdf_bytes, content_type='application/pdf')
    filename = f"{document.title or 'document'}.pdf"
    if request.GET.get('download') == '1':
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
    else:
        response['Content-Disposition'] = f'inline; filename="{filename}"'

    return response


# ═══════════════════════════════════════════════════════════════════════
# OTP FLOW
# ═══════════════════════════════════════════════════════════════════════


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def otp_send(request):
    """
    Send OTP to viewer's email.
    
    POST /api/viewer/otp/send/
    { "viewer_token": "...", "email": "client@law.com" }
    """
    serializer = OTPSendSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    vt = data['viewer_token_obj']
    email = data['email']

    # Rate-limit: max 3 OTPs per token+email in 10 minutes
    recent_count = ViewerOTP.objects.filter(
        viewer_token=vt,
        email__iexact=email,
        created_at__gte=timezone.now() - timedelta(minutes=10),
    ).count()
    if recent_count >= 3:
        return Response(
            {'error': 'Too many OTP requests. Please wait a few minutes.'},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    # Generate 6-digit OTP
    otp_code = f"{random.randint(0, 999999):06d}"
    otp_hash = make_password(otp_code)

    ViewerOTP.objects.create(
        viewer_token=vt,
        email=email,
        otp_hash=otp_hash,
        expires_at=timezone.now() + timedelta(minutes=10),
    )

    # Send OTP email
    try:
        doc_title = vt.document.title or 'a document'
        send_mail(
            subject=f"Your verification code: {otp_code}",
            message=(
                f"Your one-time verification code is: {otp_code}\n\n"
                f"Use this code to access \"{doc_title}\".\n"
                f"This code expires in 10 minutes.\n\n"
                f"If you didn't request this, please ignore this email."
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[email],
            html_message=f"""
            <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; text-align: center;">
                <h2 style="color: #1a1a2e;">Verification Code</h2>
                <p>Your one-time code to access <strong>"{doc_title}"</strong>:</p>
                <div style="background: #f0f0f0; padding: 20px; font-size: 32px;
                            font-weight: bold; letter-spacing: 8px; border-radius: 8px;
                            margin: 20px 0;">
                    {otp_code}
                </div>
                <p style="color: #666; font-size: 14px;">
                    This code expires in 10 minutes.
                </p>
            </div>
            """,
            fail_silently=False,
        )
    except Exception as e:
        logger.error(f"Failed to send OTP email to {email}: {e}")
        return Response(
            {'error': 'Failed to send verification email. Please try again.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    return Response({
        'message': 'Verification code sent to your email.',
        'email': email,
        'expires_in_seconds': 600,
    })


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def otp_verify(request):
    """
    Verify OTP and create a viewer session.
    
    POST /api/viewer/otp/verify/
    { "viewer_token": "...", "email": "...", "otp": "482916" }
    
    Returns a session_token for authenticated viewer access.
    """
    serializer = OTPVerifySerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    vt = data['viewer_token_obj']
    email = data['email']

    # Create viewer session
    session = _create_viewer_session(vt, email, request)

    # Record access
    vt.record_access(
        ip_address=request.META.get('REMOTE_ADDR'),
        user_agent=request.META.get('HTTP_USER_AGENT', ''),
    )

    return Response({
        'message': 'Email verified successfully.',
        'session': ViewerSessionSerializer(session).data,
    })


# ═══════════════════════════════════════════════════════════════════════
# PASSWORD FLOW
# ═══════════════════════════════════════════════════════════════════════


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def password_verify(request):
    """
    Verify password for password-protected tokens.
    
    POST /api/viewer/password/verify/
    { "viewer_token": "...", "password": "secret123" }
    """
    serializer = PasswordVerifySerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    vt = data['viewer_token_obj']
    email = vt.recipient_email or 'anonymous'

    session = _create_viewer_session(vt, email, request)

    return Response({
        'message': 'Password verified.',
        'session': ViewerSessionSerializer(session).data,
    })


# ═══════════════════════════════════════════════════════════════════════
# INVITATION FLOW
# ═══════════════════════════════════════════════════════════════════════


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def invitation_accept(request):
    """
    Accept an invitation for invite_only tokens.
    
    POST /api/viewer/invitation/accept/
    { "viewer_token": "...", "email": "partner@firm.com" }
    
    If the email matches an existing Django user → auto-link.
    Otherwise → creates a viewer session.
    """
    serializer = InvitationAcceptSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    vt = data['viewer_token_obj']
    email = data['email']

    # Mark invitation as accepted
    vt.invitation_accepted = True
    vt.invitation_accepted_at = timezone.now()
    vt.save(update_fields=['invitation_accepted', 'invitation_accepted_at'])

    # Check if user exists
    existing_user = User.objects.filter(email__iexact=email).first()

    # Create session
    session = _create_viewer_session(vt, email, request)

    result = {
        'message': 'Invitation accepted.',
        'session': ViewerSessionSerializer(session).data,
        'existing_user': existing_user is not None,
    }

    if existing_user:
        result['user_name'] = existing_user.get_full_name() or existing_user.username

    return Response(result)


# ═══════════════════════════════════════════════════════════════════════
# AUTHENTICATED VIEWER ENDPOINTS (viewer session auth)
# ═══════════════════════════════════════════════════════════════════════


@api_view(['GET'])
@authentication_classes([ViewerSessionAuthentication, ViewerTokenAuthentication])
@permission_classes([IsViewerAuthenticated])
def viewer_document_info(request):
    """
    Get document info for the current viewer.
    
    GET /api/viewer/document/
    Headers: Authorization: ViewerSession <token>
    or query: ?session=<token>
    """
    vt = request.user.viewer_token
    doc = vt.document

    return Response({
        'document_id': str(doc.id),
        'title': doc.title,
        'document_type': doc.document_type,
        'status': doc.status,
        'version': doc.version,
        'author': doc.author,
        'role': vt.role,
        'allowed_actions': vt.allowed_actions,
        'settings': vt.settings,
        'created_at': doc.created_at,
        'updated_at': doc.updated_at,
    })


@api_view(['GET'])
@authentication_classes([ViewerSessionAuthentication, ViewerTokenAuthentication])
@permission_classes([IsViewerAuthenticated])
def viewer_document_pdf(request):
    """
    Stream PDF for authenticated viewer.
    
    GET /api/viewer/document/pdf/
    Headers: Authorization: ViewerSession <token>
    
    Query params:
        ?download=1    Force download
    """
    vt = request.user.viewer_token

    if 'view' not in (vt.allowed_actions or []):
        return HttpResponseForbidden('PDF viewing not allowed for this link.')

    document = vt.document
    pdf_bytes = _generate_pdf(document, request, vt)

    if not pdf_bytes:
        return HttpResponse('PDF generation failed.', status=500)

    # Record access
    vt.record_access(
        ip_address=request.META.get('REMOTE_ADDR'),
        user_agent=request.META.get('HTTP_USER_AGENT', ''),
    )

    response = HttpResponse(pdf_bytes, content_type='application/pdf')
    filename = f"{document.title or 'document'}.pdf"
    if request.GET.get('download') == '1':
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
    else:
        response['Content-Disposition'] = f'inline; filename="{filename}"'

    return response


@api_view(['GET'])
@authentication_classes([ViewerSessionAuthentication])
@permission_classes([IsViewerAuthenticated])
def shared_documents_list(request):
    """
    List all documents shared with the viewer's email.
    
    GET /api/viewer/shared-documents/
    Headers: Authorization: ViewerSession <token>
    
    Returns all active ViewerTokens where recipient_email matches.
    """
    email = request.user.email

    if not email:
        return Response(
            {'error': 'No email associated with this session.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    tokens = ViewerToken.objects.filter(
        recipient_email__iexact=email,
        is_active=True,
    ).select_related('document', 'created_by').order_by('-created_at')

    # Filter out expired/maxed tokens
    valid_tokens = [t for t in tokens if t.can_access()]

    serializer = SharedDocumentListSerializer(valid_tokens, many=True)
    return Response({
        'count': len(valid_tokens),
        'documents': serializer.data,
    })


# ═══════════════════════════════════════════════════════════════════════
# AI CHAT (viewer-scoped)
# ═══════════════════════════════════════════════════════════════════════


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def viewer_ai_chat(request):
    """
    AI chat for viewers — proxies to the main AI chat with viewer context.
    
    POST /api/viewer/ai-chat/
    {
        "viewer_token": "...",          // for public access
        "session_token": "...",         // for authenticated viewers
        "message": "What does clause 5.2 mean?",
        "scope": "document",
        "scope_id": null,
        "conversation_history": [...]
    }
    """
    serializer = ViewerAIChatSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    # Resolve viewer token
    vt = None
    if data.get('session_token'):
        try:
            session = ViewerSession.objects.select_related(
                'viewer_token', 'viewer_token__document'
            ).get(session_token=data['session_token'])
            if not session.is_valid():
                return Response({'error': 'Session expired.'}, status=status.HTTP_401_UNAUTHORIZED)
            vt = session.viewer_token
        except ViewerSession.DoesNotExist:
            return Response({'error': 'Invalid session.'}, status=status.HTTP_401_UNAUTHORIZED)
    elif data.get('viewer_token'):
        try:
            vt = ViewerToken.objects.select_related('document').get(token=data['viewer_token'])
            if not vt.can_access():
                return Response({'error': 'Token expired.'}, status=status.HTTP_401_UNAUTHORIZED)
            if vt.access_mode != 'public':
                return Response(
                    {'error': 'Authentication required for AI chat.'},
                    status=status.HTTP_401_UNAUTHORIZED,
                )
        except ViewerToken.DoesNotExist:
            return Response({'error': 'Invalid token.'}, status=status.HTTP_401_UNAUTHORIZED)

    if not vt:
        return Response({'error': 'Authentication required.'}, status=status.HTTP_401_UNAUTHORIZED)

    # Check if AI chat is allowed
    if 'ai_chat' not in (vt.allowed_actions or []):
        return Response(
            {'error': 'AI chat is not available for this link.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    # Proxy to AI chat — import and call the internal function
    from aiservices.views import ai_chat as _ai_chat_internal

    # Build a mock-ish request data dict that matches ai_chat expectations
    chat_data = {
        'document_id': str(vt.document.id),
        'scope': data.get('scope', 'document'),
        'scope_id': str(data['scope_id']) if data.get('scope_id') else None,
        'message': data['message'],
        'conversation_history': data.get('conversation_history', []),
    }

    # We need to patch request.data temporarily
    original_data = request.data
    request._full_data = chat_data

    try:
        response = _ai_chat_internal(request)
    finally:
        request._full_data = original_data

    # Log AI chat access
    ViewerAccessLog.objects.create(
        viewer_token=vt,
        document=vt.document,
        email=getattr(request.user, 'email', None) if hasattr(request, 'user') else None,
        ip_address=request.META.get('REMOTE_ADDR'),
        user_agent=request.META.get('HTTP_USER_AGENT', ''),
        action='ai_chat',
        metadata={'message_preview': data['message'][:100]},
    )

    return response


# ═══════════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════


def _create_viewer_session(vt, email, request, duration_hours=24):
    """Create a new ViewerSession for authenticated viewer access."""
    session = ViewerSession(
        viewer_token=vt,
        email=email,
        expires_at=timezone.now() + timedelta(hours=duration_hours),
        ip_address=request.META.get('REMOTE_ADDR'),
        user_agent=request.META.get('HTTP_USER_AGENT', ''),
    )
    session.save()  # .save() auto-generates session_token and auto-links user
    return session


def _generate_pdf(document, request, viewer_token=None):
    """Generate PDF bytes for a document, respecting viewer token settings."""
    try:
        from exporter.pdf_system import render_document_pdf, PDFLayoutOptions
        options = PDFLayoutOptions.from_request(request, document=document)

        # Apply viewer-specific settings
        if viewer_token and viewer_token.settings:
            vs = viewer_token.settings
            if vs.get('watermark_enabled') and vs.get('watermark_text'):
                # Store watermark in options if supported
                if hasattr(options, 'watermark_text'):
                    options.watermark_text = vs['watermark_text']

        return render_document_pdf(document, request, options)
    except Exception as e:
        logger.error(f"PDF generation failed for document {document.id}: {e}")
        return None


def _extract_session_from_header(request):
    """Extract session token from Authorization header."""
    auth_header = request.META.get('HTTP_AUTHORIZATION', '')
    if auth_header.startswith('ViewerSession '):
        return auth_header[len('ViewerSession '):]
    return None


# ═══════════════════════════════════════════════════════════════════════
# DOCUMENT STRUCTURE (read-only for commentators)
# ═══════════════════════════════════════════════════════════════════════


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def viewer_document_structure(request, token):
    """
    Get the document's full hierarchical structure for commentators.
    
    GET /api/viewer/structure/<token>/
    
    Returns sections → paragraphs → tables → images in a nested tree,
    with full content for rendering an editor-like read-only view.
    Includes comment counts per element and approval status.
    
    Query params:
        ?full=true   Return full paragraph/section content (default: true)
                     Set to false to get 200-char previews instead
    """
    from documents.models import Section, Paragraph, Table, ImageComponent, DocumentImage
    from django.contrib.contenttypes.models import ContentType

    # ── Resolve token ──
    vt, document, token_type = _resolve_any_token(token)
    if not document:
        return Response(
            {'error': 'Invalid or expired link.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    # Whether to return full content or just previews
    full_content = request.query_params.get('full', 'true').lower() != 'false'

    # ── Get comment counts per element ──
    comment_cts = {}
    comments = ViewerComment.objects.filter(document=document).values(
        'content_type_id', 'object_id'
    )
    for c in comments:
        key = f"{c['content_type_id']}:{c['object_id']}"
        comment_cts[key] = comment_cts.get(key, 0) + 1

    doc_ct = ContentType.objects.get_for_model(Document)
    section_ct = ContentType.objects.get_for_model(Section)
    paragraph_ct = ContentType.objects.get_for_model(Paragraph)
    table_ct = ContentType.objects.get_for_model(Table)
    image_ct = ContentType.objects.get_for_model(ImageComponent)

    def _comment_count(ct_id, obj_id):
        return comment_cts.get(f"{ct_id}:{obj_id}", 0)

    # ── Build section tree ──
    sections = Section.objects.filter(
        document=document
    ).order_by('order').prefetch_related(
        'paragraphs', 'tables', 'image_components',
        'image_components__image_reference',
    )

    def build_section_data(section):
        paragraphs = []
        for p in section.paragraphs.all().order_by('order'):
            content = p.edited_text or p.content_text or ''
            paragraphs.append({
                'id': str(p.id),
                'type': 'paragraph',
                'content': content if full_content else content[:200],
                'content_preview': content[:200],
                'paragraph_type': p.paragraph_type,
                'topic': p.topic or '',
                'order': p.order,
                'comment_count': _comment_count(paragraph_ct.id, str(p.id)),
            })

        tables = []
        for t in section.tables.all().order_by('order'):
            table_data = {
                'id': str(t.id),
                'type': 'table',
                'title': t.title or 'Untitled Table',
                'description': t.description or '',
                'num_columns': t.num_columns,
                'num_rows': t.num_rows,
                'column_headers': t.column_headers or [],
                'table_data': t.table_data or [],
                'table_type': t.table_type,
                'table_config': t.table_config or {},
                'order': t.order,
                'comment_count': _comment_count(table_ct.id, str(t.id)),
            }
            tables.append(table_data)

        images = []
        for img in section.image_components.all().order_by('order'):
            image_url = ''
            if img.image_reference and img.image_reference.image:
                image_url = img.image_reference.image.url
            images.append({
                'id': str(img.id),
                'type': 'image',
                'caption': img.caption or '',
                'title': img.title or '',
                'alt_text': img.alt_text or '',
                'figure_number': img.figure_number or '',
                'alignment': img.alignment or 'center',
                'size_mode': img.size_mode or 'medium',
                'image_url': image_url,
                'order': img.order,
                'comment_count': _comment_count(image_ct.id, str(img.id)),
            })

        children = []
        for child in section.children.all().order_by('order'):
            children.append(build_section_data(child))

        section_content = section.edited_text or section.content_text or ''
        return {
            'id': str(section.id),
            'type': 'section',
            'title': section.title or 'Untitled Section',
            'section_type': section.section_type,
            'depth_level': getattr(section, 'depth_level', 0),
            'order': section.order,
            'content': section_content if full_content else section_content[:200],
            'content_preview': section_content[:200],
            'comment_count': _comment_count(section_ct.id, str(section.id)),
            'paragraphs': paragraphs,
            'tables': tables,
            'images': images,
            'children': children,
        }

    # Only top-level sections
    top_sections = [s for s in sections if s.parent is None]
    section_tree = [build_section_data(s) for s in top_sections]

    # ── Get approval status ──
    approval_status = None
    try:
        latest_approval = ViewerApproval.objects.filter(
            document=document
        ).order_by('-created_at').first()
        if latest_approval:
            approval_status = {
                'status': latest_approval.status,
                'reviewer_email': latest_approval.reviewer_email,
                'reviewer_name': latest_approval.reviewer_name,
                'comment': latest_approval.comment,
                'created_at': latest_approval.created_at.isoformat(),
            }
    except Exception:
        pass

    result = {
        'document_id': str(document.id),
        'document_title': document.title or 'Untitled Document',
        'document_type': document.document_type or '',
        'document_comment_count': _comment_count(doc_ct.id, str(document.id)),
        'total_comments': ViewerComment.objects.filter(document=document).count(),
        'sections': section_tree,
        'token_type': token_type,
        'role': vt.role if hasattr(vt, 'role') else (vt.role if hasattr(vt, 'role') else 'viewer'),
        'approval_status': approval_status,
    }

    return Response(result)


# ═══════════════════════════════════════════════════════════════════════
# COMMENTS CRUD (requires viewer session — commentators)
# ═══════════════════════════════════════════════════════════════════════


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def viewer_comments_list(request, token):
    """
    List comments for a document, optionally filtered by target.
    
    GET /api/viewer/comments/<token>/
    
    Query params:
        ?target_type=section        Filter by target type
        ?target_id=<uuid>           Filter by specific element
        ?resolved=true|false        Filter by resolution status
        ?sort=oldest|newest         Sort order (default: newest)
        ?page=1&page_size=20        Pagination
    """
    from django.contrib.contenttypes.models import ContentType

    vt, document, token_type = _resolve_any_token(token)
    if not document:
        return Response(
            {'error': 'Invalid or expired link.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    qs = ViewerComment.objects.filter(
        document=document,
        parent__isnull=True,  # Only top-level comments (replies are nested)
    ).select_related('content_type')

    # ── Filters ──
    target_type = request.query_params.get('target_type')
    if target_type:
        qs = qs.filter(target_type=target_type)

    target_id = request.query_params.get('target_id')
    if target_id:
        qs = qs.filter(object_id=target_id)

    resolved = request.query_params.get('resolved')
    if resolved is not None:
        qs = qs.filter(is_resolved=resolved.lower() == 'true')

    # ── Sort ──
    sort = request.query_params.get('sort', 'newest')
    if sort == 'oldest':
        qs = qs.order_by('created_at')
    else:
        qs = qs.order_by('-created_at')

    # ── Pagination ──
    page = int(request.query_params.get('page', 1))
    page_size = min(int(request.query_params.get('page_size', 20)), 100)
    total = qs.count()
    start = (page - 1) * page_size
    end = start + page_size
    comments = qs[start:end]

    from .serializers import ViewerCommentSerializer
    serializer = ViewerCommentSerializer(comments, many=True)

    return Response({
        'count': total,
        'page': page,
        'page_size': page_size,
        'total_pages': (total + page_size - 1) // page_size if page_size > 0 else 0,
        'comments': serializer.data,
    })


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def viewer_comment_create(request):
    """
    Create a comment on a document element.
    
    POST /api/viewer/comments/
    {
        "viewer_token": "abc123...",
        "target_type": "section",
        "target_id": "uuid-of-section",
        "text": "This clause needs rewording.",
        "parent_id": null,
        "metadata": {}
    }
    
    Requires a valid viewer session (Authorization header) OR
    uses the viewer_token + session from body for public commentators.
    """
    from .serializers import CreateViewerCommentSerializer, ViewerCommentSerializer
    from django.contrib.contenttypes.models import ContentType

    serializer = CreateViewerCommentSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    # ── Determine author ──
    # Try session auth first
    session_token = _extract_session_from_header(request)
    author_email = ''
    author_name = ''
    session_obj = None

    if session_token:
        try:
            session_obj = ViewerSession.objects.get(
                session_token=session_token, is_active=True,
            )
            if not session_obj.is_expired():
                author_email = session_obj.email
                author_name = session_obj.user.get_full_name() if session_obj.user else ''
        except ViewerSession.DoesNotExist:
            pass

    # If no session, check request.data for email
    if not author_email:
        author_email = request.data.get('author_email', '')
        author_name = request.data.get('author_name', '')

    if not author_email:
        return Response(
            {'error': 'Authentication required to comment. Please log in.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    # ── Build the comment ──
    document = serializer.context['document']
    target_model = serializer.context['target_model']
    target_object = serializer.context['target_object']
    ct = ContentType.objects.get_for_model(target_model)

    vt_obj = serializer.context.get('viewer_token_obj')

    comment = ViewerComment.objects.create(
        viewer_token=vt_obj if vt_obj else None,
        document=document,
        content_type=ct,
        object_id=str(target_object.id),
        target_type=data['target_type'],
        text=data['text'],
        parent=serializer.context.get('parent_comment'),
        author_email=author_email,
        author_name=author_name,
        session=session_obj,
        metadata=data.get('metadata', {}),
    )

    # ── Create alerts for document owner + other participants ──
    try:
        ViewerAlert.create_comment_alert(
            comment=comment,
            document=document,
            exclude_email=author_email,
        )
    except Exception as e:
        logger.warning(f"Failed to create comment alerts: {e}")

    result_serializer = ViewerCommentSerializer(comment)
    return Response(result_serializer.data, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
@permission_classes([permissions.AllowAny])
def viewer_comment_delete(request, comment_id):
    """
    Delete a comment. Only the original author (by email) can delete.
    
    DELETE /api/viewer/comments/<comment_id>/
    Headers: Authorization: ViewerSession <token>
    """
    try:
        comment = ViewerComment.objects.get(id=comment_id)
    except ViewerComment.DoesNotExist:
        return Response(
            {'error': 'Comment not found.'},
            status=status.HTTP_404_NOT_FOUND,
        )

    # ── Auth check: only the author can delete ──
    session_token = _extract_session_from_header(request)
    if not session_token:
        return Response(
            {'error': 'Authentication required.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    try:
        session = ViewerSession.objects.get(
            session_token=session_token, is_active=True,
        )
        if session.is_expired():
            return Response({'error': 'Session expired.'}, status=status.HTTP_401_UNAUTHORIZED)
    except ViewerSession.DoesNotExist:
        return Response({'error': 'Invalid session.'}, status=status.HTTP_401_UNAUTHORIZED)

    if session.email.lower() != comment.author_email.lower():
        return Response(
            {'error': 'You can only delete your own comments.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    # Delete replies too
    comment.replies.all().delete()
    comment.delete()

    return Response({'message': 'Comment deleted.'}, status=status.HTTP_200_OK)


@api_view(['PATCH'])
@permission_classes([permissions.AllowAny])
def viewer_comment_resolve(request, comment_id):
    """
    Toggle resolved status of a comment.
    
    PATCH /api/viewer/comments/<comment_id>/resolve/
    { "resolved": true }
    Headers: Authorization: ViewerSession <token>
    """
    try:
        comment = ViewerComment.objects.get(id=comment_id)
    except ViewerComment.DoesNotExist:
        return Response({'error': 'Comment not found.'}, status=status.HTTP_404_NOT_FOUND)

    session_token = _extract_session_from_header(request)
    if not session_token:
        return Response({'error': 'Authentication required.'}, status=status.HTTP_401_UNAUTHORIZED)

    try:
        session = ViewerSession.objects.get(session_token=session_token, is_active=True)
        if session.is_expired():
            return Response({'error': 'Session expired.'}, status=status.HTTP_401_UNAUTHORIZED)
    except ViewerSession.DoesNotExist:
        return Response({'error': 'Invalid session.'}, status=status.HTTP_401_UNAUTHORIZED)

    resolved = request.data.get('resolved', True)
    comment.is_resolved = resolved
    if resolved:
        comment.resolved_by = session.email
        comment.resolved_at = timezone.now()
    else:
        comment.resolved_by = ''
        comment.resolved_at = None
    comment.save(update_fields=['is_resolved', 'resolved_by', 'resolved_at', 'updated_at'])

    from .serializers import ViewerCommentSerializer
    return Response(ViewerCommentSerializer(comment).data)


# ═══════════════════════════════════════════════════════════════════════
# DOCUMENT APPROVAL (commentators can approve/reject)
# ═══════════════════════════════════════════════════════════════════════


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def viewer_document_approve(request):
    """
    Submit an approval/rejection decision for a document.
    
    POST /api/viewer/approve/
    {
        "viewer_token": "abc123...",
        "status": "approved" | "rejected" | "changes_requested",
        "comment": "Optional review comment"
    }
    
    Requires ViewerSession authentication.
    """
    token_str = request.data.get('viewer_token', '')
    approval_status = request.data.get('status', '')
    comment = request.data.get('comment', '')

    if not token_str:
        return Response({'error': 'viewer_token is required.'}, status=status.HTTP_400_BAD_REQUEST)

    if approval_status not in ('approved', 'rejected', 'changes_requested'):
        return Response(
            {'error': 'status must be one of: approved, rejected, changes_requested'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    vt, document, token_type = _resolve_any_token(token_str)
    if not document:
        return Response({'error': 'Invalid or expired link.'}, status=status.HTTP_403_FORBIDDEN)

    # ── Auth check ──
    session_token = _extract_session_from_header(request)
    if not session_token:
        return Response({'error': 'Authentication required.'}, status=status.HTTP_401_UNAUTHORIZED)

    try:
        session = ViewerSession.objects.get(session_token=session_token, is_active=True)
        if session.is_expired():
            return Response({'error': 'Session expired.'}, status=status.HTTP_401_UNAUTHORIZED)
    except ViewerSession.DoesNotExist:
        return Response({'error': 'Invalid session.'}, status=status.HTTP_401_UNAUTHORIZED)

    approval = ViewerApproval.objects.create(
        viewer_token=vt if isinstance(vt, ViewerToken) else None,
        document=document,
        reviewer_email=session.email,
        reviewer_name=session.user.get_full_name() if session.user else '',
        session=session,
        status=approval_status,
        comment=comment,
    )

    # ── Create alerts for document owner + other reviewers ──
    try:
        ViewerAlert.create_approval_alert(
            approval=approval,
            document=document,
        )
    except Exception as e:
        logger.warning(f"Failed to create approval alerts: {e}")

    return Response({
        'id': str(approval.id),
        'status': approval.status,
        'comment': approval.comment,
        'reviewer_email': approval.reviewer_email,
        'reviewer_name': approval.reviewer_name,
        'created_at': approval.created_at.isoformat(),
    }, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def viewer_document_approvals(request, token):
    """
    List all approval decisions for a document.
    
    GET /api/viewer/approvals/<token>/
    """
    vt, document, token_type = _resolve_any_token(token)
    if not document:
        return Response({'error': 'Invalid or expired link.'}, status=status.HTTP_403_FORBIDDEN)

    approvals = ViewerApproval.objects.filter(document=document).order_by('-created_at')
    data = [
        {
            'id': str(a.id),
            'status': a.status,
            'comment': a.comment,
            'reviewer_email': a.reviewer_email,
            'reviewer_name': a.reviewer_name,
            'created_at': a.created_at.isoformat(),
        }
        for a in approvals
    ]

    return Response({'approvals': data})


# ═══════════════════════════════════════════════════════════════════════
# TOKEN RESOLUTION HELPER (shared by structure + comments)
# ═══════════════════════════════════════════════════════════════════════


def _resolve_any_token(token):
    """
    Resolve either a ViewerToken or legacy Share token.
    Returns (token_obj, document, token_type) or (None, None, None).
    """
    # Try ViewerToken
    try:
        vt = ViewerToken.objects.select_related('document').get(token=token)
        if vt.is_active and not vt.is_expired():
            return vt, vt.document, 'viewer_token'
    except ViewerToken.DoesNotExist:
        pass

    # Try legacy Share
    try:
        from sharing.models import Share
        share = Share.objects.select_related('content_type').get(invitation_token=token)
        if share.is_active and not share.is_expired():
            document = share.content_object
            if document and isinstance(document, Document):
                return share, document, 'legacy_share'
    except Exception:
        pass

    return None, None, None


# ═══════════════════════════════════════════════════════════════════════
# REVIEW COMMENTS — Document-owner endpoints (Django session auth)
# ═══════════════════════════════════════════════════════════════════════


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def editor_review_comments(request, document_id):
    """
    GET /api/viewer/review-comments/<document_id>/

    List all viewer/commentator comments on a document.
    Requires Django session auth (document owner or editor).
    Groups comments by target element and includes replies.
    """
    try:
        document = Document.objects.get(id=document_id)
    except Document.DoesNotExist:
        return Response({'error': 'Document not found.'}, status=404)

    # Permission check: owner or org member
    if document.created_by != request.user:
        # Allow if user is in the same org
        try:
            if hasattr(request.user, 'profile') and hasattr(document.created_by, 'profile'):
                if request.user.profile.organization != document.created_by.profile.organization:
                    return Response({'error': 'Permission denied.'}, status=403)
            else:
                return Response({'error': 'Permission denied.'}, status=403)
        except Exception:
            return Response({'error': 'Permission denied.'}, status=403)

    from .serializers import ViewerCommentSerializer

    qs = ViewerComment.objects.filter(
        document=document,
        parent__isnull=True,  # Top-level only; replies are nested via serializer
    ).select_related(
        'viewer_token', 'content_type',
    ).order_by('-created_at')

    serializer = ViewerCommentSerializer(qs, many=True)

    # Summary stats
    total = ViewerComment.objects.filter(document=document).count()
    unresolved = ViewerComment.objects.filter(
        document=document, parent__isnull=True, is_resolved=False,
    ).count()
    resolved = ViewerComment.objects.filter(
        document=document, parent__isnull=True, is_resolved=True,
    ).count()

    # Per-element counts (for badge display in editor)
    from django.db.models import Count, Q
    element_counts_qs = (
        ViewerComment.objects
        .filter(document=document, parent__isnull=True)
        .values('object_id', 'target_type')
        .annotate(
            total=Count('id'),
            unresolved=Count('id', filter=Q(is_resolved=False)),
        )
    )
    counts_by_element = {}
    for row in element_counts_qs:
        counts_by_element[row['object_id']] = {
            'total': row['total'],
            'unresolved': row['unresolved'],
            'target_type': row['target_type'],
        }

    return Response({
        'comments': serializer.data,
        'total': total,
        'unresolved': unresolved,
        'resolved': resolved,
        'counts_by_element': counts_by_element,
    })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def editor_reply_comment(request, comment_id):
    """
    POST /api/viewer/review-comments/<comment_id>/reply/

    Reply to a viewer comment from the editor.
    Requires Django session auth.
    Body: { "text": "..." }
    """
    try:
        parent = ViewerComment.objects.select_related('document').get(id=comment_id)
    except ViewerComment.DoesNotExist:
        return Response({'error': 'Comment not found.'}, status=404)

    document = parent.document

    # Permission check
    if document.created_by != request.user:
        try:
            if hasattr(request.user, 'profile') and hasattr(document.created_by, 'profile'):
                if request.user.profile.organization != document.created_by.profile.organization:
                    return Response({'error': 'Permission denied.'}, status=403)
            else:
                return Response({'error': 'Permission denied.'}, status=403)
        except Exception:
            return Response({'error': 'Permission denied.'}, status=403)

    text = request.data.get('text', '').strip()
    if not text:
        return Response({'error': 'Text is required.'}, status=400)

    from django.contrib.contenttypes.models import ContentType

    reply = ViewerComment.objects.create(
        viewer_token=parent.viewer_token,
        document=document,
        content_type=parent.content_type,
        object_id=parent.object_id,
        target_type=parent.target_type,
        text=text,
        parent=parent,
        author_email=request.user.email,
        author_name=request.user.get_full_name() or request.user.username,
        metadata={'source': 'editor'},
    )

    # Alert the original commenter
    try:
        ViewerAlert.create_comment_alert(
            comment=reply,
            document=document,
            exclude_email=request.user.email,
        )
    except Exception as e:
        logger.warning(f"Failed to create reply alert: {e}")

    from .serializers import ViewerCommentReplySerializer
    return Response(ViewerCommentReplySerializer(reply).data, status=201)


@api_view(['PATCH'])
@permission_classes([permissions.IsAuthenticated])
def editor_resolve_comment(request, comment_id):
    """
    PATCH /api/viewer/review-comments/<comment_id>/resolve/

    Toggle resolved status from the editor.
    Requires Django session auth.
    """
    try:
        comment = ViewerComment.objects.select_related('document').get(id=comment_id)
    except ViewerComment.DoesNotExist:
        return Response({'error': 'Comment not found.'}, status=404)

    document = comment.document

    if document.created_by != request.user:
        try:
            if hasattr(request.user, 'profile') and hasattr(document.created_by, 'profile'):
                if request.user.profile.organization != document.created_by.profile.organization:
                    return Response({'error': 'Permission denied.'}, status=403)
            else:
                return Response({'error': 'Permission denied.'}, status=403)
        except Exception:
            return Response({'error': 'Permission denied.'}, status=403)

    # Toggle
    comment.is_resolved = not comment.is_resolved
    if comment.is_resolved:
        comment.resolved_by = request.user.email
        comment.resolved_at = timezone.now()
    else:
        comment.resolved_by = ''
        comment.resolved_at = None
    comment.save(update_fields=['is_resolved', 'resolved_by', 'resolved_at'])

    # Create alert for resolved
    if comment.is_resolved:
        try:
            recipients = set()
            if comment.author_email:
                recipients.add(comment.author_email.lower())
            recipients.discard(request.user.email.lower())

            resolver_name = request.user.get_full_name() or request.user.username
            doc_title = document.title or 'Untitled Document'

            alerts = []
            for email in recipients:
                user_obj = User.objects.filter(email__iexact=email).first()
                alerts.append(ViewerAlert(
                    document=document,
                    alert_type='comment_resolved',
                    message=f'{resolver_name} resolved a comment on "{doc_title}"',
                    recipient_email=email,
                    recipient_user=user_obj,
                    triggered_by_email=request.user.email,
                    triggered_by_name=resolver_name,
                    comment=comment,
                    metadata={'comment_id': str(comment.id)},
                ))
            if alerts:
                ViewerAlert.objects.bulk_create(alerts)
        except Exception as e:
            logger.warning(f"Failed to create resolve alert: {e}")

    from .serializers import ViewerCommentSerializer
    return Response(ViewerCommentSerializer(comment).data)


@api_view(['DELETE'])
@permission_classes([permissions.IsAuthenticated])
def editor_delete_comment(request, comment_id):
    """
    DELETE /api/viewer/review-comments/<comment_id>/

    Delete a viewer comment from the editor.
    Document owner can delete any comment.
    """
    try:
        comment = ViewerComment.objects.select_related('document').get(id=comment_id)
    except ViewerComment.DoesNotExist:
        return Response({'error': 'Comment not found.'}, status=404)

    document = comment.document

    if document.created_by != request.user:
        try:
            if hasattr(request.user, 'profile') and hasattr(document.created_by, 'profile'):
                if request.user.profile.organization != document.created_by.profile.organization:
                    return Response({'error': 'Permission denied.'}, status=403)
            else:
                return Response({'error': 'Permission denied.'}, status=403)
        except Exception:
            return Response({'error': 'Permission denied.'}, status=403)

    comment.replies.all().delete()
    comment.delete()

    return Response({'message': 'Comment deleted.'})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def editor_create_comment(request, document_id):
    """
    POST /api/viewer/review-comments/<document_id>/create/

    Create a new top-level comment from the document editor.
    Requires Django session auth (document owner or org editor).
    Body: { "text": "...", "target_type": "section|paragraph|table|image|document", "object_id": "uuid" }

    For target_type='document', object_id can be omitted (defaults to document_id).
    """
    try:
        document = Document.objects.get(id=document_id)
    except Document.DoesNotExist:
        return Response({'error': 'Document not found.'}, status=404)

    # Permission check: owner or org member
    if document.created_by != request.user:
        try:
            if hasattr(request.user, 'profile') and hasattr(document.created_by, 'profile'):
                if request.user.profile.organization != document.created_by.profile.organization:
                    return Response({'error': 'Permission denied.'}, status=403)
            else:
                return Response({'error': 'Permission denied.'}, status=403)
        except Exception:
            return Response({'error': 'Permission denied.'}, status=403)

    text = request.data.get('text', '').strip()
    if not text:
        return Response({'error': 'Text is required.'}, status=400)

    target_type = request.data.get('target_type', 'document').strip().lower()
    object_id = request.data.get('object_id', '').strip()

    # Map target_type → Django model for ContentType
    from django.contrib.contenttypes.models import ContentType
    from documents.models import Section, Paragraph, Table, ImageComponent

    TARGET_MODEL_MAP = {
        'document': Document,
        'section': Section,
        'paragraph': Paragraph,
        'table': Table,
        'image': ImageComponent,
    }

    model_class = TARGET_MODEL_MAP.get(target_type)
    if not model_class:
        return Response({'error': f'Invalid target_type: {target_type}'}, status=400)

    # Default object_id for document-level comments
    if target_type == 'document':
        object_id = object_id or str(document_id)

    if not object_id:
        return Response({'error': 'object_id is required for non-document targets.'}, status=400)

    content_type = ContentType.objects.get_for_model(model_class)

    comment = ViewerComment.objects.create(
        viewer_token=None,
        document=document,
        content_type=content_type,
        object_id=object_id,
        target_type=target_type,
        text=text,
        parent=None,
        author_email=request.user.email,
        author_name=request.user.get_full_name() or request.user.username,
        metadata={'source': 'editor'},
    )

    # Create alerts for any existing viewer sessions on this document
    try:
        ViewerAlert.create_comment_alert(
            comment=comment,
            document=document,
            exclude_email=request.user.email,
        )
    except Exception as e:
        logger.warning(f"Failed to create comment alert: {e}")

    from .serializers import ViewerCommentSerializer
    return Response(ViewerCommentSerializer(comment).data, status=201)


# ═══════════════════════════════════════════════════════════════════════
# ALERTS
# ═══════════════════════════════════════════════════════════════════════


def _get_session_from_header(request):
    """
    Extract ViewerSession from the Authorization header.
    Returns the ViewerSession instance or None.
    """
    auth_header = request.META.get('HTTP_AUTHORIZATION', '')
    if auth_header.startswith('ViewerSession '):
        session_token = auth_header[len('ViewerSession '):]
        try:
            session = ViewerSession.objects.select_related(
                'viewer_token', 'viewer_token__document'
            ).get(session_token=session_token)
            if session.is_valid():
                return session
        except ViewerSession.DoesNotExist:
            pass
    return None


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def viewer_alerts_list(request, token):
    """
    GET /api/viewer/alerts/<token>/
    
    Returns alerts for the currently-authenticated viewer session email.
    Requires ``Authorization: ViewerSession <token>`` header.
    """
    session = _get_session_from_header(request)
    if not session:
        return Response(
            {'detail': 'Authentication required. Please log in.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    token_obj, document, token_type = _resolve_any_token(token)
    if not document:
        return Response({'detail': 'Invalid or expired token.'}, status=404)

    email = session.email.lower()

    alerts = ViewerAlert.objects.filter(
        document=document,
        recipient_email__iexact=email,
    ).order_by('-created_at')[:100]

    data = []
    for a in alerts:
        data.append({
            'id': str(a.id),
            'alert_type': a.alert_type,
            'message': a.message,
            'triggered_by_email': a.triggered_by_email,
            'triggered_by_name': a.triggered_by_name,
            'is_read': a.is_read,
            'read_at': a.read_at.isoformat() if a.read_at else None,
            'created_at': a.created_at.isoformat(),
            'comment_id': str(a.comment.id) if a.comment else None,
            'approval_id': str(a.approval.id) if a.approval else None,
            'metadata': a.metadata,
        })

    unread_count = ViewerAlert.objects.filter(
        document=document,
        recipient_email__iexact=email,
        is_read=False,
    ).count()

    return Response({
        'alerts': data,
        'unread_count': unread_count,
    })


@api_view(['PATCH'])
@permission_classes([permissions.AllowAny])
def viewer_alert_mark_read(request, alert_id):
    """
    PATCH /api/viewer/alerts/<uuid:alert_id>/read/
    
    Mark a single alert as read. Requires ``ViewerSession`` header.
    """
    session = _get_session_from_header(request)
    if not session:
        return Response(
            {'detail': 'Authentication required.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    try:
        alert = ViewerAlert.objects.get(
            id=alert_id,
            recipient_email__iexact=session.email,
        )
    except ViewerAlert.DoesNotExist:
        return Response({'detail': 'Alert not found.'}, status=404)

    alert.mark_read()
    return Response({'status': 'read', 'id': str(alert.id)})


@api_view(['PATCH'])
@permission_classes([permissions.AllowAny])
def viewer_alerts_mark_all_read(request, token):
    """
    PATCH /api/viewer/alerts/<token>/read-all/
    
    Mark ALL alerts for this document+email as read. Requires ``ViewerSession`` header.
    """
    session = _get_session_from_header(request)
    if not session:
        return Response(
            {'detail': 'Authentication required.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    token_obj, document, token_type = _resolve_any_token(token)
    if not document:
        return Response({'detail': 'Invalid or expired token.'}, status=404)

    updated = ViewerAlert.objects.filter(
        document=document,
        recipient_email__iexact=session.email,
        is_read=False,
    ).update(is_read=True, read_at=timezone.now())

    return Response({
        'status': 'all_read',
        'count': updated,
    })


# ═══════════════════════════════════════════════════════════════════════
# EDITOR ALERTS (document owner — Django session auth)
# ═══════════════════════════════════════════════════════════════════════


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def editor_alerts_list(request):
    """
    GET /api/viewer/editor-alerts/
    
    Return all ViewerAlerts for the logged-in user (matching by email or user FK).
    Supports ?is_read=true/false and ?document_id=<uuid> filters.
    """
    user = request.user
    alerts = ViewerAlert.objects.filter(
        Q(recipient_user=user) | Q(recipient_email__iexact=user.email)
    ).select_related('document', 'comment', 'approval').order_by('-created_at')

    # Optional filters
    is_read_param = request.query_params.get('is_read')
    if is_read_param is not None:
        alerts = alerts.filter(is_read=is_read_param.lower() == 'true')

    document_id = request.query_params.get('document_id')
    if document_id:
        alerts = alerts.filter(document_id=document_id)

    # Pagination
    page = int(request.query_params.get('page', 1))
    page_size = int(request.query_params.get('page_size', 50))
    total = alerts.count()
    unread_count = alerts.filter(is_read=False).count() if is_read_param is None else None

    start = (page - 1) * page_size
    items = alerts[start:start + page_size]

    data = []
    for a in items:
        data.append({
            'id': str(a.id),
            'document_id': str(a.document_id),
            'document_title': a.document.title if a.document else '',
            'alert_type': a.alert_type,
            'message': a.message,
            'triggered_by_email': a.triggered_by_email,
            'triggered_by_name': a.triggered_by_name,
            'is_read': a.is_read,
            'read_at': a.read_at,
            'created_at': a.created_at,
            'comment_id': str(a.comment_id) if a.comment_id else None,
            'approval_id': str(a.approval_id) if a.approval_id else None,
            'metadata': a.metadata,
        })

    resp = {
        'total': total,
        'page': page,
        'page_size': page_size,
        'alerts': data,
    }
    if unread_count is not None:
        resp['unread_count'] = unread_count

    return Response(resp)


@api_view(['PATCH'])
@permission_classes([permissions.IsAuthenticated])
def editor_alert_mark_read(request, alert_id):
    """
    PATCH /api/viewer/editor-alerts/<uuid:alert_id>/read/
    
    Mark a single alert as read for the logged-in user.
    """
    user = request.user
    try:
        alert = ViewerAlert.objects.get(
            id=alert_id,
        )
        # Verify ownership
        if alert.recipient_user_id != user.id and alert.recipient_email.lower() != user.email.lower():
            return Response({'detail': 'Not your alert.'}, status=403)
    except ViewerAlert.DoesNotExist:
        return Response({'detail': 'Alert not found.'}, status=404)

    alert.mark_read()
    return Response({'status': 'read', 'id': str(alert.id)})


@api_view(['PATCH'])
@permission_classes([permissions.IsAuthenticated])
def editor_alerts_mark_all_read(request):
    """
    PATCH /api/viewer/editor-alerts/read-all/
    
    Mark ALL alerts as read for the logged-in user.
    """
    user = request.user
    updated = ViewerAlert.objects.filter(
        Q(recipient_user=user) | Q(recipient_email__iexact=user.email),
        is_read=False,
    ).update(is_read=True, read_at=timezone.now())

    return Response({'status': 'all_read', 'count': updated})


# ═══════════════════════════════════════════════════════════════════════
# ACTIVITY FEED (document owner — Django session auth)
# ═══════════════════════════════════════════════════════════════════════


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def document_activity_feed(request, document_id):
    """
    GET /api/viewer/activity-feed/<document_id>/

    Returns a unified, chronological activity feed for a document,
    merging comments, approvals, alerts, and workflow decision steps.

    Query params:
        page      (int, default 1)
        page_size (int, default 50, max 200)
    """
    from documents.models import DocumentWorkflow, WorkflowDecisionStep

    try:
        document = Document.objects.get(id=document_id)
    except Document.DoesNotExist:
        return Response({'error': 'Document not found.'}, status=status.HTTP_404_NOT_FOUND)

    page = int(request.query_params.get('page', 1))
    page_size = min(int(request.query_params.get('page_size', 50)), 200)

    feed = []

    # ── Comments ─────────────────────────────────────────────────
    comments = ViewerComment.objects.filter(document=document).order_by('-created_at')
    for c in comments:
        feed.append({
            'type': 'comment',
            'id': str(c.id),
            'timestamp': c.created_at.isoformat(),
            'author': c.author_name or c.author_email.split('@')[0],
            'author_email': c.author_email,
            'message': c.text[:200] if c.text else '',
            'target_type': c.target_type or '',
            'is_resolved': c.is_resolved,
            'is_reply': bool(c.parent_id),
        })

    # ── Approvals ────────────────────────────────────────────────
    approvals = ViewerApproval.objects.filter(document=document).order_by('-created_at')
    for a in approvals:
        feed.append({
            'type': 'approval',
            'id': str(a.id),
            'timestamp': a.created_at.isoformat(),
            'author': a.reviewer_name or a.reviewer_email.split('@')[0],
            'author_email': a.reviewer_email,
            'message': f'{a.get_status_display()}: {a.comment[:150]}' if a.comment else a.get_status_display(),
            'status': a.status,
        })

    # ── Alerts (visible to the owner) ────────────────────────────
    alerts = (
        ViewerAlert.objects
        .filter(document=document)
        .filter(Q(recipient_user=request.user) | Q(recipient_email__iexact=request.user.email))
        .order_by('-created_at')
    )
    for al in alerts:
        feed.append({
            'type': 'alert',
            'id': str(al.id),
            'timestamp': al.created_at.isoformat(),
            'author': al.triggered_by_name or al.triggered_by_email.split('@')[0] if al.triggered_by_email else 'System',
            'author_email': al.triggered_by_email,
            'message': al.message,
            'alert_type': al.alert_type,
            'is_read': al.is_read,
        })

    # ── Workflow decision steps ──────────────────────────────────
    decision_steps = (
        WorkflowDecisionStep.objects
        .filter(workflow__document=document)
        .select_related('workflow', 'target_user', 'target_team', 'decided_by_user')
        .order_by('-updated_at')
    )
    for ds in decision_steps:
        target_name = ds.target_email or (
            ds.target_user.get_full_name() if ds.target_user else
            (ds.target_team.name if ds.target_team else '?')
        )
        if ds.decision_status == 'pending':
            msg = f'Waiting for decision from {target_name}'
        else:
            decider = ds.decided_by_email or (
                ds.decided_by_user.get_full_name() if ds.decided_by_user else target_name
            )
            msg = f'{decider} {ds.decision_status} — {ds.title or "Step " + str(ds.order)}'
            if ds.decision_comment:
                msg += f': {ds.decision_comment[:100]}'

        feed.append({
            'type': 'decision',
            'id': str(ds.id),
            'timestamp': (ds.decided_at or ds.updated_at).isoformat(),
            'author': target_name,
            'author_email': ds.target_email or (ds.target_user.email if ds.target_user else ''),
            'message': msg,
            'decision_status': ds.decision_status,
            'step_order': ds.order,
            'step_title': ds.title,
        })

    # ── Sort + paginate ──────────────────────────────────────────
    feed.sort(key=lambda x: x['timestamp'], reverse=True)
    total = len(feed)
    start = (page - 1) * page_size
    end = start + page_size
    page_items = feed[start:end]

    return Response({
        'document_id': str(document_id),
        'total': total,
        'page': page,
        'page_size': page_size,
        'feed': page_items,
    })


# ═══════════════════════════════════════════════════════════════════════
# SHARE FOR APPROVAL (document owner — Django session auth)
# ═══════════════════════════════════════════════════════════════════════


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def share_for_approval(request):
    """
    POST /api/viewer/share-for-approval/
    
    Create a ViewerToken for the given document + email(s) with the
    commentator role (which includes approval capability) and send an
    invitation email. Also creates a 'document_shared' ViewerAlert for
    the document owner.
    
    Body:
        {
            "document_id": "<uuid>",
            "emails": ["reviewer@example.com", ...],
            "role": "viewer" | "commentator",
            "access_mode": "email_otp" | "invite_only",
            "message": "Optional personal message"
        }
    """
    user = request.user
    document_id = request.data.get('document_id')
    emails = request.data.get('emails', [])
    role = request.data.get('role', 'commentator')
    access_mode = request.data.get('access_mode', 'email_otp')
    personal_message = request.data.get('message', '')

    if not document_id:
        return Response({'detail': 'document_id is required.'}, status=400)
    if not emails:
        return Response({'detail': 'At least one email is required.'}, status=400)

    try:
        document = Document.objects.get(id=document_id)
    except Document.DoesNotExist:
        return Response({'detail': 'Document not found.'}, status=404)

    # Verify ownership or admin
    if document.created_by != user:
        return Response({'detail': 'Only the document owner can share.'}, status=403)

    created_tokens = []
    for email in emails:
        email = email.strip().lower()
        if not email:
            continue

        # Check if a token already exists for this email + document
        existing = ViewerToken.objects.filter(
            document=document,
            recipient_email__iexact=email,
            is_active=True,
        ).first()

        if existing:
            # Update role if different
            if existing.role != role:
                existing.role = role
                existing.save(update_fields=['role'])
            vt = existing
        else:
            vt = ViewerToken.objects.create(
                document=document,
                created_by=user,
                access_mode=access_mode,
                role=role,
                recipient_email=email,
                recipient_name=email.split('@')[0],
                allowed_emails=[email],
            )

        # Send invitation email
        try:
            _send_share_for_approval_email(vt, user, personal_message)
        except Exception as e:
            logger.warning(f"Failed to send share email to {email}: {e}")

        # Create alert for document owner as audit trail
        ViewerAlert.objects.create(
            document=document,
            alert_type='document_shared',
            message=f'You shared "{document.title}" with {email} as {role}',
            recipient_email=user.email,
            recipient_user=user,
            triggered_by_email=user.email,
            triggered_by_name=user.get_full_name() or user.username,
            viewer_token=vt,
            metadata={
                'shared_with_email': email,
                'role': role,
                'access_mode': access_mode,
            },
        )
        # Communications alert for the document owner
        send_alert(
            category='viewer.document_shared',
            recipient=user,
            title=f'Document shared with {email}',
            message=f'You shared "{document.title}" with {email} as {role}.',
            target_type='document',
            target_id=str(document.id),
            metadata={
                'shared_with_email': email,
                'role': role,
                'access_mode': access_mode,
            },
            email=False,  # Owner initiated action, no email needed
        )

        created_tokens.append({
            'id': str(vt.id),
            'token': vt.token,
            'email': email,
            'role': vt.role,
            'access_mode': vt.access_mode,
            'is_new': not bool(existing),
        })

    return Response({
        'status': 'shared',
        'count': len(created_tokens),
        'tokens': created_tokens,
    }, status=201)


def _send_share_for_approval_email(vt, sender_user, personal_message=''):
    """Send a share-for-approval invitation email."""
    sharer_name = sender_user.get_full_name() or sender_user.username
    doc_title = vt.document.title or 'Untitled Document'
    role_label = 'review and comment on'

    # Build the view URL based on role
    if vt.role == 'commentator':
        view_url = f"http://localhost:3000/comment/{vt.token}"
    else:
        view_url = f"http://localhost:3000/view/{vt.token}"

    subject = f"{sharer_name} invited you to {role_label} \"{doc_title}\""

    message_lines = [
        f"Hi {vt.recipient_name or ''},",
        '',
        f"{sharer_name} has invited you to {role_label} \"{doc_title}\".",
    ]
    if personal_message:
        message_lines += ['', f'Message from {sharer_name}:', f'"{personal_message}"']
    message_lines += [
        '',
        f"Click below to get started:",
        view_url,
        '',
        "You'll need to verify your email with a one-time code." if vt.access_mode == 'email_otp' else "Click the link to accept the invitation.",
    ]
    message = '\n'.join(message_lines)

    html_message = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #1a1a2e, #16213e); color: white; padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
            <h2 style="margin: 0;">{role_label.title()} Request</h2>
        </div>
        <div style="padding: 24px; background: #f8f9fa; border: 1px solid #e9ecef;">
            <p>Hi {vt.recipient_name or ''},</p>
            <p><strong>{sharer_name}</strong> has invited you to <strong>{role_label}</strong> the document:</p>
            <div style="background: white; border-left: 4px solid #4CAF50; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
                <strong style="font-size: 16px;">{doc_title}</strong>
            </div>
            {'<div style="background: #fff3cd; border: 1px solid #ffc107; padding: 12px; border-radius: 6px; margin: 16px 0;"><p style="margin: 0; font-style: italic;">"' + personal_message + '"</p><p style="margin: 4px 0 0 0; font-size: 12px; color: #666;">— {sharer_name}</p></div>' if personal_message else ''}
            <p style="text-align: center; margin: 24px 0;">
                <a href="{view_url}"
                   style="background: #4CAF50; color: white; padding: 14px 36px;
                          text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold;">
                    {role_label.title()} Document
                </a>
            </p>
            <p style="font-size: 13px; color: #666;">
                {'You will need to verify your email with a one-time code.' if vt.access_mode == 'email_otp' else 'Click the button above to accept the invitation.'}
            </p>
        </div>
        <div style="text-align: center; padding: 16px; font-size: 12px; color: #999; border-radius: 0 0 12px 12px;">
            Shared via Drafter
        </div>
    </div>
    """

    send_mail(
        subject=subject,
        message=message,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[vt.recipient_email],
        html_message=html_message,
        fail_silently=False,
    )

    vt.invitation_sent = True
    vt.invitation_sent_at = timezone.now()
    vt.save(update_fields=['invitation_sent', 'invitation_sent_at'])

    # Communications alert for the sender (audit trail)
    send_alert(
        category='viewer.invitation_sent',
        recipient=sender_user,
        title=f'Approval invitation sent to {vt.recipient_email}',
        message=f'You invited {vt.recipient_email} to {role_label} "{doc_title}".',
        target_type='document',
        target_id=str(vt.document_id),
        metadata={
            'recipient_email': vt.recipient_email,
            'role': vt.role,
            'access_mode': vt.access_mode,
            'action_url': view_url,
        },
        email=False,
    )
