"""
Notification system for sharing events.
=========================================

Routes all notifications through the centralized ``communications`` app
so every share event gets:
  1. An in-app alert (always, when recipient is a registered user)
  2. An email (if the user preference allows, or force=True)

Public API — unchanged from the original module::

    from sharing.notifications import (
        send_share_notification,
        send_invitation_reminder,
        send_invitation_accepted_notification,
        send_pending_reminders,
        send_expiring_soon_notifications,
    )
"""
from __future__ import annotations

import logging
from datetime import timedelta

from django.conf import settings
from django.contrib import messages
from django.core.mail import EmailMultiAlternatives
from django.utils import timezone

from communications.dispatch import send_alert

logger = logging.getLogger(__name__)


# ─── Configuration ──────────────────────────────────────────────────


def get_notification_config():
    """Get notification configuration from settings."""
    return getattr(settings, 'SHARING_NOTIFICATIONS', {
        'SEND_EMAIL': True,
        'SEND_SMS': False,
        'SEND_IN_APP': True,
        'REMINDER_DAYS': [3, 7, 14],
        'BASE_URL': 'http://localhost:3000',
    })


def _base_url():
    return get_notification_config().get('BASE_URL', 'http://localhost:3000')


def _share_link(share):
    base = _base_url()
    if share.share_type in ['email', 'phone']:
        return f"{base}/shared/{share.invitation_token}"
    return f"{base}/content/{share.content_type.model}/{share.object_id}"


# ─── Share created ──────────────────────────────────────────────────


def send_share_notification(share, request=None):
    """
    Send notification when content is shared.

    Creates a communications Alert (in-app + email) for the recipient.
    Falls back to direct email for external recipients with no Django user.
    """
    config = get_notification_config()
    success = False

    content_title = share.get_content_title()
    sharer_name = (
        share.shared_by.get_full_name() or share.shared_by.username
    ) if share.shared_by else 'Someone'
    link = _share_link(share)

    # ── Registered-user path → communications.send_alert ─────────
    if share.shared_with_user:
        try:
            send_alert(
                category='document.shared',
                recipient=share.shared_with_user,
                title=f'{sharer_name} shared "{content_title}" with you',
                message=share.invitation_message or f'You now have {share.get_role_display()} access.',
                actor=share.shared_by,
                priority='normal',
                target_type=share.content_type.model if share.content_type else 'document',
                target_id=str(share.object_id),
                metadata={
                    'share_id': str(share.id),
                    'action_url': link,
                    'action_label': 'View Now',
                    'role': share.get_role_display(),
                },
                email=config.get('SEND_EMAIL', True),
            )
            success = True
        except Exception as exc:
            logger.error('Failed to send share alert for %s: %s', share.id, exc)

    # ── External-email path (no User account) → direct email ─────
    elif share.invitation_email and config.get('SEND_EMAIL', True):
        try:
            success = _send_external_share_email(share, sharer_name, content_title, link)
        except Exception as exc:
            logger.error('Failed to send share email for %s: %s', share.id, exc)

    # ── SMS notification (unchanged) ──────────────────────────────
    if config.get('SEND_SMS') and share.invitation_phone:
        sms_sent = _send_share_sms(share, config)
        success = success or sms_sent

    # ── In-app Django message (for the sharer's current request) ──
    if config.get('SEND_IN_APP') and request and share.shared_with_user:
        messages.success(
            request,
            f"Content shared with {share.shared_with_user.username} successfully",
        )
        success = True

    return success


def _send_external_share_email(share, sharer_name, content_title, link):
    """
    Send a share email to an external recipient (no Django User account).

    Uses the communications HTML template for visual consistency.
    """
    from communications.email import _build_html
    from communications.models import Alert

    # Build a transient Alert-like object for template rendering
    alert = Alert(
        category='document.shared',
        priority='normal',
        title=f'{sharer_name} shared "{content_title}" with you',
        message=share.invitation_message or f'You have been invited with {share.get_role_display()} access.',
        metadata={
            'share_id': str(share.id),
            'action_url': link,
            'action_label': 'View Now',
            'role': share.get_role_display(),
        },
    )

    subject = f'[Shared] {sharer_name} shared "{content_title}" with you'
    text_body = f'{alert.title}\n\n{alert.message}'
    html_body = _build_html(alert)

    email_msg = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', None),
        to=[share.invitation_email],
    )
    email_msg.attach_alternative(html_body, 'text/html')
    email_msg.send(fail_silently=False)
    logger.info('Share email sent to %s for share %s', share.invitation_email, share.id)
    return True


