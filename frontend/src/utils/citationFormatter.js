/**
 * Citation Formatter
 * 
 * Parses inline references from API text and formats them as citations
 * Supports multiple citation styles: footnotes, endnotes, inline, definitions
 */

// Debug flag - set to true to enable verbose logging
const DEBUG_CITATIONS = false;

// Reference marker regex: [[type:target_id:ref_id|display_text]] OR [[type:id|display_text]]
// Flexible pattern to handle both 2-part and 3-part formats
const REFERENCE_REGEX = /\[\[([^:]+):([^:|]+)(?::([^|]+))?\|([^\]]+)\]\]/g;

/**
 * Citation Styles
 */
export const CITATION_STYLES = {
  FOOTNOTE: 'footnote',        // [1] with note at bottom
  ENDNOTE: 'endnote',          // [1] with note at end of document
  INLINE: 'inline',            // (See Section 5)
  DEFINITION: 'definition',    // Hover definition popup
  NUMBERED: 'numbered',        // Sequential numbering
  LABELED: 'labeled',          // [Warranty] labeled references
};

/**
 * Parse references from text
 * @param {string} text - Paragraph text with reference markers
 * @returns {Array} Parsed references
 */
export const parseReferences = (text) => {
  if (!text) return [];
  
  const references = [];
  let match;
  const regex = new RegExp(REFERENCE_REGEX);
  
  if (DEBUG_CITATIONS) {
    if (DEBUG_CITATIONS) console.log('🔎 Parsing references from text:', text.substring(0, 200));
    if (DEBUG_CITATIONS) console.log('🔎 Using regex:', REFERENCE_REGEX);
  }
  
  while ((match = regex.exec(text)) !== null) {
    // Support both formats:
    // [[type:target_id:ref_id|display]] - 3 parts (ref_id is match[3])
    // [[type:id|display]] - 2 parts (ref_id is match[2], match[3] is undefined)
    const refId = match[3] || match[2]; // Use ref_id if present, else use target_id
    
    const parsed = {
      fullMatch: match[0],
      type: match[1],
      targetId: match[2],
      refId: refId,
      displayText: match[4],  // This is what shows to the user
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    };
    
    if (DEBUG_CITATIONS) {
      if (DEBUG_CITATIONS) console.log('✅ Found reference marker:', {
        fullMarker: parsed.fullMatch,
        displayText: parsed.displayText,
        type: parsed.type,
        refId: parsed.refId
      });
    }
    
    references.push(parsed);
  }
  
  if (DEBUG_CITATIONS) {
    if (DEBUG_CITATIONS) console.log(`📊 Total references found: ${references.length}`);
  }
  return references;
};

/**
 * Format text with citations based on style
 * @param {string} text - Original text with markers
 * @param {Array} referenceMetadata - Reference metadata from API
 * @param {string} style - Citation style
 * @returns {Object} Formatted text and citations
 */
