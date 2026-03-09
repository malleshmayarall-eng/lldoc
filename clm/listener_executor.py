"""
Listener Executor — Inbox / folder watching & single-doc trigger engine
=========================================================================
Listener nodes watch for new documents arriving from:
  - **Email inbox**: Check an IMAP mailbox for PDF/DOCX attachments
  - **Upload folder**: Watch a folder source (DriveFolder, DMS, etc.)
  - **Manual upload**: Documents uploaded directly to the workflow
  - **Webhook**: External system POSTs a document

When a new document is detected the listener:
  1. Uploads it to the workflow (creates WorkflowDocument)
  2. Runs AI extraction on it
  3. Triggers the workflow DAG for **only that single document**
     (not the full corpus — the action for-loop gets 1 doc)

The listener also supports the original trigger types:
  - approval_required, field_changed, all_documents_ready,
    document_count, manual

Config (node.config):
{
    "trigger_type": "email_inbox" | "folder_watch" | "document_uploaded" | ...,
    "source": "email" | "folder" | "manual" | "webhook",
    // Email inbox settings
    "email_host": "imap.gmail.com",
    "email_user": "contracts@company.com",
    "email_password": "...",
    "email_folder": "INBOX",
    "email_filter_subject": "Contract",      // optional subject filter
    "email_filter_sender": "legal@...",      // optional sender filter
    // Folder watch settings
    "watch_folder_id": "uuid",              // DriveFolder or DMS folder
    "watch_folder_path": "/contracts/new/",
    // General
    "auto_extract": true,
    "auto_execute": true,                   // auto-run DAG after trigger
    "gate_message": "...",
    "auto_execute_downstream": true,
}
"""
import logging

from django.utils import timezone

from .models import ListenerEvent, Workflow, WorkflowDocument, WorkflowNode

logger = logging.getLogger(__name__)


def evaluate_listener_node(
    node: WorkflowNode,
    incoming_document_ids: list,
    triggered_by=None,
    force_trigger: bool = False,
) -> dict:
    """
    Evaluate a listener node's trigger conditions.

    Returns:
        {
            "status": "passed" | "gated" | "pending_approval",
            "passed_document_ids": [...],   # docs that pass through
            "event_id": "uuid" | None,      # if an event was created
            "message": "...",
        }
    """
    config = node.config or {}
    trigger_type = config.get('trigger_type', 'manual')

    # Manual trigger with force_trigger=True → pass everything through
    if force_trigger:
        event = _create_event(
            node=node,
            trigger_type='manual',
            status='auto_fired',
            document_ids=incoming_document_ids,
            message='Manually triggered by user',
            triggered_by=triggered_by,
        )
        return {
            'status': 'passed',
            'passed_document_ids': incoming_document_ids,
            'event_id': str(event.id),
            'message': f'Manually triggered — {len(incoming_document_ids)} documents passed through',
        }

    # Evaluate based on trigger type
    evaluator = TRIGGER_EVALUATORS.get(trigger_type, _eval_manual)
    return evaluator(node, incoming_document_ids, triggered_by)


def resolve_listener_event(
    event_id: str,
    action: str,  # 'approve' or 'reject'
    user=None,
    note: str = '',
) -> dict:
    """
    Approve or reject a pending listener event.
    If approved and auto_execute_downstream is set, triggers downstream.
    """
    try:
        event = ListenerEvent.objects.select_related('node', 'workflow').get(id=event_id)
    except ListenerEvent.DoesNotExist:
        return {'success': False, 'error': 'Event not found'}

    if event.status != 'pending':
        return {
            'success': False,
            'error': f'Event is already {event.status}, cannot {action}',
        }

    if action == 'approve':
        event.status = 'approved'
        event.message = f'Approved by {user.username if user else "system"}'
    elif action == 'reject':
        event.status = 'rejected'
        event.message = f'Rejected by {user.username if user else "system"}'
    else:
        return {'success': False, 'error': f'Unknown action: {action}'}

    event.resolved_by = user
    event.resolution_note = note
    event.resolved_at = timezone.now()
    event.save()

    # Update node last_result
    node = event.node
    node.last_result = {
        'status': event.status,
        'event_id': str(event.id),
        'document_count': event.document_count,
        'resolved_by': user.username if user else None,
        'resolved_at': event.resolved_at.isoformat() if event.resolved_at else None,
    }
    node.save(update_fields=['last_result', 'updated_at'])

    result = {
        'success': True,
        'event_id': str(event.id),
        'status': event.status,
        'document_count': event.document_count,
        'message': event.message,
    }

    # Auto-execute downstream if approved
    if action == 'approve':
        config = node.config or {}
        if config.get('auto_execute_downstream', True):
            try:
                downstream_result = _execute_downstream(
                    node, event.document_ids, user,
                )
                event.downstream_executed = True
                event.execution_result = downstream_result
                event.save(update_fields=['downstream_executed', 'execution_result'])
                result['downstream_executed'] = True
                result['downstream_result'] = downstream_result
            except Exception as e:
                logger.error(f"Downstream execution failed after approval: {e}")
                result['downstream_error'] = str(e)

    return result


