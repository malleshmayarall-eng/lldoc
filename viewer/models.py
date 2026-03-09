"""
Viewer App — Models

Provides token-based access for external viewers (and commentators in future).

ACCESS MODES:
1. PUBLIC — Anyone with the link can view the PDF. No login required.
2. EMAIL_OTP — Viewer must verify email via OTP. No registration needed.
3. INVITE_ONLY — Viewer must accept invitation. If email already has an
   account, show document directly; otherwise send invitation.

TOKEN CUSTOMIZATION:
- Expiry (hours/days/never)
- Max access count
- Password protection
- Allowed actions (view, download, print, chat)
- Watermark toggle
- Custom branding message
"""

from django.db import models
from django.contrib.auth.models import User
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone
import uuid
import secrets


class ViewerToken(models.Model):
    """
    A shareable token that grants viewer/commentator access to a document.
    
    Each token is independently configurable:
    - access_mode controls whether login/OTP is required
    - allowed_actions controls what the viewer can do
    - settings stores production-level customisation (watermark, branding, etc.)
    
    USAGE:
        # Public link — no auth
        token = ViewerToken.objects.create(
            document=doc,
            access_mode='public',
            created_by=owner,
        )
        url = f"https://app.com/view/{token.token}"
        
        # Email OTP — viewer must verify email
        token = ViewerToken.objects.create(
            document=doc,
            access_mode='email_otp',
            recipient_email='client@law.com',
            created_by=owner,
        )
        
        # Invite only — maps to existing Share system
        token = ViewerToken.objects.create(
            document=doc,
            access_mode='invite_only',
            recipient_email='partner@firm.com',
            created_by=owner,
        )
    """

    ACCESS_MODE_CHOICES = [
        ('public', 'Public — anyone with link'),
        ('email_otp', 'Email OTP — verify email, no registration'),
        ('invite_only', 'Invite Only — accept invitation first'),
    ]

    ROLE_CHOICES = [
        ('viewer', 'Viewer — read-only PDF'),
        ('commentator', 'Commentator — can comment and approve'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # ── Linked document ──────────────────────────────────────────────
    document = models.ForeignKey(
        'documents.Document',
        on_delete=models.CASCADE,
        related_name='viewer_tokens',
        help_text="Document this token grants access to",
    )

    # ── Token value ──────────────────────────────────────────────────
    token = models.CharField(
        max_length=128,
        unique=True,
        db_index=True,
        help_text="Cryptographically secure URL-safe token",
    )

    # ── Access configuration ─────────────────────────────────────────
    access_mode = models.CharField(
        max_length=20,
        choices=ACCESS_MODE_CHOICES,
        default='public',
    )
    role = models.CharField(
        max_length=20,
        choices=ROLE_CHOICES,
        default='viewer',
    )

    # ── Recipient (for email_otp / invite_only) ──────────────────────
    recipient_email = models.EmailField(
        null=True, blank=True,
        help_text="Required for email_otp and invite_only modes",
    )
    recipient_name = models.CharField(
        max_length=255, null=True, blank=True,
        help_text="Display name for the recipient",
    )

    # ── Multiple allowed emails (for commentator links) ──────────────
    allowed_emails = models.JSONField(
        default=list, blank=True,
        help_text='List of emails permitted to access. Empty = anyone can access. '
                  'E.g. ["alice@law.com", "bob@firm.com"]',
    )

    # ── Invitation state ─────────────────────────────────────────────
    invitation_sent = models.BooleanField(default=False)
    invitation_sent_at = models.DateTimeField(null=True, blank=True)
    invitation_accepted = models.BooleanField(default=False)
    invitation_accepted_at = models.DateTimeField(null=True, blank=True)

    # ── Security / limits ────────────────────────────────────────────
    password_hash = models.CharField(
        max_length=128, null=True, blank=True,
        help_text="Optional password protection (bcrypt/pbkdf2 hash)",
    )
    max_access_count = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="Max number of accesses. null = unlimited.",
    )
    access_count = models.PositiveIntegerField(default=0)

    # ── Expiry ───────────────────────────────────────────────────────
    expires_at = models.DateTimeField(
        null=True, blank=True,
        help_text="null = never expires",
    )

    # ── Allowed actions ──────────────────────────────────────────────
    # Stored as JSON list: ["view", "download", "print", "ai_chat"]
    allowed_actions = models.JSONField(
        default=list,
        blank=True,
        help_text='List of permitted actions: "view", "download", "print", "ai_chat"',
    )

    # ── Customisation (production settings) ──────────────────────────
    settings = models.JSONField(
        default=dict,
        blank=True,
        help_text="""
        Production-level customisation:
        {
            "watermark_enabled": true,
            "watermark_text": "CONFIDENTIAL",
            "branding_message": "Shared by Acme Legal",
            "branding_logo_url": "https://...",
            "theme": "light" | "dark",
            "disable_text_selection": false,
            "require_nda_acceptance": false,
            "nda_text": "...",
            "custom_css": "...",
            "show_page_numbers": true,
            "analytics_enabled": true,
        }
        """,
    )

    # ── Ownership / audit ────────────────────────────────────────────
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True,
        related_name='created_viewer_tokens',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_active = models.BooleanField(default=True)

    # ── Link back to Share (optional) ────────────────────────────────
    share = models.ForeignKey(
        'sharing.Share',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='viewer_tokens',
        help_text="Optional link to parent Share record",
    )

    # ── Metadata ─────────────────────────────────────────────────────
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['token']),
            models.Index(fields=['document', 'is_active']),
            models.Index(fields=['recipient_email']),
            models.Index(fields=['access_mode']),
            models.Index(fields=['created_by', '-created_at']),
        ]

    def __str__(self):
        mode = self.get_access_mode_display()
        return f"ViewerToken({self.token[:12]}…) → {self.document_id} [{mode}]"

    def save(self, *args, **kwargs):
        if not self.token:
            self.token = secrets.token_urlsafe(48)
        # Default allowed_actions if empty
        if not self.allowed_actions:
            self.allowed_actions = ['view']
        super().save(*args, **kwargs)

    # ── Helpers ──────────────────────────────────────────────────────

    def is_expired(self):
        if self.expires_at and timezone.now() > self.expires_at:
            return True
        return False

    def is_max_access_reached(self):
        if self.max_access_count is not None and self.access_count >= self.max_access_count:
            return True
        return False

    def can_access(self):
        """Check all access conditions."""
        return self.is_active and not self.is_expired() and not self.is_max_access_reached()

    def record_access(self, ip_address=None, user_agent=None):
        """Increment counter and create access log."""
        self.access_count += 1
        self.save(update_fields=['access_count'])

        ViewerAccessLog.objects.create(
            viewer_token=self,
            document=self.document,
            ip_address=ip_address,
            user_agent=user_agent or '',
        )

    def set_password(self, raw_password):
        """Hash and store a password for this token."""
        from django.contrib.auth.hashers import make_password
        self.password_hash = make_password(raw_password)

    def check_password(self, raw_password):
        """Verify a password against the stored hash."""
        if not self.password_hash:
            return True  # no password set
        from django.contrib.auth.hashers import check_password
        return check_password(raw_password, self.password_hash)

    def get_share_url(self, base_url=None):
        """Generate the viewer URL."""
        base = base_url or 'http://localhost:3000'
        return f"{base}/view/{self.token}"


