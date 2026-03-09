/**
 * MetadataTableEditor Component
 * Simple table view for document metadata
 * Shows which paragraphs use each field
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import useMetadataStore from '../store/metadataStore';
import { buildFieldUsageMap } from '../utils/metadataFieldUsageTracker';
import { metadataService } from '../services/metadataService';

const MetadataTableEditor = ({ documentId, sections }) => {
  const {
    metadata,
    loading,
    error,
    loadMetadata,
    updateField
  } = useMetadataStore();

  const [saving, setSaving] = useState(false);

  // Build field usage map from sections
  const fieldUsageMap = useMemo(() => {
    return buildFieldUsageMap(sections || []);
  }, [sections]);

  useEffect(() => {
    if (documentId) {
      loadMetadata(documentId);
    }
  }, [documentId, loadMetadata]);

  const handleQuickUpdate = async (fieldPath, value) => {
    setSaving(true);
    try {
      await updateField(documentId, fieldPath, value);
    } catch (err) {
      console.error('Update failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (fieldPath) => {
    if (!confirm(`Delete field "${fieldPath}"? This cannot be undone.`)) {
      return;
    }

    setSaving(true);
    try {
      // Determine target based on field path
      const target = fieldPath.includes('.') ? 'document_metadata' : 'custom_metadata';
      await metadataService.removeFields(documentId, [fieldPath], target);
      await loadMetadata(documentId);
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete field: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRenameField = async (oldFieldPath, newFieldPath, value) => {
    if (oldFieldPath === newFieldPath) {
      return; // No change
    }

    setSaving(true);
    try {
      // Determine targets
      const oldTarget = oldFieldPath.includes('.') ? 'document_metadata' : 'custom_metadata';
      const newTarget = newFieldPath.includes('.') ? 'document_metadata' : 'custom_metadata';

      // Create new field
      await updateField(documentId, newFieldPath, value, newTarget);
      
      // Delete old field
      await metadataService.removeFields(documentId, [oldFieldPath], oldTarget);
      
      // Reload metadata
      await loadMetadata(documentId);
    } catch (err) {
      console.error('Rename failed:', err);
      alert('Failed to rename field: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const structuredData = metadata?.document_metadata || {};
  const customData = metadata?.custom_metadata || {};

  // Flatten data for table view
  const getTableData = () => {
    const rows = [];
    
    const addRows = (obj, prefix = '') => {
      Object.entries(obj).forEach(([key, value]) => {
        const fieldPath = prefix ? `${prefix}.${key}` : key;
        const displayName = formatLabel(fieldPath);
        
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          // Nested object - recurse
          addRows(value, fieldPath);
        } else {
          // Get usage info
          const usage = fieldUsageMap[fieldPath] || { paragraphs: [], count: 0 };
          
          // Add to table
          rows.push({
            fieldPath,
            displayName,
            value: value,
            type: getFieldType(value),
            usageCount: usage.count,
            usedIn: usage.paragraphs
          });
        }
      });
    };

    addRows(structuredData);
    addRows(customData);

    return rows;
  };

  const getFieldType = (value) => {
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
    if (typeof value === 'number') return 'number';
    return 'text';
  };

  const tableData = getTableData();

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
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b">Field Name</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b">Value</th>
              <th className="px-4 py-3 text-center font-semibold text-gray-700 border-b">Used In</th>
              <th className="px-4 py-3 text-center font-semibold text-gray-700 border-b w-20">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {tableData.length === 0 ? (
              <tr>
                <td colSpan="4" className="px-4 py-12 text-center text-gray-500">
                  <div>No metadata fields found</div>
                </td>
              </tr>
            ) : (
              tableData.map((row) => (
                <TableRow
                  key={row.fieldPath}
                  row={row}
                  onSave={handleQuickUpdate}
                  onDelete={handleDelete}
                  onRename={handleRenameField}
                  saving={saving}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Table Row Component
// ---------------------------------------------------------------------------

const TableRow = ({ row, onSave, onDelete, onRename, saving }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingKey, setIsEditingKey] = useState(false);
  const [localValue, setLocalValue] = useState(row.value);
  const [localKey, setLocalKey] = useState(row.fieldPath);

  useEffect(() => {
    setLocalValue(row.value);
    setLocalKey(row.fieldPath);
  }, [row.value, row.fieldPath]);

  const handleSaveEdit = async () => {
    // Check if key changed
    if (localKey !== row.fieldPath) {
      // Rename operation
      await onRename(row.fieldPath, localKey, localValue);
    } else if (localValue !== row.value) {
      // Just value changed
      await onSave(row.fieldPath, localValue);
    }
    setIsEditing(false);
    setIsEditingKey(false);
  };

  const handleCancelEdit = () => {
    setLocalValue(row.value);
    setLocalKey(row.fieldPath);
    setIsEditing(false);
    setIsEditingKey(false);
  };

  const handleDeleteClick = async () => {
    await onDelete(row.fieldPath);
  };

  const renderValue = () => {
    if (isEditing) {
      return renderEditInput();
    }

  const displayValue = localValue ?? '';

    switch (row.type) {
      case 'boolean':
        return displayValue ? 'Yes' : 'No';
      case 'date':
        return formatDate(displayValue);
      case 'array':
        return JSON.stringify(displayValue);
      case 'number':
        return displayValue;
      default:
        if (typeof displayValue === 'string') {
          return <span className="whitespace-pre-wrap">{displayValue || '—'}</span>;
        }
        return displayValue || '—';
    }
  };

  const renderEditInput = () => {
    switch (row.type) {
      case 'boolean':
        return (
          <select
            value={localValue ? 'true' : 'false'}
            onChange={(e) => setLocalValue(e.target.value === 'true')}
            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        );
      case 'date':
        return (
          <input
            type="date"
            value={localValue || ''}
            onChange={(e) => setLocalValue(e.target.value)}
            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
        );
      case 'array':
        return (
          <textarea
            value={JSON.stringify(localValue, null, 2)}
            onChange={(e) => {
              try {
                setLocalValue(JSON.parse(e.target.value));
              } catch {
                // Invalid JSON, keep as string
              }
            }}
            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={3}
            autoFocus
          />
        );
      default:
        return (
          <textarea
            value={localValue || ''}
            onChange={(e) => setLocalValue(e.target.value)}
            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={Math.min(6, Math.max(2, String(localValue || '').split('\n').length))}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSaveEdit();
              if (e.key === 'Escape') handleCancelEdit();
            }}
          />
        );
    }
  };

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3 text-gray-900 font-medium">
        {isEditingKey ? (
          <input
            type="text"
            value={localKey}
            onChange={(e) => setLocalKey(e.target.value)}
            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            placeholder="Field name (e.g., dates.invoice_date)"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveEdit();
              if (e.key === 'Escape') handleCancelEdit();
            }}
          />
        ) : (
          <div className="flex items-center justify-between group">
            <span>{row.displayName}</span>
            <button
              onClick={() => {
                setIsEditingKey(true);
                setIsEditing(true);
              }}
              className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              title="Edit field name"
            >
              Rename
            </button>
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <div className="flex-1">
              {renderValue()}
            </div>
            <button
              onClick={handleSaveEdit}
              disabled={saving}
              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              title="Save"
            >
              Save
            </button>
            <button
              onClick={handleCancelEdit}
              className="px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
              title="Cancel"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between group">
            <span className="text-gray-700">{renderValue()}</span>
            <button
              onClick={() => setIsEditing(true)}
              className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              title="Edit"
            >
              Edit
            </button>
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        {row.usageCount > 0 ? (
          <div className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium" title={row.usedIn.map(u => `${u.sectionTitle} - Para ${u.paragraphIndex + 1}`).join('\n')}>
            <span>{row.usageCount}</span>
            <span className="text-blue-500">paragraph{row.usageCount > 1 ? 's' : ''}</span>
          </div>
        ) : (
          <span className="text-gray-400 text-xs">Not used</span>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        <button
          onClick={handleDeleteClick}
          disabled={saving}
          className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
          title="Delete field"
        >
          <Trash2 size={16} />
        </button>
      </td>
    </tr>
  );
};

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

const formatLabel = (text) => {
  return text
    .replace(/_/g, ' ')
    .split('.')
    .map(part => part.replace(/\b\w/g, char => char.toUpperCase()))
    .join(' > ');
};

const formatDate = (dateString) => {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch {
    return dateString;
  }
};

export default MetadataTableEditor;
