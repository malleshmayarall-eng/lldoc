import React from 'react';
import { AlertCircle, Eye } from 'lucide-react';

const AccessBanners = ({ isViewer, isCommenter, completeDocument }) => {
  return (
    <>
      {isViewer && (
        <div className="fixed top-16 left-0 right-0 z-40 bg-yellow-50 border-b border-yellow-200 px-6 py-3">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Eye className="text-yellow-600" size={20} />
              <div>
                <span className="text-sm font-semibold text-yellow-900">
                  View-Only Access
                </span>
                <p className="text-xs text-yellow-700 mt-0.5">
                  You can view this document but cannot make changes. Shared by{' '}
                  <span className="font-medium">
                    {completeDocument?.share_info?.shared_by_name
                      || completeDocument?.share_info?.shared_by
                      || completeDocument?.author
                      || 'owner'}
                  </span>.
                </p>
              </div>
            </div>
            <span className="text-xs bg-yellow-200 text-yellow-800 px-3 py-1 rounded-full font-medium">
              Viewer
            </span>
          </div>
        </div>
      )}

      {isCommenter && (
        <div className="fixed top-16 left-0 right-0 z-40 bg-blue-50 border-b border-blue-200 px-6 py-3">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="text-blue-600" size={20} />
              <div>
                <span className="text-sm font-semibold text-blue-900">
                  Comment Access
                </span>
                <p className="text-xs text-blue-700 mt-0.5">
                  You can view and comment but cannot edit content. Shared by{' '}
                  <span className="font-medium">
                    {completeDocument?.share_info?.shared_by_name
                      || completeDocument?.share_info?.shared_by
                      || completeDocument?.author
                      || 'owner'}
                  </span>.
                </p>
              </div>
            </div>
            <span className="text-xs bg-blue-200 text-blue-800 px-3 py-1 rounded-full font-medium">
              Commenter
            </span>
          </div>
        </div>
      )}
    </>
  );
};

export default AccessBanners;
