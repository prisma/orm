/**
 * The two column descriptors the contract-loading fixtures need.
 *
 * Defined here rather than taken from `@repo/test-utils` because these
 * fixtures stand in for a user's `contract.ts` and are loaded through the
 * import allowlist, which admits only names a user could resolve. A shared
 * helper from this repository's own dev scope is not one of those, and adding
 * it to the allowlist to satisfy a fixture would widen what real contracts may
 * import.
 */
interface ColumnTypeDescriptor {
  readonly codecId: string;
}

export const int4Column: ColumnTypeDescriptor = {
  codecId: 'pg/int4@1',
};

export const textColumn: ColumnTypeDescriptor = {
  codecId: 'pg/text@1',
};