class ViewerOTP(models.Model):
    """
    One-time password for email-based viewer authentication.
    
    Flow:
    1. Viewer opens email_otp link → enters email → POST /viewer/otp/send/
    2. Backend generates 6-digit OTP, sends to email, stores hash here
    3. Viewer enters OTP → POST /viewer/otp/verify/
    4. Backend returns a viewer_session_token for subsequent API calls
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    viewer_token = models.ForeignKey(
        ViewerToken,
        on_delete=models.CASCADE,
        related_name='otps',
    )
    email = models.EmailField()
    otp_hash = models.CharField(
        max_length=128,
        help_text="PBKDF2 hash of the 6-digit OTP",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    is_used = models.BooleanField(default=False)
    attempts = models.PositiveIntegerField(default=0)
    max_attempts = models.PositiveIntegerField(default=5)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['viewer_token', 'email', '-created_at']),
        ]

    def __str__(self):
        return f"OTP for {self.email} → token {self.viewer_token.token[:12]}…"

    def is_expired(self):
        return timezone.now() > self.expires_at

    def is_valid(self):
        return not self.is_used and not self.is_expired() and self.attempts < self.max_attempts

    def verify(self, raw_otp):
        """Verify OTP. Returns True on success, False on failure."""
        from django.contrib.auth.hashers import check_password
        self.attempts += 1
        self.save(update_fields=['attempts'])

        if not self.is_valid():
            return False
        if check_password(str(raw_otp), self.otp_hash):
            self.is_used = True
            self.save(update_fields=['is_used'])
            return True
        return False


class ViewerSession(models.Model):
    """
    Lightweight session for authenticated viewers (post-OTP or post-invitation).
    
    This replaces Django's full session/auth system for external viewers
    who don't have (and don't need) a User account.
    
    The session_token is sent as `Authorization: ViewerSession <token>` header
    or as a query param `?session=<token>`.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    viewer_token = models.ForeignKey(
        ViewerToken,
        on_delete=models.CASCADE,
        related_name='sessions',
    )
    email = models.EmailField(
        help_text="Email of the viewer (verified via OTP or invitation)",
    )
    session_token = models.CharField(
        max_length=128, unique=True, db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    is_active = models.BooleanField(default=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)

    # Link to Django User if email matches an existing account
    user = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='viewer_sessions',
        help_text="Auto-linked if email matches a registered user",
    )

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['session_token']),
            models.Index(fields=['viewer_token', 'email']),
        ]

    def __str__(self):
        return f"ViewerSession({self.session_token[:12]}…) — {self.email}"

    def save(self, *args, **kwargs):
        if not self.session_token:
            self.session_token = secrets.token_urlsafe(48)
        # Auto-link to existing user
        if not self.user and self.email:
            try:
                self.user = User.objects.get(email=self.email)
            except User.DoesNotExist:
                pass
        super().save(*args, **kwargs)

    def is_expired(self):
        return timezone.now() > self.expires_at

    def is_valid(self):
        return self.is_active and not self.is_expired()


