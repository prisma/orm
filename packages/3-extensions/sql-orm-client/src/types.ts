import type { Contract } from '@internal/contract/types';
import type {
  ExtractAggregateTypes,
  ExtractCodecTypes,
  ExtractFieldInputTypes,
  ExtractFieldOutputTypes,
  ExtractQueryOperationTypes,
  HasExecutionCreateDefault,
  IsOptionalCreateColumn,
  QueryOperationTypesBase,
  SqlStorage,
  StorageColumn,
} from '@internal/sql-contract/types';
import {
  type AnyExpression,
  type BinaryOp,
  type CodecRef,
  type CodecTrait,
  type LimitOffsetValue,
  ListExpression,
  type LockingClause,
  NullCheckExpr,
  type OrderByItem,
  type OrderByNulls,
  ParamRef,
  type AggregateFn as SqlAggregateFn,
  type WhereArg,
} from '@internal/sql-relational-core/ast';
import type {
  CodecExpression,
  Expression,
  RawSqlInterpolation,
} from '@internal/sql-relational-core/expression';
import type { BooleanCodecType, BuiltinFunctions } from '@internal/sql-relational-core/functions';
import type {
  IndexReference,
  TableIndexReferences,
} from '@internal/sql-relational-core/index-reference';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import type { ComputeColumnJsType, RuntimeScope } from '@internal/sql-relational-core/types';
import type { ActivitySourceTarget } from '@internal/sql-runtime';
import type { CollectionTables } from './collection-tables';
import type { HasRow } from './collection-types';
import { checkedOrderByItem } from './order-by-guards';
import { predicateComparison } from './predicate-comparison';
import { predicateExpression } from './predicate-expression';
import type { AliasedTable } from './table-scope';

export interface IncludeScalar<Result> extends HasRow<Result> {
  readonly kind: 'includeScalar';
  /** An operation name from the contract's emitted aggregate map — an open vocabulary. */
  readonly fn: string;
  readonly column?: string;
  readonly state: CollectionState;
}

export interface IncludeRowsBranch {
  readonly kind: 'rows';
  readonly state: CollectionState;
}

export interface IncludeScalarBranch {
  readonly kind: 'scalar';
  readonly selector: IncludeScalar<unknown>;
}

export type IncludeCombineBranch = IncludeRowsBranch | IncludeScalarBranch;

export interface IncludeCombine<ResultShape extends Record<string, unknown>>
  extends HasRow<ResultShape> {
  readonly kind: 'includeCombine';
  readonly branches: Readonly<Record<string, IncludeCombineBranch>>;
}

export interface IncludeThroughDescriptor {
  readonly table: string;
  /** Namespace the junction table lives in, as declared in the contract. */
  readonly namespaceId: string;
  /** FK columns in the junction table that point to the parent. */
  readonly parentColumns: readonly string[];
  /** FK columns in the junction table that point to the target (child). */
  readonly childColumns: readonly string[];
  /** PK columns in the target table that the junction's childColumns reference. */
  readonly targetColumns: readonly string[];
  /** Resolved column names in the parent table that junction.parentColumns reference. */
  readonly parentLocalColumns: readonly string[];
}

export interface IncludeExpr {
  readonly relationName: string;
  readonly relatedModelName: string;
  readonly relatedNamespaceId: string;
  readonly relatedTableName: string;
  readonly localVariantValue?: string;
  /** Target-side join columns, positionally paired with `localColumns`. */
  readonly targetColumns: readonly string[];
  /** Local-side join columns, positionally paired with `targetColumns`. */
  readonly localColumns: readonly string[];
  readonly cardinality: RelationCardinalityTag | undefined;
  readonly through?: IncludeThroughDescriptor;
  readonly junction?: AliasedTable;
  readonly nested: CollectionState;
  readonly scalar: IncludeScalar<unknown> | undefined;
  readonly combine: Readonly<Record<string, IncludeCombineBranch>> | undefined;
}

export interface CollectionState {
  readonly tables: CollectionTables;
  readonly filters: readonly AnyExpression[];
  readonly includes: readonly IncludeExpr[];
  readonly orderBy: readonly OrderByItem[] | undefined;
  readonly cursor: Readonly<Record<string, unknown>> | undefined;
  readonly distinct: readonly string[] | undefined;
  readonly distinctOn: readonly string[] | undefined;
  readonly selectedFields: readonly string[] | undefined;
  readonly limit: LimitOffsetValue | undefined;
  readonly offset: LimitOffsetValue | undefined;
  readonly variantValue: string | undefined;
  readonly locking: ReadonlyArray<LockingClause> | undefined;
}

export function emptyState(tables: CollectionTables): CollectionState {
  return {
    tables,
    filters: [],
    includes: [],
    orderBy: undefined,
    cursor: undefined,
    distinct: undefined,
    distinctOn: undefined,
    selectedFields: undefined,
    limit: undefined,
    offset: undefined,
    variantValue: undefined,
    locking: undefined,
  };
}

/**
 * `GroupedCollection`'s own post-group chain — orders/pages the grouped rows
 * themselves. Kept separate from {@link CollectionState}: pre-group and
 * post-group clauses are different clauses at different levels, and merging
 * them into one state is the defect this shape exists to prevent.
 */
export interface GroupPagingState {
  readonly orderBy: readonly OrderByItem[];
  readonly limit: LimitOffsetValue | undefined;
  readonly offset: LimitOffsetValue | undefined;
}

export function emptyGroupPagingState(): GroupPagingState {
  return { orderBy: [], limit: undefined, offset: undefined };
}

export interface CollectionTypeState {
  readonly hasOrderBy: boolean;
  readonly hasWhere: boolean;
  readonly variantValue: string | undefined;
  /**
   * The namespace coordinate this collection resolves at — set by the
   * `orm.<ns>.<Model>` facet so the create/update/where input types (and the
   * read row) resolve the model's fields within its namespace. `never` for a
   * directly-constructed collection (resolution falls back to the model's own
   * `storage.namespaceId`). Carried in the type state so it survives chaining
   * (`.where(...)`, `.variant(...)`, …) automatically.
   */
  readonly nsId: string;
}

export type RelationCardinalityTag = '1:1' | 'N:1' | '1:N' | 'N:M';

export type DefaultCollectionTypeState = {
  readonly hasOrderBy: boolean;
  readonly hasWhere: boolean;
  readonly variantValue: undefined;
  readonly nsId: never;
};

export type WithNsId<State extends CollectionTypeState, NsId extends string> = Omit<
  State,
  'nsId'
> & { readonly nsId: NsId };

export interface RuntimeConnection extends RuntimeScope {
  release?(): Promise<void>;
  transaction?(): Promise<RuntimeTransaction>;
}

export interface RuntimeTransaction extends RuntimeScope {
  commit?(): Promise<void>;
  rollback?(): Promise<void>;
}

/** What the ORM sends its statements to. It must carry an `activitySource` member, as the SQL runtime's queryables, connections, transactions and activity handles do: every terminal method starts an `orm-call` activity through it, and a terminal method on a queryable without one fails with `ORM.ACTIVITY_SOURCE_MISSING`. The member is optional in this type only because the public runtime types do not show it. */
export interface RuntimeQueryable extends RuntimeScope, Partial<ActivitySourceTarget> {
  connection?(): Promise<RuntimeConnection>;
  transaction?(): Promise<RuntimeTransaction>;
}

export interface CollectionContext<TContract extends Contract<SqlStorage>> {
  readonly runtime: RuntimeQueryable;
  readonly context: ExecutionContext<TContract>;
}

type PredicateOperand<T, CodecId extends string> =
  | T
  | Expression<{ codecId: CodecId; nullable: false; many?: never }>;

// Column handles carry comparison methods; prepared parameters do not, so they stay non-nullable.
type ColumnOperand<CodecId extends string> = Expression<{
  codecId: CodecId;
  nullable: boolean;
  many?: never;
}> &
  Pick<ComparisonMethodFns<never>, 'isNull'>;

export type ComparisonMethodFns<T, CodecId extends string = never> = {
  eq(value: T | Expression<{ codecId: CodecId; nullable: boolean; many?: never }>): AnyExpression;
  neq(value: T | Expression<{ codecId: CodecId; nullable: boolean; many?: never }>): AnyExpression;
  gt(value: T | ColumnOperand<CodecId>): AnyExpression;
  lt(value: T | ColumnOperand<CodecId>): AnyExpression;
  gte(value: T | ColumnOperand<CodecId>): AnyExpression;
  lte(value: T | ColumnOperand<CodecId>): AnyExpression;
  // LIKE takes a non-null string pattern, even when the field type T is nullable.
  like(pattern: PredicateOperand<string, CodecId>): AnyExpression;
  in(values: readonly T[]): AnyExpression;
  notIn(values: readonly T[]): AnyExpression;
  isNull(): AnyExpression;
  isNotNull(): AnyExpression;
  asc: Orderable['asc'];
  desc: Orderable['desc'];
};

export type OrderOptions = {
  readonly nulls?: OrderByNulls;
};

/** A value the collection can order by: `asc`/`desc`, optionally placing nulls first or last. */
export type Orderable = {
  asc(options?: OrderOptions): OrderByItem;
  desc(options?: OrderOptions): OrderByItem;
};

/**
 * Trait-gated comparison methods. Only methods whose required traits are all present in `Traits` are included.
 *
 * - `traits: []` → always available (isNull, isNotNull)
 */
export type ComparisonMethods<T, Traits, CodecId extends string = never> = {
  [K in keyof ComparisonMethodsMeta as [ComparisonMethodsMeta[K]['traits'][number]] extends [Traits]
    ? K
    : never]: ComparisonMethodFns<PredicateOperand<T, CodecId>, CodecId>[K];
};

type QueryOperationReturnTraits<
  Returns,
  TCodecTypes extends Record<string, unknown>,
> = Returns extends { readonly codecId: infer Id extends string }
  ? Id extends keyof TCodecTypes
    ? TCodecTypes[Id] extends { readonly traits: infer Traits }
      ? Traits
      : never
    : never
  : never;

