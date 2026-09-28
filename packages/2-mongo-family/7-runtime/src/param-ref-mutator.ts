import { isPlainRecord } from '@internal/contract/is-plain-record';
import type { ParamRefMutator } from '@internal/framework-components/runtime';
import type { MongoLoweredDraft } from '@internal/mongo-lowering';
import { MongoParamRef } from '@internal/mongo-value';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';

/**
 * Phantom brand on {@link MongoParamRefHandle} so handles produced by
 * {@link MongoParamRefMutator.entries} are distinguishable at the type level
 * from user-constructed `MongoParamRef` instances. There is no runtime token —
 * the handle IS the underlying `MongoParamRef` instance, cast through the brand.
 */
declare const mongoParamRefHandleBrand: unique symbol;

/**
 * Opaque token identifying a single `MongoParamRef` in the draft tree.
 * Produced by {@link MongoParamRefMutator.entries}; consumed by
 * `replaceValue` / `replaceValues`. The `TCodecId` phantom parameter
 * records the codec id so typed overloads can route replacement values
 * through a `TCodecMap`.
 */
export interface MongoParamRefHandle<TCodecId extends string | undefined = string | undefined> {
  readonly [mongoParamRefHandleBrand]: TCodecId;
}

/**
 * One outbound `MongoParamRef` slot in the draft exposed to middleware.
 * `value` is the current effective value (post any prior mutations);
 * `codecId` is the codec id declared on the underlying `MongoParamRef`.
 */
export interface MongoParamRefEntry<TCodecId extends string | undefined = string | undefined> {
  readonly ref: MongoParamRefHandle<TCodecId>;
  readonly value: unknown;
  readonly codecId: TCodecId;
}

/**
 * Discriminated entry union over a codec map. For each `K` in `TCodecMap`,
 * `entries()` may yield a `MongoParamRefEntry<K>`; refs with no codec id (or
 * an unrecognised codec id) yield `MongoParamRefEntry<undefined>`. Pattern-
 * matching on `entry.codecId` narrows `entry.ref` to `MongoParamRefHandle<K>`.
 */
export type MongoParamRefEntryUnion<TCodecMap extends Record<string, unknown>> =
  | { [K in keyof TCodecMap & string]: MongoParamRefEntry<K> }[keyof TCodecMap & string]
  | MongoParamRefEntry<undefined>;

/**
 * Mongo-family mutator threaded into `MongoMiddleware.beforeExecute` as
 * `params`. Scope is `MongoParamRef.value` slots only — middleware cannot
 * insert or remove refs, rewrite the filter shape, or modify the pipeline
 * structure. The phantom `MongoParamRefHandle` brand and the typed
 * `replaceValue` overload enforce this at compile time.
 *
 * `entries()` performs a flat walk over the `MongoLoweredDraft` tree via
 * {@link flattenMongoParamRefs}, yielding every `MongoParamRef` leaf in
 * document fields, array elements, filter predicates, update operators, and
 * pipeline stages. The walk matches `resolveDraftSlot` in the Mongo adapter
 * (plain-object and array slots only; `Date` and other non-plain objects are
 * leaves in both paths).
 *
 * Allocation discipline: the working-overrides map is only allocated on the
 * first `replaceValue` / `replaceValues` call. If no middleware mutates,
 * `currentDraft()` returns the original draft by reference identity without
 * allocating a new tree (the AC-MUT5 fast path).
 */
export interface MongoParamRefMutator<
  TCodecMap extends Record<string, unknown> = Record<string, unknown>,
> extends ParamRefMutator {
  entries(): IterableIterator<MongoParamRefEntryUnion<TCodecMap>>;

  replaceValue<TCodecId extends keyof TCodecMap & string>(
    ref: MongoParamRefHandle<TCodecId>,
    newValue: TCodecMap[TCodecId],
  ): void;
  replaceValue(ref: MongoParamRefHandle<undefined>, newValue: unknown): void;

  replaceValues(
    updates: Iterable<{
      readonly ref: MongoParamRefHandle<(keyof TCodecMap & string) | undefined>;
      readonly newValue: unknown;
    }>,
  ): void;
}

/**
 * Internal-only view that exposes `currentDraft()` to the Mongo runtime.
 * The runtime calls this after the `beforeExecute` chain; the result is the
 * original draft by reference if nothing was mutated, otherwise a new tree
 * with the mutations applied. `MongoMiddleware` consumers never see this
 * shape; they receive the public `MongoParamRefMutator` view.
 */
export interface MongoParamRefMutatorInternal<
  TCodecMap extends Record<string, unknown> = Record<string, unknown>,
> extends MongoParamRefMutator<TCodecMap> {
  currentDraft(): MongoLoweredDraft;
}

type AnyMongoHandle = MongoParamRefHandle<string | undefined>;

// ─── Internal tree-walk helpers ────────────────────────────────────────────
// Descent mirrors resolveDraftSlot in adapter-mongo/resolve-value.ts: recurse
// arrays and plain records; treat MongoParamRef, primitives, Date, and other
// non-plain objects as leaves.

