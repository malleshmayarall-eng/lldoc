"""
Viewer App — Serializers

Handles serialization for:
- ViewerToken CRUD (create / list / update)
- OTP send / verify
- Viewer session info
- Shared documents listing (for logged-in viewers)
- Document detail for viewer context
"""

from rest_framework import serializers
from django.contrib.auth.models import User
from django.utils import timezone
from datetime import timedelta

from .models import ViewerToken, ViewerOTP, ViewerSession, ViewerAccessLog


# ─── ViewerToken ─────────────────────────────────────────────────────


class ViewerTokenSerializer(serializers.ModelSerializer):
    """Read-only representation of a viewer token."""
    document_title = serializers.SerializerMethodField()
    share_url = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    token_valid = serializers.SerializerMethodField()

    class Meta:
        model = ViewerToken
        fields = [
            'id', 'document', 'token', 'access_mode', 'role',
            'recipient_email', 'recipient_name',
            'invitation_sent', 'invitation_accepted',
            'max_access_count', 'access_count',
            'expires_at', 'allowed_actions', 'settings',
            'is_active', 'created_by', 'created_at', 'updated_at',
            # computed
            'document_title', 'share_url', 'created_by_name', 'token_valid',
        ]
        read_only_fields = [
            'id', 'token', 'access_count', 'created_by',
            'created_at', 'updated_at',
        ]

    def get_document_title(self, obj):
        try:
            return obj.document.title
        except Exception:
            return str(obj.document_id)

    def get_share_url(self, obj):
        request = self.context.get('request')
        if request:
            base = f"{request.scheme}://{request.get_host()}"
        else:
            base = 'http://localhost:3000'
        return f"{base}/view/{obj.token}"

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None

    def get_token_valid(self, obj):
        return obj.can_access()


class CreateViewerTokenSerializer(serializers.Serializer):
    """
    Create a new viewer token.
    
    POST /api/viewer/tokens/
    {
        "document_id": "<uuid>",
        "access_mode": "public" | "email_otp" | "invite_only",
        "role": "viewer" | "commentator",
        "recipient_email": "client@law.com",       // required for email_otp, invite_only
        "recipient_name": "Jane Doe",               // optional
        "expires_in_hours": 72,                      // optional, null = never
        "max_access_count": 100,                     // optional, null = unlimited
        "password": "secret123",                     // optional password protection
        "allowed_actions": ["view", "download", "ai_chat"],
        "settings": {
            "watermark_enabled": true,
            "watermark_text": "CONFIDENTIAL",
            "branding_message": "Shared by Acme Legal",
            ...
        },
        "send_invitation": true                      // auto-send email (invite_only / email_otp)
    }
    """
    document_id = serializers.UUIDField()
    access_mode = serializers.ChoiceField(
        choices=ViewerToken.ACCESS_MODE_CHOICES,
        default='public',
    )
    role = serializers.ChoiceField(
        choices=ViewerToken.ROLE_CHOICES,
        default='viewer',
    )
    recipient_email = serializers.EmailField(required=False, allow_null=True)
    recipient_name = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    expires_in_hours = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    max_access_count = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    password = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    allowed_actions = serializers.ListField(
        child=serializers.ChoiceField(choices=['view', 'download', 'print', 'ai_chat']),
        required=False,
        default=['view'],
    )
    settings = serializers.JSONField(required=False, default=dict)
    send_invitation = serializers.BooleanField(required=False, default=False)

    def validate(self, data):
        mode = data.get('access_mode', 'public')
        email = data.get('recipient_email')

        if mode in ('email_otp', 'invite_only') and not email:
            raise serializers.ValidationError({
                'recipient_email': f'Email is required for access_mode "{mode}".'
            })

        # Validate document exists
        from documents.models import Document
        try:
            Document.objects.get(id=data['document_id'])
        except Document.DoesNotExist:
            raise serializers.ValidationError({
                'document_id': 'Document not found.'
            })

        return data


