# CLM Workflow Live Architecture

> How workflows go from "saved" to "automatically executing on every event"

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [The Three Pillars: Compile → Go-Live → Execute](#2-the-three-pillars)
3. [Complete Trigger Matrix](#3-complete-trigger-matrix)
4. [Data Flow: Upload → Execution](#4-data-flow-upload--execution)
5. [Data Flow: Sheet Update → Execution](#5-data-flow-sheet-update--execution)
6. [Celery Task Architecture](#6-celery-task-architecture)
7. [Event Subscription System](#7-event-subscription-system)
8. [SSE Live Stream (Real-time Frontend)](#8-sse-live-stream)
9. [Key Models & Fields](#9-key-models--fields)
10. [Checklist: "Why Isn't My Workflow Executing?"](#10-checklist)
11. [API Reference (Live Endpoints)](#11-api-reference)
12. [Infrastructure Requirements](#12-infrastructure-requirements)
13. [Known Limitations](#13-known-limitations)

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React)                         │
│  WorkflowCanvas → Execute/Go-Live → ProcessingProgressPanel  │
│        ↕ REST API          ↕ SSE (live-stream/)              │
├─────────────────────────────────────────────────────────────┤
│                  Django Web Process                           │
│                                                              │
│  views.py        event_system.py      live_events.py         │
│  ┌──────────┐   ┌────────────────┐   ┌──────────────────┐   │
│  │ upload() │──→│ dispatch_event │──→│ emit(queued)     │   │
│  │ go-live()│──→│ compile_wf()   │   │ event_bus        │   │
│  │ execute()│──→│ handle_sheet() │   │ subscribe()      │   │
│  │ live-    │   └───────┬────────┘   └──────────────────┘   │
│  │ stream() │           │                                    │
│  │ live-    │           │ execute_workflow_async.delay()      │
│  │ dashboard│           ↓                                    │
│  └──────────┘   ┌──────────────────┐                         │
│                 │  Redis Broker     │←── CELERY_BROKER_URL    │
│                 └────────┬─────────┘                         │
├──────────────────────────┼──────────────────────────────────┤
│                  Celery Worker Process                        │
│                          ↓                                   │
│  tasks.py       node_executor.py                             │
│  ┌──────────┐   ┌──────────────────────────────────┐         │
│  │ execute_ │──→│ execute_workflow()                │         │
│  │ workflow_ │   │   → _execute_input_node()        │         │
│  │ async()  │   │   → _execute_rule_node()          │         │
│  │          │   │   → _execute_ai_node()            │         │
│  │ dispatch_│   │   → _execute_action_node()        │         │
│  │ live_    │   │   → _execute_validator_node()     │         │
│  │ workflows│   │   → _execute_sheet_node()         │         │
│  └──────────┘   └──────────────────────────────────┘         │
│                                                              │
│  Beat Schedule (celery beat):                                │
│    dispatch_email_checks          every 30s                  │
│    dispatch_live_workflows        every 60s                  │
│    dispatch_event_subscriptions   every 30s                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. The Three Pillars

### Step 1: Compile (`POST /api/clm/workflows/{id}/compile/`)

**What it does:**
1. Validates DAG structure (cycle detection, input/output node presence)
2. Validates each node's configuration (email creds, sheet_id, etc.)
3. **Creates `EventSubscription` rows** for each input node
4. Records a `WorkflowCompilation` audit entry
5. Sets `workflow.compilation_status = 'compiled'`

**Without compilation → workflows CANNOT execute via events.**
The `dispatch_event()` function checks `compilation_status == 'compiled'` and silently skips uncompiled workflows.

### Step 2: Go-Live (`POST /api/clm/workflows/{id}/go-live/`)

**What it does:**
1. Calls `compile_workflow()` internally (Step 1)
2. Sets `workflow.is_live = True`
3. Returns compilation result + subscription details

### Step 3: Execute (automatic or manual)

Once live + compiled, execution happens via:
- **Event dispatch**: Upload, sheet update, webhook, email → `dispatch_event()` → `execute_workflow_async.delay()`
- **Cron poll**: `dispatch_live_workflows` (every 60s) for non-event-driven workflows
- **Manual**: `POST /execute/` with `"async": true`

---

## 3. Complete Trigger Matrix

| Source | Trigger Path | Requires Celery? | EventSubscription Type |
|--------|-------------|-------------------|----------------------|
| **Manual upload** | `views.upload_documents()` → `dispatch_event('file_uploaded', 'upload')` → Celery | Yes | `upload` |
| **Manual execute** | `views.execute()` → `execute_workflow_async.delay()` → Celery | Yes (with sync fallback) | — |
| **Sheet update** | `sheets/views.py` → `handle_sheet_update()` → `dispatch_event('sheet_updated', 'sheet')` → Celery | Yes | `sheet` |
| **Webhook** | `views.webhook_ingest()` → `process_webhook()` → `dispatch_event()` → Celery | Yes | `webhook` |
| **Email inbox** | `dispatch_email_checks` (Beat, 30s) → `check_single_email_node` → IMAP fetch → Celery | Yes | `email` |
| **Cloud drive** | `dispatch_event_subscriptions` (Beat, 30s) → `poll_single_subscription` → fetch | Yes | `google_drive`, `dropbox`, etc. |
| **Cron (non-event)** | `dispatch_live_workflows` (Beat, 60s) → `execute_workflow_async.delay()` | Yes | — (skips event-driven) |
| **Document update** | `handle_document_update()` → `dispatch_event('document_updated', 'document')` | Yes | `document` |

### Critical: Which Workflows Does Cron SKIP?

`dispatch_live_workflows` **skips** workflows where ALL active subscriptions are `sheet` or `webhook` type. These are considered fully event-driven and should only fire from real-time events.

---

## 4. Data Flow: Upload → Execution

```
User uploads PDF to /api/clm/workflows/{id}/upload/
    │
    ├── 1. Creates WorkflowDocument (with file_hash dedup)
    ├── 2. Runs AI extraction (blocking, inline)
    ├── 3. If auto_execute_on_upload: runs sync execute_workflow()
    ├── 4. Syncs input_node.document_state
    │
    └── 5. If is_live AND compiled:
            dispatch_event('file_uploaded', 'upload', ...)
                │
                ├── Finds EventSubscriptions: source_type='upload', status='active'
                ├── Creates WebhookEvent record
                ├── Creates WorkflowExecution(status='queued')
                ├── execute_workflow_async.delay() → Redis → Celery Worker
                ├── Emits 'execution_queued' to SSE event bus
                └── Updates subscription stats
```

**Key: The upload endpoint now dispatches events for live workflows.** This was a missing link — previously uploads only triggered sync auto-execution, not the async event pipeline.

---

## 5. Data Flow: Sheet Update → Execution

```
User saves sheet rows in sheets app
    │
    └── sheets/views.py → _trigger_workflows_for_changed_rows()
            │
            └── event_system.handle_sheet_update(sheet_id, changed_data)
                    │
                    └── dispatch_event('sheet_updated', 'sheet', source_id=sheet_id)
                            │
                            ├── Guards:
                            │   ✓ EventSubscription.source_type='sheet'
                            │   ✓ EventSubscription.source_id matches sheet_id
                            │   ✓ EventSubscription.status='active'
                            │   ✓ workflow.is_live=True OR auto_execute_on_upload=True
                            │   ✓ workflow.compilation_status='compiled'
                            │
                            ├── Creates WebhookEvent + WorkflowExecution
                            ├── execute_workflow_async.delay() → Redis → Celery
                            └── Emits 'execution_queued' to SSE bus
```

**Common failure**: Sheet source_id in EventSubscription doesn't match the sheet UUID being updated (e.g., input node wasn't configured with the correct sheet_id before compilation).

---

## 6. Celery Task Architecture

### Tasks (in `clm/tasks.py`)

| Task | Schedule | Purpose |
|------|----------|---------|
| `execute_workflow_async` | On-demand | Wraps `execute_workflow()` with status tracking |
| `dispatch_live_workflows` | Beat: 60s | Fans out execution for non-event-driven live workflows |
| `dispatch_email_checks` | Beat: 30s | Polls email input nodes due for IMAP check |
| `dispatch_event_subscriptions` | Beat: 30s | Polls time-based subscriptions (cloud, FTP, etc.) |
| `check_single_email_node` | On-demand | IMAP fetch for one email input node |
| `poll_single_subscription` | On-demand | Polls one subscription (email, cloud, etc.) |

### `execute_workflow_async` Flow

```python
@shared_task(time_limit=600, soft_time_limit=540)
def execute_workflow_async(workflow_id, execution_id, ...):
    # 1. Load Workflow + WorkflowExecution from DB
    # 2. Mark execution → running
    # 3. Call execute_workflow() synchronously
    # 4. Mark execution → completed / failed
    # 5. Reset workflow.execution_state → idle (in finally block)
```

### Broker Fallback in `execute` View

When `execute_workflow_async.delay()` raises (Redis down), the view catches the exception and falls back to **synchronous** execution:

```python
except Exception as broker_err:
    # Celery broker unavailable — run synchronously
    result = _exec_sync(workflow, ...)
    return Response(result)
```

This means `POST /execute/` always works even without Celery/Redis. But `dispatch_event()` (upload/sheet triggers) does NOT have this fallback — it requires Celery.

---

## 7. Event Subscription System

### EventSubscription Model

Created by `compile_workflow()` for each input node:

| Field | Purpose |
|-------|---------|
| `source_type` | `upload`, `sheet`, `email`, `webhook`, `google_drive`, etc. |
| `source_id` | UUID of source (sheet_id, folder_id, etc.) — empty for `upload` |
| `status` | `active`, `paused`, `disabled` |
| `poll_interval` | Seconds between polls (0 = event-driven) |
| `webhook_token` | Auto-generated UUID for webhook URL |
| `consecutive_errors` | For exponential backoff |
| `total_events_received` | Audit counter |
| `total_executions_triggered` | Audit counter |

### Subscription Lifecycle

```
compile_workflow() → creates subs (status='active')
         │
         ├── pause() → status='paused' (all subs)
         ├── live PATCH {is_live: true} → reactivates paused subs
         └── compile again → update_or_create (preserves stats)
```

### Source Type → Subscription Mapping

```python
_SOURCE_MAP = {
    'upload':        'upload',
    'email_inbox':   'email',
    'webhook':       'webhook',
    'sheets':        'sheet',
    'document':      'document',
    'google_drive':  'google_drive',
    'dropbox':       'dropbox',
    'onedrive':      'onedrive',
    's3':            's3',
    'ftp':           'ftp',
    'url_scrape':    'url_scrape',
    'folder_upload': 'folder',
    'dms_import':    'dms',
    'table':         'sheet',
}
```

---

## 8. SSE Live Stream

### Architecture: Hybrid Approach

The SSE endpoint (`GET /api/clm/workflows/{id}/live-stream/`) uses two data sources:

1. **In-process event bus** (`live_events.py`): Threading-based pub/sub with ring buffer. Delivers events from sync executions in the web process instantly.

2. **DB polling** (every 2s): Reads `NodeExecutionLog` and `WorkflowExecution` records to detect progress from Celery workers (separate process).

This hybrid approach is necessary because the in-process event bus doesn't share state across processes.

### Frontend Hook: `useWorkflowLiveStream`

```javascript
// Polling-first (always works), SSE as optional enhancement
const { connected, nodeProgress, events, currentExecution } =
  useWorkflowLiveStream(workflowId, { autoConnect: true });
```

- Polls `GET /live-dashboard/` every 2-5s (adaptive)
- Tries SSE `/live-stream/` as bonus (8s timeout)
- `connectionMode`: `'none'` → `'polling'` → `'sse'`

### SSE Event Types

| Event | When | Data |
|-------|------|------|
| `execution_started` | Execution begins | `execution_id, mode, total_documents` |
| `execution_queued` | Event dispatched to Celery | `workflow_name, event_type, trigger` |
| `execution_completed` | Execution finishes | `status, duration_ms, output_count` |
| `node_started` | Node begins processing | `node_id, node_type, input_count, dag_level` |
| `node_progress` | Partial progress (sheet rows) | `processed, total, progress_pct` |
| `node_completed` | Node finishes | `output_count, duration_ms` |
| `node_failed` | Node errors | `error, node_id` |
| `live_tick` | Keepalive (25s) | `is_live, execution_state` |
| `compilation_done` | Compilation finished | `status, errors, warnings` |

---

## 9. Key Models & Fields

### Workflow (lifecycle fields)

| Field | Purpose |
|-------|---------|
| `is_live` | Whether event-driven execution is enabled |
| `is_active` | Master on/off switch |
| `live_interval` | Minimum seconds between cron-triggered executions |
| `compilation_status` | `'none'`, `'compiled'`, `'failed'` |
| `execution_state` | `'idle'`, `'compiling'`, `'executing'` |
| `current_execution_id` | Lock — UUID of running execution |
| `auto_execute_on_upload` | Sync execution after upload (legacy) |
| `nodes_config_hash` | SHA256 of all node configs (for smart execution) |

### WorkflowExecution

| Field | Purpose |
|-------|---------|
| `status` | `queued` → `running` → `completed` / `partial` / `failed` |
| `mode` | `full`, `batch`, `single`, `auto`, `smart` |
| `trigger_context` | Event payload that triggered this (changed_rows, etc.) |
| `result_data` | Full execution result (node_results, output_documents) |
| `node_summary` | Quick display: `[{node_id, type, label, count, status}]` |
| `duration_ms` | Total execution time |

### NodeExecutionLog

| Field | Purpose |
|-------|---------|
| `execution` | FK to WorkflowExecution |
| `node` | FK to WorkflowNode |
| `status` | `running`, `completed`, `failed`, `skipped` |
| `input_count` / `output_count` | Document flow metrics |
| `dag_level` | Topological sort level |
| `duration_ms` | Node processing time |

---

## 10. Checklist: "Why Isn't My Workflow Executing?"

### Infrastructure

- [ ] **Redis is running**: `redis-cli ping` → `PONG`
- [ ] **`redis` pip package installed**: `pip list | grep redis`
- [ ] **Celery worker running**: `celery -A drafter worker -l info`
- [ ] **Celery beat running**: `celery -A drafter beat -l info` (for scheduled tasks)
- [ ] **Django dev server running**: `python manage.py runserver 8000`

### Workflow Configuration

- [ ] **`workflow.is_active = True`**: Master switch
- [ ] **`workflow.is_live = True`**: Event-driven execution enabled
- [ ] **`workflow.compilation_status = 'compiled'`**: DAG validated + subscriptions created
- [ ] **`EventSubscription` rows exist**: Check via `GET /api/clm/workflows/{id}/subscriptions/`
- [ ] **Subscriptions are `status='active'`**: Not `paused` or `disabled`
- [ ] **Input node has correct `source_type`**: `upload`, `sheets`, `email_inbox`, etc.
- [ ] **Input node has correct source reference**: `sheet_id`, `email_host`, etc.

### Upload-Triggered Execution

- [ ] **Documents uploaded to the correct workflow**: Documents are workflow-scoped
- [ ] **Extraction completed**: `extraction_status = 'completed'` (not `failed`)
- [ ] **At least one document exists**: Empty workflows skip execution
- [ ] **Upload endpoint dispatches event**: Only for `is_live AND compiled` workflows

### Sheet-Triggered Execution

- [ ] **Sheet rows actually changed**: `changed_row_orders` must be non-empty
- [ ] **Sheet ID matches subscription**: `EventSubscription.source_id = sheet_id`
- [ ] **Row has data**: Empty rows are skipped

### Common Silent Failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| Upload works, but no async execution | Workflow not compiled | Call `POST /compile/` or `POST /go-live/` |
| "Subscription reactivated" but still no execution | Subscriptions were `disabled` (not `paused`) | Re-compile the workflow |
| Sheet saves don't trigger | `source_id` mismatch | Re-compile after setting correct `sheet_id` in input node |
| Celery task dispatched but never runs | Redis down or worker not running | `redis-cli ping` + start worker |
| Execution stuck in `running` | Worker crashed mid-execution | `POST /workflow-status/ {"action": "clear_lock"}` |

---

## 11. API Reference (Live Endpoints)

### Lifecycle

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/clm/workflows/{id}/compile/` | POST | Validate DAG + create subscriptions |
| `/api/clm/workflows/{id}/go-live/` | POST | Compile + set `is_live=True` |
| `/api/clm/workflows/{id}/live/` | GET | Get live status |
| `/api/clm/workflows/{id}/live/` | PATCH | Toggle `is_live`, set `live_interval` |
| `/api/clm/workflows/{id}/pause/` | POST | Set `is_live=False` + pause subs |

### Execution

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/clm/workflows/{id}/execute/` | POST | Manual execution (sync or async) |
| `/api/clm/workflows/{id}/execution-status/{exec_id}/` | GET | Poll async execution progress |
| `/api/clm/workflows/{id}/workflow-status/` | GET | Comprehensive workflow state |
| `/api/clm/workflows/{id}/workflow-status/` | POST | `{"action": "clear_lock"}` to unstick |

### Live Monitoring

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/clm/workflows/{id}/live-dashboard/` | GET | Snapshot for polling (2-5s) |
| `/api/clm/workflows/{id}/live-metrics/?period=24h` | GET | Detailed metrics with charts |
| `/api/clm/workflows/{id}/live-stream/` | GET | SSE real-time event stream |

### Event Audit

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/clm/workflows/{id}/subscriptions/` | GET | List EventSubscriptions |
| `/api/clm/workflows/{id}/event-log/` | GET | List WebhookEvent records |
| `/api/clm/workflows/{id}/compilation-history/` | GET | Past compilations |
| `/api/clm/workflows/{id}/execution-history/` | GET | Past executions |

---

## 12. Infrastructure Requirements

### Development

```bash
# Terminal 1: Redis
redis-server                    # or: brew services start redis

# Terminal 2: Django
source venv/bin/activate
python manage.py runserver 8000

# Terminal 3: Celery worker + beat (combined for dev)
source venv/bin/activate
celery -A drafter worker -B -l info

# Terminal 4: Frontend
cd frontend && npm run dev      # Vite on localhost:5173
```

### Python Packages

```
celery>=5.4.0      # Task queue
redis>=5.0.0       # Redis client (for Celery broker)
```

### Configuration (`drafter/settings.py`)

```python
CELERY_BROKER_URL = 'redis://127.0.0.1:6379/0'
CELERY_RESULT_BACKEND = 'redis://127.0.0.1:6379/0'

CELERY_BEAT_SCHEDULE = {
    'email-inbox-dispatcher':        {'task': 'clm.tasks.dispatch_email_checks',         'schedule': 30.0},
    'live-workflow-dispatcher':      {'task': 'clm.tasks.dispatch_live_workflows',       'schedule': 60.0},
    'event-subscription-dispatcher': {'task': 'clm.tasks.dispatch_event_subscriptions',  'schedule': 30.0},
}
```

---

## 13. Known Limitations

1. **In-process event bus doesn't cross processes**: SSE events emitted by Celery workers stay in the worker process. The `live-stream/` endpoint compensates with DB polling every 2s.

2. **No WebSocket support**: SSE is unidirectional (server → client). For bidirectional comms, the frontend uses REST API calls.

3. **LocMemCache is per-process**: Cache-based duplicate-dispatch guards only work within a single process. The DB-based `execution_state` field is the authoritative lock.

4. **sync `auto_execute_on_upload` can conflict with async live dispatch**: If both `auto_execute_on_upload=True` AND the workflow is live+compiled, an upload could trigger BOTH a sync execution and an async one via `dispatch_event`. The sync execution runs first and sets `execution_state='executing'`, so the async one will find the workflow busy and may create a duplicate or fail.

5. **Smart execution hash dedup**: Requires the previous execution's `DocumentExecutionRecord` to have the same `nodes_config_hash`. If nodes are reconfigured between executions, all docs are re-processed.

---

## File Reference

| File | Lines | Purpose |
|------|-------|---------|
| `clm/models.py` | ~2450 | All CLM data models |
| `clm/views.py` | ~7100 | All REST API endpoints (~60 actions) |
| `clm/event_system.py` | ~950 | Compilation, dispatch, webhook, sheet handler |
| `clm/node_executor.py` | ~2300 | DAG execution engine |
| `clm/tasks.py` | ~570 | Celery async tasks |
| `clm/live_events.py` | ~414 | In-process SSE event bus |
| `clm/urls.py` | ~45 | DRF router registration |
| `drafter/celery.py` | ~30 | Celery app config |
| `drafter/settings.py` | (section) | CELERY_* settings + beat schedule |
| `sheets/views.py` | (function) | `_trigger_workflows_for_changed_rows()` |
| `frontend/src/hooks/clm/useWorkflowLiveStream.js` | ~380 | Polling + SSE hook |
| `frontend/src/components/clm/ProcessingProgressPanel.jsx` | ~855 | Live monitoring UI |
