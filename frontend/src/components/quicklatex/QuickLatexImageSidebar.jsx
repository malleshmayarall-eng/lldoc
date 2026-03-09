/**
 * QuickLatexImageSidebar — Image picker sidebar for Quick LaTeX editor.
 *
 * Features:
 *  - Browse user images with search & type filter
 *  - Upload new images directly
 *  - Click an image to insert [[image:<uuid>]] placeholder into code
 *  - Show currently used image placeholders with previews
 *  - Tabbed: "Browse" | "Used" (images currently in the code)
 */

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  Image as ImageIcon,
  Search,
  Upload,
  X,
  Check,
  Loader2,
  Copy,
  Filter,
  ChevronDown,
  AlertCircle,
  Trash2,
} from 'lucide-react';
import quickLatexService from '../../services/quickLatexService';
import { fixImageUrl } from '../../utils/imageUtils';

/* ── Image type options ───────────────────────────────────────────── */
const IMAGE_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'logo', label: 'Logo' },
  { value: 'signature', label: 'Signature' },
  { value: 'stamp', label: 'Stamp/Seal' },
  { value: 'diagram', label: 'Diagram' },
  { value: 'figure', label: 'Figure' },
  { value: 'chart', label: 'Chart' },
  { value: 'photo', label: 'Photo' },
  { value: 'picture', label: 'Picture' },
  { value: 'other', label: 'Other' },
];

