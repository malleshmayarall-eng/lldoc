"""
CLM Event System — Compilation, Event Subscriptions & Dispatch
================================================================

This module provides the core "go-live" workflow lifecycle:

  1. **compile_workflow()** — Validates the DAG, checks input node configs,
     creates EventSubscription rows, and marks the workflow as compiled.
     This is the prerequisite for going live.

  2. **dispatch_event()** — Routes an incoming event (sheet update, email,
     webhook, upload, scheduled poll) to all subscribed workflows and
     triggers execution.

  3. **process_webhook()** — Handles inbound webhook POSTs, verifies
     signatures, records the event, and dispatches execution.

  4. **poll_subscription()** — Polls a single time-based subscription
     (email inbox, cloud drive, etc.) and triggers execution on changes.

Architecture
------------
  compile_workflow()
    ↓ validates DAG (cycle, input/output nodes, node configs)
    ↓ scans input nodes → creates EventSubscription per source
    ↓ stores WorkflowCompilation record
    ↓ marks workflow.compilation_status = 'compiled'

  When workflow is_live=True:
    - Event-driven sources (sheets, webhooks) fire immediately via signals/endpoints
    - Time-based sources (email, cloud) are polled by dispatch_event_subscriptions()
    - Each event creates a WebhookEvent record, then triggers execute_workflow_async()

  dispatch_event('sheet_updated', source_id=sheet_id, payload={...})
    ↓ finds all active EventSubscriptions with matching source_type + source_id
    ↓ for each: creates WebhookEvent, dispatches async execution
"""

import hashlib
import hmac
import logging
import traceback
import uuid as _uuid
from collections import defaultdict, deque

from django.utils import timezone

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 1. Workflow Compilation
# ---------------------------------------------------------------------------

