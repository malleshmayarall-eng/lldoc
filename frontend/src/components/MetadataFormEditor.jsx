/**
 * MetadataFormEditor Component
 * Comprehensive form for editing document metadata with structured and custom fields
 */

import React, { useState, useEffect } from 'react';
import { Save, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import useMetadataStore from '../store/metadataStore';

const MetadataFormEditor = ({ documentId }) => {
  const {
    metadata,
    loading,
    error,
    loadMetadata,
    updateField,
    uploadMetadata
  } = useMetadataStore();

  const [activeTab, setActiveTab] = useState('structured');
  const [expandedSections, setExpandedSections] = useState({
    dates: true,
    legal: false,
    financial: false,
    terms: false,
    parties: false,
    signatories: false,
    provisions: false,
    compliance: false,
    confidentiality: false,
    dispute_resolution: false,
    classification: false,
    stakeholders: false
  });

  // State for structured metadata fields
  const [structuredFields, setStructuredFields] = useState({});
  
  // State for custom metadata (key-value pairs)
  const [customFields, setCustomFields] = useState([]);

  useEffect(() => {
    if (documentId) {
      loadMetadata(documentId);
    }
  }, [documentId, loadMetadata]);

  useEffect(() => {
    if (metadata?.document_metadata) {
      setStructuredFields(metadata.document_metadata);
    }
    if (metadata?.custom_metadata) {
      // Convert custom metadata object to array of key-value pairs
      const customArray = Object.entries(metadata.custom_metadata || {}).map(([key, value]) => ({
        id: Math.random(),
        key,
        value: typeof value === 'object' ? JSON.stringify(value, null, 2) : value
      }));
      setCustomFields(customArray);
    }
  }, [metadata]);

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleStructuredFieldChange = (path, value) => {
    const keys = path.split('.');
    const newFields = { ...structuredFields };
    let current = newFields;
    
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) current[keys[i]] = {};
      current = current[keys[i]];
    }
    
    current[keys[keys.length - 1]] = value;
    setStructuredFields(newFields);
  };

  const handleCustomFieldChange = (id, field, value) => {
    setCustomFields(prev => prev.map(item => 
      item.id === id ? { ...item, [field]: value } : item
    ));
  };

  const addCustomField = () => {
    setCustomFields(prev => [...prev, { id: Math.random(), key: '', value: '' }]);
  };

  const removeCustomField = (id) => {
    setCustomFields(prev => prev.filter(item => item.id !== id));
  };

  const handleSave = async () => {
    try {
      // Prepare structured metadata (document_metadata)
      const documentMetadata = flattenObject(structuredFields);

      // Prepare custom metadata
      const customMetadata = {};
      customFields.forEach(({ key, value }) => {
        if (key.trim()) {
          try {
            // Try to parse as JSON if it looks like JSON
            customMetadata[key] = value.startsWith('{') || value.startsWith('[') 
              ? JSON.parse(value) 
              : value;
          } catch {
            customMetadata[key] = value;
          }
        }
      });

      // Save document metadata if any
      if (Object.keys(documentMetadata).length > 0) {
        await uploadMetadata(documentId, documentMetadata, {
          target: 'document_metadata',
          merge: true,
          createChangelog: true
        });
      }

      // Save custom metadata if any
      if (Object.keys(customMetadata).length > 0) {
        await uploadMetadata(documentId, customMetadata, {
          target: 'custom_metadata',
          merge: true,
          createChangelog: true
        });
      }

      alert('Metadata saved successfully!');
    } catch (err) {
      console.error('Save failed:', err);
      alert('Failed to save metadata: ' + err.message);
    }
  };

  if (loading && !metadata) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-600">Loading metadata...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
          ⚠️ {error}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header with tabs */}
      <div className="border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('structured')}
              className={`px-4 py-2 rounded font-medium text-sm ${
                activeTab === 'structured'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100'
              }`}
            >
              📄 Structured Fields
            </button>
            <button
              onClick={() => setActiveTab('custom')}
              className={`px-4 py-2 rounded font-medium text-sm ${
                activeTab === 'custom'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100'
              }`}
            >
              🔧 Custom Fields
            </button>
          </div>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium"
          >
            <Save size={16} />
            Save All Changes
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'structured' ? (
          <StructuredFieldsTable
            fields={structuredFields}
            onChange={handleStructuredFieldChange}
            expandedSections={expandedSections}
            onToggleSection={toggleSection}
          />
        ) : (
          <CustomFieldsTable
            fields={customFields}
            onChange={handleCustomFieldChange}
            onAdd={addCustomField}
            onRemove={removeCustomField}
          />
        )}
      </div>
    </div>
  );
};

