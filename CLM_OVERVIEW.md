# Drafter CLM — Contract Lifecycle Management Overview

> **Visual, no-code workflow automation for processing contracts and documents at enterprise scale.**

---

## What Is Drafter CLM?

Drafter CLM is a **visual workflow builder** embedded inside the Drafter platform.
Think of it as an **n8n / Zapier for legal documents** — you drag nodes onto a canvas,
connect them with directed edges, and the system automatically routes, extracts,
filters, approves, and acts on every contract that enters the pipeline.

Unlike traditional CLM tools that force linear approval chains, Drafter CLM uses a
**Directed Acyclic Graph (DAG)** architecture, giving teams full freedom to build
branching, merging, and parallel processing flows.

---

## At a Glance

| Metric | Value |
|--------|-------|
| Node types | **11** (Input, Rule, AI, Validator, Action, Listener, AND Gate, Scraper, Document Creator, Inference, Output) |
| Supported file types | **9** — PDF, DOCX, DOC, TXT, CSV, JSON, XML, HTML, Markdown |
| Input sources | **10+** — Upload, Email Inbox, Webhook, Sheets, Google Drive, Dropbox, OneDrive, S3, FTP, URL Scrape, DMS Import |
| Execution modes | Manual, Auto-on-Upload, Live (event-driven), Cron (time-based) |
| Real-time updates | SSE live stream + adaptive polling (2–5 s) |
| AI models | Google Gemini, ChatGPT (configurable per node) |
| Background tasks | Celery + Redis with automatic sync fallback |

---

## How It Works — Three Steps

```
 ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
 │  1. BUILD    │ ───▶ │  2. GO LIVE  │ ───▶ │  3. EXECUTE  │
 │  Drag & drop │      │  Compile +   │      │  Automatic   │
 │  nodes on    │      │  activate    │      │  or manual   │
 │  the canvas  │      │  event subs  │      │  DAG run     │
 └──────────────┘      └──────────────┘      └──────────────┘
```

### Step 1 — Build Your Workflow

Open the **Workflow Canvas**, drag nodes from the toolbar, and connect them with
directed edges. Each node has a dedicated configuration panel:

- **Input** → choose source (upload, email inbox, webhook, sheets, cloud drives…)
- **Rule** → set metadata conditions (AND/OR groups, 11 operators)
- **AI** → configure AI model, prompt, and extraction fields
- **Validator** → assign reviewers with branching paths (approved / rejected)
- **Action** → trigger side-effects (email, WhatsApp, SMS, webhook)
- **Output** → collect the final filtered document set

### Step 2 — Compile & Go Live

Click **Go Live** (or call `POST /compile/` then `POST /go-live/`).
The system:

1. **Validates** the DAG (cycle detection, required nodes)
2. **Creates Event Subscriptions** for every input source
3. **Activates** subscriptions so incoming events trigger execution automatically

### Step 3 — Documents Flow Through the Pipeline

Every time a document enters (upload, email, sheet update, webhook…):

1. AI extracts metadata from the document (NuExtract / Gemini)
2. Rule nodes filter by metadata conditions and score risk
3. Validator nodes pause for human approval with branching
4. Action nodes fire notifications (email, WhatsApp, SMS)
5. Output nodes collect the final processed set

The entire run is tracked with a **full audit trail** per document.

---

## The 11 Node Types

| # | Node | Icon | What It Does |
|---|------|------|-------------|
| 1 | **Input** | 📂 | Entry point — brings documents into the workflow from any of 10+ source types |
| 2 | **Rule** | ⚖️ | Metadata filter with AND/OR condition groups and 11 comparison operators |
| 3 | **AI** | 🤖 | Runs Gemini or ChatGPT on each document — extracts fields, classifies, summarizes |
| 4 | **Validator** | ✅ | Human approval gate — assigned reviewers approve or reject with branching paths |
| 5 | **Action** | ⚡ | Fires side-effects: send email, WhatsApp, SMS, or call a webhook |
| 6 | **Listener** | 👂 | Watches an email inbox or folder and auto-triggers the workflow on new messages |
| 7 | **AND Gate** | 🔀 | Set intersection — passes only documents present in **all** upstream paths |
| 8 | **Scraper** | 🌐 | Fetches data from allowed websites to enrich document metadata |
| 9 | **Document Creator** | 📝 | Auto-creates a full Drafter editor document from CLM extracted metadata |
| 10 | **Inference** | 🧠 | Runs the Drafter hierarchical inference engine on each document |
| 11 | **Output** | 📤 | Terminal node — collects the final filtered/processed document list |

