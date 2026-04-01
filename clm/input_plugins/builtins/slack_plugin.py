"""
Slack Plugin — Posts rich Slack messages on input node document events.
=======================================================================
Uses Slack Incoming Webhooks (no SDK needed — plain HTTP POST with
Block Kit JSON).

Fires on:
  - on_document_ready: Document fully processed
  - on_error: Pipeline error
  - on_batch_complete: All documents in batch done
"""
import json
import logging
from urllib.request import Request, urlopen

from ..hookspecs import clm_input_hookimpl

logger = logging.getLogger(__name__)

_TIMEOUT = 10


def _get_settings(node) -> dict:
    """Read Slack plugin settings from the node config."""
    config = (node.config or {}).get('input_plugins', [])
    for p in config:
        if p.get('name') == 'slack':
            if not p.get('enabled', False):
                return {}
            return p.get('settings', {})
    return {}


def _should_fire(plugin_settings: dict, hook_name: str) -> bool:
    events = plugin_settings.get('events', ['on_document_ready'])
    return hook_name in events


def _post_slack(webhook_url: str, blocks: list, text: str = ''):
    """POST a message to a single Slack webhook. Best-effort."""
    payload = json.dumps({
        'text': text or 'CLM Input Plugin Notification',
        'blocks': blocks,
    }).encode('utf-8')

    req = Request(
        webhook_url,
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urlopen(req, timeout=_TIMEOUT) as resp:
            logger.debug(f"[input-slack] → {resp.status}")
    except Exception as e:
        logger.warning(f"[input-slack] POST failed: {e}")


def _send_to_all(plugin_settings: dict, blocks: list, text: str = ''):
    """Send to every configured webhook URL."""
    webhook_url = plugin_settings.get('webhook_url', '')
    if webhook_url:
        _post_slack(webhook_url, blocks, text)
    for extra in plugin_settings.get('extra_webhooks', []):
        if isinstance(extra, str) and extra.startswith('http'):
            _post_slack(extra, blocks, text)


# ── Block Kit builders ─────────────────────────────────────────────────

def _header_block(text: str) -> dict:
    return {'type': 'header', 'text': {'type': 'plain_text', 'text': text[:150], 'emoji': True}}


def _section_block(markdown: str) -> dict:
    return {'type': 'section', 'text': {'type': 'mrkdwn', 'text': markdown[:3000]}}


def _fields_block(fields: dict) -> dict:
    items = [
        {'type': 'mrkdwn', 'text': f"*{k.replace('_', ' ').title()}*\n{v}"}
        for k, v in list(fields.items())[:10]
        if v not in (None, '', {})
    ]
    return {'type': 'section', 'fields': items[:10]}


def _divider() -> dict:
    return {'type': 'divider'}


def _context_block(text: str) -> dict:
    return {
        'type': 'context',
        'elements': [{'type': 'mrkdwn', 'text': text}],
    }


def _doc_fields(document) -> dict:
    """Common document fields for Slack display."""
    return {
        'Document': document.title or str(document.id)[:8],
        'File Type': document.file_type or '—',
        'Status': document.extraction_status or '—',
    }


class SlackPlugin:
    """Posts notifications to Slack via Incoming Webhooks."""

    @clm_input_hookimpl
    def on_document_ready(self, node, document):
        s = _get_settings(node)
        if not s or not _should_fire(s, 'on_document_ready'):
            return

        channel = s.get('channel', '')
        channel_note = f"  •  #{channel}" if channel else ''

        blocks = [
            _header_block('✅ Document Ready'),
            _fields_block(_doc_fields(document)),
            _divider(),
            _context_block(
                f"CLM Input Plugin  •  Node `{node.label or node.id}`{channel_note}"
            ),
        ]

        if s.get('include_metadata', True):
            meta = document.extracted_metadata or {}
            if meta:
                excerpt = {k: str(v)[:120] for k, v in list(meta.items())[:6]}
                blocks.insert(2, _section_block('*Extracted Fields*'))
                blocks.insert(3, _fields_block(excerpt))

        _send_to_all(s, blocks, f"✅ Document ready: {document.title or document.id}")

    @clm_input_hookimpl
    def on_error(self, node, document, error, stage):
        s = _get_settings(node)
        if not s or not _should_fire(s, 'on_error'):
            return

        fields = {'Error': str(error)[:200], 'Stage': stage}
        if document:
            fields.update(_doc_fields(document))

        blocks = [
            _header_block('❌ Pipeline Error'),
            _fields_block(fields),
            _divider(),
            _context_block(f"CLM Input Plugin  •  Node `{node.label or node.id}`"),
        ]
        _send_to_all(s, blocks, f"❌ Error in {stage}: {str(error)[:100]}")

    @clm_input_hookimpl
    def on_batch_complete(self, node, documents, stats):
        s = _get_settings(node)
        if not s or not _should_fire(s, 'on_batch_complete'):
            return

        total = stats.get('total', len(documents))
        succeeded = stats.get('succeeded', 0)
        failed = stats.get('failed', 0)

        blocks = [
            _header_block('📦 Batch Complete'),
            _fields_block({
                'Total': str(total),
                'Succeeded': str(succeeded),
                'Failed': str(failed),
            }),
            _divider(),
            _context_block(
                f"CLM Input Plugin  •  Node `{node.label or node.id}`  •  "
                f"Workflow `{node.workflow_id}`"
            ),
        ]
        _send_to_all(s, blocks, f"📦 Batch complete: {total} documents")
