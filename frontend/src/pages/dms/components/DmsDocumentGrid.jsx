import { useNavigate } from 'react-router-dom';
import {
  FileText, Download, Calendar, User, Tag, Clock,
  ChevronRight, LayoutGrid, List, File,
} from 'lucide-react';

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-700',
  under_review: 'bg-yellow-100 text-yellow-800',
  analyzed: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  finalized: 'bg-emerald-100 text-emerald-800',
  active: 'bg-green-100 text-green-700',
  expired: 'bg-red-100 text-red-700',
  terminated: 'bg-red-100 text-red-700',
};

const fmtDate = (d) => {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return d; }
};

const fmtSize = (bytes) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
};

const fmtRelative = (d) => {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDate(d);
};

/* ─── Grid Card ─── */
const DocCard = ({ doc, onSelect }) => {
  const navigate = useNavigate();
  const statusClass = STATUS_COLORS[doc.status] || 'bg-gray-100 text-gray-600';

  return (
    <div
      onClick={() => { onSelect?.(doc); navigate(`/dms/documents/${doc.id}`); }}
      className="group bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md hover:border-blue-200 cursor-pointer transition-all"
    >
      {/* Top: icon + title + status */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
          <FileText size={18} className="text-blue-500" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate group-hover:text-blue-600 transition-colors">
            {doc.title || doc.original_filename || 'Untitled'}
          </h3>
          <p className="text-[11px] text-gray-400 truncate">
            {doc.original_filename}
          </p>
        </div>
        {doc.status && (
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${statusClass}`}>
            {doc.status.replace(/_/g, ' ')}
          </span>
        )}
      </div>

      {/* Meta chips */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {doc.document_type && (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded">
            <Tag size={9} /> {doc.document_type}
          </span>
        )}
        {doc.category && (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded">
            {doc.category}
          </span>
        )}
        {doc.extracted_pdf_author && (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-gray-50 text-gray-600 rounded">
            <User size={9} /> {doc.extracted_pdf_author}
          </span>
        )}
        {doc.extracted_pdf_page_count && (
          <span className="text-[10px] px-1.5 py-0.5 bg-gray-50 text-gray-500 rounded">
            {doc.extracted_pdf_page_count} pg{doc.extracted_pdf_page_count > 1 ? 's' : ''}
          </span>
        )}
        {doc.file_size > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 bg-gray-50 text-gray-500 rounded">
            {fmtSize(doc.file_size)}
          </span>
        )}
      </div>

      {/* Dates row */}
      <div className="flex items-center gap-3 text-[10px] text-gray-400">
        {doc.created_at && (
          <span className="flex items-center gap-1" title="Created">
            <Clock size={9} /> {fmtRelative(doc.created_at)}
          </span>
        )}
        {doc.updated_at && doc.updated_at !== doc.created_at && (
          <span className="flex items-center gap-1" title="Modified">
            Edited {fmtRelative(doc.updated_at)}
          </span>
        )}
        {doc.uploaded_date && (
          <span className="flex items-center gap-1" title="Upload date">
            <Calendar size={9} /> {fmtDate(doc.uploaded_date)}
          </span>
        )}
        {doc.created_by_name && (
          <span className="ml-auto flex items-center gap-1" title="Uploaded by">
            <User size={9} /> {doc.created_by_name}
          </span>
        )}
      </div>

      {/* Key dates highlight */}
      {(doc.effective_date || doc.expiration_date) && (
        <div className="mt-2 pt-2 border-t border-gray-50 flex gap-3 text-[10px]">
          {doc.effective_date && (
            <span className="text-green-600">
              Effective: {fmtDate(doc.effective_date)}
            </span>
          )}
          {doc.expiration_date && (
            <span className={`${new Date(doc.expiration_date) < new Date() ? 'text-red-600 font-semibold' : 'text-amber-600'}`}>
              Expires: {fmtDate(doc.expiration_date)}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

/* ─── List Row ─── */
const DocRow = ({ doc, onSelect }) => {
  const navigate = useNavigate();
  const statusClass = STATUS_COLORS[doc.status] || 'bg-gray-100 text-gray-600';

  return (
    <tr
      onClick={() => { onSelect?.(doc); navigate(`/dms/documents/${doc.id}`); }}
      className="border-t border-gray-100 hover:bg-blue-50/40 cursor-pointer transition-colors group"
    >
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <File size={14} className="text-gray-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate group-hover:text-blue-600 transition-colors">
              {doc.title || doc.original_filename || 'Untitled'}
            </p>
            <p className="text-[10px] text-gray-400 truncate">{doc.original_filename}</p>
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 text-xs text-gray-600">{doc.document_type || '—'}</td>
      <td className="px-3 py-2.5">
        {doc.status ? (
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusClass}`}>
            {doc.status.replace(/_/g, ' ')}
          </span>
        ) : <span className="text-xs text-gray-400">—</span>}
      </td>
      <td className="px-3 py-2.5 text-xs text-gray-500">{doc.extracted_pdf_author || '—'}</td>
      <td className="px-3 py-2.5 text-[11px] text-gray-400">{fmtRelative(doc.created_at)}</td>
      <td className="px-3 py-2.5 text-[11px] text-gray-400">{fmtRelative(doc.updated_at)}</td>
      <td className="px-3 py-2.5 text-[11px] text-gray-400">{fmtSize(doc.file_size)}</td>
      <td className="px-3 py-2.5">
        <ChevronRight size={14} className="text-gray-300 group-hover:text-blue-500 transition-colors" />
      </td>
    </tr>
  );
};

/* ─── Main Grid ─── */
const DmsDocumentGrid = ({ documents, loading, viewMode, onViewModeChange, onSelect }) => {
  return (
    <div>
      {/* Header bar */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">
          {loading ? 'Loading…' : `${documents.length} document${documents.length !== 1 ? 's' : ''}`}
        </h3>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => onViewModeChange('grid')}
            className={`p-1 rounded transition-colors ${viewMode === 'grid' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <LayoutGrid size={14} />
          </button>
          <button
            onClick={() => onViewModeChange('list')}
            className={`p-1 rounded transition-colors ${viewMode === 'list' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <List size={14} />
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      )}

      {/* Empty */}
      {!loading && documents.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <FileText size={40} className="mx-auto mb-3 text-gray-200" />
          <p className="text-sm font-medium">No documents found</p>
          <p className="text-xs mt-1">Try adjusting your filters or upload a new document</p>
        </div>
      )}

      {/* Grid view */}
      {!loading && documents.length > 0 && viewMode === 'grid' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {documents.map((doc) => (
            <DocCard key={doc.id} doc={doc} onSelect={onSelect} />
          ))}
        </div>
      )}

      {/* List view */}
      {!loading && documents.length > 0 && viewMode === 'list' && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-gray-50/80 text-[10px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Document</th>
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Author</th>
                <th className="px-3 py-2 font-semibold">Created</th>
                <th className="px-3 py-2 font-semibold">Modified</th>
                <th className="px-3 py-2 font-semibold">Size</th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <DocRow key={doc.id} doc={doc} onSelect={onSelect} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default DmsDocumentGrid;