type QueryOperationReturnJsType<
  Returns,
  TCodecTypes extends Record<string, unknown>,
> = Returns extends { readonly codecId: infer Id extends string; readonly nullable: infer N }
  ? Id extends keyof TCodecTypes
    ? TCodecTypes[Id] extends { readonly output: infer O }
      ? N extends true
        ? O | null
        : O
      : unknown
    : unknown
  : unknown;

type IsBooleanReturn<Returns, TCodecTypes extends Record<string, unknown>> = Returns extends {
  readonly codecId: infer Id extends string;
}
  ? Id extends keyof TCodecTypes
    ? TCodecTypes[Id] extends { readonly traits: infer T }
      ? 'boolean' extends T
        ? true
        : false
      : false
    : false
  : false;

/**
 * Extract the `{codecId, nullable}` spec carried inside an `Expression<T>`. Used to recover the op's return spec from its impl signature so the pre-existing `QueryOperationReturn*` helpers can consume it unchanged.
 */
type SpecOf<E> = E extends Expression<infer T> ? T : never;

type ImplReturnSpec<Impl> = Impl extends (...args: never[]) => infer Ret ? SpecOf<Ret> : never;

/**
 * Builds the ORM column-method signature for an operation.
 *
 * - User args: drops the impl's first parameter (the column is bound at access time) and forwards the rest unchanged. Each remaining arg keeps its authored `CodecExpression` / `TraitExpression` shape — so callers can pass a raw JS value, another column handle (which itself implements `Expression`), or `null` when nullable.
 * - Return: predicate ops (boolean-traited return) yield `AnyExpression`; non-predicate ops yield `ComparisonMethods<JsType, Traits>` of the return codec.
 */
type QueryOperationMethod<Op, TCodecTypes extends Record<string, unknown>> = Op extends {
  readonly impl: (...args: never[]) => unknown;
}
  ? Op['impl'] extends (first: never, ...rest: infer UserArgs extends readonly unknown[]) => unknown
    ? ImplReturnSpec<Op['impl']> extends infer Returns
      ? IsBooleanReturn<Returns, TCodecTypes> extends true
        ? (...args: UserArgs) => AnyExpression
        : (
            ...args: UserArgs
          ) => ComparisonMethods<
            QueryOperationReturnJsType<Returns, TCodecTypes>,
            QueryOperationReturnTraits<Returns, TCodecTypes>
          >
      : never
    : never
  : never;

/**
 * Tests whether an operation's `self` dispatch hint reaches a field with the given codec identity. Codec hints match by identity; trait hints match when every required trait is present in the field codec's trait set.
 */
type OpMatchesField<Op, CodecId extends string, CT extends Record<string, unknown>> = Op extends {
  readonly self: infer Self;
}
  ? Self extends { readonly codecId: CodecId }
    ? true
    : Self extends { readonly traits: infer RequiredTraits extends readonly string[] }
      ? CodecId extends keyof CT
        ? CT[CodecId] extends { readonly traits: infer FieldTraits }
          ? [RequiredTraits[number]] extends [FieldTraits]
            ? true
            : false
          : false
        : false
      : false
  : false;

type CodecOperations<TContract extends Contract<SqlStorage>, CodecId extends string> =
  ExtractQueryOperationTypes<TContract> extends infer AllOps
    ? {
        [OpName in keyof AllOps & string as OpMatchesField<
          AllOps[OpName],
          CodecId,
          ExtractCodecTypes<TContract>
        > extends true
          ? OpName
          : never]: QueryOperationMethod<AllOps[OpName], ExtractCodecTypes<TContract>>;
      }
    : unknown;

type FieldOperations<
  TContract extends Contract<SqlStorage>,
  NsId extends string,
  ModelName extends string,
  FieldName extends string,
> =
  FieldCodecId<TContract, ModelName, FieldName, NsId> extends infer CodecId extends string
    ? ExtractQueryOperationTypes<TContract> extends infer AllOps
      ? {
          [OpName in keyof AllOps & string as OpMatchesField<
            AllOps[OpName],
            CodecId,
            ExtractCodecTypes<TContract>
          > extends true
            ? OpName
            : never]: QueryOperationMethod<AllOps[OpName], ExtractCodecTypes<TContract>>;
        }
      : unknown
    : unknown;

type CodecTraits<
  TContract extends Contract<SqlStorage>,
  CodecId extends string,
> = CodecId extends keyof ExtractCodecTypes<TContract>
  ? ExtractCodecTypes<TContract>[CodecId] extends { readonly traits: infer T }
    ? T
    : never
  : never;

type CodecInput<
  TContract extends Contract<SqlStorage>,
  CodecId extends string,
> = CodecId extends keyof ExtractCodecTypes<TContract>
  ? ExtractCodecTypes<TContract>[CodecId] extends { readonly input: infer I }
    ? I
    : unknown
  : unknown;

/**
 * The model accessor's type for any field with the codec `CodecId` and the given nullability. A function of `{ deletedAt: CodecField<Contract, 'pg/timestamptz-temporal@1', true> }` is a `where` callback for every model with such a field. Values are checked against the codec's input type, as they are for a model's own fields.
 */
export type CodecField<
  TContract extends Contract<SqlStorage>,
  CodecId extends keyof ExtractCodecTypes<TContract> & string,
  Nullable extends boolean = false,
> = Expression<{ codecId: CodecId; nullable: Nullable }> &
  ComparisonMethods<
    CodecInput<TContract, CodecId> | (Nullable extends true ? null : never),
    CodecTraits<TContract, CodecId>,
    CodecId
  > &
  CodecOperations<TContract, CodecId>;

/** The model accessor's type for a list field whose elements have the codec `CodecId`, as a fragment for any model declares it with `.many()`, or with `.many({ elementsNullable: true })` when `ElementNullable` is `true`. */
export type CodecListField<
  TContract extends Contract<SqlStorage>,
  CodecId extends keyof ExtractCodecTypes<TContract> & string,
  Nullable extends boolean = false,
  ElementNullable extends boolean = false,
> = Expression<{ codecId: CodecId; nullable: Nullable }> &
  ComparisonMethods<
    | ReadonlyArray<CodecInput<TContract, CodecId> | (ElementNullable extends true ? null : never)>
    | (Nullable extends true ? null : never),
    CodecTraits<TContract, CodecId>,
    CodecId
  > &
  CodecOperations<TContract, CodecId>;

function param(codec: CodecRef | undefined, value: unknown): AnyExpression {
  const expression = predicateExpression(value);
  if (expression !== undefined) return expression;
  if (codec === undefined) return ParamRef.of(value);
  return ParamRef.of(value, { codec });
}

function paramList(codec: CodecRef | undefined, values: readonly unknown[]): ListExpression {
  return ListExpression.of(values.map((value) => param(codec, value)));
}

// never[] is intentional: factories have heterogeneous signatures (value: unknown, values: readonly unknown[], pattern: string, etc.) but are only called through the typed ComparisonMethodFns interface, never through this type directly.
type MethodFactory = (
  left: AnyExpression,
  codec: CodecRef | undefined,
) => (...args: never[]) => unknown;

type ComparisonMethodMeta = {
  readonly traits: readonly CodecTrait[];
  readonly create: MethodFactory;
};

function scalarComparisonMethod(op: BinaryOp) {
  return ((left, codec) => (value: unknown) => {
    if (value === null && (op === 'eq' || op === 'neq')) {
      return op === 'eq' ? NullCheckExpr.isNull(left) : NullCheckExpr.isNotNull(left);
    }
    return predicateComparison(op, left, param(codec, value));
  }) satisfies MethodFactory;
}

function listComparisonMethod(op: BinaryOp) {
  return ((left, codec) => (values: readonly unknown[]) =>
    predicateComparison(op, left, paramList(codec, values))) satisfies MethodFactory;
}

/**
 * Declares trait requirements and runtime factory for each comparison method.
 *
 * - `traits: []` means "no trait required" — always available
 * - Multi-trait: `traits: ['equality', 'order']` means BOTH traits are required
 */
export const COMPARISON_METHODS_META = {
  eq: {
    traits: ['equality'],
    create: scalarComparisonMethod('eq'),
  },
  neq: {
    traits: ['equality'],
    create: scalarComparisonMethod('neq'),
  },
  in: {
    traits: ['equality'],
    create: listComparisonMethod('in'),
  },
  notIn: {
    traits: ['equality'],
    create: listComparisonMethod('notIn'),
  },
  gt: {
    traits: ['order'],
    create: scalarComparisonMethod('gt'),
  },
  lt: {
    traits: ['order'],
    create: scalarComparisonMethod('lt'),
  },
  gte: {
    traits: ['order'],
    create: scalarComparisonMethod('gte'),
  },
  lte: {
    traits: ['order'],
    create: scalarComparisonMethod('lte'),
  },
  like: {
    traits: ['textual'],
    create: scalarComparisonMethod('like'),
  },
  asc: {
    traits: ['order'],
    create: (left) => (options?: OrderOptions) => checkedOrderByItem('asc', left, options),
  },
  desc: {
    traits: ['order'],
    create: (left) => (options?: OrderOptions) => checkedOrderByItem('desc', left, options),
  },
  isNull: {
    traits: [],
    create: (left) => () => NullCheckExpr.isNull(left),
  },
  isNotNull: {
    traits: [],
    create: (left) => () => NullCheckExpr.isNotNull(left),
  },
} as const satisfies Record<keyof ComparisonMethodFns<unknown>, ComparisonMethodMeta>;

type ComparisonMethodsMeta = typeof COMPARISON_METHODS_META;

type DomainNamespaceId<TContract extends Contract<SqlStorage>> =
  keyof TContract['domain']['namespaces'] & string;

export type RelationPredicate<
  TContract extends Contract<SqlStorage>,
  NsId extends DomainNamespaceId<TContract>,
  ModelName extends string,
> = (
  model: ModelAccessor<TContract, ModelName, NsId>,
  tools: ModelCallbackTools<TContract, ModelName, NsId>,
) => Condition;

export type RelationPredicateInput<
  TContract extends Contract<SqlStorage>,
  NsId extends DomainNamespaceId<TContract>,
  ModelName extends string,
