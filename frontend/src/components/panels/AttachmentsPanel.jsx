import { Paperclip } from 'lucide-react';
import SidePanel from './SidePanel';
import FileAttachmentManager from '../FileAttachmentManager';

/**
 * Attachments Panel
 * Manage file attachments (exhibits, schedules, appendices)
 */
const AttachmentsPanel = ({ isOpen, onClose, documentId, initialData = {} }) => {
  return (
    <SidePanel
      isOpen={isOpen}
      onClose={onClose}
      title="File Attachments"
      icon={Paperclip}
      width="lg"
    >
      <div className="p-6">
        <FileAttachmentManager
          documentId={documentId}
          existingAttachments={initialData.attachments || []}
        />
      </div>
    </SidePanel>
  );
};

export default AttachmentsPanel;