def compile_workflow(workflow, user=None):
    """
    Validate the workflow DAG and create event subscriptions for all input
    nodes.  This is the "compile" step before going live.

    Returns a WorkflowCompilation record with status, errors, warnings,
    and subscription details.

    Steps:
      1. Validate DAG structure (cycle detection, input/output presence)
      2. Validate each node's configuration
      3. Create/update EventSubscription rows for each input node
      4. Record the compilation result
      5. Update workflow.compilation_status

    Raises no exceptions — all errors are captured in the compilation record.
    """
    from .models import (
        EventSubscription,
        NodeConnection,
        Workflow,
        WorkflowCompilation,
        WorkflowNode,
    )

    errors = []
    warnings = []

    nodes = {n.id: n for n in workflow.nodes.all()}
    connections = list(workflow.connections.all())

    node_count = len(nodes)
    connection_count = len(connections)

    # ── 1. Basic validation ───────────────────────────────────────────
    if node_count == 0:
        errors.append({
            'node_id': None,
            'message': 'Workflow has no nodes.',
            'severity': 'error',
        })

    input_nodes = [n for n in nodes.values() if n.node_type == 'input']
    # Sheet nodes in "input" mode also act as data sources for live workflows
    sheet_input_nodes = [
        n for n in nodes.values()
        if n.node_type == 'sheet' and (n.config or {}).get('mode') == 'input'
    ]
    output_nodes = [n for n in nodes.values() if n.node_type == 'output']

    has_input = len(input_nodes) > 0 or len(sheet_input_nodes) > 0
    has_output = len(output_nodes) > 0

    if not has_input:
        errors.append({
            'node_id': None,
            'message': 'Workflow must have at least one input node (or a Sheet node in input mode).',
            'severity': 'error',
        })
    if not has_output:
        warnings.append({
            'node_id': None,
            'message': 'Workflow has no output node. Results may not be collected.',
        })

    # ── 2. Cycle detection (Kahn's algorithm) ────────────────────────
    has_cycle = False
    if nodes:
        adj = defaultdict(list)
        in_degree = defaultdict(int)
        for nid in nodes:
            in_degree[nid] = 0
        for conn in connections:
            adj[conn.source_node_id].append(conn.target_node_id)
            in_degree[conn.target_node_id] += 1

        queue = deque(nid for nid, deg in in_degree.items() if deg == 0)
        visited = 0
        while queue:
            nid = queue.popleft()
            visited += 1
            for neighbor in adj[nid]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        if visited != len(nodes):
            has_cycle = True
            errors.append({
                'node_id': None,
                'message': 'Workflow contains a cycle — cannot execute.',
                'severity': 'error',
            })

    # ── 3. Validate node configurations ───────────────────────────────
    for node in nodes.values():
        config = node.config or {}

        if node.node_type == 'input':
            source_type = config.get('source_type', 'upload')
            if source_type == 'email_inbox':
                if not config.get('email_host') or not config.get('email_user'):
                    errors.append({
                        'node_id': str(node.id),
                        'message': f'Input node "{node.label or "Input"}" has email_inbox source but missing email_host/email_user.',
                        'severity': 'error',
                    })
            elif source_type == 'webhook':
                pass  # Webhook token will be auto-generated
            elif source_type == 'sheets':
                if not config.get('sheet_id'):
                    warnings.append({
                        'node_id': str(node.id),
                        'message': f'Input node "{node.label or "Input"}" has sheets source but no sheet_id configured.',
                    })
            elif source_type == 'document':
                if not config.get('document_id'):
                    warnings.append({
                        'node_id': str(node.id),
                        'message': f'Input node "{node.label or "Input"}" has document source but no document_id configured.',
                    })
            elif source_type in ('google_drive', 'dropbox', 'onedrive', 's3', 'ftp'):
                # Basic credential check
                if source_type == 'google_drive' and not config.get('google_drive_folder_id') and not config.get('folder_id'):
                    warnings.append({
                        'node_id': str(node.id),
                        'message': f'Input node "{node.label or "Input"}" has {source_type} source but no folder/path configured.',
                    })

        elif node.node_type == 'rule':
            conditions = config.get('conditions', [])
            if not conditions:
                warnings.append({
                    'node_id': str(node.id),
                    'message': f'Rule node "{node.label or "Rule"}" has no conditions — will pass all documents.',
                })

        elif node.node_type == 'sheet':
            if not config.get('sheet_id'):
                warnings.append({
                    'node_id': str(node.id),
                    'message': f'Sheet node "{node.label or "Sheet"}" has no sheet_id configured.',
                })

    # ── 4. Create/update EventSubscriptions ───────────────────────────
    subscriptions_created = 0
    subscription_details = []

    # Map input node source_type to EventSubscription.SourceType
    _SOURCE_MAP = {
        'upload': 'upload',
        'email_inbox': 'email',
        'webhook': 'webhook',
        'sheets': 'sheet',
        'document': 'document',
        'google_drive': 'google_drive',
        'dropbox': 'dropbox',
        'onedrive': 'onedrive',
        's3': 's3',
        'ftp': 'ftp',
        'url_scrape': 'url_scrape',
        'folder_upload': 'folder',
        'dms_import': 'dms',
        'table': 'sheet',  # Table sources work like sheets
    }

    # Deactivate old subscriptions that no longer match
    existing_sub_ids = set()

    if not errors:  # Only create subscriptions if DAG is valid
        # Combine regular input nodes + sheet-input nodes for subscription creation
        all_input_nodes = list(input_nodes) + list(sheet_input_nodes)
        for node in all_input_nodes:
            config = node.config or {}

            # Sheet nodes in input mode use 'sheet' source type
            if node.node_type == 'sheet':
                source_type = 'sheets'
            else:
                source_type = config.get('source_type', 'upload')
            sub_source_type = _SOURCE_MAP.get(source_type, 'upload')

            # Determine source_id
            source_id = ''
            if source_type == 'sheets':
                source_id = config.get('sheet_id', '')
            elif source_type == 'document':
                source_id = config.get('document_id', '')
            elif source_type == 'folder_upload':
                source_id = config.get('folder_id', '')
            elif source_type == 'google_drive':
                source_id = config.get('google_drive_folder_id', '') or config.get('folder_id', '')
            elif source_type in ('dropbox', 'onedrive', 's3', 'ftp'):
                source_id = config.get('folder_path', '') or config.get('bucket', '')
            elif source_type == 'dms_import':
                source_id = ','.join(config.get('dms_document_ids', []))
            elif source_type == 'table':
                source_id = config.get('sheet_id', '') or config.get('google_sheet_url', '')

            # Determine poll interval
            poll_interval = 60  # default
            if source_type == 'email_inbox':
                poll_interval = config.get('email_refetch_interval', 60)
            elif source_type in ('google_drive', 'dropbox', 'onedrive', 's3', 'ftp', 'url_scrape'):
                poll_interval = config.get('poll_interval', 300)  # 5 min default for cloud
            elif source_type in ('sheets', 'table', 'document'):
                poll_interval = 0  # Event-driven, not polled

            # Create or update
            sub, created = EventSubscription.objects.update_or_create(
                workflow=workflow,
                node=node,
                source_type=sub_source_type,
                defaults={
                    'organization': workflow.organization,
                    'source_id': source_id,
                    'poll_interval': poll_interval,
                    'status': 'active',
                    'consecutive_errors': 0,
                    'last_error': '',
                    'config_snapshot': {
                        k: v for k, v in config.items()
                        if k not in ('email_password',)  # Don't snapshot secrets
                    },
                },
            )

            # Auto-generate webhook token if webhook source
            if source_type == 'webhook' and not sub.webhook_token:
                sub.webhook_token = _uuid.uuid4()
                sub.save(update_fields=['webhook_token'])

            existing_sub_ids.add(sub.id)
            subscriptions_created += (1 if created else 0)
            subscription_details.append({
                'node_id': str(node.id),
                'node_label': node.label or node.node_type,
                'source_type': sub_source_type,
                'source_id': source_id,
                'poll_interval': poll_interval,
                'subscription_id': str(sub.id),
                'webhook_token': str(sub.webhook_token) if sub.webhook_token else None,
                'created': created,
            })

        # Deactivate orphaned subscriptions (from removed nodes)
        orphaned = EventSubscription.objects.filter(
            workflow=workflow,
        ).exclude(id__in=existing_sub_ids)
        orphaned.update(status='disabled')

    # ── 5. Rebuild extraction template ────────────────────────────────
    if not errors:
        try:
            workflow.rebuild_extraction_template()
        except Exception as e:
            warnings.append({
                'node_id': None,
                'message': f'Failed to rebuild extraction template: {e}',
            })

    # ── 6. Compute config hash ────────────────────────────────────────
    config_hash = ''
    if not errors:
        config_hash = workflow.compute_nodes_config_hash(save=True)

    # ── 7. Record compilation ─────────────────────────────────────────
    comp_status = 'failed' if errors else ('warning' if warnings else 'success')

    compilation = WorkflowCompilation.objects.create(
        workflow=workflow,
        status=comp_status,
        node_count=node_count,
        connection_count=connection_count,
        has_cycle=has_cycle,
        has_input_node=has_input,
        has_output_node=has_output,
        subscriptions_created=subscriptions_created,
        subscription_details=subscription_details,
        errors=errors,
        warnings=warnings,
        config_hash=config_hash,
        compiled_by=user,
    )

    # ── 8. Update workflow compilation status ─────────────────────────
    if not errors:
        workflow.compilation_status = 'compiled'
        workflow.compiled_at = timezone.now()
        workflow.compilation_errors = []
    else:
        workflow.compilation_status = 'failed'
        workflow.compilation_errors = errors

    workflow.save(update_fields=[
        'compilation_status', 'compiled_at', 'compilation_errors',
        'updated_at',
    ])

    logger.info(
        f"Workflow '{workflow.name}' compiled: {comp_status} "
        f"({node_count} nodes, {connection_count} connections, "
        f"{subscriptions_created} subscriptions created, "
        f"{len(errors)} errors, {len(warnings)} warnings)"
    )

    return compilation