> = RelationPredicate<TContract, NsId, ModelName> | Record<string, unknown>;

export type RelationFilterAccessor<
  TContract extends Contract<SqlStorage>,
  RelatedNsId extends DomainNamespaceId<TContract>,
  RelatedModelName extends string,
> = {
  some(predicate?: RelationPredicateInput<TContract, RelatedNsId, RelatedModelName>): AnyExpression;
  every(predicate: RelationPredicateInput<TContract, RelatedNsId, RelatedModelName>): AnyExpression;
  none(predicate?: RelationPredicateInput<TContract, RelatedNsId, RelatedModelName>): AnyExpression;
};

type RelationAccessorMethodName =
  | keyof RelationFilterAccessor<Contract<SqlStorage>, never, string>
  | 'count';

type IsOrderable<Traits> = ['order'] extends [Traits] ? true : false;

type OrderableFields<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string,
> = {
  [K in keyof FieldsOf<TContract, ModelName, NsId> & string as IsOrderable<
    FieldTraits<TContract, ModelName, K, NsId>
  > extends true
    ? K
    : never]: Orderable;
};

/** The fields of a model whose codec has the `order` trait. */
export type OrderableFieldNames<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = keyof OrderableFields<TContract, ModelName, NsId> & string;

/**
 * A to-one relation inside `where`/`orderBy`: the relation filters plus each orderable scalar field of the related model. A related field named like a relation method is not exposed.
 */
export type ToOneRelationAccessor<
  TContract extends Contract<SqlStorage>,
  RelatedNsId extends DomainNamespaceId<TContract>,
  RelatedModelName extends string,
> = RelationFilterAccessor<TContract, RelatedNsId, RelatedModelName> &
  Omit<OrderableFields<TContract, RelatedModelName, RelatedNsId>, RelationAccessorMethodName>;

/**
 * A to-many relation inside `where`/`orderBy`: the relation filters plus `count`, which orders by the number of related rows matching an optional predicate.
 */
export type ToManyRelationAccessor<
  TContract extends Contract<SqlStorage>,
  RelatedNsId extends DomainNamespaceId<TContract>,
  RelatedModelName extends string,
> = RelationFilterAccessor<TContract, RelatedNsId, RelatedModelName> & {
  count(predicate?: RelationPredicateInput<TContract, RelatedNsId, RelatedModelName>): Orderable;
};

type ScalarModelAccessor<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = {
  [K in keyof FieldsOf<TContract, ModelName, NsId> & string]: Expression<{
    codecId: FieldCodecId<TContract, ModelName, K, NsId>;
    nullable: FieldNullable<TContract, ModelName, K, NsId>;
  }> &
    ComparisonMethods<
      FieldInputJsType<TContract, ModelName, K, NsId>,
      FieldTraits<TContract, ModelName, K, NsId>,
      FieldCodecId<TContract, ModelName, K, NsId>
    > &
    FieldOperations<TContract, NsId, ModelName, K>;
};

type RelationModelAccessor<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = {
  [K in RelationNames<TContract, ModelName, NsId>]: RelationCardinality<
    TContract,
    ModelName,
    K,
    NsId
  > extends '1:1' | 'N:1'
    ? ToOneRelationAccessor<
        TContract,
        RelationTargetNamespace<TContract, ModelName, K, NsId>,
        RelatedModelName<TContract, ModelName, K, NsId> & string
      >
    : ToManyRelationAccessor<
        TContract,
        RelationTargetNamespace<TContract, ModelName, K, NsId>,
        RelatedModelName<TContract, ModelName, K, NsId> & string
      >;
};

export type ModelAccessor<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = ScalarModelAccessor<TContract, ModelName, NsId> &
  RelationModelAccessor<TContract, ModelName, NsId>;

/**
 * The predicate accessor for a collection narrowed to a variant. When a real
 * variant is selected its (possibly MTI) fields and relations are merged onto
 * the base accessor so `t.variant('feature').where(x => x.priority…)` and
 * `t.variant('feature').where(x => x.assignee.some(…))` type-check; with no
 * variant the accessor is the plain base `ModelAccessor` and is unchanged.
 */
export type VariantAwareModelAccessor<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  VariantValue extends string | undefined,
  NsId extends string = never,
> = [VariantValue] extends [string]
  ? VariantValue extends DiscriminatorValues<TContract, ModelName, NsId>
    ? ScalarModelAccessor<TContract, ModelName, NsId> &
        ScalarModelAccessor<
          TContract,
          VariantModelName<TContract, ModelName, VariantValue, NsId>,
          VariantModelNamespace<TContract, ModelName, VariantValue, NsId>
        > &
        RelationModelAccessor<TContract, ModelName, NsId> &
        RelationModelAccessor<
          TContract,
          VariantModelName<TContract, ModelName, VariantValue, NsId>,
          VariantModelNamespace<TContract, ModelName, VariantValue, NsId>
        >
    : ModelAccessor<TContract, ModelName, NsId>
  : ModelAccessor<TContract, ModelName, NsId>;

/** A condition from `fns`. */
export type FunctionCondition = Expression<BooleanCodecType>;

/** A condition: an ORM filter expression, or a condition from `fns`. */
export type Condition = AnyExpression | FunctionCondition;

/** What a `where` callback may return: a filter, or a condition from `fns`. */
export type WhereCallbackResult = WhereArg | FunctionCondition;

type IsBooleanCodec<
  CodecId,
  TCodecTypes extends Record<string, unknown>,
> = CodecId extends keyof TCodecTypes
  ? TCodecTypes[CodecId] extends { readonly traits: infer Traits }
    ? 'boolean' extends Traits
      ? true
      : false
    : false
  : false;

/** A function's result in the ORM: a value, as opposed to a condition, also has `asc()` and `desc()`. */
type OrmFunctionResult<R, TCodecTypes extends Record<string, unknown>> =
  R extends Expression<infer Field>
    ? IsBooleanCodec<Field['codecId'], TCodecTypes> extends true
      ? R
      : R & Orderable
    : R;

type SameSignature<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/**
 * An operation's implementation with each result as {@link OrmFunctionResult}. Matching four call signatures reads the last four overloads, and TypeScript repeats the signatures of an implementation with fewer; a single signature stays one. An implementation with five or more overloads loses all but its last four, and a generic signature keeps its parameters at their constraints.
 */
type OrmOperation<Impl, CT extends Record<string, unknown>> = Impl extends {
  (...args: infer A1): infer R1;
  (...args: infer A2): infer R2;
  (...args: infer A3): infer R3;
  (...args: infer A4): infer R4;
}
  ? SameSignature<[A1, R1] | [A2, R2] | [A3, R3], [A4, R4]> extends true
    ? (...args: A4) => OrmFunctionResult<R4, CT>
    : {
        (...args: A1): OrmFunctionResult<R1, CT>;
        (...args: A2): OrmFunctionResult<R2, CT>;
        (...args: A3): OrmFunctionResult<R3, CT>;
        (...args: A4): OrmFunctionResult<R4, CT>;
      }
  : Impl;

/** `fns.raw` in the ORM: its result also has `asc()` and `desc()`. */
export interface OrmRawSqlBuilder {
  returns<S extends string>(spec: S): Expression<{ codecId: S; nullable: false }> & Orderable;
  returns<S extends string, N extends boolean = false>(spec: {
    readonly codecId: S;
    readonly nullable?: N;
  }): Expression<{ codecId: S; nullable: N }> & Orderable;
}

export type OrmRawSqlTag = (
  strings: TemplateStringsArray,
  ...values: RawSqlInterpolation[]
) => OrmRawSqlBuilder;

/** `fns.and` and `fns.or` in the ORM: they also take ORM conditions, such as `p.title.ilike(...)`. */
export type OrmLogicalFunction<CT extends Record<string, { readonly input: unknown }>> = (
  ...conditions: (AnyExpression | CodecExpression<'pg/bool@1', boolean, CT>)[]
) => FunctionCondition;

/** The SQL query builder's functions over the given codec types and query operations, as the ORM's callbacks receive them. */
export type OrmFunctionsOf<
  CT extends Record<string, { readonly input: unknown }>,
  OT extends QueryOperationTypesBase,
> = Omit<BuiltinFunctions<CT>, 'raw' | 'and' | 'or'> & {
  readonly raw: OrmRawSqlTag;
  readonly and: OrmLogicalFunction<CT>;
  readonly or: OrmLogicalFunction<CT>;
} & {
  readonly [K in keyof OT]: OrmOperation<OT[K]['impl'], CT>;
};

/** The SQL query builder's functions for a contract, as the ORM's callbacks receive them. */
export type OrmFunctions<TContract extends Contract<SqlStorage>> = OrmFunctionsOf<
  ExtractCodecTypes<TContract>,
  ExtractQueryOperationTypes<TContract>
>;

/** The indexes of the table a model is stored in, keyed by the name the contract source gave each. */
export type ModelIndexReferences<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = string extends NsId
  ? Readonly<Record<string, IndexReference>>
  : TableIndexReferences<
      NamespaceTableDef<
        TContract,
        ModelTableName<TContract, ModelName, NsId> & string,
        ResolvedNsId<TContract, ModelName, NsId>
      >
    >;

/** One model as a collection method contribution reads it: the contract's target, the model's fields and relations, and its storage table. */
export type CollectionMethodModelTypeOf<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string,
> = {
  readonly target: TContract['target'];
  readonly name: ModelName;
  readonly fields: FieldsOf<TContract, ModelName, NsId>;
  readonly relations: ModelDef<TContract, ModelName, NsId> extends {
    readonly relations: infer Relations extends object;
  }
    ? Relations
    : Record<string, never>;
  readonly table: NamespaceTableDef<
    TContract,
    ModelTableName<TContract, ModelName, NsId> & string,
    ResolvedNsId<TContract, ModelName, NsId>
  >;
};

/** The second argument of a `where` or `orderBy` callback: the SQL query builder's functions, and the model's indexes. */
export interface ModelCallbackTools<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> {
  readonly fns: OrmFunctions<TContract>;
  readonly indexes: ModelIndexReferences<TContract, ModelName, NsId>;
}

