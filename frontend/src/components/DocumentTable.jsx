import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, Plus, Trash2, Settings, Bot, MessageCircle } from 'lucide-react';

const DocumentTable = ({
  table,
  editable = true,
  onMoveUp,
  onMoveDown,
  onOpenMetadata,
  onAiChat,
  onFocusEditor,
  onUpdate,
  onDelete,
  className = '',
  reviewCommentCount = null,
  onOpenReviewComments,
}) => {
  const normalizeTableData = (rawTable) => {
    const rawHeaders = rawTable?.data?.headers ?? rawTable?.column_headers ?? [];
    const headerItems = Array.isArray(rawHeaders) ? rawHeaders : Object.values(rawHeaders || {});
    const headers = headerItems.map((header) => {
      if (header && typeof header === 'object') {
        return header.label ?? header.name ?? header.id ?? '';
      }
      return header ?? '';
    });
    const rawRows = rawTable?.data?.rows ?? rawTable?.table_data ?? [];
    const rowsArray = Array.isArray(rawRows) ? rawRows : Object.values(rawRows || {});
    const rows = rowsArray.map((row) => {
      if (Array.isArray(row)) return row;

      const rowKeys = headerItems.map((header) => (
        header && typeof header === 'object' ? header.id || header.label : header
      ));

      if (row && row.cells && typeof row.cells === 'object' && !Array.isArray(row.cells)) {
        return rowKeys.map((key) => (key ? row.cells[key] ?? '' : ''));
      }

      if (row && Array.isArray(row.cells)) return row.cells;

      if (row && typeof row === 'object') {
        const hasHeaderKeys = rowKeys.some((key) => key && Object.prototype.hasOwnProperty.call(row, key));
        if (hasHeaderKeys) {
          return rowKeys.map((key) => (key ? row[key] ?? '' : ''));
        }
        return Object.values(row);
      }

      if (row == null) return [];
      return [row];
    });
    const normalizedRows = rows.map((row) => {
      if (!Array.isArray(row)) return [];
      if (headers.length === 0) return row;
      if (row.length >= headers.length) return row;
      return [...row, ...Array.from({ length: headers.length - row.length }, () => '')];
    });

    return {
      ...rawTable,
      caption: rawTable?.caption ?? rawTable?.title ?? 'Untitled Table',
      data: {
        headers,
        rows: normalizedRows,
      },
    };
  };

  const normalizedTable = useMemo(() => normalizeTableData(table), [table]);

  const [localTable, setLocalTable] = useState(normalizedTable);

  useEffect(() => {
    setLocalTable(normalizedTable);
  }, [normalizedTable]);

  const updateTable = (next) => {
    const normalizedNext = normalizeTableData(next);
    setLocalTable(normalizedNext);
    onUpdate?.(normalizedNext);
  };

  const handleCaptionChange = (value) => {
    updateTable({ ...localTable, caption: value });
  };

  const handleHeaderChange = (index, value) => {
    const headers = [...localTable.data.headers];
    headers[index] = value;
    updateTable({ ...localTable, data: { ...localTable.data, headers } });
  };

  const handleCellChange = (rowIndex, colIndex, value) => {
    const rows = localTable.data.rows.map((row, idx) =>
      idx === rowIndex ? row.map((cell, colIdx) => (colIdx === colIndex ? value : cell)) : row
    );
    updateTable({ ...localTable, data: { ...localTable.data, rows } });
  };

  const handleAddRow = () => {
    const newRow = localTable.data.headers.map(() => '');
    const rows = [...localTable.data.rows, newRow];
    updateTable({ ...localTable, data: { ...localTable.data, rows } });
  };

  const handleRemoveRow = (rowIndex) => {
    const rows = localTable.data.rows.filter((_, idx) => idx !== rowIndex);
    updateTable({ ...localTable, data: { ...localTable.data, rows } });
  };

  const handleAddColumn = () => {
    const headers = [...localTable.data.headers, `Column ${localTable.data.headers.length + 1}`];
    const rows = localTable.data.rows.map((row) => [...row, '']);
    updateTable({ ...localTable, data: { ...localTable.data, headers, rows } });
  };

  const handleRemoveColumn = (colIndex) => {
    const headers = localTable.data.headers.filter((_, idx) => idx !== colIndex);
    const rows = localTable.data.rows.map((row) => row.filter((_, idx) => idx !== colIndex));
    updateTable({ ...localTable, data: { ...localTable.data, headers, rows } });
  };

  const tableId = localTable?.id || localTable?.client_id;

  return (
    <div
      className={`document-table ${className}`}
      data-metadata-anchor="table"
      data-metadata-id={tableId}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <input
          type="text"
          value={localTable.caption}
          onChange={(e) => handleCaptionChange(e.target.value)}
          className="w-full rounded border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Table caption"
          disabled={!editable}
        />
        {editable && (
          <div className="flex items-center gap-2">
            <button
              onClick={onMoveUp}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded"
              title="Move table up"
              type="button"
              disabled={!onMoveUp}
            >
              <ChevronUp size={16} />
            </button>
            <button
              onClick={onMoveDown}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded"
              title="Move table down"
              type="button"
              disabled={!onMoveDown}
            >
              <ChevronDown size={16} />
            </button>
            <button
              onClick={() => onOpenMetadata?.({ id: tableId, label: localTable.caption || 'Table', metadata: localTable.metadata || {}, type: 'table' })}
              className="p-2 text-indigo-600 hover:bg-indigo-50 rounded"
              title="Edit table metadata"
              type="button"
            >
              <Settings size={16} />
            </button>
            {onAiChat && (
              <button
                onClick={() => onAiChat({ scope: 'table', scopeId: tableId, scopeLabel: localTable.caption || 'Table' })}
                className="p-2 text-purple-600 hover:bg-purple-50 rounded"
                title="AI Chat – this table"
                type="button"
              >
                <Bot size={16} />
              </button>
            )}
            {onOpenReviewComments && (
              <button
                onClick={(e) => { e.stopPropagation(); onOpenReviewComments(); }}
                className={`p-2 rounded relative ${
                  reviewCommentCount?.unresolved > 0
                    ? 'text-orange-600 hover:bg-orange-50'
                    : reviewCommentCount?.total > 0
                      ? 'text-green-600 hover:bg-green-50'
                      : 'text-gray-400 hover:bg-gray-50'
                }`}
                title={
                  reviewCommentCount?.total
                    ? `${reviewCommentCount.total} comment${reviewCommentCount.total !== 1 ? 's' : ''}${reviewCommentCount.unresolved ? ` (${reviewCommentCount.unresolved} open)` : ''}`
                    : 'Review comments'
                }
                type="button"
              >
                <MessageCircle size={16} />
                {reviewCommentCount?.total > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full text-[8px] font-bold leading-none text-white bg-orange-500">
                    {reviewCommentCount.total}
                  </span>
                )}
              </button>
            )}
            <button
              onClick={() => onDelete?.()}
              className="p-2 text-red-500 hover:bg-red-50 rounded"
              title="Delete table"
              type="button"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded">
        <table className="min-w-full text-sm table-fixed">
          <thead className="bg-gray-50">
            <tr>
              {localTable.data.headers.map((header, idx) => (
                <th key={`header-${idx}`} className="border-b border-gray-200 px-3 py-2 text-left align-top">
                  <div className="flex items-center gap-2">
                    <EditableCell
                      className="w-full bg-transparent focus:outline-none whitespace-pre-wrap"
                      value={header || ''}
                      onChange={(value) => handleHeaderChange(idx, value)}
                      editable={editable}
                      onFocusEditor={onFocusEditor}
                    />
                    {editable && (
                      <button
                        onClick={() => handleRemoveColumn(idx)}
                        className="text-gray-400 hover:text-red-500"
                        title="Remove column"
                        type="button"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </th>
              ))}
              {editable && (
                <th className="border-b border-gray-200 px-2 py-2 text-left">
                  <button
                    onClick={handleAddColumn}
                    className="text-gray-500 hover:text-blue-600"
                    title="Add column"
                    type="button"
                  >
                    <Plus size={14} />
                  </button>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {(Array.isArray(localTable?.data?.rows) ? localTable.data.rows : []).map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`} className="border-b border-gray-100">
                {(Array.isArray(row) ? row : normalizeTableData({ data: { rows: [row], headers: localTable.data.headers } }).data.rows[0]).map((cell, colIndex) => (
                  <td key={`cell-${rowIndex}-${colIndex}`} className="px-3 py-2 align-top">
                    <EditableCell
                      className="w-full bg-transparent focus:outline-none whitespace-pre-wrap"
                      value={cell || ''}
                      onChange={(value) => handleCellChange(rowIndex, colIndex, value)}
                      editable={editable}
                      onFocusEditor={onFocusEditor}
                    />
                  </td>
                ))}
                {editable && (
                  <td className="px-2 py-2">
                    <button
                      onClick={() => handleRemoveRow(rowIndex)}
                      className="text-gray-400 hover:text-red-500"
                      title="Remove row"
                      type="button"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={handleAddRow}
            className="inline-flex items-center gap-2 rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            type="button"
          >
            <Plus size={12} /> Add Row
          </button>
          <button
            onClick={handleAddColumn}
            className="inline-flex items-center gap-2 rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            type="button"
          >
            <Plus size={12} /> Add Column
          </button>
        </div>
      )}
    </div>
  );
};

const EditableCell = ({
  value,
  onChange,
  editable,
  onFocusEditor,
  className = '',
}) => {
  const cellRef = useRef(null);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!cellRef.current || isFocused) return;

    const nextValue = value || '';
    if (cellRef.current.innerHTML !== nextValue) {
      cellRef.current.innerHTML = nextValue;
    }
  }, [value, isFocused]);

  return (
    <div
      ref={cellRef}
      className={className}
      style={{ whiteSpace: 'pre-wrap', wordBreak: 'normal', overflowWrap: 'normal' }}
      contentEditable={editable}
      suppressContentEditableWarning
      onInput={(event) => onChange?.(event.currentTarget.innerHTML)}
      onFocus={(event) => {
        setIsFocused(true);
        onFocusEditor?.(event.currentTarget);
      }}
      onBlur={(event) => {
        setIsFocused(false);
        if (event.currentTarget.innerHTML !== (value || '')) {
          onChange?.(event.currentTarget.innerHTML);
        }
      }}
      role="textbox"
      aria-multiline="true"
      data-placeholder=""
    />
  );
};

export default DocumentTable;
