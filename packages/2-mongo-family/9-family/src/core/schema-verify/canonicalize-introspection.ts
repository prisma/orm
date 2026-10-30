/**
 * Canonicalizes a live (introspected) `MongoSchemaIR` against the expected
 * (contract-built) IR before diffing. MongoDB applies server-side defaults
 * to several option/index families that are absent from authored contracts,
 * which would otherwise cause `verifyMongoSchema` to report false-positive
 * drift on a fresh `migrate` run.
 *
 * The normalization is contract-aware where it has to be: server defaults
 * are stripped from the live IR for fields the contract did not specify, so
 * a contract that *does* specify a value still gets compared faithfully.
 *
 * Symmetric defaults — like `changeStreamPreAndPostImages: { enabled: false }`,
 * which is equivalent to "absent" on both sides — are stripped from both IRs
 * so either authoring style verifies.
 */

import { canonicalize } from '@internal/mongo-contract';
import type {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaIR,
} from '@internal/mongo-schema-ir';
import {
  MongoSchemaCollection as MongoSchemaCollectionCtor,
  MongoSchemaCollectionOptions as MongoSchemaCollectionOptionsCtor,
  MongoSchemaIndex as MongoSchemaIndexCtor,
  MongoSchemaIR as MongoSchemaIRCtor,
} from '@internal/mongo-schema-ir';
import type { CollationOptions } from '@internal/mongo-value/mongodb-types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';

export interface CanonicalizedSchemas {
  readonly live: MongoSchemaIR;
  readonly expected: MongoSchemaIR;
}

export function canonicalizeSchemasForVerification(
  live: MongoSchemaIR,
  expected: MongoSchemaIR,
): CanonicalizedSchemas {
  const expectedByName = new Map<string, MongoSchemaCollection>();
  for (const c of expected.collections) expectedByName.set(c.name, c);

  const liveByName = new Map<string, MongoSchemaCollection>();
  for (const c of live.collections) liveByName.set(c.name, c);

  const canonicalLive = live.collections.map((c) =>
    canonicalizeLiveCollection(c, expectedByName.get(c.name)),
  );
  const canonicalExpected = expected.collections.map((c) =>
    canonicalizeExpectedCollection(c, liveByName.get(c.name)),
  );

  return {
    live: new MongoSchemaIRCtor(canonicalLive),
    expected: new MongoSchemaIRCtor(canonicalExpected),
  };
}

function canonicalizeLiveCollection(
  liveColl: MongoSchemaCollection,
  expectedColl: MongoSchemaCollection | undefined,
): MongoSchemaCollection {
  const expectedIndexes = expectedColl?.indexes ?? [];
  const indexes = liveColl.indexes.map((idx) =>
    canonicalizeLiveIndex(idx, findExpectedIndexCounterpart(idx, expectedIndexes)),
  );

  const options = liveColl.options
    ? canonicalizeLiveOptions(liveColl.options, expectedColl?.options)
    : undefined;

  return new MongoSchemaCollectionCtor({
    name: liveColl.name,
    indexes,
    ...ifDefined('validator', liveColl.validator),
    ...ifDefined('options', options),
  });
}

function canonicalizeExpectedCollection(
  expectedColl: MongoSchemaCollection,
  liveColl: MongoSchemaCollection | undefined,
): MongoSchemaCollection {
  // Symmetric text-index key ordering: a contract-shaped text index preserves
  // the user-authored field order, but the introspected counterpart comes
  // back from MongoDB with `weights` keys in alphabetical order, so we
  // canonicalize both sides to alphabetical text-key order. The order of
  // text fields within the text block is semantically irrelevant — relevance
  // is governed by `weights`, not key order.
  const indexes = expectedColl.indexes.map(canonicalizeTextIndexKeyOrder);

  const options = expectedColl.options
    ? canonicalizeExpectedOptions(expectedColl.options, liveColl?.options)
    : undefined;

  return new MongoSchemaCollectionCtor({
    name: expectedColl.name,
    indexes,
    ...ifDefined('validator', expectedColl.validator),
    ...ifDefined('options', options),
  });
}