/**
 * The flat default row of a single model: its own declared fields mapped to
 * their JS types, with no variant flattening. Use this when you want exactly
 * one model's fields (e.g. building the variant pieces, create/update inputs,
 * column-name maps).
 *
 * Contrast with {@link InferRootRow}, which is the *read-shape* of a root
 * collection: for a polymorphic base it discriminates over the variants and
 * flattens each variant's own `DefaultModelRow` onto the base. `InferRootRow`
 * is built from `DefaultModelRow`, not the other way around, so it can't be
 * re-expressed in terms of `InferRootRow`.
 */
export type DefaultModelRow<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = {
  [K in keyof FieldsOf<TContract, ModelName, NsId> & string]: FieldJsType<
    TContract,
    ModelName,
    K,
    NsId
  >;
};

/**
 * The values a filter, `create` or `update` accepts for each of a model's own fields. A field whose read type is refined by its type parameters, such as `Char<36>`, accepts its codec's input type, such as `string`.
 */
export type DefaultModelInputRow<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = {
  [K in keyof FieldsOf<TContract, ModelName, NsId> & string]: FieldInputJsType<
    TContract,
    ModelName,
    K,
    NsId
  >;
};

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type VariantRow<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> =
  ModelDef<TContract, ModelName, NsId> extends {
    readonly discriminator: { readonly field: infer DiscField extends string };
    readonly variants: infer V;
  }
    ? V extends Record<string, { readonly model: string }>
      ? {
          [Value in keyof V & string]: V[Value]['model'] extends infer VK extends string &
            CollectionModelName<TContract>
            ? Simplify<
                Omit<DefaultModelRow<TContract, ModelName, NsId>, DiscField> &
                  DefaultModelRow<
                    TContract,
                    VK,
                    VariantModelNamespace<TContract, ModelName, Value, NsId>
                  > &
                  Record<DiscField, Value>
              >
            : never;
        }[keyof V & string]
      : DefaultModelRow<TContract, ModelName, NsId>
    : DefaultModelRow<TContract, ModelName, NsId>;

export type InferRootRow<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = VariantRow<TContract, ModelName, NsId>;

export type DiscriminatorValues<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> =
  ModelDef<TContract, ModelName, NsId> extends {
    readonly variants: infer V extends Record<string, unknown>;
  }
    ? keyof V & string
    : never;

type VariantModelName<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  VariantValue,
  NsId extends string = never,
> =
  ModelDef<TContract, ModelName, NsId> extends { readonly variants: infer V }
    ? VariantValue extends keyof V
      ? V[VariantValue] extends { readonly model: infer Model extends string }
        ? Model
        : never
      : never
    : never;

type VariantModelNamespace<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  VariantValue,
  NsId extends string = never,
> = [NsId] extends [never]
  ? never
  : ModelDef<TContract, ModelName, NsId> extends { readonly variants: infer V }
    ? VariantValue extends keyof V
      ? V[VariantValue] extends { readonly namespace: infer Namespace extends string }
        ? ContractNamespaceKey<TContract, Namespace>
        : never
      : never
    : never;

export type VariantModelRow<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  VariantValue extends string,
  NsId extends string = never,
> =
  ModelDef<TContract, ModelName, NsId> extends {
    readonly discriminator: { readonly field: infer DiscField extends string };
    readonly variants: infer V;
  }
    ? V extends Record<string, { readonly model: string }>
      ? VariantValue extends keyof V
        ? V[VariantValue]['model'] extends infer VK extends string & CollectionModelName<TContract>
          ? Simplify<
              Omit<DefaultModelRow<TContract, ModelName, NsId>, DiscField> &
                DefaultModelRow<
                  TContract,
                  VK,
                  VariantModelNamespace<TContract, ModelName, VariantValue, NsId>
                > &
                Record<DiscField, VariantValue>
            >
          : DefaultModelRow<TContract, ModelName, NsId>
        : DefaultModelRow<TContract, ModelName, NsId>
      : DefaultModelRow<TContract, ModelName, NsId>
    : DefaultModelRow<TContract, ModelName, NsId>;

/**
 * The value an aggregate hands the application, read from the contract's emitted aggregate map.
 *
 * The map is already settled per input codec — an exact overload having beaten a trait one at emit time — so resolution here is two lookups: the row for this input codec, else the row that answers any input; then that row's output codec, whose application type the codec map names. An operation the target does not declare over this input resolves to `never`, which is what makes an unavailable aggregate unsayable rather than merely wrong at runtime.
 */
type AggregateOperationOf<
  TContract extends Contract<SqlStorage>,
  Op extends string,
> = Op extends keyof ExtractAggregateTypes<TContract>
  ? ExtractAggregateTypes<TContract>[Op]
  : never;

type AggregateRowFor<TContract extends Contract<SqlStorage>, Op extends string, InputCodecId> = [
  InputCodecId,
] extends [never]
  ? WithoutInputRow<AggregateOperationOf<TContract, Op>>
  : InputCodecId extends keyof OperationRows<AggregateOperationOf<TContract, Op>>
    ? OperationRows<AggregateOperationOf<TContract, Op>>[InputCodecId]
    : AnyInputRow<AggregateOperationOf<TContract, Op>>;

type OperationRows<Operation> = Operation extends { readonly byCodec: infer Rows } ? Rows : never;
type AnyInputRow<Operation> = Operation extends { readonly anyInput: infer Row } ? Row : never;
type WithoutInputRow<Operation> = Operation extends { readonly withoutInput: infer Row }
  ? Row
  : never;

/** The application value an aggregate produces, `| null` where the target declares the result nullable. */
export type AggregateResultFor<
  TContract extends Contract<SqlStorage>,
  Op extends string,
  InputCodecId = never,
> =
  AggregateRowFor<TContract, Op, InputCodecId> extends {
    readonly output: infer Output extends string;
    readonly nullable: infer Nullable extends boolean;
  }
    ? Output extends keyof ExtractCodecTypes<TContract>
      ? ExtractCodecTypes<TContract>[Output] extends { readonly output: infer Value }
        ? Nullable extends true
          ? Value | null
          : Value
        : never
      : never
    : never;

/** The application value an aggregate over `FieldName` produces. */
export type AggregateFieldResultFor<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Op extends string,
  FieldName extends string,
  NsId extends string = never,
> = AggregateResultFor<TContract, Op, FieldCodecId<TContract, ModelName, FieldName, NsId>>;

declare const aggregateResultBrand: unique symbol;

export interface AggregateSelector<Result> {
  readonly kind: 'aggregate';
  /** An operation name from the contract's emitted aggregate map — an open vocabulary. */
  readonly fn: string;
  readonly column?: string;
  readonly [aggregateResultBrand]?: Result;
}

export type AggregateSpec = Record<string, AggregateSelector<unknown>>;

export type AggregateResult<Spec extends AggregateSpec> = {
  [K in keyof Spec]: Spec[K] extends AggregateSelector<infer Result> ? Result : never;
};

/**
 * The model fields an aggregate operation admits, read from the contract's
 * emitted aggregate map: a field whose codec a `byCodec` row claims, or any
 * field when the operation declares an `anyInput` row. Availability is the
 * target's declaration, not a generic codec trait — textual or temporal
 * extrema a target declares are admitted, and a pair it never declared is
 * unsayable here before it can fail anywhere else.
 */
export type AggregateFieldNames<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Op extends string,
  NsId extends string = never,
> = {
  [K in keyof DefaultModelRow<TContract, ModelName, NsId> & string]: FieldCodecId<
    TContract,
    ModelName,
    K,
    NsId
  > extends infer Id extends string
    ? AggregateRowFor<TContract, Op, Id> extends never
      ? never
      : K
    : never;
}[keyof DefaultModelRow<TContract, ModelName, NsId> & string];

/** The operation names the contract's emitted aggregate map declares. */
type AggregateOperationNames<TContract extends Contract<SqlStorage>> =
  keyof ExtractAggregateTypes<TContract> & string;

declare const aggregateOperationsUnavailable: unique symbol;

/**
 * The surface an aggregate-derived type resolves to for a contract whose emitted aggregate map is
 * unknown. It declares no operation, and the optional symbol-keyed brand names the reason at the
 * call site while leaving the members and the assignability of any surface it intersects with
 * untouched.
 */
export interface AggregateOperationsUnavailable {
  readonly [aggregateOperationsUnavailable]?: 'the contract declares no aggregate operations';
}

/** Whether the operation declares a row for a call carrying no input. */
type HasZeroArgCall<TContract extends Contract<SqlStorage>, Op extends string> = [
  AggregateRowFor<TContract, Op, never>,
] extends [never]
  ? false
  : true;

type FieldAggregateSelectorCall<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Op extends string,
  NsId extends string,
> = <FieldName extends AggregateFieldNames<TContract, ModelName, Op, NsId>>(
  field: FieldName,
) => AggregateSelector<AggregateFieldResultFor<TContract, ModelName, Op, FieldName, NsId>>;

/**
 * One derived aggregate selector method. Its arities are read off the
 * operation's row presence in the aggregate map: a `withoutInput` row admits
 * the zero-argument call (resolved through that row), and the field-taking
 * call admits exactly the fields {@link AggregateFieldNames} reads off the
 * `byCodec`/`anyInput` rows. An operation with both shapes carries both
 * overloads; `count()` vs `count(field)` is one such data fact, not a
 * special case.
 */
type AggregateSelectorMethod<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Op extends string,
  NsId extends string,
> =
  HasZeroArgCall<TContract, Op> extends true
    ? {
        (): AggregateSelector<AggregateResultFor<TContract, Op>>;
        <FieldName extends AggregateFieldNames<TContract, ModelName, Op, NsId>>(
          field: FieldName,
        ): AggregateSelector<AggregateFieldResultFor<TContract, ModelName, Op, FieldName, NsId>>;
      }
    : FieldAggregateSelectorCall<TContract, ModelName, Op, NsId>;