export const formatWithCitations = (text, referenceMetadata = [], style = CITATION_STYLES.FOOTNOTE) => {
  if (DEBUG_CITATIONS) {
    if (DEBUG_CITATIONS) console.log('🎯 formatWithCitations called:', { 
      textLength: text?.length, 
      hasText: !!text,
      metadataCount: referenceMetadata?.length,
      style 
    });
  }
  
  if (!text) return { text: '', citations: [] };
  
  const references = parseReferences(text);
  
  // Early return if no references found
  if (references.length === 0) {
    if (DEBUG_CITATIONS) {
      if (DEBUG_CITATIONS) console.log('⚠️ No references found in text');
    }
    return { text, citations: [] };
  }
  
  if (DEBUG_CITATIONS) {
    if (DEBUG_CITATIONS) console.log(`✅ Found ${references.length} references, processing...`);
  }
  
  const citations = [];
  let formattedText = text;
  let citationNumber = 1;
  
  // Create metadata map
  const metadataMap = new Map();
  referenceMetadata.forEach(ref => {
    // Try multiple possible ID fields
    const id = ref.id || ref.reference_id || ref.ref_id;
    if (id) {
      metadataMap.set(id, ref);
      if (DEBUG_CITATIONS) console.log('📋 Mapped metadata:', id, ref);
    }
  });
  
  if (DEBUG_CITATIONS) console.log(`📊 Metadata map has ${metadataMap.size} entries`);
  
  // Process references in reverse order to maintain correct indices
  const reversedRefs = [...references].reverse();
  
  reversedRefs.forEach((ref, idx) => {
    if (DEBUG_CITATIONS) console.log(`🔄 Processing reference ${idx + 1}/${reversedRefs.length}:`, ref);
    
    const metadata = metadataMap.get(ref.refId);
    const targetInfo = metadata?.target_info || {
      // Fallback values when no metadata is available
      title: ref.displayText,
      content: `Reference to ${ref.type} (ID: ${ref.targetId})`,
      document_title: 'Loading...'
    };
    
    if (DEBUG_CITATIONS) console.log('📦 Target info:', { hasMetadata: !!metadata, targetInfo });
    
    let replacement = '';
    let citation = null;
    
    switch (style) {
      case CITATION_STYLES.FOOTNOTE:
      case CITATION_STYLES.NUMBERED:
        replacement = `<span class="citation-marker" data-citation-id="${citationNumber}" data-ref-id="${ref.refId}">${ref.displayText}<sup>[${citationNumber}]</sup></span>`;
        citation = {
          id: citationNumber,
          refId: ref.refId,
          type: ref.type,
          displayText: ref.displayText,
          targetInfo,
          formattedCitation: formatCitation(ref.type, targetInfo, citationNumber),
        };
        citationNumber++;
        break;
        
      case CITATION_STYLES.INLINE:
        const inlineText = formatInlineCitation(ref.type, targetInfo, ref.displayText);
        replacement = `<span class="citation-inline" data-ref-id="${ref.refId}">${inlineText}</span>`;
        break;
        
      case CITATION_STYLES.DEFINITION:
        replacement = `<span class="citation-definition" data-ref-id="${ref.refId}" title="${targetInfo.title || ref.displayText}">${ref.displayText}</span>`;
        citation = {
          refId: ref.refId,
          type: ref.type,
          displayText: ref.displayText,
          targetInfo,
          definition: formatDefinition(ref.type, targetInfo),
        };
        break;
        
      case CITATION_STYLES.LABELED:
        replacement = `<span class="citation-labeled" data-ref-id="${ref.refId}">${ref.displayText}<sup>[${ref.displayText}]</sup></span>`;
        citation = {
          refId: ref.refId,
          label: ref.displayText,
          type: ref.type,
          targetInfo,
          formattedCitation: formatCitation(ref.type, targetInfo, ref.displayText),
        };
        break;
        
      case CITATION_STYLES.ENDNOTE:
        replacement = `<span class="citation-marker" data-citation-id="${citationNumber}" data-ref-id="${ref.refId}">${ref.displayText}<sup>[${citationNumber}]</sup></span>`;
        citation = {
          id: citationNumber,
          refId: ref.refId,
          type: ref.type,
          displayText: ref.displayText,
          targetInfo,
          formattedCitation: formatCitation(ref.type, targetInfo, citationNumber),
          isEndnote: true,
        };
        citationNumber++;
        break;
        
      default:
        replacement = `<span class="citation-simple" data-ref-id="${ref.refId}">${ref.displayText}</span>`;
    }
    
    if (DEBUG_CITATIONS) console.log('🔧 Replacement HTML:', replacement.substring(0, 100));
    
    // Replace in text
    formattedText = formattedText.substring(0, ref.startIndex) + 
                    replacement + 
                    formattedText.substring(ref.endIndex);
    
    if (citation) {
      citations.unshift(citation); // Add to beginning since we're processing in reverse
      if (DEBUG_CITATIONS) console.log('📌 Added citation:', citation);
    }
  });
  
  const result = {
    text: formattedText,
    citations: citations.reverse(), // Reverse back to original order
  };
  
  if (DEBUG_CITATIONS) console.log('🎉 formatWithCitations complete:', {
    originalLength: text.length,
    formattedLength: result.text.length,
    citationCount: result.citations.length,
    preview: result.text.substring(0, 200)
  });
  
  return result;
};

/**
 * Format citation based on reference type
 * @param {string} type - Reference type
 * @param {Object} targetInfo - Target information
 * @param {number|string} number - Citation number or label
 * @returns {string} Formatted citation
 */
