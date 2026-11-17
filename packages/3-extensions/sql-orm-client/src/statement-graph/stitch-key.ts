import { ormError } from '../orm-errors';

/** The string a `Map` keys a decoded row identity by: equal decoded keys give equal strings. */
export function stitchKey(parts: readonly unknown[]): string {
  const [only, ...others] = parts;
  if (others.length === 0) {
    return partText(only);
  }
  return JSON.stringify(parts.map(partText));
}

function partText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Uint8Array) {
    return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  if (value instanceof Date) return value.toISOString();
  if (isTemporal(value)) return String(value);
  throw ormError(
    'ORM.ROW_IDENTITY_MISSING',
    `An include matches child rows to their parents by key, and a key value of kind "${kindOf(value)}" cannot be matched. Key a relation by columns that decode to a number, string, bigint, boolean, byte array, date or Temporal value.`,
    { meta: { kind: kindOf(value) } },
  );
}

function isTemporal(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    String(Reflect.get(value, Symbol.toStringTag)).startsWith('Temporal.')
  );
}

function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