function canonicalizeTextIndexKeyOrder(index: MongoSchemaIndex): MongoSchemaIndex {
  const hasTextKey = index.keys.some((k) => k.direction === 'text');
  if (!hasTextKey) return index;
  return new MongoSchemaIndexCtor({
    keys: sortTextKeys(index.keys),
    unique: index.unique,
    ...ifDefined('sparse', index.sparse),
    ...ifDefined('expireAfterSeconds', index.expireAfterSeconds),
    ...ifDefined('partialFilterExpression', index.partialFilterExpression),
    ...ifDefined('wildcardProjection', index.wildcardProjection),
    ...ifDefined('collation', index.collation),
    ...ifDefined('weights', index.weights),
    ...ifDefined('default_language', index.default_language),
    ...ifDefined('language_override', index.language_override),
  });
}

/**
 * Returns a copy of `keys` with text-direction entries sorted alphabetically
 * while preserving the relative position of non-text entries. Compound text
 * indexes (`{a: 1, _fts: 'text', _ftsx: 1, b: 1}`) keep their scalar
 * prefix/suffix layout; only the contiguous text block is reordered.
 */
function sortTextKeys(
  keys: ReadonlyArray<{
    readonly field: string;
    readonly direction: 'text' | 1 | -1 | '2dsphere' | '2d' | 'hashed';
  }>,
): ReadonlyArray<{
  readonly field: string;
  readonly direction: 'text' | 1 | -1 | '2dsphere' | '2d' | 'hashed';
}> {
  const textEntries = keys.filter((k) => k.direction === 'text');
  if (textEntries.length <= 1) return keys;
  const sortedText = [...textEntries].sort((a, b) => a.field.localeCompare(b.field));
  let textIdx = 0;
  return keys.map((k) => {
    if (k.direction !== 'text') return k;
    const next = sortedText[textIdx++];
    /* v8 ignore next 3 -- @preserve invariant guard: textIdx is always < sortedText.length here because we only consume sortedText for text-direction entries and sortedText is built from the same filter. */
    if (next === undefined) {
      throw new InternalError('sortTextKeys: text-key counts mismatched');
    }
    return next;
  });
}

function canonicalizeLiveIndex(
  liveIndex: MongoSchemaIndex,
  expectedIndex: MongoSchemaIndex | undefined,
): MongoSchemaIndex {
  const projectedKeys = sortTextKeys(projectTextIndexKeys(liveIndex));
  const collation = liveIndex.collation
    ? stripCollationFields(liveIndex.collation, expectedIndex?.collation)
    : liveIndex.collation;

  // Text-index server defaults: when the contract did not set
  // `weights`/`default_language`/`language_override`, MongoDB applies
  // `weights = {<field>: 1, ...}` (uniform), `'english'`, and `'language'`
  // respectively. Strip them from live *only* when the live value matches
  // those defaults — preserving non-default live values lets the verifier
  // surface drift when the live index is tampered (e.g. weights tuned
  // out-of-band, custom `default_language`/`language_override`) even though
  // the contract authored neither.
  const weights =
    expectedIndex?.weights === undefined && hasDefaultTextWeights(projectedKeys, liveIndex.weights)
      ? undefined
      : liveIndex.weights;
  const default_language =
    expectedIndex?.default_language === undefined && liveIndex.default_language === 'english'
      ? undefined
      : liveIndex.default_language;
  const language_override =
    expectedIndex?.language_override === undefined && liveIndex.language_override === 'language'
      ? undefined
      : liveIndex.language_override;

  return new MongoSchemaIndexCtor({
    keys: projectedKeys,
    unique: liveIndex.unique,
    ...ifDefined('sparse', liveIndex.sparse),
    ...ifDefined('expireAfterSeconds', liveIndex.expireAfterSeconds),
    ...ifDefined('partialFilterExpression', liveIndex.partialFilterExpression),
    ...ifDefined('wildcardProjection', liveIndex.wildcardProjection),
    ...ifDefined('collation', collation),
    ...ifDefined('weights', weights),
    ...ifDefined('default_language', default_language),
    ...ifDefined('language_override', language_override),
  });
}

/**
 * Locate the contract-side index that corresponds to a live index for the
 * purpose of contract-aware normalization. We deliberately match by the
 * *projected* (contract-shaped) key list — so a live `_fts/_ftsx` index
 * resolves to a contract `{title: 'text', body: 'text'}` index — and pick
 * the first match. Contracts very rarely contain duplicate-key indexes; if
 * we have no counterpart we fall back to no normalization for that index.
 */