/* ── Main component ───────────────────────────────────────────────── */
const QuickLatexImageSidebar = ({
  documentId,
  imageplaceholders = [],        // list of image UUIDs currently in the code
  imageSlots = [],                // [{ name, mapped_image_id, is_mapped }] from AI
  resolvedImages = {},            // { uuid: { url, name, ... } }
  onInsertPlaceholder,            // (placeholderString) => void — inserts into code
  onRemovePlaceholder,            // (uuid) => void — remove from code
  onMapImage,                     // (docId, placeholderName, imageId) => void
  onClose,
  onResolveImages,                // (docId) => void — trigger resolve
}) => {
  const [tab, setTab] = useState('browse'); // 'browse' | 'used' | 'slots'
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showTypeFilter, setShowTypeFilter] = useState(false);
  const [error, setError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [mappingSlot, setMappingSlot] = useState(null);  // which slot is being mapped
  const [slotImages, setSlotImages] = useState([]);       // images for slot picker
  const [slotSearchQuery, setSlotSearchQuery] = useState('');
  const [loadingSlotImages, setLoadingSlotImages] = useState(false);

  const fileInputRef = useRef(null);
  const searchTimeoutRef = useRef(null);

  // ── Load images ──────────────────────────────────────────────────

  const fetchImages = useCallback(async (search = '', type = '') => {
    if (!documentId) return;
    setLoading(true);
    setError(null);
    try {
      const params = { include_public: true };
      if (search.trim()) params.search = search.trim();
      if (type) params.type = type;
      const data = await quickLatexService.getImages(documentId, params);
      setImages(data.images || []);
    } catch (err) {
      setError('Failed to load images');
      console.error('Error loading images:', err);
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (tab === 'browse') {
      fetchImages(searchQuery, typeFilter);
    }
  }, [tab, typeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search
  useEffect(() => {
    if (tab !== 'browse') return;
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      fetchImages(searchQuery, typeFilter);
    }, 400);
    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); };
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve used images on "used" tab
  useEffect(() => {
    if (tab === 'used' && imageplaceholders.length > 0) {
      onResolveImages?.(documentId);
    }
  }, [tab, imageplaceholders.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve mapped slot images on "slots" tab
  useEffect(() => {
    if (tab === 'slots' && imageSlots.length > 0) {
      const mappedIds = imageSlots
        .filter(s => s.is_mapped && s.mapped_image_id)
        .map(s => s.mapped_image_id);
      if (mappedIds.length > 0) {
        onResolveImages?.(documentId, mappedIds);
      }
    }
  }, [tab, imageSlots]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load images for slot mapping picker
  const fetchSlotImages = useCallback(async (search = '') => {
    if (!documentId) return;
    setLoadingSlotImages(true);
    try {
      const params = { include_public: true };
      if (search.trim()) params.search = search.trim();
      const data = await quickLatexService.getImages(documentId, params);
      setSlotImages(data.images || []);
    } catch {
      // silent
    } finally {
      setLoadingSlotImages(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (mappingSlot) fetchSlotImages(slotSearchQuery);
  }, [mappingSlot, slotSearchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle slot mapping
  const handleMapSlot = useCallback(async (slotName, imageId) => {
    if (!documentId) return;
    await onMapImage?.(documentId, slotName, imageId);
    setMappingSlot(null);
    setSlotSearchQuery('');
  }, [documentId, onMapImage]);

  // Handle slot unmapping
  const handleUnmapSlot = useCallback(async (slotName) => {
    if (!documentId) return;
    await onMapImage?.(documentId, slotName, null);
  }, [documentId, onMapImage]);

  // ── Upload ───────────────────────────────────────────────────────

  const handleUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file || !documentId) return;

    // Validate
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setError('Invalid file type. Use JPEG, PNG, GIF, or WebP.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('File too large. Max 10 MB.');
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const result = await quickLatexService.uploadImage(documentId, file, {
        name: file.name,
        image_type: 'picture',
      });

      const img = result.image;
      if (img) {
        // Add to local list
        setImages((prev) => [img, ...prev]);
        // Auto-insert the placeholder
        onInsertPlaceholder?.(img.placeholder);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
      console.error('Image upload error:', err);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }, [documentId, onInsertPlaceholder]);

  // ── Copy placeholder to clipboard ────────────────────────────────

  const handleCopyPlaceholder = useCallback((placeholder, id) => {
    navigator.clipboard.writeText(placeholder).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  }, []);

  // ── Computed ─────────────────────────────────────────────────────

  const usedImagesList = useMemo(() => {
    return imageplaceholders.map((uuid) => ({
      id: uuid,
      ...(resolvedImages[uuid] || {}),
      placeholder: `[[image:${uuid}]]`,
    }));
  }, [imageplaceholders, resolvedImages]);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <ImageIcon size={15} className="text-purple-600" />
          <span className="text-sm font-semibold text-gray-800">Images</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────── */}
      <div className="flex border-b border-gray-100 flex-shrink-0">
        {[
          { key: 'browse', label: 'Browse & Upload' },
          { key: 'slots', label: `Slots (${imageSlots.length})` },
          { key: 'used', label: `Used (${imageplaceholders.length})` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-2 py-2 text-[11px] font-medium transition-colors ${
              tab === t.key
                ? 'text-purple-600 border-b-2 border-purple-600 bg-purple-50/50'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Error ───────────────────────────────────────────────── */}
      {error && (
        <div className="mx-3 mt-2 flex items-center gap-1.5 px-2.5 py-1.5 bg-red-50 border border-red-100 rounded text-xs text-red-600">
          <AlertCircle size={12} />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <X size={11} />
          </button>
        </div>
      )}

      {/* ══════════════════ BROWSE TAB ══════════════════════════════ */}
      {tab === 'browse' && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Search + filter bar */}
          <div className="px-3 py-2 space-y-2 flex-shrink-0 border-b border-gray-50">
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search images…"
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              </div>
              <button
                onClick={() => setShowTypeFilter(!showTypeFilter)}
                className={`p-1.5 rounded-md border transition-colors ${
                  showTypeFilter || typeFilter
                    ? 'border-purple-300 bg-purple-50 text-purple-600'
                    : 'border-gray-200 text-gray-400 hover:bg-gray-50'
                }`}
                title="Filter by type"
              >
                <Filter size={13} />
              </button>
            </div>

            {/* Type filter dropdown */}
            {showTypeFilter && (
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full text-xs border border-gray-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {IMAGE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            )}
          </div>

          {/* Upload button */}
          <div className="px-3 py-2 flex-shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
              onChange={handleUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border-2 border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:border-purple-400 hover:text-purple-600 hover:bg-purple-50/30 transition-colors disabled:opacity-40"
            >
              {uploading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Upload size={14} />
              )}
              {uploading ? 'Uploading…' : 'Upload New Image'}
            </button>
          </div>

          {/* Image grid */}
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {loading && images.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin text-gray-300" />
              </div>
            )}

            {!loading && images.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                <ImageIcon size={28} className="mx-auto mb-2 opacity-40" />
                <p className="text-xs font-medium">No images found</p>
                <p className="text-[11px] mt-1">Upload an image or adjust your search</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              {images.map((img) => {
                const isUsed = imageplaceholders.includes(img.id);
                return (
                  <div
                    key={img.id}
                    className={`group relative rounded-lg overflow-hidden border-2 cursor-pointer transition-all hover:shadow-md ${
                      isUsed
                        ? 'border-purple-400 ring-2 ring-purple-100'
                        : 'border-gray-200 hover:border-purple-300'
                    }`}
                    onClick={() => onInsertPlaceholder?.(img.placeholder)}
                    title={`Click to insert ${img.name}`}
                  >
                    <div className="aspect-square bg-gray-50">
                      <img
                        src={fixImageUrl(img.thumbnail_url || img.url)}
                        alt={img.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>

                    {/* Overlay on hover */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <span className="text-white text-[10px] font-medium bg-purple-600 px-2 py-1 rounded-full">
                        {isUsed ? 'Already used' : 'Insert'}
                      </span>
                    </div>

                    {/* Used badge */}
                    {isUsed && (
                      <div className="absolute top-1 right-1 bg-purple-600 rounded-full p-0.5">
                        <Check size={10} className="text-white" />
                      </div>
                    )}

                    {/* Name */}
                    <div className="px-1.5 py-1 bg-white">
                      <p className="text-[10px] text-gray-600 truncate">{img.name}</p>
                      {img.image_type && img.image_type !== 'other' && (
                        <span className="text-[9px] text-gray-400 capitalize">{img.image_type}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════ SLOTS TAB ═══════════════════════════════ */}
      {tab === 'slots' && (
        <div className="flex-1 overflow-y-auto">
          {imageSlots.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <ImageIcon size={28} className="mx-auto mb-2 opacity-40" />
              <p className="text-xs font-medium">No image slots detected</p>
              <p className="text-[11px] mt-1 max-w-[220px] mx-auto">
                AI-generated documents include named image slots like{' '}
                <code className="bg-gray-100 px-1 rounded text-[10px]">{'[[image:company_logo]]'}</code>{' '}
                that you can map to your uploaded images.
              </p>
            </div>
          ) : (
            <div className="space-y-2 p-3">
              {imageSlots.map((slot) => (
                <div
                  key={slot.name}
                  className={`p-2.5 rounded-lg border transition-colors ${
                    slot.is_mapped
                      ? 'border-green-200 bg-green-50/30'
                      : 'border-amber-200 bg-amber-50/30'
                  }`}
                >
                  {/* Slot name & status */}
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      {slot.is_mapped ? (
                        <Check size={12} className="text-green-500" />
                      ) : (
                        <AlertCircle size={12} className="text-amber-500" />
                      )}
                      <span className="text-xs font-medium text-gray-700">
                        {slot.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      </span>
                    </div>
                    <code className="text-[9px] text-gray-400 font-mono">
                      [[image:{slot.name}]]
                    </code>
                  </div>

                  {/* Mapped image preview or Map button */}
                  {slot.is_mapped && resolvedImages[slot.mapped_image_id] ? (
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-10 h-10 rounded-md overflow-hidden bg-gray-200 flex-shrink-0">
                        <img
                          src={fixImageUrl(
                            resolvedImages[slot.mapped_image_id]?.thumbnail_url ||
                            resolvedImages[slot.mapped_image_id]?.url
                          )}
                          alt={slot.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <p className="text-[10px] text-gray-500 flex-1 truncate">
                        {resolvedImages[slot.mapped_image_id]?.name || 'Mapped image'}
                      </p>
                      <button
                        onClick={() => handleUnmapSlot(slot.name)}
                        className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
                        title="Unmap image"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : slot.is_mapped ? (
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-10 h-10 rounded-md bg-gray-100 flex-shrink-0 flex items-center justify-center">
                        <Loader2 size={12} className="animate-spin text-gray-400" />
                      </div>
                      <p className="text-[10px] text-gray-400 flex-1">Loading mapped image…</p>
                      <button
                        onClick={() => handleUnmapSlot(slot.name)}
                        className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
                        title="Unmap image"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <div>
                      {mappingSlot === slot.name ? (
                        /* ── Image picker for this slot ── */
                        <div className="mt-1.5 space-y-1.5">
                          <div className="flex items-center gap-1">
                            <div className="relative flex-1">
                              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                              <input
                                type="text"
                                value={slotSearchQuery}
                                onChange={(e) => setSlotSearchQuery(e.target.value)}
                                placeholder="Search images…"
                                className="w-full pl-7 pr-2 py-1 text-[11px] border border-gray-200 rounded focus:ring-1 focus:ring-purple-500"
                                autoFocus
                              />
                            </div>
                            <button
                              onClick={() => { setMappingSlot(null); setSlotSearchQuery(''); }}
                              className="p-1 text-gray-400 hover:text-gray-600"
                            >
                              <X size={12} />
                            </button>
                          </div>
                          <div className="max-h-32 overflow-y-auto space-y-1 border border-gray-100 rounded-md p-1 bg-white">
                            {loadingSlotImages ? (
                              <div className="flex justify-center py-2">
                                <Loader2 size={14} className="animate-spin text-gray-300" />
                              </div>
                            ) : slotImages.length === 0 ? (
                              <p className="text-[10px] text-gray-400 text-center py-2">No images found</p>
                            ) : (
                              slotImages.map((img) => (
                                <button
                                  key={img.id}
                                  onClick={() => handleMapSlot(slot.name, img.id)}
                                  className="w-full flex items-center gap-2 p-1.5 rounded hover:bg-purple-50 transition-colors text-left"
                                >
                                  <div className="w-8 h-8 rounded overflow-hidden bg-gray-100 flex-shrink-0">
                                    <img
                                      src={fixImageUrl(img.thumbnail_url || img.url)}
                                      alt={img.name}
                                      className="w-full h-full object-cover"
                                    />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[10px] font-medium text-gray-700 truncate">{img.name}</p>
                                    {img.image_type && img.image_type !== 'other' && (
                                      <span className="text-[9px] text-gray-400 capitalize">{img.image_type}</span>
                                    )}
                                  </div>
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setMappingSlot(slot.name)}
                          className="mt-1 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 border border-dashed border-gray-300 rounded-md text-[11px] text-gray-500 hover:border-purple-400 hover:text-purple-600 hover:bg-purple-50/30 transition-colors"
                        >
                          <ImageIcon size={12} />
                          Choose Image
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════ USED TAB ════════════════════════════════ */}
      {tab === 'used' && (
        <div className="flex-1 overflow-y-auto">
          {usedImagesList.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <ImageIcon size={28} className="mx-auto mb-2 opacity-40" />
              <p className="text-xs font-medium">No image placeholders in code</p>
              <p className="text-[11px] mt-1 max-w-[200px] mx-auto">
                Insert images from the Browse tab. They appear as{' '}
                <code className="bg-gray-100 px-1 rounded text-[10px]">{'[[image:uuid]]'}</code>{' '}
                in your code.
              </p>
            </div>
          ) : (
            <div className="space-y-2 p-3">
              {usedImagesList.map((img) => (
                <div
                  key={img.id}
                  className="flex items-center gap-2.5 p-2 bg-gray-50 rounded-lg border border-gray-100 group"
                >
                  {/* Thumbnail */}
                  <div className="w-12 h-12 rounded-md overflow-hidden bg-gray-200 flex-shrink-0">
                    {img.url || img.thumbnail_url ? (
                      <img
                        src={fixImageUrl(img.thumbnail_url || img.url)}
                        alt={img.name || 'Image'}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Loader2 size={14} className="animate-spin text-gray-400" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-700 truncate">
                      {img.name || 'Loading…'}
                    </p>
                    <p className="text-[10px] text-gray-400 font-mono truncate">
                      {img.placeholder}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleCopyPlaceholder(img.placeholder, img.id)}
                      className="p-1 rounded hover:bg-gray-200 text-gray-400"
                      title="Copy placeholder"
                    >
                      {copiedId === img.id ? (
                        <Check size={12} className="text-green-500" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                    {onRemovePlaceholder && (
                      <button
                        onClick={() => onRemovePlaceholder(img.id)}
                        className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
                        title="Remove from code"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Footer hint ─────────────────────────────────────────── */}
      <div className="px-3 py-2 border-t border-gray-100 bg-gray-50/80 flex-shrink-0">
        <p className="text-[10px] text-gray-400 text-center">
          Images render as <code className="bg-gray-100 px-1 rounded">{'[[image:id]]'}</code>{' '}
          in {'{'}LaTeX/HTML{'}'} and are resolved during preview.
        </p>
      </div>
    </div>
  );
};

export default QuickLatexImageSidebar;
