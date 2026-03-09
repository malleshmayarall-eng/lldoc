import React from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

import WorkflowList from './components/WorkflowList';
import WorkflowCanvas from './components/WorkflowCanvas';
import ValidationDashboard from './components/ValidationDashboard';
import DocumentViewer from './components/DocumentViewer';
import PublicUpload from './components/PublicUpload';

function Navbar() {
  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-50">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <NavLink to="/workflows" className="flex items-center gap-2 font-bold text-lg text-indigo-600 hover:text-indigo-700 transition-colors">
            <span className="text-2xl">📑</span>
            <span>CLM Workflows</span>
          </NavLink>
          <div className="flex items-center gap-4">
            <NavLink
              to="/workflows"
              end
              className={({ isActive }) =>
                `text-sm font-medium transition-colors ${isActive ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`
              }
            >
              All Workflows
            </NavLink>
            <NavLink
              to="/validation"
              className={({ isActive }) =>
                `text-sm font-medium transition-colors flex items-center gap-1 ${isActive ? 'text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`
              }
            >
              ✅ Validations
            </NavLink>
          </div>
        </div>
      </div>
    </nav>
  );
}

export default function App() {
  const location = useLocation();
  const isPublicUpload = location.pathname.startsWith('/upload/');

  return (
    <div className="min-h-screen bg-gray-50">
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
      {!isPublicUpload && <Navbar />}
      <main>
        <Routes>
          <Route path="/upload/:token" element={<PublicUpload />} />
          <Route path="/workflows" element={<WorkflowList />} />
          <Route path="/workflows/:id" element={<WorkflowCanvas />} />
          <Route path="/documents/:workflowId/:documentId" element={<DocumentViewer />} />
          <Route path="/validation" element={<ValidationDashboard />} />
          <Route path="/validation/:workflowId" element={<ValidationDashboard />} />
          <Route path="*" element={<Navigate to="/workflows" replace />} />
        </Routes>
      </main>
    </div>
  );
}