function findExpectedIndexCounterpart(
  liveIndex: MongoSchemaIndex,
  expectedIndexes: ReadonlyArray<MongoSchemaIndex>,
): MongoSchemaIndex | undefined {
  const liveKeys = keyPatternOf(projectTextIndexKeys(liveIndex));
  return expectedIndexes.find((expected) => keyPatternOf(expected.keys) === liveKeys);
}

function keyPatternOf(keys: ReturnType<typeof projectTextIndexKeys>): string {
  return canonicalize(sortTextKeys(keys).map((k) => [k.field, k.direction]));
}

/**
 * MongoDB expands a contract-shaped text index like
 * `[{title: 'text'}, {body: 'text'}]` into its internal weighted vector
 * representation `[{_fts: 'text'}, {_ftsx: 1}]`. We project back to
 * contract-shaped keys via `weights`, iterating in whatever order MongoDB
 * returns them (alphabetical, in practice). `sortTextKeys` is applied
 * downstream to canonicalize the order on both sides, so this projection
 * does not depend on a specific iteration order.
 */
function projectTextIndexKeys(liveIndex: MongoSchemaIndex): ReadonlyArray<{
  readonly field: string;
  readonly direction: 'text' | 1 | -1 | '2dsphere' | '2d' | 'hashed';
}> {
  const isTextIndex =
    liveIndex.keys.length >= 1 &&
    liveIndex.keys.some((k) => k.field === '_fts' && k.direction === 'text');

  if (!isTextIndex || !liveIndex.weights) return liveIndex.keys;

  const textKeys = Object.keys(liveIndex.weights).map((field) => ({
    field,
    direction: 'text' as const,
  }));

  // Splice the projected text fields into the original `_fts/_ftsx` slot so
  // compound text indexes that mix scalar prefixes *and* suffixes — e.g.
  // `[prefix, _fts, _ftsx, suffix]` — keep their original layout. Flattening
  // scalars first would yield `[prefix, suffix, ...text]`, which `sortTextKeys`
  // (downstream) cannot recover because it only reorders text-direction
  // entries within their existing positions. MongoDB always emits exactly one
  // `_fts`/`_ftsx` pair per index, so we don't need to guard against
  // duplicates.
  type IndexKey = (typeof liveIndex.keys)[number];
  const projectedKeys: IndexKey[] = [];
  for (const key of liveIndex.keys) {
    if (key.field === '_ftsx') continue;
    if (key.field === '_fts') {
      projectedKeys.push(...textKeys);
      continue;
    }
    projectedKeys.push(key);
  }
  return projectedKeys;
}

/**
 * MongoDB's server-default `weights` for an authored-without-weights text
 * index assigns `1` to every text-direction field. Returns `true` only when
 * `liveWeights` is exactly that uniform shape (every projected text-direction
 * key weighted at `1`) so the canonicalizer leaves non-default weights —
 * including out-of-band relevance tweaks — visible to the verifier.
 *
 * `projectTextIndexKeys` derives text-direction keys from the live weights
 * map, so the count is guaranteed to match; we only have to check the value
 * shape.
 */
function hasDefaultTextWeights(
  projectedKeys: ReadonlyArray<{
    readonly field: string;
    readonly direction: 'text' | 1 | -1 | '2dsphere' | '2d' | 'hashed';
  }>,
  liveWeights: MongoSchemaIndex['weights'],
): boolean {
  if (liveWeights === undefined) return false;
  const textFields = projectedKeys.filter((k) => k.direction === 'text').map((k) => k.field);
  return textFields.every((field) => liveWeights[field] === 1);
}

