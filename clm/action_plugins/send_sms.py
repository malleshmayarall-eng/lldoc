"""
Send SMS Plugin
================
Sends an SMS to the phone number found in document metadata.
Uses a configurable API provider (Twilio, Vonage, custom webhook).
"""
import logging

import requests

from .base import BaseActionPlugin, register_plugin

logger = logging.getLogger(__name__)


@register_plugin
class SendSMSPlugin(BaseActionPlugin):
    name = 'send_sms'
    display_name = 'Send SMS'
    description = (
        'Send an SMS to the phone number found in document metadata. '
        'Supports configurable message templates. '
        'Requires an SMS API endpoint (Twilio, Vonage, etc.).'
    )
    icon = '📱'
    category = 'communication'

    required_fields = ['phone_number']
    optional_fields = [
        'party_1_name', 'document_title', 'contract_value',
    ]

    settings_schema = {
        'message_template': {
            'type': 'textarea',
            'label': 'SMS Message Template',
            'default': 'Re: {document_title} — Please review. Contact: {party_1_name}',
            'placeholder': 'Use {field_name} for dynamic values (160 char limit recommended)',
            'required': False,
        },
        'api_url': {
            'type': 'string',
            'label': 'SMS API URL',
            'default': '',
            'placeholder': 'https://api.twilio.com/... or custom endpoint',
            'required': False,
        },
        'api_key': {
            'type': 'password',
            'label': 'API Key / Auth Token',
            'default': '',
            'required': False,
        },
        'from_number': {
            'type': 'string',
            'label': 'From Number',
            'default': '',
            'placeholder': '+1234567890',
            'required': False,
        },
    }

    def execute(self, data: dict, settings: dict) -> dict:
        phone = data.get('phone_number')
        if not phone:
            return {'success': False, 'message': 'No phone number found'}

        phone = str(phone).strip().replace(' ', '').replace('-', '')
        if not phone.startswith('+'):
            phone = f'+{phone}'

        message_template = settings.get(
            'message_template',
            self.settings_schema['message_template']['default'],
        )
        message = self.format_template(message_template, data)

        api_url = settings.get('api_url', '')
        api_key = settings.get('api_key', '')

        if not api_url:
            logger.info(f"[SIMULATION] SMS to {phone}: {message[:100]}...")
            return {
                'success': True,
                'message': f'SMS queued for {phone} (simulation — configure API URL to send)',
                'recipient': phone,
                'simulated': True,
                'message_preview': message[:160],
            }

        try:
            headers = {'Content-Type': 'application/json'}
            if api_key:
                headers['Authorization'] = f'Bearer {api_key}'

            payload = {
                'to': phone,
                'from': settings.get('from_number', ''),
                'body': message,
            }

            resp = requests.post(api_url, json=payload, headers=headers, timeout=30)
            resp.raise_for_status()
            response_data = resp.json() if resp.headers.get('content-type', '').startswith('application/json') else {}

            logger.info(f"SMS sent to {phone}")
            return {
                'success': True,
                'message': f'SMS sent to {phone}',
                'recipient': phone,
                'message_id': response_data.get('sid') or response_data.get('message_id', ''),
            }
        except requests.RequestException as e:
            logger.error(f"SMS send failed to {phone}: {e}")
            return {
                'success': False,
                'message': f'SMS send failed: {str(e)}',
                'recipient': phone,
                'error': str(e),
            }
