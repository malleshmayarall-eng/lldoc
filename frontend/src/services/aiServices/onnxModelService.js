import * as ort from 'onnxruntime-web';
import { normalizeShape, toTypedArray } from './utils.js';

const sessionCache = new Map();
const modelConfigRegistry = new Map();
let wasmConfigured = false;

const ensureBrowser = () => {
  if (typeof window === 'undefined') {
    throw new Error('onnxModelService requires a browser environment to load ONNX models.');
  }
};

const normalizeModelConfig = (modelId, config) => {
  if (!modelId) throw new Error('modelId is required');
  if (!config?.url) throw new Error('model config must include a url');
  return {
    modelId,
    url: config.url,
    sessionOptions: config.sessionOptions || {},
    fetchOptions: config.fetchOptions || undefined,
    metadata: config.metadata || {},
  };
};

const registerModel = (modelId, config) => {
  const normalized = normalizeModelConfig(modelId, config);
  modelConfigRegistry.set(modelId, normalized);
  return normalized;
};

const getModelConfig = (modelId) => {
  if (modelConfigRegistry.has(modelId)) {
    return modelConfigRegistry.get(modelId);
  }
  throw new Error(`Model '${modelId}' is not registered`);
};

const loadSession = async (modelId, overrides = {}) => {
  ensureBrowser();
  if (!wasmConfigured) {
    ort.env.wasm.wasmPaths = `${window.location.origin}/onnxruntime-web/`;
    wasmConfigured = true;
  }
  const cached = sessionCache.get(modelId);
  if (cached) return cached;

  const config = getModelConfig(modelId);
  const sessionOptions = {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
    ...config.sessionOptions,
    ...overrides.sessionOptions,
  };

  const session = await ort.InferenceSession.create(config.url, {
    ...sessionOptions,
    ...(config.fetchOptions ? { fetchOptions: config.fetchOptions } : {}),
  });
  sessionCache.set(modelId, session);
  return session;
};

const createTensor = (data, dims, type = 'float32') => {
  const normalizedDims = normalizeShape(dims);
  const typedArray = ArrayBuffer.isView(data) ? data : toTypedArray(data, type);
  return new ort.Tensor(type, typedArray, normalizedDims);
};

const runInference = async (modelId, feeds, options = {}) => {
  if (!feeds || typeof feeds !== 'object') {
    throw new Error('feeds must be an object with input tensors');
  }
  const session = await loadSession(modelId, options);
  const outputNames = options.outputNames || undefined;
  return session.run(feeds, outputNames);
};

const clearModel = (modelId) => {
  sessionCache.delete(modelId);
};

const resetRegistry = () => {
  sessionCache.clear();
  modelConfigRegistry.clear();
};

const onnxModelService = {
  registerModel,
  getModelConfig,
  loadSession,
  createTensor,
  runInference,
  clearModel,
  resetRegistry,
};

export default onnxModelService;
