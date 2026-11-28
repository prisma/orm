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

// A codec's type parameters are the codec's own data: `false`, `[]` and `{}`
// inside them (an arktype-json schema's `{ unit: false }`) are what the codec
// is rebuilt from at runtime. They sit on a column, `columns.<name>.typeParams`,
// a storage type alias, `storage.types.<name>.typeParams`, a field type,
// `type.typeParams`, and a union member, `members.typeParams`.
const isInsideCodecTypeParams = (path: readonly string[]): boolean =>
  path.some(
    (segment, index) =>
      segment === 'typeParams' &&
      index < path.length - 1 &&
      (path[index - 1] === 'type' ||
        path[index - 1] === 'members' ||
        path[index - 2] === 'columns' ||
        (index === 3 && path[0] === 'storage' && path[1] === 'types')),
  );

/**
 * Preserve-empty predicate for writing a SQL contract to disk: the hashing
 * predicate, plus everything inside a codec's type parameters. The storage
 * hash goes on omitting those (it uses `sqlContractCanonicalizationHooks`),
 * so writing them changes no hash.
 */
export const sqlContractSerializationPreserveEmpty: PreserveEmptyPredicate = (path) =>
  isInsideCodecTypeParams(path) || shouldPreserveEmpty(path);

export const sqlContractCanonicalizationHooks: {
  readonly shouldPreserveEmpty: PreserveEmptyPredicate;
  readonly sortStorage: StorageSort;
} = {
  shouldPreserveEmpty,
  sortStorage,
};
