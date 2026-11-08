import type { ExtractCodecTypes } from '@internal/sql-contract/types';
import type { CodecRef } from '@internal/sql-relational-core/ast';
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
  readonly [columnOutput]?: { readonly output: Output };
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
  | {
      readonly codecId: keyof CT & string;
      readonly nullable?: boolean;
      readonly codec?: CodecRef;
    }
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

/** Distribute over codec bindings before combining their possible shapes. */
type BindingHasArray<Binding> = Binding extends { readonly many?: infer Many }
  ? true extends Many
    ? true
    : false
  : false;

/** Whether any complete runtime codec binding can describe an array. */
type HasArrayCodec<Entry> = Entry extends { readonly codec?: infer Binding }
  ? true extends BindingHasArray<NonNullable<Binding>>
    ? true
    : false
  : false;

/** A union needs pre-resolution when any member carries richer output. */
type NeedsPreResolved<Entry> = Entry extends unknown
  ? typeof columnOutput extends keyof Entry
    ? true
    : HasArrayCodec<Entry>
  : never;

/**
 * Standalone descriptors have no storage-column element constraint. Their
 * complete binding controls scalar versus array output. Distributing over
 * entries also retains a string codec-id member in a mixed spec union.
 */
type StandaloneEntryOutput<
  Entry,
  CT extends Record<string, { readonly output: unknown }>,
> = Entry extends keyof CT
  ? CT[Entry]['output']
  : Entry extends { readonly codecId: infer Id extends keyof CT }
    ? HasArrayCodec<Entry> extends true
      ? Entry extends { readonly codec: { readonly many: true } }
        ? readonly (CT[Id]['output'] | null)[]
        : CT[Id]['output'] | readonly (CT[Id]['output'] | null)[]
      : CT[Id]['output']
    : never;

/**
 * Resolve each union member independently so a generated column keeps its
 * precise output and a nullable alternative keeps its SQL NULL possibility.
 * The ordinary non-pre-resolved scalar route remains unchanged.
 */
type PreResolvedEntryOutput<
  Entry,
  CT extends Record<string, { readonly output: unknown }>,
> = Entry extends unknown
  ? typeof columnOutput extends keyof Entry
    ? NonNullable<Entry[typeof columnOutput & keyof Entry]> extends {
        readonly output: infer Output;
      }
      ? Output
      : never
    : 'nullable' extends keyof Entry
      ? true extends Entry['nullable' & keyof Entry]
        ? StandaloneEntryOutput<Entry, CT> | null
        : StandaloneEntryOutput<Entry, CT>
      : StandaloneEntryOutput<Entry, CT>
  : never;

/**
 * Column references retain their precise generated output. Standalone array
 * descriptors resolve through their actual complete codec binding instead
 * of borrowing another table's column. Ordinary scalar entries keep the
 * existing codec-id route through ResolveRow.
 */
type SpecPreResolved<
  Spec extends ContractRawRowSpec<CT>,
  CT extends Record<string, { readonly output: unknown }>,
> = {
  [K in keyof Spec as true extends NeedsPreResolved<Spec[K]> ? K : never]: PreResolvedEntryOutput<
    Spec[K],
    CT
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
 * A column reference carries its full output type and separately records SQL
 * nullability. Keep the payload intact: JSON null can be a value even when
 * SQL NULL is disallowed. A round trip preserves both parts of that contract.
 */
export type ContractRawRefs<
  Spec extends ContractRawRowSpec<CodecTypes>,
  CodecTypes extends Record<string, { readonly output: unknown }>,
> = {
  readonly [K in keyof Spec]: ContractColumnRef<
    EntryScopeField<Spec[K]>['codecId'],
    EntryScopeField<Spec[K]>['nullable'],
    RawRowFor<Spec, CodecTypes>[K]
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
