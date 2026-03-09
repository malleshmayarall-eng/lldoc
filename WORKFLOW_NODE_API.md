# Workflow Pipeline (n8n-Style Node Graph) API Reference

## Overview

The CLM Workflow Pipeline system provides an n8n-style visual node graph where users
build filter→action→export pipelines by connecting nodes on a canvas. Each node
represents a stage:

| Node Type | Icon | Purpose |
|-----------|------|---------|
| **Source** | 📂 | Starting point — selects contracts from a folder / state filter |
| **Filter** | 🔍 | Metadata filter with field/operator/value conditions |
| **Rule** | ⚖️ | References an existing WorkflowRule for complex matching |
| **Action** | ⚡ | Side-effect: auto-approve, auto-reject, flag, route |
| **Output** | 📤 | Data export — CSV download, bulk PDF ZIP download, preview |

Nodes are connected with directed edges. The system executes the DAG via
Kahn's topological sort, passing contract IDs downstream from source→filters→actions→outputs.

---

## Models

### WorkflowPipeline
The canvas / graph container.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `organization` | FK → Organization | Org-scoped |
| `name` | string | Pipeline name |
| `description` | text | Optional description |
| `is_active` | boolean | Whether pipeline is active |
| `canvas_state` | JSON | `{zoom, panX, panY}` for restoring viewport |
| `created_by` | FK → User | Creator |
| `last_executed_at` | datetime | Last execution timestamp |

### PipelineNode
A single node in the graph.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `pipeline` | FK → WorkflowPipeline | Parent pipeline |
| `node_type` | enum | `source`, `filter`, `rule`, `action`, `output` |
| `label` | string | Custom label |
| `position_x` | float | X position on canvas |
| `position_y` | float | Y position on canvas |
| `config` | JSON | Node-specific configuration (see below) |
| `last_result` | JSON | `{count, contract_ids}` from last execution |

#### Config Schemas by Node Type

**Source:**
```json
{"folder_id": "<uuid>|null", "states": ["uploaded", "approved", ...]}
```

**Filter:**
```json
{
  "boolean_operator": "AND|OR",
  "conditions": [
    {"field": "contract_value", "operator": "gt", "value": "50000"},
    {"field": "jurisdiction", "operator": "contains", "value": "EMEA"}
  ]
}
```

**Rule:**
```json
{"rule_id": "<uuid>"}
```

**Action:**
```json
{"action_type": "auto_approve|auto_reject|flag_for_review|route_to_user"}
```

**Output:**
```json
{"output_type": "csv|pdf_bulk|preview"}
```

### NodeConnection
A directed edge between two nodes.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `pipeline` | FK | Parent pipeline |
| `source_node` | FK → PipelineNode | Output from this node |
| `target_node` | FK → PipelineNode | Input to this node |
| `label` | string | Optional edge label |

---

## API Endpoints

### Pipelines CRUD

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/api/clm/pipelines/` | List all pipelines (org-scoped) |
| `POST` | `/api/clm/pipelines/` | Create a new pipeline |
| `GET` | `/api/clm/pipelines/<id>/` | Get pipeline with nodes & connections |
| `PUT` | `/api/clm/pipelines/<id>/` | Update pipeline (replaces nodes/connections) |
| `DELETE` | `/api/clm/pipelines/<id>/` | Delete pipeline |
| `POST` | `/api/clm/pipelines/<id>/execute/` | **Execute the pipeline DAG** |
| `POST` | `/api/clm/pipelines/<id>/duplicate/` | Duplicate pipeline |

### Pipeline Nodes (Granular CRUD)

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/api/clm/pipeline-nodes/?pipeline=<id>` | List nodes for a pipeline |
| `POST` | `/api/clm/pipeline-nodes/` | Create a node (body: `{pipeline, node_type, ...}`) |
| `PATCH` | `/api/clm/pipeline-nodes/<id>/` | Update node config/position |
| `DELETE` | `/api/clm/pipeline-nodes/<id>/` | Delete a node |
| `GET` | `/api/clm/pipeline-nodes/<id>/data/` | **Data preview** — paginated contracts at node |
| `GET` | `/api/clm/pipeline-nodes/<id>/csv/` | **Download CSV** of metadata at node |
| `GET` | `/api/clm/pipeline-nodes/<id>/bulk-pdf/` | **Download ZIP** of all PDFs at node |

### Node Connections

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/api/clm/node-connections/?pipeline=<id>` | List connections |
| `POST` | `/api/clm/node-connections/` | Create connection `{pipeline, source_node, target_node}` |
| `DELETE` | `/api/clm/node-connections/<id>/` | Delete connection |

---

## Execution Flow

```
POST /api/clm/pipelines/<id>/execute/

