"""
communications/dispatch.py — Production notification dispatch engine
=====================================================================

The **single entry-point** for firing notifications from any app.

Usage from **any** app::

    from communications.dispatch import send_alert

    send_alert(
        category='workflow.assigned',
        recipient=user,                # Django User instance
        title='New task assigned',
        message='Review the NDA draft by Friday.',
        actor=request.user,            # optional: who triggered it
        priority='high',               # low | normal | high | urgent
        target_type='workflow',        # optional: logical object type
        target_id=str(workflow.id),    # optional: object PK
        metadata={'action_url': f'/documents/{doc.id}'},
        email=True,                    # force email regardless of prefs
    )

    # Bulk — same alert to many users
    send_alert_bulk(
        category='document.shared',
        recipients=[user1, user2],
        title='Document shared with you',
        message='...',
    )

Production features:
  - Async delivery: email & webhook are dispatched via Celery tasks
  - Deduplication: prevents duplicate alerts within a configurable window
  - Rate limiting: per-user, per-category throttle
  - Multi-channel: in_app (sync), email (async), webhook (async)
  - Digest support: respects user's digest frequency preferences
  - WebSocket push: real-time notification to connected clients
  - Quiet hours: respects user's DND window for non-urgent alerts
"""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Iterable

from django.contrib.auth import get_user_model
from django.utils import timezone

from .models import Alert, AlertPreference, WebhookEndpoint

logger = logging.getLogger('communications.dispatch')
User = get_user_model()

# ─── Configuration ──────────────────────────────────────────────────

# Deduplication window: alerts with the same dedup_key within this
# window are suppressed.
DEDUP_WINDOW_SECONDS = 300  # 5 minutes

# Rate limit: max alerts per user per category within this window
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_PER_WINDOW = 20

# ─── Channel preference resolution ─────────────────────────────────


def _should_deliver(user, category: str, channel: str, force: bool = False) -> bool:
    """
    Decide whether to deliver via the given channel.

    Priority:
      1. ``force=True`` in the call → always deliver
      2. Specific category preference for the user
      3. Wildcard ``*`` preference for the user
      4. Default → in_app=True, email=False, webhook=False
    """
    if channel == 'in_app':
        return True  # Always deliver in-app

    if force:
        return True

    # Check specific category preference
    pref = AlertPreference.objects.filter(
        user=user, category=category, channel=channel,
    ).first()
    if pref is not None:
        # Check quiet hours for non-urgent
        if pref.is_in_quiet_hours():
            return False
        return pref.enabled

    # Check wildcard
    wildcard = AlertPreference.objects.filter(
        user=user, category='*', channel=channel,
    ).first()
    if wildcard is not None:
        if wildcard.is_in_quiet_hours():
            return False
        return wildcard.enabled

    return False


def _should_email(user, category: str, force: bool) -> bool:
    """Backward-compatible wrapper."""
    return _should_deliver(user, category, 'email', force)


def _get_digest_frequency(user, category: str) -> str:
    """
    Get the user's preferred digest frequency for this category.
    Returns 'realtime' if no digest preference is set.
    """
    pref = AlertPreference.objects.filter(
        user=user, category=category, channel='email',
    ).first()
    if pref and pref.digest_frequency != 'realtime':
        return pref.digest_frequency

    wildcard = AlertPreference.objects.filter(
        user=user, category='*', channel='email',
    ).first()
    if wildcard and wildcard.digest_frequency != 'realtime':
        return wildcard.digest_frequency

    return 'realtime'


# ─── Deduplication ──────────────────────────────────────────────────

def _is_duplicate(recipient, category: str, target_type: str, target_id: str) -> bool:
    """
    Check if an identical alert was sent recently (within DEDUP_WINDOW).
    Uses the computed dedup_key for O(1) lookups via index.
    """
    dedup_key = Alert.compute_dedup_key(
        recipient.id, category, target_type, target_id,
    )
    cutoff = timezone.now() - timedelta(seconds=DEDUP_WINDOW_SECONDS)
    return Alert.objects.filter(
        dedup_key=dedup_key,
        created_at__gte=cutoff,
    ).exists()


# ─── Rate limiting ──────────────────────────────────────────────────

def _is_rate_limited(recipient, category: str) -> bool:
    """
    Check if the user has exceeded the per-category rate limit.
    """
    cutoff = timezone.now() - timedelta(seconds=RATE_LIMIT_WINDOW_SECONDS)
    count = Alert.objects.filter(
        recipient=recipient,
        category=category,
        created_at__gte=cutoff,
    ).count()
    return count >= RATE_LIMIT_MAX_PER_WINDOW


# ─── Main dispatch function ─────────────────────────────────────────