---

## Input Sources

The **Input node** supports 10+ document sources, each with its own trigger mechanism:

| Source | Trigger | Requires Celery? |
|--------|---------|:-----------------:|
| **Manual Upload** | REST API or drag-and-drop in the UI | ✅ |
| **Email Inbox** | IMAP polling every 30 s (Celery Beat) | ✅ |
| **Webhook** | External system POSTs to a unique URL | ✅ |
| **Sheets** | Row save in the Drafter Sheets app | ✅ |
| **Google Drive** | Celery Beat polls for new files every 30 s | ✅ |
| **Dropbox** | Celery Beat polling | ✅ |
| **OneDrive** | Celery Beat polling | ✅ |
| **S3** | Celery Beat polling | ✅ |
| **FTP/SFTP** | Celery Beat polling | ✅ |
| **URL Scrape** | On-demand or scheduled | ✅ |
| **DMS Import** | Imports from the Drafter DMS archive | ✅ |
| **Folder Upload** | Watch a DriveFolder for new files | ✅ |

---

## Rule Engine — Smart Filtering

Rules use **nested condition groups** with boolean logic to filter documents by
any metadata field.

### 11 Comparison Operators

| Operator | Example |
|----------|---------|
| `eq` (equals) | `jurisdiction eq "US"` |
| `neq` (not equals) | `status neq "expired"` |
| `gt` / `gte` | `contract_value gt 50000` |
| `lt` / `lte` | `days_to_expiry lt 30` |
| `contains` | `vendor_name contains "Acme"` |
| `not_contains` | `clause_text not_contains "indemnity"` |
| `is_empty` / `is_not_empty` | `signature is_not_empty` |
| `regex` | `ref_number regex "^INV-\\d{4}"` |

### Risk Scoring

Each rule can **add weighted risk points** to a document. When the cumulative risk
score exceeds a configurable threshold, the document is auto-rejected or flagged.

### Rule Actions

| Action | Effect |
|--------|--------|
| `auto_approve` | Immediately clear the document |
| `auto_reject` | Immediately reject |
| `add_risk_points` | Accumulate risk score |
| `flag_for_review` | Mark for human attention |
| `route_to_user` | Assign to a specific reviewer |

---

## AI-Powered Extraction

Every document entering the workflow can be **automatically analyzed** by an AI node:

1. **NuExtract** extracts structured fields from the document text using a schema
   you define (or that the system auto-generates from your Rule conditions)
2. **Gemini / ChatGPT** runs custom prompts for classification, summarization,
   risk assessment, or any free-form analysis
3. Extracted fields are stored per-document and flow downstream for Rule evaluation

### Zero-Config Templates

You don't need to author extraction templates manually. The system **auto-collects**
field names from your Rule nodes and builds a NuExtract template automatically.

---

## Validator — Human-in-the-Loop Approval

The **Validator node** pauses the pipeline and waits for a human decision:

- Assign one or more reviewers (users or teams)
- Reviewers see a task in their dashboard and can **approve** or **reject**
- The workflow **branches** based on the decision:
  - `"approved"` → path A (continue processing)
  - `"rejected"` → path B (send rejection notice, re-route, etc.)
- Supports multi-level approval chains (sequential or parallel)
- SLA tracking with breach alerts

---

## Live Mode — Event-Driven Execution

Once a workflow is **compiled** and **live**, it reacts to events in real time:

