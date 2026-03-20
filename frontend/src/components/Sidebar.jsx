import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useFeatureFlags } from '../contexts/FeatureFlagContext';
import { getSidebarConfig } from '../domains';
import { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  Home,
  User,
  Settings,
  LogOut,
  PlusCircle,
  Search,
  ChevronRight,
  ChevronLeft,
  Database,
  FolderOpen,
  GitBranch,
  Bell,
  ListTodo,
  CheckCircle,
  ShieldCheck,
  BookTemplate,
  Code,
  Eye,
  LayoutDashboard,
  FilePlus,
  Grid3X3,
} from 'lucide-react';
import useWorkflowStore from '../store/workflowStore';
import NotificationCenter from './NotificationCenter';

const Sidebar = () => {
  const { user, logout } = useAuth();
  const { isAppEnabled, isEditorEnabled, domain } = useFeatureFlags();
  const navigate = useNavigate();
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileSidebar, setShowProfileSidebar] = useState(false);
  const { unreadCount, fetchUnreadNotifications } = useWorkflowStore();

  // Fetch unread notification count on mount and periodically
  useEffect(() => {
    fetchUnreadNotifications().catch(() => {});
    const interval = setInterval(() => {
      fetchUnreadNotifications().catch(() => {});
    }, 60000); // every 60s
    return () => clearInterval(interval);
  }, [fetchUnreadNotifications]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const sidebarConfig = useMemo(() => getSidebarConfig(domain), [domain]);

  const openCreateDialog = () => {
    if (sidebarConfig.newDocumentAction === 'quick_latex') {
      navigate('/quick-latex');
    } else {
      window.dispatchEvent(new CustomEvent('openCreateDocumentDialog'));
    }
  };

  const openSecondaryCreate = () => {
    window.dispatchEvent(new CustomEvent('openCreateDocumentDialog'));
  };

  const isAdmin = user?.role_type === 'org_admin' || user?.role_type === 'system_admin';

  // ── Build nav items filtered by feature flags ────────────────────

  const navItems = useMemo(() => {
    const items = [
      { key: 'home', to: '/dashboard', icon: Home, label: 'Home', always: true },
      { key: 'procurement_dashboard', to: '/procurement-dashboard', icon: LayoutDashboard, label: 'Procurement Dashboard', flag: ['apps', 'quick_latex'] },
      { key: 'documents', to: '/documents', icon: FileText, label: 'Documents', flag: ['apps', 'documents'] },
      { key: 'masters', to: '/masters', icon: BookTemplate, label: 'Templates', flag: ['apps', 'master_documents'] },
      { key: 'quick_latex', to: '/quick-latex', icon: Eye, label: 'Quick Documents', flag: ['apps', 'quick_latex'] },
      { key: 'sheets', to: '/sheets', icon: Grid3X3, label: 'Sheets', always: true },
      { key: 'tasks', to: '/tasks', icon: ListTodo, label: 'My Tasks', flag: ['apps', 'workflow'] },
      { key: 'approvals', to: '/approvals', icon: CheckCircle, label: 'Approvals', flag: ['apps', 'workflow'] },
      { key: 'settings', to: '/settings', icon: Settings, label: 'Settings', always: true },
      ...(isAdmin ? [{ key: 'admin', to: '/admin', icon: ShieldCheck, label: 'Admin', always: true }] : []),
    ];

    const filtered = items.filter((item) => {
      if (item.always) return true;
      if (item.flag) {
        const [category, feature] = item.flag;
        return category === 'apps' ? isAppEnabled(feature) : true;
      }
      return true;
    });

    // Reorder if the domain provides a navOrder
    const navOrder = sidebarConfig.navOrder;
    if (navOrder) {
      const byKey = Object.fromEntries(filtered.map((item) => [item.key, item]));
      const ordered = navOrder.map((k) => byKey[k]).filter(Boolean);
      // Append any items not listed in navOrder at the end
      const orderedKeys = new Set(navOrder);
      filtered.forEach((item) => {
        if (!orderedKeys.has(item.key)) ordered.push(item);
      });
      return ordered;
    }

    return filtered;
  }, [isAdmin, isAppEnabled, sidebarConfig]);

  const appItems = useMemo(() => {
    const items = [
      { to: '/dms', icon: Database, label: 'DMS App', flag: 'dms' },
      { to: '/fileshare', icon: FolderOpen, label: 'FileShare', flag: 'fileshare' },
      { to: '/clm', icon: GitBranch, label: 'Workflow Management', flag: 'clm' },
    ];

    return items.filter((item) => item.always || isAppEnabled(item.flag));
  }, [isAppEnabled]);

  const isExpanded = !isCollapsed || isHovered;

  return (
    <div 
      className={`h-screen bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ease-in-out ${
        isExpanded ? 'w-64' : 'w-16'
      }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Logo/Header */}
      <div className={`h-14 flex items-center border-b border-gray-200 ${isExpanded ? 'justify-between px-4' : 'justify-center px-2'}`}>
        <div className={`flex items-center gap-2 ${!isExpanded ? 'justify-center' : ''}`}>
          <div className="bg-blue-600 p-1.5 rounded flex-shrink-0">
            <FileText className="h-4 w-4 text-white" />
          </div>
          {isExpanded && (
            <span className="font-bold text-lg text-gray-900 whitespace-nowrap">
              Drafter
              {domain && domain !== 'default' && (
                <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-blue-100 text-blue-700">
                  {domain}
                </span>
              )}
            </span>
          )}
        </div>
        
        {/* Toggle button */}
        {isExpanded && (
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 hover:bg-gray-100 rounded transition-opacity duration-200"
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        )}
      </div>

      {/* New Document Button */}
      <div className="p-3 space-y-2">
        <button
          onClick={openCreateDialog}
          className={`w-full bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center justify-center gap-2 transition-all text-sm ${
            isExpanded ? 'px-3 py-1.5' : 'p-2'
          }`}
          title={sidebarConfig.newDocumentLabel || 'New Document'}
        >
          <PlusCircle className="h-4 w-4 flex-shrink-0" />
          {isExpanded && <span className="whitespace-nowrap">{sidebarConfig.newDocumentLabel || 'New Document'}</span>}
        </button>
        {sidebarConfig.secondaryAction && isExpanded && (
          <button
            onClick={openSecondaryCreate}
            className="w-full border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-md flex items-center justify-center gap-2 px-4 py-2 transition-all text-sm"
            title={sidebarConfig.secondaryLabel || 'Create Drafter Document'}
          >
            <FilePlus className="h-4 w-4 flex-shrink-0" />
            <span className="whitespace-nowrap">{sidebarConfig.secondaryLabel || 'Create Drafter Document'}</span>
          </button>
        )}
      </div>

      {/* Search */}
      {isExpanded && (
        <div className="px-3 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search documents..."
              className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
            />
          </div>
        </div>
      )}

      {/* Navigation Items */}
      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-1.5 rounded-md transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-gray-700 hover:bg-gray-50'
              } ${!isExpanded ? 'justify-center' : ''}`
            }
            title={!isExpanded ? item.label : ''}
          >
            <item.icon className="h-4 w-4 flex-shrink-0" />
            {isExpanded && <span className="text-sm whitespace-nowrap">{item.label}</span>}
          </NavLink>
        ))}

        {isExpanded && (
          <div className="mt-6 px-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Apps
          </div>
        )}

        {appItems.length > 0 ? (
          appItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-1.5 rounded-md transition-colors mt-1 ${
                  isActive
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-gray-700 hover:bg-gray-50'
                } ${!isExpanded ? 'justify-center' : ''}`
              }
              title={!isExpanded ? item.label : ''}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {isExpanded && <span className="text-sm whitespace-nowrap">{item.label}</span>}
            </NavLink>
          ))
        ) : (
          isExpanded && (
            <p className="px-3 py-2 text-xs text-gray-400 italic">No apps enabled</p>
          )
        )}
      </nav>

      {/* Notification Bell */}
      <div className="px-2 pb-1">
        <button
          onClick={() => setShowNotifications(true)}
          className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md transition-colors text-gray-700 hover:bg-gray-50 relative ${
            !isExpanded ? 'justify-center' : ''
          }`}
          title={!isExpanded ? `Notifications${unreadCount > 0 ? ` (${unreadCount})` : ''}` : ''}
        >
          <div className="relative flex-shrink-0">
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] rounded-full min-w-[18px] h-[18px] flex items-center justify-center font-bold leading-none px-1">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
          {isExpanded && (
            <span className="text-sm whitespace-nowrap">
              Notifications
              {unreadCount > 0 && (
                <span className="ml-2 px-1.5 py-0.5 text-xs bg-red-100 text-red-700 rounded-full font-semibold">
                  {unreadCount}
                </span>
              )}
            </span>
          )}
        </button>
      </div>

      {/* User Profile & Logout */}
      <div className="border-t border-gray-200 p-3">
        <div className={`flex items-center ${isExpanded ? 'justify-between' : 'flex-col gap-2'}`}>
          <button
            onClick={() => setShowProfileSidebar(true)}
            className="flex items-center gap-2 hover:bg-gray-100 rounded-md p-1.5 transition-colors min-w-0"
            title="Profile"
          >
            <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <User className="h-4 w-4 text-blue-600" />
            </div>
            {isExpanded && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-900 truncate">
                  {user?.first_name} {user?.last_name}
                </p>
              </div>
            )}
          </button>
          <button
            onClick={handleLogout}
            className="p-1.5 text-red-600 hover:bg-red-50 rounded-md transition-colors flex-shrink-0"
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Profile Sidebar Panel */}
      {showProfileSidebar && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={() => setShowProfileSidebar(false)}
          />
          <div className="fixed top-0 right-0 h-full w-80 bg-white shadow-xl z-50 flex flex-col animate-in slide-in-from-right">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Profile</h2>
              <button
                onClick={() => setShowProfileSidebar(false)}
                className="p-1 hover:bg-gray-100 rounded-md text-gray-500"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="flex flex-col items-center text-center">
                <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center mb-3">
                  <User className="h-8 w-8 text-blue-600" />
                </div>
                <p className="text-base font-semibold text-gray-900">
                  {user?.first_name} {user?.last_name}
                </p>
                <p className="text-sm text-gray-500">{user?.email}</p>
                {user?.role_type && (
                  <span className="mt-1 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 capitalize">
                    {user.role_type.replace('_', ' ')}
                  </span>
                )}
              </div>
              <div className="border-t pt-4">
                <NavLink
                  to="/profile"
                  onClick={() => setShowProfileSidebar(false)}
                  className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <User className="h-4 w-4" />
                  View Full Profile
                </NavLink>
                <NavLink
                  to="/settings"
                  onClick={() => setShowProfileSidebar(false)}
                  className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </NavLink>
              </div>
              <div className="border-t pt-4">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Notification Center Panel */}
      <NotificationCenter
        isOpen={showNotifications}
        onClose={() => setShowNotifications(false)}
      />
    </div>
  );
};

export default Sidebar;
