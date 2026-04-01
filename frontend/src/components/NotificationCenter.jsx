import { useEffect, useState, useMemo } from 'react';
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
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Eye,
  Settings,
  Workflow,
  Database,
  ScrollText,
} from 'lucide-react';
import useWorkflowStore from '../store/workflowStore';

// ─── App group definitions ─────────────────────────────────────────
const APP_GROUPS = {
  documents: {
    key: 'documents',
    label: 'Documents',
    icon: FileText,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    badgeColor: 'bg-blue-100 text-blue-700',
    headerGradient: 'from-blue-500 to-blue-600',
    prefixes: ['document.'],
    sources: ['editor_alert'],
  },
  workflows: {
    key: 'workflows',
    label: 'Workflows',
    icon: Workflow,
    color: 'text-teal-600',
    bgColor: 'bg-teal-50',
    badgeColor: 'bg-teal-100 text-teal-700',
    headerGradient: 'from-teal-500 to-teal-600',
    prefixes: ['workflow.'],
    sources: ['workflow'],
  },
  clm: {
    key: 'clm',
    label: 'CLM',
    icon: ScrollText,
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    badgeColor: 'bg-indigo-100 text-indigo-700',
    headerGradient: 'from-indigo-500 to-indigo-600',
    prefixes: ['clm.'],
    sources: [],
  },
  dms: {
    key: 'dms',
    label: 'DMS',
    icon: Database,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    badgeColor: 'bg-orange-100 text-orange-700',
    headerGradient: 'from-orange-500 to-orange-600',
    prefixes: ['dms.'],
    sources: [],
  },
  viewer: {
    key: 'viewer',
    label: 'Viewer',
    icon: Eye,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    badgeColor: 'bg-purple-100 text-purple-700',
    headerGradient: 'from-purple-500 to-purple-600',
    prefixes: ['viewer.'],
    sources: [],
  },
  sharing: {
    key: 'sharing',
    label: 'Sharing',
    icon: Share2,
    color: 'text-pink-600',
    bgColor: 'bg-pink-50',
    badgeColor: 'bg-pink-100 text-pink-700',
    headerGradient: 'from-pink-500 to-pink-600',
    prefixes: ['sharing.'],
    sources: [],
  },
  system: {
    key: 'system',
    label: 'System',
    icon: Settings,
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
    badgeColor: 'bg-gray-200 text-gray-700',
    headerGradient: 'from-gray-500 to-gray-600',
    prefixes: ['system.'],
    sources: [],
  },
};

// Ordered keys — controls display order
const GROUP_ORDER = ['documents', 'workflows', 'clm', 'dms', 'viewer', 'sharing', 'system'];

