"""
CLM Action Plugins — Extensible Plugin System
===============================================
Each plugin is a Python class that receives document data
and performs an action (send email, WhatsApp, SMS, etc.).

Plugins self-register via the PLUGIN_REGISTRY dict.
The action executor loops over documents, extracts required fields,
and calls plugin.execute(data, settings) for each one.
"""
from .base import BaseActionPlugin, PLUGIN_REGISTRY  # noqa
from . import send_email  # noqa
from . import send_whatsapp  # noqa
from . import send_sms  # noqa
from . import webhook  # noqa


def get_plugin(name: str) -> BaseActionPlugin | None:
    """Get a plugin instance by name."""
    cls = PLUGIN_REGISTRY.get(name)
    return cls() if cls else None


def list_plugins() -> list[dict]:
    """List all registered plugins with their metadata."""
    result = []
    for name, cls in sorted(PLUGIN_REGISTRY.items()):
        instance = cls()
        result.append({
            'name': instance.name,
            'display_name': instance.display_name,
            'description': instance.description,
            'icon': instance.icon,
            'category': instance.category,
            'required_fields': instance.required_fields,
            'optional_fields': instance.optional_fields,
            'settings_schema': instance.settings_schema,
        })
    return result
