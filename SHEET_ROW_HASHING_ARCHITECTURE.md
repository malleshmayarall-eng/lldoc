# Sheet Row Hashing & Change Detection Architecture

> **Purpose**: Ensure CLM workflow executions only process sheet rows that
> actually changed — not the entire sheet on every trigger.

---

## 1. Problem Statement

When a CLM workflow is connected to a Sheet (either as an **input node**
with `source_type='sheets'` or as a **sheet node** with `mode='input'`),
every execution was re-processing *all* rows — even rows whose data
hadn't changed since the last run. This caused:

- **Wasted compute**: Downstream nodes (rules, AI, actions, validators)
  re-executed on identical data.
- **Duplicate side-effects**: Actions (email, webhook, doc-create) fired
  repeatedly for the same unchanged row.
- **Slow executions**: A 500-row sheet with 1 changed cell triggered 500
  rule evaluations + 500 AI calls instead of 1.

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    SHEET SAVE (Frontend)                      │
│   User edits rows → POST /api/sheets/<id>/bulk-update/       │
└─────────────────────────┬────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│            LAYER 1: Row-Level Hash Computation               │
│                                                              │
│  For each touched row:                                       │
│    new_hash = SHA-256(sorted cells JSON)                     │
│    if new_hash != row.row_hash:                              │
│      → row actually changed → add to changed_rows[]          │
│      → update row.row_hash in DB                             │
│    else:                                                     │
│      → skip (no data change)                                 │
│                                                              │
│  Files: sheets/models.py SheetRow.compute_row_hash()         │
│         sheets/views.py  SheetViewSet.bulk_update()          │
└─────────────────────────┬────────────────────────────────────┘
                          │ only changed rows
                          ▼
┌──────────────────────────────────────────────────────────────┐
│        LAYER 2: Per-Row Workflow Triggering                  │
│                                                              │
│  For each changed row × each subscribed workflow:            │
│    dispatch_event('sheet_row_saved', payload={               │
│      sheet_id, row_id, row_order, row_hash,                  │
│      changed_data: {                                         │
│        changed_row_ids: [row_id],                            │
│        changed_row_orders: [row_order],                      │
│      }                                                       │
│    })                                                        │
│                                                              │
│  Creates WorkflowExecution with trigger_context = payload    │
│                                                              │
│  Files: sheets/views.py  _trigger_workflows_for_changed_rows │
│         clm/event_system.py  dispatch_event()                │
└─────────────────────────┬────────────────────────────────────┘
                          │ trigger_context carries changed_row_ids
                          ▼
┌──────────────────────────────────────────────────────────────┐
│        LAYER 3: RowExecutionTracker (Safety Net)             │
│                                                              │
│  Tracks last_executed_hash per (sheet, row, workflow).       │
│  Even if the event dispatch fails:                           │
│    SheetRow.row_hash ≠ RowExecutionTracker.last_executed_hash│
│    → reconcile-pending endpoint catches the gap              │
│                                                              │
│  On success: mark_triggered() updates last_executed_hash     │
│  On failure: mark_failed() increments consecutive_failures   │
│                                                              │
│  Files: sheets/models.py  RowExecutionTracker                │
│         sheets/views.py   reconcile_pending()                │
└─────────────────────────┬────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│        LAYER 4: Workflow Execution — Input Filtering         │
│                                                              │
│  TWO paths feed sheet data into the workflow DAG:            │
│                                                              │
│  PATH A: Input Node (source_type='sheets')                   │
│  ─────────────────────────────────────────                   │
│  _execute_input_node() in node_executor.py:                  │
│                                                              │
│  1. Reads trigger_context from execution                     │
│  2. If changed_row_ids present → filter Sheet rows query     │
│  3. For each row, compute content hash:                      │
│     • existing doc with same hash → SKIP (unchanged)         │
│     • existing doc with different hash → UPDATE + add to     │
│       _sheets_changed_doc_ids                                │
│     • no existing doc → CREATE + add to                      │
│       _sheets_changed_doc_ids                                │
│  4. Return ONLY _sheets_changed_doc_ids (not all ready docs) │
│     → downstream nodes process only changed rows             │
│                                                              │
│  PATH B: Sheet Node (node_type='sheet', mode='input')        │
│  ────────────────────────────────────────────────────        │
│  sheet_node_executor.py → _execute_sheet_input():            │
│                                                              │
│  1. If changed_row_ids from trigger_context → filter rows    │
│  2. If manual run (no trigger_context):                      │
│     • Load last-read hashes from SheetNodeQuery              │
│     • For each row: if hash matches last read → SKIP         │
│  3. Returns only changed rows in result['rows']              │
│                                                              │
│  node_executor.py (sheet node handler):                      │
│  4. Creates/updates WorkflowDocuments from result rows       │
│  5. Only adds doc IDs to output_ids if:                      │
│     • New row (no existing doc) → always add                 │
│     • Existing doc with DIFFERENT hash → update + add        │
│     • Existing doc with SAME hash → DO NOT ADD (skip)        │
│  6. output_ids = only changed/new row doc IDs                │
│                                                              │
│  Files: clm/node_executor.py                                 │
│         clm/sheet_node_executor.py                           │
└─────────────────────────┬────────────────────────────────────┘
                          │ only changed doc IDs flow downstream
                          ▼
