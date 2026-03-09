import { normalizeShape, toTypedArray, buildQueryParams } from '../src/services/aiServices/utils.js';
import { buildScoreMap, computeMetadataStatus } from '../src/services/aiServices/paragraphInferenceService.js';

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
};

const run = () => {
  const shape = normalizeShape([1, 3, 224, 224]);
  assert(shape.length === 4, 'Expected 4D shape');

  const tensor = toTypedArray([0, 1, 2], 'float32');
  assert(tensor instanceof Float32Array, 'Expected Float32Array');
  assert(tensor.length === 3, 'Expected 3 values');

  const params = buildQueryParams({ a: 1, b: null, c: 'ok' });
  assert(params.a === 1 && params.c === 'ok' && !('b' in params), 'Params should omit null');

  const scoreMap = buildScoreMap([0.9, 0.1]);
  assert('grammar_score' in scoreMap, 'Expected grammar_score to exist');
  assert(scoreMap.grammar_score === 0.9, 'Expected grammar_score to equal 0.9');

  const metadata = computeMetadataStatus([0, 1]);
  assert(metadata?.is_invalid === true, 'Expected invalid metadata status');

  console.log('aiServicesSelfTest: PASS');
};

try {
  run();
} catch (error) {
  console.error('aiServicesSelfTest: FAIL');
  console.error(error);
  process.exitCode = 1;
}
