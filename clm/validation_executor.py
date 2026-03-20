"""
Validation Executor — Simple document approval engine
=======================================================
Handles the validator node type in workflows.

Key concepts:
  - A validator node has assigned **users** (via ValidatorUser).
  - When a document reaches a validator node, **ValidationDecision** rows
    are created for every (document × assigned-user) combination.
  - Approval rule: if ANY ONE assigned user approves → document approved.
  - If ALL assigned users reject → document rejected.
  - Approved documents immediately flow downstream.
"""
import logging
from django.utils import timezone

from .models import (
    ValidatorUser,
    ValidationDecision,
    WorkflowDocument,
    WorkflowNode,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Gate evaluation — called during DAG execution
# ---------------------------------------------------------------------------

def evaluate_validator_node(
    node: WorkflowNode,
    incoming_document_ids: list,
    triggered_by=None,
) -> dict:
    """
    Evaluate a validator node during workflow execution.

    For each incoming document, check if any validator has approved.
    If decisions don't exist yet, create pending ones.

    Returns:
        {
            "status": "approved" | "pending" | "rejected" | "no_validators",
            "passed_document_ids":  [...],
            "pending_document_ids": [...],
            "rejected_document_ids": [...],
            "message": "...",
        }
    """
    validators = list(
        ValidatorUser.objects.filter(node=node, is_active=True).select_related('user')
    )

    if not validators:
        # No validators assigned → pass-through
        return {
            'status': 'no_validators',
            'passed_document_ids': incoming_document_ids,
            'pending_document_ids': [],
            'rejected_document_ids': [],
            'message': 'No validators assigned — pass-through',
        }

    passed = []
    pending = []
    rejected = []

    for doc_id in incoming_document_ids:
        doc_status = _evaluate_document(node, doc_id, validators)
        if doc_status == 'approved':
            passed.append(doc_id)
        elif doc_status == 'rejected':
            rejected.append(doc_id)
        else:
            pending.append(doc_id)

    total = len(incoming_document_ids)
    if rejected:
        overall = 'rejected'
    elif pending:
        overall = 'pending'
    else:
        overall = 'approved'

    msg_parts = []
    if passed:
        msg_parts.append(f'{len(passed)} approved')
    if pending:
        msg_parts.append(f'{len(pending)} pending')
    if rejected:
        msg_parts.append(f'{len(rejected)} rejected')
    message = f'{total} docs: ' + ', '.join(msg_parts) if msg_parts else 'No documents'

    _update_node_cache(node)

    return {
        'status': overall,
        'passed_document_ids': passed,
        'pending_document_ids': pending,
        'rejected_document_ids': rejected,
        'message': message,
    }


def _evaluate_document(node, doc_id, validators) -> str:
    """
    Evaluate a single document.
    - If ANY decision is approved → 'approved'
    - If ALL decisions are rejected → 'rejected'
    - Otherwise → 'pending' (create decisions if missing)
    """
    decisions = list(
        ValidationDecision.objects.filter(node=node, document_id=doc_id)
    )

    if not decisions:
        # First time → create pending rows for all validators
        _create_pending_decisions(node, doc_id, validators)
        return 'pending'

    statuses = [d.status for d in decisions]

    # Any one approval → approved
    if 'approved' in statuses:
        return 'approved'

    # All rejected → rejected
    if all(s == 'rejected' for s in statuses):
        return 'rejected'

    return 'pending'


def _create_pending_decisions(node, doc_id, validators):
    """Create pending ValidationDecision rows for a document."""
    created_for = []
    for vu in validators:
        decision, created = ValidationDecision.objects.get_or_create(
            node=node,
            document_id=doc_id,
            assigned_to=vu.user,
            defaults={
                'workflow': node.workflow,
                'status': 'pending',
            },
        )
        if created:
            created_for.append(vu.user)

    # ── Send "approval requested" alerts to newly-assigned users ──────
    if created_for:
        try:
            from communications.dispatch import send_alert
            doc = WorkflowDocument.objects.filter(id=doc_id).first()
            doc_title = doc.title if doc else str(doc_id)
            workflow = node.workflow
            for recipient in created_for:
                send_alert(
                    category='clm.validation_pending',
                    recipient=recipient,
                    title='Approval requested',
                    message=(
                        f'Document "{doc_title}" is waiting for your review '
                        f'in workflow "{workflow.name}" '
                        f'({node.label or "Validator"}).'
                    ),
                    priority='high',
                    target_type='workflow',
                    target_id=str(workflow.id),
                    metadata={
                        'workflow_id': str(workflow.id),
                        'workflow_name': workflow.name,
                        'node_id': str(node.id),
                        'node_label': node.label,
                        'document_id': str(doc_id),
                        'document_title': doc_title,
                        'action_url': f'/clm/validation/{workflow.id}',
                    },
                    email=True,
                )
        except Exception as e:
            logger.warning(f"Failed to send validation-pending alerts: {e}")


# ---------------------------------------------------------------------------
# Resolve a validation decision (approve/reject by the assigned user)
# ---------------------------------------------------------------------------

def resolve_validation(
    decision_id: str,
    action: str,        # 'approve' or 'reject'
    user,
    note: str = '',
) -> dict:
    """
    A validator approves or rejects a document.

    If approved:
      - Skip all other pending decisions for this doc at this node
      - Execute downstream nodes for this single document
    If rejected:
      - Check if all validators have rejected → mark doc as rejected
      - Otherwise keep waiting for other validators
    """
    try:
        decision = ValidationDecision.objects.select_related(
            'node', 'workflow', 'document',
        ).get(id=decision_id)
    except ValidationDecision.DoesNotExist:
        return {'success': False, 'error': 'Decision not found'}

    if decision.status != 'pending':
        return {
            'success': False,
            'error': f'Decision already {decision.status}',
        }

    if decision.assigned_to_id != user.id:
        return {
            'success': False,
            'error': 'You are not assigned to this validation',
        }

    # Record decision
    decision.status = 'approved' if action == 'approve' else 'rejected'
    decision.note = note
    decision.decided_at = timezone.now()
    decision.save()

    node = decision.node
    doc_id = decision.document_id

    result = {
        'success': True,
        'decision_id': str(decision.id),
        'action': action,
        'document_id': str(doc_id),
        'document_title': decision.document.title,
    }

    if action == 'approve':
        # Any one approval = approved!
        # Skip all remaining pending decisions for this doc at this node
        ValidationDecision.objects.filter(
            node=node, document_id=doc_id, status='pending',
        ).update(status='skipped', decided_at=timezone.now())

        result['document_status'] = 'approved'
        result['message'] = f'Document approved by {user.get_full_name() or user.username}'

        # Execute downstream for this single document
        try:
            downstream = _execute_downstream_single_doc(node, doc_id, user)
            result['downstream_executed'] = True
            result['downstream_result'] = downstream
        except Exception as e:
            logger.error(f"Downstream exec failed: {e}")
            result['downstream_error'] = str(e)

    else:
        # Rejection — check if ALL validators have now rejected
        remaining_pending = ValidationDecision.objects.filter(
            node=node, document_id=doc_id, status='pending',
        ).count()

        if remaining_pending == 0:
            result['document_status'] = 'rejected'
            result['message'] = 'All validators rejected this document'
        else:
            result['document_status'] = 'pending'
            result['message'] = (
                f'Rejected by {user.get_full_name() or user.username}, '
                f'{remaining_pending} validator(s) still pending'
            )

    _update_node_cache(node)

    # ── Send "validation resolved" alerts ─────────────────────────────
    try:
        from communications.dispatch import send_alert
        doc_title = decision.document.title
        workflow = node.workflow
        action_label = 'approved' if action == 'approve' else 'rejected'
        user_display = user.get_full_name() or user.username

        # Notify the workflow creator about the decision
        owner = workflow.created_by
        if owner and owner.id != user.id:
            send_alert(
                category='clm.validation_resolved',
                recipient=owner,
                title=f'Document {action_label}',
                message=(
                    f'{user_display} has {action_label} "{doc_title}" '
                    f'in workflow "{workflow.name}" '
                    f'({node.label or "Validator"}).'
                ),
                actor=user,
                priority='medium',
                target_type='workflow',
                target_id=str(workflow.id),
                metadata={
                    'workflow_id': str(workflow.id),
                    'workflow_name': workflow.name,
                    'node_id': str(node.id),
                    'node_label': node.label,
                    'document_id': str(doc_id),
                    'document_title': doc_title,
                    'decision_id': str(decision.id),
                    'action': action_label,
                    'action_url': f'/clm/validation/{workflow.id}',
                },
                email=True,
            )

        # Notify other validators assigned to the same doc (excluding actor)
        other_validators = (
            ValidationDecision.objects
            .filter(node=node, document_id=doc_id)
            .exclude(assigned_to=user)
            .select_related('assigned_to')
        )
        for other_decision in other_validators:
            send_alert(
                category='clm.validation_resolved',
                recipient=other_decision.assigned_to,
                title=f'Document {action_label}',
                message=(
                    f'{user_display} has {action_label} "{doc_title}" '
                    f'in workflow "{workflow.name}" '
                    f'({node.label or "Validator"}).'
                ),
                actor=user,
                priority='low',
                target_type='workflow',
                target_id=str(workflow.id),
                metadata={
                    'workflow_id': str(workflow.id),
                    'node_id': str(node.id),
                    'document_id': str(doc_id),
                    'document_title': doc_title,
                    'action': action_label,
                    'action_url': f'/clm/validation/{workflow.id}',
                },
            )
    except Exception as e:
        logger.warning(f"Failed to send validation-resolved alerts: {e}")

    return result


def _update_node_cache(node):
    """Update the validator node's last_result cache."""
    decisions = ValidationDecision.objects.filter(node=node)
    total = decisions.count()
    approved = decisions.filter(status='approved').count()
    rejected = decisions.filter(status='rejected').count()
    pending_count = decisions.filter(status='pending').count()

    # Count unique documents
    doc_ids = decisions.values_list('document_id', flat=True).distinct()
    docs_approved = 0
    docs_rejected = 0
    docs_pending = 0
    for did in doc_ids:
        doc_decisions = decisions.filter(document_id=did)
        statuses = list(doc_decisions.values_list('status', flat=True))
        if 'approved' in statuses:
            docs_approved += 1
        elif all(s == 'rejected' for s in statuses):
            docs_rejected += 1
        else:
            docs_pending += 1

    node.last_result = {
        'status': 'rejected' if docs_rejected and not docs_pending else (
            'pending' if docs_pending else ('approved' if docs_approved else 'no_validators')
        ),
        'count': len(doc_ids),
        'approved': docs_approved,
        'rejected': docs_rejected,
        'pending': docs_pending,
        'total_decisions': total,
        'validator_status': 'pending' if docs_pending else (
            'approved' if docs_approved else 'rejected'
        ),
    }
    node.save(update_fields=['last_result', 'updated_at'])


def _execute_downstream_single_doc(node, doc_id, triggered_by=None) -> dict:
    """
    Execute downstream nodes for a SINGLE approved document.
    This is the key difference from bulk execution: only one
    document flows through actions, so the action for-loop
    processes exactly one document.
    """
    from .node_executor import _execute_rule_node, _execute_output_node
    from .action_executor import execute_action_node
    from .models import NodeConnection

    downstream = NodeConnection.objects.filter(
        source_node=node,
    ).select_related('target_node')

    results = {}
    doc_ids = [str(doc_id)]

    for conn in downstream:
        target = conn.target_node

        if target.node_type == 'rule':
            out = _execute_rule_node(target, doc_ids)
            target.last_result = {
                'count': len(out),
                'document_ids': [str(d) for d in out],
            }
            target.save(update_fields=['last_result', 'updated_at'])
            results[str(target.id)] = {
                'node_type': 'rule', 'label': target.label,
                'count': len(out),
            }

        elif target.node_type == 'action':
            if target.config and target.config.get('plugin'):
                ar = execute_action_node(
                    node=target,
                    incoming_document_ids=doc_ids,
                    triggered_by=triggered_by,
                )
                results[str(target.id)] = {
                    'node_type': 'action', 'label': target.label,
                    'sent': ar.get('sent', 0),
                    'skipped': ar.get('skipped', 0),
                    'failed': ar.get('failed', 0),
                }

        elif target.node_type == 'output':
            out = _execute_output_node(target, doc_ids)
            target.last_result = {
                'count': len(out),
                'document_ids': [str(d) for d in out],
            }
            target.save(update_fields=['last_result', 'updated_at'])
            results[str(target.id)] = {
                'node_type': 'output', 'label': target.label,
                'count': len(out),
            }

    return results


# ---------------------------------------------------------------------------
# Dashboard query helpers
# ---------------------------------------------------------------------------

def get_pending_validations_for_user(user, workflow_id=None) -> list:
    """
    Get all pending validation decisions assigned to a user.
    Optionally filter by workflow.
    """
    qs = ValidationDecision.objects.filter(
        assigned_to=user,
        status='pending',
    ).select_related(
        'document', 'node', 'workflow',
    ).order_by('-created_at')

    if workflow_id:
        qs = qs.filter(workflow_id=workflow_id)

    return list(qs)


def get_validation_summary_for_workflow(workflow_id) -> dict:
    """
    Summary of validation status for a workflow.
    """
    decisions = ValidationDecision.objects.filter(workflow_id=workflow_id)
    return {
        'total': decisions.count(),
        'pending': decisions.filter(status='pending').count(),
        'approved': decisions.filter(status='approved').count(),
        'rejected': decisions.filter(status='rejected').count(),
        'skipped': decisions.filter(status='skipped').count(),
    }
