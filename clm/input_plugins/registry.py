"""
Plugin registry — static metadata about every input plugin.
==============================================================
Provides ``list_plugins()`` and ``get_plugin_info()`` for the API
endpoints, mirroring the ``clm/action_plugins/__init__.py`` pattern.

Every built-in plugin declares its metadata in this registry.
Third-party plugins can also register here via ``register_external()``.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# {name: {display_name, description, icon, category, hooks, settings_schema, ...}}
PLUGIN_REGISTRY: dict[str, dict[str, Any]] = {}


def _register(
    name: str,
    display_name: str,
    description: str,
    icon: str = '🔌',
    category: str = 'processing',
    hooks: list[str] | None = None,
    settings_schema: dict | None = None,
    default_enabled: bool = True,
    default_priority: int = 50,
    plugin_type: str = 'processing',
):
    """Register plugin metadata in the static registry.

    plugin_type:
        'processing'   — pipeline plugins (normalize, validate, dedup, enrich, logging).
                         These run in the document pipeline and are configured per-node
                         with enable/disable toggles.
        'integration'  — notification/integration plugins (webhook, gmail, slack, teams).
                         These are selectable as an input_type on the node (i.e., the node
                         receives notifications from the integration). Enable/disable is
                         managed at the org level in Settings, not per-node.
    """
    PLUGIN_REGISTRY[name] = {
        'name': name,
        'display_name': display_name,
        'description': description,
        'icon': icon,
        'category': category,
        'hooks': hooks or [],
        'settings_schema': settings_schema or {},
        'default_enabled': default_enabled,
        'default_priority': default_priority,
        'plugin_type': plugin_type,
    }


# ── Built-in plugin metadata ──────────────────────────────────────────

_register(
    name='normalize',
    display_name='Normalize Metadata',
    description='Trims whitespace, normalises field names to snake_case, coerces types (dates, numbers, booleans).',
    icon='🧹',
    category='transform',
    hooks=['on_transform'],
    default_enabled=True,
    default_priority=10,
    settings_schema={
        'lowercase_keys': {
            'type': 'boolean',
            'label': 'Lowercase field names',
            'default': True,
            'description': 'Convert all extracted field names to lowercase.',
        },
        'trim_values': {
            'type': 'boolean',
            'label': 'Trim whitespace',
            'default': True,
            'description': 'Strip leading/trailing whitespace from string values.',
        },
        'coerce_types': {
            'type': 'boolean',
            'label': 'Auto-detect types',
            'default': True,
            'description': 'Convert date strings, numbers, and booleans to proper types.',
        },
        'snake_case': {
            'type': 'boolean',
            'label': 'Snake-case keys',
            'default': False,
            'description': 'Convert field names from "Contract Value" to "contract_value".',
        },
    },
)

_register(
    name='validate',
    display_name='Field Validator',
    description='Validates extracted fields against required-fields rules, regex patterns, and value ranges.',
    icon='✅',
    category='validation',
    hooks=['on_validate'],
    default_enabled=True,
    default_priority=20,
    settings_schema={
        'required_fields': {
            'type': 'array',
            'label': 'Required fields',
            'default': [],
            'description': 'Field names that must be present and non-empty.',
            'items': {'type': 'string'},
        },
        'field_rules': {
            'type': 'object',
            'label': 'Field validation rules',
            'default': {},
            'description': 'Per-field rules: {"field_name": {"regex": "...", "min": N, "max": N, "type": "date|number|email"}}',
        },
        'fail_on_error': {
            'type': 'boolean',
            'label': 'Block on errors',
            'default': False,
            'description': 'Mark document as failed if any validation error is found.',
        },
    },
)

_register(
    name='dedup',
    display_name='Duplicate Detector',
    description='Detects duplicate documents by content hash, filename, or extracted field fingerprint.',
    icon='🔍',
    category='validation',
    hooks=['on_pre_ingest', 'on_post_extract'],
    default_enabled=True,
    default_priority=5,
    settings_schema={
        'strategy': {
            'type': 'select',
            'label': 'Dedup strategy',
            'default': 'content_hash',
            'options': ['content_hash', 'filename', 'field_fingerprint'],
            'description': 'How to detect duplicates.',
        },
        'fingerprint_fields': {
            'type': 'array',
            'label': 'Fingerprint fields',
            'default': [],
            'description': 'For field_fingerprint strategy — which extracted fields to hash.',
            'items': {'type': 'string'},
        },
        'action': {
            'type': 'select',
            'label': 'On duplicate',
            'default': 'warn',
            'options': ['warn', 'skip', 'replace'],
            'description': 'What to do when a duplicate is detected.',
        },
    },
)

_register(
    name='enrich',
    display_name='Auto-Enrich',
    description='Adds computed metadata: word count, page count, language detection, file fingerprint.',
    icon='✨',
    category='transform',
    hooks=['on_post_extract', 'on_transform'],
    default_enabled=True,
    default_priority=30,
    settings_schema={
        'word_count': {
            'type': 'boolean',
            'label': 'Add word count',
            'default': True,
            'description': 'Count words in extracted text and add _word_count field.',
        },
        'char_count': {
            'type': 'boolean',
            'label': 'Add character count',
            'default': False,
            'description': 'Count characters in extracted text.',
        },
        'detect_language': {
            'type': 'boolean',
            'label': 'Detect language',
            'default': False,
            'description': 'Detect the primary language of the document text.',
        },
        'file_fingerprint': {
            'type': 'boolean',
            'label': 'Add file fingerprint',
            'default': True,
            'description': 'SHA-256 hash of the file for provenance tracking.',
        },
    },
)

_register(
    name='webhook',
    display_name='Webhook Notifier',
    description='POSTs JSON payloads to configured URLs on document events (ready, error, batch complete).',
    icon='🔗',
    category='integration',
    hooks=['on_document_ready', 'on_error', 'on_batch_complete'],
    default_enabled=False,
    default_priority=90,
    plugin_type='integration',
    settings_schema={
        'urls': {
            'type': 'array',
            'label': 'Webhook URLs',
            'default': [],
            'description': 'List of URLs to POST events to.',
            'items': {'type': 'string'},
        },
        'events': {
            'type': 'array',
            'label': 'Events to fire',
            'default': ['on_document_ready'],
            'description': 'Which hooks trigger a webhook call.',
            'items': {
                'type': 'string',
                'enum': ['on_document_ready', 'on_error', 'on_batch_complete'],
            },
        },
        'include_metadata': {
            'type': 'boolean',
            'label': 'Include metadata',
            'default': True,
            'description': 'Include extracted_metadata in the webhook payload.',
        },
        'secret': {
            'type': 'string',
            'label': 'Signing secret',
            'default': '',
            'description': 'HMAC-SHA256 secret for webhook signature (X-Signature header).',
        },
    },
)

_register(
    name='gmail',
    display_name='Gmail Notifier',
    description='Sends email notifications via Gmail/SMTP when documents are processed, errors occur, or batches complete.',
    icon='📧',
    category='integration',
    hooks=['on_document_ready', 'on_error', 'on_batch_complete'],
    default_enabled=False,
    default_priority=91,
    plugin_type='integration',
    settings_schema={
        'recipients': {
            'type': 'array',
            'label': 'Recipient emails',
            'default': [],
            'description': 'Email addresses to send notifications to.',
            'items': {'type': 'string'},
        },
        'from_email': {
            'type': 'string',
            'label': 'From email',
            'default': '',
            'description': 'Sender address (leave empty to use system default).',
        },
        'events': {
            'type': 'array',
            'label': 'Events to notify',
            'default': ['on_document_ready'],
            'description': 'Which hooks trigger an email notification.',
            'items': {
                'type': 'string',
                'enum': ['on_document_ready', 'on_error', 'on_batch_complete'],
            },
        },
        'include_metadata': {
            'type': 'boolean',
            'label': 'Include metadata',
            'default': True,
            'description': 'Include extracted fields in the email body.',
        },
    },
)

_register(
    name='slack',
    display_name='Slack Notifier',
    description='Posts rich Block Kit messages to Slack channels via Incoming Webhooks on document events.',
    icon='💬',
    category='integration',
    hooks=['on_document_ready', 'on_error', 'on_batch_complete'],
    default_enabled=False,
    default_priority=92,
    plugin_type='integration',
    settings_schema={
        'webhook_url': {
            'type': 'string',
            'label': 'Webhook URL',
            'default': '',
            'description': 'Slack Incoming Webhook URL (https://hooks.slack.com/services/...).',
        },
        'extra_webhooks': {
            'type': 'array',
            'label': 'Additional webhook URLs',
            'default': [],
            'description': 'Extra Slack webhook URLs to also notify.',
            'items': {'type': 'string'},
        },
        'channel': {
            'type': 'string',
            'label': 'Channel name',
            'default': '',
            'description': 'Display-only channel name shown in the message footer.',
        },
        'events': {
            'type': 'array',
            'label': 'Events to fire',
            'default': ['on_document_ready'],
            'description': 'Which hooks trigger a Slack message.',
            'items': {
                'type': 'string',
                'enum': ['on_document_ready', 'on_error', 'on_batch_complete'],
            },
        },
        'include_metadata': {
            'type': 'boolean',
            'label': 'Include metadata',
            'default': True,
            'description': 'Include extracted fields in the Slack message.',
        },
    },
)

_register(
    name='teams',
    display_name='Teams Notifier',
    description='Posts Adaptive Card notifications to Microsoft Teams channels via Incoming Webhooks.',
    icon='🟦',
    category='integration',
    hooks=['on_document_ready', 'on_error', 'on_batch_complete'],
    default_enabled=False,
    default_priority=93,
    plugin_type='integration',
    settings_schema={
        'webhook_url': {
            'type': 'string',
            'label': 'Webhook URL',
            'default': '',
            'description': 'Teams Incoming Webhook URL.',
        },
        'extra_webhooks': {
            'type': 'array',
            'label': 'Additional webhook URLs',
            'default': [],
            'description': 'Extra Teams webhook URLs to also notify.',
            'items': {'type': 'string'},
        },
        'events': {
            'type': 'array',
            'label': 'Events to fire',
            'default': ['on_document_ready'],
            'description': 'Which hooks trigger a Teams notification.',
            'items': {
                'type': 'string',
                'enum': ['on_document_ready', 'on_error', 'on_batch_complete'],
            },
        },
        'include_metadata': {
            'type': 'boolean',
            'label': 'Include metadata',
            'default': True,
            'description': 'Include extracted fields in the Teams card.',
        },
    },
)

_register(
    name='logging',
    display_name='Event Logger',
    description='Structured logging for every pipeline hook — always enabled for observability.',
    icon='📋',
    category='monitoring',
    hooks=['on_pre_ingest', 'on_post_extract', 'on_validate', 'on_transform',
           'on_document_ready', 'on_batch_complete', 'on_error'],
    default_enabled=True,
    default_priority=99,
    settings_schema={
        'log_level': {
            'type': 'select',
            'label': 'Log level',
            'default': 'INFO',
            'options': ['DEBUG', 'INFO', 'WARNING'],
            'description': 'Minimum log level for plugin events.',
        },
    },
)


# ── Public API ─────────────────────────────────────────────────────────

def register_external(
    name: str,
    display_name: str,
    description: str,
    icon: str = '🔌',
    category: str = 'custom',
    hooks: list[str] | None = None,
    settings_schema: dict | None = None,
    default_enabled: bool = False,
    default_priority: int = 50,
    plugin_type: str = 'processing',
):
    """Register a third-party plugin's metadata for the API."""
    _register(
        name=name,
        display_name=display_name,
        description=description,
        icon=icon,
        category=category,
        hooks=hooks,
        settings_schema=settings_schema,
        default_enabled=default_enabled,
        default_priority=default_priority,
        plugin_type=plugin_type,
    )


def get_plugin_info(name: str) -> dict | None:
    """Get metadata for a single plugin by name."""
    return PLUGIN_REGISTRY.get(name)


def list_plugins() -> list[dict]:
    """List all registered plugins sorted by default_priority."""
    return sorted(
        PLUGIN_REGISTRY.values(),
        key=lambda p: p.get('default_priority', 50),
    )


def list_processing_plugins() -> list[dict]:
    """List only processing (pipeline) plugins — not integrations."""
    return sorted(
        (p for p in PLUGIN_REGISTRY.values() if p.get('plugin_type', 'processing') == 'processing'),
        key=lambda p: p.get('default_priority', 50),
    )


def list_integration_plugins() -> list[dict]:
    """List only integration plugins (webhook, gmail, slack, teams, etc.)."""
    return sorted(
        (p for p in PLUGIN_REGISTRY.values() if p.get('plugin_type') == 'integration'),
        key=lambda p: p.get('default_priority', 50),
    )


def get_all_plugin_metadata() -> dict:
    """Get the full registry dict (for serialization)."""
    return dict(PLUGIN_REGISTRY)
