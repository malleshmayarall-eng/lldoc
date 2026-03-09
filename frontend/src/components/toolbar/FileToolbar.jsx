import { 
  Save, Undo, Redo, Eye, FileText, Download, Share2,
  Printer, Settings, Clock, Users, DollarSign
} from 'lucide-react';
import ToolbarButton from './ToolbarButton';
import ToolbarSeparator from './ToolbarSeparator';

/**
 * Main Document Toolbar - File Operations
 * Similar to Microsoft Word's main toolbar
 */
const FileToolbar = ({ 
  onSave, 
  onUndo, 
  onRedo,
  onPreview,
  onPrint,
  onExport,
  onShare,
  onShowVersions,
  canUndo = false,
  canRedo = false,
  isSaving = false,
  documentTitle = 'Untitled Document'
}) => {
  return (
    <div className="bg-white border-b border-gray-300 px-4 py-2">
      <div className="flex items-center justify-between">
        {/* Left: Document Title */}
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-gray-900 truncate">
            {documentTitle}
          </h1>
        </div>

        {/* Right: Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Undo/Redo */}
          <ToolbarButton
            icon={Undo}
            tooltip="Undo (Ctrl+Z)"
            onClick={onUndo}
            disabled={!canUndo}
          />
          <ToolbarButton
            icon={Redo}
            tooltip="Redo (Ctrl+Y)"
            onClick={onRedo}
            disabled={!canRedo}
          />
          
          <ToolbarSeparator />

          {/* View Options */}
          <ToolbarButton
            icon={Eye}
            label="Preview"
            tooltip="Preview document"
            onClick={onPreview}
          />
          
          <ToolbarSeparator />

          {/* Document Actions */}
          <ToolbarButton
            icon={Clock}
            tooltip="Version history"
            onClick={onShowVersions}
          />
          <ToolbarButton
            icon={Printer}
            tooltip="Print"
            onClick={onPrint}
          />
          <ToolbarButton
            icon={Download}
            tooltip="Export"
            onClick={onExport}
          />
          <ToolbarButton
            icon={Share2}
            tooltip="Share"
            onClick={onShare}
          />
          
          <ToolbarSeparator />

          {/* Save */}
          <ToolbarButton
            icon={Save}
            label={isSaving ? "Saving..." : "Save"}
            tooltip="Save document (Ctrl+S)"
            onClick={onSave}
            variant="primary"
            disabled={isSaving}
          />
        </div>
      </div>
    </div>
  );
};

export default FileToolbar;
