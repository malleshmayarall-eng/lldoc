"""
Action Executor — For-loop engine for action nodes
====================================================
When an action node is executed, this module:

1. Gets the list of incoming document IDs (from upstream nodes)
2. For each document:
   a. Extracts the required + optional fields from metadata
   b. If required fields are missing → marks as 'skipped' with missing_fields list
   c. If all required fields present → calls plugin.execute(data, settings)
   d. Records the result (sent / skipped / failed) in ActionExecutionResult
3. Updates the ActionExecution summary stats
4. Returns a detailed report so the frontend can show per-document status

Users can then:
  - See which documents were skipped (missing data)
  - Update the missing data via override_data
  - Retry individual skipped/failed results
"""
import logging

from django.utils import timezone

from .action_plugins import get_plugin
from .models import (
    ActionExecution,
    ActionExecutionResult,
    ActionPlugin,
    WorkflowDocument,
    WorkflowNode,
)

logger = logging.getLogger(__name__)


def execute_action_node(
    node: WorkflowNode,
    incoming_document_ids: list,
    triggered_by=None,
) -> dict:
    """
    Execute an action node's plugin for every incoming document.

    Args:
        node: WorkflowNode of type 'action' with config like:
              {
                "plugin": "send_email",
                "settings": {
                  "subject_template": "RE: {document_title}",
                  "body_template": "Dear {party_1_name}...",
                  ...
                }
              }
        incoming_document_ids: list of WorkflowDocument UUIDs from upstream nodes
        triggered_by: User who triggered the execution (optional)

    Returns:
        dict with execution summary and per-document results
    """
    config = node.config or {}
    plugin_name = config.get('plugin', '')
    plugin_settings = config.get('settings', {})

    if not plugin_name:
        return {
            'error': 'No plugin configured on this action node',
            'node_id': str(node.id),
            'status': 'failed',
        }

    # Get or create the ActionPlugin DB record
    plugin_instance = get_plugin(plugin_name)
    if not plugin_instance:
        return {
            'error': f'Plugin "{plugin_name}" not found',
            'node_id': str(node.id),
            'status': 'failed',
        }

    # Ensure ActionPlugin exists in DB
    db_plugin, _ = ActionPlugin.objects.get_or_create(
        name=plugin_name,
        defaults={
            'display_name': plugin_instance.display_name,
            'description': plugin_instance.description,
            'icon': plugin_instance.icon,
            'category': plugin_instance.category,
            'required_fields': plugin_instance.required_fields,
            'optional_fields': plugin_instance.optional_fields,
            'settings_schema': plugin_instance.settings_schema,
        },
    )

    # Create execution record
    execution = ActionExecution.objects.create(
        workflow=node.workflow,
        node=node,
        plugin=db_plugin,
        status='running',
        total_documents=len(incoming_document_ids),
        settings_used=plugin_settings,
        started_at=timezone.now(),
        triggered_by=triggered_by,
    )

    # Fetch documents
    documents = WorkflowDocument.objects.filter(
        id__in=incoming_document_ids,
    ).select_related('workflow')

    required = plugin_instance.required_fields
    optional = plugin_instance.optional_fields
    all_fields = set(required + optional)

    results = []
    sent = 0
    skipped = 0
    failed = 0

    for doc in documents:
        # Extract data from both metadata sources
        combined_meta = {}
        combined_meta.update(doc.global_metadata or {})
        combined_meta.update(doc.extracted_metadata or {})
        # Also add document-level info
        combined_meta['document_title'] = doc.title
        combined_meta['document_id'] = str(doc.id)
        combined_meta['file_type'] = doc.file_type

        # Extract only the fields the plugin cares about
        data = {}
        for field in all_fields:
            val = combined_meta.get(field)
            data[field] = val if val and str(val).strip() else None
        # Also include any extra metadata the user might have
        # (so templates can reference anything)
        for key, val in combined_meta.items():
            if key not in data:
                data[key] = val

        # Check required fields
        missing = [f for f in required if not data.get(f)]

        if missing:
            # SKIPPED — missing required data
            result = ActionExecutionResult.objects.create(
                execution=execution,
                document=doc,
                status='skipped',
                extracted_data=data,
                missing_fields=missing,
                error_message=f'Missing required fields: {", ".join(missing)}',
            )
            skipped += 1
            results.append(_result_to_dict(result, doc))
            continue

        # Execute the plugin
        try:
            response = plugin_instance.execute(data, plugin_settings)

            if response.get('success'):
                result = ActionExecutionResult.objects.create(
                    execution=execution,
                    document=doc,
                    status='sent',
                    extracted_data=data,
                    plugin_response=response,
                )
                sent += 1
            else:
                result = ActionExecutionResult.objects.create(
                    execution=execution,
                    document=doc,
                    status='failed',
                    extracted_data=data,
                    plugin_response=response,
                    error_message=response.get('message', 'Plugin returned failure'),
                )
                failed += 1

            results.append(_result_to_dict(result, doc))

        except Exception as e:
            logger.error(f"Plugin {plugin_name} failed for doc {doc.id}: {e}")
            result = ActionExecutionResult.objects.create(
                execution=execution,
                document=doc,
                status='failed',
                extracted_data=data,
                error_message=str(e),
            )
            failed += 1
            results.append(_result_to_dict(result, doc))

    # Update execution summary
    execution.sent_count = sent
    execution.skipped_count = skipped
    execution.failed_count = failed
    execution.completed_at = timezone.now()

    if failed == 0 and skipped == 0:
        execution.status = 'completed'
    elif sent == 0 and skipped == 0:
        execution.status = 'failed'
    else:
        execution.status = 'partial'

    execution.save()

    # Store result summary in node's last_result
    node.last_result = {
        'execution_id': str(execution.id),
        'count': len(incoming_document_ids),
        'document_ids': [str(d) for d in incoming_document_ids],
        'sent': sent,
        'skipped': skipped,
        'failed': failed,
        'status': execution.status,
    }
    node.save(update_fields=['last_result', 'updated_at'])

    return {
        'execution_id': str(execution.id),
        'node_id': str(node.id),
        'plugin': plugin_name,
        'status': execution.status,
        'total': len(incoming_document_ids),
        'sent': sent,
        'skipped': skipped,
        'failed': failed,
        'results': results,
    }


