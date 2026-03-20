"""
Plugin manager — singleton factory for the CLM email PluginManager.
====================================================================
``get_plugin_manager()`` returns a lazily-initialised, cached instance
that has:

1. The hook specifications registered.
2. All built-in plugins loaded.
3. Any third-party plugins discovered via the ``clm_email``
   setuptools entry-point group.
"""
import logging
import threading

import pluggy

from .hookspecs import PROJECT_NAME, EmailHookSpec

logger = logging.getLogger(__name__)

_pm = None
_lock = threading.Lock()


def get_plugin_manager() -> pluggy.PluginManager:
    """Return the global (cached) CLM email PluginManager."""
    global _pm
    if _pm is not None:
        return _pm

    with _lock:
        # Double-check after acquiring lock
        if _pm is not None:
            return _pm

        pm = pluggy.PluginManager(PROJECT_NAME)
        pm.add_hookspecs(EmailHookSpec)

        # Register built-in plugins
        _register_builtins(pm)

        # Discover third-party plugins via entry points
        try:
            pm.load_setuptools_entrypoints(PROJECT_NAME)
        except Exception as e:
            logger.debug(f"Entry-point discovery skipped: {e}")

        _pm = pm
        return _pm


def _register_builtins(pm: pluggy.PluginManager):
    """Register the built-in plugins shipped with CLM."""
    try:
        from .builtins.webhook_plugin import WebhookPlugin
        pm.register(WebhookPlugin(), name='clm_email_webhook')
    except Exception as e:
        logger.debug(f"Webhook plugin registration skipped: {e}")

    try:
        from .builtins.logging_plugin import LoggingPlugin
        pm.register(LoggingPlugin(), name='clm_email_logging')
    except Exception as e:
        logger.debug(f"Logging plugin registration skipped: {e}")


def reset_plugin_manager():
    """Reset the cached manager (useful for tests)."""
    global _pm
    with _lock:
        _pm = None