def send_alert(
    category: str,
    recipient,
    title: str,
    message: str = '',
    *,
    actor=None,
    priority: str = 'normal',
    target_type: str = '',
    target_id: str = '',
    metadata: dict | None = None,
    email: bool = False,
    webhook: bool = False,
    group_key: str = '',
    deduplicate: bool = True,
    expires_in: timedelta | None = None,
    sync_email: bool = False,
) -> Alert | None:
    """
    Create an in-app alert and dispatch to async channels.

    Args:
        category: Dotted category key (e.g. 'workflow.assigned')
        recipient: Django User instance
        title: Alert title (max 300 chars)
        message: Alert body text
        actor: User who triggered the alert
        priority: low | normal | high | urgent
        target_type: Logical object type ('document', 'workflow', etc.)
        target_id: PK of the related object
        metadata: Arbitrary JSON data (action_url, etc.)
        email: Force email delivery regardless of prefs
        webhook: Force webhook delivery regardless of prefs
        group_key: Key for grouping related alerts in UI
        deduplicate: Enable deduplication (default True)
        expires_in: Auto-expire after this duration
        sync_email: Send email synchronously (for testing; default False)

    Returns:
        The created ``Alert`` instance, or ``None`` if suppressed by
        deduplication or rate limiting.
    """
    target_id_str = str(target_id) if target_id else ''

    # ── Deduplication check ──────────────────────────────────────────
    if deduplicate and target_type and target_id_str:
        if _is_duplicate(recipient, category, target_type, target_id_str):
            logger.debug(
                'Dedup suppressed: %s → %s for %s:%s',
                category, recipient, target_type, target_id_str,
            )
            return None

    # ── Rate limit check ─────────────────────────────────────────────
    if _is_rate_limited(recipient, category):
        logger.warning(
            'Rate limited: %s → %s (category=%s)',
            category, recipient, category,
        )
        return None

    # ── Determine channels ───────────────────────────────────────────
    channels_requested = ['in_app']

    should_email = _should_deliver(recipient, category, 'email', force=email)
    if should_email:
        channels_requested.append('email')

    should_webhook = _should_deliver(recipient, category, 'webhook', force=webhook)
    if should_webhook:
        channels_requested.append('webhook')

    # ── Compute keys ─────────────────────────────────────────────────
    dedup_key = ''
    if deduplicate and target_type and target_id_str:
        dedup_key = Alert.compute_dedup_key(
            recipient.id, category, target_type, target_id_str,
        )

    # ── Create the alert ─────────────────────────────────────────────
    alert = Alert.objects.create(
        recipient=recipient,
        actor=actor,
        category=category,
        priority=priority,
        title=title,
        message=message,
        target_type=target_type,
        target_id=target_id_str,
        metadata=metadata or {},
        dedup_key=dedup_key,
        group_key=group_key or f'{target_type}:{target_id_str}' if target_type else '',
        channels_requested=channels_requested,
        channels_delivered=['in_app'],
        delivery_status='delivered' if channels_requested == ['in_app'] else 'pending',
        expires_at=timezone.now() + expires_in if expires_in else None,
    )

    # ── Dispatch async channels ──────────────────────────────────────

    # Email
    if 'email' in channels_requested:
        digest_freq = _get_digest_frequency(recipient, category)
        if digest_freq == 'realtime':
            if sync_email:
                # Synchronous — used in tests or urgent transactional emails
                from .email import send_alert_email
                send_alert_email(alert)
            else:
                # Async via Celery
                from .tasks import deliver_email_async
                deliver_email_async.delay(str(alert.id))
        else:
            # Mark for digest — will be picked up by send_digest_emails task
            alert.delivery_status = 'digested'
            alert.save(update_fields=['delivery_status'])

    # Webhooks
    if 'webhook' in channels_requested:
        _dispatch_webhooks(alert)

    # Real-time WebSocket push (non-blocking, best-effort)
    _push_realtime(alert)

    return alert


def _dispatch_webhooks(alert: Alert):
    """Find matching webhook endpoints and queue delivery tasks."""
    from .tasks import deliver_webhook_async

    endpoints = WebhookEndpoint.objects.filter(
        user=alert.recipient,
        is_active=True,
    )
    for endpoint in endpoints:
        if endpoint.matches_category(alert.category):
            deliver_webhook_async.delay(str(alert.id), str(endpoint.id))


def _push_realtime(alert: Alert):
    """Queue a WebSocket push task (best-effort, non-blocking)."""
    try:
        from .tasks import push_realtime_notification
        push_realtime_notification.delay(str(alert.id))
    except Exception:
        # Never let WS push failure break the alert pipeline
        pass


# ─── Bulk dispatch ──────────────────────────────────────────────────

def send_alert_bulk(
    category: str,
    recipients: Iterable,
    title: str,
    message: str = '',
    *,
    actor=None,
    priority: str = 'normal',
    target_type: str = '',
    target_id: str = '',
    metadata: dict | None = None,
    email: bool = False,
    webhook: bool = False,
    group_key: str = '',
    deduplicate: bool = True,
) -> list[Alert]:
    """
    Send the same alert to multiple recipients.

    Returns a list of ``Alert`` instances created (excludes suppressed).
    """
    alerts = []
    for user in recipients:
        try:
            alert = send_alert(
                category=category,
                recipient=user,
                title=title,
                message=message,
                actor=actor,
                priority=priority,
                target_type=target_type,
                target_id=target_id,
                metadata=metadata,
                email=email,
                webhook=webhook,
                group_key=group_key,
                deduplicate=deduplicate,
            )
            if alert:
                alerts.append(alert)
        except Exception as exc:
            logger.error('Failed to send alert to %s: %s', user, exc)
    return alerts


# ─── Utility: notification stats ────────────────────────────────────

def get_notification_stats(user) -> dict:
    """
    Get notification statistics for a user.  Useful for dashboard widgets.
    """
    from django.db.models import Count, Q

    stats = Alert.objects.filter(recipient=user).aggregate(
        total=Count('id'),
        unread=Count('id', filter=Q(is_read=False, is_archived=False)),
        urgent_unread=Count('id', filter=Q(
            is_read=False, is_archived=False, priority='urgent',
        )),
        high_unread=Count('id', filter=Q(
            is_read=False, is_archived=False, priority='high',
        )),
    )

    # Category breakdown
    category_counts = (
        Alert.objects.filter(recipient=user, is_read=False, is_archived=False)
        .values('category')
        .annotate(count=Count('id'))
        .order_by('-count')[:10]
    )

    stats['by_category'] = {item['category']: item['count'] for item in category_counts}
    return stats

