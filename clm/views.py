"""
CLM Views — Simplified Workflow System + AI Extraction
=======================================================
Three ViewSets: Workflow, WorkflowNode, NodeConnection
Plus: document management, AI extraction, model status, workflow execution.
"""
import csv
import hashlib
import io
import logging
import zipfile

from django.db.models import Count, Q
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from .models import (
    ActionExecution,
    ActionExecutionResult,
    ActionPlugin,
    DerivedField,
    ExtractedField,
    InputNodeHistory,
    ListenerEvent,
    NodeConnection,
    ValidatorUser,
    ValidationDecision,
    Workflow,
    WorkflowChatMessage,
    WorkflowDocument,
    WorkflowNode,
)
from .serializers import (
    ActionExecutionSerializer,
    ActionPluginSerializer,
    ActionRetrySerializer,
    BatchExtractionRequestSerializer,
    BulkValidationResolveSerializer,
    DocumentExtractionRequestSerializer,
    ExtractedFieldEditSerializer,
    ExtractedFieldSerializer,
    InputNodeHistorySerializer,
    ListenerEventSerializer,
    ListenerResolveSerializer,
    ListenerTriggerSerializer,
    MetadataEditSerializer,
    NodeConnectionSerializer,
    OrgUserSerializer,
    TextExtractionRequestSerializer,
    ValidatorUserSerializer,
    ValidationDecisionSerializer,
    ValidationResolveSerializer,
    WorkflowChatMessageSerializer,
    WorkflowChatSendSerializer,
    WorkflowDocumentSerializer,
    WorkflowDocumentUploadSerializer,
    WorkflowExecutionDetailSerializer,
    WorkflowExecutionSerializer,
    WorkflowListSerializer,
    WorkflowNodeSerializer,
    WorkflowSerializer,
)

logger = logging.getLogger(__name__)


def _get_org(request):
    """Get organization from user's profile.
    DEV fallback: if user is anonymous, auto-use malleshmayara (id=2).
    """
    user = request.user
    if not user or not user.is_authenticated:
        from django.contrib.auth.models import User
        try:
            user = User.objects.get(username='malleshmayara')
            request.user = user  # attach for downstream use
        except User.DoesNotExist:
            return None
    if hasattr(user, 'profile'):
        return user.profile.organization
    return None


# ---------------------------------------------------------------------------
# Workflow
# ---------------------------------------------------------------------------

from .dashboard_views import WorkflowDashboardMixin


