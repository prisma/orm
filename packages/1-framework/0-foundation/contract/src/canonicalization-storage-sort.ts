import type { StorageSort } from './canonicalization';
import { isPlainRecord } from './is-plain-record';

export type PathSegment = string | '*';

export interface NamedArraySortTarget {
  readonly path: readonly PathSegment[];
  readonly arrayKeys: readonly string[];
}

// Order by UTF-16 code unit, not locale collation: canonicalization feeds
// storageHash, which must be byte-identical across hosts, and locale
// collation (localeCompare/Intl) varies by the engine's ICU build.
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareByNameProperty(a: unknown, b: unknown): number {
  const nameA = isPlainRecord(a) && typeof a['name'] === 'string' ? a['name'] : '';
  const nameB = isPlainRecord(b) && typeof b['name'] === 'string' ? b['name'] : '';
  return compareCodeUnits(nameA, nameB);
}

function sortArrayKeysOnRecord(
  record: Record<string, unknown>,
  arrayKeys: readonly string[],
  compare: (a: unknown, b: unknown) => number,
): Record<string, unknown> {
  const sorted: Record<string, unknown> = { ...record };
  for (const key of arrayKeys) {
    const value = record[key];
    if (Array.isArray(value)) {
      sorted[key] = [...value].sort(compare);
    }
  }
  return sorted;
}

function walkAndSort(
  node: unknown,
  pathSegments: readonly PathSegment[],
  arrayKeys: readonly string[],
  compare: (a: unknown, b: unknown) => number,
): unknown {
  if (pathSegments.length === 0) {
    if (!isPlainRecord(node)) {
      return node;
    }
    return sortArrayKeysOnRecord(node, arrayKeys, compare);
  }

  if (!isPlainRecord(node)) {
    return node;
  }

  const [head, ...rest] = pathSegments;
  if (head === undefined) {
    return node;
  }

  if (head === '*') {
    const sorted: Record<string, unknown> = { ...node };
    for (const key of Object.keys(node)) {
      sorted[key] = walkAndSort(node[key], rest, arrayKeys, compare);
    }
    return sorted;
  }

  const child = node[head];
  if (child === undefined) {
    return node;
  }

  return { ...node, [head]: walkAndSort(child, rest, arrayKeys, compare) };
}

export function createStorageSort(
  targets: readonly NamedArraySortTarget[],
  compare: (a: unknown, b: unknown) => number = compareByNameProperty,
): StorageSort {
  return (storage) => {
    if (!isPlainRecord(storage)) {
      return storage;
    }

    let result: unknown = storage;
    for (const target of targets) {
      result = walkAndSort(result, target.path, target.arrayKeys, compare);
    }
    return result;
  };
}
