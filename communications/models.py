"""
communications/models.py — Production notification & alert system
===================================================================

Models:

  • Alert              — every notification ever fired (in-app + email + webhook)
  • AlertPreference    — per-user opt-in/opt-out for categories × channels
  • WebhookEndpoint    — registered webhook URLs for push delivery
  • WebhookDelivery    — delivery attempt log for each webhook call
  • NotificationDigest — batched digest records (daily/weekly summaries)

Design principles:
  - Async-first: email & webhook delivery is offloaded to Celery tasks
  - Multi-channel: in_app (instant), email (async), webhook (async)
  - Rate-limited: per-user deduplication window prevents notification spam
  - Retry-capable: failed deliveries are retried with exponential backoff
  - Real-time: WebSocket push via Django Channels for connected clients
  - Digest-ready: low-priority alerts can be batched into periodic digests
"""
from __future__ import annotations

import hashlib
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

User = settings.AUTH_USER_MODEL


# ─── Category registry ──────────────────────────────────────────────
# Flat dotted names so any app can define sub-categories freely.
# The choices list is non-enforced at the DB level (CharField, not enum)
# so new categories can be added without migrations.

CATEGORY_CHOICES = [
    # Documents
    ('document.shared', 'Document Shared'),
    ('document.comment', 'New Comment'),
    ('document.comment_reply', 'Comment Reply'),
    ('document.comment_resolved', 'Comment Resolved'),
    ('document.approval', 'Approval Decision'),
    ('document.mention', 'You Were Mentioned'),
    ('document.export_complete', 'PDF Export Complete'),
    ('document.version_created', 'New Version Created'),
    # Workflows
    ('workflow.assigned', 'Workflow Assigned'),
    ('workflow.reassigned', 'Workflow Reassigned'),
    ('workflow.status_changed', 'Workflow Status Changed'),
    ('workflow.approval_request', 'Approval Requested'),
    ('workflow.approved', 'Workflow Approved'),
    ('workflow.rejected', 'Workflow Rejected'),
    ('workflow.due_date', 'Due Date Reminder'),
    ('workflow.decision', 'Decision Step Update'),
    ('workflow.overdue', 'Workflow Overdue'),
    # DMS
    ('dms.expiring', 'Document Expiring Soon'),
    ('dms.expired', 'Document Expired'),
    ('dms.renewal', 'Renewal Reminder'),
    # CLM
    ('clm.contract_expiring', 'Contract Expiring'),
    ('clm.task_assigned', 'CLM Task Assigned'),
    ('clm.task_completed', 'CLM Task Completed'),
    ('clm.validation_assigned', 'Assigned as Validator'),
    ('clm.validation_pending', 'Approval Requested'),
    ('clm.validation_resolved', 'Validation Decision Made'),
    ('clm.workflow_failed', 'Workflow Execution Failed'),
    ('clm.workflow_completed', 'Workflow Completed'),
    # Viewer
    ('viewer.invitation_sent', 'Viewer Invitation Sent'),
    ('viewer.document_shared', 'Document Shared via Viewer'),
    ('viewer.new_comment', 'Viewer Comment'),
    ('viewer.approval_submitted', 'Viewer Approval Submitted'),
    # Sharing
    ('sharing.access_granted', 'Access Granted'),
    ('sharing.access_revoked', 'Access Revoked'),
    ('sharing.role_changed', 'Sharing Role Changed'),
    # System
    ('system.info', 'System Info'),
    ('system.warning', 'System Warning'),
    ('system.error', 'System Error'),
    ('system.maintenance', 'Scheduled Maintenance'),
]

CATEGORY_LOOKUP = {k: v for k, v in CATEGORY_CHOICES}

PRIORITY_CHOICES = [
    ('low', 'Low'),
    ('normal', 'Normal'),
    ('high', 'High'),
    ('urgent', 'Urgent'),
]

# Priority weight for sorting — higher = more important
PRIORITY_WEIGHTS = {'low': 0, 'normal': 1, 'high': 2, 'urgent': 3}

CHANNEL_CHOICES = [
    ('in_app', 'In-App'),
    ('email', 'Email'),
    ('webhook', 'Webhook'),
]

