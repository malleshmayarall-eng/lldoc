import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Clock, User, MessageSquare } from 'lucide-react';
import useWorkflowStore from '../store/workflowStore';

const ApprovalPanel = () => {
  const navigate = useNavigate();
  const {
    myApprovals,
    loading,
    error,
    fetchMyApprovals,
    approveApproval,
    rejectApproval,
    clearError
  } = useWorkflowStore();

  const [selectedApproval, setSelectedApproval] = useState(null);
  const [comments, setComments] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchMyApprovals();
  }, [fetchMyApprovals]);

  const handleApprove = async (approvalId) => {
    setIsSubmitting(true);
    try {
      await approveApproval(approvalId, comments);
      setSelectedApproval(null);
      setComments('');
    } catch (err) {
      console.error('Error approving:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async (approvalId) => {
    if (!comments.trim()) {
      alert('Please provide comments when rejecting');
      return;
    }
    
    setIsSubmitting(true);
    try {
      await rejectApproval(approvalId, comments);
      setSelectedApproval(null);
      setComments('');
    } catch (err) {
      console.error('Error rejecting:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading.approvals) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">My Approvals</h1>
        <p className="text-gray-600">
          {myApprovals.length} pending {myApprovals.length === 1 ? 'approval' : 'approvals'}
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

      {/* Approvals List */}
      {myApprovals.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
          <CheckCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">No pending approvals</h3>
          <p className="text-gray-600">You're all caught up!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {myApprovals.map((approval) => (
            <div
              key={approval.id}
              className="bg-white rounded-lg shadow-sm border hover:shadow-md transition-shadow"
            >
              <div className="p-6">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                      {approval.workflow?.document_title || 'Untitled Document'}
                    </h3>
                    <p className="text-sm text-gray-600">Role: {approval.role}</p>
                  </div>
                  <span className="px-3 py-1 bg-blue-100 text-blue-800 text-sm font-medium rounded-full">
                    Order: {approval.order}
                  </span>
                </div>

                {/* Workflow Info */}
                {approval.workflow && (
                  <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-gray-600">Status:</span>
                        <span className="ml-2 font-medium">
                          {approval.workflow.current_status?.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">Priority:</span>
                        <span className={`ml-2 font-medium ${
                          approval.workflow.priority === 'urgent' ? 'text-red-600' :
                          approval.workflow.priority === 'high' ? 'text-orange-600' :
                          approval.workflow.priority === 'medium' ? 'text-yellow-600' :
                          'text-blue-600'
                        }`}>
                          {approval.workflow.priority}
                        </span>
                      </div>
                      {approval.workflow.assigned_to_info && (
                        <div className="col-span-2">
                          <span className="text-gray-600">Assignee:</span>
                          <span className="ml-2 font-medium">
                            {approval.workflow.assigned_to_info.username}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Required Badge */}
                {approval.is_required && (
                  <div className="mb-4">
                    <span className="px-2 py-1 bg-red-100 text-red-800 text-xs font-medium rounded">
                      Required Approval
                    </span>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3">
                  <button
                    onClick={() => navigate(`/drafter/${approval.workflow?.document}`)}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    View Details
                  </button>
                  <button
                    onClick={() => setSelectedApproval(approval)}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Review
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Approval Modal */}
      {selectedApproval && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-white border-b px-6 py-4">
              <h2 className="text-2xl font-bold text-gray-900">Review Approval</h2>
              <p className="text-gray-600 mt-1">
                {selectedApproval.workflow?.document_title || 'Untitled Document'}
              </p>
            </div>

            <div className="p-6">
              {/* Approval Info */}
              <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Your Role:</span>
                    <p className="font-semibold text-gray-900 mt-1">{selectedApproval.role}</p>
                  </div>
                  <div>
                    <span className="text-gray-600">Order in Chain:</span>
                    <p className="font-semibold text-gray-900 mt-1">#{selectedApproval.order}</p>
                  </div>
                  <div>
                    <span className="text-gray-600">Required:</span>
                    <p className="font-semibold text-gray-900 mt-1">
                      {selectedApproval.is_required ? 'Yes' : 'Optional'}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-600">Priority:</span>
                    <p className={`font-semibold mt-1 ${
                      selectedApproval.workflow?.priority === 'urgent' ? 'text-red-600' :
                      selectedApproval.workflow?.priority === 'high' ? 'text-orange-600' :
                      'text-blue-600'
                    }`}>
                      {selectedApproval.workflow?.priority}
                    </p>
                  </div>
                </div>
              </div>

              {/* Workflow Message */}
              {selectedApproval.workflow?.message && (
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 mb-2">Instructions:</h3>
                  <p className="text-gray-700 whitespace-pre-wrap">
                    {selectedApproval.workflow.message}
                  </p>
                </div>
              )}

              {/* Comments */}
              <div className="mb-6">
                <label className="block font-semibold text-gray-900 mb-2">
                  Comments {selectedApproval.is_required && <span className="text-red-500">*</span>}
                </label>
                <textarea
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  rows={4}
                  placeholder="Add your review comments..."
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Comments are required when rejecting
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setSelectedApproval(null);
                    setComments('');
                  }}
                  className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleReject(selectedApproval.id)}
                  disabled={isSubmitting || !comments.trim()}
                  className="flex-1 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <XCircle className="w-5 h-5" />
                  {isSubmitting ? 'Rejecting...' : 'Reject'}
                </button>
                <button
                  onClick={() => handleApprove(selectedApproval.id)}
                  disabled={isSubmitting}
                  className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <CheckCircle className="w-5 h-5" />
                  {isSubmitting ? 'Approving...' : 'Approve'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ApprovalPanel;
