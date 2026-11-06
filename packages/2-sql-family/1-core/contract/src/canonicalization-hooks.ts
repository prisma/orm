import type { PreserveEmptyPredicate, StorageSort } from '@internal/contract/hashing';
import {
  createPreserveEmptyPredicate,
  createStorageSort,
  matchesPathPattern,
  type NamedArraySortTarget,
  type PathPattern,
} from '@internal/contract/hashing-utils';

const preserveEmptyPatterns = [
  ['storage', 'namespaces', '*', 'entries', 'table'],
  ['storage', 'namespaces', '*', 'entries', 'table', '*'],
  ['storage', 'namespaces', '*', 'entries', 'table', '*', ['uniques', 'indexes', 'foreignKeys']],
  // An index's `unique` flag is a required boolean: `unique: false` must
  // survive the default-omission walk or the emitted contract fails its own
  // IndexSchema validation on the next read.
  ['storage', 'namespaces', '*', 'entries', 'table', '*', 'indexes', 'unique'],
  // A column default's literal payload is data, not shape — `{ kind:
  // 'literal', value: false }` (or `value: []`) must survive the
  // default-omission walk or the emitted contract fails its own
  // validation on the next read (CONTRACT.VALIDATION_FAILED on `Boolean @default(false)`).
  ['storage', 'namespaces', '*', 'entries', 'table', '*', 'columns', '*', 'default', 'value'],
  // A model's `fields` and its storage `fields` are required: a variant with no fields of its own has `fields: {}` in both.
  ['domain', 'namespaces', '*', 'models', '*', 'fields'],
  ['domain', 'namespaces', '*', 'models', '*', 'storage', 'fields'],
] as const satisfies readonly PathPattern[];

// A literal column default's value is user data, not omittable structure:
// `@default(false)` (and empty objects/arrays at any depth inside the value)
// must survive canonicalization, or the emitted contract fails the runtime's
// structural validation with `default.value … (was missing)`.
const columnDefaultValuePrefix = [
  'storage',
  'namespaces',
  '*',
  'entries',
  'table',
  '*',
  'columns',
  '*',
  'default',
  'value',
] as const satisfies PathPattern;

const isColumnDefaultValuePath = (path: readonly string[]): boolean =>
  path.length >= columnDefaultValuePrefix.length &&
  matchesPathPattern(path.slice(0, columnDefaultValuePrefix.length), columnDefaultValuePrefix);

const sortTargets = [
  {
    path: ['namespaces', '*', 'entries', 'table', '*'],
    arrayKeys: ['checks', 'indexes', 'uniques'],
  },
] as const satisfies readonly NamedArraySortTarget[];

const matchesPreserveEmptyPattern = createPreserveEmptyPredicate(preserveEmptyPatterns);

const shouldPreserveEmpty: PreserveEmptyPredicate = (path) =>
  isColumnDefaultValuePath(path) || matchesPreserveEmptyPattern(path);

const sortStorage: StorageSort = createStorageSort(sortTargets);

export const sqlContractCanonicalizationHooks: {
  readonly shouldPreserveEmpty: PreserveEmptyPredicate;
  readonly sortStorage: StorageSort;
} = {
  shouldPreserveEmpty,
  sortStorage,
};
