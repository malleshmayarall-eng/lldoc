import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  CheckCircle, 
  Clock, 
  AlertTriangle, 
  FileText,
  Calendar,
  User,
  Filter,
  Search,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import useWorkflowStore from '../store/workflowStore';
import { useAuth } from '../contexts/AuthContext';

const MyTasks = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    myTasks,
    loading,
    error,
    fetchMyTasks,
    updateWorkflowStatus,
    completeWorkflow,
    clearError
  } = useWorkflowStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [sortBy, setSortBy] = useState('due_date');
  const [expandedTask, setExpandedTask] = useState(null);

  useEffect(() => {
    fetchMyTasks();
  }, [fetchMyTasks]);

  const getPriorityColor = (priority) => {
    const colors = {
      urgent: 'bg-red-100 text-red-800 border-red-300',
      high: 'bg-orange-100 text-orange-800 border-orange-300',
      medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      low: 'bg-blue-100 text-blue-800 border-blue-300',
    };
    return colors[priority] || colors.medium;
  };

  const getStatusColor = (status) => {
    const colors = {
      draft: 'bg-gray-100 text-gray-800',
      review: 'bg-blue-100 text-blue-800',
      approved: 'bg-green-100 text-green-800',
      revision_required: 'bg-yellow-100 text-yellow-800',
      executed: 'bg-purple-100 text-purple-800',
      archived: 'bg-gray-100 text-gray-600',
      cancelled: 'bg-red-100 text-red-800',
    };
    return colors[status] || colors.draft;
  };

  const getStatusIcon = (status) => {
    const icons = {
      draft: FileText,
      review: Clock,
      approved: CheckCircle,
      revision_required: AlertTriangle,
      executed: CheckCircle,
    };
    const Icon = icons[status] || FileText;
    return <Icon className="w-4 h-4" />;
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'No deadline';
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = date - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return <span className="text-red-600 font-semibold">Overdue</span>;
    if (diffDays === 0) return <span className="text-orange-600 font-semibold">Today</span>;
    if (diffDays === 1) return <span className="text-yellow-600 font-semibold">Tomorrow</span>;
    if (diffDays <= 7) return <span className="text-yellow-600">{diffDays} days</span>;
    
    return date.toLocaleDateString();
  };

  const handleCompleteTask = async (taskId) => {
    if (confirm('Mark this task as complete?')) {
      try {
        await completeWorkflow(taskId);
      } catch (err) {
        console.error('Error completing task:', err);
      }
    }
  };

  const handleStatusChange = async (taskId, newStatus) => {
    try {
      await updateWorkflowStatus(taskId, newStatus);
    } catch (err) {
      console.error('Error updating status:', err);
    }
  };

  // Filter and sort tasks
  const filteredTasks = myTasks
    .filter((task) => {
      if (searchTerm && !task.document_title?.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }
      if (filterStatus !== 'all' && task.current_status !== filterStatus) {
        return false;
      }
      if (filterPriority !== 'all' && task.priority !== filterPriority) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'due_date') {
        return new Date(a.due_date || '9999-12-31') - new Date(b.due_date || '9999-12-31');
      }
      if (sortBy === 'priority') {
        const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return new Date(b.created_at) - new Date(a.created_at);
    });

  if (loading.tasks) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">My Tasks</h1>
        <p className="text-gray-600">
          {filteredTasks.length} active {filteredTasks.length === 1 ? 'task' : 'tasks'}
        </p>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative">
          <span className="block sm:inline">{error}</span>
          <button
            onClick={clearError}
            className="absolute top-0 bottom-0 right-0 px-4 py-3"
          >
            <span className="text-2xl">&times;</span>
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search tasks..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Status Filter */}
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none"
            >
              <option value="all">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="review">Review</option>
              <option value="approved">Approved</option>
              <option value="revision_required">Revision Required</option>
              <option value="executed">Executed</option>
            </select>
          </div>

          {/* Priority Filter */}
          <div className="relative">
            <AlertTriangle className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none"
            >
              <option value="all">All Priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          {/* Sort */}
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none"
            >
              <option value="due_date">Sort by Due Date</option>
              <option value="priority">Sort by Priority</option>
              <option value="created_at">Sort by Created</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tasks List */}
      {filteredTasks.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
          <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">No tasks found</h3>
          <p className="text-gray-600">
            {searchTerm || filterStatus !== 'all' || filterPriority !== 'all'
              ? 'Try adjusting your filters'
              : 'You have no active tasks assigned to you'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredTasks.map((task) => (
            <div
              key={task.id}
              className="bg-white rounded-lg shadow-sm border hover:shadow-md transition-shadow"
            >
              {/* Task Header */}
              <div className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">
                        {task.document_title || 'Untitled Document'}
                      </h3>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getPriorityColor(task.priority)}`}>
                        {task.priority}
                      </span>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${getStatusColor(task.current_status)}`}>
                        {getStatusIcon(task.current_status)}
                        {task.current_status.replace(/_/g, ' ')}
                      </span>
                    </div>

                    {task.message && (
                      <p className="text-gray-700 mb-3">{task.message}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                      <div className="flex items-center gap-1">
                        <User className="w-4 h-4" />
                        <span>From: {task.assigned_by_info?.username || 'Unknown'}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        <span>Due: {formatDate(task.due_date)}</span>
                      </div>
                      {task.organization && (
                        <span className="px-2 py-1 bg-gray-100 rounded text-xs">
                          {task.organization}
                        </span>
                      )}
                      {task.team && (
                        <span className="px-2 py-1 bg-gray-100 rounded text-xs">
                          {task.team}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
                    className="ml-4 p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    {expandedTask === task.id ? (
                      <ChevronUp className="w-5 h-5 text-gray-600" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-gray-600" />
                    )}
                  </button>
                </div>
              </div>

              {/* Expanded Details */}
              {expandedTask === task.id && (
                <div className="border-t p-4 bg-gray-50">
                  {task.notes && (
                    <div className="mb-4">
                      <h4 className="font-semibold text-gray-900 mb-2">Notes:</h4>
                      <p className="text-gray-700 whitespace-pre-wrap">{task.notes}</p>
                    </div>
                  )}

                  {task.approvals && task.approvals.length > 0 && (
                    <div className="mb-4">
                      <h4 className="font-semibold text-gray-900 mb-2">Approvals:</h4>
                      <div className="space-y-2">
                        {task.approvals.map((approval, index) => (
                          <div key={approval.id} className="flex items-center gap-2 text-sm">
                            <span className="font-medium">{index + 1}.</span>
                            <span>{approval.role}</span>
                            <span className={`px-2 py-1 rounded text-xs ${
                              approval.status === 'approved' ? 'bg-green-100 text-green-800' :
                              approval.status === 'rejected' ? 'bg-red-100 text-red-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {approval.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => navigate(`/drafter/${task.document}`)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Open Document
                    </button>
                    
                    <select
                      value={task.current_status}
                      onChange={(e) => handleStatusChange(task.id, e.target.value)}
                      className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="draft">Draft</option>
                      <option value="review">Review</option>
                      <option value="approved">Approved</option>
                      <option value="revision_required">Revision Required</option>
                      <option value="executed">Executed</option>
                    </select>

                    <button
                      onClick={() => handleCompleteTask(task.id)}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Complete Task
                    </button>

                    <button
                      onClick={() => navigate(`/drafter/${task.document}`)}
                      className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      View Details
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MyTasks;
