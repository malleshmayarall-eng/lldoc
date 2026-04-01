"""
CLM System Debug Views — Celery / Redis / Workflow Health Monitoring
=====================================================================

Optimised for speed:
  * Single Celery inspect call shared by celery-health + task-queue.
  * ThreadPoolExecutor runs Celery inspect, Redis probe, and DB queries
    in parallel — system-status returns in ~1.5 s instead of ~10+ s.
  * 10-second in-memory cache prevents hammering on rapid polling.
  * Reduced inspect timeout from 3 s to 1.5 s.

Endpoints (mounted at /api/clm/debug/):
  GET  system-status/       — Full snapshot (parallelised)
  GET  celery-health/       — Celery workers only
  GET  redis-health/        — Redis only
  GET  task-queue/          — Active / reserved / scheduled tasks
  GET  live-workflows/      — All is_live workflows + stuck detection
  GET  recent-executions/   — Last N executions (filterable)
  GET  beat-schedule/       — Celery Beat periodic tasks
  GET  task-history/        — 24 h execution stats + recent list
"""

import logging
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from django.conf import settings
from django.db.models import Avg, Count, Max, Q
from django.utils import timezone
from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet

logger = logging.getLogger(__name__)

# ── In-memory cache (per-process, thread-safe) ─────────────────────
_cache = {}
_cache_lock = threading.Lock()
CACHE_TTL = 10  # seconds


def _get_cached(key):
    with _cache_lock:
        entry = _cache.get(key)
        if entry and (time.time() - entry['ts']) < CACHE_TTL:
            return entry['data']
    return None


def _set_cached(key, data):
    with _cache_lock:
        _cache[key] = {'ts': time.time(), 'data': data}


# ── Celery inspect helper (single round-trip, cached) ──────────────
INSPECT_TIMEOUT = 0.5  # seconds — fast-fail, local Redis is ~3ms


def _inspect_all():
    """
    Run ONE Celery inspect pass and cache the results for CACHE_TTL.
    Only fetches: ping, stats, active (most useful for debug).
    Reserved/scheduled/registered are fetched lazily if requested separately.
    """
    cached = _get_cached('celery_inspect')
    if cached is not None:
        return cached

    from drafter.celery import app as celery_app

    result = {
        'ping': {}, 'stats': {}, 'active': {},
        'registered': {}, 'reserved': {}, 'scheduled': {},
        'error': None,
    }
    try:
        insp = celery_app.control.inspect(timeout=INSPECT_TIMEOUT)
        # Only do the 3 most critical calls (saves ~4.5s vs 6 calls)
        result['ping'] = insp.ping() or {}
        result['stats'] = insp.stats() or {}
        result['active'] = insp.active() or {}
    except Exception as e:
        logger.warning('[debug] Celery inspect failed: %s', e)
        result['error'] = str(e)[:500]

    _set_cached('celery_inspect', result)
    return result


def _inspect_full():
    """
    Full inspect including reserved, scheduled, registered.
    Used only by the task-queue standalone endpoint.
    """
    cached = _get_cached('celery_inspect_full')
    if cached is not None:
        return cached

    from drafter.celery import app as celery_app

    # Start with the lightweight inspect data
    result = dict(_inspect_all())
    try:
        insp = celery_app.control.inspect(timeout=INSPECT_TIMEOUT)
        result['registered'] = insp.registered() or {}
        result['reserved'] = insp.reserved() or {}
        result['scheduled'] = insp.scheduled() or {}
    except Exception as e:
        logger.warning('[debug] Celery inspect (full) failed: %s', e)
        result['error'] = result.get('error') or str(e)[:500]

    _set_cached('celery_inspect_full', result)
    return result


# ====================================================================
# ViewSet
# ====================================================================

