"""
Dashboard API Views

Provides comprehensive dashboard endpoints for:
- Document overview with filters
- Workflow statistics
- Shared documents
- Search functionality
- Recent activity
- Quick stats
"""
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Q, Count, Prefetch
from django.utils import timezone
from datetime import timedelta

from documents.models import (
    Document,
    DocumentWorkflow,
    WorkflowApproval,
    WorkflowNotification,
    DocumentAccessLog
)
from documents.serializers import DocumentSerializer
from documents.workflow_serializers import DocumentWorkflowListSerializer


# Simple serializer for document list
class DashboardDocumentSerializer:
    """Lightweight document serializer for dashboard — includes collaboration metadata."""
    @staticmethod
    def serialize(document, extra=None):
        data = {
            'id': str(document.id),
            'title': document.title,
            'status': document.status,
            'category': document.category,
            'document_type': document.document_type,
            'document_mode': getattr(document, 'document_mode', 'standard'),
            'author': document.author,
            'created_by': document.created_by.username if document.created_by else None,
            'created_at': document.created_at,
            'updated_at': document.updated_at,
        }
        if extra and isinstance(extra, dict):
            data.update(extra)
        return data
    
    @staticmethod
    def serialize_many(documents, extras_map=None):
        """
        extras_map: dict mapping document UUID → dict of extra fields
        """
        result = []
        for doc in documents:
            extra = extras_map.get(doc.id) if extras_map else None
            result.append(DashboardDocumentSerializer.serialize(doc, extra))
        return result

    @staticmethod
    def build_extras_map(document_ids, user=None):
        """
        Batch-query collaboration metadata for a list of document IDs.
        Returns {doc_uuid: {comment_count, share_count, approval_summary, workflow_info}}.
        """
        from viewer.models import ViewerComment, ViewerToken, ViewerApproval

        extras = {did: {} for did in document_ids}

        # ── Comment counts ───────────────────────────────────────────
        comment_counts = (
            ViewerComment.objects
            .filter(document_id__in=document_ids, is_resolved=False)
            .values('document_id')
            .annotate(count=Count('id'))
        )
        comment_map = {row['document_id']: row['count'] for row in comment_counts}

        # ── Share counts (ViewerToken) ───────────────────────────────
        share_counts = (
            ViewerToken.objects
            .filter(document_id__in=document_ids, is_active=True)
            .values('document_id')
            .annotate(count=Count('id'))
        )
        share_map = {row['document_id']: row['count'] for row in share_counts}

        # ── Viewer Approvals summary ─────────────────────────────────
        approvals = ViewerApproval.objects.filter(document_id__in=document_ids)
        approval_map = {}  # doc_id → {approved, rejected, changes_requested, total}
        for appr in approvals:
            if appr.document_id not in approval_map:
                approval_map[appr.document_id] = {
                    'approved': 0, 'rejected': 0, 'changes_requested': 0, 'total': 0
                }
            approval_map[appr.document_id][appr.status] = approval_map[appr.document_id].get(appr.status, 0) + 1
            approval_map[appr.document_id]['total'] += 1

        # ── Workflow info ────────────────────────────────────────────
        workflows = (
            DocumentWorkflow.objects
            .filter(document_id__in=document_ids, is_active=True)
            .values('document_id', 'current_status', 'priority', 'is_completed', 'due_date')
        )
        workflow_map = {}
        for wf in workflows:
            did = wf['document_id']
            if did not in workflow_map:
                workflow_map[did] = []
            workflow_map[did].append({
                'status': wf['current_status'],
                'priority': wf['priority'],
                'is_completed': wf['is_completed'],
                'due_date': wf['due_date'],
            })

        # ── Assemble extras ──────────────────────────────────────────
        for did in document_ids:
            extras[did] = {
                'comment_count': comment_map.get(did, 0),
                'share_count': share_map.get(did, 0),
                'approval_summary': approval_map.get(did, {'approved': 0, 'rejected': 0, 'changes_requested': 0, 'total': 0}),
                'workflows': workflow_map.get(did, []),
            }

        return extras