# ---------------------------------------------------------------------------
# Trigger evaluators — one per trigger_type
# ---------------------------------------------------------------------------

def _eval_document_uploaded(node, incoming_ids, triggered_by):
    """Pass if there are any documents in the pipeline."""
    if incoming_ids:
        event = _create_event(
            node=node,
            trigger_type='document_uploaded',
            status='auto_fired',
            document_ids=incoming_ids,
            message=f'{len(incoming_ids)} document(s) detected in pipeline',
            triggered_by=triggered_by,
        )
        return {
            'status': 'passed',
            'passed_document_ids': incoming_ids,
            'event_id': str(event.id),
            'message': f'{len(incoming_ids)} document(s) detected — auto-passed',
        }
    return {
        'status': 'gated',
        'passed_document_ids': [],
        'event_id': None,
        'message': 'No documents uploaded yet',
    }


def _eval_approval_required(node, incoming_ids, triggered_by):
    """Always gate — create a pending approval event."""
    # Check if there's already a pending approval for this node
    existing = ListenerEvent.objects.filter(
        node=node,
        status='pending',
        trigger_type='approval_required',
    ).first()

    if existing:
        # Update existing event with latest document list
        existing.document_ids = [str(d) for d in incoming_ids]
        existing.document_count = len(incoming_ids)
        existing.save(update_fields=['document_ids', 'document_count', 'updated_at'])
        return {
            'status': 'pending_approval',
            'passed_document_ids': [],
            'event_id': str(existing.id),
            'message': f'Waiting for approval — {len(incoming_ids)} document(s) pending',
        }

    config = node.config or {}
    gate_message = config.get(
        'gate_message',
        f'Approval required for {len(incoming_ids)} document(s)',
    )
    event = _create_event(
        node=node,
        trigger_type='approval_required',
        status='pending',
        document_ids=incoming_ids,
        message=gate_message,
        triggered_by=triggered_by,
    )
    return {
        'status': 'pending_approval',
        'passed_document_ids': [],
        'event_id': str(event.id),
        'message': gate_message,
    }


def _eval_field_changed(node, incoming_ids, triggered_by):
    """Pass documents where a specific field matches a condition."""
    from .node_executor import _eval_condition

    config = node.config or {}
    watch_field = config.get('watch_field', '')
    watch_op = config.get('watch_operator', 'eq')
    watch_value = config.get('watch_value', '')

    if not watch_field:
        return {
            'status': 'gated',
            'passed_document_ids': [],
            'event_id': None,
            'message': 'No watch_field configured',
        }

    docs = WorkflowDocument.objects.filter(id__in=incoming_ids)
    matched_ids = []
    for doc in docs:
        combined = {}
        combined.update(doc.global_metadata or {})
        combined.update(doc.extracted_metadata or {})
        if _eval_condition(combined, watch_field, watch_op, watch_value):
            matched_ids.append(doc.id)

    if matched_ids:
        event = _create_event(
            node=node,
            trigger_type='field_changed',
            status='auto_fired',
            document_ids=matched_ids,
            message=f'{len(matched_ids)} doc(s) match {watch_field} {watch_op} {watch_value}',
            triggered_by=triggered_by,
            event_data={
                'watch_field': watch_field,
                'watch_operator': watch_op,
                'watch_value': watch_value,
                'matched_count': len(matched_ids),
                'total_count': len(incoming_ids),
            },
        )
        return {
            'status': 'passed',
            'passed_document_ids': matched_ids,
            'event_id': str(event.id),
            'message': f'{len(matched_ids)}/{len(incoming_ids)} docs match condition',
        }

    return {
        'status': 'gated',
        'passed_document_ids': [],
        'event_id': None,
        'message': f'No documents match {watch_field} {watch_op} {watch_value}',
    }