def retry_action_result(result_id: str, override_data: dict = None) -> dict:
    """
    Retry a single skipped/failed ActionExecutionResult.
    Optionally accepts override_data to fill in missing fields.

    Args:
        result_id: UUID of the ActionExecutionResult to retry
        override_data: dict of field_name → value overrides
    """
    try:
        result = ActionExecutionResult.objects.select_related(
            'execution__plugin', 'document',
        ).get(id=result_id)
    except ActionExecutionResult.DoesNotExist:
        return {'error': 'Result not found', 'success': False}

    plugin_instance = get_plugin(result.execution.plugin.name)
    if not plugin_instance:
        return {'error': 'Plugin not found', 'success': False}

    # Merge extracted data with overrides
    data = dict(result.extracted_data or {})
    if override_data:
        data.update(override_data)
        result.override_data = override_data

    # Re-check required fields
    missing = [f for f in plugin_instance.required_fields if not data.get(f)]
    if missing:
        result.status = 'skipped'
        result.missing_fields = missing
        result.error_message = f'Still missing: {", ".join(missing)}'
        result.save()
        return {
            'success': False,
            'message': f'Still missing required fields: {", ".join(missing)}',
            'missing_fields': missing,
            'result_id': str(result.id),
        }

    # Execute
    plugin_settings = result.execution.settings_used or {}
    try:
        response = plugin_instance.execute(data, plugin_settings)

        if response.get('success'):
            result.status = 'retried'
            result.plugin_response = response
            result.error_message = ''
            result.missing_fields = []
            result.extracted_data = data
            result.save()

            # Update execution counts
            _recalculate_execution_counts(result.execution)

            return {
                'success': True,
                'message': response.get('message', 'Retried successfully'),
                'result_id': str(result.id),
                'plugin_response': response,
            }
        else:
            result.status = 'failed'
            result.plugin_response = response
            result.error_message = response.get('message', 'Plugin failed')
            result.extracted_data = data
            result.save()
            return {
                'success': False,
                'message': response.get('message', 'Retry failed'),
                'result_id': str(result.id),
            }
    except Exception as e:
        result.status = 'failed'
        result.error_message = str(e)
        result.save()
        return {
            'success': False,
            'message': f'Retry failed: {str(e)}',
            'result_id': str(result.id),
        }


def _recalculate_execution_counts(execution: ActionExecution):
    """Recalculate sent/skipped/failed counts from actual results."""
    results = execution.results.all()
    execution.sent_count = results.filter(status__in=['sent', 'retried']).count()
    execution.skipped_count = results.filter(status='skipped').count()
    execution.failed_count = results.filter(status='failed').count()

    if execution.failed_count == 0 and execution.skipped_count == 0:
        execution.status = 'completed'
    elif execution.sent_count == 0 and execution.skipped_count == 0:
        execution.status = 'failed'
    else:
        execution.status = 'partial'

    execution.save(update_fields=[
        'sent_count', 'skipped_count', 'failed_count', 'status',
    ])


def _result_to_dict(result: ActionExecutionResult, doc: WorkflowDocument) -> dict:
    """Convert an ActionExecutionResult to a serializable dict."""
    return {
        'result_id': str(result.id),
        'document_id': str(doc.id),
        'document_title': doc.title,
        'status': result.status,
        'extracted_data': result.extracted_data,
        'missing_fields': result.missing_fields,
        'plugin_response': result.plugin_response,
        'error_message': result.error_message,
        'override_data': result.override_data,
    }
