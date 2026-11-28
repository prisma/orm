import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import type { JsonObject } from '@internal/utils/json';
import type { Contract } from './contract-types';

/**
 * Per-target contract serializer hook. The framework canonicalizer uses
 * this to convert an in-memory contract (which may carry class-instance
 * IR nodes whose runtime-only fields must not appear in the on-disk
 * envelope) into a plain JsonObject before applying the family-agnostic
 * canonical-key ordering and sort steps. Targets whose
 * contract is JSON-clean by construction return the contract unchanged.
 */
export type SerializeContract = (contract: Contract) => JsonObject;

/**
 * Family-contributed normal form of the `storage` section. The framework applies it to `storage` before it sorts keys, both when it writes a contract and when it hashes storage, so the written section and the hash input are one form. The framework itself leaves out no value; a family leaves out the fields it defines as equal to their absence, and orders the storage arrays whose order carries no meaning.
 */
export type NormalizeStorage = (storage: unknown) => unknown;

const TOP_LEVEL_ORDER = [
  'formatVersion',
  'targetFamily',
  'target',
  'profileHash',
  'roots',
  'domain',
  'storage',
  'execution',
  'capabilities',
  'extensions',
  'defaultControlPolicy',
  'meta',
] as const;

/** Stores `value` as an own key of `target`, so a key named `__proto__` is a key rather than the prototype. */
function defineOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sortObjectKeys(item));
  }

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj).sort();
  for (const key of keys) {
    defineOwn(
      sorted,
      key,
      sortObjectKeys(
        blindCast<Record<string, unknown>, 'non-array object narrowed above'>(obj)[key],
      ),
    );
  }

  return sorted;
}

export function orderTopLevel(obj: Record<string, unknown>): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  const remaining = new Set(Object.keys(obj));

  for (const key of TOP_LEVEL_ORDER) {
    if (remaining.has(key)) {
      ordered[key] = obj[key];
      remaining.delete(key);
    }
  }

  for (const key of Array.from(remaining).sort()) {
    ordered[key] = obj[key];
  }

  return ordered;
}

export interface CanonicalizeContractOptions {
  /**
   * Per-target hook that converts the in-memory contract (which may
   * carry class-instance IR nodes) into a plain JsonObject before the
   * family-agnostic canonicalization steps run.
   *
   * Routing through the hook is what lets each target decide which
   * fields appear in the on-disk envelope; runtime-only class API
   * fields stay invisible to the canonicalization walk by virtue of
   * the per-target serializer not putting them in the JSON shape.
   */
  readonly serializeContract: SerializeContract;
  /** The family's normal form of `storage`. A family whose storage has no defaults to leave out and no arrays to order passes a function that returns the storage it is given. */
  readonly normalizeStorage: NormalizeStorage;
}

/**
 * Object-form variant of {@link canonicalizeContract}. Exported because the
 * emitter writes the canonical contract through a separate JSON-stringify
 * pass and consumes the structured object directly.
 */
export function canonicalizeContractToObject(
  contract: Contract,
  options: CanonicalizeContractOptions,
): Record<string, unknown> {
  const serialized = options.serializeContract(contract);
  const normalized: Record<string, unknown> = {
    ...ifDefined('formatVersion', serialized['formatVersion']),
    targetFamily: serialized['targetFamily'],
    target: serialized['target'],
    profileHash: serialized['profileHash'],
    roots: serialized['roots'],
    domain: serialized['domain'],
    storage: serialized['storage'],
    ...ifDefined('execution', serialized['execution']),
    extensions: serialized['extensions'],
    capabilities: serialized['capabilities'],
    ...ifDefined('defaultControlPolicy', serialized['defaultControlPolicy']),
    meta: serialized['meta'],
  };
  return orderTopLevel(canonicalizeSections(normalized, options.normalizeStorage));
}

/**
 * Applies the canonicalization rules to top-level contract sections, keyed by their contract names (`storage`, `capabilities`, `execution`, ...): the family's `normalizeStorage` applied to `storage`, then every key sorted. No value is left out.
 */
export function canonicalizeSections(
  sections: Record<string, unknown>,
  normalizeStorage: NormalizeStorage,
): Record<string, unknown> {
  const withNormalStorage =
    sections['storage'] !== undefined
      ? { ...sections, storage: normalizeStorage(sections['storage']) }
      : sections;
  return blindCast<Record<string, unknown>, 'sorting a record preserves its outer object shape'>(
    sortObjectKeys(withNormalStorage),
  );
}

export function canonicalizeContract(
  contract: Contract,
  options: CanonicalizeContractOptions,
): string {
  return JSON.stringify(canonicalizeContractToObject(contract, options), null, 2);
}
