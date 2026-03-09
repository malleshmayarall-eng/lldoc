"""
communications/dispatch.py — The single entry-point for firing alerts
======================================================================

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
"""
from __future__ import annotations

import logging
from typing import Iterable

from django.contrib.auth import get_user_model

from .models import Alert, AlertPreference

logger = logging.getLogger('communications.dispatch')
User = get_user_model()


def _should_email(user, category: str, force: bool) -> bool:
    """
    Decide whether to send an email for this category.

    Priority:
      1. ``force=True`` in the call → always email
      2. Specific category preference for the user
      3. Wildcard ``*`` preference for the user
      4. Default → False (in-app only)
    """
    if force:
        return True

    # Check specific category preference
    pref = AlertPreference.objects.filter(
        user=user, category=category, channel='email',
    ).first()
    if pref is not None:
        return pref.enabled

    # Check wildcard
    wildcard = AlertPreference.objects.filter(
        user=user, category='*', channel='email',
    ).first()
    if wildcard is not None:
        return wildcard.enabled

    return False


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
) -> Alert:
    """
    Create an in-app alert and optionally send an email.

    Returns the created ``Alert`` instance.
    """
    alert = Alert.objects.create(
        recipient=recipient,
        actor=actor,
        category=category,
        priority=priority,
        title=title,
        message=message,
        target_type=target_type,
        target_id=str(target_id) if target_id else '',
        metadata=metadata or {},
        channels_delivered=['in_app'],
    )

    # Email delivery
    if _should_email(recipient, category, force=email):
        # Import here to avoid circular imports at module load time
        from .email import send_alert_email
        send_alert_email(alert)

    return alert


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
) -> list[Alert]:
    """
    Send the same alert to multiple recipients.

    Returns a list of ``Alert`` instances created.
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
            )
            alerts.append(alert)
        except Exception as exc:
            logger.error('Failed to send alert to %s: %s', user, exc)
    return alerts
