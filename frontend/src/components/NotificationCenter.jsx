import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Bell, 
  CheckCircle, 
  X, 
  User, 
  MessageSquare,
  AlertCircle,
  Clock,
  Check,
  Share2,
  FileCheck,
  Reply,
  Trash2,
  Info,
  AlertTriangle,
  XCircle,
  GitBranch,
  FileText,
  ShieldCheck,
  Mail,
} from 'lucide-react';
import useWorkflowStore from '../store/workflowStore';

const NotificationCenter = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const {
    notifications,
    unreadCount,
    loading,
    fetchNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead
  } = useWorkflowStore();

  const [filter, setFilter] = useState('all'); // all, unread, read

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen, fetchNotifications]);

  const getNotificationIcon = (type, source) => {
    // System alerts (communications.Alert categories)
    if (source === 'system') {
      const systemIcons = {
        'document.shared': Share2,
        'document.comment': MessageSquare,
        'document.comment_reply': Reply,
        'document.comment_resolved': CheckCircle,
        'document.approval': FileCheck,
        'document.mention': User,
        'workflow.assigned': GitBranch,
        'workflow.reassigned': GitBranch,
        'workflow.status_changed': AlertCircle,
        'workflow.approval_request': FileCheck,
        'workflow.approved': CheckCircle,
        'workflow.rejected': XCircle,
        'workflow.due_date': Clock,
        'workflow.decision': AlertCircle,
        'dms.expiring': AlertTriangle,
        'dms.expired': XCircle,
        'dms.renewal': Clock,
        'clm.contract_expiring': AlertTriangle,
        'clm.task_assigned': GitBranch,
        'clm.task_completed': CheckCircle,
        'viewer.invitation_sent': Mail,
        'viewer.document_shared': Share2,
        'viewer.new_comment': MessageSquare,
        'viewer.approval_submitted': ShieldCheck,
        'system.info': Info,
        'system.warning': AlertTriangle,
        'system.error': XCircle,
      };
      return systemIcons[type] || Bell;
    }

    // Workflow + editor alert types
    const icons = {
      assignment: User,
      reassignment: User,
      approval_request: AlertCircle,
      approval_approved: CheckCircle,
      approval_rejected: X,
      comment: MessageSquare,
      mention: User,
      due_date_reminder: Clock,
      status_change: AlertCircle,
      new_comment: MessageSquare,
      comment_reply: Reply,
      comment_resolved: CheckCircle,
      comment_deleted: Trash2,
      approval_submitted: FileCheck,
      document_shared: Share2,
    };
    return icons[type] || Bell;
  };

  const getNotificationColor = (type, source) => {
    // System alerts
    if (source === 'system') {
      const systemColors = {
        'document.shared': 'text-purple-600 bg-purple-100',
        'document.comment': 'text-blue-600 bg-blue-100',
        'document.comment_reply': 'text-indigo-600 bg-indigo-100',
        'document.comment_resolved': 'text-green-600 bg-green-100',
        'document.approval': 'text-amber-600 bg-amber-100',
        'document.mention': 'text-indigo-600 bg-indigo-100',
        'workflow.assigned': 'text-blue-600 bg-blue-100',
        'workflow.reassigned': 'text-purple-600 bg-purple-100',
        'workflow.status_changed': 'text-teal-600 bg-teal-100',
        'workflow.approval_request': 'text-orange-600 bg-orange-100',
        'workflow.approved': 'text-green-600 bg-green-100',
        'workflow.rejected': 'text-red-600 bg-red-100',
        'workflow.due_date': 'text-yellow-600 bg-yellow-100',
        'workflow.decision': 'text-teal-600 bg-teal-100',
        'dms.expiring': 'text-orange-600 bg-orange-100',
        'dms.expired': 'text-red-600 bg-red-100',
        'dms.renewal': 'text-yellow-600 bg-yellow-100',
        'clm.contract_expiring': 'text-orange-600 bg-orange-100',
        'clm.task_assigned': 'text-blue-600 bg-blue-100',
        'clm.task_completed': 'text-green-600 bg-green-100',
        'viewer.invitation_sent': 'text-blue-600 bg-blue-100',
        'viewer.document_shared': 'text-purple-600 bg-purple-100',
        'viewer.new_comment': 'text-blue-600 bg-blue-100',
        'viewer.approval_submitted': 'text-amber-600 bg-amber-100',
        'system.info': 'text-blue-600 bg-blue-100',
        'system.warning': 'text-yellow-600 bg-yellow-100',
        'system.error': 'text-red-600 bg-red-100',
      };
      return systemColors[type] || 'text-gray-600 bg-gray-100';
    }

    // Workflow + editor alert types
    const colors = {
      assignment: 'text-blue-600 bg-blue-100',
      reassignment: 'text-purple-600 bg-purple-100',
      approval_request: 'text-orange-600 bg-orange-100',
      approval_approved: 'text-green-600 bg-green-100',
      approval_rejected: 'text-red-600 bg-red-100',
      comment: 'text-gray-600 bg-gray-100',
      mention: 'text-indigo-600 bg-indigo-100',
      due_date_reminder: 'text-yellow-600 bg-yellow-100',
      status_change: 'text-teal-600 bg-teal-100',
      new_comment: 'text-blue-600 bg-blue-100',
      comment_reply: 'text-indigo-600 bg-indigo-100',
      comment_resolved: 'text-green-600 bg-green-100',
      comment_deleted: 'text-red-600 bg-red-100',
      approval_submitted: 'text-amber-600 bg-amber-100',
      document_shared: 'text-purple-600 bg-purple-100',
    };
    return colors[type] || 'text-gray-600 bg-gray-100';
  };

  const getSourceBadge = (notification) => {
    if (notification._source === 'editor_alert') {
      return { label: 'Review', className: 'bg-purple-100 text-purple-700' };
    }
    if (notification._source === 'system') {
      const category = notification.category || notification.notification_type || '';
      if (category.startsWith('document.')) return { label: 'Document', className: 'bg-blue-100 text-blue-700' };
      if (category.startsWith('workflow.')) return { label: 'Workflow', className: 'bg-teal-100 text-teal-700' };
      if (category.startsWith('dms.')) return { label: 'DMS', className: 'bg-orange-100 text-orange-700' };
      if (category.startsWith('clm.')) return { label: 'CLM', className: 'bg-indigo-100 text-indigo-700' };
      if (category.startsWith('viewer.')) return { label: 'Viewer', className: 'bg-purple-100 text-purple-700' };
      if (category.startsWith('system.')) return { label: 'System', className: 'bg-gray-100 text-gray-700' };
      return { label: 'Alert', className: 'bg-gray-100 text-gray-700' };
    }
    return null;
  };

  const formatTimeAgo = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const handleNotificationClick = async (notification) => {
    if (!notification.is_read) {
      await markNotificationAsRead(notification.id, notification._source);
    }

    // Navigate based on source and type
    if (notification._source === 'system') {
      // System alerts: navigate based on target_type or metadata
      const actionUrl = notification.metadata?.action_url;
      if (actionUrl) {
        // action_url may be absolute or relative
        if (actionUrl.startsWith('http')) {
          window.open(actionUrl, '_blank');
        } else {
          navigate(actionUrl);
        }
      } else if (notification.target_type === 'document' && notification.target_id) {
        navigate(`/drafter/${notification.target_id}`);
      } else if (notification.target_type === 'workflow' && notification.target_id) {
        navigate(`/tasks`);
      }
    } else if (notification._source === 'editor_alert' && notification.document_id) {
      navigate(`/drafter/${notification.document_id}`);
    } else if (notification.workflow_info?.document_id) {
      navigate(`/drafter/${notification.workflow_info.document_id}`);
    } else if (notification.workflow_info) {
      navigate(`/tasks`);
    }
    
    onClose();
  };

  const handleMarkAllAsRead = async () => {
    await markAllNotificationsAsRead();
  };

  const filteredNotifications = notifications.filter(n => {
    if (filter === 'unread') return !n.is_read;
    if (filter === 'read') return n.is_read;
    return true;
  });

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-25 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full md:w-96 bg-white shadow-2xl z-50 flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="px-4 py-3 border-b bg-gradient-to-r from-blue-600 to-purple-600 text-white">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Bell className="w-5 h-5" />
              <h2 className="text-lg font-semibold">Notifications</h2>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 bg-white text-blue-600 text-xs font-bold rounded-full">
                  {unreadCount}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1 hover:bg-white hover:bg-opacity-20 rounded transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Filter Tabs */}
          <div className="flex gap-2 text-sm">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded ${
                filter === 'all' 
                  ? 'bg-white text-blue-600 font-semibold' 
                  : 'text-white hover:bg-white hover:bg-opacity-20'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('unread')}
              className={`px-3 py-1 rounded ${
                filter === 'unread' 
                  ? 'bg-white text-blue-600 font-semibold' 
                  : 'text-white hover:bg-white hover:bg-opacity-20'
              }`}
            >
              Unread ({unreadCount})
            </button>
            <button
              onClick={() => setFilter('read')}
              className={`px-3 py-1 rounded ${
                filter === 'read' 
                  ? 'bg-white text-blue-600 font-semibold' 
                  : 'text-white hover:bg-white hover:bg-opacity-20'
              }`}
            >
              Read
            </button>
          </div>
        </div>

        {/* Actions */}
        {unreadCount > 0 && (
          <div className="px-4 py-2 border-b bg-gray-50">
            <button
              onClick={handleMarkAllAsRead}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              <Check className="w-4 h-4" />
              Mark all as read
            </button>
          </div>
        )}

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto">
          {loading.notifications ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <Bell className="w-16 h-16 mb-4" />
              <p className="text-center">
                {filter === 'unread' ? 'No unread notifications' : 
                 filter === 'read' ? 'No read notifications' : 
                 'No notifications yet'}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {filteredNotifications.map((notification) => {
                const Icon = getNotificationIcon(notification.notification_type, notification._source);
                const colorClass = getNotificationColor(notification.notification_type, notification._source);
                const badge = getSourceBadge(notification);
                
                return (
                  <div
                    key={`${notification._source}-${notification.id}`}
                    onClick={() => handleNotificationClick(notification)}
                    className={`p-4 cursor-pointer transition-colors ${
                      notification.is_read 
                        ? 'bg-white hover:bg-gray-50' 
                        : 'bg-blue-50 hover:bg-blue-100 border-l-4 border-blue-600'
                    }`}
                  >
                    <div className="flex gap-3">
                      <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${colorClass}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium text-gray-900 ${!notification.is_read && 'font-semibold'}`}>
                          {notification.title || notification.message}
                        </p>
                        {notification.title && notification.message && notification.title !== notification.message && (
                          <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                            {notification.message}
                          </p>
                        )}
                        {/* Document title for editor alerts */}
                        {notification._source === 'editor_alert' && notification.document_title && (
                          <p className="text-xs text-gray-500 mt-1">
                            📄 {notification.document_title}
                          </p>
                        )}
                        {/* Workflow info for workflow notifications */}
                        {notification.workflow_info && notification._source === 'workflow' && (
                          <p className="text-xs text-gray-500 mt-1">
                            {notification.workflow_info.document_title}
                          </p>
                        )}
                        {/* Actor name for system alerts */}
                        {notification._source === 'system' && notification.actor_name && (
                          <p className="text-xs text-gray-500 mt-1">
                            By {notification.actor_name}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <p className="text-xs text-gray-500">
                            {formatTimeAgo(notification.created_at)}
                          </p>
                          {badge && (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.className}`}>
                              {badge.label}
                            </span>
                          )}
                        </div>
                      </div>

                      {!notification.is_read && (
                        <div className="flex-shrink-0">
                          <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t bg-gray-50">
          <button
            onClick={() => {
              navigate('/tasks');
              onClose();
            }}
            className="w-full text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            View all tasks
          </button>
        </div>
      </div>
    </>
  );
};

export default NotificationCenter;
