# AI Services

This guide describes the `aiServices` system in `src/services/aiServices`.

## Overview

`aiServices` provides two layers:

- **ONNX runtime helpers** for loading models and running in-browser inference.
- **AI API helpers** that group existing AI endpoints and support new AI routes.

## ONNX model usage

Register a model and run inference:

```js
import aiServices from '../services/aiServices';

aiServices.onnx.registerModel('layout-v1', {
  url: '/models/layout-v1.onnx',
  sessionOptions: {
    executionProviders: ['wasm'],
  },
});

const tensor = aiServices.onnx.createTensor([0, 1, 2, 3], [1, 4]);
const results = await aiServices.onnx.runInference('layout-v1', {
  input: tensor,
});
```

Notes:

- Models are cached by `modelId` after the first load.
- `onnxModelService` only runs in the browser; it throws if used in Node.

## Paragraph inference (local ONNX)

The paragraph model in `src/services/aiServices/minilm6.onnx` can run inference directly in the browser.

```js
import aiServices from '../services/aiServices';

const result = await aiServices.paragraphInference.runParagraphInference('Your paragraph text');
console.log(result.scores, result.metadata_detected);
```

The editor uses local inference only. To disable local inference, set:

```env
VITE_ENABLE_LOCAL_AI=false
```

When local inference is disabled, the paragraph AI review will show an error instead of calling
the backend API.

### Tokenizer assets

The tokenizer files are served from `public/ai-tokenizer/` so Transformers can load them with
`local_files_only=true`. If you update the tokenizer, re-copy the files into that folder or run:

```sh
npm run ai:sync-tokenizer
```

### WASM assets

`onnxruntime-web` expects its WASM binaries and JS module shims to be served with the correct
MIME type. This repo keeps them under `public/onnxruntime-web/`. If you reinstall dependencies,
ensure the `.wasm` and `.mjs` files exist there (copied from `node_modules/onnxruntime-web/dist`).

You can re-sync them with:

```sh
npm run ai:sync-onnx
```

## AI API usage

```js
import aiServices from '../services/aiServices';

const review = await aiServices.api.paragraph.getParagraphAiReview(paragraphId);
const score = await aiServices.api.getDocumentScore(documentId);
```

For additional AI endpoints:

```js
await aiServices.api.post('/ai/some-new-endpoint/', { payload: 'value' });
```

## Helper utilities

Use the helper utilities to build tensors or clean query params:

```js
import { toTypedArray } from '../services/aiServices/utils';

const values = toTypedArray([1, 2, 3], 'float32');
```
