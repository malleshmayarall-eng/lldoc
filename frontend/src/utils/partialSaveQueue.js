const VALID_OPS = new Set(['update']);

const isUuidObject = (value) => {
  if (!value || typeof value !== 'object') return false;
  const name = value?.constructor?.name || '';
  return name.toLowerCase() === 'uuid';
};

const normalizeUuidValue = (value) => {
  if (isUuidObject(value)) return value.toString();
  return value;
};

const deepNormalize = (value) => {
  const normalized = normalizeUuidValue(value);
  if (Array.isArray(normalized)) {
    return normalized.map(deepNormalize);
  }
  if (normalized && typeof normalized === 'object') {
    return Object.fromEntries(
      Object.entries(normalized).map(([key, val]) => [key, deepNormalize(val)])
    );
  }
  return normalized;
};

export const normalizeChange = (change) => {
  if (!change || typeof change !== 'object') {
    throw new Error('Change must be an object');
  }

  const { type, op, id, client_id, data, ...rest } = change;

  if (!type || typeof type !== 'string') {
    throw new Error('Change requires a valid "type"');
  }
  if (!VALID_OPS.has(op)) {
    throw new Error(`Change op must be one of: ${Array.from(VALID_OPS).join(', ')}`);
  }
  if ((op === 'update' || op === 'delete') && !id) {
    throw new Error(`Change with op "${op}" requires an "id"`);
  }

  return {
    type,
    op,
    id: normalizeUuidValue(id) ?? id,
    client_id: normalizeUuidValue(client_id) ?? client_id,
    data: deepNormalize(data || {}),
    ...deepNormalize(rest),
  };
};

const mergeChangeData = (existing, incoming) => {
  if (existing.op === 'update' && incoming.op === 'update') {
    return {
      ...existing,
      data: { ...existing.data, ...incoming.data },
      ...incoming,
      op: 'update',
    };
  }

  return { ...existing, ...incoming };
};

export class ChangeQueue {
  constructor() {
    this._changes = new Map();
  }

  _key(change) {
    const identifier = change.id || change.client_id;
    return `${change.type}:${identifier}`;
  }

  add(change) {
    const normalized = normalizeChange(change);
    const key = this._key(normalized);
    const existing = this._changes.get(key);

    if (existing) {
      this._changes.set(key, mergeChangeData(existing, normalized));
    } else {
      this._changes.set(key, normalized);
    }

    return normalized;
  }

  addUpdate(type, id, data = {}, meta = {}) {
    return this.add({ type, op: 'update', id, data, ...meta });
  }

  toPayload() {
    return { changes: Array.from(this._changes.values()) };
  }

  clear() {
    this._changes.clear();
  }

  get size() {
    return this._changes.size;
  }

  get pending() {
    return Array.from(this._changes.values());
  }
}

export const buildPartialSavePayload = (changes = []) => {
  return {
    changes: changes.map((change) => normalizeChange(change)),
  };
};
