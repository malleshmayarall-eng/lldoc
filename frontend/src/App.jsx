import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import ProtectedRoute from './components/ProtectedRoute';
import DashboardLayout from './components/DashboardLayout';
import TextSearchDialog from './components/TextSearchDialog';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Documents from './pages/Documents';
import DocumentDrafter from './pages/DocumentDrafterNew';
import DmsApp from './pages/dms/DmsApp';
import DmsDocumentDetails from './pages/dms/DmsDocumentDetails';
import FileShareApp from './pages/fileshare/FileShareApp';
import ClmApp from './pages/clm/ClmApp';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import SharedContentPage from './pages/SharedContentPage';
import DocumentViewerPage from './pages/DocumentViewerPage';
import CommentatorViewerPage from './pages/CommentatorViewerPage';
import MyTasks from './components/MyTasks';
import ApprovalPanel from './components/ApprovalPanel';
import OrgAdmin from './pages/OrgAdmin';
import MasterDocumentsPage from './pages/MasterDocumentsPage';
import QuickLatexPage from './pages/QuickLatexPage';

function App() {
  const [showTextSearch, setShowTextSearch] = useState(false);
  const [currentDocumentId, setCurrentDocumentId] = useState(null);
  const [dialogPosition, setDialogPosition] = useState({ x: 0, y: 0 });

  // Global keyboard shortcut: Ctrl+Shift+F or Cmd+Shift+F
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        setShowTextSearch(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleInsertText = (text) => {
    // Dispatch custom event with the text to insert
    const event = new CustomEvent('insertTextFromSearch', { detail: { text } });
    window.dispatchEvent(event);
  };

  return (
      <Router>
          <Routes>
            {/* Public Routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/shared/:token" element={<DocumentViewerPage />} />
            <Route path="/view/:token" element={<DocumentViewerPage />} />
            <Route path="/comment/:token" element={<CommentatorViewerPage />} />

            {/* Protected Routes */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <DashboardLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="documents" element={<Documents />} />
              <Route path="dms" element={<DmsApp />} />
              <Route path="dms/documents/:id" element={<DmsDocumentDetails />} />
              <Route path="fileshare" element={<FileShareApp />} />
              <Route path="clm/*" element={<ClmApp />} />
              <Route path="drafter/:id" element={<DocumentDrafter onDocumentLoad={setCurrentDocumentId} />} />
              <Route path="profile" element={<Profile />} />
              <Route path="settings" element={<Settings />} />
              <Route path="tasks" element={<MyTasks />} />
              <Route path="masters" element={<MasterDocumentsPage />} />
              <Route path="quick-latex" element={<QuickLatexPage />} />
              <Route path="approvals" element={<ApprovalPanel />} />
              <Route path="admin" element={<OrgAdmin />} />
            </Route>

            {/* Catch all - redirect to dashboard */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>

          {/* Global Text Search Dialog */}
          <TextSearchDialog
            isOpen={showTextSearch}
            onClose={() => setShowTextSearch(false)}
            onInsertText={handleInsertText}
            documentId={currentDocumentId}
            position={dialogPosition}
            onPositionChange={setDialogPosition}
          />
        </Router>
    );
  }
  
  export default App;

