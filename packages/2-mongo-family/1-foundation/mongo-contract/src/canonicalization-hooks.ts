import type { PreserveEmptyPredicate } from '@internal/contract/hashing';
import { createPreserveEmptyPredicate, type PathPattern } from '@internal/contract/hashing-utils';

const preserveEmptyPatterns = [
  ['storage', 'namespaces', '*', 'entries', 'collection'],
  ['storage', 'namespaces', '*', 'entries', 'collection', '*'],
  // A model's `fields` and its storage `fields` are required: a variant with no fields of its own has `fields: {}` in both.
  ['domain', 'namespaces', '*', 'models', '*', 'fields'],
  ['domain', 'namespaces', '*', 'models', '*', 'storage', 'fields'],
] as const satisfies readonly PathPattern[];

const matchesPreserveEmptyPattern = createPreserveEmptyPredicate(preserveEmptyPatterns);

// An empty schema under `properties` (or as an array's `items`) admits any
// value: a field whose codec declares no BSON type, such as `mongo/bson@1`.
// Dropping it would leave the field out of `properties`, and the closed
// schema would then reject every document that carries it.
const isUnconstrainedFieldSchema = (path: readonly string[]): boolean =>
  path.includes('jsonSchema') &&
  (path[path.length - 2] === 'properties' || path[path.length - 1] === 'items');

// `additionalProperties: false` is the closed-schema marker on a Mongo
// `$jsonSchema` validator. It is injected at every object level the validator
// describes — top-level collections, nested value objects and embedded models,
// and each polymorphic `oneOf` branch; an open object where a recursive group
// is referred back to has none — so it appears at an unbounded set of paths
// that fixed-length path patterns cannot enumerate. It is a meaningful constraint rather than an
// omittable default, so preserve it wherever it occurs in a Mongo contract.
const shouldPreserveEmpty: PreserveEmptyPredicate = (path) =>
  path[path.length - 1] === 'additionalProperties' ||
  isUnconstrainedFieldSchema(path) ||
  matchesPreserveEmptyPattern(path);

// A codec's type parameters are the codec's own data: `false`, `[]` and `{}`
// inside them are what the codec is rebuilt from at runtime. They sit on a
// field type, `type.typeParams`, and on a union member, `members.typeParams`.
const isInsideCodecTypeParams = (path: readonly string[]): boolean =>
  path.some(
    (segment, index) =>
      segment === 'typeParams' &&
      index < path.length - 1 &&
      (path[index - 1] === 'type' || path[index - 1] === 'members'),
  );

/**
 * Preserve-empty predicate for writing a Mongo contract to disk: the hashing
 * predicate, plus everything inside a codec's type parameters. The storage
 * hash goes on omitting those (it uses `mongoContractCanonicalizationHooks`),
 * so writing them changes no hash.
 */
export const mongoContractSerializationPreserveEmpty: PreserveEmptyPredicate = (path) =>
  isInsideCodecTypeParams(path) || shouldPreserveEmpty(path);

export const mongoContractCanonicalizationHooks: {
  readonly shouldPreserveEmpty: PreserveEmptyPredicate;
} = {
  shouldPreserveEmpty,
};
