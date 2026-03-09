/**
 * AIGeneratePanel – Collapsible bar for AI-powered code generation & editing.
 *
 * Two modes:
 *  - Generate: Create new code from a prompt (optionally from a preset)
 *  - Edit: Send existing code + change instructions to AI for targeted modifications
 */

import { useState } from 'react';
import { Loader2, Sparkles, X, Wand2, Pencil, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';

const GENERATE_PRESETS = [
  { label: 'NDA', prompt: 'Generate a standard Non-Disclosure Agreement between two parties' },
  { label: 'Service Agreement', prompt: 'Generate a professional services agreement' },
  { label: 'Employment Contract', prompt: 'Generate a standard employment contract' },
  { label: 'Terms of Service', prompt: 'Generate website terms of service' },
  { label: 'Privacy Policy', prompt: 'Generate a GDPR-compliant privacy policy' },
  { label: 'License Agreement', prompt: 'Generate a software license agreement' },
];

const EDIT_PRESETS = [
  { label: 'Add clause', prompt: 'Add a confidentiality clause' },
  { label: 'Add table', prompt: 'Add a summary table of key terms' },
  { label: 'Fix formatting', prompt: 'Fix formatting issues and improve professional appearance' },
  { label: 'Add signatures', prompt: 'Add a signature block at the end for both parties' },
  { label: 'Simplify language', prompt: 'Simplify the legal language to be more readable' },
  { label: 'Add header/footer', prompt: 'Add a professional header with company name and footer with page numbers' },
];

const AIGeneratePanel = ({
  documentId,
  generating,
  onGenerate,
  onClose,
  hasExistingCode = false,
  codeType = 'latex',
}) => {
  const [prompt, setPrompt] = useState('');
  const [preamble, setPreamble] = useState('');
  const [replace, setReplace] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [aiMode, setAiMode] = useState(hasExistingCode ? 'edit' : 'generate');

  const presets = aiMode === 'edit' ? EDIT_PRESETS : GENERATE_PRESETS;
  const isEdit = aiMode === 'edit';

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!prompt.trim() || generating) return;
    onGenerate({
      prompt: prompt.trim(),
      preamble: preamble.trim() || undefined,
      replace: isEdit ? true : replace,
      mode: aiMode,
    });
  };

  const handlePreset = (preset) => {
    setPrompt(preset.prompt);
  };

  return (
    <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-purple-200 px-4 py-3">
      <form onSubmit={handleSubmit}>
        {/* Header + Mode Toggle */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-purple-700">
              <Sparkles size={15} />
              AI {codeType === 'html' ? 'HTML' : 'LaTeX'}
            </div>

            {/* Mode toggle — only show when there's existing code */}
            {hasExistingCode && (
              <div className="flex bg-white rounded-md border border-purple-200 p-0.5">
                <button
                  type="button"
                  onClick={() => setAiMode('generate')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                    aiMode === 'generate'
                      ? 'bg-purple-600 text-white'
                      : 'text-purple-500 hover:bg-purple-50'
                  }`}
                >
                  <Wand2 size={11} />
                  Generate
                </button>
                <button
                  type="button"
                  onClick={() => setAiMode('edit')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                    aiMode === 'edit'
                      ? 'bg-amber-500 text-white'
                      : 'text-amber-600 hover:bg-amber-50'
                  }`}
                >
                  <Pencil size={11} />
                  Edit
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-purple-100 text-purple-400"
          >
            <X size={16} />
          </button>
        </div>

        {/* Edit mode hint */}
        {isEdit && (
          <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5 mb-2">
            Describe what changes to make to your existing code. The AI will modify the current document and return the updated version.
          </p>
        )}

        {/* Preset Chips */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => handlePreset(preset)}
              className={`px-2.5 py-1 text-xs rounded-full bg-white border transition-colors ${
                isEdit
                  ? 'border-amber-200 text-amber-600 hover:bg-amber-50'
                  : 'border-purple-200 text-purple-600 hover:bg-purple-100'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Prompt Input */}
        <div className="flex gap-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={isEdit
              ? 'Describe what to change… e.g. "Add a termination clause after section 3"'
              : 'Describe the legal document you want to generate...'
            }
            rows={2}
            className={`flex-1 px-3 py-2 border rounded-md text-sm bg-white focus:ring-2 resize-none ${
              isEdit
                ? 'border-amber-200 focus:ring-amber-500 focus:border-amber-500'
                : 'border-purple-200 focus:ring-purple-500 focus:border-purple-500'
            }`}
          />
          <button
            type="submit"
            disabled={!prompt.trim() || generating}
            className={`px-4 py-2 text-white rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 self-end ${
              isEdit
                ? 'bg-amber-500 hover:bg-amber-600'
                : 'bg-purple-600 hover:bg-purple-700'
            }`}
          >
            {generating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {isEdit ? 'Editing…' : 'Generating…'}
              </>
            ) : (
              <>
                {isEdit ? <Pencil size={14} /> : <Wand2 size={14} />}
                {isEdit ? 'Apply Changes' : 'Generate'}
              </>
            )}
          </button>
        </div>

        {/* Advanced Toggle — only in generate mode */}
        {!isEdit && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1 text-xs text-purple-500 hover:text-purple-700"
            >
              {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              Advanced options
            </button>

            {showAdvanced && (
              <div className="mt-2 space-y-2 pl-1">
                {/* Preamble */}
                <div>
                  <label className="block text-xs font-medium text-purple-600 mb-1">
                    Custom Preamble (optional)
                  </label>
                  <textarea
                    value={preamble}
                    onChange={(e) => setPreamble(e.target.value)}
                    placeholder={codeType === 'html'
                      ? '<style>/* custom styles */</style>'
                      : '\\usepackage{geometry}\n\\geometry{margin=1in}'
                    }
                    rows={2}
                    className="w-full px-3 py-2 border border-purple-200 rounded-md text-xs font-mono bg-white focus:ring-2 focus:ring-purple-500 resize-none"
                  />
                </div>

                {/* Replace Toggle */}
                <label className="flex items-center gap-2 text-xs text-purple-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={replace}
                    onChange={(e) => setReplace(e.target.checked)}
                    className="rounded border-purple-300 text-purple-600 focus:ring-purple-500"
                  />
                  Replace existing code (overwrite instead of append)
                </label>
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  );
};

export default AIGeneratePanel;
