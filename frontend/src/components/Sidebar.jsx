import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import useWorkflowStore from '../store/workflowStore';
import NotificationCenter from './NotificationCenter';

const Sidebar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
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

  const openCreateDialog = () => {
    window.dispatchEvent(new CustomEvent('openCreateDocumentDialog'));
  };

  const isAdmin = user?.role_type === 'org_admin' || user?.role_type === 'system_admin';

  const navItems = [
    { to: '/dashboard', icon: Home, label: 'Home' },
    { to: '/documents', icon: FileText, label: 'Documents' },
    { to: '/masters', icon: BookTemplate, label: 'Masters' },
    { to: '/quick-latex', icon: Code, label: 'Quick LaTeX' },
    { to: '/tasks', icon: ListTodo, label: 'My Tasks' },
    { to: '/approvals', icon: CheckCircle, label: 'Approvals' },
    { to: '/profile', icon: User, label: 'Profile' },
    { to: '/settings', icon: Settings, label: 'Settings' },
    ...(isAdmin ? [{ to: '/admin', icon: ShieldCheck, label: 'Admin' }] : []),
  ];

  const appItems = [
    { to: '/dms', icon: Database, label: 'DMS App' },
    { to: '/fileshare', icon: FolderOpen, label: 'FileShare' },
    { to: '/clm', icon: GitBranch, label: 'CLM' },
  ];

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
      <div className="h-16 flex items-center justify-between px-4 border-b border-gray-200">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="bg-blue-600 p-2 rounded flex-shrink-0">
            <FileText className="h-5 w-5 text-white" />
          </div>
          <span 
            className={`font-bold text-xl text-gray-900 whitespace-nowrap transition-opacity duration-200 ${
              isExpanded ? 'opacity-100' : 'opacity-0'
            }`}
          >
            Drafter
          </span>
        </div>
        
        {/* Toggle button */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={`p-1 hover:bg-gray-100 rounded transition-opacity duration-200 ${
            isExpanded ? 'opacity-100' : 'opacity-0'
          }`}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* New Document Button */}
      <div className="p-4">
        <button
          onClick={openCreateDialog}
          className={`w-full bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center justify-center gap-2 transition-all ${
            isExpanded ? 'px-4 py-2' : 'p-2'
          }`}
          title="New Document"
        >
          <PlusCircle className="h-5 w-5 flex-shrink-0" />
          {isExpanded && <span className="whitespace-nowrap">New Document</span>}
        </button>
      </div>

      {/* Search */}
      {isExpanded && (
        <div className="px-4 pb-4">
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
      <nav className="flex-1 px-2 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-gray-700 hover:bg-gray-50'
              } ${!isExpanded ? 'justify-center' : ''}`
            }
            title={!isExpanded ? item.label : ''}
          >
            <item.icon className="h-5 w-5 flex-shrink-0" />
            {isExpanded && <span className="font-medium whitespace-nowrap">{item.label}</span>}
          </NavLink>
        ))}

        {isExpanded && (
          <div className="mt-6 px-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Apps
          </div>
        )}

        {appItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md transition-colors mt-1 ${
                isActive
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-gray-700 hover:bg-gray-50'
              } ${!isExpanded ? 'justify-center' : ''}`
            }
            title={!isExpanded ? item.label : ''}
          >
            <item.icon className="h-5 w-5 flex-shrink-0" />
            {isExpanded && <span className="font-medium whitespace-nowrap">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Notification Bell */}
      <div className="px-2 pb-2">
        <button
          onClick={() => setShowNotifications(true)}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-gray-700 hover:bg-gray-50 relative ${
            !isExpanded ? 'justify-center' : ''
          }`}
          title={!isExpanded ? `Notifications${unreadCount > 0 ? ` (${unreadCount})` : ''}` : ''}
        >
          <div className="relative flex-shrink-0">
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] rounded-full min-w-[18px] h-[18px] flex items-center justify-center font-bold leading-none px-1">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
          {isExpanded && (
            <span className="font-medium whitespace-nowrap">
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
      <div className="border-t border-gray-200 p-4">
        {isExpanded ? (
          <>
            <div className="flex items-center gap-3 mb-3">
              <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <User className="h-5 w-5 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {user?.first_name} {user?.last_name}
                </p>
                <p className="text-xs text-gray-500 truncate">{user?.email}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </>
        ) : (
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center p-2 text-red-600 hover:bg-red-50 rounded-md transition-colors"
            title="Logout"
          >
            <LogOut className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Notification Center Panel */}
      <NotificationCenter
        isOpen={showNotifications}
        onClose={() => setShowNotifications(false)}
      />
    </div>
  );
};

export default Sidebar;
