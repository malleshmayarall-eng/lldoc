"""
communications/tasks.py — Celery tasks for production notification delivery
=============================================================================

Tasks:
  1. ``deliver_email_async``        — send one email for an Alert
  2. ``deliver_webhook_async``      — POST to one WebhookEndpoint for an Alert
  3. ``retry_failed_deliveries``    — periodic: retry alerts with pending retries
  4. ``send_digest_emails``         — periodic: compile & send digest summaries
  5. ``cleanup_expired_alerts``     — periodic: delete expired / old read alerts
  6. ``push_realtime_notification`` — push alert payload to WebSocket layer

All tasks use ``shared_task`` so Celery auto-discovers them via the
``communications`` app label.

Start worker:
    celery -A drafter worker -l info
    celery -A drafter beat -l info
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger('communications.tasks')


# ─── 1. Async email delivery ────────────────────────────────────────

@shared_task(
    name='communications.tasks.deliver_email_async',
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    acks_late=True,
)
def deliver_email_async(self, alert_id: str):
    """
    Send an email for the given Alert.  Called from ``send_alert()``
    when the email channel is enabled.

    Uses Celery's built-in retry with exponential backoff on failure.
    """
    from .models import Alert
    from .email import send_alert_email

    try:
        alert = Alert.objects.get(id=alert_id)
    except Alert.DoesNotExist:
        logger.warning('deliver_email_async: Alert %s not found, skipping', alert_id)
        return

    if alert.email_sent:
        logger.info('deliver_email_async: Alert %s already emailed, skipping', alert_id)
        return

    try:
        success = send_alert_email(alert)
        if success:
            alert.mark_delivered('email')
            logger.info('Email sent for alert %s', alert_id)
        else:
            raise RuntimeError(f'send_alert_email returned False: {alert.email_error}')
    except Exception as exc:
        alert.mark_failed(f'Email: {exc}')
        logger.error('Email delivery failed for alert %s: %s', alert_id, exc)
        # Celery-level retry (separate from our model-level retry tracking)
        raise self.retry(exc=exc, countdown=30 * (2 ** self.request.retries))


# ─── 2. Async webhook delivery ──────────────────────────────────────

@shared_task(
    name='communications.tasks.deliver_webhook_async',
    bind=True,
    max_retries=3,
    default_retry_delay=10,
    acks_late=True,
)
def deliver_webhook_async(self, alert_id: str, endpoint_id: str):
    """
    POST an Alert payload to a registered WebhookEndpoint.

    Payload includes:
      - Alert data (category, title, message, metadata, etc.)
      - HMAC-SHA256 signature in ``X-Webhook-Signature`` header
      - Delivery attempt number
    """
    import requests as http_requests

    from .models import Alert, WebhookEndpoint, WebhookDelivery

    try:
        alert = Alert.objects.get(id=alert_id)
        endpoint = WebhookEndpoint.objects.get(id=endpoint_id)
    except (Alert.DoesNotExist, WebhookEndpoint.DoesNotExist) as exc:
        logger.warning('deliver_webhook_async: %s', exc)
        return

    if not endpoint.is_active:
        logger.info('Webhook %s is disabled, skipping', endpoint.name)
        return

    # Build payload
    payload = {
        'event': 'alert.created',
        'alert': {
            'id': str(alert.id),
            'category': alert.category,
            'priority': alert.priority,
            'title': alert.title,
            'message': alert.message,
            'target_type': alert.target_type,
            'target_id': alert.target_id,
            'metadata': alert.metadata,
            'created_at': alert.created_at.isoformat() if alert.created_at else None,
        },
        'recipient': {
            'id': alert.recipient_id,
            'username': alert.recipient.username if hasattr(alert.recipient, 'username') else '',
        },
        'timestamp': timezone.now().isoformat(),
        'attempt': self.request.retries + 1,
    }

    body = json.dumps(payload, default=str)

    # Build headers with HMAC signature
    headers = {
        'Content-Type': 'application/json',
        'X-Webhook-Event': 'alert.created',
        'X-Webhook-Delivery': str(uuid.uuid4()) if False else str(alert.id),
    }

    if endpoint.secret:
        signature = hmac.new(
            endpoint.secret.encode(),
            body.encode(),
            hashlib.sha256,
        ).hexdigest()
        headers['X-Webhook-Signature'] = f'sha256={signature}'

    # Merge custom headers
    if endpoint.custom_headers:
        headers.update(endpoint.custom_headers)

    # Execute request with timeout
    delivery = WebhookDelivery(
        endpoint=endpoint,
        alert=alert,
        request_body=payload,
        request_headers={k: v for k, v in headers.items() if k != 'Authorization'},
        attempt_number=self.request.retries + 1,
    )

    start = time.monotonic()
    try:
        resp = http_requests.post(
            endpoint.url,
            data=body,
            headers=headers,
            timeout=10,
        )
        elapsed_ms = int((time.monotonic() - start) * 1000)

        delivery.response_status = resp.status_code
        delivery.response_body = resp.text[:2000]  # Truncate large responses
        delivery.response_time_ms = elapsed_ms

        if 200 <= resp.status_code < 300:
            delivery.success = True
            delivery.save()
            endpoint.record_success()
            alert.mark_delivered('webhook')
            logger.info(
                'Webhook delivered: %s → %s (%dms)',
                endpoint.name, alert.title, elapsed_ms,
            )
        else:
            error = f'HTTP {resp.status_code}: {resp.text[:200]}'
            delivery.error = error
            delivery.save()
            endpoint.record_failure(error)
            raise RuntimeError(error)

    except http_requests.RequestException as exc:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        error = f'{type(exc).__name__}: {exc}'
        delivery.error = error
        delivery.response_time_ms = elapsed_ms
        delivery.save()
        endpoint.record_failure(error)
        logger.error('Webhook failed: %s → %s: %s', endpoint.name, alert.title, error)
        raise self.retry(exc=exc, countdown=10 * (2 ** self.request.retries))
    except RuntimeError as exc:
        logger.error('Webhook non-2xx: %s → %s: %s', endpoint.name, alert.title, exc)
        raise self.retry(exc=exc, countdown=10 * (2 ** self.request.retries))


# ─── 3. Retry failed deliveries (periodic) ──────────────────────────

@shared_task(name='communications.tasks.retry_failed_deliveries')
def retry_failed_deliveries():
    """
    Periodic task: find alerts with ``delivery_status='pending'`` and
    ``next_retry_at <= now``, then re-dispatch their failed channels.

    Runs every 60s via Celery Beat.
    """
    from .models import Alert

    now = timezone.now()
    pending = Alert.objects.filter(
        delivery_status='pending',
        next_retry_at__isnull=False,
        next_retry_at__lte=now,
        delivery_attempts__gt=0,   # Only retry things that actually failed
    ).select_related('recipient')[:50]  # Batch limit

    count = 0
    for alert in pending:
        requested = set(alert.channels_requested or [])
        delivered = set(alert.channels_delivered or [])
        failed_channels = requested - delivered - {'in_app'}

        for channel in failed_channels:
            if channel == 'email' and not alert.email_sent:
                deliver_email_async.delay(str(alert.id))
                count += 1
            elif channel == 'webhook':
                # Re-dispatch to all matching webhooks
                from .models import WebhookEndpoint
                endpoints = WebhookEndpoint.objects.filter(
                    user=alert.recipient,
                    is_active=True,
                )
                for ep in endpoints:
                    if ep.matches_category(alert.category):
                        deliver_webhook_async.delay(str(alert.id), str(ep.id))
                        count += 1

    if count:
        logger.info('retry_failed_deliveries: re-dispatched %d delivery tasks', count)


# ─── 4. Digest email compilation (periodic) ─────────────────────────

@shared_task(name='communications.tasks.send_digest_emails')
def send_digest_emails(frequency: str = 'daily'):
    """
    Compile and send digest emails for users with the given frequency.

    Collects unread alerts created since the last digest and sends a
    single summary email.

    frequency: 'hourly' | 'daily' | 'weekly'
    """
    from django.contrib.auth import get_user_model
    from .models import Alert, AlertPreference, NotificationDigest

    User = get_user_model()

    # Determine the lookback period
    now = timezone.now()
    period_map = {
        'hourly': timezone.timedelta(hours=1),
        'daily': timezone.timedelta(days=1),
        'weekly': timezone.timedelta(weeks=1),
    }
    delta = period_map.get(frequency, timezone.timedelta(days=1))
    period_start = now - delta

    # Find users who have at least one digest preference for this frequency
    user_ids = AlertPreference.objects.filter(
        channel='email',
        enabled=True,
        digest_frequency=frequency,
    ).values_list('user_id', flat=True).distinct()

    for user_id in user_ids:
        user = User.objects.filter(id=user_id).first()
        if not user:
            continue

        # Get digest categories for this user
        digest_categories = list(
            AlertPreference.objects.filter(
                user=user,
                channel='email',
                enabled=True,
                digest_frequency=frequency,
            ).values_list('category', flat=True)
        )

        # Build alert query
        alerts_qs = Alert.objects.filter(
            recipient=user,
            created_at__gte=period_start,
            created_at__lt=now,
            is_read=False,
        )

        if '*' not in digest_categories:
            alerts_qs = alerts_qs.filter(category__in=digest_categories)

        alerts = list(alerts_qs.order_by('-created_at')[:50])
        if not alerts:
            continue

        # Create digest record
        digest = NotificationDigest.objects.create(
            user=user,
            frequency=frequency,
            alert_ids=[str(a.id) for a in alerts],
            alert_count=len(alerts),
            period_start=period_start,
            period_end=now,
        )

        # Send digest email
        try:
            from .email import send_digest_email
            success = send_digest_email(user, alerts, digest)
            if success:
                digest.email_sent = True
                digest.sent_at = timezone.now()
                digest.save(update_fields=['email_sent', 'sent_at'])
                logger.info('Digest (%s) sent to %s: %d alerts', frequency, user, len(alerts))
            else:
                digest.email_error = 'send_digest_email returned False'
                digest.save(update_fields=['email_error'])
        except Exception as exc:
            digest.email_error = str(exc)
            digest.save(update_fields=['email_error'])
            logger.error('Digest send failed for %s: %s', user, exc)


# ─── 5. Cleanup expired & old alerts (periodic) ─────────────────────

@shared_task(name='communications.tasks.cleanup_expired_alerts')
def cleanup_expired_alerts():
    """
    Periodic cleanup:
      1. Delete alerts past their ``expires_at`` TTL
      2. Delete read+archived alerts older than 90 days
      3. Delete webhook delivery logs older than 30 days
      4. Prune digest records older than 90 days
    """
    from .models import Alert, WebhookDelivery, NotificationDigest

    now = timezone.now()

    # 1. Expired alerts
    expired_count, _ = Alert.objects.filter(
        expires_at__isnull=False,
        expires_at__lte=now,
    ).delete()

    # 2. Old read+archived alerts (90 days)
    cutoff_90 = now - timezone.timedelta(days=90)
    old_count, _ = Alert.objects.filter(
        is_read=True,
        is_archived=True,
        created_at__lt=cutoff_90,
    ).delete()

    # 3. Old webhook delivery logs (30 days)
    cutoff_30 = now - timezone.timedelta(days=30)
    webhook_count, _ = WebhookDelivery.objects.filter(
        created_at__lt=cutoff_30,
    ).delete()

    # 4. Old digest records (90 days)
    digest_count, _ = NotificationDigest.objects.filter(
        created_at__lt=cutoff_90,
    ).delete()

    total = expired_count + old_count + webhook_count + digest_count
    if total:
        logger.info(
            'cleanup_expired_alerts: expired=%d, old_archived=%d, '
            'webhook_logs=%d, digests=%d',
            expired_count, old_count, webhook_count, digest_count,
        )


# ─── 6. Real-time WebSocket push ────────────────────────────────────

@shared_task(name='communications.tasks.push_realtime_notification')
def push_realtime_notification(alert_id: str):
    """
    Push an alert payload to the user's WebSocket channel group.

    Uses Django Channels' channel layer to send to
    ``notifications_<user_id>``.

    Falls back silently if Channels is not configured (channel layer
    not available).
    """
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
    except ImportError:
        # Django Channels not installed — skip silently
        return

    from .models import Alert

    try:
        alert = Alert.objects.select_related('recipient', 'actor').get(id=alert_id)
    except Alert.DoesNotExist:
        return

    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    group_name = f'notifications_{alert.recipient_id}'

    payload = {
        'type': 'notification.send',
        'data': {
            'id': str(alert.id),
            'category': alert.category,
            'priority': alert.priority,
            'title': alert.title,
            'message': alert.message,
            'target_type': alert.target_type,
            'target_id': alert.target_id,
            'metadata': alert.metadata,
            'group_key': alert.group_key,
            'actor': {
                'id': alert.actor_id,
                'name': (
                    alert.actor.get_full_name() or alert.actor.username
                ) if alert.actor else None,
            } if alert.actor else None,
            'is_read': alert.is_read,
            'created_at': alert.created_at.isoformat() if alert.created_at else None,
        },
    }

    try:
        async_to_sync(channel_layer.group_send)(group_name, payload)
        logger.debug('WebSocket push to %s for alert %s', group_name, alert_id)
    except Exception as exc:
        # Non-critical — don't fail the whole pipeline for WS issues
        logger.warning('WebSocket push failed for alert %s: %s', alert_id, exc)
