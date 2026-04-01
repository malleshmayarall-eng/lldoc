"""
Workflow Optimizer — AI-powered workflow improvement engine
===========================================================
Analyses the current workflow DAG and proposes concrete improvements:

  1. **Merge redundant AI nodes** — multiple AI nodes with overlapping
     json_extract fields get consolidated into one.
  2. **Upgrade system prompts** — rewrites vague/weak prompts into
     production-grade, type-aware, bias-free versions.
  3. **Optimize flow order** — reorders nodes for better efficiency
     (e.g., cheap rule filters before expensive AI calls).
  4. **Add missing connections** — detects orphaned nodes.
  5. **Suggest missing nodes** — e.g., "you have rules but no output node".

The optimizer works in two modes:
  • preview (GET)  — returns proposed changes without applying them
  • apply   (POST) — applies all proposed changes via the same action
                      system used by workflow_chat.py

The heavy lifting is done by an LLM call that receives the full workflow
snapshot + an optimization-focused system prompt.
"""
import json
import logging
import re

from .models import Workflow, WorkflowNode
from .workflow_chat import _snapshot_workflow, _apply_actions

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Optimization system prompt — the brain of the optimizer
# ---------------------------------------------------------------------------

OPTIMIZER_SYSTEM_PROMPT = """You are an expert workflow optimization AI for a Contract Lifecycle Management (CLM) system.

You will receive a complete workflow snapshot (nodes, connections, derived fields, extraction template). Your job is to analyse it deeply and propose concrete improvements.

## CURRENT WORKFLOW STATE
{workflow_state}

## OPTIMIZATION OBJECTIVES

Analyse the workflow and propose improvements across these dimensions:

### 1. MERGE REDUNDANT AI NODES
If multiple AI nodes extract overlapping fields (json_extract mode) or do similar analysis, merge them into one node with a combined field list and a single powerful system prompt. Fewer LLM calls = faster + cheaper execution.

Example: If Node A extracts [party_1_name, party_2_name] and Node B extracts [effective_date, expiration_date], merge into one node extracting all 4 fields with one prompt.

Exception: Do NOT merge AI nodes that serve fundamentally different purposes (e.g., one does json_extract and another does yes_no classification).

### 2. UPGRADE SYSTEM PROMPTS
Rewrite every AI node's system prompt to be production-grade:
- **Type-aware**: Specify exact output format per field type (dates as YYYY-MM-DD, numbers without formatting, booleans as true/false, lists as JSON arrays)
- **Bias-free**: For yes_no nodes, use balanced framing — no leading language
- **Precise**: Tell the model exactly what to extract and from where
- **Context-efficient**: Don't waste tokens on unnecessary instructions
- **Null-safe**: Explicitly instruct null for missing values

A BAD prompt: "Extract the contract details from this document"
A GOOD prompt: "You are a contract metadata extractor. Extract the following fields from the document text. Return ONLY valid JSON. Use null for fields not found in the document. Dates must be YYYY-MM-DD. Numbers must be bare values without currency symbols or commas."

### 3. OPTIMIZE FLOW ORDER
- Rule nodes that do cheap metadata filtering should come BEFORE expensive AI nodes
- If a rule node filters out 80% of documents, move it upstream so AI only processes the 20% that pass
- Ensure no unnecessary sequential dependencies when parallel paths would work

### 4. ADD MISSING CONNECTIONS
- Detect orphaned nodes (no incoming or outgoing connections when they should have them)
- Suggest connections that complete the logical flow

### 5. SUGGEST MISSING NODES
- Workflow has rules but no output node? Suggest one
- Workflow has AI extraction but no rule to filter results? Suggest one
- No input node? Flag it

### 6. IMPROVE RULE CONDITIONS
- Upgrade operators: if a rule uses 'eq' for a substring match, suggest 'contains'
- Add new operators where appropriate: exists, not_exists, regex, starts_with, ends_with, in, not_in
- Fix type mismatches: if comparing a date field with 'gt', ensure value is a date string

## OUTPUT FORMAT

Return your response in two parts:

PART 1: A conversational summary of what you found and what you're proposing. Be specific — name the nodes, explain why each change helps.

PART 2: A ```actions``` code fence containing a JSON array of actions to apply.

### Available action types:

1. **update_node** — Update a node's config, label, or system prompt
   {{"action": "update_node", "node_id": "<uuid>", "label": "<new_label>", "config": {{...full updated config...}}}}

2. **add_node** — Add a new node
   {{"action": "add_node", "node_type": "<type>", "label": "<label>", "position_x": <num>, "position_y": <num>, "config": {{...}}}}

3. **delete_node** — Remove a redundant node
   {{"action": "delete_node", "node_id": "<uuid>"}}

4. **add_connection** — Connect two nodes
   {{"action": "add_connection", "from_node_id": "<uuid>", "to_node_id": "<uuid>"}}

5. **delete_connection** — Remove a connection
   {{"action": "delete_connection", "connection_id": "<uuid>"}}

## RULES
- ALWAYS include the full updated config when using update_node (don't partial patch)
- For merged AI nodes, create ONE new update_node with the combined fields, then delete_node the redundant ones and rewire connections
- System prompts must be complete, ready-to-use strings — not templates or placeholders
- Position new nodes sensibly: flow goes left→right, ~250px spacing
- Be thorough but conservative — don't break working workflows. Only propose changes that clearly improve quality.
- If the workflow is already well-optimized, say so and propose minimal or no changes.
"""