class DashboardShareSerializer:
    """Lightweight share serializer for dashboard"""
    @staticmethod
    def serialize(share):
        return {
            'id': str(share.id),
            'document': {
                'id': str(share.document.id),
                'title': share.document.title,
            },
            'share_type': share.share_type,
            'role': share.role,
            'shared_by': share.shared_by.username if share.shared_by else None,
            'shared_with': share.shared_with_user.username if share.shared_with_user else None,
            'created_at': share.shared_at,
            'expires_at': share.expires_at,
        }
    
    @staticmethod
    def serialize_many(shares):
        return [DashboardShareSerializer.serialize(share) for share in shares]


class DashboardViewSet(viewsets.ViewSet):
    """
    ViewSet for dashboard data and analytics.
    
    Endpoints:
    - GET /api/dashboard/overview/ - Complete dashboard overview
    - GET /api/dashboard/my-documents/ - Documents created by or assigned to user
    - GET /api/dashboard/workflows/ - Workflow statistics
    - GET /api/dashboard/shared/ - Shared documents
    - GET /api/dashboard/search/ - Universal search
    - GET /api/dashboard/stats/ - Quick statistics
    - GET /api/dashboard/recent-activity/ - Recent activity feed
    """
    permission_classes = [IsAuthenticated]
    
    @action(detail=False, methods=['get'], url_path='overview')
    def overview(self, request):
        """
        Complete dashboard overview with all key information.
        
        Query Parameters:
        - timeframe: 'today' | 'week' | 'month' | 'all' (default: 'week')
        - include_stats: Include statistics (default: true)
        - include_recent: Include recent activity (default: true)
        - limit: Limit items per section (default: 10)
        """
        user = request.user
        timeframe = request.query_params.get('timeframe', 'week')
        include_stats = request.query_params.get('include_stats', 'true').lower() == 'true'
        include_recent = request.query_params.get('include_recent', 'true').lower() == 'true'
        limit = int(request.query_params.get('limit', 10))
        
        # Calculate date range
        date_filter = self._get_date_filter(timeframe)
        
        response_data = {
            'timeframe': timeframe,
            'user': {
                'id': user.id,
                'username': user.username,
                'full_name': user.get_full_name() or user.username,
            }
        }
        
        # My Documents
        my_documents = Document.objects.filter(
            Q(created_by=user) | Q(workflows__assigned_to=user)
        ).distinct().select_related('created_by')
        
        if date_filter:
            my_documents = my_documents.filter(created_at__gte=date_filter)
        
        response_data['my_documents'] = {
            'total': my_documents.count(),
            'recent': DashboardDocumentSerializer.serialize_many(
                my_documents.order_by('-updated_at')[:limit]
            )
        }
        
        # My Workflows
        my_workflows = DocumentWorkflow.objects.filter(
            assigned_to=user,
            is_active=True
        ).select_related('document', 'assigned_by')
        
        response_data['my_workflows'] = {
            'total': my_workflows.count(),
            'pending': my_workflows.filter(is_completed=False).count(),
            'recent': DocumentWorkflowListSerializer(
                my_workflows.order_by('-created_at')[:limit],
                many=True
            ).data
        }
        
        # Shared Documents
        from sharing.models import Share
        from django.contrib.contenttypes.models import ContentType
        
        content_type = ContentType.objects.get_for_model(Document)
        shared_with_me = Share.objects.filter(
            content_type=content_type,
            shared_with_user=user,
            is_active=True
        ).select_related('shared_by')
        
        response_data['shared_documents'] = {
            'total': shared_with_me.count(),
            'recent': [{
                'id': str(share.id),
                'document': {
                    'id': str(share.object_id),
                    'title': Document.objects.get(id=share.object_id).title,
                },
                'share_type': share.share_type,
                'role': share.role,
                'shared_by': share.shared_by.username if share.shared_by else None,
                'created_at': share.shared_at,
                'expires_at': share.expires_at,
            } for share in shared_with_me.order_by('-shared_at')[:limit]]
        }
        
        # Pending Approvals
        pending_approvals = WorkflowApproval.objects.filter(
            approver=user,
            status='pending',
            workflow__is_active=True
        ).select_related('workflow', 'workflow__document')
        
        response_data['pending_approvals'] = {
            'total': pending_approvals.count(),
            'items': [{
                'id': str(approval.id),
                'workflow_id': str(approval.workflow.id),
                'document_title': approval.workflow.document.title,
                'role': approval.role,
                'created_at': approval.created_at,
            } for approval in pending_approvals[:limit]]
        }
        
        # Statistics
        if include_stats:
            response_data['statistics'] = self._get_statistics(user, date_filter)
        
        # Recent Activity
        if include_recent:
            response_data['recent_activity'] = self._get_recent_activity(user, limit)
        
        return Response(response_data)
    
    @action(detail=False, methods=['get'], url_path='my-documents')
    def my_documents(self, request):
        """
        Get documents with advanced filtering.
        
        Query Parameters:
        - status: Filter by status (draft, review, approved, etc.)
        - category: Filter by category
        - created_by_me: Only documents created by me (true/false)
        - assigned_to_me: Only documents assigned to me (true/false)
        - shared_with_me: Only documents shared with me (true/false)
        - search: Search in title, content, tags
        - date_from: Filter documents from this date
        - date_to: Filter documents to this date
        - sort: Sort field (created_at, updated_at, title)
        - order: Sort order (asc, desc)
        - page: Page number (default: 1)
        - page_size: Items per page (default: 20)
        """
        user = request.user
        
        # Start with documents accessible to user
        # Build separate querysets and combine them to avoid complex joins
        from django.db.models import Q
        from django.contrib.contenttypes.models import ContentType
        from django.utils import timezone
        from sharing.models import Share
        import uuid as uuid_module
        
        # Documents created by user
        created_docs = Document.objects.filter(created_by=user)
        
        # Documents with workflows assigned to user
        workflow_doc_ids = DocumentWorkflow.objects.filter(
            assigned_to=user
        ).values_list('document_id', flat=True)
        workflow_docs = Document.objects.filter(id__in=workflow_doc_ids)
        
        # Documents shared with user - using main sharing.Share model
        content_type = ContentType.objects.get_for_model(Document)
        share_doc_ids = Share.objects.filter(
            content_type=content_type,
            is_active=True,
            shared_with_user=user
        ).filter(
            Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now())
        ).values_list('object_id', flat=True)
        
        # Convert string UUIDs to proper UUID objects
        share_doc_uuids = []
        for obj_id in share_doc_ids:
            try:
                if isinstance(obj_id, str):
                    share_doc_uuids.append(uuid_module.UUID(obj_id))
                else:
                    share_doc_uuids.append(obj_id)
            except:
                pass
        
        # Use share_doc_uuids as all_shared_ids
        all_shared_ids = share_doc_uuids
        shared_docs = Document.objects.filter(id__in=all_shared_ids)
        
        # Combine all accessible documents
        queryset = (created_docs | workflow_docs | shared_docs).select_related('created_by').distinct()
        
        # Optional filters to narrow down results
        created_by_me = request.query_params.get('created_by_me', '').lower() == 'true'
        assigned_to_me = request.query_params.get('assigned_to_me', '').lower() == 'true'
        shared_with_me = request.query_params.get('shared_with_me', '').lower() == 'true'
        
        # Apply additional filters if specified
        if created_by_me:
            queryset = queryset.filter(created_by=user)
        if assigned_to_me:
            queryset = queryset.filter(id__in=workflow_doc_ids)
        if shared_with_me:
            queryset = queryset.filter(id__in=all_shared_ids)
        
        # Filter by status
        doc_status = request.query_params.get('status')
        if doc_status:
            queryset = queryset.filter(status=doc_status)
        
        # Filter by category
        category = request.query_params.get('category')
        if category:
            queryset = queryset.filter(category=category)
        
        # Date filters
        date_from = request.query_params.get('date_from')
        if date_from:
            queryset = queryset.filter(created_at__gte=date_from)
        
        date_to = request.query_params.get('date_to')
        if date_to:
            queryset = queryset.filter(created_at__lte=date_to)
        
        # Search
        search_query = request.query_params.get('search', '').strip()
        if search_query:
            queryset = queryset.filter(
                Q(title__icontains=search_query) |
                Q(content__icontains=search_query) |
                Q(tags__icontains=search_query) |
                Q(category__icontains=search_query)
            )
        
        # Sorting
        sort_field = request.query_params.get('sort', 'updated_at')
        sort_order = request.query_params.get('order', 'desc')
        
        valid_sort_fields = ['created_at', 'updated_at', 'title', 'status']
        if sort_field in valid_sort_fields:
            if sort_order == 'asc':
                queryset = queryset.order_by(sort_field)
            else:
                queryset = queryset.order_by(f'-{sort_field}')
        else:
            queryset = queryset.order_by('-updated_at')
        
        # Pagination
        page = int(request.query_params.get('page', 1))
        page_size = int(request.query_params.get('page_size', 20))
        
        total_count = queryset.count()
        start = (page - 1) * page_size
        end = start + page_size
        
        documents = queryset[start:end]
        
        # Build collaboration metadata in batch
        doc_ids = [doc.id for doc in documents]
        extras_map = DashboardDocumentSerializer.build_extras_map(doc_ids, user=user) if doc_ids else {}
        
        return Response({
            'total': total_count,
            'page': page,
            'page_size': page_size,
            'total_pages': (total_count + page_size - 1) // page_size,
            'documents': DashboardDocumentSerializer.serialize_many(documents, extras_map=extras_map),
        })
    
    @action(detail=False, methods=['get'], url_path='workflows')
    def workflows(self, request):
        """
        Get workflow statistics and list.
        
        Query Parameters:
        - status: Filter by status (pending, completed)
        - priority: Filter by priority (low, medium, high, urgent)
        - overdue: Show only overdue workflows (true/false)
        - assigned_by_me: Show workflows I assigned (true/false)
        - assigned_to_me: Show workflows assigned to me (true/false)
        """
        user = request.user
        
        # Base queryset
        queryset = DocumentWorkflow.objects.select_related(
            'document', 'assigned_to', 'assigned_by'
        )
        
        # Filter by assignment
        assigned_by_me = request.query_params.get('assigned_by_me', '').lower() == 'true'
        assigned_to_me = request.query_params.get('assigned_to_me', '').lower() == 'true'
        
        if assigned_by_me:
            queryset = queryset.filter(assigned_by=user)
        elif assigned_to_me:
            queryset = queryset.filter(assigned_to=user)
        else:
            queryset = queryset.filter(
                Q(assigned_by=user) | Q(assigned_to=user)
            )
        
        # Filter by completion
        workflow_status = request.query_params.get('status')
        if workflow_status == 'pending':
            queryset = queryset.filter(is_completed=False, is_active=True)
        elif workflow_status == 'completed':
            queryset = queryset.filter(is_completed=True)
        
        # Filter by priority
        priority = request.query_params.get('priority')
        if priority:
            queryset = queryset.filter(priority=priority)
        
        # Filter overdue
        if request.query_params.get('overdue', '').lower() == 'true':
            queryset = queryset.filter(
                due_date__lt=timezone.now(),
                is_completed=False
            )
        
        # Statistics
        total = queryset.count()
        pending = queryset.filter(is_completed=False, is_active=True).count()
        completed = queryset.filter(is_completed=True).count()
        overdue = queryset.filter(
            due_date__lt=timezone.now(),
            is_completed=False
        ).count()
        
        # Priority breakdown
        priority_stats = {
            'urgent': queryset.filter(priority='urgent', is_completed=False).count(),
            'high': queryset.filter(priority='high', is_completed=False).count(),
            'medium': queryset.filter(priority='medium', is_completed=False).count(),
            'low': queryset.filter(priority='low', is_completed=False).count(),
        }
        
        return Response({
            'total': total,
            'pending': pending,
            'completed': completed,
            'overdue': overdue,
            'priority_breakdown': priority_stats,
            'workflows': DocumentWorkflowListSerializer(
                queryset.order_by('-created_at')[:20],
                many=True
            ).data
        })
    
    @action(detail=False, methods=['get'], url_path='shared')
    def shared(self, request):
        """
        Get shared documents statistics.
        
        Query Parameters:
        - shared_by_me: Show documents I shared (true/false)
        - shared_with_me: Show documents shared with me (true/false)
        - permission: Filter by permission (view, edit, admin)
        """
        user = request.user
        from sharing.models import Share
        from django.contrib.contenttypes.models import ContentType
        
        content_type = ContentType.objects.get_for_model(Document)
        
        shared_by_me_param = request.query_params.get('shared_by_me', '').lower() == 'true'
        shared_with_me_param = request.query_params.get('shared_with_me', '').lower() == 'true'
        
        if shared_by_me_param:
            queryset = Share.objects.filter(
                content_type=content_type,
                shared_by=user,
                is_active=True
            )
        elif shared_with_me_param:
            queryset = Share.objects.filter(
                content_type=content_type,
                shared_with_user=user,
                is_active=True
            )
        else:
            queryset = Share.objects.filter(
                content_type=content_type,
                is_active=True
            ).filter(
                Q(shared_by=user) | Q(shared_with_user=user)
            )
        
        queryset = queryset.select_related('shared_by', 'shared_with_user')
        
        # Filter by permission
        permission = request.query_params.get('permission')
        if permission:
            queryset = queryset.filter(role=permission)
        
        # Statistics
        total = queryset.count()
        shared_by_me = queryset.filter(shared_by=user).count()
        shared_with_me = queryset.filter(shared_with_user=user).count()
        
        permission_stats = {
            'viewer': queryset.filter(role='viewer').count(),
            'commenter': queryset.filter(role='commenter').count(),
            'editor': queryset.filter(role='editor').count(),
        }
        
        return Response({
            'total': total,
            'shared_by_me': shared_by_me,
            'shared_with_me': shared_with_me,
            'permission_breakdown': permission_stats,
            'shares': [{
                'id': str(share.id),
                'document': {
                    'id': str(share.object_id),
                    'title': Document.objects.get(id=share.object_id).title,
                },
                'share_type': share.share_type,
                'role': share.role,
                'shared_by': share.shared_by.username if share.shared_by else None,
                'shared_with': share.shared_with_user.username if share.shared_with_user else None,
                'created_at': share.shared_at,
                'expires_at': share.expires_at,
            } for share in queryset.order_by('-shared_at')[:20]]
        })
    
    @action(detail=False, methods=['get'], url_path='search')
    def search(self, request):
        """
        Universal search across documents, workflows, and shares.
        
        Query Parameters:
        - q: Search query (required)
        - type: Filter by type (documents, workflows, shares, all)
        - limit: Max results per type (default: 10)
        """
        user = request.user
        search_query = request.query_params.get('q', '').strip()
        search_type = request.query_params.get('type', 'all')
        limit = int(request.query_params.get('limit', 10))
        
        if not search_query:
            return Response({
                'error': 'Search query is required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        results = {}
        
        # Search documents with optimized query
        if search_type in ['all', 'documents']:
            from django.contrib.contenttypes.models import ContentType
            from sharing.models import Share
            
            # Get accessible document IDs efficiently
            created_doc_ids = Document.objects.filter(created_by=user).values_list('id', flat=True)
            workflow_doc_ids = DocumentWorkflow.objects.filter(assigned_to=user).values_list('document_id', flat=True)
            
            content_type = ContentType.objects.get_for_model(Document)
            share_doc_ids = Share.objects.filter(
                content_type=content_type,
                shared_with_user=user,
                is_active=True
            ).values_list('object_id', flat=True)
            
            # Convert share IDs to UUIDs
            import uuid as uuid_module
            share_doc_uuids = []
            for obj_id in share_doc_ids:
                try:
                    share_doc_uuids.append(uuid_module.UUID(obj_id) if isinstance(obj_id, str) else obj_id)
                except:
                    pass
            
            # Combine all accessible IDs
            all_doc_ids = set(list(created_doc_ids) + list(workflow_doc_ids) + share_doc_uuids)
            
            # Build fuzzy search query - use trigram similarity if available
            search_words = search_query.split()
            
            # Build Q objects for each word (fuzzy matching)
            q_objects = Q()
            for word in search_words:
                q_objects |= (
                    Q(title__icontains=word) |
                    Q(content__icontains=word) |
                    Q(tags__icontains=word) |
                    Q(category__icontains=word)
                )
            
            # Apply search on accessible documents only
            documents = Document.objects.filter(
                id__in=all_doc_ids
            ).filter(q_objects).select_related('created_by').distinct()[:limit]
            
            results['documents'] = {
                'count': documents.count(),
                'items': DashboardDocumentSerializer.serialize_many(documents)
            }
        
        # Search workflows
        if search_type in ['all', 'workflows']:
            search_words = search_query.split()
            q_objects = Q()
            for word in search_words:
                q_objects |= (
                    Q(document__title__icontains=word) |
                    Q(message__icontains=word) |
                    Q(notes__icontains=word) |
                    Q(current_status__icontains=word)
                )
            
            workflows = DocumentWorkflow.objects.filter(
                Q(assigned_to=user) | Q(assigned_by=user)
            ).filter(q_objects).select_related(
                'document', 'assigned_to', 'assigned_by'
            ).distinct()[:limit]
            
            results['workflows'] = {
                'count': workflows.count(),
                'items': DocumentWorkflowListSerializer(workflows, many=True).data
            }
        
        # Search shares - optimized with subquery
        if search_type in ['all', 'shares']:
            from sharing.models import Share
            from django.contrib.contenttypes.models import ContentType
            
            content_type = ContentType.objects.get_for_model(Document)
            
            # Get document IDs that match search
            search_words = search_query.split()
            q_objects = Q()
            for word in search_words:
                q_objects |= Q(title__icontains=word)
            
            matching_doc_ids = Document.objects.filter(q_objects).values_list('id', flat=True)[:100]
            
            # Get shares for matching documents
            shares = Share.objects.filter(
                content_type=content_type,
                object_id__in=[str(doc_id) for doc_id in matching_doc_ids],
                is_active=True
            ).filter(
                Q(shared_by=user) | Q(shared_with_user=user)
            ).select_related('shared_by', 'shared_with_user')[:limit]
            
            # Fetch documents in batch
            doc_ids = [share.object_id for share in shares]
            documents_dict = {str(doc.id): doc for doc in Document.objects.filter(id__in=doc_ids)}
            
            filtered_shares = []
            for share in shares:
                doc = documents_dict.get(share.object_id)
                if doc:
                    filtered_shares.append({
                        'id': str(share.id),
                        'document': {
                            'id': str(share.object_id),
                            'title': doc.title,
                        },
                        'share_type': share.share_type,
                        'role': share.role,
                        'shared_by': share.shared_by.username if share.shared_by else None,
                        'shared_with': share.shared_with_user.username if share.shared_with_user else None,
                        'created_at': share.shared_at,
                        'expires_at': share.expires_at,
                    })
            
            results['shares'] = {
                'count': len(filtered_shares),
                'items': filtered_shares
            }
        
        return Response({
            'query': search_query,
            'results': results
        })
    
    @action(detail=False, methods=['get'], url_path='stats')
    def stats(self, request):
        """
        Quick statistics for dashboard.
        
        Query Parameters:
        - timeframe: 'today' | 'week' | 'month' | 'all' (default: 'all')
        """
        user = request.user
        timeframe = request.query_params.get('timeframe', 'all')
        date_filter = self._get_date_filter(timeframe)
        
        stats = self._get_statistics(user, date_filter)
        stats['timeframe'] = timeframe
        
        return Response(stats)
    
    @action(detail=False, methods=['get'], url_path='recent-activity')
    def recent_activity(self, request):
        """
        Get recent activity feed.
        
        Query Parameters:
        - limit: Max activities to return (default: 20)
        - type: Filter by type (documents, workflows, shares, all)
        """
        user = request.user
        limit = int(request.query_params.get('limit', 20))
        activity_type = request.query_params.get('type', 'all')
        
        activities = self._get_recent_activity(user, limit, activity_type)
        
        return Response({
            'activities': activities,
            'count': len(activities)
        })
    
    # Helper methods
    
    def _get_date_filter(self, timeframe):
        """Calculate date filter based on timeframe"""
        now = timezone.now()
        
        if timeframe == 'today':
            return now.replace(hour=0, minute=0, second=0, microsecond=0)
        elif timeframe == 'week':
            return now - timedelta(days=7)
        elif timeframe == 'month':
            return now - timedelta(days=30)
        else:
            return None
    
    def _get_statistics(self, user, date_filter=None):
        """Get comprehensive statistics"""
        # Documents
        my_docs = Document.objects.filter(created_by=user)
        if date_filter:
            my_docs = my_docs.filter(created_at__gte=date_filter)
        
        # Workflows
        my_workflows = DocumentWorkflow.objects.filter(
            Q(assigned_to=user) | Q(assigned_by=user)
        )
        if date_filter:
            my_workflows = my_workflows.filter(created_at__gte=date_filter)
        
        # Shares
        from sharing.models import Share
        from django.contrib.contenttypes.models import ContentType
        
        content_type = ContentType.objects.get_for_model(Document)
        my_shares = Share.objects.filter(
            content_type=content_type,
            is_active=True
        ).filter(
            Q(shared_by=user) | Q(shared_with_user=user)
        )
        if date_filter:
            my_shares = my_shares.filter(shared_at__gte=date_filter)
        
        return {
            'documents': {
                'total': my_docs.count(),
                'by_status': {
                    'draft': my_docs.filter(status='draft').count(),
                    'review': my_docs.filter(status='review').count(),
                    'approved': my_docs.filter(status='approved').count(),
                    'executed': my_docs.filter(status='executed').count(),
                },
                'by_category': dict(
                    my_docs.values('category').annotate(count=Count('id')).values_list('category', 'count')
                )
            },
            'workflows': {
                'total': my_workflows.count(),
                'pending': my_workflows.filter(is_completed=False, is_active=True).count(),
                'completed': my_workflows.filter(is_completed=True).count(),
                'overdue': my_workflows.filter(
                    due_date__lt=timezone.now(),
                    is_completed=False
                ).count(),
            },
            'shares': {
                'total': my_shares.count(),
                'shared_by_me': my_shares.filter(shared_by=user).count(),
                'shared_with_me': my_shares.filter(shared_with_user=user).count(),
            },
            'approvals': {
                'pending': WorkflowApproval.objects.filter(
                    approver=user,
                    status='pending',
                    workflow__is_active=True
                ).count(),
            }
        }
    
    def _get_recent_activity(self, user, limit=20, activity_type='all'):
        """Get recent activity feed"""
        activities = []
        
        # Recent documents
        if activity_type in ['all', 'documents']:
            # Get shared document IDs from the main sharing.Share model
            from sharing.models import Share
            from django.contrib.contenttypes.models import ContentType
            from django.utils import timezone
            import uuid as uuid_module

            content_type = ContentType.objects.get_for_model(Document)
            share_qs = Share.objects.filter(
                content_type=content_type,
                is_active=True
            ).filter(
                Q(shared_with_user=user) | Q(shared_by=user)
            ).filter(
                Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now())
            )

            share_doc_ids = []
            for s in share_qs.values_list('object_id', flat=True):
                try:
                    if isinstance(s, str):
                        share_doc_ids.append(uuid_module.UUID(s))
                    else:
                        share_doc_ids.append(s)
                except Exception:
                    # ignore invalid ids
                    pass

            recent_docs = Document.objects.filter(
                Q(created_by=user) |
                Q(workflows__assigned_to=user) |
                Q(id__in=share_doc_ids)
            ).distinct().select_related('created_by').order_by('-updated_at')[:limit]
            
            for doc in recent_docs:
                activities.append({
                    'type': 'document',
                    'action': 'updated',
                    'timestamp': doc.updated_at,
                    'data': {
                        'id': str(doc.id),
                        'title': doc.title,
                        'status': doc.status,
                        'created_by': doc.created_by.username if doc.created_by else None,
                    }
                })
        
        # Recent workflows
        if activity_type in ['all', 'workflows']:
            recent_workflows = DocumentWorkflow.objects.filter(
                Q(assigned_to=user) | Q(assigned_by=user)
            ).select_related('document', 'assigned_by').order_by('-updated_at')[:limit]
            
            for workflow in recent_workflows:
                activities.append({
                    'type': 'workflow',
                    'action': 'completed' if workflow.is_completed else 'assigned',
                    'timestamp': workflow.updated_at,
                    'data': {
                        'id': str(workflow.id),
                        'document_title': workflow.document.title,
                        'status': workflow.current_status,
                        'priority': workflow.priority,
                        'assigned_by': workflow.assigned_by.username if workflow.assigned_by else None,
                    }
                })
        
        # Recent shares
        if activity_type in ['all', 'shares']:
            from sharing.models import Share
            from django.contrib.contenttypes.models import ContentType
            
            content_type = ContentType.objects.get_for_model(Document)
            recent_shares = Share.objects.filter(
                content_type=content_type,
                is_active=True
            ).filter(
                Q(shared_by=user) | Q(shared_with_user=user)
            ).select_related('shared_by').order_by('-shared_at')[:limit]
            
            for share in recent_shares:
                try:
                    doc = Document.objects.get(id=share.object_id)
                    activities.append({
                        'type': 'share',
                        'action': 'shared',
                        'timestamp': share.shared_at,
                        'data': {
                            'id': str(share.id),
                            'document_title': doc.title,
                            'permission': share.role,
                            'shared_by': share.shared_by.username if share.shared_by else None,
                        }
                    })
                except Document.DoesNotExist:
                    pass
        
        # Sort by timestamp
        activities.sort(key=lambda x: x['timestamp'], reverse=True)
        
        return activities[:limit]
