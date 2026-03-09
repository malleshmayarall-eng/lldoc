"""
Webhook Plugin
===============
Sends document data to an external webhook URL via HTTP POST.
Generic integration plugin for connecting to any external system
(Slack, Teams, Zapier, custom APIs, etc.).
"""
import logging

import requests

from .base import BaseActionPlugin, register_plugin

logger = logging.getLogger(__name__)


@register_plugin
class WebhookPlugin(BaseActionPlugin):
    name = 'webhook'
    display_name = 'Send Webhook'
    description = (
        'POST document data to an external webhook URL. '
        'Use this for Slack notifications, Zapier triggers, '
        'Microsoft Teams, or any custom API integration.'
    )
    icon = '🔗'
    category = 'integration'

    required_fields = []  # No specific fields required — sends all available data
    optional_fields = [
        'document_title', 'party_1_name', 'party_2_name',
        'email', 'phone_number', 'contract_value',
    ]

    settings_schema = {
        'webhook_url': {
            'type': 'string',
            'label': 'Webhook URL',
            'default': '',
            'placeholder': 'https://hooks.slack.com/... or https://hooks.zapier.com/...',
            'required': True,
        },
        'headers': {
            'type': 'textarea',
            'label': 'Custom Headers (JSON)',
            'default': '{}',
            'placeholder': '{"Authorization": "Bearer xxx"}',
            'required': False,
        },
        'payload_template': {
            'type': 'textarea',
            'label': 'Payload Template (JSON)',
            'default': '',
            'placeholder': 'Leave empty to send all data. Or use: {"text": "New doc: {document_title}"}',
            'required': False,
        },
        'method': {
            'type': 'select',
            'label': 'HTTP Method',
            'default': 'POST',
            'options': ['POST', 'PUT', 'PATCH'],
            'required': False,
        },
    }

    def execute(self, data: dict, settings: dict) -> dict:
        url = settings.get('webhook_url', '')
        if not url:
            return {'success': False, 'message': 'No webhook URL configured'}

        method = settings.get('method', 'POST').upper()

        # Parse custom headers
        custom_headers = {'Content-Type': 'application/json'}
        try:
            import json
            extra = json.loads(settings.get('headers', '{}') or '{}')
            custom_headers.update(extra)
        except (ValueError, TypeError):
            pass

        # Build payload
        payload_template = settings.get('payload_template', '')
        if payload_template:
            # User provided a template — format it
            try:
                import json
                formatted = self.format_template(payload_template, data)
                payload = json.loads(formatted)
            except (ValueError, TypeError):
                payload = {'text': self.format_template(payload_template, data)}
        else:
            # Send all data
            payload = {
                'event': 'document_action',
                'data': {k: v for k, v in data.items() if v is not None},
                'timestamp': __import__('datetime').datetime.utcnow().isoformat(),
            }

        try:
            resp = requests.request(
                method, url, json=payload,
                headers=custom_headers, timeout=30,
            )
            resp.raise_for_status()

            logger.info(f"Webhook sent to {url} — status {resp.status_code}")
            return {
                'success': True,
                'message': f'Webhook delivered ({resp.status_code})',
                'status_code': resp.status_code,
                'url': url,
            }
        except requests.RequestException as e:
            logger.error(f"Webhook failed to {url}: {e}")
            return {
                'success': False,
                'message': f'Webhook failed: {str(e)}',
                'url': url,
                'error': str(e),
            }
