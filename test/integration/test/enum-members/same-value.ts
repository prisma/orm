function jsonOf(value: object): string {
  return JSON.stringify(value, (_key, part: unknown) =>
    typeof part === 'bigint' ? `${part}n` : part,
  );
}

/**
 * Whether a value read back is the member written: a primitive by `Object.is`, so `NaN` is itself; an object by its prototype and its JSON, which a Temporal value or a `Date` writes as its ISO text, a `Uint8Array` as its bytes and a bigint as its digits.
 */
export function sameValue(read: unknown, member: unknown): boolean {
  if (typeof member !== 'object' || member === null) return Object.is(read, member);
  if (typeof read !== 'object' || read === null) return false;
  return (
    Object.getPrototypeOf(read) === Object.getPrototypeOf(member) && jsonOf(read) === jsonOf(member)
  );
}
