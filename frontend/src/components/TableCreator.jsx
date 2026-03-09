import React, { useState } from 'react';
import { Plus, X, Table } from 'lucide-react';

/**
 * TableCreator Component
 * Dialog for creating new tables in a section
 */
const TableCreator = ({ sectionId, onTableCreated, onCancel }) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    type: 'data',
    columns: ['Column 1', 'Column 2', 'Column 3'],
    rows: 5,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.title.trim()) {
      setError('Table title is required');
      return;
    }

    if (formData.columns.length === 0) {
      setError('At least one column is required');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      if (!onTableCreated) {
        throw new Error('Missing onTableCreated handler');
      }
  await onTableCreated({ ...formData, sectionId });
    } catch (err) {
      console.error('Error creating table:', err);
      setError('Failed to create table. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const addColumn = () => {
    setFormData({
      ...formData,
      columns: [...formData.columns, `Column ${formData.columns.length + 1}`],
    });
  };

  const removeColumn = (index) => {
    if (formData.columns.length <= 1) return;
    const newColumns = formData.columns.filter((_, i) => i !== index);
    setFormData({ ...formData, columns: newColumns });
  };

  const updateColumn = (index, value) => {
    const newColumns = [...formData.columns];
    newColumns[index] = value;
    setFormData({ ...formData, columns: newColumns });
  };

  return (
    <div className="table-creator-overlay">
      <div className="table-creator-dialog">
        <div className="dialog-header">
          <div className="flex items-center gap-2">
            <Table size={20} className="text-blue-600" />
            <h2 className="dialog-title">Create New Table</h2>
          </div>
          <button onClick={onCancel} className="btn-icon btn-icon-ghost">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="dialog-content">
          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          {/* Title */}
          <div className="form-group">
            <label className="form-label">
              Table Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="e.g., Product Pricing, Results Summary"
              className="form-input"
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="form-group">
            <label className="form-label">Description (optional)</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Brief description of the table..."
              className="form-textarea"
              rows={2}
            />
          </div>

          {/* Table Type */}
          <div className="form-group">
            <label className="form-label">Table Type</label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              className="form-select"
            >
              <option value="data">Data Table</option>
              <option value="pricing">Pricing Table</option>
              <option value="comparison">Comparison Table</option>
              <option value="schedule">Schedule</option>
              <option value="results">Results/Findings</option>
            </select>
          </div>

          {/* Columns */}
          <div className="form-group">
            <div className="flex items-center justify-between mb-2">
              <label className="form-label mb-0">Columns</label>
              <button
                type="button"
                onClick={addColumn}
                className="btn-secondary btn-xs"
                disabled={formData.columns.length >= 10}
              >
                <Plus size={14} />
                Add Column
              </button>
            </div>
            <div className="columns-list">
              {formData.columns.map((col, index) => (
                <div key={index} className="column-item">
                  <span className="column-number">{index + 1}</span>
                  <input
                    type="text"
                    value={col}
                    onChange={(e) => updateColumn(index, e.target.value)}
                    className="column-input"
                    placeholder={`Column ${index + 1}`}
                  />
                  {formData.columns.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeColumn(index)}
                      className="btn-icon btn-icon-danger btn-icon-xs"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {formData.columns.length >= 10 && (
              <p className="text-xs text-gray-500 mt-1">
                Maximum 10 columns for initial setup. You can add more later.
              </p>
            )}
          </div>

          {/* Rows */}
          <div className="form-group">
            <label className="form-label">Initial Number of Rows</label>
            <input
              type="number"
              value={formData.rows}
              onChange={(e) =>
                setFormData({ ...formData, rows: parseInt(e.target.value) || 1 })
              }
              min={1}
              max={100}
              className="form-input"
            />
            <p className="text-xs text-gray-500 mt-1">
              You can add more rows later
            </p>
          </div>

          {/* Actions */}
          <div className="dialog-actions">
            <button
              type="button"
              onClick={onCancel}
              className="btn-secondary"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={loading || !formData.title.trim()}
            >
              {loading ? 'Creating...' : 'Create Table'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TableCreator;
