const NUMBERS = ['double', 'int', 'long', 'decimal'] as const;

/**
 * For each BSON type `$convert` casts to, the BSON types it casts from. A pair missing here has no
 * conversion: `$convert` fails on every value. See the MongoDB `$convert` reference.
 */
const CONVERT_SOURCES: Readonly<Record<string, ReadonlySet<string>>> = {
  double: new Set([...NUMBERS, 'string', 'bool', 'date']),
  string: new Set([...NUMBERS, 'string', 'bool', 'date', 'objectId']),
  objectId: new Set(['string', 'objectId']),
  bool: new Set([...NUMBERS, 'string', 'bool', 'date', 'objectId']),
  date: new Set(['double', 'long', 'decimal', 'string', 'date', 'objectId']),
  int: new Set([...NUMBERS, 'string', 'bool']),
  long: new Set([...NUMBERS, 'string', 'bool', 'date']),
  decimal: new Set([...NUMBERS, 'string', 'bool', 'date']),
};

/** The casts that keep every value: each source type with the types it widens to. */
const KEEPS_EVERY_VALUE: Readonly<Record<string, ReadonlySet<string>>> = {
  int: new Set(['long', 'double', 'decimal']),
  long: new Set(['decimal']),
};

export function isConvertTarget(to: string): boolean {
  return Object.hasOwn(CONVERT_SOURCES, to);
}

/** Whether `$convert` casts a value of BSON type `from` to `to`, at least for some values. */
export function convertsFrom(from: string, to: string): boolean {
  return from === to || (CONVERT_SOURCES[to]?.has(from) ?? false);
}

/** Whether casting a value of BSON type `from` to `to` keeps every value as it was. */
export function convertKeepsEveryValue(from: string, to: string): boolean {
  return from === to || (KEEPS_EVERY_VALUE[from]?.has(to) ?? false);
}