class UpdateViewerTokenSerializer(serializers.Serializer):
    """Update an existing viewer token's settings."""
    is_active = serializers.BooleanField(required=False)
    expires_at = serializers.DateTimeField(required=False, allow_null=True)
    max_access_count = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    allowed_actions = serializers.ListField(
        child=serializers.ChoiceField(choices=['view', 'download', 'print', 'ai_chat']),
        required=False,
    )
    settings = serializers.JSONField(required=False)
    password = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    recipient_name = serializers.CharField(required=False, allow_blank=True)


# ─── OTP ─────────────────────────────────────────────────────────────


def _resolve_token_for_otp(token_str):
    """
    Resolve a token string to a ViewerToken.
    
    Handles:
    1. Direct ViewerToken lookup
    2. Legacy Share token → auto-provisions a ViewerToken linked to the same document
    
    Returns (viewer_token, error_message).
    """
    # 1. Try ViewerToken directly
    try:
        vt = ViewerToken.objects.get(token=token_str)
        return vt, None
    except ViewerToken.DoesNotExist:
        pass

    # 2. Try legacy Share → auto-create ViewerToken
    try:
        from sharing.models import Share
        share = Share.objects.select_related('content_type').get(invitation_token=token_str)
        if not share.is_active:
            return None, 'This link has been revoked.'
        if share.is_expired():
            return None, 'This link has expired.'

        document = share.content_object
        if not document:
            return None, 'Document not found for this share link.'

        # Find or create a ViewerToken mirroring this Share
        vt, created = ViewerToken.objects.get_or_create(
            share=share,
            defaults={
                'document': document,
                'token': token_str,  # reuse the same token string
                'access_mode': 'email_otp',
                'role': 'commentator' if share.role in ('commenter', 'commentator', 'editor') else 'viewer',
                'recipient_email': getattr(share, 'shared_with_email', None) or '',
                'recipient_name': getattr(share, 'shared_with_name', None) or '',
                'is_active': True,
                'allowed_actions': ['view', 'comment', 'ai_chat'],
                'created_by': share.shared_by,
            },
        )
        return vt, None
    except Exception:
        pass

    return None, 'Invalid viewer token.'


class OTPSendSerializer(serializers.Serializer):
    """
    Request OTP for viewer access.
    
    POST /api/viewer/otp/send/
    {
        "viewer_token": "<token-string>",
        "email": "client@law.com"
    }
    """
    viewer_token = serializers.CharField()
    email = serializers.EmailField()

    def validate(self, data):
        vt, error = _resolve_token_for_otp(data['viewer_token'])
        if not vt:
            raise serializers.ValidationError({'viewer_token': error})

        if not vt.can_access():
            raise serializers.ValidationError({'viewer_token': 'This link is expired or inactive.'})

        # Allow OTP for:
        #  1. Tokens explicitly configured as email_otp access_mode
        #  2. Commentator tokens (login is always required for commentators)
        is_commentator = vt.role in ('commentator', 'commenter')
        if vt.access_mode != 'email_otp' and not is_commentator:
            raise serializers.ValidationError({
                'viewer_token': 'This link does not require OTP verification.'
            })

        # Enforce email match if the token specifies a recipient
        if vt.recipient_email and data['email'].lower() != vt.recipient_email.lower():
            raise serializers.ValidationError({
                'email': 'This email is not authorized for this document.'
            })

        # Enforce allowed_emails restriction
        allowed = getattr(vt, 'allowed_emails', None) or []
        if allowed:
            allowed_lower = [e.lower() for e in allowed]
            if data['email'].lower() not in allowed_lower:
                raise serializers.ValidationError({
                    'email': 'This email is not in the list of allowed recipients for this link.'
                })

        data['viewer_token_obj'] = vt
        return data