const formatCitation = (type, targetInfo, number) => {
  const { title, content, document_title, url } = targetInfo;
  
  switch (type) {
    case 'section':
      return `<div class="citation-entry">
        <span class="citation-number">[${number}]</span>
        <span class="citation-content">
          ${title || 'Section'}${document_title ? `, ${document_title}` : ''}
          ${content ? `<div class="citation-preview">${truncate(content, 200)}</div>` : ''}
        </span>
      </div>`;
      
    case 'paragraph':
      return `<div class="citation-entry">
        <span class="citation-number">[${number}]</span>
        <span class="citation-content">
          ${content ? truncate(content, 200) : 'Paragraph'}
          ${title ? `<div class="citation-source">From: ${title}</div>` : ''}
        </span>
      </div>`;
      
    case 'definition':
      return `<div class="citation-entry">
        <span class="citation-number">[${number}]</span>
        <span class="citation-content">
          <strong>${title || 'Definition'}</strong>
          ${content ? `<div class="citation-definition-text">${content}</div>` : ''}
        </span>
      </div>`;
      
    case 'statute':
      return `<div class="citation-entry">
        <span class="citation-number">[${number}]</span>
        <span class="citation-content">
          ${title || 'Statute'}
          ${content ? `<div class="citation-text">${truncate(content, 150)}</div>` : ''}
        </span>
      </div>`;
      
    case 'case':
      return `<div class="citation-entry">
        <span class="citation-number">[${number}]</span>
        <span class="citation-content">
          <em>${title || 'Case Law'}</em>
          ${content ? `<div class="citation-text">${truncate(content, 150)}</div>` : ''}
        </span>
      </div>`;
      
    case 'citation':
      return `<div class="citation-entry">
        <span class="citation-number">[${number}]</span>
        <span class="citation-content">
          ${title || 'Citation'}
          ${content ? `<div class="citation-text">${content}</div>` : ''}
        </span>
      </div>`;
      
    case 'url':
      return `<div class="citation-entry">
        <span class="citation-number">[${number}]</span>
        <span class="citation-content">
          ${title || 'External Link'}: <a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>
          ${content ? `<div class="citation-text">${truncate(content, 100)}</div>` : ''}
        </span>
      </div>`;
      
    case 'footnote':
      return `<div class="citation-entry">
        <span class="citation-number">[${number}]</span>
        <span class="citation-content">${content || title || 'Footnote'}</span>
      </div>`;
      
    default:
      return `<div class="citation-entry">
        <span class="citation-number">[${number}]</span>
        <span class="citation-content">${title || content || 'Reference'}</span>
      </div>`;
  }
};

/**
 * Format inline citation
 * @param {string} type - Reference type
 * @param {Object} targetInfo - Target information
 * @param {string} displayText - Display text
 * @returns {string} Inline citation
 */
const formatInlineCitation = (type, targetInfo, displayText) => {
  // Simply return the display text without any additional formatting
  return displayText;
};

/**
 * Format definition popup content
 * @param {string} type - Reference type
 * @param {Object} targetInfo - Target information
 * @returns {string} Definition HTML
 */
const formatDefinition = (type, targetInfo) => {
  const { title, content } = targetInfo;
  
  return `<div class="definition-popup">
    <div class="definition-title">${title || type}</div>
    ${content ? `<div class="definition-content">${content}</div>` : ''}
  </div>`;
};

/**
 * Truncate text to specified length
 * @param {string} text - Text to truncate
 * @param {number} length - Max length
 * @returns {string} Truncated text
 */
const truncate = (text, length) => {
  if (!text) return '';
  if (text.length <= length) return text;
  return text.substring(0, length) + '...';
};

/**
 * Group citations by section
 * @param {Array} citations - All citations
 * @returns {Object} Grouped citations
 */
export const groupCitationsBySection = (citations) => {
  const grouped = {};
  
  citations.forEach(citation => {
    const sectionId = citation.targetInfo?.section_id || 'general';
    if (!grouped[sectionId]) {
      grouped[sectionId] = [];
    }
    grouped[sectionId].push(citation);
  });
  
  return grouped;
};

/**
 * Generate citation list HTML
 * @param {Array} citations - Citations to render
 * @param {string} title - List title
 * @returns {string} HTML for citation list
 */
export const generateCitationList = (citations, title = 'References') => {
  if (!citations || citations.length === 0) {
    return '';
  }
  
  const citationHTML = citations
    .map(citation => citation.formattedCitation)
    .join('\n');
  
  return `<div class="citations-container">
    <h3 class="citations-title">${title}</h3>
    <div class="citations-list">
      ${citationHTML}
    </div>
  </div>`;
};

/**
 * Extract plain text (remove all citation markers)
 * @param {string} text - Text with citation markers
 * @returns {string} Plain text
 */
export const extractPlainText = (text) => {
  if (!text) return '';
  
  return text.replace(REFERENCE_REGEX, (match, type, targetId, refId, displayText) => {
    return displayText;
  });
};

/**
 * Get citation statistics
 * @param {string} text - Text with references
 * @returns {Object} Statistics
 */
export const getCitationStats = (text) => {
  const references = parseReferences(text);
  
  const stats = {
    total: references.length,
    byType: {},
  };
  
  references.forEach(ref => {
    stats.byType[ref.type] = (stats.byType[ref.type] || 0) + 1;
  });
  
  return stats;
};

export default {
  parseReferences,
  formatWithCitations,
  generateCitationList,
  groupCitationsBySection,
  extractPlainText,
  getCitationStats,
  CITATION_STYLES,
};