class SystemDebugViewSet(ViewSet):
    """Read-only system debug endpoints for Celery, Redis, workflow health."""

    permission_classes = [permissions.AllowAny]  # DEV — restrict in production

    # ── system-status (parallelised) ───────────────────────────────

    @action(detail=False, methods=['get'], url_path='system-status')
    def system_status(self, request):
        """
        GET /api/clm/debug/system-status/

        Runs Celery inspect, Redis probe, and DB queries in parallel.
        Results are cached for CACHE_TTL (10s).
        Typical response: ~1.5 s cold, ~5 ms cached.
        """
        # Check full-response cache first
        cached = _get_cached('system_status_full')
        if cached is not None:
            cached['cached'] = True
            return Response(cached)

        t0 = time.time()
        payload = {
            'timestamp': timezone.now().isoformat(),
            'celery': None, 'redis': None, 'beat_schedule': None,
            'task_queue': None, 'live_workflows': None,
            'recent_executions': None, 'task_history': None,
        }

        with ThreadPoolExecutor(max_workers=4) as pool:
            futs = {
                pool.submit(self._build_celery_and_queue): ('celery', 'task_queue'),
                pool.submit(self._get_redis_health): ('redis',),
                pool.submit(self._get_live_workflows): ('live_workflows',),
                pool.submit(self._get_db_data): ('recent_executions', 'task_history'),
            }
            for fut in as_completed(futs):
                keys = futs[fut]
                try:
                    res = fut.result()
                    if isinstance(res, tuple) and len(keys) == 2:
                        payload[keys[0]], payload[keys[1]] = res
                    elif isinstance(res, dict) and len(keys) == 2:
                        for k in keys:
                            payload[k] = res.get(k)
                    else:
                        payload[keys[0]] = res
                except Exception as e:
                    logger.warning('[debug] Parallel task %s failed: %s', keys, e)
                    for k in keys:
                        payload[k] = {'error': str(e)[:300]}

        payload['beat_schedule'] = self._get_beat_schedule()
        payload['response_time_ms'] = round((time.time() - t0) * 1000)
        payload['cached'] = False

        # Cache the full assembled response
        _set_cached('system_status_full', payload)

        return Response(payload)

    def _build_celery_and_queue(self):
        raw = _inspect_all()
        return (self._build_celery_health(raw), self._build_task_queue(raw))

    def _get_db_data(self):
        return {
            'recent_executions': self._get_recent_executions(limit=10),
            'task_history': self._get_task_history(limit=15),
        }

    # ── celery-health ──────────────────────────────────────────────

    @action(detail=False, methods=['get'], url_path='celery-health')
    def celery_health(self, request):
        raw = _inspect_all()
        return Response({
            'timestamp': timezone.now().isoformat(),
            **self._build_celery_health(raw),
        })

    @staticmethod
    def _build_celery_health(raw):
        result = {
            'status': 'unknown',
            'broker_url': SystemDebugViewSet._mask_url(
                getattr(settings, 'CELERY_BROKER_URL', '')),
            'result_backend': SystemDebugViewSet._mask_url(
                getattr(settings, 'CELERY_RESULT_BACKEND', '')),
            'workers': [],
            'total_workers': 0,
            'error': raw.get('error'),
        }
        if raw.get('error') and not raw['ping']:
            result['status'] = 'unreachable'
            return result

        workers = []
        for name, pong in raw['ping'].items():
            s = raw['stats'].get(name, {})
            a = raw['active'].get(name, [])
            r = raw['registered'].get(name, [])
            rusage = s.get('rusage', {})
            workers.append({
                'name': name,
                'status': 'online',
                'ping': pong,
                'active_tasks': len(a),
                'active_task_names': [t.get('name', '?') for t in a],
                'registered_tasks': len(r),
                'pool': {
                    'impl': s.get('pool', {}).get('implementation', ''),
                    'max_concurrency': s.get('pool', {}).get('max-concurrency', 0),
                    'processes': s.get('pool', {}).get('processes', []),
                },
                'total_tasks': s.get('total', {}),
                'prefetch_count': s.get('prefetch_count', 0),
                'pid': s.get('pid', 0),
                'clock': s.get('clock', 0),
                'uptime_utime': rusage.get('utime', 0),
                'uptime_stime': rusage.get('stime', 0),
            })

        result['workers'] = workers
        result['total_workers'] = len(workers)
        result['status'] = 'healthy' if workers else 'no_workers'
        return result

    # ── redis-health ───────────────────────────────────────────────

    @action(detail=False, methods=['get'], url_path='redis-health')
    def redis_health(self, request):
        return Response({
            'timestamp': timezone.now().isoformat(),
            **self._get_redis_health(),
        })

    @staticmethod
    def _get_redis_health():
        cached = _get_cached('redis_health')
        if cached is not None:
            return cached

        result = {
            'status': 'unknown',
            'url': SystemDebugViewSet._mask_url(
                getattr(settings, 'CELERY_BROKER_URL', '')),
            'server_info': {}, 'memory': {}, 'clients': {},
            'clm_keys': {}, 'error': None,
        }
        try:
            import redis as redis_lib
            r = redis_lib.from_url(
                settings.CELERY_BROKER_URL, socket_connect_timeout=2)

            t0 = time.time()
            pong = r.ping()
            latency = round((time.time() - t0) * 1000, 2)

            info = r.info()
            result['status'] = 'healthy' if pong else 'unhealthy'
            result['latency_ms'] = latency
            result['server_info'] = {
                'redis_version': info.get('redis_version', ''),
                'os': info.get('os', ''),
                'uptime_seconds': info.get('uptime_in_seconds', 0),
                'uptime_days': info.get('uptime_in_days', 0),
                'tcp_port': info.get('tcp_port', 0),
                'hz': info.get('hz', 0),
            }
            result['memory'] = {
                'used_memory_human': info.get('used_memory_human', ''),
                'used_memory_peak_human': info.get('used_memory_peak_human', ''),
                'used_memory_rss_human': info.get('used_memory_rss_human', ''),
                'maxmemory_human': info.get('maxmemory_human', ''),
                'mem_fragmentation_ratio': info.get('mem_fragmentation_ratio', 0),
            }
            result['clients'] = {
                'connected_clients': info.get('connected_clients', 0),
                'blocked_clients': info.get('blocked_clients', 0),
            }
            # Use SCAN instead of KEYS (production-safe)
            clm_keys = {}
            for pattern, label in [
                ('clm:workflow_exec:*', 'workflow_exec_locks'),
                ('clm:email_check:*',  'email_check_locks'),
                ('clm:sub_poll:*',     'sub_poll_locks'),
            ]:
                count = 0
                cursor = 0
                while True:
                    cursor, keys = r.scan(cursor, match=pattern, count=100)
                    count += len(keys)
                    if cursor == 0:
                        break
                clm_keys[label] = count
            try:
                clm_keys['celery_queue_depth'] = r.llen('celery')
            except Exception:
                clm_keys['celery_queue_depth'] = -1

            result['clm_keys'] = clm_keys
            db0 = info.get('db0', {})
            result['total_db_keys'] = (
                db0.get('keys', r.dbsize()) if isinstance(db0, dict)
                else r.dbsize()
            )
        except ImportError:
            result['status'] = 'error'
            result['error'] = 'redis package not installed'
        except Exception as e:
            logger.warning('[debug] Redis probe failed: %s', e)
            result['status'] = 'unreachable'
            result['error'] = str(e)[:500]

        _set_cached('redis_health', result)
        return result

    # ── task-queue ─────────────────────────────────────────────────

    @action(detail=False, methods=['get'], url_path='task-queue')
    def task_queue(self, request):
        raw = _inspect_full()
        return Response({
            'timestamp': timezone.now().isoformat(),
            **self._build_task_queue(raw),
        })

    @staticmethod
    def _build_task_queue(raw):
        result = {
            'active': [], 'reserved': [], 'scheduled': [],
            'total_active': 0, 'total_reserved': 0, 'total_scheduled': 0,
            'error': raw.get('error'),
        }
        for worker, tasks in raw.get('active', {}).items():
            for t in tasks:
                result['active'].append({
                    'worker': worker,
                    'task_id': t.get('id', ''),
                    'task_name': t.get('name', ''),
                    'args': str(t.get('args', ''))[:200],
                    'kwargs': str(t.get('kwargs', ''))[:200],
                    'started': t.get('time_start'),
                    'acknowledged': t.get('acknowledged', False),
                })
        for worker, tasks in raw.get('reserved', {}).items():
            for t in tasks:
                result['reserved'].append({
                    'worker': worker,
                    'task_id': t.get('id', ''),
                    'task_name': t.get('name', ''),
                })
        for worker, tasks in raw.get('scheduled', {}).items():
            for t in tasks:
                req = t.get('request', {})
                result['scheduled'].append({
                    'worker': worker,
                    'task_id': req.get('id', ''),
                    'task_name': req.get('name', ''),
                    'eta': t.get('eta', ''),
                    'priority': t.get('priority', 0),
                })
        result['total_active'] = len(result['active'])
        result['total_reserved'] = len(result['reserved'])
        result['total_scheduled'] = len(result['scheduled'])
        return result

    # ── live-workflows ─────────────────────────────────────────────

    @action(detail=False, methods=['get'], url_path='live-workflows')
    def live_workflows(self, request):
        return Response({
            'timestamp': timezone.now().isoformat(),
            'workflows': self._get_live_workflows(),
        })

    @staticmethod
    def _get_live_workflows():
        from .models import EventSubscription, Workflow, WorkflowExecution

        workflows = list(
            Workflow.objects
            .filter(is_live=True, is_active=True)
            .order_by('-updated_at')
        )
        wf_ids = [wf.id for wf in workflows]
        if not wf_ids:
            return []

        # Last execution per workflow (single query, SQLite-safe)
        latest_execs = {}
        try:
            # Postgres: use DISTINCT ON
            for ex in (
                WorkflowExecution.objects
                .filter(workflow_id__in=wf_ids)
                .order_by('workflow_id', '-started_at')
                .distinct('workflow_id')
            ):
                latest_execs[ex.workflow_id] = ex
        except Exception:
            # SQLite fallback
            for wf_id in wf_ids:
                ex = (
                    WorkflowExecution.objects
                    .filter(workflow_id=wf_id)
                    .order_by('-started_at')
                    .first()
                )
                if ex:
                    latest_execs[wf_id] = ex

        running_wf_ids = set(
            WorkflowExecution.objects
            .filter(workflow_id__in=wf_ids, status__in=['queued', 'running'])
            .values_list('workflow_id', flat=True)
        )

        subs_by_wf = {}
        for sub in (
            EventSubscription.objects
            .filter(workflow_id__in=wf_ids, status='active')
            .values('workflow_id', 'source_type', 'consecutive_errors', 'last_error')
        ):
            subs_by_wf.setdefault(sub['workflow_id'], []).append(sub)

        result = []
        for wf in workflows:
            last_exec = latest_execs.get(wf.id)
            is_stuck = (
                wf.execution_state not in ('idle', 'completed', 'failed')
                and wf.id not in running_wf_ids
            )
            result.append({
                'id': str(wf.id),
                'name': wf.name,
                'is_live': wf.is_live,
                'live_interval': wf.live_interval,
                'execution_state': wf.execution_state,
                'compilation_status': wf.compilation_status,
                'compiled_at': wf.compiled_at.isoformat() if wf.compiled_at else None,
                'last_executed_at': wf.last_executed_at.isoformat() if wf.last_executed_at else None,
                'auto_execute_on_upload': wf.auto_execute_on_upload,
                'is_stuck': is_stuck,
                'last_execution': {
                    'id': str(last_exec.id),
                    'status': last_exec.status,
                    'mode': last_exec.mode,
                    'duration_ms': last_exec.duration_ms,
                    'total_documents': last_exec.total_documents,
                    'started_at': last_exec.started_at.isoformat() if last_exec.started_at else None,
                    'completed_at': last_exec.completed_at.isoformat() if last_exec.completed_at else None,
                } if last_exec else None,
                'subscriptions': subs_by_wf.get(wf.id, []),
            })
        return result

    # ── recent-executions ──────────────────────────────────────────

    @action(detail=False, methods=['get'], url_path='recent-executions')
    def recent_executions(self, request):
        limit = min(int(request.query_params.get('limit', 20)), 100)
        status_filter = request.query_params.get('status', '')
        return Response({
            'timestamp': timezone.now().isoformat(),
            'executions': self._get_recent_executions(
                limit=limit, status_filter=status_filter),
        })

    @staticmethod
    def _get_recent_executions(limit=20, status_filter=''):
        from .models import WorkflowExecution

        qs = (
            WorkflowExecution.objects
            .select_related('workflow', 'triggered_by')
            .order_by('-started_at')
        )
        if status_filter:
            qs = qs.filter(status=status_filter)

        return [{
            'id': str(ex.id),
            'workflow_id': str(ex.workflow_id),
            'workflow_name': ex.workflow.name if ex.workflow else '?',
            'status': ex.status,
            'mode': ex.mode,
            'total_documents': ex.total_documents,
            'duration_ms': ex.duration_ms,
            'started_at': ex.started_at.isoformat() if ex.started_at else None,
            'completed_at': ex.completed_at.isoformat() if ex.completed_at else None,
            'triggered_by': ex.triggered_by.username if ex.triggered_by else None,
            'error_excerpt': str((ex.result_data or {}).get('error', ''))[:300]
                if isinstance(ex.result_data, dict) else '',
        } for ex in qs[:limit]]

    # ── beat-schedule ──────────────────────────────────────────────

    @action(detail=False, methods=['get'], url_path='beat-schedule')
    def beat_schedule(self, request):
        return Response({
            'timestamp': timezone.now().isoformat(),
            **self._get_beat_schedule(),
        })

    @staticmethod
    def _get_beat_schedule():
        schedule = getattr(settings, 'CELERY_BEAT_SCHEDULE', {})
        return {
            'tasks': [{
                'name': name,
                'task': cfg.get('task', ''),
                'schedule_seconds': (
                    cfg['schedule']
                    if isinstance(cfg.get('schedule'), (int, float))
                    else str(cfg.get('schedule', ''))
                ),
                'args': cfg.get('args', []),
                'kwargs': cfg.get('kwargs', {}),
                'options': cfg.get('options', {}),
            } for name, cfg in schedule.items()],
            'total': len(schedule),
        }

    # ── task-history (24 h) ────────────────────────────────────────

    @action(detail=False, methods=['get'], url_path='task-history')
    def task_history(self, request):
        limit = min(int(request.query_params.get('limit', 15)), 50)
        return Response({
            'timestamp': timezone.now().isoformat(),
            'tasks': self._get_task_history(limit=limit),
        })

    @staticmethod
    def _get_task_history(limit=15):
        from .models import WorkflowExecution

        since = timezone.now() - timezone.timedelta(hours=24)
        recent = list(
            WorkflowExecution.objects
            .filter(started_at__gte=since)
            .select_related('workflow', 'triggered_by')
            .order_by('-started_at')[:limit]
        )

        stats = (
            WorkflowExecution.objects
            .filter(started_at__gte=since)
            .aggregate(
                total=Count('id'),
                completed=Count('id', filter=Q(status='completed')),
                failed=Count('id', filter=Q(status='failed')),
                partial=Count('id', filter=Q(status='partial')),
                queued=Count('id', filter=Q(status='queued')),
                running=Count('id', filter=Q(status='running')),
                avg_duration=Avg('duration_ms'),
                max_duration=Max('duration_ms'),
            )
        )

        return {
            'recent': [{
                'execution_id': str(ex.id),
                'workflow_name': ex.workflow.name if ex.workflow else '?',
                'status': ex.status,
                'mode': ex.mode,
                'duration_ms': ex.duration_ms,
                'total_documents': ex.total_documents,
                'started_at': ex.started_at.isoformat() if ex.started_at else None,
                'completed_at': ex.completed_at.isoformat() if ex.completed_at else None,
                'triggered_by': ex.triggered_by.username if ex.triggered_by else None,
            } for ex in recent],
            'stats_24h': {
                **stats,
                'avg_duration_ms': round(stats['avg_duration'] or 0, 1),
                'max_duration_ms': stats['max_duration'] or 0,
                'success_rate': round(
                    stats['completed'] / stats['total'] * 100, 1
                ) if stats['total'] else 0,
            },
        }

    # ── Helpers ────────────────────────────────────────────────────

    @staticmethod
    def _mask_url(url: str) -> str:
        if not url:
            return ''
        try:
            from urllib.parse import urlparse, urlunparse
            parsed = urlparse(url)
            if parsed.password:
                masked = parsed._replace(
                    netloc=f'{parsed.username or ""}:***@{parsed.hostname}:{parsed.port or ""}'
                )
                return urlunparse(masked)
        except Exception:
            pass
        return url