/**
 * MasterDocumentDetail
 *
 * Right-panel detail view for a selected master document.
 * Shows master metadata, template preview link, branch list,
 * and actions (branch, AI content, edit, delete).
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  BookTemplate,
  Clock,
  Copy,
  Edit3,
  ExternalLink,
  FileText,
  GitBranch,
  Loader2,
  MoreVertical,
  Tag,
  Trash2,
  User,
  X,
} from 'lucide-react';
import masterService from '../../services/masterService';

/* ------------------------------------------------------------------ */
/*  Branch Row                                                         */
/* ------------------------------------------------------------------ */

const BranchRow = ({ branch, onOpen, onDuplicate, onDelete }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const statusColors = {
    active: 'bg-green-100 text-green-700',
    archived: 'bg-gray-100 text-gray-600',
    merged: 'bg-blue-100 text-blue-700',
    superseded: 'bg-amber-100 text-amber-700',
  };

  return (
    <div className="flex items-center justify-between py-3 px-4 hover:bg-gray-50 rounded-lg group">
      <div className="flex items-center gap-3 min-w-0">
        <GitBranch className="h-4 w-4 text-gray-400 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{branch.branch_name}</p>
          <p className="text-xs text-gray-500 truncate">
            {branch.document_title || 'Untitled'} · {new Date(branch.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[branch.status] || statusColors.active}`}>
          {branch.status}
        </span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700`}>
          {branch.branch_type}
        </span>

        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            className="p-1 rounded hover:bg-gray-200 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <MoreVertical className="h-4 w-4 text-gray-400" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
              <button
                onClick={() => { onOpen(branch); setMenuOpen(false); }}
                className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50"
              >
                <ExternalLink className="h-4 w-4" /> Open Document
              </button>
              <button
                onClick={() => { onDuplicate(branch); setMenuOpen(false); }}
                className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50"
              >
                <Copy className="h-4 w-4" /> Duplicate
              </button>
              <button
                onClick={() => { onDelete(branch.id); setMenuOpen(false); }}
                className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-red-50 text-red-600"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

const MasterDocumentDetail = ({ master, onClose, onBranch, onRefresh }) => {
  const navigate = useNavigate();
  const [branches, setBranches] = useState(master?.branches || []);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: master?.name || '',
    description: master?.description || '',
    category: master?.category || 'contract',
    tags: (master?.tags || []).join(', '),
  });

  // Load branches for this master
  useEffect(() => {
    if (!master?.id) return;
    setLoadingBranches(true);
    masterService.getBranches({ master: master.id })
      .then((data) => setBranches(Array.isArray(data) ? data : data.results || []))
      .catch(() => {})
      .finally(() => setLoadingBranches(false));
  }, [master?.id]);

  // Reset edit form when master changes
  useEffect(() => {
    if (master) {
      setEditForm({
        name: master.name || '',
        description: master.description || '',
        category: master.category || 'contract',
        tags: (master.tags || []).join(', '),
      });
      setEditing(false);
    }
  }, [master]);

  const handleSave = useCallback(async () => {
    try {
      await masterService.updateMaster(master.id, {
        name: editForm.name,
        description: editForm.description,
        category: editForm.category,
        tags: editForm.tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      setEditing(false);
      onRefresh?.();
    } catch (err) {
      alert('Failed to update: ' + (err.response?.data?.detail || err.message));
    }
  }, [master, editForm, onRefresh]);

  const handleOpenBranch = useCallback((branch) => {
    if (branch.document) navigate(`/drafter/${branch.document}`);
  }, [navigate]);

  const handleDuplicateBranch = useCallback(async (branch) => {
    try {
      const result = await masterService.duplicateBranch(branch.id, {
        branch_name: `${branch.branch_name} (Copy)`,
      });
      setBranches((prev) => [result, ...prev]);
    } catch (err) {
      alert('Failed to duplicate: ' + (err.response?.data?.error || err.message));
    }
  }, []);

  const handleDeleteBranch = useCallback(async (branchId) => {
    if (!window.confirm('Delete this branch and its document?')) return;
    try {
      await masterService.deleteBranch(branchId);
      setBranches((prev) => prev.filter((b) => b.id !== branchId));
    } catch (err) {
      alert('Failed to delete: ' + (err.response?.data?.error || err.message));
    }
  }, []);

  if (!master) return null;

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="bg-blue-50 p-2 rounded-lg">
            <BookTemplate className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            {editing ? (
              <input
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                className="text-lg font-bold text-gray-900 border border-blue-300 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            ) : (
              <h2 className="text-lg font-bold text-gray-900">{master.name}</h2>
            )}
            <p className="text-xs text-gray-500">
              Created {new Date(master.created_at).toLocaleDateString()} by {master.created_by_username || 'unknown'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button onClick={handleSave} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">Save</button>
              <button onClick={() => setEditing(false)} className="px-3 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-50">Cancel</button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="p-1.5 rounded hover:bg-gray-100" title="Edit master">
              <Edit3 className="h-4 w-4 text-gray-500" />
            </button>
          )}
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>
      </div>

      {/* Body — scrollable */}
      <div className="flex-1 overflow-y-auto">
        {/* Description */}
        <div className="px-6 py-4 border-b border-gray-100">
          {editing ? (
            <textarea
              value={editForm.description}
              onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Description..."
            />
          ) : (
            <p className="text-sm text-gray-600">{master.description || 'No description'}</p>
          )}
        </div>

        {/* Meta grid */}
        <div className="px-6 py-4 border-b border-gray-100 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase">Category</p>
            {editing ? (
              <select
                value={editForm.category}
                onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm"
              >
                {['contract','policy','nda','employment','compliance','terms','memo','letter','custom'].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            ) : (
              <p className="text-gray-900 capitalize">{master.category}</p>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase">Document Type</p>
            <p className="text-gray-900">{master.document_type}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase">Branches</p>
            <p className="text-gray-900 font-semibold">{master.branch_count || 0}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase">Duplicates</p>
            <p className="text-gray-900 font-semibold">{master.duplicate_count || 0}</p>
          </div>
        </div>

        {/* Tags */}
        <div className="px-6 py-4 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase mb-2 flex items-center gap-1"><Tag className="h-3 w-3" /> Tags</p>
          {editing ? (
            <input
              value={editForm.tags}
              onChange={(e) => setEditForm((f) => ({ ...f, tags: e.target.value }))}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
              placeholder="tag1, tag2, tag3"
            />
          ) : master.tags?.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {master.tags.map((t) => (
                <span key={t} className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full text-xs font-medium">{t}</span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No tags</p>
          )}
        </div>

        {/* Template document link */}
        {master.template_document && (
          <div className="px-6 py-4 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-2 flex items-center gap-1">
              <FileText className="h-3 w-3" /> Template Document
            </p>
            <button
              onClick={() => navigate(`/drafter/${master.template_document}`)}
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 hover:underline"
            >
              {master.template_document_title || 'Untitled'} <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* ── Branches Section ─────────────────────────────────── */}
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-400 uppercase flex items-center gap-1">
              <GitBranch className="h-3 w-3" /> Branches ({branches.length})
            </p>
            <button
              onClick={onBranch}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 flex items-center gap-1"
            >
              <GitBranch className="h-3 w-3" /> New Branch
            </button>
          </div>

          {loadingBranches ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
            </div>
          ) : branches.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <GitBranch className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No branches yet. Create one to start producing documents.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {branches.map((b) => (
                <BranchRow
                  key={b.id}
                  branch={b}
                  onOpen={handleOpenBranch}
                  onDuplicate={handleDuplicateBranch}
                  onDelete={handleDeleteBranch}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MasterDocumentDetail;
