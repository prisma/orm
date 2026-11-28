/**
 * What `listCollections` reports for the options a collection is created with, where it differs
 * from what was given. The schema verifier and the `createCollection` postcheck both read the
 * reported options, so both compare the given ones through these.
 */

/** MongoDB's limit on the number of documents of a capped collection given a `max` of zero or less. */
const UNLIMITED_CAPPED_MAX = 2147483647;

/** Whether change stream images are given as turned off, which MongoDB reports as no option at all. */
export function isDisabledChangeStream(value: { readonly enabled: boolean } | undefined): boolean {
  return value !== undefined && value.enabled === false;
}

/** Whether a collation is the `simple` one, which MongoDB reports as no collation. */
export function isSimpleCollation(value: { readonly locale: string } | undefined): boolean {
  return value?.locale === 'simple';
}

/** Whether MongoDB reports a validator given as `validator`: it reports none for an empty one. */
export function reportsValidator(
  validator: Readonly<Record<string, unknown>> | undefined,
): boolean {
  return validator !== undefined && Object.keys(validator).length > 0;
}

/** The size MongoDB reports for a capped collection: the whole number of bytes given. */
export function reportedCappedSize(size: number): number {
  return Math.trunc(size);
}

/** The `max` MongoDB reports for a capped collection: its own limit for zero or less. */
export function reportedCappedMax(max: number): number {
  return max <= 0 ? UNLIMITED_CAPPED_MAX : max;
}
