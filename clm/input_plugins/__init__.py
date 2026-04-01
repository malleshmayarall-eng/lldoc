"""
CLM Input Node Plugin System  (pluggy-based)
==============================================
Hook-based extension points for the input node document pipeline.
Plugins can hook into every stage of a document's journey through
the input node — from pre-ingestion to post-extraction.

Architecture
------------
1. **hookspecs.py** — Declares the hook signatures (``@hookspec``).
2. **manager.py**   — Creates and caches the ``PluginManager``, discovers
   built-in plugins and any entry-point plugins.
3. **registry.py**  — Static plugin registry with metadata for the API.
4. **builtins/**    — Ships with default plugins:
   • ``normalize_plugin``    — Normalises extracted metadata (trim, lowercase keys, etc.)
   • ``validate_plugin``     — Validates documents against required-fields schema.
   • ``dedup_plugin``        — Detects and flags duplicate documents.
   • ``enrich_plugin``       — Auto-tags documents (file-type, page-count, word-count).
   • ``logging_plugin``      — Structured logging for every hook call.
   • ``webhook_plugin``      — POSTs a JSON payload to configured URLs.

Hook execution order (pipeline)
-------------------------------
    Upload / Fetch
      │
      ▼
    on_pre_ingest(node, file_name, file_bytes, metadata)
      │  ↳ plugins can reject, rename, add global metadata
      ▼
    [Core creates WorkflowDocument]
      │
      ▼
    on_post_extract(node, document, extracted_fields)
      │  ↳ plugins can transform/enrich extracted metadata
      ▼
    on_validate(node, document, extracted_fields)
      │  ↳ plugins can flag issues (missing fields, bad formats)
      ▼
    on_transform(node, document)
      │  ↳ plugins can mutate metadata (normalize, compute derived fields)
      ▼
    on_document_ready(node, document)
      │  ↳ fire-and-forget side-effects (webhooks, logging, notifications)
      ▼
    [Document enters DAG execution]

Usage from anywhere in CLM:

    from clm.input_plugins import get_plugin_manager

    pm = get_plugin_manager()
    pm.hook.on_post_extract(node=node, document=doc, extracted_fields=fields)

Adding a custom plugin
----------------------
1. Create a class that implements one or more methods from ``InputHookSpec``.
2. Decorate each method with ``@clm_input_hookimpl``.
3. Either:
   a. Place it in ``clm/input_plugins/builtins/`` and register in
      ``_register_builtins()``, or
   b. Expose it via a ``clm_input`` entry-point group in your package's
      setup.cfg / pyproject.toml.
"""

from .manager import get_plugin_manager, reset_plugin_manager  # noqa: F401
from .hookspecs import clm_input_hookimpl, clm_input_hookspec  # noqa: F401
from .registry import (  # noqa: F401
    PLUGIN_REGISTRY,
    get_plugin_info,
    list_plugins,
    list_processing_plugins,
    list_integration_plugins,
    get_all_plugin_metadata,
)

__all__ = [
    'get_plugin_manager',
    'reset_plugin_manager',
    'clm_input_hookspec',
    'clm_input_hookimpl',
    'PLUGIN_REGISTRY',
    'get_plugin_info',
    'list_plugins',
    'list_processing_plugins',
    'list_integration_plugins',
    'get_all_plugin_metadata',
]
