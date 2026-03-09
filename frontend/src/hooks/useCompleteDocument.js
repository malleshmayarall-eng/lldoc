import { useState, useEffect, useCallback } from 'react';
import { documentService } from '../services/documentService';

/**
 * Custom hook to manage complete document state using the Complete API
 * Fetches ALL document data in a single API call:
 * - Sections (nested hierarchy)
 * - Paragraphs (with inline images)
 * - Tables
 * - Image Components
 * - File Components
 * - Comments (with replies)
 * - Attachments
 * - Issues
 * - Referenced Documents
 * - Statistics
 * 
 * @param {string} documentId - The document UUID
 * @returns {object} Complete document state and helper functions
 */
export const useCompleteDocument = (documentId) => {
  // Main document state
  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);

  // Derived state for quick access
  const [sections, setSections] = useState([]);
  const [flatSections, setFlatSections] = useState([]); // Flattened for easy lookup
  const [allParagraphs, setAllParagraphs] = useState([]);
  const [allTables, setAllTables] = useState([]);
  const [allImageComponents, setAllImageComponents] = useState([]);
  const [allFileComponents, setAllFileComponents] = useState([]);
  const [comments, setComments] = useState([]);
  const [issues, setIssues] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [stats, setStats] = useState(null);
  const [metadata, setMetadata] = useState(null);

  // Indexed state for O(1) lookups
  const [sectionMap, setSectionMap] = useState({});
  const [paragraphMap, setParagraphMap] = useState({});
  const [tableMap, setTableMap] = useState({});
  const [imageMap, setImageMap] = useState({});
  const [fileMap, setFileMap] = useState({});
  const [commentMap, setCommentMap] = useState({});

  // Section-specific maps for quick access
  const [sectionParagraphs, setSectionParagraphs] = useState({});
  const [sectionTables, setSectionTables] = useState({});
  const [sectionImages, setSectionImages] = useState({});
  const [sectionFiles, setSectionFiles] = useState({});

  /**
   * Flatten nested sections into a single array
   */
  const flattenSections = useCallback((sections, parentId = null, depth = 0) => {
    let flattened = [];
    sections.forEach(section => {
      flattened.push({ ...section, parentId, depth });
      if (section.children && section.children.length > 0) {
        flattened = flattened.concat(flattenSections(section.children, section.id, depth + 1));
      }
    });
    return flattened;
  }, []);

  /**
   * Build indexed maps and section-specific collections
   */
  const buildIndexes = useCallback((doc) => {
    if (!doc || !doc.sections) return;

    // Flatten sections
    const flat = flattenSections(doc.sections);
    setFlatSections(flat);

    // Build section map
    const secMap = {};
    flat.forEach(section => {
      secMap[section.id] = section;
    });
    setSectionMap(secMap);

    // Extract and index all components
    const paragraphs = [];
    const tables = [];
    const images = [];
    const files = [];
    const paraMap = {};
    const tblMap = {};
    const imgMap = {};
    const filMap = {};
    const secParas = {};
    const secTbls = {};
    const secImgs = {};
    const secFils = {};

    flat.forEach(section => {
      // Paragraphs
      if (section.paragraphs) {
        secParas[section.id] = section.paragraphs;
        section.paragraphs.forEach(para => {
          paragraphs.push({ ...para, sectionId: section.id });
          paraMap[para.id] = { ...para, sectionId: section.id };
        });
      }

      // Tables
      if (section.tables) {
        secTbls[section.id] = section.tables;
        section.tables.forEach(table => {
          tables.push({ ...table, sectionId: section.id });
          tblMap[table.id] = { ...table, sectionId: section.id };
        });
      }

      // Image Components
      if (section.image_components) {
        secImgs[section.id] = section.image_components;
        section.image_components.forEach(img => {
          images.push({ ...img, sectionId: section.id });
          imgMap[img.id] = { ...img, sectionId: section.id };
        });
      }

      // File Components
      if (section.file_components) {
        secFils[section.id] = section.file_components;
        section.file_components.forEach(file => {
          files.push({ ...file, sectionId: section.id });
          filMap[file.id] = { ...file, sectionId: section.id };
        });
      }
    });

    setAllParagraphs(paragraphs);
    setAllTables(tables);
    setAllImageComponents(images);
    setAllFileComponents(files);
    setParagraphMap(paraMap);
    setTableMap(tblMap);
    setImageMap(imgMap);
    setFileMap(filMap);
    setSectionParagraphs(secParas);
    setSectionTables(secTbls);
    setSectionImages(secImgs);
    setSectionFiles(secFils);

    // Comments
    if (doc.comments) {
      const cmtMap = {};
      doc.comments.forEach(comment => {
        cmtMap[comment.id] = comment;
      });
      setComments(doc.comments);
      setCommentMap(cmtMap);
    }

    // Issues
    if (doc.issues) {
      setIssues(doc.issues);
    }

    // Attachments
    if (doc.attachments) {
      setAttachments(doc.attachments);
    }

    // Stats
    if (doc.stats) {
      setStats(doc.stats);
    }
  }, [flattenSections]);

  /**
   * Fetch complete document from API
   */
  const fetchDocument = useCallback(async () => {
    if (!documentId) return;

    try {
      setLoading(true);
      setError(null);

      console.log('📄 Fetching complete document:', documentId);
      const completeDoc = await documentService.getCompleteDocument(documentId);
      
      /**
       * Backend returns sections in denormalized format:
       * - Sections appear both nested (in children arrays) AND flat (at root level)
       * - Need to build proper tree structure from flat data
       * - Use root sections (parent === null) as entry points
       */
      const buildSectionTree = (sections) => {
        if (!sections || sections.length === 0) return [];
        
        // First, deduplicate sections (in case they appear multiple times)
        const sectionMap = new Map();
        sections.forEach(section => {
          if (!sectionMap.has(section.id)) {
            sectionMap.set(section.id, { ...section, children: [] });
          }
        });
        
        // Build tree structure
        const rootSections = [];
        const childSections = new Map();
        
        sectionMap.forEach((section, id) => {
          if (!section.parent) {
            // Root level section
            rootSections.push(section);
          } else {
            // Child section - group by parent
            if (!childSections.has(section.parent)) {
              childSections.set(section.parent, []);
            }
            childSections.get(section.parent).push(section);
          }
        });
        
        // Recursively attach children
        const attachChildren = (section) => {
          const children = childSections.get(section.id) || [];
          section.children = children.sort((a, b) => a.order - b.order);
          section.children.forEach(child => attachChildren(child));
          return section;
        };
        
        const tree = rootSections.map(section => attachChildren(section));
        return tree.sort((a, b) => a.order - b.order);
      };
      
      // Build tree from denormalized sections
      const sectionTree = buildSectionTree(completeDoc.sections);
      
      // console.log('✅ Complete document loaded:', {
      //   title: completeDoc.title,
      //   rawSections: completeDoc.sections?.length || 0,
      //   treeSections: sectionTree.length,
      //   stats: completeDoc.stats
      // });

      const enrichedDoc = {
        ...completeDoc,
        sections: sectionTree
      };

      setDocument(enrichedDoc);
      setSections(sectionTree);
      setMetadata(completeDoc.metadata || null);
      buildIndexes(enrichedDoc);
      setLastFetched(new Date());
    } catch (err) {
      console.error('❌ Error fetching complete document:', err);
      setError(err.message || 'Failed to load document');
    } finally {
      setLoading(false);
    }
  }, [documentId, buildIndexes]);

  /**
   * Refresh document data
   */
  const refresh = useCallback(() => {
    return fetchDocument();
  }, [fetchDocument]);

  /**
   * Get section by ID
   */
  const getSection = useCallback((sectionId) => {
    return sectionMap[sectionId] || null;
  }, [sectionMap]);

  /**
   * Get paragraph by ID
   */
  const getParagraph = useCallback((paragraphId) => {
    return paragraphMap[paragraphId] || null;
  }, [paragraphMap]);

  /**
   * Get table by ID
   */
  const getTable = useCallback((tableId) => {
    return tableMap[tableId] || null;
  }, [tableMap]);

  /**
   * Get image component by ID
   */
  const getImage = useCallback((imageId) => {
    return imageMap[imageId] || null;
  }, [imageMap]);

  /**
   * Get file component by ID
   */
  const getFile = useCallback((fileId) => {
    return fileMap[fileId] || null;
  }, [fileMap]);

  /**
   * Get comment by ID
   */
  const getComment = useCallback((commentId) => {
    return commentMap[commentId] || null;
  }, [commentMap]);

  /**
   * Get all paragraphs in a section
   */
  const getParagraphsInSection = useCallback((sectionId) => {
    return sectionParagraphs[sectionId] || [];
  }, [sectionParagraphs]);

  /**
   * Get all tables in a section
   */
  const getTablesInSection = useCallback((sectionId) => {
    return sectionTables[sectionId] || [];
  }, [sectionTables]);

  /**
   * Get all image components in a section
   */
  const getImagesInSection = useCallback((sectionId) => {
    return sectionImages[sectionId] || [];
  }, [sectionImages]);

  /**
   * Get all file components in a section
   */
  const getFilesInSection = useCallback((sectionId) => {
    return sectionFiles[sectionId] || [];
  }, [sectionFiles]);

  /**
   * Get all components in a section, sorted by order
   */
  const getComponentsInSection = useCallback((sectionId) => {
    const paragraphs = (sectionParagraphs[sectionId] || []).map(p => ({
      type: 'paragraph',
      order: p.order || 0,
      data: p
    }));
    const tables = (sectionTables[sectionId] || []).map(t => ({
      type: 'table',
      order: t.order || 0,
      data: t
    }));
    const images = (sectionImages[sectionId] || []).map(i => ({
      type: 'image',
      order: i.order || 0,
      data: i
    }));
    const files = (sectionFiles[sectionId] || []).map(f => ({
      type: 'file',
      order: f.order || 0,
      data: f
    }));

    const allComponents = [...paragraphs, ...tables, ...images, ...files];
    allComponents.sort((a, b) => a.order - b.order);

    return allComponents;
  }, [sectionParagraphs, sectionTables, sectionImages, sectionFiles]);

  /**
   * Get comments for a specific reference
   */
  const getCommentsForReference = useCallback((referenceId) => {
    return comments.filter(c => c.reference_id === referenceId);
  }, [comments]);

  /**
   * Get section children
   */
  const getSectionChildren = useCallback((sectionId) => {
    return flatSections.filter(s => s.parentId === sectionId);
  }, [flatSections]);

  /**
   * Get section path (breadcrumb)
   */
  const getSectionPath = useCallback((sectionId) => {
    const path = [];
    let current = sectionMap[sectionId];
    
    while (current) {
      path.unshift(current);
      current = current.parentId ? sectionMap[current.parentId] : null;
    }
    
    return path;
  }, [sectionMap]);

  /**
   * Search across all content
   */
  const search = useCallback((query) => {
    const lowerQuery = query.toLowerCase();
    const results = {
      sections: [],
      paragraphs: [],
      tables: [],
      comments: []
    };

    // Search sections
    flatSections.forEach(section => {
      if (section.title?.toLowerCase().includes(lowerQuery)) {
        results.sections.push(section);
      }
    });

    // Search paragraphs
    allParagraphs.forEach(para => {
      const text = para.content_text || para.edited_text || para.content || '';
      if (text.toLowerCase().includes(lowerQuery)) {
        results.paragraphs.push(para);
      }
    });

    // Search tables
    allTables.forEach(table => {
      if (table.title?.toLowerCase().includes(lowerQuery)) {
        results.tables.push(table);
      }
    });

    // Search comments
    comments.forEach(comment => {
      if (comment.content?.toLowerCase().includes(lowerQuery)) {
        results.comments.push(comment);
      }
    });

    return results;
  }, [flatSections, allParagraphs, allTables, comments]);

  // Initial fetch - only when documentId changes
  useEffect(() => {
    if (documentId) {
      fetchDocument();
    } else {
      setDocument(null);
      setSections([]);
      setFlatSections([]);
      setAllParagraphs([]);
      setAllTables([]);
      setAllImageComponents([]);
      setAllFileComponents([]);
      setComments([]);
      setIssues([]);
      setAttachments([]);
      setStats(null);
      setMetadata(null);
      setSectionMap({});
      setParagraphMap({});
      setTableMap({});
      setImageMap({});
      setFileMap({});
      setCommentMap({});
      setSectionParagraphs({});
      setSectionTables({});
      setSectionImages({});
      setSectionFiles({});
      setError(null);
      setLoading(false);
      setLastFetched(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]); // Only re-fetch when documentId changes

  return {
    // Main state
    document,
    loading,
    error,
    lastFetched,

    // Collections
    sections,
    flatSections,
    allParagraphs,
    allTables,
    allImageComponents,
    allFileComponents,
    comments,
    issues,
    attachments,
    stats,
    metadata,

    // Maps
    sectionMap,
    paragraphMap,
    tableMap,
    imageMap,
    fileMap,
    commentMap,
    imageComponentMap: imageMap,  // Alias for consistency
    fileComponentMap: fileMap,    // Alias for consistency

    // Section-specific collections
    sectionParagraphs,
    sectionTables,
    sectionImages,
    sectionFiles,

    // Helper functions
    refetch: refresh,
    refresh,
    getSectionById: getSection,
    getParagraphById: getParagraph,
    getTableById: getTable,
    getImageComponentById: getImage,
    getFileComponentById: getFile,
    getCommentById: getComment,
    getSection,
    getParagraph,
    getTable,
    getImage,
    getFile,
    getComment,
    getParagraphsInSection,
    getTablesInSection,
    getImagesInSection,
    getFilesInSection,
    getComponentsInSection,
    getCommentsForReference,
    getSectionChildren,
    getSectionPath,
    search,

    // Utility flags
    isLoaded: !loading && !error && document !== null,
    hasError: error !== null,
    isEmpty: !loading && !error && (!sections || sections.length === 0)
  };
};

export default useCompleteDocument;
