export function isCanonicalPlainObject(value: unknown): value is { [key: string]: unknown } {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function preflightPlainTree(value: unknown, path: string, ancestors: WeakSet<object>): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path}`);
    return;
  }
  if (typeof value !== 'object') throw new TypeError(`Non-canonical value at ${path}`);
  if (ancestors.has(value)) throw new TypeError(`Cycle at ${path}`);

  const array = Array.isArray(value);
  if (!array && !isCanonicalPlainObject(value)) throw new TypeError(`Non-plain object at ${path}`);
  ancestors.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(value);
    for (const key of ownKeys) {
      if (typeof key === 'symbol') throw new TypeError(`Symbol key at ${path}`);
      if (array && key === 'length') continue;
      if (array && !/^(?:0|[1-9]\d*)$/.test(key)) {
        throw new TypeError(`Extra array key at ${path}.${key}`);
      }
      const descriptor = descriptors[key];
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new TypeError(`Accessor at ${path}.${key}`);
      }
      if (!descriptor.enumerable) throw new TypeError(`Non-enumerable key at ${path}.${key}`);
      preflightPlainTree(descriptor.value, `${path}.${key}`, ancestors);
    }
    if (array) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError(`Sparse array at ${path}[${index}]`);
      }
    }
  } finally {
    ancestors.delete(value);
  }
}

function cloneCanonical(value: unknown, path: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path}`);
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry, index) => cloneCanonical(entry, `${path}[${index}]`)));
  }
  if (!isCanonicalPlainObject(value)) throw new TypeError(`Non-plain value at ${path}`);

  const clone: { [key: string]: unknown } = {};
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (entry === undefined) throw new TypeError(`Undefined value at ${path}.${key}`);
    Object.defineProperty(clone, key, {
      configurable: false,
      enumerable: true,
      value: cloneCanonical(entry, `${path}.${key}`),
      writable: false,
    });
  }
  return Object.freeze(clone);
}

export function canonicalParse<Output>(input: unknown, parse: (value: unknown) => Output): Output {
  preflightPlainTree(input, '$', new WeakSet());
  return cloneCanonical(parse(input), '$') as Output;
}

export function canonicalJson(input: unknown): string {
  preflightPlainTree(input, '$', new WeakSet());
  return JSON.stringify(cloneCanonical(input, '$'));
}
