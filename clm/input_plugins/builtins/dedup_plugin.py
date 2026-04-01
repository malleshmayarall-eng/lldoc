"""
Dedup Plugin — Detects duplicate documents before and after extraction.
========================================================================
Strategies:
  - content_hash: Compares file content hashes (pre-ingest).
  - filename:     Compares filenames within the workflow (pre-ingest).
  - field_fingerprint: Hashes a subset of extracted fields (post-extract).

On-duplicate actions:
  - warn:    Adds a warning issue but allows the document.
  - skip:    Rejects the document at pre-ingest.
  - replace: Marks the older duplicate as archived.
"""
import hashlib
import json
import logging

from ..hookspecs import clm_input_hookimpl

logger = logging.getLogger(__name__)


def _get_settings(node) -> dict:
    config = (node.config or {}).get('input_plugins', [])
    for p in config:
        if p.get('name') == 'dedup':
            if not p.get('enabled', True):
                return {}
            return p.get('settings', {})
    return {}


class DedupPlugin:
    """Detects duplicate documents by content hash, filename, or field fingerprint."""

    @clm_input_hookimpl
    def on_pre_ingest(self, node, file_name, file_size, file_type, metadata):
        settings = _get_settings(node)
        if not settings:
            return None

        strategy = settings.get('strategy', 'content_hash')
        action = settings.get('action', 'warn')

        from clm.models import WorkflowDocument

        duplicate = None

        if strategy == 'content_hash':
            # Check by file_hash — the hash must be provided in metadata
            # (the caller pre-computes it).
            file_hash = metadata.get('_file_hash', '')
            if file_hash:
                duplicate = WorkflowDocument.objects.filter(
                    workflow=node.workflow,
                    file_hash=file_hash,
                    extraction_status__in=('completed', 'pending', 'processing'),
                ).first()

        elif strategy == 'filename':
            if file_name:
                duplicate = WorkflowDocument.objects.filter(
                    workflow=node.workflow,
                    title=file_name,
                    extraction_status__in=('completed', 'pending', 'processing'),
                ).first()

        if not duplicate:
            return None

        logger.info(
            f"[dedup] Duplicate detected: {file_name} matches doc {duplicate.id} "
            f"(strategy={strategy}, action={action})"
        )

        if action == 'skip':
            return {
                'reject': True,
                'reason': f'Duplicate of existing document "{duplicate.title}" '
                          f'(id={duplicate.id}, strategy={strategy})',
            }
        elif action == 'replace':
            # Archive the old document
            duplicate.extraction_status = 'archived'
            gm = dict(duplicate.global_metadata or {})
            gm['_archived_reason'] = 'Replaced by newer upload (dedup plugin)'
            duplicate.global_metadata = gm
            duplicate.save(update_fields=['extraction_status', 'global_metadata'])
            metadata['_replaced_doc_id'] = str(duplicate.id)
            return {
                'metadata': {'_replaced_doc_id': str(duplicate.id)},
            }
        else:  # warn
            metadata['_duplicate_of'] = str(duplicate.id)
            return {
                'metadata': {'_duplicate_of': str(duplicate.id)},
            }

    @clm_input_hookimpl
    def on_post_extract(self, node, document, extracted_fields):
        settings = _get_settings(node)
        if not settings:
            return None

        strategy = settings.get('strategy', 'content_hash')
        if strategy != 'field_fingerprint':
            return None

        fp_fields = settings.get('fingerprint_fields', [])
        if not fp_fields:
            return None

        # Build fingerprint from specified fields
        fp_data = {k: extracted_fields.get(k, '') for k in sorted(fp_fields)}
        fingerprint = hashlib.sha256(
            json.dumps(fp_data, sort_keys=True, default=str).encode()
        ).hexdigest()

        # Store fingerprint on the document
        gm = dict(document.global_metadata or {})
        gm['_field_fingerprint'] = fingerprint

        from clm.models import WorkflowDocument

        # Check for existing doc with same fingerprint
        duplicate = WorkflowDocument.objects.filter(
            workflow=node.workflow,
            extraction_status__in=('completed', 'pending', 'processing'),
        ).exclude(
            id=document.id,
        ).filter(
            global_metadata___field_fingerprint=fingerprint,
        ).first()

        if duplicate:
            action = settings.get('action', 'warn')
            gm['_duplicate_of'] = str(duplicate.id)
            gm['_dedup_strategy'] = 'field_fingerprint'
            document.global_metadata = gm
            document.save(update_fields=['global_metadata'])

            logger.info(
                f"[dedup] Field fingerprint match: doc {document.id} "
                f"matches {duplicate.id} (action={action})"
            )

            if action == 'replace':
                duplicate.extraction_status = 'archived'
                dup_gm = dict(duplicate.global_metadata or {})
                dup_gm['_archived_reason'] = 'Replaced by field_fingerprint dedup'
                duplicate.global_metadata = dup_gm
                duplicate.save(update_fields=['extraction_status', 'global_metadata'])

            return {
                'fields': {'_duplicate_of': str(duplicate.id)},
            }

        # No duplicate — just store the fingerprint
        document.global_metadata = gm
        document.save(update_fields=['global_metadata'])
        return None
