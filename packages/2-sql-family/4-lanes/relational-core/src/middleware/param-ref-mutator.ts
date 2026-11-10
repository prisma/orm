import type { ParamRefMutator } from '@internal/framework-components/runtime';
import type { AnyParamRef } from '../ast/types';
import { collectOrderedParamRefs } from '../ast/util';
import type { SqlExecutionPlan } from '../sql-execution-plan';

/**
 * Brand applied to {@link ParamRefHandle} so user-constructed handles
 * are rejected by the type system. The mutator only accepts handles it
 * produced from `entries()`.
 *
 * The brand is a phantom type — there is no runtime token. At runtime
 * the handle is the underlying `ParamRef` instance from the plan's
 * `ast`; the brand only narrows the type-level surface so callers
 * cannot fabricate a handle from a fresh `ParamRef.of(...)`.
 */
declare const paramRefHandleBrand: unique symbol;

/**
 * Opaque token identifying a single `ParamRef` in the plan. Produced by
 * {@link SqlParamRefMutator.entries}; consumed by `replaceValue` /
 * `replaceValues`.
 *
 * The phantom `TCodecId` parameter records the codec id of the
 * referenced `ParamRef` so type-level inference can route replacement
 * values through `TCodecMap` to the codec's declared `TInput`.
 */
export interface ParamRefHandle<TCodecId extends string | undefined = string | undefined> {
  readonly [paramRefHandleBrand]: TCodecId;
}

/**
 * One outbound `ParamRef` slot in the plan exposed to middleware.
 * `value` is the current value (post any prior middleware mutations);
 * `codecId` is the codec id declared on the underlying `ParamRef.codec`.
 */
export interface ParamRefEntry<TCodecId extends string | undefined = string | undefined> {
  readonly ref: ParamRefHandle<TCodecId>;
  readonly value: unknown;
  readonly codecId: TCodecId;
}

/**
 * Discriminated entry union over a codec map. For each `K` in
 * `TCodecMap`, `entries()` may yield a `ParamRefEntry<K>`; ParamRefs
 * with no codec id (or a codec id outside the map) yield a
 * `ParamRefEntry<undefined>`. Pattern-matching on `entry.codecId`
 * narrows `entry.ref` to a `ParamRefHandle<K>`, which routes through
 * the typed `replaceValue` overload.
 */
export type ParamRefEntryUnion<TCodecMap extends Record<string, unknown>> =
  | { [K in keyof TCodecMap & string]: ParamRefEntry<K> }[keyof TCodecMap & string]
  | ParamRefEntry<undefined>;

/**
 * SQL-family mutator threaded into `SqlMiddleware.beforeEncode` as
 * `params`. Scope is `ParamRef.value` slots only — middleware cannot
 * insert / remove `ParamRef`s, rewrite SQL, or modify projection. The
 * type-level `ParamRefHandle` brand and the `replaceValue(ref,
 * newValue)` shape enforce this at compile time.
 *
 * `entries()` surfaces both literal call-site `ParamRef` slots and
 * `prepare()`-time `PreparedParamRef` bind slots; the handle and codec
 * id work the same for both.
 *
 * Allocation discipline: the mutator is constructed lazily from the
 * plan. `entries()` walks the plan's existing AST without allocating
 * an intermediate array; the working params buffer is only allocated
 * on the first `replaceValue` / `replaceValues` call. If no middleware
 * mutates, `currentParams()` returns the plan's original `params` by
 * reference identity.
 *
 * The `TCodecMap` parameter is a record keyed by codec id; `replaceValue`
 * infers `newValue` from `TCodecMap[H['codecId']]` for handles whose
 * codec id is statically resolvable. For codec ids the type system
 * cannot resolve, `newValue` falls back to `unknown` and the middleware
 * is on the hook for runtime correctness.
 */
export interface SqlParamRefMutator<
  TCodecMap extends Record<string, unknown> = Record<string, unknown>,
> extends ParamRefMutator {
  /** Iterate every outbound `ParamRef` the plan currently carries, in canonical order. */
  entries(): IterableIterator<ParamRefEntryUnion<TCodecMap>>;

  /**
   * Replace one `ParamRef`'s value with the result of bulk processing.
   * `newValue` is constrained to the codec's declared `TInput` for codec
   * ids the type system can resolve via `TCodecMap`; for unresolvable
   * codec ids `newValue` is `unknown` (the second overload).
   */
  replaceValue<TCodecId extends keyof TCodecMap & string>(
    ref: ParamRefHandle<TCodecId>,
    newValue: TCodecMap[TCodecId],
  ): void;
  replaceValue(ref: ParamRefHandle<undefined>, newValue: unknown): void;

  /** Replace many at once (typical for bulk-pattern middleware). */
  replaceValues(
    updates: Iterable<{
      readonly ref: ParamRefHandle<(keyof TCodecMap & string) | undefined>;
      readonly newValue: unknown;
    }>,
  ): void;
}