┌──────────────────────────────────────────────────────────────┐
│        LAYER 5: Downstream DAG (Rules → AI → Actions)        │
│                                                              │
│  Only receives doc IDs for rows that actually changed.       │
│  Unchanged rows never reach rule evaluation, AI extraction,  │
│  action execution, etc.                                      │
│                                                              │
│  Additionally, smart execution (hash-based DAG dedup) can    │
│  skip docs that were already processed with the same         │
│  nodes_config_hash + file_hash combo.                        │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Hash Functions

### 3.1 SheetRow.row_hash (Layer 1)

```python
# sheets/models.py — SheetRow.compute_row_hash()
def compute_row_hash(self) -> str:
    cells = self.cells.order_by('column_key').values_list('column_key', 'raw_value')
    payload = json.dumps(list(cells), sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()
```

- **Input**: All cells in the row, ordered by `column_key`.
- **Stored**: `SheetRow.row_hash` (CharField, max 64, indexed).
- **Updated**: On every `bulk-update` save, only for touched rows.
- **Comparison point**: `_trigger_workflows_for_changed_rows()` compares
  `new_hash != row.row_hash` to determine if the row actually changed.

### 3.2 Content Hash (Layer 4 — Workflow Documents)

```python
# clm/node_executor.py — used in both input-node and sheet-node paths
row_hash = hashlib.sha256(
    json.dumps(row_meta, sort_keys=True, default=str).encode()
).hexdigest()
```

- **Input**: The metadata dict built from cell values (using column labels
  as keys, computed_value preferred over raw_value).
- **Stored**: `WorkflowDocument.file_hash` for the corresponding doc.
- **Comparison point**: `existing.file_hash == row_hash` determines whether
  the doc content changed — if equal, the doc is skipped from output_ids.

### 3.3 SheetNodeQuery.content_hash (Layer 4 — Read Cache)

```python
# clm/sheet_node_executor.py — _compute_row_hash()
def _compute_row_hash(data: dict) -> str:
    payload = json.dumps(data, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()
```

- **Input**: The row data dict after column-mapping resolution.
- **Stored**: `SheetNodeQuery.content_hash` (indexed, per query record).
- **Comparison point**: On manual execution (no trigger_context),
  `_execute_sheet_input()` loads the last completed READ query per row and
  compares `_last_read_hashes[row.id] == content_hash`. Match → cache hit,
  row skipped from output.

### 3.4 Write Dedup Hash (Storage Mode)

```python
# clm/sheet_node_executor.py — _execute_sheet_storage()
content_hash = _compute_row_hash(meta)
existing_query = SheetNodeQuery.objects.filter(
    node=node, sheet=sheet, content_hash=content_hash,
    operation__in=['write', 'append'], status='completed',
).first()
```

- Prevents writing identical data to the sheet twice.
- On cache hit: increments `hit_count`, records `status='cached'`.

---

## 4. Data Flow — Event-Triggered Execution

