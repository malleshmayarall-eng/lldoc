/**
 * useInferenceCache — Persistent inference cache with hash-based change detection.
 *
 * The document tree is hashed client-side (SHA-256 of section titles + paragraph
 * content + table data). On document load, the cached tree is restored instantly.
 * A diff is computed against the live document to identify which sections changed.
 * Only changed subtrees trigger re-inference API calls.
 *
 * Cache is stored in localStorage keyed by `inf:${documentId}`.
 * Each cache entry holds:
 *   { documentHash, sectionHashes, tree, timestamp, version }
 *
 * The cache also keeps a history ring (last 5 snapshots) so past inference
 * states are browsable even after the document changes.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

// ── Constants ────────────────────────────────────────────────────────────────

const CACHE_VERSION = 1;
const CACHE_PREFIX = 'inf:';
const HISTORY_PREFIX = 'inf-hist:';
const MAX_HISTORY = 5;

// ── Hashing ──────────────────────────────────────────────────────────────────

/**
 * Fast FNV-1a 32-bit hash — good enough for change detection,
 * runs in <1ms even for 500-section documents.
 */
function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Hash a single component (paragraph / table / latex / image / file). */
function hashComponent(comp) {
  if (!comp) return '';
  const text = comp.content_text || comp.edited_text || comp.content ||
    comp.latex_code || comp.edited_code ||
    JSON.stringify(comp.table_data || comp.column_headers || '') ||
    comp.caption || comp.label || comp.alt_text || '';
  return fnv1a(text);
}

/** Hash a section and all its children recursively → deterministic string. */
function hashSection(section) {
  if (!section) return '';
  const parts = [
    section.title || '',
    section.section_type || '',
  ];

  // Hash all direct components
  for (const p of (section.paragraphs || [])) parts.push(hashComponent(p));
  for (const t of (section.tables || [])) parts.push(hashComponent(t));
  for (const lc of (section.latex_codes || [])) parts.push(hashComponent(lc));
  for (const ic of (section.image_components || [])) parts.push(hashComponent(ic));
  for (const fc of (section.file_components || [])) parts.push(hashComponent(fc));

  // Recurse into children
  for (const child of (section.children || [])) parts.push(hashSection(child));

  return fnv1a(parts.join('|'));
}

/** Hash the full document structure → single string. */
function hashDocument(doc) {
  if (!doc?.sections) return '';
  const parts = [doc.title || ''];
  for (const s of doc.sections) parts.push(hashSection(s));
  return fnv1a(parts.join('||'));
}

/** Build a flat map of sectionId → hash for all sections. */
function buildSectionHashMap(sections, map = {}) {
  for (const section of (sections || [])) {
    const id = section.id || section.client_id;
    if (id) map[id] = hashSection(section);
    if (section.children) buildSectionHashMap(section.children, map);
  }
  return map;
}

// ── localStorage helpers ─────────────────────────────────────────────────────

