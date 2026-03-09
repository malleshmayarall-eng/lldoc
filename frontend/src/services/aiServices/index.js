import aiApiService from './aiApiService';
import onnxModelService from './onnxModelService';
import paragraphInferenceService from './paragraphInferenceService';
import paragraphInferenceManager from './paragraphInferenceManager';
import * as aiServiceUtils from './utils';

const aiServices = {
  api: aiApiService,
  onnx: onnxModelService,
  paragraphInference: paragraphInferenceService,
  paragraphInferenceManager,
  utils: aiServiceUtils,
};

export { aiApiService, onnxModelService, paragraphInferenceService, paragraphInferenceManager, aiServiceUtils };
export default aiServices;