/**
 * The aggregate selector surface `aggregate()` and `groupBy().aggregate()`
 * hand their callbacks: one method per operation the contract's emitted
 * aggregate map declares, named by the map's keys. The method set, each
 * method's arities, and each selector's result type all derive from the map —
 * an operation the map does not declare is no method at all, and a contract
 * whose map is unknown (no emitted aggregate types) declares no methods.
 */
export type AggregateBuilder<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> =
  string extends AggregateOperationNames<TContract>
    ? AggregateOperationsUnavailable
    : {
        readonly [Op in AggregateOperationNames<TContract>]: AggregateSelectorMethod<
          TContract,
          ModelName,
          Op,
          NsId
        >;
      };

type FieldIncludeReducerCall<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Op extends string,
  NsId extends string,
> = <FieldName extends AggregateFieldNames<TContract, ModelName, Op, NsId>>(
  field: FieldName,
) => IncludeScalar<AggregateFieldResultFor<TContract, ModelName, Op, FieldName, NsId>>;

/**
 * One derived include-scalar reducer: it reduces a to-many relation to this operation's value over
 * the related rows, so the parent row's relation field carries that value instead of an array.
 * Valid only inside an `include(...)` refinement callback — a call elsewhere throws.
 *
 * Its arities are read off the operation's row presence in the aggregate map, exactly as
 * {@link AggregateSelectorMethod}'s are, and so is each result's type: the bare operations over an
 * integer column answer as a `number`, the suffixed ones answer losslessly, and a field-taking
 * reducer answers a parent with no related rows with `null`.
 *
 * ```typescript
 * await db.orm.User.include('posts', (posts) => posts.count()).all();
 * // each row: { ...user, posts: number }
 *
 * await db.orm.User.include('posts', (posts) => posts.sum('views')).all();
 * // each row: { ...user, posts: number | null }
 *
 * await db.orm.User.include('posts', (posts) => posts.sumBigInt('views')).all();
 * // each row: { ...user, posts: bigint | null }
 *
 * await db.orm.User.include('posts', (posts) => posts.avg('views')).all();
 * // each row: { ...user, posts: number | null }
 *
 * await db.orm.User.include('posts', (posts) => posts.min('views')).all();
 * await db.orm.User.include('posts', (posts) => posts.max('views')).all();
 * // each row: { ...user, posts: number | null }
 * ```
 */
type IncludeReducerMethod<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Op extends string,
  NsId extends string,
> =
  HasZeroArgCall<TContract, Op> extends true
    ? {
        (): IncludeScalar<AggregateResultFor<TContract, Op>>;
        <FieldName extends AggregateFieldNames<TContract, ModelName, Op, NsId>>(
          field: FieldName,
        ): IncludeScalar<AggregateFieldResultFor<TContract, ModelName, Op, FieldName, NsId>>;
      }
    : FieldIncludeReducerCall<TContract, ModelName, Op, NsId>;

/**
 * The scalar reducers an `include(...)` refinement collection carries: one
 * method per operation the contract's emitted aggregate map declares. Each
 * reduces a to-many relation to that operation's value over the related rows
 * — the parent row's relation field becomes that value instead of an array —
 * with the same row-derived arities and result types as
 * {@link AggregateBuilder}. Only valid inside an `include(...)` refinement
 * callback; a call elsewhere throws. A contract whose map is unknown (no
 * emitted aggregate types) contributes no reducers — the guard keeps an
 * index signature off the collection surface.
 */
export type AggregateIncludeReducers<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> =
  string extends AggregateOperationNames<TContract>
    ? AggregateOperationsUnavailable
    : {
        readonly [Op in AggregateOperationNames<TContract>]: IncludeReducerMethod<
          TContract,
          ModelName,
          Op,
          NsId
        >;
      };

export type HavingComparisonMethods<T, CodecId extends string = never> = Pick<
  ComparisonMethods<T, 'equality' | 'order', CodecId>,
  'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte'
>;

/**
 * Literal HAVING comparands stay `number` regardless of the result's application
 * representation; prepared comparands carry the declared aggregate output codec.
 * A field-taking metric compares as `number | null` — a
 * grouped value's SQL domain includes NULL; a no-input metric reads
 * nullability off its declared row, so `count()` compares as plain `number`.
 */
type HavingZeroArgComparand<Row> = Row extends {
  readonly nullable: infer Nullable extends boolean;
}
  ? Nullable extends true
    ? number | null
    : number
  : never;

type AggregateOutputCodecId<Row> = Row extends { readonly output: infer Id extends string }
  ? Id
  : never;

type FieldHavingCall<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Op extends string,
  NsId extends string,
> = <FieldName extends AggregateFieldNames<TContract, ModelName, Op, NsId>>(
  field: FieldName,
) => HavingComparisonMethods<
  number | null,
  AggregateOutputCodecId<
    AggregateRowFor<TContract, Op, FieldCodecId<TContract, ModelName, FieldName, NsId>>
  >
>;

type HavingMethod<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Op extends string,
  NsId extends string,
> =
  HasZeroArgCall<TContract, Op> extends true
    ? {
        (): HavingComparisonMethods<
          HavingZeroArgComparand<AggregateRowFor<TContract, Op, never>>,
          AggregateOutputCodecId<AggregateRowFor<TContract, Op, never>>
        >;
        <FieldName extends AggregateFieldNames<TContract, ModelName, Op, NsId>>(
          field: FieldName,
        ): HavingComparisonMethods<
          number | null,
          AggregateOutputCodecId<
            AggregateRowFor<TContract, Op, FieldCodecId<TContract, ModelName, FieldName, NsId>>
          >
        >;
      }
    : FieldHavingCall<TContract, ModelName, Op, NsId>;

/**
 * The metric surface `groupBy().having()` hands its callback, derived from
 * the same aggregate map as {@link AggregateBuilder} — restricted to the
 * closed SQL aggregate alphabet. HAVING compares the value inside the
 * database, where only an operation's plain `AggregateExpr` form is sound; an
 * operation outside the alphabet exists only in its descriptor-lowered form,
 * a rendering for the driver boundary, so it carries no HAVING method. A
 * contract whose map is unknown (no emitted aggregate types) declares no
 * methods.
 */
export type HavingBuilder<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> =
  string extends AggregateOperationNames<TContract>
    ? AggregateOperationsUnavailable
    : {
        readonly [Op in AggregateOperationNames<TContract> & SqlAggregateFn]: HavingMethod<
          TContract,
          ModelName,
          Op,
          NsId
        >;
      };

export type ShorthandWhereFilter<
  TContract extends Contract<SqlStorage>,
  NsId extends DomainNamespaceId<TContract>,
  ModelName extends string,
> = Partial<{
  [K in keyof DefaultModelInputRow<TContract, ModelName, NsId> & string]:
    | DefaultModelInputRow<TContract, ModelName, NsId>[K]
    | ('equality' extends FieldTraits<TContract, ModelName, K, NsId>
        ? Expression<{
            codecId: FieldCodecId<TContract, ModelName, K, NsId>;
            nullable: boolean;
            many?: never;
          }>
        : never)
    | null
    | undefined;
}>;

// Read by the facet resolution path so same-named models across namespaces
// resolve to each namespace's own model.
type NamespaceModelsOf<
  TContract extends Contract<SqlStorage>,
  NsId extends string,
> = NsId extends keyof TContract['domain']['namespaces']
  ? TContract['domain']['namespaces'][NsId]['models'] extends infer M extends Record<
      string,
      unknown
    >
    ? M
    : Record<string, never>
  : Record<string, never>;

// The model definition for `ModelName`, scanning every domain namespace block.
// For a single-namespace contract this is the sole namespace's model; under a
// same-bare-name collision it unions the same-named models.
type ScannedModelDef<TContract extends Contract<SqlStorage>, ModelName extends string> = {
  [Ns in keyof TContract['domain']['namespaces']]: ModelName extends keyof TContract['domain']['namespaces'][Ns]['models']
    ? TContract['domain']['namespaces'][Ns]['models'][ModelName]
    : never;
}[keyof TContract['domain']['namespaces']];

type ModelDef<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = [NsId] extends [never]
  ? ScannedModelDef<TContract, ModelName>
  : ModelName extends keyof NamespaceModelsOf<TContract, NsId>
    ? NamespaceModelsOf<TContract, NsId>[ModelName]
    : never;

// Fallback for a model definition that does not carry its own
// `storage.namespaceId`: the storage namespace whose block declares the table.
type NamespaceContainingTable<TContract extends Contract<SqlStorage>, TableName extends string> = {
  [K in keyof TContract['storage']['namespaces'] &
    string]: TContract['storage']['namespaces'][K] extends {
    readonly entries: { readonly table: infer Tables };
  }
    ? TableName extends keyof Tables
      ? K
      : never
    : never;
}[keyof TContract['storage']['namespaces'] & string];

// The namespace coordinate to resolve a model's storage columns at: the
// explicit `NsId` when threaded from a facet, else the model's own
// `storage.namespaceId`, else the namespace whose storage block declares the
// model's table (the sole namespace for single-namespace contracts).
type ResolvedNsId<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = [NsId] extends [never]
  ? ModelDef<TContract, ModelName> extends {
      readonly storage: { readonly namespaceId: infer N extends string };
    }
    ? N
    : ModelDef<TContract, ModelName> extends {
          readonly storage: { readonly table: infer T extends string };
        }
      ? NamespaceContainingTable<TContract, T>
      : never
  : NsId;

export type FieldsOf<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> =
  ModelDef<TContract, ModelName, NsId> extends { readonly fields: infer F }
    ? F extends Record<string, unknown>
      ? F
      : Record<string, never>
    : Record<string, never>;

type ModelStorageFields<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> =
  ModelDef<TContract, ModelName, NsId> extends {
    readonly storage: { readonly fields: infer Fields };
  }
    ? Fields extends Record<string, { readonly column: string }>
      ? Fields
      : never
    : never;

type ModelFieldToColumnMap<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> =
  ModelStorageFields<TContract, ModelName, NsId> extends infer Fields
    ? Fields extends Record<string, { readonly column: string }>
      ? { readonly [F in keyof Fields]: Fields[F]['column'] }
      : never
    : never;

