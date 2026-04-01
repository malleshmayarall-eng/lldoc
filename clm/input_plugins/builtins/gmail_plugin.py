"""
Gmail Plugin — Sends email notifications on input node document events.
=========================================================================
Uses Django's configured email backend (``settings.EMAIL_BACKEND``),
which is already set up for Gmail SMTP via ``clm.email_backend``.

Fires on:
  - on_document_ready: Document fully processed
  - on_error: Pipeline error
  - on_batch_complete: All documents in batch done
"""
import logging

from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils.html import strip_tags

from ..hookspecs import clm_input_hookimpl

logger = logging.getLogger(__name__)


def _get_settings(node) -> dict:
    """Read Gmail plugin settings from the node config."""
    config = (node.config or {}).get('input_plugins', [])
    for p in config:
        if p.get('name') == 'gmail':
            if not p.get('enabled', False):
                return {}
            return p.get('settings', {})
    return {}


def _should_fire(plugin_settings: dict, hook_name: str) -> bool:
    events = plugin_settings.get('events', ['on_document_ready'])
    return hook_name in events


def _build_subject(event: str, context: dict) -> str:
    """Build a concise email subject line."""
    prefixes = {
        'on_document_ready': '✅ Document Ready',
        'on_error': '❌ Pipeline Error',
        'on_batch_complete': '📦 Batch Complete',
    }
    prefix = prefixes.get(event, 'CLM Notification')
    title = context.get('title', context.get('document_title', ''))
    if title:
        return f"[CLM] {prefix}: {title}"
    return f"[CLM] {prefix}"


def _build_html_body(event: str, context: dict) -> str:
    """Build a simple HTML email body."""
    rows = ''.join(
        f'<tr><td style="padding:4px 12px 4px 0;font-weight:600;color:#555;">'
        f'{k.replace("_", " ").title()}</td>'
        f'<td style="padding:4px 0;">{v}</td></tr>'
        for k, v in context.items()
        if k not in ('html_body',) and v not in (None, '', {})
    )
    colour = {'on_document_ready': '#22c55e', 'on_error': '#ef4444',
              'on_batch_complete': '#3b82f6'}.get(event, '#6b7280')
    return (
        f'<div style="font-family:Inter,Helvetica,Arial,sans-serif;max-width:600px;">'
        f'<div style="background:{colour};color:#fff;padding:12px 16px;'
        f'border-radius:8px 8px 0 0;font-size:14px;font-weight:600;">'
        f'{_build_subject(event, context)}</div>'
        f'<table style="width:100%;padding:16px;font-size:13px;">{rows}</table>'
        f'<div style="padding:8px 16px;font-size:11px;color:#999;">'
        f'Sent by CLM Input Plugin System</div></div>'
    )


def _send(plugin_settings: dict, event: str, context: dict):
    """Send the email notification. Best-effort, never raises."""
    recipients = plugin_settings.get('recipients', [])
    if not recipients:
        logger.debug("[input-gmail] No recipients configured, skipping.")
        return

    from_email = plugin_settings.get('from_email', '') or getattr(
        settings, 'DEFAULT_FROM_EMAIL', 'noreply@example.com'
    )
    subject = _build_subject(event, context)
    html_body = _build_html_body(event, context)
    plain_body = strip_tags(html_body)

    try:
        send_mail(
            subject=subject,
            message=plain_body,
            from_email=from_email,
            recipient_list=recipients,
            html_message=html_body,
            fail_silently=True,
        )
        logger.info(
            f"[input-gmail] {event} → {len(recipients)} recipient(s)"
        )
    except Exception as e:
        logger.warning(f"[input-gmail] {event} send failed: {e}")


def _doc_context(document) -> dict:
    """Build a context dict from a WorkflowDocument."""
    ctx = {
        'document_id': str(document.id),
        'title': document.title or '',
        'file_type': document.file_type or '',
        'extraction_status': document.extraction_status or '',
        'workflow_id': str(document.workflow_id),
    }
    meta = document.extracted_metadata or {}
    if meta:
        # Include up to 10 extracted fields
        for k, v in list(meta.items())[:10]:
            ctx[f"field_{k}"] = str(v)[:200]
    return ctx


class GmailPlugin:
    """Sends email notifications via Gmail/SMTP on input node events."""

    @clm_input_hookimpl
    def on_document_ready(self, node, document):
        s = _get_settings(node)
        if not s or not _should_fire(s, 'on_document_ready'):
            return
        _send(s, 'on_document_ready', {
            'node_id': str(node.id),
            **_doc_context(document),
        })

    @clm_input_hookimpl
    def on_error(self, node, document, error, stage):
        s = _get_settings(node)
        if not s or not _should_fire(s, 'on_error'):
            return
        ctx = {
            'node_id': str(node.id),
            'error': str(error),
            'stage': stage,
        }
        if document:
            ctx.update(_doc_context(document))
        _send(s, 'on_error', ctx)

    @clm_input_hookimpl
    def on_batch_complete(self, node, documents, stats):
        s = _get_settings(node)
        if not s or not _should_fire(s, 'on_batch_complete'):
            return
        _send(s, 'on_batch_complete', {
            'node_id': str(node.id),
            'workflow_id': str(node.workflow_id),
            'document_count': len(documents),
            'total_processed': stats.get('total', 0),
            'succeeded': stats.get('succeeded', 0),
            'failed': stats.get('failed', 0),
        })
