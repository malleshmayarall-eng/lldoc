"""
CLM Live Event Bus — In-process event streaming for real-time workflow monitoring
==================================================================================

Architecture
------------
  This module provides a lightweight, in-process pub/sub event bus that
  connects workflow execution (node_executor.py) to SSE streaming endpoints.

  **No external dependencies** — uses threading primitives (Event, Lock) and
  collections.deque for bounded, thread-safe event queues.  Works with both
  sync Django views (StreamingHttpResponse) and Celery workers.

  Flow:
    1. ``emit()`` — Called from node_executor / tasks during execution.
       Stores the event in a per-workflow ring buffer and wakes all waiters.

    2. ``subscribe()`` — Returns a ``LiveSubscription`` context manager.
       Each subscriber gets its own ``threading.Event`` that is set whenever
       new events arrive.  ``iter_events()`` yields events as they come,
       blocking between them (suitable for SSE generator).

    3. ``get_recent()`` — Returns the last N events for a workflow (for
       initial page load / reconnection).

Event Types
-----------
  • execution_started   — workflow execution begins
  • execution_completed — workflow execution finished (success/partial/failed)
  • node_started        — a specific node begins processing
  • node_completed      — a specific node finished processing
  • node_failed         — a specific node encountered an error
  • node_progress       — incremental progress within a node (e.g., 12/50 docs processed)
  • document_processed  — a single document was processed by a node
  • compilation_started — workflow compilation begins
  • compilation_done    — workflow compilation finished
  • live_tick           — periodic heartbeat for live workflows (keeps SSE alive)
  • metric_update       — aggregated metrics snapshot (doc throughput, latency, etc.)
"""

import json
import logging
import threading
import time
import uuid
from collections import defaultdict, deque
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone as _tz
from typing import Any, Generator, Iterator

logger = logging.getLogger(__name__)

# Maximum events to keep per workflow in the ring buffer
_BUFFER_SIZE = 500

# Maximum subscriptions per workflow (prevents memory leaks from abandoned SSE connections)
_MAX_SUBSCRIBERS = 50


# ---------------------------------------------------------------------------
# Event Data Model
# ---------------------------------------------------------------------------

@dataclass
class LiveEvent:
    """A single real-time event emitted during workflow execution."""
    event_type: str
    workflow_id: str
    timestamp: str = field(default_factory=lambda: datetime.now(_tz.utc).isoformat())
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    execution_id: str = ''
    node_id: str = ''
    node_type: str = ''
    node_label: str = ''
    data: dict = field(default_factory=dict)

    def to_sse(self) -> str:
        """Format as a Server-Sent Events message."""
        payload = {
            'event_type': self.event_type,
            'workflow_id': self.workflow_id,
            'execution_id': self.execution_id,
            'node_id': self.node_id,
            'node_type': self.node_type,
            'node_label': self.node_label,
            'timestamp': self.timestamp,
            'event_id': self.event_id,
            **self.data,
        }
        data_str = json.dumps(payload, default=str)
        return f"event: {self.event_type}\nid: {self.event_id}\ndata: {data_str}\n\n"

    def to_dict(self) -> dict:
        return {
            'event_type': self.event_type,
            'workflow_id': self.workflow_id,
            'execution_id': self.execution_id,
            'node_id': self.node_id,
            'node_type': self.node_type,
            'node_label': self.node_label,
            'timestamp': self.timestamp,
            'event_id': self.event_id,
            **self.data,
        }


# ---------------------------------------------------------------------------
# Subscription — per-client event stream
# ---------------------------------------------------------------------------