```
User saves row 5 in Sheet ABC
  │
  ├─ compute_row_hash() → "a1b2c3..." (different from stored "x9y8z7...")
  │   → row.row_hash = "a1b2c3..."
  │
  ├─ _trigger_workflows_for_changed_rows()
  │   → dispatch_event('sheet_row_saved', payload={
  │       changed_row_ids: ['<row-5-uuid>'],
  │       changed_row_orders: [5],
  │       row_hash: 'a1b2c3...',
  │     })
  │
  ├─ WorkflowExecution.trigger_context = payload
  │
  ├─ execute_workflow() starts
  │   │
  │   ├─ Input node (source_type='sheets'):
  │   │   reads trigger_context.changed_row_ids → filters query to row 5 only
  │   │   row 5 hash != existing doc hash → updates doc → returns [doc-5-id]
  │   │
  │   ├─ Rule node: evaluates 1 doc (not 500)
  │   ├─ AI node: processes 1 doc
  │   ├─ Action node: fires for 1 doc
  │   └─ Output: 1 doc
  │
  └─ RowExecutionTracker.mark_triggered(row=5, hash='a1b2c3...')
```

---

## 5. Data Flow — Manual Execution (No trigger_context)

```
User clicks "Run Workflow" manually
  │
  ├─ WorkflowExecution.trigger_context = {} (empty)
  │
  ├─ execute_workflow() starts
  │   │
  │   ├─ Input node (source_type='sheets'):
  │   │   trigger_context empty → processes ALL rows
  │   │   For each row:
  │   │     compute hash → compare with existing doc's file_hash
  │   │     row 1: hash matches → SKIP
  │   │     row 2: hash matches → SKIP
  │   │     row 5: hash differs → UPDATE doc → add to changed list
  │   │     row 6: no existing doc → CREATE doc → add to changed list
  │   │   Returns [doc-5-id, doc-6-id] (only 2 of 500 rows)
  │   │
  │   ├─ Rule node: evaluates 2 docs
  │   ├─ AI node: processes 2 docs
  │   └─ Action node: fires for 2 docs
  │
  ├─ Sheet Node (mode='input', no trigger_context):
  │   │
  │   ├─ _execute_sheet_input():
  │   │   Load last-read hashes from SheetNodeQuery
  │   │   row 1: hash == last read hash → cache hit → SKIP
  │   │   row 2: hash == last read hash → cache hit → SKIP
  │   │   row 5: hash != last read hash → INCLUDE in result
  │   │   Returns rows=[row-5] with cache_hits=499
  │   │
  │   ├─ node_executor sheet handler:
  │   │   row 5: existing doc hash != new hash → UPDATE → add to output
  │   │   remaining: not in result (filtered by sheet_node_executor)
  │   │   output_ids = [doc-5-id]
  │   │
  │   └─ Downstream: only 1 doc flows through
```

---

## 6. Key Models & Fields

| Model | Field | Purpose |
|-------|-------|---------|
| `SheetRow` | `row_hash` | SHA-256 of all cell values; updated on save |
| `RowExecutionTracker` | `last_executed_hash` | Hash when workflow was last triggered for this row |
| `WorkflowDocument` | `file_hash` | Content hash of the row metadata (for input-node path) |
| `SheetNodeQuery` | `content_hash` | Hash of row payload per read/write operation |
| `WorkflowExecution` | `trigger_context` | Carries `changed_row_ids` / `changed_row_orders` from event |

---

## 7. Key Functions

| Function | File | Role |
|----------|------|------|
| `SheetRow.compute_row_hash()` | `sheets/models.py` | Compute deterministic hash from all cells |
| `_trigger_workflows_for_changed_rows()` | `sheets/views.py` | Dispatch per-row events for changed rows |
| `dispatch_event()` | `clm/event_system.py` | Route events to subscribed workflows |
| `_execute_input_node()` | `clm/node_executor.py` | Input node: filters sheets rows, returns only changed doc IDs |
| `_execute_sheet_input()` | `clm/sheet_node_executor.py` | Sheet node read: hash-based skip for unchanged rows |
| `execute_sheet_node()` | `clm/sheet_node_executor.py` | Public entry point for sheet node execution |
| `RowExecutionTracker.mark_triggered()` | `sheets/models.py` | Record successful trigger (update hash) |
| `RowExecutionTracker.find_pending_rows()` | `sheets/models.py` | Find rows where hash is stale (for reconciliation) |