function loadCache(documentId) {
  if (!documentId) return null;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + documentId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.version !== CACHE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCache(documentId, data) {
  if (!documentId) return;
  try {
    localStorage.setItem(CACHE_PREFIX + documentId, JSON.stringify({
      ...data,
      version: CACHE_VERSION,
      timestamp: Date.now(),
    }));
  } catch {
    // localStorage full — silently ignore
  }
}

function loadHistory(documentId) {
  if (!documentId) return [];
  try {
    const raw = localStorage.getItem(HISTORY_PREFIX + documentId);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(documentId, history) {
  if (!documentId) return;
  try {
    localStorage.setItem(HISTORY_PREFIX + documentId, JSON.stringify(
      history.slice(0, MAX_HISTORY)
    ));
  } catch {
    // Silently ignore
  }
}

// ── Reducer ──────────────────────────────────────────────────────────────────

const initialState = {
  documentHash: null,
  sectionHashes: {},
  cachedTree: null,           // Restored inference tree from cache
  staleSectionIds: new Set(),  // Sections whose hash changed since last cache
  cacheTimestamp: null,
  history: [],                 // Past inference snapshots [{timestamp, documentHash, stats}]
  cacheHit: false,             // True if cache was restored on mount
};

function reducer(state, action) {
  switch (action.type) {
    case 'RESTORE_CACHE':
      return {
        ...state,
        cachedTree: action.payload.tree,
        documentHash: action.payload.documentHash,
        sectionHashes: action.payload.sectionHashes || {},
        cacheTimestamp: action.payload.timestamp,
        cacheHit: true,
      };
    case 'SET_HASHES':
      return {
        ...state,
        documentHash: action.payload.documentHash,
        sectionHashes: action.payload.sectionHashes,
      };
    case 'SET_STALE_SECTIONS':
      return { ...state, staleSectionIds: new Set(action.payload) };
    case 'SAVE_SNAPSHOT':
      return {
        ...state,
        cachedTree: action.payload.tree,
        cacheTimestamp: Date.now(),
      };
    case 'SET_HISTORY':
      return { ...state, history: action.payload };
    case 'RESET':
      return { ...initialState };
    default:
      return state;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export default function useInferenceCache(documentId, completeDocument) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const mountedRef = useRef(true);
  const prevDocHashRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Restore cache on mount / documentId change ─────────────────────────

  useEffect(() => {
    if (!documentId) {
      dispatch({ type: 'RESET' });
      return;
    }
    const cached = loadCache(documentId);
    if (cached?.tree) {
      dispatch({ type: 'RESTORE_CACHE', payload: cached });
    }
    const history = loadHistory(documentId);
    dispatch({ type: 'SET_HISTORY', payload: history });
  }, [documentId]);

  // ── Compute hashes whenever document structure changes ─────────────────

  useEffect(() => {
    if (!completeDocument?.sections) return;
    const docHash = hashDocument(completeDocument);
    const sectionMap = buildSectionHashMap(completeDocument.sections);
    dispatch({ type: 'SET_HASHES', payload: { documentHash: docHash, sectionHashes: sectionMap } });
  }, [completeDocument]);

  // ── Diff: find which sections changed since cached snapshot ────────────

  useEffect(() => {
    if (!state.documentHash || !state.sectionHashes) return;
    const cached = loadCache(documentId);
    if (!cached?.sectionHashes) {
      // No cache — everything is stale
      dispatch({ type: 'SET_STALE_SECTIONS', payload: Object.keys(state.sectionHashes) });
      return;
    }

    const stale = [];
    for (const [sectionId, hash] of Object.entries(state.sectionHashes)) {
      if (cached.sectionHashes[sectionId] !== hash) {
        stale.push(sectionId);
      }
    }
    // Also flag sections that existed in cache but no longer exist (deleted)
    for (const sectionId of Object.keys(cached.sectionHashes)) {
      if (!(sectionId in state.sectionHashes) && !stale.includes(sectionId)) {
        stale.push(sectionId);
      }
    }
    dispatch({ type: 'SET_STALE_SECTIONS', payload: stale });
  }, [documentId, state.documentHash, state.sectionHashes]);

  // ── Save inference tree to cache ───────────────────────────────────────

  const persistTree = useCallback((tree) => {
    if (!documentId || !tree) return;
    const snapshot = {
      tree,
      documentHash: state.documentHash,
      sectionHashes: state.sectionHashes,
      timestamp: Date.now(),
      version: CACHE_VERSION,
    };
    saveCache(documentId, snapshot);
    dispatch({ type: 'SAVE_SNAPSHOT', payload: snapshot });

    // Push to history
    const history = loadHistory(documentId);
    const stats = {
      sections: tree.tree?.length || 0,
      components: 0,
    };
    if (tree.tree) {
      const countComponents = (nodes) => {
        for (const n of nodes) {
          stats.components += (n.components?.length || 0);
          if (n.children) countComponents(n.children);
        }
      };
      countComponents(tree.tree);
    }
    history.unshift({
      timestamp: Date.now(),
      documentHash: state.documentHash,
      stats,
    });
    saveHistory(documentId, history);
    dispatch({ type: 'SET_HISTORY', payload: history.slice(0, MAX_HISTORY) });
  }, [documentId, state.documentHash, state.sectionHashes]);

  // ── Check if document changed since last cache ─────────────────────────

  const hasDocumentChanged = useMemo(() => {
    if (!state.documentHash) return false;
    const cached = loadCache(documentId);
    if (!cached?.documentHash) return true;
    return cached.documentHash !== state.documentHash;
  }, [documentId, state.documentHash]);

  // ── Clear cache ────────────────────────────────────────────────────────

  const clearCache = useCallback(() => {
    if (!documentId) return;
    localStorage.removeItem(CACHE_PREFIX + documentId);
    dispatch({ type: 'RESET' });
  }, [documentId]);

  return {
    // State
    cachedTree: state.cachedTree,
    documentHash: state.documentHash,
    sectionHashes: state.sectionHashes,
    staleSectionIds: state.staleSectionIds,
    cacheTimestamp: state.cacheTimestamp,
    cacheHit: state.cacheHit,
    history: state.history,
    hasDocumentChanged,

    // Actions
    persistTree,
    clearCache,

    // Utilities
    hashDocument,
    hashSection,
    buildSectionHashMap,
  };
}
