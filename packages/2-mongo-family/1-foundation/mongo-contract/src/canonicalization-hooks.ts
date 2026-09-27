import type { PreserveEmptyPredicate } from '@internal/contract/hashing';
import { createPreserveEmptyPredicate, type PathPattern } from '@internal/contract/hashing-utils';

const preserveEmptyPatterns = [
  ['storage', 'namespaces', '*', 'entries', 'collection'],
  ['storage', 'namespaces', '*', 'entries', 'collection', '*'],
] as const satisfies readonly PathPattern[];

const matchesPreserveEmptyPattern = createPreserveEmptyPredicate(preserveEmptyPatterns);

// An empty schema under `properties` (or as an array's `items`) admits any
// value: a field whose codec declares no BSON type, such as `mongo/json@1`.
// Dropping it would leave the field out of `properties`, and the closed
// schema would then reject every document that carries it.
const isUnconstrainedFieldSchema = (path: readonly string[]): boolean =>
  path.includes('jsonSchema') &&
  (path[path.length - 2] === 'properties' || path[path.length - 1] === 'items');

// `additionalProperties: false` is the closed-schema marker on a Mongo
// `$jsonSchema` validator. It is injected at every object level — top-level
// collections, nested embedded value objects, and each polymorphic `oneOf`
// branch — so it appears at an unbounded set of paths that fixed-length path
// patterns cannot enumerate. It is a meaningful constraint rather than an
// omittable default, so preserve it wherever it occurs in a Mongo contract.
const shouldPreserveEmpty: PreserveEmptyPredicate = (path) =>
  path[path.length - 1] === 'additionalProperties' ||
  isUnconstrainedFieldSchema(path) ||
  matchesPreserveEmptyPattern(path);

export const mongoContractCanonicalizationHooks: {
  readonly shouldPreserveEmpty: PreserveEmptyPredicate;
} = {
  shouldPreserveEmpty,
};