def _send_share_sms(share, config):
    """Send SMS notification for new share."""
    try:
        # Check Twilio configuration
        account_sid = getattr(settings, 'TWILIO_ACCOUNT_SID', None)
        auth_token = getattr(settings, 'TWILIO_AUTH_TOKEN', None)
        from_number = getattr(settings, 'TWILIO_PHONE_NUMBER', None)
        
        if not all([account_sid, auth_token, from_number]):
            logger.warning("Twilio not configured, skipping SMS")
            return False
        
        # Import Twilio client
        try:
            from twilio.rest import Client
        except ImportError:
            logger.error("Twilio library not installed. Run: pip install twilio")
            return False
        
        # Get share info
        content_title = share.get_content_title()
        sharer_name = share.shared_by.get_full_name() if share.shared_by else "Someone"
        base_url = config.get('BASE_URL', 'http://localhost:3000')
        share_link = f"{base_url}/shared/{share.invitation_token}"
        
        # Compose message (SMS has 160 character limit)
        message = f"{sharer_name} shared '{content_title}' with you. View: {share_link}"
        
        # Send SMS
        client = Client(account_sid, auth_token)
        client.messages.create(
            body=message,
            from_=from_number,
            to=share.invitation_phone
        )
        
        logger.info(f"Share notification SMS sent to {share.invitation_phone} for share {share.id}")
        return True
        
    except Exception as e:
        logger.error(f"Failed to send share SMS for share {share.id}: {str(e)}")
        return False


# ─── Invitation reminder ───────────────────────────────────────────


def send_invitation_reminder(share):
    """Send reminder for unaccepted invitation."""
    if share.invitation_accepted:
        logger.warning('Share %s already accepted, skipping reminder', share.id)
        return False

    if share.is_expired():
        logger.warning('Share %s expired, skipping reminder', share.id)
        return False

    if not share.invitation_email:
        logger.warning('Share %s has no email for reminder', share.id)
        return False

    content_title = share.get_content_title()
    sharer_name = (
        share.shared_by.get_full_name() or share.shared_by.username
    ) if share.shared_by else 'Someone'
    days_ago = (timezone.now() - share.shared_at).days
    link = _share_link(share)

    # Registered user → send_alert
    if share.shared_with_user:
        try:
            send_alert(
                category='document.shared',
                recipient=share.shared_with_user,
                title=f'Reminder: "{content_title}" shared with you {days_ago} days ago',
                message=f'{sharer_name} shared this with you. You haven\'t accessed it yet.',
                actor=share.shared_by,
                target_type='share',
                target_id=str(share.id),
                metadata={'action_url': link, 'action_label': 'View Now'},
                email=True,
            )
            logger.info('Reminder alert sent for share %s', share.id)
            return True
        except Exception as exc:
            logger.error('Failed to send reminder alert for %s: %s', share.id, exc)
            return False

    # External email recipient → direct email via communications template
    try:
        _send_external_email(
            to_email=share.invitation_email,
            category='document.shared',
            title=f'Reminder: "{content_title}" shared with you',
            message=(
                f'{sharer_name} shared "{content_title}" with you {days_ago} days ago. '
                f'You haven\'t accessed it yet.'
            ),
            action_url=link,
            action_label='View Now',
        )
        logger.info('Reminder email sent for share %s', share.id)
        return True
    except Exception as exc:
        logger.error('Failed to send reminder email for %s: %s', share.id, exc)
        return False


# ─── Invitation accepted ───────────────────────────────────────────


