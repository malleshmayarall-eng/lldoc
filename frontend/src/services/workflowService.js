import api from './api';

/**
 * Workflow Service
 * Handles all workflow, approval, comment, and notification operations
 */

export const workflowService = {
  // ============================================================================
  // WORKFLOWS
  // ============================================================================

  /**
   * Get all workflows with optional filters
   * @param {Object} params - Filter parameters
   * @returns {Promise} - List of workflows
   */
  async getWorkflows(params = {}) {
    const response = await api.get('/documents/workflows/', { params });
    return response.data;
  },

  /**
   * Get a single workflow by ID
   * @param {string} id - Workflow ID
   * @returns {Promise} - Workflow object
   */
  async getWorkflow(id) {
    const response = await api.get(`/documents/workflows/${id}/`);
    return response.data;
  },

  /**
   * Create a new workflow
   * @param {Object} workflowData - Workflow data
   * @returns {Promise} - Created workflow
   */
  async createWorkflow(workflowData) {
    const response = await api.post('/documents/workflows/', workflowData);
    return response.data;
  },

  /**
   * Update a workflow
   * @param {string} id - Workflow ID
   * @param {Object} data - Update data
   * @returns {Promise} - Updated workflow
   */
  async updateWorkflow(id, data) {
    const response = await api.patch(`/documents/workflows/${id}/`, data);
    return response.data;
  },

  /**
   * Delete a workflow
   * @param {string} id - Workflow ID
   * @returns {Promise}
   */
  async deleteWorkflow(id) {
    const response = await api.delete(`/documents/workflows/${id}/`);
    return response.data;
  },

  /**
   * Get tasks assigned to the current user
   * @returns {Promise} - User's tasks
   */
  async getMyTasks() {
    const response = await api.get('/documents/workflows/my-tasks/');
    return response.data;
  },

  /**
   * Get workflows assigned by the current user
   * @returns {Promise} - Workflows assigned by user
   */
  async getAssignedByMe() {
    const response = await api.get('/documents/workflows/assigned-by-me/');
    return response.data;
  },

  /**
   * Get workflows by organization
   * @param {string} organization - Organization name
   * @returns {Promise} - Organization workflows
   */
  async getWorkflowsByOrg(organization) {
    const response = await api.get(`/documents/workflows/by-org/${encodeURIComponent(organization)}/`);
    return response.data;
  },

  /**
   * Get workflows by team
   * @param {string} team - Team name
   * @returns {Promise} - Team workflows
   */
  async getWorkflowsByTeam(team) {
    const response = await api.get(`/documents/workflows/by-team/${encodeURIComponent(team)}/`);
    return response.data;
  },

  /**
   * Reassign a workflow to a different user
   * @param {string} id - Workflow ID
   * @param {number} assignedTo - New assignee user ID
   * @param {string} message - Reassignment message
   * @returns {Promise} - Updated workflow
   */
  async reassignWorkflow(id, assignedTo, message) {
    const response = await api.post(`/documents/workflows/${id}/reassign/`, {
      assigned_to: assignedTo,
      message,
    });
    return response.data;
  },

  /**
   * Mark a workflow as complete
   * @param {string} id - Workflow ID
   * @returns {Promise} - Updated workflow
   */
  async completeWorkflow(id) {
    const response = await api.post(`/documents/workflows/${id}/complete/`);
    return response.data;
  },

  /**
   * Update workflow status
   * @param {string} id - Workflow ID
   * @param {string} status - New status
   * @returns {Promise} - Updated workflow
   */
  async updateWorkflowStatus(id, status) {
    const response = await api.post(`/documents/workflows/${id}/update-status/`, {
      status,
    });
    return response.data;
  },

  // ============================================================================
  // APPROVALS
  // ============================================================================

  /**
   * Get all approvals with optional filters
   * @param {Object} params - Filter parameters
   * @returns {Promise} - List of approvals
   */
  async getApprovals(params = {}) {
    const response = await api.get('/documents/workflow-approvals/', { params });
    return response.data;
  },

  /**
   * Get a single approval by ID
   * @param {string} id - Approval ID
   * @returns {Promise} - Approval object
   */
  async getApproval(id) {
    const response = await api.get(`/documents/workflow-approvals/${id}/`);
    return response.data;
  },

  /**
   * Create a new approval
   * @param {Object} approvalData - Approval data
   * @returns {Promise} - Created approval
   */
  async createApproval(approvalData) {
    const response = await api.post('/documents/workflow-approvals/', approvalData);
    return response.data;
  },

  /**
   * Update an approval
   * @param {string} id - Approval ID
   * @param {Object} data - Update data
   * @returns {Promise} - Updated approval
   */
  async updateApproval(id, data) {
    const response = await api.patch(`/documents/workflow-approvals/${id}/`, data);
    return response.data;
  },

  /**
   * Delete an approval
   * @param {string} id - Approval ID
   * @returns {Promise}
   */
  async deleteApproval(id) {
    const response = await api.delete(`/documents/workflow-approvals/${id}/`);
    return response.data;
  },

  /**
   * Get pending approvals for the current user
   * @returns {Promise} - Pending approvals
   */
  async getMyApprovals() {
    const response = await api.get('/documents/workflow-approvals/my-approvals/');
    return response.data;
  },

  /**
   * Approve an approval
   * @param {string} id - Approval ID
   * @param {string} comments - Approval comments
   * @returns {Promise} - Updated approval
   */
  async approveApproval(id, comments = '') {
    const response = await api.post(`/documents/workflow-approvals/${id}/approve/`, {
      comments,
    });
    return response.data;
  },

  /**
   * Reject an approval
   * @param {string} id - Approval ID
   * @param {string} comments - Rejection comments (required)
   * @returns {Promise} - Updated approval
   */
  async rejectApproval(id, comments) {
    const response = await api.post(`/documents/workflow-approvals/${id}/reject/`, {
      comments,
    });
    return response.data;
  },

  // ============================================================================
  // COMMENTS
  // ============================================================================

  /**
   * Get all comments with optional filters
   * @param {Object} params - Filter parameters
   * @returns {Promise} - List of comments
   */
  async getComments(params = {}) {
    const response = await api.get('/documents/workflow-comments/', { params });
    return response.data;
  },

  /**
   * Get a single comment by ID
   * @param {string} id - Comment ID
   * @returns {Promise} - Comment object
   */
  async getComment(id) {
    const response = await api.get(`/documents/workflow-comments/${id}/`);
    return response.data;
  },

  /**
   * Create a new comment
   * @param {Object} commentData - Comment data
   * @returns {Promise} - Created comment
   */
  async createComment(commentData) {
    const response = await api.post('/documents/workflow-comments/', commentData);
    return response.data;
  },

  /**
   * Update a comment
   * @param {string} id - Comment ID
   * @param {Object} data - Update data
   * @returns {Promise} - Updated comment
   */
  async updateComment(id, data) {
    const response = await api.patch(`/documents/workflow-comments/${id}/`, data);
    return response.data;
  },

  /**
   * Delete a comment
   * @param {string} id - Comment ID
   * @returns {Promise}
   */
  async deleteComment(id) {
    const response = await api.delete(`/documents/workflow-comments/${id}/`);
    return response.data;
  },

  /**
   * Resolve a comment
   * @param {string} id - Comment ID
   * @returns {Promise} - Updated comment
   */
  async resolveComment(id) {
    const response = await api.post(`/documents/workflow-comments/${id}/resolve/`);
    return response.data;
  },

  // ============================================================================
  // NOTIFICATIONS
  // ============================================================================

  /**
   * Get all notifications with optional filters
   * @param {Object} params - Filter parameters
   * @returns {Promise} - List of notifications
   */
  async getNotifications(params = {}) {
    const response = await api.get('/documents/workflow-notifications/', { params });
    return response.data;
  },

  /**
   * Get unread notifications
   * @returns {Promise} - Unread notifications
   */
  async getUnreadNotifications() {
    const response = await api.get('/documents/workflow-notifications/unread/');
    return response.data;
  },

  /**
   * Mark a notification as read
   * @param {string} id - Notification ID
   * @returns {Promise} - Updated notification
   */
  async markNotificationAsRead(id) {
    const response = await api.post(`/documents/workflow-notifications/${id}/mark-read/`);
    return response.data;
  },

  /**
   * Mark all notifications as read
   * @returns {Promise} - Result
   */
  async markAllNotificationsAsRead() {
    const response = await api.post('/documents/workflow-notifications/mark-all-read/');
    return response.data;
  },

  // ============================================================================
  // WORKFLOW DECISION STEPS
  // ============================================================================

  /**
   * Create a workflow with decision steps (yes/no scenarios) in one call.
   * @param {Object} data - { document, priority, message, steps: [...] }
   * @returns {Promise} - Workflow with decision steps
   */
  async createWorkflowWithSteps(data) {
    const response = await api.post('/documents/workflow-decisions/create-with-steps/', data);
    return response.data;
  },

  /**
   * Get all decision steps for a workflow.
   * @param {string} workflowId - Workflow UUID
   * @returns {Promise} - Workflow with nested decision steps
   */
  async getDecisionStepsByWorkflow(workflowId) {
    const response = await api.get(`/documents/workflow-decisions/by-workflow/${workflowId}/`);
    return response.data;
  },

  /**
   * Get decision steps pending for the current user.
   * @returns {Promise} - { count, steps }
   */
  async getMyPendingDecisions() {
    const response = await api.get('/documents/workflow-decisions/my-pending/');
    return response.data;
  },

  /**
   * Submit a decision (approve/reject) on a decision step.
   * @param {string} stepId - Decision step UUID
   * @param {string} decision - 'approved' or 'rejected'
   * @param {string} comment - Optional comment
   * @returns {Promise} - Updated decision step
   */
  async submitDecision(stepId, decision, comment = '') {
    const response = await api.post(`/documents/workflow-decisions/${stepId}/decide/`, {
      decision,
      comment,
    });
    return response.data;
  },
};

export default workflowService;
