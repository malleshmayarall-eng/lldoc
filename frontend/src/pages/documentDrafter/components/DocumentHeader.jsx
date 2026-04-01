import React, { useState, useRef, useEffect } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  ChevronDown,
  Download,
  Eye,
  FileText,
  GitBranch,
  History,
  Clock,
  Image as ImageIcon,
  Info,
  Layout,
  List,
  Paperclip as PaperclipIcon,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Type,
  Users,
  Edit3,
  Sparkles,
  X as CloseIcon,
  Bot,
  MessageSquare,
  Cpu,
  Network,
} from 'lucide-react';
import CitationStyleSelector from '../../../components/CitationStyleSelector';
import RichTextToolbar from '../../../components/RichTextToolbar';

const DOCUMENT_STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft', color: 'bg-gray-100 text-gray-700' },
  { value: 'under_review', label: 'Under Review', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'done', label: 'Done', color: 'bg-emerald-100 text-emerald-800' },
];

const DocumentHeader = ({
  navigate,
  isViewer,
  effectiveViewMode,
  isPreviewMode,
  setIsPreviewMode,
  onPreviewClick,
  canModifyContent,
  addSection,
  showFormatToolbar,
  setShowFormatToolbar,
  loadCompleteDocument,
  showSectionTree,
  onToggleSectionTree,
  activeSidebar,
  setActiveSidebar,
  completeDocument,
  citationStyle,
  setCitationStyle,
  handleOpenTextSearch,
  canShare,
  saveDocumentGoldenPath,
  hasChanges,
  saving,
  lastSaveStatus,
  lastSavedAt,
  lastSaveError,
  documentWorkflows,
  stats,
  metadata,
  aiScoreLoading,
  onRunAiReview,
  onOpenExportStudio,
  onOpenAiChat,
  onRichTextCommand,
  toolbarTextColor,
  toolbarBackgroundColor,
  toolbarOpacity,
  toolbarFontSize,
  reviewCommentTotalCount = 0,
  documentStatus,
  onStatusChange,
}) => {
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const statusDropdownRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target)) {
        setStatusDropdownOpen(false);
      }
    };
    if (statusDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [statusDropdownOpen]);

  const currentStatusOption = DOCUMENT_STATUS_OPTIONS.find(o => o.value === documentStatus) || DOCUMENT_STATUS_OPTIONS[0];
  return (
    <>
      <div className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-gray-200 shadow-sm">
        <div className="mx-auto w-full px-4 md:px-6 py-3">
          <div className="flex flex-wrap items-center justify-center gap-2">
          <button onClick={() => navigate('/documents')} className="p-2 hover:bg-gray-100 rounded" title="Back">
            <ArrowLeft size={20} />
          </button>
          <div className="w-px h-6 bg-gray-300" />

          <button
            onClick={() => {
              if (onPreviewClick) {
                onPreviewClick();
                return;
              }
              if (!isViewer) {
                setIsPreviewMode(!isPreviewMode);
              }
            }}
            className={`px-3 py-1.5 rounded flex items-center gap-2 ${
              effectiveViewMode ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
            } ${isViewer ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80'}`}
            disabled={isViewer}
            title={
              isViewer
                ? 'View-Only Access'
                : effectiveViewMode
                  ? 'Switch to Edit Mode'
                  : 'Switch to Preview Mode'
            }
          >
            {effectiveViewMode ? <Eye size={16} /> : <Edit3 size={16} />}
            <span className="text-sm font-medium">
              {isViewer ? 'View Only' : 'View Preview'}
            </span>
          </button>

          {/* Document Status Dropdown */}
          <div className="w-px h-6 bg-gray-300" />
          <div className="relative" ref={statusDropdownRef}>
            <button
              onClick={() => !isViewer && setStatusDropdownOpen(!statusDropdownOpen)}
              className={`px-3 py-1.5 rounded flex items-center gap-2 text-sm font-medium ${currentStatusOption.color} ${
                isViewer ? 'opacity-70 cursor-default' : 'hover:opacity-80 cursor-pointer'
              }`}
              title="Document Status"
              disabled={isViewer}
            >
              <span>{currentStatusOption.label}</span>
              {!isViewer && <ChevronDown size={14} />}
            </button>
            {statusDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[160px]">
                {DOCUMENT_STATUS_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      onStatusChange?.(option.value);
                      setStatusDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${
                      option.value === documentStatus ? 'font-semibold' : ''
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${option.color.split(' ')[0].replace('100', '500')}`} />
                    {option.label}
                    {option.value === documentStatus && (
                      <span className="ml-auto text-blue-600">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {!effectiveViewMode && canModifyContent && (
            <>
              <div className="w-px h-6 bg-gray-300" />

              <button
                onClick={() => setShowFormatToolbar(!showFormatToolbar)}
                className={`px-3 py-1.5 rounded flex items-center gap-2 ${
                  showFormatToolbar
                    ? 'bg-blue-600 text-white'
                    : 'hover:bg-blue-50 text-blue-600'
                }`}
                title="Format Toolbar"
              >
                <Type size={16} />
                <span className="text-sm font-medium">Format</span>
              </button>
            </>
          )}

          <div className="w-px h-6 bg-gray-300" />

          <button onClick={() => loadCompleteDocument()} className="p-2 rounded hover:bg-gray-100" title="Refresh">
            <RefreshCw size={18} />
          </button>

          <button
            onClick={() => onRunAiReview?.()}
            className={`px-3 py-1.5 rounded flex items-center gap-2 ${
              aiScoreLoading ? 'bg-blue-50 text-blue-600' : 'hover:bg-blue-50 text-blue-600'
            }`}
            title="Run AI Review"
          >
            <Sparkles size={16} />
            <span className="text-sm font-medium">AI Review</span>
          </button>

          <div className="w-px h-6 bg-gray-300" />

          <button
            onClick={() => onToggleSectionTree?.()}
            className={`p-2 rounded hover:bg-gray-100 ${showSectionTree ? 'bg-blue-50 text-blue-600' : ''}`}
            title="Section Tree"
          >
            <List size={20} />
          </button>

          {canModifyContent && (
            <>
              <button
                onClick={() => setActiveSidebar(activeSidebar === 'images' ? null : 'images')}
                className={`p-2 rounded hover:bg-gray-100 ${activeSidebar === 'images' ? 'bg-blue-50 text-blue-600' : ''}`}
                title="Images"
              >
                <ImageIcon size={20} />
              </button>

              <button
                onClick={() => setActiveSidebar(activeSidebar === 'documents' ? null : 'documents')}
                className={`p-2 rounded hover:bg-gray-100 relative ${activeSidebar === 'documents' ? 'bg-blue-50 text-blue-600' : ''}`}
                title="Documents"
              >
                <PaperclipIcon size={20} />
                {stats?.file_components_count > 0 && (
                  <span className="absolute -top-1 -right-1 bg-green-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {stats.file_components_count}
                  </span>
                )}
              </button>
            </>
          )}

          <button
            onClick={() => setActiveSidebar(activeSidebar === 'info' ? null : 'info')}
            className={`p-2 rounded hover:bg-gray-100 ${activeSidebar === 'info' ? 'bg-blue-50 text-blue-600' : ''}`}
            title="Info"
          >
            <Info size={20} />
          </button>

          <button
            onClick={() => setActiveSidebar(activeSidebar === 'properties' ? null : 'properties')}
            className={`p-2 rounded hover:bg-gray-100 ${activeSidebar === 'properties' ? 'bg-blue-50 text-blue-600' : ''}`}
            title="Properties"
          >
            <Settings size={20} />
          </button>

          <button
            onClick={() => setActiveSidebar(activeSidebar === 'layout' ? null : 'layout')}
            className={`p-2 rounded hover:bg-gray-100 ${activeSidebar === 'layout' ? 'bg-blue-50 text-blue-600' : ''}`}
            title="Page Layout"
          >
            <Layout size={20} />
          </button>

          <button
            onClick={() => setActiveSidebar(activeSidebar === 'issues' ? null : 'issues')}
            className={`p-2 rounded hover:bg-gray-100 relative ${activeSidebar === 'issues' ? 'bg-blue-50 text-blue-600' : ''}`}
            title="Issues"
          >
            <AlertCircle size={20} />
            {completeDocument.issues?.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-yellow-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {completeDocument.issues.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveSidebar(activeSidebar === 'references' ? null : 'references')}
            className={`p-2 rounded hover:bg-gray-100 ${activeSidebar === 'references' ? 'bg-blue-50 text-blue-600' : ''}`}
            title="References"
          >
            <BookOpen size={20} />
          </button>

          {canModifyContent && (
            <button
              onClick={handleOpenTextSearch}
              className="p-2 rounded hover:bg-purple-100 hover:text-purple-600 transition-colors"
              title="Search & Insert Text (^)"
            >
              <div className="w-5 h-5 flex items-center justify-center font-bold text-lg">
                ^
              </div>
            </button>
          )}

          <div className="w-px h-6 bg-gray-300" />

          {/* Inline citation style selector disabled per request */}
          {/*
          <div className="flex items-center gap-2">
            <CitationStyleSelector
              currentStyle={citationStyle}
              onStyleChange={setCitationStyle}
            />
          </div>
          */}

          <button
            onClick={() => setActiveSidebar(activeSidebar === 'graph' ? null : 'graph')}
            className={`p-2 rounded hover:bg-gray-100 ${activeSidebar === 'graph' ? 'bg-blue-50 text-blue-600' : ''}`}
            title="Document Graph"
          >
            <GitBranch size={20} />
          </button>

          <button
            onClick={() => onOpenAiChat?.()}
            className={`p-2 rounded hover:bg-gray-100 ${activeSidebar === 'ai-chat' ? 'bg-purple-50 text-purple-600' : ''}`}
            title="AI Chat"
          >
            <Bot size={20} />
          </button>

          <button
            onClick={() => setActiveSidebar(activeSidebar === 'ai-services' ? null : 'ai-services')}
            className={`p-2 rounded hover:bg-gray-100 ${activeSidebar === 'ai-services' ? 'bg-purple-50 text-purple-600' : ''}`}
            title="AI Services"
          >
            <Cpu size={20} />
          </button>

          <button
            onClick={() => setActiveSidebar(activeSidebar === 'inference' ? null : 'inference')}
            className={`p-2 rounded hover:bg-gray-100 ${activeSidebar === 'inference' ? 'bg-indigo-50 text-indigo-600' : ''}`}
            title="Inference & Cross-References"
          >
            <Network size={20} />
          </button>

          {completeDocument?.id && (
            <button
              onClick={() => setActiveSidebar(activeSidebar === 'audit' ? null : 'audit')}
              className={`p-2 rounded hover:bg-gray-100 ${activeSidebar === 'audit' ? 'bg-blue-50 text-blue-600' : ''}`}
              title="History & Versions"
            >
              <History size={20} />
            </button>
          )}

          <div className="w-px h-6 bg-gray-300" />

          {completeDocument?.id && canShare && (
            <>
              <button
                onClick={() => setActiveSidebar(activeSidebar === 'sharing' ? null : 'sharing')}
                className={`p-2 rounded hover:bg-gray-100 ${activeSidebar === 'sharing' ? 'bg-blue-50 text-blue-600' : ''}`}
                title="Share & Access"
              >
                <Users size={20} />
              </button>

              <div className="w-px h-6 bg-gray-300" />
            </>
          )}

          <button
            onClick={() => setActiveSidebar(activeSidebar === 'workflow' ? null : 'workflow')}
            className={`p-2 rounded hover:bg-gray-100 relative ${activeSidebar === 'workflow' ? 'bg-blue-50 text-blue-600' : ''}`}
            title="Workflow"
          >
            <GitBranch size={20} />
            {documentWorkflows.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {documentWorkflows.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveSidebar(activeSidebar === 'review-comments' ? null : 'review-comments')}
            className={`p-2 rounded hover:bg-gray-100 relative ${activeSidebar === 'review-comments' ? 'bg-blue-50 text-blue-600' : ''}`}
            title="Review Comments"
          >
            <MessageSquare size={20} />
            {reviewCommentTotalCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] flex items-center justify-center rounded-full text-[9px] font-bold leading-none text-white bg-orange-500">
                {reviewCommentTotalCount > 99 ? '99+' : reviewCommentTotalCount}
              </span>
            )}
          </button>

          {!isViewer && (
            <button
              onClick={() => setActiveSidebar(activeSidebar === 'sections' ? null : 'sections')}
              className={`p-2 rounded hover:bg-gray-100 ${activeSidebar === 'sections' ? 'bg-violet-50 text-violet-600' : ''}`}
              title="Section Reference Browser"
            >
              <BookOpen size={20} />
            </button>
          )}

          <div className="w-px h-6 bg-gray-300" />

          {canModifyContent && (
            <button
              onClick={saveDocumentGoldenPath}
              disabled={!hasChanges || saving}
              className={`px-4 py-2 rounded flex items-center gap-2 font-medium ${
                hasChanges && !saving ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Save size={18} />
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}

          {!isViewer && (
            <button
              onClick={onOpenExportStudio}
              className={`px-4 py-2 rounded flex items-center gap-2 font-medium ${activeSidebar === 'export'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
              title="Export document"
            >
              <Download size={18} />
              Export
            </button>
          )}

          {isViewer && (
            <button
              onClick={() => {}}
              className="px-4 py-2 rounded flex items-center gap-2 font-medium bg-gray-100 hover:bg-gray-200 text-gray-700"
              title="Export document"
            >
              <Download size={18} />
              Export
            </button>
          )}
        </div>
  <div className="text-center mt-1 text-xs text-gray-500">
          {lastSaveStatus === 'saving' && 'Saving...'}
          {lastSaveStatus === 'ok' && <>Synced{lastSavedAt ? ` at ${new Date(lastSavedAt).toLocaleTimeString()}` : ''}</>}
          {lastSaveStatus === 'error' && (
            <span className="text-red-500">Save failed{lastSaveError ? `: ${lastSaveError}` : ''}</span>
          )}
          {lastSaveStatus === 'idle' && 'Idle'}
        </div>

        {!isViewer && showFormatToolbar ? (
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-2 rounded border border-gray-200 bg-white px-2 py-1 shadow-sm">
              <RichTextToolbar
                onCommand={onRichTextCommand}
                textColor={toolbarTextColor}
                backgroundColor={toolbarBackgroundColor}
                opacity={toolbarOpacity}
                fontSize={toolbarFontSize}
              />
              <button
                type="button"
                onClick={() => setShowFormatToolbar(false)}
                className="ml-1 rounded-full p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                title="Close"
              >
                <CloseIcon size={12} />
              </button>
            </div>
          </div>
        ) : (
          (stats || metadata) && (
            <div className="flex justify-center">
              <div className="inline-flex items-center gap-3 bg-white/95 backdrop-blur rounded-lg shadow-sm border border-gray-200 px-3 py-2">
                <div className="flex items-center gap-4 text-xs">
                  {stats && (
                    <>
                      {stats.sections_count !== undefined && (
                        <div className="flex items-center gap-1 text-gray-600">
                          <FileText size={12} className="text-blue-600" />
                          <span className="font-medium">{stats.sections_count}</span>
                          <span>sections</span>
                        </div>
                      )}
                      {stats.paragraphs_count !== undefined && (
                        <div className="flex items-center gap-1 text-gray-600">
                          <span className="font-medium">{stats.paragraphs_count}</span>
                          <span>paragraphs</span>
                        </div>
                      )}
                      {stats.tables_count > 0 && (
                        <div className="flex items-center gap-1 text-gray-600">
                          <span className="font-medium">{stats.tables_count}</span>
                          <span>tables</span>
                        </div>
                      )}
                      {stats.image_components_count > 0 && (
                        <div className="flex items-center gap-1 text-gray-600">
                          <ImageIcon size={12} className="text-purple-600" />
                          <span className="font-medium">{stats.image_components_count}</span>
                          <span>images</span>
                        </div>
                      )}
                      {stats.file_components_count > 0 && (
                        <div className="flex items-center gap-1 text-gray-600">
                          <PaperclipIcon size={12} className="text-green-600" />
                          <span className="font-medium">{stats.file_components_count}</span>
                          <span>files</span>
                        </div>
                      )}
                      {stats.word_count > 0 && (
                        <div className="flex items-center gap-1 text-gray-600">
                          <span className="font-medium">{stats.word_count}</span>
                          <span>words</span>
                        </div>
                      )}

                      <div className="w-px h-3 bg-gray-300" />
                    </>
                  )}

                  {metadata && (
                    <>
                      {metadata.version && (
                        <div className="flex items-center gap-1">
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">
                            v{metadata.major_version || 1}.{metadata.minor_version || 0}
                          </span>
                        </div>
                      )}
                      {metadata.is_draft && (
                        <div className="flex items-center gap-1">
                          <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded font-medium">
                            Draft
                          </span>
                        </div>
                      )}
                      {metadata.last_modified_by && (
                        <div className="flex items-center gap-1 text-gray-600">
                          <span className="text-gray-500">Modified by</span>
                          <span className="font-medium">{metadata.last_modified_by}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        )}
        </div>
      </div>
    </>
  );
};

export default DocumentHeader;