// ─── Icon / color maps ─────────────────────────────────────────────
const NOTIFICATION_ICONS = {
  'document.shared': Share2,
  'document.comment': MessageSquare,
  'document.comment_reply': Reply,
  'document.comment_resolved': CheckCircle,
  'document.approval': FileCheck,
  'document.mention': User,
  'document.export_complete': FileText,
  'document.version_created': FolderOpen,
  'workflow.assigned': GitBranch,
  'workflow.reassigned': GitBranch,
  'workflow.status_changed': AlertCircle,
  'workflow.approval_request': FileCheck,
  'workflow.approved': CheckCircle,
  'workflow.rejected': XCircle,
  'workflow.due_date': Clock,
  'workflow.decision': AlertCircle,
  'workflow.overdue': AlertTriangle,
  'dms.expiring': AlertTriangle,
  'dms.expired': XCircle,
  'dms.renewal': Clock,
  'clm.contract_expiring': AlertTriangle,
  'clm.task_assigned': GitBranch,
  'clm.task_completed': CheckCircle,
  'clm.validation_assigned': ShieldCheck,
  'clm.validation_pending': FileCheck,
  'clm.validation_resolved': CheckCircle,
  'clm.workflow_failed': XCircle,
  'clm.workflow_completed': CheckCircle,
  'viewer.invitation_sent': Mail,
  'viewer.document_shared': Share2,
  'viewer.new_comment': MessageSquare,
  'viewer.approval_submitted': ShieldCheck,
  'sharing.access_granted': Share2,
  'sharing.access_revoked': XCircle,
  'sharing.role_changed': ShieldCheck,
  'system.info': Info,
  'system.warning': AlertTriangle,
  'system.error': XCircle,
  'system.maintenance': Settings,
  // Legacy workflow/editor types
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

const NOTIFICATION_COLORS = {
  'document.shared': 'text-purple-600 bg-purple-100',
  'document.comment': 'text-blue-600 bg-blue-100',
  'document.comment_reply': 'text-indigo-600 bg-indigo-100',
  'document.comment_resolved': 'text-green-600 bg-green-100',
  'document.approval': 'text-amber-600 bg-amber-100',
  'document.mention': 'text-indigo-600 bg-indigo-100',
  'document.export_complete': 'text-blue-600 bg-blue-100',
  'document.version_created': 'text-teal-600 bg-teal-100',
  'workflow.assigned': 'text-blue-600 bg-blue-100',
  'workflow.reassigned': 'text-purple-600 bg-purple-100',
  'workflow.status_changed': 'text-teal-600 bg-teal-100',
  'workflow.approval_request': 'text-orange-600 bg-orange-100',
  'workflow.approved': 'text-green-600 bg-green-100',
  'workflow.rejected': 'text-red-600 bg-red-100',
  'workflow.due_date': 'text-yellow-600 bg-yellow-100',
  'workflow.decision': 'text-teal-600 bg-teal-100',
  'workflow.overdue': 'text-red-600 bg-red-100',
  'dms.expiring': 'text-orange-600 bg-orange-100',
  'dms.expired': 'text-red-600 bg-red-100',
  'dms.renewal': 'text-yellow-600 bg-yellow-100',
  'clm.contract_expiring': 'text-orange-600 bg-orange-100',
  'clm.task_assigned': 'text-blue-600 bg-blue-100',
  'clm.task_completed': 'text-green-600 bg-green-100',
  'clm.validation_assigned': 'text-amber-600 bg-amber-100',
  'clm.validation_pending': 'text-orange-600 bg-orange-100',
  'clm.validation_resolved': 'text-green-600 bg-green-100',
  'clm.workflow_failed': 'text-red-600 bg-red-100',
  'clm.workflow_completed': 'text-green-600 bg-green-100',
  'viewer.invitation_sent': 'text-blue-600 bg-blue-100',
  'viewer.document_shared': 'text-purple-600 bg-purple-100',
  'viewer.new_comment': 'text-blue-600 bg-blue-100',
  'viewer.approval_submitted': 'text-amber-600 bg-amber-100',
  'sharing.access_granted': 'text-pink-600 bg-pink-100',
  'sharing.access_revoked': 'text-red-600 bg-red-100',
  'sharing.role_changed': 'text-pink-600 bg-pink-100',
  'system.info': 'text-blue-600 bg-blue-100',
  'system.warning': 'text-yellow-600 bg-yellow-100',
  'system.error': 'text-red-600 bg-red-100',
  'system.maintenance': 'text-gray-600 bg-gray-100',
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

// ─── Helpers ────────────────────────────────────────────────────────
const getNotificationIcon = (type) => NOTIFICATION_ICONS[type] || Bell;
const getNotificationColor = (type) => NOTIFICATION_COLORS[type] || 'text-gray-600 bg-gray-100';

/** Resolve which app group a notification belongs to */
const resolveGroup = (notification) => {
  const category = notification.category || notification.notification_type || '';
  const source = notification._source;

  for (const groupKey of GROUP_ORDER) {
    const group = APP_GROUPS[groupKey];
    // Check source match (e.g. 'workflow' source → workflows group)
    if (group.sources.includes(source)) return groupKey;
    // Check category prefix match (e.g. 'clm.task_assigned' → clm group)
    if (group.prefixes.some((p) => category.startsWith(p))) return groupKey;
  }
  return 'system'; // fallback
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

// ─── Notification Item ──────────────────────────────────────────────
const NotificationItem = ({ notification, onClick }) => {
  const Icon = getNotificationIcon(notification.notification_type);
  const colorClass = getNotificationColor(notification.notification_type);

  return (
    <div
      onClick={() => onClick(notification)}
      className={`px-4 py-3 cursor-pointer transition-all duration-150 ${
        notification.is_read
          ? 'bg-white hover:bg-gray-50'
          : 'bg-blue-50/60 hover:bg-blue-50 border-l-3 border-l-blue-500'
      }`}
    >
      <div className="flex gap-3">
        <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${colorClass}`}>
          <Icon className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <p className={`text-sm text-gray-900 leading-snug ${!notification.is_read ? 'font-semibold' : 'font-medium'}`}>
            {notification.title || notification.message}
          </p>
          {notification.title && notification.message && notification.title !== notification.message && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{notification.message}</p>
          )}
          {notification._source === 'editor_alert' && notification.document_title && (
            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
              <FileText className="w-3 h-3" /> {notification.document_title}
            </p>
          )}
          {notification.workflow_info && notification._source === 'workflow' && notification.workflow_info.document_title && (
            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
              <FileText className="w-3 h-3" /> {notification.workflow_info.document_title}
            </p>
          )}
          {notification._source === 'system' && notification.actor_name && (
            <p className="text-xs text-gray-400 mt-0.5">By {notification.actor_name}</p>
          )}
          <p className="text-[11px] text-gray-400 mt-1">{formatTimeAgo(notification.created_at)}</p>
        </div>

        {!notification.is_read && (
          <div className="flex-shrink-0 pt-1">
            <div className="w-2 h-2 bg-blue-500 rounded-full" />
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Group Section (collapsible stack) ──────────────────────────────
const GroupSection = ({ groupKey, items, onNotificationClick, defaultExpanded }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const group = APP_GROUPS[groupKey];
  const GroupIcon = group.icon;
  const unread = items.filter((n) => !n.is_read).length;

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      {/* Group header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-gray-50 ${group.bgColor}`}
      >
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center bg-gradient-to-br ${group.headerGradient} text-white shadow-sm`}>
          <GroupIcon className="w-3.5 h-3.5" />
        </div>
        <span className={`text-sm font-semibold ${group.color} flex-1`}>{group.label}</span>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${group.badgeColor}`}>
              {unread}
            </span>
          )}
          <span className="text-xs text-gray-400">{items.length}</span>
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </button>

      {/* Items */}
      {expanded && (
        <div className="divide-y divide-gray-50">
          {items.map((notification) => (
            <NotificationItem
              key={`${notification._source}-${notification.id}`}
              notification={notification}
              onClick={onNotificationClick}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Main Component ─────────────────────────────────────────────────
const NotificationCenter = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const {
    notifications,
    unreadCount,
    loading,
    fetchNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
  } = useWorkflowStore();

  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen, fetchNotifications]);

  // Filter first, then group
  const filteredNotifications = useMemo(() => {
    return notifications.filter((n) => {
      if (filter === 'unread') return !n.is_read;
      if (filter === 'read') return n.is_read;
      return true;
    });
  }, [notifications, filter]);

  // Group by app
  const groupedNotifications = useMemo(() => {
    const groups = {};
    for (const n of filteredNotifications) {
      const gk = resolveGroup(n);
      if (!groups[gk]) groups[gk] = [];
      groups[gk].push(n);
    }
    return groups;
  }, [filteredNotifications]);

  // Ordered groups that actually have items
  const activeGroups = useMemo(() => {
    return GROUP_ORDER.filter((gk) => groupedNotifications[gk]?.length > 0);
  }, [groupedNotifications]);

  const handleNotificationClick = async (notification) => {
    if (!notification.is_read) {
      await markNotificationAsRead(notification.id, notification._source);
    }

    if (notification._source === 'system') {
      const actionUrl = notification.metadata?.action_url;
      if (actionUrl) {
        if (actionUrl.startsWith('http')) {
          window.open(actionUrl, '_blank');
        } else {
          navigate(actionUrl);
        }
      } else if (notification.target_type === 'document' && notification.target_id) {
        navigate(`/drafter/${notification.target_id}`);
      } else if (notification.target_type === 'workflow' && notification.target_id) {
        navigate('/tasks');
      }
    } else if (notification._source === 'editor_alert' && notification.document_id) {
      navigate(`/drafter/${notification.document_id}`);
    } else if (notification.workflow_info?.document_id) {
      navigate(`/drafter/${notification.workflow_info.document_id}`);
    } else if (notification.workflow_info) {
      navigate('/tasks');
    }

    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 backdrop-blur-sm z-41"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full md:w-[420px] bg-white shadow-2xl z-50 flex flex-col animate-slide-in-right">
        {/* ── Header ── */}
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
            {[
              { key: 'all', label: 'All' },
              { key: 'unread', label: `Unread (${unreadCount})` },
              { key: 'read', label: 'Read' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`px-3 py-1 rounded transition-colors ${
                  filter === tab.key
                    ? 'bg-white text-blue-600 font-semibold'
                    : 'text-white hover:bg-white hover:bg-opacity-20'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Quick app group chips (horizontal scroll) ── */}
        {activeGroups.length > 1 && (
          <div className="px-3 py-2 border-b bg-gray-50 flex items-center gap-2 overflow-x-auto scrollbar-hide">
            {activeGroups.map((gk) => {
              const g = APP_GROUPS[gk];
              const Icon = g.icon;
              const unread = (groupedNotifications[gk] || []).filter((n) => !n.is_read).length;
              return (
                <button
                  key={gk}
                  onClick={() => {
                    const el = document.getElementById(`notif-group-${gk}`);
                    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors border ${g.badgeColor} border-transparent hover:shadow-sm`}
                >
                  <Icon className="w-3 h-3" />
                  {g.label}
                  {unread > 0 && (
                    <span className="ml-0.5 bg-red-500 text-white text-[9px] rounded-full min-w-[16px] h-4 flex items-center justify-center font-bold px-1">
                      {unread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* ── Mark all read ── */}
        {unreadCount > 0 && (
          <div className="px-4 py-2 border-b bg-gray-50">
            <button
              onClick={() => markAllNotificationsAsRead()}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              <Check className="w-4 h-4" />
              Mark all as read
            </button>
          </div>
        )}

        {/* ── Grouped Notifications List ── */}
        <div className="flex-1 overflow-y-auto">
          {loading.notifications ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <Bell className="w-16 h-16 mb-4 opacity-30" />
              <p className="text-center text-sm">
                {filter === 'unread'
                  ? 'No unread notifications'
                  : filter === 'read'
                  ? 'No read notifications'
                  : 'No notifications yet'}
              </p>
            </div>
          ) : (
            <div>
              {activeGroups.map((gk, idx) => (
                <div key={gk} id={`notif-group-${gk}`}>
                  <GroupSection
                    groupKey={gk}
                    items={groupedNotifications[gk]}
                    onNotificationClick={handleNotificationClick}
                    defaultExpanded={idx < 3}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
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
