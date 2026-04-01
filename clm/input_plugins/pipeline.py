"""
Input Plugin Pipeline — Orchestrates hook execution for documents.
===================================================================
The ``InputPipeline`` class runs a document through the full plugin
pipeline:  pre_ingest → post_extract → validate → transform → ready.

It reads the node's plugin configuration (``node.config.input_plugins``)
to determine which plugins are enabled, their order, and their settings.
Disabled plugins are skipped.  Results are collected in a ``PipelineResult``
that the caller can inspect.
"""
import hashlib
import json
import logging
from dataclasses import dataclass, field
from typing import Any

from .manager import get_plugin_manager

logger = logging.getLogger(__name__)


@dataclass
class PipelineResult:
    """Accumulates results from all pipeline stages for one document."""
    rejected: bool = False
    reject_reason: str = ''
    issues: list[dict] = field(default_factory=list)
    metadata_additions: dict = field(default_factory=dict)
    plugin_log: list[dict] = field(default_factory=list)
    error: str = ''
    stage_reached: str = 'none'

    @property
    def has_errors(self) -> bool:
        return any(i['severity'] == 'error' for i in self.issues)

    @property
    def has_warnings(self) -> bool:
        return any(i['severity'] == 'warning' for i in self.issues)

    def to_dict(self) -> dict:
        return {
            'rejected': self.rejected,
            'reject_reason': self.reject_reason,
            'issues': self.issues,
            'metadata_additions': self.metadata_additions,
            'error': self.error,
            'stage_reached': self.stage_reached,
            'has_errors': self.has_errors,
            'has_warnings': self.has_warnings,
        }


def _get_node_plugin_config(node) -> list[dict]:
    """
    Read the input_plugins config from node.config.

    Expected format:
        node.config = {
            ...
            "input_plugins": [
                {"name": "normalize", "enabled": true, "priority": 10, "settings": {...}},
                {"name": "validate",  "enabled": true, "priority": 20, "settings": {...}},
                ...
            ]
        }

    If missing, returns a sensible default list built from the registry.
    Only includes processing plugins — integration plugins are managed
    as input_type on the node and enabled/disabled at the org level.
    """
    config = node.config or {}
    plugins = config.get('input_plugins')

    if plugins is not None:
        # Filter out any legacy integration plugins stored in node config
        from .registry import get_plugin_info
        return [
            p for p in plugins
            if (get_plugin_info(p.get('name')) or {}).get('plugin_type', 'processing') == 'processing'
        ]

    # Default: enable all default_enabled processing plugins from registry
    from .registry import list_processing_plugins
    return [
        {
            'name': p['name'],
            'enabled': p['default_enabled'],
            'priority': p['default_priority'],
            'settings': {
                k: v.get('default')
                for k, v in p.get('settings_schema', {}).items()
            },
        }
        for p in list_processing_plugins()
    ]


def _is_plugin_enabled(name: str, plugin_configs: list[dict]) -> tuple[bool, dict]:
    """Check if a named plugin is enabled and return its settings."""
    for pc in plugin_configs:
        if pc.get('name') == name:
            return pc.get('enabled', True), pc.get('settings', {})
    return False, {}


def run_pre_ingest(
    node,
    file_name: str,
    file_size: int,
    file_type: str,
    metadata: dict,
) -> PipelineResult:
    """
    Run the pre-ingest pipeline stage.
    Called *before* a WorkflowDocument is created.

    Returns a PipelineResult. If ``.rejected`` is True, the caller
    should skip document creation.
    """
    result = PipelineResult(stage_reached='pre_ingest')
    pm = get_plugin_manager()

    try:
        hook_results = pm.hook.on_pre_ingest(
            node=node,
            file_name=file_name,
            file_size=file_size,
            file_type=file_type,
            metadata=metadata,
        )

        # Process results from all plugins
        for hr in (hook_results or []):
            if not isinstance(hr, dict):
                continue

            # Check for rejection
            if hr.get('reject'):
                result.rejected = True
                result.reject_reason = hr.get('reason', 'Rejected by plugin')
                result.plugin_log.append({
                    'stage': 'pre_ingest',
                    'action': 'rejected',
                    'reason': result.reject_reason,
                })
                return result

            # Collect metadata additions
            if 'metadata' in hr:
                metadata.update(hr['metadata'])
                result.metadata_additions.update(hr['metadata'])

            # File rename
            if 'file_name' in hr:
                result.metadata_additions['_renamed_from'] = file_name
                result.metadata_additions['_new_file_name'] = hr['file_name']

        result.plugin_log.append({
            'stage': 'pre_ingest',
            'action': 'passed',
            'metadata_added': len(result.metadata_additions),
        })

    except Exception as e:
        logger.error(f"Pre-ingest pipeline error: {e}")
        result.error = str(e)
        _fire_error(pm, node, None, str(e), 'pre_ingest')

    return result


