"""
CLM Celery Tasks — Async workflow execution + email inbox polling + DB cleanup
===============================================================================

Architecture
------------
  **Async workflow execution**
  1. ``execute_workflow_async`` is a shared_task that wraps the synchronous
     ``execute_workflow()`` function.  It receives a workflow_id + execution_id,
     marks the WorkflowExecution as running, runs the DAG, then marks it
     completed/failed.  The view dispatches this task and returns the
     execution_id immediately — the frontend polls ``execution-status``
     until it finishes.

  2. ``dispatch_live_workflows`` runs every 60s via Celery Beat.
     It finds all workflows with ``is_live=True`` and ``is_active=True``
     and fans out individual ``execute_workflow_async`` tasks for each one,
     using cache locks to prevent overlapping executions.

  **Email inbox polling**
  3. ``dispatch_email_checks`` runs every 30s via Celery Beat.
     It queries *only* email-inbox input nodes (DB-level filter),
     applies interval + error-backoff logic, and fans out individual
     ``check_single_email_node`` tasks for those that are due.

  4. ``check_single_email_node`` does the actual IMAP fetch for one node.
     It calls ``check_email_inbox()`` from listener_executor (which handles
     UNSEEN + cached-Message-ID dedup, auto-extract, auto-execute).
     A cache-based lock prevents the same node from being checked
     concurrently by two tasks (duplicate-dispatch guard).

  **DB retention / cleanup**
  5. ``cleanup_clm_tables`` runs daily (every 6 hours).  Prunes high-volume
     tables that grow unboundedly during live-mode operation:
     - ``SheetNodeQuery``  → keep 7 days, hard cap 50k rows
     - ``NodeExecutionLog`` → keep 14 days
     - ``WorkflowLiveEvent`` → keep 7 days
     - ``WorkflowExecution`` → keep 60 days
     - SQLite WAL checkpoint after deletions

Efficiency safeguards
---------------------
  - **DB-level filter**: Only email_inbox nodes with ``is_active`` workflows
    and a positive ``email_refetch_interval`` are loaded — no Python loop
    over every input node.
  - **Duplicate-dispatch guard**: ``cache.add()`` lock with TTL prevents
    the dispatcher from spawning a second task while one is still running.
  - **Error cooldown**: Nodes with recent errors get exponential backoff
    (base interval × 2^consecutive_errors, capped at 1 hour) so broken
    mailboxes aren't hammered every 30s.
  - **Rate limit**: ``10/m`` per worker — at most 10 IMAP connections per
    minute across all nodes.

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

# Maximum backoff cap for error cooldown (1 hour)
_MAX_ERROR_BACKOFF = 3600


# ---------------------------------------------------------------------------
# Async Workflow Execution
# ---------------------------------------------------------------------------

@shared_task(
    name='clm.tasks.execute_workflow_async',
    bind=True,
    max_retries=1,
    default_retry_delay=30,
    acks_late=True,
    reject_on_worker_lost=True,
    time_limit=600,          # hard kill after 10 min
    soft_time_limit=540,     # SoftTimeLimitExceeded after 9 min
)
def execute_workflow_async(
    self,
    workflow_id: str,
    execution_id: str,
    user_id: int | None = None,
    document_ids: list[str] | None = None,
    excluded_ids: list[str] | None = None,
    mode: str = 'full',
    smart: bool = False,
):
    """
    Async Celery wrapper around ``execute_workflow()``.

    The view creates a WorkflowExecution with status='queued', then
    dispatches this task.  This task:
      1. Marks execution → running
      2. Calls ``execute_workflow()`` synchronously
      3. Marks execution → completed / failed

    Locking is handled by the DB-based ``workflow.execution_state`` field
    (set/reset by ``execute_workflow()``'s try/finally).  No cache locks
    needed — LocMemCache is unreliable across processes.

    The frontend polls ``/execution-status/<exec_id>/`` for progress.
    """
    from django.contrib.auth import get_user_model

    from .models import Workflow, WorkflowExecution
    from .node_executor import execute_workflow

    User = get_user_model()

    try:
        workflow = Workflow.objects.get(id=workflow_id)
    except Workflow.DoesNotExist:
        logger.error('[async-exec] Workflow %s not found', workflow_id)
        return {'status': 'workflow_not_found'}

    try:
        execution = WorkflowExecution.objects.get(id=execution_id)
    except WorkflowExecution.DoesNotExist:
        logger.error('[async-exec] Execution %s not found', execution_id)
        return {'status': 'execution_not_found'}

    # Resolve user (Celery tasks receive serializable args, not model instances)
    triggered_by = None
    if user_id:
        try:
            triggered_by = User.objects.get(pk=user_id)
        except User.DoesNotExist:
            pass

    # Mark running
    execution.status = 'running'
    execution.save(update_fields=['status'])

    logger.info(
        '[async-exec] STARTING workflow=%s (%s) exec=%s mode=%s smart=%s '
        'is_live=%s compiled=%s doc_ids=%s',
        workflow.name, workflow_id, execution_id, mode, smart,
        workflow.is_live, workflow.compilation_status, document_ids,
    )

    start = time.time()
    try:
        # Pass the pre-created execution record so execute_workflow
        # uses it directly (no duplicate record created).
        result = execute_workflow(
            workflow,
            triggered_by=triggered_by,
            single_document_ids=document_ids if document_ids else None,
            excluded_document_ids=excluded_ids if excluded_ids else None,
            mode=mode,
            smart=smart,
            execution=execution,
        )

        elapsed_ms = int((time.time() - start) * 1000)

        # Refresh from DB — execute_workflow already saved the record
        execution.refresh_from_db()

        logger.info(
            '[async-exec] Workflow %s COMPLETED (%dms, status=%s)',
            workflow.name, elapsed_ms, execution.status,
        )
        return {
            'status': execution.status,
            'execution_id': str(execution.id),
            'duration_ms': elapsed_ms,
        }

    except Exception as exc:
        elapsed_ms = int((time.time() - start) * 1000)
        logger.error(
            '[async-exec] Workflow %s FAILED (%dms): %s',
            workflow.name, elapsed_ms, exc,
        )
        # execute_workflow's try/finally already resets execution_state,
        # but the execution record may not have been finalised if the
        # crash happened before the executor could save it.
        execution.refresh_from_db()
        if execution.status in ('queued', 'running'):
            execution.status = 'failed'
            execution.result_data = {'error': str(exc)[:2000]}
            execution.completed_at = timezone.now()
            execution.duration_ms = elapsed_ms
            execution.save()
        # Belt-and-suspenders: ensure workflow state is idle
        workflow.refresh_from_db(fields=['execution_state', 'current_execution_id'])
        if workflow.execution_state != 'idle':
            workflow.execution_state = 'idle'
            workflow.current_execution_id = None
            workflow.save(update_fields=['execution_state', 'current_execution_id', 'updated_at'])
        return {
            'status': 'failed',
            'execution_id': str(execution.id),
            'error': str(exc)[:500],
        }


@shared_task(name='clm.tasks.dispatch_live_workflows')
def dispatch_live_workflows():
    """
    Master dispatcher for live workflows — runs every 60s via Beat.

    Finds all workflows with ``is_live=True`` and ``is_active=True``,
    checks if enough time has elapsed since the last execution (based on
    ``live_interval``), and dispatches async execution tasks.

    **Important**: Workflows that are fully event-driven (all input sources
    are sheets or webhooks) are SKIPPED here — they're triggered by
    handle_sheet_update() or process_webhook() instead.  This prevents
    duplicate/conflicting executions.
    """
    from django.core.cache import cache

    from .models import EventSubscription, Workflow, WorkflowExecution

    now = timezone.now()
    due_count = 0
    skipped_event_driven = 0

    live_workflows = Workflow.objects.filter(
        is_active=True,
        is_live=True,
    ).select_related('organization')

    logger.info(
        '[live-dispatch] dispatch_live_workflows — found %d live+active workflows',
        live_workflows.count(),
    )

    # Event-driven source types — workflows using ONLY these don't need
    # cron-based polling.
    _EVENT_DRIVEN_TYPES = {'sheet', 'webhook'}

    for workflow in live_workflows:
        wf_id = str(workflow.id)

        # ── Check if this workflow is fully event-driven ─────────
        # If ALL active subscriptions are event-driven (sheets/webhooks),
        # skip — they're handled by real-time events, not this cron.
        active_subs = list(
            EventSubscription.objects.filter(
                workflow=workflow,
                status='active',
            ).values_list('source_type', flat=True)
        )
        if active_subs and all(st in _EVENT_DRIVEN_TYPES for st in active_subs):
            skipped_event_driven += 1
            logger.debug('[live-dispatch] %s — fully event-driven (%s), skipped', workflow.name, active_subs)
            continue

        # ── Interval check — has enough time elapsed? ────────────
        interval = workflow.live_interval or 60
        if workflow.last_executed_at:
            elapsed = (now - workflow.last_executed_at).total_seconds()
            if elapsed < interval:
                logger.debug('[live-dispatch] %s — not due yet (%.0fs / %ds)', workflow.name, elapsed, interval)
                continue  # Not due yet

        # ── Duplicate-dispatch guard ─────────────────────────────
        lock_key = f'clm:workflow_exec:{wf_id}'
        lock_ttl = max(interval * 3, 300)  # auto-expire even if task crashes
        if not cache.add(lock_key, 'dispatched', lock_ttl):
            logger.debug('[live-dispatch] %s — lock held, skipped', workflow.name)
            continue

        # Create a queued execution record
        execution = WorkflowExecution.objects.create(
            workflow=workflow,
            status='queued',
            mode='auto',
            triggered_by=workflow.created_by,
        )

        # Dispatch the async task
        execute_workflow_async.delay(
            workflow_id=wf_id,
            execution_id=str(execution.id),
            user_id=workflow.created_by_id,
            mode='full',
            smart=True,  # Live mode always uses smart execution
        )
        due_count += 1
        logger.info('[live-dispatch] Dispatched async exec for "%s" (exec=%s)', workflow.name, execution.id)

    if due_count or skipped_event_driven:
        logger.info(
            '[live-dispatch] Result: dispatched=%d, skipped_event_driven=%d',
            due_count, skipped_event_driven,
        )


@shared_task(name='clm.tasks.dispatch_email_checks')
def dispatch_email_checks():
    """
    Master dispatcher — runs every 30s via Beat.
    Finds email input nodes that are due for a check and
    fans out individual check tasks.
    """
    from django.core.cache import cache
    from django.utils.dateparse import parse_datetime

    from .models import WorkflowNode

    now = timezone.now()
    due_count = 0

    # DB-level filter: only input nodes on active workflows whose config
    # contains source_type=email_inbox.  On SQLite / Postgres the
    # JSONField __contains lookup narrows the result set in the DB
    # instead of loading every node into Python.
    email_nodes = WorkflowNode.objects.filter(
        node_type='input',
        workflow__is_active=True,
        config__source_type='email_inbox',
    ).select_related('workflow')

    for node in email_nodes:
        config = node.config or {}
        node_id_str = str(node.id)

        # ── Must have a positive refetch interval ────────────────
        interval = config.get('email_refetch_interval', 0)
        if not interval or interval <= 0:
            continue

        # ── Must have valid IMAP credentials ─────────────────────
        if not config.get('email_user') or not config.get('email_host'):
            continue

        # ── Error cooldown — exponential backoff on failures ─────
        consecutive_errors = config.get('email_consecutive_errors', 0)
        if consecutive_errors > 0:
            backoff = min(interval * (2 ** consecutive_errors), _MAX_ERROR_BACKOFF)
        else:
            backoff = interval

        # ── Interval check — has enough time elapsed? ────────────
        last_checked = config.get('email_last_checked_at')
        if last_checked:
            try:
                last_dt = parse_datetime(last_checked)
                if last_dt and (now - last_dt).total_seconds() < backoff:
                    continue  # Not due yet
            except (ValueError, TypeError):
                pass  # Invalid date — run anyway

        # ── Duplicate-dispatch guard ─────────────────────────────
        # cache.add() is atomic — returns False if the key already exists.
        # TTL = 5 × interval so it auto-expires even if the task crashes.
        lock_key = f'clm:email_check:{node_id_str}'
        lock_ttl = max(int(backoff * 5), 300)
        if not cache.add(lock_key, 'dispatched', lock_ttl):
            logger.debug(f'[email-dispatch] Skipping {node_id_str} — lock held')
            continue

        check_single_email_node.delay(node_id_str)
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

    On success, resets ``email_consecutive_errors`` to 0.
    On failure, increments ``email_consecutive_errors`` so the
    dispatcher applies exponential backoff on the next tick.
    """
    from django.core.cache import cache

    from .listener_executor import check_email_inbox
    from .models import WorkflowNode

    lock_key = f'clm:email_check:{node_id}'

    try:
        node = WorkflowNode.objects.select_related('workflow').get(id=node_id)
    except WorkflowNode.DoesNotExist:
        logger.warning(f'[email-check] Node {node_id} not found, skipping')
        cache.delete(lock_key)
        return {'status': 'node_not_found'}

    config = node.config or {}
    workflow = node.workflow

    if not workflow.is_active:
        cache.delete(lock_key)
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
        # Increment consecutive error counter for backoff
        config['email_last_checked_at'] = timezone.now().isoformat()
        config['email_last_check_error'] = str(exc)[:500]
        config['email_last_check_status'] = 'error'
        config['email_consecutive_errors'] = config.get('email_consecutive_errors', 0) + 1
        node.config = config
        node.save(update_fields=['config'])
        cache.delete(lock_key)
        raise self.retry(exc=exc)

    elapsed_ms = int((time.time() - start) * 1000)

    # ── Stamp success metadata + reset error counter ─────────────
    config['email_last_checked_at'] = timezone.now().isoformat()
    config['email_last_check_status'] = 'ok'
    config['email_last_check_found'] = result.get('found', 0)
    config['email_last_check_skipped'] = result.get('skipped', 0)
    config['email_last_check_error'] = ''
    config['email_last_check_ms'] = elapsed_ms
    config['email_consecutive_errors'] = 0     # reset on success
    node.config = config
    node.save(update_fields=['config'])

    # Release the dispatch lock
    cache.delete(lock_key)

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


# ---------------------------------------------------------------------------
# Event-Based Subscription Dispatcher
# ---------------------------------------------------------------------------

@shared_task(name='clm.tasks.dispatch_event_subscriptions')
def dispatch_event_subscriptions():
    """
    Master dispatcher for time-based event subscriptions — runs every 30s.

    Finds all active EventSubscriptions that are due for polling (based on
    next_poll_at) and fans out individual ``poll_single_subscription`` tasks.

    Event-driven subscriptions (sheets, webhooks) are NOT polled — they
    fire immediately via signals/webhook endpoints.  This task only handles
    time-based sources: email, cloud drives, URL scrape, etc.
    """
    from django.core.cache import cache

    from .models import EventSubscription

    now = timezone.now()
    due_count = 0

    # Time-based source types that need polling
    POLL_TYPES = ['email', 'google_drive', 'dropbox', 'onedrive', 's3', 'ftp', 'url_scrape', 'folder', 'dms']

    # DB-level filter: only active subscriptions on live/compiled workflows
    # with a positive poll interval. Due-check done in Python below since
    # OR(null, lte) requires Q objects.
    subs = EventSubscription.objects.filter(
        status='active',
        source_type__in=POLL_TYPES,
        poll_interval__gt=0,
        workflow__is_active=True,
        workflow__is_live=True,
        workflow__compilation_status='compiled',
    ).select_related('workflow', 'node')

    for sub in subs:
        # Check if due
        if sub.next_poll_at and sub.next_poll_at > now:
            continue  # Not due yet

        # Error backoff
        if sub.consecutive_errors > 0:
            backoff = min(
                sub.poll_interval * (2 ** sub.consecutive_errors),
                _MAX_ERROR_BACKOFF,
            )
            if sub.last_error_at:
                elapsed = (now - sub.last_error_at).total_seconds()
                if elapsed < backoff:
                    continue  # In backoff period

        sub_id = str(sub.id)

        # Duplicate-dispatch guard
        lock_key = f'clm:sub_poll:{sub_id}'
        lock_ttl = max(sub.poll_interval * 5, 300)
        if not cache.add(lock_key, 'dispatched', lock_ttl):
            logger.debug(f'[sub-dispatch] Skipping {sub_id} — lock held')
            continue

        poll_single_subscription.delay(sub_id)
        due_count += 1

    if due_count:
        logger.info(f'[sub-dispatch] Dispatched {due_count} subscription poll(s)')


@shared_task(
    name='clm.tasks.poll_single_subscription',
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    rate_limit='15/m',
    acks_late=True,
    reject_on_worker_lost=True,
    time_limit=300,
    soft_time_limit=270,
)
def poll_single_subscription(self, subscription_id: str):
    """
    Poll a single event subscription for new data.

    Delegates to ``event_system.poll_subscription()`` which handles:
    - Email inbox checking via IMAP
    - Cloud drive scanning (Google Drive, Dropbox, etc.)
    - FTP/SFTP folder listing
    - URL scraping for changes

    On success, triggers workflow execution if new data found.
    On failure, increments error counter for exponential backoff.
    """
    from django.core.cache import cache

    from .event_system import poll_subscription

    lock_key = f'clm:sub_poll:{subscription_id}'

    try:
        result = poll_subscription(subscription_id)
    except Exception as exc:
        logger.error(f'[sub-poll] Subscription {subscription_id} failed: {exc}')
        cache.delete(lock_key)
        raise self.retry(exc=exc)

    # Release dispatch lock
    cache.delete(lock_key)

    if result.get('status') == 'triggered':
        logger.info(
            f'[sub-poll] ✅ Subscription {subscription_id} triggered execution '
            f'(found={result.get("found", 0)})'
        )
    else:
        logger.debug(
            f'[sub-poll] Subscription {subscription_id}: {result.get("status", "unknown")}'
        )

    return result


# ---------------------------------------------------------------------------
# DB Retention / Cleanup — prevents unbounded table growth
# ---------------------------------------------------------------------------

# Retention policy constants (easily tunable)
_SHEET_QUERY_RETENTION_DAYS = 7
_SHEET_QUERY_HARD_CAP = 50_000          # absolute max rows across all workflows
_NODE_LOG_RETENTION_DAYS = 14
_LIVE_EVENT_RETENTION_DAYS = 7
_EXECUTION_RETENTION_DAYS = 60
_EXECUTION_KEEP_PER_WORKFLOW = 200      # always keep the most recent N per workflow

# Batch-delete size to avoid long-held locks on SQLite
_DELETE_BATCH_SIZE = 5000


@shared_task(
    name='clm.tasks.cleanup_clm_tables',
    time_limit=300,
    soft_time_limit=270,
)
def cleanup_clm_tables():
    """
    Periodic retention task — prunes high-volume CLM tables.

    Runs every 6 hours via Celery Beat.  Targets the tables that grow
    fastest during live-mode operation:

      1. ``SheetNodeQuery``  — one row per sheet cell read/written per
         execution.  Retention: 7 days, hard cap 50k rows total.
      2. ``NodeExecutionLog`` — one row per node per execution.
         Retention: 14 days.
      3. ``WorkflowLiveEvent`` — event triggers for live workflows.
         Retention: 7 days.
      4. ``WorkflowExecution`` — top-level execution records.
         Retention: 60 days, always keep last 200 per workflow.

    After deletions, issues a WAL checkpoint on SQLite to reclaim space
    immediately (otherwise the WAL can grow to match the deleted data).

    Deletes are done in batches of 5000 to avoid locking the DB for
    too long on SQLite.
    """
    from datetime import timedelta

    from django.db import connection

    from .models import (
        NodeExecutionLog,
        SheetNodeQuery,
        WorkflowExecution,
        WorkflowLiveEvent,
    )

    now = timezone.now()
    totals = {}

    # ── 1. SheetNodeQuery — age-based + hard cap ─────────────────
    cutoff = now - timedelta(days=_SHEET_QUERY_RETENTION_DAYS)
    deleted = _batch_delete(SheetNodeQuery.objects.filter(created_at__lt=cutoff))
    totals['sheet_queries_age'] = deleted

    # Hard cap: if still over limit, delete oldest surplus
    remaining = SheetNodeQuery.objects.count()
    if remaining > _SHEET_QUERY_HARD_CAP:
        surplus = remaining - _SHEET_QUERY_HARD_CAP
        oldest_ids = list(
            SheetNodeQuery.objects.order_by('created_at')
            .values_list('id', flat=True)[:surplus]
        )
        deleted = _batch_delete(SheetNodeQuery.objects.filter(id__in=oldest_ids))
        totals['sheet_queries_cap'] = deleted
    else:
        totals['sheet_queries_cap'] = 0

    # ── 2. NodeExecutionLog — age-based ──────────────────────────
    cutoff = now - timedelta(days=_NODE_LOG_RETENTION_DAYS)
    deleted = _batch_delete(NodeExecutionLog.objects.filter(created_at__lt=cutoff))
    totals['node_logs'] = deleted

    # ── 3. WorkflowLiveEvent — age-based ─────────────────────────
    cutoff = now - timedelta(days=_LIVE_EVENT_RETENTION_DAYS)
    deleted = _batch_delete(WorkflowLiveEvent.objects.filter(created_at__lt=cutoff))
    totals['live_events'] = deleted

    # ── 4. WorkflowExecution — age-based, keep last N per wf ────
    cutoff = now - timedelta(days=_EXECUTION_RETENTION_DAYS)
    # First pass: delete anything older than retention period
    # BUT protect the most recent N per workflow.
    old_execs = WorkflowExecution.objects.filter(started_at__lt=cutoff)
    # Exclude IDs that are in the "keep" set for their workflow
    keep_ids = set()
    for wf_id in (
        old_execs.values_list('workflow_id', flat=True).distinct()
    ):
        recent = list(
            WorkflowExecution.objects.filter(workflow_id=wf_id)
            .order_by('-started_at')
            .values_list('id', flat=True)[:_EXECUTION_KEEP_PER_WORKFLOW]
        )
        keep_ids.update(recent)

    deletable = old_execs.exclude(id__in=keep_ids)
    deleted = _batch_delete(deletable)
    totals['executions'] = deleted

    # ── WAL checkpoint (SQLite only) ─────────────────────────────
    _wal_checkpoint(connection)

    total_deleted = sum(totals.values())
    if total_deleted > 0:
        logger.info('[cleanup] 🧹 CLM table cleanup: %s  (total=%d)', totals, total_deleted)
    else:
        logger.debug('[cleanup] CLM table cleanup: nothing to prune')

    return totals


def _batch_delete(queryset, batch_size: int = _DELETE_BATCH_SIZE) -> int:
    """Delete a queryset in batches to avoid long SQLite locks.

    Returns total number of rows deleted.
    """
    total = 0
    while True:
        # Get a batch of PKs
        batch_ids = list(queryset.values_list('pk', flat=True)[:batch_size])
        if not batch_ids:
            break
        count, _ = queryset.model.objects.filter(pk__in=batch_ids).delete()
        total += count
    return total


def _wal_checkpoint(connection):
    """Issue a WAL checkpoint on SQLite to reclaim space after deletes.

    No-op on other database backends.
    """
    if connection.vendor == 'sqlite':
        try:
            with connection.cursor() as cursor:
                cursor.execute('PRAGMA wal_checkpoint(TRUNCATE);')
                result = cursor.fetchone()
                logger.debug('[cleanup] WAL checkpoint: %s', result)
        except Exception as exc:
            logger.warning('[cleanup] WAL checkpoint failed: %s', exc)
