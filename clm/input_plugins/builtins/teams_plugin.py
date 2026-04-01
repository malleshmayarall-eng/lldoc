"""
Microsoft Teams Plugin — Posts Adaptive Cards to MS Teams channels.
====================================================================
Uses Teams Incoming Webhook connectors (plain HTTP POST with
Adaptive Card JSON — no SDK needed).

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
    """Read Teams plugin settings from the node config."""
    config = (node.config or {}).get('input_plugins', [])
    for p in config:
        if p.get('name') == 'teams':
            if not p.get('enabled', False):
                return {}
            return p.get('settings', {})
    return {}


def _should_fire(plugin_settings: dict, hook_name: str) -> bool:
    events = plugin_settings.get('events', ['on_document_ready'])
    return hook_name in events


def _post_teams(webhook_url: str, card: dict):
    """POST an Adaptive Card to a Teams webhook. Best-effort."""
    # Teams Incoming Webhook expects the Adaptive Card wrapped in
    # an attachments array with contentType "application/vnd.microsoft.card.adaptive".
    payload = json.dumps({
        'type': 'message',
        'attachments': [{
            'contentType': 'application/vnd.microsoft.card.adaptive',
            'contentUrl': None,
            'content': card,
        }],
    }).encode('utf-8')

    req = Request(
        webhook_url,
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urlopen(req, timeout=_TIMEOUT) as resp:
            logger.debug(f"[input-teams] → {resp.status}")
    except Exception as e:
        logger.warning(f"[input-teams] POST failed: {e}")


def _send_to_all(plugin_settings: dict, card: dict):
    """Send to every configured webhook URL."""
    webhook_url = plugin_settings.get('webhook_url', '')
    if webhook_url:
        _post_teams(webhook_url, card)
    for extra in plugin_settings.get('extra_webhooks', []):
        if isinstance(extra, str) and extra.startswith('http'):
            _post_teams(extra, card)


# ── Adaptive Card builders ─────────────────────────────────────────────

def _fact_set(facts: dict) -> dict:
    """Build an Adaptive Card FactSet element."""
    return {
        'type': 'FactSet',
        'facts': [
            {'title': k.replace('_', ' ').title(), 'value': str(v)[:200]}
            for k, v in facts.items()
            if v not in (None, '', {})
        ][:10],
    }


def _text_block(text: str, weight: str = 'Default', size: str = 'Default',
                color: str = 'Default', wrap: bool = True) -> dict:
    return {
        'type': 'TextBlock',
        'text': text[:300],
        'weight': weight,
        'size': size,
        'color': color,
        'wrap': wrap,
    }


def _build_card(title: str, colour: str, body_elements: list) -> dict:
    """Build a full Adaptive Card v1.4 payload."""
    return {
        '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
        'type': 'AdaptiveCard',
        'version': '1.4',
        'msteams': {'width': 'Full'},
        'body': [
            {
                'type': 'Container',
                'style': colour,
                'items': [
                    _text_block(title, weight='Bolder', size='Medium'),
                ],
            },
            {
                'type': 'Container',
                'items': body_elements,
            },
            {
                'type': 'Container',
                'items': [
                    _text_block(
                        'Sent by CLM Input Plugin System',
                        size='Small', color='Light',
                    ),
                ],
            },
        ],
    }


def _doc_facts(document) -> dict:
    """Common document facts for Teams display."""
    return {
        'Document': document.title or str(document.id)[:8],
        'File Type': document.file_type or '—',
        'Status': document.extraction_status or '—',
    }


class TeamsPlugin:
    """Posts Adaptive Card notifications to Microsoft Teams channels."""

    @clm_input_hookimpl
    def on_document_ready(self, node, document):
        s = _get_settings(node)
        if not s or not _should_fire(s, 'on_document_ready'):
            return

        elements = [_fact_set(_doc_facts(document))]

        if s.get('include_metadata', True):
            meta = document.extracted_metadata or {}
            if meta:
                excerpt = {k: str(v)[:120] for k, v in list(meta.items())[:6]}
                elements.append(
                    _text_block('**Extracted Fields**', weight='Bolder', size='Small')
                )
                elements.append(_fact_set(excerpt))

        card = _build_card('✅ Document Ready', 'good', elements)
        _send_to_all(s, card)

    @clm_input_hookimpl
    def on_error(self, node, document, error, stage):
        s = _get_settings(node)
        if not s or not _should_fire(s, 'on_error'):
            return

        facts = {'Error': str(error)[:200], 'Stage': stage}
        if document:
            facts.update(_doc_facts(document))

        card = _build_card('❌ Pipeline Error', 'attention', [_fact_set(facts)])
        _send_to_all(s, card)

    @clm_input_hookimpl
    def on_batch_complete(self, node, documents, stats):
        s = _get_settings(node)
        if not s or not _should_fire(s, 'on_batch_complete'):
            return

        total = stats.get('total', len(documents))
        succeeded = stats.get('succeeded', 0)
        failed = stats.get('failed', 0)

        facts = {
            'Total Documents': str(total),
            'Succeeded': str(succeeded),
            'Failed': str(failed),
            'Workflow': str(node.workflow_id),
            'Node': node.label or str(node.id)[:8],
        }

        card = _build_card('📦 Batch Complete', 'accent', [_fact_set(facts)])
        _send_to_all(s, card)
