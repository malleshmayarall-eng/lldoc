from __future__ import annotations

import base64
import json

from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import serializers

from .models import DmsDocument, DmsSignatory
from .services import build_metadata_index, build_search_index, extract_pdf_metadata, extract_pdf_text, merge_metadata


class DmsSignatorySerializer(serializers.ModelSerializer):
    class Meta:
        model = DmsSignatory
        fields = ["id", "name", "role", "organization"]


class DmsDocumentListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list views — no pdf_data, no extracted_text."""

    created_by_name = serializers.SerializerMethodField()
    signatories_count = serializers.SerializerMethodField()

    class Meta:
        model = DmsDocument
        fields = [
            "id",
            "title",
            "original_filename",
            "content_type",
            "file_size",
            "document_id",
            "document_name",
            "document_type",
            "category",
            "status",
            "extracted_pdf_author",
            "extracted_pdf_page_count",
            "uploaded_date",
            "signed_date",
            "effective_date",
            "expiration_date",
            "termination_date",
            "signing_is_signed",
            "signature_type",
            "compliance_jurisdiction",
            "notes",
            "created_by",
            "created_by_name",
            "created_at",
            "updated_at",
            "signatories_count",
        ]
        read_only_fields = fields

    def get_created_by_name(self, obj: DmsDocument) -> str:
        if obj.created_by:
            full = f"{obj.created_by.first_name} {obj.created_by.last_name}".strip()
            return full or obj.created_by.username
        return ""

    def get_signatories_count(self, obj: DmsDocument) -> int:
        return obj.signatories.count()


class DmsDocumentSerializer(serializers.ModelSerializer):
    pdf_base64 = serializers.SerializerMethodField()
    signatories = DmsSignatorySerializer(many=True, read_only=True)

    class Meta:
        model = DmsDocument
        fields = [
            "id",
            "title",
            "original_filename",
            "content_type",
            "file_size",
            "metadata",
            "extracted_pdf_title",
            "extracted_pdf_author",
            "extracted_pdf_subject",
            "extracted_pdf_creator",
            "extracted_pdf_producer",
            "extracted_pdf_keywords",
            "extracted_pdf_page_count",
            "extracted_pdf_raw_metadata",
            "document_id",
            "document_name",
            "document_type",
            "category",
            "status",
            "uploaded_date",
            "signed_date",
            "effective_date",
            "expiration_date",
            "termination_date",
            "archived_date",
            "auto_renewal_enabled",
            "renewal_date",
            "renewal_decision_required",
            "renewed_date",
            "termination_initiated_date",
            "termination_notice_start_date",
            "deletion_eligible_date",
            "deletion_scheduled_date",
            "signing_is_signed",
            "signature_type",
            "compliance_jurisdiction",
            "compliance_retention_end_date",
            "compliance_legal_hold",
            "compliance_review_due_date",
            "audit_log_generated_at",
            "verification_retention_end_date",
            "notes",
            "metadata_index",
            "extracted_text",
            "created_by",
            "created_at",
            "updated_at",
            "pdf_base64",
            "signatories",
        ]
        read_only_fields = fields

    def get_pdf_base64(self, obj: DmsDocument) -> str | None:
        include_pdf = self.context.get("include_pdf")
        if not include_pdf:
            return None
        return base64.b64encode(obj.pdf_data).decode("utf-8") if obj.pdf_data else None


class DmsDocumentUploadSerializer(serializers.Serializer):
    file = serializers.FileField()
    title = serializers.CharField(required=False, allow_blank=True)
    metadata = serializers.JSONField(required=False)
    extract_metadata = serializers.BooleanField(default=True)
    extract_text = serializers.BooleanField(default=True)
    extracted_pdf = serializers.JSONField(required=False)
    document_id = serializers.CharField(required=False, allow_blank=True)
    document_name = serializers.CharField(required=False, allow_blank=True)
    document_type = serializers.CharField(required=False, allow_blank=True)
    category = serializers.CharField(required=False, allow_blank=True)
    status = serializers.CharField(required=False, allow_blank=True)
    dates = serializers.JSONField(required=False)
    signing = serializers.JSONField(required=False)
    compliance = serializers.JSONField(required=False)
    notes = serializers.CharField(required=False, allow_blank=True)
    uploaded_date = serializers.CharField(required=False, allow_blank=True)
    signed_date = serializers.CharField(required=False, allow_blank=True)
    effective_date = serializers.CharField(required=False, allow_blank=True)
    expiration_date = serializers.CharField(required=False, allow_blank=True)
    termination_date = serializers.CharField(required=False, allow_blank=True)
    archived_date = serializers.CharField(required=False, allow_blank=True)
    auto_renewal_enabled = serializers.BooleanField(required=False)
    renewal_date = serializers.CharField(required=False, allow_blank=True)
    renewal_decision_required = serializers.BooleanField(required=False)
    renewed_date = serializers.CharField(required=False, allow_blank=True)
    termination_initiated_date = serializers.CharField(required=False, allow_blank=True)
    termination_notice_start_date = serializers.CharField(required=False, allow_blank=True)
    deletion_eligible_date = serializers.CharField(required=False, allow_blank=True)
    deletion_scheduled_date = serializers.CharField(required=False, allow_blank=True)

    def validate_metadata(self, value):
        if isinstance(value, str):
            return json.loads(value)
        return value

    def validate_extracted_pdf(self, value):
        if isinstance(value, str):
            return json.loads(value)
        return value

    def _parse_date_value(self, value):
        if isinstance(value, str) and value:
            return parse_date(value)
        return None

    def create(self, validated_data):
        request = self.context.get("request")
        upload = validated_data["file"]
        pdf_bytes = upload.read()
        extracted_metadata = extract_pdf_metadata(pdf_bytes) if validated_data.get("extract_metadata") else {}
        custom_metadata = validated_data.get("metadata") or {}
        extracted_pdf_payload = validated_data.get("extracted_pdf") or {}
        merged_metadata = merge_metadata(extracted_metadata, custom_metadata)
        extracted_text = extract_pdf_text(pdf_bytes) if validated_data.get("extract_text") else ""
        metadata_index = build_metadata_index(merged_metadata)
        title = validated_data.get("title") or merged_metadata.get("title") or upload.name
        extra_text = f"{title} {upload.name or ''}"
        search_index = build_search_index(metadata_index, extracted_text, extra=extra_text)
        dates_payload = validated_data.get("dates") or {}
        signing_payload = validated_data.get("signing") or {}
        compliance_payload = validated_data.get("compliance") or {}
        parsed_dates = {
            "uploaded_date": self._parse_date_value(
                dates_payload.get("uploaded_date") or validated_data.get("uploaded_date")
            ),
            "signed_date": self._parse_date_value(
                dates_payload.get("signed_date") or validated_data.get("signed_date")
            ),
            "effective_date": self._parse_date_value(
                dates_payload.get("effective_date") or validated_data.get("effective_date")
            ),
            "expiration_date": self._parse_date_value(
                dates_payload.get("expiration_date") or validated_data.get("expiration_date")
            ),
            "termination_date": self._parse_date_value(
                dates_payload.get("termination_date") or validated_data.get("termination_date")
            ),
            "archived_date": self._parse_date_value(
                dates_payload.get("archived_date") or validated_data.get("archived_date")
            ),
            "renewal_date": self._parse_date_value(validated_data.get("renewal_date")),
            "renewed_date": self._parse_date_value(validated_data.get("renewed_date")),
            "termination_initiated_date": self._parse_date_value(
                validated_data.get("termination_initiated_date")
            ),
            "termination_notice_start_date": self._parse_date_value(
                validated_data.get("termination_notice_start_date")
            ),
            "deletion_eligible_date": self._parse_date_value(
                validated_data.get("deletion_eligible_date")
            ),
            "deletion_scheduled_date": self._parse_date_value(
                validated_data.get("deletion_scheduled_date")
            ),
        }
        retention_end_date = self._parse_date_value(compliance_payload.get("retention_end_date"))
        compliance_review_due_date = self._parse_date_value(
            compliance_payload.get("review_due_date")
        )
        verification_retention_end_date = self._parse_date_value(
            compliance_payload.get("verification_retention_end_date")
        )
        raw_metadata = (
            extracted_pdf_payload.get("raw_metadata")
            or extracted_metadata.get("raw_metadata")
            or {}
        )
        raw_metadata_text = json.dumps(raw_metadata)
        extra_text = " ".join(
            part
            for part in [title, upload.name or "", validated_data.get("document_name", ""), validated_data.get("document_id", "")]
            if part
        )
        search_index = build_search_index(metadata_index, extracted_text, extra=extra_text)
        document = DmsDocument.objects.create(
            title=title,
            original_filename=upload.name or "",
            content_type=getattr(upload, "content_type", "application/pdf"),
            pdf_data=pdf_bytes,
            file_size=len(pdf_bytes),
            metadata=merged_metadata,
            extracted_pdf_title=extracted_pdf_payload.get("title") or extracted_metadata.get("title", ""),
            extracted_pdf_author=extracted_pdf_payload.get("author") or extracted_metadata.get("author", ""),
            extracted_pdf_subject=extracted_pdf_payload.get("subject") or extracted_metadata.get("subject", ""),
            extracted_pdf_creator=extracted_pdf_payload.get("creator") or extracted_metadata.get("creator", ""),
            extracted_pdf_producer=extracted_pdf_payload.get("producer") or extracted_metadata.get("producer", ""),
            extracted_pdf_keywords=extracted_pdf_payload.get("keywords") or extracted_metadata.get("keywords", ""),
            extracted_pdf_page_count=extracted_pdf_payload.get("page_count") or extracted_metadata.get("page_count"),
            extracted_pdf_raw_metadata=raw_metadata_text,
            document_id=validated_data.get("document_id", ""),
            document_name=validated_data.get("document_name", ""),
            document_type=validated_data.get("document_type", ""),
            category=validated_data.get("category", ""),
            status=validated_data.get("status", ""),
            uploaded_date=parsed_dates["uploaded_date"],
            signed_date=parsed_dates["signed_date"],
            effective_date=parsed_dates["effective_date"],
            expiration_date=parsed_dates["expiration_date"],
            termination_date=parsed_dates["termination_date"],
            archived_date=parsed_dates["archived_date"],
            auto_renewal_enabled=validated_data.get("auto_renewal_enabled", False),
            renewal_date=parsed_dates["renewal_date"],
            renewal_decision_required=validated_data.get("renewal_decision_required", False),
            renewed_date=parsed_dates["renewed_date"],
            termination_initiated_date=parsed_dates["termination_initiated_date"],
            termination_notice_start_date=parsed_dates["termination_notice_start_date"],
            deletion_eligible_date=parsed_dates["deletion_eligible_date"],
            deletion_scheduled_date=parsed_dates["deletion_scheduled_date"],
            signing_is_signed=signing_payload.get("is_signed", False),
            signature_type=signing_payload.get("signature_type", ""),
            compliance_jurisdiction=compliance_payload.get("jurisdiction", ""),
            compliance_retention_end_date=retention_end_date,
            compliance_legal_hold=compliance_payload.get("legal_hold", False),
            compliance_review_due_date=compliance_review_due_date,
            audit_log_generated_at=compliance_payload.get("audit_log_generated_at"),
            verification_retention_end_date=verification_retention_end_date,
            notes=validated_data.get("notes", ""),
            metadata_index=metadata_index,
            extracted_text=extracted_text,
            search_index=search_index,
            created_by=getattr(request, "user", None) if request else None,
        )
        signatories = signing_payload.get("signatories") or []
        for signatory in signatories:
            if not isinstance(signatory, dict):
                continue
            DmsSignatory.objects.create(
                document=document,
                name=signatory.get("name", ""),
                role=signatory.get("role", ""),
                organization=signatory.get("organization", ""),
            )
        audit_log_value = compliance_payload.get("audit_log_generated_at")
        if isinstance(audit_log_value, str) and audit_log_value:
            parsed_datetime = parse_datetime(audit_log_value)
            if parsed_datetime:
                document.audit_log_generated_at = parsed_datetime
                document.save(update_fields=["audit_log_generated_at"])

        return document


class DmsSearchSerializer(serializers.Serializer):
    query = serializers.CharField(required=False, allow_blank=True)
    metadata_filters = serializers.DictField(required=False)
    include_text = serializers.BooleanField(required=False, default=True)
    fuzzy = serializers.BooleanField(required=False, default=True)
    min_similarity = serializers.FloatField(required=False, default=0.6)
    max_fuzzy_results = serializers.IntegerField(required=False, default=200)


class DmsDocumentPreflightSerializer(serializers.Serializer):
    file = serializers.FileField()
    title = serializers.CharField(required=False, allow_blank=True)
    metadata = serializers.JSONField(required=False)
    extract_metadata = serializers.BooleanField(default=True)
    extract_text = serializers.BooleanField(default=True)

    def validate_metadata(self, value):
        if isinstance(value, str):
            return json.loads(value)
        return value

    def create(self, validated_data):
        upload = validated_data["file"]
        pdf_bytes = upload.read()
        extracted_metadata = extract_pdf_metadata(pdf_bytes) if validated_data.get("extract_metadata") else {}
        custom_metadata = validated_data.get("metadata") or {}
        merged_metadata = merge_metadata(extracted_metadata, custom_metadata)
        extracted_text = extract_pdf_text(pdf_bytes) if validated_data.get("extract_text") else ""
        title = validated_data.get("title") or merged_metadata.get("title") or upload.name
        return {
            "title": title,
            "original_filename": upload.name or "",
            "content_type": getattr(upload, "content_type", "application/pdf"),
            "file_size": len(pdf_bytes),
            "metadata": merged_metadata,
            "extracted_pdf_title": extracted_metadata.get("title", ""),
            "extracted_pdf_author": extracted_metadata.get("author", ""),
            "extracted_pdf_subject": extracted_metadata.get("subject", ""),
            "extracted_pdf_creator": extracted_metadata.get("creator", ""),
            "extracted_pdf_producer": extracted_metadata.get("producer", ""),
            "extracted_pdf_keywords": extracted_metadata.get("keywords", ""),
            "extracted_pdf_page_count": extracted_metadata.get("page_count"),
            "extracted_pdf_raw_metadata": json.dumps(extracted_metadata.get("raw_metadata") or {}),
            "extracted_text": extracted_text,
        }