class LiveSubscription:
    """
    A single SSE client's subscription to a workflow's event stream.

    Thread-safe: ``emit()`` is called from executor threads while
    ``iter_events()`` runs in the Django streaming response thread.
    """

    def __init__(self, workflow_id: str):
        self.workflow_id = workflow_id
        self._queue: deque[LiveEvent] = deque(maxlen=200)
        self._wake = threading.Event()
        self._closed = False

    def push(self, event: LiveEvent):
        """Called by the bus when a new event is emitted."""
        if self._closed:
            return
        self._queue.append(event)
        self._wake.set()

    def iter_events(self, timeout: float = 30.0) -> Generator[LiveEvent | None, None, None]:
        """
        Blocking generator that yields events as they arrive.
        Yields None on timeout (caller should send SSE keepalive comment).
        Stops when ``close()`` is called.
        """
        while not self._closed:
            # Drain all queued events
            while self._queue:
                yield self._queue.popleft()

            # Wait for new events or timeout
            signaled = self._wake.wait(timeout=timeout)
            self._wake.clear()

            if not signaled:
                # Timeout — yield None so caller can send keepalive
                yield None

            # Drain events that arrived while we were waking
            while self._queue:
                yield self._queue.popleft()

    def close(self):
        self._closed = True
        self._wake.set()  # Unblock iter_events


# ---------------------------------------------------------------------------
# Global Event Bus — singleton per process
# ---------------------------------------------------------------------------

class _EventBus:
    """
    In-process pub/sub event bus.

    Thread-safe: uses a per-workflow lock for subscriber management
    and a ring buffer for recent events.
    """

    def __init__(self):
        self._buffers: dict[str, deque[LiveEvent]] = defaultdict(
            lambda: deque(maxlen=_BUFFER_SIZE)
        )
        self._subscribers: dict[str, list[LiveSubscription]] = defaultdict(list)
        self._lock = threading.Lock()

    def emit(self, event: LiveEvent):
        """
        Emit an event — store in ring buffer and push to all subscribers.
        Non-blocking: if a subscriber is slow, events queue up in its deque.
        """
        wf_id = event.workflow_id

        with self._lock:
            self._buffers[wf_id].append(event)
            subs = list(self._subscribers.get(wf_id, []))

        for sub in subs:
            try:
                sub.push(event)
            except Exception:
                pass  # Don't let a bad subscriber crash the emitter

    def get_recent(self, workflow_id: str, limit: int = 50) -> list[LiveEvent]:
        """Return the last N events for a workflow."""
        with self._lock:
            buf = self._buffers.get(workflow_id, deque())
            return list(buf)[-limit:]

    @contextmanager
    def subscribe(self, workflow_id: str) -> Generator[LiveSubscription, None, None]:
        """
        Context manager that creates a subscription and cleans up on exit.

        Usage:
            with event_bus.subscribe('workflow-id') as sub:
                for event in sub.iter_events():
                    yield event.to_sse()
        """
        sub = LiveSubscription(workflow_id)

        with self._lock:
            subs = self._subscribers[workflow_id]
            if len(subs) >= _MAX_SUBSCRIBERS:
                # Evict oldest subscriber
                oldest = subs.pop(0)
                oldest.close()
                logger.warning(
                    f'[live-bus] Evicted oldest subscriber for workflow {workflow_id} '
                    f'(max={_MAX_SUBSCRIBERS})'
                )
            subs.append(sub)

        try:
            yield sub
        finally:
            sub.close()
            with self._lock:
                try:
                    self._subscribers[workflow_id].remove(sub)
                except ValueError:
                    pass

    def cleanup_workflow(self, workflow_id: str):
        """Remove all data for a workflow (called when workflow is deleted)."""
        with self._lock:
            self._buffers.pop(workflow_id, None)
            subs = self._subscribers.pop(workflow_id, [])
        for sub in subs:
            sub.close()

    def active_subscribers(self, workflow_id: str) -> int:
        """Count of active SSE connections for a workflow."""
        with self._lock:
            return len(self._subscribers.get(workflow_id, []))


# Global singleton
event_bus = _EventBus()


# ---------------------------------------------------------------------------
# Convenience emitters — called from node_executor.py and tasks.py
# ---------------------------------------------------------------------------

def emit(event_type: str, workflow_id: str, **kwargs):
    """Emit a live event with minimal boilerplate."""
    event = LiveEvent(
        event_type=event_type,
        workflow_id=str(workflow_id),
        **kwargs,
    )
    event_bus.emit(event)
    return event


