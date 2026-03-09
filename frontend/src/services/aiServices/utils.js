export const ensureArray = (value, label = 'value') => {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
};

export const normalizeShape = (shape) => {
  const normalized = ensureArray(shape, 'shape').map((dim) => Number(dim));
  if (normalized.some((dim) => !Number.isFinite(dim) || dim <= 0)) {
    throw new Error('shape dimensions must be positive numbers');
  }
  return normalized;
};

export const toTypedArray = (data, type = 'float32') => {
  const values = ensureArray(data, 'data').map((value) => Number(value));
  switch (type) {
    case 'float32':
      return new Float32Array(values);
    case 'float64':
      return new Float64Array(values);
    case 'int32':
      return new Int32Array(values);
    case 'uint8':
      return new Uint8Array(values);
    default:
      throw new Error(`Unsupported tensor type: ${type}`);
  }
};

export const buildQueryParams = (params = {}) => {
  return Object.entries(params).reduce((acc, [key, value]) => {
    if (value === undefined || value === null || value === '') return acc;
    acc[key] = value;
    return acc;
  }, {});
};
