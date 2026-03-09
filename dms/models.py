from __future__ import annotations

import uuid

from django.contrib.auth import get_user_model
from django.db import models


User = get_user_model()


class DmsDocument(models.Model):
    """Store PDFs with extracted metadata for fast retrieval."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255, blank=True)
    original_filename = models.CharField(max_length=255, blank=True)
    content_type = models.CharField(max_length=128, blank=True)
    pdf_data = models.BinaryField()
    file_size = models.PositiveIntegerField(default=0)
    metadata = models.JSONField(default=dict, blank=True)
    extracted_pdf_title = models.CharField(max_length=255, blank=True)
    extracted_pdf_author = models.CharField(max_length=255, blank=True)
    extracted_pdf_subject = models.CharField(max_length=255, blank=True)
    extracted_pdf_creator = models.CharField(max_length=255, blank=True)
    extracted_pdf_producer = models.CharField(max_length=255, blank=True)
    extracted_pdf_keywords = models.CharField(max_length=255, blank=True)
    extracted_pdf_page_count = models.IntegerField(null=True, blank=True)
    extracted_pdf_raw_metadata = models.TextField(blank=True)
    document_id = models.CharField(max_length=100, blank=True)
    document_name = models.CharField(max_length=255, blank=True)
    document_type = models.CharField(max_length=50, blank=True)
    category = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=50, blank=True)
    uploaded_date = models.DateField(null=True, blank=True)
    signed_date = models.DateField(null=True, blank=True)
    effective_date = models.DateField(null=True, blank=True)
    expiration_date = models.DateField(null=True, blank=True)
    termination_date = models.DateField(null=True, blank=True)
    archived_date = models.DateField(null=True, blank=True)
    auto_renewal_enabled = models.BooleanField(default=False)
    renewal_date = models.DateField(null=True, blank=True)
    renewal_decision_required = models.BooleanField(default=False)
    renewed_date = models.DateField(null=True, blank=True)
    termination_initiated_date = models.DateField(null=True, blank=True)
    termination_notice_start_date = models.DateField(null=True, blank=True)
    deletion_eligible_date = models.DateField(null=True, blank=True)
    deletion_scheduled_date = models.DateField(null=True, blank=True)
    signing_is_signed = models.BooleanField(default=False)
    signature_type = models.CharField(max_length=20, blank=True)
    compliance_jurisdiction = models.CharField(max_length=100, blank=True)
    compliance_retention_end_date = models.DateField(null=True, blank=True)
    compliance_legal_hold = models.BooleanField(default=False)
    compliance_review_due_date = models.DateField(null=True, blank=True)
    audit_log_generated_at = models.DateTimeField(null=True, blank=True)
    verification_retention_end_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    metadata_index = models.TextField(blank=True, db_index=True)
    extracted_text = models.TextField(blank=True)
    search_index = models.TextField(default="", blank=True, db_index=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="dms_documents",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["-created_at"]),
            models.Index(fields=["title"]),
            models.Index(fields=["content_type"]),
        ]

    def __str__(self) -> str:  # pragma: no cover - human-readable only
        return self.title or self.original_filename or str(self.id)


class DmsSignatory(models.Model):
    document = models.ForeignKey(
        DmsDocument,
        on_delete=models.CASCADE,
        related_name="signatories",
    )
    name = models.CharField(max_length=255, blank=True)
    role = models.CharField(max_length=255, blank=True)
    organization = models.CharField(max_length=255, blank=True)

    def __str__(self) -> str:  # pragma: no cover
        return self.name or self.role or str(getattr(self, "pk", ""))
