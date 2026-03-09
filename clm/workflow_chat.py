"""
Workflow Chat — AI assistant for workflow editing
===================================================
An AI chat service that lets users modify their workflow via natural language.

The user says things like:
  • "Add a rule node that filters contracts over $50k"
  • "Connect the AI node to the output"
  • "Set the document type to resume"
  • "Add a derived field for total experience"
  • "Create an AI node that scores risk as high/medium/low"
  • "Delete the scraper node"
  • "What does my workflow look like?"

The assistant:
  1. Reads the current workflow state (nodes, connections, config, derived fields)
  2. Builds a system prompt describing available actions
  3. Calls the LLM with the user message + conversation history
  4. Parses the structured JSON actions from the LLM response
  5. Applies the actions to the workflow (creates nodes, connections, etc.)
  6. Returns the reply text + list of actions taken

Actions are returned as a JSON array inside the response, delimited by
```actions ... ``` fences.  The reply text outside the fence is shown to the user.
"""
import json
import logging
import re
import uuid as _uuid

from django.utils import timezone

from .models import (
    DerivedField,
    NodeConnection,
    Workflow,
    WorkflowChatMessage,
    WorkflowNode,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Workflow state snapshot — what the AI sees
# ---------------------------------------------------------------------------

def _snapshot_workflow(workflow: Workflow) -> dict:
    """
    Build a concise JSON snapshot of the workflow's current state
    for inclusion in the AI prompt.
    """
    nodes = []
    for n in workflow.nodes.all().order_by('position_x'):
        node_info = {
            'id': str(n.id),
            'type': n.node_type,
            'label': n.label or n.get_node_type_display(),
            'position': {'x': n.position_x, 'y': n.position_y},
        }
        # Include config highlights (not the full blob)
        cfg = n.config or {}
        if n.node_type == 'input':
            node_info['document_type'] = cfg.get('document_type', '')
            node_info['source_type'] = cfg.get('source_type', 'upload')
        elif n.node_type == 'rule':
            node_info['boolean_operator'] = cfg.get('boolean_operator', 'AND')
            node_info['conditions'] = cfg.get('conditions', [])
        elif n.node_type == 'ai':
            node_info['model'] = cfg.get('model', '')
            node_info['output_format'] = cfg.get('output_format', 'text')
            node_info['output_key'] = cfg.get('output_key', '')
            node_info['system_prompt_preview'] = (cfg.get('system_prompt', '') or '')[:100]
            if cfg.get('output_format') == 'json_extract':
                node_info['json_fields'] = cfg.get('json_fields', [])
        elif n.node_type == 'action':
            node_info['plugin'] = cfg.get('plugin', '')
        elif n.node_type == 'listener':
            node_info['trigger_type'] = cfg.get('trigger_type', '')
        elif n.node_type == 'validator':
            node_info['name'] = cfg.get('name', '')
        elif n.node_type == 'scraper':
            node_info['urls'] = cfg.get('urls', [])[:3]  # first 3

        nodes.append(node_info)

    connections = [
        {
            'id': str(c.id),
            'from': str(c.source_node_id),
            'from_label': c.source_node.label or c.source_node.get_node_type_display(),
            'to': str(c.target_node_id),
            'to_label': c.target_node.label or c.target_node.get_node_type_display(),
        }
        for c in workflow.connections.select_related('source_node', 'target_node').all()
    ]

    derived_fields = [
        {
            'id': str(df.id),
            'name': df.name,
            'display_name': df.display_name,
            'field_type': df.field_type,
            'computation_hint': df.computation_hint[:100],
            'depends_on': df.depends_on,
        }
        for df in workflow.derived_fields.all()
    ]

    return {
        'workflow_id': str(workflow.id),
        'workflow_name': workflow.name,
        'description': workflow.description,
        'document_count': workflow.documents.count(),
        'extraction_template': workflow.extraction_template,
        'nodes': nodes,
        'connections': connections,
        'derived_fields': derived_fields,
    }


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are a workflow assistant for a document processing system (CLM — Contract Lifecycle Management).

You help users build and modify document processing workflows through natural language conversation.

## CURRENT WORKFLOW STATE
{workflow_state}

## AVAILABLE NODE TYPES
- input: Starting point — documents uploaded or fetched here. Config: document_type (contract/invoice/nda/lease/employment/purchase_order/insurance/resume/mou/general), source_type (upload/email_inbox/google_drive/dropbox/onedrive/s3/ftp/url_scrape/webhook)
- rule: Filters documents by metadata conditions. Config: boolean_operator (AND/OR), conditions: [{{field, operator, value}}]. Operators: eq, neq, gt, gte, lt, lte, contains, not_contains
- ai: AI model processing. Config: model (gemini-2.0-flash/gemini-1.5-pro/gpt-4o/gpt-4o-mini), output_format (json_extract/yes_no/text/derived), system_prompt, output_key, json_fields (for json_extract), temperature, max_tokens
- action: Runs plugins per document. Config: plugin (send_email/send_whatsapp/send_sms/webhook)
- listener: Watches for triggers. Config: trigger_type (document_uploaded/approval_required/field_changed/all_documents_ready/document_count/manual/schedule)
- validator: Human approval gate. Config: name, description
- scraper: Web scraping. Config: urls, keywords
- and_gate: Passes documents present in ALL upstream paths (intersection)
- output: Terminal node — shows filtered results

## AVAILABLE ACTIONS
You can propose actions to modify the workflow. Return them inside a ```actions``` code fence as a JSON array.

### Action types:

1. add_node — Add a new node
   {{"action": "add_node", "node_type": "<type>", "label": "<label>", "position_x": <num>, "position_y": <num>, "config": {{...}}}}

2. update_node — Update an existing node's config or label
   {{"action": "update_node", "node_id": "<uuid>", "label": "<new_label>", "config": {{...}}}}

3. delete_node — Remove a node (and its connections)
   {{"action": "delete_node", "node_id": "<uuid>"}}

4. add_connection — Connect two nodes
   {{"action": "add_connection", "from_node_id": "<uuid>", "to_node_id": "<uuid>"}}
   You can also use "from_label" and "to_label" instead of IDs to reference nodes by their label/type.

5. delete_connection — Remove a connection
   {{"action": "delete_connection", "connection_id": "<uuid>"}}

6. add_derived_field — Add a derived/computed metadata field
   {{"action": "add_derived_field", "name": "<snake_case>", "display_name": "<label>", "field_type": "string|number|boolean|date|list|category", "computation_hint": "<instructions>", "depends_on": ["field1", "field2"], "allowed_values": [], "include_document_text": false}}

7. delete_derived_field — Remove a derived field
   {{"action": "delete_derived_field", "derived_field_id": "<uuid>"}}

8. update_workflow — Update workflow name or description
   {{"action": "update_workflow", "name": "<name>", "description": "<desc>"}}

## RULES
- ALWAYS respond with a conversational message explaining what you're doing.
- If the user asks to modify the workflow, include a ```actions``` block with the JSON array.
- If the user just asks a question (e.g. "what does my workflow look like?"), answer conversationally WITHOUT an actions block.
- When adding nodes, calculate sensible position_x/position_y values based on existing nodes. Space nodes ~250px apart horizontally. The flow goes left→right.
- When adding a node, also add connections to/from logical neighbors if the user's intent implies it.
- Use descriptive labels for nodes.
- For rule nodes, always include the conditions array in config.
- For AI nodes, always include model, output_format, system_prompt, and output_key.
- When the user says "connect X to Y", find the nodes by label match.
- You can reference nodes by their label (case-insensitive partial match) — I'll resolve the UUIDs.
- Be concise but helpful. Explain what you did after each action.
"""


# ---------------------------------------------------------------------------
# Conversation history builder
# ---------------------------------------------------------------------------

def _build_conversation(
    workflow: Workflow,
    user_message: str,
    max_history: int = 20,
) -> tuple[str, list[dict]]:
    """
    Build the system prompt + message history for the LLM call.

    Returns (system_prompt, messages) where messages is a list of
    {role, content} dicts ready for the API call.
    """
    snapshot = _snapshot_workflow(workflow)
    system = SYSTEM_PROMPT.format(
        workflow_state=json.dumps(snapshot, indent=2, default=str),
    )

    # Load recent conversation history
    history = list(
        workflow.chat_messages
        .filter(role__in=['user', 'assistant'])
        .order_by('-created_at')[:max_history]
    )
    history.reverse()  # oldest first

    messages = []
    for msg in history:
        if msg.role == 'user':
            messages.append({'role': 'user', 'content': msg.content})
        elif msg.role == 'assistant':
            messages.append({'role': 'assistant', 'content': msg.content})

    # Append current user message
    messages.append({'role': 'user', 'content': user_message})

    return system, messages


# ---------------------------------------------------------------------------
# Response parser — extract actions from the LLM response
# ---------------------------------------------------------------------------

def _parse_response(raw_text: str) -> tuple[str, list[dict]]:
    """
    Parse the LLM response into (reply_text, actions).

    The LLM puts actions inside ```actions ... ``` fences.
    Everything outside the fence is the conversational reply.
    """
    # Find actions block
    actions_match = re.search(
        r'```actions\s*\n?(.*?)\n?\s*```',
        raw_text,
        re.DOTALL,
    )

    actions = []
    reply_text = raw_text

    if actions_match:
        actions_json = actions_match.group(1).strip()
        reply_text = raw_text[:actions_match.start()] + raw_text[actions_match.end():]
        reply_text = reply_text.strip()

        try:
            parsed = json.loads(actions_json)
            if isinstance(parsed, list):
                actions = parsed
            elif isinstance(parsed, dict):
                actions = [parsed]
        except json.JSONDecodeError:
            # Try to find a JSON array in the text
            arr_match = re.search(r'\[.*\]', actions_json, re.DOTALL)
            if arr_match:
                try:
                    actions = json.loads(arr_match.group())
                except json.JSONDecodeError:
                    logger.warning(f"Failed to parse actions JSON: {actions_json[:200]}")

    # Also try generic ```json fences as fallback
    if not actions:
        json_match = re.search(r'```json\s*\n?(.*?)\n?\s*```', raw_text, re.DOTALL)
        if json_match:
            try:
                parsed = json.loads(json_match.group(1).strip())
                if isinstance(parsed, list):
                    actions = parsed
                    reply_text = raw_text[:json_match.start()] + raw_text[json_match.end():]
                    reply_text = reply_text.strip()
            except json.JSONDecodeError:
                pass

    return reply_text, actions


# ---------------------------------------------------------------------------
# Node label resolver — find nodes by label/type instead of UUID
# ---------------------------------------------------------------------------

def _resolve_node_ref(workflow: Workflow, ref: str) -> WorkflowNode | None:
    """
    Resolve a node reference — could be a UUID or a label substring.
    Returns the matching WorkflowNode or None.
    """
    if not ref:
        return None

    # Try UUID first
    try:
        uid = _uuid.UUID(str(ref))
        return workflow.nodes.filter(id=uid).first()
    except (ValueError, AttributeError):
        pass

    # Label substring match (case-insensitive)
    ref_lower = ref.lower().strip()
    for node in workflow.nodes.all():
        label = (node.label or '').lower()
        node_type = node.node_type.lower()
        display = node.get_node_type_display().lower()
        if ref_lower in label or ref_lower == node_type or ref_lower == display:
            return node

    # Partial match fallback
    for node in workflow.nodes.all():
        label = (node.label or '').lower()
        node_type = node.node_type.lower()
        if ref_lower in label or ref_lower in node_type:
            return node

    return None


# ---------------------------------------------------------------------------
# Action executor — apply actions to the workflow
# ---------------------------------------------------------------------------

def _apply_actions(workflow: Workflow, actions: list[dict], user=None) -> list[dict]:
    """
    Apply a list of structured actions to the workflow.
    Returns a list of result dicts [{action, status, detail, ...}].
    """
    results = []

    for action_def in actions:
        action_type = action_def.get('action', '')
        result = {'action': action_type, 'status': 'error', 'detail': ''}

        try:
            if action_type == 'add_node':
                result = _action_add_node(workflow, action_def)
            elif action_type == 'update_node':
                result = _action_update_node(workflow, action_def)
            elif action_type == 'delete_node':
                result = _action_delete_node(workflow, action_def)
            elif action_type == 'add_connection':
                result = _action_add_connection(workflow, action_def)
            elif action_type == 'delete_connection':
                result = _action_delete_connection(workflow, action_def)
            elif action_type == 'add_derived_field':
                result = _action_add_derived_field(workflow, action_def)
            elif action_type == 'delete_derived_field':
                result = _action_delete_derived_field(workflow, action_def)
            elif action_type == 'update_workflow':
                result = _action_update_workflow(workflow, action_def)
            else:
                result = {
                    'action': action_type,
                    'status': 'skipped',
                    'detail': f'Unknown action type: {action_type}',
                }
        except Exception as e:
            logger.error(f"Action {action_type} failed: {e}")
            result = {
                'action': action_type,
                'status': 'error',
                'detail': str(e),
            }

        results.append(result)

    # Rebuild extraction template after mutations
    try:
        workflow.rebuild_extraction_template()
    except Exception as e:
        logger.warning(f"Failed to rebuild extraction template: {e}")

    return results


# -- Individual action handlers ---------------------------------------------

def _action_add_node(workflow: Workflow, params: dict) -> dict:
    node_type = params.get('node_type', '')
    if node_type not in dict(WorkflowNode.NodeType.choices):
        return {'action': 'add_node', 'status': 'error',
                'detail': f'Invalid node type: {node_type}'}

    label = params.get('label', '')
    config = params.get('config', {})

    # Calculate position if not provided
    existing = workflow.nodes.all()
    max_x = max((n.position_x for n in existing), default=0)
    pos_x = params.get('position_x', max_x + 250)
    pos_y = params.get('position_y', 200)

    node = WorkflowNode.objects.create(
        workflow=workflow,
        node_type=node_type,
        label=label,
        position_x=pos_x,
        position_y=pos_y,
        config=config,
    )

    return {
        'action': 'add_node',
        'status': 'success',
        'node_id': str(node.id),
        'node_type': node_type,
        'label': label,
        'detail': f'Created {node_type} node "{label}" at ({pos_x}, {pos_y})',
    }


def _action_update_node(workflow: Workflow, params: dict) -> dict:
    node_id = params.get('node_id', '')
    node = _resolve_node_ref(workflow, node_id)
    if not node:
        # Try label
        label_ref = params.get('label_ref', '') or params.get('node_label', '')
        if label_ref:
            node = _resolve_node_ref(workflow, label_ref)
    if not node:
        return {'action': 'update_node', 'status': 'error',
                'detail': f'Node not found: {node_id}'}

    updated_fields = []

    if 'label' in params and params['label'] != node.label:
        node.label = params['label']
        updated_fields.append('label')

    if 'config' in params:
        # Merge config (don't replace entirely)
        new_config = node.config or {}
        new_config.update(params['config'])
        node.config = new_config
        updated_fields.append('config')

    if 'position_x' in params:
        node.position_x = params['position_x']
        updated_fields.append('position_x')
    if 'position_y' in params:
        node.position_y = params['position_y']
        updated_fields.append('position_y')

    if updated_fields:
        node.save(update_fields=updated_fields + ['updated_at'])

    return {
        'action': 'update_node',
        'status': 'success',
        'node_id': str(node.id),
        'updated': updated_fields,
        'detail': f'Updated node "{node.label}": {", ".join(updated_fields)}',
    }


def _action_delete_node(workflow: Workflow, params: dict) -> dict:
    node_id = params.get('node_id', '')
    node = _resolve_node_ref(workflow, node_id)
    if not node:
        return {'action': 'delete_node', 'status': 'error',
                'detail': f'Node not found: {node_id}'}

    label = node.label or node.get_node_type_display()
    node.delete()

    return {
        'action': 'delete_node',
        'status': 'success',
        'detail': f'Deleted node "{label}"',
    }


def _action_add_connection(workflow: Workflow, params: dict) -> dict:
    # Resolve source
    from_ref = params.get('from_node_id', '') or params.get('from_label', '')
    to_ref = params.get('to_node_id', '') or params.get('to_label', '')

    source = _resolve_node_ref(workflow, from_ref)
    target = _resolve_node_ref(workflow, to_ref)

    if not source:
        return {'action': 'add_connection', 'status': 'error',
                'detail': f'Source node not found: {from_ref}'}
    if not target:
        return {'action': 'add_connection', 'status': 'error',
                'detail': f'Target node not found: {to_ref}'}
    if source == target:
        return {'action': 'add_connection', 'status': 'error',
                'detail': 'Cannot connect a node to itself'}

    # Check for existing connection
    existing = NodeConnection.objects.filter(
        workflow=workflow, source_node=source, target_node=target,
    ).first()
    if existing:
        return {'action': 'add_connection', 'status': 'skipped',
                'detail': f'Connection already exists: {source.label} → {target.label}'}

    conn = NodeConnection.objects.create(
        workflow=workflow,
        source_node=source,
        target_node=target,
    )

    return {
        'action': 'add_connection',
        'status': 'success',
        'connection_id': str(conn.id),
        'detail': f'Connected "{source.label or source.node_type}" → '
                  f'"{target.label or target.node_type}"',
    }


def _action_delete_connection(workflow: Workflow, params: dict) -> dict:
    conn_id = params.get('connection_id', '')
    try:
        conn = workflow.connections.get(id=conn_id)
        detail = (f'Deleted connection: '
                  f'{conn.source_node.label} → {conn.target_node.label}')
        conn.delete()
        return {'action': 'delete_connection', 'status': 'success',
                'detail': detail}
    except NodeConnection.DoesNotExist:
        return {'action': 'delete_connection', 'status': 'error',
                'detail': f'Connection not found: {conn_id}'}


def _action_add_derived_field(workflow: Workflow, params: dict) -> dict:
    name = params.get('name', '').strip()
    if not name:
        return {'action': 'add_derived_field', 'status': 'error',
                'detail': 'name is required'}

    df, created = DerivedField.objects.update_or_create(
        workflow=workflow,
        name=name,
        defaults={
            'display_name': params.get('display_name', ''),
            'field_type': params.get('field_type', 'string'),
            'description': params.get('description', ''),
            'computation_hint': params.get('computation_hint', ''),
            'depends_on': params.get('depends_on', []),
            'allowed_values': params.get('allowed_values', []),
            'include_document_text': params.get('include_document_text', False),
            'order': params.get('order', 0),
        },
    )

    verb = 'Created' if created else 'Updated'
    return {
        'action': 'add_derived_field',
        'status': 'success',
        'derived_field_id': str(df.id),
        'detail': f'{verb} derived field "{name}" ({df.field_type})',
    }


def _action_delete_derived_field(workflow: Workflow, params: dict) -> dict:
    df_id = params.get('derived_field_id', '')
    try:
        df = workflow.derived_fields.get(id=df_id)
        name = df.name
        df.delete()
        return {'action': 'delete_derived_field', 'status': 'success',
                'detail': f'Deleted derived field "{name}"'}
    except DerivedField.DoesNotExist:
        # Try by name
        df_name = params.get('name', '')
        try:
            df = workflow.derived_fields.get(name=df_name)
            df.delete()
            return {'action': 'delete_derived_field', 'status': 'success',
                    'detail': f'Deleted derived field "{df_name}"'}
        except DerivedField.DoesNotExist:
            return {'action': 'delete_derived_field', 'status': 'error',
                    'detail': f'Derived field not found: {df_id or df_name}'}


def _action_update_workflow(workflow: Workflow, params: dict) -> dict:
    updated = []
    if 'name' in params:
        workflow.name = params['name']
        updated.append('name')
    if 'description' in params:
        workflow.description = params['description']
        updated.append('description')
    if updated:
        workflow.save(update_fields=updated + ['updated_at'])
    return {
        'action': 'update_workflow',
        'status': 'success',
        'updated': updated,
        'detail': f'Updated workflow: {", ".join(updated)}',
    }


# ---------------------------------------------------------------------------
# Main chat function — called by the view
# ---------------------------------------------------------------------------

def chat_with_workflow(
    workflow: Workflow,
    user_message: str,
    model_id: str = 'gemini-2.0-flash',
    auto_apply: bool = True,
    user=None,
) -> dict:
    """
    Process a chat message against a workflow.

    1. Save the user message
    2. Build the system prompt + conversation history
    3. Call the LLM
    4. Parse the response for structured actions
    5. Optionally apply the actions to the workflow
    6. Save the assistant message
    7. Return the result

    Args:
        workflow: The Workflow instance to chat about
        user_message: The user's natural language message
        model_id: LLM model to use (default: gemini-2.0-flash)
        auto_apply: If True, automatically apply proposed actions
        user: The Django User who sent the message

    Returns:
        {
            "reply": "...",
            "actions": [...],
            "actions_applied": true/false,
            "action_results": [...],
            "model": "gemini-2.0-flash",
            "message_id": "uuid",
        }
    """
    from .ai_node_executor import _call_model

    # 1. Save user message
    user_msg = WorkflowChatMessage.objects.create(
        workflow=workflow,
        role='user',
        content=user_message,
        created_by=user,
    )

    # 2. Build prompt
    system_prompt, messages = _build_conversation(workflow, user_message)

    # 3. Call LLM
    # Build the conversation as a single context string for _call_model
    context_parts = []
    for msg in messages[:-1]:  # exclude the last (current) user message
        role_label = "USER" if msg['role'] == 'user' else "ASSISTANT"
        context_parts.append(f"[{role_label}]: {msg['content']}")
    context_parts.append(f"[USER]: {user_message}")
    full_context = "\n\n".join(context_parts)

    ai_result = _call_model(
        model_id=model_id,
        system_prompt=system_prompt,
        document_context=full_context,
        temperature=0.3,
        max_tokens=4096,
    )

    if 'error' in ai_result:
        # Save error as assistant message
        error_msg = f"Sorry, I encountered an error: {ai_result['error']}"
        asst_msg = WorkflowChatMessage.objects.create(
            workflow=workflow,
            role='assistant',
            content=error_msg,
            model_used=model_id,
            created_by=user,
        )
        return {
            'reply': error_msg,
            'actions': [],
            'actions_applied': False,
            'action_results': [],
            'model': model_id,
            'message_id': str(asst_msg.id),
            'error': ai_result['error'],
        }

    raw_response = ai_result.get('response', '')

    # 4. Parse response
    reply_text, actions = _parse_response(raw_response)

    # 5. Apply actions if auto_apply and there are actions
    action_results = []
    applied = False
    if actions and auto_apply:
        action_results = _apply_actions(workflow, actions, user=user)
        applied = True

    # 6. Save assistant message
    asst_msg = WorkflowChatMessage.objects.create(
        workflow=workflow,
        role='assistant',
        content=reply_text,
        actions=actions,
        actions_applied=applied,
        model_used=model_id,
        token_usage=ai_result.get('usage', {}),
        created_by=user,
    )

    return {
        'reply': reply_text,
        'actions': actions,
        'actions_applied': applied,
        'action_results': action_results,
        'model': model_id,
        'message_id': str(asst_msg.id),
    }