type FieldToColumnMapSafe<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> =
  ModelFieldToColumnMap<TContract, ModelName, NsId> extends Record<string, string>
    ? ModelFieldToColumnMap<TContract, ModelName, NsId>
    : never;

type ModelTableName<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> =
  ModelDef<TContract, ModelName, NsId> extends {
    readonly storage: { readonly table: infer T extends string };
  }
    ? T
    : never;

type FieldColumnName<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
  NsId extends string = never,
> = (FieldToColumnMapSafe<TContract, ModelName, NsId> extends never
  ? FieldName
  : FieldName extends keyof FieldToColumnMapSafe<TContract, ModelName, NsId>
    ? FieldToColumnMapSafe<TContract, ModelName, NsId>[FieldName]
    : FieldName) &
  string;

type NamespaceTableDef<
  TContract extends Contract<SqlStorage>,
  TableName extends string,
  NsId extends string = never,
> = [NsId] extends [never]
  ? {
      [K in keyof TContract['storage']['namespaces']]: TContract['storage']['namespaces'][K] extends {
        readonly entries: { readonly table: infer Tables };
      }
        ? TableName extends keyof Tables
          ? Tables[TableName]
          : never
        : never;
    }[keyof TContract['storage']['namespaces']]
  : NsId extends keyof TContract['storage']['namespaces']
    ? TContract['storage']['namespaces'][NsId] extends {
        readonly entries: { readonly table: infer Tables };
      }
      ? TableName extends keyof Tables
        ? Tables[TableName]
        : never
      : never
    : never;

type ResolvedStorageColumn<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
  NsId extends string = never,
> =
  ModelTableName<TContract, ModelName, NsId> extends infer TableName extends string
    ? FieldColumnName<TContract, ModelName, FieldName, NsId> extends infer ColName extends string
      ? NamespaceTableDef<TContract, TableName, ResolvedNsId<TContract, ModelName, NsId>> extends {
          readonly columns: infer Columns;
        }
        ? ColName extends keyof Columns
          ? Columns[ColName] extends StorageColumn
            ? Columns[ColName]
            : never
          : never
        : never
      : never
    : never;

type FieldStorageJsType<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
  NsId extends string = never,
> =
  ResolvedStorageColumn<TContract, ModelName, FieldName, NsId> extends infer Col extends
    StorageColumn
    ? Col extends StorageColumn
      ? ComputeColumnJsType<
          TContract,
          ResolvedNsId<TContract, ModelName, NsId>,
          ModelTableName<TContract, ModelName, NsId> & string,
          FieldColumnName<TContract, ModelName, FieldName, NsId> & string,
          ExtractCodecTypes<TContract>
        >
      : never
    : never;

// The refined output type of a field, read directly from the emitter's
// namespace-nested `FieldOutputTypes[ns][model][field]` map. This carries every
// field of the model (including value-object fields, which have no single
// storage column), already typeParam-refined and nullability-applied. Resolves
// to `never` when the namespace coordinate is absent from the map.
type NamespaceFieldOutputType<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
  NsId extends string = never,
> =
  ResolvedNsId<TContract, ModelName, NsId> extends infer Ns extends string
    ? ExtractFieldOutputTypes<TContract> extends infer Outputs
      ? Ns extends keyof Outputs
        ? Outputs[Ns] extends infer NamespaceOutputs
          ? ModelName extends keyof NamespaceOutputs
            ? NamespaceOutputs[ModelName] extends infer ModelOutputs
              ? FieldName extends keyof ModelOutputs
                ? ModelOutputs[FieldName]
                : never
              : never
            : never
          : never
        : never
      : never
    : never;

// The emitter's per-namespace `FieldOutputTypes` is the source of truth (refined
// codecs + value objects + nullability); for a column-mapped field absent from
// that map (e.g. a namespace not present in the emitted output map) it falls
// back to the codec-based storage resolution.
type FieldJsType<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
  NsId extends string = never,
> = [NamespaceFieldOutputType<TContract, ModelName, FieldName, NsId>] extends [never]
  ? [FieldStorageJsType<TContract, ModelName, FieldName, NsId>] extends [never]
    ? unknown
    : FieldStorageJsType<TContract, ModelName, FieldName, NsId>
  : NamespaceFieldOutputType<TContract, ModelName, FieldName, NsId>;

type NamespaceFieldInputType<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
  NsId extends string = never,
> =
  ResolvedNsId<TContract, ModelName, NsId> extends infer Ns extends string
    ? ExtractFieldInputTypes<TContract> extends infer Inputs
      ? Ns extends keyof Inputs
        ? Inputs[Ns] extends infer NamespaceInputs
          ? ModelName extends keyof NamespaceInputs
            ? NamespaceInputs[ModelName] extends infer ModelInputs
              ? FieldName extends keyof ModelInputs
                ? ModelInputs[FieldName]
                : never
              : never
            : never
          : never
        : never
      : never
    : never;

// The type a filter or a write accepts for a field: the contract's `FieldInputTypes` entry, or the read type for a contract that has no such entry.
type FieldInputJsType<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
  NsId extends string = never,
> = [NamespaceFieldInputType<TContract, ModelName, FieldName, NsId>] extends [never]
  ? FieldJsType<TContract, ModelName, FieldName, NsId>
  : NamespaceFieldInputType<TContract, ModelName, FieldName, NsId>;

type FieldStorageColumn<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
  NsId extends string = never,
> = ResolvedStorageColumn<TContract, ModelName, FieldName, NsId>;

export type FieldCodecId<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
  NsId extends string = never,
> =
  FieldStorageColumn<TContract, ModelName, FieldName, NsId> extends {
    readonly codecId: infer Id extends string;
  }
    ? Id
    : never;

export type FieldNullable<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
  NsId extends string = never,
> =
  FieldStorageColumn<TContract, ModelName, FieldName, NsId> extends {
    readonly nullable: infer N extends boolean;
  }
    ? N
    : false;

type FieldTraits<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
  NsId extends string = never,
> =
  FieldCodecId<TContract, ModelName, FieldName, NsId> extends infer Id extends string
    ? Id extends keyof ExtractCodecTypes<TContract>
      ? ExtractCodecTypes<TContract>[Id] extends { readonly traits: infer T }
        ? T
        : never
      : never
    : never;

export type NumericFieldNames<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = {
  [K in keyof DefaultModelRow<TContract, ModelName, NsId> & string]: 'numeric' extends FieldTraits<
    TContract,
    ModelName,
    K,
    NsId
  >
    ? K
    : never;
}[keyof DefaultModelRow<TContract, ModelName, NsId> & string];

type FieldHasExecutionCreateDefault<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
  NsId extends string = never,
> = HasExecutionCreateDefault<
  TContract,
  ResolvedNsId<TContract, ModelName, NsId>,
  ModelTableName<TContract, ModelName, NsId>,
  FieldColumnName<TContract, ModelName, FieldName, NsId>
>;

type IsOptionalCreateField<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
  NsId extends string = never,
> =
  FieldStorageColumn<TContract, ModelName, FieldName, NsId> extends infer Column
    ? Column extends StorageColumn
      ? IsOptionalCreateColumn<
          TContract,
          Column,
          ResolvedNsId<TContract, ModelName, NsId>,
          ModelTableName<TContract, ModelName, NsId>,
          FieldColumnName<TContract, ModelName, FieldName, NsId>
        >
      : FieldHasExecutionCreateDefault<TContract, ModelName, FieldName, NsId>
    : FieldHasExecutionCreateDefault<TContract, ModelName, FieldName, NsId>;

type CreateFieldNames<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = keyof DefaultModelRow<TContract, ModelName, NsId> & string;

type RequiredCreateFieldNames<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = {
  [K in CreateFieldNames<TContract, ModelName, NsId>]-?: IsOptionalCreateField<
    TContract,
    ModelName,
    K,
    NsId
  > extends true
    ? never
    : K;
}[CreateFieldNames<TContract, ModelName, NsId>];

type OptionalCreateFieldNames<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = {
  [K in CreateFieldNames<TContract, ModelName, NsId>]-?: IsOptionalCreateField<
    TContract,
    ModelName,
    K,
    NsId
  > extends true
    ? K
    : never;
}[CreateFieldNames<TContract, ModelName, NsId>];

type RowCreateFields<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = Pick<
  DefaultModelInputRow<TContract, ModelName, NsId>,
  RequiredCreateFieldNames<TContract, ModelName, NsId>
> &
  Partial<
    Pick<
      DefaultModelInputRow<TContract, ModelName, NsId>,
      OptionalCreateFieldNames<TContract, ModelName, NsId>
    >
  >;

export type CreateInput<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = RowCreateFields<TContract, ModelName, NsId> &
  RelationMutationFields<TContract, ModelName, 'create'>;

type IsPolymorphicBase<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> =
  ModelDef<TContract, ModelName, NsId> extends {
    readonly discriminator: unknown;
    readonly variants: Record<string, unknown>;
  }
    ? true
    : false;

type DiscriminatorFieldName<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> =
  ModelDef<TContract, ModelName, NsId> extends {
    readonly discriminator: { readonly field: infer F extends string };
  }
    ? F
    : never;

export type VariantCreateInput<
  TContract extends Contract<SqlStorage>,
  BaseModelName extends string,
  VariantValue extends string,
  NsId extends string = never,
> = VariantValue extends string
  ? Omit<
      CreateInput<TContract, BaseModelName, NsId>,
      DiscriminatorFieldName<TContract, BaseModelName, NsId>
    > &
      CreateInput<
        TContract,
        VariantModelName<TContract, BaseModelName, VariantValue, NsId>,
        VariantModelNamespace<TContract, BaseModelName, VariantValue, NsId>
      >
  : never;

/**
 * An input with no keys is `Record<string, never>`, not `{}`: TypeScript accepts any object where `{}` is expected, so a model with no fields would accept any key.
 */
type ClosedWhenEmpty<T> = [keyof T] extends [never] ? Record<string, never> : T;

/** The scalar fields an update of the model takes. For a model with no fields, it rejects every key. */
export type ScalarUpdateInput<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = ClosedWhenEmpty<Partial<DefaultModelInputRow<TContract, ModelName, NsId>>>;

