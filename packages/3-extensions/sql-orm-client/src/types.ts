import type { Contract } from '@internal/contract/types';
import type { AnnotationValue, OperationKind } from '@internal/framework-components/runtime';
import type {
  ExtractAggregateTypes,
  ExtractCodecTypes,
  ExtractFieldOutputTypes,
  ExtractQueryOperationTypes,
  SqlStorage,
  StorageColumn,
  StorageTable,
} from '@internal/sql-contract/types';
import {
  type AnyExpression,
  BinaryExpr,
  type BinaryOp,
  type CodecRef,
  type CodecTrait,
  ListExpression,
  NullCheckExpr,
  OrderByItem,
  ParamRef,
  type AggregateFn as SqlAggregateFn,
} from '@internal/sql-relational-core/ast';
import type { Expression } from '@internal/sql-relational-core/expression';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import type { ComputeColumnJsType, RuntimeScope } from '@internal/sql-relational-core/types';
import type { RowSelection } from './collection-internal-types';

export interface IncludeScalar<Result> extends RowSelection<Result> {
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
  extends RowSelection<ResultShape> {
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
  readonly localTableName: string;
  readonly targetColumn: string;
  readonly localColumn: string;
  readonly cardinality: RelationCardinalityTag | undefined;
  readonly through?: IncludeThroughDescriptor;
  readonly nested: CollectionState;
  readonly scalar: IncludeScalar<unknown> | undefined;
  readonly combine: Readonly<Record<string, IncludeCombineBranch>> | undefined;
}

export interface CollectionState {
  readonly filters: readonly AnyExpression[];
  readonly includes: readonly IncludeExpr[];
  readonly orderBy: readonly OrderByItem[] | undefined;
  readonly cursor: Readonly<Record<string, unknown>> | undefined;
  readonly distinct: readonly string[] | undefined;
  readonly distinctOn: readonly string[] | undefined;
  readonly selectedFields: readonly string[] | undefined;
  readonly limit: number | undefined;
  readonly offset: number | undefined;
  readonly variantName: string | undefined;
  /**
   * Annotations attached to this query at terminal-call time.
   * Populated transiently by terminal methods (`first`, `all`, `create`,
   * etc.) just before dispatch — `Collection` itself has no chainable
   * `.annotate()`. Stored as a `Map<namespace, AnnotationValue>` so
   * duplicate namespaces last-write-win. Empty on a fresh state.
   */
  readonly annotations: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>>;
}

export function emptyState(): CollectionState {
  return {
    filters: [],
    includes: [],
    orderBy: undefined,
    cursor: undefined,
    distinct: undefined,
    distinctOn: undefined,
    selectedFields: undefined,
    limit: undefined,
    offset: undefined,
    variantName: undefined,
    annotations: new Map(),
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
  readonly limit: number | undefined;
  readonly offset: number | undefined;
}

export function emptyGroupPagingState(): GroupPagingState {
  return { orderBy: [], limit: undefined, offset: undefined };
}

export interface CollectionTypeState {
  readonly hasOrderBy: boolean;
  readonly hasWhere: boolean;
  readonly hasUniqueFilter: boolean;
  readonly variantName: string | undefined;
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
  readonly hasOrderBy: false;
  readonly hasWhere: false;
  readonly hasUniqueFilter: false;
  readonly variantName: undefined;
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

export interface RuntimeQueryable extends RuntimeScope {
  connection?(): Promise<RuntimeConnection>;
  transaction?(): Promise<RuntimeTransaction>;
}

export interface CollectionContext<TContract extends Contract<SqlStorage>> {
  readonly runtime: RuntimeQueryable;
  readonly context: ExecutionContext<TContract>;
}

export type ComparisonMethodFns<T> = {
  eq(value: T): AnyExpression;
  neq(value: T): AnyExpression;
  gt(value: T): AnyExpression;
  lt(value: T): AnyExpression;
  gte(value: T): AnyExpression;
  lte(value: T): AnyExpression;
  like(pattern: string): AnyExpression;
  in(values: readonly T[]): AnyExpression;
  notIn(values: readonly T[]): AnyExpression;
  isNull(): AnyExpression;
  isNotNull(): AnyExpression;
  asc(): OrderByItem;
  desc(): OrderByItem;
};

/**
 * Trait-gated comparison methods. Only methods whose required traits are all present in `Traits` are included.
 *
 * - `traits: []` → always available (isNull, isNotNull)
 */
export type ComparisonMethods<T, Traits> = {
  [K in keyof ComparisonMethodsMeta as [ComparisonMethodsMeta[K]['traits'][number]] extends [Traits]
    ? K
    : never]: ComparisonMethodFns<T>[K];
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

type FieldOperations<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> =
  FieldCodecId<TContract, ModelName, FieldName> extends infer CodecId extends string
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

function param(codec: CodecRef | undefined, value: unknown): ParamRef {
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
    return new BinaryExpr(op, left, param(codec, value));
  }) satisfies MethodFactory;
}

function listComparisonMethod(op: BinaryOp) {
  return ((left, codec) => (values: readonly unknown[]) =>
    new BinaryExpr(op, left, paramList(codec, values))) satisfies MethodFactory;
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
    create: (left) => () => OrderByItem.asc(left),
  },
  desc: {
    traits: ['order'],
    create: (left) => () => OrderByItem.desc(left),
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

export type RelationPredicate<TContract extends Contract<SqlStorage>, ModelName extends string> = (
  model: ModelAccessor<TContract, ModelName>,
) => AnyExpression;

export type RelationPredicateInput<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = RelationPredicate<TContract, ModelName> | Record<string, unknown>;

export type RelationFilterAccessor<
  TContract extends Contract<SqlStorage>,
  RelatedModelName extends string,
> = {
  some(predicate?: RelationPredicateInput<TContract, RelatedModelName>): AnyExpression;
  every(predicate: RelationPredicateInput<TContract, RelatedModelName>): AnyExpression;
  none(predicate?: RelationPredicateInput<TContract, RelatedModelName>): AnyExpression;
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
      FieldJsType<TContract, ModelName, K, NsId>,
      FieldTraits<TContract, ModelName, K, NsId>
    > &
    FieldOperations<TContract, ModelName, K>;
};

type RelationModelAccessor<TContract extends Contract<SqlStorage>, ModelName extends string> = {
  [K in RelationNames<TContract, ModelName>]: RelationFilterAccessor<
    TContract,
    RelatedModelName<TContract, ModelName, K> & string
  >;
};

export type ModelAccessor<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = ScalarModelAccessor<TContract, ModelName, NsId> & RelationModelAccessor<TContract, ModelName>;

/**
 * The predicate accessor for a collection narrowed to a variant. When a real
 * variant is selected its (possibly MTI) fields and relations are merged onto
 * the base accessor so `t.variant('Feature').where(x => x.priority…)` and
 * `t.variant('Feature').where(x => x.assignee.some(…))` type-check; with no
 * variant the accessor is the plain base `ModelAccessor` and is unchanged.
 */
export type VariantAwareModelAccessor<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  VariantName extends string | undefined,
  NsId extends string = never,
> = [VariantName] extends [string]
  ? VariantName extends VariantNames<TContract, ModelName, NsId>
    ? ScalarModelAccessor<TContract, ModelName, NsId> &
        ScalarModelAccessor<TContract, VariantName, NsId> &
        RelationModelAccessor<TContract, ModelName> &
        RelationModelAccessor<TContract, VariantName>
    : ModelAccessor<TContract, ModelName, NsId>
  : ModelAccessor<TContract, ModelName, NsId>;

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
    ? V extends Record<string, { readonly value: string }>
      ? {
          [VK in keyof V]: VK extends string & CollectionModelName<TContract>
            ? Simplify<
                Omit<DefaultModelRow<TContract, ModelName, NsId>, DiscField> &
                  DefaultModelRow<TContract, VK, NsId> &
                  Record<DiscField, V[VK]['value']>
              >
            : never;
        }[keyof V]
      : DefaultModelRow<TContract, ModelName, NsId>
    : DefaultModelRow<TContract, ModelName, NsId>;

export type InferRootRow<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = VariantRow<TContract, ModelName, NsId>;

export type VariantNames<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> =
  ModelDef<TContract, ModelName, NsId> extends {
    readonly variants: infer V extends Record<string, unknown>;
  }
    ? keyof V & string
    : never;

export type VariantModelRow<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  VariantName extends string,
  NsId extends string = never,
> =
  ModelDef<TContract, ModelName, NsId> extends {
    readonly discriminator: { readonly field: infer DiscField extends string };
    readonly variants: infer V;
  }
    ? V extends Record<string, { readonly value: string }>
      ? VariantName extends keyof V & string & CollectionModelName<TContract>
        ? Simplify<
            Omit<DefaultModelRow<TContract, ModelName, NsId>, DiscField> &
              DefaultModelRow<TContract, VariantName, NsId> &
              Record<DiscField, V[VariantName]['value']>
          >
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

export type HavingComparisonMethods<T> = Pick<
  ComparisonMethods<T, 'equality' | 'order'>,
  'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte'
>;

/**
 * The value a HAVING comparison accepts. The comparison happens inside the
 * database, where the operand is an inlined numeric literal — so the
 * comparand stays `number` regardless of the result's application
 * representation. A field-taking metric compares as `number | null` — a
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

type FieldHavingCall<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Op extends string,
  NsId extends string,
> = <FieldName extends AggregateFieldNames<TContract, ModelName, Op, NsId>>(
  field: FieldName,
) => HavingComparisonMethods<number | null>;

type HavingMethod<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Op extends string,
  NsId extends string,
> =
  HasZeroArgCall<TContract, Op> extends true
    ? {
        (): HavingComparisonMethods<HavingZeroArgComparand<AggregateRowFor<TContract, Op, never>>>;
        <FieldName extends AggregateFieldNames<TContract, ModelName, Op, NsId>>(
          field: FieldName,
        ): HavingComparisonMethods<number | null>;
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
  ModelName extends string,
  NsId extends string = never,
> = Partial<{
  [K in keyof DefaultModelRow<TContract, ModelName, NsId> & string]:
    | DefaultModelRow<TContract, ModelName, NsId>[K]
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

type FieldsOf<
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

type FieldStorageColumn<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
  NsId extends string = never,
> = ResolvedStorageColumn<TContract, ModelName, FieldName, NsId>;

type FieldCodecId<
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

type FieldNullable<
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

type ExecutionDefaultEntry<TContract extends Contract<SqlStorage>> =
  TContract['execution'] extends {
    readonly mutations: {
      readonly defaults: infer Defaults;
    };
  }
    ? Defaults extends ReadonlyArray<unknown>
      ? Defaults[number]
      : never
    : never;

type HasExecutionCreateDefault<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
  NsId extends string = never,
> = [
  Extract<
    ExecutionDefaultEntry<TContract>,
    {
      // Execution-default refs are namespace-scoped. When a namespace is known
      // (e.g. a junction resolved through its declared `namespaceId`), the match
      // must include it so a same-named `table.column` in another namespace
      // cannot borrow this namespace's default. With no namespace (`never`), fall
      // back to table/column matching.
      readonly ref: {
        readonly table: ModelTableName<TContract, ModelName, NsId>;
        readonly column: FieldColumnName<TContract, ModelName, FieldName, NsId>;
      } & ([NsId] extends [never] ? unknown : { readonly namespace: NsId });
      readonly onCreate?: unknown;
    }
  >,
] extends [never]
  ? false
  : true;

type IsOptionalCreateField<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
  NsId extends string = never,
> =
  FieldStorageColumn<TContract, ModelName, FieldName, NsId> extends infer Column
    ? Column extends StorageColumn
      ? Column['nullable'] extends true
        ? true
        : Column extends { readonly default: unknown }
          ? true
          : HasExecutionCreateDefault<TContract, ModelName, FieldName, NsId>
      : HasExecutionCreateDefault<TContract, ModelName, FieldName, NsId>
    : HasExecutionCreateDefault<TContract, ModelName, FieldName, NsId>;

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

export type CreateInput<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = Pick<
  DefaultModelRow<TContract, ModelName, NsId>,
  RequiredCreateFieldNames<TContract, ModelName, NsId>
> &
  Partial<
    Pick<
      DefaultModelRow<TContract, ModelName, NsId>,
      OptionalCreateFieldNames<TContract, ModelName, NsId>
    >
  > &
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
  VariantName extends string,
  NsId extends string = never,
> = Omit<
  CreateInput<TContract, BaseModelName, NsId>,
  DiscriminatorFieldName<TContract, BaseModelName, NsId>
> &
  CreateInput<TContract, VariantName, NsId>;

export type ResolvedCreateInput<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  VName extends string | undefined,
  NsId extends string = never,
> =
  IsPolymorphicBase<TContract, ModelName, NsId> extends true
    ? VName extends string
      ? VariantCreateInput<TContract, ModelName, VName, NsId>
      : never
    : CreateInput<TContract, ModelName, NsId>;

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
> = FieldName extends keyof DefaultModelRow<TContract, ModelName>
  ? DefaultModelRow<TContract, ModelName>[FieldName]
  : unknown;

type CriterionFromConstraintColumns<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Columns extends readonly string[],
> = string extends Columns[number]
  ? Record<string, unknown>
  : {
      [C in Columns[number] as FieldNameForColumn<TContract, ModelName, C>]: RowValueForField<
        TContract,
        ModelName,
        FieldNameForColumn<TContract, ModelName, C>
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

type ConstraintFieldNames<TContract extends Contract<SqlStorage>, ModelName extends string> =
  ConstraintColumnsUnion<TContract, ModelName> extends infer Columns
    ? Columns extends readonly string[]
      ? FieldNameForColumn<TContract, ModelName, Columns[number]>
      : never
    : never;

/**
 * The field names a conflict target may name: every field participating in the
 * primary key or a unique constraint. A batched upsert names the constraint by
 * its fields rather than by a field-value record — no single row's values can
 * stand for the whole batch — so this is the flat name union rather than the
 * per-constraint record {@link UniqueConstraintCriterion} builds. A contract
 * whose constraint metadata is not statically known widens to every model
 * field, mirroring how that criterion widens to an open record.
 */
export type UniqueConstraintFieldName<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = [ConstraintFieldNames<TContract, ModelName>] extends [never]
  ? keyof DefaultModelRow<TContract, ModelName> & string
  : ConstraintFieldNames<TContract, ModelName>;

export interface UpsertAllOptions<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> {
  /**
   * Fields of the unique constraint that drives conflict resolution. Defaults
   * to the model's primary key.
   */
  readonly conflictOn?: readonly UniqueConstraintFieldName<TContract, ModelName>[];
  /**
   * Fields overwritten from the proposed row when a row conflicts. Defaults to
   * every non-conflict field the input rows carry. An empty list skips
   * conflicting rows, which are then absent from the result.
   */
  readonly update?: readonly (keyof DefaultModelRow<TContract, ModelName> & string)[];
}

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
  DefaultModelRow<TContract, ModelName, NsId>,
  NestedRequiredCreateFieldNames<TContract, ModelName, NsId>
> &
  Partial<
    Pick<
      DefaultModelRow<TContract, ModelName, NsId>,
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
> = Partial<DefaultModelRow<TContract, ModelName, NsId>> &
  RelationMutationFields<TContract, ModelName, 'update'>;

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

type SelectedVariantNames<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  VariantName,
  NsId extends string,
> = [VariantName] extends [string]
  ? string extends VariantName
    ? VariantNames<TContract, ModelName, NsId>
    : VariantName
  : never;

type VariantDeclaredRelationKeys<
  TContract extends Contract<SqlStorage>,
  VariantName extends string,
  NsId extends string,
> = VariantName extends string ? keyof RelationsOf<TContract, VariantName, NsId> : never;

type SelectedVariantDeclaredRelationKeys<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  VariantName,
  NsId extends string,
> = VariantDeclaredRelationKeys<
  TContract,
  SelectedVariantNames<TContract, ModelName, VariantName, NsId>,
  NsId
>;

export type VariantAwareIncludeRelationNames<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  VariantName,
  NsId extends string = never,
> =
  IsSingletonString<VariantName> extends true
    ?
        | RelationNames<TContract, Extract<VariantName, string>, NsId>
        | Exclude<
            RelationNames<TContract, ModelName, NsId>,
            keyof RelationsOf<TContract, Extract<VariantName, string>, NsId>
          >
    : [VariantName] extends [string]
      ? Exclude<
          RelationNames<TContract, ModelName, NsId>,
          SelectedVariantDeclaredRelationKeys<TContract, ModelName, VariantName, NsId>
        >
      : RelationNames<TContract, ModelName, NsId>;

export type IncludeRelationOwner<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  VariantName,
  RelName extends string,
  NsId extends string = never,
> =
  IsSingletonString<VariantName> extends true
    ? RelName extends keyof RelationsOf<TContract, Extract<VariantName, string>, NsId>
      ? Extract<VariantName, string>
      : ModelName
    : ModelName;

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
          ? N
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

type RelationLocalFieldColumns<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Relation,
> = Relation extends {
  readonly on: { readonly localFields: infer Fields extends readonly string[] };
}
  ? MapFieldsToColumns<TContract, ModelName, Fields>
  : readonly [];

type MapFieldsToColumns<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Fields extends readonly string[],
> = Fields extends readonly [infer Head extends string, ...infer Tail extends string[]]
  ? readonly [
      FieldColumnName<TContract, ModelName, Head>,
      ...MapFieldsToColumns<TContract, ModelName, Tail>,
    ]
  : readonly [];

type AnyColumnNullable<
  Columns extends Record<string, StorageColumn>,
  ColNames extends readonly string[],
> = ColNames extends readonly [infer Head extends string, ...infer Tail extends string[]]
  ? Head extends keyof Columns
    ? Columns[Head]['nullable'] extends true
      ? true
      : AnyColumnNullable<Columns, Tail>
    : true
  : false;

type HasForeignKeyForCols<
  FKs extends readonly unknown[],
  Cols extends readonly string[],
> = FKs extends readonly [infer Head, ...infer Tail extends unknown[]]
  ? Head extends { readonly source: { readonly columns: Cols } }
    ? true
    : HasForeignKeyForCols<Tail, Cols>
  : false;

type IsFkSideOfRelation<
  Table extends StorageTable,
  ParentCols extends readonly string[],
> = Table extends { readonly foreignKeys: infer FKs extends readonly unknown[] }
  ? HasForeignKeyForCols<FKs, ParentCols>
  : false;

type IsToOneRelationNullable<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  RelName extends string,
  NsId extends string = never,
> =
  ModelTableName<TContract, ModelName, NsId> extends infer TableName extends string
    ? NamespaceTableDef<
        TContract,
        TableName,
        ResolvedNsId<TContract, ModelName, NsId>
      > extends infer Table extends StorageTable
      ? RelationsOf<TContract, ModelName, NsId> extends infer Rels extends Record<string, unknown>
        ? RelName extends keyof Rels
          ? RelationLocalFieldColumns<
              TContract,
              ModelName,
              Rels[RelName]
            > extends infer Cols extends readonly string[]
            ? IsFkSideOfRelation<Table, Cols> extends true
              ? AnyColumnNullable<Table['columns'], Cols>
              : true
            : true
          : true
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