def _eval_all_documents_ready(node, incoming_ids, triggered_by):
    """Pass only when all incoming documents have extraction completed."""
    if not incoming_ids:
        return {
            'status': 'gated',
            'passed_document_ids': [],
            'event_id': None,
            'message': 'No documents in pipeline',
        }

    ready_count = WorkflowDocument.objects.filter(
        id__in=incoming_ids,
        extraction_status='completed',
    ).count()
    total = len(incoming_ids)

    if ready_count == total:
        event = _create_event(
            node=node,
            trigger_type='all_documents_ready',
            status='auto_fired',
            document_ids=incoming_ids,
            message=f'All {total} documents have completed extraction',
            triggered_by=triggered_by,
        )
        return {
            'status': 'passed',
            'passed_document_ids': incoming_ids,
            'event_id': str(event.id),
            'message': f'All {total} documents ready — passed',
        }

    return {
        'status': 'gated',
        'passed_document_ids': [],
        'event_id': None,
        'message': f'{ready_count}/{total} documents ready — waiting for {total - ready_count} more',
    }


def _eval_document_count(node, incoming_ids, triggered_by):
    """Pass when document count reaches a threshold."""
    config = node.config or {}
    threshold = int(config.get('threshold', 1))
    count = len(incoming_ids)

    if count >= threshold:
        event = _create_event(
            node=node,
            trigger_type='document_count',
            status='auto_fired',
            document_ids=incoming_ids,
            message=f'Document count {count} >= threshold {threshold}',
            triggered_by=triggered_by,
            event_data={'count': count, 'threshold': threshold},
        )
        return {
            'status': 'passed',
            'passed_document_ids': incoming_ids,
            'event_id': str(event.id),
            'message': f'{count} docs (threshold: {threshold}) — passed',
        }

    return {
        'status': 'gated',
        'passed_document_ids': [],
        'event_id': None,
        'message': f'{count}/{threshold} documents — need {threshold - count} more',
    }


def _eval_manual(node, incoming_ids, triggered_by):
    """Manual trigger — always gates until force_trigger=True."""
    return {
        'status': 'gated',
        'passed_document_ids': [],
        'event_id': None,
        'message': 'Waiting for manual trigger',
    }


# Trigger type → evaluator function
TRIGGER_EVALUATORS = {
    'document_uploaded': _eval_document_uploaded,
    'approval_required': _eval_approval_required,
    'field_changed': _eval_field_changed,
    'all_documents_ready': _eval_all_documents_ready,
    'document_count': _eval_document_count,
    'manual': _eval_manual,
    'schedule': _eval_manual,  # placeholder
    'email_inbox': _eval_document_uploaded,   # inbox-sourced → same auto logic
    'folder_watch': _eval_document_uploaded,  # folder-sourced → same auto logic
}


# ---------------------------------------------------------------------------
# Email Inbox Checker — polls IMAP for attachments
# ---------------------------------------------------------------------------