```
 Event (upload, email, sheet save, webhook)
     │
     ▼
 dispatch_event()
     │
     ├── Matches EventSubscription (source_type + source_id)
     ├── Creates WorkflowExecution (status = "queued")
     └── Dispatches to Celery → execute_workflow_async()
                                      │
                                      ▼
                              DAG topological sort → execute each node
```

### Real-Time Monitoring

While the workflow runs, the frontend receives live updates via **Server-Sent Events (SSE)**:

| Event | When |
|-------|------|
| `execution_started` | Workflow run begins |
| `node_started` | A node begins processing |
| `node_progress` | Per-document progress within a node |
| `node_completed` | A node finishes |
| `node_failed` | A node errors |
| `execution_completed` | Entire run finishes |
| `live_tick` | Heartbeat every 25–30 s |

The frontend also **polls** the `/live-dashboard/` endpoint every 2–5 s as a reliable
fallback, with adaptive interval based on activity.

---

## Smart Re-Execution

Drafter CLM uses **content hashing** to avoid redundant work:

- Every workflow's DAG shape is captured in a **SHA-256 `nodes_config_hash`**
- Each document tracks which config hash it was last processed with
- When you re-execute (or the cron fires), **only new or changed documents** are
  processed — unchanged ones are skipped entirely

This makes re-runs after small edits **near-instant**, even for workflows with
thousands of documents.

---

## Derived Fields

Compute new fields from extracted data without writing code:

```
total_value = unit_price × quantity
days_remaining = expiration_date − today()
risk_category = IF(risk_score > 70, "High", IF(risk_score > 30, "Medium", "Low"))
```

Derived fields flow through the pipeline just like extracted fields and can be used
in downstream Rule conditions.

---

## Upload Links — External Document Collection

Share a **secure, OTP-protected link** with external parties (vendors, clients,
counterparties) so they can submit documents directly into a workflow:

- No Drafter account required
- OTP email verification
- Documents land in the Input node and trigger the pipeline automatically
- Full audit trail of who uploaded what and when

---

## Workflow Chat — AI Configuration Assistant

Not sure how to set up your workflow? Open the **Workflow Chat** — an AI assistant
that understands your workflow's structure and can suggest:

- Which node types to add
- How to configure rule conditions
- Optimal AI prompts for your document type
- Performance optimizations

---

## Built for SME Decision-Makers

Most CLM tools are built for enterprises with dedicated operations teams.
Drafter CLM is different — it's designed so a **founder, GM, or head of legal at a
10–200 person company** can see exactly what's happening across every contract
**without opening a single spreadsheet**.

### Why This Matters for SMEs

| Pain Point | Drafter CLM Answer |
|------------|--------------------|
| "I don't know which contracts are at risk" | **Traffic Light System** — every document is red / yellow / green at a glance |
| "We lose track of renewals and deadlines" | **SLA breach alerts** surface overdue reviews automatically |
| "I can't prove our legal tool is saving money" | **Hours Saved metric** quantifies automation ROI in real dollars |
| "Setting up workflows takes a consultant" | **No-code canvas** — drag, connect, go live in minutes |
| "Our team is too small for a CLM rollout" | **Zero infrastructure** — SQLite in dev, one-click Go Live, sync fallback if Redis is down |

### The Renewal Conversation

When it's time to justify next year's subscription, open the **CLM Dashboard** and
show three numbers:

1. **Hours Saved** — total manual review hours eliminated by automation
2. **Auto-Approved vs. Pending** — ratio of contracts cleared without human touch
3. **SLA Breaches Prevented** — deadlines caught before they became problems

No pivot tables. No CSV exports. No "let me pull that report." Just open the
dashboard and point.

---

## Dashboard & Analytics

### Workflow Dashboard

One screen, seven numbers — everything a founder needs to know:

