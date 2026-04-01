"""
Logging Plugin — Structured logging for every input pipeline hook.
====================================================================
Always registered.  Emits structured log lines at INFO level so that
document pipeline activity is visible in server logs and log aggregators.
"""
import logging

from ..hookspecs import clm_input_hookimpl

logger = logging.getLogger('clm.input.events')


def _get_log_level(node) -> int:
    config = (node.config or {}).get('input_plugins', [])
    for p in config:
        if p.get('name') == 'logging':
            level_str = p.get('settings', {}).get('log_level', 'INFO')
            return getattr(logging, level_str, logging.INFO)
    return logging.INFO


class LoggingPlugin:
    """Logs every input pipeline event at configurable level."""

    @clm_input_hookimpl
    def on_pre_ingest(self, node, file_name, file_size, file_type, metadata):
        level = _get_log_level(node)
        logger.log(
            level,
            '[input:pre_ingest] node=%s file=%r size=%d type=%s',
            node.id, file_name, file_size, file_type,
        )

    @clm_input_hookimpl
    def on_post_extract(self, node, document, extracted_fields):
        level = _get_log_level(node)
        field_count = len(extracted_fields) if extracted_fields else 0
        logger.log(
            level,
            '[input:post_extract] node=%s doc=%s title=%r fields=%d status=%s',
            node.id, document.id, document.title, field_count,
            document.extraction_status,
        )

    @clm_input_hookimpl
    def on_validate(self, node, document, extracted_fields):
        level = _get_log_level(node)
        logger.log(
            level,
            '[input:validate] node=%s doc=%s title=%r',
            node.id, document.id, document.title,
        )
        return []  # No issues — logging-only plugin

    @clm_input_hookimpl
    def on_transform(self, node, document):
        level = _get_log_level(node)
        meta_count = len(document.extracted_metadata or {})
        logger.log(
            level,
            '[input:transform] node=%s doc=%s fields=%d',
            node.id, document.id, meta_count,
        )

    @clm_input_hookimpl
    def on_document_ready(self, node, document):
        level = _get_log_level(node)
        logger.log(
            level,
            '[input:ready] node=%s doc=%s title=%r status=%s',
            node.id, document.id, document.title,
            document.extraction_status,
        )

    @clm_input_hookimpl
    def on_batch_complete(self, node, documents, stats):
        level = _get_log_level(node)
        logger.log(
            level,
            '[input:batch_complete] node=%s total=%d ready=%d rejected=%d failed=%d',
            node.id, stats.get('total', 0), stats.get('ready', 0),
            stats.get('rejected', 0), stats.get('failed', 0),
        )

    @clm_input_hookimpl
    def on_error(self, node, document, error, stage):
        doc_id = document.id if document else 'N/A'
        logger.warning(
            '[input:error] node=%s doc=%s stage=%s error=%s',
            node.id, doc_id, stage, error,
        )
