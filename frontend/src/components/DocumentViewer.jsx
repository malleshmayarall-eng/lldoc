/**
 * DocumentViewer Component
 *
 * Comprehensive read-only document viewer for users with viewer/commenter access.
 * Renders the full document structure including:
 * - Sections with nested hierarchy (collapsible)
 * - Paragraphs with AI placeholder rendering
 * - Tables (read-only)
 * - Image components
 * - File components
 * - Document metadata header
 * - Share info footer
 * - Zoom controls
 *
 * Styled to match the editor's A4 page layout for visual consistency.
 */

import React, { useState } from 'react';
import {
  Eye,
  Download,
  Printer,
  ChevronDown,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Table as TableIcon,
  File,
  Calendar,
  User,
  Shield,
  Info,
  ExternalLink,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import ParagraphAiRenderer from './ParagraphAiRenderer';
import { mergeMetadataSources } from '../utils/metadataMerge';

// ─── Read-only Table Renderer ─────────────────────────────────────────────────
const ReadOnlyTable = ({ table }) => {
  const rawHeaders = table?.data?.headers ?? table?.column_headers ?? [];
  const headerItems = Array.isArray(rawHeaders) ? rawHeaders : Object.values(rawHeaders || {});
  const headers = headerItems.map((h) => {
    if (h && typeof h === 'object') return h.label ?? h.name ?? h.id ?? '';
    return h ?? '';
  });

  const rawRows = table?.data?.rows ?? table?.table_data ?? [];
  const rowsArray = Array.isArray(rawRows) ? rawRows : Object.values(rawRows || {});
  const rows = rowsArray.map((row) => {
    if (Array.isArray(row)) return row;
    if (row && row.cells && typeof row.cells === 'object' && !Array.isArray(row.cells)) {
      const rowKeys = headerItems.map((h) =>
        h && typeof h === 'object' ? h.id || h.label : h
      );
      return rowKeys.map((key) => (key ? row.cells[key] ?? '' : ''));
    }
    if (row && Array.isArray(row.cells)) return row.cells;
    if (row && typeof row === 'object') return Object.values(row);
    if (row == null) return [];
    return [row];
  });

  const caption = table?.caption ?? table?.title ?? '';

  if (headers.length === 0 && rows.length === 0) return null;

  return (
    <div className="my-4">
      {caption && (
        <p className="text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1.5">
          <TableIcon size={12} className="text-gray-400" />
          {caption}
        </p>
      )}
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-sm">
          {headers.length > 0 && (
            <thead>
              <tr className="bg-gray-50">
                {headers.map((h, i) => (
                  <th
                    key={i}
                    className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-200"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                {(Array.isArray(row) ? row : []).map((cell, ci) => (
                  <td key={ci} className="px-3 py-2 text-gray-700 border-b border-gray-100">
                    {cell != null ? String(cell) : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Read-only Image Renderer ─────────────────────────────────────────────────
const ReadOnlyImage = ({ data }) => {
  const [error, setError] = useState(false);

  const imageUrl =
    data?.image_url || data?.image_reference?.image_url || data?.image_reference?.image || null;
  const caption = data?.caption || '';
  const alignment = data?.alignment || 'center';
  const sizeMode = data?.size_mode || 'medium';

  const getWidth = () => {
    if (data?.custom_width_pixels) return `${data.custom_width_pixels}px`;
    if (data?.custom_width_percent) return `${data.custom_width_percent}%`;
    switch (sizeMode) {
      case 'small': return '25%';
      case 'medium': return '50%';
      case 'large': return '75%';
      case 'full': return '100%';
      default: return '50%';
    }
  };

  if (!imageUrl || error) {
    return (
      <div className={`flex ${alignment === 'left' ? 'justify-start' : alignment === 'right' ? 'justify-end' : 'justify-center'} my-3`}>
        <div
          className="bg-gray-100 border border-dashed border-gray-300 rounded flex items-center justify-center text-gray-400"
          style={{ width: getWidth(), minHeight: 80 }}
        >
          <ImageIcon size={24} />
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${alignment === 'left' ? 'items-start' : alignment === 'right' ? 'items-end' : 'items-center'} my-3`}>
      <img
        src={imageUrl}
        alt={caption || 'Document image'}
        className="rounded shadow-sm"
        style={{ width: getWidth(), maxWidth: '100%' }}
        onError={() => setError(true)}
      />
      {caption && (
        <p className="text-xs text-gray-500 mt-1 italic">{caption}</p>
      )}
    </div>
  );
};

// ─── Read-only File Component Renderer ────────────────────────────────────────
const ReadOnlyFileComponent = ({ data }) => {
  const label = data?.label || data?.file_reference?.name || 'Attached File';
  const fileUrl = data?.file_reference?.file_url || data?.file_reference?.file || null;
  const fileType = data?.file_reference?.file_type || '';

  return (
    <div className="my-3 flex items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
      <File size={16} className="text-blue-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{label}</p>
        {fileType && (
          <p className="text-xs text-gray-500">{fileType.toUpperCase()}</p>
        )}
      </div>
      {fileUrl && (
        <a
          href={fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-xs font-medium"
        >
          <ExternalLink size={12} />
          Open
        </a>
      )}
    </div>
  );
};

// ─── Metadata Summary ─────────────────────────────────────────────────────────
const MetadataSummary = ({ document: doc }) => {
  const [expanded, setExpanded] = useState(false);

  const items = [];
  if (doc.author) items.push({ icon: User, label: 'Author', value: doc.author });
  if (doc.document_type) items.push({ icon: FileText, label: 'Type', value: doc.document_type });
  if (doc.status) items.push({ icon: Shield, label: 'Status', value: doc.status });
  if (doc.effective_date) items.push({ icon: Calendar, label: 'Effective', value: new Date(doc.effective_date).toLocaleDateString() });
  if (doc.expiration_date) items.push({ icon: Calendar, label: 'Expires', value: new Date(doc.expiration_date).toLocaleDateString() });
  if (doc.governing_law) items.push({ icon: Shield, label: 'Governing Law', value: doc.governing_law });
  if (doc.jurisdiction) items.push({ icon: Shield, label: 'Jurisdiction', value: doc.jurisdiction });
  if (doc.reference_number) items.push({ icon: FileText, label: 'Ref #', value: doc.reference_number });
  if (doc.version) items.push({ icon: Info, label: 'Version', value: doc.version });

  if (items.length === 0) return null;

  const visible = expanded ? items : items.slice(0, 4);

  return (
    <div className="mb-6 border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Document Info</span>
        {expanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
      </button>
      <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-2">
        {visible.map(({ icon: Icon, label, value }, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <Icon size={13} className="text-gray-400 flex-shrink-0" />
            <span className="text-gray-500 font-medium">{label}:</span>
            <span className="text-gray-800 truncate">{value}</span>
          </div>
        ))}
      </div>
      {items.length > 4 && !expanded && (
        <div className="px-4 pb-2">
          <button onClick={() => setExpanded(true)} className="text-xs text-blue-600 hover:text-blue-800">
            +{items.length - 4} more fields
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sortByOrder = (items) =>
  [...(items || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

const getSectionContent = (section) => {
  const items = [];
  (section.paragraphs || []).forEach((p) => items.push({ type: 'paragraph', data: p, order: p.order ?? 0 }));
  (section.tables || []).forEach((t) => items.push({ type: 'table', data: t, order: t.order ?? 0 }));
  (section.image_components || []).forEach((img) => items.push({ type: 'image', data: img, order: img.order ?? 0 }));
  (section.file_components || []).forEach((f) => items.push({ type: 'file', data: f, order: f.order ?? 0 }));
  return items.sort((a, b) => a.order - b.order);
};

// ─── Main DocumentViewer ──────────────────────────────────────────────────────
const DocumentViewer = ({
  document,
  pageSettings = { size: 'a4', orientation: 'portrait' },
  citationStyle = 'apa',
  onExport,
  onPrint,
  shareInfo,
}) => {
  const [zoom, setZoom] = useState(100);
  const [collapsedSections, setCollapsedSections] = useState({});

  if (!document) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center py-20">
          <FileText size={48} className="mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500">No document to display</p>
        </div>
      </div>
    );
  }

  const effectiveShareInfo = shareInfo || document.share_info;

  const documentMetadata = mergeMetadataSources(
    document?.document_metadata,
    document?.metadata?.document_metadata,
    document?.custom_metadata,
    document?.metadata?.custom_metadata
  );

  const toggleSection = (sectionId) => {
    setCollapsedSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  // ─── Render a single section recursively ────────────────────────────────
  const renderSection = (section, depth = 0) => {
    const isCollapsed = collapsedSections[section.id];
    const content = getSectionContent(section);
    const children = sortByOrder(section.children || []);

    const headingSizes = {
      0: 'text-xl font-bold',
      1: 'text-lg font-bold',
      2: 'text-base font-semibold',
      3: 'text-sm font-semibold',
      4: 'text-sm font-medium',
    };
    const headingClass = headingSizes[Math.min(depth, 4)];

    return (
      <div key={section.id} className="mb-4">
        {/* Section Title */}
        {section.title && (
          <div
            className="flex items-center gap-2 mb-2 cursor-pointer group"
            onClick={() => toggleSection(section.id)}
          >
            <span className="text-gray-400 group-hover:text-gray-600 transition-colors">
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </span>
            <h2 className={`${headingClass} text-gray-900`}>
              {section.title}
            </h2>
          </div>
        )}

        {/* Section Content */}
        {!isCollapsed && (
          <div>
            {content.map((item, idx) => {
              switch (item.type) {
                case 'paragraph':
                  return (
                    <ParagraphAiRenderer
                      key={item.data.id || idx}
                      paragraph={item.data}
                      documentMetadata={documentMetadata}
                      className="mb-3 text-gray-800 leading-relaxed text-[14px]"
                    />
                  );
                case 'table':
                  return <ReadOnlyTable key={item.data.id || idx} table={item.data} />;
                case 'image':
                  return <ReadOnlyImage key={item.data.id || idx} data={item.data} />;
                case 'file':
                  return <ReadOnlyFileComponent key={item.data.id || idx} data={item.data} />;
                default:
                  return null;
              }
            })}

            {/* Nested subsections */}
            {children.map((child) => renderSection(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const sections = sortByOrder(document.sections || []);
  const totalParagraphs = sections.reduce((sum, s) => sum + (s.paragraphs?.length || 0), 0);
  const totalTables = sections.reduce((sum, s) => sum + (s.tables?.length || 0), 0);

  return (
    <div className="h-full flex flex-col bg-gray-100">
      {/* ─── Viewer Toolbar ──────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 py-2.5 flex-shrink-0">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          {/* Left: Title & badge */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-50 border border-amber-200">
              <Eye className="text-amber-600" size={16} />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-gray-900 truncate">
                {document.title || 'Untitled Document'}
              </h1>
              <p className="text-xs text-gray-500">
                Read-only view
                {effectiveShareInfo && (
                  <> • Shared by{' '}
                    <span className="font-medium text-gray-700">
                      {effectiveShareInfo.shared_by_name ||
                        effectiveShareInfo.shared_by ||
                        document.author ||
                        'owner'}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Center: Zoom */}
          <div className="hidden sm:flex items-center gap-1.5 bg-gray-100 rounded-lg px-2 py-1">
            <button
              onClick={() => setZoom((z) => Math.max(50, z - 10))}
              className="p-1 hover:bg-gray-200 rounded text-gray-600"
              title="Zoom out"
            >
              <ZoomOut size={14} />
            </button>
            <span className="text-xs text-gray-600 font-medium w-10 text-center">{zoom}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(150, z + 10))}
              className="p-1 hover:bg-gray-200 rounded text-gray-600"
              title="Zoom in"
            >
              <ZoomIn size={14} />
            </button>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-1.5">
            {onPrint && (
              <button
                onClick={onPrint}
                className="px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-gray-600 hover:bg-gray-100 text-sm transition-colors"
                title="Print"
              >
                <Printer size={14} />
                <span className="hidden sm:inline">Print</span>
              </button>
            )}
            {onExport && (
              <button
                onClick={onExport}
                className="px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-white bg-blue-600 hover:bg-blue-700 text-sm transition-colors"
                title="Export"
              >
                <Download size={14} />
                <span className="hidden sm:inline">Export</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── Document Content ────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto py-8">
        <div
          className="mx-auto transition-transform"
          style={{ width: `${794 * (zoom / 100)}px` }}
        >
          {/* A4 Page Container */}
          <div
            className="bg-white shadow-lg mx-auto rounded-sm"
            style={{
              width: '794px',
              minHeight: '1123px',
              padding: '48px 56px',
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'top center',
            }}
          >
            {/* Document Title */}
            <div className="mb-6 pb-4 border-b border-gray-200">
              <h1 className="text-2xl font-bold text-gray-900 mb-1">
                {document.title || 'Untitled Document'}
              </h1>
              {document.author && (
                <p className="text-sm text-gray-600">By {document.author}</p>
              )}
              {document.created_at && (
                <p className="text-xs text-gray-400 mt-1">
                  Created {new Date(document.created_at).toLocaleDateString()}
                  {document.updated_at && document.updated_at !== document.created_at && (
                    <> • Updated {new Date(document.updated_at).toLocaleDateString()}</>
                  )}
                </p>
              )}
            </div>

            {/* Metadata Summary */}
            <MetadataSummary document={document} />

            {/* Document Sections */}
            {sections.length > 0 ? (
              <div className="prose prose-sm max-w-none">
                {sections.map((section) => renderSection(section, 0))}
              </div>
            ) : (
              <div className="text-center py-16 text-gray-400">
                <FileText size={40} className="mx-auto mb-3 opacity-50" />
                <p className="text-sm">This document has no content yet.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Footer Info ─────────────────────────────────────────────── */}
      <div className="bg-white border-t border-gray-200 px-6 py-2 flex-shrink-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-xs text-gray-500">
          <span className="flex items-center gap-3">
            <span>{sections.length} section{sections.length !== 1 ? 's' : ''}</span>
            <span className="text-gray-300">•</span>
            <span>{totalParagraphs} paragraph{totalParagraphs !== 1 ? 's' : ''}</span>
            {totalTables > 0 && (
              <>
                <span className="text-gray-300">•</span>
                <span>{totalTables} table{totalTables !== 1 ? 's' : ''}</span>
              </>
            )}
          </span>
          <span className="flex items-center gap-1.5">
            <Eye size={12} className="text-amber-500" />
            <span className="font-medium text-amber-700">View Only</span>
          </span>
        </div>
      </div>
    </div>
  );
};

export default DocumentViewer;
