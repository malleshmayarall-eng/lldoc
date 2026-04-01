"""
CLM Dashboard Views — Live Workflow Monitoring & Analytics
===========================================================

Provides real-time and historical dashboard endpoints for CLM workflow
execution monitoring.  The frontend connects to the SSE stream for live
updates and uses the REST endpoints for initial page load + historical data.

Endpoints:
  Per-workflow:
    GET  /api/clm/workflows/{id}/live-dashboard/       — Full live dashboard snapshot
    GET  /api/clm/workflows/{id}/live-stream/           — SSE event stream (real-time)
    GET  /api/clm/workflows/{id}/live-metrics/          — Aggregated execution metrics
    GET  /api/clm/workflows/{id}/execution-timeline/    — Visual timeline of recent executions
    GET  /api/clm/workflows/{id}/node-performance/      — Per-node performance stats

  Organization-wide:
    GET  /api/clm/workflows/org-dashboard/              — All-workflows overview for org
    GET  /api/clm/workflows/live-workflows/             — Currently live workflows list
"""

import json
import logging
import time

from django.db.models import Avg, Count, F, Max, Min, Q, Sum
from django.http import StreamingHttpResponse
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

from .live_events import event_bus
from .models import (
    EventSubscription,
    NodeExecutionLog,
    WebhookEvent,
    Workflow,
    WorkflowDocument,
    WorkflowExecution,
    WorkflowLiveEvent,
    WorkflowNode,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Mixin — add these @action methods to WorkflowViewSet
# ---------------------------------------------------------------------------

class WorkflowDashboardMixin:
    """
    Mixin providing dashboard @action methods for WorkflowViewSet.
    Import and add to WorkflowViewSet's bases.
    """

    # -- Live Dashboard Snapshot -------------------------------------------

    @action(detail=True, methods=['get'], url_path='live-dashboard')
    def live_dashboard(self, request, pk=None):
        """
        GET /api/clm/workflows/{id}/live-dashboard/

        Returns a comprehensive snapshot of the workflow's current state
        suitable for rendering a live dashboard.  The frontend calls this
        on page load, then subscribes to ``/live-stream/`` for incremental
        updates.

        Response:
          {
            "workflow": {id, name, is_live, execution_state, ...},
            "current_execution": {id, status, progress, node_summary, ...} | null,
            "live_metrics": {total_executions, avg_duration_ms, ...},
            "recent_events": [...],
            "node_status": [{node_id, label, type, last_status, last_duration_ms, ...}],
            "subscription_health": [{source_type, status, last_polled, errors, ...}],
            "active_sse_connections": N,
          }
        """
        workflow = self.get_object()
        now = timezone.now()

        # ── Current execution (if any) ────────────────────────────────
        current_exec = None
        if workflow.execution_state not in ('idle', 'completed', 'failed'):
            exec_qs = WorkflowExecution.objects.filter(
                workflow=workflow,
                status__in=['queued', 'running'],
            ).order_by('-started_at').first()
            if exec_qs:
                elapsed = (now - exec_qs.started_at).total_seconds() if exec_qs.started_at else 0
                # Get live node logs for the current execution
                node_logs = NodeExecutionLog.objects.filter(
                    execution=exec_qs,
                ).select_related('node').order_by('dag_level', 'started_at')

                node_progress = []
                for log in node_logs:
                    node_progress.append({
                        'node_id': str(log.node_id),
                        'node_type': log.node.node_type if log.node else '',
                        'label': log.node.label if log.node else '',
                        'status': log.status,
                        'input_count': log.input_count,
                        'output_count': log.output_count,
                        'duration_ms': log.duration_ms,
                        'dag_level': log.dag_level,
                        'started_at': log.started_at.isoformat() if log.started_at else None,
                        'completed_at': log.completed_at.isoformat() if log.completed_at else None,
                        'error': log.error_message[:200] if log.error_message else '',
                    })

                current_exec = {
                    'execution_id': str(exec_qs.id),
                    'status': workflow.execution_state,  # use workflow-level state (executing/compiling/...)
                    'execution_status': exec_qs.status,  # raw DB status (running/completed/...)
                    'mode': exec_qs.mode,
                    'started_at': exec_qs.started_at.isoformat() if exec_qs.started_at else None,
                    'elapsed_seconds': round(elapsed, 1),
                    'total_documents': exec_qs.total_documents,
                    'node_summary': exec_qs.node_summary,
                    'node_progress': node_progress,
                }

        # ── Live metrics (last 24h) ──────────────────────────────────
        twenty_four_ago = now - timezone.timedelta(hours=24)
        recent_execs = WorkflowExecution.objects.filter(
            workflow=workflow,
            started_at__gte=twenty_four_ago,
        )
        metrics = recent_execs.aggregate(
            total_executions=Count('id'),
            avg_duration_ms=Avg('duration_ms'),
            max_duration_ms=Max('duration_ms'),
            min_duration_ms=Min('duration_ms'),
            completed=Count('id', filter=Q(status='completed')),
            failed=Count('id', filter=Q(status='failed')),
            partial=Count('id', filter=Q(status='partial')),
        )
        metrics['success_rate'] = (
            round(metrics['completed'] / metrics['total_executions'] * 100, 1)
            if metrics['total_executions'] else 0
        )

        # Total documents processed in 24h
        total_docs_24h = recent_execs.aggregate(
            total=Sum('total_documents'),
        )['total'] or 0
        metrics['documents_processed_24h'] = total_docs_24h

        # ── Recent events ─────────────────────────────────────────────
        recent_live_events = WorkflowLiveEvent.objects.filter(
            workflow=workflow,
        ).order_by('-created_at')[:30]
        events_data = [
            {
                'event_type': e.event_type,
                'node_type': e.node_type,
                'node_label': e.node_label,
                'status': e.status,
                'input_count': e.input_count,
                'output_count': e.output_count,
                'duration_ms': e.duration_ms,
                'data': e.data,
                'created_at': e.created_at.isoformat(),
            }
            for e in recent_live_events
        ]

        # ── Per-node status ───────────────────────────────────────────
        nodes = workflow.nodes.all().order_by('position_x', 'created_at')
        node_status = []
        for node in nodes:
            last_log = NodeExecutionLog.objects.filter(
                node=node,
            ).order_by('-created_at').first()

            node_info = {
                'node_id': str(node.id),
                'node_type': node.node_type,
                'label': node.label or node.get_node_type_display(),
                'last_status': last_log.status if last_log else 'never_run',
                'last_duration_ms': last_log.duration_ms if last_log else None,
                'last_input_count': last_log.input_count if last_log else 0,
                'last_output_count': last_log.output_count if last_log else 0,
                'last_run_at': last_log.completed_at.isoformat() if last_log and last_log.completed_at else None,
                'last_error': last_log.error_message[:200] if last_log and last_log.error_message else '',
            }

            # Input node document counts
            if node.node_type == 'input':
                ds = node.document_state or {}
                node_info['total_documents'] = ds.get('total_count', 0)
                node_info['ready_documents'] = ds.get('ready_count', 0)
                node_info['pending_documents'] = ds.get('pending_count', 0)
                node_info['failed_documents'] = ds.get('failed_count', 0)

            node_status.append(node_info)

        # ── Subscription health ───────────────────────────────────────
        subs = EventSubscription.objects.filter(
            workflow=workflow,
        ).select_related('node')
        sub_health = [
            {
                'subscription_id': str(s.id),
                'source_type': s.source_type,
                'status': s.status,
                'node_label': s.node.label if s.node else '',
                'poll_interval': s.poll_interval,
                'last_polled_at': s.last_polled_at.isoformat() if s.last_polled_at else None,
                'next_poll_at': s.next_poll_at.isoformat() if s.next_poll_at else None,
                'consecutive_errors': s.consecutive_errors,
                'last_error': s.last_error[:200] if s.last_error else '',
                'total_events': s.total_events_received,
                'total_executions': s.total_executions_triggered,
            }
            for s in subs
        ]

        return Response({
            'workflow': {
                'id': str(workflow.id),
                'name': workflow.name,
                'is_live': workflow.is_live,
                'is_active': workflow.is_active,
                'live_interval': workflow.live_interval,
                'execution_state': workflow.execution_state,
                'compilation_status': workflow.compilation_status,
                'compiled_at': workflow.compiled_at.isoformat() if workflow.compiled_at else None,
                'last_executed_at': workflow.last_executed_at.isoformat() if workflow.last_executed_at else None,
                'auto_execute_on_upload': workflow.auto_execute_on_upload,
            },
            'current_execution': current_exec,
            'live_metrics': metrics,
            'recent_events': events_data,
            'node_status': node_status,
            'subscription_health': sub_health,
            'active_sse_connections': event_bus.active_subscribers(str(workflow.id)),
        })

    # -- SSE Live Stream ---------------------------------------------------

    @action(detail=True, methods=['get'], url_path='live-stream')
    def live_stream(self, request, pk=None):
        """
        GET /api/clm/workflows/{id}/live-stream/

        Server-Sent Events (SSE) stream for real-time workflow execution
        updates.  The frontend connects with:

          const es = new EventSource('/api/clm/workflows/{id}/live-stream/');
          es.addEventListener('node_started', (e) => { ... });
          es.addEventListener('node_completed', (e) => { ... });
          es.addEventListener('execution_started', (e) => { ... });
          es.addEventListener('execution_completed', (e) => { ... });

        Sends keepalive comments every 30s to prevent proxy timeouts.
        Last-Event-ID header is supported for reconnection.

        Query params:
          ?include_recent=true  — replay last 20 events on connect (default: true)
        """
        workflow = self.get_object()
        wf_id = str(workflow.id)
        include_recent = request.query_params.get('include_recent', 'true').lower() == 'true'
        last_event_id = request.META.get('HTTP_LAST_EVENT_ID', '')

        def event_generator():
            # Send initial comment to confirm connection
            yield ': connected to live stream\n\n'

            # Replay recent events if requested (for initial page load)
            if include_recent:
                recent = event_bus.get_recent(wf_id, limit=20)
                # If reconnecting, skip events already received
                if last_event_id:
                    found = False
                    for i, evt in enumerate(recent):
                        if evt.event_id == last_event_id:
                            recent = recent[i + 1:]
                            found = True
                            break
                    if not found:
                        recent = recent[-10:]  # Fallback: send last 10

                for evt in recent:
                    yield evt.to_sse()

            # Subscribe and stream live events
            with event_bus.subscribe(wf_id) as sub:
                for event in sub.iter_events(timeout=30.0):
                    if event is None:
                        # Keepalive comment
                        yield ': keepalive\n\n'
                    else:
                        yield event.to_sse()

        response = StreamingHttpResponse(
            event_generator(),
            content_type='text/event-stream',
        )
        response['Cache-Control'] = 'no-cache'
        response['X-Accel-Buffering'] = 'no'  # Disable nginx buffering
        # Explicitly set CORS headers for SSE (StreamingHttpResponse may
        # bypass django-cors-headers middleware in some configurations)
        origin = request.META.get('HTTP_ORIGIN', '')
        allowed_origins = [
            'http://localhost:3000', 'http://127.0.0.1:3000',
            'http://localhost:3001', 'http://127.0.0.1:3001',
            'http://localhost:5173', 'http://127.0.0.1:5173',
        ]
        if origin in allowed_origins:
            response['Access-Control-Allow-Origin'] = origin
            response['Access-Control-Allow-Credentials'] = 'true'
        return response

    # -- Aggregated Execution Metrics --------------------------------------

    @action(detail=True, methods=['get'], url_path='live-metrics')
    def live_metrics(self, request, pk=None):
        """
        GET /api/clm/workflows/{id}/live-metrics/
        ?period=24h|7d|30d  (default: 24h)

        Returns aggregated execution metrics for the specified period.
        """
        workflow = self.get_object()
        period = request.query_params.get('period', '24h')
        now = timezone.now()

        if period == '7d':
            since = now - timezone.timedelta(days=7)
        elif period == '30d':
            since = now - timezone.timedelta(days=30)
        else:
            since = now - timezone.timedelta(hours=24)

        execs = WorkflowExecution.objects.filter(
            workflow=workflow,
            started_at__gte=since,
        )

        # Aggregate
        agg = execs.aggregate(
            total=Count('id'),
            completed=Count('id', filter=Q(status='completed')),
            failed=Count('id', filter=Q(status='failed')),
            partial=Count('id', filter=Q(status='partial')),
            avg_duration=Avg('duration_ms'),
            max_duration=Max('duration_ms'),
            min_duration=Min('duration_ms'),
            total_docs=Sum('total_documents'),
        )

        # Per-hour distribution (for charts)
        hourly = []
        if period == '24h':
            for h in range(24):
                hour_start = now - timezone.timedelta(hours=24 - h)
                hour_end = now - timezone.timedelta(hours=23 - h)
                count = execs.filter(
                    started_at__gte=hour_start,
                    started_at__lt=hour_end,
                ).count()
                hourly.append({
                    'hour': hour_start.strftime('%H:00'),
                    'executions': count,
                })

        # Per-node performance
        node_perf = NodeExecutionLog.objects.filter(
            workflow=workflow,
            started_at__gte=since,
        ).values(
            'node__id', 'node__node_type', 'node__label',
        ).annotate(
            exec_count=Count('id'),
            avg_duration=Avg('duration_ms'),
            max_duration=Max('duration_ms'),
            total_input=Sum('input_count'),
            total_output=Sum('output_count'),
            failures=Count('id', filter=Q(status='failed')),
        ).order_by('-exec_count')

        node_stats = [
            {
                'node_id': str(n['node__id']),
                'node_type': n['node__node_type'],
                'label': n['node__label'] or n['node__node_type'],
                'executions': n['exec_count'],
                'avg_duration_ms': round(n['avg_duration'] or 0, 1),
                'max_duration_ms': n['max_duration'] or 0,
                'total_input_docs': n['total_input'] or 0,
                'total_output_docs': n['total_output'] or 0,
                'failure_count': n['failures'],
                'failure_rate': round(
                    n['failures'] / n['exec_count'] * 100, 1
                ) if n['exec_count'] else 0,
            }
            for n in node_perf
        ]

        # Recent event types distribution
        event_counts = WorkflowLiveEvent.objects.filter(
            workflow=workflow,
            created_at__gte=since,
        ).values('event_type').annotate(
            count=Count('id'),
        ).order_by('-count')

        return Response({
            'period': period,
            'since': since.isoformat(),
            'summary': {
                'total_executions': agg['total'],
                'completed': agg['completed'],
                'failed': agg['failed'],
                'partial': agg['partial'],
                'success_rate': round(
                    agg['completed'] / agg['total'] * 100, 1
                ) if agg['total'] else 0,
                'avg_duration_ms': round(agg['avg_duration'] or 0, 1),
                'max_duration_ms': agg['max_duration'] or 0,
                'min_duration_ms': agg['min_duration'] or 0,
                'total_documents_processed': agg['total_docs'] or 0,
            },
            'hourly_distribution': hourly,
            'node_performance': node_stats,
            'event_distribution': list(event_counts),
        })

    # -- Execution Timeline ------------------------------------------------

    @action(detail=True, methods=['get'], url_path='execution-timeline')
    def execution_timeline(self, request, pk=None):
        """
        GET /api/clm/workflows/{id}/execution-timeline/
        ?limit=10

        Returns a detailed timeline of recent executions, with per-node
        timing data suitable for rendering Gantt-style visualizations.
        """
        workflow = self.get_object()
        limit = min(int(request.query_params.get('limit', 10)), 50)

        executions = WorkflowExecution.objects.filter(
            workflow=workflow,
        ).order_by('-started_at')[:limit]

        timeline = []
        for exc in executions:
            node_logs = NodeExecutionLog.objects.filter(
                execution=exc,
            ).select_related('node').order_by('dag_level', 'started_at')

            nodes_timeline = []
            for log in node_logs:
                nodes_timeline.append({
                    'node_id': str(log.node_id),
                    'node_type': log.node.node_type if log.node else '',
                    'label': log.node.label if log.node else '',
                    'status': log.status,
                    'dag_level': log.dag_level,
                    'started_at': log.started_at.isoformat() if log.started_at else None,
                    'completed_at': log.completed_at.isoformat() if log.completed_at else None,
                    'duration_ms': log.duration_ms,
                    'input_count': log.input_count,
                    'output_count': log.output_count,
                    'error': log.error_message[:200] if log.error_message else '',
                })

            timeline.append({
                'execution_id': str(exc.id),
                'status': exc.status,
                'mode': exc.mode,
                'started_at': exc.started_at.isoformat() if exc.started_at else None,
                'completed_at': exc.completed_at.isoformat() if exc.completed_at else None,
                'duration_ms': exc.duration_ms,
                'total_documents': exc.total_documents,
                'nodes': nodes_timeline,
                'triggered_by': exc.triggered_by.username if exc.triggered_by else None,
            })

        return Response({
            'workflow_id': str(workflow.id),
            'workflow_name': workflow.name,
            'timeline': timeline,
        })

    # -- Node Performance Stats --------------------------------------------

    @action(detail=True, methods=['get'], url_path='node-performance')
    def node_performance(self, request, pk=None):
        """
        GET /api/clm/workflows/{id}/node-performance/
        ?node_id=uuid  — filter to specific node (optional)
        ?limit=20      — last N executions per node

        Returns per-node execution history and performance metrics.
        """
        workflow = self.get_object()
        node_id = request.query_params.get('node_id')
        limit = min(int(request.query_params.get('limit', 20)), 100)

        qs = NodeExecutionLog.objects.filter(
            workflow=workflow,
        ).select_related('node', 'execution')

        if node_id:
            qs = qs.filter(node_id=node_id)

        # Recent logs
        recent_logs = qs.order_by('-created_at')[:limit]
        logs_data = [
            {
                'execution_id': str(log.execution_id),
                'node_id': str(log.node_id),
                'node_type': log.node.node_type if log.node else '',
                'label': log.node.label if log.node else '',
                'status': log.status,
                'dag_level': log.dag_level,
                'input_count': log.input_count,
                'output_count': log.output_count,
                'duration_ms': log.duration_ms,
                'started_at': log.started_at.isoformat() if log.started_at else None,
                'completed_at': log.completed_at.isoformat() if log.completed_at else None,
                'error': log.error_message[:200] if log.error_message else '',
            }
            for log in recent_logs
        ]

        # Aggregate per-node
        node_agg = qs.values(
            'node__id', 'node__node_type', 'node__label',
        ).annotate(
            total_runs=Count('id'),
            avg_duration=Avg('duration_ms'),
            max_duration=Max('duration_ms'),
            min_duration=Min('duration_ms'),
            avg_input=Avg('input_count'),
            avg_output=Avg('output_count'),
            failures=Count('id', filter=Q(status='failed')),
        ).order_by('node__label')

        aggregates = [
            {
                'node_id': str(n['node__id']),
                'node_type': n['node__node_type'],
                'label': n['node__label'] or n['node__node_type'],
                'total_runs': n['total_runs'],
                'avg_duration_ms': round(n['avg_duration'] or 0, 1),
                'max_duration_ms': n['max_duration'] or 0,
                'min_duration_ms': n['min_duration'] or 0,
                'avg_input_docs': round(n['avg_input'] or 0, 1),
                'avg_output_docs': round(n['avg_output'] or 0, 1),
                'failure_count': n['failures'],
            }
            for n in node_agg
        ]

        return Response({
            'recent_logs': logs_data,
            'node_aggregates': aggregates,
        })

    # -- Organization-wide Dashboard (list-level action) -------------------

    @action(detail=False, methods=['get'], url_path='org-dashboard')
    def org_dashboard(self, request):
        """
        GET /api/clm/workflows/org-dashboard/

        Organization-wide CLM dashboard showing all workflow health,
        recent executions, document processing stats, and alerts.
        """
        from .views import _get_org
        org = _get_org(request)
        if not org:
            return Response({'error': 'Organization not found.'}, status=400)

        now = timezone.now()
        twenty_four_ago = now - timezone.timedelta(hours=24)

        # All workflows for this org
        workflows = Workflow.objects.filter(
            organization=org, is_active=True,
        )

        total_workflows = workflows.count()
        live_workflows = workflows.filter(is_live=True).count()
        executing_now = workflows.exclude(
            execution_state__in=['idle', 'completed', 'failed'],
        ).count()

        # Recent executions across all workflows
        recent_execs = WorkflowExecution.objects.filter(
            workflow__organization=org,
            started_at__gte=twenty_four_ago,
        )
        exec_summary = recent_execs.aggregate(
            total=Count('id'),
            completed=Count('id', filter=Q(status='completed')),
            failed=Count('id', filter=Q(status='failed')),
            avg_duration=Avg('duration_ms'),
            total_docs=Sum('total_documents'),
        )

        # Total documents across all workflows
        total_documents = WorkflowDocument.objects.filter(
            workflow__organization=org,
        ).count()

        # Per-workflow summary
        workflow_summaries = []
        for wf in workflows.order_by('-updated_at')[:20]:
            last_exec = WorkflowExecution.objects.filter(
                workflow=wf,
            ).order_by('-started_at').first()

            wf_24h = WorkflowExecution.objects.filter(
                workflow=wf,
                started_at__gte=twenty_four_ago,
            ).aggregate(
                runs=Count('id'),
                failed=Count('id', filter=Q(status='failed')),
            )

            workflow_summaries.append({
                'workflow_id': str(wf.id),
                'name': wf.name,
                'is_live': wf.is_live,
                'execution_state': wf.execution_state,
                'compilation_status': wf.compilation_status,
                'document_count': wf.documents.count(),
                'node_count': wf.nodes.count(),
                'last_execution': {
                    'id': str(last_exec.id),
                    'status': last_exec.status,
                    'started_at': last_exec.started_at.isoformat() if last_exec.started_at else None,
                    'duration_ms': last_exec.duration_ms,
                } if last_exec else None,
                'executions_24h': wf_24h['runs'],
                'failures_24h': wf_24h['failed'],
            })

        # Recent events across all workflows
        recent_events = WebhookEvent.objects.filter(
            workflow__organization=org,
        ).order_by('-created_at')[:20]
        events_data = [
            {
                'event_id': str(e.id),
                'workflow_name': e.workflow.name if e.workflow else '',
                'event_type': e.event_type,
                'status': e.status,
                'created_at': e.created_at.isoformat(),
            }
            for e in recent_events
        ]

        # Subscription health summary
        sub_errors = EventSubscription.objects.filter(
            workflow__organization=org,
            consecutive_errors__gt=0,
        ).count()

        return Response({
            'organization': str(org.id) if hasattr(org, 'id') else '',
            'summary': {
                'total_workflows': total_workflows,
                'live_workflows': live_workflows,
                'executing_now': executing_now,
                'total_documents': total_documents,
                'executions_24h': exec_summary['total'],
                'completed_24h': exec_summary['completed'],
                'failed_24h': exec_summary['failed'],
                'avg_duration_ms': round(exec_summary['avg_duration'] or 0, 1),
                'documents_processed_24h': exec_summary['total_docs'] or 0,
                'subscriptions_with_errors': sub_errors,
            },
            'workflows': workflow_summaries,
            'recent_events': events_data,
        })

    # -- Live Workflows List -----------------------------------------------

    @action(detail=False, methods=['get'], url_path='live-workflows')
    def live_workflows(self, request):
        """
        GET /api/clm/workflows/live-workflows/

        Lists all currently live workflows with their real-time status.
        """
        from .views import _get_org
        org = _get_org(request)
        if not org:
            return Response({'error': 'Organization not found.'}, status=400)

        live_wfs = Workflow.objects.filter(
            organization=org,
            is_active=True,
            is_live=True,
        ).order_by('-updated_at')

        result = []
        for wf in live_wfs:
            last_exec = WorkflowExecution.objects.filter(
                workflow=wf,
            ).order_by('-started_at').first()

            # Active subscriptions
            active_subs = EventSubscription.objects.filter(
                workflow=wf, status='active',
            ).count()
            error_subs = EventSubscription.objects.filter(
                workflow=wf, consecutive_errors__gt=0,
            ).count()

            result.append({
                'workflow_id': str(wf.id),
                'name': wf.name,
                'execution_state': wf.execution_state,
                'live_interval': wf.live_interval,
                'compilation_status': wf.compilation_status,
                'document_count': wf.documents.count(),
                'last_executed_at': wf.last_executed_at.isoformat() if wf.last_executed_at else None,
                'last_execution_status': last_exec.status if last_exec else None,
                'last_execution_duration': last_exec.duration_ms if last_exec else None,
                'active_subscriptions': active_subs,
                'subscriptions_with_errors': error_subs,
                'sse_connections': event_bus.active_subscribers(str(wf.id)),
            })

        return Response({
            'count': len(result),
            'workflows': result,
        })
