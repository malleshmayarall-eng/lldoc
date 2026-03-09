import api from './api';

/**
 * Table Service
 * Handles all table-related API operations for the document system.
 *
 * Architecture (2025):
 * - Creates/deletes go through direct REST endpoints (real UUID on creation).
 * - Updates are handled by SaveCoordinator → partial-save (debounced).
 * - No more save-structure or temp IDs in this service.
 */

const API_BASE = '/documents';

const tableService = {
  /**
   * Create a table directly via POST (returns real UUID immediately).
   * Use this for the create-first approach: POST → get ID → add to local state.
   * @param {string} sectionId - Real section UUID
   * @param {Object} tableData - Table configuration
   * @returns {Promise<Object>} Created table with server-assigned UUID
   */
  async createTable(sectionId, tableData = {}) {
    const headers = Array.isArray(tableData.column_headers)
      ? tableData.column_headers
      : Array.isArray(tableData.columns)
        ? tableData.columns
        : Array.isArray(tableData.columnNames)
          ? tableData.columnNames
          : [];
    const rows = Array.isArray(tableData.table_data)
      ? tableData.table_data
      : Array.isArray(tableData.rows)
        ? tableData.rows
        : [];
    const response = await api.post(`${API_BASE}/tables/`, {
      section: sectionId,
      title: tableData.title ?? tableData.caption ?? '',
      description: tableData.description ?? '',
      table_type: tableData.table_type ?? tableData.tableType ?? 'data',
      order: tableData.order ?? 0,
      num_columns: headers.length || tableData.num_columns || 1,
      num_rows: rows.length || tableData.num_rows || 1,
      column_headers: headers,
      table_data: rows,
      data: tableData.data ?? { headers, rows },
    });
    return response.data;
  },

  /**
   * @deprecated Use createTable() instead — direct POST with real UUID response.
   */
  async createTableViaSaveStructure() {
    throw new Error('createTableViaSaveStructure is removed. Use createTable() for direct API creation.');
  },

  /**
   * @deprecated Use createTable() instead.
   */
  async createInitializedTable() {
    throw new Error('createInitializedTable is removed. Use createTable().');
  },

  /**
   * @deprecated Use createTable() instead.
   */
  async createEmptyTable() {
    throw new Error('createEmptyTable is removed. Use createTable().');
  },

  /**
   * Get all tables in a section
   * @param {string} sectionId - The section ID
   * @returns {Promise<Array>} List of tables
   */
  async getTablesInSection(sectionId) {
    try {
      const response = await api.get(`${API_BASE}/tables/`, {
        params: { section: sectionId },
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching tables in section:', error);
      throw error;
    }
  },

  /**
   * Get a single table by ID
   * @param {string} tableId - The table ID
   * @returns {Promise<Object>} Table data
   */
  async getTable(tableId) {
    try {
      const response = await api.get(`${API_BASE}/tables/${tableId}/`);
      return response.data;
    } catch (error) {
      console.error('Error fetching table:', error);
      throw error;
    }
  },

  /**
   * Update a single cell
   * @param {string} tableId - The table ID
   * @param {string} rowId - The row ID
   * @param {string} colId - The column ID
   * @param {string} value - The new value
   * @returns {Promise<Object>} Updated cell data
   */
  async updateCell(tableId, rowId, colId, value) {
    try {
      const response = await api.post(`${API_BASE}/tables/${tableId}/update-cell/`, {
        row_id: rowId,
        col_id: colId,
        value: value,
      });
      return response.data;
    } catch (error) {
      console.error('Error updating cell:', error);
      throw error;
    }
  },

  /**
   * Bulk update multiple cells
   * @param {string} tableId - The table ID
   * @param {Array} updates - Array of {rowId, colId, value}
   * @returns {Promise<Array>} Results of all updates
   */
  async bulkUpdateCells(tableId, updates) {
    try {
      const promises = updates.map(update =>
        this.updateCell(tableId, update.rowId, update.colId, update.value)
      );
      return await Promise.all(promises);
    } catch (error) {
      console.error('Error bulk updating cells:', error);
      throw error;
    }
  },

  /**
   * Add a new row
   * @param {string} tableId - The table ID
   * @param {Object} rowData - Row data as {colId: value}
   * @param {number} position - Position to insert (null = append)
   * @returns {Promise<Object>} Added row data
   */
  async addRow(tableId, rowData, position = null) {
    try {
      const response = await api.post(`${API_BASE}/tables/${tableId}/add-row/`, {
        row_data: rowData,
        position: position,
      });
      return response.data;
    } catch (error) {
      console.error('Error adding row:', error);
      throw error;
    }
  },

  /**
   * Delete a row
   * @param {string} tableId - The table ID
   * @param {string} rowId - The row ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteRow(tableId, rowId) {
    try {
      const response = await api.post(`${API_BASE}/tables/${tableId}/delete-row/`, {
        row_id: rowId,
      });
      return response.data;
    } catch (error) {
      console.error('Error deleting row:', error);
      throw error;
    }
  },

  /**
   * Add a new column
   * @param {string} tableId - The table ID
   * @param {string} columnLabel - Column label
   * @param {Object} config - Column config {width, align, type}
   * @param {number} position - Position to insert (null = append)
   * @returns {Promise<Object>} Added column data
   */
  async addColumn(tableId, columnLabel, config = {}, position = null) {
    try {
      const response = await api.post(`${API_BASE}/tables/${tableId}/add-column/`, {
        column_label: columnLabel,
        column_config: {
          width: config.width || 'auto',
          align: config.align || 'left',
          type: config.type || 'text',
        },
        position: position,
      });
      return response.data;
    } catch (error) {
      console.error('Error adding column:', error);
      throw error;
    }
  },

  /**
   * Delete a column
   * @param {string} tableId - The table ID
   * @param {string} colId - The column ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteColumn(tableId, colId) {
    try {
      const response = await api.post(`${API_BASE}/tables/${tableId}/delete-column/`, {
        col_id: colId,
      });
      return response.data;
    } catch (error) {
      console.error('Error deleting column:', error);
      throw error;
    }
  },

  /**
   * Update table metadata
   * @param {string} tableId - The table ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated table
   */
  async updateTable(tableId, updates) {
    try {
      const response = await api.patch(`${API_BASE}/tables/${tableId}/`, updates);
      return response.data;
    } catch (error) {
      console.error('Error updating table:', error);
      throw error;
    }
  },

  /**
   * Delete a table
   * @param {string} tableId - The table ID
   * @returns {Promise<void>}
   */
  async deleteTable(tableId) {
    try {
      await api.delete(`${API_BASE}/tables/${tableId}/`);
    } catch (error) {
      console.error('Error deleting table:', error);
      throw error;
    }
  },

  /**
   * Export table to CSV format
   * @param {Object} table - Table data
   * @returns {Blob} CSV blob
   */
  exportTableToCSV(table) {
    // Create CSV header
    const headers = table.column_headers.map(col => col.label);
    let csv = headers.join(',') + '\n';

    // Add rows
    table.table_data.forEach(row => {
      const values = table.column_headers.map(col => {
        const value = row.cells[col.id] || '';
        // Escape commas and quotes
        return `"${value.replace(/"/g, '""')}"`;
      });
      csv += values.join(',') + '\n';
    });

    return new Blob([csv], { type: 'text/csv' });
  },

  /**
   * Download table as CSV file
   * @param {Object} table - Table data
   */
  downloadTableAsCSV(table) {
    const blob = this.exportTableToCSV(table);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${table.title || 'table'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  /**
   * Import CSV data to table
   * @param {string} tableId - The table ID
   * @param {File} csvFile - CSV file
   * @returns {Promise<void>}
   */
  async importCSVToTable(tableId, csvFile) {
    try {
      const text = await csvFile.text();
      const lines = text.split('\n').filter(line => line.trim());

      // Skip header row (line 0)
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v =>
          v.trim().replace(/^"|"$/g, '')
        );

        // Create row data object
        const rowData = {};
        values.forEach((value, index) => {
          rowData[`col${index + 1}`] = value;
        });

        // Add row
        await this.addRow(tableId, rowData);
      }
    } catch (error) {
      console.error('Error importing CSV:', error);
      throw error;
    }
  },
};

export default tableService;