// Helper function to flatten nested object
const flattenObject = (obj, prefix = '') => {
  const flattened = {};
  
  Object.entries(obj || {}).forEach(([key, value]) => {
    const newKey = prefix ? `${prefix}.${key}` : key;
    
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(flattened, flattenObject(value, newKey));
    } else {
      flattened[newKey] = value;
    }
  });
  
  return flattened;
};

// Structured Fields Table Component
const StructuredFieldsTable = ({ fields, onChange, expandedSections, onToggleSection }) => {
  const sections = [
    {
      key: 'dates',
      title: 'Dates',
      icon: '📅',
      fields: [
        { key: 'effective_date', label: 'Effective Date', type: 'date' },
        { key: 'expiration_date', label: 'Expiration Date', type: 'date' },
        { key: 'execution_date', label: 'Execution Date', type: 'date' },
        { key: 'created_date', label: 'Created Date', type: 'date' },
        { key: 'renewal_date', label: 'Renewal Date', type: 'date' },
        { key: 'notice_date', label: 'Notice Date', type: 'date' },
        { key: 'termination_date', label: 'Termination Date', type: 'date' }
      ]
    },
    {
      key: 'legal',
      title: 'Legal Information',
      icon: '⚖️',
      fields: [
        { key: 'governing_law', label: 'Governing Law', type: 'text' },
        { key: 'jurisdiction', label: 'Jurisdiction', type: 'text' },
        { key: 'reference_number', label: 'Reference Number', type: 'text' },
        { key: 'document_type', label: 'Document Type', type: 'text' },
        { key: 'confidentiality_level', label: 'Confidentiality Level', type: 'select', options: ['public', 'internal', 'confidential', 'restricted'] },
        { key: 'legal_status', label: 'Legal Status', type: 'select', options: ['draft', 'final', 'executed', 'terminated'] },
        { key: 'venue', label: 'Venue', type: 'text' }
      ]
    },
    {
      key: 'financial',
      title: 'Financial Information',
      icon: '💰',
      fields: [
        { key: 'contract_value', label: 'Contract Value', type: 'number' },
        { key: 'currency', label: 'Currency', type: 'text', placeholder: 'USD' },
        { key: 'payment_terms.method', label: 'Payment Method', type: 'text' },
        { key: 'payment_terms.frequency', label: 'Payment Frequency', type: 'select', options: ['one-time', 'monthly', 'quarterly', 'annual'] },
        { key: 'payment_terms.due_date', label: 'Payment Due Date', type: 'text' },
        { key: 'payment_terms.late_fee', label: 'Late Fee', type: 'text' },
        { key: 'pricing.base_price', label: 'Base Price', type: 'number' },
        { key: 'pricing.discounts', label: 'Discounts', type: 'text' },
        { key: 'pricing.taxes', label: 'Taxes', type: 'text' },
        { key: 'pricing.total', label: 'Total', type: 'number' }
      ]
    },
    {
      key: 'terms',
      title: 'Terms & Conditions',
      icon: '📋',
      fields: [
        { key: 'term_length', label: 'Term Length', type: 'text' },
        { key: 'term_unit', label: 'Term Unit', type: 'select', options: ['days', 'months', 'years'] },
        { key: 'auto_renewal', label: 'Auto Renewal', type: 'checkbox' },
        { key: 'renewal_terms', label: 'Renewal Terms', type: 'textarea' },
        { key: 'notice_period', label: 'Notice Period', type: 'text' },
        { key: 'notice_unit', label: 'Notice Unit', type: 'select', options: ['days', 'months'] },
        { key: 'termination_clause', label: 'Termination Clause', type: 'textarea' }
      ]
    },
    {
      key: 'classification',
      title: 'Classification',
      icon: '🏷️',
      fields: [
        { key: 'category', label: 'Category', type: 'text' },
        { key: 'subcategory', label: 'Subcategory', type: 'text' },
        { key: 'priority', label: 'Priority', type: 'select', options: ['low', 'medium', 'high', 'critical'] },
        { key: 'sensitivity', label: 'Sensitivity', type: 'select', options: ['public', 'internal', 'confidential', 'restricted'] }
      ]
    }
  ];

  const getFieldValue = (fieldKey) => {
    const keys = fieldKey.split('.');
    let value = fields;
    for (const key of keys) {
      value = value?.[key];
    }
    return value ?? '';
  };

  return (
    <div className="space-y-4">
      {sections.map(section => (
        <div key={section.key} className="border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => onToggleSection(section.key)}
            className="w-full flex items-center justify-between px-2 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              {expandedSections[section.key] ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
              <span className="text-lg">{section.icon}</span>
              <span className="font-semibold text-gray-900">{section.title}</span>
              <span className="text-sm text-gray-500">({section.fields.length} fields)</span>
            </div>
          </button>

          {expandedSections[section.key] && (
            <div className="p-4">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-gray-700 w-1/3">Field Name</th>
                    <th className="px-4 py-2 text-left font-semibold text-gray-700">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {section.fields.map(field => (
                    <tr key={field.key} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900 font-medium">
                        {field.label}
                      </td>
                      <td className="px-4 py-3">
                        <FieldInput
                          field={field}
                          value={getFieldValue(`${section.key}.${field.key}`)}
                          onChange={(value) => onChange(`${section.key}.${field.key}`, value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// Field Input Component
const FieldInput = ({ field, value, onChange }) => {
  const baseClass = "w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500";

  switch (field.type) {
    case 'date':
      return (
        <input
          type="date"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className={baseClass}
        />
      );
    
    case 'number':
      return (
        <input
          type="number"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className={baseClass}
          step="0.01"
        />
      );
    
    case 'checkbox':
      return (
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="w-5 h-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
        />
      );
    
    case 'select':
      return (
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className={baseClass}
        >
          <option value="">Select...</option>
          {field.options?.map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      );
    
    case 'textarea':
      return (
        <textarea
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className={baseClass}
          rows={3}
        />
      );
    
    default:
      return (
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className={baseClass}
          placeholder={field.placeholder || ''}
        />
      );
  }
};

// Custom Fields Table Component
const CustomFieldsTable = ({ fields, onChange, onAdd, onRemove }) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Custom Metadata Fields</h3>
        </div>
        <button
          onClick={onAdd}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
        >
          <Plus size={16} />
          Add Field
        </button>
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Field Key</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Field Value</th>
              <th className="px-4 py-3 text-center font-semibold text-gray-700 w-20">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {fields.length === 0 ? (
              <tr>
                <td colSpan="3" className="px-4 py-12 text-center text-gray-500">
                  <div className="flex flex-col items-center gap-2">
                    <p>No custom fields yet</p>
                    <button
                      onClick={onAdd}
                      className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                    >
                      Click "Add Field" to create your first custom field
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              fields.map(field => (
                <tr key={field.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={field.key}
                      onChange={(e) => onChange(field.id, 'key', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="field_name"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <textarea
                      value={field.value}
                      onChange={(e) => onChange(field.id, 'value', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      rows={2}
                      placeholder='Simple value or JSON: {"key": "value"}'
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => onRemove(field.id)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded"
                      title="Delete field"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
};

export default MetadataFormEditor;
