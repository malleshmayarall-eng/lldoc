"""
Serializers for Document Workflow & Task Assignment System
"""
from rest_framework import serializers
from django.contrib.auth.models import User
from documents.models import (
    DocumentWorkflow,
    WorkflowApproval,
    WorkflowComment,
    WorkflowNotification,
    WorkflowDecisionStep,
)
from user_management.models import UserProfile


class UserProfileSerializer(serializers.ModelSerializer):
    """Serializer for user profiles - minimal info"""
    organization_name = serializers.CharField(source='organization.name', read_only=True)
    role_name = serializers.CharField(source='role.name', read_only=True)
    
    class Meta:
        model = UserProfile
        fields = ['organization_name', 'role_name', 'job_title', 'department']


class TeamMemberSerializer(serializers.ModelSerializer):
    """Serializer for team member search results"""
    profile = UserProfileSerializer(read_only=True)
    full_name = serializers.SerializerMethodField()
    
    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'email', 'full_name', 'profile']
        read_only_fields = fields
    
    def get_full_name(self, obj):
        """Get user's full name"""
        if obj.first_name and obj.last_name:
            return f"{obj.first_name} {obj.last_name}"
        return obj.username


class UserSummarySerializer(serializers.ModelSerializer):
    """Minimal user info for workflow displays"""
    profile = UserProfileSerializer(read_only=True)
    
    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'email', 'profile']
        read_only_fields = fields


class WorkflowApprovalSerializer(serializers.ModelSerializer):
    """Serializer for workflow approvals"""
    approver_info = UserSummarySerializer(source='approver', read_only=True)
    
    class Meta:
        model = WorkflowApproval
        fields = [
            'id', 'workflow', 'approver', 'approver_info', 'role', 'order',
            'status', 'approved_at', 'comments', 'is_required',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'approved_at']
    
    def validate_order(self, value):
        """Ensure order is positive"""
        if value < 1:
            raise serializers.ValidationError("Order must be 1 or greater")
        return value


class WorkflowApprovalDetailSerializer(serializers.ModelSerializer):
    """Enriched serializer for approval listings (includes nested workflow info)"""
    approver_info = UserSummarySerializer(source='approver', read_only=True)
    workflow = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowApproval
        fields = [
            'id', 'workflow', 'approver', 'approver_info', 'role', 'order',
            'status', 'approved_at', 'comments', 'is_required',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'approved_at']

    def get_workflow(self, obj):
        return {
            'id': str(obj.workflow.id),
            'document': str(obj.workflow.document_id),
            'document_title': obj.workflow.document.title if obj.workflow.document else '',
            'current_status': obj.workflow.current_status,
            'priority': obj.workflow.priority,
            'assigned_to_info': UserSummarySerializer(obj.workflow.assigned_to).data if obj.workflow.assigned_to else None,
        }


class WorkflowCommentSerializer(serializers.ModelSerializer):
    """Serializer for workflow comments"""
    user_info = UserSummarySerializer(source='user', read_only=True)
    mentions_info = UserSummarySerializer(source='mentions', many=True, read_only=True)
    
    class Meta:
        model = WorkflowComment
        fields = [
            'id', 'workflow', 'user', 'user_info', 'comment', 'comment_type',
            'mentions', 'mentions_info', 'is_resolved',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'user', 'user_info']


class WorkflowNotificationSerializer(serializers.ModelSerializer):
    """Serializer for workflow notifications"""
    workflow_info = serializers.SerializerMethodField()
    
    class Meta:
        model = WorkflowNotification
        fields = [
            'id', 'workflow', 'workflow_info', 'recipient', 'notification_type',
            'title', 'message', 'approval', 'comment',
            'created_at', 'is_read', 'read_at'
        ]
        read_only_fields = ['id', 'created_at', 'read_at']
    
    def get_workflow_info(self, obj):
        """Get basic workflow information"""
        return {
            'id': str(obj.workflow.id),
            'document_id': str(obj.workflow.document.id),
            'document_title': obj.workflow.document.title,
            'current_status': obj.workflow.current_status,
        }