DELIVERY_STATUS_CHOICES = [
    ('pending', 'Pending'),
    ('delivered', 'Delivered'),
    ('failed', 'Failed'),
    ('skipped', 'Skipped'),        # user preference opted out
    ('deduped', 'Deduplicated'),   # suppressed by dedup window
    ('digested', 'Batched for Digest'),
]

DIGEST_FREQUENCY_CHOICES = [
    ('realtime', 'Real-time (no digest)'),
    ('hourly', 'Hourly Digest'),
    ('daily', 'Daily Digest'),
    ('weekly', 'Weekly Digest'),
]


class Alert(models.Model):
    """
    A single notification instance.  Created via ``send_alert()`` — see
    ``communications/dispatch.py``.

    Production features:
      - Async delivery: email/webhook dispatch is queued via Celery
      - Deduplication: ``dedup_key`` prevents duplicate alerts within a time window
      - Retry: failed deliveries are retried with exponential backoff
      - Grouping: ``group_key`` collapses related alerts in the UI
      - Digest: low-priority alerts can be held for digest delivery
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # ── Who ──────────────────────────────────────────────────────────
    recipient = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='alerts',
        db_index=True,
    )
    # Optional: if triggered by another user
    actor = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='alerts_triggered',
    )

    # ── What ─────────────────────────────────────────────────────────
    category = models.CharField(
        max_length=80,
        db_index=True,
        help_text='Dotted category key, e.g. "workflow.assigned"',
    )
    priority = models.CharField(
        max_length=10,
        choices=PRIORITY_CHOICES,
        default='normal',
        db_index=True,
    )
    title = models.CharField(max_length=300)
    message = models.TextField(blank=True, default='')

    # ── Context (generic link to any object) ─────────────────────────
    # Store IDs as strings so they work with UUID PKs across all apps.
    target_type = models.CharField(
        max_length=60,
        blank=True,
        default='',
        help_text='Logical type: "document", "workflow", "contract", …',
    )
    target_id = models.CharField(
        max_length=255,
        blank=True,
        default='',
        help_text='PK of the related object (UUID string)',
    )

    # Arbitrary extra data (links, IDs, names, etc.)
    metadata = models.JSONField(default=dict, blank=True)

    # ── Deduplication & Grouping ─────────────────────────────────────
    dedup_key = models.CharField(
        max_length=255,
        blank=True,
        default='',
        db_index=True,
        help_text='Hash key for deduplication within a time window',
    )
    group_key = models.CharField(
        max_length=255,
        blank=True,
        default='',
        db_index=True,
        help_text='Key for grouping related alerts in UI (e.g. "document:<uuid>")',
    )

    # ── Delivery tracking ────────────────────────────────────────────
    channels_requested = models.JSONField(
        default=list,
        blank=True,
        help_text='Channels requested: ["in_app", "email", "webhook"]',
    )
    channels_delivered = models.JSONField(
        default=list,
        blank=True,
        help_text='Channels that successfully delivered: ["in_app","email"]',
    )
    delivery_status = models.CharField(
        max_length=20,
        choices=DELIVERY_STATUS_CHOICES,
        default='pending',
        db_index=True,
    )

    # Email-specific tracking
    email_sent = models.BooleanField(default=False)
    email_error = models.TextField(blank=True, default='')

    # Retry tracking for failed async delivery
    delivery_attempts = models.PositiveSmallIntegerField(default=0)
    max_retries = models.PositiveSmallIntegerField(default=3)
    next_retry_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_error = models.TextField(blank=True, default='')

    # ── Read state ───────────────────────────────────────────────────
    is_read = models.BooleanField(default=False, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)

    # ── Archival ─────────────────────────────────────────────────────
    is_archived = models.BooleanField(default=False, db_index=True)
    archived_at = models.DateTimeField(null=True, blank=True)

    # ── Timestamps ───────────────────────────────────────────────────
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    expires_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        help_text='Auto-delete after this time (TTL for transient alerts)',
    )

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['recipient', 'is_read', '-created_at']),
            models.Index(fields=['recipient', 'is_archived', '-created_at']),
            models.Index(fields=['recipient', 'category']),
            models.Index(fields=['target_type', 'target_id']),
            models.Index(fields=['delivery_status', 'next_retry_at']),
            models.Index(fields=['dedup_key', 'created_at']),
            models.Index(fields=['group_key']),
            models.Index(fields=['expires_at']),
        ]

    def __str__(self):
        return f'[{self.category}] {self.title} → {self.recipient}'

    # ── helpers ──────────────────────────────────────────────────────
    def mark_read(self):
        if not self.is_read:
            self.is_read = True
            self.read_at = timezone.now()
            self.save(update_fields=['is_read', 'read_at'])

    def mark_unread(self):
        if self.is_read:
            self.is_read = False
            self.read_at = None
            self.save(update_fields=['is_read', 'read_at'])

    def archive(self):
        if not self.is_archived:
            self.is_archived = True
            self.archived_at = timezone.now()
            self.save(update_fields=['is_archived', 'archived_at'])

    def unarchive(self):
        if self.is_archived:
            self.is_archived = False
            self.archived_at = None
            self.save(update_fields=['is_archived', 'archived_at'])

    def mark_delivered(self, channel: str):
        """Record successful delivery for a channel."""
        delivered = list(self.channels_delivered or [])
        if channel not in delivered:
            delivered.append(channel)
            self.channels_delivered = delivered
        requested = set(self.channels_requested or [])
        if requested and set(delivered) >= requested:
            self.delivery_status = 'delivered'
        self.save(update_fields=['channels_delivered', 'delivery_status'])

    def mark_failed(self, error: str):
        """Record a failed delivery attempt and schedule retry."""
        self.delivery_attempts += 1
        self.last_error = error
        if self.delivery_attempts < self.max_retries:
            # Exponential backoff: 30s, 120s, 480s, ...
            delay_seconds = 30 * (4 ** (self.delivery_attempts - 1))
            self.next_retry_at = timezone.now() + timezone.timedelta(seconds=delay_seconds)
            self.delivery_status = 'pending'
        else:
            self.delivery_status = 'failed'
            self.next_retry_at = None
        self.save(update_fields=[
            'delivery_attempts', 'last_error', 'next_retry_at', 'delivery_status',
        ])

    @staticmethod
    def compute_dedup_key(
        recipient_id, category: str, target_type: str, target_id: str,
    ) -> str:
        """Generate a deterministic dedup key for an alert."""
        raw = f'{recipient_id}:{category}:{target_type}:{target_id}'
        return hashlib.sha256(raw.encode()).hexdigest()[:32]

    @property
    def is_expired(self) -> bool:
        return self.expires_at and timezone.now() >= self.expires_at


class AlertPreference(models.Model):
    """
    Per-user opt-in/opt-out for a category × channel pair.

    By default every alert is delivered in-app.  Email delivery
    defaults OFF unless the user (or the system) creates a preference
    row with ``enabled=True`` for the ``email`` channel, **or** the
    caller passes ``email=True`` to ``send_alert()`` (force-send).

    Digest frequency can be set per-category to batch low-priority
    alerts into hourly/daily/weekly summaries.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='alert_preferences',
    )
    # "*" means "all categories" — a global toggle
    category = models.CharField(
        max_length=80,
        default='*',
        help_text='Category key or "*" for global',
    )
    channel = models.CharField(
        max_length=20,
        choices=CHANNEL_CHOICES,
        default='email',
    )
    enabled = models.BooleanField(default=True)

    # Digest batching — only meaningful for email channel
    digest_frequency = models.CharField(
        max_length=20,
        choices=DIGEST_FREQUENCY_CHOICES,
        default='realtime',
        help_text='How often to batch alerts (email only)',
    )

    # Quiet hours — suppress non-urgent alerts during these hours (UTC)
    quiet_hours_start = models.TimeField(
        null=True, blank=True,
        help_text='Start of quiet hours (UTC). Null = no quiet hours.',
    )
    quiet_hours_end = models.TimeField(
        null=True, blank=True,
        help_text='End of quiet hours (UTC). Null = no quiet hours.',
    )

    class Meta:
        unique_together = ('user', 'category', 'channel')

    def __str__(self):
        state = '✓' if self.enabled else '✗'
        return f'{self.user} | {self.category} | {self.channel} {state}'

    def is_in_quiet_hours(self) -> bool:
        """Check if current time falls within quiet hours."""
        if not self.quiet_hours_start or not self.quiet_hours_end:
            return False
        now = timezone.now().time()
        start, end = self.quiet_hours_start, self.quiet_hours_end
        if start <= end:
            return start <= now <= end
        # Wraps midnight (e.g., 22:00 → 06:00)
        return now >= start or now <= end


