/**
 * `column()` packager + `ColumnSpec<R, P>` shape + `ColumnHelperFor<D>` variants for tying per-codec column helpers to their descriptor.
 *
 * `ColumnSpec<R, P>` extends {@link ColumnTypeDescriptor} so it remains a drop-in for contract authoring sites that consume `ColumnTypeDescriptor` shapes — both types live at the framework-components layer so the `extends` clause is real (no structural mirror).
 *
 * `column()` is a trivial, non-polymorphic packager. Generic over `R` (the codec instance type returned by the descriptor's curried factory) and `P` (the typeParams record). The framework does NOT try to infer `R` and `P` from a descriptor — that path is the variance trap. Per-codec helpers absorb the descriptor relationship instead and tie themselves to their descriptor via `satisfies ColumnHelperFor<D>` or `satisfies ColumnHelperForStrict<D>`.
 */

import type { ValueSetRef } from '@internal/contract/types';
import type { CodecDescriptorTemplate } from './codec-descriptor';
import type { CodecInstanceContext } from './codec-types';

/**
 * Authored column-type descriptor — the data shape an authoring site (PSL or TypeScript builders) attaches to a column to identify its codec and its native database type.
 *
 * Lives at the framework-components layer alongside the codec types so codec-author packages (e.g. column-spec / `column()` packagers) can extend it directly without crossing layer boundaries.
 *
 * @template TCodecId Narrowed codec id literal for sites that thread a specific codec id through the type system.
 */
export type ColumnTypeDescriptor<TCodecId extends string = string> = {
  readonly codecId: TCodecId;
  readonly nativeType: string;
  readonly typeParams?: Record<string, unknown> | undefined;
  readonly typeRef?: string;
  /**
   * Storage-plane value-set ref, set by an authoring path that resolves a
   * field's type against a value-set-deriving entity (e.g. a PSL entity-ref
   * type constructor like `pg.enum(Ref)`, or a TS `enumType` handle).
   * Threaded straight onto the storage node this descriptor builds, where it
   * drives value-set → codec typing. Every codec's own descriptor leaves this
   * unset.
   */
  readonly valueSet?: ValueSetRef;
  readonly entityRef?: EntityRef;
};

/**
 * Late-resolved pack-entity reference — a field on the type descriptor it is
 * declared on: `entityKind`/`entityName` identify a pack entity whose final
 * placement depends on data not yet known when the descriptor carrying this
 * reference is built — e.g. an owning namespace resolved only once the
 * surrounding structure is assembled.
 */
export type EntityRef = {
  readonly entityKind: string;
  readonly entityName: string;
  readonly entity: unknown;
};

/**
 * Column spec carrying the codec factory closure alongside the {@link ColumnTypeDescriptor} fields. Codec authors return a `ColumnSpec` from per-codec column helpers; the runtime materializes the codec instance by calling `codecFactory(ctx)` once it knows the column's `CodecInstanceContext`.
 *
 * Extends {@link ColumnTypeDescriptor} so `ColumnSpec` instances flow directly into contract-authoring sites that consume the descriptor shape — no structural mirroring required.
 */
export interface ColumnSpec<R, P extends Record<string, unknown> | undefined>
  extends ColumnTypeDescriptor {
  readonly codecFactory: (ctx: CodecInstanceContext) => R;
  readonly typeParams: P;
}

/**
 * Trivial column packager. Per-codec helpers call this directly with the result of `descriptor.factory(params)` — direct method invocation binds the descriptor's method-level generic at the call site and the literal flows through `R`.
 *
 * `nativeType` is the column's database-native type spelling — the value the postgres adapter's migration planner, the SQL renderer's cast policy, and the emitted contract's column `nativeType` slot read. Per-codec helpers pass the literal native-type string for their codec (e.g. `'text'`, `'int4'`, `'character varying'`); for codecs whose native-type spelling depends on parameters (none today; reserved for future shapes), the helper computes the rendered string before calling `column`. The framework does not derive the value from `codecId` — that mapping is target-specific and lives at the helper.
 */
export function column<R, P extends Record<string, unknown> | undefined>(
  codecFactory: (ctx: CodecInstanceContext) => R,
  codecId: string,
  typeParams: P,
  nativeType: string,
): ColumnSpec<R, P> {
  return {
    codecFactory,
    codecId,
    typeParams,
    nativeType,
  };
}

/**
 * Coarse `satisfies` shape — checks the helper's typeParams record matches the descriptor's factory params. Catches "wrong typeParams shape" wiring mistakes; does NOT catch "wrong descriptor's factory" mistakes (the codec slot is left as `unknown`).
 *
 * Use when the codec's `ReturnType<factory>` is unstable (e.g. heavily overloaded factories where extraction widens too much).
 */
// biome-ignore lint/suspicious/noExplicitAny: variance erasure — `CodecDescriptorTemplate<P>` is invariant in P, so concrete subclasses do not extend `CodecDescriptor<unknown>`; matches the existing `AnyCodecDescriptor` pattern
export type ColumnHelperFor<D extends CodecDescriptorTemplate<any>> = (
  // biome-ignore lint/suspicious/noExplicitAny: helper signature is the verification subject; satisfies clauses can't narrow this without circular inference
  ...args: any[]
) => ColumnSpec<unknown, ColumnHelperParams<D>>;

/**
 * Strict `satisfies` shape — also checks the helper's codec is at least the *base* codec instance type the descriptor's factory returns. `ReturnType<ReturnType<D['factory']>>` widens method generics to their constraint, so this only sanity-checks the wiring at the base type level. Literal preservation comes from the direct `descriptor.factory(...)` call inside the helper, not from `satisfies`.
 */
// biome-ignore lint/suspicious/noExplicitAny: variance erasure — `CodecDescriptorTemplate<P>` is invariant in P, so concrete subclasses do not extend `CodecDescriptor<unknown>`; matches the existing `AnyCodecDescriptor` pattern
export type ColumnHelperForStrict<D extends CodecDescriptorTemplate<any>> = (
  // biome-ignore lint/suspicious/noExplicitAny: helper signature is the verification subject; satisfies clauses can't narrow this without circular inference
  ...args: any[]
) => ColumnSpec<ReturnType<ReturnType<D['factory']>>, ColumnHelperParams<D>>;

/**
 * Coerce a descriptor's `factory` first parameter into the typeParams shape `ColumnSpec` accepts. Non-parameterized descriptors (factory with no params, or `params: void`) collapse to `undefined`; parameterized descriptors keep the params record shape.
 */
// biome-ignore lint/suspicious/noExplicitAny: variance erasure — see above
type ColumnHelperParams<D extends CodecDescriptorTemplate<any>> =
  Parameters<D['factory']>[0] extends Record<string, unknown>
    ? Parameters<D['factory']>[0]
    : undefined;
