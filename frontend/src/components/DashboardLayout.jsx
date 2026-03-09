import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import CreateDocumentDialog from './CreateDocumentDialog';
import AIDocumentWizard from './AIDocumentWizard';

const DashboardLayout = () => {
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
      <CreateDocumentDialog />
      <AIDocumentWizard />
    </div>
  );
};

export default DashboardLayout;