class DocumentWorkflowSerializer(serializers.ModelSerializer):
    """Full serializer for document workflows"""
    assigned_to_info = UserSummarySerializer(source='assigned_to', read_only=True)
    assigned_by_info = UserSummarySerializer(source='assigned_by', read_only=True)
    approvals = WorkflowApprovalSerializer(many=True, read_only=True)
    comments_count = serializers.SerializerMethodField()
    document_title = serializers.CharField(source='document.title', read_only=True)
    
    class Meta:
        model = DocumentWorkflow
        fields = [
            'id', 'document', 'document_title', 'current_status',
            'assigned_to', 'assigned_to_info', 'assigned_by', 'assigned_by_info',
            'priority', 'due_date', 'organization', 'team',
            'message', 'notes', 'version', 'approvals', 'comments_count',
            'created_at', 'updated_at', 'completed_at',
            'is_active', 'is_completed'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'completed_at']
    
    def get_comments_count(self, obj):
        """Get count of comments on this workflow"""
        return obj.comments.count()


class DocumentWorkflowListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for workflow lists"""
    assigned_to_info = UserSummarySerializer(source='assigned_to', read_only=True)
    document_title = serializers.CharField(source='document.title', read_only=True)
    
    class Meta:
        model = DocumentWorkflow
        fields = [
            'id', 'document', 'document_title', 'current_status',
            'assigned_to', 'assigned_to_info', 'priority', 'due_date',
            'organization', 'team', 'is_active', 'is_completed',
            'created_at', 'updated_at'
        ]
        read_only_fields = fields


class CreateWorkflowSerializer(serializers.ModelSerializer):
    """Serializer for creating new workflows"""
    
    class Meta:
        model = DocumentWorkflow
        fields = [
            'document', 'current_status', 'assigned_to', 'priority',
            'due_date', 'organization', 'team', 'message', 'notes', 'version'
        ]
    
    def validate_assigned_to(self, value):
        """
        Validate that the assigned user is from the same organization as the requester.
        Optionally validate team membership if team is specified.
        """
        request = self.context.get('request')
        if not request or not hasattr(request, 'user'):
            return value
        
        try:
            requester_profile = request.user.profile
        except UserProfile.DoesNotExist:
            raise serializers.ValidationError(
                "Your user profile is not set up. Please contact an administrator."
            )
        
        try:
            assignee_profile = value.profile
        except UserProfile.DoesNotExist:
            raise serializers.ValidationError(
                "The selected user does not have a profile set up."
            )
        
        # Check if users are in the same organization
        if assignee_profile.organization != requester_profile.organization:
            raise serializers.ValidationError(
                f"You can only assign workflows to users in your organization ({requester_profile.organization.name})."
            )
        
        # If team is specified in the data, validate team membership
        team_name = self.initial_data.get('team')
        if team_name:
            # Check if assignee is in the specified team
            from user_management.models import Team
            assignee_teams = assignee_profile.teams.filter(
                name__iexact=team_name,
                organization=requester_profile.organization
            )
            if not assignee_teams.exists():
                raise serializers.ValidationError(
                    f"The selected user is not a member of the '{team_name}' team."
                )
        
        return value
    
    def validate(self, attrs):
        """Additional cross-field validation"""
        # If team is specified, ensure it exists in the organization
        team_name = attrs.get('team')
        if team_name:
            request = self.context.get('request')
            if request and hasattr(request, 'user'):
                try:
                    requester_profile = request.user.profile
                    from user_management.models import Team
                    if not Team.objects.filter(
                        name__iexact=team_name,
                        organization=requester_profile.organization,
                        is_active=True
                    ).exists():
                        raise serializers.ValidationError({
                            'team': f"Team '{team_name}' does not exist in your organization."
                        })
                except UserProfile.DoesNotExist:
                    pass
        
        return attrs
    
    def create(self, validated_data):
        """Create workflow and set assigned_by from request user"""
        request = self.context.get('request')
        if request and hasattr(request, 'user'):
            validated_data['assigned_by'] = request.user
        return super().create(validated_data)


# ═══════════════════════════════════════════════════════════════════════
# WORKFLOW DECISION STEPS
# ═══════════════════════════════════════════════════════════════════════

class WorkflowDecisionStepSerializer(serializers.ModelSerializer):
    """Full serializer for workflow decision steps."""
    decided_by_user_info = UserSummarySerializer(source='decided_by_user', read_only=True)
    target_user_info = UserSummarySerializer(source='target_user', read_only=True)
    target_team_info = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowDecisionStep
        fields = [
            'id', 'workflow', 'order', 'target_type',
            'target_user', 'target_user_info',
            'target_team', 'target_team_info',
            'target_email',
            'title', 'description',
            'decision_status', 'decided_by_user', 'decided_by_user_info',
            'decided_by_email', 'decision_comment', 'decided_at',
            'on_reject_action', 'viewer_token',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at', 'decided_at',
            'decided_by_user', 'decided_by_email', 'decision_status',
            'viewer_token',
        ]

    def get_target_team_info(self, obj):
        if not obj.target_team:
            return None
        return {
            'id': str(obj.target_team.id),
            'name': obj.target_team.name,
        }


class CreateDecisionStepSerializer(serializers.Serializer):
    """Serializer for creating decision steps within a workflow."""
    order = serializers.IntegerField(min_value=1)
    target_type = serializers.ChoiceField(choices=['user', 'team', 'email'])
    target_user = serializers.IntegerField(required=False, allow_null=True)
    target_team = serializers.UUIDField(required=False, allow_null=True)
    target_email = serializers.EmailField(required=False, allow_blank=True, default='')
    title = serializers.CharField(max_length=255, required=False, allow_blank=True, default='')
    description = serializers.CharField(required=False, allow_blank=True, default='')
    on_reject_action = serializers.CharField(max_length=30, required=False, default='revision_required')

    def validate(self, attrs):
        tt = attrs.get('target_type')
        if tt == 'user' and not attrs.get('target_user'):
            raise serializers.ValidationError({'target_user': 'Required when target_type is user.'})
        if tt == 'team' and not attrs.get('target_team'):
            raise serializers.ValidationError({'target_team': 'Required when target_type is team.'})
        if tt == 'email' and not attrs.get('target_email'):
            raise serializers.ValidationError({'target_email': 'Required when target_type is email.'})
        return attrs


class WorkflowWithDecisionStepsSerializer(serializers.ModelSerializer):
    """Workflow serializer that includes its decision steps."""
    assigned_to_info = UserSummarySerializer(source='assigned_to', read_only=True)
    assigned_by_info = UserSummarySerializer(source='assigned_by', read_only=True)
    decision_steps = WorkflowDecisionStepSerializer(many=True, read_only=True)
    document_title = serializers.CharField(source='document.title', read_only=True)
    current_step = serializers.SerializerMethodField()

    class Meta:
        model = DocumentWorkflow
        fields = [
            'id', 'document', 'document_title', 'current_status',
            'assigned_to', 'assigned_to_info', 'assigned_by', 'assigned_by_info',
            'priority', 'due_date', 'organization', 'team',
            'message', 'notes', 'decision_steps', 'current_step',
            'created_at', 'updated_at', 'completed_at',
            'is_active', 'is_completed',
        ]
        read_only_fields = fields

    def get_current_step(self, obj):
        """Return the first pending decision step."""
        step = obj.decision_steps.filter(decision_status='pending').order_by('order').first()
        if step:
            return WorkflowDecisionStepSerializer(step).data
        return None

