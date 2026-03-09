/**
 * Metadata Field Usage Tracker
 * Utility to scan paragraphs and track which field names are used where
 */

/**
 * Extract all placeholder field names from text content
 * @param {string} content - HTML or text content
 * @returns {string[]} Array of unique field names
 */
export const extractPlaceholderFields = (content) => {
  if (!content || typeof content !== 'string') return [];
  
  const fieldNames = new Set();
  const placeholderRegex = /\[\[([a-zA-Z0-9_.-]+)\]\]/g;
  
  let match;
  while ((match = placeholderRegex.exec(content)) !== null) {
    fieldNames.add(match[1]);
  }
  
  return Array.from(fieldNames);
};

/**
 * Build a usage map showing which paragraphs use which fields
 * @param {Array} sections - Document sections with paragraphs
 * @returns {Object} Map of field names to paragraph IDs
 */
export const buildFieldUsageMap = (sections) => {
  const usageMap = {};
  
  if (!Array.isArray(sections)) return usageMap;
  
  sections.forEach((section, sectionIndex) => {
    const paragraphs = section?.paragraphs || [];
    
    paragraphs.forEach((paragraph, paragraphIndex) => {
      const content = paragraph?.content || '';
      const paragraphId = paragraph?.id || paragraph?.client_id || `s${sectionIndex}-p${paragraphIndex}`;
      const fields = extractPlaceholderFields(content);
      
      fields.forEach((fieldName) => {
        if (!usageMap[fieldName]) {
          usageMap[fieldName] = {
            fieldName,
            paragraphs: [],
            count: 0
          };
        }
        
        usageMap[fieldName].paragraphs.push({
          paragraphId,
          sectionIndex,
          paragraphIndex,
          sectionTitle: section?.title || `Section ${sectionIndex + 1}`
        });
        usageMap[fieldName].count++;
      });
    });
  });
  
  return usageMap;
};

/**
 * Get all unique field names used across the document
 * @param {Array} sections - Document sections with paragraphs
 * @returns {string[]} Array of unique field names sorted alphabetically
 */
export const getAllUsedFields = (sections) => {
  const usageMap = buildFieldUsageMap(sections);
  return Object.keys(usageMap).sort();
};

/**
 * Check if a field name is used anywhere in the document
 * @param {string} fieldName - Field name to check
 * @param {Array} sections - Document sections with paragraphs
 * @returns {boolean} True if field is used
 */
export const isFieldUsed = (fieldName, sections) => {
  const usageMap = buildFieldUsageMap(sections);
  return fieldName in usageMap;
};

/**
 * Get paragraphs that use a specific field
 * @param {string} fieldName - Field name to search for
 * @param {Array} sections - Document sections with paragraphs
 * @returns {Array} Array of paragraph references
 */
export const getParagraphsUsingField = (fieldName, sections) => {
  const usageMap = buildFieldUsageMap(sections);
  return usageMap[fieldName]?.paragraphs || [];
};

export default {
  extractPlaceholderFields,
  buildFieldUsageMap,
  getAllUsedFields,
  isFieldUsed,
  getParagraphsUsingField
};
