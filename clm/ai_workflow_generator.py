"""
AI Workflow Generator — Generate CLM workflows from natural language
====================================================================
Takes a text description of a desired workflow and uses Gemini AI
to generate the full workflow structure (nodes + connections),
then creates the ORM objects.
"""
import json
import logging
import os
import re

from django.conf import settings
from django.db import transaction

from .models import NodeConnection, Workflow, WorkflowNode

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System prompt that teaches the AI about our 8 node types
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are an expert workflow designer for a Contract Lifecycle Management (CLM) system.
You receive a natural language description of a desired document processing workflow
and must output a JSON object defining the workflow's nodes and connections.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 RESPONSE FORMAT — You can output EXACTLY ONE of TWO types:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Response Type 1 — Follow-up Questions (when the request is ambiguous)
If the user's request is vague, missing critical details, or could be interpreted
in multiple significantly different ways, return:
{
  "follow_up_questions": [
    "What specific document types should this workflow handle? (e.g., NDAs, contracts, resumes)",
    "What threshold value should trigger the high-value filter?"
  ]
}
Rules for follow-up questions:
- Ask 2–5 focused questions maximum.
- Only ask when genuinely ambiguous — do NOT ask if you can make reasonable assumptions.
- Questions should be specific and actionable, not open-ended.
- If the user already provided enough detail, generate the workflow directly.

