/** The boolean a stored integer names: `false` for 0 and `true` for 1, read from a number, a bigint or the integer's decimal text. `undefined` for any other value. */
export function booleanFromInteger(stored: unknown): boolean | undefined {
  if (stored === 0 || stored === 0n || stored === '0') return false;
  if (stored === 1 || stored === 1n || stored === '1') return true;
  return undefined;
}

/** The integer a boolean is stored as: 1 for `true` and 0 for `false`. */
export function integerFromBoolean(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}