def check_email_inbox(node: WorkflowNode, user=None) -> dict:
    """
    Poll an IMAP mailbox for new emails.

    Two modes (controlled by config flags):
      • **Attachments** (default): PDF/DOCX/TXT attachments → WorkflowDocument each.
      • **Email body as document**: The plain-text (or HTML-stripped) email body
        itself is stored as a WorkflowDocument with file_type='txt'. The subject
        becomes the title, and sender/date/subject go into extracted_metadata
        so downstream Rule nodes can filter on them.

    Both modes can run simultaneously.  For each created document:
      1. Run AI extraction (if template exists)
      2. Optionally trigger the workflow DAG for that single document

    Returns { "found": N, "documents_created": [...], "errors": [...] }
    """
    import email as email_lib
    import imaplib
    from email.header import decode_header
    from email.utils import parseaddr, parsedate_to_datetime

    from django.core.files.base import ContentFile

    config = node.config or {}
    host = config.get('email_host', '')
    email_user = config.get('email_user', '')
    email_pass = config.get('email_password', '')
    folder = config.get('email_folder', 'INBOX')
    subject_filter = config.get('email_filter_subject', '')
    sender_filter = config.get('email_filter_sender', '')
    auto_extract = config.get('auto_extract', True)
    auto_execute = config.get('auto_execute', True)
    include_body = config.get('include_body_as_document', True)
    include_attachments = config.get('include_attachments', True)

    if not host or not email_user:
        return {'found': 0, 'documents_created': [], 'errors': ['Email host/user not configured']}

    workflow = node.workflow
    org = workflow.organization
    created_docs = []
    skipped_count = 0
    errors = []

    # Pre-load all known Message-IDs for this workflow for fast O(1) lookups
    _existing_message_ids = set(
        WorkflowDocument.objects.filter(
            workflow=workflow,
        )
        .exclude(email_message_id='')
        .values_list('email_message_id', flat=True)
    )

    def _decode_header_value(raw_header):
        """Decode RFC-2047 encoded header into a plain string."""
        if not raw_header:
            return ''
        parts = decode_header(raw_header)
        decoded = []
        for data, charset in parts:
            if isinstance(data, bytes):
                decoded.append(data.decode(charset or 'utf-8', errors='replace'))
            else:
                decoded.append(data)
        return ' '.join(decoded)

    def _get_email_body(msg):
        """Extract the best plain-text body from an email message."""
        # Prefer text/plain; fall back to stripped text/html
        plain_parts = []
        html_parts = []
        for part in msg.walk():
            ct = part.get_content_type()
            disp = str(part.get('Content-Disposition', ''))
            if 'attachment' in disp:
                continue
            payload = part.get_payload(decode=True)
            if not payload:
                continue
            charset = part.get_content_charset() or 'utf-8'
            text = payload.decode(charset, errors='replace')
            if ct == 'text/plain':
                plain_parts.append(text)
            elif ct == 'text/html':
                html_parts.append(text)

        if plain_parts:
            return '\n'.join(plain_parts)

        # Strip HTML tags as fallback
        if html_parts:
            import re as _re
            raw_html = '\n'.join(html_parts)
            text = _re.sub(r'<style[^>]*>.*?</style>', '', raw_html, flags=_re.S | _re.I)
            text = _re.sub(r'<script[^>]*>.*?</script>', '', text, flags=_re.S | _re.I)
            text = _re.sub(r'<[^>]+>', ' ', text)
            text = _re.sub(r'\s+', ' ', text).strip()
            return text

        return ''

    def _process_document(doc, source_label):
        """Run AI extraction and optionally trigger the workflow for one doc."""
        if auto_extract and workflow.extraction_template:
            try:
                from .ai_inference import extract_document
                extract_document(doc, workflow.extraction_template)
            except Exception as e:
                logger.error(f"Extraction failed for inbox doc {doc.id}: {e}")
                doc.extraction_status = 'failed'
                doc.save(update_fields=['extraction_status'])
        elif not workflow.extraction_template:
            # No extraction template — mark as completed so it flows through
            doc.extraction_status = 'completed'
            doc.save(update_fields=['extraction_status'])

        if auto_execute:
            try:
                _trigger_single_doc_workflow(workflow, doc, user)
            except Exception as e:
                logger.error(f"Single-doc trigger failed: {e}")
                errors.append(f"Trigger failed for {source_label}: {str(e)}")

    try:
        # Connect to IMAP
        mail = imaplib.IMAP4_SSL(host)
        mail.login(email_user, email_pass)
        mail.select(folder)

        # Search for unseen messages
        search_criteria = '(UNSEEN)'
        if subject_filter:
            search_criteria = f'(UNSEEN SUBJECT "{subject_filter}")'
        if sender_filter:
            search_criteria = f'(UNSEEN FROM "{sender_filter}")'

        _, msg_ids = mail.search(None, search_criteria)
        msg_id_list = msg_ids[0].split()

        for msg_id in msg_id_list[:50]:  # cap at 50 per poll
            try:
                _, msg_data = mail.fetch(msg_id, '(RFC822)')
                raw = msg_data[0][1]
                msg = email_lib.message_from_bytes(raw)

                # ── Dedup via RFC Message-ID header ──────────────────
                raw_message_id = (msg.get('Message-ID') or msg.get('Message-Id') or '').strip()
                if raw_message_id and raw_message_id in _existing_message_ids:
                    # Already processed — mark seen and skip
                    mail.store(msg_id, '+FLAGS', '\\Seen')
                    skipped_count += 1
                    continue

                subject = _decode_header_value(msg.get('Subject', ''))
                sender_name, sender_email = parseaddr(msg.get('From', ''))
                sender_name = _decode_header_value(sender_name) or sender_email
                try:
                    email_date = parsedate_to_datetime(msg.get('Date', '')).isoformat()
                except Exception:
                    email_date = ''

                # Common metadata injected into every doc from this email
                email_meta = {
                    'email_subject': subject,
                    'email_sender': sender_email,
                    'email_sender_name': sender_name,
                    'email_date': email_date,
                    'email_source': email_user,
                }

                has_attachments = False

                # --- Attachments → WorkflowDocument each --------------------
                if include_attachments:
                    for part in msg.walk():
                        fname = part.get_filename()
                        if not fname:
                            continue
                        fname = _decode_header_value(fname)
                        ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else ''
                        if ext not in ('pdf', 'docx', 'doc', 'txt'):
                            continue

                        payload = part.get_payload(decode=True)
                        if not payload:
                            continue

                        has_attachments = True
                        file_type = ext if ext in ('pdf', 'docx', 'doc', 'txt') else 'pdf'
                        doc = WorkflowDocument.objects.create(
                            workflow=workflow,
                            organization=org,
                            title=fname,
                            file=ContentFile(payload, name=fname),
                            file_type=file_type,
                            file_size=len(payload),
                            extracted_metadata=email_meta,
                            global_metadata={'_source': 'email_inbox'},
                            uploaded_by=user,
                            email_message_id=raw_message_id,
                        )
                        created_docs.append(doc)
                        _process_document(doc, fname)

                # --- Email body → WorkflowDocument --------------------------
                if include_body:
                    body_text = _get_email_body(msg)
                    if body_text and len(body_text.strip()) > 20:
                        safe_subject = (subject or 'No Subject').strip()[:200]
                        title = f"📧 {safe_subject}"
                        # Save body as a .txt file so the doc has a real file
                        body_bytes = body_text.encode('utf-8')
                        txt_filename = f"email_{safe_subject[:60].replace(' ', '_')}.txt"

                        doc = WorkflowDocument.objects.create(
                            workflow=workflow,
                            organization=org,
                            title=title,
                            file=ContentFile(body_bytes, name=txt_filename),
                            file_type='txt',
                            file_size=len(body_bytes),
                            direct_text=body_text,
                            original_text=body_text,
                            text_source='direct',
                            extracted_metadata={
                                **email_meta,
                                'source_type': 'email_body',
                                'has_attachments': has_attachments,
                            },
                            global_metadata={'_source': 'email_inbox'},
                            uploaded_by=user,
                            email_message_id=raw_message_id,
                        )
                        created_docs.append(doc)
                        _process_document(doc, title)

                # Mark as seen
                mail.store(msg_id, '+FLAGS', '\\Seen')

                # Add to in-memory set so we don't re-process within same batch
                if raw_message_id:
                    _existing_message_ids.add(raw_message_id)

            except Exception as e:
                errors.append(f"Message processing error: {str(e)}")

        mail.logout()

    except Exception as e:
        errors.append(f"IMAP connection error: {str(e)}")

    # Create listener event
    if created_docs:
        body_count = sum(1 for d in created_docs if (d.extracted_metadata or {}).get('source_type') == 'email_body')
        attach_count = len(created_docs) - body_count
        skip_msg = f', {skipped_count} skipped (duplicate)' if skipped_count else ''
        _create_event(
            node=node,
            trigger_type='email_inbox',
            status='auto_fired',
            document_ids=[str(d.id) for d in created_docs],
            message=f'Inbox check: {len(created_docs)} doc(s) from {email_user} ({body_count} emails, {attach_count} attachments{skip_msg})',
            triggered_by=user,
            event_data={
                'source': 'email_inbox',
                'email_user': email_user,
                'email_folder': folder,
                'documents_created': len(created_docs),
                'email_bodies': body_count,
                'attachments': attach_count,
                'skipped_duplicates': skipped_count,
            },
        )

    return {
        'found': len(created_docs),
        'skipped': skipped_count,
        'documents_created': [
            {
                'id': str(d.id),
                'title': d.title,
                'status': d.extraction_status,
                'source_type': (d.extracted_metadata or {}).get('source_type', 'attachment'),
            }
            for d in created_docs
        ],
        'errors': errors,
    }


