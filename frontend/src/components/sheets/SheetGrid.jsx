/**
 * SheetGrid — professional spreadsheet grid component
 *
 * Features:
 *  - Virtual scrolling for 1000+ row performance
 *  - Multi-cell selection (shift+click, drag-select)
 *  - Drag-to-fill handle (auto-fill / increment)
 *  - Column sorting & filtering
 *  - Freeze first column (sticky row numbers)
 *  - Row numbers, column headers, context menu
 *  - Formula support & search highlighting
 *  - Column config popover & formula dialog
 *  - Keyboard navigation (arrows, tab, enter, delete)
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  ChevronDown, Trash2, Plus, FunctionSquare, X, Check,
  ArrowUpDown, ArrowUp, ArrowDown, Filter, FilterX,
} from 'lucide-react';
import useSheetsStore, { validateCellValue } from '../../store/sheetsStore';

// ── Constants ────────────────────────────────────────────────────────

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 36;
const ROW_NUM_WIDTH = 48;
const BUFFER_ROWS = 10;
const DEFAULT_COL_WIDTH = 120;

export default function SheetGrid({ onScrollEnd }) {
  // ── Store selectors ────────────────────────────────────────────────
  const currentSheet = useSheetsStore((s) => s.currentSheet);
  const cellValues = useSheetsStore((s) => s.cellValues);
  const computedValues = useSheetsStore((s) => s.computedValues);
  const cellErrors = useSheetsStore((s) => s.cellErrors);
  const selectedCell = useSheetsStore((s) => s.selectedCell);
  const editingCell = useSheetsStore((s) => s.editingCell);
  const selectCell = useSheetsStore((s) => s.selectCell);
  const startEditing = useSheetsStore((s) => s.startEditing);
  const stopEditing = useSheetsStore((s) => s.stopEditing);
  const setCellValue = useSheetsStore((s) => s.setCellValue);
  const setFormulaBarValue = useSheetsStore((s) => s.setFormulaBarValue);
  const deleteRow = useSheetsStore((s) => s.deleteRow);
  const deleteColumn = useSheetsStore((s) => s.deleteColumn);
  const addRow = useSheetsStore((s) => s.addRow);
  const addColumn = useSheetsStore((s) => s.addColumn);
  const updateColumns = useSheetsStore((s) => s.updateColumns);
  const searchQuery = useSheetsStore((s) => s.searchQuery);
  const saveAllCells = useSheetsStore((s) => s.saveAllCells);
  const undo = useSheetsStore((s) => s.undo);
  const redo = useSheetsStore((s) => s.redo);
  const copySelection = useSheetsStore((s) => s.copySelection);
  const pasteSelection = useSheetsStore((s) => s.pasteSelection);
  const selectedRange = useSheetsStore((s) => s.selectedRange);
  const setSelectedRange = useSheetsStore((s) => s.setSelectedRange);
  const loadingMore = useSheetsStore((s) => s.loadingMore);
  const loadMoreRows = useSheetsStore((s) => s.loadMoreRows);
  const pagination = useSheetsStore((s) => s.pagination);

  // Enterprise server-side sort/filter/scroll
  const serverSort = useSheetsStore((s) => s.serverSort);
  const serverFilters = useSheetsStore((s) => s.serverFilters);
  const setServerSort = useSheetsStore((s) => s.setServerSort);
  const setServerFilter = useSheetsStore((s) => s.setServerFilter);
  const clearServerFilters = useSheetsStore((s) => s.clearServerFilters);
  const scrollToTarget = useSheetsStore((s) => s.scrollToTarget);
  const clearScrollTarget = useSheetsStore((s) => s.clearScrollTarget);

  // ── Local state ────────────────────────────────────────────────────
  const [editValue, setEditValue] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [resizing, setResizing] = useState(null);

  // Column formula dialog
  const [formulaDialog, setFormulaDialog] = useState(null);
  const formulaInputRef = useRef(null);

  // Column header config popover
  const [columnMenu, setColumnMenu] = useState(null);
  const [colEditLabel, setColEditLabel] = useState('');
  const [colEditType, setColEditType] = useState('text');
  const [colEditFormula, setColEditFormula] = useState('');
  const columnMenuRef = useRef(null);

  // Virtual scroll state
  const scrollContainerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  // Multi-cell selection via drag
  const [isDragging, setIsDragging] = useState(false);
  const dragStartCell = useRef(null);

  // Drag-to-fill
  const [isFilling, setIsFilling] = useState(false);
  const [fillPreview, setFillPreview] = useState(null);
  const fillAnchorRef = useRef(null);

  // Sort & filter — local state as fallback when server sort/filter not active
  const [sortConfig, setSortConfig] = useState(null);
  const [filterConfig, setFilterConfig] = useState({});
  const [filterPopover, setFilterPopover] = useState(null);
  const filterPopoverRef = useRef(null);
  const [filterText, setFilterText] = useState('');

  const gridRef = useRef(null);
  const editInputRef = useRef(null);

  const COLUMN_TYPES = [
    { value: 'text',     label: 'Text',     icon: 'Aa' },
    { value: 'number',   label: 'Number',   icon: '#' },
    { value: 'currency', label: 'Currency', icon: '$' },
    { value: 'date',     label: 'Date',     icon: '\u{1F4C5}' },
    { value: 'boolean',  label: 'Boolean',  icon: '\u2611' },
    { value: 'select',   label: 'Select',   icon: '\u25BE' },
    { value: 'json',     label: 'JSON',     icon: '{}' },
    { value: 'formula',  label: 'Formula',  icon: '\u0192' },
  ];

  // ── Derived data ───────────────────────────────────────────────────
  const columns = currentSheet?.columns || [];
  const rawRowCount = currentSheet?.row_count || 0;

  const formulaColKeys = useMemo(() => {
    const s = new Set();
    for (const col of columns) { if (col.formula) s.add(col.key); }
    return s;
  }, [columns]);

  const isFormulaCol = useCallback((colKey) => formulaColKeys.has(colKey), [formulaColKeys]);

  // ── Helper: normalize range ────────────────────────────────────────
  const normalizeRange = useCallback((range) => {
    if (!range) return null;
    return {
      startRow: Math.min(range.startRow, range.endRow),
      startCol: Math.min(range.startCol, range.endCol),
      endRow: Math.max(range.startRow, range.endRow),
      endCol: Math.max(range.startCol, range.endCol),
    };
  }, []);

  // ── Sorting & Filtering ────────────────────────────────────────────
  // When data is paginated (loaded via fetchSheetPaginated), the loaded
  // rows are already server-ordered — we use their `.order` fields directly.
  // Client-side sort/filter is only used as fallback for non-paginated loads.
  const isPaginated = !!pagination;

  const visibleRowIndices = useMemo(() => {
    if (isPaginated) {
      // Paginated mode: use loaded row order values directly from server
      const rows = currentSheet?.rows || [];
      return rows.map((r) => r.order);
    }
    // Fallback: non-paginated mode (old fetchSheet path), client-side sort/filter
    let indices = Array.from({ length: rawRowCount }, (_, i) => i);
    const activeFilters = Object.entries(filterConfig).filter(
      ([, cfg]) => cfg && (cfg.text || (cfg.values && cfg.values.size > 0))
    );
    if (activeFilters.length > 0) {
      indices = indices.filter((rowIdx) => {
        for (const [colKey, cfg] of activeFilters) {
          const key = rowIdx + '_' + colKey;
          const display = String(computedValues[key] ?? cellValues[key] ?? '');
          if (cfg.text && !display.toLowerCase().includes(cfg.text.toLowerCase())) return false;
          if (cfg.values && cfg.values.size > 0 && !cfg.values.has(display)) return false;
        }
        return true;
      });
    }
    if (sortConfig) {
      const { colKey, direction } = sortConfig;
      indices.sort((a, b) => {
        const aVal = computedValues[a + '_' + colKey] ?? cellValues[a + '_' + colKey] ?? '';
        const bVal = computedValues[b + '_' + colKey] ?? cellValues[b + '_' + colKey] ?? '';
        const aNum = Number(aVal), bNum = Number(bVal);
        if (!isNaN(aNum) && !isNaN(bNum) && aVal !== '' && bVal !== '') {
          return direction === 'asc' ? aNum - bNum : bNum - aNum;
        }
        const cmp = String(aVal).localeCompare(String(bVal));
        return direction === 'asc' ? cmp : -cmp;
      });
    }
    return indices;
  }, [isPaginated, currentSheet?.rows, rawRowCount, filterConfig, sortConfig, cellValues, computedValues]);

  const loadedRowCount = visibleRowIndices.length;
  const totalRowCount = isPaginated
    ? (pagination?.totalRows ?? loadedRowCount)
    : loadedRowCount;

  // ── Virtual scroll ─────────────────────────────────────────────────
  const totalHeight = loadedRowCount * ROW_HEIGHT + ROW_HEIGHT;
  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
  const endRow = Math.min(loadedRowCount - 1, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + BUFFER_ROWS);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const measure = () => setViewportHeight(container.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const handleScroll = useCallback((e) => {
    const el = e.target;
    setScrollTop(el.scrollTop);
  }, []);

  useEffect(() => {
    const remainingLoadedRows = loadedRowCount - 1 - endRow;
    if (loadedRowCount > 0 && remainingLoadedRows <= 0) {
      if (onScrollEnd) onScrollEnd();
      loadMoreRows();
    }
  }, [endRow, loadedRowCount, loadMoreRows, onScrollEnd]);

  // ── Scroll-to-target effect (search result navigation) ─────────
  useEffect(() => {
    if (!scrollToTarget || !scrollContainerRef.current) return;
    const { indexInPage } = scrollToTarget;
    if (indexInPage == null) return;
    // Scroll to the row's position in the viewport
    const targetTop = indexInPage * ROW_HEIGHT;
    scrollContainerRef.current.scrollTop = Math.max(0, targetTop - viewportHeight / 3);
    // Select the cell if a column key was specified
    const { colKey } = scrollToTarget;
    if (colKey) {
      const colIdx = columns.findIndex((c) => c.key === colKey);
      if (colIdx >= 0) selectCell(indexInPage, colIdx, colKey);
    }
    // Clear target so it doesn't re-trigger
    clearScrollTarget();
  }, [scrollToTarget, columns, selectCell, clearScrollTarget, viewportHeight]);

  // ── Column header popover ──────────────────────────────────────────
  const openColumnMenu = useCallback((colIdx, e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const col = columns[colIdx];
    if (!col) return;
    setColEditLabel(col.label);
    setColEditType(col.type || 'text');
    setColEditFormula(col.formula || '');
    setColumnMenu({ colIdx, colKey: col.key, rect });
  }, [columns]);

  const closeColumnMenu = useCallback(() => setColumnMenu(null), []);

  const saveColumnConfig = useCallback(async () => {
    if (!columnMenu || !currentSheet) return;
    const { colIdx } = columnMenu;
    const newCols = currentSheet.columns.map((c, i) => {
      if (i !== colIdx) return c;
      const updated = { ...c, label: colEditLabel || c.label, type: colEditType };
      if (colEditType === 'formula' && colEditFormula.trim()) {
        updated.formula = colEditFormula.startsWith('=') ? colEditFormula : '=' + colEditFormula;
      } else {
        delete updated.formula;
        if (colEditType === 'formula') updated.type = 'text';
      }
      return updated;
    });
    await updateColumns(newCols);
    setColumnMenu(null);
  }, [columnMenu, currentSheet, colEditLabel, colEditType, colEditFormula, updateColumns]);

  useEffect(() => {
    if (!columnMenu) return;
    const close = (e) => { if (columnMenuRef.current && !columnMenuRef.current.contains(e.target)) setColumnMenu(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [columnMenu]);

  // ── Focus edit input ───────────────────────────────────────────────
  useEffect(() => { if (editingCell && editInputRef.current) editInputRef.current.focus(); }, [editingCell]);

  // ── Global keyboard shortcuts ──────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveAllCells(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') { if (!editingCell) { e.preventDefault(); copySelection(); } return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') { if (!editingCell) { e.preventDefault(); pasteSelection(); } return; }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingCell, saveAllCells, undo, redo, copySelection, pasteSelection]);

  // ── Formula dialog ─────────────────────────────────────────────────
  const openFormulaDialog = useCallback((colIdx) => {
    const col = columns[colIdx];
    if (!col) return;
    setFormulaDialog({ colIdx, colKey: col.key, label: col.label, formula: col.formula || '' });
    setContextMenu(null);
    setTimeout(() => formulaInputRef.current?.focus(), 50);
  }, [columns]);

  const handleFormulaDialogCellClick = useCallback((colIdx) => {
    if (!formulaDialog) return false;
    const col = columns[colIdx];
    if (!col) return false;
    setFormulaDialog((prev) => ({ ...prev, formula: (prev.formula || '') + col.key + '{row}' }));
    return true;
  }, [formulaDialog, columns]);

  const saveColumnFormula = useCallback(async () => {
    if (!formulaDialog || !currentSheet) return;
    const { colIdx, formula } = formulaDialog;
    const newCols = currentSheet.columns.map((c, i) => {
      if (i !== colIdx) return c;
      if (formula.trim()) {
        return { ...c, type: 'formula', formula: formula.startsWith('=') ? formula : '=' + formula };
      }
      const { formula: _removed, ...rest } = c;
      return { ...rest, type: 'text' };
    });
    await updateColumns(newCols);
    setFormulaDialog(null);
  }, [formulaDialog, currentSheet, updateColumns]);

  // ── Navigation ─────────────────────────────────────────────────────
  const navigateCell = useCallback((dr, dc) => {
    if (!selectedCell) return;
    const newRow = Math.max(0, Math.min(totalRowCount - 1, selectedCell.row + dr));
    const newCol = Math.max(0, Math.min(columns.length - 1, selectedCell.col + dc));
    selectCell(newRow, newCol, columns[newCol]?.key);
    const container = scrollContainerRef.current;
    if (container) {
      const rowTop = newRow * ROW_HEIGHT;
      const rowBottom = rowTop + ROW_HEIGHT;
      if (rowTop < container.scrollTop) container.scrollTop = rowTop;
      else if (rowBottom > container.scrollTop + viewportHeight - HEADER_HEIGHT)
        container.scrollTop = rowBottom - viewportHeight + HEADER_HEIGHT;
    }
  }, [selectedCell, totalRowCount, columns, selectCell, viewportHeight]);

  const handleCellKeyDown = useCallback((e) => {
    if (!selectedCell) return;
    if (editingCell) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const realRow = visibleRowIndices[editingCell.row] ?? editingCell.row;
        setCellValue(realRow, editingCell.colKey, editValue);
        stopEditing(); navigateCell(1, 0);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const realRow = visibleRowIndices[editingCell.row] ?? editingCell.row;
        setCellValue(realRow, editingCell.colKey, editValue);
        stopEditing(); navigateCell(0, e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') { stopEditing(); }
      return;
    }
    // Shift+Arrow extends selection
    if (e.shiftKey && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const range = selectedRange || { startRow: selectedCell.row, startCol: selectedCell.col, endRow: selectedCell.row, endCol: selectedCell.col };
      const nr = { ...range };
      if (e.key === 'ArrowUp') nr.endRow = Math.max(0, range.endRow - 1);
      if (e.key === 'ArrowDown') nr.endRow = Math.min(totalRowCount - 1, range.endRow + 1);
      if (e.key === 'ArrowLeft') nr.endCol = Math.max(0, range.endCol - 1);
      if (e.key === 'ArrowRight') nr.endCol = Math.min(columns.length - 1, range.endCol + 1);
      setSelectedRange(nr);
      return;
    }
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); navigateCell(-1, 0); break;
      case 'ArrowDown': e.preventDefault(); navigateCell(1, 0); break;
      case 'ArrowLeft': e.preventDefault(); navigateCell(0, -1); break;
      case 'ArrowRight': e.preventDefault(); navigateCell(0, 1); break;
      case 'Tab': e.preventDefault(); navigateCell(0, e.shiftKey ? -1 : 1); break;
      case 'Enter':
        e.preventDefault();
        if (isFormulaCol(selectedCell.colKey)) break;
        startEditing(selectedCell.row, selectedCell.colKey);
        setEditValue(cellValues[visibleRowIndices[selectedCell.row] + '_' + selectedCell.colKey] || '');
        break;
      case 'Delete': case 'Backspace':
        e.preventDefault();
        if (selectedRange) {
          const r = normalizeRange(selectedRange);
          for (let row = r.startRow; row <= r.endRow; row++) {
            for (let col = r.startCol; col <= r.endCol; col++) {
              const ck = columns[col]?.key;
              if (ck && !isFormulaCol(ck)) setCellValue(visibleRowIndices[row], ck, '');
            }
          }
        } else {
          if (isFormulaCol(selectedCell.colKey)) break;
          setCellValue(visibleRowIndices[selectedCell.row], selectedCell.colKey, '');
        }
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          if (isFormulaCol(selectedCell.colKey)) break;
          startEditing(selectedCell.row, selectedCell.colKey);
          setEditValue(e.key);
        }
    }
  }, [selectedCell, editingCell, editValue, cellValues, navigateCell, setCellValue, startEditing, stopEditing, visibleRowIndices, selectedRange, setSelectedRange, totalRowCount, columns, isFormulaCol, normalizeRange]);

  // ── Cell display ───────────────────────────────────────────────────
  const getDisplayValue = useCallback((realRowIdx, colKey) => {
    const key = realRowIdx + '_' + colKey;
    const raw = cellValues[key];
    if (raw && typeof raw === 'string' && raw.startsWith('=')) return computedValues[key] ?? '...';
    return computedValues[key] ?? raw ?? '';
  }, [cellValues, computedValues]);

  const isSearchMatch = useCallback((realRowIdx, colKey) => {
    if (!searchQuery) return false;
    const key = realRowIdx + '_' + colKey;
    const q = searchQuery.toLowerCase();
    return String(cellValues[key] || '').toLowerCase().includes(q) ||
           String(computedValues[key] || '').toLowerCase().includes(q);
  }, [searchQuery, cellValues, computedValues]);

  // ── Context menu ───────────────────────────────────────────────────
  const handleContextMenu = useCallback((e, visibleRowIdx, colIdx) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, rowIdx: visibleRowIdx, colIdx });
  }, []);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  // ── Column resize ─────────────────────────────────────────────────
  const handleResizeStart = useCallback((e, colIdx) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const startWidth = columns[colIdx]?.width || DEFAULT_COL_WIDTH;
    const onMove = (me) => setResizing({ colIdx, width: Math.max(50, startWidth + (me.clientX - startX)) });
    const onUp = () => { setResizing(null); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [columns]);

  const handleResizeDoubleClick = useCallback((e, colIdx) => {
    e.preventDefault(); e.stopPropagation();
    const col = columns[colIdx];
    if (!col) return;
    let maxW = col.label.length * 8 + 40;
    for (let r = 0; r < Math.min(rawRowCount, 100); r++) {
      const val = String(computedValues[r + '_' + col.key] ?? cellValues[r + '_' + col.key] ?? '');
      maxW = Math.max(maxW, val.length * 8 + 32);
    }
    maxW = Math.max(50, Math.min(400, maxW));
    const newCols = columns.map((c, i) => i === colIdx ? { ...c, width: maxW } : c);
    updateColumns(newCols);
  }, [columns, rawRowCount, computedValues, cellValues, updateColumns]);

  const getColWidth = useCallback((colIdx) => {
    if (resizing && resizing.colIdx === colIdx) return resizing.width;
    return columns[colIdx]?.width || DEFAULT_COL_WIDTH;
  }, [columns, resizing]);

  // ── Multi-cell selection (drag) ────────────────────────────────────
  const handleCellMouseDown = useCallback((e, visibleRowIdx, colIdx) => {
    if (e.button !== 0) return;
    if (e.shiftKey && selectedCell) {
      e.preventDefault();
      setSelectedRange({ startRow: selectedCell.row, startCol: selectedCell.col, endRow: visibleRowIdx, endCol: colIdx });
      return;
    }
    dragStartCell.current = { row: visibleRowIdx, col: colIdx };
    setIsDragging(true);
    setSelectedRange(null);
  }, [selectedCell, setSelectedRange]);

  const handleCellMouseEnter = useCallback((visibleRowIdx, colIdx) => {
    if (isDragging && dragStartCell.current) {
      setSelectedRange({ startRow: dragStartCell.current.row, startCol: dragStartCell.current.col, endRow: visibleRowIdx, endCol: colIdx });
    }
    if (isFilling && fillAnchorRef.current) {
      setFillPreview({ startRow: fillAnchorRef.current.startRow, startCol: fillAnchorRef.current.startCol, endRow: visibleRowIdx, endCol: fillAnchorRef.current.endCol });
    }
  }, [isDragging, isFilling, setSelectedRange]);

  // ── Drag-to-fill execution ─────────────────────────────────────────
  const executeFill = useCallback(() => {
    if (!fillAnchorRef.current || !fillPreview) return;
    const anchorNorm = normalizeRange(fillAnchorRef.current);
    const norm = normalizeRange(fillPreview);
    if (!anchorNorm || !norm) return;
    const sourceValues = [];
    for (let r = anchorNorm.startRow; r <= anchorNorm.endRow; r++) {
      const rowVals = [];
      for (let c = anchorNorm.startCol; c <= anchorNorm.endCol; c++) {
        const ck = columns[c]?.key;
        rowVals.push(cellValues[visibleRowIndices[r] + '_' + ck] || '');
      }
      sourceValues.push(rowVals);
    }
    if (sourceValues.length === 0) return;
    for (let r = norm.startRow; r <= norm.endRow; r++) {
      if (r >= anchorNorm.startRow && r <= anchorNorm.endRow) continue;
      for (let c = norm.startCol; c <= norm.endCol; c++) {
        const ck = columns[c]?.key;
        if (!ck || isFormulaCol(ck)) continue;
        const srcRow = ((r - anchorNorm.startRow) % sourceValues.length + sourceValues.length) % sourceValues.length;
        let fillVal = sourceValues[srcRow]?.[c - anchorNorm.startCol] ?? '';
        if (sourceValues.length === 1 && !isNaN(Number(fillVal)) && fillVal !== '') {
          fillVal = String(Number(fillVal) + (r - anchorNorm.startRow));
        }
        setCellValue(visibleRowIndices[r], ck, fillVal);
      }
    }
  }, [fillPreview, columns, cellValues, visibleRowIndices, setCellValue, isFormulaCol, normalizeRange]);

  useEffect(() => {
    const handleMouseUp = () => {
      if (isDragging) { setIsDragging(false); dragStartCell.current = null; }
      if (isFilling) { executeFill(); setIsFilling(false); setFillPreview(null); fillAnchorRef.current = null; }
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [isDragging, isFilling, executeFill]);

  const handleFillHandleMouseDown = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    const range = selectedRange || (selectedCell ? { startRow: selectedCell.row, startCol: selectedCell.col, endRow: selectedCell.row, endCol: selectedCell.col } : null);
    if (!range) return;
    fillAnchorRef.current = range;
    setIsFilling(true);
    setFillPreview(range);
  }, [selectedCell, selectedRange]);

  // ── Sort ───────────────────────────────────────────────────────────
  const handleSort = useCallback((colKey) => {
    // Server-side sort — compute next direction and delegate to store
    const currentSort = serverSort || sortConfig;
    let nextColKey = colKey;
    let nextDir = 'asc';
    if (currentSort?.colKey === colKey) {
      if (currentSort.direction === 'asc') nextDir = 'desc';
      else { nextColKey = null; nextDir = null; }
    }
    if (nextColKey) {
      setServerSort(nextColKey, nextDir);
      setSortConfig({ colKey: nextColKey, direction: nextDir }); // keep local in sync for UI
    } else {
      setServerSort(null);
      setSortConfig(null);
    }
  }, [serverSort, sortConfig, setServerSort]);

  // ── Filter popover ─────────────────────────────────────────────────
  const openFilterPopover = useCallback((colIdx, e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const col = columns[colIdx];
    if (!col) return;
    setFilterText(filterConfig[col.key]?.text || '');
    setFilterPopover({ colIdx, colKey: col.key, rect });
  }, [columns, filterConfig]);

  const applyFilter = useCallback(() => {
    if (!filterPopover) return;
    const { colKey } = filterPopover;
    if (!filterText) {
      // Clear this column filter — server-side
      setServerFilter(colKey, '');
      setFilterConfig((prev) => { const next = { ...prev }; delete next[colKey]; return next; });
    } else {
      // Apply server-side filter for this column
      setServerFilter(colKey, filterText);
      setFilterConfig((prev) => ({ ...prev, [colKey]: { text: filterText, values: null } }));
    }
    setFilterPopover(null);
  }, [filterPopover, filterText, setServerFilter]);

  const clearFilter = useCallback((colKey) => {
    setServerFilter(colKey, '');
    setFilterConfig((prev) => { const next = { ...prev }; delete next[colKey]; return next; });
    setFilterPopover(null);
  }, [setServerFilter]);

  const clearAllFilters = useCallback(() => {
    clearServerFilters();
    setFilterConfig({});
    setSortConfig(null);
    setServerSort(null);
  }, [clearServerFilters, setServerSort]);

  useEffect(() => {
    if (!filterPopover) return;
    const close = (e) => { if (filterPopoverRef.current && !filterPopoverRef.current.contains(e.target)) setFilterPopover(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [filterPopover]);

  // ── Range helpers ──────────────────────────────────────────────────
  const isCellInRange = useCallback((vi, ci) => {
    if (!selectedRange) return false;
    const r = normalizeRange(selectedRange);
    return vi >= r.startRow && vi <= r.endRow && ci >= r.startCol && ci <= r.endCol;
  }, [selectedRange, normalizeRange]);

  const isCellInFillPreview = useCallback((vi, ci) => {
    if (!fillPreview) return false;
    const r = normalizeRange(fillPreview);
    if (!r) return false;
    const a = normalizeRange(fillAnchorRef.current);
    if (a && vi >= a.startRow && vi <= a.endRow && ci >= a.startCol && ci <= a.endCol) return false;
    return vi >= r.startRow && vi <= r.endRow && ci >= r.startCol && ci <= r.endCol;
  }, [fillPreview, normalizeRange]);

  // ── Total table width ──────────────────────────────────────────────
  const totalWidth = useMemo(() => {
    return ROW_NUM_WIDTH + columns.reduce((sum, _, i) => sum + getColWidth(i), 0) + 40;
  }, [columns, getColWidth]);

  // ── Render ─────────────────────────────────────────────────────────
  if (!currentSheet) {
    return <div className="flex-1 flex items-center justify-center text-gray-400">No sheet selected</div>;
  }

  const hasActiveFilters = Object.keys(filterConfig).length > 0 || sortConfig !== null || !!serverSort || Object.keys(serverFilters).length > 0;

  // Determine effective sort for UI display
  const effectiveSort = serverSort || sortConfig;
  const effectiveFilterCount = Math.max(Object.keys(filterConfig).length, Object.keys(serverFilters).length);

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative bg-white">
      {hasActiveFilters && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-xs">
          <FilterX className="h-3 w-3 text-amber-600" />
          <span className="text-amber-700 font-medium">
            {effectiveSort && ('Sorted by ' + (columns.find(c => c.key === effectiveSort.colKey)?.label || effectiveSort.colKey) + ' (' + effectiveSort.direction + ')')}
            {effectiveSort && effectiveFilterCount > 0 && ' \u00b7 '}
            {effectiveFilterCount > 0 && (effectiveFilterCount + ' filter' + (effectiveFilterCount > 1 ? 's' : '') + ' active')}
          </span>
          <span className="text-amber-500">{'\u00b7 ' + totalRowCount + ' of ' + rawRowCount + ' rows'}</span>
          <button onClick={clearAllFilters} className="ml-auto text-amber-600 hover:text-amber-800 font-medium transition-colors">Clear all</button>
        </div>
      )}

      <div ref={scrollContainerRef} className="flex-1 overflow-auto" onScroll={handleScroll} tabIndex={0} onKeyDown={handleCellKeyDown}>
        <div style={{ minWidth: totalWidth, position: 'relative' }}>
          {/* Column headers */}
          <div className="sticky top-0 z-10 flex" style={{ minWidth: totalWidth, height: HEADER_HEIGHT }}>
            <div className="sticky left-0 z-20 flex items-center justify-center bg-gray-50 border-b border-r border-gray-200"
              style={{ width: ROW_NUM_WIDTH, minWidth: ROW_NUM_WIDTH, height: HEADER_HEIGHT }}>
              <button
                onClick={addRow}
                className="group/addrow flex h-full w-full items-center justify-center gap-0.5 text-blue-500 hover:text-white hover:bg-blue-500 transition-all duration-150 ring-inset hover:ring-1 hover:ring-blue-400"
                title="Add new row (also available in toolbar)"
                type="button"
              >
                <Plus className="h-3.5 w-3.5 transition-transform group-hover/addrow:scale-110" />
              </button>
            </div>
            {columns.map((col, colIdx) => {
              const typeColor = { formula: 'text-blue-500 bg-blue-50', number: 'text-emerald-600 bg-emerald-50', currency: 'text-amber-600 bg-amber-50', date: 'text-violet-600 bg-violet-50', boolean: 'text-orange-600 bg-orange-50', select: 'text-cyan-600 bg-cyan-50' }[col.type] || '';
              const isSorted = effectiveSort?.colKey === col.key;
              const isFiltered = !!(filterConfig[col.key] || serverFilters[col.key]);
              return (
                <div key={col.key}
                  className={'flex items-center bg-white border-b border-r border-gray-200 text-xs font-medium text-gray-600 relative select-none group/col' + (selectedCell?.col === colIdx ? ' bg-blue-50/60 text-blue-700' : '') + (columnMenu?.colIdx === colIdx ? ' bg-blue-50 ring-1 ring-blue-300 ring-inset' : '')}
                  style={{ width: getColWidth(colIdx), minWidth: 50, height: HEADER_HEIGHT }}>
                  <button className="flex items-center gap-1 px-2 h-full flex-1 text-left min-w-0" onClick={(e) => openColumnMenu(colIdx, e)}>
                    <span className="truncate font-semibold text-[12px]">{col.label}</span>
                    {col.type !== 'text' && <span className={'text-[9px] font-medium px-1 py-0.5 rounded flex-shrink-0 ' + typeColor}>{col.type === 'formula' ? '\u0192' : col.type}</span>}
                    <ChevronDown className="h-3 w-3 text-gray-300 group-hover/col:text-gray-500 ml-auto flex-shrink-0 transition-colors" />
                  </button>
                  <div className="flex items-center gap-0.5 pr-1 flex-shrink-0">
                    <button onClick={() => handleSort(col.key)} title={isSorted ? 'Sorted ' + effectiveSort.direction : 'Sort'}
                      className={'p-0.5 rounded transition-colors ' + (isSorted ? 'text-blue-600 bg-blue-100' : 'text-gray-300 hover:text-gray-500 opacity-0 group-hover/col:opacity-100')}>
                      {isSorted && effectiveSort.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : isSorted && effectiveSort.direction === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3" />}
                    </button>
                    <button onClick={(e) => openFilterPopover(colIdx, e)} title="Filter"
                      className={'p-0.5 rounded transition-colors ' + (isFiltered ? 'text-amber-600 bg-amber-100' : 'text-gray-300 hover:text-gray-500 opacity-0 group-hover/col:opacity-100')}>
                      <Filter className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400 transition-colors"
                    onMouseDown={(e) => handleResizeStart(e, colIdx)} onDoubleClick={(e) => handleResizeDoubleClick(e, colIdx)} />
                </div>
              );
            })}
            <div className="flex items-center justify-center bg-gray-50 border-b border-r border-gray-200" style={{ width: 40, height: HEADER_HEIGHT }}>
              <button onClick={() => addColumn()} className="w-full h-full flex items-center justify-center text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors" title="Add column">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Virtual scroll body */}
          <div style={{ height: totalHeight, position: 'relative' }}>
            {Array.from({ length: Math.max(0, endRow - startRow + 1) }, (_, i) => {
              const visibleIdx = startRow + i;
              if (visibleIdx >= loadedRowCount) return null;
              const realRowIdx = visibleRowIndices[visibleIdx];
              if (realRowIdx == null) return null;
              const rowTop = visibleIdx * ROW_HEIGHT;
              return (
                <div key={realRowIdx} className="flex absolute left-0" style={{ top: rowTop, height: ROW_HEIGHT, minWidth: totalWidth }}>
                  <div className={'sticky left-0 z-[5] flex items-center justify-center bg-gray-50 border-b border-r border-gray-200 text-[11px] text-gray-400 font-medium select-none' + (selectedCell?.row === visibleIdx ? ' bg-blue-50 text-blue-700' : '')}
                    style={{ width: ROW_NUM_WIDTH, minWidth: ROW_NUM_WIDTH, height: ROW_HEIGHT }}
                    onContextMenu={(e) => handleContextMenu(e, visibleIdx, -1)}>
                    {realRowIdx + 1}
                  </div>
                  {columns.map((col, colIdx) => {
                    const key = realRowIdx + '_' + col.key;
                    const isSelected = selectedCell?.row === visibleIdx && selectedCell?.col === colIdx;
                    const isEditing = editingCell?.row === visibleIdx && editingCell?.colKey === col.key;
                    const inRange = isCellInRange(visibleIdx, colIdx);
                    const inFill = isCellInFillPreview(visibleIdx, colIdx);
                    const displayVal = getDisplayValue(realRowIdx, col.key);
                    const rawVal = cellValues[key] || '';
                    const isFormula = typeof rawVal === 'string' && rawVal.startsWith('=');
                    const matchesSearch = isSearchMatch(realRowIdx, col.key);
                    const isColFormula = isFormulaCol(col.key);
                    const cellError = cellErrors[key];
                    const colType = col.type || 'text';
                    const inputCls = 'absolute inset-0 w-full h-full px-2 text-sm font-mono border-none outline-none bg-white z-10';
                    const inputStyle = { fontSize: '13px' };
                    const commitEdit = (val) => { setCellValue(realRowIdx, col.key, val); stopEditing(); };
                    const renderEditInput = () => {
                      if (colType === 'boolean') {
                        const cur = String(rawVal).toLowerCase();
                        commitEdit((cur === 'true' || cur === '1' || cur === 'yes') ? 'false' : 'true');
                        return null;
                      }
                      if (colType === 'number' || colType === 'currency') {
                        return <input ref={editInputRef} type="text" inputMode="decimal" value={editValue}
                          onChange={(e) => { setEditValue(e.target.value); setFormulaBarValue(e.target.value); }}
                          onBlur={() => commitEdit(editValue)} className={inputCls} style={inputStyle} />;
                      }
                      if (colType === 'date') {
                        return <input ref={editInputRef} type="date" value={editValue}
                          onChange={(e) => { setEditValue(e.target.value); setFormulaBarValue(e.target.value); }}
                          onBlur={() => commitEdit(editValue)} className={inputCls} style={inputStyle} />;
                      }
                      return <input ref={editInputRef} type="text" value={editValue}
                        onChange={(e) => { setEditValue(e.target.value); setFormulaBarValue(e.target.value); }}
                        onBlur={() => commitEdit(editValue)} className={inputCls} style={inputStyle} />;
                    };
                    const showFillHandle = !isFilling && (selectedRange
                      ? (() => { const r = normalizeRange(selectedRange); return visibleIdx === r.endRow && colIdx === r.endCol; })()
                      : isSelected);
                    return (
                      <div key={col.key}
                        className={'relative border-b border-r border-gray-200 transition-colors ' + (isSelected ? 'outline outline-2 outline-blue-500 outline-offset-[-1px] z-[4]' : inRange ? 'bg-blue-50/60' : inFill ? 'bg-green-50/60 border-green-300' : 'hover:bg-blue-50/30') + (matchesSearch ? ' bg-yellow-100' : '') + (isColFormula ? ' bg-blue-50/40' : '') + (cellError ? ' bg-red-50' : '')}
                        style={{ width: getColWidth(colIdx), minWidth: 50, height: ROW_HEIGHT }}
                        onMouseDown={(e) => handleCellMouseDown(e, visibleIdx, colIdx)}
                        onMouseEnter={() => handleCellMouseEnter(visibleIdx, colIdx)}
                        onClick={() => {
                          if (handleFormulaDialogCellClick(colIdx)) return;
                          if (editingCell && editValue.startsWith('=')) {
                            const clickedCol = columns[colIdx];
                            if (clickedCol && !(editingCell.row === visibleIdx && editingCell.colKey === col.key)) {
                              const ref = clickedCol.key + (realRowIdx + 1);
                              const newVal = editValue + ref;
                              setEditValue(newVal); setFormulaBarValue(newVal); editInputRef.current?.focus();
                              return;
                            }
                          }
                          selectCell(visibleIdx, colIdx, col.key);
                          if (!isEditing) stopEditing();
                        }}
                        onDoubleClick={() => {
                          if (isColFormula) return;
                          if (colType === 'boolean') {
                            const cur = String(rawVal).toLowerCase();
                            setCellValue(realRowIdx, col.key, (cur === 'true' || cur === '1' || cur === 'yes') ? 'false' : 'true');
                            return;
                          }
                          startEditing(visibleIdx, col.key);
                          setEditValue(rawVal);
                        }}
                        onContextMenu={(e) => handleContextMenu(e, visibleIdx, colIdx)}>
                        {isEditing && !isColFormula ? renderEditInput() : (
                          <div className={'px-2 h-full flex items-center text-sm truncate ' + (isFormula || isColFormula ? 'text-gray-800' : 'text-gray-700') + (colType === 'number' || colType === 'currency' ? ' justify-end font-mono' : '') + (colType === 'boolean' ? ' justify-center' : '')}
                            style={{ fontSize: '13px' }}>
                            {colType === 'boolean' ? (
                              <span className={'inline-block w-4 h-4 rounded border ' + (['true','1','yes'].includes(String(displayVal).toLowerCase()) ? 'bg-blue-500 border-blue-500 text-white text-[10px] leading-4 text-center' : 'border-gray-300 bg-white')}>
                                {['true','1','yes'].includes(String(displayVal).toLowerCase()) ? '\u2713' : ''}
                              </span>
                            ) : typeof displayVal === 'number' ? displayVal.toLocaleString() : String(displayVal)}
                            {isColFormula && <span className="absolute top-0 left-0.5 text-[8px] text-blue-400 leading-none">{'\u0192'}</span>}
                            {cellError && <span className="absolute top-0 right-0.5 text-[8px] text-red-500 leading-none cursor-help" title={cellError}>{'\u26A0'}</span>}
                          </div>
                        )}
                        {showFillHandle && (
                          <div className="absolute -bottom-[3px] -right-[3px] w-[7px] h-[7px] bg-blue-500 border border-white cursor-crosshair z-10"
                            onMouseDown={handleFillHandleMouseDown} />
                        )}
                      </div>
                    );
                  })}
                  <div className="border-b border-r border-gray-200 bg-gray-50/30" style={{ width: 40, height: ROW_HEIGHT }} />
                </div>
              );
            })}
            <div className="absolute left-0 flex" style={{ top: loadedRowCount * ROW_HEIGHT, height: ROW_HEIGHT, minWidth: totalWidth }}>
              <div className="border-b border-r border-gray-200 bg-gray-50/50" style={{ width: totalWidth }}>
                {loadingMore ? (
                  <div className="w-full h-full flex items-center justify-center gap-2 text-xs text-cyan-600">
                    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" /></svg>
                    Loading more rows…
                  </div>
                ) : pagination?.hasNext ? (
                  <div className="w-full h-full flex items-center justify-center gap-2 text-xs text-gray-500">
                    <svg className="h-3.5 w-3.5 text-gray-400" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                    Scroll to load more rows…
                  </div>
                ) : (
                  <button onClick={addRow} className="w-full h-full flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors font-medium">
                    <Plus className="h-3 w-3" /> Add Row
                    <span className="text-[10px] text-gray-300 ml-1">or use + in header</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div className="fixed bg-white border border-gray-200 rounded-lg shadow-xl z-50 py-1 min-w-[160px]" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button onClick={() => { addRow(); setContextMenu(null); }} className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
            <Plus className="h-3.5 w-3.5" /> Insert Row Below
          </button>
          {contextMenu.colIdx >= 0 && <button onClick={() => { addColumn(); setContextMenu(null); }} className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"><Plus className="h-3.5 w-3.5" /> Insert Column Right</button>}
          {contextMenu.colIdx >= 0 && <button onClick={() => openFormulaDialog(contextMenu.colIdx)} className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"><FunctionSquare className="h-3.5 w-3.5" /> Set Column Formula</button>}
          {contextMenu.colIdx >= 0 && <>
            <div className="h-px bg-gray-100 my-1" />
            <button onClick={() => { handleSort(columns[contextMenu.colIdx]?.key); setContextMenu(null); }} className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"><ArrowUpDown className="h-3.5 w-3.5" /> Sort Column</button>
            <button onClick={(e) => { openFilterPopover(contextMenu.colIdx, e); setContextMenu(null); }} className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"><Filter className="h-3.5 w-3.5" /> Filter Column</button>
          </>}
          <div className="h-px bg-gray-100 my-1" />
          <button onClick={() => { deleteRow(visibleRowIndices[contextMenu.rowIdx]); setContextMenu(null); }} className="w-full text-left px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"><Trash2 className="h-3.5 w-3.5" /> Delete Row</button>
          {contextMenu.colIdx >= 0 && <button onClick={() => { deleteColumn(columns[contextMenu.colIdx]?.key); setContextMenu(null); }} className="w-full text-left px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"><Trash2 className="h-3.5 w-3.5" /> Delete Column</button>}
        </div>
      )}

      {/* Column config popover */}
      {columnMenu && (
        <div ref={columnMenuRef} className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-50 w-64 overflow-hidden"
          style={{ left: Math.min(columnMenu.rect.left, window.innerWidth - 270), top: columnMenu.rect.bottom + 4 }}>
          <div className="px-3 pt-3 pb-2">
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Column Name</label>
            <input type="text" value={colEditLabel} onChange={(e) => setColEditLabel(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-300 focus:border-blue-300 outline-none bg-gray-50"
              autoFocus onKeyDown={(e) => e.key === 'Enter' && saveColumnConfig()} />
          </div>
          <div className="px-3 pb-2">
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Type</label>
            <div className="grid grid-cols-4 gap-1">
              {COLUMN_TYPES.map((t) => (
                <button key={t.value} onClick={() => setColEditType(t.value)}
                  className={'flex flex-col items-center gap-0.5 py-1.5 px-1 rounded-lg text-[10px] font-medium transition-all duration-150 ' + (colEditType === t.value ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700')}>
                  <span className="text-sm leading-none">{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>
          {colEditType === 'formula' && (
            <div className="px-3 pb-2">
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Formula Template</label>
              <input type="text" value={colEditFormula} onChange={(e) => setColEditFormula(e.target.value)} placeholder="=A{row}+B{row}"
                className="w-full px-2.5 py-1.5 text-sm font-mono border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-300 focus:border-blue-300 outline-none bg-gray-50" />
              <p className="text-[9px] text-gray-400 mt-1">Use <code className="bg-gray-100 px-0.5 rounded">{'{row}'}</code> for row number.</p>
            </div>
          )}
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 bg-gray-50/50">
            <button onClick={() => { deleteColumn(columns[columnMenu.colIdx]?.key); setColumnMenu(null); }} className="text-[11px] text-red-500 hover:text-red-700 font-medium transition-colors">Delete</button>
            <div className="flex items-center gap-1.5">
              <button onClick={closeColumnMenu} className="px-2.5 py-1 text-[11px] text-gray-500 hover:bg-gray-100 rounded-md transition-colors">Cancel</button>
              <button onClick={saveColumnConfig} className="px-3 py-1 text-[11px] font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-md transition-colors flex items-center gap-1">
                <Check className="h-3 w-3" /> Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter popover */}
      {filterPopover && (
        <div ref={filterPopoverRef} className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl z-50 w-56 overflow-hidden"
          style={{ left: Math.min(filterPopover.rect.left, window.innerWidth - 240), top: filterPopover.rect.bottom + 4 }}>
          <div className="px-3 pt-3 pb-2">
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{'Filter: ' + (columns[filterPopover.colIdx]?.label || '')}</label>
            <input type="text" value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder="Type to filter\u2026"
              className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-300 focus:border-amber-300 outline-none bg-gray-50"
              autoFocus onKeyDown={(e) => e.key === 'Enter' && applyFilter()} />
          </div>
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 bg-gray-50/50">
            <button onClick={() => clearFilter(filterPopover.colKey)} className="text-[11px] text-gray-500 hover:text-red-500 font-medium transition-colors">Clear</button>
            <button onClick={applyFilter} className="px-3 py-1 text-[11px] font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-md transition-colors">Apply</button>
          </div>
        </div>
      )}

      {/* Column formula dialog */}
      {formulaDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-[440px] max-w-[95vw]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <FunctionSquare className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-semibold text-gray-700">{'Column Formula \u2014 ' + formulaDialog.label}</span>
              </div>
              <button onClick={() => setFormulaDialog(null)} className="text-gray-400 hover:text-gray-600 transition-colors"><X className="h-4 w-4" /></button>
            </div>
            <div className="px-4 py-3 space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1 font-medium">Formula template <span className="text-gray-400">(applied to every row)</span></label>
                <input ref={formulaInputRef} type="text" value={formulaDialog.formula}
                  onChange={(e) => setFormulaDialog((prev) => ({ ...prev, formula: e.target.value }))}
                  placeholder={'e.g. =' + (columns.find((_, i) => i !== formulaDialog.colIdx)?.key || 'qty') + '{row}*2'}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                {'Use column names like '}<code className="bg-gray-100 px-1 rounded text-gray-600">{'qty{row}'}</code>{' or click a column button below.'}
              </p>
              <div>
                <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Columns</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {columns.map((col, i) => {
                    if (i === formulaDialog.colIdx) return null;
                    return (
                      <button key={col.key} type="button"
                        onClick={() => setFormulaDialog((prev) => ({ ...prev, formula: (prev.formula || '') + col.key + '{row}' }))}
                        className="px-2 py-0.5 rounded bg-gray-100 hover:bg-blue-100 text-xs font-mono text-gray-600 hover:text-blue-600 transition-colors" title={col.label}>
                        {col.key} <span className="text-[9px] text-gray-400">{'(' + col.label + ')'}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50 rounded-b-xl">
              <button onClick={() => setFormulaDialog((prev) => ({ ...prev, formula: '' }))} className="text-xs text-gray-500 hover:text-red-500 transition-colors">Clear Formula</button>
              <div className="flex items-center gap-2">
                <button onClick={() => setFormulaDialog(null)} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
                <button onClick={saveColumnFormula} className="px-4 py-1.5 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors">Apply</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
