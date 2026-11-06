const NUMBERS = ['double', 'int', 'long', 'decimal'] as const;

/**
 * For each BSON type a field can be cast to, the BSON types whose `$convert` result is what casting the value means. `$convert` accepts more pairs than these; each one left off gives a result the value did not mean:
 *
 * - `string` to `bool` is `true` for every non-empty string, `"false"` and `"no"` included.
 * - `objectId` or `date` to `bool` is always `true`.
 * - `bool` to a number is `1` or `0`, which a number field does not mean.
 * - `date` to `double`, `long` or `decimal` is milliseconds since the epoch, and a number to `date` reads the number that way, a unit the value does not name.
 * - `objectId` to `date` is the time the id was made, not a date the document holds.
 *
 * See the MongoDB `$convert` reference.
 */
const CASTS_FROM: Readonly<Record<string, ReadonlySet<string>>> = {
  double: new Set([...NUMBERS, 'string']),
  string: new Set([...NUMBERS, 'string', 'bool', 'date', 'objectId']),
  objectId: new Set(['string', 'objectId']),
  bool: new Set([...NUMBERS, 'bool']),
  date: new Set(['string', 'date']),
  int: new Set([...NUMBERS, 'string']),
  long: new Set([...NUMBERS, 'string']),
  decimal: new Set([...NUMBERS, 'string']),
};

/** The casts that keep every value: each source type with the types it widens to. */
const KEEPS_EVERY_VALUE: Readonly<Record<string, ReadonlySet<string>>> = {
  int: new Set(['long', 'double', 'decimal']),
  long: new Set(['decimal']),
};

export function isConvertTarget(to: string): boolean {
  return Object.hasOwn(CASTS_FROM, to);
}

/** Whether a cast with `$convert` from BSON type `from` to `to` keeps what the values mean, for the values it casts. */
export function castsFrom(from: string, to: string): boolean {
  return from === to || (CASTS_FROM[to]?.has(from) ?? false);
}

/** Whether casting a value of BSON type `from` to `to` keeps every value as it was. */
export function convertKeepsEveryValue(from: string, to: string): boolean {
  return from === to || (KEEPS_EVERY_VALUE[from]?.has(to) ?? false);
}
