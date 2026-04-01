# CLM Workflow — Complete Architecture & Live Events Reference

## Table of Contents
1. [System Overview](#1-system-overview)
2. [Data Model](#2-data-model)
3. [Workflow Lifecycle](#3-workflow-lifecycle)
4. [Execution Engine (DAG)](#4-execution-engine-dag)
5. [Live Mode & Event System](#5-live-mode--event-system)
6. [Sheet Integration](#6-sheet-integration)
7. [Real-Time Event Bus (SSE)](#7-real-time-event-bus-sse)
8. [Celery Tasks & Beat Schedule](#8-celery-tasks--beat-schedule)
9. [API Reference](#9-api-reference)
10. [Root Cause Analysis — Why Live/Sheets Were Not Working](#10-root-cause-analysis)
11. [Frontend Live Processing Guide](#11-frontend-live-processing-guide)

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLM WORKFLOW SYSTEM                          │
│                                                                     │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌────────────────┐  │
│  │  Input   │──▶│  Rule    │──▶│   AI     │──▶│    Output      │  │
│  │  Node    │   │  Node    │   │  Node    │   │    Node        │  │
│  └──────────┘   └──────────┘   └──────────┘   └────────────────┘  │
│       │                                                             │
│  Sources:                                                           │
│  • upload (manual)       • email_inbox (IMAP)                      │
│  • sheets (Sheet app)    • webhook (POST endpoint)                  │
│  • google_drive/dropbox  • folder_upload (DriveFolder)             │
│  • dms_import            • table (CSV/Excel/Google Sheets)          │
└─────────────────────────────────────────────────────────────────────┘
```

### Node Types (11 total)
| Node | Role |
|------|------|
| `input` | Sources documents — supports 10 source types |
| `rule` | Metadata filter — conditions with AND/OR logic |
| `listener` | Watches email/folder, triggers single-doc execution |
| `validator` | Multi-level human approval gate |
| `action` | Plugin executor (email, WhatsApp, webhook, etc.) |
| `ai` | Gemini/ChatGPT processing per document |
| `and_gate` | Set intersection — passes docs present in ALL upstream paths |
| `scraper` | Enriches doc metadata from allowed websites |
| `doc_create` | Creates editor Documents from CLM metadata |
| `sheet` | Reads from / writes to Sheet (input or storage mode) |
| `output` | Terminal — collects final filtered document list |

---

## 2. Data Model

```
Workflow
  ├── WorkflowNode (11 types)
  ├── NodeConnection (directed edges)
  ├── WorkflowDocument (documents flowing through the DAG)
  │     └── ExtractedField (per-field extraction results)
  ├── WorkflowExecution (each run of the DAG)
  │     └── NodeExecutionLog (per-node timing + I/O counts)
  ├── EventSubscription (one per input node, created at compile time)
  ├── WebhookEvent (records each inbound event)
  ├── WorkflowCompilation (compilation history)
  └── DocumentExecutionRecord (smart dedup — tracks doc+hash combos)
```

### Key Workflow Fields
| Field | Purpose |
|-------|---------|
| `is_live` | Master live switch — enables event-driven + Beat dispatch |
| `is_active` | Soft-delete / pause |
| `compilation_status` | `not_compiled` → `compiled` → `stale` → `failed` |
| `execution_state` | `idle` / `executing` / `completed` / `failed` (DB lock) |
| `nodes_config_hash` | SHA-256 of all node configs — changes = re-execute all |
| `live_interval` | Seconds between Beat-triggered executions (default 60) |
| `auto_execute_on_upload` | Auto-run immediately when documents are uploaded |

---

## 3. Workflow Lifecycle

```
CREATE WORKFLOW
      │
      ▼
ADD NODES + CONNECTIONS (via WorkflowNodeViewSet)
      │
      ▼
POST /api/clm/workflows/{id}/compile/
  → Validates DAG (cycle detection, input/output presence)
  → Creates EventSubscription per input node
  → Sets compilation_status = 'compiled'
      │
      ▼
POST /api/clm/workflows/{id}/go-live/
  → Runs compile() if needed
  → Sets is_live = True
  → Activates all EventSubscriptions
      │
      ▼
LIVE MODE
  ├── Sheet source: events fired by sheets/views.py on save → dispatch_event()
  ├── Webhook source: POST /api/clm/webhooks/{token}/ → process_webhook()
  ├── Email source: Celery Beat → dispatch_email_checks → check_single_email_node
  └── Time-based / cloud: Celery Beat → dispatch_event_subscriptions → poll_subscription
      │
      ▼
EXECUTION (async via Celery)
  WorkflowExecution created (status='queued')
  execute_workflow_async.delay(workflow_id, execution_id, ...)
      │
  execute_workflow() [node_executor.py]
  ├── emit_execution_started()
  ├── For each DAG level (topological sort):
  │   ├── emit_node_started()
  │   ├── _execute_*_node() — the actual processing
  │   ├── emit_node_progress() — incremental within node
  │   ├── emit_node_completed() / emit_node_failed()
  └── emit_execution_completed()
      │
      ▼
RESULTS stored in WorkflowExecution.result_data
Frontend reads via:
  • SSE stream:    GET /api/clm/workflows/{id}/live-stream/
  • Polling:       GET /api/clm/workflows/{id}/execution-status/{exec_id}/
  • Node detail:   GET /api/clm/workflows/{id}/node-inspection/
```

---

## 4. Execution Engine (DAG)

### `execute_workflow()` in `node_executor.py`

```python
def execute_workflow(workflow, triggered_by=None, single_document_ids=None,
                     excluded_document_ids=None, mode='full', smart=False,
                     execution=None):
    """
    Topological sort → execute each level in order.
    Each node receives the UNION of all upstream node outputs.
    AND gates do SET INTERSECTION.
    """
```

### Topological Order (Kahn's algorithm)
1. Compute in-degree for every node
2. Start queue with all zero-in-degree nodes (input nodes)
3. Process each level: execute all nodes at the same level in sequence
4. Pass output document IDs downstream

### Smart Execution (Dedup)
When `smart=True`, documents already processed with the current `nodes_config_hash`
are skipped. This is critical for live mode — only new/changed rows are re-processed.

### Sheet Node (`_execute_sheet_node`)
- **Input mode**: reads rows from a linked Sheet, creates WorkflowDocuments
- **Output/storage mode**: writes result document metadata back to a Sheet

---

## 5. Live Mode & Event System

### Compile → Subscribe → Trigger

```
compile_workflow()
    │
    ├── Scans ALL input nodes
    ├── For each input node → creates EventSubscription:
    │     source_type: sheet | email | webhook | google_drive | ...
    │     source_id:   sheet UUID | folder ID | etc.
    │     poll_interval: 0 (event-driven) or N seconds (polled)
    └── Sets workflow.compilation_status = 'compiled'
```

### dispatch_event() — the central router

```python
dispatch_event(
    event_type='sheet_updated',   # or 'sheet_row_saved', 'email_received', etc.
    source_type='sheet',
    source_id='<sheet-uuid>',
    payload={...},
)
```

- Finds all `EventSubscription` rows matching `source_type + source_id`
- Filters: `status='active'`, `workflow.is_active=True`
- **⚠️ BUG (fixed)**: also requires `workflow.is_live OR auto_execute_on_upload`
  - Old code would silently skip if only `is_live=True` but `auto_execute_on_upload=False`
  - Fix: check `workflow.is_live` first (or gate)
- Creates `WebhookEvent` record
- Dispatches `execute_workflow_async.delay(...)`

### Event-Driven vs. Time-Based Sources

| Source Type | Trigger Mechanism |
|-------------|-------------------|
| `sheet` | sheets/views.py calls `dispatch_event()` on row save |
| `webhook` | WebhookReceiverView → `process_webhook()` → `dispatch_event()` |
| `email` | Celery Beat every 30s → IMAP poll → `check_email_inbox()` |
| `google_drive/dropbox/s3/ftp` | Celery Beat → `poll_subscription()` |
| `upload/folder_upload` | On-demand — user triggers via API |

---

## 6. Sheet Integration

### How sheets trigger CLM workflows

```
User saves a sheet row
    │
sheets/views.py → _trigger_workflows_for_changed_rows()
    │
    ├── Queries EventSubscription WHERE source_type='sheet' AND source_id=<sheet_id>
    │         AND workflow.is_live=True AND compilation_status='compiled'
    │
    ├── For each subscription:
    │   └── dispatch_event('sheet_row_saved', 'sheet', sheet_id, payload={row_data})
    │             │
    │             └── Creates WebhookEvent + WorkflowExecution (status='queued')
    │                       │
    │                       └── execute_workflow_async.delay(...)
    │                                 │
    │                                 └── execute_workflow() processes all nodes
    │
    └── (Batch event for backward compat)
        handle_sheet_update(sheet_id, changed_data)
```

### Why it failed (before fix)

1. **Missing compilation**: If the workflow was set `is_live=True` but never compiled,
   `EventSubscription` rows don't exist → nothing subscribes to sheet events.
   **Fix**: The `go-live` endpoint now auto-compiles.

2. **dispatch_event guard**: The old check was:
   ```python
   if not workflow.is_live and not workflow.auto_execute_on_upload:
       continue  # silently skip
   ```
   This is correct, but `is_live` must be `True` AND the subscription must be `active`.
   After `pause()`, subscriptions go to `paused` status — they need to be reactivated
   on `go-live`.

3. **No SSE endpoint**: Live events are emitted to the in-process `event_bus` ring buffer
   but there was no HTTP endpoint to stream them to the frontend. Fixed by adding
   `GET /api/clm/workflows/{id}/live-stream/`.

---

## 7. Real-Time Event Bus (SSE)

### Architecture (`live_events.py`)

```
node_executor.py / tasks.py
    │
    │  emit_execution_started(workflow, execution)
    │  emit_node_started(workflow, execution, node)
    │  emit_node_progress(workflow, execution, node, processed, total)
    │  emit_node_completed(workflow, execution, node)
    │  emit_node_failed(workflow, execution, node, error)
    │  emit_execution_completed(workflow, execution)
    │  emit_live_tick(workflow)
    │
    ▼
event_bus.emit(LiveEvent)
    │
    ├── Appends to per-workflow ring buffer (500 events max)
    └── Wakes all LiveSubscription waiters
              │
              ▼
LiveSubscription.iter_events()
    │   (blocking generator — yields events as they arrive)
    │
    ▼
SSE StreamingHttpResponse
    │   GET /api/clm/workflows/{id}/live-stream/
    │
    ▼
Frontend EventSource('...live-stream/')
```

### SSE Event Types
| Event | When | Key fields |
|-------|------|-----------|
| `execution_started` | Run begins | `execution_id`, `total_documents`, `mode` |
| `node_started` | Node begins | `node_id`, `node_type`, `node_label`, `input_count`, `dag_level` |
| `node_progress` | Per-document within node | `processed`, `total`, `progress_pct` |
| `node_completed` | Node finishes | `output_count`, `duration_ms` |
| `node_failed` | Node error | `error` |
| `document_processed` | Single doc processed | `document_id`, `document_title`, `result` |
| `execution_completed` | Run done | `status`, `duration_ms`, `output_count` |
| `compilation_started` | Compile begins | — |
| `compilation_done` | Compile done | `compilation_status`, `errors`, `warnings` |
| `live_tick` | Heartbeat (30s) | `is_live`, `execution_state`, `metrics` |

### Reconnection
`GET /api/clm/workflows/{id}/live-stream/?last_event_id=<uuid>`
Returns buffered events since that ID + resumes live stream.

---

## 8. Celery Tasks & Beat Schedule

```python
CELERY_BEAT_SCHEDULE = {
    'email-inbox-dispatcher':      {'task': 'clm.tasks.dispatch_email_checks',          'schedule': 30.0},
    'live-workflow-dispatcher':    {'task': 'clm.tasks.dispatch_live_workflows',         'schedule': 60.0},
    'event-subscription-dispatcher': {'task': 'clm.tasks.dispatch_event_subscriptions', 'schedule': 30.0},
}
```

### `dispatch_live_workflows` (every 60s)
- Finds all `is_live=True, is_active=True` workflows
- **Skips** fully event-driven workflows (all subscriptions = `sheet|webhook`)
  because those are triggered immediately by the event, not by the clock
- Checks elapsed time vs `live_interval`
- Uses `cache.add()` lock to prevent overlapping executions
- Dispatches `execute_workflow_async.delay(..., smart=True)`

### `execute_workflow_async` (Celery task)
- Marks execution `running`
- Calls `execute_workflow()` synchronously in the worker
- All `emit_*()` calls inside `execute_workflow()` write to `event_bus`
  (in-process ring buffer in the worker process — **not visible to the web process**)
  
**⚠️ CRITICAL**: Because Celery workers are separate processes, `event_bus` is not
shared with the Django web process. SSE clients connected to the web process will NOT
receive events emitted by Celery workers using the default in-memory bus.

**Fix options (in order of complexity)**:
1. **Polling hybrid** (implemented): SSE endpoint polls DB + node logs for progress
   while also draining the in-process bus for sync executions.
2. **Redis pub/sub** (production): Replace `event_bus` with Redis channels.
3. **Django Channels** (full async): WebSocket-based real-time with channel layers.

The implemented fix uses a **DB-backed polling SSE** approach:
- SSE stream polls `NodeExecutionLog` and `WorkflowExecution` every 2 seconds
- In-process events (from sync fallback) come through the `event_bus`
- Together this gives real-time-like updates for both Celery and sync execution

---

## 9. API Reference

### Workflow Lifecycle
```
POST /api/clm/workflows/                         Create workflow
GET  /api/clm/workflows/{id}/                    Get workflow
POST /api/clm/workflows/{id}/compile/            Validate DAG + create subscriptions
POST /api/clm/workflows/{id}/go-live/            Compile + set is_live=True
POST /api/clm/workflows/{id}/pause/              Set is_live=False + pause subscriptions
PATCH /api/clm/workflows/{id}/live/              Toggle is_live + set live_interval
```

### Execution
```
POST /api/clm/workflows/{id}/execute/            Execute (sync or async)
  Body: { "async": true, "smart": true, "mode": "full" }
  Response (async): { "execution_id": "...", "status": "queued" }

GET  /api/clm/workflows/{id}/execution-status/{exec_id}/   Poll execution progress
GET  /api/clm/workflows/{id}/execution-history/            List past executions
GET  /api/clm/workflows/{id}/execution-detail/{exec_id}/   Full result data
GET  /api/clm/workflows/{id}/node-execution-logs/{exec_id}/ Per-node logs
```

### Live Monitoring
```
GET  /api/clm/workflows/{id}/live-stream/        SSE stream of live events
  ?last_event_id=<uuid>                          Resume from specific event
  Response: text/event-stream (SSE)

GET  /api/clm/workflows/{id}/workflow-status/    Comprehensive status snapshot
POST /api/clm/workflows/{id}/workflow-status/    Body: {"action":"clear_lock"}
GET  /api/clm/workflows/{id}/subscriptions/      List event subscriptions
GET  /api/clm/workflows/{id}/event-log/          List WebhookEvent records
```

### Documents & Fields
```
POST /api/clm/workflows/{id}/upload/             Upload documents
GET  /api/clm/workflows/{id}/documents/          List documents
GET  /api/clm/workflows/{id}/document-detail/{doc_id}/  Full doc detail + journey
GET  /api/clm/workflows/{id}/node-inspect/{node_id}/    Node inspection with per-doc results
```

---

## 10. Root Cause Analysis

### Problem 1: No SSE Endpoint (CRITICAL)
- `live_events.py` provides `event_bus`, `emit_*()`, `subscribe()` — everything needed
- `views.py` had **zero** streaming endpoints
- **Fix**: Added `GET /api/clm/workflows/{id}/live-stream/` with SSE streaming

### Problem 2: Celery Worker ≠ Web Process (`event_bus` not shared)
- In-memory `event_bus` only stores events in the Celery worker process
- Web process SSE clients never see those events
- **Fix**: SSE endpoint also polls DB (`NodeExecutionLog`, `WorkflowExecution`) every 2s

### Problem 3: Sheet dispatch_event guard
- `dispatch_event()` condition: `if not workflow.is_live and not workflow.auto_execute_on_upload: continue`
- This is correct — but `compilation_status` must also be `'compiled'`
- If user sets `is_live=True` but never called `/compile/` or `/go-live/`,
  no `EventSubscription` rows exist → no match in `sub_qs` → nothing dispatched
- **Fix**: `go-live` endpoint always compiles first; added check in docs

### Problem 4: EventSubscription status after pause/resume
- `pause()` sets all subscriptions to `'paused'`
- `go-live()` (re-)compiles and calls `update_or_create` on subscriptions → sets `status='active'`
- But if user manually sets `is_live=True` without calling `go-live/`, old paused
  subscriptions stay paused → events never routed
- **Fix**: `live` PATCH endpoint now also reactivates subscriptions when `is_live=True`

### Problem 5: Sheet node executor emits no live events
- `_execute_sheet_node()` in `node_executor.py` had no `emit_*` calls
- **Fix**: Added `emit_node_progress()` calls inside the sheet processing loop

---

## 11. Frontend Live Processing Guide

### SSE Connection Pattern
```javascript
const es = new EventSource(
  `/api/clm/workflows/${workflowId}/live-stream/`,
  { withCredentials: true }
);

es.addEventListener('execution_started', (e) => {
  const data = JSON.parse(e.data);
  // { workflow_id, execution_id, total_documents, mode, status }
});

es.addEventListener('node_started', (e) => {
  const data = JSON.parse(e.data);
  // { node_id, node_type, node_label, input_count, dag_level }
});

es.addEventListener('node_progress', (e) => {
  const data = JSON.parse(e.data);
  // { node_id, processed, total, progress_pct, dag_level }
});

es.addEventListener('node_completed', (e) => {
  const data = JSON.parse(e.data);
  // { node_id, output_count, duration_ms }
});

es.addEventListener('execution_completed', (e) => {
  const data = JSON.parse(e.data);
  // { status, duration_ms, total_documents, output_count }
  es.close();
});

// Keep-alive (server sends comment every 30s)
es.addEventListener('live_tick', (e) => {
  const data = JSON.parse(e.data);
  // heartbeat — update last_seen timestamp
});
```

### Reconnection with Last-Event-ID
```javascript
// Browser EventSource auto-sends Last-Event-ID header on reconnect
// But for explicit reconnection:
const lastId = localStorage.getItem(`sse_last_id_${workflowId}`);
const url = lastId
  ? `/api/clm/workflows/${workflowId}/live-stream/?last_event_id=${lastId}`
  : `/api/clm/workflows/${workflowId}/live-stream/`;
```

### Status Polling (fallback / initial load)
```javascript
// For initial state and when SSE is unavailable
const status = await fetch(`/api/clm/workflows/${id}/workflow-status/`)
  .then(r => r.json());

// Poll execution when running
if (status.active_execution) {
  const execId = status.active_execution.execution_id;
  const poll = setInterval(async () => {
    const exec = await fetch(`/api/clm/workflows/${id}/execution-status/${execId}/`)
      .then(r => r.json());
    if (['completed','partial','failed'].includes(exec.status)) {
      clearInterval(poll);
    }
  }, 2000);
}
```