# ---------------------------------------------------------------------------
# 2. Event Dispatch
# ---------------------------------------------------------------------------

def dispatch_event(
    event_type: str,
    source_type: str,
    source_id: str,
    payload: dict | None = None,
    idempotency_key: str = '',
    organization_id=None,
    source_ip: str | None = None,
):
    """
    Route an incoming event to all subscribed workflows and trigger execution.

    Args:
        event_type: 'sheet_updated', 'email_received', 'webhook_call',
                    'file_uploaded', 'folder_changed', etc.
        source_type: EventSubscription.SourceType value
        source_id: Identifier of the source (sheet UUID, folder ID, etc.)
        payload: Event data (sheet changes, email metadata, webhook body)
        idempotency_key: For dedup (e.g. Message-ID for emails)
        organization_id: Scope to a specific org (optional)
        source_ip: IP of the event source (for webhooks)

    Returns:
        {
            'dispatched': N,
            'events': [{event_id, workflow_id, execution_id}, ...],
            'skipped': N,
            'errors': [...],
        }
    """
    from .models import EventSubscription, WebhookEvent, WorkflowExecution

    logger.info(
        '[dispatch-event] CALLED event_type=%s source_type=%s source_id=%r '
        'org_id=%s idem_key=%r payload_keys=%s',
        event_type, source_type, source_id, organization_id,
        idempotency_key, list((payload or {}).keys()),
    )

    # Dedup check
    if idempotency_key:
        existing = WebhookEvent.objects.filter(
            idempotency_key=idempotency_key,
            status__in=['received', 'processing', 'processed'],
        ).first()
        if existing:
            logger.debug('[dispatch-event] DEDUP HIT — skipping (key=%s)', idempotency_key)
            return {
                'dispatched': 0,
                'events': [],
                'skipped': 1,
                'errors': [],
                'message': f'Duplicate event (idempotency_key={idempotency_key})',
            }

    # Find matching subscriptions
    sub_qs = EventSubscription.objects.filter(
        source_type=source_type,
        status='active',
        workflow__is_active=True,
    ).select_related('workflow', 'node')

    if source_id:
        sub_qs = sub_qs.filter(source_id=source_id)

    if organization_id:
        sub_qs = sub_qs.filter(organization_id=organization_id)

    sub_count = sub_qs.count()
    logger.info('[dispatch-event] Matching subscriptions: %d', sub_count)
    if sub_count == 0:
        logger.warning(
            '[dispatch-event] No matching EventSubscriptions found! '
            'filter: source_type=%r, status=active, workflow__is_active=True',
            source_type,
        )
        all_subs = EventSubscription.objects.filter(source_type=source_type).values_list(
            'id', 'status', 'workflow__name', 'workflow__is_active', 'workflow__is_live', 'workflow__compilation_status'
        )
        for s in all_subs:
            logger.debug(
                '[dispatch-event] Existing sub: id=%s status=%s wf=%s active=%s live=%s compiled=%s',
                s[0], s[1], s[2], s[3], s[4], s[5],
            )
        if not all_subs.exists():
            logger.warning(
                '[dispatch-event] No EventSubscriptions with source_type=%r exist at all. '
                'Did you compile the workflow? (POST /compile/ or POST /go-live/)',
                source_type,
            )

    dispatched = 0
    events = []
    errors = []

    for sub in sub_qs:
        workflow = sub.workflow
        logger.info(
            '[dispatch-event] Processing sub %s → workflow %r (is_live=%s, compiled=%s)',
            sub.id, workflow.name, workflow.is_live, workflow.compilation_status,
        )

        # Only dispatch if workflow is live or auto_execute_on_upload
        if not workflow.is_live and not workflow.auto_execute_on_upload:
            logger.debug('[dispatch-event] SKIPPED %r — not live and no auto_execute_on_upload', workflow.name)
            continue

        # Check compilation status
        if workflow.compilation_status not in ('compiled',):
            logger.warning(
                '[dispatch-event] SKIPPED %r — not compiled (status=%s)',
                workflow.name, workflow.compilation_status,
            )
            continue

        # Create event record
        event = WebhookEvent.objects.create(
            subscription=sub,
            workflow=workflow,
            organization=sub.organization,
            event_type=event_type,
            status='received',
            payload=payload or {},
            source_ip=source_ip,
            idempotency_key=idempotency_key,
        )
        logger.info('[dispatch-event] Created WebhookEvent %s', event.id)

        # Trigger async execution
        try:
            execution = WorkflowExecution.objects.create(
                workflow=workflow,
                status='queued',
                mode='auto',
                triggered_by=workflow.created_by,
                trigger_context=payload or {},
            )
            logger.info('[dispatch-event] Created WorkflowExecution %s (status=queued)', execution.id)

            from .tasks import execute_workflow_async
            logger.info(
                '[dispatch-event] Dispatching execute_workflow_async wf=%s exec=%s',
                workflow.id, execution.id,
            )
            execute_workflow_async.delay(
                workflow_id=str(workflow.id),
                execution_id=str(execution.id),
                user_id=workflow.created_by_id,
                mode='full',
                smart=True,
            )
            logger.info('[dispatch-event] Task dispatched to Celery successfully for %r', workflow.name)

            event.status = 'processing'
            event.execution = execution
            event.save(update_fields=['status', 'execution'])

            # Emit a live event to the in-process bus so SSE clients
            # connected to the web process see the event immediately.
            # (Celery workers will emit their own events during execution.)
            try:
                from .live_events import emit
                emit(
                    'execution_queued',
                    workflow_id=str(workflow.id),
                    execution_id=str(execution.id),
                    data={
                        'workflow_name': workflow.name,
                        'event_type': event_type,
                        'source_type': source_type,
                        'source_id': source_id,
                        'status': 'queued',
                        'trigger': 'event_dispatch',
                    },
                )
            except Exception:
                pass  # Never let SSE emission block event dispatch

            # Update subscription stats
            sub.total_events_received += 1
            sub.total_executions_triggered += 1
            sub.last_polled_at = timezone.now()
            sub.save(update_fields=[
                'total_events_received', 'total_executions_triggered',
                'last_polled_at', 'updated_at',
            ])

            dispatched += 1
            events.append({
                'event_id': str(event.id),
                'workflow_id': str(workflow.id),
                'workflow_name': workflow.name,
                'execution_id': str(execution.id),
            })

        except Exception as e:
            error_msg = str(e)
            event.status = 'failed'
            event.error_message = error_msg
            event.save(update_fields=['status', 'error_message'])

            sub.consecutive_errors += 1
            sub.last_error = error_msg
            sub.last_error_at = timezone.now()
            sub.save(update_fields=['consecutive_errors', 'last_error', 'last_error_at'])

            errors.append({
                'workflow_id': str(workflow.id),
                'error': error_msg,
            })
            logger.error('[dispatch-event] EXCEPTION dispatching to %r: %s', workflow.name, error_msg)

    logger.info('[dispatch-event] RESULT: dispatched=%d, errors=%d', dispatched, len(errors))

    return {
        'dispatched': dispatched,
        'events': events,
        'skipped': 0,
        'errors': errors,
    }