export type ResolvedCreateInput<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  VariantValue extends string | undefined,
  NsId extends string = never,
> = ClosedWhenEmpty<
  IsPolymorphicBase<TContract, ModelName, NsId> extends true
    ? VariantValue extends string
      ? VariantCreateInput<TContract, ModelName, VariantValue, NsId>
      : never
    : CreateInput<TContract, ModelName, NsId>
>;

export type ResolvedScalarCreateInput<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  VariantValue extends string | undefined,
  NsId extends string = never,
> = ClosedWhenEmpty<
  IsPolymorphicBase<TContract, ModelName, NsId> extends true
    ? VariantValue extends string
      ? Omit<
          RowCreateFields<TContract, ModelName, NsId>,
          DiscriminatorFieldName<TContract, ModelName, NsId>
        > &
          RowCreateFields<
            TContract,
            VariantModelName<TContract, ModelName, VariantValue, NsId>,
            VariantModelNamespace<TContract, ModelName, VariantValue, NsId>
          >
      : never
    : RowCreateFields<TContract, ModelName, NsId>
>;

type ModelStorageTableDef<TContract extends Contract<SqlStorage>, ModelName extends string> =
  ModelTableName<TContract, ModelName> extends infer TableName extends string
    ? NamespaceTableDef<TContract, TableName>
    : never;

type PrimaryKeyConstraintColumns<TContract extends Contract<SqlStorage>, ModelName extends string> =
  ModelStorageTableDef<TContract, ModelName> extends {
    readonly primaryKey: { readonly columns: infer Columns extends readonly string[] };
  }
    ? Columns
    : never;

type UniqueConstraintColumns<TContract extends Contract<SqlStorage>, ModelName extends string> =
  ModelStorageTableDef<TContract, ModelName> extends {
    readonly uniques: infer Uniques;
  }
    ? Uniques extends ReadonlyArray<infer Unique>
      ? Unique extends { readonly columns: infer Columns extends readonly string[] }
        ? Columns
        : never
      : never
    : never;

type FieldNameForColumn<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  ColumnName extends string,
> = {
  [K in keyof DefaultModelRow<TContract, ModelName> & string]: FieldColumnName<
    TContract,
    ModelName,
    K
  > extends ColumnName
    ? K
    : never;
}[keyof DefaultModelRow<TContract, ModelName> & string] extends infer Matched
  ? Matched extends string
    ? Matched
    : ColumnName
  : ColumnName;

type RowValueForField<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = FieldName extends keyof DefaultModelInputRow<TContract, ModelName>
  ? DefaultModelInputRow<TContract, ModelName>[FieldName]
  : unknown;

type CriterionFromConstraintColumns<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Columns extends readonly string[],
> = string extends Columns[number]
  ? Record<string, unknown>
  : {
      [C in Columns[number] as FieldNameForColumn<TContract, ModelName, C>]: Exclude<
        RowValueForField<TContract, ModelName, FieldNameForColumn<TContract, ModelName, C>>,
        null
      >;
    };

type ConstraintColumnsUnion<TContract extends Contract<SqlStorage>, ModelName extends string> =
  | PrimaryKeyConstraintColumns<TContract, ModelName>
  | UniqueConstraintColumns<TContract, ModelName>;

export type UniqueConstraintCriterion<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> =
  ConstraintColumnsUnion<TContract, ModelName> extends infer Columns
    ? Columns extends readonly string[]
      ? CriterionFromConstraintColumns<TContract, ModelName, Columns>
      : never
    : never;

type RelationConnectCriterion<TContract extends Contract<SqlStorage>, ModelName extends string> = [
  UniqueConstraintCriterion<TContract, ModelName>,
] extends [never]
  ? Record<string, unknown>
  : UniqueConstraintCriterion<TContract, ModelName>;

export interface RelationMutationCreate<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> {
  readonly kind: 'create';
  readonly data: readonly MutationCreateInput<TContract, ModelName>[];
}

export interface RelationMutationConnect<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> {
  readonly kind: 'connect';
  readonly criteria: readonly RelationConnectCriterion<TContract, ModelName>[];
}

export interface RelationMutationDisconnect<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> {
  readonly kind: 'disconnect';
  readonly criteria?: readonly RelationConnectCriterion<TContract, ModelName>[];
}

export type RelationMutation<TContract extends Contract<SqlStorage>, ModelName extends string> =
  | RelationMutationCreate<TContract, ModelName>
  | RelationMutationConnect<TContract, ModelName>
  | RelationMutationDisconnect<TContract, ModelName>;

type RelationThrough<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  RelName extends string,
> =
  RelationsOf<TContract, ModelName> extends infer Rels extends Record<string, unknown>
    ? RelName extends keyof Rels
      ? Rels[RelName] extends {
          readonly through: infer Through extends {
            readonly table: string;
            readonly parentColumns: readonly string[];
            readonly childColumns: readonly string[];
          };
        }
        ? Through
        : never
      : never
    : never;

type HasJunctionThrough<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  RelName extends string,
> = [RelationThrough<TContract, ModelName, RelName>] extends [never] ? false : true;

/**
 * Resolves a storage table name to its owning domain model by scanning the
 * model map for the model whose `storage.table` and `storage.namespaceId`
 * match. Junction tables (e.g. `user_roles`) surface their generated model
 * (e.g. `UserRole`) so the junction's own field nullability/defaults can be
 * inspected.
 */
type ModelNameForTable<
  TContract extends Contract<SqlStorage>,
  NamespaceId extends string,
  TableName extends string,
> = {
  [M in keyof NamespaceModelsOf<TContract, NamespaceId> & string]: NamespaceModelsOf<
    TContract,
    NamespaceId
  >[M] extends {
    readonly storage: { readonly namespaceId: NamespaceId; readonly table: TableName };
  }
    ? M
    : never;
}[keyof NamespaceModelsOf<TContract, NamespaceId> & string];

/**
 * A junction field is a *payload* field when its backing column is neither a
 * parent-side nor a child-side foreign-key column of the join. Those payload
 * fields are the ones the relation API can't populate from `create`/`connect`.
 */
type JunctionPayloadFieldNames<
  TContract extends Contract<SqlStorage>,
  JunctionModel extends string,
  JoinColumns extends string,
  NsId extends string = never,
> = {
  [F in CreateFieldNames<TContract, JunctionModel, NsId>]: FieldColumnName<
    TContract,
    JunctionModel,
    F,
    NsId
  > extends JoinColumns
    ? never
    : F;
}[CreateFieldNames<TContract, JunctionModel, NsId>];

/**
 * True when the relation's junction carries at least one required payload
 * column — a non-join column that is not nullable and has no default. Such a
 * relation can't be populated through nested `create`, so its create input is
 * disabled at the type level (mirroring the runtime guard in
 * `mutation-executor.ts`).
 */
type HasRequiredJunctionPayload<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  RelName extends string,
> =
  RelationThrough<TContract, ModelName, RelName> extends infer Through extends {
    readonly table: string;
    readonly namespaceId: string;
    readonly parentColumns: readonly string[];
    readonly childColumns: readonly string[];
  }
    ? ModelNameForTable<
        TContract,
        Through['namespaceId'],
        Through['table']
      > extends infer JunctionModel extends string
      ? JunctionPayloadFieldNames<
          TContract,
          JunctionModel,
          Through['parentColumns'][number] | Through['childColumns'][number],
          Through['namespaceId']
        > extends infer PayloadFields extends string
        ? {
            [F in PayloadFields]: IsOptionalCreateField<
              TContract,
              JunctionModel,
              F,
              Through['namespaceId']
            > extends true
              ? never
              : F;
          }[PayloadFields] extends never
          ? false
          : true
        : false
      : false
    : false;

type DisconnectMutator<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  BareDisconnectDisabled extends boolean,
> = BareDisconnectDisabled extends true
  ? (
      criteria: readonly RelationConnectCriterion<TContract, ModelName>[],
    ) => RelationMutationDisconnect<TContract, ModelName>
  : {
      (): RelationMutationDisconnect<TContract, ModelName>;
      (
        criteria: readonly RelationConnectCriterion<TContract, ModelName>[],
      ): RelationMutationDisconnect<TContract, ModelName>;
    };

export interface RelationMutator<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  LinkWritesDisabled extends boolean = false,
  BareDisconnectDisabled extends boolean = false,
  DisconnectDisabled extends boolean = false,
> {
  create(
    data: LinkWritesDisabled extends true ? never : MutationCreateInput<TContract, ModelName>,
  ): RelationMutationCreate<TContract, ModelName>;
  create(
    data: LinkWritesDisabled extends true
      ? never
      : readonly MutationCreateInput<TContract, ModelName>[],
  ): RelationMutationCreate<TContract, ModelName>;
  connect(
    criterion: LinkWritesDisabled extends true
      ? never
      : RelationConnectCriterion<TContract, ModelName>,
  ): RelationMutationConnect<TContract, ModelName>;
  connect(
    criteria: LinkWritesDisabled extends true
      ? never
      : readonly RelationConnectCriterion<TContract, ModelName>[],
  ): RelationMutationConnect<TContract, ModelName>;
  // `disconnect` is update-only: `createGraph` rejects any nested disconnect
  // during `create()`, so in the create context the criteria parameter narrows
  // to `never`, making every call a type error (mirrors the `LinkWritesDisabled`
  // arms above). `never` is callable, so disabling must live on the parameter,
  // not the property type.
  readonly disconnect: DisconnectDisabled extends true
    ? (criteria: never) => RelationMutationDisconnect<TContract, ModelName>
    : DisconnectMutator<TContract, ModelName, BareDisconnectDisabled>;
}

type RelationMutationCallback<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  RelName extends RelationNames<TContract, ModelName>,
  Context extends 'create' | 'update' = 'update',
> = (
  mutator: RelationMutator<
    TContract,
    RelatedModelName<TContract, ModelName, RelName> & string,
    HasRequiredJunctionPayload<TContract, ModelName, RelName>,
    HasJunctionThrough<TContract, ModelName, RelName>,
    Context extends 'create' ? true : false
  >,
) => RelationMutation<TContract, RelatedModelName<TContract, ModelName, RelName> & string>;

