import React, { useState } from 'react';
import { FileText, Upload, Library } from 'lucide-react';
import DocumentLibraryBrowser from './DocumentLibraryBrowser';
import './AddDocumentButton.css';

/**
 * AddDocumentButton - Button to add document files from library to document
 * Shows dropdown menu with options to browse library or upload new
 * Similar to AddImageButton but for embedded documents
 */
const AddDocumentButton = ({ 
  sectionId, 
  order = 0,
  onDocumentSelected,
  compact = false 
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const handleBrowseLibrary = () => {
    setShowMenu(false);
    setShowLibrary(true);
  };

  const handleUploadNew = () => {
    setShowMenu(false);
    setShowUpload(true);
  };

  const handleDocumentSelected = (document) => {
    setShowLibrary(false);
    setShowUpload(false);
    
    if (onDocumentSelected) {
      onDocumentSelected(document, sectionId, order);
    }
  };

  if (compact) {
    return (
      <>
        <button
          className="add-document-button compact"
          onClick={() => setShowLibrary(true)}
          title="Add document"
        >
          <FileText size={18} />
        </button>

        {showLibrary && (
          <div className="document-library-modal">
            <DocumentLibraryBrowser
              onSelectDocument={handleDocumentSelected}
              onClose={() => setShowLibrary(false)}
            />
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="add-document-container">
        <button
          className="add-document-button"
          onClick={() => setShowMenu(!showMenu)}
        >
          <FileText size={20} />
          <span>Add Document</span>
        </button>

        {showMenu && (
          <div className="add-document-menu">
            <button onClick={handleBrowseLibrary} className="menu-item">
              <Library size={18} />
              <div className="menu-item-content">
                <span className="menu-item-title">Browse Library</span>
                <span className="menu-item-desc">Choose from uploaded files</span>
              </div>
            </button>
            <button onClick={handleUploadNew} className="menu-item">
              <Upload size={18} />
              <div className="menu-item-content">
                <span className="menu-item-title">Upload New</span>
                <span className="menu-item-desc">Upload a new document file</span>
              </div>
            </button>
          </div>
        )}
      </div>

      {showLibrary && (
        <div className="document-library-modal">
          <DocumentLibraryBrowser
            onSelectDocument={handleDocumentSelected}
            onClose={() => setShowLibrary(false)}
            showUpload={true}
          />
        </div>
      )}
    </>
  );
};

export default AddDocumentButton;