# ---------------------------------------------------------------------------
# 3. Webhook Processing
# ---------------------------------------------------------------------------

def process_webhook(token: str, payload: dict, headers: dict = None, source_ip: str = None):
    """
    Handle an inbound webhook POST.

    1. Look up the EventSubscription by webhook_token
    2. Optionally verify HMAC signature
    3. Record WebhookEvent
    4. Dispatch execution

    Returns:
        {'success': True, 'event_id': ..., 'execution_id': ...}
        or
        {'success': False, 'error': ...}
    """
    from .models import EventSubscription, WebhookEvent

    try:
        sub = EventSubscription.objects.select_related('workflow', 'node').get(
            webhook_token=token,
            status='active',
        )
    except EventSubscription.DoesNotExist:
        return {'success': False, 'error': 'Invalid or inactive webhook token.'}

    workflow = sub.workflow

    if not workflow.is_active:
        return {'success': False, 'error': 'Workflow is not active.'}

    # HMAC verification (optional)
    if sub.webhook_secret:
        signature = (headers or {}).get('X-Webhook-Signature', '')
        if not signature:
            signature = (headers or {}).get('x-webhook-signature', '')
        if signature:
            import json
            expected = hmac.new(
                sub.webhook_secret.encode(),
                json.dumps(payload, sort_keys=True).encode(),
                hashlib.sha256,
            ).hexdigest()
            if not hmac.compare_digest(signature, expected):
                return {'success': False, 'error': 'Invalid webhook signature.'}

    # Dispatch
    result = dispatch_event(
        event_type='webhook_call',
        source_type='webhook',
        source_id=str(sub.webhook_token),
        payload=payload,
        idempotency_key=payload.get('delivery_id', ''),
        organization_id=sub.organization_id,
        source_ip=source_ip,
    )

    if result['dispatched'] > 0:
        evt = result['events'][0]
        return {
            'success': True,
            'event_id': evt['event_id'],
            'execution_id': evt['execution_id'],
        }
    elif result['skipped'] > 0:
        return {'success': True, 'message': 'Duplicate event — already processed.'}
    else:
        return {
            'success': False,
            'error': result['errors'][0]['error'] if result['errors'] else 'No workflow dispatched.',
        }