type RelationMutationFields<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Context extends 'create' | 'update' = 'update',
> = Partial<{
  [K in RelationNames<TContract, ModelName>]: RelationMutationCallback<
    TContract,
    ModelName,
    K,
    Context
  >;
}>;

type AllModelRelationEntries<TContract extends Contract<SqlStorage>> = {
  [Ns in keyof TContract['domain']['namespaces']]: {
    [M in keyof TContract['domain']['namespaces'][Ns]['models']]: TContract['domain']['namespaces'][Ns]['models'][M] extends {
      readonly relations: infer R extends Record<string, unknown>;
    }
      ? R[keyof R]
      : never;
  }[keyof TContract['domain']['namespaces'][Ns]['models']];
}[keyof TContract['domain']['namespaces']];

type RelationDefWithTargetFields = {
  readonly to: { readonly model: string };
  readonly on: {
    readonly targetFields: readonly string[];
  };
};

type ChildForeignKeyFieldNames<TContract extends Contract<SqlStorage>, ModelName extends string> =
  Extract<AllModelRelationEntries<TContract>, RelationDefWithTargetFields> extends infer Relation
    ? Relation extends {
        readonly to: { readonly model: ModelName };
        readonly on: {
          readonly targetFields: infer Fields extends readonly string[];
        };
      }
      ? Fields[number]
      : never
    : never;

type NestedOptionalCreateFieldNames<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> =
  | OptionalCreateFieldNames<TContract, ModelName, NsId>
  | Extract<
      ChildForeignKeyFieldNames<TContract, ModelName>,
      CreateFieldNames<TContract, ModelName, NsId>
    >;

type NestedRequiredCreateFieldNames<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = Exclude<
  CreateFieldNames<TContract, ModelName, NsId>,
  NestedOptionalCreateFieldNames<TContract, ModelName, NsId>
>;

type NestedCreateInput<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = Pick<
  DefaultModelInputRow<TContract, ModelName, NsId>,
  NestedRequiredCreateFieldNames<TContract, ModelName, NsId>
> &
  Partial<
    Pick<
      DefaultModelInputRow<TContract, ModelName, NsId>,
      NestedOptionalCreateFieldNames<TContract, ModelName, NsId>
    >
  >;

type AtLeastOne<T> = keyof T extends never
  ? never
  : {
      [K in keyof T]-?: Pick<T, K> & Partial<Omit<T, K>>;
    }[keyof T];

export type MutationCreateInput<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = NestedCreateInput<TContract, ModelName, NsId> &
  RelationMutationFields<TContract, ModelName, 'create'>;

export type MutationCreateInputWithRelations<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = NestedCreateInput<TContract, ModelName, NsId> &
  AtLeastOne<RelationMutationFields<TContract, ModelName, 'create'>>;

export type MutationUpdateInput<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = ClosedWhenEmpty<
  Partial<DefaultModelInputRow<TContract, ModelName, NsId>> &
    RelationMutationFields<TContract, ModelName, 'update'>
>;

type ModelRelations<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> =
  ModelDef<TContract, ModelName, NsId> extends { readonly relations: infer R }
    ? R extends Record<string, unknown>
      ? R
      : Record<string, never>
    : Record<string, never>;

type ExactRecord<T> =
  T extends Record<string, unknown>
    ? string extends keyof T
      ? Record<string, never>
      : T
    : Record<string, never>;

export type RelationsOf<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = ExactRecord<ModelRelations<TContract, ModelName, NsId>>;

export type RelationNames<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = (string extends keyof RelationsOf<TContract, ModelName, NsId>
  ? never
  : {
      // Filter out relation keys whose type is `never` — those are cross-space
      // relations (Option B): declared in the contract but non-navigable via
      // `include`. Emitting the relation as `never` in the `.d.ts` and
      // excluding it here makes `include('relName')` a compile error.
      [K in keyof RelationsOf<TContract, ModelName, NsId>]: RelationsOf<
        TContract,
        ModelName,
        NsId
      >[K] extends never
        ? never
        : K;
    }[keyof RelationsOf<TContract, ModelName, NsId>]) &
  string;

type IsUnion<T, Whole = T> = T extends Whole ? ([Whole] extends [T] ? false : true) : never;

type IsSingletonString<T> = [T] extends [string]
  ? string extends T
    ? false
    : IsUnion<T> extends true
      ? false
      : true
  : false;

type VariantDeclaredRelationKeys<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  VariantValue,
  NsId extends string,
> = VariantValue extends string
  ? keyof RelationsOf<
      TContract,
      VariantModelName<TContract, ModelName, VariantValue, NsId>,
      VariantModelNamespace<TContract, ModelName, VariantValue, NsId>
    >
  : never;

type SelectedVariantDeclaredRelationKeys<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  VariantValue,
  NsId extends string,
> = VariantDeclaredRelationKeys<
  TContract,
  ModelName,
  string extends VariantValue ? DiscriminatorValues<TContract, ModelName, NsId> : VariantValue,
  NsId
>;

export type VariantAwareIncludeRelationNames<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  VariantValue,
  NsId extends string = never,
> =
  IsSingletonString<VariantValue> extends true
    ?
        | RelationNames<
            TContract,
            VariantModelName<TContract, ModelName, VariantValue, NsId>,
            VariantModelNamespace<TContract, ModelName, VariantValue, NsId>
          >
        | Exclude<
            RelationNames<TContract, ModelName, NsId>,
            keyof RelationsOf<
              TContract,
              VariantModelName<TContract, ModelName, VariantValue, NsId>,
              VariantModelNamespace<TContract, ModelName, VariantValue, NsId>
            >
          >
    : [VariantValue] extends [string]
      ? Exclude<
          RelationNames<TContract, ModelName, NsId>,
          SelectedVariantDeclaredRelationKeys<TContract, ModelName, VariantValue, NsId>
        >
      : RelationNames<TContract, ModelName, NsId>;

export type IncludeRelationOwner<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  VariantValue,
  RelName extends string,
  NsId extends string = never,
> =
  IsSingletonString<VariantValue> extends true
    ? RelName extends keyof RelationsOf<
        TContract,
        VariantModelName<TContract, ModelName, VariantValue, NsId>,
        VariantModelNamespace<TContract, ModelName, VariantValue, NsId>
      >
      ? VariantModelName<TContract, ModelName, VariantValue, NsId>
      : ModelName
    : ModelName;

export type IncludeRelationOwnerNamespace<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  VariantValue,
  RelName extends string,
  NsId extends string = never,
> =
  IsSingletonString<VariantValue> extends true
    ? RelName extends keyof RelationsOf<
        TContract,
        VariantModelName<TContract, ModelName, VariantValue, NsId>,
        VariantModelNamespace<TContract, ModelName, VariantValue, NsId>
      >
      ? VariantModelNamespace<TContract, ModelName, VariantValue, NsId>
      : NsId
    : NsId;

type RelationModelName<Relation> = Relation extends {
  readonly to: { readonly model: infer To extends string };
}
  ? To
  : never;

export type RelatedModelName<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  RelName extends string,
  NsId extends string = never,
> =
  RelationsOf<TContract, ModelName, NsId> extends infer Rels
    ? Rels extends Record<string, unknown>
      ? RelName extends keyof Rels
        ? RelationModelName<Rels[RelName]>
        : never
      : never
    : never;

type ContractNamespaceKey<TContract extends Contract<SqlStorage>, NsId extends string> = {
  [K in keyof TContract['domain']['namespaces'] & string]: NsId extends K ? K : never;
}[keyof TContract['domain']['namespaces'] & string];

// The namespace coordinate the relation's target model lives in, read from the
// relation's `to.namespace`. Lets a relation reached through an explicit
// namespace facet resolve its included row at the target namespace rather than
// the parent facet's. Without a facet coordinate (`never`) it stays `never` so
// the included row resolves through the same default path as before — a
// non-facet collection's include shape is unchanged.
export type RelationTargetNamespace<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  RelName extends string,
  NsId extends string = never,
> = [NsId] extends [never]
  ? never
  : RelationsOf<TContract, ModelName, NsId> extends infer Rels
    ? Rels extends Record<string, unknown>
      ? RelName extends keyof Rels
        ? Rels[RelName] extends { readonly to: { readonly namespace: infer N extends string } }
          ? ContractNamespaceKey<TContract, N>
          : never
        : never
      : never
    : never;

type RelationCardinalityFromRelation<Relation> = Relation extends {
  readonly cardinality: infer Cardinality extends RelationCardinalityTag;
}
  ? Cardinality
  : '1:N';

export type RelationCardinality<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  RelName extends string,
  NsId extends string = never,
> =
  RelationsOf<TContract, ModelName, NsId> extends infer Rels
    ? Rels extends Record<string, unknown>
      ? RelName extends keyof Rels
        ? RelationCardinalityFromRelation<Rels[RelName]>
        : '1:N'
      : '1:N'
    : '1:N';

type IsToOneRelationNullable<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  RelName extends string,
  NsId extends string = never,
> =
  RelationsOf<TContract, ModelName, NsId> extends infer Rels extends Record<string, unknown>
    ? RelName extends keyof Rels
      ? Rels[RelName] extends { readonly nullable: false }
        ? false
        : true
      : true
    : true;

export type IncludeRelationValue<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  RelName extends string,
  IncludedRow,
  NsId extends string = never,
> =
  RelationCardinality<TContract, ModelName, RelName, NsId> extends '1:1' | 'N:1'
    ? IsToOneRelationNullable<TContract, ModelName, RelName, NsId> extends true
      ? IncludedRow | null
      : IncludedRow
    : IncludedRow[];

// The union of model names across every domain namespace, scanned per-namespace
// so a model unique to one namespace under a same-bare-name collision is not
// dropped (a single keyed map would collapse to the shared-key intersection).
export type CollectionModelName<TContract extends Contract<SqlStorage>> = {
  [Ns in keyof TContract['domain']['namespaces']]: keyof TContract['domain']['namespaces'][Ns]['models'] &
    string;
}[keyof TContract['domain']['namespaces']];
