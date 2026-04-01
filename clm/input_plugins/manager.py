"""
Plugin manager — singleton factory for the CLM input PluginManager.
=====================================================================
``get_plugin_manager()`` returns a lazily-initialised, cached instance
that has:

1. The hook specifications registered.
2. All built-in plugins loaded.
3. Any third-party plugins discovered via the ``clm_input``
   setuptools entry-point group.

Thread-safe: uses a double-checked lock around first init.
"""
import logging
import threading

import pluggy

from .hookspecs import PROJECT_NAME, InputHookSpec

logger = logging.getLogger(__name__)

_pm: pluggy.PluginManager | None = None
_lock = threading.Lock()


def get_plugin_manager() -> pluggy.PluginManager:
    """Return the global (cached) CLM input PluginManager."""
    global _pm
    if _pm is not None:
        return _pm

    with _lock:
        if _pm is not None:
            return _pm

        pm = pluggy.PluginManager(PROJECT_NAME)
        pm.add_hookspecs(InputHookSpec)

        # Register built-in plugins
        _register_builtins(pm)

        # Discover third-party plugins via entry points
        # (e.g., ``[project.entry-points.clm_input]`` in pyproject.toml)
        try:
            pm.load_setuptools_entrypoints(PROJECT_NAME)
        except Exception as e:
            logger.debug(f"Entry-point discovery skipped: {e}")

        _pm = pm
        return _pm


def _register_builtins(pm: pluggy.PluginManager):
    """Register the built-in plugins shipped with CLM."""

    _builtins = [
        ('clm_input_normalize', '.builtins.normalize_plugin', 'NormalizePlugin'),
        ('clm_input_validate', '.builtins.validate_plugin', 'ValidatePlugin'),
        ('clm_input_dedup', '.builtins.dedup_plugin', 'DedupPlugin'),
        ('clm_input_enrich', '.builtins.enrich_plugin', 'EnrichPlugin'),
        ('clm_input_webhook', '.builtins.webhook_plugin', 'WebhookPlugin'),
        ('clm_input_gmail', '.builtins.gmail_plugin', 'GmailPlugin'),
        ('clm_input_slack', '.builtins.slack_plugin', 'SlackPlugin'),
        ('clm_input_teams', '.builtins.teams_plugin', 'TeamsPlugin'),
        ('clm_input_logging', '.builtins.logging_plugin', 'LoggingPlugin'),
    ]

    for reg_name, module_path, class_name in _builtins:
        try:
            import importlib
            mod = importlib.import_module(module_path, package=__package__)
            cls = getattr(mod, class_name)
            pm.register(cls(), name=reg_name)
            logger.debug(f"Registered input plugin: {reg_name}")
        except Exception as e:
            logger.debug(f"Input plugin {reg_name} registration skipped: {e}")


def reset_plugin_manager():
    """Reset the cached manager (useful for tests)."""
    global _pm
    with _lock:
        _pm = None


def register_plugin(pm: pluggy.PluginManager | None, plugin_instance, name: str):
    """
    Register a plugin instance at runtime.
    If ``pm`` is None, the global manager is used.
    """
    mgr = pm or get_plugin_manager()
    if mgr.is_registered(plugin_instance):
        return
    mgr.register(plugin_instance, name=name)
    logger.info(f"Runtime registered input plugin: {name}")


def unregister_plugin(pm: pluggy.PluginManager | None, name: str):
    """Unregister a plugin by name at runtime."""
    mgr = pm or get_plugin_manager()
    plugin = mgr.get_plugin(name)
    if plugin:
        mgr.unregister(plugin, name=name)
        logger.info(f"Runtime unregistered input plugin: {name}")