# ---------------------------------------------------------------------------
# Single-document workflow trigger
# ---------------------------------------------------------------------------

def _trigger_single_doc_workflow(workflow, document, triggered_by=None) -> dict:
    """
    Execute the workflow DAG for a SINGLE document.
    Only this document flows through rules, validators, and actions.
    """
    from .node_executor import execute_workflow
    return execute_workflow(
        workflow,
        triggered_by=triggered_by,
        single_document_ids=[str(document.id)],
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_event(
    node, trigger_type, status, document_ids,
    message='', triggered_by=None, event_data=None,
) -> ListenerEvent:
    """Create a ListenerEvent record."""
    event = ListenerEvent.objects.create(
        workflow=node.workflow,
        node=node,
        trigger_type=trigger_type,
        status=status,
        document_ids=[str(d) for d in document_ids],
        document_count=len(document_ids),
        event_data=event_data or {},
        message=message,
        triggered_by=triggered_by,
    )
    # Update node last_result
    node.last_result = {
        'status': status,
        'event_id': str(event.id),
        'document_count': len(document_ids),
        'message': message,
        'trigger_type': trigger_type,
    }
    node.save(update_fields=['last_result', 'updated_at'])
    return event


def _execute_downstream(node, document_ids, triggered_by=None) -> dict:
    """
    Execute all downstream nodes from this listener node.
    Used after an approval to continue the workflow pipeline.
    """
    from .node_executor import (
        _execute_output_node,
        _execute_rule_node,
    )
    from .action_executor import execute_action_node
    from .models import NodeConnection

    # Find all direct downstream nodes
    downstream_connections = NodeConnection.objects.filter(
        source_node=node,
    ).select_related('target_node')

    results = {}
    for conn in downstream_connections:
        target = conn.target_node
        doc_ids = [d if isinstance(d, str) else str(d) for d in document_ids]

        if target.node_type == 'rule':
            output_ids = _execute_rule_node(target, doc_ids)
            target.last_result = {
                'count': len(output_ids),
                'document_ids': [str(d) for d in output_ids],
            }
            target.save(update_fields=['last_result', 'updated_at'])
            results[str(target.id)] = {
                'node_type': 'rule',
                'label': target.label,
                'count': len(output_ids),
            }

        elif target.node_type == 'action':
            if target.config and target.config.get('plugin'):
                action_result = execute_action_node(
                    node=target,
                    incoming_document_ids=doc_ids,
                    triggered_by=triggered_by,
                )
                results[str(target.id)] = {
                    'node_type': 'action',
                    'label': target.label,
                    'sent': action_result.get('sent', 0),
                    'skipped': action_result.get('skipped', 0),
                    'failed': action_result.get('failed', 0),
                }

        elif target.node_type == 'output':
            output_ids = _execute_output_node(target, doc_ids)
            target.last_result = {
                'count': len(output_ids),
                'document_ids': [str(d) for d in output_ids],
            }
            target.save(update_fields=['last_result', 'updated_at'])
            results[str(target.id)] = {
                'node_type': 'output',
                'label': target.label,
                'count': len(output_ids),
            }

        elif target.node_type == 'listener':
            # Nested listener — evaluate it too
            nested = evaluate_listener_node(
                target, doc_ids, triggered_by,
            )
            results[str(target.id)] = {
                'node_type': 'listener',
                'label': target.label,
                'status': nested['status'],
                'message': nested['message'],
            }

    return results
