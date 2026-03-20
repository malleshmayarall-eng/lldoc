"""
CLM Email Plugin System  (pluggy-based)
========================================
Hook-based extension point so that external code can react to email
events without modifying the core inbox checker.

Architecture
------------
1. **hookspecs.py** — Declares the hook signatures (``@hookspec``).
2. **manager.py**   — Creates and caches the ``PluginManager``, discovers
   built-in plugins and any entry-point plugins.
3. **builtins/**    — Ships with default plugins:
   • ``webhook_plugin`` — POSTs a JSON payload to configured URLs on every
     email event (new email, processed doc, inbox check complete).
   • ``logging_plugin`` — Structured logging for every hook call.

Usage from anywhere in CLM:

    from clm.plugins import get_plugin_manager

    pm = get_plugin_manager()
    pm.hook.on_inbox_checked(node=node, found=5, skipped=2, errors=[])
    pm.hook.on_email_processed(node=node, document=doc)

Adding a custom plugin
----------------------
1. Create a class that implements one or more methods from ``EmailHookSpec``.
2. Decorate each method with ``@clm_email_hookimpl``.
3. Either:
   a. Place it in ``clm/plugins/builtins/`` and register in ``_register_builtins()``, or
   b. Expose it via a ``clm_email`` entry-point group in your package's setup.cfg / pyproject.toml.
"""

from .manager import get_plugin_manager  # noqa: F401
from .hookspecs import clm_email_hookimpl, clm_email_hookspec  # noqa: F401

__all__ = [
    'get_plugin_manager',
    'clm_email_hookspec',
    'clm_email_hookimpl',
]