| Metric | Description | Why It Matters |
|--------|-------------|----------------|
| **Total contracts** | All documents in the workflow | Portfolio size at a glance |
| **Auto-approved** | Cleared without human review | Shows how much your rules handle automatically |
| **Auto-rejected** | Rejected by rule conditions | Catches bad contracts before anyone wastes time |
| **Pending approval** | Waiting for human decision | Tells you where the bottleneck is *right now* |
| **SLA breached** | Overdue review tasks | Early warning before missed deadlines cost money |
| **Avg. risk score** | Aggregate risk across all documents | Portfolio health in one number |
| **Hours saved** | Estimated automation ROI | **The number you show in the renewal meeting** |

### Traffic Light System — See Risk Without Reading a Single Page

Every document gets an automatic colour based on its cumulative risk score:

| Colour | Meaning | Typical Action |
|--------|---------|----------------|
| 🟢 **Green** | Low risk — within policy | Auto-approved or fast-tracked |
| 🟡 **Yellow** | Medium risk — needs attention | Routed to a reviewer for spot-check |
| 🔴 **Red** | High risk — potential exposure | Escalated to senior counsel; SLA clock starts |

Managers glance at the red / yellow / green breakdown and instantly know whether the
contract portfolio is healthy — no scrolling through rows, no conditional formatting
in Excel.

### Hours Saved — Prove ROI at Renewal Time

The **Hours Saved** metric is calculated from:

- Number of documents auto-processed (extraction + rule evaluation + routing)
- Estimated manual review time per document (configurable per workflow)
- Cumulative total displayed on the dashboard in **hours** and **estimated cost**

> **Example:** 500 vendor contracts × 12 min average manual triage = **100 hours saved**.
> At $150 / hr loaded cost, that's **$15,000 in value** — shown right on the dashboard.

When a founder opens the dashboard before a renewal call, this number speaks for itself.

### Execution History

Full audit trail for every workflow run — proof that the system is working:

- Execution ID, trigger source, mode (manual / auto / live / smart)
- Per-node timing and document counts
- Individual document journey through the DAG
- Error logs and retry history
- **Exportable** for compliance or board reporting

---

## Use Case Examples

### 1. Vendor Contract Intake

```
📂 Email Inbox → ⚖️ Filter by Value > $50K → 🤖 AI Extract Terms
  → ✅ Legal Review → ⚡ Email Notification → 📤 Approved Contracts
                   ↘ (rejected)
                     ⚡ Rejection Email → 📤 Rejected Contracts
```

### 2. Regulatory Compliance Scan

```
📂 Upload → 🤖 AI Classify Document Type → ⚖️ Jurisdiction Filter
  → 🤖 AI Compliance Analysis → ✅ Compliance Officer Review → 📤 Output
```

### 3. Multi-Source Contract Aggregation

```
📂 Email Inbox ──┐
📂 Google Drive ─┤
📂 Webhook ──────┤──→ 🔀 AND Gate → ⚖️ Dedup & Filter → 📤 Unified Repository
📂 S3 Bucket ────┘
```

### 4. Auto-Generate Editor Documents

```
📂 Upload → 🤖 AI Extract All Fields → 📝 Document Creator
  → Drafter Editor document pre-filled with extracted metadata
```

---

## Technical Highlights

| Feature | Detail |
|---------|--------|
| **DAG Execution** | Kahn's topological sort; each level executed in order; document IDs flow downstream |
| **Background Processing** | Celery + Redis task queue with automatic synchronous fallback when Redis is unavailable |
| **Smart Dedup** | SHA-256 content hash per document × config hash; unchanged docs are skipped |
| **Live Events** | SSE stream + DB-backed polling hybrid (works across Celery workers and web processes) |
| **Compilation** | DAG validation, cycle detection, event subscription creation, audit logging |
| **Concurrency Lock** | DB-level `execution_state` field prevents overlapping runs |
| **Reconnection** | SSE supports `last_event_id` for lossless reconnection after network drops |
| **Sync Fallback** | If Celery/Redis is down, `POST /execute/` runs the workflow synchronously in the web process |

### Celery Beat Schedule (Background Tasks)

