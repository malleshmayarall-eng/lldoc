/**
 * MasterDocumentsPage
 *
 * Full-page view for managing master documents — search, list, create,
 * AI-generate, branch, duplicate. Uses the same layout/style patterns
 * as the Documents page.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookTemplate,
  Copy,
  FileText,
  GitBranch,
  Loader2,
  MoreVertical,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import useMasterDocuments from '../hooks/useMasterDocuments';
import MasterDocumentDetail from '../components/masters/MasterDocumentDetail';
import BranchCreatorDialog from '../components/masters/BranchCreatorDialog';
import AIGenerateMasterDialog from '../components/masters/AIGenerateMasterDialog';
import PromoteToMasterDialog from '../components/masters/PromoteToMasterDialog';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CATEGORIES = [
  { value: '', label: 'All Categories' },
  { value: 'contract', label: 'Contract' },
  { value: 'policy', label: 'Policy' },
  { value: 'nda', label: 'NDA' },
  { value: 'employment', label: 'Employment' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'terms', label: 'Terms & Conditions' },
  { value: 'memo', label: 'Memorandum' },
  { value: 'letter', label: 'Formal Letter' },
  { value: 'custom', label: 'Custom' },
];

const ORDERINGS = [
  { value: '-updated_at', label: 'Recently Updated' },
  { value: '-created_at', label: 'Newest First' },
  { value: 'name', label: 'Name A-Z' },
  { value: '-name', label: 'Name Z-A' },
  { value: '-branch_count', label: 'Most Branched' },
];

/* ------------------------------------------------------------------ */
/*  Reusable tiny components                                           */
/* ------------------------------------------------------------------ */

const Badge = ({ children, color = 'gray' }) => {
  const colors = {
    gray: 'bg-gray-100 text-gray-700',
    blue: 'bg-blue-100 text-blue-700',
    green: 'bg-green-100 text-green-700',
    purple: 'bg-purple-100 text-purple-700',
    amber: 'bg-amber-100 text-amber-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[color] || colors.gray}`}>
      {children}
    </span>
  );
};

/* ------------------------------------------------------------------ */
/*  MasterCard                                                         */
/* ------------------------------------------------------------------ */

