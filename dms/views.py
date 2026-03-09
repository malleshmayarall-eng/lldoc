from __future__ import annotations

import json

from django.db import connection
from django.db.models import Case, IntegerField, Q, Value, When
from django.http import HttpResponse
from django.utils.dateparse import parse_date
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .alerts import build_alerts_for_queryset, build_document_alerts
from .models import DmsDocument
from .serializers import (
    DmsDocumentListSerializer,
    DmsDocumentPreflightSerializer,
    DmsDocumentSerializer,
    DmsDocumentUploadSerializer,
    DmsSearchSerializer,
)
from .services import compute_fuzzy_score


# Allowed sort fields → actual model field
_SORT_FIELDS = {
    "title": "title",
    "created_at": "created_at",
    "updated_at": "updated_at",
    "uploaded_date": "uploaded_date",
    "effective_date": "effective_date",
    "expiration_date": "expiration_date",
    "file_size": "file_size",
    "status": "status",
    "category": "category",
    "document_type": "document_type",
    "author": "extracted_pdf_author",
}


class DmsDocumentViewSet(viewsets.ModelViewSet):
    queryset = DmsDocument.objects.all().order_by("-created_at")
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        if self.action == "list":
            return DmsDocumentListSerializer
        if self.action == "create":
            return DmsDocumentUploadSerializer
        if self.action == "preflight":
            return DmsDocumentPreflightSerializer
        if self.action == "search":
            return DmsSearchSerializer
        return DmsDocumentSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        document = serializer.save()
        response_serializer = DmsDocumentSerializer(document)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, *args, **kwargs):
        document = self.get_object()
        include_pdf = str(request.query_params.get("include_pdf", "")).lower() in {"1", "true", "yes"}
        serializer = DmsDocumentSerializer(document, context={"include_pdf": include_pdf})
        return Response(serializer.data)

    @action(detail=True, methods=["get"], url_path="download")
    def download(self, request, *args, **kwargs):
        document = self.get_object()
        response = HttpResponse(document.pdf_data, content_type=document.content_type or "application/pdf")
        filename = document.original_filename or f"document-{document.id}.pdf"
        response["Content-Disposition"] = f"attachment; filename=\"{filename}\""
        return response

    @action(detail=True, methods=["get"], url_path="alerts")
    def alerts(self, request, *args, **kwargs):
        document = self.get_object()
        warning_days = int(request.query_params.get("warning_days", 30))
        alerts = build_document_alerts(document, warning_days=warning_days)
        payload = [
            {
                "document_id": alert.document_id,
                "alert_type": alert.alert_type,
                "message": alert.message,
                "due_date": alert.due_date,
            }
            for alert in alerts
        ]
        return Response(payload, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="alerts")
    def alerts_list(self, request, *args, **kwargs):
        warning_days = int(request.query_params.get("warning_days", 30))
        queryset = self.get_queryset()
        alerts = build_alerts_for_queryset(queryset, warning_days=warning_days)
        payload = [
            {
                "document_id": alert.document_id,
                "alert_type": alert.alert_type,
                "message": alert.message,
                "due_date": alert.due_date,
            }
            for alert in alerts
        ]
        return Response(payload, status=status.HTTP_200_OK)

    @action(detail=False, methods=["post"], url_path="preflight")
    def preflight(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.save()
        return Response(payload, status=status.HTTP_200_OK)

    @action(detail=False, methods=["post"], url_path="search")
    def search(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        query = serializer.validated_data.get("query", "").strip().lower()
        metadata_filters = serializer.validated_data.get("metadata_filters") or {}
        include_text = serializer.validated_data.get("include_text", False)
        fuzzy = serializer.validated_data.get("fuzzy", True)
        min_similarity = serializer.validated_data.get("min_similarity", 0.6)
        max_fuzzy_results = serializer.validated_data.get("max_fuzzy_results", 200)

        if query and len(query) <= 3:
            min_similarity = min(min_similarity, 0.3)

        def metadata_matches(metadata: dict, filters: dict) -> bool:
            for key, desired in filters.items():
                if key not in metadata:
                    return False
                actual = metadata.get(key)
                if isinstance(desired, list):
                    if isinstance(actual, list):
                        if not any(item in actual for item in desired):
                            return False
                    else:
                        if not any(item == actual for item in desired):
                            return False
                else:
                    if isinstance(actual, list):
                        if desired not in actual:
                            return False
                    elif actual != desired:
                        return False
            return True

        base_queryset = self.get_queryset()
        use_python_metadata_filter = bool(metadata_filters) and connection.vendor == "sqlite"
        if metadata_filters and not use_python_metadata_filter:
            for key, value in metadata_filters.items():
                if isinstance(value, list):
                    for item in value:
                        base_queryset = base_queryset.filter(metadata__contains={key: item})
                else:
                    base_queryset = base_queryset.filter(metadata__contains={key: value})

        queryset = base_queryset
        if query and not fuzzy:
            if include_text:
                queryset = queryset.filter(search_index__icontains=query)
            else:
                queryset = queryset.filter(metadata_index__icontains=query)

        queryset = queryset.distinct()

        if use_python_metadata_filter:
            queryset = [doc for doc in queryset if metadata_matches(doc.metadata or {}, metadata_filters)]

        if query and fuzzy:
            candidate_queryset = base_queryset
            filtered_candidates = candidate_queryset.filter(search_index__icontains=query)
            if filtered_candidates.exists():
                candidate_queryset = filtered_candidates

            candidate_limit = max(1, min(int(max_fuzzy_results), 500))
            candidates = list(candidate_queryset.order_by("-created_at")[:candidate_limit])
            if use_python_metadata_filter:
                candidates = [doc for doc in candidates if metadata_matches(doc.metadata or {}, metadata_filters)]
            scored: list[tuple[str, float]] = []
            for doc in candidates:
                haystack = " ".join(
                    part
                    for part in [
                        doc.search_index,
                        doc.metadata_index,
                        doc.extracted_text,
                        doc.title,
                        doc.original_filename,
                    ]
                    if part
                )
                score = compute_fuzzy_score(query, haystack)
                if score >= min_similarity:
                    scored.append((str(doc.id), score))

            scored.sort(key=lambda item: item[1], reverse=True)
            ordered_ids = [item[0] for item in scored]
            if ordered_ids:
                ordering = Case(
                    *[When(id=doc_id, then=Value(index)) for index, doc_id in enumerate(ordered_ids)],
                    output_field=IntegerField(),
                )
                queryset = self.get_queryset().filter(id__in=ordered_ids).order_by(ordering)
            else:
                queryset = self.get_queryset().none()
        page = self.paginate_queryset(queryset)
        if page is not None:
            serialized = DmsDocumentSerializer(page, many=True)
            return self.get_paginated_response(serialized.data)

        serialized = DmsDocumentSerializer(queryset, many=True)
        return Response(serialized.data)

    # ──────────────────────────────────────────────────────────────────────
    # Seamless list with query-param filtering, sorting & text search
    # GET /api/dms/documents/?q=&status=&category=&document_type=&author=
    #   &created_after=&created_before=&uploaded_after=&uploaded_before=
    #   &updated_after=&updated_before=&sort_by=created_at&sort_dir=desc
    # ──────────────────────────────────────────────────────────────────────

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        params = request.query_params

        # ── text search (metadata_index + title + filename) ──
        q = (params.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(metadata_index__icontains=q)
                | Q(title__icontains=q)
                | Q(original_filename__icontains=q)
                | Q(document_name__icontains=q)
                | Q(extracted_pdf_author__icontains=q)
            )

        # ── exact-match dropdown filters ──
        for field in ("status", "category", "document_type", "signature_type", "compliance_jurisdiction"):
            val = params.get(field)
            if val:
                qs = qs.filter(**{field: val})

        if params.get("author"):
            qs = qs.filter(extracted_pdf_author__icontains=params["author"])

        if params.get("created_by"):
            qs = qs.filter(created_by_id=params["created_by"])

        if params.get("is_signed"):
            qs = qs.filter(signing_is_signed=params["is_signed"].lower() in ("1", "true", "yes"))

        # ── metadata key-value filters ──
        # Accept JSON-encoded array: metadata_filters=[{"key":"parties","value":"Acme"},…]
        raw_mf = params.get("metadata_filters")
        if raw_mf:
            try:
                meta_filters = json.loads(raw_mf)
            except (json.JSONDecodeError, TypeError):
                meta_filters = []
            if meta_filters and isinstance(meta_filters, list):
                if connection.vendor == "sqlite":
                    # SQLite doesn't support __contains on JSONField reliably — filter in Python
                    pk_set = None
                    for mf in meta_filters:
                        key = mf.get("key", "").strip()
                        val = mf.get("value", "").strip().lower()
                        if not key:
                            continue
                        matching = set()
                        for doc_id, doc_meta in qs.values_list("id", "metadata"):
                            if not isinstance(doc_meta, dict):
                                continue
                            actual = doc_meta.get(key)
                            if actual is None:
                                continue
                            # Support matching inside lists and partial string match
                            if isinstance(actual, list):
                                if any(val in str(item).lower() for item in actual):
                                    matching.add(doc_id)
                            elif val in str(actual).lower():
                                matching.add(doc_id)
                        pk_set = matching if pk_set is None else pk_set & matching
                    if pk_set is not None:
                        qs = qs.filter(id__in=pk_set)
                else:
                    for mf in meta_filters:
                        key = mf.get("key", "").strip()
                        val = mf.get("value", "").strip()
                        if key and val:
                            qs = qs.filter(metadata__contains={key: val})

        # ── date range filters ──
        _date_range_fields = {
            "created": "created_at",
            "updated": "updated_at",
            "uploaded": "uploaded_date",
            "effective": "effective_date",
            "expiration": "expiration_date",
            "signed": "signed_date",
        }
        for prefix, model_field in _date_range_fields.items():
            after = params.get(f"{prefix}_after")
            before = params.get(f"{prefix}_before")
            if after:
                d = parse_date(after)
                if d:
                    qs = qs.filter(**{f"{model_field}__gte": d})
            if before:
                d = parse_date(before)
                if d:
                    qs = qs.filter(**{f"{model_field}__lte": d})

        # ── sorting ──
        sort_by = params.get("sort_by", "created_at")
        sort_dir = params.get("sort_dir", "desc").lower()
        model_field = _SORT_FIELDS.get(sort_by, "created_at")
        order = f"-{model_field}" if sort_dir == "desc" else model_field
        qs = qs.order_by(order)

        # ── paginate ──
        page = self.paginate_queryset(qs)
        if page is not None:
            serialized = DmsDocumentListSerializer(page, many=True)
            return self.get_paginated_response(serialized.data)
        serialized = DmsDocumentListSerializer(qs, many=True)
        return Response(serialized.data)

    # ──────────────────────────────────────────────────────────────────────
    # Dropdown options — returns distinct values for each filterable field
    # GET /api/dms/documents/filter-options/
    # ──────────────────────────────────────────────────────────────────────

    @action(detail=False, methods=["get"], url_path="filter-options")
    def filter_options(self, request, *args, **kwargs):
        qs = self.get_queryset()

        def _distinct_values(field: str, limit: int = 100):
            return sorted(
                v for v in
                qs.values_list(field, flat=True).distinct()[:limit]
                if v
            )

        # Collect created_by users
        from django.contrib.auth import get_user_model
        User = get_user_model()
        creator_ids = list(qs.values_list("created_by", flat=True).distinct()[:50])
        creators = []
        if creator_ids:
            for u in User.objects.filter(id__in=[i for i in creator_ids if i]).only("id", "username", "first_name", "last_name"):
                label = f"{u.first_name} {u.last_name}".strip() or u.username
                creators.append({"id": u.id, "label": label})

        return Response({
            "statuses": _distinct_values("status"),
            "categories": _distinct_values("category"),
            "document_types": _distinct_values("document_type"),
            "authors": _distinct_values("extracted_pdf_author"),
            "signature_types": _distinct_values("signature_type"),
            "jurisdictions": _distinct_values("compliance_jurisdiction"),
            "creators": creators,
            "sort_options": [
                {"value": "created_at", "label": "Date Created"},
                {"value": "updated_at", "label": "Date Modified"},
                {"value": "uploaded_date", "label": "Upload Date"},
                {"value": "title", "label": "Title"},
                {"value": "file_size", "label": "File Size"},
                {"value": "status", "label": "Status"},
                {"value": "category", "label": "Category"},
                {"value": "document_type", "label": "Document Type"},
                {"value": "author", "label": "Author"},
                {"value": "effective_date", "label": "Effective Date"},
                {"value": "expiration_date", "label": "Expiration Date"},
            ],
        })

    # ──────────────────────────────────────────────────────────────────────
    # Metadata keys — returns distinct top-level keys from the metadata
    # JSONField across all documents + sample values for each key.
    # GET /api/dms/documents/metadata-keys/
    # ──────────────────────────────────────────────────────────────────────

    @action(detail=False, methods=["get"], url_path="metadata-keys")
    def metadata_keys(self, request, *args, **kwargs):
        qs = self.get_queryset()
        key_values: dict[str, set] = {}
        limit = 500  # scan at most N docs
        for meta in qs.values_list("metadata", flat=True)[:limit]:
            if not isinstance(meta, dict):
                continue
            for key, val in meta.items():
                if key not in key_values:
                    key_values[key] = set()
                if len(key_values[key]) >= 20:
                    continue
                if isinstance(val, list):
                    for item in val:
                        s = str(item).strip()
                        if s:
                            key_values[key].add(s)
                elif val is not None:
                    s = str(val).strip()
                    if s:
                        key_values[key].add(s)

        result = []
        for key in sorted(key_values.keys()):
            result.append({
                "key": key,
                "sample_values": sorted(key_values[key])[:20],
            })
        return Response(result)
