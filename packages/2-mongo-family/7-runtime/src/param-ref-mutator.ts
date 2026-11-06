import type { ParamRefMutator } from '@internal/framework-components/runtime';
import type { MongoLoweredDraft } from '@internal/mongo-lowering';
import { MongoParamRef } from '@internal/mongo-value';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { flattenMongoDraftLeaves, mapMongoDraftLeaves } from './draft-leaves';

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
 * Mongo-family mutator threaded into `MongoMiddleware.beforeEncode` as
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
 * The runtime calls this after the `beforeEncode` chain; the result is the
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

/**
 * Yields every `MongoParamRef` in a draft, at any depth, once per position. Placeholders (`MongoPreparedParamRef`) are skipped. The walk is {@link flattenMongoDraftLeaves}, which visits raw drafts too and matches `resolveDraftSlot`, so middleware sees every parameter the resolve pass will encode.
 */
export function* flattenMongoParamRefs(draft: MongoLoweredDraft): Generator<MongoParamRef> {
  for (const leaf of flattenMongoDraftLeaves(draft)) {
    if (leaf instanceof MongoParamRef) {
      yield leaf;
    }
  }
}

function buildMutatedDraft(
  draft: MongoLoweredDraft,
  overrides: ReadonlyMap<MongoParamRef, unknown>,
): MongoLoweredDraft {
  return mapMongoDraftLeaves(draft, (leaf) =>
    leaf instanceof MongoParamRef && overrides.has(leaf)
      ? new MongoParamRef(overrides.get(leaf), {
          ...ifDefined('name', leaf.name),
          ...ifDefined('codecId', leaf.codecId),
          ...ifDefined('collection', leaf.collection),
          ...ifDefined('nullable', leaf.nullable),
        })
      : leaf,
  );
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