def run_post_pipeline(node, document) -> PipelineResult:
    """
    Run the full post-extraction pipeline on a document:
    post_extract → validate → transform → document_ready.

    Called after AI extraction completes.
    """
    result = PipelineResult(stage_reached='post_extract')
    pm = get_plugin_manager()
    plugin_configs = _get_node_plugin_config(node)

    extracted = dict(document.extracted_metadata or {})

    # ── Stage 1: Post-extract ──────────────────────────────────────
    try:
        hook_results = pm.hook.on_post_extract(
            node=node,
            document=document,
            extracted_fields=extracted,
        )
        for hr in (hook_results or []):
            if isinstance(hr, dict) and 'fields' in hr:
                extracted.update(hr['fields'])
                result.metadata_additions.update(hr['fields'])

        result.plugin_log.append({
            'stage': 'post_extract',
            'action': 'completed',
            'fields_added': len(result.metadata_additions),
        })
    except Exception as e:
        logger.error(f"Post-extract pipeline error for doc {document.id}: {e}")
        result.error = str(e)
        _fire_error(pm, node, document, str(e), 'extract')
        return result

    # Persist any metadata changes from post_extract
    if result.metadata_additions:
        document.extracted_metadata = {
            **(document.extracted_metadata or {}),
            **result.metadata_additions,
        }
        document.save(update_fields=['extracted_metadata'])

    # ── Stage 2: Validate ──────────────────────────────────────────
    result.stage_reached = 'validate'
    try:
        hook_results = pm.hook.on_validate(
            node=node,
            document=document,
            extracted_fields=dict(document.extracted_metadata or {}),
        )
        for hr in (hook_results or []):
            if isinstance(hr, list):
                result.issues.extend(hr)

        # Store issues on document
        if result.issues:
            gm = dict(document.global_metadata or {})
            gm['_plugin_issues'] = result.issues
            gm['_plugin_issue_count'] = len(result.issues)
            document.global_metadata = gm
            document.save(update_fields=['global_metadata'])

        result.plugin_log.append({
            'stage': 'validate',
            'action': 'completed',
            'issues': len(result.issues),
            'errors': sum(1 for i in result.issues if i.get('severity') == 'error'),
            'warnings': sum(1 for i in result.issues if i.get('severity') == 'warning'),
        })
    except Exception as e:
        logger.error(f"Validate pipeline error for doc {document.id}: {e}")
        result.error = str(e)
        _fire_error(pm, node, document, str(e), 'validate')
        return result

    # Check if validation errors should block
    _validate_enabled, _validate_settings = _is_plugin_enabled('validate', plugin_configs)
    if _validate_settings.get('fail_on_error') and result.has_errors:
        document.extraction_status = 'failed'
        gm = dict(document.global_metadata or {})
        gm['_failed_reason'] = 'Validation errors (plugin)'
        document.global_metadata = gm
        document.save(update_fields=['extraction_status', 'global_metadata'])
        result.plugin_log.append({
            'stage': 'validate',
            'action': 'blocked',
            'reason': 'fail_on_error enabled with validation errors',
        })
        return result

    # ── Stage 3: Transform ─────────────────────────────────────────
    result.stage_reached = 'transform'
    try:
        pm.hook.on_transform(node=node, document=document)
        # Plugins mutate document directly; save once
        document.save(update_fields=['extracted_metadata', 'global_metadata'])
        result.plugin_log.append({
            'stage': 'transform',
            'action': 'completed',
        })
    except Exception as e:
        logger.error(f"Transform pipeline error for doc {document.id}: {e}")
        result.error = str(e)
        _fire_error(pm, node, document, str(e), 'transform')
        return result

    # ── Stage 4: Document ready ────────────────────────────────────
    result.stage_reached = 'ready'
    try:
        pm.hook.on_document_ready(node=node, document=document)
        result.plugin_log.append({
            'stage': 'ready',
            'action': 'completed',
        })
    except Exception as e:
        logger.error(f"Document-ready pipeline error for doc {document.id}: {e}")
        result.error = str(e)
        _fire_error(pm, node, document, str(e), 'ready')

    return result


def run_batch_complete(node, documents: list, stats: dict):
    """Fire the batch_complete hook after all docs are processed."""
    pm = get_plugin_manager()
    try:
        pm.hook.on_batch_complete(
            node=node,
            documents=documents,
            stats=stats,
        )
    except Exception as e:
        logger.error(f"Batch-complete hook error: {e}")


def _fire_error(pm, node, document, error: str, stage: str):
    """Fire the on_error hook (best-effort, never raises)."""
    try:
        pm.hook.on_error(
            node=node,
            document=document,
            error=error,
            stage=stage,
        )
    except Exception:
        pass
