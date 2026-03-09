# CLM (Contract Lifecycle Management) — API Reference

## Overview

Commercial-grade CLM system with AI-powered metadata extraction (NuExtract v2.0),
a weighted rule engine with boolean logic, and a strict state-machine workflow.

**Base URL:** `/api/clm/`

---

## Architecture

```
Upload → EXTRACTING → ANALYZING → Auto-Rejected / Pending Approval / Approved
                                          │                  │
                                          │                  ├→ Approved
                                          │                  └→ Manually Rejected
                                          └→ Re-process
```

### State Machine

| State | Description | Valid Transitions |
|-------|-------------|-------------------|
| `uploaded` | Initial state after upload | `extracting` |
| `extracting` | NuExtract is running | `analyzing`, `auto_rejected` |
| `analyzing` | Rule engine is evaluating | `auto_rejected`, `pending_approval`, `approved` |
| `auto_rejected` | Failed a rule check | `extracting` (re-process) |
| `pending_approval` | Awaiting human review | `approved`, `manually_rejected` |
| `approved` | Cleared for use | (terminal) |
| `manually_rejected` | Human reviewer rejected | `extracting` (re-process) |

---

## API Endpoints

### Extraction Schemas

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/schemas/` | List all schemas |
| `POST` | `/schemas/` | Create a schema |
| `GET` | `/schemas/{id}/` | Get schema detail |
| `PUT` | `/schemas/{id}/` | Update a schema |
| `DELETE` | `/schemas/{id}/` | Delete a schema |
| `POST` | `/schemas/{id}/duplicate/` | Duplicate with incremented version |

**Create Schema Request:**
```json
{
  "name": "Standard Contract Schema",
  "description": "For vendor agreements",
  "template": {
    "contract_value": "",
    "expiration_date": "",
    "jurisdiction": "",
    "vendor_name": "",
    "indemnity_clause": ""
  },
  "field_types": {
    "contract_value": "decimal",
    "expiration_date": "date",
    "jurisdiction": "string",
    "vendor_name": "string",
    "indemnity_clause": "string"
  }
}
```

### Folders

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/folders/` | List all folders |
| `POST` | `/folders/` | Create a folder |
| `GET` | `/folders/{id}/` | Get folder detail |
| `PUT` | `/folders/{id}/` | Update a folder |
| `DELETE` | `/folders/{id}/` | Delete a folder |
| `GET` | `/folders/tree/` | Get nested folder tree |

### Contracts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/contracts/` | List contracts (filterable) |
| `POST` | `/contracts/` | Upload a contract |
| `GET` | `/contracts/{id}/` | Get contract detail |
| `DELETE` | `/contracts/{id}/` | Delete a contract |
| `POST` | `/contracts/{id}/process/` | **Run full pipeline** (Extract → Analyze → Route) |
| `POST` | `/contracts/{id}/extract-only/` | Run NuExtract only |
| `POST` | `/contracts/{id}/evaluate-rules/` | Run rule engine only |
| `PATCH` | `/contracts/{id}/update-metadata/` | Edit extracted metadata |
| `POST` | `/contracts/{id}/approve/` | Approve a pending contract |
| `POST` | `/contracts/{id}/reject/` | Reject a pending contract |

**Query Parameters for GET `/contracts/`:**
- `state` — Filter by state (e.g., `?state=pending_approval`)
- `folder` — Filter by folder UUID
- `traffic_light` — `red`, `green`, or `yellow`
- `sla_breached` — `true` for breached contracts
- `needs_review` — `true` for low-confidence extractions

**Upload Contract (multipart/form-data):**
```
POST /api/clm/contracts/
Content-Type: multipart/form-data

title: "Vendor Agreement Q3"
file: <binary PDF>
file_type: "pdf"
folder: "<folder-uuid>"
```

