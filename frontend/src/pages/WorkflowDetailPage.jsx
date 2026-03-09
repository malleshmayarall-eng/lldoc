import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  FileText,
  User,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Clock,
  Users,
} from 'lucide-react';
import useWorkflowStore from '../store/workflowStore';
import WorkflowComments from '../components/WorkflowComments';
import { useAuth } from '../contexts/AuthContext';

const WorkflowDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    workflows,
    loading,
    error,
    fetchWorkflows,
    updateWorkflowStatus,
    completeWorkflow,
    reassignWorkflow,
    clearError
  } = useWorkflowStore();

  const [workflow, setWorkflow] = useState(null);
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [reassignData, setReassignData] = useState({ assigned_to: '', message: '' });

  useEffect(() => {
    loadWorkflow();
  }, [id]);

  const loadWorkflow = async () => {
    const result = await fetchWorkflows();
    const found = (Array.isArray(result) ? result : result.results || []).find(w => w.id === id);
    setWorkflow(found);
  };

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

  const handleStatusChange = async (newStatus) => {
    try {
      await updateWorkflowStatus(id, newStatus);
      loadWorkflow();
    } catch (err) {
      console.error('Error updating status:', err);
    }
  };

  const handleComplete = async () => {
    if (confirm('Mark this workflow as complete?')) {
      try {
        await completeWorkflow(id);
        navigate('/tasks');
      } catch (err) {
        console.error('Error completing workflow:', err);
      }
    }
  };

  const handleReassign = async () => {
    try {
      await reassignWorkflow(id, parseInt(reassignData.assigned_to), reassignData.message);
      setShowReassignModal(false);
      setReassignData({ assigned_to: '', message: '' });
      loadWorkflow();
    } catch (err) {
      console.error('Error reassigning workflow:', err);
    }
  };

  // Mock users - in production, fetch from API
  const users = [
    { id: 1, username: 'john.doe', name: 'John Doe' },
    { id: 2, username: 'jane.smith', name: 'Jane Smith' },
    { id: 3, username: 'bob.wilson', name: 'Bob Wilson' },
  ];

  if (loading.workflows || !workflow) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-6">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </button>
          <h1 className="text-3xl font-bold text-gray-900">Workflow Details</h1>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative">
            <span className="block sm:inline">{error}</span>
            <button onClick={clearError} className="absolute top-0 bottom-0 right-0 px-4 py-3">
              <span className="text-2xl">&times;</span>
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Workflow Info Card */}
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <div className="flex items-start justify-between mb-6">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <FileText className="w-6 h-6 text-gray-600" />
                    <h2 className="text-2xl font-bold text-gray-900">
                      {workflow.document_title || 'Untitled Document'}
                    </h2>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${getPriorityColor(workflow.priority)}`}>
                      {workflow.priority} priority
                    </span>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(workflow.current_status)}`}>
                      {workflow.current_status.replace(/_/g, ' ')}
                    </span>
                    {workflow.is_completed && (
                      <span className="px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                        Completed
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Message */}
              {workflow.message && (
                <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <h3 className="font-semibold text-gray-900 mb-2">Instructions:</h3>
                  <p className="text-gray-700 whitespace-pre-wrap">{workflow.message}</p>
                </div>
              )}

              {/* Notes */}
              {workflow.notes && (
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 mb-2">Notes:</h3>
                  <p className="text-gray-700 whitespace-pre-wrap">{workflow.notes}</p>
                </div>
              )}

              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <div className="flex items-center gap-2 text-gray-600 mb-1">
                    <User className="w-4 h-4" />
                    <span className="text-sm">Assigned To</span>
                  </div>
                  <p className="font-semibold text-gray-900">
                    {workflow.assigned_to_info?.username || 'Unknown'}
                  </p>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-gray-600 mb-1">
                    <User className="w-4 h-4" />
                    <span className="text-sm">Assigned By</span>
                  </div>
                  <p className="font-semibold text-gray-900">
                    {workflow.assigned_by_info?.username || 'Unknown'}
                  </p>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-gray-600 mb-1">
                    <Calendar className="w-4 h-4" />
                    <span className="text-sm">Due Date</span>
                  </div>
                  <p className="font-semibold text-gray-900">
                    {workflow.due_date ? new Date(workflow.due_date).toLocaleString() : 'No deadline'}
                  </p>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-gray-600 mb-1">
                    <Clock className="w-4 h-4" />
                    <span className="text-sm">Created</span>
                  </div>
                  <p className="font-semibold text-gray-900">
                    {new Date(workflow.created_at).toLocaleDateString()}
                  </p>
                </div>
                {workflow.organization && (
                  <div>
                    <div className="flex items-center gap-2 text-gray-600 mb-1">
                      <Users className="w-4 h-4" />
                      <span className="text-sm">Organization</span>
                    </div>
                    <p className="font-semibold text-gray-900">{workflow.organization}</p>
                  </div>
                )}
                {workflow.team && (
                  <div>
                    <div className="flex items-center gap-2 text-gray-600 mb-1">
                      <Users className="w-4 h-4" />
                      <span className="text-sm">Team</span>
                    </div>
                    <p className="font-semibold text-gray-900">{workflow.team}</p>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-3 pt-4 border-t">
                <button
                  onClick={() => navigate(`/drafter/${workflow.document}`)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Open Document
                </button>
                
                <select
                  value={workflow.current_status}
                  onChange={(e) => handleStatusChange(e.target.value)}
                  className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="draft">Draft</option>
                  <option value="review">Review</option>
                  <option value="approved">Approved</option>
                  <option value="revision_required">Revision Required</option>
                  <option value="executed">Executed</option>
                  <option value="archived">Archived</option>
                  <option value="cancelled">Cancelled</option>
                </select>

                {workflow.assigned_to === user?.id && !workflow.is_completed && (
                  <>
                    <button
                      onClick={() => setShowReassignModal(true)}
                      className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      Reassign
                    </button>
                    <button
                      onClick={handleComplete}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Complete
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Comments */}
            <WorkflowComments workflowId={id} />
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Approval Chain */}
            {workflow.approvals && workflow.approvals.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Approval Chain</h3>
                <div className="space-y-3">
                  {workflow.approvals.map((approval) => (
                    <div key={approval.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center font-semibold text-blue-600">
                        {approval.order}
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-gray-900">{approval.role}</p>
                        <p className="text-sm text-gray-600">{approval.approver_info?.username || 'Unknown'}</p>
                        <div className="mt-2">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            approval.status === 'approved' ? 'bg-green-100 text-green-800' :
                            approval.status === 'rejected' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {approval.status}
                          </span>
                          {approval.is_required && (
                            <span className="ml-2 px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-medium">
                              Required
                            </span>
                          )}
                        </div>
                        {approval.comments && (
                          <p className="mt-2 text-sm text-gray-700 italic">"{approval.comments}"</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Activity Timeline */}
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Activity</h3>
              <div className="space-y-4">
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-2 h-2 rounded-full bg-green-500 mt-2"></div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Workflow created</p>
                    <p className="text-xs text-gray-500">{new Date(workflow.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-2 h-2 rounded-full bg-blue-500 mt-2"></div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Last updated</p>
                    <p className="text-xs text-gray-500">{new Date(workflow.updated_at).toLocaleString()}</p>
                  </div>
                </div>
                {workflow.completed_at && (
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-2 h-2 rounded-full bg-gray-500 mt-2"></div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">Completed</p>
                      <p className="text-xs text-gray-500">{new Date(workflow.completed_at).toLocaleString()}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Reassign Modal */}
        {showReassignModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Reassign Workflow</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Assign To <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={reassignData.assigned_to}
                    onChange={(e) => setReassignData({ ...reassignData, assigned_to: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select user...</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Message <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={reassignData.message}
                    onChange={(e) => setReassignData({ ...reassignData, message: e.target.value })}
                    rows={3}
                    placeholder="Reason for reassignment..."
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setShowReassignModal(false)}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleReassign}
                    disabled={!reassignData.assigned_to || !reassignData.message}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Reassign
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkflowDetailPage;
