"""
Webhook Plugin — POST JSON payloads to configured URLs on email events.
========================================================================
The webhook URLs are read from the WorkflowNode's ``config``:

    node.config = {
        ...
        "email_webhooks": [
            "https://hooks.example.com/clm-email",
            "https://n8n.example.com/webhook/abc123",
        ],
    }

If ``email_webhooks`` is absent or empty, every hook is a silent no-op.
Failures are logged but never raised — plugins must not break the
core inbox flow.
"""
import json
import logging
from urllib.request import Request, urlopen

from ..hookspecs import clm_email_hookimpl

logger = logging.getLogger(__name__)

_TIMEOUT = 10  # seconds


def _post_webhook(urls: list, event: str, payload: dict):
    """Fire-and-forget POST to each URL.  Best-effort, never raises."""
    body = json.dumps({
        'event': event,
        **payload,
    }).encode('utf-8')

    for url in urls:
        try:
            req = Request(
                url,
                data=body,
                headers={'Content-Type': 'application/json'},
                method='POST',
            )
            with urlopen(req, timeout=_TIMEOUT) as resp:
                logger.debug(f"[webhook] {event} → {url} — {resp.status}")
        except Exception as e:
            logger.warning(f"[webhook] {event} → {url} FAILED: {e}")


def _get_urls(node) -> list:
    """Extract webhook URLs from node config, defaulting to []."""
    config = node.config if hasattr(node, 'config') else {}
    urls = (config or {}).get('email_webhooks', [])
    return [u for u in urls if isinstance(u, str) and u.startswith('http')]


class WebhookPlugin:
    """Fires JSON webhooks on email events."""

    @clm_email_hookimpl
    def on_email_received(self, node, message_id, subject, sender, email_date):
        urls = _get_urls(node)
        if not urls:
            return
        _post_webhook(urls, 'email.received', {
            'node_id': str(node.id),
            'workflow_id': str(node.workflow_id),
            'message_id': message_id,
            'subject': subject,
            'sender': sender,
            'email_date': email_date,
        })

    @clm_email_hookimpl
    def on_email_processed(self, node, document):
        urls = _get_urls(node)
        if not urls:
            return
        _post_webhook(urls, 'email.processed', {
            'node_id': str(node.id),
            'workflow_id': str(node.workflow_id),
            'document_id': str(document.id),
            'document_title': document.title,
            'extraction_status': document.extraction_status,
            'source_type': (document.extracted_metadata or {}).get('source_type', 'attachment'),
        })

    @clm_email_hookimpl
    def on_email_failed(self, node, message_id, error):
        urls = _get_urls(node)
        if not urls:
            return
        _post_webhook(urls, 'email.failed', {
            'node_id': str(node.id),
            'workflow_id': str(node.workflow_id),
            'message_id': message_id,
            'error': error,
        })

    @clm_email_hookimpl
    def on_inbox_checked(self, node, found, skipped, errors):
        urls = _get_urls(node)
        if not urls:
            return
        _post_webhook(urls, 'email.inbox_checked', {
            'node_id': str(node.id),
            'workflow_id': str(node.workflow_id),
            'found': found,
            'skipped': skipped,
            'errors': errors,
        })