def send_invitation_accepted_notification(share):
    """Notify sharer when external invitation is accepted."""
    if not share.shared_by:
        logger.warning('Share %s has no sharer for acceptance notification', share.id)
        return False

    recipient_label = share.invitation_email or share.invitation_phone or 'Someone'
    content_title = share.get_content_title()

    try:
        send_alert(
            category='document.shared',
            recipient=share.shared_by,
            title=f'{recipient_label} accepted your invitation',
            message=f'{recipient_label} now has {share.get_role_display()} access to "{content_title}".',
            target_type='share',
            target_id=str(share.id),
            metadata={
                'accepted_by': recipient_label,
                'role': share.get_role_display(),
            },
            email=True,
        )
        logger.info('Acceptance notification sent to %s for share %s', share.shared_by, share.id)
        return True
    except Exception as exc:
        logger.error('Failed to send acceptance notification for %s: %s', share.id, exc)
        return False


# ─── Batch operations ──────────────────────────────────────────────


def send_pending_reminders():
    """Send reminders for all pending invitations (scheduled task)."""
    from .models import Share

    config = get_notification_config()
    reminder_days = config.get('REMINDER_DAYS', [3, 7, 14])
    stats = {'checked': 0, 'sent': 0, 'failed': 0, 'skipped': 0}

    pending = Share.objects.filter(
        share_type__in=['email', 'phone'],
        invitation_accepted=False,
        is_active=True,
    )
    for share in pending:
        stats['checked'] += 1
        if share.is_expired():
            stats['skipped'] += 1
            continue
        days = (timezone.now() - share.shared_at).days
        if days in reminder_days:
            if send_invitation_reminder(share):
                stats['sent'] += 1
            else:
                stats['failed'] += 1
        else:
            stats['skipped'] += 1

    logger.info('Reminder batch: %s', stats)
    return stats


def send_expiring_soon_notifications():
    """Notify users about shares expiring within 24 hours (scheduled task)."""
    from .models import Share

    tomorrow = timezone.now() + timedelta(days=1)
    today = timezone.now()
    stats = {'checked': 0, 'sent': 0, 'failed': 0}

    expiring = Share.objects.filter(
        expires_at__gte=today,
        expires_at__lte=tomorrow,
        is_active=True,
    )
    for share in expiring:
        stats['checked'] += 1
        content_title = share.get_content_title()
        expiry = share.expires_at.strftime('%B %d, %Y at %I:%M %p')

        if share.shared_with_user:
            try:
                send_alert(
                    category='document.shared',
                    recipient=share.shared_with_user,
                    title=f'Access expiring soon: "{content_title}"',
                    message=f'Your access expires on {expiry}. Contact the owner for continued access.',
                    priority='high',
                    target_type='share',
                    target_id=str(share.id),
                    email=True,
                )
                stats['sent'] += 1
            except Exception:
                stats['failed'] += 1
        elif share.invitation_email:
            try:
                _send_external_email(
                    to_email=share.invitation_email,
                    category='document.shared',
                    title=f'Access expiring soon: "{content_title}"',
                    message=f'Your access to "{content_title}" expires on {expiry}. Contact the owner for continued access.',
                    priority='high',
                )
                stats['sent'] += 1
            except Exception:
                stats['failed'] += 1
        else:
            stats['failed'] += 1

    logger.info('Expiring notification batch: %s', stats)
    return stats


# ─── Helpers ────────────────────────────────────────────────────────


def _send_external_email(*, to_email, category, title, message,
                         action_url=None, action_label='View Details',
                         priority='normal'):
    """
    Send an email to an external address (no Django User) using the
    communications HTML template for visual consistency.
    """
    from communications.email import _build_html
    from communications.models import Alert

    alert = Alert(
        category=category,
        priority=priority,
        title=title,
        message=message,
        metadata={
            'action_url': action_url or '',
            'action_label': action_label,
        },
    )
    subject = f'[{category.split(".")[-1].title()}] {title}'
    text_body = f'{title}\n\n{message}'
    html_body = _build_html(alert)

    email_msg = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', None),
        to=[to_email],
    )
    email_msg.attach_alternative(html_body, 'text/html')
    email_msg.send(fail_silently=False)