class WebhookEndpoint(models.Model):
    """
    A registered webhook URL for push notification delivery.

    Org-scoped: an organization admin registers webhook endpoints that
    receive POST payloads for matching alert categories.

    Supports HMAC-SHA256 signature verification via a shared secret.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Owner — the user who registered this webhook
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='webhook_endpoints',
    )

    name = models.CharField(max_length=200, help_text='Human label, e.g. "Slack #alerts"')
    url = models.URLField(max_length=500, help_text='HTTPS endpoint URL')

    # HMAC secret for payload signature verification
    secret = models.CharField(
        max_length=255,
        blank=True,
        default='',
        help_text='Shared secret for HMAC-SHA256 signature header (X-Webhook-Signature)',
    )

    # Category filter — empty list = all categories
    categories = models.JSONField(
        default=list,
        blank=True,
        help_text='List of category keys to subscribe to. Empty = all.',
    )

    # Headers to include in every request (e.g., Authorization)
    custom_headers = models.JSONField(
        default=dict,
        blank=True,
        help_text='Extra headers sent with each webhook POST',
    )

    is_active = models.BooleanField(default=True, db_index=True)

    # Reliability tracking
    consecutive_failures = models.PositiveIntegerField(default=0)
    last_success_at = models.DateTimeField(null=True, blank=True)
    last_failure_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True, default='')
    # Auto-disable after N consecutive failures
    auto_disable_threshold = models.PositiveIntegerField(
        default=10,
        help_text='Disable webhook after this many consecutive failures',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        status = '🟢' if self.is_active else '🔴'
        return f'{status} {self.name} → {self.url}'

    def matches_category(self, category: str) -> bool:
        """Check if this webhook should fire for the given category."""
        if not self.categories:
            return True  # empty = subscribe to all
        return category in self.categories

    def record_success(self):
        self.consecutive_failures = 0
        self.last_success_at = timezone.now()
        self.save(update_fields=['consecutive_failures', 'last_success_at'])

    def record_failure(self, error: str):
        self.consecutive_failures += 1
        self.last_failure_at = timezone.now()
        self.last_error = error
        if self.consecutive_failures >= self.auto_disable_threshold:
            self.is_active = False
        self.save(update_fields=[
            'consecutive_failures', 'last_failure_at', 'last_error', 'is_active',
        ])


class WebhookDelivery(models.Model):
    """
    Immutable log of every webhook delivery attempt.  Used for debugging
    and audit trail.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    endpoint = models.ForeignKey(
        WebhookEndpoint,
        on_delete=models.CASCADE,
        related_name='deliveries',
    )
    alert = models.ForeignKey(
        Alert,
        on_delete=models.CASCADE,
        related_name='webhook_deliveries',
    )

    # Request
    request_body = models.JSONField(default=dict)
    request_headers = models.JSONField(default=dict)

    # Response
    response_status = models.PositiveSmallIntegerField(null=True, blank=True)
    response_body = models.TextField(blank=True, default='')
    response_time_ms = models.PositiveIntegerField(null=True, blank=True)

    # Result
    success = models.BooleanField(default=False)
    error = models.TextField(blank=True, default='')
    attempt_number = models.PositiveSmallIntegerField(default=1)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['endpoint', '-created_at']),
            models.Index(fields=['alert', '-created_at']),
        ]

    def __str__(self):
        status = '✓' if self.success else '✗'
        return f'{status} {self.endpoint.name} — {self.alert.title}'


class NotificationDigest(models.Model):
    """
    Tracks digest batches.  A Celery beat task periodically collects
    unread alerts matching a user's digest preferences and sends a
    single summary email.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='notification_digests',
    )
    frequency = models.CharField(
        max_length=20,
        choices=DIGEST_FREQUENCY_CHOICES,
    )

    # Which alerts were included in this digest
    alert_ids = models.JSONField(
        default=list,
        help_text='List of Alert UUIDs included in this digest',
    )
    alert_count = models.PositiveIntegerField(default=0)

    # Period covered
    period_start = models.DateTimeField()
    period_end = models.DateTimeField()

    # Delivery
    email_sent = models.BooleanField(default=False)
    email_error = models.TextField(blank=True, default='')
    sent_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'frequency', '-created_at']),
        ]

    def __str__(self):
        return f'Digest({self.frequency}) for {self.user} — {self.alert_count} alerts'
