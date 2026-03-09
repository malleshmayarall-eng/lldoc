from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterable

from django.utils import timezone
from django.utils.dateparse import parse_date

from .models import DmsDocument


@dataclass(frozen=True)
class DocumentAlert:
    document_id: str
    alert_type: str
    message: str
    due_date: date | None


def _coerce_date(value) -> date | None:
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value:
        return parse_date(value)
    return None


def _resolve_document_date(document: DmsDocument, field_name: str) -> date | None:
    direct_value = getattr(document, field_name, None)
    resolved = _coerce_date(direct_value)
    if resolved:
        return resolved

    metadata = document.metadata or {}
    if isinstance(metadata, dict):
        if field_name in metadata:
            return _coerce_date(metadata.get(field_name))
        dates = metadata.get("dates")
        if isinstance(dates, dict):
            return _coerce_date(dates.get(field_name))
    return None


def _days_until(target: date | None) -> int | None:
    if not target:
        return None
    today = timezone.now().date()
    return (target - today).days


def build_document_alerts(document: DmsDocument, warning_days: int = 30) -> list[DocumentAlert]:
    alerts: list[DocumentAlert] = []

    today = timezone.now().date()

    expiration_date = _resolve_document_date(document, "expiration_date")
    exp_days = _days_until(expiration_date)
    if exp_days is not None and exp_days <= warning_days:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="expiring",
                message=f"Document expires in {exp_days} day(s)",
                due_date=expiration_date,
            )
        )
    if expiration_date and expiration_date < today:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="expired",
                message="Document has expired",
                due_date=expiration_date,
            )
        )

    termination_date = _resolve_document_date(document, "termination_date")
    term_days = _days_until(termination_date)
    if term_days is not None and term_days <= warning_days:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="terminating",
                message=f"Document terminates in {term_days} day(s)",
                due_date=termination_date,
            )
        )
    if termination_date and termination_date == today:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="termination_effective_today",
                message="Termination is effective today",
                due_date=termination_date,
            )
        )
    if termination_date and termination_date < today:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="terminated",
                message="Document has been terminated",
                due_date=termination_date,
            )
        )

    termination_initiated = _resolve_document_date(document, "termination_initiated_date")
    if termination_initiated:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="termination_initiated",
                message="Termination initiated",
                due_date=termination_initiated,
            )
        )

    termination_notice = _resolve_document_date(document, "termination_notice_start_date")
    if termination_notice:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="termination_notice_started",
                message="Termination notice period started",
                due_date=termination_notice,
            )
        )

    effective_date = _resolve_document_date(document, "effective_date")
    eff_days = _days_until(effective_date)
    if eff_days is not None and eff_days <= warning_days:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="effective",
                message=f"Document becomes effective in {eff_days} day(s)",
                due_date=effective_date,
            )
        )
    if effective_date and effective_date == today:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="effective_today",
                message="Document becomes effective today",
                due_date=effective_date,
            )
        )

    renewal_date = _resolve_document_date(document, "renewal_date")
    renewal_days = _days_until(renewal_date)
    if document.auto_renewal_enabled and renewal_days is not None and renewal_days <= warning_days:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="auto_renewal_upcoming",
                message=f"Auto-renewal in {renewal_days} day(s)",
                due_date=renewal_date,
            )
        )

    if document.renewal_decision_required and renewal_date:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="renewal_decision_required",
                message="Renewal decision required",
                due_date=renewal_date,
            )
        )

    if document.renewed_date:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="renewed",
                message="Document renewed successfully",
                due_date=document.renewed_date,
            )
        )

    if document.archived_date:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="archived",
                message="Document archived",
                due_date=document.archived_date,
            )
        )

    retention_end = _resolve_document_date(document, "compliance_retention_end_date")
    retention_days = _days_until(retention_end)
    if retention_days is not None and retention_days <= warning_days:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="retention_nearing_end",
                message=f"Retention period ends in {retention_days} day(s)",
                due_date=retention_end,
            )
        )

    if document.deletion_eligible_date:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="eligible_for_deletion",
                message="Document eligible for deletion",
                due_date=document.deletion_eligible_date,
            )
        )

    if document.deletion_scheduled_date:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="deletion_scheduled",
                message="Deletion scheduled",
                due_date=document.deletion_scheduled_date,
            )
        )

    if document.compliance_legal_hold:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="legal_hold_applied",
                message="Legal hold applied",
                due_date=None,
            )
        )

    if not document.compliance_legal_hold and document.compliance_retention_end_date:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="legal_hold_released",
                message="Legal hold released",
                due_date=document.compliance_retention_end_date,
            )
        )

    if document.audit_log_generated_at:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="audit_log_generated",
                message="Audit log generated",
                due_date=document.audit_log_generated_at.date(),
            )
        )

    if document.compliance_review_due_date:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="compliance_review_due",
                message="Compliance review due",
                due_date=document.compliance_review_due_date,
            )
        )

    if document.verification_retention_end_date:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="verification_retention_limit",
                message="Verification data retention limit reached",
                due_date=document.verification_retention_end_date,
            )
        )

    missing_fields = [
        field
        for field in ["document_id", "document_name", "document_type", "category", "status"]
        if not getattr(document, field, "")
    ]
    if missing_fields:
        alerts.append(
            DocumentAlert(
                document_id=str(document.id),
                alert_type="missing_mandatory_metadata",
                message=f"Missing mandatory metadata: {', '.join(missing_fields)}",
                due_date=None,
            )
        )

    return alerts


def build_alerts_for_queryset(queryset: Iterable[DmsDocument], warning_days: int = 30) -> list[DocumentAlert]:
    all_alerts: list[DocumentAlert] = []
    for document in queryset:
        all_alerts.extend(build_document_alerts(document, warning_days=warning_days))
    return all_alerts
