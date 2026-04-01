import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import ProtectedRoute from './components/ProtectedRoute';
import FeatureRoute from './components/FeatureRoute';
import DashboardLayout from './components/DashboardLayout';
import TextSearchDialog from './components/TextSearchDialog';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import DomainDashboard from './pages/DomainDashboard';
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
import ProcurementDashboardFull from './pages/ProcurementDashboardFull';
import SheetsApp from './pages/SheetsApp';
import AttachmentsPage from './pages/AttachmentsPage';
import PublicSheetForm from './components/sheets/PublicSheetForm';
import { documentService } from './services/documentService';
import { getDocumentEditorRoute } from './utils/documentRouting';

function DocumentEditorRoute({ onDocumentLoad }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let isActive = true;

    const resolveDocumentMode = async () => {
      try {
        const document = await documentService.getDocument(id);
        if (!isActive) {
          return;
        }

        const destination = getDocumentEditorRoute(document, { fallback: `/drafter/${id}` });
        if (destination !== `/drafter/${id}`) {
          navigate(destination, { replace: true });
          return;
        }
      } catch {
        // Fall through to the standard editor so existing error handling remains intact.
      }

      if (isActive) {
        setIsReady(true);
      }
    };

    setIsReady(false);
    resolveDocumentMode();

    return () => {
      isActive = false;
    };
  }, [id, navigate]);

  if (!isReady) {
    return <div className="flex h-full min-h-[50vh] items-center justify-center text-sm text-gray-500">Opening document…</div>;
  }

  return <DocumentDrafter onDocumentLoad={onDocumentLoad} />;
}

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
            <Route path="/sheets/form/:token" element={<PublicSheetForm />} />

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
              <Route path="dashboard" element={<DomainDashboard />} />
              <Route path="documents" element={<Documents />} />
              <Route path="dms" element={
                <FeatureRoute category="apps" feature="dms">
                  <DmsApp />
                </FeatureRoute>
              } />
              <Route path="dms/documents/:id" element={
                <FeatureRoute category="apps" feature="dms">
                  <DmsDocumentDetails />
                </FeatureRoute>
              } />
              <Route path="fileshare" element={
                <FeatureRoute category="apps" feature="fileshare">
                  <FileShareApp />
                </FeatureRoute>
              } />
              <Route path="clm/*" element={
                <FeatureRoute category="apps" feature="clm">
                  <ClmApp />
                </FeatureRoute>
              } />
              <Route path="drafter/:id" element={<DocumentEditorRoute onDocumentLoad={setCurrentDocumentId} />} />
              <Route path="profile" element={<Profile />} />
              <Route path="settings" element={<Settings />} />
              <Route path="tasks" element={
                <FeatureRoute category="apps" feature="workflow">
                  <MyTasks />
                </FeatureRoute>
              } />
              <Route path="masters" element={
                <FeatureRoute category="apps" feature="master_documents">
                  <MasterDocumentsPage />
                </FeatureRoute>
              } />
              <Route path="quick-latex" element={
                <FeatureRoute category="apps" feature="quick_latex">
                  <QuickLatexPage />
                </FeatureRoute>
              } />
              <Route path="procurement-dashboard" element={
                <FeatureRoute category="apps" feature="quick_latex">
                  <ProcurementDashboardFull />
                </FeatureRoute>
              } />
              <Route path="approvals" element={
                <FeatureRoute category="apps" feature="workflow">
                  <ApprovalPanel />
                </FeatureRoute>
              } />
              <Route path="attachments" element={<AttachmentsPage />} />
              <Route path="sheets/*" element={<SheetsApp />} />
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