class OTPVerifySerializer(serializers.Serializer):
    """
    Verify OTP and get a viewer session.
    
    POST /api/viewer/otp/verify/
    {
        "viewer_token": "<token-string>",
        "email": "client@law.com",
        "otp": "482916"
    }
    """
    viewer_token = serializers.CharField()
    email = serializers.EmailField()
    otp = serializers.CharField(max_length=6, min_length=6)

    def validate(self, data):
        vt, error = _resolve_token_for_otp(data['viewer_token'])
        if not vt:
            raise serializers.ValidationError({'viewer_token': error})

        if not vt.can_access():
            raise serializers.ValidationError({'viewer_token': 'This link is expired or inactive.'})

        # Get latest unused OTP for this token+email
        otp_record = ViewerOTP.objects.filter(
            viewer_token=vt,
            email__iexact=data['email'],
            is_used=False,
        ).order_by('-created_at').first()

        if not otp_record:
            raise serializers.ValidationError({'otp': 'No pending OTP found. Request a new one.'})

        if not otp_record.verify(data['otp']):
            remaining = otp_record.max_attempts - otp_record.attempts
            raise serializers.ValidationError({
                'otp': f'Invalid OTP. {remaining} attempts remaining.'
            })

        data['viewer_token_obj'] = vt
        data['otp_record'] = otp_record
        return data


# ─── Password verification ──────────────────────────────────────────


class PasswordVerifySerializer(serializers.Serializer):
    """
    Verify password for password-protected viewer tokens.
    
    POST /api/viewer/password/verify/
    {
        "viewer_token": "<token-string>",
        "password": "secret123"
    }
    """
    viewer_token = serializers.CharField()
    password = serializers.CharField()

    def validate(self, data):
        try:
            vt = ViewerToken.objects.get(token=data['viewer_token'])
        except ViewerToken.DoesNotExist:
            raise serializers.ValidationError({'viewer_token': 'Invalid viewer token.'})

        if not vt.can_access():
            raise serializers.ValidationError({'viewer_token': 'This link is expired or inactive.'})

        if not vt.password_hash:
            raise serializers.ValidationError({
                'viewer_token': 'This link is not password-protected.'
            })

        if not vt.check_password(data['password']):
            raise serializers.ValidationError({'password': 'Incorrect password.'})

        data['viewer_token_obj'] = vt
        return data


# ─── Invitation accept ───────────────────────────────────────────────


class InvitationAcceptSerializer(serializers.Serializer):
    """
    Accept an invitation for invite_only viewer tokens.
    
    POST /api/viewer/invitation/accept/
    {
        "viewer_token": "<token-string>",
        "email": "partner@firm.com"
    }
    """
    viewer_token = serializers.CharField()
    email = serializers.EmailField()

    def validate(self, data):
        try:
            vt = ViewerToken.objects.get(token=data['viewer_token'])
        except ViewerToken.DoesNotExist:
            raise serializers.ValidationError({'viewer_token': 'Invalid viewer token.'})

        if not vt.can_access():
            raise serializers.ValidationError({'viewer_token': 'This link is expired or inactive.'})

        if vt.access_mode != 'invite_only':
            raise serializers.ValidationError({
                'viewer_token': 'This link does not require invitation acceptance.'
            })

        if vt.recipient_email and data['email'].lower() != vt.recipient_email.lower():
            raise serializers.ValidationError({
                'email': 'This email is not authorized for this invitation.'
            })

        data['viewer_token_obj'] = vt
        return data


# ─── Shared documents list ───────────────────────────────────────────


