/** A value inside a document that JSON cannot hold: what it is, such as `undefined`, `NaN`, `bigint` or a class name, and its path of keys and indexes joined by dots, `''` for the document itself. */
export interface NonJsonValue {
  readonly received: string;
  readonly path: string;
}

export interface FindNonJsonValueOptions {
  /** Names an object that is not JSON although its shape is, such as a driver's wrapper class; read before the object's prototype. */
  readonly tagOf?: (value: object) => string | undefined;
}

function childPath(path: string, key: string | number): string {
  return path === '' ? String(key) : `${path}.${key}`;
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPlainArray(value: object): boolean {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype;
}

function constructorName(value: object): string {
  const name = Reflect.get(value, 'constructor')?.name;
  return typeof name === 'string' && name !== '' ? name : 'object';
}

function describeNonJson(value: unknown, options: FindNonJsonValueOptions): string | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? undefined : String(value);
  if (typeof value !== 'object') return typeof value;
  const tag = options.tagOf?.(value);
  if (tag !== undefined) return tag;
  if (value instanceof Date) return 'Date';
  if (isPlainArray(value)) return undefined;
  return isPlainObject(value) ? undefined : constructorName(value);
}

function find(
  value: unknown,
  path: string,
  ancestors: Set<object>,
  options: FindNonJsonValueOptions,
): NonJsonValue | undefined {
  const received = describeNonJson(value, options);
  if (received !== undefined) return { received, path };
  if (typeof value !== 'object' || value === null) return undefined;
  if (ancestors.has(value)) return { received: 'circular reference', path };
  ancestors.add(value);
  const found = Array.isArray(value)
    ? findInArray(value, path, ancestors, options)
    : findInEntries(Object.entries(value), path, ancestors, options);
  ancestors.delete(value);
  return found;
}

function findInArray(
  value: readonly unknown[],
  path: string,
  ancestors: Set<object>,
  options: FindNonJsonValueOptions,
): NonJsonValue | undefined {
  for (let index = 0; index < value.length; index++) {
    if (!(index in value)) return { received: 'sparse array hole', path: childPath(path, index) };
    const found = find(value[index], childPath(path, index), ancestors, options);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findInEntries(
  entries: readonly [string, unknown][],
  path: string,
  ancestors: Set<object>,
  options: FindNonJsonValueOptions,
): NonJsonValue | undefined {
  for (const [key, entry] of entries) {
    const found = find(entry, childPath(path, key), ancestors, options);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The first value in `value`, depth first, that a plain JSON document cannot hold: `undefined`, a function, a symbol, a `bigint`, `NaN` or an infinity, an instance of a class such as `Date` or `Uint8Array`, a circular reference or a hole in a sparse array. `undefined` when `value` is plain JSON at every depth.
 */
export function findNonJsonValue(
  value: unknown,
  options: FindNonJsonValueOptions = {},
): NonJsonValue | undefined {
  return find(value, '', new Set(), options);
}