**Process Pipeline Response:**
```json
{
  "pipeline_result": {
    "steps": ["transition_to_extracting", "extraction_complete", "transition_to_analyzing", "rule_evaluation_complete"],
    "extraction": {
      "overall_confidence": 0.92,
      "needs_human_verification": false,
      "field_count": 5
    },
    "rules": {
      "risk_score": 30,
      "matched_rules": 2,
      "final_action": "pending_approval",
      "auto_rejected": false,
      "auto_approved": false
    },
    "final_state": "pending_approval",
    "errors": []
  },
  "contract": { /* full contract object */ }
}
```

### Workflow Rules

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/rules/` | List all rules |
| `POST` | `/rules/` | Create a rule with groups & conditions |
| `GET` | `/rules/{id}/` | Get rule detail |
| `PUT` | `/rules/{id}/` | Update a rule |
| `DELETE` | `/rules/{id}/` | Delete a rule |
| `POST` | `/rules/{id}/test/` | Test rule against sample metadata |
| `POST` | `/rules/{id}/duplicate/` | Duplicate a rule |

**Create Rule with Nested Groups:**
```json
{
  "name": "High Value EMEA Auto-Review",
  "description": "Route high-value EMEA contracts for review",
  "priority": 10,
  "action": "add_risk_points",
  "risk_points": 30,
  "risk_reason": "High value EMEA contract",
  "risk_threshold": 60,
  "groups": [
    {
      "boolean_operator": "AND",
      "order": 0,
      "conditions": [
        { "field": "contract_value", "operator": "gt", "value": "50000", "order": 0 },
        { "field": "jurisdiction", "operator": "eq", "value": "EMEA", "order": 1 }
      ]
    }
  ]
}
```

**Available Operators:**
| Operator | Description |
|----------|-------------|
| `eq` | Equals |
| `neq` | Not Equals |
| `gt` | Greater Than |
| `gte` | Greater or Equal |
| `lt` | Less Than |
| `lte` | Less or Equal |
| `contains` | Contains (case-insensitive) |
| `not_contains` | Does Not Contain |
| `is_empty` | Is Empty / Missing |
| `is_not_empty` | Is Not Empty |
| `regex` | Matches Regex |

**Available Actions:**
| Action | Description |
|--------|-------------|
| `auto_reject` | Immediately reject the contract |
| `auto_approve` | Immediately approve |
| `add_risk_points` | Add weighted risk points |
| `route_to_user` | Route to a specific user |
| `flag_for_review` | Flag without risk points |

### Audit Logs (Read-Only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/audit-logs/` | List logs (filter by `?contract=<uuid>&action=<type>`) |
| `GET` | `/audit-logs/{id}/` | Get log detail |

### Approval Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/approval-tasks/` | List assigned tasks |
| `POST` | `/approval-tasks/{id}/decide/` | Make decision |

### SLA Alerts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/sla-alerts/` | List alerts for current user |
| `POST` | `/sla-alerts/{id}/acknowledge/` | Acknowledge alert |

### Dashboard

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/dashboard/stats/` | Traffic light stats + ROI |
| `GET` | `/dashboard/timeline/` | 30-day processing timeline |
| `GET` | `/dashboard/risk-distribution/` | Risk score distribution |

**Dashboard Stats Response:**
```json
{
  "total_contracts": 150,
  "auto_approved": 42,
  "auto_rejected": 28,
  "pending_approval": 15,
  "manually_rejected": 5,
  "approved": 42,
  "extracting": 3,
  "analyzing": 2,
  "sla_breached": 4,
  "avg_risk_score": 23.5,
  "hours_saved": 17.5,
  "red_count": 33,
  "green_count": 42,
  "yellow_count": 15
}
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NUEXTRACT_MODEL` | `numind/NuExtract-v1.5` | HuggingFace model name |
| `HF_API_TOKEN` | (empty) | HuggingFace API token |
| `NUEXTRACT_CONFIDENCE_THRESHOLD` | `0.85` | Below this = human verification |
| `NUEXTRACT_USE_LOCAL` | `false` | Use local model vs API |
| `NUEXTRACT_MAX_INPUT_LENGTH` | `6000` | Max chars per chunk |

---

## Management Commands

```bash
# Check SLA breaches (run via cron every 15 min)
python manage.py check_sla_breaches
```
