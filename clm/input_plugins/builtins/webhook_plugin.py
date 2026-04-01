"""
Webhook Plugin — POSTs JSON payloads to configured URLs on input events.
=========================================================================
Fires webhooks on:
  - on_document_ready: Document fully processed
  - on_error: Pipeline error
  - on_batch_complete: All documents in batch done
"""
import hashlib
import hmac
import json
import logging
from urllib.request import Request, urlopen

from ..hookspecs import clm_input_hookimpl

logger = logging.getLogger(__name__)

_TIMEOUT = 10


def _get_settings(node) -> dict:
    config = (node.config or {}).get('input_plugins', [])
    for p in config:
        if p.get('name') == 'webhook':
            if not p.get('enabled', False):
                return {}
            return p.get('settings', {})
    return {}


def _post_webhook(urls: list, event: str, payload: dict, secret: str = ''):
    """Fire-and-forget POST to each URL.  Best-effort, never raises."""
    body = json.dumps({
        'event': event,
        'source': 'clm_input_plugin',
        **payload,
    }, default=str).encode('utf-8')

    headers = {'Content-Type': 'application/json'}
    if secret:
        sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        headers['X-Signature'] = sig

    for url in urls:
        try:
            req = Request(
                url, data=body, headers=headers, method='POST',
            )
            with urlopen(req, timeout=_TIMEOUT) as resp:
                logger.debug(f"[input-webhook] {event} → {url} — {resp.status}")
        except Exception as e:
            logger.warning(f"[input-webhook] {event} → {url} FAILED: {e}")


def _should_fire(settings: dict, hook_name: str) -> bool:
    events = settings.get('events', ['on_document_ready'])
    return hook_name in events


def _doc_payload(document, include_meta: bool = True) -> dict:
    """Build a JSON-safe document payload."""
    payload = {
        'document_id': str(document.id),
        'title': document.title or '',
        'file_type': document.file_type or '',
        'extraction_status': document.extraction_status or '',
        'workflow_id': str(document.workflow_id),
    }
    if include_meta:
        meta = document.extracted_metadata or {}
        # Limit metadata size
        payload['extracted_metadata'] = {
            k: str(v)[:500] for k, v in list(meta.items())[:50]
        }
    return payload


class WebhookPlugin:
    """Fires webhooks on input node document events."""

    @clm_input_hookimpl
    def on_document_ready(self, node, document):
        settings = _get_settings(node)
        if not settings or not _should_fire(settings, 'on_document_ready'):
            return
        urls = [u for u in settings.get('urls', []) if isinstance(u, str) and u.startswith('http')]
        if not urls:
            return
        _post_webhook(
            urls, 'input.document_ready',
            {
                'node_id': str(node.id),
                **_doc_payload(document, settings.get('include_metadata', True)),
            },
            settings.get('secret', ''),
        )

    @clm_input_hookimpl
    def on_error(self, node, document, error, stage):
        settings = _get_settings(node)
        if not settings or not _should_fire(settings, 'on_error'):
            return
        urls = [u for u in settings.get('urls', []) if isinstance(u, str) and u.startswith('http')]
        if not urls:
            return
        payload = {
            'node_id': str(node.id),
            'error': error,
            'stage': stage,
        }
        if document:
            payload.update(_doc_payload(document, False))
        _post_webhook(urls, 'input.error', payload, settings.get('secret', ''))

    @clm_input_hookimpl
    def on_batch_complete(self, node, documents, stats):
        settings = _get_settings(node)
        if not settings or not _should_fire(settings, 'on_batch_complete'):
            return
        urls = [u for u in settings.get('urls', []) if isinstance(u, str) and u.startswith('http')]
        if not urls:
            return
        _post_webhook(
            urls, 'input.batch_complete',
            {
                'node_id': str(node.id),
                'workflow_id': str(node.workflow_id),
                'stats': stats,
                'document_count': len(documents),
            },
            settings.get('secret', ''),
        )
