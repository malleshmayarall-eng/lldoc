/**
 * Inference Service — API client for the hierarchical inference engine.
 *
 * Two loops:
 *   Read Path  → tree context (SELF → LATERAL → PARENT → PATH → ROOT)
 *   Write Path → embed → MaxSim → rerank → graph UPSERT (lateral edges)
 *
 * Every method returns the unwrapped response data (no axios wrapper).
 */

import api from './api';
import { API_ENDPOINTS } from '@constants/api';

// ══════════════════════════════════════════════════════════════════════════
// Trigger inference (LLM-based — creates/updates summaries)
// ══════════════════════════════════════════════════════════════════════════

/**
 * Run bottom-up inference for the entire document.
 * Incremental — unchanged components are skipped.
 * @param {string} documentId
 * @param {{ model?: string, force?: boolean }} [options]
 */
export async function inferDocument(documentId, options = {}) {
  const { data } = await api.post(
    API_ENDPOINTS.INFERENCE.INFER_DOCUMENT(documentId),
    { model: options.model || '', force: options.force || false },
  );
  return data;
}

/**
 * Run inference for a single section subtree.
 * @param {string} sectionId
 * @param {{ model?: string, force?: boolean }} [options]
 */
export async function inferSection(sectionId, options = {}) {
  const { data } = await api.post(
    API_ENDPOINTS.INFERENCE.INFER_SECTION(sectionId),
    { model: options.model || '', force: options.force || false },
  );
  return data;
}

/**
 * Run inference for a single component.
 * @param {'paragraph'|'sentence'|'latex_code'|'table'} componentType
 * @param {string} componentId
 * @param {{ model?: string, force?: boolean }} [options]
 */
export async function inferComponent(componentType, componentId, options = {}) {
  const { data } = await api.post(
    API_ENDPOINTS.INFERENCE.INFER_COMPONENT(componentType, componentId),
    { model: options.model || '', force: options.force || false },
  );
  return data;
}

// ══════════════════════════════════════════════════════════════════════════
// Retrieve inference results (read path)
// ══════════════════════════════════════════════════════════════════════════

/** Document-level inference summary. */
export async function getDocumentSummary(documentId) {
  const { data } = await api.get(API_ENDPOINTS.INFERENCE.DOCUMENT_SUMMARY(documentId));
  return data;
}

/** Pre-built context string for the entire document. */
export async function getDocumentContext(documentId) {
  const { data } = await api.get(API_ENDPOINTS.INFERENCE.DOCUMENT_CONTEXT(documentId));
  return data;
}

/** Section aggregate inference. */
export async function getSectionSummary(sectionId) {
  const { data } = await api.get(API_ENDPOINTS.INFERENCE.SECTION_SUMMARY(sectionId));
  return data;
}

/** Pre-built context string for a section. */
export async function getSectionContext(sectionId) {
  const { data } = await api.get(API_ENDPOINTS.INFERENCE.SECTION_CONTEXT(sectionId));
  return data;
}

/** Child component inferences for a section. */
export async function getSectionComponents(sectionId) {
  const { data } = await api.get(API_ENDPOINTS.INFERENCE.SECTION_COMPONENTS(sectionId));
  return data;
}

// ══════════════════════════════════════════════════════════════════════════
// Tree and staleness
// ══════════════════════════════════════════════════════════════════════════

/**
 * Full inference tree — document summary + section aggregates + component inferences.
 * Single request, complete snapshot.
 */
export async function getDocumentTree(documentId) {
  const { data } = await api.get(API_ENDPOINTS.INFERENCE.DOCUMENT_TREE(documentId));
  return data;
}

/**
 * List all components whose inference is stale (content changed since last run).
 */
export async function getStaleComponents(documentId) {
  const { data } = await api.get(API_ENDPOINTS.INFERENCE.DOCUMENT_STALE(documentId));
  return data;
}

// ══════════════════════════════════════════════════════════════════════════
// Write-path (embed → MaxSim → rerank → graph UPSERT)
// ══════════════════════════════════════════════════════════════════════════