---

## 8. Change Detection Decision Matrix

| Scenario | Trigger Source | Row Filter | Hash Comparison | Output |
|----------|---------------|------------|-----------------|--------|
| Event-triggered (row save) | `dispatch_event` → `trigger_context` | Filter to `changed_row_ids` | Compare doc `file_hash` | Only changed docs |
| Manual execution | User click → empty `trigger_context` | Process all rows | Compare doc `file_hash` | Only changed/new docs |
| Sheet node (event) | `trigger_context.changed_row_ids` | Filter rows by ID | Compare via `SheetNodeQuery` last-read hash | Only changed rows in result |
| Sheet node (manual) | No trigger_context | Process all rows | Compare via `SheetNodeQuery` last-read hash | Only changed rows in result |
| Storage write | Upstream doc IDs | N/A | `SheetNodeQuery.content_hash` write dedup | Skip identical writes |
| Reconcile-pending | POST endpoint | `find_pending_rows()` | `row_hash ≠ last_executed_hash` | Re-trigger stale rows |

---

## 9. Reconciliation (Safety Net)

If an event dispatch fails (network error, Celery down, etc.):

1. `RowExecutionTracker.last_executed_hash` remains stale
2. `SheetRow.row_hash` has the new value
3. `GET /api/sheets/<id>/reconcile-pending/` detects the mismatch
4. `POST /api/sheets/<id>/reconcile-pending/` re-triggers workflows
5. Frontend can call this on a "Sync" button or periodically

---

## 10. Performance Characteristics

| Sheet Size | Rows Changed | Old Behavior | New Behavior | Speedup |
|------------|-------------|--------------|--------------|---------|
| 100 rows | 1 row | 100 rule evals + 100 AI calls | 1 rule eval + 1 AI call | ~100× |
| 500 rows | 3 rows | 500 rule evals + 500 AI calls | 3 rule evals + 3 AI calls | ~167× |
| 1000 rows | 0 rows | 1000 rule evals + 1000 AI calls | 0 (empty output) | ∞ |

The overhead of hash computation + DB lookups is O(n) with n = total rows,
but the constant is tiny (SHA-256 + one DB query) compared to the cost of
downstream AI/action execution which is now O(k) with k = changed rows.

---

## 11. Edge Cases

### First Execution (No History)
- No `SheetNodeQuery` records exist → `_last_read_hashes` is empty
- No `WorkflowDocument` with matching `_row_order` exists
- All rows are treated as **new** → all get processed
- After execution, hashes are stored for future comparisons

### Row Deleted from Sheet
- The row no longer exists in `sheet.rows`
- Its `WorkflowDocument` remains (orphaned but harmless)
- No re-execution triggered since the row isn't in the query

### Column Added/Removed
- `compute_row_hash()` uses `column_key` ordering → hash changes
- All rows get new hashes → all re-process (correct behavior)

### Formula Recalculation
- `computed_value` changes → `row_hash` changes → row re-processes
- Even if `raw_value` is unchanged, formula output change is detected

### Concurrent Edits
- Each save computes hashes independently
- `RowExecutionTracker` uses `update_or_create` → last write wins
- If two saves overlap, the reconcile-pending endpoint catches any gap

### NULL-Safe JSON Queries (SQLite + Postgres)
- When querying `global_metadata._source`, docs with no `_source` key return
  `NULL` from `JSON_EXTRACT`.
- `NOT (NULL IN (...))` evaluates to `NULL` (not `TRUE`) in SQL, which
  incorrectly excludes docs that have no tag at all.
- **Fix**: Use positive `Q(global_metadata___source='upload') |
  Q(global_metadata___source__isnull=True)` instead of
  `.exclude(global_metadata___source__in=_ALL_NON_UPLOAD_SOURCES)`.
- Applies to: archive, restore, and fallback query paths in
  `_execute_input_node()` (`clm/node_executor.py`).

---

## 12. Stable Row Identity (`_row_id`)