# ---------------------------------------------------------------------------
# Static analysis — detect issues without an LLM call
# ---------------------------------------------------------------------------

def _static_analysis(workflow: Workflow) -> list[dict]:
    """
    Fast pre-LLM analysis: detect obvious structural issues.
    Returns a list of {issue, severity, suggestion} dicts.
    """
    issues = []
    nodes = list(workflow.nodes.all())
    connections = list(workflow.connections.all())

    node_ids = {n.id for n in nodes}
    types = {n.node_type for n in nodes}

    # Build adjacency info
    has_incoming = set()
    has_outgoing = set()
    for c in connections:
        has_incoming.add(c.target_node_id)
        has_outgoing.add(c.source_node_id)

    # Check for missing node types
    if 'input' not in types:
        issues.append({
            'issue': 'No input node found',
            'severity': 'critical',
            'suggestion': 'Add an input node — it is required for document ingestion.',
        })

    if 'output' not in types:
        issues.append({
            'issue': 'No output node found',
            'severity': 'warning',
            'suggestion': 'Add an output node to collect filtered results.',
        })

    # Orphaned nodes (not input, have no incoming connections)
    for n in nodes:
        if n.node_type == 'input':
            continue
        if n.id not in has_incoming:
            issues.append({
                'issue': f'Orphaned node: "{n.label or n.node_type}" has no incoming connections',
                'severity': 'warning',
                'suggestion': f'Connect an upstream node to "{n.label or n.node_type}".',
            })

    # Dead-end nodes (not output, have no outgoing connections)
    for n in nodes:
        if n.node_type == 'output':
            continue
        if n.id not in has_outgoing:
            issues.append({
                'issue': f'Dead-end node: "{n.label or n.node_type}" has no outgoing connections',
                'severity': 'info',
                'suggestion': f'Connect "{n.label or n.node_type}" to a downstream node.',
            })

    # Duplicate AI extraction fields
    ai_nodes = [n for n in nodes if n.node_type == 'ai']
    json_extract_nodes = [
        n for n in ai_nodes
        if (n.config or {}).get('output_format') == 'json_extract'
    ]
    if len(json_extract_nodes) > 1:
        all_fields = {}
        for n in json_extract_nodes:
            for f in (n.config or {}).get('json_fields', []):
                fname = f.get('name', '')
                if fname:
                    all_fields.setdefault(fname, []).append(n.label or str(n.id)[:8])

        overlapping = {k: v for k, v in all_fields.items() if len(v) > 1}
        if overlapping:
            issues.append({
                'issue': f'Duplicate AI extraction: {len(overlapping)} field(s) extracted by multiple nodes',
                'severity': 'warning',
                'suggestion': f'Merge overlapping AI nodes. Fields: {list(overlapping.keys())}',
                'detail': overlapping,
            })

    # Weak system prompts
    for n in ai_nodes:
        prompt = (n.config or {}).get('system_prompt', '') or ''
        if len(prompt) < 30:
            issues.append({
                'issue': f'Weak system prompt on AI node "{n.label or n.node_type}" ({len(prompt)} chars)',
                'severity': 'warning',
                'suggestion': 'Rewrite with type-aware instructions, output format, and null handling.',
            })

    # Rule nodes with old operators
    for n in nodes:
        if n.node_type != 'rule':
            continue
        for c in (n.config or {}).get('conditions', []):
            op = c.get('operator', '')
            field = c.get('field', '')
            if op in ('eq', 'neq') and any(kw in field.lower() for kw in ('date', 'amount', 'value', 'cost')):
                issues.append({
                    'issue': f'Rule condition uses "{op}" on numeric/date field "{field}"',
                    'severity': 'info',
                    'suggestion': f'Consider using gt/gte/lt/lte for range comparisons on "{field}".',
                })

    # AI nodes before rule nodes (inefficient order)
    # Check if any AI node feeds into a rule that filters heavily
    for c in connections:
        src = next((n for n in nodes if n.id == c.source_node_id), None)
        tgt = next((n for n in nodes if n.id == c.target_node_id), None)
        if src and tgt and src.node_type == 'ai' and tgt.node_type == 'rule':
            # Check if the rule could be moved before the AI
            rule_fields = {
                cond.get('field', '')
                for cond in (tgt.config or {}).get('conditions', [])
            }
            ai_fields = {
                f.get('name', '')
                for f in (src.config or {}).get('json_fields', [])
            }
            # If rule doesn't depend on AI's output fields, it could go first
            if not rule_fields.intersection(ai_fields):
                issues.append({
                    'issue': f'Rule "{tgt.label}" after AI "{src.label}" but doesn\'t use AI outputs',
                    'severity': 'info',
                    'suggestion': 'Move the rule before the AI node — filter first, then enrich survivors.',
                })

    return issues