class ViewerAccessLog(models.Model):
    """Access log specific to viewer token usage."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    viewer_token = models.ForeignKey(
        ViewerToken, on_delete=models.CASCADE,
        related_name='access_logs',
    )
    document = models.ForeignKey(
        'documents.Document', on_delete=models.CASCADE,
        related_name='viewer_access_logs',
    )
    session = models.ForeignKey(
        ViewerSession, on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='access_logs',
    )
    email = models.EmailField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    action = models.CharField(
        max_length=30, default='view',
        help_text='view, download, print, ai_chat',
    )
    accessed_at = models.DateTimeField(auto_now_add=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-accessed_at']
        indexes = [
            models.Index(fields=['viewer_token', '-accessed_at']),
            models.Index(fields=['document', '-accessed_at']),
        ]

    def __str__(self):
        return f"{self.action} @ {self.accessed_at} — {self.email or self.ip_address}"


class ViewerComment(models.Model):
    """
    Comment left by an external viewer/commentator on any document element.
    
    Uses GenericForeignKey to target any part of the document structure:
    - Document (top-level comment)
    - Section (section/subsection/sub-subsection comment)
    - Paragraph (paragraph-level comment)
    - Table (table-level comment)
    - ImageComponent (image-level comment)
    
    Supports:
    - Nested replies via parent FK
    - Resolution tracking (resolved/unresolved)
    - Author identified by email (from ViewerSession)
    - Sorting by created_at
    - Pagination via standard DRF pagination
    
    USAGE:
        # Comment on a section
        ViewerComment.objects.create(
            viewer_token=vt,
            content_type=ContentType.objects.get_for_model(Section),
            object_id=str(section.id),
            author_email='reviewer@firm.com',
            author_name='Jane Doe',
            text='This clause is ambiguous — needs rewording.',
        )
    """
    
    TARGET_TYPE_CHOICES = [
        ('document', 'Document'),
        ('section', 'Section'),
        ('paragraph', 'Paragraph'),
        ('table', 'Table'),
        ('image', 'Image Component'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # ── Link to viewer token (access context) ────────────────────────
    viewer_token = models.ForeignKey(
        ViewerToken,
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='comments',
        help_text="The viewer token through which this comment was created (null for editor-created comments)",
    )
    document = models.ForeignKey(
        'documents.Document',
        on_delete=models.CASCADE,
        related_name='viewer_comments',
        help_text="The document this comment belongs to",
    )
    
    # ── Generic target (what element is this comment on?) ────────────
    content_type = models.ForeignKey(
        ContentType,
        on_delete=models.CASCADE,
        help_text="Type of the target element (Section, Paragraph, Table, etc.)",
    )
    object_id = models.CharField(
        max_length=255,
        help_text="UUID of the target element",
    )
    content_object = GenericForeignKey('content_type', 'object_id')
    
    # Human-readable target type for easy filtering
    target_type = models.CharField(
        max_length=20,
        choices=TARGET_TYPE_CHOICES,
        default='document',
        db_index=True,
        help_text="Readable target type for filtering",
    )
    
    # ── Comment content ──────────────────────────────────────────────
    text = models.TextField(
        help_text="The comment text",
    )
    
    # ── Threading (replies) ──────────────────────────────────────────
    parent = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='replies',
        help_text="Parent comment if this is a reply",
    )
    
    # ── Author info ──────────────────────────────────────────────────
    author_email = models.EmailField(
        help_text="Email of the commenter (from viewer session)",
    )
    author_name = models.CharField(
        max_length=255, blank=True, default='',
        help_text="Display name of the commenter",
    )
    session = models.ForeignKey(
        ViewerSession,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='comments',
        help_text="The viewer session that created this comment",
    )
    
    # ── Status ───────────────────────────────────────────────────────
    is_resolved = models.BooleanField(
        default=False,
        help_text="Whether this comment thread has been resolved",
    )
    resolved_by = models.CharField(
        max_length=255, blank=True, default='',
        help_text="Who resolved this comment",
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    
    # ── Timestamps ───────────────────────────────────────────────────
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    # ── Metadata ─────────────────────────────────────────────────────
    metadata = models.JSONField(
        default=dict, blank=True,
        help_text="Extra data: highlight range, suggested text, etc.",
    )
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['document', 'target_type', '-created_at']),
            models.Index(fields=['content_type', 'object_id']),
            models.Index(fields=['viewer_token', '-created_at']),
            models.Index(fields=['author_email']),
            models.Index(fields=['is_resolved']),
        ]
    
    def __str__(self):
        return f"Comment by {self.author_email} on {self.target_type}:{self.object_id[:8]} — {self.text[:50]}"
    
    @property
    def reply_count(self):
        return self.replies.count()
    
    @property
    def target_title(self):
        """Get a human-readable title for the target element."""
        try:
            obj = self.content_object
            if obj is None:
                return 'Unknown'
            if hasattr(obj, 'title') and obj.title:
                return obj.title
            if hasattr(obj, 'content_text'):
                return (obj.content_text or '')[:80]
            return str(obj)
        except Exception:
            return 'Unknown'


class ViewerApproval(models.Model):
    """
    Tracks approval/rejection decisions from commentators on a document.
    
    Each approval is an immutable record — multiple reviewers can each
    submit their own decision, and the latest one per reviewer is used.
    
    USAGE:
        ViewerApproval.objects.create(
            viewer_token=vt,
            document=doc,
            reviewer_email='reviewer@firm.com',
            reviewer_name='Jane Doe',
            status='approved',
            comment='Looks good — ready to proceed.',
        )
    """
    
    STATUS_CHOICES = [
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
        ('changes_requested', 'Changes Requested'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    viewer_token = models.ForeignKey(
        ViewerToken,
        on_delete=models.CASCADE,
        related_name='approvals',
        null=True, blank=True,
        help_text="The viewer token through which this approval was made",
    )
    document = models.ForeignKey(
        'documents.Document',
        on_delete=models.CASCADE,
        related_name='viewer_approvals',
        help_text="The document being approved/rejected",
    )
    
    # ── Reviewer info ────────────────────────────────────────────────
    reviewer_email = models.EmailField(
        help_text="Email of the reviewer (from viewer session)",
    )
    reviewer_name = models.CharField(
        max_length=255, blank=True, default='',
        help_text="Display name of the reviewer",
    )
    session = models.ForeignKey(
        ViewerSession,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='approvals',
    )
    
    # ── Decision ─────────────────────────────────────────────────────
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        help_text="Approval decision",
    )
    comment = models.TextField(
        blank=True, default='',
        help_text="Optional comment with the approval decision",
    )
    
    # ── Timestamps ───────────────────────────────────────────────────
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['document', '-created_at']),
            models.Index(fields=['reviewer_email']),
        ]
    
    def __str__(self):
        return f"{self.status} by {self.reviewer_email} on {self.document_id}"


class ViewerAlert(models.Model):
    """
    Notification/alert for document events (comments, approvals, replies).
    
    Sent to the document owner and other participants when someone comments,
    replies to a comment, resolves a thread, or submits an approval decision.
    
    USAGE:
        ViewerAlert.objects.create(
            document=doc,
            alert_type='new_comment',
            recipient_email='owner@firm.com',
            triggered_by_email='reviewer@client.com',
            triggered_by_name='Jane Doe',
            message='Jane Doe commented on paragraph in "Service Agreement"',
            metadata={'comment_id': str(comment.id), 'target_type': 'paragraph'},
        )
    """
    
    ALERT_TYPES = [
        ('new_comment', 'New Comment'),
        ('comment_reply', 'Reply to Comment'),
        ('comment_resolved', 'Comment Resolved'),
        ('comment_deleted', 'Comment Deleted'),
        ('approval_submitted', 'Approval Decision Submitted'),
        ('document_shared', 'Document Shared'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    document = models.ForeignKey(
        'documents.Document',
        on_delete=models.CASCADE,
        related_name='viewer_alerts',
    )
    
    # ── Alert classification ─────────────────────────────────────────
    alert_type = models.CharField(max_length=30, choices=ALERT_TYPES)
    message = models.TextField(help_text="Human-readable alert message")
    
    # ── Who receives this alert ──────────────────────────────────────
    recipient_email = models.EmailField(
        help_text="Email of the person who should see this alert",
    )
    recipient_user = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='viewer_alerts_received',
        help_text="Auto-linked Django user (if exists)",
    )
    
    # ── Who triggered it ─────────────────────────────────────────────
    triggered_by_email = models.EmailField(
        blank=True, default='',
        help_text="Email of the person who triggered this alert",
    )
    triggered_by_name = models.CharField(
        max_length=255, blank=True, default='',
    )
    
    # ── State ────────────────────────────────────────────────────────
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)
    
    # ── Reference to source object ───────────────────────────────────
    # Optional: links to the comment/approval that triggered this alert
    comment = models.ForeignKey(
        'ViewerComment',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='alerts',
    )
    approval = models.ForeignKey(
        'ViewerApproval',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='alerts',
    )
    viewer_token = models.ForeignKey(
        ViewerToken,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='alerts',
    )
    
    # ── Metadata ─────────────────────────────────────────────────────
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['recipient_email', 'is_read', '-created_at']),
            models.Index(fields=['recipient_user', 'is_read', '-created_at']),
            models.Index(fields=['document', '-created_at']),
            models.Index(fields=['alert_type']),
        ]
    
    def __str__(self):
        return f"[{self.alert_type}] {self.message[:60]} → {self.recipient_email}"
    
    def mark_read(self):
        """Mark this alert as read."""
        if not self.is_read:
            self.is_read = True
            self.read_at = timezone.now()
            self.save(update_fields=['is_read', 'read_at'])
    
    @classmethod
    def create_comment_alert(cls, comment, document, exclude_email=None):
        """
        Create alerts for a new comment — notify document owner and other
        participants in the same comment thread / document.
        """
        recipients = set()
        
        # 1. Notify document owner
        if document.created_by and document.created_by.email:
            recipients.add(document.created_by.email.lower())
        
        # 2. Notify other commentators on this document
        from viewer.models import ViewerComment
        other_emails = (
            ViewerComment.objects
            .filter(document=document)
            .exclude(author_email='')
            .values_list('author_email', flat=True)
            .distinct()
        )
        for email in other_emails:
            recipients.add(email.lower())
        
        # Don't notify the person who just commented
        if exclude_email:
            recipients.discard(exclude_email.lower())
        
        # Build alerts
        author_display = comment.author_name or comment.author_email.split('@')[0]
        doc_title = document.title or 'Untitled Document'
        
        if comment.parent:
            alert_type = 'comment_reply'
            msg = f'{author_display} replied to a comment on "{doc_title}"'
        else:
            target_label = comment.target_type or 'element'
            msg = f'{author_display} commented on a {target_label} in "{doc_title}"'
            alert_type = 'new_comment'
        
        alerts = []
        for recipient in recipients:
            user = User.objects.filter(email__iexact=recipient).first()
            alerts.append(cls(
                document=document,
                alert_type=alert_type,
                message=msg,
                recipient_email=recipient,
                recipient_user=user,
                triggered_by_email=comment.author_email,
                triggered_by_name=comment.author_name,
                comment=comment,
                viewer_token=comment.viewer_token,
                metadata={
                    'comment_id': str(comment.id),
                    'target_type': comment.target_type,
                    'object_id': comment.object_id,
                },
            ))
        
        if alerts:
            cls.objects.bulk_create(alerts)
        
        return alerts
    
    @classmethod
    def create_approval_alert(cls, approval, document):
        """Create alerts for an approval decision — notify document owner."""
        recipients = set()
        
        if document.created_by and document.created_by.email:
            recipients.add(document.created_by.email.lower())
        
        # Also notify other reviewers
        from viewer.models import ViewerApproval
        other_emails = (
            ViewerApproval.objects
            .filter(document=document)
            .exclude(reviewer_email='')
            .values_list('reviewer_email', flat=True)
            .distinct()
        )
        for email in other_emails:
            recipients.add(email.lower())
        
        recipients.discard(approval.reviewer_email.lower())
        
        reviewer_display = approval.reviewer_name or approval.reviewer_email.split('@')[0]
        doc_title = document.title or 'Untitled Document'
        status_display = approval.get_status_display()
        msg = f'{reviewer_display} {status_display.lower()} "{doc_title}"'
        
        alerts = []
        for recipient in recipients:
            user = User.objects.filter(email__iexact=recipient).first()
            alerts.append(cls(
                document=document,
                alert_type='approval_submitted',
                message=msg,
                recipient_email=recipient,
                recipient_user=user,
                triggered_by_email=approval.reviewer_email,
                triggered_by_name=approval.reviewer_name,
                approval=approval,
                viewer_token=approval.viewer_token,
                metadata={
                    'approval_id': str(approval.id),
                    'status': approval.status,
                },
            ))
        
        if alerts:
            cls.objects.bulk_create(alerts)
        
        return alerts
