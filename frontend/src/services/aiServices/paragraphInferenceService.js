import onnxModelService from './onnxModelService.js';

const DEFAULT_MODEL_ID = 'paragraph-minilm6';
const DEFAULT_MAX_LENGTH = 256;

const SCORE_LABELS = [
  { key: 'grammar_score', label: 'Grammar' },
  { key: 'clarity_score', label: 'Clarity' },
  { key: 'ambiguity_score', label: 'Ambiguity' },
  { key: 'legal_risk_score', label: 'Legal Risk' },
  { key: 'metadata_presence_score', label: 'Metadata Presence' },
  { key: 'reference_integrity_score', label: 'Reference Integrity' },
  { key: 'enforceability_score', label: 'Enforceability' },
  { key: 'structural_validity_score', label: 'Structural Validity' },
  { key: 'overall_score', label: 'Overall' },
];

const MODEL_URL = new URL('./minilm6.onnx', import.meta.url).toString();
const TOKENIZER_JSON_URL = '/ai-tokenizer/tokenizer.json';
const TOKENIZER_CONFIG_URL = '/ai-tokenizer/tokenizer_config.json';
const TOKENIZER_VOCAB_URL = '/ai-tokenizer/vocab.txt';
const TOKENIZER_TRAINER_URL = '/ai-tokenizer/trainer_state.json';

const tokenizerAssets = {
  tokenizerJsonUrl: TOKENIZER_JSON_URL,
  tokenizerConfigUrl: TOKENIZER_CONFIG_URL,
  vocabUrl: TOKENIZER_VOCAB_URL,
  trainerStateUrl: TOKENIZER_TRAINER_URL,
};

const DEFAULT_TOKENIZER_BASE = '/ai-tokenizer/';

const tokenizerPromises = new Map();
let transformersPromise = null;

const ensureTransformers = async () => {
  if (!transformersPromise) {
    transformersPromise = import('@xenova/transformers');
  }
  return transformersPromise;
};

const resolveTokenizerBaseUrl = (baseUrl = DEFAULT_TOKENIZER_BASE) => {
  if (typeof baseUrl === 'string' && /^https?:\/\//.test(baseUrl)) {
    return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  if (normalized.startsWith('/')) return normalized;
  return `/${normalized}`;
};

const loadTokenizer = async (baseUrl = DEFAULT_TOKENIZER_BASE) => {
  const resolvedBaseUrl = resolveTokenizerBaseUrl(baseUrl);
  if (!tokenizerPromises.has(resolvedBaseUrl)) {
    tokenizerPromises.set(
      resolvedBaseUrl,
      (async () => {
        const transformers = await ensureTransformers();
        if (!transformers?.AutoTokenizer) {
          throw new Error('Transformers AutoTokenizer is unavailable.');
        }
        if (transformers?.env) {
          transformers.env.allowRemoteModels = false;
          transformers.env.localModelPath = '/';
        }
        return transformers.AutoTokenizer.from_pretrained(resolvedBaseUrl, {
          local_files_only: false,
        });
      })()
    );
  }
  return tokenizerPromises.get(resolvedBaseUrl);
};

const ensureModelRegistered = (modelId = DEFAULT_MODEL_ID, url = MODEL_URL) => {
  try {
    onnxModelService.getModelConfig(modelId);
    return;
  } catch {
    onnxModelService.registerModel(modelId, { url });
  }
};

const tensorData = (tensor) => {
  if (!tensor) return [];
  if (tensor.data) return Array.from(tensor.data);
  if (tensor.cpuData) return Object.values(tensor.cpuData).map((value) => Number(value));
  return [];
};

const clamp01 = (value) => {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
};

const buildScoreMap = (logits = []) => {
  return SCORE_LABELS.reduce((acc, item, index) => {
    const value = Number(logits[index]);
    acc[item.key] = Number.isFinite(value) ? clamp01(value) : null;
    return acc;
  }, {});
};

const computeMetadataStatus = (metadataLogits = []) => {
  if (!metadataLogits || metadataLogits.length < 2) return null;
  const [validLogit, invalidLogit] = metadataLogits.map((value) => Number(value));
  const expValid = Math.exp(validLogit);
  const expInvalid = Math.exp(invalidLogit);
  const probInvalid = expInvalid / (expValid + expInvalid);
  return {
    is_invalid: probInvalid >= 0.5,
    invalid_probability: clamp01(probInvalid),
  };
};

const buildFeeds = (session, encoded) => {
  const feeds = {};
  session.inputNames.forEach((inputName) => {
    const tensor = encoded[inputName];
    if (!tensor) return;
    const dims = tensor.dims || tensor.shape || [1, tensor.data.length];
    const data = tensor.data instanceof BigInt64Array
      ? tensor.data
      : BigInt64Array.from(tensor.data, (value) => BigInt(value));
    feeds[inputName] = onnxModelService.createTensor(data, dims, 'int64');
  });
  return feeds;
};

const runParagraphInference = async (text, options = {}) => {
  if (!text) throw new Error('text is required for paragraph inference');
  const modelId = options.modelId || DEFAULT_MODEL_ID;
  ensureModelRegistered(modelId, options.modelUrl);

  const [session, tokenizer] = await Promise.all([
    onnxModelService.loadSession(modelId, options.sessionOptions || {}),
  loadTokenizer(options.tokenizerBaseUrl || DEFAULT_TOKENIZER_BASE),
  ]);

  const encoded = await tokenizer(text, {
    padding: 'max_length',
    truncation: true,
    max_length: options.maxLength || DEFAULT_MAX_LENGTH,
  });

  const feeds = buildFeeds(session, encoded);
  const results = await onnxModelService.runInference(modelId, feeds, options);

  const logits = tensorData(results.logits);
  const metadataLogits = tensorData(results.metadata_status_logits);

  return {
    status: 'success',
    source: 'local-onnx',
    processed_text: text,
    rendered_text: text,
    scores: buildScoreMap(logits),
    metadata_detected: computeMetadataStatus(metadataLogits) || {},
    suggestions: [],
    raw: {
      logits,
      metadata_status_logits: metadataLogits,
    },
  };
};

const paragraphInferenceService = {
  SCORE_LABELS,
  tokenizerAssets,
  loadTokenizer,
  runParagraphInference,
  buildScoreMap,
  computeMetadataStatus,
};

export { SCORE_LABELS, tokenizerAssets, loadTokenizer, runParagraphInference, buildScoreMap, computeMetadataStatus };
export default paragraphInferenceService;
