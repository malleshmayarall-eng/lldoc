import React, { useState } from 'react';
import { Image as ImageIcon, Upload, Library } from 'lucide-react';
import ImageLibraryBrowser from './ImageLibraryBrowser';
import './AddImageButton.css';

/**
 * AddImageButton - Button to add images from library to document
 * Shows dropdown menu with options to browse library or upload new
 */
const AddImageButton = ({ 
  sectionId, 
  order = 0,
  onImageSelected,
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

  const handleImageSelected = (image) => {
    setShowLibrary(false);
    setShowUpload(false);
    
    if (onImageSelected) {
      onImageSelected(image, sectionId, order);
    }
  };

  if (compact) {
    return (
      <>
        <button
          className="add-image-button compact"
          onClick={() => setShowLibrary(true)}
          title="Add image"
        >
          <ImageIcon size={18} />
        </button>

        {showLibrary && (
          <div className="image-library-modal">
            <ImageLibraryBrowser
              onSelectImage={handleImageSelected}
              onClose={() => setShowLibrary(false)}
            />
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="add-image-container">
        <button
          className="add-image-button"
          onClick={() => setShowMenu(!showMenu)}
        >
          <ImageIcon size={20} />
          <span>Add Image</span>
        </button>

        {showMenu && (
          <div className="add-image-menu">
            <button onClick={handleBrowseLibrary} className="menu-item">
              <Library size={18} />
              <div className="menu-item-content">
                <span className="menu-item-title">Browse Library</span>
                <span className="menu-item-desc">Choose from uploaded images</span>
              </div>
            </button>
            <button onClick={handleUploadNew} className="menu-item">
              <Upload size={18} />
              <div className="menu-item-content">
                <span className="menu-item-title">Upload New</span>
                <span className="menu-item-desc">Upload a new image file</span>
              </div>
            </button>
          </div>
        )}
      </div>

      {showLibrary && (
        <div className="image-library-modal">
          <ImageLibraryBrowser
            onSelectImage={handleImageSelected}
            onClose={() => setShowLibrary(false)}
            showUpload={true}
          />
        </div>
      )}

      {/* Click outside to close menu */}
      {showMenu && (
        <div 
          className="add-image-backdrop"
          onClick={() => setShowMenu(false)}
        />
      )}
    </>
  );
};

export default AddImageButton;