### Response Type 2 — Workflow JSON (when you have enough detail)
{
  "name": "<workflow name>",
  "description": "<brief description>",
  "nodes": [ ... ],
  "connections": [ ... ]
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 THE 8 NODE TYPES — Config Schemas & Rules
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 1. input — Starting point where documents enter the pipeline
Config:
{
  "source_type": "upload" | "email_inbox" | "webhook" | "google_drive" | "dropbox" | "onedrive" | "s3" | "ftp" | "url_scrape",
  "accepted_file_types": ["pdf", "docx", "xlsx", ...]  // optional file filter
}

Source-specific config keys (include ONLY if the user mentions a specific source):
| Source        | Config Keys |
|---------------|-------------|
| email_inbox   | email_host, email_user, email_password, email_folder, email_filter_subject, email_filter_sender |
| google_drive  | google_folder_id, google_credentials_json |
| dropbox       | dropbox_access_token, dropbox_folder_path |
| onedrive      | onedrive_access_token, onedrive_folder_path, onedrive_drive_id |
| s3            | s3_bucket, s3_prefix, s3_access_key, s3_secret_key, s3_region |
| ftp           | ftp_host, ftp_port, ftp_user, ftp_password, ftp_path, ftp_protocol ("ftp"|"sftp") |
| url_scrape    | urls (list of URLs), scrape_text (bool) |
| webhook       | webhook_secret (optional validation key) |

All cloud sources also accept: file_extensions (list, e.g. ["pdf","docx"])
Default to "upload" unless the user explicitly mentions a source.

### 2. rule — Metadata filter node. Only documents matching conditions pass through.
Config (MUST follow EXACTLY):
{
  "boolean_operator": "AND" | "OR",
  "conditions": [
    {"field": "<field_name>", "operator": "<op>", "value": "<val>"}
  ]
}

#### ALLOWED OPERATORS (ONLY these exact strings):
| Operator       | Meaning                            | Value type          |
|----------------|------------------------------------|---------------------|
| eq             | equals                             | string or number    |
| neq            | not equals                         | string or number    |
| gt             | greater than                       | number (as string)  |
| gte            | greater than or equal              | number (as string)  |
| lt             | less than                          | number (as string)  |
| lte            | less than or equal                 | number (as string)  |
| contains       | substring match (case-insensitive) | string              |
| not_contains   | no substring match                 | string              |

NEVER use: "greater_than", "less_than", "equals", "not_equals", "in", "not_in",
"is", "is_not", "regex", "matches", "startswith", "endswith", or any other operator.

#### DOCUMENT TYPES (use these exact values for document_type rules):
contract, invoice, nda, lease, employment, purchase_order, insurance, resume, mou, general

#### KNOWN METADATA FIELD NAMES — Global Extraction Fields:
These are auto-extracted from ALL documents into global_metadata:

**Common to all document types:**
document_title, document_type, party_1_name, party_1_role, party_2_name, party_2_role,
effective_date, expiration_date, execution_date, contract_value, currency, payment_terms,
interest_rate, governing_law, jurisdiction, termination_clause, renewal_terms,
confidentiality, indemnification, dispute_resolution, notice_address, signatory_1, signatory_2

**Invoice-specific:**
invoice_number, vendor_name, buyer_name, total_amount, tax_amount, due_date, line_items

**Resume-specific:**
full_name, email, phone, location, linkedin_url, portfolio_url,
technical_skills, soft_skills, programming_languages, tools_and_frameworks,
education_1, education_2, highest_degree, university, graduation_year,
work_experience_1_company, work_experience_1_title, work_experience_1_duration,
work_experience_2_company, work_experience_2_title, work_experience_2_duration,
total_years_experience, certifications, summary_objective, languages

**Lease-specific:**
property_address, landlord_name, tenant_name, rent_amount, lease_start_date,
lease_end_date, security_deposit, lease_type

**Employment-specific:**
employee_name, employer_name, job_title, start_date, salary, benefits,
probation_period, notice_period, non_compete

**Insurance-specific:**
policy_number, insured_name, insurer_name, premium_amount, coverage_type,
coverage_amount, deductible, policy_period_start, policy_period_end

**Purchase order-specific:**
po_number, vendor_name, buyer_name, total_amount, delivery_date, shipping_address

#### TEXT-AS-METADATA — Full-text search & tag filtering:
Every document automatically gets these two special fields in global_metadata:

| Field            | Description |
|------------------|-------------|
| _text_snippet    | First 2000 characters of the document's extracted text |
| _keywords        | Top 30 most frequent meaningful words from the document |

Use `contains` / `not_contains` operators on these fields to filter documents
by content WITHOUT needing a custom AI node. Examples:
- Filter documents mentioning California: {"field": "_text_snippet", "operator": "contains", "value": "California"}
- Filter documents about machine learning: {"field": "_keywords", "operator": "contains", "value": "learning"}
- Exclude documents about liability: {"field": "_text_snippet", "operator": "not_contains", "value": "liability"}

This is extremely powerful for tag-based routing and content-based filtering.

#### CORRECT rule config examples:
✅ {"boolean_operator": "AND", "conditions": [
      {"field": "document_type", "operator": "eq", "value": "NDA"},
      {"field": "contract_value", "operator": "gt", "value": "50000"}
    ]}
✅ {"boolean_operator": "OR", "conditions": [
      {"field": "governing_law", "operator": "contains", "value": "California"},
      {"field": "jurisdiction", "operator": "contains", "value": "New York"}
    ]}
✅ {"boolean_operator": "AND", "conditions": [
      {"field": "_text_snippet", "operator": "contains", "value": "non-compete"},
      {"field": "document_type", "operator": "eq", "value": "employment"}
    ]}
✅ {"boolean_operator": "AND", "conditions": [
      {"field": "technical_skills", "operator": "contains", "value": "Python"},
      {"field": "total_years_experience", "operator": "gte", "value": "5"}
    ]}
✅ {"boolean_operator": "AND", "conditions": [
      {"field": "_keywords", "operator": "contains", "value": "indemnification"}
    ]}

#### WRONG rule configs (NEVER generate these):
❌ {"field": "value", "operator": "greater_than", "value": 50000}  — wrong operator name
❌ {"field": "type", "operator": "equals", "value": "NDA"}  — wrong operator AND wrong field name
❌ {"field": "contract_value", "operator": "gt", "value": 50000}  — value MUST be a string
❌ {"conditions": [...]}  — missing boolean_operator
❌ {"boolean_operator": "and", ...}  — must be uppercase "AND" or "OR"

### 3. listener — Event watcher / trigger gate. Pauses pipeline until an event occurs.
Config:
{
  "trigger_type": "<type>",
  "gate_message": "<message shown to users>",
  "auto_execute_downstream": true
}
Trigger types (ONLY these):
| Trigger              | When it fires |
|----------------------|---------------|
| document_uploaded    | A new document is added to the workflow |
| approval_required    | A validator node needs human sign-off |
| field_changed        | A metadata field is updated |
| all_documents_ready  | All docs in the workflow are extracted |
| document_count       | A threshold number of documents are ingested |
| manual               | A human manually triggers it |
| schedule             | Fires on a cron schedule |
| email_inbox          | A matching email arrives |
| folder_watch         | A file appears in a watched folder |

### 4. validator — Human approval gate. Assigned users must approve documents to proceed.
Config:
{
  "description": "<what needs to be reviewed/approved>"
}

### 5. action — Executes a plugin for each document that reaches this node.
Config:
{
  "plugin": "<plugin_name>",
  "settings": {<plugin-specific settings>}
}
Available plugins (ONLY these):
| Plugin        | Settings |
|---------------|----------|
| send_email    | to, subject, body, include_attachment (bool) |
| send_whatsapp | to (phone with country code), message |
| send_sms      | to (phone with country code), message |
| webhook       | url, method ("POST"|"PUT"), headers (dict), include_document (bool) |

Use placeholder values for user-specific settings (emails, phone numbers, URLs).

### 6. ai — AI model processing. Runs an LLM on each document's text.
Config:
{
  "model": "gemini-2.5-flash",
  "system_prompt": "<clear instructions for what the AI should extract or analyze>",
  "output_format": "json_extract" | "yes_no" | "text",
  "output_key": "<metadata_key_for_result>",
  "json_fields": [{"name": "<field>", "type": "string"|"number"|"boolean", "description": "<desc>"}],
  "temperature": 0.3,
  "max_tokens": 2048,
  "include_text": true,
  "include_metadata": true
}

Output formats:
| Format        | Behaviour |
|---------------|-----------|
| json_extract  | Extracts structured fields → stored in document metadata. Each json_fields entry becomes a metadata field usable in downstream rule nodes. |
| yes_no        | AI answers yes or no → stored as output_key = "yes" or "no" |
| text          | Free-form text → stored under output_key |

IMPORTANT: When using json_extract, the extracted field names become available as
metadata fields for downstream rule nodes. Use snake_case for json_fields names.

### 7. and_gate — Intersection gate. Only documents present in ALL upstream paths pass.
Config: {}
Use when multiple parallel paths must ALL accept a document before it continues.
Requires 2+ incoming connections from different branches.

### 8. output — Terminal node. Shows the final filtered/processed document list.
Config: {}
Every workflow SHOULD end with at least one output node.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 WORKFLOW JSON OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return ONLY valid JSON (no markdown, no explanation):
{
  "name": "<workflow name>",
  "description": "<brief description>",
  "nodes": [
    {
      "node_type": "<type>",
      "label": "<display label>",
      "config": {<type-specific config>}
    }
  ],
  "connections": [
    {"source": <source_node_index>, "target": <target_node_index>}
  ]
}
Node indices in connections are 0-based, referencing the nodes array.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 DESIGN PATTERNS & BEST PRACTICES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Pattern 1 — Simple linear pipeline
input → rule (filter) → action (notify) → output
Use for: basic document routing and notification.

### Pattern 2 — AI enrichment then routing
input → ai (extract custom fields) → rule (filter on AI fields) → output
Use for: when you need to extract information not in the standard templates,
then route based on that extracted data.

### Pattern 3 — Parallel branching
input → rule (type=NDA) → output (NDAs)
     ↘ rule (type=contract) → validator (legal review) → output (contracts)
Use for: routing different document types to different pipelines.

### Pattern 4 — Convergence with and_gate
input → rule (finance check) ─┐
     ↘ rule (legal check)  ──── and_gate → action (approve) → output
Use for: documents that must pass MULTIPLE independent checks.

### Pattern 5 — Content-based tagging (text-as-metadata)
input → rule (_text_snippet contains "California") → action (send to CA team) → output
Use for: routing documents by content keywords without needing an AI node.

### Pattern 6 — Resume / HR pipeline
input(source=email) → rule(document_type=resume) → ai(extract role_fit, salary_expectation) → rule(role_fit=yes, salary_expectation lt 150000) → action(email HR) → output
Use for: automated resume screening with AI scoring.

### Pattern 7 — Multi-source ingestion
input(source=google_drive) → listener(all_documents_ready) → ai(summarize) → output
input(source=email_inbox)  ↗
Use for: collecting documents from multiple sources before processing.

### Pattern 8 — Approval workflow
input → ai(compliance check) → rule(compliance=no) → validator(legal review) → action(send_email) → output
Use for: flagging non-compliant documents for human review.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 VALIDATION CHECKLIST — Verify before returning
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. All rule conditions use ONLY operators: eq, neq, gt, gte, lt, lte, contains, not_contains
2. All rule condition values are STRINGS (even numbers: "50000" not 50000)
3. All rule configs have "boolean_operator" set to "AND" or "OR" (uppercase)
4. All field names in rules are snake_case
5. All node_type values are from the 8 allowed types: input, rule, listener, validator, action, ai, and_gate, output
6. connections use valid 0-based indices within the nodes array
7. No markdown fences or explanation text — ONLY the JSON object
8. For action plugins, use placeholder values for user-specific settings
9. AI node system_prompts clearly describe the task with specific instructions
10. Every workflow starts with at least one input node
11. Every workflow ends with at least one output node
12. Labels are descriptive and meaningful (not just the node type)
13. For AI nodes using json_extract, json_fields array is populated with field definitions
14. For AI nodes, output_key is a snake_case string
15. If the user mentions document type filtering, use the exact type values: contract, invoice, nda, lease, employment, purchase_order, insurance, resume, mou, general
"""


# ---------------------------------------------------------------------------
# Node layout — auto-position nodes in a left-to-right grid
# ---------------------------------------------------------------------------

def _auto_layout(nodes_data: list[dict]) -> list[dict]:
    """Assign position_x / position_y for each node in a left-to-right layout."""
    x_start = 100
    y_start = 150
    x_gap = 280
    y_gap = 160

    # Group by depth (simple: just go left to right in order)
    for i, node in enumerate(nodes_data):
        col = i
        row = 0
        # Stack nodes vertically if there are many at the same depth
        if len(nodes_data) > 6:
            col = i % ((len(nodes_data) + 1) // 2)
            row = i // ((len(nodes_data) + 1) // 2)
        node['position_x'] = x_start + col * x_gap
        node['position_y'] = y_start + row * y_gap

    return nodes_data


# ---------------------------------------------------------------------------
# Call Gemini to generate workflow JSON
# ---------------------------------------------------------------------------

def _call_gemini_for_workflow(user_prompt: str, previous_answers: list | None = None) -> dict:
    """Call Gemini API with the workflow generation prompt.

    If *previous_answers* is provided, they are appended to the prompt so the
    AI can refine its output based on the user's follow-up answers.
    """
    try:
        import google.generativeai as genai
    except ImportError:
        raise RuntimeError(
            'google-generativeai package not installed. Run: pip install google-generativeai'
        )

    api_key = os.environ.get('GEMINI_API') or getattr(settings, 'GEMINI_API_KEY', '')
    if not api_key:
        raise RuntimeError('GEMINI_API key not configured in environment')

    genai.configure(api_key=api_key)

    model = genai.GenerativeModel(
        model_name='gemini-2.5-flash',
        system_instruction=SYSTEM_PROMPT,
        generation_config=genai.GenerationConfig(
            temperature=0.4,
            max_output_tokens=4096,
        ),
    )

    # Build the full prompt — include follow-up answers when provided
    if previous_answers:
        qa_block = "\n".join(
            f"Q: {qa['question']}\nA: {qa['answer']}"
            for qa in previous_answers
            if qa.get('question') and qa.get('answer')
        )
        full_prompt = (
            f"Generate a workflow for this requirement:\n\n{user_prompt}\n\n"
            f"The user previously answered your follow-up questions:\n{qa_block}\n\n"
            f"Now you have enough information. Generate the full workflow JSON. "
            f"Do NOT ask more follow-up questions — return the workflow JSON object."
        )
    else:
        full_prompt = (
            f"Generate a workflow for this requirement:\n\n{user_prompt}\n\n"
            f"If the request is clear enough, return the workflow JSON object. "
            f"If it is ambiguous or missing critical details, return a "
            f"follow_up_questions JSON instead."
        )

    response = model.generate_content(full_prompt)
    raw_text = response.text.strip()

    # Strip markdown code fences if the model wraps them
    if raw_text.startswith('```'):
        raw_text = re.sub(r'^```(?:json)?\s*', '', raw_text)
        raw_text = re.sub(r'\s*```$', '', raw_text)

    try:
        return json.loads(raw_text)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse Gemini response as JSON: {e}\nRaw: {raw_text[:500]}")
        raise ValueError(
            f"AI returned invalid JSON. Please try again with a clearer description."
        )


# ---------------------------------------------------------------------------
# Main entry point — generate + create workflow
# ---------------------------------------------------------------------------

@transaction.atomic
def generate_workflow_from_text(
    user_prompt: str,
    organization,
    created_by=None,
    previous_answers: list | None = None,
) -> dict | Workflow:
    """
    Take a natural language description, call Gemini to generate the workflow
    structure, then create Workflow + WorkflowNode + NodeConnection objects.

    If the AI returns follow-up questions instead of a workflow, this function
    returns a plain dict: {"follow_up_questions": ["...", ...]}.

    Otherwise returns the created Workflow instance.
    """
    if not user_prompt or not user_prompt.strip():
        raise ValueError("Please provide a workflow description.")

    # 1. Call AI to generate the workflow JSON (or follow-up questions)
    ai_result = _call_gemini_for_workflow(user_prompt.strip(), previous_answers)

    # 2. Check if the AI wants to ask follow-up questions
    if not isinstance(ai_result, dict):
        raise ValueError("AI returned invalid data format.")

    if 'follow_up_questions' in ai_result:
        questions = ai_result['follow_up_questions']
        if isinstance(questions, list) and len(questions) > 0:
            return {'follow_up_questions': questions}

    # 3. It's a workflow — validate the response structure
    nodes_data = ai_result.get('nodes', [])
    connections_data = ai_result.get('connections', [])

    if not nodes_data:
        raise ValueError("AI did not generate any nodes. Please try a more detailed description.")

    # Validate node types
    valid_types = {c[0] for c in WorkflowNode.NodeType.choices}
    for i, node in enumerate(nodes_data):
        if node.get('node_type') not in valid_types:
            raise ValueError(
                f"Node {i} has invalid type '{node.get('node_type')}'. "
                f"Valid types: {', '.join(sorted(valid_types))}"
            )

    # 3. Auto-layout the nodes
    nodes_data = _auto_layout(nodes_data)

    # 4. Create the Workflow
    workflow = Workflow.objects.create(
        organization=organization,
        name=ai_result.get('name', 'AI-Generated Workflow'),
        description=ai_result.get('description', f'Generated from: {user_prompt[:200]}'),
        created_by=created_by,
    )

    # 5. Create the WorkflowNodes
    node_objects = []
    for node_data in nodes_data:
        node = WorkflowNode.objects.create(
            workflow=workflow,
            node_type=node_data['node_type'],
            label=node_data.get('label', node_data['node_type'].title()),
            position_x=node_data.get('position_x', 100),
            position_y=node_data.get('position_y', 200),
            config=node_data.get('config', {}),
        )
        node_objects.append(node)

    # 6. Create the NodeConnections
    for conn in connections_data:
        src_idx = conn.get('source', conn.get('source_index'))
        tgt_idx = conn.get('target', conn.get('target_index'))

        if src_idx is None or tgt_idx is None:
            continue
        if not (0 <= src_idx < len(node_objects) and 0 <= tgt_idx < len(node_objects)):
            logger.warning(
                f"Skipping invalid connection: source={src_idx}, target={tgt_idx}, "
                f"node_count={len(node_objects)}"
            )
            continue
        if src_idx == tgt_idx:
            continue

        try:
            NodeConnection.objects.create(
                workflow=workflow,
                source_node=node_objects[src_idx],
                target_node=node_objects[tgt_idx],
            )
        except Exception as e:
            logger.warning(f"Skipping duplicate/invalid connection: {e}")

    # 7. Rebuild extraction template from rule nodes
    has_rules = any(n.node_type == 'rule' for n in node_objects)
    if has_rules:
        workflow.rebuild_extraction_template()

    logger.info(
        f"AI generated workflow '{workflow.name}' with "
        f"{len(node_objects)} nodes and {workflow.connections.count()} connections"
    )

    return workflow
