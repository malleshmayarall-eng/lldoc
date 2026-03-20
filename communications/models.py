"""
communications/models.py — Unified alert system
=================================================

Two models:
  • Alert           — every alert ever fired (in-app + optionally emailed)
  • AlertPreference — per-user opt-in/opt-out for categories × channels
"""
from __future__ import annotations

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
    # Workflows
    ('workflow.assigned', 'Workflow Assigned'),
    ('workflow.reassigned', 'Workflow Reassigned'),
    ('workflow.status_changed', 'Workflow Status Changed'),
    ('workflow.approval_request', 'Approval Requested'),
    ('workflow.approved', 'Workflow Approved'),
    ('workflow.rejected', 'Workflow Rejected'),
    ('workflow.due_date', 'Due Date Reminder'),
    ('workflow.decision', 'Decision Step Update'),
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
    # Viewer
    ('viewer.invitation_sent', 'Viewer Invitation Sent'),
    ('viewer.document_shared', 'Document Shared via Viewer'),
    ('viewer.new_comment', 'Viewer Comment'),
    ('viewer.approval_submitted', 'Viewer Approval Submitted'),
    # System
    ('system.info', 'System Info'),
    ('system.warning', 'System Warning'),
    ('system.error', 'System Error'),
]

PRIORITY_CHOICES = [
    ('low', 'Low'),
    ('normal', 'Normal'),
    ('high', 'High'),
    ('urgent', 'Urgent'),
]

CHANNEL_CHOICES = [
    ('in_app', 'In-App'),
    ('email', 'Email'),
]


class Alert(models.Model):
    """
    A single alert instance.  Created via ``send_alert()`` — see
    ``alerts/dispatch.py``.

    Every alert is stored for in-app display.  If the category is
    configured for email delivery (via AlertPreference or the
    ``email=True`` kwarg), an email is also sent at creation time.
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

    # ── Delivery tracking ────────────────────────────────────────────
    channels_delivered = models.JSONField(
        default=list,
        blank=True,
        help_text='List of channels that successfully delivered: ["in_app","email"]',
    )
    email_sent = models.BooleanField(default=False)
    email_error = models.TextField(blank=True, default='')

    # ── Read state ───────────────────────────────────────────────────
    is_read = models.BooleanField(default=False, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)

    # ── Timestamps ───────────────────────────────────────────────────
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['recipient', 'is_read', '-created_at']),
            models.Index(fields=['recipient', 'category']),
            models.Index(fields=['target_type', 'target_id']),
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


class AlertPreference(models.Model):
    """
    Per-user opt-in/opt-out for a category × channel pair.

    By default every alert is delivered in-app.  Email delivery
    defaults OFF unless the user (or the system) creates a preference
    row with ``enabled=True`` for the ``email`` channel, **or** the
    caller passes ``email=True`` to ``send_alert()`` (force-send).
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

    class Meta:
        unique_together = ('user', 'category', 'channel')

    def __str__(self):
        state = '✓' if self.enabled else '✗'
        return f'{self.user} | {self.category} | {self.channel} {state}'