/**
 * Run the write-path for every component in a document.
 * Creates/refreshes lateral edges.
 * @param {string} documentId
 * @param {'thread'|'celery'|'sync'} [asyncMode='thread']
 */
export async function runWritePathDocument(documentId, asyncMode = 'thread') {
  const { data } = await api.post(
    API_ENDPOINTS.INFERENCE.WRITE_PATH_DOCUMENT(documentId),
    { async_mode: asyncMode },
  );
  return data;
}

/**
 * Run the write-path for a single component.
 * @param {'paragraph'|'sentence'|'latex_code'|'table'} componentType
 * @param {string} componentId
 */
export async function runWritePathComponent(componentType, componentId) {
  const { data } = await api.post(
    API_ENDPOINTS.INFERENCE.WRITE_PATH_COMPONENT(componentType, componentId),
  );
  return data;
}

// ══════════════════════════════════════════════════════════════════════════
// Lateral edges (cross-component dependencies discovered by write-path)
// ══════════════════════════════════════════════════════════════════════════

/**
 * Get all lateral edges originating from a component.
 * @param {'paragraph'|'sentence'|'latex_code'|'table'|'section'} componentType
 * @param {string} componentId
 */
export async function getLateralEdges(componentType, componentId) {
  const { data } = await api.get(
    API_ENDPOINTS.INFERENCE.LATERAL_EDGES_COMPONENT(componentType, componentId),
  );
  return data;
}

/**
 * Get all lateral edges in a document.
 * @param {string} documentId
 * @param {'critical'|'contextual'|''} [edgeType]  Optional filter.
 */
export async function getDocumentLateralEdges(documentId, edgeType = '') {
  const params = edgeType ? { edge_type: edgeType } : {};
  const { data } = await api.get(
    API_ENDPOINTS.INFERENCE.LATERAL_EDGES_DOCUMENT(documentId),
    { params },
  );
  return data;
}

// ══════════════════════════════════════════════════════════════════════════
// Maintenance / health
// ══════════════════════════════════════════════════════════════════════════

/**
 * Re-embed all components into the vector store without reranking.
 * Use when the embedding model changes.
 */
export async function rebuildEmbeddings(documentId) {
  const { data } = await api.post(
    API_ENDPOINTS.INFERENCE.REBUILD_EMBEDDINGS(documentId),
  );
  return data;
}

/**
 * Health-check for the write-path services + per-document stats.
 */
export async function getWritePathStatus(documentId) {
  const { data } = await api.get(
    API_ENDPOINTS.INFERENCE.WRITE_PATH_STATUS(documentId),
  );
  return data;
}

// ── Combined convenience helpers ────────────────────────────────────────

/**
 * Full refresh: run LLM inference + write-path in sequence.
 * Returns { inference, writePath } results.
 */
export async function fullRefresh(documentId, options = {}) {
  const inference = await inferDocument(documentId, options);
  const writePath = await runWritePathDocument(documentId, 'sync');
  return { inference, writePath };
}

/**
 * Quick health snapshot: staleness + write-path status in parallel.
 */
export async function getHealthSnapshot(documentId) {
  const [stale, wpStatus] = await Promise.all([
    getStaleComponents(documentId),
    getWritePathStatus(documentId),
  ]);
  return { stale, writePathStatus: wpStatus };
}

// ── Default export (object form for backwards compat with service pattern) ──

const inferenceService = {
  // Trigger
  inferDocument,
  inferSection,
  inferComponent,

  // Read results
  getDocumentSummary,
  getDocumentContext,
  getSectionSummary,
  getSectionContext,
  getSectionComponents,

  // Tree + staleness
  getDocumentTree,
  getStaleComponents,

  // Write-path
  runWritePathDocument,
  runWritePathComponent,

  // Lateral edges
  getLateralEdges,
  getDocumentLateralEdges,

  // Maintenance
  rebuildEmbeddings,
  getWritePathStatus,

  // Convenience
  fullRefresh,
  getHealthSnapshot,
};

export default inferenceService;
