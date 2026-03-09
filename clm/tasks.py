"""
CLM Celery Tasks — Server-side email inbox polling
====================================================

Architecture:
  1. `dispatch_email_checks` runs every 30s via Celery Beat.
     It scans all active workflow nodes with source_type=email_inbox
     and email_refetch_interval > 0, checks if enough time has elapsed
     since the last check, and spawns `check_single_email_node` tasks
     for those that are due.

  2. `check_single_email_node` does the actual IMAP fetch for one node.
     It calls the existing `check_email_inbox()` from listener_executor
     (which already handles UNSEEN + Message-ID dedup, auto-extract,
     auto-execute). After checking, it stamps `email_last_checked_at`
     on the node config so the dispatcher knows when it last ran.

This means:
  - Emails are received even when no browser is open
  - Each node's interval is respected independently
  - No duplicate processing (Message-ID dedup in check_email_inbox)
  - Zero client-side polling needed
  - Scales to many workflows/nodes via Celery's task queue

Start:
    celery -A drafter worker -B -l info     # worker + beat combined (dev)
    celery -A drafter worker -l info         # worker only (prod)
    celery -A drafter beat -l info           # beat only (prod)
"""
import logging
import time

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(name='clm.tasks.dispatch_email_checks')
def dispatch_email_checks():
    """
    Master dispatcher — runs every 30s via Beat.
    Finds email input nodes that are due for a check and
    fans out individual check tasks.
    """
    from .models import WorkflowNode

    now = timezone.now()
    due_count = 0

    # All input nodes configured for email_inbox with a refetch interval
    email_nodes = WorkflowNode.objects.filter(
        node_type='input',
        workflow__is_active=True,
    ).select_related('workflow')

    for node in email_nodes:
        config = node.config or {}
        if config.get('source_type') != 'email_inbox':
            continue

        interval = config.get('email_refetch_interval', 0)
        if not interval or interval <= 0:
            continue

        # Check if enough time has passed since last check
        last_checked = config.get('email_last_checked_at')
        if last_checked:
            try:
                from django.utils.dateparse import parse_datetime
                last_dt = parse_datetime(last_checked)
                if last_dt and (now - last_dt).total_seconds() < interval:
                    continue  # Not due yet
            except (ValueError, TypeError):
                pass  # Invalid date — run anyway

        # Has valid IMAP credentials?
        if not config.get('email_user') or not config.get('email_host'):
            continue

        # Dispatch the actual check as a separate task
        check_single_email_node.delay(str(node.id))
        due_count += 1

    if due_count:
        logger.info(f'[email-dispatch] Dispatched {due_count} email check(s)')


@shared_task(
    name='clm.tasks.check_single_email_node',
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    rate_limit='10/m',       # max 10 IMAP connections per minute
    acks_late=True,
    reject_on_worker_lost=True,
)
def check_single_email_node(self, node_id: str):
    """
    Check a single email input node's IMAP inbox.
    Called by the dispatcher or manually via the API.
    """
    from .listener_executor import check_email_inbox
    from .models import WorkflowNode

    try:
        node = WorkflowNode.objects.select_related('workflow').get(id=node_id)
    except WorkflowNode.DoesNotExist:
        logger.warning(f'[email-check] Node {node_id} not found, skipping')
        return {'status': 'node_not_found'}

    config = node.config or {}
    workflow = node.workflow

    if not workflow.is_active:
        return {'status': 'workflow_inactive'}

    logger.info(
        f'[email-check] Checking inbox for node {node.label or node_id} '
        f'(workflow: {workflow.name}, user: {config.get("email_user", "?")})'
    )

    start = time.time()
    try:
        result = check_email_inbox(node=node, user=None)
    except Exception as exc:
        logger.error(f'[email-check] Failed for node {node_id}: {exc}')
        # Stamp the error + timestamp so we don't hammer a broken mailbox
        config['email_last_checked_at'] = timezone.now().isoformat()
        config['email_last_check_error'] = str(exc)[:500]
        config['email_last_check_status'] = 'error'
        node.config = config
        node.save(update_fields=['config'])
        # Retry with backoff
        raise self.retry(exc=exc)

    elapsed_ms = int((time.time() - start) * 1000)

    # Stamp success metadata on the node config
    config['email_last_checked_at'] = timezone.now().isoformat()
    config['email_last_check_status'] = 'ok'
    config['email_last_check_found'] = result.get('found', 0)
    config['email_last_check_skipped'] = result.get('skipped', 0)
    config['email_last_check_error'] = ''
    config['email_last_check_ms'] = elapsed_ms
    node.config = config
    node.save(update_fields=['config'])

    found = result.get('found', 0)
    skipped = result.get('skipped', 0)
    errors = result.get('errors', [])

    if found:
        logger.info(
            f'[email-check] ✅ {found} new doc(s) from {config.get("email_user")} '
            f'({skipped} skipped, {elapsed_ms}ms)'
        )
    else:
        logger.debug(
            f'[email-check] No new emails for {config.get("email_user")} '
            f'({skipped} skipped, {elapsed_ms}ms)'
        )

    return {
        'status': 'ok',
        'node_id': node_id,
        'found': found,
        'skipped': skipped,
        'errors': errors,
        'elapsed_ms': elapsed_ms,
    }