# ---------------------------------------------------------------------------
# 4. Poll a single subscription (for Celery tasks)
# ---------------------------------------------------------------------------

def poll_subscription(subscription_id: str):
    """
    Poll a single time-based subscription (email, cloud drive, etc.)
    and trigger workflow execution if new data is found.

    Called by the Celery task `poll_single_subscription`.
    """
    from .models import EventSubscription, WebhookEvent

    try:
        sub = EventSubscription.objects.select_related('workflow', 'node').get(
            id=subscription_id,
        )
    except EventSubscription.DoesNotExist:
        return {'status': 'not_found'}

    if sub.status != 'active':
        return {'status': 'inactive'}

    workflow = sub.workflow
    if not workflow.is_active or not workflow.is_live:
        return {'status': 'workflow_inactive'}

    node = sub.node
    config = node.config or {}

    found = 0
    errors_list = []

    try:
        if sub.source_type == 'email':
            from .listener_executor import check_email_inbox
            result = check_email_inbox(
                node=node,
                user=workflow.created_by,
                auto_execute_override=False,  # We handle execution here
            )
            found = result.get('found', 0)
            errors_list = result.get('errors', [])

        elif sub.source_type in ('google_drive', 'dropbox', 'onedrive', 's3', 'ftp', 'url_scrape'):
            from .source_integrations import fetch_from_source
            result = fetch_from_source(
                node, workflow, workflow.organization,
                user=workflow.created_by,
            )
            found = result.get('found', 0)
            errors_list = result.get('errors', [])

        elif sub.source_type == 'folder':
            # Folder watch re-imports from DriveFolder
            # The _execute_input_node handles this — trigger a full execution
            found = 1  # Treat as "something may have changed"

        # Update subscription
        sub.last_polled_at = timezone.now()
        sub.next_poll_at = timezone.now() + timezone.timedelta(seconds=sub.poll_interval)
        sub.consecutive_errors = 0
        sub.last_error = ''
        sub.total_events_received += 1
        sub.save(update_fields=[
            'last_polled_at', 'next_poll_at', 'consecutive_errors',
            'last_error', 'total_events_received', 'updated_at',
        ])

        # If new data found, trigger execution
        if found > 0:
            event = WebhookEvent.objects.create(
                subscription=sub,
                workflow=workflow,
                organization=sub.organization,
                event_type=f'poll_{sub.source_type}',
                status='received',
                payload={'found': found, 'errors': errors_list},
            )

            from .models import WorkflowExecution
            from .tasks import execute_workflow_async

            execution = WorkflowExecution.objects.create(
                workflow=workflow,
                status='queued',
                mode='auto',
                triggered_by=workflow.created_by,
            )

            execute_workflow_async.delay(
                workflow_id=str(workflow.id),
                execution_id=str(execution.id),
                user_id=workflow.created_by_id,
                mode='full',
                smart=True,
            )

            event.status = 'processing'
            event.execution = execution
            event.save(update_fields=['status', 'execution'])

            sub.total_executions_triggered += 1
            sub.save(update_fields=['total_executions_triggered'])

            return {
                'status': 'triggered',
                'found': found,
                'execution_id': str(execution.id),
            }

        return {'status': 'no_changes', 'found': 0}

    except Exception as e:
        error_msg = str(e)
        sub.consecutive_errors += 1
        sub.last_error = error_msg
        sub.last_error_at = timezone.now()
        # Exponential backoff: double the poll interval on each error, cap at 1 hour
        backoff = min(sub.poll_interval * (2 ** sub.consecutive_errors), 3600)
        sub.next_poll_at = timezone.now() + timezone.timedelta(seconds=backoff)
        sub.save(update_fields=[
            'consecutive_errors', 'last_error', 'last_error_at',
            'next_poll_at', 'updated_at',
        ])

        logger.error(f"Poll failed for subscription {subscription_id}: {e}")
        return {'status': 'error', 'error': error_msg}


