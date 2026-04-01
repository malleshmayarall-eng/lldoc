import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import WorkflowList from '@components/clm/WorkflowList';
import WorkflowCanvas from '@components/clm/WorkflowCanvas';
import ValidationDashboard from '@components/clm/ValidationDashboard';
import DocumentViewer from '@components/clm/DocumentViewer';
import PublicUpload from '@components/clm/PublicUpload';
import SystemDebugPage from './SystemDebugPage';

/**
 * ClmApp — CLM (Contract Lifecycle Management) page wrapper.
 * Renders inside the DashboardLayout and provides its own sub-routing.
 */
export default function ClmApp() {
  return (
    <div className="min-h-full bg-gray-50">
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            fontSize: '13px',
            borderRadius: '10px',
            padding: '10px 16px',
          },
          success: {
            iconTheme: { primary: '#10b981', secondary: '#fff' },
          },
          error: {
            iconTheme: { primary: '#ef4444', secondary: '#fff' },
            duration: 5000,
          },
        }}
      />
      <Routes>
        <Route path="upload/:token" element={<PublicUpload />} />
        <Route path="debug" element={<SystemDebugPage />} />
        <Route path="workflows" element={<WorkflowList />} />
        <Route path="workflows/:id" element={<WorkflowCanvas />} />
        <Route path="documents/:workflowId/:documentId" element={<DocumentViewer />} />
        <Route path="validation" element={<ValidationDashboard />} />
        <Route path="validation/:workflowId" element={<ValidationDashboard />} />
        <Route index element={<Navigate to="workflows" replace />} />
        <Route path="*" element={<Navigate to="workflows" replace />} />
      </Routes>
    </div>
  );
}
