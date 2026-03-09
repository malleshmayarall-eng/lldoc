import { useEffect, useMemo, useRef, useState } from 'react';
import { Folder, FileText, UploadCloud, Plus, Search, ArrowLeft, Share2, ShieldCheck, Download, Trash2, Pencil } from 'lucide-react';
import { fileshareService } from '../../services/fileshareService';
import { useAuth } from '../../contexts/AuthContext';
import ShareDialog from '../../components/ShareDialog';

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString();
};

const toBreadcrumbs = (folder) => {
  if (!folder) return [];
  if (Array.isArray(folder.ancestors) && folder.ancestors.length) return folder.ancestors;
  return [];
};

const getRoleLabel = (role) => {
  if (!role) return '';
  if (role === 'editor') return 'Editor';
  if (role === 'commenter') return 'Commenter';
  if (role === 'viewer') return 'Viewer';
  return role;
};

const FileShareApp = () => {
  const { user } = useAuth();
  const fileInputRef = useRef(null);
  const [currentFolder, setCurrentFolder] = useState(null);
  const [driveRoots, setDriveRoots] = useState({
    personal: null,
    shared: null,
    organization: null,
    teams: [],
  });
  const [activeRootId, setActiveRootId] = useState(null);
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState({ loading: false, error: null });
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [shareTarget, setShareTarget] = useState(null);

  const hasItems = folders.length > 0 || files.length > 0;
  const filteredFolders = useMemo(() => {
    const items = folders.filter((folder) => folder?.id !== currentFolder?.id);
    if (!search) return items;
    return items.filter((folder) => folder.name?.toLowerCase().includes(search.toLowerCase()));
  }, [folders, search, currentFolder?.id]);

  const filteredFiles = useMemo(() => {
    if (!search) return files;
    return files.filter((file) => file.name?.toLowerCase().includes(search.toLowerCase()));
  }, [files, search]);

  const rootLabel = 'My Drive';
  const displayedBreadcrumbs = useMemo(() => {
    const filtered = breadcrumbs.filter((crumb) => crumb.id !== activeRootId);
    const personalRootId = driveRoots.personal?.id;
    if (activeRootId && personalRootId && activeRootId !== personalRootId) {
      const rootCandidates = [driveRoots.shared, driveRoots.organization, ...driveRoots.teams];
      const activeRoot = rootCandidates.find((root) => root?.id === activeRootId);
      if (activeRoot?.name && !filtered.some((crumb) => crumb.id === activeRootId)) {
        return [{ id: activeRootId, name: activeRoot.name }, ...filtered];
      }
    }
    return filtered;
  }, [breadcrumbs, activeRootId, driveRoots.personal?.id, driveRoots.shared, driveRoots.organization, driveRoots.teams]);

  const loadBreadcrumbs = async (folder) => {
    if (!folder) return [];
    if (Array.isArray(folder.ancestors) && folder.ancestors.length) return folder.ancestors;
    if (Array.isArray(folder.ancestor_ids) && folder.ancestor_ids.length) {
      const ancestorFolders = await Promise.all(
        folder.ancestor_ids.map((id) => fileshareService.getFolder(id))
      );
      return ancestorFolders.map((ancestor) => ({
        id: ancestor.id,
        name: ancestor.name || 'Folder',
      }));
    }
    return [];
  };

  const loadFolderContents = async (folderId) => {
    setStatus({ loading: true, error: null });
    try {
      const { folders: childFolders, files: childFiles } = await fileshareService.getChildren(folderId);
      setFolders(childFolders);
      setFiles(childFiles);
      setStatus({ loading: false, error: null });
    } catch (error) {
      const statusCode = error?.response?.status;
      const message =
        statusCode === 401
          ? 'Session expired. Please log in.'
          : statusCode === 404
            ? 'Folder no longer available.'
            : error?.response?.data?.detail || error?.message || 'Unable to load folder contents.';
      setStatus({ loading: false, error: message });
    }
  };

  const loadRoots = async () => {
    setStatus({ loading: true, error: null });
    try {
      const roots = await fileshareService.getRoots();
      const normalizedRoots = {
        personal: roots?.personal || null,
        shared: roots?.shared || null,
        organization: roots?.organization || null,
        teams: Array.isArray(roots?.teams) ? roots.teams : [],
      };
      setDriveRoots(normalizedRoots);

      const defaultRoot =
        normalizedRoots.personal ||
        normalizedRoots.shared ||
        normalizedRoots.organization ||
        normalizedRoots.teams?.[0] ||
        null;

      if (defaultRoot) {
  setCurrentFolder(defaultRoot);
  setActiveRootId(defaultRoot.id);
  setBreadcrumbs([]);
  await loadFolderContents(defaultRoot.id);
      } else {
        setFolders([]);
        setFiles([]);
        setStatus({ loading: false, error: null });
      }
    } catch (error) {
      const statusCode = error?.response?.status;
      const message =
        statusCode === 401
          ? 'Session expired. Please log in.'
          : statusCode === 404
            ? 'Folder no longer available.'
            : error?.response?.data?.detail || error?.message || 'Unable to load FileShare roots.';
      setStatus({ loading: false, error: message });
    }
  };

  useEffect(() => {
    loadRoots();
  }, []);

  const handleOpenFolder = async (folder) => {
    if (!folder?.id) return;
    setCurrentFolder(folder);
    setBreadcrumbs(await loadBreadcrumbs(folder));
    await loadFolderContents(folder.id);
  };

  const handleBreadcrumbClick = async (folderId) => {
    if (!folderId) return;
    const folder = await fileshareService.getFolder(folderId);
    setCurrentFolder(folder);
    setBreadcrumbs(await loadBreadcrumbs(folder));
    await loadFolderContents(folderId);
  };

  const handleRootSelect = async (root) => {
    if (!root?.id) return;
    setActiveRootId(root.id);
    setCurrentFolder(root);
    setBreadcrumbs([]);
    await loadFolderContents(root.id);
  };

  const handleUploadClick = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await fileshareService.uploadFile({ file, folderId: currentFolder?.id });
      await loadFolderContents(currentFolder?.id);
    } catch (error) {
      const message = error?.response?.data?.detail || error?.message || 'Upload failed. Try again or contact support.';
      setStatus({ loading: false, error: message });
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setStatus({ loading: true, error: null });
    try {
      await fileshareService.createFolder({ name: newFolderName.trim(), parentId: currentFolder?.id });
      setNewFolderName('');
      setShowNewFolder(false);
      await loadFolderContents(currentFolder?.id);
    } catch (error) {
      const message = error?.response?.data?.detail || error?.message || 'Could not create folder.';
      setStatus({ loading: false, error: message });
    }
  };

  const getDownloadUrl = (file) => fileshareService.getDownloadUrl(file);

  const handleDownload = async (file) => {
    if (!file?.id) return;
    setStatus({ loading: true, error: null });
    try {
      const result = await fileshareService.downloadFile(file);
      if (!result?.blob) {
        throw new Error('Download failed.');
      }
      const url = window.URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename || file?.name || file?.title || 'file';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setStatus({ loading: false, error: null });
    } catch (error) {
      const message = error?.response?.data?.detail || error?.message || 'Download failed.';
      setStatus({ loading: false, error: message });
    }
  };

  const handleDeleteFolder = async (folder) => {
    if (!folder?.id) return;
    const confirmed = window.confirm(`Delete folder "${folder.name || 'Untitled folder'}"?`);
    if (!confirmed) return;
    setStatus({ loading: true, error: null });
    try {
      await fileshareService.deleteFolder(folder.id);
      await loadFolderContents(currentFolder?.id);
    } catch (error) {
      const message = error?.response?.data?.detail || error?.message || 'Unable to delete folder.';
      setStatus({ loading: false, error: message });
    }
  };

  const handleDeleteFile = async (file) => {
    if (!file?.id) return;
    const confirmed = window.confirm(`Delete file "${file.name || file.title || 'Untitled file'}"?`);
    if (!confirmed) return;
    setStatus({ loading: true, error: null });
    try {
      await fileshareService.deleteFile(file.id);
      await loadFolderContents(currentFolder?.id);
    } catch (error) {
      const message = error?.response?.data?.detail || error?.message || 'Unable to delete file.';
      setStatus({ loading: false, error: message });
    }
  };

  const handleRenameFolder = async (folder) => {
    if (!folder?.id) return;
    const nextName = window.prompt('Rename folder', folder.name || '');
    if (!nextName || !nextName.trim() || nextName.trim() === folder.name) return;
    setStatus({ loading: true, error: null });
    try {
      await fileshareService.renameFolder(folder.id, nextName.trim());
      await loadFolderContents(currentFolder?.id);
    } catch (error) {
      const message = error?.response?.data?.detail || error?.message || 'Unable to rename folder.';
      setStatus({ loading: false, error: message });
    }
  };

  const handleRenameFile = async (file) => {
    if (!file?.id) return;
    const nextName = window.prompt('Rename file', file.name || file.title || '');
    if (!nextName || !nextName.trim() || nextName.trim() === (file.name || file.title)) return;
    setStatus({ loading: true, error: null });
    try {
      await fileshareService.renameFile(file.id, nextName.trim());
      await loadFolderContents(currentFolder?.id);
    } catch (error) {
      const message = error?.response?.data?.detail || error?.message || 'Unable to rename file.';
      setStatus({ loading: false, error: message });
    }
  };

  const permissionRole = currentFolder?.share_role;
  const showPermissionBanner = permissionRole && currentFolder?.owner?.id !== user?.id;
  const isSharedRootActive = Boolean(driveRoots.shared?.id && activeRootId === driveRoots.shared.id);
  const isViewerAccess = permissionRole === 'viewer';
  const canRenameItem = (item) => {
    if (item?.owner?.id && user?.id && item.owner.id === user.id) return true;
    const role = item?.share_role;
    return !role || role === 'editor';
  };

  return (
    <div className="min-h-full bg-gray-50 px-6 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-indigo-600 p-2 text-white">
            <Folder className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">FileShare</h1>
            <p className="text-sm text-gray-600">Suite Drive keeps shared folders and files together for your team.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isSharedRootActive && !isViewerAccess && (
            <>
              <button
                type="button"
                onClick={() => setShowNewFolder((prev) => !prev)}
                className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:border-indigo-300 hover:text-indigo-600"
              >
                <Plus className="h-4 w-4" />
                New folder
              </button>
              <button
                type="button"
                onClick={handleUploadClick}
                disabled={uploading}
                className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <UploadCloud className="h-4 w-4" />
                {uploading ? 'Uploading…' : 'Upload file'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleUpload}
              />
            </>
          )}
        </div>
      </header>

      {showPermissionBanner && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
          <ShieldCheck className="h-4 w-4" />
          You have {getRoleLabel(permissionRole)} access. Some actions may be limited.
        </div>
      )}

      {status.error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {status.error}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              const defaultRoot =
                driveRoots.personal ||
                driveRoots.shared ||
                driveRoots.organization ||
                driveRoots.teams?.[0] ||
                null;
              if (defaultRoot) handleRootSelect(defaultRoot);
            }}
            className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:border-indigo-300 hover:text-indigo-600"
          >
            <ArrowLeft className="h-4 w-4" />
            Roots
          </button>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>You're viewing</span>
            <span className="font-medium text-gray-900">{currentFolder?.name || 'My Drive'}</span>
          </div>
          <div className="flex w-full max-w-[720px] flex-nowrap items-center gap-2 overflow-x-auto pb-1">
            {driveRoots.personal && (
              <button
                type="button"
                onClick={() => handleRootSelect(driveRoots.personal)}
                className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                  activeRootId === driveRoots.personal.id
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600'
                }`}
              >
                My Drive
              </button>
            )}
            {driveRoots.shared && (
              <button
                type="button"
                onClick={() => handleRootSelect(driveRoots.shared)}
                className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                  activeRootId === driveRoots.shared.id
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600'
                }`}
              >
                Shared with me
              </button>
            )}
            {driveRoots.organization && (
              <button
                type="button"
                onClick={() => handleRootSelect(driveRoots.organization)}
                className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                  activeRootId === driveRoots.organization.id
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600'
                }`}
              >
                Org Drive
              </button>
            )}
            {driveRoots.teams?.map((teamRoot) => (
              <button
                key={teamRoot.id}
                type="button"
                onClick={() => handleRootSelect(teamRoot)}
                className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                  activeRootId === teamRoot.id
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600'
                }`}
              >
                {teamRoot.name || 'Team Drive'}
              </button>
            ))}
          </div>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search in FileShare..."
            className="w-full rounded-md border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </div>
      </div>

      {showNewFolder && !isSharedRootActive && !isViewerAccess && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
          <input
            value={newFolderName}
            onChange={(event) => setNewFolderName(event.target.value)}
            placeholder="Folder name"
            className="flex-1 min-w-[220px] rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
          <button
            type="button"
            onClick={handleCreateFolder}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Create folder
          </button>
          <button
            type="button"
            onClick={() => setShowNewFolder(false)}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm text-gray-500">
        <button
          type="button"
          onClick={() => {
            if (driveRoots.personal) handleRootSelect(driveRoots.personal);
          }}
          className="rounded-md bg-white px-2 py-1 text-gray-600 hover:text-indigo-600"
        >
          {rootLabel}
        </button>
        {displayedBreadcrumbs.map((crumb) => (
          <div key={crumb.id} className="flex items-center gap-2">
            <span>/</span>
            <button
              type="button"
              onClick={() => handleBreadcrumbClick(crumb.id)}
              className="rounded-md bg-white px-2 py-1 text-gray-600 hover:text-indigo-600"
            >
              {crumb.name || 'Folder'}
            </button>
          </div>
        ))}
      </div>

      {!hasItems && !status.loading && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
            <Folder className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">This folder is empty.</h2>
          <p className="mt-1 text-sm text-gray-600">Upload a file or create a folder to get started.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={handleUploadClick}
              className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              <UploadCloud className="h-4 w-4" />
              Upload file
            </button>
            <button
              type="button"
              onClick={() => setShowNewFolder(true)}
              className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:border-indigo-300 hover:text-indigo-600"
            >
              <Plus className="h-4 w-4" />
              New folder
            </button>
          </div>
        </div>
      )}

      {hasItems && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Shared by</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Updated</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredFolders.map((folder) => (
                <tr key={folder.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleOpenFolder(folder)}
                      className="flex items-center gap-2 text-left font-medium text-gray-900 hover:text-indigo-600"
                    >
                      <Folder className="h-4 w-4 text-indigo-500" />
                      {folder.name || 'Untitled folder'}
                      {!isViewerAccess && canRenameItem(folder) && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleRenameFolder(folder);
                          }}
                          className="ml-1 inline-flex items-center rounded-full p-1 text-gray-400 hover:text-indigo-600"
                          title="Rename folder"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {folder.share_role && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setShareTarget({
                              contentType: 'folder',
                              objectId: folder.id,
                              title: folder.name || 'Untitled folder',
                            });
                          }}
                          className="ml-2 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600 hover:bg-indigo-100"
                        >
                          <Share2 className="h-3 w-3" />
                          Shared
                        </button>
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-600">Folder</td>
                  <td className="px-4 py-3 text-gray-600">
                    {folder.shared_by?.name || folder.owner?.name || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{getRoleLabel(folder.share_role) || 'Owner'}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(folder.updated_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setShareTarget({
                            contentType: 'folder',
                            objectId: folder.id,
                            title: folder.name || 'Untitled folder',
                          })
                        }
                        className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:border-indigo-300 hover:text-indigo-600"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        Share
                      </button>
                      {!isViewerAccess && folder.share_role !== 'viewer' && (
                        <button
                          type="button"
                          onClick={() => handleDeleteFolder(folder)}
                          className="inline-flex items-center gap-2 rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:border-red-300 hover:text-red-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredFiles.map((file) => (
                <tr key={file.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-gray-900">
                      <FileText className="h-4 w-4 text-gray-500" />
                      <span>{file.name || file.title || 'Untitled file'}</span>
                      {!isViewerAccess && canRenameItem(file) && (
                        <button
                          type="button"
                          onClick={() => handleRenameFile(file)}
                          className="inline-flex items-center rounded-full p-1 text-gray-400 hover:text-indigo-600"
                          title="Rename file"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {file.share_role && (
                        <button
                          type="button"
                          onClick={() =>
                            setShareTarget({
                              contentType: 'file',
                              objectId: file.id,
                              title: file.name || file.title || 'Untitled file',
                            })
                          }
                          className="ml-2 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600 hover:bg-indigo-100"
                        >
                          <Share2 className="h-3 w-3" />
                          Shared
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">File</td>
                  <td className="px-4 py-3 text-gray-600">
                    {file.shared_by?.name || file.owner?.name || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{getRoleLabel(file.share_role) || 'Owner'}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(file.updated_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setShareTarget({
                            contentType: 'file',
                            objectId: file.id,
                            title: file.name || file.title || 'Untitled file',
                          })
                        }
                        className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:border-indigo-300 hover:text-indigo-600"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        Share
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownload(file)}
                        disabled={!getDownloadUrl(file)}
                        className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </button>
                      {!isViewerAccess && file.share_role !== 'viewer' && (
                        <button
                          type="button"
                          onClick={() => handleDeleteFile(file)}
                          className="inline-flex items-center gap-2 rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:border-red-300 hover:text-red-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {status.loading && (
        <div className="mt-4 text-sm text-gray-500">Loading FileShare content…</div>
      )}

      <ShareDialog
        isOpen={Boolean(shareTarget)}
        onClose={() => setShareTarget(null)}
        contentType={shareTarget?.contentType}
        objectId={shareTarget?.objectId}
        contentTitle={shareTarget?.title}
        onShareCreated={() => loadFolderContents(currentFolder?.id)}
      />
    </div>
  );
};

export default FileShareApp;
