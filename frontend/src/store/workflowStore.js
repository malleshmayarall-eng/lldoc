import { create } from 'zustand';
import { workflowService } from '../services/workflowService';
import { getEditorAlerts, markEditorAlertRead, markAllEditorAlertsRead } from '../services/viewerService';
import notificationService from '../services/notificationService';

/**
 * Workflow Store
 * Central state management for workflows, approvals, comments, and notifications
 */
const useWorkflowStore = create((set, get) => ({
  // ============================================================================
  // STATE
  // ============================================================================
  workflows: [],
  myTasks: [],
  assignedByMe: [],
  approvals: [],
  myApprovals: [],
  comments: [],
  notifications: [],
  unreadCount: 0,
  
  loading: {
    workflows: false,
    tasks: false,
    approvals: false,
    comments: false,
    notifications: false,
  },
  
  error: null,
  
  // ============================================================================
  // WORKFLOWS
  // ============================================================================
  
  /**
   * Fetch all workflows with optional filters
   */
  fetchWorkflows: async (params = {}) => {
    set((state) => ({ loading: { ...state.loading, workflows: true }, error: null }));
    try {
      const data = await workflowService.getWorkflows(params);
      set({ workflows: Array.isArray(data) ? data : data.results || [], loading: { ...get().loading, workflows: false } });
      return data;
    } catch (error) {
      set({ error: error.message, loading: { ...get().loading, workflows: false } });
      throw error;
    }
  },

  /**
   * Fetch my tasks
   */
  fetchMyTasks: async () => {
    set((state) => ({ loading: { ...state.loading, tasks: true }, error: null }));
    try {
      const data = await workflowService.getMyTasks();
      set({ 
        myTasks: data.tasks || data.results || [],
        loading: { ...get().loading, tasks: false }
      });
      return data;
    } catch (error) {
      set({ error: error.message, loading: { ...get().loading, tasks: false } });
      throw error;
    }
  },

  /**
   * Fetch workflows assigned by me
   */
  fetchAssignedByMe: async () => {
    set((state) => ({ loading: { ...state.loading, workflows: true }, error: null }));
    try {
      const data = await workflowService.getAssignedByMe();
      set({ 
        assignedByMe: data.workflows || data.results || [],
        loading: { ...get().loading, workflows: false }
      });
      return data;
    } catch (error) {
      set({ error: error.message, loading: { ...get().loading, workflows: false } });
      throw error;
    }
  },

  /**
   * Create a new workflow
   */
  createWorkflow: async (workflowData) => {
    set({ error: null });
    try {
      const newWorkflow = await workflowService.createWorkflow(workflowData);
      set((state) => ({ workflows: [newWorkflow, ...state.workflows] }));
      return newWorkflow;
    } catch (error) {
      set({ error: error.message });
      throw error;
    }
  },

  /**
   * Update a workflow
   */
  updateWorkflow: async (id, data) => {
    set({ error: null });
    try {
      const updated = await workflowService.updateWorkflow(id, data);
      set((state) => ({
        workflows: state.workflows.map((w) => (w.id === id ? updated : w)),
        myTasks: state.myTasks.map((w) => (w.id === id ? updated : w)),
        assignedByMe: state.assignedByMe.map((w) => (w.id === id ? updated : w)),
      }));
      return updated;
    } catch (error) {
      set({ error: error.message });
      throw error;
    }
  },

  /**
   * Reassign a workflow
   */
  reassignWorkflow: async (id, assignedTo, message) => {
    set({ error: null });
    try {
      const updated = await workflowService.reassignWorkflow(id, assignedTo, message);
      set((state) => ({
        workflows: state.workflows.map((w) => (w.id === id ? updated : w)),
        myTasks: state.myTasks.filter((w) => w.id !== id), // Remove from my tasks
        assignedByMe: [updated, ...state.assignedByMe], // Add to assigned by me
      }));
      return updated;
    } catch (error) {
      set({ error: error.message });
      throw error;
    }
  },

  /**
   * Complete a workflow
   */
  completeWorkflow: async (id) => {
    set({ error: null });
    try {
      const updated = await workflowService.completeWorkflow(id);
      set((state) => ({
        workflows: state.workflows.map((w) => (w.id === id ? updated : w)),
        myTasks: state.myTasks.filter((w) => w.id !== id), // Remove from my tasks
      }));
      return updated;
    } catch (error) {
      set({ error: error.message });
      throw error;
    }
  },

  /**
   * Update workflow status
   */
  updateWorkflowStatus: async (id, status) => {
    set({ error: null });
    try {
      const updated = await workflowService.updateWorkflowStatus(id, status);
      set((state) => ({
        workflows: state.workflows.map((w) => (w.id === id ? updated : w)),
        myTasks: state.myTasks.map((w) => (w.id === id ? updated : w)),
      }));
      return updated;
    } catch (error) {
      set({ error: error.message });
      throw error;
    }
  },

  /**
   * Delete a workflow
   */
  deleteWorkflow: async (id) => {
    set({ error: null });
    try {
      await workflowService.deleteWorkflow(id);
      set((state) => ({
        workflows: state.workflows.filter((w) => w.id !== id),
        myTasks: state.myTasks.filter((w) => w.id !== id),
        assignedByMe: state.assignedByMe.filter((w) => w.id !== id),
      }));
    } catch (error) {
      set({ error: error.message });
      throw error;
    }
  },

  // ============================================================================
  // APPROVALS
  // ============================================================================

  /**
   * Fetch all approvals with optional filters
   */
  fetchApprovals: async (params = {}) => {
    set((state) => ({ loading: { ...state.loading, approvals: true }, error: null }));
    try {
      const data = await workflowService.getApprovals(params);
      set({ 
        approvals: Array.isArray(data) ? data : data.results || [],
        loading: { ...get().loading, approvals: false }
      });
      return data;
    } catch (error) {
      set({ error: error.message, loading: { ...get().loading, approvals: false } });
      throw error;
    }
  },

  /**
   * Fetch my pending approvals
   */
  fetchMyApprovals: async () => {
    set((state) => ({ loading: { ...state.loading, approvals: true }, error: null }));
    try {
      const data = await workflowService.getMyApprovals();
      set({ 
        myApprovals: data.approvals || data.results || [],
        loading: { ...get().loading, approvals: false }
      });
      return data;
    } catch (error) {
      set({ error: error.message, loading: { ...get().loading, approvals: false } });
      throw error;
    }
  },

  /**
   * Create a new approval
   */
  createApproval: async (approvalData) => {
    set({ error: null });
    try {
      const newApproval = await workflowService.createApproval(approvalData);
      set((state) => ({ approvals: [newApproval, ...state.approvals] }));
      return newApproval;
    } catch (error) {
      set({ error: error.message });
      throw error;
    }
  },

  /**
   * Approve an approval
   */
  approveApproval: async (id, comments = '') => {
    set({ error: null });
    try {
      const updated = await workflowService.approveApproval(id, comments);
      set((state) => ({
        approvals: state.approvals.map((a) => (a.id === id ? updated : a)),
        myApprovals: state.myApprovals.filter((a) => a.id !== id),
      }));
      return updated;
    } catch (error) {
      set({ error: error.message });
      throw error;
    }
  },

  /**
   * Reject an approval
   */
  rejectApproval: async (id, comments) => {
    set({ error: null });
    try {
      const updated = await workflowService.rejectApproval(id, comments);
      set((state) => ({
        approvals: state.approvals.map((a) => (a.id === id ? updated : a)),
        myApprovals: state.myApprovals.filter((a) => a.id !== id),
      }));
      return updated;
    } catch (error) {
      set({ error: error.message });
      throw error;
    }
  },

  // ============================================================================
  // COMMENTS
  // ============================================================================

  /**
   * Fetch comments with optional filters
   */
  fetchComments: async (params = {}) => {
    set((state) => ({ loading: { ...state.loading, comments: true }, error: null }));
    try {
      const data = await workflowService.getComments(params);
      set({ 
        comments: Array.isArray(data) ? data : data.results || [],
        loading: { ...get().loading, comments: false }
      });
      return data;
    } catch (error) {
      set({ error: error.message, loading: { ...get().loading, comments: false } });
      throw error;
    }
  },

  /**
   * Create a new comment
   */
  createComment: async (commentData) => {
    set({ error: null });
    try {
      const newComment = await workflowService.createComment(commentData);
      set((state) => ({ comments: [newComment, ...state.comments] }));
      return newComment;
    } catch (error) {
      set({ error: error.message });
      throw error;
    }
  },

  /**
   * Update a comment
   */
  updateComment: async (id, data) => {
    set({ error: null });
    try {
      const updated = await workflowService.updateComment(id, data);
      set((state) => ({
        comments: state.comments.map((c) => (c.id === id ? updated : c)),
      }));
      return updated;
    } catch (error) {
      set({ error: error.message });
      throw error;
    }
  },

  /**
   * Resolve a comment
   */
  resolveComment: async (id) => {
    set({ error: null });
    try {
      const updated = await workflowService.resolveComment(id);
      set((state) => ({
        comments: state.comments.map((c) => (c.id === id ? updated : c)),
      }));
      return updated;
    } catch (error) {
      set({ error: error.message });
      throw error;
    }
  },

  /**
   * Delete a comment
   */
  deleteComment: async (id) => {
    set({ error: null });
    try {
      await workflowService.deleteComment(id);
      set((state) => ({
        comments: state.comments.filter((c) => c.id !== id),
      }));
    } catch (error) {
      set({ error: error.message });
      throw error;
    }
  },

  // ============================================================================
  // NOTIFICATIONS
  // ============================================================================

  // Editor alerts (viewer comments, approvals, shares on user's documents)
  editorAlerts: [],
  editorAlertsUnreadCount: 0,

  // System alerts (centralized communications app — shares, system messages, etc.)
  systemAlerts: [],
  systemAlertsUnreadCount: 0,

  /**
   * Fetch all notifications (workflow + editor alerts + system alerts merged)
   */
  fetchNotifications: async (params = {}) => {
    set((state) => ({ loading: { ...state.loading, notifications: true }, error: null }));
    try {
      // Fetch all three sources in parallel
      const [workflowData, editorData, systemData] = await Promise.allSettled([
        workflowService.getNotifications(params),
        getEditorAlerts({ page_size: 50 }),
        notificationService.getAlerts({ page_size: 50 }),
      ]);

      const workflowNotifs = workflowData.status === 'fulfilled'
        ? (Array.isArray(workflowData.value) ? workflowData.value : workflowData.value.results || workflowData.value.notifications || [])
        : [];

      const editorAlerts = editorData.status === 'fulfilled'
        ? (editorData.value.alerts || [])
        : [];

      const rawSystemAlerts = systemData.status === 'fulfilled'
        ? (Array.isArray(systemData.value) ? systemData.value : systemData.value.results || [])
        : [];

      // Normalize editor alerts to look like notifications
      const normalizedEditorAlerts = editorAlerts.map(a => ({
        ...a,
        _source: 'editor_alert',
        notification_type: a.alert_type,
        message: a.message,
        created_at: a.created_at,
        is_read: a.is_read,
        workflow_info: a.document_id ? { document_id: a.document_id } : null,
      }));

      // Normalize system alerts (communications.Alert) to look like notifications
      const normalizedSystemAlerts = rawSystemAlerts.map(a => ({
        ...a,
        _source: 'system',
        notification_type: a.category,
        title: a.title,
        message: a.message,
        created_at: a.created_at,
        is_read: a.is_read,
      }));

      const merged = [
        ...workflowNotifs.map(n => ({ ...n, _source: 'workflow' })),
        ...normalizedEditorAlerts,
        ...normalizedSystemAlerts,
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      const totalUnread = merged.filter(n => !n.is_read).length;
      const editorUnread = editorData.status === 'fulfilled' ? (editorData.value.unread_count ?? normalizedEditorAlerts.filter(a => !a.is_read).length) : 0;
      const systemUnread = normalizedSystemAlerts.filter(a => !a.is_read).length;

      set({ 
        notifications: merged,
        unreadCount: totalUnread,
        editorAlerts: normalizedEditorAlerts,
        editorAlertsUnreadCount: editorUnread,
        systemAlerts: normalizedSystemAlerts,
        systemAlertsUnreadCount: systemUnread,
        loading: { ...get().loading, notifications: false }
      });
      return { notifications: merged, unreadCount: totalUnread };
    } catch (error) {
      set({ error: error.message, loading: { ...get().loading, notifications: false } });
      throw error;
    }
  },

  /**
   * Fetch unread notifications (workflow + editor alerts + system alerts)
   */
  fetchUnreadNotifications: async () => {
    set((state) => ({ loading: { ...state.loading, notifications: true }, error: null }));
    try {
      const [workflowData, editorData, systemData] = await Promise.allSettled([
        workflowService.getUnreadNotifications(),
        getEditorAlerts({ is_read: 'false', page_size: 20 }),
        notificationService.getUnreadCount(),
      ]);

      const workflowNotifs = workflowData.status === 'fulfilled'
        ? (workflowData.value.notifications || workflowData.value.results || [])
        : [];
      const workflowCount = workflowData.status === 'fulfilled'
        ? (workflowData.value.count || workflowNotifs.length)
        : 0;

      const editorAlerts = editorData.status === 'fulfilled'
        ? (editorData.value.alerts || [])
        : [];
      const editorCount = editorData.status === 'fulfilled'
        ? (editorData.value.total || editorAlerts.length)
        : 0;

      const systemCount = systemData.status === 'fulfilled'
        ? (systemData.value.unread_count || 0)
        : 0;

      const normalizedAlerts = editorAlerts.map(a => ({
        ...a,
        _source: 'editor_alert',
        notification_type: a.alert_type,
      }));

      const merged = [...workflowNotifs.map(n => ({ ...n, _source: 'workflow' })), ...normalizedAlerts]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      set({ 
        notifications: merged,
        unreadCount: workflowCount + editorCount + systemCount,
        editorAlerts: normalizedAlerts,
        editorAlertsUnreadCount: editorCount,
        systemAlertsUnreadCount: systemCount,
        loading: { ...get().loading, notifications: false }
      });
      return { count: workflowCount + editorCount + systemCount };
    } catch (error) {
      set({ error: error.message, loading: { ...get().loading, notifications: false } });
      throw error;
    }
  },

  /**
   * Mark notification as read (handles workflow, editor alerts, and system alerts)
   */
  markNotificationAsRead: async (id, source = null) => {
    set({ error: null });
    try {
      // Determine source from stored notifications if not provided
      const notifications = get().notifications;
      const notif = notifications.find(n => n.id === id);
      const resolvedSource = source || notif?._source;

      if (resolvedSource === 'editor_alert') {
        await markEditorAlertRead(id);
      } else if (resolvedSource === 'system') {
        await notificationService.markRead(id);
      } else {
        await workflowService.markNotificationAsRead(id);
      }

      set((state) => {
        const updatedNotifs = state.notifications.map((n) => (n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n));
        const updatedEditorAlerts = state.editorAlerts.map((a) => (a.id === id ? { ...a, is_read: true } : a));
        const updatedSystemAlerts = state.systemAlerts.map((a) => (a.id === id ? { ...a, is_read: true } : a));
        return {
          notifications: updatedNotifs,
          unreadCount: updatedNotifs.filter(n => !n.is_read).length,
          editorAlerts: updatedEditorAlerts,
          editorAlertsUnreadCount: updatedEditorAlerts.filter(a => !a.is_read).length,
          systemAlerts: updatedSystemAlerts,
          systemAlertsUnreadCount: updatedSystemAlerts.filter(a => !a.is_read).length,
        };
      });
    } catch (error) {
      set({ error: error.message });
      throw error;
    }
  },

  /**
   * Mark all notifications as read (workflow + editor alerts + system alerts)
   */
  markAllNotificationsAsRead: async () => {
    set({ error: null });
    try {
      await Promise.allSettled([
        workflowService.markAllNotificationsAsRead(),
        markAllEditorAlertsRead(),
        notificationService.markAllRead(),
      ]);
      set((state) => ({
        notifications: state.notifications.map((n) => ({ ...n, is_read: true, read_at: new Date().toISOString() })),
        unreadCount: 0,
        editorAlerts: state.editorAlerts.map((a) => ({ ...a, is_read: true })),
        editorAlertsUnreadCount: 0,
        systemAlerts: state.systemAlerts.map((a) => ({ ...a, is_read: true })),
        systemAlertsUnreadCount: 0,
      }));
    } catch (error) {
      set({ error: error.message });
      throw error;
    }
  },

  // ============================================================================
  // UTILITY
  // ============================================================================

  /**
   * Clear error
   */
  clearError: () => set({ error: null }),

  /**
   * Reset store
   */
  reset: () => set({
    workflows: [],
    myTasks: [],
    assignedByMe: [],
    approvals: [],
    myApprovals: [],
    comments: [],
    notifications: [],
    unreadCount: 0,
    editorAlerts: [],
    editorAlertsUnreadCount: 0,
    systemAlerts: [],
    systemAlertsUnreadCount: 0,
    loading: {
      workflows: false,
      tasks: false,
      approvals: false,
      comments: false,
      notifications: false,
    },
    error: null,
  }),
}));

export default useWorkflowStore;