# ---------------------------------------------------------------------------
# 5. Sheet Event Handler
# ---------------------------------------------------------------------------

def handle_sheet_update(sheet_id: str, changed_data: dict = None, user=None):
    """
    Called when a Sheet is updated (via signal or API hook).
    Dispatches events to all workflows subscribed to this sheet.

    The changed_data dict should contain:
      - changed_row_orders: [int]  — which rows changed
      - changed_row_ids: [str]     — UUIDs of changed rows
      - total_changed: int         — count of changed rows

    Only rows with actual data changes (detected via row_hash) are included.
    If changed_data is empty / has no changed rows, no event is dispatched.
    """
    changed_data = changed_data or {}

    # Don't dispatch if no rows actually changed
    if not changed_data.get('changed_row_orders') and not changed_data.get('total_changed'):
        return {'dispatched': 0, 'events': [], 'skipped': 0, 'errors': [],
                'message': 'No rows changed — skipped dispatch.'}

    result = dispatch_event(
        event_type='sheet_updated',
        source_type='sheet',
        source_id=str(sheet_id),
        payload={
            'sheet_id': str(sheet_id),
            'changed_data': changed_data,
            'changed_row_orders': changed_data.get('changed_row_orders', []),
            'changed_row_ids': changed_data.get('changed_row_ids', []),
            'updated_by': user.username if user else None,
            'updated_at': timezone.now().isoformat(),
        },
    )
    return result