class WorkflowViewSet(WorkflowDashboardMixin, viewsets.ModelViewSet):
    """
    CRUD for workflows + document upload + execute + live dashboard.
    """
    permission_classes = [permissions.AllowAny]  # DEV: allow unauthenticated
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_serializer_class(self):
        if self.action == 'list':
            return WorkflowListSerializer
        return WorkflowSerializer

    def get_queryset(self):
        org = _get_org(self.request)
        if not org:
            return Workflow.objects.none()

        qs = Workflow.objects.filter(
            organization=org,
        ).select_related('created_by', 'team').prefetch_related('nodes', 'connections', 'documents')

        # ── Optional filters (query params) ───────────────────────────
        params = self.request.query_params

        # ?is_live=true  →  only live workflows
        is_live = params.get('is_live')
        if is_live is not None:
            qs = qs.filter(is_live=is_live.lower() in ('true', '1'))

        # ?scope=my|team|org  →  ownership filter
        scope = params.get('scope', '').lower()
        user = self.request.user
        if scope == 'my' and user.is_authenticated:
            qs = qs.filter(created_by=user)
        elif scope == 'team' and user.is_authenticated:
            # Workflows assigned to any team the user belongs to
            if hasattr(user, 'profile'):
                user_team_ids = user.profile.teams.values_list('id', flat=True)
                qs = qs.filter(team_id__in=user_team_ids)
            else:
                qs = qs.none()

        # ?team=<uuid>  →  specific team
        team_id = params.get('team')
        if team_id:
            qs = qs.filter(team_id=team_id)

        return qs

    def perform_create(self, serializer):
        org = _get_org(self.request)
        serializer.save(organization=org, created_by=self.request.user)

    # -- Rebuild extraction template ----------------------------------------

    @action(detail=True, methods=['post'], url_path='rebuild-template')
    def rebuild_template(self, request, pk=None):
        """
        Re-scan all rule/AI nodes in this workflow and rebuild
        the extraction_template from their field names.
        Returns the new template + any new fields that were added.
        Note: This template is used by AI extract nodes, not NuExtract.
        """
        workflow = self.get_object()
        template, changed_fields = workflow.rebuild_extraction_template()
        return Response({
            'extraction_template': template,
            'field_count': len(template),
            'new_fields': sorted(changed_fields),
            'needs_reextraction': len(changed_fields) > 0,
        })

    # -- Upload documents ---------------------------------------------------

    # -- helpers for upload --
    KNOWN_TYPES = frozenset({
        'pdf', 'docx', 'doc', 'txt', 'csv', 'json', 'xml', 'html', 'md',
        'xlsx', 'xls', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'tif',
        'webp', 'svg', 'rtf', 'odt', 'pptx', 'ppt', 'htm',
    })

    @staticmethod
    def _ext_and_type(filename):
        ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
        return ext, (ext if ext in WorkflowViewSet.KNOWN_TYPES else 'other')

    @staticmethod
    def _expand_zip(upload_file):
        """
        If *upload_file* is a ZIP archive, extract every non-hidden file
        inside and return a list of (filename, ContentFile) tuples.
        Returns an empty list if the file is not a valid ZIP.
        """
        import zipfile
        from django.core.files.base import ContentFile

        upload_file.seek(0)
        if not zipfile.is_zipfile(upload_file):
            return []
        upload_file.seek(0)

        extracted = []
        with zipfile.ZipFile(upload_file, 'r') as zf:
            for info in zf.infolist():
                # skip directories, hidden/system files, __MACOSX, etc.
                if info.is_dir():
                    continue
                basename = info.filename.split('/')[-1]
                if not basename or basename.startswith('.') or basename.startswith('__'):
                    continue
                data = zf.read(info.filename)
                cf = ContentFile(data, name=basename)
                cf.size = len(data)          # ContentFile doesn't set .size automatically
                extracted.append((basename, cf))
        return extracted

    @action(detail=True, methods=['post'], url_path='upload')
    def upload_documents(self, request, pk=None):
        """
        Upload one or more documents (or ZIP archives) to this workflow.
        Accepts multipart form: files[], title (optional).
        ZIP files are automatically extracted — each file inside becomes
        a separate WorkflowDocument.
        Documents are marked as 'completed' immediately — metadata
        extraction is handled by dedicated extract (AI) nodes in the
        workflow, not at upload time.
        """
        workflow = self.get_object()
        org = _get_org(request)
        raw_files = request.FILES.getlist('files') or [request.FILES.get('file')]
        raw_files = [f for f in raw_files if f]

        if not raw_files:
            return Response(
                {'error': 'No files provided.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Expand ZIPs into individual files ─────────────────────────────
        files = []          # list of (display_name, file_obj)
        zip_count = 0       # how many ZIPs were expanded
        zip_file_count = 0  # total files extracted from ZIPs

        for f in raw_files:
            ext, _ = self._ext_and_type(f.name)
            if ext == 'zip':
                inner = self._expand_zip(f)
                if inner:
                    zip_count += 1
                    zip_file_count += len(inner)
                    files.extend(inner)
                    continue
            # Regular file (or a zip that couldn't be read → upload as-is)
            files.append((f.name, f))

        if not files:
            return Response(
                {'error': 'ZIP archive was empty or contained no valid files.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Determine input node for this upload
        input_node_id = request.data.get('input_node_id')
        input_node_obj = None
        if input_node_id:
            try:
                input_node_obj = workflow.nodes.get(id=input_node_id, node_type='input')
            except WorkflowNode.DoesNotExist:
                pass
        created = []
        skipped_dupes = []

        for name, fobj in files:
            _, file_type = self._ext_and_type(name)

            # ── SHA-256 content hash for dedup ────────────────────────────
            hasher = hashlib.sha256()
            fobj.seek(0)
            for chunk in fobj.chunks():
                hasher.update(chunk)
            file_hash = hasher.hexdigest()
            fobj.seek(0)  # reset for FileField save

            # Check for duplicate within this workflow
            existing = workflow.documents.filter(file_hash=file_hash).first()
            if existing:
                skipped_dupes.append({
                    'title': name,
                    'duplicate_of': str(existing.id),
                    'duplicate_title': existing.title,
                    'file_hash': file_hash,
                })
                continue

            # ── Input plugin: pre-ingest hook ─────────────────────────
            global_meta = {'_source': 'upload', '_file_hash': file_hash}
            if input_node_obj:
                try:
                    from .input_plugins.pipeline import run_pre_ingest
                    pre_result = run_pre_ingest(
                        node=input_node_obj,
                        file_name=name,
                        file_size=getattr(fobj, 'size', 0) or 0,
                        file_type=file_type,
                        metadata=global_meta,
                    )
                    if pre_result.rejected:
                        skipped_dupes.append({
                            'title': name,
                            'rejected_by_plugin': True,
                            'reason': pre_result.reject_reason,
                        })
                        continue
                except Exception as e:
                    logger.debug(f"Input plugin pre-ingest error (non-fatal): {e}")

            doc = WorkflowDocument.objects.create(
                workflow=workflow,
                organization=org,
                title=name,
                file=fobj,
                file_type=file_type,
                file_size=getattr(fobj, 'size', 0) or 0,
                file_hash=file_hash,
                uploaded_by=request.user,
                input_node=input_node_obj,
                global_metadata=global_meta,
            )

            # Mark as completed — extraction is handled by dedicated
            # extract (AI) nodes in the workflow, not at upload time.
            doc.extraction_status = 'completed'
            doc.save(update_fields=['extraction_status'])

            # ── Input plugin: post-pipeline hooks ─────────────────────
            if input_node_obj and doc.extraction_status == 'completed':
                try:
                    from .input_plugins.pipeline import run_post_pipeline
                    run_post_pipeline(node=input_node_obj, document=doc)
                except Exception as e:
                    logger.debug(f"Input plugin post-pipeline error (non-fatal): {e}")

            created.append(doc)

        # ── Input plugin: batch-complete hook ─────────────────────────
        if input_node_obj and created:
            try:
                from .input_plugins.pipeline import run_batch_complete
                run_batch_complete(
                    node=input_node_obj,
                    documents=created,
                    stats={
                        'total': len(files),
                        'ready': len(created),
                        'rejected': len(skipped_dupes),
                        'failed': sum(1 for d in created if d.extraction_status == 'failed'),
                        'issues': 0,
                    },
                )
            except Exception as e:
                logger.debug(f"Input plugin batch-complete error (non-fatal): {e}")

        # Auto-execute workflow if enabled
        auto_result = None
        if workflow.auto_execute_on_upload and created:
            from .node_executor import execute_workflow
            try:
                auto_result = execute_workflow(
                    workflow,
                    triggered_by=request.user,
                    single_document_ids=[str(d.id) for d in created],
                    mode='auto',
                )
            except Exception as e:
                logger.error(f"Auto-execute failed for workflow {workflow.id}: {e}")

        response_data = WorkflowDocumentSerializer(created, many=True).data
        result = {
            'documents': response_data,
            'count': len(created),
        }
        if skipped_dupes:
            result['duplicates_skipped'] = skipped_dupes
        if zip_count:
            result['zip_expanded'] = {
                'archives': zip_count,
                'files_extracted': zip_file_count,
            }
        if auto_result:
            result['auto_execution'] = auto_result

        # Record input history for the upload operation
        if created and input_node_obj:
            from .models import InputNodeHistory
            source_type = 'bulk_upload' if len(created) > 5 else 'upload'
            InputNodeHistory.objects.create(
                workflow=workflow,
                node=input_node_obj,
                organization=org,
                source_type=source_type,
                status='completed',
                document_count=len(created),
                skipped_count=len(skipped_dupes),
                document_ids=[str(d.id) for d in created],
                source_reference={
                    'file_names': [name for name, _ in files],
                },
                details={
                    'duplicates_skipped': skipped_dupes,
                    'zip_expanded': {
                        'archives': zip_count,
                        'files_extracted': zip_file_count,
                    } if zip_count else None,
                },
                triggered_by=request.user if request.user.is_authenticated else None,
            )

        # Sync document_state on the input node so executor reads from it
        if input_node_obj:
            input_node_obj.sync_document_state()

        # ── Upload-triggered execution: only when auto_execute_on_upload is
        # explicitly enabled on this workflow.  Live workflows (is_live=True)
        # are NOT triggered here — Celery Beat's dispatch_live_workflows task
        # is the sole authority for periodic live execution.  This prevents
        # the frontend from causing duplicate/inconsistent executions.
        if created and workflow.auto_execute_on_upload and workflow.compilation_status == 'compiled':
            logger.info(
                '[upload] auto_execute_on_upload trigger: workflow=%s (%s) compiled=%s docs=%d',
                workflow.name, workflow.id, workflow.compilation_status, len(created),
            )
            try:
                from .event_system import dispatch_event
                dispatch_result = dispatch_event(
                    event_type='file_uploaded',
                    source_type='upload',
                    source_id='',  # upload subs have empty source_id
                    payload={
                        'workflow_id': str(workflow.id),
                        'document_ids': [str(d.id) for d in created],
                        'count': len(created),
                        'uploaded_by': request.user.username if request.user.is_authenticated else None,
                    },
                    organization_id=str(org.id) if org else None,
                )
                if dispatch_result.get('dispatched'):
                    logger.info('[upload] dispatch_event returned: dispatched=%d', dispatch_result['dispatched'])
                    result['auto_execute'] = {
                        'dispatched': dispatch_result['dispatched'],
                        'execution_ids': [
                            e.get('execution_id') for e in dispatch_result.get('events', [])
                        ],
                    }
                else:
                    logger.debug('[upload] dispatch_event returned no dispatches: %s', dispatch_result)
            except Exception as e:
                logger.warning('[upload] auto_execute dispatch after upload failed: %s', e)
        elif created and workflow.is_live:
            # Live workflows: new docs are picked up by Celery Beat on the
            # next tick (dispatch_live_workflows runs every 60s).  Just log.
            logger.info(
                '[upload] Live workflow %s (%s) — %d docs uploaded, '
                'Celery Beat will pick them up on next tick (interval=%ds)',
                workflow.name, workflow.id, len(created), workflow.live_interval,
            )

        return Response(result, status=status.HTTP_201_CREATED)

    # -- Table upload (spreadsheet → row documents) -------------------------

    @action(detail=True, methods=['post'], url_path='table-upload')
    def table_upload(self, request, pk=None):
        """
        Upload a spreadsheet / CSV / TSV / image/PDF table and convert each
        row into a WorkflowDocument with columns as metadata fields.

        POST /api/clm/workflows/{id}/table-upload/
        Form data:
          file           — the table file (xlsx, xls, csv, tsv, ods, pdf, png, jpg)
          input_node_id  — (optional) UUID of the input node
          sheet_name     — (optional) specific sheet tab name for Excel/ODS
          google_sheet_url — (optional) URL of a public Google Sheet (instead of file upload)
          ai_extract     — (optional) "true" to use AI vision for PDF/image tables (default: true)

        Each row becomes a WorkflowDocument:
          - title = value from name/title column or "Row N"
          - extracted_metadata = { column_name: value, ... }
          - global_metadata = same + _source='table', _row_number=N
          - extraction_status = 'completed'
          - file_hash = SHA-256 of row JSON (dedup)

        Returns: {
            documents: [...],
            count: N,
            headers: ['col_a', 'col_b', ...],
            original_headers: ['Col A', 'Col B', ...],
            row_count: N,
            col_count: M,
            parse_method: 'csv' | 'xlsx' | 'ai_vision' | ...
        }
        """
        from .table_parser import parse_table_file, rows_to_workflow_documents

        workflow = self.get_object()
        org = _get_org(request)

        google_url = request.data.get('google_sheet_url', '').strip()
        uploaded_file = request.FILES.get('file')
        sheet_name = request.data.get('sheet_name', None)
        ai_extract = str(request.data.get('ai_extract', 'true')).lower() == 'true'

        if not uploaded_file and not google_url:
            return Response(
                {'error': 'Provide a file or google_sheet_url.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Determine input node
        input_node_id = request.data.get('input_node_id')
        input_node_obj = None
        if input_node_id:
            try:
                input_node_obj = workflow.nodes.get(id=input_node_id, node_type='input')
            except WorkflowNode.DoesNotExist:
                pass

        try:
            if google_url:
                parsed = parse_table_file(
                    file_bytes=b'',
                    filename='',
                    google_sheet_url=google_url,
                )
            else:
                file_bytes = uploaded_file.read()
                parsed = parse_table_file(
                    file_bytes=file_bytes,
                    filename=uploaded_file.name,
                    sheet_name=sheet_name,
                    ai_extract=ai_extract,
                )
        except Exception as e:
            return Response(
                {'error': f'Table parsing failed: {e}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if parsed['row_count'] == 0:
            return Response(
                {'error': 'No data rows found in the file.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Create WorkflowDocuments from rows
        docs = rows_to_workflow_documents(
            parsed=parsed,
            workflow=workflow,
            organization=org,
            input_node=input_node_obj,
            user=request.user,
        )

        # Store table metadata on the input node config for reference
        if input_node_obj:
            config = input_node_obj.config or {}
            config['table_info'] = {
                'headers': parsed['headers'],
                'original_headers': parsed.get('original_headers', parsed['headers']),
                'row_count': parsed['row_count'],
                'col_count': parsed['col_count'],
                'parse_method': parsed.get('parse_method', 'unknown'),
                'file_name': uploaded_file.name if uploaded_file else google_url,
            }
            input_node_obj.config = config
            input_node_obj.save(update_fields=['config'])

        # Record input history for table upload
        if docs and input_node_obj:
            from .models import InputNodeHistory
            InputNodeHistory.objects.create(
                workflow=workflow,
                node=input_node_obj,
                organization=org,
                source_type='table',
                status='completed',
                document_count=len(docs),
                document_ids=[str(d.id) for d in docs],
                source_reference={
                    'file_name': uploaded_file.name if uploaded_file else google_url,
                    'headers': parsed['headers'],
                    'parse_method': parsed.get('parse_method', 'unknown'),
                },
                triggered_by=request.user if request.user.is_authenticated else None,
            )

        return Response({
            'documents': WorkflowDocumentSerializer(docs, many=True).data,
            'count': len(docs),
            'headers': parsed['headers'],
            'original_headers': parsed.get('original_headers', parsed['headers']),
            'row_count': parsed['row_count'],
            'col_count': parsed['col_count'],
            'parse_method': parsed.get('parse_method', 'unknown'),
        }, status=status.HTTP_201_CREATED)

    # -- Table preview (parse without creating documents) -------------------

    @action(detail=True, methods=['post'], url_path='table-preview')
    def table_preview(self, request, pk=None):
        """
        Preview a table file without creating documents.
        Returns headers + first 10 rows for column mapping preview.

        POST /api/clm/workflows/{id}/table-preview/
        Same params as table-upload.
        """
        from .table_parser import parse_table_file

        self.get_object()  # permission check

        google_url = request.data.get('google_sheet_url', '').strip()
        uploaded_file = request.FILES.get('file')
        sheet_name = request.data.get('sheet_name', None)
        ai_extract = str(request.data.get('ai_extract', 'true')).lower() == 'true'

        if not uploaded_file and not google_url:
            return Response(
                {'error': 'Provide a file or google_sheet_url.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            if google_url:
                parsed = parse_table_file(
                    file_bytes=b'',
                    filename='',
                    google_sheet_url=google_url,
                )
            else:
                file_bytes = uploaded_file.read()
                parsed = parse_table_file(
                    file_bytes=file_bytes,
                    filename=uploaded_file.name,
                    sheet_name=sheet_name,
                    ai_extract=ai_extract,
                )
        except Exception as e:
            return Response(
                {'error': f'Table parsing failed: {e}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response({
            'headers': parsed['headers'],
            'original_headers': parsed.get('original_headers', parsed['headers']),
            'preview_rows': parsed['rows'][:10],
            'row_count': parsed['row_count'],
            'col_count': parsed['col_count'],
            'parse_method': parsed.get('parse_method', 'unknown'),
            'sheet_names': parsed.get('sheet_names'),
            'active_sheet': parsed.get('active_sheet'),
        })

    # -- List documents -----------------------------------------------------

    @action(detail=True, methods=['get'], url_path='documents')
    def list_documents(self, request, pk=None):
        """List all documents uploaded to this workflow."""
        workflow = self.get_object()
        docs = workflow.documents.all()

        extraction_status = request.query_params.get('status')
        if extraction_status:
            docs = docs.filter(extraction_status=extraction_status)

        return Response(WorkflowDocumentSerializer(docs, many=True).data)

    # -- Document detail (single document with full metadata) ---------------

    @action(detail=True, methods=['get'], url_path='document-detail/(?P<doc_id>[0-9a-f-]+)')
    def document_detail(self, request, pk=None, doc_id=None):
        """
        Full detail for a single document — metadata, fields, confidence, text stats,
        plus last execution journey (per-node pass/fail).
        GET /api/clm/workflows/{id}/document-detail/{doc_id}/
        """
        from .models import WorkflowExecution

        workflow = self.get_object()
        try:
            doc = workflow.documents.get(id=doc_id)
        except WorkflowDocument.DoesNotExist:
            return Response({'error': 'Document not found.'}, status=status.HTTP_404_NOT_FOUND)

        fields = doc.extracted_fields.all()
        global_fields = fields.filter(source='global')
        workflow_fields = fields.filter(source='workflow')

        # Build journey from latest execution
        journey_data = None
        execution = WorkflowExecution.objects.filter(
            workflow=workflow, status__in=['completed', 'partial'],
        ).order_by('-started_at').first()

        if execution and execution.result_data:
            result_data = execution.result_data
            node_results = result_data.get('node_results', [])
            doc_id_str = str(doc_id)
            journey_steps = []

            for nr in node_results:
                doc_ids_in_node = nr.get('document_ids', [])
                passed = doc_id_str in doc_ids_in_node
                step = {
                    'node_id': nr.get('node_id', ''),
                    'node_type': nr.get('node_type', ''),
                    'label': nr.get('label', ''),
                    'passed': passed,
                    'total_docs': nr.get('count', len(doc_ids_in_node)),
                }
                # AI result for this doc
                ai_data = nr.get('ai')
                if ai_data and ai_data.get('results'):
                    for r in ai_data['results']:
                        if str(r.get('document_id', '')) == doc_id_str:
                            step['ai_result'] = {
                                'status': r.get('status', ''),
                                'model': ai_data.get('model', ''),
                                'output_format': r.get('output_format', ai_data.get('output_format', '')),
                                'response': r.get('response', ''),
                                'parsed_fields': r.get('parsed_fields'),
                                'answer': r.get('answer'),
                            }
                            break
                # Action result for this doc
                action_data = nr.get('action')
                if action_data and action_data.get('results'):
                    for r in action_data['results']:
                        if str(r.get('document_id', '')) == doc_id_str:
                            step['action_result'] = {
                                'status': r.get('status', ''),
                                'plugin': action_data.get('plugin', ''),
                            }
                            break
                journey_steps.append(step)

            output_doc_ids = result_data.get('output_documents', [])
            output_ids_flat = [str(d.get('id', '')) for d in output_doc_ids] if isinstance(output_doc_ids, list) and output_doc_ids and isinstance(output_doc_ids[0], dict) else [str(d) for d in output_doc_ids]

            journey_data = {
                'execution_id': str(execution.id),
                'execution_status': execution.status,
                'executed_at': execution.started_at.isoformat() if execution.started_at else None,
                'reached_output': doc_id_str in output_ids_flat,
                'steps': journey_steps,
            }

        return Response({
            'document': WorkflowDocumentSerializer(doc).data,
            'fields': {
                'global': ExtractedFieldSerializer(global_fields, many=True).data,
                'workflow': ExtractedFieldSerializer(workflow_fields, many=True).data,
                'total_count': fields.count(),
            },
            'text_stats': {
                'direct_text_length': len(doc.direct_text or ''),
                'ocr_text_length': len(doc.ocr_text or ''),
                'text_source': doc.text_source,
            },
            'ocr_metadata': doc.ocr_metadata or {},
            'journey': journey_data,
        })

    # -- AI: Extract single document (legacy — use reextract instead) -------

    @action(detail=True, methods=['post'], url_path='extract-document')
    def extract_document(self, request, pk=None):
        """
        Re-extract metadata for a single document in this workflow.
        POST { "document_id": "uuid", "template": {...} (optional) }
        Note: Extraction is now handled by AI extract nodes. This endpoint
        is kept for backward compatibility but delegates to ai_inference.
        """
        from .ai_inference import extract_document as run_extraction

        workflow = self.get_object()
        ser = DocumentExtractionRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        doc_id = ser.validated_data['document_id']
        template = ser.validated_data.get('template') or workflow.extraction_template

        if not template:
            workflow.rebuild_extraction_template()
            template = workflow.extraction_template

        try:
            doc = workflow.documents.get(id=doc_id)
        except WorkflowDocument.DoesNotExist:
            return Response(
                {'error': 'Document not found in this workflow.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        result = run_extraction(doc, template)
        doc.refresh_from_db()

        return Response({
            'document': WorkflowDocumentSerializer(doc).data,
            'extraction': result,
        })

    # -- AI: Batch extract (legacy — use reextract-all instead) -------------

    @action(detail=True, methods=['post'], url_path='extract-all')
    def extract_all(self, request, pk=None):
        """
        Re-extract metadata for multiple (or all pending/failed) documents.
        POST { "document_ids": ["uuid", ...] (optional), "template": {...} (optional) }
        Note: Extraction is now handled by AI extract nodes.
        """
        from .ai_inference import extract_document as run_extraction

        workflow = self.get_object()
        ser = BatchExtractionRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        template = ser.validated_data.get('template') or workflow.extraction_template
        if not template:
            workflow.rebuild_extraction_template()
            template = workflow.extraction_template

        doc_ids = ser.validated_data.get('document_ids')
        if doc_ids:
            docs = workflow.documents.filter(id__in=doc_ids)
        else:
            docs = workflow.documents.filter(
                extraction_status__in=['pending', 'failed'],
            )

        results = []
        for doc in docs:
            try:
                result = run_extraction(doc, template)
                results.append({
                    'document_id': str(doc.id),
                    'title': doc.title,
                    'status': 'completed',
                    'overall_confidence': result.get('overall_confidence', 0),
                })
            except Exception as e:
                logger.error(f"Batch extraction failed for {doc.id}: {e}")
                results.append({
                    'document_id': str(doc.id),
                    'title': doc.title,
                    'status': 'failed',
                    'error': str(e),
                })

        return Response({
            'processed': len(results),
            'results': results,
        })

    # -- AI: Extract from raw text ------------------------------------------

    @action(detail=True, methods=['post'], url_path='extract-text')
    def extract_text(self, request, pk=None):
        """
        Extract metadata from raw text (no file upload needed).
        Useful for testing templates or pasting contract snippets.
        POST { "text": "...", "template": {...} }
        """
        from .ai_inference import extract_from_text

        self.get_object()  # permission check
        ser = TextExtractionRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        text = ser.validated_data['text']
        template = ser.validated_data['template']

        result = extract_from_text(text, template)
        return Response(result)

    # -- AI: Edit document metadata -----------------------------------------

    @action(detail=True, methods=['patch'], url_path='edit-metadata/(?P<doc_id>[0-9a-f-]+)')
    def edit_metadata(self, request, pk=None, doc_id=None):
        """
        Manually edit/override a document's extracted metadata and/or global metadata.
        PATCH { "extracted_metadata": {...}, "global_metadata": {...} }
        Merges with existing metadata in each category.
        Also updates the corresponding ExtractedField rows.
        """
        workflow = self.get_object()
        ser = MetadataEditSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        try:
            doc = workflow.documents.get(id=doc_id)
        except WorkflowDocument.DoesNotExist:
            return Response(
                {'error': 'Document not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        update_fields = ['updated_at']

        # Merge workflow-specific metadata
        if ser.validated_data.get('extracted_metadata'):
            existing = doc.extracted_metadata or {}
            existing.update(ser.validated_data['extracted_metadata'])
            doc.extracted_metadata = existing
            update_fields.append('extracted_metadata')

            # Update ExtractedField rows
            for field_name, value in ser.validated_data['extracted_metadata'].items():
                ExtractedField.objects.update_or_create(
                    document=doc, field_name=field_name, source='workflow',
                    defaults={
                        'workflow': workflow,
                        'organization': doc.organization,
                        'standardized_value': str(value) if value else '',
                        'display_value': str(value) if value else '',
                        'is_manually_edited': True,
                    },
                )

        # Merge global metadata
        if ser.validated_data.get('global_metadata'):
            existing_global = doc.global_metadata or {}
            existing_global.update(ser.validated_data['global_metadata'])
            doc.global_metadata = existing_global
            update_fields.append('global_metadata')

            for field_name, value in ser.validated_data['global_metadata'].items():
                ExtractedField.objects.update_or_create(
                    document=doc, field_name=field_name, source='global',
                    defaults={
                        'workflow': workflow,
                        'organization': doc.organization,
                        'standardized_value': str(value) if value else '',
                        'display_value': str(value) if value else '',
                        'is_manually_edited': True,
                    },
                )

        doc.save(update_fields=update_fields)
        return Response(WorkflowDocumentSerializer(doc).data)

    # -- Delete document ----------------------------------------------------

    @action(detail=True, methods=['delete'], url_path='delete-document/(?P<doc_id>[0-9a-f-]+)')
    def delete_document(self, request, pk=None, doc_id=None):
        """
        Delete a single document from this workflow.
        Cascades: removes file, extracted fields, and all metadata.
        """
        workflow = self.get_object()
        try:
            doc = workflow.documents.get(id=doc_id)
        except WorkflowDocument.DoesNotExist:
            return Response(
                {'error': 'Document not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        title = doc.title
        input_node_obj = doc.input_node
        # Delete the physical file
        if doc.file:
            try:
                doc.file.delete(save=False)
            except Exception:
                pass

        doc.delete()  # Cascade deletes ExtractedField rows

        # Sync document_state on the owning input node
        if input_node_obj:
            input_node_obj.sync_document_state()

        return Response({
            'deleted': True,
            'document_id': str(doc_id),
            'title': title,
        })

    # -- Re-extract single document -----------------------------------------

    @action(detail=True, methods=['post'], url_path='reextract/(?P<doc_id>[0-9a-f-]+)')
    def reextract_document(self, request, pk=None, doc_id=None):
        """
        Re-extract metadata for a single document (re-runs text extraction + AI).
        POST /api/clm/workflows/{id}/reextract/{doc_id}/
        Optionally accepts { "template": {...} } to override template.
        """
        from .ai_inference import extract_document as run_extraction

        workflow = self.get_object()

        # Ensure template is fresh
        if not workflow.extraction_template:
            workflow.rebuild_extraction_template()

        template = workflow.extraction_template

        # Allow template override from request body
        if request.data.get('template'):
            template = request.data['template']

        try:
            doc = workflow.documents.get(id=doc_id)
        except WorkflowDocument.DoesNotExist:
            return Response(
                {'error': 'Document not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Reset status
        doc.extraction_status = 'pending'
        doc.save(update_fields=['extraction_status'])

        result = run_extraction(doc, template)
        doc.refresh_from_db()

        # Sync document_state on the owning input node
        if doc.input_node:
            doc.input_node.sync_document_state()

        return Response({
            'document': WorkflowDocumentSerializer(doc).data,
            'extraction': result,
        })

    # -- Re-extract all documents -------------------------------------------

    @action(detail=True, methods=['post'], url_path='reextract-all')
    def reextract_all(self, request, pk=None):
        """
        Re-extract metadata for all documents (or specific ones) in this workflow.
        POST { "document_ids": ["uuid",...] (optional), "status_filter": "failed" (optional) }
        """
        from .ai_inference import extract_document as run_extraction

        workflow = self.get_object()
        if not workflow.extraction_template:
            workflow.rebuild_extraction_template()

        template = workflow.extraction_template

        doc_ids = request.data.get('document_ids')
        status_filter = request.data.get('status_filter')

        docs = workflow.documents.all()
        if doc_ids:
            docs = docs.filter(id__in=doc_ids)
        elif status_filter:
            docs = docs.filter(extraction_status=status_filter)

        results = []
        affected_nodes = set()
        for doc in docs:
            if doc.input_node_id:
                affected_nodes.add(doc.input_node_id)
            try:
                result = run_extraction(doc, template)
                results.append({
                    'document_id': str(doc.id),
                    'title': doc.title,
                    'status': 'completed',
                    'text_source': result.get('text_source', ''),
                    'overall_confidence': result.get('overall_confidence', 0),
                })
            except Exception as e:
                logger.error(f"Re-extraction failed for {doc.id}: {e}")
                results.append({
                    'document_id': str(doc.id),
                    'title': doc.title,
                    'status': 'failed',
                    'error': str(e),
                })

        # Sync document_state on all affected input nodes
        for nid in affected_nodes:
            try:
                node_obj = WorkflowNode.objects.get(id=nid)
                node_obj.sync_document_state()
            except WorkflowNode.DoesNotExist:
                pass

        return Response({
            'processed': len(results),
            'results': results,
        })

    # -- AI Field Discovery — Gemini analyses docs to choose extraction fields

    @action(detail=True, methods=['post'], url_path='discover-fields/(?P<doc_id>[0-9a-f-]+)')
    def discover_fields(self, request, pk=None, doc_id=None):
        """
        Use Gemini AI to analyse a document and suggest optimal extraction fields.
        Returns the recommended fields + batches for use with extract nodes.
        POST /api/clm/workflows/{id}/discover-fields/{doc_id}/
        """
        from .ai_inference import discover_fields as run_discovery

        workflow = self.get_object()
        try:
            doc = workflow.documents.get(id=doc_id)
        except WorkflowDocument.DoesNotExist:
            return Response({'error': 'Document not found.'}, status=status.HTTP_404_NOT_FOUND)

        # Need text — extract if not already done
        text = doc.original_text or ''
        if not text.strip():
            from .ocr_extraction import extract_all
            try:
                ocr_result = extract_all(doc.file, doc.file_type)
                text = ocr_result['best_text']
                doc.direct_text = ocr_result['direct_text']
                doc.ocr_text = ocr_result['ocr_text']
                doc.text_source = ocr_result['text_source']
                doc.original_text = text
                doc.ocr_metadata = ocr_result['metadata']
                doc.save(update_fields=[
                    'direct_text', 'ocr_text', 'text_source',
                    'original_text', 'ocr_metadata',
                ])
            except Exception as e:
                return Response({'error': f'Text extraction failed: {e}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        if not text.strip():
            return Response({'error': 'No text could be extracted from this document.'}, status=status.HTTP_400_BAD_REQUEST)

        result = run_discovery(text)

        return Response({
            'document_id': str(doc.id),
            'title': doc.title,
            'discovery': result,
        })

    @action(detail=True, methods=['post'], url_path='smart-extract/(?P<doc_id>[0-9a-f-]+)')
    def smart_extract_document(self, request, pk=None, doc_id=None):
        """
        AI-powered extraction: Gemini analyses the document to choose optimal
        fields, then AI extracts values using those fields.
        POST /api/clm/workflows/{id}/smart-extract/{doc_id}/
        """
        from .ai_inference import extract_document as run_extraction

        workflow = self.get_object()
        try:
            doc = workflow.documents.get(id=doc_id)
        except WorkflowDocument.DoesNotExist:
            return Response({'error': 'Document not found.'}, status=status.HTTP_404_NOT_FOUND)

        if not workflow.extraction_template:
            workflow.rebuild_extraction_template()
        template = workflow.extraction_template

        doc.extraction_status = 'pending'
        doc.save(update_fields=['extraction_status'])

        try:
            result = run_extraction(
                doc, template,
                ai_discover=True,
            )
        except Exception as e:
            logger.error(f"Smart extraction failed for {doc.id}: {e}")
            doc.extraction_status = 'failed'
            doc.save(update_fields=['extraction_status'])
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        doc.refresh_from_db()
        return Response({
            'document': WorkflowDocumentSerializer(doc).data,
            'extraction': result,
        })

    @action(detail=True, methods=['post'], url_path='smart-extract-all')
    def smart_extract_all(self, request, pk=None):
        """
        AI-powered extraction for all (or selected) documents in the workflow.
        POST { "document_ids": ["uuid",...] (optional) }
        Each document gets its own AI field discovery → extraction pipeline.
        """
        from .ai_inference import extract_document as run_extraction

        workflow = self.get_object()
        if not workflow.extraction_template:
            workflow.rebuild_extraction_template()
        template = workflow.extraction_template

        doc_ids = request.data.get('document_ids')
        docs = workflow.documents.all()
        if doc_ids:
            docs = docs.filter(id__in=doc_ids)

        results = []
        for doc in docs:
            try:
                result = run_extraction(
                    doc, template,
                    ai_discover=True,
                )
                results.append({
                    'document_id': str(doc.id),
                    'title': doc.title,
                    'status': 'completed',
                    'overall_confidence': result.get('overall_confidence', 0),
                    'ai_discovery': result.get('ai_discovery', {}),
                })
            except Exception as e:
                logger.error(f"Smart extraction failed for {doc.id}: {e}")
                results.append({
                    'document_id': str(doc.id),
                    'title': doc.title,
                    'status': 'failed',
                    'error': str(e),
                })

        return Response({
            'processed': len(results),
            'results': results,
        })

    # -- Document fields (individual rows) ----------------------------------

    @action(detail=True, methods=['get'], url_path='document-fields/(?P<doc_id>[0-9a-f-]+)')
    def document_fields(self, request, pk=None, doc_id=None):
        """
        Get all individual ExtractedField rows for a document.
        GET /api/clm/workflows/{id}/document-fields/{doc_id}/
        Optional query params: ?source=global|workflow
        """
        workflow = self.get_object()
        try:
            doc = workflow.documents.get(id=doc_id)
        except WorkflowDocument.DoesNotExist:
            return Response(
                {'error': 'Document not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        fields = doc.extracted_fields.all()
        source = request.query_params.get('source')
        if source in ('global', 'workflow'):
            fields = fields.filter(source=source)

        return Response({
            'document_id': str(doc.id),
            'document_title': doc.title,
            'text_source': doc.text_source,
            'extraction_status': doc.extraction_status,
            'fields': ExtractedFieldSerializer(fields, many=True).data,
        })

    # -- Edit single extracted field ----------------------------------------

    @action(
        detail=True, methods=['patch'],
        url_path='edit-field/(?P<field_id>[0-9a-f-]+)',
    )
    def edit_field(self, request, pk=None, field_id=None):
        """
        Edit a single ExtractedField value (manual override).
        PATCH { "standardized_value": "...", "display_value": "..." }
        Also syncs the change back to the document's JSON metadata.
        """
        workflow = self.get_object()
        try:
            field = ExtractedField.objects.get(
                id=field_id, workflow=workflow,
            )
        except ExtractedField.DoesNotExist:
            return Response(
                {'error': 'Field not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        ser = ExtractedFieldEditSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        if 'standardized_value' in ser.validated_data:
            field.standardized_value = ser.validated_data['standardized_value']
        if 'display_value' in ser.validated_data:
            field.display_value = ser.validated_data['display_value']
        field.is_manually_edited = True
        field.save()

        # Sync back to document JSON
        doc = field.document
        if field.source == 'global':
            meta = doc.global_metadata or {}
            meta[field.field_name] = field.standardized_value
            doc.global_metadata = meta
            doc.save(update_fields=['global_metadata', 'updated_at'])
        else:
            meta = doc.extracted_metadata or {}
            meta[field.field_name] = field.standardized_value
            doc.extracted_metadata = meta
            doc.save(update_fields=['extracted_metadata', 'updated_at'])

        return Response(ExtractedFieldSerializer(field).data)

    # -- Field names dropdown (unique field names across workflow) -----------

    @action(detail=True, methods=['get'], url_path='field-options')
    def field_options(self, request, pk=None):
        """
        Get unique field names and their distinct values across all
        documents in this workflow. Used for frontend dropdown options
        in rule-node configuration.

        GET /api/clm/workflows/{id}/field-options/
        Optional: ?source=global|workflow

        Returns:
        {
          "field_names": ["contract_value", "party_1_name", ...],
          "field_values": {
            "party_1_name": ["Acme Corp", "TechServ LLC", ...],
            "contract_value": ["25000.00", "50000", ...],
            ...
          },
          "global_fields": ["document_title", "party_1_name", ...],
        }
        """
        workflow = self.get_object()

        fields_qs = ExtractedField.objects.filter(workflow=workflow)
        source = request.query_params.get('source')
        if source in ('global', 'workflow'):
            fields_qs = fields_qs.filter(source=source)

        # Unique field names
        field_names = sorted(
            fields_qs.values_list('field_name', flat=True).distinct()
        )

        # Distinct values per field name (non-empty only)
        field_values = {}
        for fn in field_names:
            values = list(
                fields_qs.filter(field_name=fn)
                .exclude(standardized_value='')
                .values_list('standardized_value', flat=True)
                .distinct()[:50]
            )
            if values:
                field_values[fn] = values

        # Also provide the global template field names for reference
        from .ai_inference import GLOBAL_CLM_TEMPLATE
        global_fields = sorted(GLOBAL_CLM_TEMPLATE.keys())

        # Collect AI node output fields — these are available as metadata
        # fields in downstream rule nodes after execution
        ai_node_fields = set()
        for node in workflow.nodes.filter(node_type='ai'):
            config = node.config or {}
            if config.get('output_format') == 'json_extract':
                for jf in config.get('json_fields', []):
                    name = jf.get('name', '').strip()
                    if name:
                        ai_node_fields.add(name)
            output_key = config.get('output_key', '').strip()
            if output_key:
                ai_node_fields.add(output_key)
        ai_fields_list = sorted(ai_node_fields)

        # Also scan extracted_metadata across documents for any AI-produced
        # fields that are already populated (from prior execution runs)
        ai_extracted_fields = set()
        for doc in workflow.documents.all():
            meta = doc.extracted_metadata or {}
            for key in meta:
                if key not in field_names and key not in global_fields:
                    ai_extracted_fields.add(key)

        # Merge all into the field_names list so rule dropdowns show them
        all_field_names = sorted(
            set(field_names) | set(global_fields) | ai_node_fields | ai_extracted_fields
        )

        return Response({
            'field_names': all_field_names,
            'field_values': field_values,
            'global_fields': global_fields,
            'ai_node_fields': ai_fields_list,
            'total_fields': len(all_field_names),
            'total_documents': workflow.documents.count(),
        })

    # -- Document summary ---------------------------------------------------

    @action(detail=True, methods=['get'], url_path='document-summary')
    def document_summary(self, request, pk=None):
        """
        Summary of all documents with extraction stats.
        GET /api/clm/workflows/{id}/document-summary/
        """
        workflow = self.get_object()
        docs = workflow.documents.all()

        summary = []
        for doc in docs:
            global_count = doc.extracted_fields.filter(source='global').count()
            workflow_count = doc.extracted_fields.filter(source='workflow').count()
            summary.append({
                'document_id': str(doc.id),
                'title': doc.title,
                'file_type': doc.file_type,
                'file_size': doc.file_size,
                'extraction_status': doc.extraction_status,
                'text_source': doc.text_source,
                'direct_text_length': len(doc.direct_text),
                'ocr_text_length': len(doc.ocr_text),
                'global_field_count': global_count,
                'workflow_field_count': workflow_count,
                'overall_confidence': doc.overall_confidence,
                'created_at': doc.created_at.isoformat(),
            })

        status_counts = {}
        for s in ['pending', 'processing', 'completed', 'failed']:
            status_counts[s] = docs.filter(extraction_status=s).count()

        return Response({
            'workflow_id': str(workflow.id),
            'total_documents': docs.count(),
            'status_counts': status_counts,
            'documents': summary,
        })

    # -- Derived Fields (AI-computed metadata) ------------------------------

    @action(detail=True, methods=['get', 'post'], url_path='derived-fields')
    def derived_fields(self, request, pk=None):
        """
        GET  /api/clm/workflows/{id}/derived-fields/
          → List all derived field definitions for this workflow.

        POST /api/clm/workflows/{id}/derived-fields/
          → Create a new derived field definition.
          Body: {
            "name": "total_experience",
            "display_name": "Total Experience (Years)",
            "field_type": "number",
            "description": "Total years of work experience",
            "computation_hint": "Sum all work experience durations...",
            "depends_on": ["work_experience_1_duration", ...],
            "allowed_values": [],
            "include_document_text": false,
            "order": 0
          }
        """
        from .serializers import DerivedFieldSerializer
        from .models import DerivedField

        workflow = self.get_object()

        if request.method == 'GET':
            fields = workflow.derived_fields.all().order_by('order', 'created_at')
            serializer = DerivedFieldSerializer(fields, many=True)
            return Response({
                'workflow_id': str(workflow.id),
                'derived_fields': serializer.data,
                'count': fields.count(),
            })

        # POST — create new derived field
        data = request.data.copy()
        data['workflow'] = str(workflow.id)
        serializer = DerivedFieldSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        # Rebuild extraction template so the new field appears
        workflow.rebuild_extraction_template()

        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(
        detail=True, methods=['get', 'patch', 'delete'],
        url_path='derived-fields/(?P<field_id>[0-9a-f-]+)',
    )
    def derived_field_detail(self, request, pk=None, field_id=None):
        """
        GET    /api/clm/workflows/{id}/derived-fields/{field_id}/
        PATCH  /api/clm/workflows/{id}/derived-fields/{field_id}/
        DELETE /api/clm/workflows/{id}/derived-fields/{field_id}/
        """
        from .serializers import DerivedFieldSerializer
        from .models import DerivedField

        workflow = self.get_object()

        try:
            field = workflow.derived_fields.get(id=field_id)
        except DerivedField.DoesNotExist:
            return Response(
                {'error': 'Derived field not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if request.method == 'GET':
            serializer = DerivedFieldSerializer(field)
            return Response(serializer.data)

        if request.method == 'DELETE':
            field.delete()
            workflow.rebuild_extraction_template()
            return Response(status=status.HTTP_204_NO_CONTENT)

        # PATCH
        serializer = DerivedFieldSerializer(
            field, data=request.data, partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        workflow.rebuild_extraction_template()
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='derived-fields-bulk')
    def derived_fields_bulk(self, request, pk=None):
        """
        POST /api/clm/workflows/{id}/derived-fields-bulk/
          → Bulk create/replace derived field definitions.
          Body: {
            "fields": [
              {"name": "total_experience", "computation_hint": "...", ...},
              {"name": "seniority_level", "computation_hint": "...", ...},
            ],
            "replace": false  // if true, delete existing and replace
          }
        """
        from .serializers import DerivedFieldCreateSerializer
        from .models import DerivedField

        workflow = self.get_object()
        fields_data = request.data.get('fields', [])
        replace = request.data.get('replace', False)

        if not fields_data or not isinstance(fields_data, list):
            return Response(
                {'error': 'Provide a "fields" array.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate all fields first
        serializer = DerivedFieldCreateSerializer(data=fields_data, many=True)
        serializer.is_valid(raise_exception=True)

        if replace:
            workflow.derived_fields.all().delete()

        created = []
        errors = []
        for i, field_data in enumerate(serializer.validated_data):
            try:
                df, was_created = DerivedField.objects.update_or_create(
                    workflow=workflow,
                    name=field_data['name'],
                    defaults={
                        'display_name': field_data.get('display_name', ''),
                        'field_type': field_data.get('field_type', 'string'),
                        'description': field_data.get('description', ''),
                        'computation_hint': field_data['computation_hint'],
                        'depends_on': field_data.get('depends_on', []),
                        'allowed_values': field_data.get('allowed_values', []),
                        'include_document_text': field_data.get('include_document_text', False),
                        'order': field_data.get('order', i),
                    },
                )
                created.append({
                    'id': str(df.id),
                    'name': df.name,
                    'created': was_created,
                })
            except Exception as e:
                errors.append({'index': i, 'name': field_data.get('name', ''), 'error': str(e)})

        workflow.rebuild_extraction_template()

        return Response({
            'workflow_id': str(workflow.id),
            'created': created,
            'errors': errors,
            'total': len(created),
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='compute-derived/(?P<doc_id>[0-9a-f-]+)')
    def compute_derived_single(self, request, pk=None, doc_id=None):
        """
        POST /api/clm/workflows/{id}/compute-derived/{doc_id}/
          → Run derived field computation for a single document.
          Optional body: {"model": "gemini-2.5-flash", "field_ids": [...]}
        """
        from .derived_field_executor import execute_derived_fields

        workflow = self.get_object()

        try:
            doc = workflow.documents.get(id=doc_id)
        except WorkflowDocument.DoesNotExist:
            return Response(
                {'error': 'Document not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not workflow.derived_fields.exists():
            return Response(
                {'error': 'No derived fields defined for this workflow.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Build a temporary AI node-like object for the executor
        model_id = request.data.get('model', 'gemini-2.5-flash')
        field_ids = request.data.get('field_ids')

        # Create a mock node config
        node = type('MockNode', (), {
            'id': 'manual-derived',
            'workflow': workflow,
            'config': {
                'model': model_id,
                'output_format': 'derived',
                'temperature': 0.2,
                'max_tokens': 2048,
                'derived_field_ids': field_ids,
            },
        })()

        result = execute_derived_fields(
            node=node,
            incoming_document_ids=[str(doc.id)],
            triggered_by=request.user,
        )

        return Response(result)

    @action(detail=True, methods=['post'], url_path='compute-derived-all')
    def compute_derived_all(self, request, pk=None):
        """
        POST /api/clm/workflows/{id}/compute-derived-all/
          → Run derived field computation for ALL completed documents.
          Optional body: {"model": "gemini-2.5-flash", "field_ids": [...]}
        """
        from .derived_field_executor import execute_derived_fields

        workflow = self.get_object()

        if not workflow.derived_fields.exists():
            return Response(
                {'error': 'No derived fields defined for this workflow.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        docs = workflow.documents.filter(extraction_status='completed')
        if not docs.exists():
            return Response(
                {'error': 'No completed documents to process.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        model_id = request.data.get('model', 'gemini-2.5-flash')
        field_ids = request.data.get('field_ids')

        node = type('MockNode', (), {
            'id': 'manual-derived-all',
            'workflow': workflow,
            'config': {
                'model': model_id,
                'output_format': 'derived',
                'temperature': 0.2,
                'max_tokens': 2048,
                'derived_field_ids': field_ids,
            },
        })()

        doc_ids = [str(d.id) for d in docs]
        result = execute_derived_fields(
            node=node,
            incoming_document_ids=doc_ids,
            triggered_by=request.user,
        )

        return Response(result)

    # -- AI: Model status ---------------------------------------------------

    @action(detail=False, methods=['get'], url_path='model-status')
    def model_status(self, request):
        """
        Check extraction model status: loaded, device, inference count.
        GET /api/clm/workflows/model-status/
        """
        from .ai_inference import get_engine
        engine = get_engine()
        return Response(engine.status)

    # -- AI: Preload model --------------------------------------------------

    @action(detail=False, methods=['post'], url_path='preload-model')
    def preload_model(self, request):
        """
        Trigger model preload (download + load to GPU).
        POST /api/clm/workflows/preload-model/
        """
        from .ai_inference import get_engine
        engine = get_engine()
        try:
            engine.load(force=request.data.get('force', False))
            return Response(engine.status)
        except Exception as e:
            return Response(
                {'error': str(e), **engine.status},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    # -- AI: Generate workflow from text ------------------------------------

    @action(detail=False, methods=['post'], url_path='generate-from-text')
    def generate_from_text(self, request):
        """
        Generate a complete workflow from a natural language description using AI.
        POST /api/clm/workflows/generate-from-text/
        Body: {"text": "Filter all NDAs with value > 50k, run AI analysis, email results"}
        Or with follow-up answers:
        Body: {"text": "...", "answers": [{"question": "...", "answer": "..."}]}
        Returns: Full serialized workflow with nodes and connections,
                 OR {"follow_up_questions": ["...", ...]} if AI needs clarification.
        """
        from .ai_workflow_generator import generate_workflow_from_text

        org = _get_org(request)
        if not org:
            return Response(
                {'error': 'Organization not found'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        text = request.data.get('text', '').strip()
        if not text:
            return Response(
                {'error': 'Please provide a workflow description in the "text" field.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Optional follow-up answers from a previous round
        previous_answers = request.data.get('answers', None)
        if previous_answers is not None and not isinstance(previous_answers, list):
            previous_answers = None

        try:
            result = generate_workflow_from_text(
                user_prompt=text,
                organization=org,
                created_by=request.user if request.user.is_authenticated else None,
                previous_answers=previous_answers,
            )

            # If AI returned follow-up questions instead of a workflow
            if isinstance(result, dict) and 'follow_up_questions' in result:
                return Response(result, status=status.HTTP_200_OK)

            # Otherwise it's a Workflow instance — serialize it
            workflow = result
            workflow = Workflow.objects.prefetch_related(
                'nodes', 'connections', 'documents',
            ).get(pk=workflow.pk)
            serializer = WorkflowSerializer(workflow)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except ValueError as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except RuntimeError as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        except Exception as e:
            logger.error(f"AI workflow generation failed: {e}", exc_info=True)
            return Response(
                {'error': 'Failed to generate workflow. Please try again with a different description.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    # -- Execute workflow ---------------------------------------------------

    @action(detail=True, methods=['post'], url_path='execute')
    def execute(self, request, pk=None):
        """
        Execute the workflow pipeline (sync or async).
        POST /api/clm/workflows/{id}/execute/
        Body (all optional):
          {
            "document_ids": ["uuid", ...],       // specific docs only (batch/single mode)
            "excluded_ids": ["uuid", ...],        // docs to exclude
            "mode": "full" | "batch" | "single",  // default: auto-detected
            "smart": true,                         // skip already-executed docs (hash dedup)
            "async": true                          // dispatch as Celery task (returns immediately)
          }

        When ``async=true``, a WorkflowExecution record is created with
        status='queued', the task is dispatched to Celery, and the response
        returns the ``execution_id`` immediately.  The frontend polls
        ``/execution-status/<exec_id>/`` until the task finishes.
        """
        from .models import WorkflowExecution

        workflow = self.get_object()

        doc_ids = request.data.get('document_ids')
        excluded_ids = request.data.get('excluded_ids')
        smart = request.data.get('smart', False)
        run_async = request.data.get('async', False)

        # Auto-detect mode
        if request.data.get('mode'):
            mode = request.data['mode']
        elif doc_ids and len(doc_ids) == 1:
            mode = 'single'
        elif doc_ids:
            mode = 'batch'
        else:
            mode = 'full'

        if run_async:
            # Async execution — dispatch Celery task
            # ──────────────────────────────────────────────────────────
            # Locking strategy:
            #   Primary lock  = workflow.execution_state (DB, authoritative)
            #   Secondary lock = LocMemCache key (best-effort, unreliable
            #                    across processes like Celery workers)
            #
            # We rely on the DB field as the single source of truth.  The
            # cache lock is a nice-to-have for same-process dedup but is
            # NOT required for correctness.
            # ──────────────────────────────────────────────────────────
            from .tasks import execute_workflow_async

            force = request.data.get('force', False)

            # Refresh workflow state from DB
            workflow.refresh_from_db(fields=['execution_state', 'current_execution_id'])

            if workflow.execution_state not in ('idle', 'completed', 'failed'):
                # Workflow claims it's busy — validate with the DB record
                active_exec = WorkflowExecution.objects.filter(
                    workflow=workflow,
                    status__in=['queued', 'running'],
                ).order_by('-started_at').first()

                if active_exec:
                    age = (timezone.now() - active_exec.started_at).total_seconds()

                    if age > 300 or force:
                        # Stale (>5 min) or forced override — kill it
                        active_exec.status = 'failed'
                        active_exec.result_data = {
                            'error': f'Execution timed out after {int(age)}s (stale lock cleared)',
                        }
                        active_exec.completed_at = timezone.now()
                        active_exec.duration_ms = int(age * 1000)
                        active_exec.save()
                        workflow.execution_state = 'idle'
                        workflow.current_execution_id = None
                        workflow.save(update_fields=['execution_state', 'current_execution_id', 'updated_at'])
                    else:
                        # Genuinely running — return rich 409 so frontend
                        # can resume polling on this execution
                        return Response({
                            'error': 'Workflow is already executing.',
                            'execution_id': str(active_exec.id),
                            'status': active_exec.status,
                            'execution_state': workflow.execution_state,
                            'started_at': active_exec.started_at.isoformat(),
                            'age_seconds': int(age),
                            'resume': True,
                            'message': f'Execution {active_exec.status} (started {int(age)}s ago). '
                                       f'Poll /execution-status/{active_exec.id}/ or pass "force": true to override.',
                        }, status=status.HTTP_409_CONFLICT)
                else:
                    # No active execution in DB — state is stuck, reset it
                    workflow.execution_state = 'idle'
                    workflow.current_execution_id = None
                    workflow.save(update_fields=['execution_state', 'current_execution_id', 'updated_at'])

            execution = WorkflowExecution.objects.create(
                workflow=workflow,
                status='queued',
                mode=mode,
                triggered_by=request.user if request.user.is_authenticated else None,
                excluded_document_ids=[str(d) for d in (excluded_ids or [])],
            )

            try:
                execute_workflow_async.delay(
                    workflow_id=str(workflow.id),
                    execution_id=str(execution.id),
                    user_id=request.user.pk if request.user.is_authenticated else None,
                    document_ids=doc_ids,
                    excluded_ids=excluded_ids,
                    mode=mode,
                    smart=bool(smart),
                )
            except Exception as broker_err:
                # Celery broker unavailable (no Redis, etc.) — run synchronously
                # using the already-created execution record.
                import logging
                logging.getLogger('clm').warning(
                    f'[execute] Celery broker unavailable ({broker_err}), '
                    f'falling back to sync execution for workflow {workflow.id}'
                )
                from .node_executor import execute_workflow as _exec_sync

                try:
                    result = _exec_sync(
                        workflow,
                        triggered_by=request.user,
                        single_document_ids=doc_ids if doc_ids else None,
                        excluded_document_ids=excluded_ids if excluded_ids else None,
                        mode=mode,
                        smart=bool(smart),
                        execution=execution,
                    )
                    return Response(result)
                except ValueError as e:
                    return Response(
                        {'error': str(e)},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            return Response({
                'execution_id': str(execution.id),
                'status': 'queued',
                'message': 'Workflow execution queued. Poll /execution-status/ for progress.',
            }, status=status.HTTP_202_ACCEPTED)

        # Synchronous execution (existing behaviour)
        from .node_executor import execute_workflow

        try:
            result = execute_workflow(
                workflow,
                triggered_by=request.user,
                single_document_ids=doc_ids if doc_ids else None,
                excluded_document_ids=excluded_ids if excluded_ids else None,
                mode=mode,
                smart=bool(smart),
            )
            return Response(result)
        except ValueError as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

    # -- Execution status (polling for async) ----------------------------------

    @action(detail=True, methods=['get'], url_path='execution-status/(?P<exec_id>[0-9a-f-]+)')
    def execution_status(self, request, pk=None, exec_id=None):
        """
        Lightweight polling endpoint for async execution progress.
        GET /api/clm/workflows/{id}/execution-status/{exec_id}/

        Returns:
          {
            "execution_id": "...",
            "status": "queued" | "running" | "completed" | "partial" | "failed",
            "mode": "...",
            "started_at": "...",
            "completed_at": "..." | null,
            "duration_ms": ... | null,
            "total_documents": ...,
            "node_summary": [...],
            "result_data": {...}        // only when completed/failed
          }
        """
        from .models import WorkflowExecution

        workflow = self.get_object()
        try:
            execution = WorkflowExecution.objects.get(
                id=exec_id, workflow=workflow,
            )
        except WorkflowExecution.DoesNotExist:
            return Response(
                {'error': 'Execution not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        data = {
            'execution_id': str(execution.id),
            'status': execution.status,
            'mode': execution.mode,
            'execution_state': workflow.execution_state,
            'started_at': execution.started_at.isoformat() if execution.started_at else None,
            'completed_at': execution.completed_at.isoformat() if execution.completed_at else None,
            'duration_ms': execution.duration_ms,
            'total_documents': execution.total_documents,
            'node_summary': execution.node_summary,
        }

        # Include full result_data only when execution is finished
        if execution.status in ('completed', 'partial', 'failed'):
            data['result_data'] = execution.result_data

        return Response(data)

    # -- Live dashboard (polling endpoint) ---------------------------------

    @action(detail=True, methods=['get'], url_path='live-dashboard')
    def live_dashboard(self, request, pk=None):
        """
        GET /api/clm/workflows/{id}/live-dashboard/

        Comprehensive snapshot polled every 2-5 s by the frontend hook.
        Returns: workflow info, current_execution with node_progress,
                 node_status (per-node last-run summary), subscription_health,
                 live_metrics summary, and recent events.
        """
        from .models import WorkflowExecution, NodeExecutionLog, EventSubscription, WebhookEvent

        workflow = self.get_object()

        # ── Current / recent execution ─────────────────────────────────────
        active_exec = WorkflowExecution.objects.filter(
            workflow=workflow,
            status__in=['queued', 'running'],
        ).order_by('-started_at').first()

        if not active_exec:
            active_exec = WorkflowExecution.objects.filter(
                workflow=workflow,
            ).order_by('-started_at').first()

        current_execution = None
        if active_exec:
            elapsed = None
            if active_exec.started_at and active_exec.status in ('queued', 'running'):
                elapsed = int((timezone.now() - active_exec.started_at).total_seconds())

            # Node-level progress for this execution
            node_logs = NodeExecutionLog.objects.filter(
                execution=active_exec,
            ).select_related('node').order_by('dag_level', 'started_at')

            node_progress = []
            for log in node_logs:
                node_progress.append({
                    'node_id':    str(log.node_id),
                    'label':      log.node.label if log.node else '',
                    'node_type':  log.node.node_type if log.node else '',
                    'status':     log.status,
                    'dag_level':  log.dag_level,
                    'input_count':  log.input_count,
                    'output_count': log.output_count,
                    'duration_ms':  log.duration_ms,
                    'error_message': log.error_message,
                    'progress_pct': getattr(log, 'progress_pct', None),
                })

            current_execution = {
                'execution_id': str(active_exec.id),
                'status':         active_exec.status,
                'mode':           active_exec.mode,
                'total_documents': active_exec.total_documents,
                'duration_ms':    active_exec.duration_ms,
                'started_at':     active_exec.started_at.isoformat() if active_exec.started_at else None,
                'completed_at':   active_exec.completed_at.isoformat() if active_exec.completed_at else None,
                'elapsed_seconds': elapsed,
                'node_summary':   active_exec.node_summary,
                'node_progress':  node_progress,
            }

        # ── Per-node last-run summary ─────────────────────────────────────
        nodes_qs = workflow.nodes.all()
        node_status_list = []
        for node in nodes_qs:
            last_log = NodeExecutionLog.objects.filter(
                node=node,
            ).order_by('-started_at').first()
            node_status_list.append({
                'node_id':        str(node.id),
                'label':          node.label,
                'node_type':      node.node_type,
                'last_status':    last_log.status if last_log else 'never_run',
                'last_duration_ms': last_log.duration_ms if last_log else None,
                'last_run_at':    last_log.started_at.isoformat() if last_log and last_log.started_at else None,
                'total_documents': last_log.input_count if last_log else 0,
                'ready_documents': last_log.output_count if last_log else 0,
                'pending_documents': 0,
                'failed_documents': 0,
            })

        # ── Subscription health ────────────────────────────────────────────
        subs = EventSubscription.objects.filter(workflow=workflow).select_related('workflow')
        sub_health = []
        for sub in subs:
            node_label = ''
            try:
                node_label = workflow.nodes.filter(
                    id=sub.source_id,
                ).values_list('label', flat=True).first() or ''
            except Exception:
                pass
            sub_health.append({
                'subscription_id': str(sub.id),
                'source_type':     sub.source_type,
                'source_id':       str(sub.source_id) if sub.source_id else None,
                'node_label':      node_label,
                'status':          sub.status,
                'total_events':    sub.total_events_received,
                'total_executions': sub.total_executions_triggered,
                'consecutive_errors': sub.consecutive_errors,
                'last_error':      sub.last_error,
                'last_polled_at':  sub.last_polled_at.isoformat() if sub.last_polled_at else None,
                'poll_interval':   sub.poll_interval,
            })

        # ── Recent events (last 20) ─────────────────────────────────────────
        recent_events_qs = WebhookEvent.objects.filter(
            workflow=workflow,
        ).order_by('-created_at')[:20]
        recent_events = [
            {
                'event_id':   str(ev.id),
                'event_type': ev.event_type,
                'status':     ev.status,
                'created_at': ev.created_at.isoformat(),
                'data':       ev.payload if hasattr(ev, 'payload') else {},
            }
            for ev in recent_events_qs
        ]

        # ── Live metrics summary ────────────────────────────────────────────
        from django.utils import timezone as tz
        window = tz.now() - timezone.timedelta(hours=24)
        recent_execs = WorkflowExecution.objects.filter(
            workflow=workflow,
            started_at__gte=window,
        )
        total = recent_execs.count()
        completed = recent_execs.filter(status='completed').count()
        failed    = recent_execs.filter(status='failed').count()
        partial   = recent_execs.filter(status='partial').count()
        success_rate = round((completed / total) * 100, 1) if total else 0

        live_metrics = {
            'total_executions_24h': total,
            'completed': completed,
            'failed': failed,
            'partial': partial,
            'success_rate': success_rate,
            'is_live': workflow.is_live,
            'compilation_status': workflow.compilation_status,
            'last_executed_at': workflow.last_executed_at.isoformat() if workflow.last_executed_at else None,
        }

        return Response({
            'workflow': {
                'id':                 str(workflow.id),
                'name':               workflow.name,
                'is_live':            workflow.is_live,
                'is_active':          workflow.is_active,
                'compilation_status': workflow.compilation_status,
                'execution_state':    workflow.execution_state,
                'live_interval':      workflow.live_interval,
                'last_executed_at':   workflow.last_executed_at.isoformat() if workflow.last_executed_at else None,
            },
            'current_execution':  current_execution,
            'node_status':        node_status_list,
            'subscription_health': sub_health,
            'recent_events':      recent_events,
            'live_metrics':       live_metrics,
        })

    # -- Live metrics (detailed, period-based) ------------------------------

    @action(detail=True, methods=['get'], url_path='live-metrics')
    def live_metrics(self, request, pk=None):
        """
        GET /api/clm/workflows/{id}/live-metrics/?period=24h|7d|30d

        Returns detailed execution metrics for the workflow for dashboard charts.
        """
        from .models import WorkflowExecution, NodeExecutionLog

        workflow = self.get_object()
        period = request.query_params.get('period', '24h')

        period_map = {'24h': 24, '7d': 168, '30d': 720}
        hours = period_map.get(period, 24)
        since = timezone.now() - timezone.timedelta(hours=hours)

        execs = WorkflowExecution.objects.filter(
            workflow=workflow,
            started_at__gte=since,
        )

        total     = execs.count()
        completed = execs.filter(status='completed').count()
        failed    = execs.filter(status='failed').count()
        partial   = execs.filter(status='partial').count()
        success_rate = round((completed / total) * 100, 1) if total else 0

        # Average duration
        from django.db.models import Avg, Sum
        avg_ms = execs.filter(
            duration_ms__isnull=False,
        ).aggregate(avg=Avg('duration_ms'))['avg'] or 0

        total_docs = execs.aggregate(
            total=Sum('total_documents'),
        )['total'] or 0

        summary = {
            'total_executions': total,
            'completed': completed,
            'failed': failed,
            'partial': partial,
            'success_rate': success_rate,
            'avg_duration_ms': int(avg_ms),
            'total_documents_processed': total_docs,
        }

        # Node performance table
        node_perf_map = {}
        node_logs = NodeExecutionLog.objects.filter(
            execution__workflow=workflow,
            execution__started_at__gte=since,
        ).select_related('node')

        for log in node_logs:
            nid = str(log.node_id)
            if nid not in node_perf_map:
                node_perf_map[nid] = {
                    'node_id': nid,
                    'label': log.node.label if log.node else '',
                    'node_type': log.node.node_type if log.node else '',
                    'executions': 0,
                    'total_duration_ms': 0,
                    'total_input_docs': 0,
                    'failure_count': 0,
                }
            entry = node_perf_map[nid]
            entry['executions'] += 1
            entry['total_duration_ms'] += log.duration_ms or 0
            entry['total_input_docs'] += log.input_count or 0
            if log.status in ('failed', 'error'):
                entry['failure_count'] += 1

        node_performance = []
        for entry in node_perf_map.values():
            entry['avg_duration_ms'] = (
                entry['total_duration_ms'] // entry['executions']
                if entry['executions'] else 0
            )
            node_performance.append(entry)
        node_performance.sort(key=lambda x: -x['executions'])

        # Hourly distribution (only meaningful for 24h)
        hourly = []
        if period == '24h':
            from django.db.models.functions import TruncHour
            from django.db.models import Count
            hourly_qs = execs.annotate(
                hour=TruncHour('started_at'),
            ).values('hour').annotate(
                executions=Count('id'),
            ).order_by('hour')
            for row in hourly_qs:
                hourly.append({
                    'hour': row['hour'].strftime('%H:00') if row['hour'] else '',
                    'executions': row['executions'],
                })

        return Response({
            'period': period,
            'summary': summary,
            'node_performance': node_performance,
            'hourly_distribution': hourly,
        })

    # -- SSE live-stream endpoint -------------------------------------------

    @action(detail=True, methods=['get'], url_path='live-stream')
    def live_stream(self, request, pk=None):
        """
        GET /api/clm/workflows/{id}/live-stream/
        ?last_event_id=<uuid>   Resume from a specific event (replays buffered events first)

        Server-Sent Events (SSE) stream of live workflow execution events.

        Architecture:
          This endpoint uses a HYBRID approach to handle both in-process
          (sync / no-Celery) and out-of-process (Celery worker) executions:

          1. In-process bus (live_events.event_bus):
             - Works immediately for sync executions
             - Celery workers emit to their OWN process's bus (not shared)

          2. DB polling (NodeExecutionLog + WorkflowExecution):
             - Polls the DB every 2s to pick up Celery-based progress
             - Converts DB records to synthetic SSE events
             - Works regardless of whether Celery or sync execution is used

          Both sources are multiplexed into the same SSE stream.

        Client usage:
          const es = new EventSource('/api/clm/workflows/{id}/live-stream/', {withCredentials: true});
          es.addEventListener('execution_started', e => { ... });
          es.addEventListener('node_started', e => { ... });
          es.addEventListener('node_progress', e => { ... });
          es.addEventListener('node_completed', e => { ... });
          es.addEventListener('node_failed', e => { ... });
          es.addEventListener('execution_completed', e => { ... });
          es.addEventListener('live_tick', e => { ... });
          es.addEventListener('compilation_done', e => { ... });

        SSE keepalive is sent every 25s (a comment line: ': keepalive\\n\\n').
        The stream closes automatically when the client disconnects.
        """
        import json
        import time
        import threading
        from django.http import StreamingHttpResponse

        from .live_events import event_bus, LiveEvent
        from .models import NodeExecutionLog, WorkflowExecution

        workflow = self.get_object()
        workflow_id = str(workflow.id)
        last_event_id = request.GET.get('last_event_id', '')

        # Detect client disconnect via threading.Event
        disconnect_event = threading.Event()

        def _make_sse(event_type: str, data: dict, event_id: str = '') -> str:
            payload = json.dumps(data, default=str)
            lines = []
            if event_id:
                lines.append(f'id: {event_id}')
            lines.append(f'event: {event_type}')
            lines.append(f'data: {payload}')
            lines.append('')  # blank line = end of message
            return '\n'.join(lines) + '\n'

        def _db_snapshot(since_exec_id: str, seen_node_ids: set) -> list[str]:
            """
            Poll DB for execution progress events not yet pushed via event_bus.
            Returns SSE-formatted strings.
            """
            messages = []

            # Latest active or recent execution
            exec_qs = WorkflowExecution.objects.filter(
                workflow_id=workflow_id,
            ).order_by('-started_at')

            if since_exec_id:
                exec_qs = exec_qs.filter(id=since_exec_id)
            else:
                exec_qs = exec_qs[:1]

            for execution in exec_qs:
                exec_id = str(execution.id)

                # Execution state change events
                if execution.status == 'running' and exec_id not in seen_node_ids:
                    seen_node_ids.add(f'exec_start:{exec_id}')
                    messages.append(_make_sse('execution_started', {
                        'workflow_id': workflow_id,
                        'execution_id': exec_id,
                        'status': 'running',
                        'mode': execution.mode,
                        'total_documents': execution.total_documents or 0,
                        'source': 'db_poll',
                    }))

                if execution.status in ('completed', 'partial', 'failed'):
                    key = f'exec_done:{exec_id}'
                    if key not in seen_node_ids:
                        seen_node_ids.add(key)
                        messages.append(_make_sse('execution_completed', {
                            'workflow_id': workflow_id,
                            'execution_id': exec_id,
                            'status': execution.status,
                            'duration_ms': execution.duration_ms or 0,
                            'total_documents': execution.total_documents or 0,
                            'output_count': (
                                len(execution.result_data.get('output_documents', []))
                                if execution.result_data else 0
                            ),
                            'source': 'db_poll',
                        }))

                # Per-node execution logs
                logs = NodeExecutionLog.objects.filter(
                    execution=execution,
                ).select_related('node').order_by('dag_level', 'started_at')

                for log in logs:
                    node_key = f'node:{exec_id}:{log.node_id}'  # type: ignore[attr-defined]
                    if log.status == 'running' and f'{node_key}:start' not in seen_node_ids:
                        seen_node_ids.add(f'{node_key}:start')
                        messages.append(_make_sse('node_started', {
                            'workflow_id': workflow_id,
                            'execution_id': exec_id,
                            'node_id': str(log.node_id),  # type: ignore[attr-defined]
                            'node_type': log.node.node_type if log.node else '',
                            'node_label': log.node.label if log.node else '',
                            'input_count': log.input_count,
                            'dag_level': log.dag_level,
                            'source': 'db_poll',
                        }))

                    if log.status in ('completed', 'failed', 'skipped'):
                        done_key = f'{node_key}:{log.status}'
                        if done_key not in seen_node_ids:
                            seen_node_ids.add(done_key)
                            ev_type = 'node_completed' if log.status != 'failed' else 'node_failed'
                            messages.append(_make_sse(ev_type, {
                                'workflow_id': workflow_id,
                                'execution_id': exec_id,
                                'node_id': str(log.node_id),  # type: ignore[attr-defined]
                                'node_type': log.node.node_type if log.node else '',
                                'node_label': log.node.label if log.node else '',
                                'output_count': log.output_count,
                                'input_count': log.input_count,
                                'duration_ms': log.duration_ms or 0,
                                'dag_level': log.dag_level,
                                'error': log.error_message or '',
                                'status': log.status,
                                'source': 'db_poll',
                            }))

            return messages

        def _event_generator():
            """
            Generator that yields SSE messages.

            1. Replay buffered events from the in-process ring buffer (for
               reconnection after brief disconnect).
            2. Subscribe to the in-process event bus for new in-process events.
            3. Concurrently poll DB every 2s for Celery-worker progress.
            4. Send keepalive comments every 25s.
            """
            import uuid as _uuid

            # Replay buffered events (for reconnection)
            buffered = event_bus.get_recent(workflow_id, limit=100)
            replay_start = False
            for ev in buffered:
                if last_event_id and not replay_start:
                    if ev.event_id == last_event_id:
                        replay_start = True
                    continue  # skip until we find last_event_id
                yield ev.to_sse()

            # Track what we've seen from DB polling
            seen_db_keys: set[str] = set()
            active_exec_id = ''

            # Check if there's an active execution to focus DB polls on
            active_exec = WorkflowExecution.objects.filter(
                workflow_id=workflow_id,
                status__in=['queued', 'running'],
            ).order_by('-started_at').first()
            if active_exec:
                active_exec_id = str(active_exec.id)

            last_db_poll = 0.0
            last_keepalive = time.time()
            DB_POLL_INTERVAL = 2.0      # seconds between DB polls
            KEEPALIVE_INTERVAL = 25.0   # seconds between keepalive comments

            with event_bus.subscribe(workflow_id) as sub:
                while not disconnect_event.is_set():
                    now = time.time()

                    # 1. Drain in-process events (immediate, from sync exec / compile)
                    for ev in sub.iter_events(timeout=0.5):
                        if ev is None:
                            break  # timeout — move on
                        yield ev.to_sse()
                        # If this event tells us an execution started, track it
                        if ev.event_type == 'execution_started' and ev.execution_id:
                            active_exec_id = ev.execution_id

                    # 2. DB poll for Celery-worker progress
                    if now - last_db_poll >= DB_POLL_INTERVAL:
                        last_db_poll = now
                        try:
                            db_msgs = _db_snapshot(active_exec_id, seen_db_keys)
                            for msg in db_msgs:
                                yield msg
                        except Exception as e:
                            logger.warning(f'[live-stream] DB poll error: {e}')

                        # Update active_exec_id if a new execution appeared
                        fresh = WorkflowExecution.objects.filter(
                            workflow_id=workflow_id,
                            status__in=['queued', 'running'],
                        ).order_by('-started_at').values_list('id', flat=True).first()
                        if fresh:
                            active_exec_id = str(fresh)

                    # 3. Keepalive comment
                    if now - last_keepalive >= KEEPALIVE_INTERVAL:
                        last_keepalive = now
                        # Refresh workflow state
                        try:
                            wf = Workflow.objects.get(id=workflow_id)
                            tick_data = {
                                'workflow_id': workflow_id,
                                'is_live': wf.is_live,
                                'execution_state': wf.execution_state,
                                'timestamp': timezone.now().isoformat(),
                            }
                            yield _make_sse('live_tick', tick_data, event_id=str(_uuid.uuid4()))
                        except Exception:
                            pass
                        yield ': keepalive\n\n'

        response = StreamingHttpResponse(
            _event_generator(),
            content_type='text/event-stream',
        )
        response['Cache-Control'] = 'no-cache'
        response['X-Accel-Buffering'] = 'no'  # Disable nginx buffering
        response['Access-Control-Allow-Origin'] = request.headers.get('Origin', '*')
        response['Access-Control-Allow-Credentials'] = 'true'

        return response

    # -- Live mode toggle ----------------------------------------------------

    @action(detail=True, methods=['get', 'patch'], url_path='live')
    def live(self, request, pk=None):
        """
        GET  /api/clm/workflows/{id}/live/  → current live state
        PATCH /api/clm/workflows/{id}/live/  → toggle is_live on/off

        Body (PATCH):
          { "is_live": true, "live_interval": 60 }

        Server enforces:
          - Cannot go live unless workflow is compiled.
          - Celery Beat (dispatch_live_workflows) is the sole authority for
            periodic execution — this endpoint only persists the config.
        """
        workflow = self.get_object()

        if request.method == 'GET':
            return Response({
                'is_live': workflow.is_live,
                'live_interval': workflow.live_interval,
                'compilation_status': workflow.compilation_status,
                'last_executed_at': workflow.last_executed_at.isoformat() if workflow.last_executed_at else None,
            })

        # PATCH
        from .models import EventSubscription

        turning_live = request.data.get('is_live', None)

        # Server-side guard: cannot go live unless compiled
        if turning_live and workflow.compilation_status != 'compiled':
            logger.warning(
                '[live-toggle] Rejected is_live=True for workflow %s — not compiled (status=%s)',
                workflow.name, workflow.compilation_status,
            )
            return Response({
                'error': 'Cannot go live — workflow must be compiled first.',
                'compilation_status': workflow.compilation_status,
                'hint': 'POST /api/clm/workflows/{id}/compile/ or POST /api/clm/workflows/{id}/go-live/',
            }, status=status.HTTP_400_BAD_REQUEST)

        if turning_live is not None:
            workflow.is_live = bool(turning_live)
        if 'live_interval' in request.data:
            interval = int(request.data['live_interval'])
            workflow.live_interval = max(interval, 10)  # minimum 10s

        workflow.save(update_fields=['is_live', 'live_interval', 'updated_at'])

        logger.info(
            '[live-toggle] Workflow %s (%s) is now %s (interval=%ds)',
            workflow.name, workflow.id,
            'LIVE' if workflow.is_live else 'OFFLINE',
            workflow.live_interval,
        )

        # When going live: reactivate any paused subscriptions
        # (subscriptions are paused by pause() but should come back on re-enable)
        reactivated = 0
        if workflow.is_live:
            reactivated = EventSubscription.objects.filter(
                workflow=workflow, status='paused',
            ).update(status='active')

        return Response({
            'is_live': workflow.is_live,
            'live_interval': workflow.live_interval,
            'compilation_status': workflow.compilation_status,
            'subscriptions_reactivated': reactivated,
            'message': f'Workflow is now {"LIVE — Celery Beat will manage execution" if workflow.is_live else "offline"}.',
        })

    # -- Compile workflow (validate DAG + create event subscriptions) --------

    @action(detail=True, methods=['post'], url_path='compile')
    def compile_workflow(self, request, pk=None):
        """
        POST /api/clm/workflows/{id}/compile/

        Validates the workflow DAG, checks input node configurations,
        creates event subscriptions for all input nodes, and marks the
        workflow as compiled.  This is the prerequisite for going live.

        Returns the compilation result with errors, warnings, and
        subscription details.
        """
        from .event_system import compile_workflow as _compile
        from .live_events import emit_compilation_event
        from .models import WorkflowCompilation

        workflow = self.get_object()
        emit_compilation_event(workflow, status='compiling')
        compilation = _compile(workflow, user=request.user if request.user.is_authenticated else None)
        emit_compilation_event(
            workflow, status=compilation.status,
            errors=compilation.errors, warnings=compilation.warnings,
        )

        return Response({
            'id': str(compilation.id),
            'status': compilation.status,
            'node_count': compilation.node_count,
            'connection_count': compilation.connection_count,
            'has_cycle': compilation.has_cycle,
            'has_input_node': compilation.has_input_node,
            'has_output_node': compilation.has_output_node,
            'subscriptions_created': compilation.subscriptions_created,
            'subscription_details': compilation.subscription_details,
            'errors': compilation.errors,
            'warnings': compilation.warnings,
            'config_hash': compilation.config_hash,
            'compilation_status': workflow.compilation_status,
            'compiled_at': workflow.compiled_at.isoformat() if workflow.compiled_at else None,
        }, status=status.HTTP_200_OK if compilation.status != 'failed' else status.HTTP_400_BAD_REQUEST)

    # -- Compile + Go Live (compile then enable) -----------------------------

    @action(detail=True, methods=['post'], url_path='go-live')
    def go_live(self, request, pk=None):
        """
        POST /api/clm/workflows/{id}/go-live/
        Body: { "live_interval": 60 }  (optional)

        Compiles the workflow and, if successful, sets is_live=True.
        This is the one-step "go live" action that the frontend calls.
        """
        from .event_system import compile_workflow as _compile

        workflow = self.get_object()

        # Compile first
        compilation = _compile(workflow, user=request.user if request.user.is_authenticated else None)

        if compilation.status == 'failed':
            return Response({
                'success': False,
                'message': 'Compilation failed — cannot go live.',
                'errors': compilation.errors,
                'warnings': compilation.warnings,
            }, status=status.HTTP_400_BAD_REQUEST)

        # Set live
        interval = request.data.get('live_interval')
        if interval:
            workflow.live_interval = max(int(interval), 10)
        workflow.is_live = True
        workflow.save(update_fields=['is_live', 'live_interval', 'updated_at'])

        return Response({
            'success': True,
            'is_live': True,
            'live_interval': workflow.live_interval,
            'compilation_status': workflow.compilation_status,
            'compiled_at': workflow.compiled_at.isoformat() if workflow.compiled_at else None,
            'subscriptions_created': compilation.subscriptions_created,
            'subscription_details': compilation.subscription_details,
            'warnings': compilation.warnings,
            'message': f'Workflow "{workflow.name}" is now LIVE.',
        })

    # -- Pause (go offline) --------------------------------------------------

    @action(detail=True, methods=['post'], url_path='pause')
    def pause(self, request, pk=None):
        """
        POST /api/clm/workflows/{id}/pause/

        Pauses a live workflow — sets is_live=False and pauses all
        event subscriptions.
        """
        from .models import EventSubscription

        workflow = self.get_object()
        workflow.is_live = False
        workflow.save(update_fields=['is_live', 'updated_at'])

        # Pause all active subscriptions
        paused = EventSubscription.objects.filter(
            workflow=workflow, status='active',
        ).update(status='paused')

        return Response({
            'success': True,
            'is_live': False,
            'subscriptions_paused': paused,
            'message': f'Workflow "{workflow.name}" is now PAUSED.',
        })

    # -- Event subscriptions -------------------------------------------------

    @action(detail=True, methods=['get'], url_path='subscriptions')
    def subscriptions(self, request, pk=None):
        """
        GET /api/clm/workflows/{id}/subscriptions/

        Lists all event subscriptions for this workflow with their status,
        stats, and configuration.
        """
        from .models import EventSubscription
        from .serializers import EventSubscriptionSerializer

        workflow = self.get_object()
        subs = EventSubscription.objects.filter(
            workflow=workflow,
        ).select_related('node').order_by('-created_at')

        return Response({
            'subscriptions': EventSubscriptionSerializer(subs, many=True).data,
            'count': subs.count(),
        })

    # -- Event log -----------------------------------------------------------

    @action(detail=True, methods=['get'], url_path='event-log')
    def event_log(self, request, pk=None):
        """
        GET /api/clm/workflows/{id}/event-log/
        ?limit=50&event_type=sheet_updated&status=processed

        Lists all events received by this workflow (webhook calls, sheet
        updates, email arrivals, poll results).
        """
        from .models import WebhookEvent
        from .serializers import WebhookEventSerializer

        workflow = self.get_object()
        limit = int(request.query_params.get('limit', 50))

        qs = WebhookEvent.objects.filter(
            workflow=workflow,
        ).select_related('subscription', 'execution').order_by('-created_at')

        event_type = request.query_params.get('event_type')
        if event_type:
            qs = qs.filter(event_type=event_type)

        status_filter = request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)

        events = qs[:limit]

        return Response({
            'events': WebhookEventSerializer(events, many=True).data,
            'count': len(events),
        })

    # -- Node execution logs -------------------------------------------------

    @action(detail=True, methods=['get'], url_path='node-execution-logs/(?P<exec_id>[0-9a-f-]+)')
    def node_execution_logs(self, request, pk=None, exec_id=None):
        """
        GET /api/clm/workflows/{id}/node-execution-logs/{exec_id}/

        Returns per-node execution logs for a specific workflow execution.
        Shows input/output document IDs, timing, errors, and result data
        for every node that ran.
        """
        from .models import NodeExecutionLog, WorkflowExecution
        from .serializers import NodeExecutionLogSerializer

        workflow = self.get_object()

        try:
            execution = WorkflowExecution.objects.get(id=exec_id, workflow=workflow)
        except WorkflowExecution.DoesNotExist:
            return Response({'error': 'Execution not found.'}, status=status.HTTP_404_NOT_FOUND)

        logs = NodeExecutionLog.objects.filter(
            execution=execution,
        ).select_related('node').order_by('dag_level', 'started_at')

        return Response({
            'execution_id': str(execution.id),
            'execution_status': execution.status,
            'node_logs': NodeExecutionLogSerializer(logs, many=True).data,
            'count': logs.count(),
        })

    # -- Compilation history -------------------------------------------------

    @action(detail=True, methods=['get'], url_path='compilation-history')
    def compilation_history(self, request, pk=None):
        """
        GET /api/clm/workflows/{id}/compilation-history/
        ?limit=10

        Lists all compilation attempts for this workflow.
        """
        from .models import WorkflowCompilation
        from .serializers import WorkflowCompilationSerializer

        workflow = self.get_object()
        limit = int(request.query_params.get('limit', 10))

        compilations = WorkflowCompilation.objects.filter(
            workflow=workflow,
        ).order_by('-created_at')[:limit]

        return Response({
            'compilations': WorkflowCompilationSerializer(compilations, many=True).data,
            'count': len(compilations),
        })

    # -- Workflow status (comprehensive server-side status) ------------------

    @action(detail=True, methods=['get', 'post'], url_path='workflow-status')
    def workflow_status(self, request, pk=None):
        """
        GET  /api/clm/workflows/{id}/workflow-status/
        Comprehensive status: is_live, current execution state, lock info,
        last execution summary, document counts.

        POST /api/clm/workflows/{id}/workflow-status/
        Body: { "action": "clear_lock" }
        Force-clears any stale execution state so Execute can run again.
        """
        from .models import WorkflowExecution

        workflow = self.get_object()

        if request.method == 'POST':
            action_name = request.data.get('action')
            if action_name == 'clear_lock':
                # Reset DB-based execution state
                workflow.execution_state = 'idle'
                workflow.current_execution_id = None
                workflow.save(update_fields=['execution_state', 'current_execution_id', 'updated_at'])
                # Also mark any queued/running executions as failed (stale)
                stale = WorkflowExecution.objects.filter(
                    workflow=workflow,
                    status__in=['queued', 'running'],
                )
                count = stale.count()
                stale.update(
                    status='failed',
                    completed_at=timezone.now(),
                )
                # Clear cache lock too (best-effort, may not be in this process)
                try:
                    from django.core.cache import cache as django_cache
                    django_cache.delete(f'clm:workflow_exec:{workflow.id}')
                except Exception:
                    pass
                return Response({
                    'cleared': True,
                    'stale_executions_cleared': count,
                    'execution_state': 'idle',
                    'message': f'Lock cleared. {count} stale execution(s) marked failed.',
                })
            return Response({'error': 'Unknown action'}, status=status.HTTP_400_BAD_REQUEST)

        # GET — build comprehensive status (DB-based, no cache dependency)
        workflow.refresh_from_db(fields=['execution_state', 'current_execution_id'])

        # Find any active execution
        active_exec = WorkflowExecution.objects.filter(
            workflow=workflow,
            status__in=['queued', 'running'],
        ).order_by('-started_at').first()

        active_info = None
        if active_exec:
            age = (timezone.now() - active_exec.started_at).total_seconds()
            active_info = {
                'execution_id': str(active_exec.id),
                'status': active_exec.status,
                'mode': active_exec.mode,
                'started_at': active_exec.started_at.isoformat(),
                'age_seconds': int(age),
                'is_stale': age > 300,
            }

        # Last completed execution
        last_exec = WorkflowExecution.objects.filter(
            workflow=workflow,
            status__in=['completed', 'partial', 'failed'],
        ).order_by('-started_at').first()

        last_info = None
        if last_exec:
            last_info = {
                'execution_id': str(last_exec.id),
                'status': last_exec.status,
                'mode': last_exec.mode,
                'duration_ms': last_exec.duration_ms,
                'total_documents': last_exec.total_documents,
                'started_at': last_exec.started_at.isoformat() if last_exec.started_at else None,
                'completed_at': last_exec.completed_at.isoformat() if last_exec.completed_at else None,
                'node_summary': last_exec.node_summary,
            }

        doc_count = workflow.documents.count() if hasattr(workflow, 'documents') else 0
        node_count = workflow.nodes.count() if hasattr(workflow, 'nodes') else 0

        return Response({
            'workflow_id': str(workflow.id),
            'workflow_name': workflow.name,
            'is_active': workflow.is_active,
            'is_live': workflow.is_live,
            'live_interval': workflow.live_interval,
            'execution_state': workflow.execution_state,
            'current_execution_id': str(workflow.current_execution_id) if workflow.current_execution_id else None,
            'last_executed_at': workflow.last_executed_at.isoformat() if workflow.last_executed_at else None,
            'document_count': doc_count,
            'node_count': node_count,
            'lock_held': workflow.execution_state not in ('idle', 'completed', 'failed'),
            'active_execution': active_info,
            'last_execution': last_info,
        })

    # -- Execution history --------------------------------------------------

    @action(detail=True, methods=['get'], url_path='execution-history')
    def execution_history(self, request, pk=None):
        """
        List execution history for this workflow.
        GET /api/clm/workflows/{id}/execution-history/
        ?limit=20
        """
        from .models import WorkflowExecution

        workflow = self.get_object()
        limit = int(request.query_params.get('limit', 20))
        executions = WorkflowExecution.objects.filter(
            workflow=workflow,
        ).order_by('-started_at')[:limit]

        return Response({
            'executions': WorkflowExecutionSerializer(executions, many=True).data,
            'count': executions.count() if hasattr(executions, 'count') else len(executions),
        })

    @action(detail=True, methods=['get'], url_path='execution-detail/(?P<exec_id>[0-9a-f-]+)')
    def execution_detail(self, request, pk=None, exec_id=None):
        """
        Get full detail for a single execution (includes result_data).
        GET /api/clm/workflows/{id}/execution-detail/{exec_id}/
        """
        from .models import WorkflowExecution

        workflow = self.get_object()
        try:
            execution = WorkflowExecution.objects.get(
                id=exec_id, workflow=workflow,
            )
        except WorkflowExecution.DoesNotExist:
            return Response(
                {'error': 'Execution not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(WorkflowExecutionDetailSerializer(execution).data)

    # -- Smart execution: nodes config status ----------------------------------

    @action(detail=True, methods=['get'], url_path='nodes-status')
    def nodes_status(self, request, pk=None):
        """
        Check if workflow node config has changed since last execution.
        GET /api/clm/workflows/{id}/nodes-status/

        Returns:
          {
            "current_config_hash": "abc...",
            "last_executed_hash": "xyz...",
            "nodes_changed": true/false,
            "total_documents": 42,
            "already_executed": 38,
            "pending_execution": 4
          }
        """
        from .models import DocumentExecutionRecord

        workflow = self.get_object()
        current_hash = workflow.compute_nodes_config_hash(save=True)

        # Find the hash used in the most recent execution records
        last_record = DocumentExecutionRecord.objects.filter(
            workflow=workflow, status='completed',
        ).order_by('-executed_at').values_list('nodes_config_hash', flat=True).first()

        nodes_changed = bool(last_record and last_record != current_hash)

        # Count docs
        total_docs = WorkflowDocument.objects.filter(workflow=workflow).count()

        if nodes_changed or not last_record:
            already_executed = 0
        else:
            # Count docs with a matching record
            all_docs = list(WorkflowDocument.objects.filter(
                workflow=workflow,
            ).values_list('id', 'file_hash'))

            already_set = set(
                DocumentExecutionRecord.objects.filter(
                    workflow=workflow,
                    nodes_config_hash=current_hash,
                    status='completed',
                ).values_list('document__id', 'file_hash')
            )
            already_executed = sum(
                1 for doc_id, fhash in all_docs
                if (doc_id, fhash or '') in already_set
            )

        return Response({
            'current_config_hash': current_hash,
            'last_executed_hash': last_record or '',
            'nodes_changed': nodes_changed,
            'total_documents': total_docs,
            'already_executed': already_executed,
            'pending_execution': total_docs - already_executed,
        })

    # -- Smart execution: per-document execution records ----------------------

    @action(detail=True, methods=['get'], url_path='execution-records')
    def execution_records(self, request, pk=None):
        """
        List per-document execution records (smart execution tracking).
        GET /api/clm/workflows/{id}/execution-records/
        ?limit=100&status=completed
        """
        from .models import DocumentExecutionRecord

        workflow = self.get_object()
        limit = int(request.query_params.get('limit', 100))
        qs = DocumentExecutionRecord.objects.filter(
            workflow=workflow,
        ).select_related('document', 'execution').order_by('-executed_at')

        status_filter = request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)

        records = qs[:limit]
        data = []
        for rec in records:
            data.append({
                'id': str(rec.id),
                'document_id': str(rec.document_id),
                'document_title': rec.document.title if rec.document else '',
                'file_hash': rec.file_hash,
                'nodes_config_hash': rec.nodes_config_hash,
                'execution_id': str(rec.execution_id) if rec.execution_id else None,
                'status': rec.status,
                'result_snapshot': rec.result_snapshot,
                'executed_at': rec.executed_at.isoformat() if rec.executed_at else None,
            })

        return Response({
            'records': data,
            'count': len(data),
        })

    # -- Node inspect (rich per-node execution detail) ---------------------

    @action(detail=True, methods=['get'], url_path='node-inspect/(?P<node_id>[0-9a-f-]+)')
    def node_inspect(self, request, pk=None, node_id=None):
        """
        Rich inspection data for a single node in the context of the
        latest (or specified) execution.

        GET /api/clm/workflows/{id}/node-inspect/{node_id}/
        ?execution_id=uuid  (optional — defaults to latest)

        Returns:
          - node config, type, label
          - execution result for this node
          - per-document detail: pass/fail status, metadata values,
            which conditions matched/failed (for rule nodes), AI results,
            action results, validation status
          - upstream / downstream node IDs
          - timing info
        """
        from .models import WorkflowExecution, WorkflowNode

        workflow = self.get_object()

        # Validate node belongs to this workflow
        try:
            node = WorkflowNode.objects.get(id=node_id, workflow=workflow)
        except WorkflowNode.DoesNotExist:
            return Response({'error': 'Node not found.'}, status=status.HTTP_404_NOT_FOUND)

        # Find execution
        exec_id = request.query_params.get('execution_id')
        if exec_id:
            try:
                execution = WorkflowExecution.objects.get(id=exec_id, workflow=workflow)
            except WorkflowExecution.DoesNotExist:
                return Response({'error': 'Execution not found.'}, status=status.HTTP_404_NOT_FOUND)
        else:
            execution = WorkflowExecution.objects.filter(
                workflow=workflow, status__in=['completed', 'partial', 'failed'],
            ).order_by('-started_at').first()

        # Build upstream / downstream from connections
        connections = list(workflow.connections.all())
        upstream_ids = [str(c.source_node_id) for c in connections if str(c.target_node_id) == str(node_id)]
        downstream_ids = [str(c.target_node_id) for c in connections if str(c.source_node_id) == str(node_id)]

        # Build upstream node labels
        all_nodes = {str(n.id): n for n in workflow.nodes.all()}
        upstream_nodes = [
            {'id': uid, 'label': all_nodes[uid].label or all_nodes[uid].node_type.title(), 'type': all_nodes[uid].node_type}
            for uid in upstream_ids if uid in all_nodes
        ]
        downstream_nodes = [
            {'id': did, 'label': all_nodes[did].label or all_nodes[did].node_type.title(), 'type': all_nodes[did].node_type}
            for did in downstream_ids if did in all_nodes
        ]

        # Base response
        response = {
            'node': {
                'id': str(node.id),
                'node_type': node.node_type,
                'label': node.label or node.node_type.title(),
                'config': node.config or {},
                'last_result': node.last_result or {},
                'position_x': node.position_x,
                'position_y': node.position_y,
            },
            'upstream': upstream_nodes,
            'downstream': downstream_nodes,
            'execution': None,
            'documents': [],
        }

        if not execution:
            return Response(response)

        # Execution meta
        result_data = execution.result_data or {}
        node_results = result_data.get('node_results', [])
        node_id_str = str(node_id)

        # Find this node's result in the execution
        this_nr = None
        for nr in node_results:
            if nr.get('node_id') == node_id_str:
                this_nr = nr
                break

        response['execution'] = {
            'id': str(execution.id),
            'status': execution.status,
            'mode': execution.mode,
            'started_at': execution.started_at.isoformat() if execution.started_at else None,
            'duration_ms': execution.duration_ms,
        }

        if not this_nr:
            return Response(response)

        # Determine incoming doc IDs (from upstream nodes)
        # Guard: ensure all IDs are strings (not dicts/UUIDs)
        def _str_ids(ids):
            return {str(i) if not isinstance(i, dict) else str(i.get('id', '')) for i in ids}

        upstream_doc_ids = set()
        for nr in node_results:
            if nr.get('node_id') in upstream_ids:
                upstream_doc_ids |= _str_ids(nr.get('document_ids', []))
        # For input nodes, incoming = output (they generate docs)
        if node.node_type == 'input':
            upstream_doc_ids = _str_ids(this_nr.get('document_ids', []))

        output_doc_ids = _str_ids(this_nr.get('document_ids', []))
        filtered_out_ids = upstream_doc_ids - output_doc_ids

        # Fetch actual document objects for enrichment
        all_doc_ids = list(upstream_doc_ids | output_doc_ids)
        docs_qs = WorkflowDocument.objects.filter(id__in=all_doc_ids)
        docs_map = {str(d.id): d for d in docs_qs}

        # Build per-document detail
        documents = []
        config = node.config or {}

        for doc_id in all_doc_ids:
            doc = docs_map.get(doc_id)
            if not doc:
                continue
            passed = doc_id in output_doc_ids
            doc_entry = {
                'id': doc_id,
                'title': doc.title or f'Doc {doc_id[:8]}…',
                'file_type': doc.file_type or '',
                'passed': passed,
                'reason': '',
                'details': {},
            }

            # ── Rule node: evaluate each condition against this doc ──
            if node.node_type == 'rule':
                from .node_executor import _eval_condition
                conditions = config.get('conditions', [])
                bool_op = config.get('boolean_operator', 'AND')
                combined_metadata = {}
                combined_metadata.update(doc.global_metadata or {})
                combined_metadata.update(doc.extracted_metadata or {})

                condition_results = []
                for c in conditions:
                    field = c.get('field', '')
                    operator = c.get('operator', 'eq')
                    value = c.get('value', '')
                    # Get the actual field value from metadata
                    from .node_executor import _get_nested_value
                    actual_value = _get_nested_value(combined_metadata, field)
                    result = _eval_condition(combined_metadata, field, operator, value)
                    condition_results.append({
                        'field': field,
                        'operator': operator,
                        'expected_value': value,
                        'actual_value': str(actual_value) if actual_value is not None else None,
                        'result': result,
                    })

                doc_entry['details']['conditions'] = condition_results
                doc_entry['details']['boolean_operator'] = bool_op
                all_passed = all(cr['result'] for cr in condition_results) if bool_op == 'AND' else any(cr['result'] for cr in condition_results)
                if not passed:
                    failed_conds = [cr for cr in condition_results if not cr['result']]
                    if failed_conds:
                        fc = failed_conds[0]
                        doc_entry['reason'] = f"{fc['field']} {fc['operator']} '{fc['expected_value']}' failed (actual: {fc['actual_value']})"
                else:
                    # Reason for passed docs
                    doc_entry['reason'] = f"All {len(condition_results)} condition{'s' if len(condition_results) != 1 else ''} matched ({bool_op})"

            # ── AI node: per-doc AI result + created fields ──
            if node.node_type == 'ai':
                ai_data = this_nr.get('ai', {})
                ai_per_doc = ai_data.get('results', [])

                # Determine which fields this AI node writes to the document
                ai_output_key = config.get('output_key', 'ai_analysis')
                ai_json_fields = config.get('json_fields', [])
                ai_output_format = config.get('output_format', 'text')

                # Read the actual values from the document's metadata
                doc_meta = doc.extracted_metadata or {}
                created_fields = {}
                if ai_output_format == 'json_extract' and ai_json_fields:
                    for jf in ai_json_fields:
                        # json_fields items can be dicts {"name": "...", ...} or plain strings
                        fname = jf.get('name', '').strip() if isinstance(jf, dict) else str(jf).strip()
                        if fname and fname in doc_meta:
                            created_fields[fname] = str(doc_meta[fname])[:120]
                elif ai_output_format == 'yes_no':
                    if ai_output_key in doc_meta:
                        created_fields[ai_output_key] = str(doc_meta[ai_output_key])[:120]
                else:  # text
                    if ai_output_key in doc_meta:
                        created_fields[ai_output_key] = str(doc_meta[ai_output_key])[:200]

                for r in ai_per_doc:
                    if str(r.get('document_id', '')) == doc_id:
                        doc_entry['details']['ai'] = {
                            'status': r.get('status', ''),
                            'model': ai_data.get('model', ''),
                            'output_format': r.get('output_format', ai_data.get('output_format', '')),
                            'response': r.get('response', ''),
                            'parsed_fields': r.get('parsed_fields'),
                            'answer': r.get('answer'),
                            'cache_hit': r.get('cache_hit', False),
                            'error': r.get('error', ''),
                            'created_fields': created_fields,
                            'output_key': ai_output_key,
                        }
                        if not passed and r.get('answer') == 'no':
                            doc_entry['reason'] = "AI answered 'NO' → filtered out"
                        elif passed:
                            if ai_output_format == 'yes_no':
                                doc_entry['reason'] = "AI answered 'YES' → passed"
                            elif created_fields:
                                doc_entry['reason'] = f"{len(created_fields)} field(s) extracted by AI"
                            else:
                                doc_entry['reason'] = "AI processed successfully"
                        break
                else:
                    # No per-doc result found but fields may exist from a previous run
                    if created_fields:
                        doc_entry['details']['ai'] = {
                            'status': 'previous_run',
                            'model': ai_data.get('model', ''),
                            'output_format': ai_output_format,
                            'created_fields': created_fields,
                            'output_key': ai_output_key,
                        }

            # ── Action node: per-doc action result ──
            if node.node_type == 'action':
                action_data = this_nr.get('action', {})
                action_per_doc = action_data.get('results', [])
                for r in action_per_doc:
                    if str(r.get('document_id', '')) == doc_id:
                        doc_entry['details']['action'] = {
                            'status': r.get('status', ''),
                            'plugin': action_data.get('plugin', ''),
                            'missing_fields': r.get('missing_fields', []),
                            'error_message': r.get('error_message', ''),
                            'plugin_response': r.get('plugin_response'),
                        }
                        if r.get('status') == 'failed':
                            doc_entry['reason'] = r.get('error_message', 'Action failed')
                        elif passed:
                            plugin_name = action_data.get('plugin', 'action')
                            doc_entry['reason'] = f"{plugin_name} completed successfully"
                        break

            # ── Validator node ──
            if node.node_type == 'validator':
                validator_data = this_nr.get('validator', {})
                doc_entry['details']['validator'] = {
                    'status': validator_data.get('status', ''),
                    'approved': validator_data.get('approved', 0),
                    'pending': validator_data.get('pending', 0),
                    'rejected': validator_data.get('rejected', 0),
                }
                if not passed:
                    doc_entry['reason'] = 'Pending approval or rejected'
                elif passed:
                    approved = validator_data.get('approved', 0)
                    doc_entry['reason'] = f"Approved ({approved} approval(s))"

            # ── Gate node ──
            if node.node_type == 'and_gate':
                gate_data = this_nr.get('gate', {})
                doc_entry['details']['gate'] = {
                    'gate_type': gate_data.get('gate_type', 'and'),
                    'status': gate_data.get('status', ''),
                    'message': gate_data.get('message', ''),
                }
                if not passed:
                    doc_entry['reason'] = 'Not present in all upstream paths'
                elif passed:
                    gate_type = gate_data.get('gate_type', 'and').upper()
                    doc_entry['reason'] = f"Present in all upstream paths ({gate_type} gate)"

            # ── Listener node ──
            if node.node_type == 'listener':
                listener_data = this_nr.get('listener', {})
                doc_entry['details']['listener'] = {
                    'status': listener_data.get('status', ''),
                    'event_id': listener_data.get('event_id'),
                    'message': listener_data.get('message', ''),
                }
                if not passed:
                    doc_entry['reason'] = listener_data.get('message', 'Listener gate blocked')
                elif passed:
                    doc_entry['reason'] = 'Event received — listener gate passed'

            # ── Input node: show extraction status + ALL metadata fields ──
            if node.node_type == 'input':
                meta = doc.extracted_metadata or {}
                global_meta = doc.global_metadata or {}

                # Build a rich field list with type detection
                all_fields = []
                for k, v in meta.items():
                    val_str = str(v) if v is not None else ''
                    val_type = 'text'
                    if isinstance(v, bool):
                        val_type = 'boolean'
                    elif isinstance(v, (int, float)):
                        val_type = 'number'
                    elif isinstance(v, list):
                        val_type = 'list'
                        val_str = ', '.join(str(i) for i in v) if v else ''
                    elif isinstance(v, dict):
                        val_type = 'object'
                        import json as _json
                        val_str = _json.dumps(v, default=str)[:500]
                    all_fields.append({
                        'key': k,
                        'value': val_str[:500],
                        'type': val_type,
                        'source': 'extracted',
                        'empty': v is None or val_str.strip() == '',
                    })

                # Include global_metadata (prefixed for clarity)
                for k, v in global_meta.items():
                    if k.startswith('_'):
                        continue  # skip internal keys
                    val_str = str(v) if v is not None else ''
                    all_fields.append({
                        'key': k,
                        'value': val_str[:500],
                        'type': 'text',
                        'source': 'global',
                        'empty': v is None or val_str.strip() == '',
                    })

                doc_entry['details']['input'] = {
                    'extraction_status': doc.extraction_status,
                    'document_type': global_meta.get('_document_type', ''),
                    'source': global_meta.get('_source', 'upload'),
                    'field_count': len(meta),
                    'global_field_count': len([k for k in global_meta if not k.startswith('_')]),
                    'top_fields': {k: str(v)[:80] for k, v in list(meta.items())[:8]},
                    'all_fields': all_fields,
                    'file_info': {
                        'file_type': doc.file_type or '',
                        'file_size': doc.file_size if hasattr(doc, 'file_size') else None,
                        'page_count': doc.page_count if hasattr(doc, 'page_count') else None,
                        'created_at': doc.created_at.isoformat() if doc.created_at else None,
                        'updated_at': doc.updated_at.isoformat() if doc.updated_at else None,
                    },
                }
                if passed:
                    field_count = len(meta)
                    doc_entry['reason'] = f"Uploaded — {field_count} field(s) extracted"

            # ── Scraper node: per-doc scraping results ──
            if node.node_type == 'scraper':
                scraper_data = this_nr.get('scraper', {})
                scraper_per_doc = scraper_data.get('results', [])
                scraper_urls = scraper_data.get('url_results', [])
                output_key = config.get('output_key', 'scraped_data')

                # Read the scraped data from the document's metadata
                scraped = (doc.extracted_metadata or {}).get(output_key, {})

                for r in scraper_per_doc:
                    if str(r.get('document_id', '')) == doc_id:
                        doc_entry['details']['scraper'] = {
                            'status': r.get('status', ''),
                            'keywords_found': r.get('keywords_found', 0),
                            'total_snippets': r.get('total_snippets', 0),
                            'urls_scraped': scraper_data.get('urls_scraped', 0),
                            'urls_blocked': scraper_data.get('urls_blocked', 0),
                            'urls_failed': scraper_data.get('urls_failed', 0),
                            'keywords': scraper_data.get('keywords', []),
                            'url_results': scraper_urls,
                            'output_key': output_key,
                            'scraped_urls': [
                                {
                                    'url': u.get('url', ''),
                                    'title': u.get('title', ''),
                                    'word_count': u.get('word_count', 0),
                                    'snippet_count': sum(len(v) for v in u.get('snippets', {}).values()),
                                }
                                for u in (scraped.get('urls', []) if isinstance(scraped, dict) else [])
                            ],
                        }
                        if passed:
                            kf = r.get('keywords_found', 0)
                            ts = r.get('total_snippets', 0)
                            doc_entry['reason'] = f"{kf} keyword(s) found, {ts} snippet(s) scraped"
                        break

            # ── Output node ──
            if node.node_type == 'output' and passed:
                doc_entry['reason'] = 'Reached output — workflow complete'

            # ── Doc Create node: per-doc creation result ──
            if node.node_type == 'doc_create':
                dc_data = this_nr.get('doc_create', {})
                dc_per_doc = dc_data.get('results', [])
                for r in dc_per_doc:
                    if str(r.get('source_document_id', '')) == doc_id:
                        dc_detail = {
                            'status': r.get('status', ''),
                            'creation_mode': r.get('creation_mode', ''),
                            'created_document_id': r.get('created_document_id'),
                            'created_document_title': r.get('created_document_title'),
                            'metadata_used': r.get('metadata_used', {}),
                            'missing_fields': r.get('missing_fields', []),
                            'error_message': r.get('error_message', ''),
                        }

                        # Enrich with live metadata from the created editor document
                        # (covers both new runs that include it and old runs that don't)
                        created_doc_id = r.get('created_document_id')
                        if created_doc_id:
                            from documents.models import Document as EditorDocument
                            try:
                                ed = EditorDocument.objects.get(id=created_doc_id)
                                cm = ed.custom_metadata if isinstance(ed.custom_metadata, dict) else {}
                                dm = ed.document_metadata if isinstance(ed.document_metadata, dict) else {}
                                display_cm = {
                                    k: v for k, v in cm.items()
                                    if k != 'processing_settings' and not k.startswith('_')
                                }
                                display_dm = {}
                                for k, v in dm.items():
                                    if isinstance(v, dict):
                                        for sk, sv in v.items():
                                            if sv is not None and str(sv).strip():
                                                display_dm[f'{k}.{sk}'] = sv
                                    elif v is not None and str(v).strip():
                                        display_dm[k] = v

                                dc_detail['created_document_metadata'] = {
                                    'title': ed.title,
                                    'document_type': ed.document_type,
                                    'category': getattr(ed, 'category', ''),
                                    'governing_law': getattr(ed, 'governing_law', '') or '',
                                    'jurisdiction': getattr(ed, 'jurisdiction', '') or '',
                                    'author': getattr(ed, 'author', '') or '',
                                    'custom_metadata': display_cm,
                                    'document_metadata': display_dm,
                                }
                            except Exception:
                                pass

                        doc_entry['details']['doc_create'] = dc_detail
                        if r.get('status') == 'created':
                            doc_entry['reason'] = f"Editor document created ({r.get('creation_mode', 'template')})"
                        elif r.get('status') == 'skipped':
                            missing = r.get('missing_fields', [])
                            doc_entry['reason'] = f"Skipped — missing: {', '.join(missing)}" if missing else 'Skipped'
                        elif r.get('status') == 'failed':
                            doc_entry['reason'] = r.get('error_message', 'Creation failed')
                        break

            documents.append(doc_entry)

        # Sort: passed first, then filtered
        documents.sort(key=lambda d: (not d['passed'], d['title']))

        # Node-level summary
        response['summary'] = {
            'total_incoming': len(upstream_doc_ids),
            'total_passed': len(output_doc_ids),
            'total_filtered': len(filtered_out_ids),
            'pass_rate': round(len(output_doc_ids) / max(len(upstream_doc_ids), 1) * 100, 1),
            # Include node-type specific summary data
            **({
                'model': this_nr.get('ai', {}).get('model', ''),
                'output_format': this_nr.get('ai', {}).get('output_format', ''),
                'cache_hits': this_nr.get('ai', {}).get('cache_hits', 0),
                'output_key': config.get('output_key', 'ai_analysis'),
                'json_fields': config.get('json_fields', []),
                'ai_fields_created': sorted({
                    str(fname)
                    for d in documents
                    if isinstance(d.get('details', {}).get('ai', {}).get('created_fields'), dict)
                    for fname in d['details']['ai']['created_fields']
                }),
            } if node.node_type == 'ai' else {}),
            **({
                'plugin': this_nr.get('action', {}).get('plugin', ''),
                'sent': this_nr.get('action', {}).get('sent', 0),
                'action_failed': this_nr.get('action', {}).get('failed', 0),
            } if node.node_type == 'action' else {}),
            **({
                'conditions_count': len(config.get('conditions', [])),
                'boolean_operator': config.get('boolean_operator', 'AND'),
                'conditions_preview': [
                    {
                        'field': c.get('field', ''),
                        'operator': c.get('operator', ''),
                        'value': c.get('value', ''),
                    }
                    for c in config.get('conditions', [])
                ],
            } if node.node_type == 'rule' else {}),
            **({
                'gate_type': this_nr.get('gate', {}).get('gate_type', 'and'),
                'blocked': this_nr.get('gate', {}).get('blocked', 0),
            } if node.node_type == 'and_gate' else {}),
            **({
                'urls_configured': len(config.get('urls', [])),
                'keywords': config.get('keywords', []),
                'output_key': config.get('output_key', 'scraped_data'),
                'urls_scraped': this_nr.get('scraper', {}).get('urls_scraped', 0),
                'urls_blocked': this_nr.get('scraper', {}).get('urls_blocked', 0),
                'urls_failed': this_nr.get('scraper', {}).get('urls_failed', 0),
                'total_snippets': this_nr.get('scraper', {}).get('total_snippets', 0),
            } if node.node_type == 'scraper' else {}),
            **({
                'creation_mode': this_nr.get('doc_create', {}).get('creation_mode', ''),
                'template': config.get('template', ''),
                'created': this_nr.get('doc_create', {}).get('created', 0),
                'skipped': this_nr.get('doc_create', {}).get('skipped', 0),
                'failed': this_nr.get('doc_create', {}).get('failed', 0),
                'created_document_ids': this_nr.get('doc_create', {}).get('created_document_ids', []),
            } if node.node_type == 'doc_create' else {}),
        }

        response['documents'] = documents

        return Response(response)

    # -- Document journey (trace through nodes) ----------------------------

    @action(detail=True, methods=['get'], url_path='document-journey/(?P<doc_id>[0-9a-f-]+)')
    def document_journey(self, request, pk=None, doc_id=None):
        """
        Trace a single document through the last (or specified) execution.
        GET /api/clm/workflows/{id}/document-journey/{doc_id}/
        ?execution_id=uuid  (optional — defaults to latest)

        Returns per-node pass/fail status + AI results for this document.
        """
        from .models import WorkflowExecution

        workflow = self.get_object()

        # Validate document exists
        try:
            doc = workflow.documents.get(id=doc_id)
        except WorkflowDocument.DoesNotExist:
            return Response({'error': 'Document not found.'}, status=status.HTTP_404_NOT_FOUND)

        # Find execution
        exec_id = request.query_params.get('execution_id')
        if exec_id:
            try:
                execution = WorkflowExecution.objects.get(id=exec_id, workflow=workflow)
            except WorkflowExecution.DoesNotExist:
                return Response({'error': 'Execution not found.'}, status=status.HTTP_404_NOT_FOUND)
        else:
            execution = WorkflowExecution.objects.filter(
                workflow=workflow, status__in=['completed', 'partial'],
            ).order_by('-started_at').first()
            if not execution:
                return Response({'error': 'No completed executions found.'}, status=status.HTTP_404_NOT_FOUND)

        result_data = execution.result_data or {}
        node_results = result_data.get('node_results', [])
        ai_results = result_data.get('ai_results', {})
        action_results = result_data.get('action_results', {})

        doc_id_str = str(doc_id)

        # Build per-node journey
        journey = []
        for nr in node_results:
            node_id = nr.get('node_id', '')
            doc_ids_in_node = nr.get('document_ids', [])
            passed = doc_id_str in doc_ids_in_node

            step = {
                'node_id': node_id,
                'node_type': nr.get('node_type', ''),
                'label': nr.get('label', ''),
                'passed': passed,
                'total_docs': nr.get('count', len(doc_ids_in_node)),
            }

            # AI results for this doc
            ai_data = nr.get('ai')
            if ai_data and ai_data.get('results'):
                for r in ai_data['results']:
                    if str(r.get('document_id', '')) == doc_id_str:
                        step['ai_result'] = {
                            'status': r.get('status', ''),
                            'model': ai_data.get('model', ''),
                            'output_format': r.get('output_format', ai_data.get('output_format', '')),
                            'response': r.get('response', ''),
                            'parsed_fields': r.get('parsed_fields'),
                            'answer': r.get('answer'),
                            'response_length': r.get('response_length'),
                            'error': r.get('error', ''),
                        }
                        break

            # Action results for this doc
            action_data = nr.get('action')
            if action_data and action_data.get('results'):
                for r in action_data['results']:
                    if str(r.get('document_id', '')) == doc_id_str:
                        step['action_result'] = {
                            'status': r.get('status', ''),
                            'plugin': action_data.get('plugin', ''),
                            'missing_fields': r.get('missing_fields', []),
                            'error_message': r.get('error_message', ''),
                            'message': r.get('plugin_response', {}).get('message', ''),
                        }
                        break

            # Validator results for this doc
            validator_data = nr.get('validator')
            if validator_data:
                step['validator_result'] = {
                    'status': validator_data.get('status', ''),
                    'approved': validator_data.get('approved', 0),
                    'pending': validator_data.get('pending', 0),
                    'rejected': validator_data.get('rejected', 0),
                }

            # Gate results for this doc
            gate_data = nr.get('gate')
            if gate_data:
                step['gate_result'] = {
                    'passed_count': gate_data.get('passed', 0),
                    'blocked_count': gate_data.get('blocked', 0),
                    'message': gate_data.get('message', ''),
                }

            journey.append(step)

        # Determine overall outcome
        output_doc_ids = result_data.get('output_documents', [])
        output_ids_flat = [str(d.get('id', '')) for d in output_doc_ids] if isinstance(output_doc_ids, list) and output_doc_ids and isinstance(output_doc_ids[0], dict) else [str(d) for d in output_doc_ids]
        reached_output = doc_id_str in output_ids_flat

        # Find first node where doc was filtered out
        filtered_at = None
        for i, step in enumerate(journey):
            if not step['passed'] and i > 0 and journey[i - 1]['passed']:
                filtered_at = step['label']
                break

        return Response({
            'document': {
                'id': str(doc.id),
                'title': doc.title,
                'file_type': doc.file_type,
            },
            'execution': {
                'id': str(execution.id),
                'status': execution.status,
                'mode': execution.mode,
                'started_at': execution.started_at.isoformat() if execution.started_at else None,
                'duration_ms': execution.duration_ms,
            },
            'journey': journey,
            'reached_output': reached_output,
            'filtered_at': filtered_at,
        })

    # -- Toggle auto-execute on upload --------------------------------------

    @action(detail=True, methods=['get', 'patch'], url_path='auto-execute')
    def auto_execute(self, request, pk=None):
        """
        GET: Get current auto-execute setting
        PATCH: Toggle auto-execute on upload
        PATCH { "auto_execute_on_upload": true|false }
        """
        workflow = self.get_object()

        if request.method == 'GET':
            return Response({
                'auto_execute_on_upload': workflow.auto_execute_on_upload,
            })

        enabled = request.data.get('auto_execute_on_upload')
        if enabled is not None:
            workflow.auto_execute_on_upload = bool(enabled)
            workflow.save(update_fields=['auto_execute_on_upload'])

        return Response({
            'auto_execute_on_upload': workflow.auto_execute_on_upload,
        })

    # -- Workflow Settings (validation, execution, general) -----------------

    @action(detail=True, methods=['get', 'patch'], url_path='workflow-settings')
    def workflow_settings(self, request, pk=None):
        """
        GET:   Return full workflow settings (workflow_settings JSON + trigger_mode).
        PATCH: Deep-merge incoming settings into workflow_settings, update trigger_mode.

        PATCH body:
        {
          "trigger_mode": "event",
          "settings": {
            "validation": { "approval_rule": "all", "require_note": true },
            "execution": { "retry_on_failure": true, "max_retries": 5 },
            "general": { "tags": ["contracts", "hr"], "color": "#10b981" }
          }
        }
        """
        workflow = self.get_object()

        if request.method == 'GET':
            return Response({
                'workflow_settings': workflow.workflow_settings or {},
                'trigger_mode': workflow.trigger_mode,
                'auto_execute_on_upload': workflow.auto_execute_on_upload,
                'is_live': workflow.is_live,
                'live_interval': workflow.live_interval,
            })

        update_fields = ['updated_at']

        # Merge settings (deep merge)
        incoming = request.data.get('settings')
        if incoming and isinstance(incoming, dict):
            current = dict(workflow.workflow_settings or {})
            for section_key, section_val in incoming.items():
                if isinstance(section_val, dict):
                    current.setdefault(section_key, {})
                    current[section_key].update(section_val)
                else:
                    current[section_key] = section_val
            workflow.workflow_settings = current
            update_fields.append('workflow_settings')

        # Trigger mode
        trigger_mode = request.data.get('trigger_mode')
        if trigger_mode and trigger_mode in dict(Workflow.TriggerMode.choices):
            workflow.trigger_mode = trigger_mode
            update_fields.append('trigger_mode')

        # Convenience: also allow toggling common fields here
        if 'auto_execute_on_upload' in request.data:
            workflow.auto_execute_on_upload = bool(request.data['auto_execute_on_upload'])
            update_fields.append('auto_execute_on_upload')
        if 'live_interval' in request.data:
            workflow.live_interval = max(int(request.data['live_interval']), 10)
            update_fields.append('live_interval')

        workflow.save(update_fields=update_fields)

        return Response({
            'workflow_settings': workflow.workflow_settings,
            'trigger_mode': workflow.trigger_mode,
            'auto_execute_on_upload': workflow.auto_execute_on_upload,
            'is_live': workflow.is_live,
            'live_interval': workflow.live_interval,
        })

    # -- Event Triggers (CRUD) ----------------------------------------------

    @action(detail=True, methods=['get', 'post'], url_path='event-triggers')
    def event_triggers(self, request, pk=None):
        """
        GET:  List all event triggers for this workflow.
        POST: Create a new event trigger.

        POST body:
        {
          "name": "Daily contract scan",
          "trigger_type": "schedule",
          "config": { "cron": "0 9 * * *", "timezone": "UTC" },
          "is_active": true
        }
        """
        from .models import WorkflowEventTrigger
        from .serializers import WorkflowEventTriggerSerializer

        workflow = self.get_object()

        if request.method == 'GET':
            triggers = workflow.event_triggers.all()
            serializer = WorkflowEventTriggerSerializer(triggers, many=True)
            return Response({
                'triggers': serializer.data,
                'trigger_mode': workflow.trigger_mode,
                'count': triggers.count(),
            })

        # POST — create
        data = request.data.copy()
        data['workflow'] = str(workflow.id)
        serializer = WorkflowEventTriggerSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        trigger = serializer.save(
            workflow=workflow,
            created_by=request.user if request.user.is_authenticated else None,
        )

        # If first event trigger and still manual mode, suggest switching
        active_count = workflow.event_triggers.filter(is_active=True).count()

        return Response({
            'trigger': WorkflowEventTriggerSerializer(trigger).data,
            'active_trigger_count': active_count,
            'message': f'Trigger "{trigger.name or trigger.get_trigger_type_display()}" created.',
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['patch', 'delete'], url_path=r'event-triggers/(?P<trigger_id>[0-9a-f-]+)')
    def event_trigger_detail(self, request, pk=None, trigger_id=None):
        """
        PATCH:  Update an event trigger.
        DELETE: Delete an event trigger.
        """
        from .models import WorkflowEventTrigger
        from .serializers import WorkflowEventTriggerSerializer

        workflow = self.get_object()

        try:
            trigger = WorkflowEventTrigger.objects.get(
                id=trigger_id, workflow=workflow,
            )
        except WorkflowEventTrigger.DoesNotExist:
            return Response(
                {'error': 'Trigger not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if request.method == 'DELETE':
            trigger.delete()
            return Response({
                'success': True,
                'message': 'Trigger deleted.',
            })

        # PATCH
        serializer = WorkflowEventTriggerSerializer(
            trigger, data=request.data, partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()

        return Response({
            'trigger': serializer.data,
            'message': 'Trigger updated.',
        })

    # -- Available trigger types (for frontend dropdown) --------------------

    @action(detail=False, methods=['get'], url_path='trigger-types')
    def trigger_types(self, request):
        """
        GET /api/clm/workflows/trigger-types/
        Returns available trigger types with their config schemas.
        """
        from .models import WorkflowEventTrigger

        types = []
        config_schemas = {
            'webhook': {
                'description': 'Receive HTTP POST from external systems',
                'fields': [
                    {'key': 'secret', 'label': 'Webhook Secret', 'type': 'password', 'required': False},
                    {'key': 'headers_filter', 'label': 'Required Headers (JSON)', 'type': 'json', 'required': False},
                ],
            },
            'schedule': {
                'description': 'Run on a time-based schedule',
                'fields': [
                    {'key': 'cron', 'label': 'Cron Expression', 'type': 'text', 'required': True, 'placeholder': '0 9 * * *'},
                    {'key': 'timezone', 'label': 'Timezone', 'type': 'text', 'required': False, 'default': 'UTC'},
                    {'key': 'enabled_days', 'label': 'Enabled Days (1=Mon)', 'type': 'multiselect', 'options': [1,2,3,4,5,6,7], 'required': False},
                ],
            },
            'file_upload': {
                'description': 'Trigger when a file is uploaded',
                'fields': [
                    {'key': 'file_types', 'label': 'Accepted File Types', 'type': 'tags', 'required': False, 'placeholder': 'pdf, docx, txt'},
                    {'key': 'min_files', 'label': 'Minimum Files', 'type': 'number', 'required': False, 'default': 1},
                ],
            },
            'email': {
                'description': 'Trigger when an email arrives',
                'fields': [
                    {'key': 'inbox', 'label': 'Inbox Address', 'type': 'email', 'required': True},
                    {'key': 'subject_filter', 'label': 'Subject Filter (glob)', 'type': 'text', 'required': False, 'placeholder': 'Invoice*'},
                    {'key': 'from_filter', 'label': 'From Filter', 'type': 'text', 'required': False},
                ],
            },
            'sheet_update': {
                'description': 'Trigger when a linked Sheet is updated',
                'fields': [
                    {'key': 'sheet_id', 'label': 'Sheet ID', 'type': 'text', 'required': True},
                    {'key': 'trigger_on', 'label': 'Trigger On', 'type': 'select', 'options': ['row_created', 'row_updated', 'any'], 'default': 'any'},
                ],
            },
            'field_change': {
                'description': 'Trigger when a specific field value changes',
                'fields': [
                    {'key': 'field_name', 'label': 'Field Name', 'type': 'text', 'required': True},
                    {'key': 'condition', 'label': 'Condition', 'type': 'select', 'options': ['changed', 'gt', 'lt', 'eq', 'contains'], 'default': 'changed'},
                    {'key': 'threshold', 'label': 'Threshold Value', 'type': 'text', 'required': False},
                ],
            },
            'document_status': {
                'description': 'Trigger when document extraction completes or fails',
                'fields': [
                    {'key': 'status', 'label': 'Status', 'type': 'select', 'options': ['completed', 'failed', 'any'], 'default': 'completed'},
                ],
            },
            'api_call': {
                'description': 'Trigger via API call with custom payload',
                'fields': [
                    {'key': 'expected_payload_keys', 'label': 'Expected Payload Keys', 'type': 'tags', 'required': False},
                ],
            },
            'manual': {
                'description': 'Manual button-click only',
                'fields': [],
            },
        }

        for choice_val, choice_label in WorkflowEventTrigger.TriggerType.choices:
            types.append({
                'value': choice_val,
                'label': choice_label,
                'config_schema': config_schemas.get(choice_val, {'description': '', 'fields': []}),
            })

        return Response({
            'trigger_types': types,
            'trigger_modes': [
                {'value': v, 'label': l}
                for v, l in Workflow.TriggerMode.choices
            ],
        })

    # -- Webhook: Ingest document and auto-execute --------------------------

    @action(detail=True, methods=['post'], url_path='webhook-ingest')
    def webhook_ingest(self, request, pk=None):
        """
        Webhook endpoint for external systems / plugins / listeners.
        Accepts a document upload, saves it, runs AI extraction,
        then auto-executes the full workflow pipeline.

        POST /api/clm/workflows/{id}/webhook-ingest/
        Body: multipart/form-data with file(s) or JSON with direct_text.
          - file: uploaded document (PDF, DOCX, TXT)
          - title: optional document title
          - direct_text: optional raw text (if no file)
          - metadata: optional JSON string of extra metadata
          - execute: "true" (default) or "false" to skip execution
        """
        from .node_executor import execute_workflow

        workflow = self.get_object()
        org = _get_org(request)

        # Accept file upload or direct text
        files = request.FILES.getlist('files') or [request.FILES.get('file')]
        files = [f for f in files if f]
        direct_text = request.data.get('direct_text', '')
        title = request.data.get('title', '')
        should_execute = str(request.data.get('execute', 'true')).lower() != 'false'

        # Parse optional metadata
        extra_metadata = {}
        meta_raw = request.data.get('metadata')
        if meta_raw:
            import json
            try:
                extra_metadata = json.loads(meta_raw) if isinstance(meta_raw, str) else meta_raw
            except (json.JSONDecodeError, TypeError):
                pass

        if not files and not direct_text:
            return Response(
                {'error': 'Provide at least one file or direct_text.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        created = []

        # Handle file uploads
        for f in files:
            ext = f.name.rsplit('.', 1)[-1].lower() if '.' in f.name else 'pdf'
            file_type = ext if ext in ('pdf', 'docx', 'doc', 'txt') else 'pdf'

            doc = WorkflowDocument.objects.create(
                workflow=workflow,
                organization=org,
                title=title or f.name,
                file=f,
                file_type=file_type,
                file_size=f.size,
                uploaded_by=request.user if request.user.is_authenticated else None,
                global_metadata={**extra_metadata, '_source': 'webhook'},
            )

            # Mark as completed — extraction handled by AI extract nodes
            doc.extraction_status = 'completed'
            doc.save(update_fields=['extraction_status'])

            created.append(doc)

        # Handle direct text (no file)
        if not files and direct_text:
            doc = WorkflowDocument.objects.create(
                workflow=workflow,
                organization=org,
                title=title or 'Webhook Document',
                file_type='txt',
                file_size=len(direct_text.encode('utf-8')),
                direct_text=direct_text,
                text_source='direct',
                uploaded_by=request.user if request.user.is_authenticated else None,
                global_metadata={**extra_metadata, '_source': 'webhook'},
            )

            # Mark as completed — extraction handled by AI extract nodes
            doc.extraction_status = 'completed'
            doc.save(update_fields=['extraction_status'])

            created.append(doc)

        # Auto-execute the workflow
        execution_result = None
        if should_execute and created:
            try:
                execution_result = execute_workflow(
                    workflow,
                    triggered_by=request.user if request.user.is_authenticated else None,
                    mode='auto',
                )
            except Exception as e:
                logger.error(f"Webhook auto-execute failed for workflow {workflow.id}: {e}")
                execution_result = {'error': str(e)}

        return Response({
            'documents': WorkflowDocumentSerializer(created, many=True).data,
            'document_count': len(created),
            'execution': execution_result,
            'webhook_url': request.build_absolute_uri(),
        }, status=status.HTTP_201_CREATED)

    # -- Action: List available plugins -------------------------------------

    @action(detail=False, methods=['get'], url_path='action-plugins')
    def action_plugins(self, request):
        """
        List all available action plugins with their metadata,
        required fields, settings schema, etc.
        GET /api/clm/workflows/action-plugins/
        """
        from .action_plugins import list_plugins
        plugins = list_plugins()

        # Also include any DB-registered plugins
        db_plugins = ActionPlugin.objects.filter(is_active=True)
        db_names = {p['name'] for p in plugins}

        for dbp in db_plugins:
            if dbp.name not in db_names:
                plugins.append(ActionPluginSerializer(dbp).data)

        return Response({
            'plugins': plugins,
            'count': len(plugins),
        })

    # -- Input Plugins: List / Configure ------------------------------------

    @action(detail=False, methods=['get'], url_path='input-plugins')
    def input_plugins_list(self, request):
        """
        List available input node plugins with metadata.
        Query params:
          ?type=processing  — only pipeline plugins (normalize, validate, …)
          ?type=integration — only integration plugins (webhook, gmail, slack, teams)
          (omit for all)
        GET /api/clm/workflows/input-plugins/
        """
        plugin_type = request.query_params.get('type')
        if plugin_type == 'processing':
            from .input_plugins import list_processing_plugins
            plugins = list_processing_plugins()
        elif plugin_type == 'integration':
            from .input_plugins import list_integration_plugins
            plugins = list_integration_plugins()
        else:
            from .input_plugins import list_plugins as list_input_plugins
            plugins = list_input_plugins()
        return Response({
            'plugins': plugins,
            'count': len(plugins),
        })

    @action(detail=False, methods=['get'], url_path='input-plugins/integrations')
    def input_plugins_integrations(self, request):
        """
        List integration plugins that can serve as input_type on nodes.
        Includes org-level enabled/disabled status from OrganizationDocumentSettings.
        GET /api/clm/workflows/input-plugins/integrations/
        """
        from .input_plugins import list_integration_plugins
        plugins = list_integration_plugins()

        # Read org-level enabled state
        org = request.user.profile.organization if hasattr(request.user, 'profile') else None
        org_enabled = {}
        if org:
            try:
                from user_management.models import OrganizationDocumentSettings
                settings_obj, _ = OrganizationDocumentSettings.objects.get_or_create(
                    organization=org,
                )
                org_enabled = (settings_obj.preferences or {}).get('clm_integration_plugins', {})
            except Exception:
                pass

        enriched = []
        for p in plugins:
            enriched.append({
                **p,
                'org_enabled': org_enabled.get(p['name'], p.get('default_enabled', False)),
            })

        return Response({
            'plugins': enriched,
            'count': len(enriched),
        })

    @action(detail=False, methods=['get', 'patch'], url_path='input-plugins/integration-settings')
    def input_plugins_integration_settings(self, request):
        """
        GET:   Read org-level integration plugin enable/disable settings.
        PATCH: Update org-level integration plugin enable/disable settings.

        Body (PATCH): { "plugins": { "webhook": true, "gmail": false, "slack": true, "teams": false } }

        GET  /api/clm/workflows/input-plugins/integration-settings/
        PATCH /api/clm/workflows/input-plugins/integration-settings/
        """
        org = request.user.profile.organization if hasattr(request.user, 'profile') else None
        if not org:
            return Response({'error': 'Organization not found.'}, status=status.HTTP_400_BAD_REQUEST)

        from user_management.models import OrganizationDocumentSettings
        settings_obj, _ = OrganizationDocumentSettings.objects.get_or_create(organization=org)
        prefs = dict(settings_obj.preferences or {})

        if request.method == 'GET':
            from .input_plugins import list_integration_plugins
            all_integrations = list_integration_plugins()
            current = prefs.get('clm_integration_plugins', {})
            result = {}
            for p in all_integrations:
                result[p['name']] = {
                    'enabled': current.get(p['name'], p.get('default_enabled', False)),
                    'display_name': p['display_name'],
                    'description': p['description'],
                    'icon': p['icon'],
                }
            return Response({'plugins': result})

        # PATCH
        new_settings = request.data.get('plugins')
        if new_settings is None:
            return Response(
                {'error': 'Body must include "plugins" object.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from .input_plugins import list_integration_plugins
        valid_names = {p['name'] for p in list_integration_plugins()}
        current = prefs.get('clm_integration_plugins', {})
        for name, enabled in new_settings.items():
            if name in valid_names:
                current[name] = bool(enabled)

        prefs['clm_integration_plugins'] = current
        settings_obj.preferences = prefs
        settings_obj.save(update_fields=['preferences'])

        return Response({
            'plugins': current,
            'message': 'Integration plugin settings updated.',
        })

    @action(detail=True, methods=['get', 'patch'], url_path='input-plugins/config')
    def input_plugins_config(self, request, pk=None):
        """
        GET:   Read the processing plugin configuration for a specific input node.
               Only returns processing plugins (not integration plugins).
        PATCH: Update the processing plugin configuration for a specific input node.

        Query params (GET/PATCH): ?node_id=<uuid>
        Body (PATCH): { "plugins": [ {"name": "...", "enabled": true, "priority": 10, "settings": {...}} ] }

        GET  /api/clm/workflows/<id>/input-plugins/config/?node_id=<uuid>
        PATCH /api/clm/workflows/<id>/input-plugins/config/?node_id=<uuid>
        """
        workflow = self.get_object()
        node_id = request.query_params.get('node_id') or request.data.get('node_id')

        if not node_id:
            return Response(
                {'error': 'node_id query parameter is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            node = workflow.nodes.get(id=node_id, node_type='input')
        except WorkflowNode.DoesNotExist:
            return Response(
                {'error': f'Input node {node_id} not found in this workflow.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if request.method == 'GET':
            # Return current plugin config (or defaults) — only processing plugins
            from .input_plugins.pipeline import _get_node_plugin_config
            from .input_plugins import get_plugin_info
            current_config = _get_node_plugin_config(node)

            enriched = []
            for pc in current_config:
                info = get_plugin_info(pc['name']) or {}
                # Skip integration plugins — they are configured as input_type, not here
                if info.get('plugin_type') == 'integration':
                    continue
                enriched.append({
                    **info,
                    **pc,
                    'display_name': info.get('display_name', pc['name']),
                    'description': info.get('description', ''),
                    'icon': info.get('icon', '🔌'),
                    'category': info.get('category', 'custom'),
                    'hooks': info.get('hooks', []),
                    'settings_schema': info.get('settings_schema', {}),
                })

            return Response({
                'node_id': str(node.id),
                'node_label': node.label,
                'plugins': enriched,
            })

        # PATCH — update config (only accept processing plugins)
        new_plugins = request.data.get('plugins')
        if new_plugins is None:
            return Response(
                {'error': 'Body must include "plugins" array.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate plugin names — only processing plugins allowed here
        from .input_plugins import PLUGIN_REGISTRY
        valid_names = {
            name for name, info in PLUGIN_REGISTRY.items()
            if info.get('plugin_type', 'processing') == 'processing'
        }
        for pc in new_plugins:
            pname = pc.get('name', '')
            if pname not in valid_names:
                return Response(
                    {'error': f'Unknown or non-processing plugin: "{pname}". Valid: {sorted(valid_names)}'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Store in node.config.input_plugins
        config = dict(node.config or {})
        config['input_plugins'] = new_plugins
        node.config = config
        node.save(update_fields=['config'])

        return Response({
            'node_id': str(node.id),
            'plugins': new_plugins,
            'message': 'Input plugin configuration updated.',
        })

    @action(detail=True, methods=['post'], url_path='input-plugins/run')
    def input_plugins_run(self, request, pk=None):
        """
        Manually run the input plugin pipeline on all completed documents
        for a specific input node.  Useful for re-processing after config change.
        POST /api/clm/workflows/<id>/input-plugins/run/?node_id=<uuid>
        """
        workflow = self.get_object()
        node_id = request.query_params.get('node_id') or request.data.get('node_id')
        force = request.data.get('force', False)

        if not node_id:
            return Response(
                {'error': 'node_id is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            node = workflow.nodes.get(id=node_id, node_type='input')
        except WorkflowNode.DoesNotExist:
            return Response(
                {'error': f'Input node {node_id} not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        from .input_plugins.pipeline import run_post_pipeline, run_batch_complete

        docs = WorkflowDocument.objects.filter(
            workflow=workflow,
            input_node=node,
            extraction_status='completed',
        )
        if not force:
            docs = docs.exclude(global_metadata___plugin_processed=True)

        results = []
        for doc in docs:
            try:
                pr = run_post_pipeline(node=node, document=doc)
                gm = dict(doc.global_metadata or {})
                gm['_plugin_processed'] = True
                if pr.plugin_log:
                    gm['_plugin_log'] = pr.plugin_log
                doc.global_metadata = gm
                doc.save(update_fields=['global_metadata'])
                results.append({
                    'document_id': str(doc.id),
                    'title': doc.title,
                    'status': 'processed',
                    'issues': len(pr.issues),
                    'stage_reached': pr.stage_reached,
                })
            except Exception as e:
                results.append({
                    'document_id': str(doc.id),
                    'title': doc.title,
                    'status': 'error',
                    'error': str(e),
                })

        processed = [r for r in results if r['status'] == 'processed']
        if processed:
            docs_list = list(docs)
            run_batch_complete(
                node=node,
                documents=docs_list,
                stats={
                    'total': len(results),
                    'ready': len(processed),
                    'rejected': 0,
                    'failed': len(results) - len(processed),
                    'issues': sum(r.get('issues', 0) for r in processed),
                },
            )

        return Response({
            'node_id': str(node.id),
            'results': results,
            'processed': len(processed),
            'errors': len(results) - len(processed),
        })

    # -- AI: List available AI models ----------------------------------------

    @action(detail=False, methods=['get'], url_path='ai-models')
    def ai_models(self, request):
        """
        List all available AI models for the AI node.
        GET /api/clm/workflows/ai-models/
        """
        from .ai_node_executor import list_ai_models
        models = list_ai_models()
        return Response({
            'models': models,
            'count': len(models),
        })

    # -- Document types: DEPRECATED — extraction is now handled by AI extract nodes
    # This endpoint is kept for backward compatibility but returns an empty list.

    @action(detail=False, methods=['get'], url_path='document-types')
    def document_types(self, request):
        """
        DEPRECATED: Document types are no longer used for input node
        metadata extraction. Extraction is handled by dedicated AI extract
        nodes in the workflow.
        GET /api/clm/workflows/document-types/
        """
        return Response({
            'document_types': [],
            'count': 0,
            'deprecated': True,
            'message': 'Document type-based extraction has been removed. Use AI extract nodes instead.',
        })

    # -- Action: Execute action node manually --------------------------------

    @action(detail=True, methods=['post'], url_path='execute-action/(?P<node_id>[0-9a-f-]+)')
    def execute_action(self, request, pk=None, node_id=None):
        """
        Execute a single action node against its incoming documents.
        The action node runs its plugin for each document in a for-loop.
        POST /api/clm/workflows/{id}/execute-action/{node_id}/
        Optionally: { "document_ids": [...] } to limit to specific docs.
        """
        from .action_executor import execute_action_node

        workflow = self.get_object()
        try:
            node = workflow.nodes.get(id=node_id, node_type='action')
        except WorkflowNode.DoesNotExist:
            return Response(
                {'error': 'Action node not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Determine which documents to process
        doc_ids = request.data.get('document_ids')
        if doc_ids:
            document_ids = doc_ids
        elif node.last_result and node.last_result.get('document_ids'):
            # Use cached incoming documents from last workflow execution
            document_ids = node.last_result['document_ids']
        else:
            # Fallback: all completed documents
            document_ids = list(
                workflow.documents.filter(extraction_status='completed')
                .values_list('id', flat=True)
            )

        result = execute_action_node(
            node=node,
            incoming_document_ids=document_ids,
            triggered_by=request.user,
        )

        return Response(result)

    # -- Action: Get execution results --------------------------------------

    @action(detail=True, methods=['get'], url_path='action-results')
    def action_results(self, request, pk=None):
        """
        Get all action execution results for this workflow.
        GET /api/clm/workflows/{id}/action-results/
        Optional: ?node_id=uuid &status=completed|partial|failed
        """
        workflow = self.get_object()
        executions = ActionExecution.objects.filter(
            workflow=workflow,
        ).select_related('plugin', 'node').prefetch_related('results__document')

        node_id = request.query_params.get('node_id')
        if node_id:
            executions = executions.filter(node_id=node_id)

        exec_status = request.query_params.get('status')
        if exec_status:
            executions = executions.filter(status=exec_status)

        return Response({
            'executions': ActionExecutionSerializer(executions, many=True).data,
            'count': executions.count(),
        })

    # -- Action: Get single execution detail --------------------------------

    @action(detail=True, methods=['get'], url_path='action-execution/(?P<exec_id>[0-9a-f-]+)')
    def action_execution_detail(self, request, pk=None, exec_id=None):
        """
        Get detailed results for a single action execution.
        GET /api/clm/workflows/{id}/action-execution/{exec_id}/
        """
        workflow = self.get_object()
        try:
            execution = ActionExecution.objects.select_related(
                'plugin', 'node',
            ).prefetch_related('results__document').get(
                id=exec_id, workflow=workflow,
            )
        except ActionExecution.DoesNotExist:
            return Response(
                {'error': 'Execution not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(ActionExecutionSerializer(execution).data)

    # -- Action: Retry a single result --------------------------------------

    @action(detail=True, methods=['post'], url_path='action-retry')
    def action_retry(self, request, pk=None):
        """
        Retry a single skipped/failed action result.
        POST { "result_id": "uuid", "override_data": {"email": "new@example.com"} }
        """
        from .action_executor import retry_action_result

        workflow = self.get_object()  # permission check
        ser = ActionRetrySerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        result_id = str(ser.validated_data['result_id'])
        override_data = ser.validated_data.get('override_data', {})

        # Verify the result belongs to this workflow
        try:
            ActionExecutionResult.objects.get(
                id=result_id,
                execution__workflow=workflow,
            )
        except ActionExecutionResult.DoesNotExist:
            return Response(
                {'error': 'Result not found in this workflow.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        result = retry_action_result(result_id, override_data)
        return Response(result)

    # -- Action: Retry all skipped/failed in an execution -------------------

    @action(detail=True, methods=['post'], url_path='action-retry-all/(?P<exec_id>[0-9a-f-]+)')
    def action_retry_all(self, request, pk=None, exec_id=None):
        """
        Retry all skipped/failed results in an execution.
        POST /api/clm/workflows/{id}/action-retry-all/{exec_id}/
        """
        from .action_executor import retry_action_result

        workflow = self.get_object()
        try:
            execution = ActionExecution.objects.get(
                id=exec_id, workflow=workflow,
            )
        except ActionExecution.DoesNotExist:
            return Response(
                {'error': 'Execution not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        results_to_retry = execution.results.filter(
            status__in=['skipped', 'failed'],
        )

        retried = []
        for result in results_to_retry:
            res = retry_action_result(str(result.id))
            retried.append(res)

        return Response({
            'retried': len(retried),
            'results': retried,
        })

    # -- Document Creator: Get creation results -----------------------------

    @action(detail=True, methods=['get'], url_path='doc-create-results')
    def doc_create_results(self, request, pk=None):
        """
        Get all document creation results for this workflow.
        GET /api/clm/workflows/{id}/doc-create-results/
        Optional: ?node_id=uuid &status=created|skipped|failed &mode=template|duplicate|quick_latex|structured
        """
        from .models import DocumentCreationResult
        from .serializers import DocumentCreationResultSerializer

        workflow = self.get_object()
        qs = DocumentCreationResult.objects.filter(
            workflow=workflow,
        ).select_related(
            'node', 'source_clm_document', 'created_document',
        )

        node_id = request.query_params.get('node_id')
        if node_id:
            qs = qs.filter(node_id=node_id)

        result_status = request.query_params.get('status')
        if result_status:
            qs = qs.filter(status=result_status)

        mode = request.query_params.get('mode')
        if mode:
            qs = qs.filter(creation_mode=mode)

        return Response({
            'results': DocumentCreationResultSerializer(qs, many=True).data,
            'count': qs.count(),
        })

    # -- Editor templates (for doc_create node config) ----------------------

    @action(detail=False, methods=['get'], url_path='editor-templates')
    def editor_templates(self, request):
        """
        List all available document editor templates that doc_create nodes
        can use.  Returns template names, titles, placeholders, and sections.
        GET /api/clm/workflows/editor-templates/
        """
        from documents.document_drafter import DocumentDrafter

        templates = DocumentDrafter.get_available_templates()
        # Enrich each template with its placeholder list
        for t in templates:
            t['placeholders'] = DocumentDrafter.get_template_placeholders(t['key'])
        return Response({'templates': templates})

    # -- Editor document field schema (for doc_create mapping step) ---------

    @action(detail=False, methods=['get'],
            url_path=r'editor-document-fields/(?P<doc_id>[0-9a-f-]+)')
    def editor_document_fields(self, request, doc_id=None):
        """
        Return all settable field keys for a specific editor document,
        grouped by category.  Used by the doc_create wizard to let users
        pick mapping targets.

        GET /api/clm/workflows/editor-document-fields/<doc_id>/

        Response::
            {
                "document_id": "<uuid>",
                "title": "Service Agreement",
                "custom_metadata_keys": ["processing_settings", "client_ref", …],
                "document_metadata_keys": ["financial.contract_value", …],
                "direct_fields": ["title", "document_type", …],
                "all_keys_flat": ["title", "custom_metadata.client_ref", …]
            }
        """
        from documents.models import Document

        try:
            doc = Document.objects.get(id=doc_id)
        except Document.DoesNotExist:
            return Response({'error': 'Document not found'}, status=404)

        # Direct model fields that are settable
        from clm.document_creator_executor import DIRECT_DOCUMENT_FIELDS
        direct = sorted(DIRECT_DOCUMENT_FIELDS)

        # custom_metadata keys (flatten one level)
        cm = doc.custom_metadata if isinstance(doc.custom_metadata, dict) else {}
        cm_keys = sorted(cm.keys())

        # document_metadata keys (flatten with dot notation)
        dm = doc.document_metadata if isinstance(doc.document_metadata, dict) else {}
        dm_keys = []
        def _flatten(prefix, d):
            for k, v in d.items():
                key = f'{prefix}.{k}' if prefix else k
                if isinstance(v, dict):
                    _flatten(key, v)
                else:
                    dm_keys.append(key)
        _flatten('', dm)
        dm_keys.sort()

        # Build flat list with prefixes for the frontend
        all_flat = list(direct)
        all_flat += [f'custom_metadata.{k}' for k in cm_keys]
        all_flat += [f'document_metadata.{k}' for k in dm_keys]

        return Response({
            'document_id': str(doc.id),
            'title': doc.title,
            'document_type': doc.document_type,
            'document_mode': doc.document_mode,
            'custom_metadata_keys': cm_keys,
            'custom_metadata': cm,  # full dict so wizard can show values
            'document_metadata_keys': dm_keys,
            'direct_fields': direct,
            'all_keys_flat': sorted(all_flat),
        })

    # -- Editor documents list (for doc_create duplicate mode) --------------

    @action(detail=False, methods=['get'], url_path='editor-documents')
    def editor_documents(self, request):
        """
        Search existing editor documents for use as duplicate / quick-latex
        clone sources in doc_create nodes.

        GET /api/clm/workflows/editor-documents/
            ?search=service+contract
            &mode=standard|quick_latex
            &type=contract|nda|...
            &category=contract|nda|...
            &sort=relevance|recent|title
            &limit=30

        Returns documents with title, type, mode, section_count, dates,
        and a content_preview snippet if search is active.
        """
        from django.db.models import Q, Value, IntegerField, Case, When
        from documents.models import Document, Section

        org = _get_org(request)
        if not org:
            return Response({'documents': [], 'total': 0})

        qs = Document.objects.filter(
            created_by__profile__organization=org,
        )

        # ── Filters ──
        mode = request.query_params.get('mode', '').strip()
        if mode:
            qs = qs.filter(document_mode=mode)

        doc_type = request.query_params.get('type', '').strip()
        if doc_type:
            qs = qs.filter(document_type=doc_type)

        category = request.query_params.get('category', '').strip()
        if category:
            qs = qs.filter(category=category)

        # ── Multi-field search with relevance scoring ──
        search = request.query_params.get('search', '').strip()
        if search:
            terms = search.split()
            # Build Q objects for each term across multiple fields
            term_qs = Q()
            for term in terms:
                term_qs &= (
                    Q(title__icontains=term) |
                    Q(document_type__icontains=term) |
                    Q(category__icontains=term) |
                    Q(author__icontains=term) |
                    Q(governing_law__icontains=term) |
                    Q(jurisdiction__icontains=term) |
                    Q(project_name__icontains=term) |
                    Q(sections__title__icontains=term) |
                    Q(sections__content_text__icontains=term)
                )
            qs = qs.filter(term_qs).distinct()

            # Relevance scoring: title match ranks higher
            qs = qs.annotate(
                relevance=Case(
                    When(title__icontains=search, then=Value(3)),
                    When(document_type__icontains=search, then=Value(2)),
                    When(category__icontains=search, then=Value(2)),
                    default=Value(1),
                    output_field=IntegerField(),
                ),
            )

        # ── Sort ──
        sort = request.query_params.get('sort', 'recent').strip()
        if search and sort == 'relevance':
            qs = qs.order_by('-relevance', '-updated_at')
        elif sort == 'title':
            qs = qs.order_by('title', '-updated_at')
        else:
            qs = qs.order_by('-updated_at')

        total = qs.count()
        limit = min(int(request.query_params.get('limit', 30)), 100)
        docs_qs = qs[:limit]

        # ── Build response with enriched data ──
        results = []
        for doc in docs_qs.select_related('created_by').only(
            'id', 'title', 'document_type', 'document_mode', 'category',
            'status', 'updated_at', 'created_at', 'author',
            'governing_law', 'jurisdiction', 'is_latex_code',
            'created_by__username', 'created_by__first_name', 'created_by__last_name',
        ):
            section_count = Section.objects.filter(document=doc).count()

            entry = {
                'id': str(doc.id),
                'title': doc.title,
                'document_type': doc.document_type,
                'document_mode': doc.document_mode,
                'category': doc.category or '',
                'status': doc.status,
                'is_latex': doc.is_latex_code,
                'section_count': section_count,
                'author': doc.author or '',
                'governing_law': doc.governing_law or '',
                'jurisdiction': doc.jurisdiction or '',
                'updated_at': doc.updated_at.isoformat() if doc.updated_at else None,
                'created_at': doc.created_at.isoformat() if doc.created_at else None,
                'created_by': (
                    doc.created_by.get_full_name() or doc.created_by.username
                ) if doc.created_by else '',
            }

            # Content preview: first matching section snippet for search
            if search:
                matching_section = Section.objects.filter(
                    document=doc,
                ).filter(
                    Q(title__icontains=search) |
                    Q(content_text__icontains=search)
                ).first()
                if matching_section:
                    text = matching_section.content_text or ''
                    # Find the search term position and extract surrounding context
                    lower = text.lower()
                    idx = lower.find(search.lower())
                    if idx >= 0:
                        start = max(0, idx - 60)
                        end = min(len(text), idx + len(search) + 60)
                        snippet = text[start:end].strip()
                        if start > 0:
                            snippet = '…' + snippet
                        if end < len(text):
                            snippet = snippet + '…'
                        entry['content_preview'] = snippet
                    else:
                        entry['content_preview'] = text[:150]
                    entry['matching_section'] = matching_section.title
            else:
                # No search — just show first section title
                first_section = Section.objects.filter(
                    document=doc,
                ).order_by('order').values_list('title', flat=True).first()
                if first_section:
                    entry['first_section'] = first_section

            results.append(entry)

        # ── Available filter options for the frontend ──
        type_choices = list(
            Document.objects.filter(
                created_by__profile__organization=org,
            ).values_list('document_type', flat=True).distinct()[:20]
        )
        category_choices = list(
            Document.objects.filter(
                created_by__profile__organization=org,
            ).exclude(category__isnull=True).exclude(category='')
            .values_list('category', flat=True).distinct()[:20]
        )

        return Response({
            'documents': results,
            'total': total,
            'filters': {
                'document_types': sorted(set(type_choices)),
                'categories': sorted(set(category_choices)),
                'modes': ['standard', 'quick_latex'],
            },
        })

    # -- Listener: Trigger types list ---------------------------------------

    @action(detail=False, methods=['get'], url_path='listener-triggers')
    def listener_triggers(self, request):
        """
        List all available listener trigger types with descriptions.
        GET /api/clm/workflows/listener-triggers/
        """
        triggers = [
            {
                'name': 'document_uploaded',
                'display_name': 'Document Uploaded',
                'description': 'Auto-fires when documents exist in the pipeline.',
                'icon': '📥',
                'category': 'automatic',
                'config_fields': [],
            },
            {
                'name': 'approval_required',
                'display_name': 'Approval Required',
                'description': 'Gates the workflow — waits for a user to approve or reject before continuing.',
                'icon': '✋',
                'category': 'approval',
                'config_fields': [
                    {'key': 'gate_message', 'label': 'Gate Message', 'type': 'textarea', 'default': 'Approval required before proceeding'},
                    {'key': 'auto_execute_downstream', 'label': 'Auto-execute downstream after approval', 'type': 'boolean', 'default': True},
                ],
            },
            {
                'name': 'field_changed',
                'display_name': 'Field Condition',
                'description': 'Passes documents where a specific metadata field matches a condition.',
                'icon': '🔍',
                'category': 'automatic',
                'config_fields': [
                    {'key': 'watch_field', 'label': 'Field to Watch', 'type': 'string', 'required': True},
                    {'key': 'watch_operator', 'label': 'Operator', 'type': 'select', 'options': ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_contains'], 'default': 'eq'},
                    {'key': 'watch_value', 'label': 'Value', 'type': 'string', 'required': True},
                ],
            },
            {
                'name': 'all_documents_ready',
                'display_name': 'All Documents Ready',
                'description': 'Fires when all incoming documents have completed AI extraction.',
                'icon': '✅',
                'category': 'automatic',
                'config_fields': [],
            },
            {
                'name': 'document_count',
                'display_name': 'Document Count Threshold',
                'description': 'Fires when the number of documents reaches a threshold.',
                'icon': '📊',
                'category': 'automatic',
                'config_fields': [
                    {'key': 'threshold', 'label': 'Minimum Documents', 'type': 'number', 'default': 5},
                ],
            },
            {
                'name': 'manual',
                'display_name': 'Manual Trigger',
                'description': 'Only fires when a user explicitly clicks the Trigger button.',
                'icon': '🖱️',
                'category': 'manual',
                'config_fields': [],
            },
            {
                'name': 'email_inbox',
                'display_name': 'Email Inbox',
                'description': 'Watches an email inbox for new emails. Creates workflow documents from email body text and/or PDF/DOCX attachments. Email metadata (subject, sender, date) is auto-injected into extracted_metadata for Rule node filtering.',
                'icon': '📧',
                'category': 'automatic',
                'config_fields': [
                    {'key': 'email_host', 'label': 'IMAP Host', 'type': 'string', 'required': True, 'default': 'imap.gmail.com'},
                    {'key': 'email_user', 'label': 'Email Address', 'type': 'string', 'required': True},
                    {'key': 'email_password', 'label': 'Email Password / App Password', 'type': 'password', 'required': True},
                    {'key': 'email_folder', 'label': 'Folder', 'type': 'string', 'default': 'INBOX'},
                    {'key': 'email_filter_subject', 'label': 'Subject Filter', 'type': 'string'},
                    {'key': 'email_filter_sender', 'label': 'Sender Filter', 'type': 'string'},
                    {'key': 'include_body_as_document', 'label': 'Include email body as document', 'type': 'boolean', 'default': True},
                    {'key': 'include_attachments', 'label': 'Include PDF/DOCX/TXT attachments', 'type': 'boolean', 'default': True},
                    {'key': 'auto_extract', 'label': 'Auto-extract with AI', 'type': 'boolean', 'default': True},
                    {'key': 'auto_execute', 'label': 'Auto-execute workflow per document', 'type': 'boolean', 'default': True},
                ],
            },
            {
                'name': 'folder_watch',
                'display_name': 'Folder Watch',
                'description': 'Watches a DriveFolder for new uploads. Each uploaded file becomes a single-document workflow trigger.',
                'icon': '📂',
                'category': 'automatic',
                'config_fields': [
                    {'key': 'watch_folder_id', 'label': 'DriveFolder ID', 'type': 'uuid'},
                    {'key': 'auto_extract', 'label': 'Auto-extract with AI', 'type': 'boolean', 'default': True},
                    {'key': 'auto_execute', 'label': 'Auto-execute workflow per document', 'type': 'boolean', 'default': True},
                ],
            },
        ]
        return Response({
            'triggers': triggers,
            'count': len(triggers),
        })

    # -- Listener: Check / evaluate a listener node -------------------------

    @action(detail=True, methods=['post'], url_path='check-listener/(?P<node_id>[0-9a-f-]+)')
    def check_listener(self, request, pk=None, node_id=None):
        """
        Evaluate a listener node's trigger conditions.
        POST /api/clm/workflows/{id}/check-listener/{node_id}/
        Optional: { "force_trigger": true } to manually force-pass.
        Optional: { "document_ids": [...] } to limit scope.
        """
        from .listener_executor import evaluate_listener_node

        workflow = self.get_object()
        try:
            node = workflow.nodes.get(id=node_id, node_type='listener')
        except WorkflowNode.DoesNotExist:
            return Response(
                {'error': 'Listener node not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        force = request.data.get('force_trigger', False)
        doc_ids = request.data.get('document_ids', [])

        # If no specific doc_ids, get from upstream nodes
        if not doc_ids:
            from .models import NodeConnection
            parent_ids = NodeConnection.objects.filter(
                target_node=node,
            ).values_list('source_node_id', flat=True)

            doc_ids = []
            for pid in parent_ids:
                parent_node = workflow.nodes.filter(id=pid).first()
                if parent_node and parent_node.last_result:
                    doc_ids.extend(parent_node.last_result.get('document_ids', []))
            doc_ids = list(set(doc_ids))

        result = evaluate_listener_node(
            node=node,
            incoming_document_ids=doc_ids,
            triggered_by=request.user,
            force_trigger=force,
        )
        return Response(result)

    # -- Listener: Approve or reject an event --------------------------------

    @action(detail=True, methods=['post'], url_path='resolve-listener')
    def resolve_listener(self, request, pk=None):
        """
        Approve or reject a pending listener event.
        POST /api/clm/workflows/{id}/resolve-listener/
        Body: { "event_id": "uuid", "action": "approve"|"reject", "note": "..." }
        """
        from .listener_executor import resolve_listener_event

        serializer = ListenerResolveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        result = resolve_listener_event(
            event_id=str(serializer.validated_data['event_id']),
            action=serializer.validated_data['action'],
            user=request.user,
            note=serializer.validated_data.get('note', ''),
        )
        if result.get('success'):
            return Response(result)
        return Response(result, status=status.HTTP_400_BAD_REQUEST)

    # -- Listener: List events for a workflow --------------------------------

    @action(detail=True, methods=['get'], url_path='listener-events')
    def listener_events(self, request, pk=None):
        """
        List listener events for a workflow.
        GET /api/clm/workflows/{id}/listener-events/
        ?status=pending  — filter by status
        ?node_id=uuid    — filter by node
        """
        workflow = self.get_object()
        events = ListenerEvent.objects.filter(
            workflow=workflow,
        ).select_related('node', 'resolved_by', 'triggered_by')

        event_status = request.query_params.get('status')
        if event_status:
            events = events.filter(status=event_status)

        node_id = request.query_params.get('node_id')
        if node_id:
            events = events.filter(node_id=node_id)

        serializer = ListenerEventSerializer(events[:50], many=True)
        return Response({
            'events': serializer.data,
            'count': events.count(),
            'pending_count': events.filter(status='pending').count(),
        })

    # -- Listener: Pending approvals across all workflows --------------------

    @action(detail=False, methods=['get'], url_path='pending-approvals')
    def pending_approvals(self, request):
        """
        List all pending approval events across the user's org.
        GET /api/clm/workflows/pending-approvals/
        """
        org = _get_org(request)
        if not org:
            return Response({'events': [], 'count': 0})

        events = ListenerEvent.objects.filter(
            workflow__organization=org,
            status='pending',
        ).select_related('node', 'workflow', 'triggered_by').order_by('-created_at')

        serializer = ListenerEventSerializer(events[:50], many=True)
        return Response({
            'events': serializer.data,
            'count': events.count(),
        })

    # -- Listener: Check email inbox ----------------------------------------

    @action(detail=True, methods=['post'], url_path='check-inbox/(?P<node_id>[0-9a-f-]+)')
    def check_inbox(self, request, pk=None, node_id=None):
        """
        Poll an email inbox for new documents.
        POST /api/clm/workflows/{id}/check-inbox/{node_id}/
        Works with both input nodes (source_type=email_inbox) and
        legacy listener nodes (trigger_type=email_inbox).
        """
        from .listener_executor import check_email_inbox

        workflow = self.get_object()
        try:
            node = workflow.nodes.get(id=node_id)
        except WorkflowNode.DoesNotExist:
            return Response(
                {'error': 'Node not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        config = node.config or {}
        is_input_email = (node.node_type == 'input' and config.get('source_type') == 'email_inbox')
        is_listener_email = (node.node_type == 'listener' and config.get('trigger_type') == 'email_inbox')

        if not is_input_email and not is_listener_email:
            return Response(
                {'error': 'Node is not configured for email inbox watching.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        result = check_email_inbox(node=node, user=request.user)

        # Stamp last-checked metadata (consistent with Celery task)
        from django.utils import timezone as _tz
        config = node.config or {}
        config['email_last_checked_at'] = _tz.now().isoformat()
        config['email_last_check_status'] = 'ok' if not result.get('errors') else 'error'
        config['email_last_check_found'] = result.get('found', 0)
        config['email_last_check_skipped'] = result.get('skipped', 0)
        config['email_last_check_error'] = '; '.join(result.get('errors', []))[:500]
        node.config = config
        node.save(update_fields=['config'])

        # Include cached email_state in the response
        node.refresh_from_db(fields=['document_state'])
        ds = node.document_state or {}
        result['email_state'] = ds.get('email_state', {})
        result['document_state'] = ds

        return Response(result)

    # -- Email status (last checked, server-side polling info) ---------------

    @action(detail=True, methods=['get'], url_path='email-status/(?P<node_id>[0-9a-f-]+)')
    def email_status(self, request, pk=None, node_id=None):
        """
        Return server-side email polling status for a node.
        GET /api/clm/workflows/{id}/email-status/{node_id}/
        """
        workflow = self.get_object()
        try:
            node = workflow.nodes.get(id=node_id)
        except WorkflowNode.DoesNotExist:
            return Response({'error': 'Node not found.'}, status=status.HTTP_404_NOT_FOUND)

        config = node.config or {}
        ds = node.document_state or {}
        email_state = ds.get('email_state', {})

        # Compute effective polling interval (includes error backoff)
        interval = config.get('email_refetch_interval', 0)
        consecutive_errors = config.get('email_consecutive_errors', 0)
        if consecutive_errors > 0 and interval > 0:
            effective_interval = min(interval * (2 ** consecutive_errors), 3600)
        else:
            effective_interval = interval

        return Response({
            'email_last_checked_at': config.get('email_last_checked_at'),
            'email_last_check_status': config.get('email_last_check_status'),
            'email_last_check_found': config.get('email_last_check_found'),
            'email_last_check_skipped': config.get('email_last_check_skipped'),
            'email_last_check_error': config.get('email_last_check_error'),
            'email_last_check_ms': config.get('email_last_check_ms'),
            'email_refetch_interval': interval,
            'effective_interval': effective_interval,
            'consecutive_errors': consecutive_errors,
            'server_polling_active': bool(interval > 0),
            # Cached email state from document_state
            'email_state': {
                'seen_count': email_state.get('seen_count', 0),
                'total_emails_ingested': email_state.get('total_emails_ingested', 0),
                'last_checked_at': email_state.get('last_checked_at', ''),
                'last_found': email_state.get('last_found', 0),
                'last_skipped': email_state.get('last_skipped', 0),
                'cumulative_found': email_state.get('cumulative_found', 0),
                'cumulative_skipped': email_state.get('cumulative_skipped', 0),
            },
        })

    # -- Integration: Test connection for cloud sources ---------------------

    @action(detail=True, methods=['post'],
            url_path='test-connection/(?P<node_id>[0-9a-f-]+)')
    def test_connection(self, request, pk=None, node_id=None):
        """
        Test connectivity for a cloud/external source integration.
        POST /api/clm/workflows/{id}/test-connection/{node_id}/

        Works for source_types: google_drive, dropbox, onedrive, s3, ftp, url_scrape.
        Returns {"ok": true/false, "message": "...", "details": {...}}
        """
        workflow = self.get_object()
        try:
            node = workflow.nodes.get(id=node_id)
        except WorkflowNode.DoesNotExist:
            return Response({'error': 'Node not found.'},
                            status=status.HTTP_404_NOT_FOUND)

        config = node.config or {}
        source_type = config.get('source_type', 'upload')

        cloud_sources = {'google_drive', 'dropbox', 'onedrive', 's3', 'ftp', 'url_scrape'}
        if source_type not in cloud_sources:
            return Response(
                {'ok': False, 'message': f'Test connection not supported for {source_type}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            if source_type == 'google_drive':
                result = self._test_google_drive(config)
            elif source_type == 'dropbox':
                result = self._test_dropbox(config)
            elif source_type == 'onedrive':
                result = self._test_onedrive(config)
            elif source_type == 's3':
                result = self._test_s3(config)
            elif source_type == 'ftp':
                result = self._test_ftp(config)
            elif source_type == 'url_scrape':
                result = self._test_url_scrape(config)
            else:
                result = {'ok': False, 'message': 'Unknown source'}
        except Exception as e:
            result = {'ok': False, 'message': str(e)}

        return Response(result, status=status.HTTP_200_OK if result.get('ok') else status.HTTP_400_BAD_REQUEST)

    def _test_google_drive(self, config):
        from .source_integrations import _extract_folder_id
        raw_folder = config.get('google_folder_id', '') or config.get('google_folder_url', '')
        access_mode = config.get('google_access', 'public')
        if not raw_folder:
            return {'ok': False, 'message': 'Folder ID or URL is required'}

        folder_id = _extract_folder_id(raw_folder)

        if access_mode == 'private':
            # Private mode — service account JSON
            creds_json = config.get('google_credentials_json', '')
            if not creds_json:
                return {'ok': False, 'message': 'Service Account JSON is required for private folders'}
            try:
                from google.oauth2 import service_account
                from googleapiclient.discovery import build
                import json as _json, os
                if os.path.isfile(creds_json):
                    creds = service_account.Credentials.from_service_account_file(
                        creds_json, scopes=['https://www.googleapis.com/auth/drive.readonly'])
                else:
                    creds = service_account.Credentials.from_service_account_info(
                        _json.loads(creds_json),
                        scopes=['https://www.googleapis.com/auth/drive.readonly'])
                svc = build('drive', 'v3', credentials=creds)
                resp = svc.files().list(
                    q=f"'{folder_id}' in parents and trashed = false",
                    pageSize=5, fields='files(name)').execute()
                count = len(resp.get('files', []))
                return {'ok': True, 'message': f'Connected (private). {count} files found.',
                        'details': {'file_count': count, 'access': 'private'}}
            except ImportError:
                return {'ok': False, 'message': 'Google API libraries not installed (pip install google-api-python-client google-auth)'}
            except Exception as e:
                return {'ok': False, 'message': str(e)}
        else:
            # Public mode — API key
            api_key = config.get('google_api_key', '')
            if not api_key:
                return {'ok': False, 'message': 'API key is required for public folder access'}
            try:
                import requests as req
                resp = req.get(
                    'https://www.googleapis.com/drive/v3/files',
                    params={
                        'q': f"'{folder_id}' in parents and trashed = false",
                        'pageSize': 5,
                        'fields': 'files(name)',
                        'key': api_key,
                    },
                    timeout=15,
                )
                resp.raise_for_status()
                count = len(resp.json().get('files', []))
                return {'ok': True, 'message': f'Connected (public). {count} files found.',
                        'details': {'file_count': count, 'access': 'public'}}
            except Exception as e:
                return {'ok': False, 'message': str(e)}

    def _test_dropbox(self, config):
        token = config.get('dropbox_access_token', '')
        if not token:
            return {'ok': False, 'message': 'Missing dropbox_access_token'}
        try:
            import dropbox as dbx_lib
            dbx = dbx_lib.Dropbox(token)
            acct = dbx.users_get_current_account()
            folder = config.get('dropbox_folder_path', '')
            entries = dbx.files_list_folder(folder).entries
            return {'ok': True,
                    'message': f'Connected as {acct.name.display_name}. {len(entries)} items in folder.',
                    'details': {'account': acct.name.display_name, 'item_count': len(entries)}}
        except ImportError:
            return {'ok': False, 'message': 'Dropbox SDK not installed'}
        except Exception as e:
            return {'ok': False, 'message': str(e)}

    def _test_onedrive(self, config):
        token = config.get('onedrive_access_token', '')
        if not token:
            return {'ok': False, 'message': 'Missing onedrive_access_token'}
        try:
            import requests as req
            resp = req.get('https://graph.microsoft.com/v1.0/me',
                           headers={'Authorization': f'Bearer {token}'}, timeout=10)
            resp.raise_for_status()
            user_info = resp.json()
            return {'ok': True,
                    'message': f'Connected as {user_info.get("displayName", "unknown")}.',
                    'details': {'user': user_info.get('displayName')}}
        except Exception as e:
            return {'ok': False, 'message': str(e)}

    def _test_s3(self, config):
        bucket = config.get('s3_bucket', '')
        if not bucket:
            return {'ok': False, 'message': 'Missing s3_bucket'}
        try:
            import boto3
            kwargs = {'region_name': config.get('s3_region', 'us-east-1')}
            ak = config.get('s3_access_key', '')
            sk = config.get('s3_secret_key', '')
            if ak and sk:
                kwargs.update({'aws_access_key_id': ak, 'aws_secret_access_key': sk})
            s3 = boto3.client('s3', **kwargs)
            resp = s3.list_objects_v2(Bucket=bucket, Prefix=config.get('s3_prefix', ''), MaxKeys=5)
            count = resp.get('KeyCount', 0)
            return {'ok': True, 'message': f'Connected. {count} objects found.',
                    'details': {'object_count': count}}
        except ImportError:
            return {'ok': False, 'message': 'boto3 not installed'}
        except Exception as e:
            return {'ok': False, 'message': str(e)}

    def _test_ftp(self, config):
        host = config.get('ftp_host', '')
        if not host:
            return {'ok': False, 'message': 'Missing ftp_host'}
        port = int(config.get('ftp_port', 21))
        user = config.get('ftp_user', 'anonymous')
        password = config.get('ftp_password', '')
        protocol = config.get('ftp_protocol', 'ftp')
        try:
            if protocol == 'sftp':
                import paramiko
                t = paramiko.Transport((host, port))
                t.connect(username=user, password=password)
                sftp = paramiko.SFTPClient.from_transport(t)
                items = sftp.listdir(config.get('ftp_path', '/'))
                sftp.close(); t.close()
                return {'ok': True, 'message': f'SFTP connected. {len(items)} items.',
                        'details': {'item_count': len(items)}}
            else:
                import ftplib
                ftp = ftplib.FTP()
                ftp.connect(host, port, timeout=10)
                ftp.login(user, password)
                items = ftp.nlst(config.get('ftp_path', '/'))
                ftp.quit()
                return {'ok': True, 'message': f'FTP connected. {len(items)} items.',
                        'details': {'item_count': len(items)}}
        except ImportError:
            return {'ok': False, 'message': 'paramiko not installed (required for SFTP)'}
        except Exception as e:
            return {'ok': False, 'message': str(e)}

    def _test_url_scrape(self, config):
        urls = config.get('urls', [])
        if not urls:
            return {'ok': False, 'message': 'No URLs configured'}
        try:
            import requests as req
            first = urls[0]
            resp = req.head(first, timeout=10, allow_redirects=True)
            return {'ok': True,
                    'message': f'URL reachable ({resp.status_code}). {len(urls)} URL(s) configured.',
                    'details': {'url_count': len(urls), 'first_status': resp.status_code}}
        except Exception as e:
            return {'ok': False, 'message': str(e)}

    # -----------------------------------------------------------------------
    # Validation endpoints
    # -----------------------------------------------------------------------

    # -- Org users for dropdown ---------------------------------------------

    @action(detail=False, methods=['get'], url_path='org-users')
    def org_users(self, request):
        """
        List organization members for validator assignment dropdown.
        GET /api/clm/workflows/org-users/
        ?search=name   — filter by name/email
        """
        from user_management.models import UserProfile

        org = _get_org(request)
        if not org:
            return Response({'users': [], 'count': 0})

        profiles = UserProfile.objects.filter(
            organization=org, is_active=True,
        ).select_related('user', 'role')

        search = request.query_params.get('search', '').strip()
        if search:
            profiles = profiles.filter(
                Q(user__first_name__icontains=search)
                | Q(user__last_name__icontains=search)
                | Q(user__email__icontains=search)
                | Q(user__username__icontains=search)
            )

        serializer = OrgUserSerializer(profiles[:100], many=True)
        return Response({
            'users': serializer.data,
            'count': profiles.count(),
        })

    # -- Validator users CRUD for a workflow's validator nodes ----------------

    @action(detail=True, methods=['get', 'post', 'delete'], url_path='validator-users')
    def validator_users(self, request, pk=None):
        """
        GET    /api/clm/workflows/{id}/validator-users/?node_id=uuid
        POST   /api/clm/workflows/{id}/validator-users/
               { "node": "uuid", "user": 1, "role_label": "Reviewer" }
        DELETE /api/clm/workflows/{id}/validator-users/
               { "validator_user_id": "uuid" }
        """
        workflow = self.get_object()

        if request.method == 'GET':
            qs = ValidatorUser.objects.filter(
                workflow=workflow, is_active=True,
            ).select_related('user', 'node')

            node_id = request.query_params.get('node_id')
            if node_id:
                qs = qs.filter(node_id=node_id)

            serializer = ValidatorUserSerializer(qs, many=True)
            return Response({
                'users': serializer.data,
                'count': qs.count(),
            })

        if request.method == 'DELETE':
            vu_id = request.data.get('validator_user_id')
            try:
                vu = ValidatorUser.objects.get(id=vu_id, workflow=workflow)
                vu.delete()
                return Response(status=status.HTTP_204_NO_CONTENT)
            except ValidatorUser.DoesNotExist:
                return Response(
                    {'error': 'Validator user not found.'},
                    status=status.HTTP_404_NOT_FOUND,
                )

        # POST — add a user to a validator node
        node_id = request.data.get('node')
        if not node_id:
            return Response(
                {'error': 'node is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            node = workflow.nodes.get(id=node_id, node_type='validator')
        except WorkflowNode.DoesNotExist:
            return Response(
                {'error': 'Validator node not found in this workflow.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        user_id = request.data.get('user')
        if not user_id:
            return Response(
                {'error': 'user is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check if already assigned
        if ValidatorUser.objects.filter(node=node, user_id=user_id).exists():
            return Response(
                {'error': 'User already assigned to this validator node.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        vu = ValidatorUser.objects.create(
            node=node,
            workflow=workflow,
            user_id=user_id,
            role_label=request.data.get('role_label', ''),
        )

        # ── Notify the assigned user ────────────────────────────────
        try:
            from communications.dispatch import send_alert
            from django.contrib.auth import get_user_model
            User = get_user_model()
            target_user = User.objects.get(pk=user_id)
            role_text = f' as "{vu.role_label}"' if vu.role_label else ''
            send_alert(
                category='clm.validation_assigned',
                recipient=target_user,
                title='You have been assigned as a validator',
                message=(
                    f'{request.user.get_full_name() or request.user.username} '
                    f'added you{role_text} to the "{node.label or "Validator"}" step '
                    f'in workflow "{workflow.name}".'
                ),
                actor=request.user,
                priority='high',
                target_type='workflow',
                target_id=str(workflow.id),
                metadata={
                    'workflow_id': str(workflow.id),
                    'workflow_name': workflow.name,
                    'node_id': str(node.id),
                    'node_label': node.label,
                    'role_label': vu.role_label,
                    'action_url': f'/clm/{workflow.id}',
                    'validation_url': f'/clm/validation/{workflow.id}',
                },
                email=True,
            )
        except Exception as e:
            logger.warning(f"Failed to send validator assignment alert: {e}")

        serializer = ValidatorUserSerializer(vu)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    # -- Resolve a validation decision (approve/reject) ---------------------

    @action(detail=True, methods=['post'], url_path='resolve-validation')
    def resolve_validation(self, request, pk=None):
        """
        Approve or reject a pending validation decision.
        POST /api/clm/workflows/{id}/resolve-validation/
        Body: { "decision_id": "uuid", "action": "approve"|"reject", "note": "..." }
        """
        from .validation_executor import resolve_validation

        serializer = ValidationResolveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        result = resolve_validation(
            decision_id=str(serializer.validated_data['decision_id']),
            action=serializer.validated_data['action'],
            user=request.user,
            note=serializer.validated_data.get('note', ''),
        )
        if result.get('success'):
            return Response(result)
        return Response(result, status=status.HTTP_400_BAD_REQUEST)

    # -- Bulk resolve (approve/reject multiple) -----------------------------

    @action(detail=True, methods=['post'], url_path='bulk-resolve-validation')
    def bulk_resolve_validation(self, request, pk=None):
        """
        Approve or reject multiple validation decisions.
        POST /api/clm/workflows/{id}/bulk-resolve-validation/
        Body: { "decision_ids": ["uuid", ...], "action": "approve"|"reject", "note": "..." }
        """
        from .validation_executor import resolve_validation

        serializer = BulkValidationResolveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        results = []
        for did in serializer.validated_data['decision_ids']:
            r = resolve_validation(
                decision_id=str(did),
                action=serializer.validated_data['action'],
                user=request.user,
                note=serializer.validated_data.get('note', ''),
            )
            results.append(r)

        return Response({
            'results': results,
            'total': len(results),
            'succeeded': sum(1 for r in results if r.get('success')),
        })

    # -- Validation status for a workflow -----------------------------------

    @action(detail=True, methods=['get'], url_path='validation-status')
    def validation_status(self, request, pk=None):
        """
        Per-workflow validation dashboard data.
        GET /api/clm/workflows/{id}/validation-status/
        ?node_id=uuid  — filter by validator node
        """
        workflow = self.get_object()

        decisions = ValidationDecision.objects.filter(
            workflow=workflow,
        ).select_related('node', 'document', 'assigned_to')

        node_id = request.query_params.get('node_id')
        if node_id:
            decisions = decisions.filter(node_id=node_id)

        # Summary
        summary = {
            'total': decisions.count(),
            'pending': decisions.filter(status='pending').count(),
            'approved': decisions.filter(status='approved').count(),
            'rejected': decisions.filter(status='rejected').count(),
            'skipped': decisions.filter(status='skipped').count(),
        }

        # Pending decisions detail
        pending = decisions.filter(status='pending').order_by('-created_at')[:50]
        pending_data = ValidationDecisionSerializer(pending, many=True).data

        # Recent decisions
        recent = decisions.exclude(status='pending').order_by('-decided_at')[:20]
        recent_data = ValidationDecisionSerializer(recent, many=True).data

        # Per-document status
        doc_ids = decisions.values_list('document_id', flat=True).distinct()
        doc_status = []
        for doc_id in doc_ids[:50]:
            doc_decisions = decisions.filter(document_id=doc_id)
            doc = doc_decisions.first().document
            doc_status.append({
                'document_id': str(doc_id),
                'document_title': doc.title if doc else 'Unknown',
                'total': doc_decisions.count(),
                'pending': doc_decisions.filter(status='pending').count(),
                'approved': doc_decisions.filter(status='approved').count(),
                'rejected': doc_decisions.filter(status='rejected').count(),
            })

        return Response({
            'summary': summary,
            'pending_decisions': pending_data,
            'recent_decisions': recent_data,
            'document_status': doc_status,
        })

    # -- My validations (global dashboard for logged-in user) ---------------

    @action(detail=False, methods=['get'], url_path='my-validations')
    def my_validations(self, request):
        """
        Global validation dashboard for the current user.
        GET /api/clm/workflows/my-validations/
        ?status=pending  — filter by status (default: all)
        ?workflow_id=uuid — filter by workflow
        """
        org = _get_org(request)
        if not org:
            return Response({'decisions': [], 'summary': {}})

        decisions = ValidationDecision.objects.filter(
            assigned_to=request.user,
            workflow__organization=org,
        ).select_related('workflow', 'node', 'document')

        filter_status = request.query_params.get('status')
        if filter_status:
            decisions = decisions.filter(status=filter_status)

        workflow_id = request.query_params.get('workflow_id')
        if workflow_id:
            decisions = decisions.filter(workflow_id=workflow_id)

        summary = {
            'total': decisions.count(),
            'pending': decisions.filter(status='pending').count(),
            'approved': decisions.filter(status='approved').count(),
            'rejected': decisions.filter(status='rejected').count(),
        }

        # Group by workflow
        workflows_data = {}
        for d in decisions.order_by('-created_at')[:100]:
            wf_id = str(d.workflow_id)
            if wf_id not in workflows_data:
                workflows_data[wf_id] = {
                    'workflow_id': wf_id,
                    'workflow_name': d.workflow.name,
                    'decisions': [],
                    'pending_count': 0,
                }
            workflows_data[wf_id]['decisions'].append(
                ValidationDecisionSerializer(d).data,
            )
            if d.status == 'pending':
                workflows_data[wf_id]['pending_count'] += 1

        # Unread validation alerts for the current user
        try:
            from communications.models import Alert
            unread_validation_alerts = Alert.objects.filter(
                recipient=request.user,
                is_read=False,
                category__in=[
                    'clm.validation_assigned',
                    'clm.validation_pending',
                    'clm.validation_resolved',
                ],
            ).count()
        except Exception:
            unread_validation_alerts = 0

        return Response({
            'summary': summary,
            'workflows': list(workflows_data.values()),
            'total_pending': summary['pending'],
            'unread_alerts': unread_validation_alerts,
        })

    # -- AI Chat assistant --------------------------------------------------

    @action(detail=True, methods=['get', 'post'], url_path='chat')
    def chat(self, request, pk=None):
        """
        AI Chat assistant for workflow editing.

        GET  /api/clm/workflows/{id}/chat/
          → Returns conversation history (last 50 messages).

        POST /api/clm/workflows/{id}/chat/
          body: {"message": "Add a rule node that filters invoices over $5k",
                 "model": "gemini-2.5-flash",  // optional
                 "auto_apply": true}            // optional, default true
          → Sends message to AI, applies proposed changes, returns reply.
        """
        workflow = self.get_object()

        if request.method == 'GET':
            messages = workflow.chat_messages.order_by('created_at')[:50]
            serializer = WorkflowChatMessageSerializer(messages, many=True)
            return Response({
                'workflow_id': str(workflow.id),
                'workflow_name': workflow.name,
                'messages': serializer.data,
                'message_count': workflow.chat_messages.count(),
            })

        # POST — send a message
        serializer = WorkflowChatSendSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        from .workflow_chat import chat_with_workflow

        result = chat_with_workflow(
            workflow=workflow,
            user_message=serializer.validated_data['message'],
            model_id=serializer.validated_data.get('model', 'gemini-2.5-flash'),
            auto_apply=serializer.validated_data.get('auto_apply', True),
            user=request.user if request.user.is_authenticated else None,
        )

        # Include refreshed workflow state in response
        workflow.refresh_from_db()
        result['workflow'] = WorkflowSerializer(workflow).data

        return Response(result)

    @action(detail=True, methods=['delete'], url_path='chat-clear')
    def chat_clear(self, request, pk=None):
        """
        DELETE /api/clm/workflows/{id}/chat-clear/
          → Clear all chat messages for this workflow.
        """
        workflow = self.get_object()
        count = workflow.chat_messages.count()
        workflow.chat_messages.all().delete()
        return Response({
            'cleared': count,
            'detail': f'Cleared {count} chat messages.',
        })

    @action(detail=True, methods=['post'], url_path='chat-apply')
    def chat_apply(self, request, pk=None):
        """
        POST /api/clm/workflows/{id}/chat-apply/
          body: {"message_id": "<uuid>"}
          → Apply actions from a previously unapplied assistant message.
          Useful when auto_apply was False and user reviews then confirms.
        """
        workflow = self.get_object()
        message_id = request.data.get('message_id')

        if not message_id:
            return Response(
                {'error': 'message_id is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            msg = workflow.chat_messages.get(
                id=message_id, role='assistant',
            )
        except WorkflowChatMessage.DoesNotExist:
            return Response(
                {'error': 'Assistant message not found'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if msg.actions_applied:
            return Response(
                {'error': 'Actions already applied for this message'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not msg.actions:
            return Response(
                {'error': 'No actions to apply in this message'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from .workflow_chat import _apply_actions

        action_results = _apply_actions(workflow, msg.actions, user=request.user)
        msg.actions_applied = True
        msg.save(update_fields=['actions_applied'])

        workflow.refresh_from_db()

        return Response({
            'message_id': str(msg.id),
            'actions_applied': True,
            'action_results': action_results,
            'workflow': WorkflowSerializer(workflow).data,
        })

    # -- Optimize Workflow --------------------------------------------------

    @action(detail=True, methods=['get', 'post'], url_path='optimize-workflow')
    def optimize_workflow(self, request, pk=None):
        """
        GET  /api/clm/workflows/{id}/optimize-workflow/
          → Preview: returns static issues + AI-proposed optimizations
            without applying them.

        POST /api/clm/workflows/{id}/optimize-workflow/
          body: {"apply": true}
          → Apply: runs the optimizer and applies all proposed changes.

        The optimizer analyses the DAG and proposes:
          • Merging redundant AI nodes
          • Upgrading system prompts to production-grade
          • Reordering nodes (cheap filters before expensive AI calls)
          • Fixing structural issues (orphans, missing connections)
        """
        workflow = self.get_object()

        from .workflow_optimizer import optimize_workflow as run_optimizer

        if request.method == 'GET':
            # Preview mode — no changes applied
            result = run_optimizer(workflow, apply=False, user=request.user)
            return Response(result)
        else:
            # Apply mode
            apply = request.data.get('apply', True)
            result = run_optimizer(workflow, apply=bool(apply), user=request.user)

            if result.get('actions_applied'):
                workflow.refresh_from_db()
                result['workflow'] = WorkflowSerializer(workflow).data

            return Response(result)

    # -- Download: single document ------------------------------------------

    @action(detail=True, methods=['get'],
            url_path='download-document/(?P<doc_id>[0-9a-f-]+)')
    def download_document(self, request, pk=None, doc_id=None):
        """
        Download a single document's original file.
        GET /api/clm/workflows/{id}/download-document/{doc_id}/
        """
        workflow = self.get_object()
        try:
            doc = workflow.documents.get(id=doc_id)
        except WorkflowDocument.DoesNotExist:
            return Response({'error': 'Document not found.'},
                            status=status.HTTP_404_NOT_FOUND)

        if not doc.file:
            return Response({'error': 'No file attached to this document.'},
                            status=status.HTTP_404_NOT_FOUND)

        return FileResponse(
            doc.file.open('rb'),
            as_attachment=True,
            filename=doc.title or f'document.{doc.file_type}',
        )

    # -- Download: node documents (PDF merge / ZIP / CSV) -------------------

    @action(detail=True, methods=['get'],
            url_path='node-download/(?P<node_id>[0-9a-f-]+)')
    def node_download(self, request, pk=None, node_id=None):
        """
        Download documents at a specific node.
        GET /api/clm/workflows/{id}/node-download/{node_id}/?export=pdf|zip|csv

        Formats:
          pdf — merge all PDF documents at this node into a single PDF
          zip — all documents at this node in a ZIP archive
          csv — CSV of node results / extracted metadata for each document
        """
        from .models import WorkflowExecution

        workflow = self.get_object()

        try:
            node = WorkflowNode.objects.get(id=node_id, workflow=workflow)
        except WorkflowNode.DoesNotExist:
            return Response({'error': 'Node not found.'},
                            status=status.HTTP_404_NOT_FOUND)

        dl_format = request.query_params.get('export', 'zip').lower()
        if dl_format not in ('pdf', 'zip', 'csv'):
            return Response(
                {'error': 'Invalid format. Use pdf, zip, or csv.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Resolve document IDs at this node ────────────────────────────
        doc_ids = self._get_node_document_ids(workflow, node, node_id)

        if not doc_ids:
            return Response(
                {'error': 'No documents found at this node.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        docs = list(workflow.documents.filter(id__in=doc_ids))
        if not docs:
            return Response(
                {'error': 'No documents found at this node.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        safe_name = (node.label or node.node_type).replace(' ', '_')

        if dl_format == 'pdf':
            return self._download_merged_pdf(docs, safe_name)
        elif dl_format == 'zip':
            return self._download_zip(docs, safe_name)
        else:  # csv — include ALL workflow docs so Pass/Fail is visible
            all_docs = list(workflow.documents.all())
            return self._download_csv(all_docs, node, safe_name)

    # ── Download helpers ──────────────────────────────────────────────────

    def _get_node_document_ids(self, workflow, node, node_id):
        """Resolve which document IDs are 'at' a node from execution data."""
        from .models import WorkflowExecution

        node_id_str = str(node_id)

        # For input nodes, use documents assigned to this input node
        if node.node_type == 'input':
            return list(
                workflow.documents.filter(input_node=node)
                .values_list('id', flat=True)
            ) or list(
                workflow.documents.values_list('id', flat=True)
            )

        # For other nodes, look at latest execution result
        execution = WorkflowExecution.objects.filter(
            workflow=workflow,
            status__in=['completed', 'partial', 'failed'],
        ).order_by('-started_at').first()

        if not execution or not execution.result_data:
            # Fallback: return all workflow documents
            return list(workflow.documents.values_list('id', flat=True))

        node_results = execution.result_data.get('node_results', [])
        for nr in node_results:
            if nr.get('node_id') == node_id_str:
                raw_ids = nr.get('document_ids', [])
                return [
                    (i if not isinstance(i, dict) else i.get('id'))
                    for i in raw_ids
                ]

        return list(workflow.documents.values_list('id', flat=True))

    def _download_merged_pdf(self, docs, name):
        """Merge all PDF documents into a single PDF using pypdf."""
        from pypdf import PdfReader, PdfWriter

        writer = PdfWriter()
        pdf_count = 0

        for doc in docs:
            if not doc.file or doc.file_type != 'pdf':
                continue
            try:
                reader = PdfReader(doc.file.open('rb'))
                for page in reader.pages:
                    writer.add_page(page)
                pdf_count += 1
            except Exception as e:
                logger.warning(f"Skipping {doc.title} in PDF merge: {e}")

        if pdf_count == 0:
            return Response(
                {'error': 'No valid PDF documents found to merge.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        buf = io.BytesIO()
        writer.write(buf)
        buf.seek(0)

        response = HttpResponse(buf.getvalue(), content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="{name}_merged.pdf"'
        return response

    def _download_zip(self, docs, name):
        """Create a ZIP archive of all documents."""
        buf = io.BytesIO()
        seen_names = {}

        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            for doc in docs:
                if not doc.file:
                    continue
                fname = doc.title or f'document_{doc.id}'
                # Deduplicate filenames within the zip
                if fname in seen_names:
                    seen_names[fname] += 1
                    base, ext = (fname.rsplit('.', 1) + [''])[:2]
                    fname = f"{base}_{seen_names[fname]}.{ext}" if ext else f"{fname}_{seen_names[fname]}"
                else:
                    seen_names[fname] = 0
                try:
                    zf.writestr(fname, doc.file.read())
                except Exception as e:
                    logger.warning(f"Skipping {doc.title} in ZIP: {e}")

        buf.seek(0)
        response = HttpResponse(buf.getvalue(), content_type='application/zip')
        response['Content-Disposition'] = f'attachment; filename="{name}_documents.zip"'
        return response

    def _download_csv(self, docs, node, name):
        """
        Generate a CSV of document metadata scoped to rule-condition fields
        that were applied at or before this node in the DAG.
        Empty string for missing values (never nan/None).
        """
        output = io.StringIO()
        workflow = node.workflow

        # ── Walk upstream to collect rule-condition fields ────────────────
        connections = list(workflow.connections.all())
        all_nodes = {str(n.id): n for n in workflow.nodes.all()}

        # BFS backwards from this node to collect all upstream node IDs
        upstream_ids = set()
        queue = [str(node.id)]
        while queue:
            nid = queue.pop(0)
            for c in connections:
                if str(c.target_node_id) == nid and str(c.source_node_id) not in upstream_ids:
                    upstream_ids.add(str(c.source_node_id))
                    queue.append(str(c.source_node_id))

        # Include the current node itself
        upstream_ids.add(str(node.id))

        # Gather condition fields from rule nodes at/before this node
        rule_fields = []
        seen_fields = set()
        for nid in upstream_ids:
            n = all_nodes.get(nid)
            if n and n.node_type == 'rule':
                for cond in (n.config or {}).get('conditions', []):
                    field = cond.get('field', '')
                    if field and field not in seen_fields:
                        seen_fields.add(field)
                        rule_fields.append(field)

        # Also include AI-node output fields from upstream
        for nid in upstream_ids:
            n = all_nodes.get(nid)
            if n and n.node_type == 'ai':
                for f in (n.config or {}).get('fields', []):
                    fname = f.get('name', '') if isinstance(f, dict) else str(f)
                    if fname and fname not in seen_fields:
                        seen_fields.add(fname)
                        rule_fields.append(fname)

        # Sort for consistent column order
        rule_fields.sort()

        # ── Node last_result per-document data ───────────────────────────
        node_result = node.last_result or {}
        per_doc_results = {}
        for entry in node_result.get('documents', node_result.get('results', [])):
            if isinstance(entry, dict) and 'document_id' in entry:
                per_doc_results[entry['document_id']] = entry

        # Build set of doc IDs that passed through this node
        passed_ids = set()
        raw_ids = node_result.get('document_ids', [])
        for i in raw_ids:
            passed_ids.add(str(i) if not isinstance(i, dict) else str(i.get('id', '')))

        # Also check execution data for this node's document_ids
        from .models import WorkflowExecution
        execution = WorkflowExecution.objects.filter(
            workflow=workflow,
            status__in=['completed', 'partial', 'failed'],
        ).order_by('-started_at').first()
        if execution and execution.result_data:
            for nr in execution.result_data.get('node_results', []):
                if nr.get('node_id') == str(node.id):
                    for i in nr.get('document_ids', []):
                        passed_ids.add(str(i) if not isinstance(i, dict) else str(i.get('id', '')))

        # ── Build CSV ────────────────────────────────────────────────────
        headers = ['document_id', 'title', 'file_type', 'status']
        headers += rule_fields

        writer = csv.writer(output)
        writer.writerow(headers)

        for doc in docs:
            meta = doc.extracted_metadata or {}
            gmeta = doc.global_metadata or {}

            doc_status = 'Pass' if str(doc.id) in passed_ids else 'Fail'

            row = [
                str(doc.id),
                doc.title or '',
                doc.file_type or '',
                doc_status,
            ]

            # Rule-condition field values
            for field in rule_fields:
                val = meta.get(field)
                if val is None:
                    val = gmeta.get(field)
                if val is None:
                    row.append('')
                elif isinstance(val, (list, dict)):
                    row.append(str(val))
                else:
                    row.append(str(val) if val is not None else '')

            writer.writerow(row)

        response = HttpResponse(output.getvalue(), content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename="{name}_results.csv"'
        return response

    # -- Duplicate ----------------------------------------------------------

    @action(detail=True, methods=['post'], url_path='duplicate')
    def duplicate(self, request, pk=None):
        """Duplicate a workflow with all nodes and connections."""
        workflow = self.get_object()

        new_wf = Workflow.objects.create(
            organization=workflow.organization,
            name=f"{workflow.name} (Copy)",
            description=workflow.description,
            is_active=False,
            extraction_template=workflow.extraction_template,
            canvas_state=workflow.canvas_state,
            created_by=request.user,
        )

        node_map = {}
        for node in workflow.nodes.all():
            old_id = node.id
            new_node = WorkflowNode.objects.create(
                workflow=new_wf,
                node_type=node.node_type,
                label=node.label,
                position_x=node.position_x,
                position_y=node.position_y,
                config=node.config,
            )
            node_map[old_id] = new_node

        for conn in workflow.connections.all():
            if conn.source_node_id in node_map and conn.target_node_id in node_map:
                NodeConnection.objects.create(
                    workflow=new_wf,
                    source_node=node_map[conn.source_node_id],
                    target_node=node_map[conn.target_node_id],
                )

        return Response(
            WorkflowSerializer(new_wf).data,
            status=status.HTTP_201_CREATED,
        )

    # -- Upload Links (shareable public upload pages) -----------------------

    @action(detail=True, methods=['get', 'post'], url_path='upload-links')
    def upload_links(self, request, pk=None):
        """
        GET  → list all upload links for this workflow
        POST → create a new upload link
        """
        from .serializers import WorkflowUploadLinkSerializer
        from .models import WorkflowUploadLink

        workflow = self.get_object()

        if request.method == 'GET':
            links = workflow.upload_links.all()
            return Response(WorkflowUploadLinkSerializer(links, many=True).data)

        # POST — create
        ser = WorkflowUploadLinkSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        link = WorkflowUploadLink.objects.create(
            workflow=workflow,
            created_by=request.user if request.user.is_authenticated else None,
            **{k: v for k, v in ser.validated_data.items()
               if k not in ('workflow', 'created_by')},
        )
        return Response(
            WorkflowUploadLinkSerializer(link).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['patch', 'delete'],
            url_path='upload-links/(?P<link_id>[0-9a-f-]+)')
    def upload_link_detail(self, request, pk=None, link_id=None):
        """
        PATCH  → update a link (toggle is_active, change label, etc.)
        DELETE → permanently delete a link
        """
        from .serializers import WorkflowUploadLinkSerializer
        from .models import WorkflowUploadLink

        workflow = self.get_object()
        try:
            link = workflow.upload_links.get(id=link_id)
        except WorkflowUploadLink.DoesNotExist:
            return Response({'error': 'Upload link not found.'},
                            status=status.HTTP_404_NOT_FOUND)

        if request.method == 'DELETE':
            link.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        # PATCH
        ser = WorkflowUploadLinkSerializer(link, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)

    # ======================================================================
    # Input Node Management — previous inputs, refresh, source-specific upload
    # ======================================================================

    @action(detail=True, methods=['get'],
            url_path='input-node-documents/(?P<node_id>[0-9a-f-]+)')
    def input_node_documents(self, request, pk=None, node_id=None):
        """
        List all documents that belong to a specific input node, grouped
        by source_type, with previous input history.

        GET /api/clm/workflows/{id}/input-node-documents/{node_id}/
        ?status=completed  (optional filter)

        Returns:
        {
          "node": { ... node config ... },
          "source_type": "upload",
          "supports_refresh": false,
          "supports_manage_uploaded": true,
          "documents": [ ... ],
          "document_count": N,
          "input_history": [ ... previous input operations ... ]
        }
        """
        from .models import InputNodeHistory

        workflow = self.get_object()
        try:
            node = workflow.nodes.get(id=node_id, node_type='input')
        except WorkflowNode.DoesNotExist:
            return Response(
                {'error': 'Input node not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        config = node.config or {}
        source_type = config.get('source_type', 'upload')

        # Documents belonging to this input node
        docs = workflow.documents.filter(input_node=node)
        status_filter = request.query_params.get('status')
        if status_filter:
            docs = docs.filter(extraction_status=status_filter)

        # Previous input history for this node
        history = InputNodeHistory.objects.filter(
            workflow=workflow, node=node,
        ).order_by('-created_at')[:20]

        from .serializers import InputNodeHistorySerializer
        refreshable_sources = {
            'folder_upload', 'dms_import', 'sheets', 'email_inbox',
            'google_drive', 'dropbox', 'onedrive', 's3', 'ftp',
            'url_scrape', 'table',
        }
        upload_sources = {'upload', 'bulk_upload'}

        ds = node.document_state or {}
        resp = {
            'node': {
                'id': str(node.id),
                'label': node.label or 'Input',
                'node_type': node.node_type,
                'config': config,
            },
            'source_type': source_type,
            'supports_refresh': source_type in refreshable_sources,
            'supports_manage_uploaded': source_type in upload_sources,
            'documents': WorkflowDocumentSerializer(docs, many=True).data,
            'document_count': docs.count(),
            'document_state': ds,
            'input_history': InputNodeHistorySerializer(history, many=True).data,
        }
        # For email nodes, surface the cached email_state at the top level
        if source_type == 'email_inbox':
            resp['email_state'] = ds.get('email_state', {})

        return Response(resp)

    @action(detail=True, methods=['get'],
            url_path='input-history/(?P<node_id>[0-9a-f-]+)')
    def input_history(self, request, pk=None, node_id=None):
        """
        List previous input operations for a specific input node.
        GET /api/clm/workflows/{id}/input-history/{node_id}/
        ?limit=50&source_type=upload
        """
        from .models import InputNodeHistory
        from .serializers import InputNodeHistorySerializer

        workflow = self.get_object()
        try:
            node = workflow.nodes.get(id=node_id, node_type='input')
        except WorkflowNode.DoesNotExist:
            return Response(
                {'error': 'Input node not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        limit = int(request.query_params.get('limit', 50))
        history = InputNodeHistory.objects.filter(
            workflow=workflow, node=node,
        )
        source_filter = request.query_params.get('source_type')
        if source_filter:
            history = history.filter(source_type=source_filter)

        history = history.order_by('-created_at')[:limit]

        return Response({
            'node_id': str(node.id),
            'history': InputNodeHistorySerializer(history, many=True).data,
            'count': history.count() if hasattr(history, 'count') else len(history),
        })

    @action(detail=True, methods=['get', 'post'],
            url_path='node-document-state/(?P<node_id>[0-9a-f-]+)')
    def node_document_state(self, request, pk=None, node_id=None):
        """
        GET  → Return the current document_state for an input node.
        POST → Force-sync document_state from the actual WorkflowDocument rows.

        GET/POST /api/clm/workflows/{id}/node-document-state/{node_id}/

        Returns:
        {
          "node_id": "uuid",
          "document_state": { ... },
          "source_type": "upload"
        }
        """
        workflow = self.get_object()
        try:
            node = workflow.nodes.get(id=node_id, node_type='input')
        except WorkflowNode.DoesNotExist:
            return Response(
                {'error': 'Input node not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if request.method == 'POST':
            node.sync_document_state()
            node.refresh_from_db()

        config = node.config or {}
        return Response({
            'node_id': str(node.id),
            'document_state': node.document_state or {},
            'source_type': config.get('source_type', 'upload'),
        })

    @action(detail=True, methods=['post'],
            url_path='refresh-input/(?P<node_id>[0-9a-f-]+)')
    def refresh_input(self, request, pk=None, node_id=None):
        """
        Re-fetch documents from the input node's source.

        For fetchable sources (folder_upload, dms_import, sheets, email_inbox,
        google_drive, dropbox, etc.), this re-runs the source integration to
        pick up any new files/rows.

        For upload/bulk_upload sources, this re-runs OCR + extraction on
        already-uploaded documents (optionally filtered by document_ids).

        POST /api/clm/workflows/{id}/refresh-input/{node_id}/
        Body (all optional):
        {
          "document_ids": ["uuid", ...],  // for upload: re-extract specific docs
          "force_reextract": false         // for upload: force re-extract all
        }

        Returns:
        {
          "source_type": "...",
          "action": "refreshed" | "reextracted",
          "documents_affected": N,
          "new_documents": N,
          "history_id": "uuid"
        }
        """
        from .models import InputNodeHistory

        workflow = self.get_object()
        org = _get_org(request)
        try:
            node = workflow.nodes.get(id=node_id, node_type='input')
        except WorkflowNode.DoesNotExist:
            return Response(
                {'error': 'Input node not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        config = node.config or {}
        source_type = config.get('source_type', 'upload')

        # Create history record
        history = InputNodeHistory.objects.create(
            workflow=workflow,
            node=node,
            organization=org,
            source_type=source_type,
            status='processing',
            triggered_by=request.user if request.user.is_authenticated else None,
        )

        upload_sources = {'upload', 'bulk_upload'}

        if source_type in upload_sources:
            # Re-extract already uploaded documents
            return self._refresh_upload_input(
                request, workflow, node, org, history,
            )
        else:
            # Re-fetch from external source
            return self._refresh_fetchable_input(
                request, workflow, node, org, history, source_type,
            )

    def _refresh_upload_input(self, request, workflow, node, org, history):
        """Re-OCR and re-extract already uploaded documents."""
        from .ai_inference import extract_document as run_extraction

        doc_ids = request.data.get('document_ids')
        force = request.data.get('force_reextract', False)

        docs = workflow.documents.filter(input_node=node)
        if doc_ids:
            docs = docs.filter(id__in=doc_ids)
        elif not force:
            docs = docs.filter(extraction_status__in=['pending', 'failed'])

        if not workflow.extraction_template:
            workflow.rebuild_extraction_template()
        template = workflow.extraction_template

        results = []
        created_ids = []
        failed_count = 0
        for doc in docs:
            try:
                run_extraction(doc, template)
                results.append({'id': str(doc.id), 'status': 'completed'})
                created_ids.append(str(doc.id))
            except Exception as e:
                logger.error(f"Refresh re-extract failed for {doc.id}: {e}")
                results.append({'id': str(doc.id), 'status': 'failed', 'error': str(e)})
                failed_count += 1

        history.status = 'completed' if failed_count == 0 else 'partial'
        history.document_count = len(results)
        history.failed_count = failed_count
        history.document_ids = created_ids
        history.source_reference = {'action': 'reextract', 'force': force}
        history.details = {'results': results}
        history.save()

        # Sync document_state on the input node
        node.sync_document_state()

        return Response({
            'source_type': 'upload',
            'action': 'reextracted',
            'documents_affected': len(results),
            'new_documents': 0,
            'failed': failed_count,
            'history_id': str(history.id),
            'results': results,
        })

    def _refresh_fetchable_input(self, request, workflow, node, org, history, source_type):
        """Re-fetch documents from an external source."""
        config = node.config or {}

        docs_before = set(
            workflow.documents.filter(input_node=node)
            .values_list('id', flat=True)
        )

        new_doc_ids = []
        errors = []

        try:
            if source_type == 'email_inbox':
                from .listener_executor import check_email_inbox
                result = check_email_inbox(node=node, user=request.user)
                errors = result.get('errors', [])

            elif source_type in ('google_drive', 'dropbox', 'onedrive', 's3', 'ftp', 'url_scrape'):
                from .source_integrations import fetch_from_source
                result = fetch_from_source(node, workflow, org, user=request.user)
                errors = result.get('errors', [])

            elif source_type == 'table':
                google_url = config.get('google_sheet_url', '').strip()
                if google_url:
                    from .table_parser import parse_table_file, rows_to_workflow_documents
                    parsed = parse_table_file(
                        file_bytes=b'', filename='',
                        google_sheet_url=google_url,
                    )
                    if parsed['row_count'] > 0:
                        rows_to_workflow_documents(
                            parsed=parsed, workflow=workflow,
                            organization=org, input_node=node, user=request.user,
                        )

            elif source_type == 'folder_upload':
                folder_id = config.get('folder_id', '')
                if folder_id:
                    from fileshare.models import DriveFile
                    drive_files = DriveFile.objects.filter(
                        folder_id=folder_id, is_deleted=False,
                        organization=org,
                    )
                    for df in drive_files:
                        if not df.file:
                            continue
                        if df.checksum and workflow.documents.filter(file_hash=df.checksum).exists():
                            continue
                        ext = df.name.rsplit('.', 1)[-1].lower() if '.' in df.name else 'other'
                        doc = WorkflowDocument.objects.create(
                            workflow=workflow, organization=org,
                            title=df.name, file=df.file,
                            file_type=ext if ext in WorkflowViewSet.KNOWN_TYPES else 'other',
                            file_size=df.file_size or 0,
                            file_hash=df.checksum or '',
                            uploaded_by=request.user if request.user.is_authenticated else None,
                            input_node=node,
                            global_metadata={'_source': 'folder_upload', '_folder_id': str(folder_id)},
                        )
                        # Mark as completed — extraction handled by AI extract nodes
                        doc.extraction_status = 'completed'
                        doc.save(update_fields=['extraction_status'])

            elif source_type == 'dms_import':
                dms_doc_ids = config.get('dms_document_ids', [])
                dms_category = config.get('dms_category', '')
                if dms_doc_ids or dms_category:
                    from dms.models import DmsDocument
                    dms_qs = DmsDocument.objects.all()
                    if dms_doc_ids:
                        dms_qs = dms_qs.filter(id__in=dms_doc_ids)
                    elif dms_category:
                        dms_qs = dms_qs.filter(category=dms_category)
                    for dms_doc in dms_qs:
                        content_hash = ''
                        if dms_doc.pdf_data:
                            import hashlib
                            content_hash = hashlib.sha256(dms_doc.pdf_data).hexdigest()
                        if content_hash and workflow.documents.filter(file_hash=content_hash).exists():
                            continue
                        from django.core.files.base import ContentFile
                        cf = ContentFile(dms_doc.pdf_data, name=f"{dms_doc.title or 'dms_doc'}.pdf")
                        doc = WorkflowDocument.objects.create(
                            workflow=workflow, organization=org,
                            title=dms_doc.title or dms_doc.original_filename or str(dms_doc.id),
                            file=cf, file_type='pdf',
                            file_size=dms_doc.file_size or len(dms_doc.pdf_data or b''),
                            file_hash=content_hash,
                            uploaded_by=request.user if request.user.is_authenticated else None,
                            input_node=node,
                            original_text=dms_doc.extracted_text or '',
                            text_source='direct' if dms_doc.extracted_text else 'none',
                            global_metadata={'_source': 'dms_import', '_dms_document_id': str(dms_doc.id)},
                        )
                        # Mark as completed — extraction handled by AI extract nodes
                        doc.extraction_status = 'completed'
                        doc.save(update_fields=['extraction_status'])

            elif source_type == 'sheets':
                sheet_id = config.get('sheet_id', '')
                if sheet_id:
                    from sheets.models import Sheet
                    sheet = Sheet.objects.get(id=sheet_id, organization=org)
                    rows = sheet.rows.prefetch_related('cells').order_by('order')
                    for row in rows:
                        row_meta = {}
                        for cell in row.cells.all():
                            col_def = next(
                                (c for c in (sheet.columns or []) if c.get('key') == cell.column_key),
                                None,
                            )
                            label = col_def.get('label', cell.column_key) if col_def else cell.column_key
                            row_meta[label] = cell.computed_value or cell.raw_value or ''
                        title_val = list(row_meta.values())[0] if row_meta else ''
                        title = str(title_val)[:200] or f"Sheet Row {row.order + 1}"
                        import json as _json
                        row_hash = hashlib.sha256(
                            _json.dumps(row_meta, sort_keys=True, default=str).encode()
                        ).hexdigest()
                        if workflow.documents.filter(file_hash=row_hash).exists():
                            continue
                        WorkflowDocument.objects.create(
                            workflow=workflow, organization=org,
                            title=title, file_type='other',
                            file_hash=row_hash,
                            uploaded_by=request.user if request.user.is_authenticated else None,
                            input_node=node,
                            extracted_metadata=row_meta,
                            global_metadata={
                                '_source': 'sheets', '_sheet_id': str(sheet_id),
                                '_row_order': row.order, **row_meta,
                            },
                            extraction_status='completed',
                        )

        except Exception as e:
            logger.error(f"Refresh input {source_type} failed: {e}")
            errors.append(str(e))

        # Calculate new documents
        docs_after = set(
            workflow.documents.filter(input_node=node)
            .values_list('id', flat=True)
        )
        new_doc_ids = [str(uid) for uid in (docs_after - docs_before)]

        # Update history
        history.status = 'completed' if not errors else 'partial'
        history.document_count = len(new_doc_ids)
        history.document_ids = new_doc_ids
        history.source_reference = {'source_type': source_type, 'config_snapshot': config}
        history.details = {'errors': errors} if errors else {}
        history.save()

        # Sync document_state on the input node
        node.sync_document_state()

        return Response({
            'source_type': source_type,
            'action': 'refreshed',
            'documents_affected': len(docs_after),
            'new_documents': len(new_doc_ids),
            'errors': errors,
            'history_id': str(history.id),
            'document_state': node.document_state or {},
        })

    @action(detail=True, methods=['post'],
            url_path='folder-upload/(?P<node_id>[0-9a-f-]+)')
    def folder_upload(self, request, pk=None, node_id=None):
        """
        Import files from a DriveFolder into an input node.
        POST /api/clm/workflows/{id}/folder-upload/{node_id}/
        Body: { "folder_id": "uuid" }

        Sets the input node's source_type to 'folder_upload' and imports
        all files from the specified folder. Subsequent refreshes will
        re-check the folder for new files.
        """
        from .models import InputNodeHistory

        workflow = self.get_object()
        org = _get_org(request)
        try:
            node = workflow.nodes.get(id=node_id, node_type='input')
        except WorkflowNode.DoesNotExist:
            return Response({'error': 'Input node not found.'},
                            status=status.HTTP_404_NOT_FOUND)

        folder_id = request.data.get('folder_id')
        if not folder_id:
            return Response({'error': 'folder_id is required.'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Validate folder exists
        from fileshare.models import DriveFolder
        try:
            folder = DriveFolder.objects.get(id=folder_id, organization=org, is_deleted=False)
        except DriveFolder.DoesNotExist:
            return Response({'error': 'Folder not found.'},
                            status=status.HTTP_404_NOT_FOUND)

        # Update node config
        config = node.config or {}
        config['source_type'] = 'folder_upload'
        config['folder_id'] = str(folder_id)
        config['folder_name'] = folder.name
        node.config = config
        node.save(update_fields=['config'])

        # Import files from folder
        from fileshare.models import DriveFile
        drive_files = DriveFile.objects.filter(
            folder=folder, is_deleted=False, organization=org,
        )

        if not workflow.extraction_template:
            workflow.rebuild_extraction_template()

        created = []
        skipped = []
        for df in drive_files:
            if not df.file:
                continue
            if df.checksum and WorkflowDocument.objects.filter(
                workflow=workflow, file_hash=df.checksum,
            ).exists():
                skipped.append({'name': df.name, 'reason': 'duplicate'})
                continue
            ext = df.name.rsplit('.', 1)[-1].lower() if '.' in df.name else 'other'
            doc = WorkflowDocument.objects.create(
                workflow=workflow, organization=org,
                title=df.name, file=df.file,
                file_type=ext if ext in self.KNOWN_TYPES else 'other',
                file_size=df.file_size or 0,
                file_hash=df.checksum or '',
                uploaded_by=request.user if request.user.is_authenticated else None,
                input_node=node,
                global_metadata={'_source': 'folder_upload', '_folder_id': str(folder_id)},
            )
            # Mark as completed — extraction handled by AI extract nodes
            doc.extraction_status = 'completed'
            doc.save(update_fields=['extraction_status'])
            created.append(doc)

        # Record history
        InputNodeHistory.objects.create(
            workflow=workflow, node=node, organization=org,
            source_type='folder_upload',
            status='completed',
            document_count=len(created),
            skipped_count=len(skipped),
            document_ids=[str(d.id) for d in created],
            source_reference={
                'folder_id': str(folder_id),
                'folder_name': folder.name,
                'folder_path': folder.get_path(),
            },
            details={'skipped': skipped},
            triggered_by=request.user if request.user.is_authenticated else None,
        )

        return Response({
            'documents': WorkflowDocumentSerializer(created, many=True).data,
            'count': len(created),
            'skipped': skipped,
            'folder': {'id': str(folder.id), 'name': folder.name, 'path': folder.get_path()},
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'],
            url_path='dms-import/(?P<node_id>[0-9a-f-]+)')
    def dms_import(self, request, pk=None, node_id=None):
        """
        Import documents from the DMS into an input node.
        POST /api/clm/workflows/{id}/dms-import/{node_id}/
        Body: { "document_ids": ["uuid", ...] } OR { "category": "contracts" }

        Sets the input node's source_type to 'dms_import' and creates
        WorkflowDocuments from the DMS PDF content.
        """
        from .models import InputNodeHistory

        workflow = self.get_object()
        org = _get_org(request)
        try:
            node = workflow.nodes.get(id=node_id, node_type='input')
        except WorkflowNode.DoesNotExist:
            return Response({'error': 'Input node not found.'},
                            status=status.HTTP_404_NOT_FOUND)

        dms_doc_ids = request.data.get('document_ids', [])
        category = request.data.get('category', '')
        if not dms_doc_ids and not category:
            return Response({'error': 'Provide document_ids or category.'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Update node config
        config = node.config or {}
        config['source_type'] = 'dms_import'
        if dms_doc_ids:
            config['dms_document_ids'] = dms_doc_ids
        if category:
            config['dms_category'] = category
        node.config = config
        node.save(update_fields=['config'])

        from dms.models import DmsDocument
        dms_qs = DmsDocument.objects.all()
        if dms_doc_ids:
            dms_qs = dms_qs.filter(id__in=dms_doc_ids)
        elif category:
            dms_qs = dms_qs.filter(category=category)

        if not workflow.extraction_template:
            workflow.rebuild_extraction_template()

        created = []
        skipped = []
        for dms_doc in dms_qs:
            content_hash = ''
            if dms_doc.pdf_data:
                content_hash = hashlib.sha256(dms_doc.pdf_data).hexdigest()
            if content_hash and WorkflowDocument.objects.filter(
                workflow=workflow, file_hash=content_hash,
            ).exists():
                skipped.append({'title': dms_doc.title, 'reason': 'duplicate'})
                continue

            from django.core.files.base import ContentFile
            cf = ContentFile(dms_doc.pdf_data or b'', name=f"{dms_doc.title or 'dms_doc'}.pdf")
            doc = WorkflowDocument.objects.create(
                workflow=workflow, organization=org,
                title=dms_doc.title or dms_doc.original_filename or str(dms_doc.id),
                file=cf, file_type='pdf',
                file_size=dms_doc.file_size or len(dms_doc.pdf_data or b''),
                file_hash=content_hash,
                uploaded_by=request.user if request.user.is_authenticated else None,
                input_node=node,
                original_text=dms_doc.extracted_text or '',
                text_source='direct' if dms_doc.extracted_text else 'none',
                global_metadata={'_source': 'dms_import', '_dms_document_id': str(dms_doc.id)},
            )
            # Mark as completed — extraction handled by AI extract nodes
            doc.extraction_status = 'completed'
            doc.save(update_fields=['extraction_status'])
            created.append(doc)

        InputNodeHistory.objects.create(
            workflow=workflow, node=node, organization=org,
            source_type='dms_import',
            status='completed',
            document_count=len(created),
            skipped_count=len(skipped),
            document_ids=[str(d.id) for d in created],
            source_reference={
                'dms_document_ids': dms_doc_ids,
                'category': category,
            },
            details={'skipped': skipped},
            triggered_by=request.user if request.user.is_authenticated else None,
        )

        return Response({
            'documents': WorkflowDocumentSerializer(created, many=True).data,
            'count': len(created),
            'skipped': skipped,
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'],
            url_path='sheets-import/(?P<node_id>[0-9a-f-]+)')
    def sheets_import(self, request, pk=None, node_id=None):
        """
        Import rows from a Sheet (sheets app) into an input node.
        Each row becomes a WorkflowDocument with cell values as metadata.

        POST /api/clm/workflows/{id}/sheets-import/{node_id}/
        Body: { "sheet_id": "uuid" }

        Sets the input node's source_type to 'sheets'. Refreshing will
        re-read the sheet and import any new rows.
        """
        from .models import InputNodeHistory

        workflow = self.get_object()
        org = _get_org(request)
        try:
            node = workflow.nodes.get(id=node_id, node_type='input')
        except WorkflowNode.DoesNotExist:
            return Response({'error': 'Input node not found.'},
                            status=status.HTTP_404_NOT_FOUND)

        sheet_id = request.data.get('sheet_id')
        if not sheet_id:
            return Response({'error': 'sheet_id is required.'},
                            status=status.HTTP_400_BAD_REQUEST)

        from sheets.models import Sheet
        try:
            sheet = Sheet.objects.get(id=sheet_id, organization=org)
        except Sheet.DoesNotExist:
            return Response({'error': 'Sheet not found.'},
                            status=status.HTTP_404_NOT_FOUND)

        # Update node config
        config = node.config or {}
        config['source_type'] = 'sheets'
        config['sheet_id'] = str(sheet_id)
        config['sheet_title'] = sheet.title
        node.config = config
        node.save(update_fields=['config'])

        rows = sheet.rows.prefetch_related('cells').order_by('order')
        import json as _json

        created = []
        skipped = []
        for row in rows:
            row_meta = {}
            for cell in row.cells.all():
                col_def = next(
                    (c for c in (sheet.columns or []) if c.get('key') == cell.column_key),
                    None,
                )
                label = col_def.get('label', cell.column_key) if col_def else cell.column_key
                row_meta[label] = cell.computed_value or cell.raw_value or ''

            title_val = list(row_meta.values())[0] if row_meta else ''
            title = str(title_val)[:200] or f"Sheet Row {row.order + 1}"

            row_hash = hashlib.sha256(
                _json.dumps(row_meta, sort_keys=True, default=str).encode()
            ).hexdigest()
            if WorkflowDocument.objects.filter(workflow=workflow, file_hash=row_hash).exists():
                skipped.append({'title': title, 'reason': 'duplicate'})
                continue

            doc = WorkflowDocument.objects.create(
                workflow=workflow, organization=org,
                title=title, file_type='other',
                file_hash=row_hash,
                uploaded_by=request.user if request.user.is_authenticated else None,
                input_node=node,
                extracted_metadata=row_meta,
                global_metadata={
                    '_source': 'sheets', '_sheet_id': str(sheet_id),
                    '_row_order': row.order, **row_meta,
                },
                extraction_status='completed',
            )
            created.append(doc)

        InputNodeHistory.objects.create(
            workflow=workflow, node=node, organization=org,
            source_type='sheets',
            status='completed',
            document_count=len(created),
            skipped_count=len(skipped),
            document_ids=[str(d.id) for d in created],
            source_reference={
                'sheet_id': str(sheet_id),
                'sheet_title': sheet.title,
                'row_count': rows.count(),
            },
            details={'skipped': skipped, 'headers': sheet.columns},
            triggered_by=request.user if request.user.is_authenticated else None,
        )

        return Response({
            'documents': WorkflowDocumentSerializer(created, many=True).data,
            'count': len(created),
            'skipped': skipped,
            'sheet': {'id': str(sheet.id), 'title': sheet.title},
        }, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# WorkflowNode
# ---------------------------------------------------------------------------

class WorkflowNodeViewSet(viewsets.ModelViewSet):
    """
    CRUD for individual workflow nodes.
    Use ?workflow=<uuid> to scope.
    """
    serializer_class = WorkflowNodeSerializer
    permission_classes = [permissions.AllowAny]  # DEV: allow unauthenticated

    def get_queryset(self):
        org = _get_org(self.request)
        if not org:
            return WorkflowNode.objects.none()

        qs = WorkflowNode.objects.filter(workflow__organization=org)

        workflow_id = self.request.query_params.get('workflow')
        if workflow_id:
            qs = qs.filter(workflow_id=workflow_id)

        return qs

    def perform_create(self, serializer):
        """
        After creating any node, rebuild the extraction template from
        the canvas and recompute the config hash.  This ensures the
        workflow always reflects what's on the canvas, not stale DB state.
        """
        node = serializer.save()
        node.workflow.on_canvas_changed()

    def perform_update(self, serializer):
        """
        After updating any node (config, position, label), rebuild
        extraction template and recompute config hash from the canvas.
        """
        node = serializer.save()
        node.workflow.on_canvas_changed()

    def perform_destroy(self, instance):
        """
        After deleting a node, rebuild from canvas so removed fields
        disappear and the config hash reflects the new DAG shape.
        """
        workflow = instance.workflow
        instance.delete()
        workflow.on_canvas_changed()

    # ── Sheet node actions ──────────────────────────────────────────

    @action(detail=True, methods=['get'], url_path='sheet-queries')
    def sheet_queries(self, request, pk=None):
        """
        GET /api/clm/nodes/<id>/sheet-queries/?limit=50
        Return recent SheetNodeQuery records for this sheet node.
        Includes query counts, cache hit stats, and row data.
        """
        node = self.get_object()
        if node.node_type != 'sheet':
            return Response(
                {'error': 'This action is only available for sheet nodes.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from .models import SheetNodeQuery
        from .serializers import SheetNodeQuerySerializer

        limit = int(request.query_params.get('limit', 50))
        queries = SheetNodeQuery.objects.filter(
            node=node,
        ).select_related('sheet', 'source_document').order_by('-created_at')[:limit]

        # Aggregate stats
        from django.db.models import Count, Sum, Q
        stats = SheetNodeQuery.objects.filter(node=node).aggregate(
            total_queries=Count('id'),
            total_reads=Count('id', filter=Q(operation='read')),
            total_writes=Count('id', filter=Q(operation__in=['write', 'append'])),
            total_cache_hits=Count('id', filter=Q(status='cached')),
            total_hit_count=Sum('hit_count'),
        )

        return Response({
            'node_id': str(node.id),
            'node_label': node.label,
            'stats': stats,
            'queries': SheetNodeQuerySerializer(queries, many=True).data,
        })

    @action(detail=True, methods=['get'], url_path='sheet-info')
    def sheet_info(self, request, pk=None):
        """
        GET /api/clm/nodes/<id>/sheet-info/
        Return info about the linked sheet, including columns and row count.
        """
        node = self.get_object()
        if node.node_type != 'sheet':
            return Response(
                {'error': 'This action is only available for sheet nodes.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        config = node.config or {}
        sheet_id = config.get('sheet_id')
        if not sheet_id:
            return Response({
                'linked': False,
                'message': 'No sheet linked to this node yet.',
            })

        from sheets.models import Sheet
        try:
            sheet = Sheet.objects.get(id=sheet_id)
        except Sheet.DoesNotExist:
            return Response({
                'linked': False,
                'message': f'Sheet {sheet_id} not found.',
            }, status=status.HTTP_404_NOT_FOUND)

        # Query stats for this node + sheet combo
        from .models import SheetNodeQuery
        from django.db.models import Count, Q
        query_stats = SheetNodeQuery.objects.filter(
            node=node, sheet=sheet,
        ).aggregate(
            total_queries=Count('id'),
            cache_hits=Count('id', filter=Q(status='cached')),
        )

        return Response({
            'linked': True,
            'sheet_id': str(sheet.id),
            'sheet_title': sheet.title,
            'sheet_description': sheet.description,
            'columns': sheet.columns,
            'row_count': sheet.row_count,
            'col_count': sheet.col_count,
            'mode': config.get('mode', 'storage'),
            'write_mode': config.get('write_mode', 'append'),
            'query_stats': query_stats,
        })


# ---------------------------------------------------------------------------
# NodeConnection
# ---------------------------------------------------------------------------

class NodeConnectionViewSet(viewsets.ModelViewSet):
    """
    CRUD for connections between nodes.
    Use ?workflow=<uuid> to scope.
    """
    serializer_class = NodeConnectionSerializer
    permission_classes = [permissions.AllowAny]  # DEV: allow unauthenticated

    def get_queryset(self):
        org = _get_org(self.request)
        if not org:
            return NodeConnection.objects.none()

        qs = NodeConnection.objects.filter(workflow__organization=org)

        workflow_id = self.request.query_params.get('workflow')
        if workflow_id:
            qs = qs.filter(workflow_id=workflow_id)

        return qs

    def perform_create(self, serializer):
        """Recompute config hash when a new connection is added."""
        conn = serializer.save()
        # Connections change the DAG shape — rebuild template not needed
        # (only nodes contribute fields) but hash must be recomputed.
        conn.workflow.on_canvas_changed(rebuild_template=False)

    def perform_destroy(self, instance):
        """Recompute config hash when a connection is removed."""
        workflow = instance.workflow
        instance.delete()
        workflow.on_canvas_changed(rebuild_template=False)


# ---------------------------------------------------------------------------
# PublicUploadView — No authentication required
# ---------------------------------------------------------------------------

from rest_framework.views import APIView


class PublicUploadView(APIView):
    """
    Public endpoint for shareable upload links.

    GET  /api/clm/public/upload/<token>/  → workflow info (no auth)
    POST /api/clm/public/upload/<token>/  → upload files  (no auth)
    """
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def _get_link(self, token):
        from .models import WorkflowUploadLink
        try:
            return WorkflowUploadLink.objects.select_related(
                'workflow', 'input_node',
            ).get(token=token)
        except WorkflowUploadLink.DoesNotExist:
            return None

    def _check_link_usable(self, link):
        """Return (ok, error_response) — if not ok, return the error."""
        if not link:
            return False, Response({'error': 'Upload link not found.'},
                                   status=status.HTTP_404_NOT_FOUND)
        if not link.is_usable:
            reason = 'inactive'
            if link.is_expired:
                reason = 'expired'
            elif link.is_at_limit:
                reason = 'limit_reached'
            return False, Response({'error': f'This upload link is {reason}.'},
                                   status=status.HTTP_403_FORBIDDEN)
        return True, None

    def get(self, request, token):
        """Return minimal info about the workflow for the upload page."""
        link = self._get_link(token)
        ok, err = self._check_link_usable(link)
        if not ok:
            return err

        data = {
            'token': str(link.token),
            'workflow_name': link.workflow.name,
            'workflow_description': link.workflow.description or '',
            'label': link.label or '',
            'requires_password': bool(link.password),
            'require_login': link.require_login,       # none | email_otp | phone_otp
            'input_node_label': link.input_node.label if link.input_node else None,
        }
        return Response(data)

    def post(self, request, token):
        """
        Accept file uploads from the public page.
        Re-uses the same logic as WorkflowViewSet.upload_documents
        but without requiring authentication.
        """
        from .ai_inference import extract_document
        from .models import WorkflowUploadLink, WorkflowDocument, WorkflowNode, UploadLinkOTP

        link = self._get_link(token)
        ok, err = self._check_link_usable(link)
        if not ok:
            return err

        # Password check
        if link.password:
            submitted = request.data.get('password', '')
            if submitted != link.password:
                return Response({'error': 'Incorrect password.'},
                                status=status.HTTP_403_FORBIDDEN)

        # OTP verification check
        verified_identifier = ''
        if link.require_login != 'none':
            session_token = request.data.get('session_token', '')
            if not session_token:
                return Response(
                    {'error': 'Verification required. Please verify your identity first.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
            try:
                otp_record = UploadLinkOTP.objects.get(
                    upload_link=link,
                    session_token=session_token,
                    is_verified=True,
                )
                verified_identifier = otp_record.identifier
            except UploadLinkOTP.DoesNotExist:
                return Response(
                    {'error': 'Invalid or expired verification. Please verify again.'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        workflow = link.workflow
        org = workflow.organization

        raw_files = request.FILES.getlist('files') or [request.FILES.get('file')]
        raw_files = [f for f in raw_files if f]

        if not raw_files:
            return Response({'error': 'No files provided.'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Uploader info (optional, for tracking)
        uploader_name = request.data.get('uploader_name', '')
        uploader_email = request.data.get('uploader_email', '')
        uploader_phone = request.data.get('uploader_phone', '')

        # If OTP-verified, use the verified identifier
        if verified_identifier:
            if link.require_login == 'email_otp':
                uploader_email = verified_identifier
            elif link.require_login == 'phone_otp':
                uploader_phone = verified_identifier

        # Expand ZIPs
        files = []
        for f in raw_files:
            ext = f.name.rsplit('.', 1)[-1].lower() if '.' in f.name else ''
            if ext == 'zip':
                inner = WorkflowViewSet._expand_zip(f)
                if inner:
                    files.extend(inner)
                    continue
            files.append((f.name, f))

        if not files:
            return Response({'error': 'No valid files found.'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Determine input node
        input_node_obj = link.input_node

        known_types = WorkflowViewSet.KNOWN_TYPES
        created = []
        skipped_dupes = []

        for name, fobj in files:
            ext_raw = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
            file_type = ext_raw if ext_raw in known_types else 'other'

            # SHA-256 dedup
            hasher = hashlib.sha256()
            fobj.seek(0)
            for chunk in fobj.chunks():
                hasher.update(chunk)
            file_hash = hasher.hexdigest()
            fobj.seek(0)

            existing = workflow.documents.filter(file_hash=file_hash).first()
            if existing:
                skipped_dupes.append({
                    'title': name,
                    'duplicate_of': str(existing.id),
                    'duplicate_title': existing.title,
                })
                continue

            doc = WorkflowDocument.objects.create(
                workflow=workflow,
                organization=org,
                title=name,
                file=fobj,
                file_type=file_type,
                file_size=getattr(fobj, 'size', 0) or 0,
                file_hash=file_hash,
                uploaded_by=None,  # public — no user
                input_node=input_node_obj,
                global_metadata={
                    '_source': 'public_upload',
                    '_upload_link': str(link.token),
                    '_upload_link_label': link.label or '',
                    '_uploader_name': uploader_name,
                    '_uploader_email': uploader_email,
                    '_uploader_phone': uploader_phone,
                    '_verified': bool(verified_identifier),
                    '_verified_as': verified_identifier,
                },
            )

            # Mark as completed — extraction handled by AI extract nodes
            doc.extraction_status = 'completed'
            doc.save(update_fields=['extraction_status'])

            created.append(doc)

        # Increment upload count
        link.upload_count += 1
        link.save(update_fields=['upload_count'])

        # Auto-execute if enabled
        auto_result = None
        if workflow.auto_execute_on_upload and created:
            from .node_executor import execute_workflow
            try:
                auto_result = execute_workflow(
                    workflow,
                    triggered_by=None,
                    single_document_ids=[str(d.id) for d in created],
                    mode='auto',
                )
            except Exception as e:
                logger.error(f"Auto-execute failed for public upload on {workflow.id}: {e}")

        from .serializers import WorkflowDocumentSerializer
        result = {
            'documents': WorkflowDocumentSerializer(created, many=True).data,
            'count': len(created),
            'message': f'Successfully uploaded {len(created)} document(s).',
        }
        if skipped_dupes:
            result['duplicates_skipped'] = skipped_dupes
        if auto_result:
            result['auto_execution'] = auto_result

        return Response(result, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# PublicUploadOTPView — Send / Verify OTP for public upload links
# ---------------------------------------------------------------------------

import random

class PublicUploadOTPView(APIView):
    """
    OTP verification for upload links that require login.

    POST /api/clm/public/upload/<token>/send-otp/
      body: { "identifier": "email@example.com" }   (or phone number)
      → sends 6-digit OTP, returns { "message": "..." }

    POST /api/clm/public/upload/<token>/verify-otp/
      body: { "identifier": "email@example.com", "code": "123456" }
      → returns { "session_token": "<uuid>", "identifier": "..." }
    """
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def _get_link(self, token):
        from .models import WorkflowUploadLink
        try:
            return WorkflowUploadLink.objects.select_related('workflow').get(token=token)
        except WorkflowUploadLink.DoesNotExist:
            return None


class PublicUploadSendOTPView(PublicUploadOTPView):
    """POST /api/clm/public/upload/<token>/send-otp/"""

    def post(self, request, token):
        from .models import UploadLinkOTP

        link = self._get_link(token)
        if not link:
            return Response({'error': 'Upload link not found.'},
                            status=status.HTTP_404_NOT_FOUND)
        if not link.is_usable:
            return Response({'error': 'This upload link is no longer active.'},
                            status=status.HTTP_403_FORBIDDEN)
        if link.require_login == 'none':
            return Response({'error': 'This link does not require verification.'},
                            status=status.HTTP_400_BAD_REQUEST)

        identifier = (request.data.get('identifier') or '').strip()
        if not identifier:
            return Response({'error': 'Please provide an email or phone number.'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Generate 6-digit OTP
        code = f"{random.randint(0, 999999):06d}"

        # Create OTP record
        otp = UploadLinkOTP.objects.create(
            upload_link=link,
            identifier=identifier,
            code=code,
        )

        # Send OTP
        if link.require_login == 'email_otp':
            self._send_email_otp(identifier, code, link)
        elif link.require_login == 'phone_otp':
            self._send_phone_otp(identifier, code, link)

        # Mask the identifier for the response
        if '@' in identifier:
            parts = identifier.split('@')
            masked = parts[0][:2] + '***@' + parts[1]
        else:
            masked = identifier[:3] + '****' + identifier[-2:] if len(identifier) > 5 else '***'

        return Response({
            'message': f'Verification code sent to {masked}',
            'method': link.require_login,
        })

    def _send_email_otp(self, email, code, link):
        """Send OTP code via email using Django's email system."""
        try:
            from django.core.mail import send_mail
            send_mail(
                subject=f'Your verification code: {code}',
                message=(
                    f'Your one-time verification code is: {code}\n\n'
                    f'This code is valid for 10 minutes.\n'
                    f'You are uploading documents to: {link.workflow.name}\n\n'
                    f'If you did not request this code, please ignore this email.'
                ),
                from_email=None,  # uses DEFAULT_FROM_EMAIL
                recipient_list=[email],
                fail_silently=True,
            )
        except Exception as e:
            logger.error(f"Failed to send OTP email to {email}: {e}")

    def _send_phone_otp(self, phone, code, link):
        """
        Send OTP code via SMS.
        Placeholder — integrate with Twilio / SNS / your SMS provider.
        For now, logs the code for development.
        """
        logger.info(f"[PHONE OTP] Code {code} for {phone} (link: {link.token})")
        # TODO: Integrate with SMS provider
        # Example with Twilio:
        # from twilio.rest import Client
        # client = Client(TWILIO_SID, TWILIO_TOKEN)
        # client.messages.create(body=f"Your code: {code}", from_=TWILIO_FROM, to=phone)


class PublicUploadVerifyOTPView(PublicUploadOTPView):
    """POST /api/clm/public/upload/<token>/verify-otp/"""

    def post(self, request, token):
        from .models import UploadLinkOTP

        link = self._get_link(token)
        if not link:
            return Response({'error': 'Upload link not found.'},
                            status=status.HTTP_404_NOT_FOUND)

        identifier = (request.data.get('identifier') or '').strip()
        code = (request.data.get('code') or '').strip()

        if not identifier or not code:
            return Response({'error': 'Identifier and code are required.'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Find the most recent unverified OTP for this identifier
        otp = UploadLinkOTP.objects.filter(
            upload_link=link,
            identifier=identifier,
            is_verified=False,
        ).order_by('-created_at').first()

        if not otp:
            return Response({'error': 'No pending verification found. Please request a new code.'},
                            status=status.HTTP_400_BAD_REQUEST)

        if otp.is_expired_otp:
            return Response({'error': 'Verification code has expired. Please request a new one.'},
                            status=status.HTTP_400_BAD_REQUEST)

        if otp.is_max_attempts:
            return Response({'error': 'Too many attempts. Please request a new code.'},
                            status=status.HTTP_400_BAD_REQUEST)

        otp.attempts += 1
        otp.save(update_fields=['attempts'])

        if otp.code != code:
            remaining = 5 - otp.attempts
            return Response({
                'error': f'Incorrect code. {remaining} attempt{"s" if remaining != 1 else ""} remaining.',
            }, status=status.HTTP_400_BAD_REQUEST)

        # Success — mark verified
        otp.is_verified = True
        otp.verified_at = timezone.now()
        otp.save(update_fields=['is_verified', 'verified_at'])

        return Response({
            'session_token': str(otp.session_token),
            'identifier': identifier,
            'verified': True,
        })


# ---------------------------------------------------------------------------
# Webhook Receiver — public endpoint for inbound webhooks
# ---------------------------------------------------------------------------

from rest_framework.views import APIView


class WebhookReceiverView(APIView):
    """
    POST /api/clm/webhooks/<token>/

    Public endpoint (no auth required) for receiving inbound webhook events.
    Each EventSubscription with source_type='webhook' has a unique token
    generated at compilation time.  External systems POST to this URL to
    trigger the linked workflow.

    Optional HMAC verification via X-Webhook-Signature header.
    """
    permission_classes = [permissions.AllowAny]
    authentication_classes = []  # No auth — public endpoint

    def post(self, request, token=None):
        from .event_system import process_webhook

        payload = request.data if isinstance(request.data, dict) else {'raw': str(request.data)}
        headers = {k: v for k, v in request.META.items() if k.startswith('HTTP_')}

        # Also grab standard webhook headers
        for key in ('HTTP_X_WEBHOOK_SIGNATURE', 'HTTP_X_HUB_SIGNATURE', 'HTTP_X_DELIVERY_ID'):
            val = request.META.get(key)
            if val:
                clean_key = key.replace('HTTP_', '').replace('_', '-').title()
                headers[clean_key] = val

        source_ip = request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[0].strip()
        if not source_ip:
            source_ip = request.META.get('REMOTE_ADDR')

        result = process_webhook(
            token=str(token),
            payload=payload,
            headers=headers,
            source_ip=source_ip,
        )

        if result.get('success'):
            return Response(result, status=status.HTTP_200_OK)
        else:
            return Response(result, status=status.HTTP_400_BAD_REQUEST)