### Problem
Previous implementation matched existing `WorkflowDocument` records by
`_row_order` (the row's positional index in the sheet). This is **fragile**:

- **Row reorder**: Dragging row 3 to position 1 changes all row orders.
  The doc that was previously "Row 3" now matches "Row 1" — wrong identity.
- **Row insertion**: Inserting a new row shifts all subsequent orders.
  Downstream nodes see "updates" that are actually different rows.
- **Row deletion**: Deleting a middle row shifts orders downward. A doc
  for deleted row 2 now mismatches with new row 2's data.

### Solution: `_row_id` (SheetRow UUID)
Every `SheetRow` has a stable UUID primary key (`id`) assigned at creation.
This UUID:
- Never changes when rows are reordered, inserted, or deleted
- Is stored in `WorkflowDocument.global_metadata._row_id`
- Is the **primary** dedup/match key for both paths:
  - Input node (`source_type='sheets'`) — `existing_docs_by_row_id`
  - Sheet handler (`node_type='sheet'`, `mode='input'`) — `_existing_by_row_id`

**Legacy fallback**: Docs created before this change may lack `_row_id`.
Both paths fall back to `_row_order` matching for those docs.

### Data Flow
```
SheetRow.id (UUID)
  → passed as row_entry['row_id'] from sheet_node_executor
  → stored in WorkflowDocument.global_metadata._row_id
  → used as primary key in existing doc lookup dicts
  → used as RowActionLog.row_id for action dedup
```

### Files Changed
- `clm/node_executor.py` — `_execute_input_node()` sheets path (~L746):
  `existing_docs_by_row_id` dict indexed by `_row_id`, fallback `existing_docs_by_order`
- `clm/node_executor.py` — Sheet handler (~L1790):
  `_existing_by_row_id` dict indexed by `_row_id`, fallback `_existing_by_order`

---

## 13. Action Idempotency Guard (`RowActionLog`)

### Problem
Even when only changed rows flow downstream, **live workflows** that
re-trigger frequently (e.g., auto-save every 30 seconds) can fire the
same action for the same unchanged row data if the execution's
`trigger_context` is stale or the same data arrives via a different path.

Side-effect nodes (action → email/webhook, doc_create → editor documents)
must be **idempotent**: executing twice with the same data should not
produce duplicate side-effects.

### Solution: `RowActionLog` Model

```
┌─────────────────────────────────────────────────────────────┐
│                      RowActionLog                           │
│                                                             │
│  PK: (node, row_id, content_hash)  ← unique_together       │
│                                                             │
│  row_id       = SheetRow UUID (stable identity)             │
│  content_hash = SHA-256 of row data when action fired       │
│  action_type  = plugin name (e.g., 'send_email')            │
│  status       = 'executed' | 'skipped' | 'failed'           │
│  workflow     = FK to Workflow                               │
│  node         = FK to WorkflowNode                           │
│  execution    = FK to WorkflowExecution (nullable)           │
│  created_at   = timestamp                                    │
└─────────────────────────────────────────────────────────────┘
```

### Decision Matrix

| Same row_id? | Same content_hash? | Action |
|:---:|:---:|:---|
| ✗ | — | **Execute** (new row, never seen) |
| ✓ | ✓ | **Skip** (already processed, data unchanged) |
| ✓ | ✗ | **Re-execute** (same row, data changed) |

### Guard Flow (per document in action/doc_create loop)

```
1. Extract _row_id from doc.global_metadata._row_id (or doc.id)
2. Get content_hash from doc.file_hash (or compute SHA-256)
3. Check: RowActionLog.has_been_executed(node, row_id, content_hash)?
   → YES: skip (log as 'Deduplicated')
   → NO:  execute plugin
4. On success: RowActionLog.record_execution(...)
```

### Files Changed
- `clm/models.py` — New `RowActionLog` model (migration 0039)
- `clm/action_executor.py` — Dedup check before `plugin_instance.execute()`,
  record after success. Added `workflow_execution` parameter.
- `clm/document_creator_executor.py` — Dedup check before `handler()`,
  record after success. Added `workflow_execution` parameter.
- `clm/node_executor.py` — Pass `workflow_execution=execution` to both
  `execute_action_node()` and `execute_doc_create_node()`.

### Performance
- `RowActionLog` has a composite index on `(node, row_id, content_hash)`
  — the `has_been_executed()` lookup is a single indexed query.
- `unique_together` constraint prevents double-inserts from concurrent
  executions (DB-level race protection).
- Old logs can be cleaned up via `RowActionLog.cleanup_old_logs(days=90)`.

---

## 14. Complete Dedup Stack (All 8 Layers)

| Layer | Where | What it prevents |
|:---:|:---|:---|
| 1 | `SheetRow.compute_row_hash()` | Detects cell-level changes |
| 2 | `_trigger_workflows_for_changed_rows()` | Only triggers for changed rows |
| 3 | `WorkflowExecution.trigger_context` | Carries changed_row_ids to executor |
| 4 | `_execute_input_node()` + sheet handler | Only returns changed doc IDs |
| 5 | `SheetNodeQuery` content_hash cache | Skips unchanged rows on manual runs |
| 6 | `WorkflowDocument.file_hash` comparison | Skips update if doc data unchanged |
| 7 | `RowActionLog` | Prevents duplicate side-effects across executions |
| **8** | **`InputNodeRow`** | **DB-level input tracking — skips unchanged rows without loading all docs** |

---

## 15. InputNodeRow — DB-Level Input Tracking

### Problem

Even with hash-based change detection, both input paths (`source_type='sheets'`
and `node_type='sheet', mode='input'`) were loading **ALL existing
WorkflowDocuments** into Python on every execution just to compare hashes.
For a 500-row sheet this meant 500 ORM `get()` or `filter()` calls on every
run, even when 499 rows were unchanged.

### Solution: `InputNodeRow` Model

New model in `clm/models.py` (migration `0040_input_node_row`):

```
InputNodeRow
├── id            UUID (PK)
├── workflow      FK → Workflow
├── node          FK → WorkflowNode
├── row_id        CharField (stable SheetRow UUID)
├── content_hash  CharField(64) — SHA-256 of row data
├── document      FK → WorkflowDocument (the doc created for this row)
├── source_type   'sheets' | 'sheet_node'
├── sheet_id      CharField (for debugging/filtering)
├── row_order     IntegerField (informational)
├── created_at    DateTimeField
└── updated_at    DateTimeField
```

**Unique constraint**: `(node, row_id)` — one tracked entry per row per node.

**Indexes**:
- `(node, row_id)` — primary lookup
- `(node, content_hash)` — batch hash comparison
- `(workflow, node)` — workflow-level queries

### Decision Matrix Per Row

| InputNodeRow exists? | Hash matches? | Action |
|:---:|:---:|:---|
| ✗ | — | CREATE WorkflowDocument + INSERT InputNodeRow |
| ✓ | ✓ | **SKIP** (unchanged — no DB write at all) |
| ✓ | ✗ | UPDATE existing WorkflowDocument + UPDATE InputNodeRow hash |

### API

```python
# Load all known rows for a node in one query → {row_id: (hash, doc_id)}
known = InputNodeRow.load_hash_map(node)

# Insert or update a tracked row
InputNodeRow.upsert(node, workflow, row_id, content_hash, document,
                    source_type='sheets', sheet_id='', row_order=None)
```

### Execution Flow (Both Input Paths)

```
1. InputNodeRow.load_hash_map(node) → single SQL query
2. For each sheet row:
   a. Compute row_hash from cell data
   b. Check known_rows[row_id]
      → hash matches? SKIP (zero DB ops)
      → hash differs? UPDATE doc + upsert InputNodeRow
      → not found? CREATE doc + upsert InputNodeRow
3. Only new/changed doc IDs returned to downstream nodes
```

### Performance

- **First execution**: N rows → N creates + N InputNodeRow inserts (same as before)
- **Subsequent execution, 0 changes**: 1 SQL query (load_hash_map) + N hash comparisons in Python → **zero** WorkflowDocument queries
- **Subsequent execution, 1 change**: 1 SQL query + 1 update + 1 upsert → **O(1)** instead of **O(N)**

### Files Changed

- `clm/models.py` — New `InputNodeRow` model
- `clm/migrations/0040_input_node_row.py` — Migration
- `clm/node_executor.py` — Both `source_type='sheets'` (input node) and
  `node_type='sheet', mode='input'` (sheet handler) rewritten to use
  `InputNodeRow.load_hash_map()` / `InputNodeRow.upsert()` instead of
  loading all WorkflowDocuments
