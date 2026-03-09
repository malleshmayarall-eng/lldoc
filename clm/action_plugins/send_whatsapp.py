"""
Send WhatsApp Plugin
=====================
Sends a WhatsApp message using a configurable API provider.
Supports Twilio, WhatsApp Business API, or any custom webhook.

Note: Requires API credentials to be configured in Django settings
or passed via plugin settings.
"""
import logging

import requests

from .base import BaseActionPlugin, register_plugin

logger = logging.getLogger(__name__)


@register_plugin
class SendWhatsAppPlugin(BaseActionPlugin):
    name = 'send_whatsapp'
    display_name = 'Send WhatsApp'
    description = (
        'Send a WhatsApp message to the phone number found in document metadata. '
        'Supports configurable message templates with {field_name} placeholders. '
        'Requires a WhatsApp Business API endpoint or Twilio credentials.'
    )
    icon = '💬'
    category = 'communication'

    required_fields = ['phone_number']
    optional_fields = [
        'party_1_name', 'party_2_name', 'document_title',
        'contract_value', 'email',
    ]

    settings_schema = {
        'message_template': {
            'type': 'textarea',
            'label': 'Message Template',
            'default': (
                'Hello {party_1_name},\n'
                'This is regarding: {document_title}.\n'
                'Please review at your convenience.'
            ),
            'placeholder': 'Use {field_name} for dynamic values',
            'required': False,
        },
        'api_url': {
            'type': 'string',
            'label': 'WhatsApp API URL',
            'default': '',
            'placeholder': 'https://api.twilio.com/... or custom webhook URL',
            'required': False,
        },
        'api_key': {
            'type': 'password',
            'label': 'API Key / Auth Token',
            'default': '',
            'placeholder': 'Your API authentication token',
            'required': False,
        },
        'from_number': {
            'type': 'string',
            'label': 'From Number',
            'default': '',
            'placeholder': '+1234567890 (WhatsApp-enabled number)',
            'required': False,
        },
    }

    def execute(self, data: dict, settings: dict) -> dict:
        phone = data.get('phone_number')
        if not phone:
            return {'success': False, 'message': 'No phone number found'}

        # Clean phone number
        phone = str(phone).strip().replace(' ', '').replace('-', '')
        if not phone.startswith('+'):
            phone = f'+{phone}'

        # Build message from template
        message_template = settings.get(
            'message_template',
            self.settings_schema['message_template']['default'],
        )
        message = self.format_template(message_template, data)

        api_url = settings.get('api_url', '')
        api_key = settings.get('api_key', '')

        if not api_url:
            # Simulation mode — log the message but don't actually send
            logger.info(
                f"[SIMULATION] WhatsApp to {phone}: {message[:100]}..."
            )
            return {
                'success': True,
                'message': f'WhatsApp message queued for {phone} (simulation mode — configure API URL to send)',
                'recipient': phone,
                'simulated': True,
                'message_preview': message[:200],
            }

        try:
            # Generic webhook POST (works with Twilio, MessageBird, custom APIs)
            headers = {
                'Content-Type': 'application/json',
            }
            if api_key:
                headers['Authorization'] = f'Bearer {api_key}'

            payload = {
                'to': phone,
                'from': settings.get('from_number', ''),
                'body': message,
                'type': 'text',
            }

            resp = requests.post(api_url, json=payload, headers=headers, timeout=30)
            resp.raise_for_status()
            response_data = resp.json() if resp.headers.get('content-type', '').startswith('application/json') else {}

            logger.info(f"WhatsApp sent to {phone}")
            return {
                'success': True,
                'message': f'WhatsApp sent to {phone}',
                'recipient': phone,
                'message_id': response_data.get('sid') or response_data.get('message_id', ''),
                'api_response': response_data,
            }
        except requests.RequestException as e:
            logger.error(f"WhatsApp send failed to {phone}: {e}")
            return {
                'success': False,
                'message': f'WhatsApp send failed: {str(e)}',
                'recipient': phone,
                'error': str(e),
            }