function* flattenDraftSlot(value: unknown): Generator<MongoParamRef> {
  if (value instanceof MongoParamRef) {
    yield value;
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* flattenDraftSlot(item);
    }
    return;
  }
  if (isPlainRecord(value)) {
    for (const v of Object.values(value)) {
      yield* flattenDraftSlot(v);
    }
  }
}

/**
 * Flat walk over a `MongoLoweredDraft` yielding every `MongoParamRef` leaf
 * regardless of nesting — object values, array elements, filter predicate
 * values, update operator values, and pipeline stage values. Raw command
 * variants carry no `MongoParamRef` nodes so they yield zero entries.
 *
 * **Walk parity:** slot traversal matches `resolveDraftSlot` / `resolveParams`
 * — refs appear only in plain-object and array containers; `Date` and other
 * non-plain objects are leaves (not descended into), so middleware sees every
 * ref the resolve pass will encode.
 */
export function* flattenMongoParamRefs(draft: MongoLoweredDraft): Generator<MongoParamRef> {
  switch (draft.kind) {
    case 'insertOne':
    case 'rawInsertOne':
      yield* flattenDraftSlot(draft.document);
      break;
    case 'insertMany':
    case 'rawInsertMany':
      for (const doc of draft.documents) {
        yield* flattenDraftSlot(doc);
      }
      break;
    case 'updateOne':
    case 'updateMany':
    case 'rawUpdateOne':
    case 'rawUpdateMany':
      yield* flattenDraftSlot(draft.filter);
      yield* flattenDraftSlot(draft.update);
      break;
    case 'findOneAndUpdate':
    case 'rawFindOneAndUpdate':
      yield* flattenDraftSlot(draft.filter);
      yield* flattenDraftSlot(draft.update);
      break;
    case 'deleteOne':
    case 'deleteMany':
    case 'rawDeleteOne':
    case 'rawDeleteMany':
      yield* flattenDraftSlot(draft.filter);
      break;
    case 'findOneAndDelete':
    case 'rawFindOneAndDelete':
      yield* flattenDraftSlot(draft.filter);
      break;
    case 'aggregate':
    case 'rawAggregate':
      for (const stage of draft.pipeline) {
        yield* flattenDraftSlot(stage);
      }
      break;
  }
}

// ─── Draft reconstruction for the mutated path ─────────────────────────────

function substituteSlot(value: unknown, overrides: ReadonlyMap<MongoParamRef, unknown>): unknown {
  if (value instanceof MongoParamRef) {
    if (overrides.has(value)) {
      return new MongoParamRef(overrides.get(value), {
        ...ifDefined('name', value.name),
        ...ifDefined('codecId', value.codecId),
        ...ifDefined('collection', value.collection),
      });
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteSlot(item, overrides));
  }
  if (isPlainRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = substituteSlot(v, overrides);
    }
    return out;
  }
  return value;
}

function substituteDoc(
  doc: Record<string, unknown>,
  overrides: ReadonlyMap<MongoParamRef, unknown>,
): Record<string, unknown> {
  return blindCast<
    Record<string, unknown>,
    'substituteSlot preserves plain-object shape for document inputs'
  >(substituteSlot(doc, overrides));
}

function isUpdatePipeline(
  update: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>,
): update is ReadonlyArray<Record<string, unknown>> {
  return Array.isArray(update);
}

function substituteUpdate(
  update: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>,
  overrides: ReadonlyMap<MongoParamRef, unknown>,
): Record<string, unknown> | Array<Record<string, unknown>> {
  if (isUpdatePipeline(update)) {
    return update.map((stage) => substituteDoc(stage, overrides));
  }
  return substituteDoc(update, overrides);
}