# ---------------------------------------------------------------------------
# 5b. Document Event Handler
# ---------------------------------------------------------------------------

def handle_document_update(document_id: str, change_summary: dict = None, user=None):
    """
    Called when a Document (documents app) is updated via partial-save.

    Dispatches events to all workflows that have an EventSubscription
    with source_type='document' and source_id=<document_id>.

    Also auto-discovers workflows linked via DocumentCreationResult:
    if the document was created by a CLM workflow, the originating
    workflow is triggered even without an explicit document subscription.

    Args:
        document_id: UUID of the documents.Document that was edited.
        change_summary: Optional dict describing what changed, e.g.
            {'changes_applied': 3, 'types': ['section', 'paragraph']}.
        user: The user who made the edit.
    """
    change_summary = change_summary or {}

    # ── 1. Direct subscriptions (input node source_type='document') ──
    result = dispatch_event(
        event_type='document_updated',
        source_type='document',
        source_id=str(document_id),
        payload={
            'document_id': str(document_id),
            'change_summary': change_summary,
            'updated_by': user.username if user else None,
            'updated_at': timezone.now().isoformat(),
        },
    )

    # ── 2. Auto-discover via DocumentCreationResult ──────────────────
    # If this document was created by a CLM workflow (doc_create node),
    # re-trigger that workflow so it can re-process the updated document.
    from .models import DocumentCreationResult, WebhookEvent, WorkflowExecution

    creation_records = DocumentCreationResult.objects.filter(
        created_document_id=document_id,
        status='created',
    ).select_related('workflow')

    for record in creation_records:
        workflow = record.workflow
        if not workflow.is_active or not workflow.is_live:
            continue
        if workflow.compilation_status != 'compiled':
            continue

        # Check we haven't already dispatched to this workflow via direct sub
        already_dispatched = any(
            e.get('workflow_id') == str(workflow.id)
            for e in result.get('events', [])
        )
        if already_dispatched:
            continue

        # Direct execution — the workflow may not have a document
        # EventSubscription, so we trigger execution directly.
        try:
            execution = WorkflowExecution.objects.create(
                workflow=workflow,
                status='queued',
                mode='auto',
                triggered_by=workflow.created_by,
                trigger_context={
                    'document_id': str(document_id),
                    'change_summary': change_summary,
                    'creation_record_id': str(record.id),
                    'source_clm_document_id': str(record.source_clm_document_id),
                    'trigger': 'document_update_auto',
                    'updated_by': user.username if user else None,
                },
            )

            from .tasks import execute_workflow_async
            execute_workflow_async.delay(
                workflow_id=str(workflow.id),
                execution_id=str(execution.id),
                user_id=workflow.created_by_id,
                mode='full',
                smart=True,
            )

            result['dispatched'] += 1
            result['events'].append({
                'event_id': None,
                'workflow_id': str(workflow.id),
                'workflow_name': workflow.name,
                'execution_id': str(execution.id),
                'trigger': 'document_creation_record',
            })

        except Exception as e:
            logger.error(
                f"Failed to auto-trigger workflow '{workflow.name}' "
                f"for document {document_id}: {e}"
            )
            result['errors'].append({
                'workflow_id': str(workflow.id),
                'error': str(e),
            })

    return result


