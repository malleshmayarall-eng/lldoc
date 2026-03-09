import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Save, Plus, Trash2, ArrowLeft, FileText, ChevronDown, ChevronRight, 
  CheckCircle, AlertCircle, Eye, Edit3, Book, Settings, X, Layers, FileBox, Image as ImageIcon, Info, Upload
} from 'lucide-react';
import api from '../services/api';
import { documentService } from '../services/documentService';
import inlineImageService from '../services/inlineImageService';
import { TextInput, NumberInput, SelectInput, Toggle, TextArea, StringListEditor, ObjectListEditor } from '../components/FieldEditors';
import ImagesPanel from '../components/panels/ImagesPanel';
import ImagesGallery from '../components/ImagesGallery';
import ParagraphDropZone from '../components/ParagraphDropZone';
import InlineImage from '../components/InlineImage';
import InlineImageSettings from '../components/InlineImageSettings';
import DraggableImageItem from '../components/DraggableImageItem';
import ImageResizeToolbar from '../components/ImageResizeToolbar';
import ParagraphRenderer from '../components/ParagraphRenderer';
import ParagraphEditor from '../components/ParagraphEditor';
import SectionHeader from '../components/SectionHeader';
import DocumentSection from '../components/DocumentSection';

const DocumentDrafter = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  
  const [document, setDocument] = useState(null);
  const [sections, setSections] = useState([]);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [expandedSections, setExpandedSections] = useState(new Set());
  const [lastSaved, setLastSaved] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [viewMode, setViewMode] = useState('edit'); // 'edit' or 'preview'
  const [showPropertiesPanel, setShowPropertiesPanel] = useState(false);
  const [activePropertyTab, setActivePropertyTab] = useState('properties');
  const [showMetadataModal, setShowMetadataModal] = useState(false);
  const [showImagesGallery, setShowImagesGallery] = useState(false);
  const [sidebarImages, setSidebarImages] = useState([]);
  const [sidebarTab, setSidebarTab] = useState('document'); // 'user', 'document', 'team'
  const [loadingSidebarImages, setLoadingSidebarImages] = useState(false);
  const [inlineImages, setInlineImages] = useState({}); // { paragraphId: [images] }
  const [selectedInlineImage, setSelectedInlineImage] = useState(null); // For showing resize toolbar

  // Full-edit fields state
  const [metadata, setMetadata] = useState({ author: '', version: '', document_type: '' });
  const [versionMgmt, setVersionMgmt] = useState({
    version_number: '', major_version: '', minor_version: '', patch_version: '',
    is_draft: false, version_label: '', version_notes: ''
  });
  const [parties, setParties] = useState([]);
  const [signatories, setSignatories] = useState([]);
  const [dates, setDates] = useState({ effective_date: '', expiration_date: '', execution_date: '' });
  const [legal, setLegal] = useState({ governing_law: '', reference_number: '', project_name: '', jurisdiction: '' });
  const [financial, setFinancial] = useState({ contract_value: '', currency: 'USD', payment_terms: { schedule: '', due_days: '', method: '', late_fee_percentage: '' } });
  const [termRenewal, setTermRenewal] = useState({ term_length: '', auto_renewal: false, renewal_terms: '', notice_period: '' });
  const [provisions, setProvisions] = useState({ liability_cap: '', indemnification_clauses: [], insurance_requirements: {}, termination_clauses: [], termination_for_convenience: false });
  const [compliance, setCompliance] = useState({ regulatory_requirements: [], compliance_certifications: [] });
  const [confidentiality, setConfidentiality] = useState({ confidentiality_period: '', nda_type: '' });
  const [dispute, setDispute] = useState({ dispute_resolution_method: '', arbitration_location: '' });
  const [classification, setClassification] = useState({ category: '', status: '' });
  const [filesInfo, setFilesInfo] = useState({ source_file_name: '', source_file_type: '', source_file_size: '', attachments: [] });
  const [scanInfo, setScanInfo] = useState({ is_scanned: false, ocr_confidence: '', page_count: '' });
  const [images, setImages] = useState({ logo_image_id: '', watermark_image_id: '', background_image_id: '', header_icon_id: '', footer_icon_id: '' });
  const [custom, setCustom] = useState({ custom_metadata: {}, related_documents: [] });
  const [changeSummary, setChangeSummary] = useState('');
  const [autoSaveFull, setAutoSaveFull] = useState(true);

  // Load document and sections
  const loadDocument = useCallback(async () => {
    if (!id || id === 'new') return;
    
    try {
      const doc = await documentService.getDocument(id);
      setDocument(doc);
      setTitle(doc.title || '');
      // Prefill known fields if present
      setMetadata((prev) => ({
        ...prev,
        author: doc.author || prev.author,
        version: doc.version || prev.version,
        document_type: doc.document_type || prev.document_type,
      }));
      setClassification((prev) => ({
        ...prev,
        category: doc.category || prev.category,
        status: doc.status || prev.status,
      }));
      
      // Load image IDs if present
      setImages((prev) => ({
        ...prev,
        logo_image_id: doc.logo_image_id || prev.logo_image_id,
        watermark_image_id: doc.watermark_image_id || prev.watermark_image_id,
        background_image_id: doc.background_image_id || prev.background_image_id,
        header_icon_id: doc.header_icon_id || prev.header_icon_id,
        footer_icon_id: doc.footer_icon_id || prev.footer_icon_id,
      }));
      
      const sectionsResponse = await api.get(`/documents/sections/?document=${id}`);
      const loadedSections = sectionsResponse.data || [];
      
      for (let section of loadedSections) {
        const paragraphsResponse = await api.get(`/documents/paragraphs/?section=${section.id}`);
        section.paragraphs = paragraphsResponse.data || [];
      }
      
      setSections(loadedSections);
      setExpandedSections(new Set(loadedSections.map(s => s.id)));
      setError(null);
    } catch (err) {
      console.error('Error loading document:', err);
      setError('Failed to load document');
      if (err.response?.status === 404) {
        navigate('/documents');
      }
    }
  }, [id, navigate]);

  useEffect(() => {
    loadDocument();
  }, [loadDocument]);

  // Auto-save
  useEffect(() => {
    if (!hasChanges || !id || id === 'new') return;
    
    const timer = setTimeout(() => {
      saveDocument(true);
    }, 3000); // Auto-save after 3 seconds of no changes
    
    return () => clearTimeout(timer);
  }, [title, sections, hasChanges, id]);

  // Optional auto-save for full metadata edits
  useEffect(() => {
    if (!autoSaveFull || !id || id === 'new') return;
    const timer = setTimeout(() => {
      saveFullMetadata(true);
    }, 4000);
    return () => clearTimeout(timer);
  }, [metadata, versionMgmt, parties, signatories, dates, legal, financial, termRenewal, provisions, compliance, confidentiality, dispute, classification, filesInfo, images, custom, changeSummary, autoSaveFull, id]);

  const saveDocument = async (silent = false) => {
    if (!silent) setSaving(true);
    setError(null);
    
    try {
      let docId = id;
      
      // Create or update document
      if (!docId || docId === 'new') {
        // Format sections for create-structured endpoint
        const formattedSections = sections.map(section => {
          const sectionData = {
            title: section.title || 'Untitled Section',
          };
          
          // If section has paragraphs, send them
          if (section.paragraphs && section.paragraphs.length > 0) {
            sectionData.paragraphs = section.paragraphs.map(p => p.content_text || '');
          } else if (section.content_text) {
            // Otherwise send as content
            sectionData.content = section.content_text;
          } else {
            // Default empty content
            sectionData.content = '';
          }
          
          return sectionData;
        });
        
        const newDoc = await documentService.createStructured({
          title: title || 'Untitled Document',
          sections: formattedSections.length > 0 ? formattedSections : [
            { title: 'Introduction', content: '' }
          ]
        });
        
        docId = newDoc.id;
        setDocument(newDoc);
        
        // Update sections state with the created document's sections
        if (newDoc.sections && newDoc.sections.length > 0) {
          setSections(newDoc.sections);
        }
        
        navigate(`/drafter/${docId}`, { replace: true });
      } else {
        await documentService.updateDocument(docId, { title });
      }
      
      // Save sections and paragraphs
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const sectionData = {
          id: section.id || `section_${Date.now()}_${i}`,
          document: docId,
          title: section.title || '',
          content_text: section.content_text || '',
          content_start: 0,
          content_end: (section.content_text || '').length,
          section_type: section.section_type || 'clause',
          order: i,
          depth_level: 0
        };
        
        try {
          await api.put(`/documents/sections/${sectionData.id}/`, sectionData);
        } catch (error) {
          if (error.response?.status === 404) {
            await api.post('/documents/sections/', sectionData);
          } else {
            throw error;
          }
        }
        
        // Update section ID if it was generated
        if (!section.id) {
          sections[i].id = sectionData.id;
        }
        
        // Save paragraphs
        if (section.paragraphs) {
          for (let j = 0; j < section.paragraphs.length; j++) {
            const paragraph = section.paragraphs[j];
            const paragraphData = {
              id: paragraph.id || `${sectionData.id}_p${Date.now()}_${j}`,
              section: sectionData.id,
              content_text: paragraph.content_text || '',
              content_start: 0,
              content_end: (paragraph.content_text || '').length,
              paragraph_type: paragraph.paragraph_type || 'standard',
              order: j
            };
            
            try {
              await api.put(`/documents/paragraphs/${paragraphData.id}/`, paragraphData);
            } catch (error) {
              if (error.response?.status === 404) {
                await api.post('/documents/paragraphs/', paragraphData);
              } else {
                throw error;
              }
            }
            
            // Update paragraph ID if it was generated
            if (!paragraph.id) {
              sections[i].paragraphs[j].id = paragraphData.id;
            }
          }
        }
      }
      
      setLastSaved(new Date());
      setHasChanges(false);
    } catch (err) {
      console.error('Error saving document:', err);
      
      // More specific error messages
      if (err.response?.status === 400) {
        const errorData = err.response.data;
        if (errorData.sections) {
          setError('Invalid section data. Please ensure each section has a title.');
        } else {
          setError(`Validation error: ${errorData.error || errorData.detail || 'Invalid data'}`);
        }
      } else if (err.response?.status === 401) {
        setError('You must be logged in to save documents.');
      } else if (err.response?.status === 403) {
        setError('You do not have permission to save this document.');
      } else {
        setError('Failed to save document. Please try again.');
      }
    } finally {
      if (!silent) setSaving(false);
    }
  };

  // Aggregate payload and call edit-full API
  const saveFullMetadata = async (silent = false) => {
    if (!id || id === 'new') return; // full-edit requires existing document
    try {
      const payload = {
        // Core
        title: title || undefined,
        author: metadata.author || undefined,
        version: metadata.version || undefined,
        document_type: metadata.document_type || undefined,
        // Version
        version_number: versionMgmt.version_number || undefined,
        major_version: versionMgmt.major_version || undefined,
        minor_version: versionMgmt.minor_version || undefined,
        patch_version: versionMgmt.patch_version || undefined,
        is_draft: !!versionMgmt.is_draft,
        version_label: versionMgmt.version_label || undefined,
        version_notes: versionMgmt.version_notes || undefined,
        // Parties
        parties: parties && parties.length ? parties : undefined,
        signatories: signatories && signatories.length ? signatories : undefined,
        // Dates
        effective_date: dates.effective_date || undefined,
        expiration_date: dates.expiration_date || undefined,
        execution_date: dates.execution_date || undefined,
        // Legal info
        governing_law: legal.governing_law || undefined,
        reference_number: legal.reference_number || undefined,
        project_name: legal.project_name || undefined,
        jurisdiction: legal.jurisdiction || undefined,
        // Financial
        contract_value: financial.contract_value || undefined,
        currency: financial.currency || undefined,
        payment_terms: financial.payment_terms,
        // Term/Renewal
        term_length: termRenewal.term_length || undefined,
        auto_renewal: !!termRenewal.auto_renewal,
        renewal_terms: termRenewal.renewal_terms || undefined,
        notice_period: termRenewal.notice_period || undefined,
        // Provisions
        liability_cap: provisions.liability_cap || undefined,
        indemnification_clauses: provisions.indemnification_clauses,
        insurance_requirements: provisions.insurance_requirements,
        termination_clauses: provisions.termination_clauses,
        termination_for_convenience: !!provisions.termination_for_convenience,
        // Compliance
        regulatory_requirements: compliance.regulatory_requirements,
        compliance_certifications: compliance.compliance_certifications,
        // Confidentiality
        confidentiality_period: confidentiality.confidentiality_period || undefined,
        nda_type: confidentiality.nda_type || undefined,
        // Dispute
        dispute_resolution_method: dispute.dispute_resolution_method || undefined,
        arbitration_location: dispute.arbitration_location || undefined,
        // Classification
        category: classification.category || undefined,
        status: classification.status || undefined,
        // Files
        source_file_name: filesInfo.source_file_name || undefined,
        source_file_type: filesInfo.source_file_type || undefined,
        source_file_size: filesInfo.source_file_size || undefined,
        attachments: filesInfo.attachments,
        // Scan info
        is_scanned: !!scanInfo.is_scanned,
        ocr_confidence: scanInfo.ocr_confidence || undefined,
        page_count: scanInfo.page_count || undefined,
        // Images
        logo_image_id: images.logo_image_id || undefined,
        watermark_image_id: images.watermark_image_id || undefined,
        background_image_id: images.background_image_id || undefined,
        header_icon_id: images.header_icon_id || undefined,
        footer_icon_id: images.footer_icon_id || undefined,
        // Custom
        custom_metadata: custom.custom_metadata,
        related_documents: custom.related_documents,
        // Summary
        change_summary: changeSummary || 'Updated document via drafter',
      };

      if (!silent) setSaving(true);
      const result = await documentService.editFull(id, payload, false);
      setLastSaved(new Date());
      setHasChanges(false);
      if (!silent) setSaving(false);
      setError(null);
      return result;
    } catch (err) {
      console.error('Error saving full metadata:', err);
      setError(
        err.response?.data?.detail ||
        err.response?.data?.error ||
        'Failed to update full document fields'
      );
      if (!silent) setSaving(false);
    }
  };

  const addSection = () => {
    const newSection = {
      id: null, // Will be generated on save
      title: '',
      content_text: '',
      section_type: 'clause',
      paragraphs: []
    };
    setSections([...sections, newSection]);
    setExpandedSections(new Set([...expandedSections, newSection.id]));
    setHasChanges(true);
  };

  const updateSection = (index, field, value) => {
    const updated = [...sections];
    updated[index][field] = value;
    setSections(updated);
    setHasChanges(true);
  };

  const deleteSection = (index) => {
    if (!confirm('Delete this section?')) return;
    setSections(sections.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  // Load images for sidebar
  const loadSidebarImages = async (scope = 'document') => {
    setLoadingSidebarImages(true);
    try {
      const params = { upload_scope: scope };
      if (scope === 'document' && id) {
        params.document = id;
      }
      const response = await api.get('/documents/images/', { params });
      setSidebarImages(response.data.results || response.data || []);
    } catch (err) {
      console.error('Error loading sidebar images:', err);
    } finally {
      setLoadingSidebarImages(false);
    }
  };

  // Load inline images for a paragraph
  const loadParagraphImages = async (paragraphId) => {
    try {
      console.log('loadParagraphImages - Loading for paragraph:', paragraphId);
      const response = await inlineImageService.getByParagraph(paragraphId);
      console.log('loadParagraphImages - Raw response:', response);
      
      // Handle different response formats:
      // - Direct array: [img1, img2, ...]
      // - Object with results: { results: [img1, img2, ...] }
      // - Object with data: { data: [img1, img2, ...] }
      // - Single object: { id: ..., image_url: ..., ... } -> wrap in array
      let images = [];
      
      if (Array.isArray(response)) {
        images = response;
      } else if (response?.results && Array.isArray(response.results)) {
        images = response.results;
      } else if (response?.data && Array.isArray(response.data)) {
        images = response.data;
      } else if (response?.id) {
        // Single image object returned, wrap in array
        images = [response];
      }
      
      console.log('loadParagraphImages - Extracted images:', images);
      console.log('loadParagraphImages - Is array?', Array.isArray(images));
      console.log('loadParagraphImages - Image count:', images.length);
      
      setInlineImages(prev => {
        const updated = { ...prev, [paragraphId]: images };
        console.log('loadParagraphImages - Updated inlineImages state:', updated);
        return updated;
      });
    } catch (err) {
      console.error('Error loading paragraph images:', err);
      setInlineImages(prev => ({ ...prev, [paragraphId]: [] }));
    }
  };

  // Handle image drop into paragraph
  const handleImageDrop = async ({ imageData, position, paragraphId }) => {
    try {
      const payload = {
        paragraph: paragraphId,
        position_in_text: position || 0,
        image_reference: imageData.id,
        alignment: 'center',
        size_mode: 'max-width',
        max_width_pixels: 600
      };
      
      console.log('Inserting image with payload:', payload);
      
      // Insert with default settings - no modal
      const result = await inlineImageService.insertFromLibrary(payload);
      console.log('Image inserted successfully:', result);

      // Reload paragraph images immediately
      await loadParagraphImages(paragraphId);
      
      // Force a re-render by updating sections
      setSections([...sections]);
    } catch (err) {
      console.error('Error inserting image:', err);
      console.error('Error details:', err.response?.data);
      setError('Failed to insert image');
    }
  };

  // Update inline image settings from toolbar
  const handleUpdateImageSettings = async (imageId, paragraphId, settings) => {
    try {
      if (settings.size_mode || settings.size_value) {
        await inlineImageService.resizeImage(imageId, {
          size_mode: settings.size_mode,
          size_value: settings.size_value
        });
      }
      
      if (settings.alignment) {
        await inlineImageService.repositionImage(imageId, settings.alignment);
      }

      // Reload paragraph images
      await loadParagraphImages(paragraphId);
      setSelectedInlineImage(null);
    } catch (err) {
      console.error('Error updating image settings:', err);
    }
  };

  // Delete inline image
  const handleDeleteInlineImage = async (imageId, paragraphId) => {
    if (!confirm('Delete this image?')) return;
    
    try {
      await inlineImageService.deleteImage(imageId);
      await loadParagraphImages(paragraphId);
    } catch (err) {
      console.error('Error deleting inline image:', err);
    }
  };

  // Toggle inline image visibility
  const handleToggleImageVisibility = async (imageId, paragraphId) => {
    try {
      await inlineImageService.toggleVisibility(imageId);
      await loadParagraphImages(paragraphId);
    } catch (err) {
      console.error('Error toggling image visibility:', err);
    }
  };

  // Load sidebar images when tab changes
  useEffect(() => {
    if (showImagesGallery) {
      loadSidebarImages(sidebarTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showImagesGallery, sidebarTab]);

  // Load inline images for all paragraphs
  useEffect(() => {
    sections.forEach(section => {
      if (section.paragraphs) {
        section.paragraphs.forEach(paragraph => {
          if (paragraph.id) {
            loadParagraphImages(paragraph.id);
          }
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections]);

  const addParagraph = (sectionIndex) => {
    const updated = [...sections];
    if (!updated[sectionIndex].paragraphs) {
      updated[sectionIndex].paragraphs = [];
    }
    updated[sectionIndex].paragraphs.push({
      id: null,
      content_text: '',
      paragraph_type: 'standard'
    });
    setSections(updated);
    setHasChanges(true);
  };

  const updateParagraph = (sectionIndex, paragraphIndex, value) => {
    const updated = [...sections];
    updated[sectionIndex].paragraphs[paragraphIndex].content_text = value;
    setSections(updated);
    setHasChanges(true);
  };

  const updateParagraphType = (sectionIndex, paragraphIndex, type) => {
    const updated = [...sections];
    updated[sectionIndex].paragraphs[paragraphIndex].paragraph_type = type;
    setSections(updated);
    setHasChanges(true);
  };

  const deleteParagraph = (sectionIndex, paragraphIndex) => {
    if (!confirm('Delete this paragraph?')) return;
    const updated = [...sections];
    updated[sectionIndex].paragraphs = updated[sectionIndex].paragraphs.filter((_, i) => i !== paragraphIndex);
    setSections(updated);
    setHasChanges(true);
  };

  const toggleSection = (sectionId) => {
    const updated = new Set(expandedSections);
    if (updated.has(sectionId)) {
      updated.delete(sectionId);
    } else {
      updated.add(sectionId);
    }
    setExpandedSections(updated);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Minimalist Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <button
                onClick={() => navigate('/documents')}
                className="p-2 hover:bg-gray-100 rounded-full transition-all"
                title="Back"
              >
                <ArrowLeft className="w-5 h-5 text-gray-600" />
              </button>
              
              <input
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setHasChanges(true);
                }}
                placeholder="Untitled Document"
                className="text-lg font-medium border-none focus:outline-none bg-transparent"
              />
            </div>

            <div className="flex items-center space-x-2">
              {lastSaved && !hasChanges && (
                <div className="flex items-center text-xs text-green-600 bg-green-50 px-3 py-1 rounded-full">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Saved
                </div>
              )}
              
              {hasChanges && (
                <div className="text-xs text-amber-600 bg-amber-50 px-3 py-1 rounded-full">
                  Unsaved
                </div>
              )}

              {error && (
                <div className="flex items-center text-xs text-red-600 bg-red-50 px-3 py-1 rounded-full">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  {error}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Floating Action Panel - Canvas Style */}
      <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-50">
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-200/50 backdrop-blur-sm">
          <div className="flex items-center space-x-1 p-2">
            {/* Add Section */}
            <button
              onClick={addSection}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all hover:scale-105"
              title="Add Section"
            >
              <Plus className="w-4 h-4" />
              <span className="text-sm font-medium">Section</span>
            </button>

            <div className="w-px h-6 bg-gray-300"></div>

            {/* View Mode Toggle */}
            <button
              onClick={() => setViewMode(viewMode === 'edit' ? 'preview' : 'edit')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl transition-all hover:scale-105 ${
                viewMode === 'preview' 
                  ? 'bg-purple-600 text-white' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              title={viewMode === 'edit' ? 'Preview' : 'Edit'}
            >
              {viewMode === 'edit' ? <Eye className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
              <span className="text-sm font-medium">{viewMode === 'edit' ? 'Preview' : 'Edit'}</span>
            </button>

            <div className="w-px h-6 bg-gray-300"></div>

            {/* Images Gallery with Drag & Drop */}
            <button
              onClick={() => setShowImagesGallery(!showImagesGallery)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl transition-all hover:scale-105 ${
                showImagesGallery 
                  ? 'bg-pink-600 text-white' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              title="Images - Upload & Drag to Insert"
            >
              <ImageIcon className="w-4 h-4" />
              <span className="text-sm font-medium">Images</span>
            </button>

            <div className="w-px h-6 bg-gray-300"></div>

            {/* Metadata Info */}
            <button
              onClick={() => setShowMetadataModal(!showMetadataModal)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl transition-all hover:scale-105 ${
                showMetadataModal 
                  ? 'bg-teal-600 text-white' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              title="Document Metadata"
            >
              <Info className="w-4 h-4" />
              <span className="text-sm font-medium">Info</span>
            </button>

            <div className="w-px h-6 bg-gray-300"></div>

            {/* Uploads/Attachments */}
            <button
              onClick={() => {
                setShowPropertiesPanel(true);
                setActivePropertyTab('files');
              }}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl transition-all hover:scale-105 ${
                showPropertiesPanel && activePropertyTab === 'files'
                  ? 'bg-orange-600 text-white' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              title="Files & Attachments"
            >
              <Upload className="w-4 h-4" />
              <span className="text-sm font-medium">Files</span>
            </button>

            <div className="w-px h-6 bg-gray-300"></div>

            {/* Properties Panel */}
            <button
              onClick={() => setShowPropertiesPanel(!showPropertiesPanel)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl transition-all hover:scale-105 ${
                showPropertiesPanel 
                  ? 'bg-indigo-600 text-white' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              title="Document Properties"
            >
              <Settings className="w-4 h-4" />
              <span className="text-sm font-medium">Properties</span>
            </button>

            <div className="w-px h-6 bg-gray-300"></div>

            {/* Save */}
            <button
              onClick={() => saveDocument()}
              disabled={saving}
              className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:bg-gray-400 transition-all hover:scale-105"
              title="Save Document"
            >
              <Save className="w-4 h-4" />
              <span className="text-sm font-medium">{saving ? 'Saving...' : 'Save'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Floating Properties Panel - Slides from Right */}
      {showPropertiesPanel && (
        <div className="fixed inset-0 z-40 overflow-hidden">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/20 backdrop-blur-sm transition-opacity"
            onClick={() => setShowPropertiesPanel(false)}
          ></div>
          
          {/* Panel */}
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-2xl bg-white shadow-2xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 z-10">
              <div className="flex items-center justify-between p-4">
                <h2 className="text-lg font-semibold text-gray-900">Document Properties</h2>
                <button
                  onClick={() => setShowPropertiesPanel(false)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              {/* Property Tabs */}
              <div className="flex space-x-1 px-4 pb-2 overflow-x-auto">
                {[
                  { key: 'properties', label: 'Core', icon: FileBox },
                  { key: 'legal', label: 'Legal', icon: Book },
                  { key: 'financial', label: 'Financial', icon: FileText },
                  { key: 'images', label: 'Images', icon: ImageIcon },
                  { key: 'files', label: 'Files', icon: Layers },
                  { key: 'review', label: 'Review', icon: CheckCircle },
                ].map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.key}
                      onClick={() => setActivePropertyTab(tab.key)}
                      className={`flex items-center space-x-1 px-3 py-2 rounded-lg text-sm transition-all ${
                        activePropertyTab === tab.key
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Property Content */}
            <div className="p-6">
              {activePropertyTab === 'properties' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Core Metadata */}
            <div className="p-4 bg-white border border-gray-200 rounded-lg">
              <h4 className="font-semibold mb-3">Core Metadata</h4>
              <TextInput label="Author" value={metadata.author} onChange={(v) => setMetadata({ ...metadata, author: v })} />
              <TextInput label="Version" value={metadata.version} onChange={(v) => setMetadata({ ...metadata, version: v })} />
              <SelectInput label="Document Type" value={metadata.document_type} onChange={(v) => setMetadata({ ...metadata, document_type: v })} options={[
                { value: 'contract', label: 'Contract' },
                { value: 'policy', label: 'Policy' },
                { value: 'regulation', label: 'Regulation' },
                { value: 'legal_brief', label: 'Legal Brief' },
                { value: 'terms', label: 'Terms & Conditions' },
                { value: 'nda', label: 'NDA' },
                { value: 'license', label: 'License' },
                { value: 'other', label: 'Other' },
              ]} placeholder="Select type" />
            </div>

            {/* Version Management */}
            <div className="p-4 bg-white border border-gray-200 rounded-lg">
              <h4 className="font-semibold mb-3">Version Management</h4>
              <NumberInput label="Version Number" value={versionMgmt.version_number} onChange={(v) => setVersionMgmt({ ...versionMgmt, version_number: v })} />
              <div className="grid grid-cols-3 gap-3">
                <NumberInput label="Major" value={versionMgmt.major_version} onChange={(v) => setVersionMgmt({ ...versionMgmt, major_version: v })} />
                <NumberInput label="Minor" value={versionMgmt.minor_version} onChange={(v) => setVersionMgmt({ ...versionMgmt, minor_version: v })} />
                <NumberInput label="Patch" value={versionMgmt.patch_version} onChange={(v) => setVersionMgmt({ ...versionMgmt, patch_version: v })} />
              </div>
              <Toggle label="Draft" checked={versionMgmt.is_draft} onChange={(v) => setVersionMgmt({ ...versionMgmt, is_draft: v })} />
              <TextInput label="Version Label" value={versionMgmt.version_label} onChange={(v) => setVersionMgmt({ ...versionMgmt, version_label: v })} />
              <TextArea label="Version Notes" value={versionMgmt.version_notes} onChange={(v) => setVersionMgmt({ ...versionMgmt, version_notes: v })} />
            </div>

            {/* Dates */}
            <div className="p-4 bg-white border border-gray-200 rounded-lg">
              <h4 className="font-semibold mb-3">Important Dates</h4>
              <TextInput label="Effective Date (YYYY-MM-DD)" value={dates.effective_date} onChange={(v) => setDates({ ...dates, effective_date: v })} />
              <TextInput label="Expiration Date (YYYY-MM-DD)" value={dates.expiration_date} onChange={(v) => setDates({ ...dates, expiration_date: v })} />
              <TextInput label="Execution Date (YYYY-MM-DD)" value={dates.execution_date} onChange={(v) => setDates({ ...dates, execution_date: v })} />
            </div>

            {/* Parties */}
            <div className="md:col-span-3 p-4 bg-white border border-gray-200 rounded-lg">
              <h4 className="font-semibold mb-3">Parties and Signatories</h4>
              <ObjectListEditor
                label="Parties"
                items={parties}
                onChange={setParties}
                schema={[
                  { key: 'name', label: 'Name', type: 'text' },
                  { key: 'role', label: 'Role', type: 'text' },
                  { key: 'type', label: 'Type', type: 'text' },
                  { key: 'address', label: 'Address', type: 'text' },
                ]}
              />
              <ObjectListEditor
                label="Signatories"
                items={signatories}
                onChange={setSignatories}
                schema={[
                  { key: 'name', label: 'Name', type: 'text' },
                  { key: 'title', label: 'Title', type: 'text' },
                  { key: 'party', label: 'Party', type: 'text' },
                  { key: 'signed', label: 'Signed', type: 'toggle' },
                  { key: 'signature_date', label: 'Signature Date (YYYY-MM-DD)', type: 'text' },
                ]}
              />
            </div>
          </div>
        )}

        {activePropertyTab === 'legal' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-white border border-gray-200 rounded-lg">
              <h4 className="font-semibold mb-3">Legal Information</h4>
              <TextInput label="Governing Law" value={legal.governing_law} onChange={(v) => setLegal({ ...legal, governing_law: v })} />
              <TextInput label="Reference Number" value={legal.reference_number} onChange={(v) => setLegal({ ...legal, reference_number: v })} />
              <TextInput label="Project Name" value={legal.project_name} onChange={(v) => setLegal({ ...legal, project_name: v })} />
              <TextInput label="Jurisdiction" value={legal.jurisdiction} onChange={(v) => setLegal({ ...legal, jurisdiction: v })} />
            </div>

            <div className="p-4 bg-white border border-gray-200 rounded-lg">
              <h4 className="font-semibold mb-3">Term and Renewal</h4>
              <TextInput label="Term Length" value={termRenewal.term_length} onChange={(v) => setTermRenewal({ ...termRenewal, term_length: v })} />
              <Toggle label="Auto Renewal" checked={termRenewal.auto_renewal} onChange={(v) => setTermRenewal({ ...termRenewal, auto_renewal: v })} />
              <TextArea label="Renewal Terms" value={termRenewal.renewal_terms} onChange={(v) => setTermRenewal({ ...termRenewal, renewal_terms: v })} />
              <TextInput label="Notice Period" value={termRenewal.notice_period} onChange={(v) => setTermRenewal({ ...termRenewal, notice_period: v })} />
            </div>

            <div className="p-4 bg-white border border-gray-200 rounded-lg">
              <h4 className="font-semibold mb-3">Compliance</h4>
              <StringListEditor label="Regulatory Requirements" values={compliance.regulatory_requirements} onChange={(vals) => setCompliance({ ...compliance, regulatory_requirements: vals })} />
              <StringListEditor label="Compliance Certifications" values={compliance.compliance_certifications} onChange={(vals) => setCompliance({ ...compliance, compliance_certifications: vals })} />
            </div>

            <div className="md:col-span-3 p-4 bg-white border border-gray-200 rounded-lg">
              <h4 className="font-semibold mb-3">Legal Provisions</h4>
              <NumberInput label="Liability Cap" value={provisions.liability_cap} onChange={(v) => setProvisions({ ...provisions, liability_cap: v })} />
              <ObjectListEditor
                label="Indemnification Clauses"
                items={provisions.indemnification_clauses}
                onChange={(items) => setProvisions({ ...provisions, indemnification_clauses: items })}
                schema={[
                  { key: 'type', label: 'Type', type: 'text' },
                  { key: 'description', label: 'Description', type: 'textarea' },
                ]}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h5 className="text-sm font-semibold mb-2">Insurance Requirements</h5>
                  <TextInput label="General Liability" value={provisions.insurance_requirements?.general_liability || ''} onChange={(v) => setProvisions({ ...provisions, insurance_requirements: { ...provisions.insurance_requirements, general_liability: v } })} />
                  <TextInput label="Professional Liability" value={provisions.insurance_requirements?.professional_liability || ''} onChange={(v) => setProvisions({ ...provisions, insurance_requirements: { ...provisions.insurance_requirements, professional_liability: v } })} />
                  <TextInput label="Workers Comp" value={provisions.insurance_requirements?.workers_comp || ''} onChange={(v) => setProvisions({ ...provisions, insurance_requirements: { ...provisions.insurance_requirements, workers_comp: v } })} />
                  <TextInput label="Cyber Liability" value={provisions.insurance_requirements?.cyber_liability || ''} onChange={(v) => setProvisions({ ...provisions, insurance_requirements: { ...provisions.insurance_requirements, cyber_liability: v } })} />
                </div>
              </div>
              <ObjectListEditor
                label="Termination Clauses"
                items={provisions.termination_clauses}
                onChange={(items) => setProvisions({ ...provisions, termination_clauses: items })}
                schema={[
                  { key: 'type', label: 'Type', type: 'select', options: [
                    { value: 'breach', label: 'Breach' },
                    { value: 'convenience', label: 'Convenience' },
                  ] },
                  { key: 'notice_period', label: 'Notice Period', type: 'text' },
                  { key: 'cure_period', label: 'Cure Period', type: 'text' },
                ]}
              />
              <Toggle label="Termination for Convenience" checked={provisions.termination_for_convenience} onChange={(v) => setProvisions({ ...provisions, termination_for_convenience: v })} />
            </div>
          </div>
        )}

        {activePropertyTab === 'financial' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-white border border-gray-200 rounded-lg">
              <h4 className="font-semibold mb-3">Financial Terms</h4>
              <NumberInput label="Contract Value" value={financial.contract_value} onChange={(v) => setFinancial({ ...financial, contract_value: v })} />
              <SelectInput label="Currency" value={financial.currency} onChange={(v) => setFinancial({ ...financial, currency: v })} options={[
                { value: 'USD', label: 'USD' },
                { value: 'EUR', label: 'EUR' },
                { value: 'GBP', label: 'GBP' },
              ]} />
              <h5 className="text-sm font-semibold mt-3 mb-2">Payment Terms</h5>
              <SelectInput label="Schedule" value={financial.payment_terms?.schedule || ''} onChange={(v) => setFinancial({ ...financial, payment_terms: { ...financial.payment_terms, schedule: v } })} options={[
                { value: 'monthly', label: 'Monthly' },
                { value: 'quarterly', label: 'Quarterly' },
              ]} placeholder="Select schedule" />
              <NumberInput label="Due Days" value={financial.payment_terms?.due_days || ''} onChange={(v) => setFinancial({ ...financial, payment_terms: { ...financial.payment_terms, due_days: v } })} />
              <TextInput label="Method" value={financial.payment_terms?.method || ''} onChange={(v) => setFinancial({ ...financial, payment_terms: { ...financial.payment_terms, method: v } })} />
              <NumberInput label="Late Fee %" value={financial.payment_terms?.late_fee_percentage || ''} onChange={(v) => setFinancial({ ...financial, payment_terms: { ...financial.payment_terms, late_fee_percentage: v } })} />
            </div>
          </div>
        )}

        {activePropertyTab === 'images' && (
          <ImagesPanel
            images={images}
            onChange={setImages}
            onSave={async (updatedImages) => {
              try {
                await api.patch(`/documents/${id}/edit-full/`, {
                  ...updatedImages,
                  change_summary: 'Updated document images'
                });
                setImages(updatedImages);
                setLastSaved(new Date());
              } catch (err) {
                console.error('Error saving images:', err);
                setError('Failed to save images');
              }
            }}
          />
        )}

        {activePropertyTab === 'files' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-white border border-gray-200 rounded-lg">
              <h4 className="font-semibold mb-3">Classification</h4>
              <SelectInput label="Category" value={classification.category} onChange={(v) => setClassification({ ...classification, category: v })} options={[
                { value: 'contract', label: 'Contract' },
                { value: 'policy', label: 'Policy' },
                { value: 'regulation', label: 'Regulation' },
                { value: 'legal_brief', label: 'Legal Brief' },
                { value: 'terms', label: 'Terms & Conditions' },
                { value: 'nda', label: 'NDA' },
                { value: 'license', label: 'License' },
                { value: 'other', label: 'Other' },
              ]} />
              <SelectInput label="Status" value={classification.status} onChange={(v) => setClassification({ ...classification, status: v })} options={[
                { value: 'draft', label: 'Draft' },
                { value: 'under_review', label: 'Under Review' },
                { value: 'analyzed', label: 'Analyzed' },
                { value: 'approved', label: 'Approved' },
                { value: 'finalized', label: 'Finalized' },
              ]} />
            </div>

            <div className="p-4 bg-white border border-gray-200 rounded-lg">
              <h4 className="font-semibold mb-3">Files & Attachments</h4>
              <TextInput label="Source File Name" value={filesInfo.source_file_name} onChange={(v) => setFilesInfo({ ...filesInfo, source_file_name: v })} />
              <TextInput label="Source File Type" value={filesInfo.source_file_type} onChange={(v) => setFilesInfo({ ...filesInfo, source_file_type: v })} />
              <NumberInput label="Source File Size" value={filesInfo.source_file_size} onChange={(v) => setFilesInfo({ ...filesInfo, source_file_size: v })} />
              <ObjectListEditor
                label="Attachments"
                items={filesInfo.attachments}
                onChange={(items) => setFilesInfo({ ...filesInfo, attachments: items })}
                schema={[
                  { key: 'name', label: 'Name', type: 'text' },
                  { key: 'file_path', label: 'File Path', type: 'text' },
                  { key: 'type', label: 'Type', type: 'text' },
                  { key: 'size', label: 'Size (bytes)', type: 'number' },
                ]}
              />
            </div>

            <div className="p-4 bg-white border border-gray-200 rounded-lg">
              <h4 className="font-semibold mb-3">Scanned Document</h4>
              <Toggle label="Is Scanned" checked={scanInfo.is_scanned} onChange={(v) => setScanInfo({ ...scanInfo, is_scanned: v })} />
              <NumberInput label="OCR Confidence" value={scanInfo.ocr_confidence} onChange={(v) => setScanInfo({ ...scanInfo, ocr_confidence: v })} />
              <NumberInput label="Page Count" value={scanInfo.page_count} onChange={(v) => setScanInfo({ ...scanInfo, page_count: v })} />
            </div>

            <div className="md:col-span-3 p-4 bg-white border border-gray-200 rounded-lg">
              <h4 className="font-semibold mb-3">Images (UUIDs)</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <TextInput label="Logo Image ID" value={images.logo_image_id} onChange={(v) => setImages({ ...images, logo_image_id: v })} />
                <TextInput label="Watermark Image ID" value={images.watermark_image_id} onChange={(v) => setImages({ ...images, watermark_image_id: v })} />
                <TextInput label="Background Image ID" value={images.background_image_id} onChange={(v) => setImages({ ...images, background_image_id: v })} />
                <TextInput label="Header Icon ID" value={images.header_icon_id} onChange={(v) => setImages({ ...images, header_icon_id: v })} />
                <TextInput label="Footer Icon ID" value={images.footer_icon_id} onChange={(v) => setImages({ ...images, footer_icon_id: v })} />
              </div>
            </div>
          </div>
        )}

        {activePropertyTab === 'review' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-white border border-gray-200 rounded-lg">
              <h4 className="font-semibold mb-3">Custom Metadata</h4>
              {/* Simple key/value editor (JSON) */}
              <TextArea
                label="Custom Metadata (JSON)"
                value={JSON.stringify(custom.custom_metadata || {}, null, 2)}
                onChange={(val) => {
                  try {
                    const parsed = JSON.parse(val);
                    setCustom({ ...custom, custom_metadata: parsed });
                  } catch {
                    // keep as text until valid
                  }
                }}
                rows={10}
              />
            </div>

            <div className="p-4 bg-white border border-gray-200 rounded-lg">
              <h4 className="font-semibold mb-3">Related Documents</h4>
              <ObjectListEditor
                label="Related"
                items={custom.related_documents}
                onChange={(items) => setCustom({ ...custom, related_documents: items })}
                schema={[
                  { key: 'id', label: 'Document ID', type: 'text' },
                  { key: 'title', label: 'Title', type: 'text' },
                  { key: 'relationship', label: 'Relationship', type: 'text' },
                ]}
              />
            </div>

            <div className="md:col-span-2 p-4 bg-white border border-gray-200 rounded-lg">
              <h4 className="font-semibold mb-3">Change Summary</h4>
              <TextArea label="Summary" value={changeSummary} onChange={setChangeSummary} rows={4} />
              <div className="mt-3 flex items-center justify-between">
                <Toggle label="Auto Save Full Edits" checked={autoSaveFull} onChange={setAutoSaveFull} />
                <button
                  type="button"
                  onClick={() => saveFullMetadata()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Apply Full Update
                </button>
              </div>
            </div>
          </div>
        )}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8 pb-32">
        {/* Preview Mode */}
        {viewMode === 'preview' ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200/50 p-12 backdrop-blur-sm">
            {/* Document Title */}
            <div className="mb-8 border-b border-gray-300 pb-6">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">{title || 'Untitled Document'}</h1>
              <div className="flex items-center space-x-4 text-sm text-gray-600">
                <span>{sections.length} section{sections.length !== 1 ? 's' : ''}</span>
                <span>•</span>
                <span>{sections.reduce((total, s) => total + (s.paragraphs?.length || 0), 0)} paragraph{sections.reduce((total, s) => total + (s.paragraphs?.length || 0), 0) !== 1 ? 's' : ''}</span>
              </div>
            </div>

            {/* Sections - Preview Mode (Word-like) */}
            <div className="space-y-0">
              {sections.map((section, sectionIndex) => (
                <DocumentSection
                  key={section.id || sectionIndex}
                  section={section}
                  sectionIndex={sectionIndex}
                  inlineImages={inlineImages}
                  editable={false}
                  isExpanded={true}
                  onToggleExpand={() => {}}
                  onTitleChange={() => {}}
                  onParagraphChange={() => {}}
                  onAddParagraph={() => {}}
                  onDeleteSection={() => {}}
                  onImageDrop={() => {}}
                  onImageSelect={() => {}}
                  onImageDelete={() => {}}
                  onImageToggleVisibility={() => {}}
                />
              ))}


              {sections.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <Book className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                  <p>No content yet. Switch to Edit mode to start writing.</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Edit Mode */
          <>
            {/* Sections */}
            <div className="space-y-6">
              {sections.map((section, sectionIndex) => (
                <div key={section.id || sectionIndex} className="group bg-white rounded-2xl border border-gray-200/50 shadow-sm hover:shadow-md transition-all backdrop-blur-sm">
              {/* Section Header */}
              <div className="border-b border-gray-100 p-5">
                <div className="flex items-start space-x-3">
                  <button
                    onClick={() => toggleSection(section.id)}
                    className="p-1.5 hover:bg-gray-100 rounded-lg mt-1 transition-all"
                  >
                    {expandedSections.has(section.id) ? (
                      <ChevronDown className="w-5 h-5 text-gray-600" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-gray-600" />
                    )}
                  </button>

                  <div className="flex-1 space-y-3">
                    <input
                      type="text"
                      value={section.title || ''}
                      onChange={(e) => updateSection(sectionIndex, 'title', e.target.value)}
                      placeholder={`Section ${sectionIndex + 1} Title`}
                      className="w-full text-lg font-semibold border-none focus:outline-none focus:ring-0 bg-transparent text-gray-900 placeholder-gray-400"
                    />
                    
                    <select
                      value={section.section_type || 'clause'}
                      onChange={(e) => updateSection(sectionIndex, 'section_type', e.target.value)}
                      className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50"
                    >
                      <option value="header">Header</option>
                      <option value="preamble">Preamble</option>
                      <option value="definitions">Definitions</option>
                      <option value="body">Main Body</option>
                      <option value="clause">Clause/Article</option>
                      <option value="schedule">Schedule/Exhibit</option>
                      <option value="signature">Signature Block</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  <button
                    onClick={() => deleteSection(sectionIndex)}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                    title="Delete section"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Section Content */}
              {expandedSections.has(section.id) && (
                <div className="p-5">
                  {/* Paragraphs */}
                  <div className="space-y-4 mb-4">
                    {section.paragraphs && section.paragraphs.map((paragraph, paragraphIndex) => (
                      <div key={paragraph.id || paragraphIndex} className="flex items-start space-x-3 group/para">
                        <div className="flex-1 space-y-2">
                          {/* Text Editor */}
                          <ParagraphDropZone
                            paragraph={paragraph}
                            onImageDrop={handleImageDrop}
                            className="w-full"
                          >
                            <textarea
                              value={paragraph.content_text || ''}
                              onChange={(e) => updateParagraph(sectionIndex, paragraphIndex, e.target.value)}
                              placeholder={`Paragraph ${paragraphIndex + 1} - Drop images here to insert inline`}
                              className="w-full min-h-[120px] p-4 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y text-gray-800 placeholder-gray-400"
                            />
                          </ParagraphDropZone>
                          
                          {/* Inline Images Preview */}
                          {Array.isArray(inlineImages[paragraph.id]) && inlineImages[paragraph.id].length > 0 && (
                            <div className="border border-blue-200 rounded-lg p-3 bg-gradient-to-r from-blue-50 to-purple-50">
                              <div className="text-xs font-medium text-blue-900 mb-2 flex items-center gap-2">
                                <ImageIcon size={14} />
                                {inlineImages[paragraph.id].length} Inline Image{inlineImages[paragraph.id].length !== 1 ? 's' : ''}
                              </div>
                              <div className="flex flex-wrap gap-3">
                                {inlineImages[paragraph.id].map(img => (
                                  <div key={img.id} className="relative group/img">
                                    <InlineImage
                                      inlineImage={img}
                                      onDelete={(id) => handleDeleteInlineImage(id, paragraph.id)}
                                      onToggleVisibility={(id) => handleToggleImageVisibility(id, paragraph.id)}
                                      onSelect={(imageData) => setSelectedInlineImage({ ...imageData, paragraphId: paragraph.id })}
                                      editable={true}
                                    />
                                    <div className="absolute -top-2 -right-2 bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded-full opacity-0 group-hover/img:opacity-100 transition-opacity">
                                      @{img.position_in_text || 0}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          <select
                            value={paragraph.paragraph_type || 'standard'}
                            onChange={(e) => updateParagraphType(sectionIndex, paragraphIndex, e.target.value)}
                            className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50"
                          >
                            <option value="standard">Standard</option>
                            <option value="definition">Definition</option>
                            <option value="obligation">Obligation</option>
                            <option value="right">Right/Permission</option>
                            <option value="condition">Condition</option>
                            <option value="exception">Exception</option>
                            <option value="example">Example</option>
                          </select>
                        </div>
                        
                        <button
                          onClick={() => deleteParagraph(sectionIndex, paragraphIndex)}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover/para:opacity-100 transition-all"
                          title="Delete paragraph"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Add Paragraph Button */}
                  <button
                    onClick={() => addParagraph(sectionIndex)}
                    className="flex items-center space-x-2 px-4 py-2.5 text-sm text-blue-600 hover:bg-blue-50 rounded-xl transition-all border border-dashed border-blue-300 hover:border-blue-400 w-full justify-center"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Paragraph</span>
                  </button>
                </div>
              )}
            </div>
          ))}
            </div>

            {/* Empty State */}
            {sections.length === 0 && (
              <div className="text-center py-20">
                <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium text-gray-600 mb-2">No sections yet</h3>
                <p className="text-sm text-gray-500 mb-6">Start building your document by adding a section</p>
                <button
                  onClick={addSection}
                  className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all hover:scale-105"
                >
                  <Plus className="w-5 h-5" />
                  <span>Add First Section</span>
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Combined Images Sidebar - Upload & Drag-Drop */}
      {showImagesGallery && (
        <div className="fixed right-0 top-0 bottom-0 w-96 bg-white shadow-2xl border-l border-gray-200 z-40 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-pink-50 to-purple-50">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-pink-600" />
                Images Library
              </h3>
              <button
                onClick={() => setShowImagesGallery(false)}
                className="p-1.5 hover:bg-white rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setSidebarTab('user')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  sidebarTab === 'user'
                    ? 'bg-pink-600 text-white shadow-md'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                My Images
              </button>
              <button
                onClick={() => setSidebarTab('document')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  sidebarTab === 'document'
                    ? 'bg-pink-600 text-white shadow-md'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                Document
              </button>
              <button
                onClick={() => setSidebarTab('team')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  sidebarTab === 'team'
                    ? 'bg-pink-600 text-white shadow-md'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                Team
              </button>
            </div>

            {/* Upload Button */}
            <label className="block">
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  
                  try {
                    const formData = new FormData();
                    formData.append('image', file);
                    formData.append('name', file.name);
                    formData.append('upload_scope', sidebarTab);
                    if (sidebarTab === 'document' && id) {
                      formData.append('document', id);
                    }
                    
                    await api.post('/documents/images/', formData, {
                      headers: { 'Content-Type': 'multipart/form-data' }
                    });
                    
                    await loadSidebarImages(sidebarTab);
                    e.target.value = '';
                  } catch (err) {
                    console.error('Upload error:', err);
                    setError('Failed to upload image');
                  }
                }}
                className="hidden"
                id="sidebar-upload"
              />
              <div className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-pink-600 text-white rounded-lg hover:bg-pink-700 transition-colors cursor-pointer text-sm font-medium">
                <Upload className="w-4 h-4" />
                Upload Image
              </div>
            </label>
          </div>

          {/* Help Text */}
          <div className="p-3 bg-blue-50 border-b border-blue-100">
            <p className="text-xs text-blue-800">
              <strong>💡 Drag images</strong> into paragraphs to insert inline. Click inserted images to resize.
            </p>
          </div>

          {/* Images Grid */}
          <div className="flex-1 overflow-y-auto p-4">
            {loadingSidebarImages ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-pink-600"></div>
              </div>
            ) : sidebarImages.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <ImageIcon className="w-16 h-16 mx-auto mb-3 text-gray-300" />
                <p className="text-sm mb-2">No images yet</p>
                <p className="text-xs text-gray-400">Upload your first image above</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {sidebarImages.map(image => (
                  <DraggableImageItem
                    key={image.id}
                    image={image}
                  >
                    <div className="group relative">
                      <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden border-2 border-gray-200 hover:border-pink-400 transition-all">
                        <img
                          src={
                            (image.thumbnail_url || image.url || image.image)?.startsWith('http')
                              ? (image.thumbnail_url || image.url || image.image)
                              : `http://localhost:8000${image.thumbnail_url || image.url || image.image}`
                          }
                          alt={image.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="mt-1.5 px-1">
                        <div className="text-xs font-medium text-gray-700 truncate" title={image.name}>
                          {image.name}
                        </div>
                        {image.width && image.height && (
                          <div className="text-xs text-gray-500">
                            {image.width}×{image.height}
                          </div>
                        )}
                      </div>
                      {/* Delete button on hover */}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (confirm('Delete this image?')) {
                            try {
                              await api.delete(`/documents/images/${image.id}/`);
                              await loadSidebarImages(sidebarTab);
                            } catch (err) {
                              console.error('Delete error:', err);
                            }
                          }
                        }}
                        className="absolute top-2 right-2 p-1.5 bg-white rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-600" />
                      </button>
                    </div>
                  </DraggableImageItem>
                ))}
              </div>
            )}
          </div>

          {/* Footer Stats */}
          <div className="p-3 border-t border-gray-200 bg-gray-50 text-xs text-gray-600">
            {sidebarImages.length} image{sidebarImages.length !== 1 ? 's' : ''} • Max 10MB • JPEG, PNG, GIF, WEBP
          </div>
        </div>
      )}

      {/* Metadata Modal */}
      {showMetadataModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-teal-50 to-blue-50">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-teal-600 rounded-lg">
                  <Info className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Document Information</h3>
                  <p className="text-sm text-gray-600">Quick overview of document metadata</p>
                </div>
              </div>
              <button
                onClick={() => setShowMetadataModal(false)}
                className="p-2 hover:bg-white/50 rounded-lg transition-colors"
              >
                <X className="w-6 h-6 text-gray-500" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto max-h-[calc(80vh-120px)] space-y-6">
              {/* Basic Info */}
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                  <FileText className="w-5 h-5 mr-2 text-blue-600" />
                  Basic Information
                </h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-gray-600">Title:</span>
                    <p className="font-medium text-gray-900">{title || 'Untitled Document'}</p>
                  </div>
                  <div>
                    <span className="text-gray-600">Author:</span>
                    <p className="font-medium text-gray-900">{metadata.author || 'Not set'}</p>
                  </div>
                  <div>
                    <span className="text-gray-600">Version:</span>
                    <p className="font-medium text-gray-900">{metadata.version || versionMgmt.version_number || 'Not set'}</p>
                  </div>
                  <div>
                    <span className="text-gray-600">Type:</span>
                    <p className="font-medium text-gray-900">{metadata.document_type || 'Not set'}</p>
                  </div>
                  <div>
                    <span className="text-gray-600">Category:</span>
                    <p className="font-medium text-gray-900">{classification.category || 'Not set'}</p>
                  </div>
                  <div>
                    <span className="text-gray-600">Status:</span>
                    <p className="font-medium text-gray-900">{classification.status || versionMgmt.is_draft ? 'Draft' : 'Not set'}</p>
                  </div>
                </div>
              </div>

              {/* Structure Stats */}
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4">
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                  <Layers className="w-5 h-5 mr-2 text-blue-600" />
                  Document Structure
                </h4>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-white/50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-blue-600">{sections.length}</div>
                    <div className="text-xs text-gray-600 mt-1">Sections</div>
                  </div>
                  <div className="bg-white/50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-indigo-600">
                      {sections.reduce((total, section) => total + (section.paragraphs?.length || 0), 0)}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">Paragraphs</div>
                  </div>
                  <div className="bg-white/50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-purple-600">
                      {sections.reduce((total, section) => 
                        total + (section.paragraphs?.reduce((pTotal, p) => pTotal + (p.sentences?.length || 0), 0) || 0), 0
                      )}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">Sentences</div>
                  </div>
                </div>
              </div>

              {/* Dates */}
              {(dates.effective_date || dates.expiration_date || dates.execution_date) && (
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                    <CheckCircle className="w-5 h-5 mr-2 text-green-600" />
                    Important Dates
                  </h4>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    {dates.effective_date && (
                      <div>
                        <span className="text-gray-600">Effective:</span>
                        <p className="font-medium text-gray-900">{dates.effective_date}</p>
                      </div>
                    )}
                    {dates.expiration_date && (
                      <div>
                        <span className="text-gray-600">Expiration:</span>
                        <p className="font-medium text-gray-900">{dates.expiration_date}</p>
                      </div>
                    )}
                    {dates.execution_date && (
                      <div>
                        <span className="text-gray-600">Execution:</span>
                        <p className="font-medium text-gray-900">{dates.execution_date}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Legal Info */}
              {(legal.governing_law || legal.jurisdiction || legal.reference_number) && (
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                    <Book className="w-5 h-5 mr-2 text-purple-600" />
                    Legal Information
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {legal.governing_law && (
                      <div>
                        <span className="text-gray-600">Governing Law:</span>
                        <p className="font-medium text-gray-900">{legal.governing_law}</p>
                      </div>
                    )}
                    {legal.jurisdiction && (
                      <div>
                        <span className="text-gray-600">Jurisdiction:</span>
                        <p className="font-medium text-gray-900">{legal.jurisdiction}</p>
                      </div>
                    )}
                    {legal.reference_number && (
                      <div className="col-span-2">
                        <span className="text-gray-600">Reference Number:</span>
                        <p className="font-medium text-gray-900">{legal.reference_number}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Last Saved */}
              {lastSaved && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      <span className="font-medium text-green-900">Last saved</span>
                    </div>
                    <span className="text-sm text-green-700">
                      {new Date(lastSaved).toLocaleString()}
                    </span>
                  </div>
                </div>
              )}

              {/* Changes Warning */}
              {hasChanges && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <div className="flex items-center space-x-2">
                    <AlertCircle className="w-5 h-5 text-amber-600" />
                    <span className="font-medium text-amber-900">Unsaved changes</span>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end space-x-3">
              <button
                onClick={() => setShowMetadataModal(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setShowMetadataModal(false);
                  setShowPropertiesPanel(true);
                  setActivePropertyTab('properties');
                }}
                className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors"
              >
                Edit Metadata
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Image Resize Toolbar */}
      {selectedInlineImage && (
        <ImageResizeToolbar
          image={selectedInlineImage}
          onResize={(settings) => handleUpdateImageSettings(selectedInlineImage.id, selectedInlineImage.paragraphId, settings)}
          onClose={() => setSelectedInlineImage(null)}
        />
      )}
    </div>
  );
};

export default DocumentDrafter;
