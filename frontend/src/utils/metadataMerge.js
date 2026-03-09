const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const toMetadataArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (isPlainObject(value)) {
    return Object.entries(value).map(([key, itemValue]) => ({
      key,
      value: itemValue,
    }));
  }
  return [];
};

export const mergeMetadataSources = (...sources) => {
  const normalized = sources.filter((value) => value != null && value !== '');
  if (!normalized.length) return {};

  const hasArray = normalized.some(Array.isArray);
  const hasObject = normalized.some(isPlainObject);

  if (hasArray && hasObject) {
    return normalized.flatMap((value) => toMetadataArray(value));
  }

  if (hasArray) {
    return normalized.flatMap((value) => (Array.isArray(value) ? value : []));
  }

  const merged = {};
  normalized.forEach((value) => {
    if (isPlainObject(value)) {
      Object.assign(merged, value);
    }
  });

  return merged;
};
