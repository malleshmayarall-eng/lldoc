"""
communications/email.py — Email rendering & sending for alerts
===============================================================

Uses Django's built-in email framework (already configured with
Gmail SMTP via CertifiSMTPBackend in settings.py).

Two modes:
  1. Plain-text fallback
  2. Simple HTML template (inline styles, no external CSS)
"""
from __future__ import annotations

import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives

logger = logging.getLogger('communications.email')


# ─── Minimal HTML email template ────────────────────────────────────

_HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
        <!-- Header bar -->
        <tr>
          <td style="background:{header_color};padding:20px 28px;">
            <span style="color:#ffffff;font-size:13px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;">{category_label}</span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:28px;">
            <h2 style="margin:0 0 12px;font-size:18px;color:#1a1a2e;">{title}</h2>
            <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#4a4a68;">{message}</p>
            {action_block}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:16px 28px;background:#f9f9fb;border-top:1px solid #eee;">
            <p style="margin:0;font-size:11px;color:#999;">
              You received this because of your alert preferences.
              <br>To manage notifications, visit your account settings.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
""".strip()

_ACTION_BUTTON = """
<table cellpadding="0" cellspacing="0" style="margin-top:8px;">
  <tr>
    <td style="background:{btn_color};border-radius:6px;padding:10px 22px;">
      <a href="{url}" style="color:#fff;text-decoration:none;font-size:13px;font-weight:600;">{label}</a>
    </td>
  </tr>
</table>
"""

# Category → header colour mapping
_PRIORITY_COLORS = {
    'urgent': '#dc2626',
    'high': '#ea580c',
    'normal': '#2563eb',
    'low': '#6b7280',
}


def _build_html(alert) -> str:
    """Render a simple HTML email body from an Alert instance."""
    color = _PRIORITY_COLORS.get(alert.priority, '#2563eb')
    category_label = alert.category.replace('.', ' · ').title()

    # Optional action button from metadata
    action_url = alert.metadata.get('action_url', '')
    action_label = alert.metadata.get('action_label', 'View Details')
    action_block = ''
    if action_url:
        action_block = _ACTION_BUTTON.format(
            url=action_url,
            label=action_label,
            btn_color=color,
        )

    return _HTML_TEMPLATE.format(
        header_color=color,
        category_label=category_label,
        title=alert.title,
        message=alert.message or '(no additional details)',
        action_block=action_block,
    )


def send_alert_email(alert) -> bool:
    """
    Send an email for the given Alert instance.

    Returns True on success, False on failure (never raises).
    Errors are logged and stored on ``alert.email_error``.
    """
    recipient_email = _resolve_email(alert.recipient)
    if not recipient_email:
        msg = f'No email address for user {alert.recipient}'
        logger.warning(msg)
        alert.email_error = msg
        alert.save(update_fields=['email_error'])
        return False

    subject = f'[{alert.category.split(".")[-1].title()}] {alert.title}'
    text_body = f'{alert.title}\n\n{alert.message}'
    html_body = _build_html(alert)

    from_email = getattr(settings, 'DEFAULT_FROM_EMAIL', None)

    email = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=from_email,
        to=[recipient_email],
    )
    email.attach_alternative(html_body, 'text/html')

    try:
        email.send(fail_silently=False)
        alert.email_sent = True
        alert.email_error = ''
        if 'email' not in (alert.channels_delivered or []):
            delivered = list(alert.channels_delivered or [])
            delivered.append('email')
            alert.channels_delivered = delivered
        alert.save(update_fields=['email_sent', 'email_error', 'channels_delivered'])
        logger.info('Alert email sent to %s: %s', recipient_email, alert.title)
        return True
    except Exception as exc:
        error_msg = f'{type(exc).__name__}: {exc}'
        alert.email_error = error_msg
        alert.save(update_fields=['email_error'])
        logger.error('Failed to send alert email to %s: %s', recipient_email, error_msg)
        return False


def _resolve_email(user) -> str | None:
    """Get the best email address for a Django User."""
    email = getattr(user, 'email', None)
    if email:
        return email
    # Try profile if user_management is installed
    profile = getattr(user, 'profile', None)
    if profile:
        return getattr(profile, 'email', None) or getattr(profile, 'contact_email', None)
    return None
