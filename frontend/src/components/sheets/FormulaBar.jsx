/**
 * FormulaBar — shows the active cell reference and editable formula/value
 *
 * For formula-column cells the bar is read-only and shows the column template.
 */

import { useCallback, useMemo } from 'react';
import { FunctionSquare } from 'lucide-react';
import useSheetsStore from '../../store/sheetsStore';
import { colIndexToLetter } from '../../utils/SpreadsheetEngine';

export default function FormulaBar() {
  const selectedCell = useSheetsStore((s) => s.selectedCell);
  const currentSheet = useSheetsStore((s) => s.currentSheet);
  const formulaBarValue = useSheetsStore((s) => s.formulaBarValue);
  const setFormulaBarValue = useSheetsStore((s) => s.setFormulaBarValue);
  const setCellValue = useSheetsStore((s) => s.setCellValue);
  const startEditing = useSheetsStore((s) => s.startEditing);

  const columns = currentSheet?.columns || [];

  // Check if the selected cell belongs to a formula column
  const selectedColDef = useMemo(() => {
    if (!selectedCell) return null;
    return columns.find((c) => c.key === selectedCell.colKey) || null;
  }, [selectedCell, columns]);

  const isColFormula = selectedColDef?.formula;

  const cellRef = selectedCell
    ? `${colIndexToLetter(selectedCell.col)}${selectedCell.row + 1}`
    : '';

  const handleChange = useCallback((e) => {
    if (isColFormula) return; // read-only for formula columns
    setFormulaBarValue(e.target.value);
  }, [setFormulaBarValue, isColFormula]);

  const handleKeyDown = useCallback((e) => {
    if (isColFormula) return; // read-only for formula columns
    if (e.key === 'Enter' && selectedCell) {
      setCellValue(selectedCell.row, selectedCell.colKey, formulaBarValue);
      e.target.blur();
    }
    if (e.key === 'Escape') {
      e.target.blur();
    }
  }, [selectedCell, formulaBarValue, setCellValue, isColFormula]);

  const handleFocus = useCallback(() => {
    if (isColFormula) return; // read-only for formula columns
    if (selectedCell) {
      startEditing(selectedCell.row, selectedCell.colKey);
    }
  }, [selectedCell, startEditing, isColFormula]);

  // Display value: for formula columns show the template, otherwise normal value
  const displayValue = isColFormula ? (selectedColDef.formula || '') : formulaBarValue;

  return (
    <div className="flex items-center h-9 border-b border-gray-200 bg-white px-2 gap-2">
      {/* Cell reference */}
      <div className="flex items-center gap-1 px-2 py-1 bg-gray-50 border border-gray-200 rounded text-xs font-mono text-gray-700 min-w-[60px] justify-center">
        {cellRef || '—'}
      </div>

      {/* fx icon */}
      <FunctionSquare className={`h-4 w-4 flex-shrink-0 ${isColFormula ? 'text-blue-500' : 'text-gray-400'}`} />

      {/* Column formula badge */}
      {isColFormula && (
        <span className="text-[10px] font-medium text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded">
          column formula
        </span>
      )}

      {/* Formula / value input */}
      <input
        type="text"
        value={displayValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        readOnly={!!isColFormula}
        placeholder="Enter value or formula (=SUM, =IF, ...)"
        className={`flex-1 h-7 px-2 text-sm font-mono border border-transparent rounded outline-none ${
          isColFormula
            ? 'bg-blue-50/50 text-blue-700 cursor-default'
            : 'focus:border-blue-400 focus:ring-1 focus:ring-blue-200 bg-transparent'
        }`}
      />
    </div>
  );
}