# ---------------------------------------------------------------------------
# 6. Node Execution Logging
# ---------------------------------------------------------------------------

def log_node_execution(
    execution,
    node,
    workflow,
    status: str,
    input_ids: list = None,
    output_ids: list = None,
    result_data: dict = None,
    error_message: str = '',
    error_traceback: str = '',
    started_at=None,
    completed_at=None,
    dag_level: int = 0,
):
    """
    Create or update a NodeExecutionLog entry for a specific node
    within a workflow execution.
    """
    from .models import NodeExecutionLog

    input_ids = input_ids or []
    output_ids = output_ids or []

    duration_ms = None
    if started_at and completed_at:
        duration_ms = int((completed_at - started_at).total_seconds() * 1000)

    # Flatten output_ids if it's a dict (validator nodes return {approved: [], rejected: []})
    flat_output = output_ids
    if isinstance(output_ids, dict):
        flat_output = []
        for v in output_ids.values():
            if isinstance(v, list):
                flat_output.extend(v)

    log, created = NodeExecutionLog.objects.update_or_create(
        execution=execution,
        node=node,
        defaults={
            'workflow': workflow,
            'status': status,
            'input_document_ids': [str(d) for d in input_ids],
            'output_document_ids': [str(d) for d in flat_output],
            'input_count': len(input_ids),
            'output_count': len(flat_output),
            'result_data': result_data or {},
            'error_message': error_message,
            'error_traceback': error_traceback,
            'started_at': started_at,
            'completed_at': completed_at,
            'duration_ms': duration_ms,
            'dag_level': dag_level,
        },
    )
    return log