# ---------------------------------------------------------------------------
# LLM-powered optimization
# ---------------------------------------------------------------------------

def _call_optimizer_llm(workflow: Workflow) -> dict:
    """Call the LLM with the optimizer system prompt."""
    from .ai_node_executor import _call_model

    snapshot = _snapshot_workflow(workflow)
    system = OPTIMIZER_SYSTEM_PROMPT.format(
        workflow_state=json.dumps(snapshot, indent=2, default=str),
    )

    user_prompt = (
        "Analyse this workflow thoroughly and propose all improvements. "
        "Be specific — name nodes, explain why each change helps, and "
        "include the actions block with concrete changes. "
        "Focus on: merging redundant AI nodes, upgrading system prompts, "
        "optimizing flow order, and fixing structural issues."
    )

    result = _call_model(
        model_id='gemini-2.5-flash',
        system_prompt=system,
        document_context=user_prompt,
        temperature=0.3,
        max_tokens=8192,
    )

    return result


def _parse_optimizer_response(raw_text: str) -> tuple[str, list[dict]]:
    """
    Parse the optimizer LLM response into (summary, actions).
    Same format as workflow_chat._parse_response.
    """
    actions_match = re.search(
        r'```actions\s*\n?(.*?)\n?\s*```',
        raw_text,
        re.DOTALL,
    )

    actions = []
    reply_text = raw_text

    if actions_match:
        actions_json = actions_match.group(1).strip()
        try:
            parsed = json.loads(actions_json)
            if isinstance(parsed, list):
                actions = parsed
            elif isinstance(parsed, dict):
                actions = [parsed]
        except json.JSONDecodeError:
            logger.warning("Optimizer LLM returned invalid JSON in actions block")

        # Remove the actions block from the reply text
        reply_text = raw_text[:actions_match.start()] + raw_text[actions_match.end():]
        reply_text = reply_text.strip()

    return reply_text, actions


# ---------------------------------------------------------------------------
# Main optimizer function
# ---------------------------------------------------------------------------

def optimize_workflow(
    workflow: Workflow,
    apply: bool = False,
    user=None,
) -> dict:
    """
    Analyse and optionally optimize a workflow.

    Args:
        workflow: The Workflow instance to optimize.
        apply: If True, apply proposed changes immediately.
        user: The Django User requesting optimization.

    Returns:
        {
            "static_issues": [...],       # Fast structural analysis
            "summary": "...",             # LLM explanation of proposed changes
            "proposed_actions": [...],    # Concrete actions to apply
            "actions_applied": bool,
            "action_results": [...],      # Results if applied
        }
    """
    # 1. Static analysis (instant, no LLM)
    static_issues = _static_analysis(workflow)

    # 2. LLM-powered deep analysis
    llm_result = _call_optimizer_llm(workflow)

    if 'error' in llm_result:
        return {
            'static_issues': static_issues,
            'summary': f"Optimization analysis found {len(static_issues)} structural issue(s), "
                       f"but the AI analysis failed: {llm_result['error']}",
            'proposed_actions': [],
            'actions_applied': False,
            'action_results': [],
            'error': llm_result['error'],
        }

    raw_response = llm_result.get('response', '')
    summary, proposed_actions = _parse_optimizer_response(raw_response)

    # 3. Optionally apply
    action_results = []
    applied = False
    if proposed_actions and apply:
        action_results = _apply_actions(workflow, proposed_actions, user=user)
        applied = True

    return {
        'static_issues': static_issues,
        'summary': summary,
        'proposed_actions': proposed_actions,
        'actions_applied': applied,
        'action_results': action_results,
        'model': 'gemini-2.5-flash',
    }
