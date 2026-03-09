"""
Base Action Plugin — Abstract interface for all action plugins.
================================================================
All plugins inherit from BaseActionPlugin and register themselves
in PLUGIN_REGISTRY by calling register_plugin().
"""
import logging
from abc import ABC, abstractmethod
from typing import Any

logger = logging.getLogger(__name__)

# Global plugin registry: {"send_email": SendEmailPlugin, ...}
PLUGIN_REGISTRY: dict[str, type] = {}


def register_plugin(cls):
    """Decorator to register a plugin class."""
    instance = cls()
    PLUGIN_REGISTRY[instance.name] = cls
    logger.debug(f"Registered action plugin: {instance.name}")
    return cls


class BaseActionPlugin(ABC):
    """
    Abstract base class for all action plugins.

    Subclasses must define:
      - name: str              — machine name (send_email)
      - display_name: str      — human label ("Send Email")
      - description: str       — what this plugin does
      - icon: str              — emoji for frontend
      - category: str          — communication / notification / integration / export / custom
      - required_fields: list  — metadata field names needed (e.g., ["email"])
      - optional_fields: list  — nice-to-have fields
      - settings_schema: dict  — configurable parameters (templates, CC, etc.)
      - execute(data, settings) -> dict  — run the action for one document
    """

    name: str = ''
    display_name: str = ''
    description: str = ''
    icon: str = '⚡'
    category: str = 'communication'
    required_fields: list[str] = []
    optional_fields: list[str] = []
    settings_schema: dict = {}

    @abstractmethod
    def execute(self, data: dict, settings: dict) -> dict:
        """
        Execute the action for a single document.

        Args:
            data: dict of field_name → value extracted from the document.
                  Includes both global and workflow metadata fields.
                  Missing fields are set to None.
            settings: dict of plugin-specific settings from the action node config
                      (e.g., subject template, message body, from address).

        Returns:
            dict with at least:
              - success: bool
              - message: str (human-readable result summary)
              - Optionally: message_id, delivery_status, etc.
        """
        ...

    def validate_settings(self, settings: dict) -> list[str]:
        """
        Validate plugin settings. Returns list of error messages (empty = valid).
        Default: validates required settings from settings_schema.
        """
        errors = []
        for key, schema in self.settings_schema.items():
            if schema.get('required', False) and not settings.get(key):
                errors.append(f"Setting '{key}' is required.")
        return errors

    def format_template(self, template: str, data: dict) -> str:
        """
        Format a template string with document data.
        Uses {field_name} placeholders. Missing fields become "[unknown]".
        """
        try:
            safe_data = {k: (v if v else '[unknown]') for k, v in data.items()}
            return template.format(**safe_data)
        except (KeyError, IndexError, ValueError):
            # Fallback: simple string replacement
            result = template
            for key, val in data.items():
                result = result.replace(f'{{{key}}}', str(val) if val else '[unknown]')
            return result
