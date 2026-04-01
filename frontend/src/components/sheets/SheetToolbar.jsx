/**
 * SheetToolbar — minimal modern toolbar for spreadsheet actions
 *
 * Groups: Save · Undo/Redo · Clipboard · Structure · Formulas · AI · Search · Progress
 */

import { useCallback, useState, useRef, useEffect } from 'react';
import {
  Save, Undo2, Redo2, Copy, Clipboard,
  Upload, Download, Wand2, Columns, Rows, Search,
  Table2, X, FunctionSquare, FileUp, LayoutDashboard,
  Zap, Loader2, ArrowUpToLine,
} from 'lucide-react';
import useSheetsStore from '../../store/sheetsStore';
import TaskProgressBar from './TaskProgressBar';

export default function SheetToolbar({
  onAIGenerate, onImportTable, onExport, onCsvImport, onCsvExport,
  onDashboard, dashboardActive,
  onOpenSearch, formulaTask, onDismissFormulaTask,
}) {
  const saveAllCells = useSheetsStore((s) => s.saveAllCells);
  const undo = useSheetsStore((s) => s.undo);
  const redo = useSheetsStore((s) => s.redo);
  const addRow = useSheetsStore((s) => s.addRow);
  const addRowOnTop = useSheetsStore((s) => s.addRowOnTop);
  const addColumn = useSheetsStore((s) => s.addColumn);
  const copySelection = useSheetsStore((s) => s.copySelection);
  const pasteSelection = useSheetsStore((s) => s.pasteSelection);
  const saving = useSheetsStore((s) => s.saving);
  const selectedCell = useSheetsStore((s) => s.selectedCell);
  const setCellValue = useSheetsStore((s) => s.setCellValue);
  const searchQuery = useSheetsStore((s) => s.searchQuery);
  const setSearchQuery = useSheetsStore((s) => s.setSearchQuery);
  const pendingAIChanges = useSheetsStore((s) => s.pendingAIChanges);
  const aiGenerating = useSheetsStore((s) => s.aiGenerating);

  const [showSearch, setShowSearch] = useState(false);
  const [showFormulaMenu, setShowFormulaMenu] = useState(false);
  const formulaRef = useRef(null);

  // Close formula menu on outside click
  useEffect(() => {
    if (!showFormulaMenu) return;
    const close = (e) => {
      if (formulaRef.current && !formulaRef.current.contains(e.target)) setShowFormulaMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showFormulaMenu]);

  const formulas = [
    { name: 'SUM',     desc: 'Sum of values',     template: '=SUM(A1:A10)' },
    { name: 'AVG',     desc: 'Average',            template: '=AVG(A1:A10)' },
    { name: 'COUNT',   desc: 'Count values',       template: '=COUNT(A1:A10)' },
    { name: 'MIN',     desc: 'Minimum',            template: '=MIN(A1:A10)' },
    { name: 'MAX',     desc: 'Maximum',            template: '=MAX(A1:A10)' },
    { name: 'IF',      desc: 'Conditional',        template: '=IF(A1>0,"Yes","No")' },
    { name: 'VLOOKUP', desc: 'Vertical lookup',    template: '=VLOOKUP(A1,B1:C10,2)' },
    { name: 'CONCAT',  desc: 'Join text',          template: '=CONCAT(A1,B1)' },
    { name: 'ROUND',   desc: 'Round number',       template: '=ROUND(A1,2)' },
    { name: 'NOW',     desc: 'Current datetime',   template: '=NOW()' },
    { name: 'TODAY',   desc: 'Current date',       template: '=TODAY()' },
  ];

  const insertFormula = useCallback((template) => {
    if (selectedCell) setCellValue(selectedCell.row, selectedCell.colKey, template);
    setShowFormulaMenu(false);
  }, [selectedCell, setCellValue]);

  const Btn = ({ icon: Icon, label, onClick, active, disabled }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`p-1.5 rounded-md transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed ${
        active ? 'bg-blue-100 text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );

  const Divider = () => <div className="w-px h-5 bg-gray-200 mx-0.5" />;

  return (
    <div className="flex items-center gap-0.5 px-3 h-10 border-b border-gray-100 bg-white flex-wrap">
      {/* Save · Undo · Redo */}
      <Btn icon={Save} label={saving ? 'Saving…' : 'Save (⌘S)'} onClick={saveAllCells} disabled={saving} />
      <Btn icon={Undo2} label="Undo (⌘Z)" onClick={undo} />
      <Btn icon={Redo2} label="Redo (⌘Y)" onClick={redo} />
      <Divider />

      {/* Clipboard */}
      <Btn icon={Copy} label="Copy (⌘C)" onClick={copySelection} />
      <Btn icon={Clipboard} label="Paste (⌘V)" onClick={pasteSelection} />
      <Divider />

      {/* Structure */}
      <Btn icon={ArrowUpToLine} label="Add Row on Top" onClick={addRowOnTop} />
      <Btn icon={Rows} label="Add Row at Bottom" onClick={addRow} />
      <Btn icon={Columns} label="Add Column" onClick={() => addColumn()} />
      <Divider />

      {/* Formula helper */}
      <div className="relative" ref={formulaRef}>
        <button
          onClick={() => setShowFormulaMenu((p) => !p)}
          className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md transition-all duration-150 ${
            showFormulaMenu ? 'bg-blue-100 text-blue-600' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
          }`}
        >
          <FunctionSquare className="h-3.5 w-3.5" />
          <span>f(x)</span>
        </button>
        {showFormulaMenu && (
          <div className="absolute top-full left-0 mt-1 w-60 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 bg-gray-50/50">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Insert Formula</p>
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {formulas.map((f) => (
                <button
                  key={f.name}
                  onClick={() => insertFormula(f.template)}
                  className="w-full text-left px-3 py-1.5 hover:bg-blue-50 transition-colors flex items-center gap-2 group"
                >
                  <code className="text-[11px] font-mono font-bold text-blue-600 bg-blue-50 group-hover:bg-blue-100 px-1.5 py-0.5 rounded min-w-[55px] text-center">
                    {f.name}
                  </code>
                  <span className="text-[11px] text-gray-500">{f.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <Divider />

      {/* AI & Dashboard & Import/Export */}
      {onAIGenerate && (
        <button onClick={onAIGenerate} className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors relative ${
          pendingAIChanges ? 'text-purple-700 bg-purple-100 shadow-sm' : aiGenerating ? 'text-purple-500 bg-purple-50' : 'text-purple-600 hover:bg-purple-50'
        }`}>
          {aiGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          AI
          {pendingAIChanges && (
            <span className="ml-0.5 px-1 py-0 text-[9px] font-bold bg-purple-600 text-white rounded-full leading-[14px]">
              {pendingAIChanges.changes?.length || 0}
            </span>
          )}
        </button>
      )}
      {onDashboard && (
        <button
          onClick={onDashboard}
          className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
            dashboardActive
              ? 'text-indigo-700 bg-indigo-100 shadow-sm'
              : 'text-indigo-600 hover:bg-indigo-50'
          }`}
        >
          <LayoutDashboard className="h-3.5 w-3.5" /> Dashboard
        </button>
      )}
      {onImportTable && (
        <button onClick={onImportTable} className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors">
          <Table2 className="h-3.5 w-3.5" /> Import
        </button>
      )}
      {onExport && (
        <button onClick={onExport} className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors">
          <Upload className="h-3.5 w-3.5" /> Export
        </button>
      )}
      <Divider />

      {/* CSV Import / Export */}
      {onCsvImport && (
        <button onClick={onCsvImport} className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors">
          <FileUp className="h-3.5 w-3.5" /> CSV
        </button>
      )}
      {onCsvExport && (
        <button onClick={onCsvExport} className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors">
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
      )}

      {/* Search (right aligned) + Progress */}
      <div className="ml-auto flex items-center gap-1.5">
        {/* Formula task progress (compact inline) */}
        {formulaTask && (
          <TaskProgressBar task={formulaTask} compact onDismiss={onDismissFormulaTask} />
        )}

        {/* Quick search */}
        {showSearch && (
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Quick filter…"
              className="h-7 w-36 pl-2 pr-7 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-300 focus:border-blue-300 outline-none bg-gray-50"
              autoFocus
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
        <Btn icon={Search} label="Quick Filter" onClick={() => setShowSearch((p) => !p)} active={showSearch} />

        {/* Enterprise search dialog trigger */}
        {onOpenSearch && (
          <button
            onClick={onOpenSearch}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
            title="Enterprise Search (⌘⇧F)"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Find</span>
          </button>
        )}
      </div>
    </div>
  );
}
