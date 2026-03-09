"""
Gate Executor — AND Logic Gate
================================
Logic gate node that controls document flow based on upstream path convergence.

AND Gate:
  Documents pass ONLY if they appear in ALL upstream paths.
  This is a set intersection — a document must have flowed through every
  incoming branch to proceed.  Use case: "only process docs that passed
  BOTH the legal-review rule AND the finance-approval validator."

Note: A separate OR gate is unnecessary because regular nodes with multiple
inputs already do a union (OR) of all upstream document lists automatically.

The gate is a pure function: it receives the per-parent document-ID lists
from the DAG executor and returns the merged result.
"""
import logging

from .models import WorkflowNode

logger = logging.getLogger(__name__)


def execute_and_gate(
    node: WorkflowNode,
    per_parent_ids: dict[str, list[str]],
) -> dict:
    """
    AND Gate: return documents present in ALL upstream parent outputs.

    Args:
        node: The AND gate WorkflowNode.
        per_parent_ids: {parent_node_id: [doc_id, ...], ...}

    Returns:
        {
            'status': 'completed',
            'gate_type': 'and',
            'passed_document_ids': [...],
            'total_upstream': N,
            'parent_count': N,
            'parent_details': {parent_id: count, ...},
        }
    """
    if not per_parent_ids:
        return {
            'status': 'completed',
            'gate_type': 'and',
            'passed_document_ids': [],
            'total_upstream': 0,
            'parent_count': 0,
            'parent_details': {},
            'message': 'No upstream connections',
        }

    # Build sets per parent
    parent_sets = {
        pid: set(ids) for pid, ids in per_parent_ids.items()
    }
    parent_count = len(parent_sets)

    # Intersection: docs must be in ALL parent sets
    if parent_count == 1:
        passed = list(list(parent_sets.values())[0])
    else:
        passed = list(set.intersection(*parent_sets.values()))

    # Collect all unique upstream docs for stats
    all_upstream = set()
    for ids in parent_sets.values():
        all_upstream |= ids

    parent_details = {pid: len(ids) for pid, ids in per_parent_ids.items()}

    logger.info(
        f"AND gate {node.id}: {len(passed)} passed out of "
        f"{len(all_upstream)} unique docs across {parent_count} parents"
    )

    return {
        'status': 'completed',
        'gate_type': 'and',
        'passed_document_ids': passed,
        'blocked_document_ids': list(all_upstream - set(passed)),
        'total_upstream': len(all_upstream),
        'parent_count': parent_count,
        'parent_details': parent_details,
        'message': (
            f'{len(passed)} doc(s) present in all {parent_count} upstream paths'
            if parent_count > 1
            else f'{len(passed)} doc(s) passed through'
        ),
    }
