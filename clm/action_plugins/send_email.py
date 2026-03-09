"""
Send Email Plugin
==================
Sends an email per document with all extracted details.
Uses Django's SMTP backend — for-loop iteration handled by action_executor.

Required field: `email` — the recipient's email address.
All other extracted metadata is included in the email body as a summary.
"""
import logging
from datetime import datetime

from django.conf import settings as django_settings
from django.core.mail import EmailMessage

from .base import BaseActionPlugin, register_plugin

logger = logging.getLogger(__name__)


@register_plugin
class SendEmailPlugin(BaseActionPlugin):
    name = 'send_email'
    display_name = 'Send Email'
    description = (
        'Send an email for each document in the pipeline. '
        'The email includes all extracted data as a formatted summary. '
        'Required: email field in metadata. '
        'Uses {field_name} placeholders in subject/body templates.'
    )
    icon = '📧'
    category = 'communication'

    # --- Fields the for-loop extracts from each document's metadata ---
    required_fields = ['email']
    optional_fields = [
        'party_1_name', 'party_2_name', 'document_title',
        'contract_value', 'effective_date', 'expiration_date',
        'jurisdiction', 'governing_law', 'payment_terms',
        'confidentiality_clause', 'termination_clause',
    ]

    # --- Settings shown in the frontend ActionConfigPanel dropdown ---
    settings_schema = {
        'subject_template': {
            'type': 'string',
            'label': 'Subject Template',
            'default': 'Document Review: {document_title}',
            'placeholder': 'Use {field_name} for dynamic values',
            'required': False,
        },
        'body_template': {
            'type': 'textarea',
            'label': 'Email Body (before data summary)',
            'default': (
                'Hello{_greeting},\n\n'
                'This email is regarding the document "{document_title}".\n\n'
                'Below is a summary of all extracted information from the document. '
                'Please review the details and take any necessary action.\n'
            ),
            'placeholder': 'Use {field_name} for dynamic values. Data summary appended automatically.',
            'required': False,
        },
        'from_email': {
            'type': 'string',
            'label': 'From Email',
            'default': '',
            'placeholder': 'Leave empty to use system default',
            'required': False,
        },
        'cc': {
            'type': 'string',
            'label': 'CC (comma-separated)',
            'default': '',
            'placeholder': 'cc1@example.com, cc2@example.com',
            'required': False,
        },
        'include_data_summary': {
            'type': 'boolean',
            'label': 'Include extracted data summary in email',
            'default': True,
            'required': False,
        },
        'reply_to': {
            'type': 'string',
            'label': 'Reply-To address',
            'default': '',
            'placeholder': 'Leave empty to use from address',
            'required': False,
        },
    }

    def execute(self, data: dict, settings: dict) -> dict:
        """
        Send one email for one document.
        Called once per document by the action executor for-loop.

        Args:
            data:     dict of field -> value extracted from this document
            settings: plugin settings from the ActionConfigPanel
        Returns:
            dict with success, message, and delivery details
        """
        email = data.get('email')
        if not email:
            return {'success': False, 'message': 'No email address found in extracted data'}

        # --- Prepare greeting helper ---
        party_name = data.get('party_1_name') or data.get('party_2_name')
        data['_greeting'] = f' {party_name}' if party_name else ''

        # --- Subject ---
        subject_tpl = settings.get(
            'subject_template',
            self.settings_schema['subject_template']['default'],
        )
        subject = self.format_template(subject_tpl, data)

        # --- Body intro ---
        body_tpl = settings.get(
            'body_template',
            self.settings_schema['body_template']['default'],
        )
        body = self.format_template(body_tpl, data)

        # --- Data summary section ---
        include_summary = settings.get('include_data_summary', True)
        if include_summary:
            body += '\n' + self._build_data_summary(data)

        # --- Footer ---
        from_email = settings.get('from_email') or getattr(
            django_settings, 'DEFAULT_FROM_EMAIL', 'noreply@example.com'
        )
        body += (
            '\n---\n'
            f'Sent automatically by CLM Workflow System\n'
            f'From: {from_email}\n'
            f'Date: {datetime.now().strftime("%Y-%m-%d %H:%M")}\n'
        )

        try:
            recipient_list = [e.strip() for e in email.split(',') if e.strip()]

            cc_raw = settings.get('cc', '')
            cc_list = [c.strip() for c in cc_raw.split(',') if c.strip()] if cc_raw else []

            reply_to = settings.get('reply_to', '') or from_email

            msg = EmailMessage(
                subject=subject,
                body=body,
                from_email=from_email,
                to=recipient_list,
                cc=cc_list,
                reply_to=[reply_to],
            )
            msg.send(fail_silently=False)

            logger.info(f"Email sent to {email} -- subject: {subject}")
            return {
                'success': True,
                'message': f'Email sent to {email}',
                'recipient': email,
                'subject': subject,
                'cc': cc_list,
                'fields_included': len([
                    k for k, v in data.items()
                    if v and not k.startswith('_')
                ]),
            }
        except Exception as e:
            logger.error(f"Email send failed to {email}: {e}")
            return {
                'success': False,
                'message': f'Failed to send email: {str(e)}',
                'recipient': email,
                'error': str(e),
            }

    # ------------------------------------------------------------------
    def _build_data_summary(self, data: dict) -> str:
        """
        Build a text summary table of all extracted document data.
        Skips internal fields (prefixed with _) and null/empty values.
        """
        lines = [
            '=' * 50,
            '  EXTRACTED DOCUMENT DATA',
            '=' * 50,
        ]
        for key, val in sorted(data.items()):
            if key.startswith('_'):
                continue
            label = key.replace('_', ' ').title()
            display = str(val) if val and str(val).strip() else '(not found)'
            lines.append(f'  {label:.<35} {display}')
        lines.append('=' * 50)
        return '\n'.join(lines)
