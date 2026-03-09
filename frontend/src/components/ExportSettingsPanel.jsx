import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { Download, RefreshCw, Save, Upload, ShieldCheck, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import HeaderFooterCropEditor from './HeaderFooterCropEditor';

const SectionCard = ({ title, description, children }) => (
  <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
    <div className="mb-3">
      <h4 className="text-sm font-semibold text-gray-900 truncate">{title}</h4>
      {description && <p className="text-xs text-gray-500 truncate">{description}</p>}
    </div>
    {children}
  </div>
);

const Toggle = ({ checked, onChange, label }) => (
  <label className="flex items-center justify-between gap-3 text-sm min-w-0">
    <span className="text-gray-700 flex-1 min-w-0 truncate">{label}</span>
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`h-6 w-11 rounded-full border transition-colors ${checked ? 'bg-blue-600 border-blue-600' : 'bg-gray-200 border-gray-300'}`}
    >
      <span
        className={`block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`}
      />
    </button>
  </label>
);

const MODE_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'pdf', label: 'PDF Overlay' },
  { value: 'template', label: 'Template' },
];

const ModeToggle = ({ value, onChange, accent = 'blue' }) => {
  const colors = {
    blue: { active: 'bg-blue-600 text-white shadow-sm', inactive: 'text-gray-600 hover:text-gray-800 hover:bg-gray-100' },
    purple: { active: 'bg-purple-600 text-white shadow-sm', inactive: 'text-gray-600 hover:text-gray-800 hover:bg-gray-100' },
  };
  const palette = colors[accent] || colors.blue;
  return (
    <div className="inline-flex rounded-lg bg-gray-100 p-0.5 gap-0.5">
      {MODE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${value === opt.value ? palette.active : palette.inactive}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
};

const ExportSettingsPanel = ({
  documentId,
  exportDraft,
  exportLoading,
  exportSaving,
  exportError,
  exportDirty,
  templates,
  images,
  pdfFiles,
  metadataSnapshot,
  onUpdate,
  onSave,
  onReset,
  onUploadImage,
  onUploadPdfFile,
  onSaveHeaderFooterPdf,
  onRemoveHeaderFooterPdf,
  onRefreshPreview,
}) => {
  const [newMetadataField, setNewMetadataField] = useState('');
  const [newFieldEnabled, setNewFieldEnabled] = useState(true);
  const [collapsedSections, setCollapsedSections] = useState({});

  // Derive initial mode from existing config
  const deriveMode = useCallback((pdfConfig, templateValue) => {
    if (pdfConfig?.file_id) return 'pdf';
    if (templateValue) return 'template';
    return 'none';
  }, []);

  const [headerMode, setHeaderMode] = useState(() =>
    deriveMode(exportDraft?.processing_settings?.header_pdf, exportDraft?.header_template)
  );
  const [footerMode, setFooterMode] = useState(() =>
    deriveMode(exportDraft?.processing_settings?.footer_pdf, exportDraft?.footer_template)
  );

  // Sync modes when exportDraft changes externally (e.g. after save/reset)
  useEffect(() => {
    const newHeaderMode = deriveMode(exportDraft?.processing_settings?.header_pdf, exportDraft?.header_template);
    const newFooterMode = deriveMode(exportDraft?.processing_settings?.footer_pdf, exportDraft?.footer_template);
    setHeaderMode(newHeaderMode);
    setFooterMode(newFooterMode);
  }, [exportDraft?.processing_settings?.header_pdf?.file_id, exportDraft?.header_template,
      exportDraft?.processing_settings?.footer_pdf?.file_id, exportDraft?.footer_template, deriveMode]);

  const handleModeChange = useCallback((type, newMode) => {
    const setter = type === 'header' ? setHeaderMode : setFooterMode;
    setter(newMode);

    if (newMode === 'pdf') {
      // Switching to PDF → clear template
      onUpdate([`${type}_template`], null);
      onUpdate([`${type}_config`], {});
    } else if (newMode === 'template') {
      // Switching to Template → remove PDF
      onRemoveHeaderFooterPdf?.(type);
    } else {
      // None → clear both
      onUpdate([`${type}_template`], null);
      onUpdate([`${type}_config`], {});
      onRemoveHeaderFooterPdf?.(type);
    }
  }, [onUpdate, onRemoveHeaderFooterPdf]);

  const processing = exportDraft?.processing_settings || {};
  const tableConfig = processing.table_config || {};
  const fileConfig = processing.file_config || {};
  const pdfLayout = processing.pdf_layout || {};
  const pdfImages = processing.pdf_images || {};
  const metadataEnabled = processing.metadata_fields?.enabled || {};
  const pdfSecurity = processing.pdf_security || {};
  const pdfTextProtection = processing.pdf_text_protection || {};
  const headerPdfConfig = processing.header_pdf || null;
  const footerPdfConfig = processing.footer_pdf || null;

  const toggleSection = useCallback((key) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const pageSizeOptions = ['a4', 'letter', 'legal', 'a3', 'a5'];
  const fontFamilyOptions = ['serif', 'sans', 'monospace'];
  const fontSizeOptions = ['10pt', '11pt', '12pt', '14pt', '16pt'];
  const lineSpacingOptions = ['1', '1.15', '1.5', '2'];
  const marginSizeOptions = ['narrow', 'normal', 'wide'];
  const imageSizeOptions = ['small', 'medium', 'large'];
  const unprintableAreaOptions = ['standard', 'none', 'full_bleed'];
  const captionAlignmentOptions = ['left', 'center', 'right'];

  const headerTemplates = Array.isArray(templates?.headers)
    ? templates.headers
    : templates?.headers?.results || templates?.headers?.data || [];
  const footerTemplates = Array.isArray(templates?.footers)
    ? templates.footers
    : templates?.footers?.results || templates?.footers?.data || [];

  const normalizeList = (value) => (Array.isArray(value) ? value : value?.results || value?.data || []);

  const logoImages = normalizeList(images?.logo);
  const watermarkImages = normalizeList(images?.watermark);
  const backgroundImages = normalizeList(images?.background);

  const metadataEntries = useMemo(() => Object.entries(metadataEnabled || {}), [metadataEnabled]);

  const metadataSource = metadataSnapshot?.metadata || metadataSnapshot || {};
  const coreMetadataKeys = ['document_id', 'document_title', 'document_type', 'created_at', 'created_by', 'updated_at', 'extracted_at'];

  const flattenMetadata = (value, prefix) => {
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value).flatMap(([key, nested]) => {
      const nextKey = prefix ? `${prefix}.${key}` : key;
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return flattenMetadata(nested, nextKey);
      }
      return [nextKey];
    });
  };

  const structuredMetadataKeys = useMemo(
    () => flattenMetadata(metadataSource?.document_metadata || {}, 'document_metadata'),
    [metadataSource]
  );

  const customMetadataKeys = useMemo(
    () => flattenMetadata(metadataSource?.custom_metadata || {}, 'custom_metadata'),
    [metadataSource]
  );

  const groupedMetadataKeys = useMemo(() => {
    const allKeys = new Set(Object.keys(metadataEnabled || {}));
    coreMetadataKeys.forEach((key) => allKeys.add(key));
    structuredMetadataKeys.forEach((key) => allKeys.add(key));
    customMetadataKeys.forEach((key) => allKeys.add(key));
    return {
      core: coreMetadataKeys.filter((key) => allKeys.has(key)),
      structured: structuredMetadataKeys.filter((key) => allKeys.has(key)),
      custom: customMetadataKeys.filter((key) => allKeys.has(key)),
      extras: Array.from(allKeys).filter(
        (key) => !coreMetadataKeys.includes(key) && !structuredMetadataKeys.includes(key) && !customMetadataKeys.includes(key)
      ),
    };
  }, [coreMetadataKeys, customMetadataKeys, metadataEnabled, structuredMetadataKeys]);

  const setMetadataGroupEnabled = (keys, enabled) => {
    keys.forEach((key) => {
      onUpdate(['processing_settings', 'metadata_fields', 'enabled', key], enabled);
    });
  };

  const isGroupEnabled = (keys) =>
    keys.length > 0 && keys.every((key) => Boolean(metadataEnabled?.[key]));

  const handleJsonChange = (path, value) => {
    try {
      const parsed = value ? JSON.parse(value) : {};
      onUpdate(path, parsed);
    } catch (error) {
      onUpdate(path, value);
    }
  };

  const handleAddMetadataField = () => {
    if (!newMetadataField.trim()) return;
    onUpdate(['processing_settings', 'metadata_fields', 'enabled', newMetadataField.trim()], newFieldEnabled);
    setNewMetadataField('');
  };

  return (
    <div className="space-y-4 relative">
      {/* Saving overlay */}
      {exportSaving && (
        <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-20 flex flex-col items-center justify-center rounded-lg">
          <div className="h-6 w-6 animate-spin rounded-full border-3 border-blue-200 border-t-blue-600" />
          <span className="mt-2 text-xs font-medium text-gray-500">Saving settings…</span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 truncate">Export Studio</h3>
          <p className="text-xs text-gray-500 truncate">Post-processing settings with live preview.</p>
        </div>
        <button
          type="button"
          onClick={onRefreshPreview}
          disabled={exportSaving}
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50"
        >
          <RefreshCw size={14} className={exportSaving ? 'animate-spin' : ''} /> Refresh preview
        </button>
      </div>

      {exportError && (
        <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
          {exportError}
        </div>
      )}

      {exportLoading ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
          Loading export settings…
        </div>
      ) : (
        <>
          {/* ── Header & Footer (unified: mode toggle → PDF Overlay / Template / None) ── */}
          <SectionCard title="Header & Footer" description="Choose PDF overlay or template-based header/footer.">
            <div className="space-y-4">
              {/* ── Header ── */}
              <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                    <FileText size={14} className="text-blue-500" />
                    Header
                    {headerMode === 'pdf' && headerPdfConfig?.file_id && (
                      <span className="ml-1 text-[10px] font-medium text-sky-600 bg-sky-50 px-1.5 py-0.5 rounded">PDF</span>
                    )}
                    {headerMode === 'template' && exportDraft?.header_template && (
                      <span className="ml-1 text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">Template</span>
                    )}
                  </div>
                  <ModeToggle value={headerMode} onChange={(m) => handleModeChange('header', m)} accent="blue" />
                </div>

                {headerMode === 'pdf' && (
                  <HeaderFooterCropEditor
                    documentId={documentId}
                    pdfFiles={pdfFiles}
                    headerPdfConfig={headerPdfConfig}
                    footerPdfConfig={null}
                    onSaveHeaderFooterPdf={onSaveHeaderFooterPdf}
                    onRemoveHeaderFooterPdf={onRemoveHeaderFooterPdf}
                    onUploadPdfFile={onUploadPdfFile}
                    onRefreshPreview={onRefreshPreview}
                    showOnly="header"
                  />
                )}

                {headerMode === 'template' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-1">Header template</label>
                      <select
                        value={exportDraft?.header_template || ''}
                        onChange={(e) => onUpdate(['header_template'], e.target.value || null)}
                        className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs"
                      >
                        <option value="">None</option>
                        {headerTemplates.map((tpl) => (
                          <option key={tpl.id || tpl.uuid} value={tpl.id || tpl.uuid}>
                            {tpl.name || tpl.title || tpl.id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-1">Header config (JSON)</label>
                      <textarea
                        rows={2}
                        value={typeof exportDraft?.header_config === 'string' ? exportDraft?.header_config : JSON.stringify(exportDraft?.header_config || {}, null, 2)}
                        onChange={(e) => handleJsonChange(['header_config'], e.target.value)}
                        className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-[11px] font-mono"
                      />
                    </div>
                  </div>
                )}

                {headerMode === 'none' && (
                  <p className="text-[11px] text-gray-400 italic">No header configured. Choose PDF Overlay or Template above.</p>
                )}
              </div>

              {/* ── Footer ── */}
              <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                    <FileText size={14} className="text-purple-500" />
                    Footer
                    {footerMode === 'pdf' && footerPdfConfig?.file_id && (
                      <span className="ml-1 text-[10px] font-medium text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">PDF</span>
                    )}
                    {footerMode === 'template' && exportDraft?.footer_template && (
                      <span className="ml-1 text-[10px] font-medium text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">Template</span>
                    )}
                  </div>
                  <ModeToggle value={footerMode} onChange={(m) => handleModeChange('footer', m)} accent="purple" />
                </div>

                {footerMode === 'pdf' && (
                  <HeaderFooterCropEditor
                    documentId={documentId}
                    pdfFiles={pdfFiles}
                    headerPdfConfig={null}
                    footerPdfConfig={footerPdfConfig}
                    onSaveHeaderFooterPdf={onSaveHeaderFooterPdf}
                    onRemoveHeaderFooterPdf={onRemoveHeaderFooterPdf}
                    onUploadPdfFile={onUploadPdfFile}
                    onRefreshPreview={onRefreshPreview}
                    showOnly="footer"
                  />
                )}

                {footerMode === 'template' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-1">Footer template</label>
                      <select
                        value={exportDraft?.footer_template || ''}
                        onChange={(e) => onUpdate(['footer_template'], e.target.value || null)}
                        className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs"
                      >
                        <option value="">None</option>
                        {footerTemplates.map((tpl) => (
                          <option key={tpl.id || tpl.uuid} value={tpl.id || tpl.uuid}>
                            {tpl.name || tpl.title || tpl.id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-1">Footer config (JSON)</label>
                      <textarea
                        rows={2}
                        value={typeof exportDraft?.footer_config === 'string' ? exportDraft?.footer_config : JSON.stringify(exportDraft?.footer_config || {}, null, 2)}
                        onChange={(e) => handleJsonChange(['footer_config'], e.target.value)}
                        className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-[11px] font-mono"
                      />
                    </div>
                  </div>
                )}

                {footerMode === 'none' && (
                  <p className="text-[11px] text-gray-400 italic">No footer configured. Choose PDF Overlay or Template above.</p>
                )}
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Table Rendering" description="Control how tables appear in exported PDFs.">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-gray-500 truncate">Style preset</label>
              <input
                value={tableConfig.style_preset || ''}
                onChange={(e) => onUpdate(['processing_settings', 'table_config', 'style_preset'], e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder="clean"
              />
              <label className="text-xs text-gray-500 truncate">Overflow mode</label>
              <input
                value={tableConfig.overflow_mode || ''}
                onChange={(e) => onUpdate(['processing_settings', 'table_config', 'overflow_mode'], e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder="split_columns"
              />
              <label className="text-xs text-gray-500 truncate">Split column count</label>
              <input
                type="number"
                value={tableConfig.split_column_count ?? ''}
                onChange={(e) => onUpdate(['processing_settings', 'table_config', 'split_column_count'], Number(e.target.value || 0))}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </SectionCard>

          <SectionCard title="PDF Layout" description="Set page size, typography, and margin presets.">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-gray-500 truncate">Page size</label>
              <select
                value={pdfLayout.page_size || ''}
                onChange={(e) => onUpdate(['processing_settings', 'pdf_layout', 'page_size'], e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select page size</option>
                {pageSizeOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <label className="text-xs text-gray-500 truncate">Font family</label>
              <select
                value={pdfLayout.font_family || ''}
                onChange={(e) => onUpdate(['processing_settings', 'pdf_layout', 'font_family'], e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select font family</option>
                {fontFamilyOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <label className="text-xs text-gray-500 truncate">Font size</label>
              <select
                value={pdfLayout.font_size || ''}
                onChange={(e) => onUpdate(['processing_settings', 'pdf_layout', 'font_size'], e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select font size</option>
                {fontSizeOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <label className="text-xs text-gray-500 truncate">Line spacing</label>
              <select
                value={pdfLayout.line_spacing || ''}
                onChange={(e) => onUpdate(['processing_settings', 'pdf_layout', 'line_spacing'], e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select line spacing</option>
                {lineSpacingOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <label className="text-xs text-gray-500 truncate">Margin size</label>
              <select
                value={pdfLayout.margin_size || ''}
                onChange={(e) => onUpdate(['processing_settings', 'pdf_layout', 'margin_size'], e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select margin size</option>
                {marginSizeOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <label className="text-xs text-gray-500 truncate">Image size</label>
              <select
                value={pdfLayout.image_size || ''}
                onChange={(e) => onUpdate(['processing_settings', 'pdf_layout', 'image_size'], e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select image size</option>
                {imageSizeOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <label className="text-xs text-gray-500 truncate">Caption alignment</label>
              <select
                value={pdfLayout.caption_alignment || 'center'}
                onChange={(e) => onUpdate(['processing_settings', 'pdf_layout', 'caption_alignment'], e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                {captionAlignmentOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            <div className="mt-3 space-y-2">
              <Toggle
                checked={Boolean(pdfLayout.show_unprintable_area)}
                onChange={(value) => onUpdate(['processing_settings', 'pdf_layout', 'show_unprintable_area'], value)}
                label="Show unprintable area"
              />
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-gray-500 truncate">Unprintable area</label>
                <select
                  value={pdfLayout.unprintable_area || ''}
                  onChange={(e) => onUpdate(['processing_settings', 'pdf_layout', 'unprintable_area'], e.target.value)}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Select unprintable area</option>
                  {unprintableAreaOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="File Components" description="Adjust how attached documents render.">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-gray-500 truncate">Width percent</label>
              <input
                type="number"
                value={fileConfig.width_percent ?? ''}
                onChange={(e) => onUpdate(['processing_settings', 'file_config', 'width_percent'], Number(e.target.value || 0))}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <label className="text-xs text-gray-500 truncate">Page range</label>
              <input
                value={fileConfig.page_range || ''}
                onChange={(e) => onUpdate(['processing_settings', 'file_config', 'page_range'], e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder="1-3,5"
              />
            </div>
            <div className="mt-3 space-y-2">
              <Toggle
                checked={Boolean(fileConfig.show_border)}
                onChange={(value) => onUpdate(['processing_settings', 'file_config', 'show_border'], value)}
                label="Show border"
              />
              <Toggle
                checked={Boolean(fileConfig.show_caption_metadata)}
                onChange={(value) => onUpdate(['processing_settings', 'file_config', 'show_caption_metadata'], value)}
                label="Show caption metadata"
              />
            </div>
          </SectionCard>

          <SectionCard title="PDF Images" description="Select logo, watermark, or background art.">
            <div className="space-y-3">
              {[{ key: 'logo', label: 'Logo', options: logoImages },
                { key: 'watermark', label: 'Watermark', options: watermarkImages },
                { key: 'background', label: 'Background', options: backgroundImages }].map((entry) => (
                <div key={entry.key} className="space-y-2">
                  <label className="text-xs text-gray-500 truncate">{entry.label}</label>
                  <div className="flex gap-2 min-w-0">
                    <select
                      value={pdfImages[`${entry.key}_image_id`] || ''}
                      onChange={(e) => onUpdate(['processing_settings', 'pdf_images', `${entry.key}_image_id`], e.target.value || null)}
                      className="flex-1 min-w-0 rounded-md border border-gray-300 px-3 py-2 text-sm truncate"
                    >
                      <option value="">None</option>
                      {entry.options.map((img) => (
                        <option key={img.id} value={img.id}>
                          {img.name || img.filename || img.id}
                        </option>
                      ))}
                    </select>
                    <label className="inline-flex items-center gap-2 text-xs text-blue-600 cursor-pointer">
                      <Upload size={14} /> Upload
                      <input
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          onUploadImage(file, entry.key);
                        }}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Metadata Fields" description="Choose which metadata keys appear in the export.">
            <div className="space-y-4">
              {!metadataSnapshot && metadataEntries.length === 0 && (
                <p className="text-xs text-gray-500">No metadata snapshot available yet.</p>
              )}

              {[
                { title: 'Core metadata', keys: groupedMetadataKeys.core },
                { title: 'Structured metadata', keys: groupedMetadataKeys.structured },
                { title: 'Custom metadata', keys: groupedMetadataKeys.custom },
                { title: 'Other', keys: groupedMetadataKeys.extras },
              ].map((group) => (
                <div key={group.title} className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-medium text-gray-500 min-w-0">
                    <span className="truncate">{group.title}</span>
                    {group.title === 'Core metadata' && group.keys.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setMetadataGroupEnabled(group.keys, !isGroupEnabled(group.keys))}
                        className="text-[11px] text-blue-600 hover:text-blue-700"
                      >
                        {isGroupEnabled(group.keys) ? 'Disable all' : 'Enable all'}
                      </button>
                    )}
                  </div>
                  {group.keys.length === 0 ? (
                    <p className="text-xs text-gray-400">No fields found.</p>
                  ) : (
                    group.keys.map((key) => (
                      <Toggle
                        key={key}
                        checked={Boolean(metadataEnabled?.[key])}
                        onChange={(value) => onUpdate(['processing_settings', 'metadata_fields', 'enabled', key], value)}
                        label={key}
                      />
                    ))
                  )}
                </div>
              ))}

              <div className="rounded-lg border border-gray-200 p-3 space-y-2">
                <label className="text-xs text-gray-500 truncate">Add metadata field</label>
                <input
                  value={newMetadataField}
                  onChange={(e) => setNewMetadataField(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  placeholder="custom_metadata.dates"
                />
                <div className="flex items-center justify-between">
                  <Toggle
                    checked={newFieldEnabled}
                    onChange={setNewFieldEnabled}
                    label="Enabled"
                  />
                  <button
                    type="button"
                    onClick={handleAddMetadataField}
                    className="text-xs text-blue-600 hover:text-blue-700"
                  >
                    Add field
                  </button>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="PDF Security" description="Password protect exported PDFs.">
            <div className="space-y-3">
              <Toggle
                checked={Boolean(pdfSecurity.enabled)}
                onChange={(value) => onUpdate(['processing_settings', 'pdf_security', 'enabled'], value)}
                label="Enable PDF encryption"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="password"
                  value={pdfSecurity.user_password || ''}
                  onChange={(e) => onUpdate(['processing_settings', 'pdf_security', 'user_password'], e.target.value)}
                  disabled={!pdfSecurity.enabled}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                  placeholder="User password"
                />
                <input
                  type="password"
                  value={pdfSecurity.owner_password || ''}
                  onChange={(e) => onUpdate(['processing_settings', 'pdf_security', 'owner_password'], e.target.value)}
                  disabled={!pdfSecurity.enabled}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                  placeholder="Owner password"
                />
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <ShieldCheck size={14} /> Passwords are stored with the document export settings.
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Text Protection" description="Rasterize the PDF to discourage text extraction.">
            <div className="space-y-3">
              <Toggle
                checked={Boolean(pdfTextProtection.enabled)}
                onChange={(value) => onUpdate(['processing_settings', 'pdf_text_protection', 'enabled'], value)}
                label="Enable text protection"
              />
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-gray-500 truncate">Mode</label>
                <select
                  value={pdfTextProtection.mode || 'rasterize'}
                  onChange={(e) => onUpdate(['processing_settings', 'pdf_text_protection', 'mode'], e.target.value)}
                  disabled={!pdfTextProtection.enabled}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                >
                  <option value="rasterize">Rasterize</option>
                </select>
                <label className="text-xs text-gray-500 truncate">DPI</label>
                <input
                  type="number"
                  value={pdfTextProtection.dpi ?? 200}
                  onChange={(e) => onUpdate(['processing_settings', 'pdf_text_protection', 'dpi'], Number(e.target.value || 0))}
                  disabled={!pdfTextProtection.enabled}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                />
              </div>
              <Toggle
                checked={Boolean(pdfTextProtection.remove_metadata)}
                onChange={(value) => onUpdate(['processing_settings', 'pdf_text_protection', 'remove_metadata'], value)}
                label="Remove metadata"
              />
              <input
                type="text"
                value={pdfTextProtection.encryption_key || ''}
                onChange={(e) => onUpdate(['processing_settings', 'pdf_text_protection', 'encryption_key'], e.target.value)}
                disabled={!pdfTextProtection.enabled}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                placeholder="Optional encryption key"
              />
            </div>
          </SectionCard>

          <SectionCard title="Custom Metadata" description="Advanced export metadata overrides.">
            <textarea
              rows={4}
              value={typeof exportDraft?.custom_metadata === 'string' ? exportDraft?.custom_metadata : JSON.stringify(exportDraft?.custom_metadata || {}, null, 2)}
              onChange={(e) => handleJsonChange(['custom_metadata'], e.target.value)}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-xs font-mono"
            />
          </SectionCard>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={!exportDirty || exportSaving}
              className={`flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${exportDirty ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-400'}`}
            >
              <Save size={16} /> {exportSaving ? 'Saving…' : 'Save settings'}
            </button>
            <button
              type="button"
              onClick={onReset}
              disabled={!exportDirty}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              <RefreshCw size={16} /> Reset
            </button>
          </div>

          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{exportDirty ? 'Unsaved changes' : 'All changes saved'}</span>
            <span className="inline-flex items-center gap-1">
              <Download size={12} /> Export preview updates on save
            </span>
          </div>
        </>
      )}
    </div>
  );
};

export default ExportSettingsPanel;