class SharedDocumentListSerializer(serializers.Serializer):
    """
    Lightweight serializer for listing documents shared with a viewer.
    Used in the viewer's "my shared documents" dashboard.
    """
    document_id = serializers.UUIDField(source='document.id')
    document_title = serializers.CharField(source='document.title')
    document_type = serializers.CharField(source='document.document_type')
    document_status = serializers.CharField(source='document.status')
    role = serializers.CharField()
    access_mode = serializers.CharField()
    viewer_token = serializers.CharField(source='token')
    shared_by = serializers.SerializerMethodField()
    shared_at = serializers.DateTimeField(source='created_at')
    expires_at = serializers.DateTimeField()
    token_valid = serializers.SerializerMethodField()
    allowed_actions = serializers.ListField()

    def get_shared_by(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None

    def get_token_valid(self, obj):
        return obj.can_access()


# ─── Viewer session info ─────────────────────────────────────────────


class ViewerSessionSerializer(serializers.ModelSerializer):
    """Session info returned after successful OTP/invitation/password."""
    document_id = serializers.UUIDField(source='viewer_token.document_id')
    document_title = serializers.SerializerMethodField()
    role = serializers.CharField(source='viewer_token.role')
    allowed_actions = serializers.ListField(source='viewer_token.allowed_actions')
    settings = serializers.JSONField(source='viewer_token.settings')

    class Meta:
        model = ViewerSession
        fields = [
            'session_token', 'email', 'document_id', 'document_title',
            'role', 'allowed_actions', 'settings',
            'created_at', 'expires_at',
        ]
        read_only_fields = fields

    def get_document_title(self, obj):
        try:
            return obj.viewer_token.document.title
        except Exception:
            return ''


# ─── Access log ──────────────────────────────────────────────────────


class ViewerAccessLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = ViewerAccessLog
        fields = [
            'id', 'viewer_token', 'document', 'session',
            'email', 'ip_address', 'user_agent', 'action',
            'accessed_at', 'metadata',
        ]
        read_only_fields = fields


# ─── AI Chat (viewer-scoped) ────────────────────────────────────────


class ViewerAIChatSerializer(serializers.Serializer):
    """
    AI chat for viewers — same as /api/ai/chat/ but scoped to viewer permissions.
    
    POST /api/viewer/ai-chat/
    {
        "session_token": "...",         // or viewer_token for public mode
        "viewer_token": "...",          // for public access
        "message": "What does clause 5.2 mean?",
        "scope": "document",
        "scope_id": null,
        "conversation_history": [...]
    }
    """
    viewer_token = serializers.CharField(required=False)
    session_token = serializers.CharField(required=False)
    message = serializers.CharField()
    scope = serializers.ChoiceField(
        choices=['document', 'section', 'paragraph', 'table'],
        default='document',
    )
    scope_id = serializers.UUIDField(required=False, allow_null=True)
    conversation_history = serializers.ListField(
        child=serializers.DictField(),
        required=False,
        default=list,
    )

    def validate(self, data):
        if not data.get('viewer_token') and not data.get('session_token'):
            raise serializers.ValidationError(
                'Either viewer_token or session_token is required.'
            )
        return data


# ═══════════════════════════════════════════════════════════════════════
# VIEWER COMMENT SERIALIZERS
# ═══════════════════════════════════════════════════════════════════════

from .models import ViewerComment
from django.contrib.contenttypes.models import ContentType


class ViewerCommentSerializer(serializers.ModelSerializer):
    """Read representation of a comment with nested replies."""
    replies = serializers.SerializerMethodField()
    reply_count = serializers.IntegerField(read_only=True, default=0)
    target_title = serializers.CharField(read_only=True)

    class Meta:
        model = ViewerComment
        fields = [
            'id', 'document', 'target_type', 'object_id',
            'text', 'parent',
            'author_email', 'author_name',
            'is_resolved', 'resolved_by', 'resolved_at',
            'created_at', 'updated_at',
            'reply_count', 'target_title',
            'replies', 'metadata',
        ]
        read_only_fields = [
            'id', 'document', 'created_at', 'updated_at',
            'reply_count', 'target_title', 'replies',
        ]

    def get_replies(self, obj):
        """Get nested replies (1 level deep only to avoid infinite recursion)."""
        if obj.parent is not None:
            return []  # Don't nest replies of replies
        replies = ViewerComment.objects.filter(
            parent=obj
        ).order_by('created_at')[:50]
        return ViewerCommentReplySerializer(replies, many=True).data


class ViewerCommentReplySerializer(serializers.ModelSerializer):
    """Flat reply serializer (no further nesting)."""

    class Meta:
        model = ViewerComment
        fields = [
            'id', 'text', 'parent',
            'author_email', 'author_name',
            'created_at', 'updated_at',
            'metadata',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class CreateViewerCommentSerializer(serializers.Serializer):
    """
    Create a comment on any document element.
    
    POST /api/viewer/comments/
    {
        "viewer_token": "abc123...",
        "target_type": "section",
        "target_id": "uuid-of-section",
        "text": "This clause needs rewording.",
        "parent_id": null,              // optional, for replies
        "metadata": {}                  // optional
    }
    """
    viewer_token = serializers.CharField(
        help_text="The viewer/share token from the URL",
    )
    target_type = serializers.ChoiceField(
        choices=['document', 'section', 'paragraph', 'table', 'image'],
        help_text="Type of element being commented on",
    )
    target_id = serializers.CharField(
        help_text="UUID of the target element",
    )
    text = serializers.CharField(
        max_length=5000,
        help_text="Comment text",
    )
    parent_id = serializers.UUIDField(
        required=False, allow_null=True,
        help_text="Parent comment ID for replies",
    )
    metadata = serializers.JSONField(
        required=False, default=dict,
    )

    def validate_viewer_token(self, value):
        """Resolve the viewer token and verify commentator role."""
        # Try ViewerToken first
        try:
            vt = ViewerToken.objects.select_related('document').get(token=value)
            if not vt.is_active:
                raise serializers.ValidationError('This link has been revoked.')
            if vt.is_expired():
                raise serializers.ValidationError('This link has expired.')
            if vt.role not in ('commentator',) and 'comment' not in (vt.allowed_actions or []):
                raise serializers.ValidationError('You do not have permission to comment.')
            self.context['viewer_token_obj'] = vt
            self.context['token_type'] = 'viewer_token'
            return value
        except ViewerToken.DoesNotExist:
            pass

        # Try legacy Share
        try:
            from sharing.models import Share
            share = Share.objects.select_related('content_type').get(invitation_token=value)
            if not share.is_active:
                raise serializers.ValidationError('This link has been revoked.')
            if share.is_expired():
                raise serializers.ValidationError('This link has expired.')
            if share.role not in ('commenter', 'editor'):
                raise serializers.ValidationError('You do not have permission to comment.')
            self.context['share_obj'] = share
            self.context['token_type'] = 'legacy_share'
            return value
        except Exception:
            pass

        raise serializers.ValidationError('Invalid or unknown token.')

    def validate_target_type(self, value):
        """Map target_type to the actual model."""
        from documents.models import Document, Section, Paragraph, Table, ImageComponent
        model_map = {
            'document': Document,
            'section': Section,
            'paragraph': Paragraph,
            'table': Table,
            'image': ImageComponent,
        }
        self.context['target_model'] = model_map[value]
        return value

    def validate(self, data):
        """Verify the target element exists and belongs to the document."""
        target_model = self.context.get('target_model')
        target_id = data.get('target_id')

        # Get document from token
        if self.context.get('token_type') == 'viewer_token':
            document = self.context['viewer_token_obj'].document
        else:
            document = self.context['share_obj'].content_object

        self.context['document'] = document

        # Validate target exists
        try:
            if data['target_type'] == 'document':
                obj = target_model.objects.get(id=target_id)
            elif data['target_type'] in ('section',):
                obj = target_model.objects.get(id=target_id, document=document)
            elif data['target_type'] in ('paragraph',):
                obj = target_model.objects.get(id=target_id, section__document=document)
            elif data['target_type'] == 'table':
                obj = target_model.objects.get(id=target_id, section__document=document)
            elif data['target_type'] == 'image':
                obj = target_model.objects.get(id=target_id, section__document=document)
            else:
                raise serializers.ValidationError({'target_id': 'Invalid target type.'})
            
            self.context['target_object'] = obj
        except target_model.DoesNotExist:
            raise serializers.ValidationError({
                'target_id': f'{data["target_type"].title()} not found in this document.'
            })

        # Validate parent comment if provided
        if data.get('parent_id'):
            try:
                parent = ViewerComment.objects.get(
                    id=data['parent_id'],
                    document=document,
                )
                self.context['parent_comment'] = parent
            except ViewerComment.DoesNotExist:
                raise serializers.ValidationError({
                    'parent_id': 'Parent comment not found.'
                })

        return data
