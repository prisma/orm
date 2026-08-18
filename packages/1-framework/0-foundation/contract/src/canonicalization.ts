import { isArrayEqual } from '@internal/utils/array-equal';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import type { JsonObject } from '@internal/utils/json';
import { matchesPathPattern, type PathPattern } from './canonicalization-path-match';
import type { Contract } from './contract-types';

/**
 * Per-target contract serializer hook. The framework canonicalizer uses
 * this to convert an in-memory contract (which may carry class-instance
 * IR nodes whose runtime-only fields must not appear in the on-disk
 * envelope) into a plain JsonObject before applying the family-agnostic
 * canonical-key ordering / default-omission / sort steps. Targets whose
 * contract is JSON-clean by construction return the contract unchanged.
 */
export type SerializeContract = (contract: Contract) => JsonObject;

/**
 * Family-contributed predicate for the default-omission walk. Called when
 * a value at `path` is a default (empty object/array or `false`); if this
 * returns `true` the value is kept rather than stripped.
 *
 * The framework only calls the predicate inside the `isDefaultValue` branch,
 * so there is no need to guard against non-default values.
 */
export type PreserveEmptyPredicate = (path: readonly string[]) => boolean;

/**
 * Family-contributed storage sort. Applied to the serialized `storage`
 * subtree after the default-omission walk; the result replaces the
 * `storage` field before the final key sort. Use to establish a
 * deterministic order for storage arrays (indexes, uniques) that the
 * family-agnostic `sortObjectKeys` pass cannot handle.
 */
export type StorageSort = (storage: unknown) => unknown;

const DOMAIN_NAMESPACE_SLOT_PATTERN = ['domain', 'namespaces', '*'] as const satisfies PathPattern;
const DOMAIN_MODELS_CONTAINER_PATTERN = [
  'domain',
  'namespaces',
  '*',
  'models',
] as const satisfies PathPattern;
const DOMAIN_MODEL_RELATIONS_PATTERN = [
  'domain',
  'namespaces',
  '*',
  'models',
  '*',
  'relations',
] as const satisfies PathPattern;
const DOMAIN_MODEL_STORAGE_PATTERN = [
  'domain',
  'namespaces',
  '*',
  'models',
  '*',
  'storage',
] as const satisfies PathPattern;
const DOMAIN_MODEL_FIELD_MANY_PATTERN = [
  'domain',
  'namespaces',
  '*',
  'models',
  '*',
  'fields',
  '*',
  'many',
] as const satisfies PathPattern;
const DOMAIN_VALUE_OBJECT_FIELD_MANY_PATTERN = [
  'domain',
  'namespaces',
  '*',
  'valueObjects',
  '*',
  'fields',
  '*',
  'many',
] as const satisfies PathPattern;
const STORAGE_NAMESPACE_ENTRIES_PATTERN = [
  'storage',
  'namespaces',
  '*',
  'entries',
] as const satisfies PathPattern;

const TOP_LEVEL_ORDER = [
  'schemaVersion',
  'canonicalVersion',
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

function isDefaultValue(value: unknown): boolean {
  if (value === false) return true;
  if (value === null) return false;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value);
    return keys.length === 0;
  }
  return false;
}

