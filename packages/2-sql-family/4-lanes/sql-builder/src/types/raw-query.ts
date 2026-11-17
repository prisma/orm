import type { ExtractCodecTypes } from '@internal/sql-contract/types';
import type {
  Expression,
  NoReservedRowColumn,
  RawAffectedCountQuery,
  RawRowQuery,
  RawSqlBuilder,
  RawSqlInterpolation,
} from '@internal/sql-relational-core/expression';
import type { ResolveRow } from '../resolve';
import type { ScopeField } from '../scope';
import type { TableProxyContract } from './db';

/**
 * The output type a contract column reference carries, kept on a symbol key so
 * it cannot collide with a codec descriptor's own fields and never appears in
 * the value a caller writes.
 */
declare const columnOutput: unique symbol;

/**
 * A column of the contract, as a raw row spec reads it: the codec that decodes
 * it, whether it may be null, and the type the contract says it decodes to.
 *
 * The first two fields are the codec descriptor the target-agnostic raw
 * surface already accepts, so a reference is usable as a spec entry with no
 * translation.
 */
export interface ContractColumnRef<
  CodecId extends string = string,
  Nullable extends boolean = boolean,
  Output = unknown,
> {
  readonly codecId: CodecId;
  readonly nullable: Nullable;
  readonly [columnOutput]?: Output;
}

/**
 * One entry of a contract-bound row spec: a codec id the contract knows, that
 * id with nullability, or a column reference.
 *
 * The id members are keyed on the contract's codec map rather than `string`,
 * which is what makes an entry's literal survive inference — a `string` member
 * inside the record constraint widens `'pg/int8@1'` to `string`, and a widened
 * id resolves to `unknown`. Naming the map also means every id the contract
 * carries is offered at the call site. `ParamSpec` keys its declaration the
 * same way.
 */
export type ContractRawSpecEntry<CT extends Record<string, { readonly output: unknown }>> =
  | (keyof CT & string)
  | { readonly codecId: keyof CT & string; readonly nullable?: boolean }
  | ContractColumnRef;

/**
 * A contract-bound row spec: result-column name to the codec that decodes it.
 * It inherits the target-agnostic spec's one reserved name, so `db.raw` refuses
 * a `__proto__` column exactly where the contract-free tag does.
 */
export type ContractRawRowSpec<CT extends Record<string, { readonly output: unknown }>> = Readonly<
  Record<string, ContractRawSpecEntry<CT>>
> &
  NoReservedRowColumn;

type EntryScopeField<Entry> = Entry extends string
  ? { codecId: Entry; nullable: false }
  : Entry extends { readonly codecId: infer Id extends string; readonly nullable?: infer N }
    ? { codecId: Id; nullable: [N] extends [true] ? true : false }
    : never;

type SpecScopeFields<
  Spec extends ContractRawRowSpec<CT>,
  CT extends Record<string, { readonly output: unknown }>,
> = {
  [K in keyof Spec]: EntryScopeField<Spec[K]> extends infer F extends ScopeField ? F : never;
};

/**
 * The entries whose type the contract already resolved — column references.
 * Everything else resolves from its codec id through the codec-type map, the
 * same route the query builders take.
 */
type SpecPreResolved<
  Spec extends ContractRawRowSpec<CT>,
  CT extends Record<string, { readonly output: unknown }>,
> = {
  [K in keyof Spec as typeof columnOutput extends keyof Spec[K] ? K : never]: NonNullable<
    Spec[K][typeof columnOutput & keyof Spec[K]]
  >;
};

/** The row a spec declares, resolved against the contract's codec types. */
export type RawRowFor<
  Spec extends ContractRawRowSpec<CodecTypes>,
  CodecTypes extends Record<string, { readonly output: unknown }>,
> = ResolveRow<SpecScopeFields<Spec, CodecTypes>, CodecTypes, SpecPreResolved<Spec, CodecTypes>>;

/**
 * What a row-spec'd statement publishes as `.returns`. Each declared key gets
 * one column reference. The reference carries the codec id and nullability the
 * entry stated, plus the type the row resolves for that key.
 *
 * A column reference keeps nullability in its own field rather than in the
 * type it carries. These references do the same, so a ref fed back into a row
 * spec resolves the type it came from, whichever form the inner entry took.
 */
export type ContractRawRefs<
  Spec extends ContractRawRowSpec<CodecTypes>,
  CodecTypes extends Record<string, { readonly output: unknown }>,
> = {
  readonly [K in keyof Spec]: ContractColumnRef<
    EntryScopeField<Spec[K]>['codecId'],
    EntryScopeField<Spec[K]>['nullable'],
    NonNullable<RawRowFor<Spec, CodecTypes>[K]>
  >;
};

/**
 * A raw template bound to the contract: the same builder the target-agnostic
 * surface returns, with terminators that resolve their row type from the spec.
 */
export interface ContractRawBuilder<CodecTypes extends Record<string, { readonly output: unknown }>>
  extends RawSqlBuilder {
  /**
   * The expression terminator, narrowed to the contract's codec ids. The
   * target-agnostic tag takes any string, because the contract-free lane has
   * no map to key against; a contract-bound fragment does, so the ids it can
   * name are the ones the contract carries — and naming them makes them
   * complete at the call site.
   */
  returns<S extends keyof CodecTypes & string>(
    spec: S,
  ): Expression<{ codecId: S; nullable: false }>;
  returns<S extends keyof CodecTypes & string, N extends boolean = false>(spec: {
    readonly codecId: S;
    readonly nullable?: N;
  }): Expression<{ codecId: S; nullable: N }>;

  returnsRow<Spec extends ContractRawRowSpec<CodecTypes>>(
    spec: Spec,
  ): RawRowQuery<RawRowFor<Spec, CodecTypes>, ContractRawRefs<Spec, CodecTypes>>;
  affectedCount(): RawAffectedCountQuery;
}

/** The contract-bound raw tag, as `db.raw.sql` exposes it. */
export type ContractRawTag<CodecTypes extends Record<string, { readonly output: unknown }>> = (
  strings: TemplateStringsArray,
  ...values: RawSqlInterpolation[]
) => ContractRawBuilder<CodecTypes>;

/** The raw tag for a contract, with its codec-type map already applied. */
export type RawTagFor<C extends TableProxyContract> = ContractRawTag<ExtractCodecTypes<C>>;

/**
 * The raw lane, addressed as `db.raw`. It holds the whole-query statement tag
 * under `sql`.
 *
 * Editors key their SQL highlighting on that name, and a raw plan's
 * `lane: 'raw'` already uses it.
 *
 * The lane is one key wide on purpose. Anything else raw authoring needs can
 * join it later, without moving the address again.
 */
export type RawLane<C extends TableProxyContract> = {
  readonly sql: RawTagFor<C>;
};