| Task | Interval | Purpose |
|------|----------|---------|
| `dispatch_email_checks` | 30 s | Poll email inbox input nodes via IMAP |
| `dispatch_live_workflows` | 60 s | Trigger time-based live workflows |
| `dispatch_event_subscriptions` | 30 s | Poll cloud drive / FTP / external subscriptions |

---

## API Quick Reference

### Workflow Lifecycle

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/clm/workflows/` | POST | Create a workflow |
| `/api/clm/workflows/{id}/` | GET | Get workflow with nodes & connections |
| `/api/clm/workflows/{id}/compile/` | POST | Validate DAG + create event subscriptions |
| `/api/clm/workflows/{id}/go-live/` | POST | Compile + activate live mode |
| `/api/clm/workflows/{id}/pause/` | POST | Pause live mode + deactivate subscriptions |
| `/api/clm/workflows/{id}/execute/` | POST | Manual execution (sync or async) |

### Documents & Monitoring

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/clm/workflows/{id}/upload/` | POST | Upload documents into the workflow |
| `/api/clm/workflows/{id}/documents/` | GET | List all workflow documents |
| `/api/clm/workflows/{id}/live-stream/` | GET | SSE real-time event stream |
| `/api/clm/workflows/{id}/live-dashboard/` | GET | Status snapshot for polling |
| `/api/clm/workflows/{id}/execution-history/` | GET | Past execution records |
| `/api/clm/workflows/{id}/workflow-status/` | GET | Comprehensive workflow state |

### Contracts (Legacy Pipeline)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/clm/contracts/` | GET / POST | List or upload contracts |
| `/api/clm/contracts/{id}/process/` | POST | Run full extract → analyze → route pipeline |
| `/api/clm/contracts/{id}/approve/` | POST | Approve a pending contract |
| `/api/clm/contracts/{id}/reject/` | POST | Reject a pending contract |
| `/api/clm/dashboard/stats/` | GET | Traffic light stats + ROI metrics |

---

## Frontend Components

| Component | Purpose |
|-----------|---------|
| **WorkflowCanvas** | Infinite pan/zoom canvas with node dragging and SVG edge connections |
| **WorkflowNode** | Individual node card — type icon, label, config summary, count badge, I/O ports |
| **NodeConfigPanel** | Slide-out panel for configuring each node type |
| **ProcessingProgressPanel** | Real-time execution monitor with per-node progress bars |
| **NodeDataPreview** | Modal table showing documents at a specific node + CSV / PDF download |
| **PipelineManager** | Pipeline list with create, duplicate, delete, and open actions |

### User Flow

1. Navigate to **CLM → Workflows**
2. Click **+ New Workflow** → enter name → canvas opens
3. Drag nodes from the toolbar onto the canvas
4. Connect output ports → input ports by dragging
5. Click a node to configure it in the side panel
6. Click **▶ Execute** for a one-off run, or **Go Live** for event-driven automation
7. Watch real-time progress in the **Processing Panel**
8. Click a node's count badge to preview documents and download CSV / PDF

---

## Related Documentation

| Document | Focus |
|----------|-------|
| [`CLM_API_REFERENCE.md`](./CLM_API_REFERENCE.md) | Full REST API reference for contracts, schemas, rules, audit logs |
| [`CLM_ARCHITECTURE.md`](./CLM_ARCHITECTURE.md) | Internal architecture: data model, execution engine, SSE event bus, Celery tasks |
| [`CLM_LIVE_ARCHITECTURE.md`](./CLM_LIVE_ARCHITECTURE.md) | Deep dive into live mode: compile → go-live → event dispatch → SSE streaming |
| [`WORKFLOW_NODE_API.md`](./WORKFLOW_NODE_API.md) | Pipeline node graph API: CRUD, execution, data preview, CSV/PDF export |
| [`PRODUCT_DESCRIPTION.md`](./PRODUCT_DESCRIPTION.md) | Full platform product description (all 14 modules) |

---

*Drafter CLM — Automate contracts. Eliminate bottlenecks. Scale with confidence.*