function canonicalizeLiveOptions(
  liveOptions: MongoSchemaCollectionOptions,
  expectedOptions: MongoSchemaCollectionOptions | undefined,
): MongoSchemaCollectionOptions | undefined {
  const collation = liveOptions.collation
    ? stripCollationFields(liveOptions.collation, expectedOptions?.collation)
    : undefined;

  // Timeseries: drop `bucketMaxSpanSeconds` (and any other server-applied
  // extras) when the contract did not specify them.
  const timeseries = liveOptions.timeseries
    ? (stripUnspecifiedFields(
        liveOptions.timeseries as Record<string, unknown>,
        expectedOptions?.timeseries as Record<string, unknown> | undefined,
      ) as MongoSchemaCollectionOptions['timeseries'])
    : undefined;

  // ClusteredIndex: drop `key`, `unique`, `v` and any other server-applied
  // extras when the contract did not specify them.
  const clusteredIndex = liveOptions.clusteredIndex
    ? (stripUnspecifiedFields(
        liveOptions.clusteredIndex as Record<string, unknown>,
        expectedOptions?.clusteredIndex as Record<string, unknown> | undefined,
      ) as MongoSchemaCollectionOptions['clusteredIndex'])
    : undefined;

  // changeStreamPreAndPostImages: `{enabled: false}` is equivalent to
  // "absent". Strip it from live so it round-trips with a contract that
  // omits the field, and is symmetric with the expected-side stripping.
  const changeStreamPreAndPostImages = isDisabledChangeStream(
    liveOptions.changeStreamPreAndPostImages,
  )
    ? undefined
    : liveOptions.changeStreamPreAndPostImages;

  const hasMeaningful =
    liveOptions.capped || timeseries || collation || changeStreamPreAndPostImages || clusteredIndex;
  if (!hasMeaningful) return undefined;

  return new MongoSchemaCollectionOptionsCtor({
    ...ifDefined('capped', liveOptions.capped),
    ...ifDefined('timeseries', timeseries),
    ...ifDefined('collation', collation),
    ...ifDefined('changeStreamPreAndPostImages', changeStreamPreAndPostImages),
    ...ifDefined('clusteredIndex', clusteredIndex),
  });
}

function canonicalizeExpectedOptions(
  expectedOptions: MongoSchemaCollectionOptions,
  _liveOptions: MongoSchemaCollectionOptions | undefined,
): MongoSchemaCollectionOptions | undefined {
  // Symmetric: a contract `{enabled: false}` is equivalent to absent.
  const changeStreamPreAndPostImages = isDisabledChangeStream(
    expectedOptions.changeStreamPreAndPostImages,
  )
    ? undefined
    : expectedOptions.changeStreamPreAndPostImages;

  const hasMeaningful =
    expectedOptions.capped ||
    expectedOptions.timeseries ||
    expectedOptions.collation ||
    changeStreamPreAndPostImages ||
    expectedOptions.clusteredIndex;
  if (!hasMeaningful) return undefined;

  return new MongoSchemaCollectionOptionsCtor({
    ...ifDefined('capped', expectedOptions.capped),
    ...ifDefined('timeseries', expectedOptions.timeseries),
    ...ifDefined('collation', expectedOptions.collation),
    ...ifDefined('changeStreamPreAndPostImages', changeStreamPreAndPostImages),
    ...ifDefined('clusteredIndex', expectedOptions.clusteredIndex),
  });
}

function isDisabledChangeStream(value: { enabled: boolean } | undefined): boolean {
  return value !== undefined && value.enabled === false;
}

/**
 * Returns a copy of `live` containing only the keys that `expected` defines.
 * Used for option families whose individual sub-fields are server-extended
 * with platform defaults (collation, timeseries, clusteredIndex), so the
 * verifier should compare only what the contract actually authored.
 *
 * When `expected` is `undefined` — i.e. the contract authored nothing for
 * this whole option family but the live IR has it — we return `live`
 * unchanged so the verifier still sees the entire live block and can
 * surface it as drift. (Returning `undefined` here would silently strip a
 * server-attached collation/timeseries/clusteredIndex that the contract
 * never asked for, hiding real drift.)
 */
function stripCollationFields(
  live: CollationOptions,
  expected: CollationOptions | undefined,
): CollationOptions {
  return blindCast<
    CollationOptions,
    'locale is required in CollationOptions so stripUnspecifiedFields preserves it when expected is defined'
  >(stripUnspecifiedFields(live, expected));
}

function stripUnspecifiedFields<T extends object>(live: T, expected: T | undefined): Partial<T> {
  if (expected === undefined) return live;
  const out: Partial<T> = {};
  for (const key of Object.keys(expected) as (keyof T)[]) {
    if (Object.hasOwn(live, key)) out[key] = live[key];
  }
  return out;
}
