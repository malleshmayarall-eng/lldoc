"""
Views for Document Workflow & Task Assignment System

Provides API endpoints for:
- Creating and managing workflows
- Assigning tasks to users (same org, team, or specific person)
- Approval chains
- Comments and collaboration
- Notifications for assigned work
"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Q, Count
from django.utils import timezone
from django.shortcuts import get_object_or_404

from documents.models import (
    Document,
    DocumentWorkflow,
    WorkflowApproval,
    WorkflowComment,
    WorkflowNotification,
    WorkflowDecisionStep,
)
from documents.workflow_serializers import (
    DocumentWorkflowSerializer,
    DocumentWorkflowListSerializer,
    CreateWorkflowSerializer,
    WorkflowApprovalSerializer,
    WorkflowCommentSerializer,
    WorkflowNotificationSerializer,
    TeamMemberSerializer,
    WorkflowDecisionStepSerializer,
    CreateDecisionStepSerializer,
    WorkflowWithDecisionStepsSerializer,
)
from user_management.models import UserProfile, Team
from communications.dispatch import send_alert


class DocumentWorkflowViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing document workflows and task assignments.
    
    Endpoints:
    - GET /api/workflows/ - List all workflows
    - POST /api/workflows/ - Create new workflow
    - GET /api/workflows/{id}/ - Get workflow details
    - PUT/PATCH /api/workflows/{id}/ - Update workflow
    - DELETE /api/workflows/{id}/ - Delete workflow
    - GET /api/workflows/my-tasks/ - Get workflows assigned to me
    - GET /api/workflows/assigned-by-me/ - Get workflows I assigned
    - GET /api/workflows/by-org/{org}/ - Get workflows for organization
    - GET /api/workflows/by-team/{team}/ - Get workflows for team
    - POST /api/workflows/{id}/reassign/ - Reassign workflow
    - POST /api/workflows/{id}/complete/ - Mark workflow as complete
    - POST /api/workflows/{id}/update-status/ - Update workflow status
    """
    permission_classes = [IsAuthenticated]
    
    def get_serializer_class(self):
        if self.action == 'list':
            return DocumentWorkflowListSerializer
        elif self.action == 'create':
            return CreateWorkflowSerializer
        return DocumentWorkflowSerializer
    
    def get_queryset(self):
        """
        Return workflows based on filters.
        Users can see:
        - Workflows assigned to them
        - Workflows they created
        - Workflows in their organization
        """
        user = self.request.user
        queryset = DocumentWorkflow.objects.select_related(
            'document', 'assigned_to', 'assigned_by'
        ).prefetch_related('approvals', 'comments')
        
        # Filter by status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')
        
        # Filter by completion
        is_completed = self.request.query_params.get('is_completed')
        if is_completed is not None:
            queryset = queryset.filter(is_completed=is_completed.lower() == 'true')
        
        # Filter by priority
        priority = self.request.query_params.get('priority')
        if priority:
            queryset = queryset.filter(priority=priority)
        
        # Filter by status
        current_status = self.request.query_params.get('status')
        if current_status:
            queryset = queryset.filter(current_status=current_status)
        
        # Filter by document
        document_id = self.request.query_params.get('document')
        if document_id:
            queryset = queryset.filter(document_id=document_id)
        
        return queryset.order_by('-created_at')
    
    def perform_create(self, serializer):
        """Set assigned_by to current user"""
        serializer.save(assigned_by=self.request.user)
    
    @action(detail=False, methods=['get'], url_path='my-tasks')
    def my_tasks(self, request):
        """
        Get workflows assigned to the current user.
        Filter for active tasks by default.
        """
        workflows = DocumentWorkflow.objects.filter(
            assigned_to=request.user,
            is_active=True
        ).select_related('document', 'assigned_by').order_by('due_date')
        
        serializer = DocumentWorkflowListSerializer(workflows, many=True)
        return Response({
            'count': workflows.count(),
            'tasks': serializer.data
        })
    
    @action(detail=False, methods=['get'], url_path='assigned-by-me')
    def assigned_by_me(self, request):
        """Get workflows assigned by the current user"""
        workflows = DocumentWorkflow.objects.filter(
            assigned_by=request.user
        ).select_related('document', 'assigned_to').order_by('-created_at')
        
        serializer = DocumentWorkflowListSerializer(workflows, many=True)
        return Response({
            'count': workflows.count(),
            'workflows': serializer.data
        })
    
    @action(detail=False, methods=['get'], url_path='by-org/(?P<organization>[^/.]+)')
    def by_organization(self, request, organization=None):
        """Get workflows for a specific organization"""
        workflows = DocumentWorkflow.objects.filter(
            organization=organization,
            is_active=True
        ).select_related('document', 'assigned_to', 'assigned_by').order_by('-created_at')
        
        serializer = DocumentWorkflowListSerializer(workflows, many=True)
        return Response({
            'organization': organization,
            'count': workflows.count(),
            'workflows': serializer.data
        })
    
    @action(detail=False, methods=['get'], url_path='by-team/(?P<team>[^/.]+)')
    def by_team(self, request, team=None):
        """Get workflows for a specific team"""
        workflows = DocumentWorkflow.objects.filter(
            team=team,
            is_active=True
        ).select_related('document', 'assigned_to', 'assigned_by').order_by('-created_at')
        
        serializer = DocumentWorkflowListSerializer(workflows, many=True)
        return Response({
            'team': team,
            'count': workflows.count(),
            'workflows': serializer.data
        })
    
    @action(detail=True, methods=['post'])
    def reassign(self, request, pk=None):
        """
        Reassign workflow to a different user.
        
        Body:
        {
            "assigned_to": user_id,
            "message": "Optional message for new assignee"
        }
        """
        workflow = self.get_object()
        
        new_assignee_id = request.data.get('assigned_to')
        message = request.data.get('message', '')
        
        if not new_assignee_id:
            return Response(
                {'error': 'assigned_to is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        from django.contrib.auth.models import User
        try:
            new_assignee = User.objects.get(pk=new_assignee_id)
        except User.DoesNotExist:
            return Response(
                {'error': 'User not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Reassign
        workflow.reassign(new_assignee, request.user, message)
        
        # Create notification
        WorkflowNotification.objects.create(
            workflow=workflow,
            recipient=new_assignee,
            notification_type='reassignment',
            title=f'Task Reassigned: {workflow.document.title}',
            message=message or f'{request.user.username} reassigned this task to you.'
        )
        # Communications alert (in-app + email)
        send_alert(
            category='workflow.status_changed',
            recipient=new_assignee,
            title=f'Task Reassigned: {workflow.document.title}',
            message=message or f'{request.user.username} reassigned this task to you.',
            actor=request.user,
            target_type='workflow',
            target_id=str(workflow.id),
            email=True,
        )
        
        serializer = DocumentWorkflowSerializer(workflow)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'], url_path='search-team-members')
    def search_team_members(self, request):
        """
        Search for team members from the same organization/team for workflow assignment.
        
        Query Parameters:
        - q: Search query (searches username, first_name, last_name, email)
        - team: Filter by team name (partial match)
        - team_id: Filter by team UUID
        - exclude_self: Exclude current user from results (default: false)
        - limit: Maximum results to return (default: 50, max: 100)
        
        Returns list of users with their profile information who can be assigned workflows.
        Only returns users from the same organization as the requesting user.
        """
        from django.contrib.auth.models import User
        from django.db.models import Q
        
        # Get current user's profile
        try:
            user_profile = request.user.profile
        except UserProfile.DoesNotExist:
            return Response(
                {'error': 'User profile not found. Please complete your profile setup.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Start with users from the same organization
        queryset = User.objects.filter(
            profile__organization=user_profile.organization,
            profile__is_active=True,
            is_active=True
        ).select_related('profile', 'profile__organization', 'profile__role').distinct()
        
        # Filter by team if specified
        team_param = request.query_params.get('team')
        team_id_param = request.query_params.get('team_id')
        
        if team_id_param:
            # Filter by team UUID
            queryset = queryset.filter(profile__teams__id=team_id_param)
        elif team_param:
            # Filter by team name (case-insensitive partial match)
            queryset = queryset.filter(
                profile__teams__name__icontains=team_param,
                profile__teams__organization=user_profile.organization
            )
        
        # Search query
        search_query = request.query_params.get('q', '').strip()
        if search_query:
            queryset = queryset.filter(
                Q(username__icontains=search_query) |
                Q(first_name__icontains=search_query) |
                Q(last_name__icontains=search_query) |
                Q(email__icontains=search_query) |
                Q(profile__job_title__icontains=search_query) |
                Q(profile__department__icontains=search_query)
            )
        
        # Exclude current user from results (optional)
        exclude_self = request.query_params.get('exclude_self', 'false').lower() == 'true'
        if exclude_self:
            queryset = queryset.exclude(id=request.user.id)
        
        # Order by name
        queryset = queryset.order_by('first_name', 'last_name', 'username')
        
        # Limit results
        limit = min(int(request.query_params.get('limit', 50)), 100)
        queryset = queryset[:limit]
        
        # Serialize
        serializer = TeamMemberSerializer(queryset, many=True)
        
        return Response({
            'count': len(serializer.data),
            'organization': user_profile.organization.name,
            'members': serializer.data
        })
    
    @action(detail=False, methods=['get'], url_path='get-teams')
    def get_teams(self, request):
        """
        Get all teams in the current user's organization.
        
        Query Parameters:
        - q: Search query (searches team name and description)
        - is_active: Filter by active status (default: true)
        
        Returns list of teams that the user can assign workflows to.
        """
        # Get current user's profile
        try:
            user_profile = request.user.profile
        except UserProfile.DoesNotExist:
            return Response(
                {'error': 'User profile not found. Please complete your profile setup.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get teams from user's organization
        queryset = Team.objects.filter(
            organization=user_profile.organization
        ).select_related('organization', 'team_lead', 'team_lead__user').prefetch_related('members')
        
        # Filter by active status
        is_active = request.query_params.get('is_active', 'true').lower()
        if is_active == 'true':
            queryset = queryset.filter(is_active=True)
        
        # Search query
        search_query = request.query_params.get('q', '').strip()
        if search_query:
            from django.db.models import Q
            queryset = queryset.filter(
                Q(name__icontains=search_query) |
                Q(description__icontains=search_query)
            )
        
        # Order by name
        queryset = queryset.order_by('name')
        
        # Prepare response data
        teams_data = []
        for team in queryset:
            team_data = {
                'id': str(team.id),
                'name': team.name,
                'description': team.description,
                'is_active': team.is_active,
                'members_count': team.get_members_count(),
                'team_lead': None
            }
            
            if team.team_lead:
                team_data['team_lead'] = {
                    'id': team.team_lead.user.id,
                    'username': team.team_lead.user.username,
                    'full_name': f"{team.team_lead.user.first_name} {team.team_lead.user.last_name}".strip() or team.team_lead.user.username,
                    'job_title': team.team_lead.job_title
                }
            
            teams_data.append(team_data)
        
        return Response({
            'count': len(teams_data),
            'organization': user_profile.organization.name,
            'teams': teams_data
        })
    
    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        """Mark workflow as completed"""
        workflow = self.get_object()
        
        if workflow.is_completed:
            return Response(
                {'error': 'Workflow already completed'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        workflow.mark_completed()
        
        # Sync document status → done when workflow is completed
        doc = workflow.document
        doc.status = 'done'
        doc.save(update_fields=['status', 'updated_at'])

        # Notify the assigner
        if workflow.assigned_by:
            WorkflowNotification.objects.create(
                workflow=workflow,
                recipient=workflow.assigned_by,
                notification_type='status_change',
                title=f'Task Completed: {workflow.document.title}',
                message=f'{request.user.username} completed the assigned task.'
            )
            send_alert(
                category='workflow.status_changed',
                recipient=workflow.assigned_by,
                title=f'Task Completed: {workflow.document.title}',
                message=f'{request.user.username} completed the assigned task.',
                actor=request.user,
                target_type='workflow',
                target_id=str(workflow.id),
                email=True,
            )
        
        serializer = DocumentWorkflowSerializer(workflow)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'], url_path='update-status')
    def update_status(self, request, pk=None):
        """
        Update workflow status.
        
        Body:
        {
            "status": "draft|review|approved|revision_required|executed|archived|cancelled"
        }
        """
        workflow = self.get_object()
        new_status = request.data.get('status')
        
        if not new_status:
            return Response(
                {'error': 'status is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        valid_statuses = dict(DocumentWorkflow.WORKFLOW_STATUS_CHOICES).keys()
        if new_status not in valid_statuses:
            return Response(
                {'error': f'Invalid status. Must be one of: {", ".join(valid_statuses)}'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        old_status = workflow.current_status
        workflow.current_status = new_status
        workflow.save(update_fields=['current_status', 'updated_at'])
        
        # Sync document status when workflow transitions to key states
        WORKFLOW_TO_DOC_STATUS = {
            'review': 'under_review',
            'approved': 'done',
            'executed': 'done',
        }
        if new_status in WORKFLOW_TO_DOC_STATUS:
            doc = workflow.document
            doc.status = WORKFLOW_TO_DOC_STATUS[new_status]
            doc.save(update_fields=['status', 'updated_at'])

        # Notify interested parties
        if workflow.assigned_to and workflow.assigned_to != request.user:
            WorkflowNotification.objects.create(
                workflow=workflow,
                recipient=workflow.assigned_to,
                notification_type='status_change',
                title=f'Status Changed: {workflow.document.title}',
                message=f'Status changed from {old_status} to {new_status}'
            )
            send_alert(
                category='workflow.status_changed',
                recipient=workflow.assigned_to,
                title=f'Status Changed: {workflow.document.title}',
                message=f'Status changed from {old_status} to {new_status}.',
                actor=request.user,
                target_type='workflow',
                target_id=str(workflow.id),
                email=True,
            )
        
        serializer = DocumentWorkflowSerializer(workflow)
        return Response(serializer.data)


class WorkflowApprovalViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing workflow approvals.
    
    Endpoints:
    - GET /api/workflow-approvals/ - List approvals
    - POST /api/workflow-approvals/ - Create approval
    - GET /api/workflow-approvals/{id}/ - Get approval details
    - PUT/PATCH /api/workflow-approvals/{id}/ - Update approval
    - DELETE /api/workflow-approvals/{id}/ - Delete approval
    - POST /api/workflow-approvals/{id}/approve/ - Approve
    - POST /api/workflow-approvals/{id}/reject/ - Reject
    - GET /api/workflow-approvals/my-approvals/ - Get pending approvals for me
    """
    serializer_class = WorkflowApprovalSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        queryset = WorkflowApproval.objects.select_related(
            'workflow', 'workflow__document', 'approver'
        )
        
        # Filter by workflow
        workflow_id = self.request.query_params.get('workflow')
        if workflow_id:
            queryset = queryset.filter(workflow_id=workflow_id)
        
        # Filter by status
        approval_status = self.request.query_params.get('status')
        if approval_status:
            queryset = queryset.filter(status=approval_status)
        
        return queryset.order_by('workflow', 'order')
    
    @action(detail=False, methods=['get'], url_path='my-approvals')
    def my_approvals(self, request):
        """Get pending approvals for the current user"""
        approvals = WorkflowApproval.objects.filter(
            approver=request.user,
            status='pending',
            workflow__is_active=True
        ).select_related('workflow', 'workflow__document', 'workflow__assigned_to').order_by('workflow__due_date')
        
        from .workflow_serializers import WorkflowApprovalDetailSerializer
        serializer = WorkflowApprovalDetailSerializer(approvals, many=True)
        return Response({
            'count': approvals.count(),
            'approvals': serializer.data
        })
    
    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """
        Approve this approval.
        
        Body:
        {
            "comments": "Optional approval comments"
        }
        """
        approval = self.get_object()
        
        if approval.approver != request.user:
            return Response(
                {'error': 'Only the assigned approver can approve'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        comments = request.data.get('comments', '')
        approval.approve(comments)
        
        # Notify workflow owner
        if approval.workflow.assigned_to:
            WorkflowNotification.objects.create(
                workflow=approval.workflow,
                recipient=approval.workflow.assigned_to,
                notification_type='approval_approved',
                title=f'Approval Granted: {approval.workflow.document.title}',
                message=f'{request.user.username} approved. {comments}',
                approval=approval
            )
            send_alert(
                category='workflow.approved',
                recipient=approval.workflow.assigned_to,
                title=f'Approval Granted: {approval.workflow.document.title}',
                message=f'{request.user.username} approved. {comments}',
                actor=request.user,
                target_type='workflow',
                target_id=str(approval.workflow.id),
                email=True,
            )
        
        serializer = WorkflowApprovalSerializer(approval)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        """
        Reject this approval.
        
        Body:
        {
            "comments": "Reason for rejection (required)"
        }
        """
        approval = self.get_object()
        
        if approval.approver != request.user:
            return Response(
                {'error': 'Only the assigned approver can reject'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        comments = request.data.get('comments', '')
        if not comments:
            return Response(
                {'error': 'Comments are required when rejecting'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        approval.reject(comments)
        
        # Notify workflow owner
        if approval.workflow.assigned_to:
            WorkflowNotification.objects.create(
                workflow=approval.workflow,
                recipient=approval.workflow.assigned_to,
                notification_type='approval_rejected',
                title=f'Approval Rejected: {approval.workflow.document.title}',
                message=f'{request.user.username} rejected: {comments}',
                approval=approval
            )
            send_alert(
                category='workflow.rejected',
                recipient=approval.workflow.assigned_to,
                title=f'Approval Rejected: {approval.workflow.document.title}',
                message=f'{request.user.username} rejected: {comments}',
                actor=request.user,
                priority='high',
                target_type='workflow',
                target_id=str(approval.workflow.id),
                email=True,
            )
        
        serializer = WorkflowApprovalSerializer(approval)
        return Response(serializer.data)


class WorkflowCommentViewSet(viewsets.ModelViewSet):
    """
    ViewSet for workflow comments and collaboration.
    
    Endpoints:
    - GET /api/workflow-comments/ - List comments
    - POST /api/workflow-comments/ - Create comment
    - GET /api/workflow-comments/{id}/ - Get comment
    - PUT/PATCH /api/workflow-comments/{id}/ - Update comment
    - DELETE /api/workflow-comments/{id}/ - Delete comment
    - POST /api/workflow-comments/{id}/resolve/ - Mark as resolved
    """
    serializer_class = WorkflowCommentSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        queryset = WorkflowComment.objects.select_related(
            'workflow', 'workflow__document', 'user'
        ).prefetch_related('mentions')
        
        # Filter by workflow
        workflow_id = self.request.query_params.get('workflow')
        if workflow_id:
            queryset = queryset.filter(workflow_id=workflow_id)
        
        # Filter by type
        comment_type = self.request.query_params.get('type')
        if comment_type:
            queryset = queryset.filter(comment_type=comment_type)
        
        # Filter by resolved status
        is_resolved = self.request.query_params.get('is_resolved')
        if is_resolved is not None:
            queryset = queryset.filter(is_resolved=is_resolved.lower() == 'true')
        
        return queryset.order_by('-created_at')
    
    def perform_create(self, serializer):
        """Set user to current user and handle mentions"""
        comment = serializer.save(user=self.request.user)
        
        # Create notifications for mentions
        mentions_data = self.request.data.get('mentions', [])
        if mentions_data:
            from django.contrib.auth.models import User
            mentioned_users = User.objects.filter(id__in=mentions_data)
            comment.mentions.set(mentioned_users)
            
            for user in mentioned_users:
                WorkflowNotification.objects.create(
                    workflow=comment.workflow,
                    recipient=user,
                    notification_type='mention',
                    title=f'You were mentioned: {comment.workflow.document.title}',
                    message=f'{self.request.user.username} mentioned you in a comment',
                    comment=comment
                )
                send_alert(
                    category='document.mention',
                    recipient=user,
                    title=f'You were mentioned: {comment.workflow.document.title}',
                    message=f'{self.request.user.username} mentioned you in a comment.',
                    actor=self.request.user,
                    target_type='workflow',
                    target_id=str(comment.workflow.id),
                    email=True,
                )
    
    @action(detail=True, methods=['post'])
    def resolve(self, request, pk=None):
        """Mark comment as resolved"""
        comment = self.get_object()
        comment.is_resolved = True
        comment.save(update_fields=['is_resolved', 'updated_at'])
        
        serializer = WorkflowCommentSerializer(comment)
        return Response(serializer.data)


class WorkflowNotificationViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet for workflow notifications.
    Users can see notifications assigned to them.
    
    Endpoints:
    - GET /api/workflow-notifications/ - List my notifications
    - GET /api/workflow-notifications/{id}/ - Get notification
    - GET /api/workflow-notifications/unread/ - Get unread notifications
    - POST /api/workflow-notifications/{id}/mark-read/ - Mark as read
    - POST /api/workflow-notifications/mark-all-read/ - Mark all as read
    """
    serializer_class = WorkflowNotificationSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        """Only show notifications for current user"""
        queryset = WorkflowNotification.objects.filter(
            recipient=self.request.user
        ).select_related('workflow', 'workflow__document', 'approval', 'comment')
        
        # Filter by read status
        is_read = self.request.query_params.get('is_read')
        if is_read is not None:
            queryset = queryset.filter(is_read=is_read.lower() == 'true')
        
        # Filter by type
        notification_type = self.request.query_params.get('type')
        if notification_type:
            queryset = queryset.filter(notification_type=notification_type)
        
        return queryset.order_by('-created_at')
    
    @action(detail=False, methods=['get'])
    def unread(self, request):
        """Get unread notifications"""
        notifications = WorkflowNotification.objects.filter(
            recipient=request.user,
            is_read=False
        ).select_related('workflow', 'workflow__document').order_by('-created_at')
        
        serializer = WorkflowNotificationSerializer(notifications, many=True)
        return Response({
            'count': notifications.count(),
            'notifications': serializer.data
        })
    
    @action(detail=True, methods=['post'], url_path='mark-read')
    def mark_read(self, request, pk=None):
        """Mark notification as read"""
        notification = self.get_object()
        notification.mark_as_read()
        
        serializer = WorkflowNotificationSerializer(notification)
        return Response(serializer.data)
    
    @action(detail=False, methods=['post'], url_path='mark-all-read')
    def mark_all_read(self, request):
        """Mark all notifications as read"""
        count = WorkflowNotification.objects.filter(
            recipient=request.user,
            is_read=False
        ).update(
            is_read=True,
            read_at=timezone.now()
        )
        
        return Response({
            'message': f'Marked {count} notifications as read',
            'count': count
        })


# ═══════════════════════════════════════════════════════════════════════
# WORKFLOW DECISION STEPS — yes / no scenarios
# ═══════════════════════════════════════════════════════════════════════

class WorkflowDecisionStepViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing workflow decision steps (yes/no gates).

    Endpoints:
    - GET    /api/workflow-decisions/                     — list
    - POST   /api/workflow-decisions/                     — create
    - GET    /api/workflow-decisions/{id}/                — detail
    - DELETE /api/workflow-decisions/{id}/                — delete
    - POST   /api/workflow-decisions/{id}/decide/         — submit yes/no
    - GET    /api/workflow-decisions/by-workflow/{wf_id}/ — steps for workflow
    - GET    /api/workflow-decisions/my-pending/          — steps waiting on me
    """
    serializer_class = WorkflowDecisionStepSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return (
            WorkflowDecisionStep.objects
            .select_related(
                'workflow', 'workflow__document',
                'target_user', 'target_team', 'decided_by_user', 'viewer_token',
            )
            .order_by('workflow', 'order')
        )

    def perform_create(self, serializer):
        """
        Create a decision step.  When target_type='email', auto-create
        a ViewerToken so the external reviewer can access the document.
        """
        step = serializer.save()
        if step.target_type == 'email' and step.target_email:
            self._provision_viewer_token(step)

    # ── Custom actions ───────────────────────────────────────────

    @action(detail=True, methods=['post'])
    def decide(self, request, pk=None):
        """
        Submit a decision (approve / reject) for this step.

        POST /api/workflow-decisions/{id}/decide/
        {
            "decision": "approved" | "rejected",
            "comment": "Optional reason"
        }
        """
        step = self.get_object()

        if step.decision_status != 'pending':
            return Response(
                {'error': 'This step has already been decided.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        decision = request.data.get('decision')
        if decision not in ('approved', 'rejected'):
            return Response(
                {'error': 'decision must be "approved" or "rejected".'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        comment = request.data.get('comment', '')
        user = request.user

        if decision == 'approved':
            step.approve(user=user, comment=comment)
        else:
            step.reject(user=user, comment=comment)

        # Create notification for the workflow owner
        if step.workflow.assigned_by:
            decision_label = 'approved' if decision == 'approved' else 'rejected'
            WorkflowNotification.objects.create(
                workflow=step.workflow,
                recipient=step.workflow.assigned_by,
                notification_type='approval_approved' if decision == 'approved' else 'approval_rejected',
                title=f'Decision: {step.title or "Step " + str(step.order)} — {decision_label}',
                message=f'{user.get_full_name() or user.username} {decision_label} step "{step.title or step.order}". {comment}'.strip(),
            )
            send_alert(
                category='workflow.approved' if decision == 'approved' else 'workflow.rejected',
                recipient=step.workflow.assigned_by,
                title=f'Decision: {step.title or "Step " + str(step.order)} — {decision_label}',
                message=f'{user.get_full_name() or user.username} {decision_label} step "{step.title or step.order}". {comment}'.strip(),
                actor=user,
                priority='high' if decision == 'rejected' else 'normal',
                target_type='workflow',
                target_id=str(step.workflow.id),
                email=True,
            )

        serializer = WorkflowDecisionStepSerializer(step)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='by-workflow/(?P<workflow_id>[^/.]+)')
    def by_workflow(self, request, workflow_id=None):
        """Get all decision steps for a given workflow (includes full workflow info)."""
        try:
            workflow = DocumentWorkflow.objects.select_related(
                'document', 'assigned_to', 'assigned_by',
            ).get(id=workflow_id)
        except DocumentWorkflow.DoesNotExist:
            return Response({'error': 'Workflow not found.'}, status=404)

        serializer = WorkflowWithDecisionStepsSerializer(workflow)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='my-pending')
    def my_pending(self, request):
        """
        Get decision steps that are pending and targeted at the current user
        (either directly, via team membership, or via email).
        """
        user = request.user
        user_teams = []
        try:
            user_teams = list(user.profile.teams.values_list('id', flat=True))
        except Exception:
            pass

        steps = WorkflowDecisionStep.objects.filter(
            decision_status='pending',
            workflow__is_active=True,
        ).filter(
            Q(target_type='user', target_user=user) |
            Q(target_type='team', target_team_id__in=user_teams) |
            Q(target_type='email', target_email__iexact=user.email)
        ).select_related(
            'workflow', 'workflow__document', 'target_user', 'target_team',
        ).order_by('workflow__due_date', 'order')

        serializer = WorkflowDecisionStepSerializer(steps, many=True)
        return Response({
            'count': steps.count(),
            'steps': serializer.data,
        })

    @action(detail=False, methods=['post'], url_path='create-with-steps')
    def create_with_steps(self, request):
        """
        Create a workflow **and** its decision steps in one call.

        POST /api/workflow-decisions/create-with-steps/
        {
            "document": "<uuid>",
            "priority": "medium",
            "message": "Please review this contract",
            "steps": [
                {
                    "order": 1,
                    "target_type": "user",
                    "target_user": 5,
                    "title": "Legal Review",
                    "description": "Check clauses 3-7"
                },
                {
                    "order": 2,
                    "target_type": "email",
                    "target_email": "external@partner.com",
                    "title": "Partner Approval",
                    "on_reject_action": "revision_required"
                },
                {
                    "order": 3,
                    "target_type": "team",
                    "target_team": "<team-uuid>",
                    "title": "Final Sign-off"
                }
            ]
        }
        """
        from django.contrib.auth.models import User as AuthUser

        document_id = request.data.get('document')
        if not document_id:
            return Response({'error': 'document is required.'}, status=400)

        try:
            document = Document.objects.get(id=document_id)
        except Document.DoesNotExist:
            return Response({'error': 'Document not found.'}, status=404)

        steps_data = request.data.get('steps', [])
        if not steps_data:
            return Response({'error': 'At least one step is required.'}, status=400)

        # Validate steps
        step_serializer = CreateDecisionStepSerializer(data=steps_data, many=True)
        step_serializer.is_valid(raise_exception=True)

        # Create workflow
        workflow = DocumentWorkflow.objects.create(
            document=document,
            assigned_by=request.user,
            assigned_to=request.user,
            current_status='review',
            priority=request.data.get('priority', 'medium'),
            message=request.data.get('message', ''),
            notes=request.data.get('notes', ''),
            organization=request.data.get('organization', ''),
            team=request.data.get('team', ''),
        )

        created_steps = []
        for s in step_serializer.validated_data:
            target_user = None
            target_team = None

            if s.get('target_user'):
                try:
                    target_user = AuthUser.objects.get(pk=s['target_user'])
                except AuthUser.DoesNotExist:
                    continue

            if s.get('target_team'):
                from user_management.models import Team as TeamModel
                try:
                    target_team = TeamModel.objects.get(pk=s['target_team'])
                except TeamModel.DoesNotExist:
                    continue

            step = WorkflowDecisionStep.objects.create(
                workflow=workflow,
                order=s['order'],
                target_type=s['target_type'],
                target_user=target_user,
                target_team=target_team,
                target_email=s.get('target_email', ''),
                title=s.get('title', ''),
                description=s.get('description', ''),
                on_reject_action=s.get('on_reject_action', 'revision_required'),
            )

            # Auto-provision ViewerToken for email targets
            if step.target_type == 'email' and step.target_email:
                self._provision_viewer_token(step)

            created_steps.append(step)

        response_serializer = WorkflowWithDecisionStepsSerializer(workflow)
        return Response(response_serializer.data, status=201)

    # ── Helpers ──────────────────────────────────────────────────

    def _provision_viewer_token(self, step):
        """Create a ViewerToken for an email-targeted decision step."""
        from viewer.models import ViewerToken
        import secrets

        existing = ViewerToken.objects.filter(
            document=step.workflow.document,
            recipient_email__iexact=step.target_email,
            is_active=True,
        ).first()

        if existing:
            step.viewer_token = existing
            step.save(update_fields=['viewer_token'])
            return

        vt = ViewerToken.objects.create(
            document=step.workflow.document,
            created_by=step.workflow.assigned_by,
            access_mode='email_otp',
            role='commentator',
            recipient_email=step.target_email,
            recipient_name=step.target_email.split('@')[0],
            allowed_emails=[step.target_email],
            token=secrets.token_urlsafe(48),
        )
        step.viewer_token = vt
        step.save(update_fields=['viewer_token'])