function omitDefaults(
  obj: unknown,
  path: readonly string[],
  shouldPreserveEmpty: PreserveEmptyPredicate | undefined,
): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => omitDefaults(item, path, shouldPreserveEmpty));
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = [...path, key];

    if (key === '_generated') {
      continue;
    }

    if (key === 'generated' && value === false) {
      continue;
    }

    if ((key === 'onDelete' || key === 'onUpdate') && value === 'noAction') {
      continue;
    }

    if (isDefaultValue(value)) {
      const isRequiredDomainNamespaces = isArrayEqual(currentPath, ['domain', 'namespaces']);
      const isDomainNamespaceSlot = matchesPathPattern(currentPath, DOMAIN_NAMESPACE_SLOT_PATTERN);
      const isRequiredDomainModels = matchesPathPattern(
        currentPath,
        DOMAIN_MODELS_CONTAINER_PATTERN,
      );
      const isRequiredStorageNamespaces = isArrayEqual(currentPath, ['storage', 'namespaces']);
      const isStorageNamespaceEntries = matchesPathPattern(
        currentPath,
        STORAGE_NAMESPACE_ENTRIES_PATTERN,
      );
      const isRequiredRoots = isArrayEqual(currentPath, ['roots']);
      const isRequiredExtensions = isArrayEqual(currentPath, ['extensions']);
      const isRequiredCapabilities = isArrayEqual(currentPath, ['capabilities']);
      const isRequiredMeta = isArrayEqual(currentPath, ['meta']);
      const isRequiredExecutionDefaults = isArrayEqual(currentPath, [
        'execution',
        'mutations',
        'defaults',
      ]);
      const isExtensionNamespace = currentPath.length === 2 && currentPath[0] === 'extensions';
      const isModelRelations = matchesPathPattern(currentPath, DOMAIN_MODEL_RELATIONS_PATTERN);
      const isModelStorage = matchesPathPattern(currentPath, DOMAIN_MODEL_STORAGE_PATTERN);

      const isNullableField = key === 'nullable';
      const isManyElementNullable = key === 'elementNullable' && path.at(-1) === 'many';
      const isContractFieldMany =
        matchesPathPattern(currentPath, DOMAIN_MODEL_FIELD_MANY_PATTERN) ||
        matchesPathPattern(currentPath, DOMAIN_VALUE_OBJECT_FIELD_MANY_PATTERN);

      const isFamilyPreserved = shouldPreserveEmpty?.(currentPath) ?? false;

      if (
        !isRequiredDomainNamespaces &&
        !isDomainNamespaceSlot &&
        !isRequiredDomainModels &&
        !isRequiredStorageNamespaces &&
        !isStorageNamespaceEntries &&
        !isRequiredRoots &&
        !isRequiredExtensions &&
        !isRequiredCapabilities &&
        !isRequiredMeta &&
        !isRequiredExecutionDefaults &&
        !isExtensionNamespace &&
        !isModelRelations &&
        !isModelStorage &&
        !isNullableField &&
        !isManyElementNullable &&
        !isContractFieldMany &&
        !isFamilyPreserved
      ) {
        continue;
      }
    }

    result[key] = omitDefaults(value, currentPath, shouldPreserveEmpty);
  }

  return result;
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
    sorted[key] = sortObjectKeys(
      blindCast<Record<string, unknown>, 'non-array object narrowed above'>(obj)[key],
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
  readonly schemaVersion?: string;
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
  /**
   * Family-contributed preserve-empty predicate. When the walk encounters a
   * default value (empty object/array or `false`) at `path`, calling this
   * with the full path allows the family to veto the omission. If absent,
   * only the framework's family-agnostic required-slot rules apply.
   */
  readonly shouldPreserveEmpty?: PreserveEmptyPredicate;
  /**
   * Family-contributed storage sort. Applied to the serialized `storage`
   * subtree after the default-omission walk, before the final key sort.
   * SQL family uses this to impose a deterministic order on `indexes` and
   * `uniques` arrays within each namespace table. Families that require no
   * special storage ordering omit this hook.
   */
  readonly sortStorage?: StorageSort;
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
    ...ifDefined('schemaVersion', options.schemaVersion),
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
  const withDefaultsOmitted = blindCast<
    Record<string, unknown>,
    'canonicalization starts from a record and preserves its outer object shape'
  >(omitDefaults(normalized, [], options.shouldPreserveEmpty));
  const withSortedStorage = options.sortStorage
    ? { ...withDefaultsOmitted, storage: options.sortStorage(withDefaultsOmitted['storage']) }
    : withDefaultsOmitted;
  const withSortedKeys = blindCast<
    Record<string, unknown>,
    'sorting a record preserves its outer object shape'
  >(sortObjectKeys(withSortedStorage));
  return orderTopLevel(withSortedKeys);
}

export function canonicalizeContract(
  contract: Contract,
  options: CanonicalizeContractOptions,
): string {
  return JSON.stringify(canonicalizeContractToObject(contract, options), null, 2);
}
