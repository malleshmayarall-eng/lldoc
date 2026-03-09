import React, { useState, useEffect } from 'react';
import { Table, Plus, X, ArrowRight, ArrowLeft } from 'lucide-react';

/**
 * InlineTableCreator - Floating dialog for creating tables
 * Modern, intuitive popup interface
 */
const InlineTableCreator = ({ 
  sectionId, 
  onTableCreated, 
  onCancel,
  className = '' 
}) => {
  const [step, setStep] = useState(1); // 1: Quick setup, 2: Column config
  const [title, setTitle] = useState('');
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [columnNames, setColumnNames] = useState(['Column 1', 'Column 2', 'Column 3']);
  const [tableType, setTableType] = useState('data');

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onCancel]);

  const handleNext = () => {
    if (!title.trim()) {
      alert('Please enter a table title');
      return;
    }
    
    // Auto-generate column names based on selected columns
    const newColumnNames = Array.from({ length: cols }, (_, i) => 
      columnNames[i] || `Column ${i + 1}`
    );
    setColumnNames(newColumnNames);
    setStep(2);
  };

  const handleCreate = () => {
    const tableData = {
      title: title.trim(),
      columnNames: columnNames.slice(0, cols),
      rows,
      columns: cols,
      tableType,
    };
    console.log('📊 Creating table with data:', tableData);
    onTableCreated(tableData);
  };

  const updateColumnName = (index, value) => {
    const newNames = [...columnNames];
    newNames[index] = value;
    setColumnNames(newNames);
  };

  return (
    <>
      {/* Backdrop */}
      <div 
        className="table-creator-backdrop"
        onClick={onCancel}
      />
      
      {/* Floating Dialog */}
      <div className="table-creator-dialog">
        <div className="creator-card">
          <div className="creator-header">
            <div className="flex items-center gap-2">
              <div className="icon-circle">
                <Table size={20} />
              </div>
              <h3 className="creator-title">
                {step === 1 ? 'Create New Table' : 'Name Your Columns'}
              </h3>
            </div>
            <button onClick={onCancel} className="btn-icon-close" title="Close (Esc)">
              <X size={20} />
            </button>
          </div>

          {step === 1 ? (
            <div className="creator-body">
              {/* Title Input */}
              <div className="form-group">
                <label className="form-label">Table Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Product Comparison, Results Summary"
                  className="form-input-modern"
                  autoFocus
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && title.trim()) handleNext();
                  }}
                />
              </div>

              {/* Size Grid Picker */}
              <div className="form-group">
                <label className="form-label">Table Size</label>
                <div className="size-grid">
                  {/* Rows Picker */}
                  <div className="size-picker">
                    <label className="size-label">Rows</label>
                    <div className="size-buttons">
                      {[1, 2, 3, 4, 5, 6, 8, 10].map(num => (
                        <button
                          key={`row-${num}`}
                          type="button"
                          onClick={() => setRows(num)}
                          className={`size-btn ${rows === num ? 'active' : ''}`}
                        >
                          {num}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Columns Picker */}
                  <div className="size-picker">
                    <label className="size-label">Columns</label>
                  <div className="size-buttons">
                    {[2, 3, 4, 5, 6, 8].map(num => (
                      <button
                        key={`col-${num}`}
                        type="button"
                        onClick={() => setCols(num)}
                        className={`size-btn ${cols === num ? 'active' : ''}`}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Table Type */}
            <div className="form-group">
              <label className="form-label">Table Type</label>
              <div className="type-grid">
                {[
                  { value: 'data', label: 'Data', icon: '📊' },
                  { value: 'pricing', label: 'Pricing', icon: '💰' },
                  { value: 'comparison', label: 'Comparison', icon: '⚖️' },
                  { value: 'schedule', label: 'Schedule', icon: '📅' },
                ].map(type => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setTableType(type.value)}
                    className={`type-btn ${tableType === type.value ? 'active' : ''}`}
                  >
                    <span className="type-icon">{type.icon}</span>
                    <span className="type-label">{type.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Preview */}
            <div className="table-preview">
              <div className="preview-label">Preview: {cols} × {rows} table</div>
              <div className="preview-grid" style={{
                gridTemplateColumns: `repeat(${cols}, 1fr)`
              }}>
                {Array.from({ length: cols * Math.min(rows, 3) }).map((_, i) => (
                  <div 
                    key={i} 
                    className={`preview-cell ${i < cols ? 'header' : ''}`}
                  />
                ))}
                {rows > 3 && (
                  <div className="preview-more" style={{ gridColumn: `1 / ${cols + 1}` }}>
                    +{rows - 3} more rows
                  </div>
                )}
              </div>
            </div>
            
            <div className="creator-footer">
              <button onClick={onCancel} className="btn-secondary">
                Cancel
              </button>
              <button 
                onClick={handleNext} 
                className="btn-primary"
                disabled={!title.trim()}
              >
                Next: Column Names →
              </button>
            </div>
          </div>
          ) : (
            <div className="creator-body">
              <div className="column-config-grid">
                {columnNames.slice(0, cols).map((name, index) => (
                  <div key={index} className="column-config-item">
                    <div className="column-number">{index + 1}</div>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => updateColumnName(index, e.target.value)}
                      placeholder={`Column ${index + 1}`}
                      className="column-name-input"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter' && index === cols - 1) {
                          handleCreate();
                        }
                      }}
                    />
                  </div>
                ))}
              </div>

              <div className="config-summary">
                <p className="summary-text">
                  Creating <strong>{title}</strong> with {cols} columns and {rows} rows
                </p>
              </div>
              
              <div className="creator-footer">
                <button onClick={() => setStep(1)} className="btn-secondary">
                  ← Back
                </button>
                <button onClick={handleCreate} className="btn-primary">
                  Create Table
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default InlineTableCreator;