function buildMutatedDraft(
  draft: MongoLoweredDraft,
  overrides: ReadonlyMap<MongoParamRef, unknown>,
): MongoLoweredDraft {
  switch (draft.kind) {
    case 'insertOne':
      return {
        kind: 'insertOne',
        collection: draft.collection,
        document: substituteDoc(draft.document, overrides),
      };
    case 'rawInsertOne':
      return {
        kind: 'rawInsertOne',
        collection: draft.collection,
        document: substituteDoc(draft.document, overrides),
      };
    case 'insertMany':
      return {
        kind: 'insertMany',
        collection: draft.collection,
        documents: draft.documents.map((d) => substituteDoc(d, overrides)),
      };
    case 'rawInsertMany':
      return {
        kind: 'rawInsertMany',
        collection: draft.collection,
        documents: draft.documents.map((d) => substituteDoc(d, overrides)),
      };
    case 'updateOne':
      return {
        kind: 'updateOne',
        collection: draft.collection,
        filter: substituteDoc(draft.filter, overrides),
        update: substituteUpdate(draft.update, overrides),
        upsert: draft.upsert,
      };
    case 'updateMany':
      return {
        kind: 'updateMany',
        collection: draft.collection,
        filter: substituteDoc(draft.filter, overrides),
        update: substituteUpdate(draft.update, overrides),
        upsert: draft.upsert,
      };
    case 'rawUpdateOne':
      return {
        kind: 'rawUpdateOne',
        collection: draft.collection,
        filter: substituteDoc(draft.filter, overrides),
        update: substituteUpdate(draft.update, overrides),
      };
    case 'rawUpdateMany':
      return {
        kind: 'rawUpdateMany',
        collection: draft.collection,
        filter: substituteDoc(draft.filter, overrides),
        update: substituteUpdate(draft.update, overrides),
      };
    case 'deleteOne':
      return {
        kind: 'deleteOne',
        collection: draft.collection,
        filter: substituteDoc(draft.filter, overrides),
      };
    case 'deleteMany':
      return {
        kind: 'deleteMany',
        collection: draft.collection,
        filter: substituteDoc(draft.filter, overrides),
      };
    case 'rawDeleteOne':
      return {
        kind: 'rawDeleteOne',
        collection: draft.collection,
        filter: substituteDoc(draft.filter, overrides),
      };
    case 'rawDeleteMany':
      return {
        kind: 'rawDeleteMany',
        collection: draft.collection,
        filter: substituteDoc(draft.filter, overrides),
      };
    case 'findOneAndUpdate':
      return {
        kind: 'findOneAndUpdate',
        collection: draft.collection,
        filter: substituteDoc(draft.filter, overrides),
        update: substituteUpdate(draft.update, overrides),
        upsert: draft.upsert,
        sort: draft.sort,
        returnDocument: draft.returnDocument,
      };
    case 'rawFindOneAndUpdate':
      return {
        kind: 'rawFindOneAndUpdate',
        collection: draft.collection,
        filter: substituteDoc(draft.filter, overrides),
        update: substituteUpdate(draft.update, overrides),
        upsert: draft.upsert,
        sort: draft.sort,
        returnDocument: draft.returnDocument,
      };
    case 'findOneAndDelete':
      return {
        kind: 'findOneAndDelete',
        collection: draft.collection,
        filter: substituteDoc(draft.filter, overrides),
        sort: draft.sort,
      };
    case 'rawFindOneAndDelete':
      return {
        kind: 'rawFindOneAndDelete',
        collection: draft.collection,
        filter: substituteDoc(draft.filter, overrides),
        sort: draft.sort,
      };
    case 'aggregate':
      return {
        kind: 'aggregate',
        collection: draft.collection,
        pipeline: draft.pipeline.map((s) => substituteDoc(s, overrides)),
      };
    case 'rawAggregate':
      return {
        kind: 'rawAggregate',
        collection: draft.collection,
        pipeline: draft.pipeline.map((s) => substituteDoc(s, overrides)),
      };
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Build a {@link MongoParamRefMutatorInternal} for the given lowered draft.
 *
 * The mutator captures the draft by reference and uses `flattenMongoParamRefs`
 * on demand to produce `entries()`. Replacements are stored in a lazily-
 * allocated `Map`; the fast path (no replacements) preserves bit-for-bit
 * reference identity to the original draft in `currentDraft()`.
 */
export function createMongoParamRefMutator<
  TCodecMap extends Record<string, unknown> = Record<string, unknown>,
>(draft: MongoLoweredDraft): MongoParamRefMutatorInternal<TCodecMap> {
  const originalDraft = draft;
  let overrides: Map<MongoParamRef, unknown> | undefined;

  const ensureOverrides = (): Map<MongoParamRef, unknown> => {
    if (!overrides) {
      overrides = new Map();
    }
    return overrides;
  };

  function* entries(): IterableIterator<MongoParamRefEntryUnion<TCodecMap>> {
    for (const ref of flattenMongoParamRefs(originalDraft)) {
      const handle = blindCast<
        MongoParamRefHandle<string | undefined>,
        'MongoParamRef instance is the runtime handle token'
      >(ref);
      const value = overrides?.has(ref) ? overrides.get(ref) : ref.value;
      const codecId: string | undefined = ref.codecId;
      const entry: MongoParamRefEntry<string | undefined> = { ref: handle, value, codecId };
      yield blindCast<
        MongoParamRefEntryUnion<TCodecMap>,
        'entry codecId widened to TCodecMap union'
      >(entry);
    }
  }

  function replaceValue(handle: AnyMongoHandle, newValue: unknown): void {
    ensureOverrides().set(
      blindCast<MongoParamRef, 'MongoParamRefHandle brand is the underlying ref instance'>(handle),
      newValue,
    );
  }

  function replaceValues(
    updates: Iterable<{ readonly ref: AnyMongoHandle; readonly newValue: unknown }>,
  ): void {
    const map = ensureOverrides();
    for (const { ref, newValue } of updates) {
      map.set(
        blindCast<MongoParamRef, 'MongoParamRefHandle brand is the underlying ref instance'>(ref),
        newValue,
      );
    }
  }

  return {
    entries,
    replaceValue: blindCast<
      MongoParamRefMutator<TCodecMap>['replaceValue'],
      'replaceValue overloads are enforced at the interface; implementation accepts AnyMongoHandle'
    >(replaceValue),
    replaceValues,
    currentDraft(): MongoLoweredDraft {
      if (!overrides || overrides.size === 0) {
        return originalDraft;
      }
      return buildMutatedDraft(originalDraft, overrides);
    },
  };
}