1. Build adjacency list from connections
2. Topological sort (Kahn's algorithm)
3. Execute each node in order:
   - source → query DB for contracts matching folder/states
   - filter → apply metadata conditions to incoming IDs
   - rule   → apply WorkflowRule conditions to incoming IDs
   - action → transition contract states (side-effect)
   - output → pass-through (data retrieved via /data/ or /csv/)
4. Cache {count, contract_ids} in each node's last_result
5. Return per-node results
```

### Execute Response
```json
{
  "pipeline_id": "uuid",
  "pipeline_name": "My Pipeline",
  "executed_at": "2026-02-12T17:00:00Z",
  "node_results": [
    {
      "node_id": "uuid",
      "node_type": "source",
      "label": "All Contracts",
      "count": 150,
      "contract_ids": ["uuid1", "uuid2", ...]
    },
    {
      "node_id": "uuid",
      "node_type": "filter",
      "label": "High Value",
      "count": 42,
      "contract_ids": ["uuid1", ...]
    }
  ]
}
```

### Data Preview Response
```
GET /api/clm/pipeline-nodes/<id>/data/?page=1&page_size=25
```
```json
{
  "node_id": "uuid",
  "total": 42,
  "page": 1,
  "page_size": 25,
  "contracts": [
    {
      "id": "uuid",
      "title": "Contract A",
      "state": "approved",
      "traffic_light": "green",
      "risk_score": 15,
      "vendor_name": "Acme Corp",
      "jurisdiction": "US",
      "contract_value": "75000.00",
      ...
    }
  ]
}
```

### CSV Download
```
GET /api/clm/pipeline-nodes/<id>/csv/
→ Content-Type: text/csv
→ Content-Disposition: attachment; filename="pipeline_node_abcd1234.csv"
```

Columns: `id, title, state, risk_score, vendor_name, jurisdiction, contract_value, expiration_date, overall_confidence, sla_breached, created_at, meta_<key1>, meta_<key2>, ...`

### Bulk PDF Download
```
GET /api/clm/pipeline-nodes/<id>/bulk-pdf/
→ Content-Type: application/zip
→ Content-Disposition: attachment; filename="contracts_abcd1234.zip"
```

---

## Frontend Components

| Component | File | Purpose |
|-----------|------|---------|
| **PipelineManager** | `PipelineManager.jsx` | Pipeline list, create, delete, duplicate, open editor |
| **NodeCanvas** | `NodeCanvas.jsx` | n8n-style infinite canvas with pan/zoom, node dragging, SVG connections |
| **WorkflowNode** | `WorkflowNode.jsx` | Individual node card — type icon, label, config summary, count badge, ports |
| **ConnectionLine** | `ConnectionLine.jsx` | SVG cubic bezier with animated flow dots |
| **NodeConfigPanel** | `NodeConfigPanel.jsx` | Right slide-out panel for configuring node (adapts by type) |
| **NodeDataPreview** | `NodeDataPreview.jsx` | Modal table of contracts at a node + CSV/PDF download buttons |

### User Flow

1. Navigate to **Pipelines** tab
2. Click **+ New Pipeline** → enter name → opens canvas
3. Use toolbar to add nodes: Source → Filter → Output
4. **Drag** nodes to position them on the canvas
5. **Connect** nodes by clicking output port (right) and dragging to input port (left)
6. **Click** a node to open config panel — set conditions/filters
7. Click **▶ Execute** — pipeline runs, count badges appear on each node
8. **Click** a count badge to open data preview modal
9. Use **📊 Download CSV** or **📁 Bulk PDF** buttons from the modal
10. Click **💾 Save** to persist canvas state

### Filter Node Configuration

The filter node supports 11 operators on any metadata field:

| Operator | Description |
|----------|-------------|
| `eq` | Equals |
| `neq` | Not Equals |
| `gt` | Greater Than |
| `gte` | Greater or Equal |
| `lt` | Less Than |
| `lte` | Less or Equal |
| `contains` | String contains |
| `not_contains` | String does not contain |
| `is_empty` | Field is null/empty |
| `is_not_empty` | Field has a value |
| `regex` | Matches regex pattern |

Conditions within a filter are combined with AND or OR (configurable).

---

## Running the Frontend

```bash
cd clm/frontend
npm install
npm run dev
# → http://localhost:5173
```

The Vite dev server proxies `/api/*` to `http://localhost:8000` (Django backend).

CORS is pre-configured for `localhost:5173` in Django settings.