def emit_execution_started(workflow, execution, mode='full', total_docs=0):
    return emit(
        'execution_started',
        workflow_id=str(workflow.id),
        execution_id=str(execution.id),
        data={
            'workflow_name': workflow.name,
            'mode': mode,
            'total_documents': total_docs,
            'status': 'running',
        },
    )


def emit_execution_completed(workflow, execution, duration_ms=0, total_docs=0, output_count=0):
    return emit(
        'execution_completed',
        workflow_id=str(workflow.id),
        execution_id=str(execution.id),
        data={
            'workflow_name': workflow.name,
            'status': execution.status,
            'duration_ms': duration_ms,
            'total_documents': total_docs,
            'output_count': output_count,
        },
    )


def emit_node_started(workflow, execution, node, input_count=0, dag_level=0):
    return emit(
        'node_started',
        workflow_id=str(workflow.id),
        execution_id=str(execution.id) if execution else '',
        node_id=str(node.id),
        node_type=node.node_type,
        node_label=node.label or node.get_node_type_display(),
        data={
            'input_count': input_count,
            'dag_level': dag_level,
        },
    )


def emit_node_completed(workflow, execution, node, output_count=0, duration_ms=0, dag_level=0):
    return emit(
        'node_completed',
        workflow_id=str(workflow.id),
        execution_id=str(execution.id) if execution else '',
        node_id=str(node.id),
        node_type=node.node_type,
        node_label=node.label or node.get_node_type_display(),
        data={
            'output_count': output_count,
            'duration_ms': duration_ms,
            'dag_level': dag_level,
            'status': 'completed',
        },
    )


def emit_node_failed(workflow, execution, node, error='', dag_level=0):
    return emit(
        'node_failed',
        workflow_id=str(workflow.id),
        execution_id=str(execution.id) if execution else '',
        node_id=str(node.id),
        node_type=node.node_type,
        node_label=node.label or node.get_node_type_display(),
        data={
            'error': str(error)[:500],
            'dag_level': dag_level,
            'status': 'failed',
        },
    )


def emit_node_progress(workflow, execution, node, processed=0, total=0, dag_level=0):
    return emit(
        'node_progress',
        workflow_id=str(workflow.id),
        execution_id=str(execution.id) if execution else '',
        node_id=str(node.id),
        node_type=node.node_type,
        node_label=node.label or node.get_node_type_display(),
        data={
            'processed': processed,
            'total': total,
            'progress_pct': round(processed / total * 100, 1) if total else 0,
            'dag_level': dag_level,
        },
    )


def emit_document_processed(workflow, execution, node, document_id, document_title='', result='passed'):
    return emit(
        'document_processed',
        workflow_id=str(workflow.id),
        execution_id=str(execution.id) if execution else '',
        node_id=str(node.id),
        node_type=node.node_type,
        node_label=node.label or node.get_node_type_display(),
        data={
            'document_id': str(document_id),
            'document_title': document_title,
            'result': result,
        },
    )


def emit_compilation_event(workflow, status, errors=None, warnings=None):
    return emit(
        'compilation_done' if status != 'compiling' else 'compilation_started',
        workflow_id=str(workflow.id),
        data={
            'workflow_name': workflow.name,
            'compilation_status': status,
            'errors': errors or [],
            'warnings': warnings or [],
        },
    )


def emit_live_tick(workflow, metrics=None):
    """Heartbeat + metrics snapshot for live workflows."""
    return emit(
        'live_tick',
        workflow_id=str(workflow.id),
        data={
            'workflow_name': workflow.name,
            'is_live': workflow.is_live,
            'execution_state': workflow.execution_state,
            'metrics': metrics or {},
        },
    )


def emit_metric_update(workflow, metrics):
    """Aggregated metrics update (document throughput, latency, etc.)."""
    return emit(
        'metric_update',
        workflow_id=str(workflow.id),
        data={'metrics': metrics},
    )