/**
 * Internal-only view of the mutator that exposes the post-mutation params
 * array to the SQL runtime. The runtime calls `currentParams()` after the
 * `beforeEncode` chain has run; the result is the plan's original
 * `params` by reference identity if no middleware mutated, otherwise a
 * frozen new array carrying the mutations applied in chain order.
 *
 * Family-internal contract — `SqlMiddleware` consumers never see this
 * shape; they receive the public `SqlParamRefMutator` view above.
 */
export interface SqlParamRefMutatorInternal<
  TCodecMap extends Record<string, unknown> = Record<string, unknown>,
> extends SqlParamRefMutator<TCodecMap> {
  currentParams(): readonly unknown[];
}

type AnyHandle = ParamRefHandle<string | undefined>;

/**
 * Build a {@link SqlParamRefMutatorInternal} for the given lowered plan.
 *
 * The mutator captures `plan.params` by reference and walks
 * `plan.ast` (via `collectOrderedParamRefs`) on demand to build
 * entries. Mutations write to a lazily-allocated working copy so the
 * fast path (no mutation) preserves bit-for-bit reference identity to
 * the original `plan.params`.
 *
 * Threading: `plan.ast` carries the canonical `ParamRef` ordering used
 * by every consumer (renderer's `$N` index map, encode-side metadata
 * walk, etc.). The mutator's `entries()` yields the same order so
 * middleware that filters by codec id sees ParamRefs in the order the
 * runtime will encode them.
 */
export function createSqlParamRefMutator<
  TCodecMap extends Record<string, unknown> = Record<string, unknown>,
>(plan: SqlExecutionPlan): SqlParamRefMutatorInternal<TCodecMap> {
  const originalParams = plan.params;
  const refs: ReadonlyArray<AnyParamRef> = plan.ast ? collectOrderedParamRefs(plan.ast) : [];
  let workingParams: unknown[] | undefined;

  const indexOfRef = (handle: AnyHandle): number => {
    // The handle is the underlying ParamRef instance the mutator yielded
    // from entries(); equality is identity equality on the ParamRef. The
    // brand on ParamRefHandle is unforgeable from outside, so the only
    // legal handles came from this mutator's entries().
    return refs.indexOf(handle as unknown as AnyParamRef);
  };

  const ensureWorkingParams = (): unknown[] => {
    if (!workingParams) {
      workingParams = [...originalParams];
    }
    return workingParams;
  };

  const writeAt = (index: number, value: unknown): void => {
    const buffer = ensureWorkingParams();
    buffer[index] = value;
  };

  function* entries(): IterableIterator<ParamRefEntryUnion<TCodecMap>> {
    const view = workingParams ?? originalParams;
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      if (!ref) continue;
      const handle = ref as unknown as ParamRefHandle<string | undefined>;
      let value: unknown;
      let codecId: string | undefined;
      if (ref.kind === 'param-ref') {
        value = i < view.length ? view[i] : ref.value;
        codecId = ref.codec?.codecId;
      } else {
        // PreparedParamRef positions carry no AST-side fallback value —
        // the slot value at index `i` is the only source.
        value = i < view.length ? view[i] : undefined;
        codecId = ref.codec.codecId;
      }
      // The runtime erases the discriminated union to a single shape; the
      // public type pins each entry's `ref` to the matching `codecId`
      // arm at compile time.
      const entry: ParamRefEntry<string | undefined> = { ref: handle, value, codecId };
      yield entry as ParamRefEntryUnion<TCodecMap>;
    }
  }

  function replaceValue(handle: AnyHandle, newValue: unknown): void {
    const index = indexOfRef(handle);
    if (index < 0) {
      // Handle does not belong to this plan. The type system pins this
      // at the brand level; this runtime check guards against handles
      // smuggled across plans.
      return;
    }
    writeAt(index, newValue);
  }

  function replaceValues(
    updates: Iterable<{ readonly ref: AnyHandle; readonly newValue: unknown }>,
  ): void {
    for (const { ref, newValue } of updates) {
      const index = indexOfRef(ref);
      if (index < 0) continue;
      writeAt(index, newValue);
    }
  }

  // The public `SqlParamRefMutator` declares overloaded `replaceValue`
  // signatures (typed-by-codec / unresolvable-codec). The implementation
  // is one function with a permissive runtime signature; the cast is the
  // single point at which the runtime function meets the typed overload
  // surface, matching the overload-implementation pattern.
  return {
    entries,
    replaceValue: replaceValue as SqlParamRefMutator<TCodecMap>['replaceValue'],
    replaceValues,
    currentParams(): readonly unknown[] {
      if (!workingParams) {
        return originalParams;
      }
      return Object.freeze([...workingParams]);
    },
  };
}
