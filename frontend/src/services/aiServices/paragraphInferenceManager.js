/**
 * ParagraphInferenceManager — Singleton that shares ONE ONNX session + tokenizer
 * across all paragraphs. Only re-runs inference when a paragraph's text actually
 * changes. Queues requests so at most one inference runs at a time, preventing
 * concurrent ONNX thrashing in the browser.
 *
 * Usage:
 *   import inferenceManager from './paragraphInferenceManager';
 *   const result = await inferenceManager.requestInference(paragraphId, text);
 */
import paragraphInferenceService, {
  loadTokenizer,
} from './paragraphInferenceService';
import onnxModelService from './onnxModelService';

const DEFAULT_MODEL_ID = 'paragraph-minilm6';

/* ------------------------------------------------------------------ */
/*  Internal state                                                     */
/* ------------------------------------------------------------------ */

/** Map<paragraphId, { text, scores, fullResult }> */
const cache = new Map();

/** Whether the shared session + tokenizer have been warmed up */
let warmupPromise = null;

/** Sequential queue so only one inference runs at a time */
let queuePromise = Promise.resolve();

/* ------------------------------------------------------------------ */
/*  Warm-up: load session + tokenizer exactly once                     */
/* ------------------------------------------------------------------ */

const warmup = (options = {}) => {
  if (!warmupPromise) {
    warmupPromise = (async () => {
      const modelId = options.modelId || DEFAULT_MODEL_ID;

      // Ensure model is registered (idempotent inside the service)
      const MODEL_URL = new URL('./minilm6.onnx', import.meta.url).toString();
      try {
        onnxModelService.getModelConfig(modelId);
      } catch {
        onnxModelService.registerModel(modelId, { url: MODEL_URL });
      }

      // Kick off both in parallel — they are cached after the first call
      await Promise.all([
        onnxModelService.loadSession(modelId),
        loadTokenizer(options.tokenizerBaseUrl),
      ]);
    })();
  }
  return warmupPromise;
};

/* ------------------------------------------------------------------ */
/*  Change detection                                                   */
/* ------------------------------------------------------------------ */

const hasChanged = (paragraphId, text) => {
  const entry = cache.get(paragraphId);
  return !entry || entry.text !== text;
};

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Request inference for a single paragraph.
 * - If the text hasn't changed since the last inference, returns the cached result
 *   immediately (no ONNX work).
 * - Otherwise queues the inference so only one runs at a time.
 *
 * @param {string} paragraphId  Unique paragraph identifier
 * @param {string} text         Current paragraph text
 * @param {object} [options]    Forwarded to runParagraphInference
 * @returns {Promise<{scores, fullResult}>}
 */
const requestInference = (paragraphId, text, options = {}) => {
  // Fast path — text unchanged, return cached scores
  if (!hasChanged(paragraphId, text)) {
    const hit = cache.get(paragraphId);
    return Promise.resolve({ scores: hit.scores, fullResult: hit.fullResult });
  }

  // Chain onto the queue so only one inference runs at a time
  const job = queuePromise.then(async () => {
    // Re-check after waiting — another queued job for the same paragraph
    // may have already processed an identical text.
    if (!hasChanged(paragraphId, text)) {
      const hit = cache.get(paragraphId);
      return { scores: hit.scores, fullResult: hit.fullResult };
    }

    // Ensure model + tokenizer are loaded (no-op after first call)
    await warmup(options);

    const result = await paragraphInferenceService.runParagraphInference(
      text,
      options,
    );

    // Store in cache
    cache.set(paragraphId, {
      text,
      scores: result?.scores ?? null,
      fullResult: result,
    });

    return { scores: result?.scores ?? null, fullResult: result };
  });

  // Keep the queue reference moving forward; swallow errors so one
  // failed paragraph doesn't block the queue for others.
  queuePromise = job.catch(() => {});

  return job;
};

/**
 * Invalidate the cached result for a paragraph so the next
 * `requestInference` call will always run the model.
 */
const invalidate = (paragraphId) => {
  cache.delete(paragraphId);
};

/**
 * Clear all cached results (e.g. when the document changes).
 */
const clearAll = () => {
  cache.clear();
};

/**
 * Pre-warm the model + tokenizer without running any inference.
 * Call once early (e.g. on document load) so the first paragraph
 * inference is fast.
 */
const preload = (options = {}) => warmup(options);

const paragraphInferenceManager = {
  requestInference,
  invalidate,
  clearAll,
  preload,
  /** Exposed for testing */
  _cache: cache,
};

export default paragraphInferenceManager;
export { requestInference, invalidate, clearAll, preload };