const MasterCard = ({ master, onSelect, onBranch, onDelete }) => {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className="bg-white border border-gray-200 rounded-lg hover:shadow-md hover:border-blue-200 transition-all cursor-pointer group"
      onClick={() => onSelect(master)}
    >
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="bg-blue-50 p-2 rounded-lg flex-shrink-0">
              <BookTemplate className="h-5 w-5 text-blue-600" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900 truncate">{master.name}</h3>
              <p className="text-xs text-gray-500 truncate">
                {master.document_type} · {master.category}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="relative flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              className="p-1 rounded hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreVertical className="h-4 w-4 text-gray-400" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                <button
                  onClick={(e) => { e.stopPropagation(); onBranch(master); setMenuOpen(false); }}
                  className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50"
                >
                  <GitBranch className="h-4 w-4" /> New Branch
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(master.id); setMenuOpen(false); }}
                  className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-red-50 text-red-600"
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        {master.description && (
          <p className="text-sm text-gray-600 line-clamp-2 mb-3">{master.description}</p>
        )}

        {/* Tags */}
        {master.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {master.tags.slice(0, 4).map((tag) => (
              <Badge key={tag} color="blue">{tag}</Badge>
            ))}
            {master.tags.length > 4 && (
              <Badge color="gray">+{master.tags.length - 4}</Badge>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 text-xs text-gray-500 pt-3 border-t border-gray-100">
          <span className="flex items-center gap-1">
            <GitBranch className="h-3.5 w-3.5" />
            {master.branch_count || 0} branches
          </span>
          <span className="flex items-center gap-1">
            <Copy className="h-3.5 w-3.5" />
            {master.duplicate_count || 0} duplicates
          </span>
          {master.is_public && (
            <Badge color="green">Public</Badge>
          )}
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

const MasterDocumentsPage = () => {
  const navigate = useNavigate();
  const {
    masters,
    selectedMaster,
    loading,
    error,
    searchQuery,
    filters,
    fetchMaster,
    fetchBranches,
    deleteMaster,
    setSearch,
    setFilters,
  } = useMasterDocuments();

  const [showFilters, setShowFilters] = useState(false);
  const [detailMaster, setDetailMaster] = useState(null);
  const [branchTarget, setBranchTarget] = useState(null);
  const [showAIGenerate, setShowAIGenerate] = useState(false);
  const [showPromote, setShowPromote] = useState(false);

  // When a master is selected, fetch full detail + branches
  const handleSelectMaster = useCallback(async (master) => {
    try {
      const full = await fetchMaster(master.id);
      setDetailMaster(full);
      await fetchBranches({ master: master.id });
    } catch {
      // error handled by hook
    }
  }, [fetchMaster, fetchBranches]);

  const handleDeleteMaster = useCallback(async (id) => {
    if (!window.confirm('Delete this master document and all its configuration? (Branches are NOT deleted)')) return;
    try {
      await deleteMaster(id);
      if (detailMaster?.id === id) setDetailMaster(null);
    } catch {
      // error handled by hook
    }
  }, [deleteMaster, detailMaster]);

  // Branch created → navigate to the new document
  const handleBranchCreated = useCallback((branch) => {
    setBranchTarget(null);
    if (branch?.document) {
      navigate(`/drafter/${branch.document}`);
    }
  }, [navigate]);

  // AI-generated master → show detail
  const handleAIGenerated = useCallback((master) => {
    setShowAIGenerate(false);
    if (master) handleSelectMaster(master);
  }, [handleSelectMaster]);

  // Promoted → show detail
  const handlePromoted = useCallback((master) => {
    setShowPromote(false);
    if (master) handleSelectMaster(master);
  }, [handleSelectMaster]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <BookTemplate className="h-7 w-7 text-blue-600" />
              Master Documents
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Create reusable templates, branch for clients, and produce documents at scale
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPromote(true)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-1.5"
            >
              <Star className="h-4 w-4" /> Promote
            </button>
            <button
              onClick={() => setShowAIGenerate(true)}
              className="px-3 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 flex items-center gap-1.5"
            >
              <Sparkles className="h-4 w-4" /> AI Generate
            </button>
            <button
              onClick={() => setBranchTarget(null)}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-1.5"
              disabled // enabled only from detail / card
              title="Select a master first, then create branches"
            >
              <Plus className="h-4 w-4" /> New Master
            </button>
          </div>
        </div>

        {/* Search + Filters */}
        <div className="flex items-center gap-3 mt-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search master documents..."
              value={searchQuery}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <select
            value={filters.category}
            onChange={(e) => setFilters({ category: e.target.value })}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>

          <select
            value={filters.ordering}
            onChange={(e) => setFilters({ ordering: e.target.value })}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {ORDERINGS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────── */}
      <div className="flex h-[calc(100vh-180px)]">
        {/* Left: Master list */}
        <div className={`${detailMaster ? 'w-1/3 border-r border-gray-200' : 'w-full'} overflow-y-auto p-4 transition-all`}>
          {loading && masters.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : masters.length === 0 ? (
            <div className="text-center py-20">
              <BookTemplate className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-600 mb-2">No master documents yet</h3>
              <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
                Create a master document to start producing documents at scale.
                Use AI to generate one, or promote an existing document.
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => setShowAIGenerate(true)}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 flex items-center gap-1.5"
                >
                  <Sparkles className="h-4 w-4" /> AI Generate Master
                </button>
                <button
                  onClick={() => setShowPromote(true)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-1.5"
                >
                  <Star className="h-4 w-4" /> Promote Existing
                </button>
              </div>
            </div>
          ) : (
            <div className={`grid gap-3 ${detailMaster ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}`}>
              {masters.map((master) => (
                <MasterCard
                  key={master.id}
                  master={master}
                  onSelect={handleSelectMaster}
                  onBranch={(m) => setBranchTarget(m)}
                  onDelete={handleDeleteMaster}
                />
              ))}
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
          )}
        </div>

        {/* Right: Detail panel */}
        {detailMaster && (
          <div className="flex-1 overflow-y-auto">
            <MasterDocumentDetail
              master={detailMaster}
              onClose={() => setDetailMaster(null)}
              onBranch={() => setBranchTarget(detailMaster)}
              onRefresh={() => handleSelectMaster(detailMaster)}
            />
          </div>
        )}
      </div>

      {/* ── Dialogs ─────────────────────────────────────────────── */}
      {branchTarget && (
        <BranchCreatorDialog
          master={branchTarget}
          onCreated={handleBranchCreated}
          onClose={() => setBranchTarget(null)}
        />
      )}

      {showAIGenerate && (
        <AIGenerateMasterDialog
          onCreated={handleAIGenerated}
          onClose={() => setShowAIGenerate(false)}
        />
      )}

      {showPromote && (
        <PromoteToMasterDialog
          onPromoted={handlePromoted}
          onClose={() => setShowPromote(false)}
        />
      )}
    </div>
  );
};

export default MasterDocumentsPage;
