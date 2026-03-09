import api from './api';
import { API_ENDPOINTS } from '../constants/api';

const normalizeList = (data) => {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.results)) return data.results;
  return [];
};

const parseFilename = (contentDisposition) => {
  if (!contentDisposition) return null;
  const filenameStar = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (filenameStar?.[1]) return decodeURIComponent(filenameStar[1]);
  const filename = contentDisposition.match(/filename="?([^";]+)"?/i);
  return filename?.[1] || null;
};

export const fileshareService = {
  async getRoots() {
    const response = await api.get(API_ENDPOINTS.FILESHARE.FOLDERS.ROOTS);
    return response.data;
  },

  async getMyRoot() {
    const response = await api.get(API_ENDPOINTS.FILESHARE.FOLDERS.MY_ROOT);
    return response.data;
  },

  async getFolder(folderId) {
    const response = await api.get(API_ENDPOINTS.FILESHARE.FOLDERS.BY_ID(folderId));
    return response.data;
  },

  async listFolders(parentId) {
    const response = await api.get(API_ENDPOINTS.FILESHARE.FOLDERS.BASE, {
      params: parentId ? { parent: parentId } : {},
    });
    return normalizeList(response.data);
  },

  async getChildren(folderId) {
    const response = await api.get(API_ENDPOINTS.FILESHARE.FOLDERS.CHILDREN(folderId));
    const data = response.data || {};
    return {
      folders: normalizeList(data.folders),
      files: normalizeList(data.files),
    };
  },

  async listFiles(folderId, options = {}) {
    const params = {};
    if (folderId) params.folder = folderId;
    if (options.sharedOnly) params.shared_only = true;

    const response = await api.get(API_ENDPOINTS.FILESHARE.FILES.BASE, { params });
    return normalizeList(response.data);
  },

  async getFile(fileId) {
    const response = await api.get(API_ENDPOINTS.FILESHARE.FILES.BY_ID(fileId));
    return response.data;
  },

  async getFolderSharedWith(folderId) {
    const response = await api.get(API_ENDPOINTS.FILESHARE.FOLDERS.SHARED_WITH(folderId));
    return response.data;
  },

  async getFileSharedWith(fileId) {
    const response = await api.get(API_ENDPOINTS.FILESHARE.FILES.SHARED_WITH(fileId));
    return response.data;
  },

  async getShareInfo(contentType, objectId) {
    const response = await api.get(API_ENDPOINTS.SHARING.SHARES, {
      params: {
        content_type: contentType,
        object_id: objectId,
      },
    });
    return normalizeList(response.data);
  },

  async getSharedWithMe() {
    const response = await api.get(API_ENDPOINTS.FILESHARE.FOLDERS.SHARED_WITH_ME);
    const data = response.data || {};

    const folders = normalizeList(data.folders);
    const files = normalizeList(data.files);

    if (folders.length || files.length) {
      return { folders, files };
    }

    return { folders: [], files: normalizeList(data) };
  },

  async getContentTypes() {
    const response = await api.get(API_ENDPOINTS.FILESHARE.FILES.CONTENT_TYPES);
    return normalizeList(response.data);
  },

  getDownloadUrl(file, token = null) {
    if (!file?.id) return null;
    const baseUrl = API_ENDPOINTS.FILESHARE.FILES.DOWNLOAD(file.id);
    const tokenValue = token || file?.invitation_token || file?.share_token || file?.token;
    return tokenValue ? `${baseUrl}?token=${encodeURIComponent(tokenValue)}` : baseUrl;
  },

  async downloadFile(file, token = null) {
    if (!file?.id) return null;
    const tokenValue = token || file?.invitation_token || file?.share_token || file?.token;
    const response = await api.get(API_ENDPOINTS.FILESHARE.FILES.DOWNLOAD(file.id), {
      responseType: 'blob',
      params: tokenValue ? { token: tokenValue } : {},
    });

    const contentDisposition = response.headers?.['content-disposition'];
    const filename =
      parseFilename(contentDisposition) || file?.name || file?.title || 'file';

    return { blob: response.data, filename };
  },

  async uploadFile({ file, folderId, description, tags, name }) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name || file?.name || 'Untitled file');
    if (folderId) formData.append('folder', folderId);
    if (description) formData.append('description', description);
    if (tags?.length) formData.append('tags', tags.join(','));

    const response = await api.post(API_ENDPOINTS.FILESHARE.FILES.BASE, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async createFolder({ name, parentId }) {
    const response = await api.post(API_ENDPOINTS.FILESHARE.FOLDERS.BASE, {
      name,
      parent: parentId || null,
    });
    return response.data;
  },

  async renameFolder(folderId, name) {
    const response = await api.patch(API_ENDPOINTS.FILESHARE.FOLDERS.BY_ID(folderId), { name });
    return response.data;
  },

  async renameFile(fileId, name) {
    const response = await api.patch(API_ENDPOINTS.FILESHARE.FILES.BY_ID(fileId), { name });
    return response.data;
  },

  async deleteFolder(folderId) {
    const response = await api.delete(API_ENDPOINTS.FILESHARE.FOLDERS.BY_ID(folderId));
    return response.data;
  },

  async deleteFile(fileId) {
    const response = await api.delete(API_ENDPOINTS.FILESHARE.FILES.BY_ID(fileId));
    return response.data;
  },
};

export default fileshareService;
