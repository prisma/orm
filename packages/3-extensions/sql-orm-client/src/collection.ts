import type { Contract } from '@internal/contract/types';
import type {
  AnnotationValue,
  MetaBuilder,
  OperationKind,
} from '@internal/framework-components/runtime';
import { AsyncIterableResult, createMetaBuilder } from '@internal/framework-components/runtime';
import type { ExtractCodecTypes, SqlStorage } from '@internal/sql-contract/types';
import {
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  checkLimitOffset,
  isWhereExpr,
  LiteralExpr,
  LockingClause,
  type LockOptionCapabilities,
  type LockStrength,
  type LockStrengthCapabilities,
  type LockWaitOptions,
  type LockWaitRequest,
  lockIncompatible,
  lockOptionCapabilities,
  lockStrengthCapabilities,
  lockWaitPolicyOf,
  type OrderByItem,
  type ToWhereExpr,
  type WhereArg,
} from '@internal/sql-relational-core/ast';
import { type TraitExpression, toExpr } from '@internal/sql-relational-core/expression';
import type { Preparable } from '@internal/sql-relational-core/plan';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import type { SimplifyDeep } from '@internal/utils/simplify-deep';
import type { Simplify } from '@internal/utils/types';
import { createAggregateBuilder, isAggregateSelector } from './aggregate-builder';
import { resolveAggregate } from './aggregate-codecs';
import { emptyAggregateResult } from './aggregate-empty-result';
import { aggregateOperationNames } from './aggregate-operations';
import {
  mapCursorValuesToColumns,
  mapFieldsToColumns,
  mapSelectedFieldsToColumns,
} from './collection-column-mapping';
import {
  assertDistinctOnCapability,
  assertInsertConflictSkipCapability,
  assertLockCapability,
  assertReturningCapability,
  columnOfCallerField,
  fieldOfColumn,
  getModelAndVariantFieldColumns,
  getModelColumnFields,
  getModelFieldColumns,
  getOwnFieldColumns,
  isToOneCardinality,
  type PolymorphismInfo,
  type PolymorphismVariantInfo,
  resolveIncludeRelation,
  resolveInsertConflictColumns,
  resolveModelTableName,
  resolvePolymorphismInfo,
  resolvePrimaryKeyColumns,
  resolveRowIdentityColumns,
  resolveUpsertConflictColumns,
} from './collection-contract';
import {
  consumeFirstRow,
  describeCollectionFirst,
  describeCollectionFirstOrThrow,
  describeCollectionRows,
  dispatchCollectionRows,
} from './collection-dispatch';
import type {
  CollectionConstructor,
  CollectionInit,
  IncludedRelationsForRow,
  IncludeRefinementCollection,
  IncludeRefinementResult,
  IncludeRefinementValue,
  IsToManyRelation,
  WhereInput,
  WithVariantState,
  WithWhereState,
} from './collection-internal-types';
import {
  dispatchMutationRows,
  dispatchSplitMutationRows,
  executeMutationReturningSingleRow,
} from './collection-mutation-dispatch';
import {
  assertModelFieldNames,
  mapModelDataToStorageRow,
  mapPolymorphicRow,
} from './collection-runtime';
import type {
  CollectionRowOf,
  CollectionTypeStateOf,
  Filtered,
  HasNoVariant,
  HasOrderBy,
  HasRow,
  HasTypeState,
  HasWhere,
  Including,
  ModelFragmentReceiver,
  Ordered,
  QueryFragment,
  // biome-ignore lint/correctness/noUnusedImports: used in `declare` properties
  RowType,
  TypeState,
} from './collection-types';
import { shorthandToWhereExpr } from './filters';
import {
  assertFragmentBody,
  assertModelFragmentReceiver,
  assertModelFragmentSource,
  type FragmentFacts,
  type FragmentFactsType,
  type WithFacts,
} from './fragments';
import { GroupedCollection } from './grouped-collection';
import {
  createIncludeCombine,
  createIncludeScalar,
  isCollectionStateCarrier,
  isIncludeCombine,
  isIncludeScalar,
} from './include-descriptors';
import { assertLockCompatible } from './lock-guards';
import { createModelAccessor } from './model-accessor';
import {
  buildRowIdentityFilterFromRow,
  executeNestedCreateMutation,
  executeNestedUpdateMutation,
  hasNestedMutationCallbacks,
  withMutationScope,
} from './mutation-executor';
import { assertCursorCompatibleOrder, assertDistinctOnCompatibleOrder } from './order-by-guards';
import { ormError } from './orm-errors';
import type { PreparedCollection } from './prepared-collection';
import {
  compileAggregate,
  compileDeleteCount,
  compileDeleteReturning,
  compileInsertCount,
  compileInsertCountSplit,
  compileInsertReturning,
  compileInsertReturningSplit,
  compileUpdateCount,
  compileUpdateReturning,
  compileUpsertReturning,
  type InsertConflictSkip,
  mergeAnnotations,
} from './query-plan';
import { queryPlanRows } from './query-plan-rows';
import {
  type AggregateBuilder,
  type AggregateIncludeReducers,
  type AggregateResult,
  type AggregateSpec,
  type CollectionContext,
  type CollectionState,
  type CollectionTypeState,
  type DefaultCollectionTypeState,
  type DefaultModelRow,
  type DiscriminatorValues,
  emptyGroupPagingState,
  emptyState,
  type IncludeCombine,
  type IncludeCombineBranch,
  type IncludeExpr,
  type IncludeRelationOwner,
  type IncludeRelationValue,
  type IncludeScalar,
  type InferRootRow,
  type MutationCreateInput,
  type MutationCreateInputWithRelations,
  type MutationUpdateInput,
  type RelatedModelName,
  type RelationTargetNamespace,
  type ResolvedCreateInput,
  type ResolvedScalarCreateInput,
  type RuntimeQueryable,
  type ShorthandWhereFilter,
  type UniqueConstraintCriterion,
  type VariantAwareIncludeRelationNames,
  type VariantAwareModelAccessor,
  type VariantModelRow,
  type VariantNameForValue,
  type WithNsId,
} from './types';
import { normalizeWhereArg } from './where-interop';
import { assertBulkWriteIgnoresNothing, assertRelationUpdateIgnoresNothing } from './write-guards';

function applyCreateDefaults(
  ctx: CollectionContext<Contract<SqlStorage>>,
  namespaceId: string,
  tableName: string,
  rows: Record<string, unknown>[],
  defaultValueCache = new Map<string, unknown>(),
): void {
  for (const row of rows) {
    const applied = ctx.context.applyMutationDefaults({
      op: 'create',
      entry: tableName,
      namespace: namespaceId,
      values: row,
      defaultValueCache,
    });
    for (const def of applied) {
      row[def.field] = def.value;
    }
  }
}

function applyUpdateDefaults(
  ctx: CollectionContext<Contract<SqlStorage>>,
  namespaceId: string,
  tableName: string,
  values: Record<string, unknown>,
): void {
  const applied = ctx.context.applyMutationDefaults({
    op: 'update',
    entry: tableName,
    namespace: namespaceId,
    values,
  });
  for (const def of applied) {
    values[def.field] = def.value;
  }
}

type WhereDirectInput = WhereArg;

type LockMethodArgs<
  Capabilities,
  Strength extends LockStrength,
> = Capabilities extends LockStrengthCapabilities[Strength] & LockOptionCapabilities['of']
  ? [options?: LockWaitOptions<Capabilities>]
  : never;

function isToWhereExprInput(value: unknown): value is ToWhereExpr {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toWhereExpr' in value &&
    typeof value.toWhereExpr === 'function'
  );
}

function isWhereDirectInput(value: unknown): value is WhereDirectInput {
  return (
    (isWhereExpr(value) &&
      typeof value === 'object' &&
      value !== null &&
      'accept' in value &&
      typeof value.accept === 'function') ||
    isToWhereExprInput(value)
  );
}

type WriteConfigure = (meta: MetaBuilder<'write'>) => void;

/**
 * Ask the database to skip rows that collide with a unique constraint
 * instead of failing the whole statement.
 *
 * `conflictOn` names the scalar fields of the constraint to watch; omit
 * it to skip on any unique constraint of the table. Requires the
 * contract capability `insertOnConflictSkip`, and
 * `insertOnConflictWithoutTarget` as well when `conflictOn` is omitted.
 */
export interface CreateConflictOptions<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> {
  readonly onConflict: 'skip';
  readonly conflictOn?: readonly (keyof DefaultModelRow<TContract, ModelName> & string)[];
}

function splitCreateArguments<TContract extends Contract<SqlStorage>, ModelName extends string>(
  optionsOrConfigure: CreateConflictOptions<TContract, ModelName> | WriteConfigure | undefined,
  configure: WriteConfigure | undefined,
): {
  options: CreateConflictOptions<TContract, ModelName> | undefined;
  configureCallback: WriteConfigure | undefined;
} {
  if (typeof optionsOrConfigure === 'function') {
    return { options: undefined, configureCallback: optionsOrConfigure };
  }
  return { options: optionsOrConfigure, configureCallback: configure };
}

type MtiVariantInfo = Simplify<PolymorphismVariantInfo & { readonly strategy: 'mti' }>;

function isMtiVariantInfo(variant: PolymorphismVariantInfo | undefined): variant is MtiVariantInfo {
  return variant?.strategy === 'mti';
}

interface MtiCreateContext {
  polyInfo: PolymorphismInfo;
  variant: MtiVariantInfo;
  baseFieldToColumn: Readonly<Record<string, string>>;
  variantFieldToColumn: Readonly<Record<string, string>>;
  mergedFieldToColumn: Readonly<Record<string, string>>;
  pkColumns: readonly string[];
}

/** What `fragment` reads from the collection it is called on: its contract, its model and its query state. */
interface FragmentSource {
  readonly modelName: string;
  readonly namespaceId: string;
  readonly state: CollectionState;
  readonly ctx: { readonly context: { readonly contract: Contract<SqlStorage> } };
}

type ContractOf<C extends FragmentSource> = C['ctx']['context']['contract'];

type ModelNameOf<C extends FragmentSource> = C['modelName'];

/** The compile error `fragment` gives on a collection whose type records a filter, an order or an include. */
interface FragmentNeedsRootCollection {
  readonly fragmentNeedsRootCollection: 'the fragment is built from the model alone, so call fragment on the root collection of the model';
}

type HasRowBeyondModel<Self extends FragmentSource, NsId extends string> = Self extends HasRow
  ? [
      Exclude<
        keyof CollectionRowOf<Self>,
        keyof DefaultModelRow<ContractOf<Self>, ModelNameOf<Self>, NsId>
      >,
    ] extends [never]
    ? false
    : true
  : false;

type RootCollectionOnly<Self extends FragmentSource, NsId extends string> = Self extends
  | HasWhere
  | HasOrderBy
  ? FragmentNeedsRootCollection
  : HasRowBeyondModel<Self, NsId> extends true
    ? FragmentNeedsRootCollection
    : unknown;

type ModelFragmentBody<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string,
> = [NsId] extends [never]
  ? Collection<TContract, ModelName>
  : Collection<
      TContract,
      ModelName,
      InferRootRow<TContract, ModelName, NsId>,
      WithNsId<DefaultCollectionTypeState, NsId>
    >;

export class CollectionBase<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Row = SimplifyDeep<InferRootRow<TContract, ModelName>>,
  State extends CollectionTypeState = DefaultCollectionTypeState,
> implements HasRow<Row>, HasTypeState<State>
{
  declare readonly [TypeState]: State;
  declare readonly [RowType]: Row;
  declare readonly _row?: CollectionRowOf<this>;
  /** @internal */
  readonly ctx: CollectionContext<TContract>;
  /** @internal */
  private readonly contract: TContract;
  /** @internal */
  readonly modelName: ModelName;
  /** @internal */
  readonly tableName: string;
  /** @internal */
  readonly namespaceId: State['nsId'];
  /** @internal */
  readonly state: CollectionState;
  /** @internal */
  readonly registry: ReadonlyMap<string, CollectionConstructor<TContract>>;
  /** @internal */
  readonly includeRefinementMode: boolean;

  constructor(
    ctx: CollectionContext<TContract>,
    modelName: ModelName,
    options: CollectionInit<TContract>,
  ) {
    this.ctx = ctx;
    this.contract = ctx.context.contract;
    this.modelName = modelName;
    this.namespaceId = options.namespaceId;
    this.tableName =
      options.tableName ?? resolveModelTableName(this.contract, options.namespaceId, modelName);
    this.state = options.state ?? emptyState();
    this.registry = options.registry ?? new Map<string, CollectionConstructor<TContract>>();
    this.includeRefinementMode = options.includeRefinementMode ?? false;
    this.#installAggregateReducers();
  }

  /**
   * Install one include-scalar reducer per operation the composed registry
   * contributes — the runtime mirror of the contract's emitted aggregate map,
   * which is what types the reducers as {@link AggregateIncludeReducers} on
   * the public {@link Collection} surface. The reducers live on the instance
   * because their names are the registry's, not the class declaration's.
   *
   * A name the collection already carries is skipped, and which member holds
   * it decides what the skip means. A `CollectionBase` member is rejected at
   * ORM composition with `ORM.AGGREGATE_OPERATION_RESERVED`, since
   * {@link reservedCollectionMemberNames} scans this class. A member declared
   * by a custom collection class registered through `orm({ collections })`
   * falls outside that set, so it keeps the name and the operation gets no
   * reducer. The type level is what guards that case: {@link Collection}
   * intersects the class with {@link AggregateIncludeReducers}, so for any
   * contract whose emitted map carries the operation, a subclass member that
   * does not match the reducer's signature is a type error.
   */
  #installAggregateReducers(): void {
    for (const operation of aggregateOperationNames(this.ctx.context.aggregateDescriptors)) {
      if (operation in this) {
        continue;
      }
      Object.defineProperty(this, operation, {
        value: (field?: string) => this.#includeScalarReducer(operation, field),
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
  }

  /**
   * Scalar reducer — reduces a to-many relation to the operation's value over
   * the related rows. Use inside an `include(...)` refinement callback as
   * `include(..., (rel) => rel.count())`; throws if called elsewhere. The
   * parent row's relation field becomes that value instead of an array. A
   * call without a field aggregates over rows; a call with one aggregates the
   * field's storage column.
   */
  #includeScalarReducer(operation: string, field: string | undefined): IncludeScalar<unknown> {
    this.#assertIncludeRefinementMode(`${operation}()`);
    const column =
      field === undefined
        ? undefined
        : columnOfCallerField(
            this.contract,
            this.namespaceId,
            getModelFieldColumns(this.contract, this.namespaceId, this.modelName),
            this.modelName,
            field,
          );
    return createIncludeScalar(operation, this.state, column);
  }

  /**
   * Narrow the collection with a `WHERE` predicate. Returns a new
   * collection — chain further builders or run a terminal on it.
   *
   * Accepts a callback receiving a typed model accessor, a raw
   * `WhereArg` expression, or a shorthand field/value object. Multiple
   * calls are AND-combined.
   *
   * ```typescript
   * // Callback form with column-level operators:
   * const matches = await db.orm.User.where((u) => u.email.eq('alice@example.com')).all();
   *
   * // Shorthand object form:
   * const user = await db.orm.User.where({ id: 1, active: true }).first();
   *
   * // Chained AND — still a builder, run a terminal to execute:
   * const adults = await db.orm.User.where({ active: true }).where((u) => u.age.gt(18)).all();
   * ```
   */
  where<Self>(
    this: Self,
    fn: (
      model: VariantAwareModelAccessor<TContract, ModelName, State['variantName'], State['nsId']>,
    ) => WhereDirectInput,
  ): Filtered<Self>;
  where<Self>(this: Self, input: WhereDirectInput): Filtered<Self>;
  where<Self>(
    this: Self,
    filters: ShorthandWhereFilter<TContract, State['nsId'], ModelName>,
  ): Filtered<Self>;
  where(
    input:
      | WhereDirectInput
      | ((
          model: VariantAwareModelAccessor<
            TContract,
            ModelName,
            State['variantName'],
            State['nsId']
          >,
        ) => WhereDirectInput)
      | ShorthandWhereFilter<TContract, State['nsId'], ModelName>,
  ): Filtered<this> {
    const whereArg =
      typeof input === 'function'
        ? input(
            createModelAccessor<TContract, ModelName, State['variantName'], State['nsId']>(
              this.ctx.context,
              this.namespaceId,
              this.modelName,
              this.state.variantName,
            ),
          )
        : isWhereDirectInput(input)
          ? input
          : shorthandToWhereExpr(this.ctx.context, this.namespaceId, this.modelName, input);
    const filter = normalizeWhereArg(whereArg, {
      contract: this.contract,
      namespaceId: this.namespaceId,
    });

    if (!filter) {
      return blindCast<
        Filtered<this>,
        'where() records its static state even when normalization produces no filter'
      >(this);
    }

    return this.#cloneSelf<HasWhere>({
      filters: [...this.state.filters, filter],
    });
  }

  /**
   * Call `fn`, a query fragment, with this collection and return its result. `fn` may be a scope, which only imposes conditions and declares the fields it needs, or a fragment for what `where` cannot express, such as a shared `select` and `include`, an order or a limit. A condition on one row that needs no declared fields is `where(rowFragment)`. For a fragment made by the client's `fragment` method, the result is this collection's own type plus the filter and order the fragment's body established.
   */
  with<Self, Facts extends FragmentFacts>(
    this: Self,
    fragment: ((collection: NoInfer<Self>) => unknown) & { readonly [FragmentFactsType]: Facts },
  ): WithFacts<Self, Facts>;
  with<Self, Out>(this: Self, fn: (collection: Self) => Out): Out;
  with(fn: (collection: unknown) => unknown): unknown {
    return fn(this);
  }

  /**
   * Define a query fragment for this collection's model, such as a shared `select` and `include`. The body is typed once, against the model's plain collection. The fragment can be applied to any collection of the model that `select` and `variant` have not narrowed.
   *
   * The fragment is built from the model alone, so call `fragment` on the model's root collection. On a collection with chained calls it throws `ORM.ARGUMENT_INVALID`. The type check is partial: it refuses a collection whose type records a filter, an order or an include, and a collection typed by a type parameter, such as `this` in a class method; it does not see `limit`, `offset`, `select`, `cursor`, `distinct`, `variant` or a lock, a union with a root collection, or a value typed as the plain collection.
   *
   * ```ts
   * const summary = db.Post.fragment((posts) => posts.select('id', 'title').include('user'));
   * db.User.include('posts', (posts) => posts.with(summary));
   * ```
   */
  fragment<Self extends FragmentSource, NsId extends string, Result>(
    this: Self & HasTypeState<{ readonly nsId: NsId }> & RootCollectionOnly<Self, NsId>,
    body: (collection: ModelFragmentBody<ContractOf<Self>, ModelNameOf<Self>, NsId>) => Result,
  ): QueryFragment<ModelFragmentReceiver<ContractOf<Self>, ModelNameOf<Self>, NsId>, Result> {
    assertFragmentBody(body);
    assertModelFragmentSource(this);
    const source = { modelName: this.modelName, namespaceId: this.namespaceId };
    return (collection) => {
      assertModelFragmentReceiver(source, collection);
      return body(
        blindCast<
          ModelFragmentBody<ContractOf<Self>, ModelNameOf<Self>, NsId>,
          'a collection of this model that select and variant have not narrowed has the methods of its plain collection'
        >(collection),
      );
    };
  }

  /**
   * Narrow a polymorphic model to the variant declared with the given
   * discriminator value. The returned collection has the variant's row
   * shape and a discriminator filter is automatically applied. Call
   * `.variant(...)` once, on the base collection: a collection that
   * already has a variant selected refuses it. To select a different
   * variant, start again from the base collection.
   *
   * ```typescript
   * // Read only admin users (STI):
   * const admins = await db.orm.User.variant('admin').all();
   *
   * // Iterate the rows:
   * for await (const admin of db.orm.User.variant('admin').all()) {
   *   console.log(admin.role);
   * }
   *
   * // Insert under a variant — discriminator is injected automatically:
   * await db.orm.User.variant('admin').create({ name: 'Ada', role: 'super' });
   * ```
   */
  variant<
    V extends DiscriminatorValues<TContract, ModelName>,
    S extends CollectionTypeState = State,
  >(
    this: HasTypeState<S> & HasNoVariant,
    value: V,
  ): Collection<
    TContract,
    ModelName,
    VariantModelRow<TContract, ModelName, VariantNameForValue<TContract, ModelName, V>>,
    WithVariantState<WithWhereState<S>, VariantNameForValue<TContract, ModelName, V>>
  >;
  variant<V extends DiscriminatorValues<TContract, ModelName>>(
    this: HasNoVariant,
    value: V,
  ): Collection<
    TContract,
    ModelName,
    VariantModelRow<TContract, ModelName, VariantNameForValue<TContract, ModelName, V>>,
    WithVariantState<WithWhereState<State>, VariantNameForValue<TContract, ModelName, V>>
  >;
  variant<V extends DiscriminatorValues<TContract, ModelName>>(
    value: V,
  ): Collection<
    TContract,
    ModelName,
    VariantModelRow<TContract, ModelName, VariantNameForValue<TContract, ModelName, V>>,
    WithVariantState<WithWhereState<State>, VariantNameForValue<TContract, ModelName, V>>
  > {
    type VariantName = VariantNameForValue<TContract, ModelName, V>;
    const polyInfo = resolvePolymorphismInfo(this.contract, this.namespaceId, this.modelName);
    const selectedVariantName = this.state.variantName;

    if (selectedVariantName !== undefined) {
      const selectedValue = polyInfo?.variants.get(selectedVariantName)?.value;
      throw ormError(
        'ORM.OPERATION_UNSUPPORTED',
        `variant("${value}") cannot be called on model "${this.modelName}" because variant("${selectedValue}") is already selected; call variant() on the base collection instead`,
        {
          meta: {
            method: 'variant',
            model: this.modelName,
            variant: selectedVariantName,
            selectedValue,
            reason: 'variant-already-selected',
          },
        },
      );
    }

    const variantInfo = polyInfo?.variantsByValue.get(value);

    if (!polyInfo || !variantInfo) {
      const declaredValues = [...(polyInfo?.variantsByValue.keys() ?? [])];
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        declaredValues.length === 0
          ? `variant("${value}") cannot narrow model "${this.modelName}": it declares no discriminator values`
          : `variant("${value}") cannot narrow model "${this.modelName}": the declared discriminator values are ${declaredValues.map((declared) => `"${declared}"`).join(', ')}`,
        {
          meta: {
            method: 'variant',
            argument: 'value',
            model: this.modelName,
            value,
            declaredValues,
          },
        },
      );
    }

    const columnName = polyInfo.discriminatorColumn;
    const filter = BinaryExpr.eq(
      ColumnRef.of(this.tableName, columnName),
      LiteralExpr.of(variantInfo.value),
    );

    return this.#cloneWithRow<
      VariantModelRow<TContract, ModelName, VariantName>,
      WithVariantState<WithWhereState<State>, VariantName>
    >({
      filters: [...this.state.filters, filter],
      variantName: variantInfo.modelName,
    });
  }

  /**
   * Eagerly load a related model. The relation appears on every
   * returned row under its declared name; to-one relations are mapped
   * to a single object (or `null`), to-many relations to an array.
   *
   * An optional refinement callback receives a child collection that
   * can be further constrained, projected, ordered, paginated, or
   * reduced to scalars via `count()`/`sum()`/etc. or to multiple
   * sub-aggregates via `combine()`.
   *
   * ```typescript
   * // Simple include — every user comes back with its posts array:
   * const users = await db.orm.User.include('posts').all();
   *
   * // Refine the related collection:
   * const withRecent = await db.orm.User.include('posts', (posts) =>
   *   posts.where({ published: true }).orderBy((p) => p.createdAt.desc()).limit(5),
   * ).all();
   *
   * // Reduce a to-many relation to a scalar value:
   * const withCounts = await db.orm.User.include('posts', (posts) => posts.count()).all();
   *
   * // Multiple sub-views via combine():
   * const overview = await db.orm.User.include('posts', (posts) =>
   *   posts.combine({ recent: posts.limit(3), total: posts.count() }),
   * ).all();
   * ```
   */
  include<
    RelName extends VariantAwareIncludeRelationNames<
      TContract,
      ModelName,
      State['variantName'],
      State['nsId']
    >,
    RelationOwner extends string = IncludeRelationOwner<
      TContract,
      ModelName,
      State['variantName'],
      RelName,
      State['nsId']
    > &
      string,
    RelatedName extends RelatedModelName<TContract, RelationOwner, RelName, State['nsId']> &
      string = RelatedModelName<TContract, RelationOwner, RelName, State['nsId']> & string,
    TargetNs extends string = RelationTargetNamespace<
      TContract,
      RelationOwner,
      RelName,
      State['nsId']
    >,
    Self extends HasRow = never,
  >(
    this: Self,
    relationName: RelName,
  ): Including<
    Self,
    {
      [K in RelName]: IncludeRelationValue<
        TContract,
        RelationOwner,
        K,
        SimplifyDeep<InferRootRow<TContract, RelatedName, TargetNs>>,
        State['nsId']
      >;
    }
  >;
  include<
    RelName extends VariantAwareIncludeRelationNames<
      TContract,
      ModelName,
      State['variantName'],
      State['nsId']
    >,
    RelationOwner extends string = IncludeRelationOwner<
      TContract,
      ModelName,
      State['variantName'],
      RelName,
      State['nsId']
    > &
      string,
    RelatedName extends RelatedModelName<TContract, RelationOwner, RelName, State['nsId']> &
      string = RelatedModelName<TContract, RelationOwner, RelName, State['nsId']> & string,
    TargetNs extends string = RelationTargetNamespace<
      TContract,
      RelationOwner,
      RelName,
      State['nsId']
    >,
    IsToMany extends boolean = IsToManyRelation<TContract, RelationOwner, RelName, State['nsId']>,
    RefinedResult extends IncludeRefinementResult<
      TContract,
      RelatedName,
      IsToMany
    > = IncludeRefinementCollection<
      TContract,
      RelatedName,
      SimplifyDeep<InferRootRow<TContract, RelatedName, TargetNs>>,
      CollectionTypeState,
      IsToMany
    >,
    Self extends HasRow = never,
  >(
    this: Self,
    relationName: RelName,
    refineFn: (
      collection: IncludeRefinementCollection<
        TContract,
        RelatedName,
        SimplifyDeep<InferRootRow<TContract, RelatedName, TargetNs>>,
        DefaultCollectionTypeState,
        IsToMany
      >,
    ) => RefinedResult,
  ): Including<
    Self,
    {
      [K in RelName]: IncludeRefinementValue<
        TContract,
        RelationOwner,
        K,
        SimplifyDeep<InferRootRow<TContract, RelatedName, TargetNs>>,
        RefinedResult,
        State['nsId']
      >;
    }
  >;
  include<
    RelName extends VariantAwareIncludeRelationNames<
      TContract,
      ModelName,
      State['variantName'],
      State['nsId']
    >,
    RelationOwner extends string = IncludeRelationOwner<
      TContract,
      ModelName,
      State['variantName'],
      RelName,
      State['nsId']
    > &
      string,
    RelatedName extends RelatedModelName<TContract, RelationOwner, RelName, State['nsId']> &
      string = RelatedModelName<TContract, RelationOwner, RelName, State['nsId']> & string,
    TargetNs extends string = RelationTargetNamespace<
      TContract,
      RelationOwner,
      RelName,
      State['nsId']
    >,
    IsToMany extends boolean = IsToManyRelation<TContract, RelationOwner, RelName, State['nsId']>,
    RefinedResult extends IncludeRefinementResult<
      TContract,
      RelatedName,
      IsToMany
    > = IncludeRefinementCollection<
      TContract,
      RelatedName,
      SimplifyDeep<InferRootRow<TContract, RelatedName, TargetNs>>,
      CollectionTypeState,
      IsToMany
    >,
  >(
    relationName: RelName,
    refineFn?: (
      collection: IncludeRefinementCollection<
        TContract,
        RelatedName,
        SimplifyDeep<InferRootRow<TContract, RelatedName, TargetNs>>,
        DefaultCollectionTypeState,
        IsToMany
      >,
    ) => RefinedResult,
  ): Collection<
    TContract,
    ModelName,
    SimplifyDeep<
      Row & {
        [K in RelName]: IncludeRefinementValue<
          TContract,
          RelationOwner,
          K,
          SimplifyDeep<InferRootRow<TContract, RelatedName, TargetNs>>,
          RefinedResult,
          State['nsId']
        >;
      }
    >,
    CollectionTypeStateOf<this>
  > {
    const relation = resolveIncludeRelation(
      this.contract,
      this.namespaceId,
      this.modelName,
      relationName,
      this.state.variantName,
    );

    let nestedState = emptyState();
    let scalarSelector: IncludeScalar<unknown> | undefined;
    let combineBranches: Readonly<Record<string, IncludeCombineBranch>> | undefined;

    if (refineFn) {
      const nestedCollection = this.#createCollection<
        RelatedName,
        SimplifyDeep<InferRootRow<TContract, RelatedName, TargetNs>>,
        DefaultCollectionTypeState
      >(
        blindCast<RelatedName, 'resolved include target matches the type-level relation owner'>(
          relation.relatedModelName,
        ),
        {
          tableName: relation.relatedTableName,
          namespaceId: relation.relatedNamespaceId,
          state: emptyState(),
          includeRefinementMode: true,
        },
      );
      const refined = refineFn(nestedCollection);

      if (isIncludeScalar(refined)) {
        if (isToOneCardinality(relation.cardinality)) {
          throw ormError(
            'ORM.INCLUDE_UNSUPPORTED',
            `include('${relationName}') scalar aggregations are only supported for to-many relations`,
            { meta: { relation: relationName, kind: 'scalar' } },
          );
        }
        scalarSelector = refined;
        nestedState = refined.state;
      } else if (isIncludeCombine(refined)) {
        if (isToOneCardinality(relation.cardinality)) {
          throw ormError(
            'ORM.INCLUDE_UNSUPPORTED',
            `include('${relationName}') combine() is only supported for to-many relations`,
            { meta: { relation: relationName, kind: 'combine' } },
          );
        }
        combineBranches = refined.branches;
      } else if (isCollectionStateCarrier(refined)) {
        nestedState = refined.state;
      } else {
        throw ormError(
          'ORM.INCLUDE_INVALID',
          `include('${relationName}') refinement must return a collection, include scalar selector, or combine() descriptor`,
          { meta: { relation: relationName } },
        );
      }
    }

    const includeExpr: IncludeExpr = {
      relationName,
      relatedModelName: relation.relatedModelName,
      relatedNamespaceId: relation.relatedNamespaceId,
      relatedTableName: relation.relatedTableName,
      localTableName: relation.localTableName,
      targetColumns: relation.targetColumns,
      localColumns: relation.localColumns,
      cardinality: relation.cardinality,
      ...ifDefined('through', relation.through),
      nested: nestedState,
      scalar: scalarSelector,
      combine: combineBranches,
    };

    return this.#cloneWithRow<
      SimplifyDeep<
        Row & {
          [K in RelName]: IncludeRefinementValue<
            TContract,
            RelationOwner,
            K,
            SimplifyDeep<InferRootRow<TContract, RelatedName, TargetNs>>,
            RefinedResult,
            State['nsId']
          >;
        }
      >,
      CollectionTypeStateOf<this>
    >({
      includes: [...this.state.includes, includeExpr],
    });
  }

  /**
   * Project the row down to a subset of scalar fields. Previously
   * included relations are preserved on the resulting row shape; only
   * scalar columns are narrowed.
   *
   * ```typescript
   * const summaries = await db.orm.User.select('id', 'email').all();
   * // typeof summaries[number] === { id: ...; email: ... }
   *
   * for await (const row of db.orm.User.select('id', 'email').all()) {
   *   console.log(row.id, row.email);
   * }
   * ```
   */
  select<
    Fields extends readonly [
      keyof DefaultModelRow<TContract, ModelName> & string,
      ...(keyof DefaultModelRow<TContract, ModelName> & string)[],
    ],
    S extends CollectionTypeState = State,
    R = Row,
  >(
    this: HasTypeState<S> & HasRow<R>,
    ...fields: Fields
  ): Collection<
    TContract,
    ModelName,
    SimplifyDeep<
      Pick<DefaultModelRow<TContract, ModelName>, Fields[number]> &
        IncludedRelationsForRow<TContract, ModelName, R>
    >,
    S
  >;
  select<
    Fields extends readonly [
      keyof DefaultModelRow<TContract, ModelName> & string,
      ...(keyof DefaultModelRow<TContract, ModelName> & string)[],
    ],
  >(
    ...fields: Fields
  ): Collection<
    TContract,
    ModelName,
    SimplifyDeep<
      Pick<DefaultModelRow<TContract, ModelName>, Fields[number]> &
        IncludedRelationsForRow<TContract, ModelName, Row>
    >,
    State
  >;
  select<
    Fields extends readonly [
      keyof DefaultModelRow<TContract, ModelName> & string,
      ...(keyof DefaultModelRow<TContract, ModelName> & string)[],
    ],
  >(
    ...fields: Fields
  ): Collection<
    TContract,
    ModelName,
    SimplifyDeep<
      Pick<DefaultModelRow<TContract, ModelName>, Fields[number]> &
        IncludedRelationsForRow<TContract, ModelName, Row>
    >,
    State
  > {
    const selectedFields = mapSelectedFieldsToColumns(
      this.contract,
      this.namespaceId,
      this.modelName,
      this.state.variantName,
      fields,
    );

    return this.#cloneWithRow<
      SimplifyDeep<
        Pick<DefaultModelRow<TContract, ModelName>, Fields[number]> &
          IncludedRelationsForRow<TContract, ModelName, Row>
      >,
      State
    >({
      selectedFields,
    });
  }

  /**
   * Append an `ORDER BY` clause. Pass a single selector callback or an
   * array of callbacks; each receives a typed model accessor whose
   * columns expose `.asc()` and `.desc()`. Multiple calls append to the
   * existing list (left-to-right ordering preserved).
   *
   * Calling `orderBy(...)` unlocks `cursor(...)` and `distinctOn(...)`,
   * which both require a defined sort order.
   *
   * ```typescript
   * const newest = await db.orm.User.orderBy((u) => u.createdAt.desc()).all();
   *
   * const byName = await db.orm.User
   *   .orderBy([(u) => u.lastName.asc(), (u) => u.firstName.asc()])
   *   .all();
   * ```
   */
  orderBy<Self>(
    this: Self,
    selection:
      | ((
          model: VariantAwareModelAccessor<
            TContract,
            ModelName,
            State['variantName'],
            State['nsId']
          >,
        ) => OrderByItem)
      | ReadonlyArray<
          (
            model: VariantAwareModelAccessor<
              TContract,
              ModelName,
              State['variantName'],
              State['nsId']
            >,
          ) => OrderByItem
        >,
  ): Ordered<Self>;
  orderBy(
    selection:
      | ((
          model: VariantAwareModelAccessor<
            TContract,
            ModelName,
            State['variantName'],
            State['nsId']
          >,
        ) => OrderByItem)
      | ReadonlyArray<
          (
            model: VariantAwareModelAccessor<
              TContract,
              ModelName,
              State['variantName'],
              State['nsId']
            >,
          ) => OrderByItem
        >,
  ): Ordered<this> {
    const accessor = createModelAccessor<TContract, ModelName, State['variantName'], State['nsId']>(
      this.ctx.context,
      this.namespaceId,
      this.modelName,
      this.state.variantName,
    );
    const selectors = Array.isArray(selection) ? selection : [selection];
    const nextOrders = selectors.map((selector) => selector(accessor));
    const existing = this.state.orderBy ?? [];
    return this.#cloneSelf<HasOrderBy>({
      orderBy: [...existing, ...nextOrders],
    });
  }

  /**
   * Switch to grouped-aggregate mode. Returns a `GroupedCollection`
   * whose `.aggregate(...)` terminal produces one row per group with
   * the chosen key columns plus the requested aggregates.
   *
   * ```typescript
   * const stats = await db.orm.Post
   *   .where({ published: true })
   *   .groupBy('userId')
   *   .aggregate((agg) => ({ count: agg.count(), totalViews: agg.sum('views') }));
   * // [{ userId: 1, count: 3, totalViews: 120 }, ...]
   * ```
   */
  groupBy<
    Fields extends readonly [
      keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string,
      ...(keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string)[],
    ],
  >(...fields: Fields): GroupedCollection<TContract, ModelName, Fields, State['nsId']> {
    assertLockCompatible(this.state, 'groupBy');
    const groupByColumns = mapFieldsToColumns(
      this.contract,
      this.namespaceId,
      this.modelName,
      fields,
    );

    return new GroupedCollection(this.ctx, this.modelName, {
      tableName: this.tableName,
      namespaceId: this.namespaceId,
      preGroupState: this.state,
      groupByFields: [...fields],
      groupByColumns,
      havingFilters: [],
      postGroup: emptyGroupPagingState(),
    });
  }

  /**
   * Produce multiple named sub-views of a to-many relation in a
   * single `include(...)`. Each branch is either another refined
   * collection (mapped to a row array on the parent) or a scalar
   * reducer such as `count()`/`sum(...)`. Only valid inside an
   * `include(...)` refinement callback for to-many relations.
   *
   * ```typescript
   * const users = await db.orm.User.include('posts', (posts) =>
   *   posts.combine({
   *     recent: posts.where({ published: true }).limit(3),
   *     total: posts.count(),
   *     averageViews: posts.avg('views'),
   *   }),
   * ).all();
   * // each user row: {
   * //   ...user,
   * //   posts: { recent: Post[]; total: number; averageViews: number | null };
   * // }
   * ```
   */
  combine<
    Spec extends Record<
      string,
      | IncludeRefinementCollection<TContract, ModelName, unknown, CollectionTypeState, true>
      | IncludeScalar<unknown>
    >,
  >(
    spec: Spec,
  ): IncludeCombine<{
    [K in keyof Spec]: Spec[K] extends IncludeScalar<infer ScalarResult>
      ? ScalarResult
      : Spec[K] extends HasRow
        ? CollectionRowOf<Spec[K]>[]
        : never;
  }> {
    this.#assertIncludeRefinementMode('combine()');

    const branches: Record<string, IncludeCombineBranch> = {};
    for (const [name, value] of Object.entries(spec)) {
      if (isIncludeScalar(value)) {
        branches[name] = {
          kind: 'scalar',
          selector: value,
        };
        continue;
      }

      if (isCollectionStateCarrier(value)) {
        branches[name] = {
          kind: 'rows',
          state: value.state,
        };
        continue;
      }

      throw ormError('ORM.INCLUDE_INVALID', `include().combine() branch "${name}" is invalid`, {
        meta: { branch: name },
      });
    }

    return createIncludeCombine<{
      [K in keyof Spec]: Spec[K] extends IncludeScalar<infer ScalarResult>
        ? ScalarResult
        : Spec[K] extends HasRow
          ? CollectionRowOf<Spec[K]>[]
          : never;
    }>(branches);
  }

  /**
   * Resume pagination from a known cursor position. Requires a prior
   * `orderBy(...)` so the cursor has a stable basis; provide a value
   * for every column referenced by the active `orderBy(...)` so each
   * ordered axis has a defined boundary.
   *
   * ```typescript
   * const page1 = await db.orm.Post
   *   .orderBy((p) => p.createdAt.desc())
   *   .limit(20)
   *   .all();
   *
   * const last = page1[page1.length - 1]!;
   * const page2 = await db.orm.Post
   *   .orderBy((p) => p.createdAt.desc())
   *   .cursor({ createdAt: last.createdAt })
   *   .limit(20)
   *   .all();
   * ```
   */
  cursor<Self extends HasOrderBy>(
    this: Self,
    cursorValues: Partial<Record<keyof DefaultModelRow<TContract, ModelName> & string, unknown>>,
  ): Self;
  cursor(
    cursorValues: Partial<Record<keyof DefaultModelRow<TContract, ModelName> & string, unknown>>,
  ): this {
    assertCursorCompatibleOrder(this.state.orderBy);
    const mappedCursor = mapCursorValuesToColumns(
      this.contract,
      this.namespaceId,
      this.modelName,
      cursorValues,
    );

    if (Object.keys(mappedCursor).length === 0) {
      return this;
    }

    return this.#cloneSelf({
      cursor: mappedCursor,
    });
  }

  /**
   * Emit `SELECT DISTINCT` keyed on the given fields. Replaces any
   * previous `distinct(...)` / `distinctOn(...)` selection.
   *
   * ```typescript
   * const groups = await db.orm.User.distinct('country', 'role').all();
   * ```
   */
  distinct<
    Fields extends readonly [
      keyof DefaultModelRow<TContract, ModelName> & string,
      ...(keyof DefaultModelRow<TContract, ModelName> & string)[],
    ],
    Self,
  >(this: Self, ...fields: Fields): Self;
  distinct<
    Fields extends readonly [
      keyof DefaultModelRow<TContract, ModelName> & string,
      ...(keyof DefaultModelRow<TContract, ModelName> & string)[],
    ],
  >(...fields: Fields): this {
    const distinctFields = mapFieldsToColumns(
      this.contract,
      this.namespaceId,
      this.modelName,
      fields,
    );

    return this.#cloneSelf({
      distinct: distinctFields,
      distinctOn: undefined,
    });
  }

  /**
   * Emit `SELECT DISTINCT ON (fields)` — keep the first row per
   * distinct key according to the current `orderBy(...)`. Requires a
   * prior `orderBy(...)`; replaces any previous `distinct(...)` /
   * `distinctOn(...)` selection.
   *
   * Requires the `postgres.distinctOn` capability.
   *
   * ```typescript
   * // Latest post per user:
   * const latestPerUser = await db.orm.Post
   *   .orderBy([(p) => p.userId.asc(), (p) => p.createdAt.desc()])
   *   .distinctOn('userId')
   *   .all();
   * ```
   */
  distinctOn<
    Fields extends readonly [
      keyof DefaultModelRow<TContract, ModelName> & string,
      ...(keyof DefaultModelRow<TContract, ModelName> & string)[],
    ],
    Self extends HasOrderBy,
  >(
    this: Self,
    ...fields: TContract['capabilities'] extends { postgres: { distinctOn: true } } ? Fields : never
  ): Self;
  distinctOn<
    Fields extends readonly [
      keyof DefaultModelRow<TContract, ModelName> & string,
      ...(keyof DefaultModelRow<TContract, ModelName> & string)[],
    ],
  >(
    ...fields: TContract['capabilities'] extends { postgres: { distinctOn: true } } ? Fields : never
  ): this {
    assertDistinctOnCapability(this.contract, 'distinctOn');
    assertDistinctOnCompatibleOrder(this.state.orderBy, fields.length);
    const distinctOnFields = mapFieldsToColumns(
      this.contract,
      this.namespaceId,
      this.modelName,
      fields,
    );

    return this.#cloneSelf({
      distinct: undefined,
      distinctOn: distinctOnFields,
    });
  }

  /**
   * Lock the selected rows of this model with `FOR UPDATE` until the transaction ends.
   *
   * Requires the `sql.forUpdate` and `sql.lockOf` capabilities, because the lock always names the model's table with `OF`.
   *
   * ```typescript
   * const job = await tx.orm.Job.where({ state: 'queued' }).limit(1).forUpdate({ skipLocked: true }).first();
   * ```
   */
  forUpdate<Self>(
    this: Self,
    ...options: LockMethodArgs<TContract['capabilities'], 'forUpdate'>
  ): Self;
  forUpdate(...options: LockMethodArgs<TContract['capabilities'], 'forUpdate'>): this {
    return this.#lock('forUpdate', options[0]);
  }

  /**
   * Lock the selected rows of this model with `FOR NO KEY UPDATE` until the transaction ends. Unlike `forUpdate`, it does not block foreign-key checks from rows that reference them.
   *
   * Requires the `postgres.forNoKeyUpdate` and `sql.lockOf` capabilities, because the lock always names the model's table with `OF`.
   */
  forNoKeyUpdate<Self>(
    this: Self,
    ...options: LockMethodArgs<TContract['capabilities'], 'forNoKeyUpdate'>
  ): Self;
  forNoKeyUpdate(...options: LockMethodArgs<TContract['capabilities'], 'forNoKeyUpdate'>): this {
    return this.#lock('forNoKeyUpdate', options[0]);
  }

  /**
   * Lock the selected rows of this model with `FOR SHARE` until the transaction ends; other transactions may share-lock them but not write them.
   *
   * Requires the `sql.forShare` and `sql.lockOf` capabilities, because the lock always names the model's table with `OF`.
   */
  forShare<Self>(
    this: Self,
    ...options: LockMethodArgs<TContract['capabilities'], 'forShare'>
  ): Self;
  forShare(...options: LockMethodArgs<TContract['capabilities'], 'forShare'>): this {
    return this.#lock('forShare', options[0]);
  }

  /**
   * Lock the selected rows of this model with `FOR KEY SHARE` until the transaction ends; only deletes and key changes are blocked.
   *
   * Requires the `postgres.forKeyShare` and `sql.lockOf` capabilities, because the lock always names the model's table with `OF`.
   */
  forKeyShare<Self>(
    this: Self,
    ...options: LockMethodArgs<TContract['capabilities'], 'forKeyShare'>
  ): Self;
  forKeyShare(...options: LockMethodArgs<TContract['capabilities'], 'forKeyShare'>): this {
    return this.#lock('forKeyShare', options[0]);
  }

  /**
   * Apply `LIMIT n`. Replaces any previous limit set on this collection.
   *
   * ```typescript
   * const firstTen = await db.orm.User.orderBy((u) => u.id.asc()).limit(10).all();
   * ```
   */
  limit<Self>(
    this: Self,
    n: number | TraitExpression<readonly ['numeric'], false, ExtractCodecTypes<TContract>>,
  ): Self;
  limit(
    n: number | TraitExpression<readonly ['numeric'], false, ExtractCodecTypes<TContract>>,
  ): this {
    return this.#cloneSelf({ limit: typeof n === 'number' ? n : toExpr(n) });
  }

  /**
   * Apply `OFFSET n`. Replaces any previous offset set on this collection.
   *
   * ```typescript
   * const page2 = await db.orm.User
   *   .orderBy((u) => u.id.asc())
   *   .offset(10)
   *   .limit(10)
   *   .all();
   * ```
   */
  offset<Self>(
    this: Self,
    n: number | TraitExpression<readonly ['numeric'], false, ExtractCodecTypes<TContract>>,
  ): Self;
  offset(
    n: number | TraitExpression<readonly ['numeric'], false, ExtractCodecTypes<TContract>>,
  ): this {
    return this.#cloneSelf({ offset: typeof n === 'number' ? n : toExpr(n) });
  }

  /**
   * Read terminal: execute the query and stream every matching row.
   *
   * The returned `AsyncIterableResult<Row>` is BOTH a thenable that
   * resolves to `Row[]` (so `await` collects all rows into an array)
   * AND an async iterable (so `for await` streams rows as they
   * arrive, without buffering the whole result set in memory). Pick
   * whichever fits the caller. A single result can only be consumed
   * once.
   *
   * Queries without `include(...)` stream rows as the driver yields them (drivers that cannot
   * expose a cursor buffer internally first). Queries with `include(...)` read the whole parent
   * result set into memory before yielding the first row.
   *
   * ```typescript
   * // Thenable — collect to an array:
   * const users = await db.orm.User.all();
   * for (const user of users) console.log(user.id);
   *
   * // Async iterable — stream rows as they arrive:
   * for await (const user of db.orm.User.all()) {
   *   console.log(user.id);
   * }
   * ```
   *
   * Accepts an optional `configure` callback that receives a
   * `MetaBuilder<'read'>` so the caller can attach typed user
   * annotations to the executed plan. `meta.annotate(...)` enforces
   * applicability at the type level and at runtime; annotations are
   * merged into `plan.meta.annotations` at compile time.
   *
   * ```typescript
   * await db.orm.User.all((meta) => meta.annotate(cacheAnnotation({ key: 'users' })));
   * ```
   */
  all<Self extends this>(
    this: Self,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): AsyncIterableResult<CollectionRowOf<Self>>;
  all(configure?: (meta: MetaBuilder<'read'>) => void): AsyncIterableResult<CollectionRowOf<this>>;
  all(configure?: (meta: MetaBuilder<'read'>) => void): AsyncIterableResult<unknown> {
    return this.#withAnnotationsFromMeta(configure, 'all').#dispatch();
  }

  get prepared(): PreparedCollection<
    TContract,
    ModelName,
    CollectionRowOf<this>,
    CollectionTypeStateOf<this>
  > {
    const prepared: PreparedCollection<TContract, ModelName, Row, CollectionTypeStateOf<this>> = {
      aggregate: (fn, configure) => this.#describeAggregate(fn, configure),
      all: (configure) => {
        const selected = this.#withAnnotationsFromMeta(configure, 'all');
        return describeCollectionRows<Row>(selected.#descriptionOptions());
      },
      first: (filter, configure) => {
        const selected = this.#forFirst(filter, configure, 'first');
        return describeCollectionFirst<Row>(selected.#descriptionOptions());
      },
      firstOrThrow: (filter, configure) => {
        const selected = this.#forFirst(filter, configure, 'firstOrThrow');
        return describeCollectionFirstOrThrow<Row>(selected.#descriptionOptions());
      },
    };
    return blindCast<
      PreparedCollection<TContract, ModelName, CollectionRowOf<this>, CollectionTypeStateOf<this>>,
      'the row this collection reads is the row its type carries'
    >(prepared);
  }

  #descriptionOptions() {
    return {
      context: this.ctx.context,
      state: this.state,
      tableName: this.tableName,
      modelName: this.modelName,
      namespaceId: this.namespaceId,
    };
  }

  #forFirst(
    filter: WhereInput<TContract, State['nsId'], ModelName, State['variantName']> | undefined,
    configure: ((meta: MetaBuilder<'read'>) => void) | undefined,
    terminalName: 'first' | 'firstOrThrow',
  ) {
    const scoped =
      filter === undefined
        ? this
        : typeof filter === 'function'
          ? this.where(filter)
          : this.where(filter);
    return scoped.limit(1).#withAnnotationsFromMeta(configure, terminalName);
  }

  /**
   * Read terminal: return the first matching row, or `null` if none
   * match. Optionally accepts a filter (callback or shorthand object)
   * followed by a `configure` callback for typed read annotations.
   *
   * To attach annotations without further narrowing, pass `undefined`
   * as the filter (or chain `.where(...)` first):
   *
   * ```typescript
   * // No filter — first row in the collection:
   * const someone = await db.orm.User.first();
   *
   * // Shorthand filter:
   * const alice = await db.orm.User.first({ email: 'alice@example.com' });
   *
   * // Callback filter:
   * const old = await db.orm.User.first((u) => u.age.gt(60));
   *
   * // Annotate without filtering further:
   * await db.orm.User.first(undefined, (meta) =>
   *   meta.annotate(cacheAnnotation({})),
   * );
   * ```
   */
  async first<Self extends this>(
    this: Self,
    filter?: WhereInput<TContract, State['nsId'], ModelName, State['variantName']>,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Promise<CollectionRowOf<Self> | null>;
  async first(
    filter?: WhereInput<TContract, State['nsId'], ModelName, State['variantName']>,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Promise<CollectionRowOf<this> | null>;
  async first(
    filter?: WhereInput<TContract, State['nsId'], ModelName, State['variantName']>,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Promise<unknown> {
    return consumeFirstRow(this.#forFirst(filter, configure, 'first').#dispatch());
  }

  async firstOrThrow<Self extends this>(
    this: Self,
    filter?: WhereInput<TContract, State['nsId'], ModelName, State['variantName']>,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Promise<CollectionRowOf<Self>>;
  async firstOrThrow(
    filter?: WhereInput<TContract, State['nsId'], ModelName, State['variantName']>,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Promise<CollectionRowOf<this>>;
  async firstOrThrow(
    filter?: WhereInput<TContract, State['nsId'], ModelName, State['variantName']>,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Promise<unknown> {
    return this.#forFirst(filter, configure, 'firstOrThrow').#dispatch().firstOrThrow();
  }

  /**
   * Read terminal: run an aggregate query (count, sum, avg, min, max)
   * built via the `AggregateBuilder` callback. Returns one object
   * with the requested aggregate values keyed by the aliases supplied
   * in the spec.
   *
   * ```typescript
   * const stats = await db.orm.Post
   *   .where({ published: true })
   *   .aggregate((agg) => ({
   *     total: agg.count(),
   *     averageViews: agg.avg('views'),
   *     maxViews: agg.max('views'),
   *   }));
   * // { total: 42, averageViews: 17.3, maxViews: 9001 }
   * ```
   *
   * Accepts an optional `configure` callback that receives a
   * `MetaBuilder<'read'>` for attaching typed annotations.
   * Annotations are merged into the compiled plan's `meta.annotations`.
   */
  async aggregate<Spec extends AggregateSpec>(
    fn: (aggregate: AggregateBuilder<TContract, ModelName, State['nsId']>) => Spec,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Promise<AggregateResult<Spec>> {
    const description = this.#describeAggregate(fn, configure);
    return description.consume(queryPlanRows(this.ctx.runtime, description.plan));
  }

  #describeAggregate<Spec extends AggregateSpec>(
    fn: (aggregate: AggregateBuilder<TContract, ModelName, State['nsId']>) => Spec,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Preparable<Record<string, unknown>, Promise<AggregateResult<Spec>>> {
    assertLockCompatible(this.state, 'aggregate');
    const aggregateSpec = fn(
      createAggregateBuilder<TContract, ModelName, State['nsId']>(
        this.contract,
        this.ctx.context.aggregateDescriptors,
        this.namespaceId,
        this.modelName,
      ),
    );
    const entries = Object.entries(aggregateSpec);
    if (entries.length === 0) {
      throw ormError(
        'ORM.AGGREGATE_SELECTOR_MISSING',
        'aggregate() requires at least one aggregation selector',
        { meta: { method: 'aggregate', model: this.modelName } },
      );
    }

    for (const [alias, selector] of entries) {
      if (!isAggregateSelector(selector)) {
        throw ormError(
          'ORM.AGGREGATE_SELECTOR_INVALID',
          `aggregate() selector "${alias}" is invalid`,
          {
            meta: { method: 'aggregate', model: this.modelName, alias },
          },
        );
      }
    }

    const annotationsMap = this.#collectAnnotationsFromMeta(configure, 'read', 'aggregate');

    const compiled = mergeAnnotations(
      compileAggregate(
        this.contract,
        this.ctx.context.aggregateDescriptors,
        this.namespaceId,
        this.tableName,
        this.state,
        aggregateSpec,
        this.modelName,
      ),
      annotationsMap,
    );
    const results = entries.map(([alias, selector]) => {
      const resolved = resolveAggregate({
        aggregates: this.ctx.context.aggregateDescriptors,
        contract: this.contract,
        namespaceId: this.namespaceId,
        tableName: this.tableName,
        fn: selector.fn,
        column: selector.column,
      });
      return {
        alias,
        resolved,
        codec: this.ctx.context.contractCodecs.forCodecRef(resolved.codec),
      };
    });
    return {
      plan: compiled,
      async consume(source) {
        const rows = await source.toArray();
        const row = rows[0] ?? {};
        const result = Object.fromEntries(
          results.map(({ alias, resolved, codec }) => {
            const value = Object.hasOwn(row, alias) ? row[alias] : undefined;
            return [alias, value ?? emptyAggregateResult(resolved, codec)];
          }),
        );
        return blindCast<
          AggregateResult<Spec>,
          "aliases are the aggregateSpec's own keys; values decoded by the projection codecs the same spec resolved"
        >(result);
      },
    };
  }

  /**
   * Write terminal: insert one row and return it (with any configured
   * `select(...)` / `include(...)` projections applied to the returned
   * shape).
   *
   * Related rows can be created or linked through relation callbacks on any relation: to-one
   * (1:1, N:1), to-many (1:N), and many-to-many (N:M, written through the junction table). The
   * callback receives a mutator exposing `create(...)` and `connect(...)`; `disconnect(...)` is
   * only supported in nested `update(...)` mutations. To-one relations take a single row or
   * criterion.
   * N:M `create`/`connect` are unavailable when the junction has required columns the relation API
   * cannot populate.
   *
   * ```typescript
   * // Simple insert:
   * const user = await db.orm.User.create({
   *   email: 'alice@example.com',
   *   name: 'Alice',
   * });
   *
   * // Nested create on a child-owned to-many relation:
   * const author = await db.orm.User.create({
   *   email: 'bob@example.com',
   *   posts: (posts) => posts.create([
   *     { title: 'Hello' },
   *     { title: 'World' },
   *   ]),
   * });
   *
   * // Connect a child-owned post to an existing parent author:
   * const reply = await db.orm.Post.create({
   *   title: 'Re: Hello',
   *   author: (author) => author.connect({ id: 1 }),
   * });
   * ```
   *
   * Accepts an optional `configure` callback that receives a
   * `MetaBuilder<'write'>` for attaching typed annotations.
   * Annotations are merged into the compiled mutation plan's
   * `meta.annotations`.
   *
   * Note: when the input contains nested-mutation callbacks, the
   * operation is executed as a graph of internal queries via
   * `withMutationScope`. In that path the `configure` callback still runs, so `meta.annotate`
   * validation applies, but the recorded annotations are discarded: neither the nested
   * statements nor the read-back query carry them.
   */
  async create<Self extends this>(
    this: Self,
    data: ResolvedCreateInput<TContract, ModelName, State['variantName'], State['nsId']>,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<CollectionRowOf<Self>>;
  async create<Self extends this>(
    this: Self,
    data: MutationCreateInputWithRelations<TContract, ModelName, State['nsId']>,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<CollectionRowOf<Self>>;
  async create(
    data: MutationCreateInputWithRelations<TContract, ModelName, State['nsId']>,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<CollectionRowOf<this>>;
  async create(
    data:
      | ResolvedCreateInput<TContract, ModelName, State['variantName'], State['nsId']>
      | MutationCreateInputWithRelations<TContract, ModelName, State['nsId']>,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<unknown> {
    assertLockCompatible(this.state, 'mutation');
    assertReturningCapability(this.contract, 'create()');
    const annotationsMap = this.#collectAnnotationsFromMeta(configure, 'write', 'create');

    if (
      hasNestedMutationCallbacks(
        this.contract,
        this.namespaceId,
        this.modelName,
        blindCast<
          Record<string, unknown>,
          'create overload inputs are model-field records inspected for relation callbacks'
        >(data),
      )
    ) {
      const createdRow = await executeNestedCreateMutation({
        context: this.ctx.context,
        runtime: this.ctx.runtime,
        namespaceId: this.namespaceId,
        modelName: this.modelName,
        data: blindCast<
          MutationCreateInput<Contract<SqlStorage>, string>,
          'nested callback detection selects the relation-mutation create input'
        >(data),
      });

      const identityCriterion = buildRowIdentityFilterFromRow(
        this.contract,
        this.namespaceId,
        this.modelName,
        createdRow,
      );
      const reloaded = await this.#reloadMutationRowByIdentity(identityCriterion);
      if (!reloaded) {
        throw ormError(
          'ORM.MUTATION_ROW_MISSING',
          `create() for model "${this.modelName}" did not return a row`,
          { meta: { operation: 'create', model: this.modelName } },
        );
      }
      return reloaded;
    }

    const rows = await this.#createAllWithAnnotations(
      [
        blindCast<
          ResolvedScalarCreateInput<TContract, ModelName, State['variantName'], State['nsId']>,
          'absence of nested callbacks selects the scalar create overload input'
        >(data),
      ],
      annotationsMap,
    );
    const created = rows[0];
    if (created) {
      return created;
    }

    throw ormError(
      'ORM.MUTATION_ROW_MISSING',
      `create() for model "${this.modelName}" did not return a row`,
      { meta: { operation: 'create', model: this.modelName } },
    );
  }

  /**
   * Write terminal: insert many rows and stream the inserted rows.
   *
   * The returned `AsyncIterableResult<Row>` is BOTH a thenable that
   * resolves to `Row[]` AND an async iterable that streams inserted
   * rows as they arrive. Use whichever shape fits the caller — but
   * only consume it once. Streaming is the default; some
   * driver/plan combinations may still buffer internally before
   * yielding.
   *
   * ```typescript
   * // Thenable — collect all inserted rows into an array:
   * const created = await db.orm.User.createAll([
   *   { email: 'a@example.com' },
   *   { email: 'b@example.com' },
   * ]);
   *
   * // Async iterable — stream inserted rows as they arrive:
   * for await (const row of db.orm.User.createAll(seedUsers)) {
   *   console.log('inserted', row.id);
   * }
   *
   * // Let the database skip rows that collide with a unique
   * // constraint; only the rows it inserted come back:
   * const inserted = await db.orm.User.createAll(seedUsers, {
   *   onConflict: 'skip',
   *   conflictOn: ['email'],
   * });
   * ```
   *
   * Accepts an optional `configure` callback that receives a
   * `MetaBuilder<'write'>` for attaching typed annotations to the
   * compiled insert plan. It may be passed in second position when
   * there are no options.
   */
  createAll<Self extends this>(
    this: Self,
    data: readonly ResolvedScalarCreateInput<
      TContract,
      ModelName,
      State['variantName'],
      State['nsId']
    >[],
    optionsOrConfigure?: CreateConflictOptions<TContract, ModelName> | WriteConfigure,
    configure?: WriteConfigure,
  ): AsyncIterableResult<CollectionRowOf<Self>>;
  createAll(
    data: readonly ResolvedScalarCreateInput<
      TContract,
      ModelName,
      State['variantName'],
      State['nsId']
    >[],
    optionsOrConfigure?: CreateConflictOptions<TContract, ModelName> | WriteConfigure,
    configure?: WriteConfigure,
  ): AsyncIterableResult<CollectionRowOf<this>>;
  createAll(
    data: readonly ResolvedScalarCreateInput<
      TContract,
      ModelName,
      State['variantName'],
      State['nsId']
    >[],
    optionsOrConfigure?: CreateConflictOptions<TContract, ModelName> | WriteConfigure,
    configure?: WriteConfigure,
  ): AsyncIterableResult<unknown> {
    assertLockCompatible(this.state, 'mutation');
    const { options, configureCallback } = splitCreateArguments(optionsOrConfigure, configure);
    const conflictSkip = this.#resolveConflictSkip(options, 'createAll()');
    return this.#createAllWithAnnotations(
      data,
      this.#collectAnnotationsFromMeta(configureCallback, 'write', 'createAll'),
      conflictSkip,
    );
  }

  #createAllWithAnnotations(
    data: readonly ResolvedScalarCreateInput<
      TContract,
      ModelName,
      State['variantName'],
      State['nsId']
    >[],
    annotationsMap: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> | undefined,
    conflictSkip?: InsertConflictSkip,
  ): AsyncIterableResult<Row> {
    if (data.length === 0) {
      const generator = async function* (): AsyncGenerator<Row, void, unknown> {};
      return new AsyncIterableResult(generator());
    }

    assertReturningCapability(this.contract, 'createAll()');

    const rows = blindCast<
      readonly Record<string, unknown>[],
      'resolved create inputs are model-field records for storage mapping'
    >(data);
    const mtiContext = this.#resolveMtiCreateContext();
    if (mtiContext) {
      return this.#executeMtiCreate(rows, mtiContext);
    }

    const mappedRows = this.#mapCreateRows(rows);
    applyCreateDefaults(this.ctx, this.namespaceId, this.tableName, mappedRows);
    const { selectedForQuery: selectedForInsert, hiddenColumns } = this.#augmentMutationSelection();
    if (this.contract.capabilities?.['sql']?.['defaultInInsert'] !== true) {
      const plans = compileInsertReturningSplit(
        this.contract,
        this.namespaceId,
        this.modelName,
        this.tableName,
        mappedRows,
        selectedForInsert,
        conflictSkip,
      ).map((plan) => mergeAnnotations(plan, annotationsMap));
      return dispatchSplitMutationRows<Row>({
        context: this.ctx.context,
        runtime: this.ctx.runtime,
        plans,
        tableName: this.tableName,
        modelName: this.modelName,
        namespaceId: this.namespaceId,
        variantName: this.state.variantName,
        includes: this.state.includes,
        selectedFields: this.state.selectedFields,
        hiddenColumns,
        mapRow: (mapped) =>
          blindCast<Row, 'mapped mutation storage row matches the collection generic row'>(mapped),
      });
    }

    const compiled = mergeAnnotations(
      compileInsertReturning(
        this.contract,
        this.namespaceId,
        this.modelName,
        this.tableName,
        mappedRows,
        selectedForInsert,
        conflictSkip,
      ),
      annotationsMap,
    );
    return dispatchMutationRows<Row>({
      context: this.ctx.context,
      runtime: this.ctx.runtime,
      compiled,
      tableName: this.tableName,
      modelName: this.modelName,
      namespaceId: this.namespaceId,
      variantName: this.state.variantName,
      includes: this.state.includes,
      selectedFields: this.state.selectedFields,
      hiddenColumns,
      mapRow: (mapped) =>
        blindCast<Row, 'mapped mutation storage row matches the collection generic row'>(mapped),
    });
  }

  #resolveConflictSkip(
    options: CreateConflictOptions<TContract, ModelName> | undefined,
    method: string,
  ): InsertConflictSkip | undefined {
    if (options === undefined) return undefined;

    if (options.onConflict !== 'skip') {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        `${method} onConflict must be "skip"; received ${JSON.stringify(options.onConflict)}`,
        { meta: { method, model: this.modelName } },
      );
    }

    if (method === 'createAll()') {
      this.#assertConflictSkipNotOnMtiVariant(method);
    } else {
      this.#assertNotMtiVariant(method);
    }

    const conflictOn = options.conflictOn ?? [];
    assertInsertConflictSkipCapability(this.contract, method, conflictOn.length > 0);

    return {
      columns: resolveInsertConflictColumns(
        this.contract,
        this.namespaceId,
        this.modelName,
        conflictOn,
      ),
    };
  }

  #assertNotMtiVariant(method: string): void {
    this.#refuseOnMtiVariant(
      method,
      `${method} is not supported for MTI variant "${this.state.variantName}" on model "${this.modelName}". Use createAll() instead.`,
    );
  }

  #assertConflictSkipNotOnMtiVariant(method: string): void {
    this.#refuseOnMtiVariant(
      method,
      `The onConflict option is not supported on variant "${this.state.variantName}" of model "${this.modelName}" because the variant is stored in its own table. Call createAll(rows) without the option; a duplicate row then makes the call fail.`,
    );
  }

  #refuseOnMtiVariant(method: string, message: string): void {
    if (!this.#resolveMtiCreateContext()) return;
    throw ormError('ORM.OPERATION_UNSUPPORTED', message, {
      meta: {
        method,
        model: this.modelName,
        variant: this.state.variantName,
        reason: 'mti-variant',
      },
    });
  }

  #resolveMtiCreateContext(): MtiCreateContext | null {
    const variantName = this.state.variantName;
    if (!variantName) return null;

    const polyInfo = resolvePolymorphismInfo(this.contract, this.namespaceId, this.modelName);
    if (!polyInfo) return null;

    const variant = polyInfo.variants.get(variantName);
    if (!isMtiVariantInfo(variant)) return null;

    const baseFieldToColumn = getModelFieldColumns(this.contract, this.namespaceId, this.modelName);
    const variantFieldToColumn = getOwnFieldColumns(
      this.contract,
      this.namespaceId,
      variant.modelName,
    );
    const pkColumns = resolvePrimaryKeyColumns(this.contract, this.namespaceId, this.tableName);

    return {
      polyInfo,
      variant,
      baseFieldToColumn,
      variantFieldToColumn,
      mergedFieldToColumn: getModelAndVariantFieldColumns(
        this.contract,
        this.namespaceId,
        this.modelName,
        variant.modelName,
      ),
      pkColumns,
    };
  }

  #executeMtiCreate(
    data: readonly Record<string, unknown>[],
    mtiCtx: MtiCreateContext,
  ): AsyncIterableResult<Row> {
    const {
      polyInfo,
      variant,
      baseFieldToColumn,
      variantFieldToColumn,
      mergedFieldToColumn,
      pkColumns,
    } = mtiCtx;
    const contract = this.contract;
    const collectionCtx = this.ctx;
    const runtime = collectionCtx.runtime;
    const tableName = this.tableName;
    const modelName = this.modelName;
    const namespaceId = this.namespaceId;

    const baseFieldColumns = new Set(Object.values(baseFieldToColumn));
    const variantFieldColumns = new Set(Object.values(variantFieldToColumn));

    const generator = async function* (): AsyncGenerator<Row, void, unknown> {
      const defaultValueCache = new Map<string, unknown>();
      for (const row of data) {
        const allMapped: Record<string, unknown> = {};
        for (const [fieldName, value] of Object.entries(row)) {
          if (value === undefined) continue;
          allMapped[
            columnOfCallerField(
              contract,
              namespaceId,
              mergedFieldToColumn,
              variant.modelName,
              fieldName,
            )
          ] = value;
        }
        allMapped[polyInfo.discriminatorColumn] = variant.value;

        const baseRow: Record<string, unknown> = {};
        const variantRow: Record<string, unknown> = {};
        for (const [col, val] of Object.entries(allMapped)) {
          if (baseFieldColumns.has(col) || col === polyInfo.discriminatorColumn) {
            baseRow[col] = val;
          }
          if (variantFieldColumns.has(col)) {
            variantRow[col] = val;
          }
        }

        const merged = await withMutationScope(runtime, async (scope) => {
          applyCreateDefaults(collectionCtx, namespaceId, tableName, [baseRow], defaultValueCache);
          const baseCompiled = compileInsertReturning(
            contract,
            namespaceId,
            modelName,
            tableName,
            [baseRow],
            undefined,
          );
          const baseResult = await queryPlanRows<Record<string, unknown>>(
            scope,
            baseCompiled,
          ).toArray();
          const baseCreated = baseResult[0];
          if (!baseCreated) {
            throw ormError(
              'ORM.MUTATION_ROW_MISSING',
              `MTI base INSERT for model "${modelName}" did not return a row`,
              {
                meta: {
                  operation: 'create',
                  model: modelName,
                  table: tableName,
                  phase: 'mti-base',
                },
              },
            );
          }

          for (const pkColumn of pkColumns) {
            variantRow[pkColumn] = baseCreated[pkColumn];
          }
          applyCreateDefaults(
            collectionCtx,
            namespaceId,
            variant.table,
            [variantRow],
            defaultValueCache,
          );
          const variantCompiled = compileInsertReturning(
            contract,
            namespaceId,
            variant.modelName,
            variant.table,
            [variantRow],
            undefined,
          );
          const variantResult = await queryPlanRows<Record<string, unknown>>(
            scope,
            variantCompiled,
          ).toArray();
          const variantCreated = variantResult[0];
          if (!variantCreated) {
            throw ormError(
              'ORM.MUTATION_ROW_MISSING',
              `MTI variant INSERT for model "${modelName}" into "${variant.table}" did not return a row`,
              {
                meta: {
                  operation: 'create',
                  model: modelName,
                  table: variant.table,
                  phase: 'mti-variant',
                },
              },
            );
          }

          const prefixedVariant: Record<string, unknown> = {};
          for (const [col, val] of Object.entries(variantCreated)) {
            if (pkColumns.includes(col)) continue;
            prefixedVariant[`${variant.table}__${col}`] = val;
          }

          return mapPolymorphicRow(
            contract,
            namespaceId,
            modelName,
            polyInfo,
            { ...baseCreated, ...prefixedVariant },
            variant.modelName,
          );
        });

        yield blindCast<Row, 'polymorphic storage rows map to the collection generic row'>(merged);
      }
    };

    return new AsyncIterableResult(generator());
  }

  #mapCreateRows(data: readonly Record<string, unknown>[]): Record<string, unknown>[] {
    const variantName = this.state.variantName;
    if (!variantName) {
      return data.map((row) =>
        mapModelDataToStorageRow(this.contract, this.namespaceId, this.modelName, row),
      );
    }

    const polyInfo = resolvePolymorphismInfo(this.contract, this.namespaceId, this.modelName);
    if (!polyInfo) {
      return data.map((row) =>
        mapModelDataToStorageRow(this.contract, this.namespaceId, this.modelName, row),
      );
    }

    const variant = polyInfo.variants.get(variantName);
    if (!variant) {
      return data.map((row) =>
        mapModelDataToStorageRow(this.contract, this.namespaceId, this.modelName, row),
      );
    }

    const mergedFieldToColumn = getModelAndVariantFieldColumns(
      this.contract,
      this.namespaceId,
      this.modelName,
      variant.modelName,
    );

    return data.map((row) => {
      const mapped: Record<string, unknown> = {};
      for (const [fieldName, value] of Object.entries(row)) {
        if (value === undefined) continue;
        mapped[
          columnOfCallerField(
            this.contract,
            this.namespaceId,
            mergedFieldToColumn,
            variant.modelName,
            fieldName,
          )
        ] = value;
      }
      mapped[polyInfo.discriminatorColumn] = variant.value;
      return mapped;
    });
  }

  /**
   * Write terminal: insert many rows without materializing the
   * inserted rows, returning the number of rows the database reports
   * inserting.
   *
   * Prefer `createAll(...)` when you need the returned rows; prefer
   * this when you only need to know how many rows were inserted (the
   * compiled plan skips `RETURNING`).
   *
   * ```typescript
   * const inserted = await db.orm.User.createAndCount([
   *   { email: 'a@example.com' },
   *   { email: 'b@example.com' },
   * ]);
   * // inserted === 2
   *
   * // Let the database skip rows that collide with a unique
   * // constraint; the count is how many it actually inserted:
   * const added = await db.orm.User.createAndCount(seedUsers, {
   *   onConflict: 'skip',
   * });
   * ```
   *
   * Not supported on MTI variants — use `createAll(...)` instead.
   */
  async createAndCount(
    data: readonly ResolvedScalarCreateInput<
      TContract,
      ModelName,
      State['variantName'],
      State['nsId']
    >[],
    optionsOrConfigure?: CreateConflictOptions<TContract, ModelName> | WriteConfigure,
    configure?: WriteConfigure,
  ): Promise<number> {
    assertLockCompatible(this.state, 'mutation');
    const { options, configureCallback } = splitCreateArguments(optionsOrConfigure, configure);
    const conflictSkip = this.#resolveConflictSkip(options, 'createAndCount()');

    if (data.length === 0) {
      return 0;
    }

    this.#assertNotMtiVariant('createAndCount()');
    const annotationsMap = this.#collectAnnotationsFromMeta(
      configureCallback,
      'write',
      'createAndCount',
    );

    const rows = blindCast<
      readonly Record<string, unknown>[],
      'resolved create-and-count inputs are model-field records for storage mapping'
    >(data);
    const mappedRows = this.#mapCreateRows(rows);
    applyCreateDefaults(this.ctx, this.namespaceId, this.tableName, mappedRows);

    if (this.contract.capabilities?.['sql']?.['defaultInInsert'] !== true) {
      const plans = compileInsertCountSplit(
        this.contract,
        this.namespaceId,
        this.tableName,
        mappedRows,
        conflictSkip,
      ).map((plan) => mergeAnnotations(plan, annotationsMap));
      let affectedRows = 0;
      for (const plan of plans) {
        const stats = await this.ctx.runtime.execute(plan);
        affectedRows += stats.affectedRows;
      }
      return affectedRows;
    }

    const compiled = mergeAnnotations(
      compileInsertCount(this.contract, this.namespaceId, this.tableName, mappedRows, conflictSkip),
      annotationsMap,
    );
    const stats = await this.ctx.runtime.execute(compiled);
    return stats.affectedRows;
  }

  /**
   * Write terminal: insert a row, or update the existing row on
   * conflict. Returns the resulting row (the inserted one or the
   * updated/existing one).
   *
   * `conflictOn` selects which unique constraint drives the conflict
   * resolution — omit to use the model's primary key.
   *
   * ```typescript
   * // Insert-or-update on email uniqueness:
   * await db.orm.User.upsert({
   *   create: { email: 'alice@example.com', name: 'Alice' },
   *   update: { name: 'Alice (updated)' },
   *   conflictOn: { email: 'alice@example.com' },
   * });
   *
   * // Conditional create — `update: {}` keeps the existing row
   * // unchanged. `conflictOn` must reference the constraint that
   * // makes the row "already exist"; omit only when the conflict is
   * // on the primary key. On conflict,
   * // `ON CONFLICT DO NOTHING RETURNING ...` may return zero rows,
   * // so a follow-up reload is issued to fetch and return the
   * // existing row.
   * await db.orm.User.upsert({
   *   create: { email: 'alice@example.com', name: 'Alice' },
   *   update: {},
   *   conflictOn: { email: 'alice@example.com' },
   * });
   * ```
   *
   * Not supported on MTI variants.
   */
  async upsert<Self extends this>(
    this: Self,
    input: {
      create: ResolvedScalarCreateInput<TContract, ModelName, State['variantName'], State['nsId']>;
      update: Partial<DefaultModelRow<TContract, ModelName>>;
      conflictOn?: UniqueConstraintCriterion<TContract, ModelName>;
    },
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<CollectionRowOf<Self>>;
  async upsert(
    input: {
      create: ResolvedScalarCreateInput<TContract, ModelName, State['variantName'], State['nsId']>;
      update: Partial<DefaultModelRow<TContract, ModelName>>;
      conflictOn?: UniqueConstraintCriterion<TContract, ModelName>;
    },
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<CollectionRowOf<this>>;
  async upsert(
    input: {
      create: ResolvedScalarCreateInput<TContract, ModelName, State['variantName'], State['nsId']>;
      update: Partial<DefaultModelRow<TContract, ModelName>>;
      conflictOn?: UniqueConstraintCriterion<TContract, ModelName>;
    },
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<unknown> {
    assertLockCompatible(this.state, 'mutation');
    assertReturningCapability(this.contract, 'upsert()');
    this.#assertNotMtiVariant('upsert()');
    const annotationsMap = this.#collectAnnotationsFromMeta(configure, 'write', 'upsert');

    const mappedCreateRows = this.#mapCreateRows([
      blindCast<
        Record<string, unknown>,
        'resolved upsert create input is a model-field record for storage mapping'
      >(input.create),
    ]);
    const createValues = mappedCreateRows[0] ?? {};
    applyCreateDefaults(this.ctx, this.namespaceId, this.tableName, [createValues]);
    const updateValues = mapModelDataToStorageRow(
      this.contract,
      this.namespaceId,
      this.modelName,
      input.update,
    );
    const hasUpdateValues = Object.keys(updateValues).length > 0;
    if (hasUpdateValues) {
      applyUpdateDefaults(this.ctx, this.namespaceId, this.tableName, updateValues);
    }
    const conflictColumns = resolveUpsertConflictColumns(
      this.contract,
      this.namespaceId,
      this.modelName,
      blindCast<
        Record<string, unknown> | undefined,
        'typed unique criterion is read as a field-value record by conflict resolution'
      >(input.conflictOn),
    );
    if (conflictColumns.length === 0) {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        `upsert() for model "${this.modelName}" requires conflict columns`,
        { meta: { method: 'upsert', model: this.modelName } },
      );
    }

    const { selectedForQuery: selectedForUpsert, hiddenColumns } = this.#augmentMutationSelection();
    const compiled = mergeAnnotations(
      compileUpsertReturning(
        this.contract,
        this.namespaceId,
        this.modelName,
        this.tableName,
        createValues,
        updateValues,
        conflictColumns,
        selectedForUpsert,
      ),
      annotationsMap,
    );
    const row = await executeMutationReturningSingleRow<Row>({
      context: this.ctx.context,
      runtime: this.ctx.runtime,
      compiled,
      tableName: this.tableName,
      modelName: this.modelName,
      namespaceId: this.namespaceId,
      variantName: this.state.variantName,
      includes: this.state.includes,
      selectedFields: this.state.selectedFields,
      hiddenColumns,
      mapRow: (mapped) =>
        blindCast<Row, 'mapped upsert storage row matches the collection generic row'>(mapped),
      operation: 'upsert',
      onMissingRowMessage: `upsert() for model "${this.modelName}" did not return a row`,
    });
    if (row) {
      return row;
    }

    if (!hasUpdateValues) {
      const conflictCriterion = this.#buildUpsertConflictCriterion(createValues, conflictColumns);
      const existing = await this.#reloadMutationRowByCriterion(
        conflictCriterion,
        'upsert conflict',
      );
      if (existing) {
        return existing;
      }
    }

    throw ormError(
      'ORM.MUTATION_ROW_MISSING',
      `upsert() for model "${this.modelName}" did not return a row`,
      { meta: { operation: 'upsert', model: this.modelName } },
    );
  }

  /**
   * Write terminal: update a single matching row — the first one the
   * filter matches — and return it (or `null` when no row matched).
   * Requires a prior `.where(...)` — calling `update(...)` on an
   * unfiltered collection is a type error.
   *
   * The row is the one `first()` returns, so an order, an offset, a cursor, `distinct` and `distinctOn` choose it; after `limit(0)` no row changes and the result is `null`. An update with a relation callback finds its row by the filter alone, so it throws `ORM.ARGUMENT_INVALID` on a collection with an order, a limit, an offset, a cursor, `distinct` or `distinctOn`.
   *
   * Related rows can be created, linked, or unlinked through relation callbacks on any relation:
   * to-one (1:1, N:1), to-many (1:N), and many-to-many (N:M, written through the junction table).
   * The callback receives a mutator exposing `create(...)`, `connect(...)`, and `disconnect(...)`.
   * A to-one `disconnect()` clears the foreign key; a to-many `disconnect()` with no criteria
   * unlinks every related row; an N:M `disconnect()` requires criteria. N:M `create`/`connect` are
   * unavailable when the junction has required columns the relation API cannot populate. Nested
   * updates against existing related rows are not supported through this API.
   *
   * ```typescript
   * // Update one row by id:
   * const updated = await db.orm.User
   *   .where({ id: 1 })
   *   .update({ name: 'Alice Renamed' });
   *
   * // Update + relink — runs as a graph of internal mutations:
   * await db.orm.User
   *   .where({ id: 1 })
   *   .update({
   *     name: 'Alice',
   *     posts: (posts) => posts.connect([{ id: 5 }]),
   *   });
   * ```
   *
   * Accepts an optional `configure` callback that receives a
   * `MetaBuilder<'write'>` for attaching typed annotations.
   *
   * Note: when the input contains nested-mutation callbacks, the
   * operation is executed as a graph of internal queries via
   * `withMutationScope`. In that path the `configure` callback still runs, so `meta.annotate`
   * validation applies, but the recorded annotations are discarded: neither the nested
   * statements nor the read-back query carry them.
   */
  async update<Self extends HasWhere>(
    this: Self,
    data: MutationUpdateInput<TContract, ModelName, State['nsId']>,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<CollectionRowOf<Self & HasRow<CollectionRowOf<this>>> | null>;
  async update(
    data: MutationUpdateInput<TContract, ModelName, State['nsId']>,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<unknown> {
    assertLockCompatible(this.state, 'mutation');
    assertReturningCapability(this.contract, 'update()');
    const annotationsMap = this.#collectAnnotationsFromMeta(configure, 'write', 'update');

    if (
      hasNestedMutationCallbacks(
        this.contract,
        this.namespaceId,
        this.modelName,
        blindCast<
          Record<string, unknown>,
          'update input is a model-field record inspected for relation callbacks'
        >(data),
      )
    ) {
      assertRelationUpdateIgnoresNothing(this.state, this.modelName);
      const updatedRow = await executeNestedUpdateMutation({
        context: this.ctx.context,
        runtime: this.ctx.runtime,
        namespaceId: this.namespaceId,
        modelName: this.modelName,
        filters: this.state.filters,
        data: blindCast<
          MutationUpdateInput<Contract<SqlStorage>, string>,
          'nested callback detection selects the relation-mutation update input'
        >(data),
      });
      if (!updatedRow) {
        return null;
      }

      const identityCriterion = buildRowIdentityFilterFromRow(
        this.contract,
        this.namespaceId,
        this.modelName,
        updatedRow,
      );
      return this.#reloadMutationRowByIdentity(identityCriterion);
    }

    assertModelFieldNames(
      this.contract,
      this.namespaceId,
      this.modelName,
      blindCast<Record<string, unknown>, 'scalar update input is a model-field record'>(data),
    );
    return withMutationScope(this.ctx.runtime, async (scope) => {
      const scoped = this.#withRuntime(scope);
      const identityWhere = await scoped.#findFirstMatchingRowIdentityWhere();
      if (!identityWhere) {
        return null;
      }
      const narrowed = scoped.#clone({ filters: [identityWhere] });
      const rows = await narrowed.#updateAllWithAnnotations(
        blindCast<
          Partial<DefaultModelRow<TContract, ModelName, State['nsId']>>,
          'absence of nested callbacks selects the scalar update input'
        >(data),
        annotationsMap,
      );
      return rows[0] ?? null;
    });
  }

  /**
   * Write terminal: update every matching row and stream the updated
   * rows. Requires a prior `.where(...)` filter. Throws `ORM.ARGUMENT_INVALID` on a collection with a limit, an offset, a cursor, `distinct` or `distinctOn`, which the statement cannot apply.
   *
   * The returned `AsyncIterableResult<Row>` is BOTH a thenable that
   * resolves to `Row[]` AND an async iterable that streams updated
   * rows as they arrive. Use whichever fits; a result can only be
   * consumed once. Streaming is the default; some driver/plan
   * combinations may still buffer internally before yielding.
   *
   * ```typescript
   * // Thenable — collect updated rows into an array:
   * const updated = await db.orm.Post
   *   .where({ published: false })
   *   .updateAll({ published: true });
   *
   * // Async iterable — stream updated rows as they arrive:
   * for await (const row of db.orm.Post.where({ draft: true }).updateAll({ draft: false })) {
   *   console.log('published', row.id);
   * }
   * ```
   *
   * Accepts an optional `configure` callback that receives a
   * `MetaBuilder<'write'>` for attaching typed annotations.
   */
  updateAll<Self extends HasWhere>(
    this: Self,
    data: Partial<DefaultModelRow<TContract, ModelName, State['nsId']>>,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): AsyncIterableResult<CollectionRowOf<Self & HasRow<CollectionRowOf<this>>>>;
  updateAll(
    data: Partial<DefaultModelRow<TContract, ModelName, State['nsId']>>,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): AsyncIterableResult<unknown> {
    assertBulkWriteIgnoresNothing(this.state, this.modelName, 'updateAll');
    assertLockCompatible(this.state, 'mutation');
    return this.#updateAllWithAnnotations(
      data,
      this.#collectAnnotationsFromMeta(configure, 'write', 'updateAll'),
    );
  }

  #updateAllWithAnnotations(
    data: Partial<DefaultModelRow<TContract, ModelName, State['nsId']>>,
    annotationsMap: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> | undefined,
  ): AsyncIterableResult<Row> {
    assertReturningCapability(this.contract, 'updateAll()');

    const mappedData = mapModelDataToStorageRow(
      this.contract,
      this.namespaceId,
      this.modelName,
      data,
    );
    if (Object.keys(mappedData).length === 0) {
      const generator = async function* (): AsyncGenerator<Row, void, unknown> {};
      return new AsyncIterableResult(generator());
    }

    applyUpdateDefaults(this.ctx, this.namespaceId, this.tableName, mappedData);

    const { selectedForQuery: selectedForUpdate, hiddenColumns } = this.#augmentMutationSelection();
    const compiled = mergeAnnotations(
      compileUpdateReturning(
        this.contract,
        this.namespaceId,
        this.modelName,
        this.tableName,
        mappedData,
        this.state.filters,
        selectedForUpdate,
      ),
      annotationsMap,
    );
    return dispatchMutationRows<Row>({
      context: this.ctx.context,
      runtime: this.ctx.runtime,
      compiled,
      tableName: this.tableName,
      modelName: this.modelName,
      namespaceId: this.namespaceId,
      variantName: this.state.variantName,
      includes: this.state.includes,
      selectedFields: this.state.selectedFields,
      hiddenColumns,
      mapRow: (mapped) =>
        blindCast<Row, 'mapped update storage row matches the collection generic row'>(mapped),
    });
  }

  /**
   * Write terminal: update every matching row without returning them,
   * resolving to the count of rows that were updated. Requires a prior
   * `.where(...)` filter. Throws `ORM.ARGUMENT_INVALID` on a collection with a limit, an offset, a cursor, `distinct` or `distinctOn`, which the statement cannot apply.
   *
   * Prefer `updateAll(...)` when you need the updated rows; prefer
   * this when you only need the affected-row count.
   *
   * ```typescript
   * const count = await db.orm.Post
   *   .where({ published: false })
   *   .updateAndCount({ published: true });
   * ```
   */
  async updateAndCount<Self extends HasWhere>(
    this: Self,
    data: Partial<DefaultModelRow<TContract, ModelName, State['nsId']>>,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<number>;
  async updateAndCount(
    data: Partial<DefaultModelRow<TContract, ModelName, State['nsId']>>,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<number> {
    assertBulkWriteIgnoresNothing(this.state, this.modelName, 'updateAndCount');
    assertLockCompatible(this.state, 'mutation');
    const mappedData = mapModelDataToStorageRow(
      this.contract,
      this.namespaceId,
      this.modelName,
      data,
    );
    if (Object.keys(mappedData).length === 0) {
      return 0;
    }

    applyUpdateDefaults(this.ctx, this.namespaceId, this.tableName, mappedData);

    const annotationsMap = this.#collectAnnotationsFromMeta(configure, 'write', 'updateAndCount');

    const compiled = mergeAnnotations(
      compileUpdateCount(
        this.contract,
        this.namespaceId,
        this.tableName,
        mappedData,
        this.state.filters,
        this.state.variantName,
        this.modelName,
      ),
      annotationsMap,
    );
    const stats = await this.ctx.runtime.execute(compiled);
    return stats.affectedRows;
  }

  /**
   * Write terminal: delete a single matching row — the first one the
   * filter matches — and return it (or `null` when no row matched).
   * Requires a prior `.where(...)` — calling `delete()` on an
   * unfiltered collection is a type error. The row is the one `first()` returns, so an order, an offset, a cursor, `distinct` and `distinctOn` choose it; after `limit(0)` no row is deleted and the result is `null`.
   *
   * ```typescript
   * const deleted = await db.orm.User.where({ id: 1 }).delete();
   * if (deleted) console.log('deleted', deleted.email);
   * ```
   *
   * Accepts an optional `configure` callback that receives a
   * `MetaBuilder<'write'>` for attaching typed annotations.
   */
  async delete<Self extends HasWhere>(
    this: Self,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<CollectionRowOf<Self & HasRow<CollectionRowOf<this>>> | null>;
  async delete(configure?: (meta: MetaBuilder<'write'>) => void): Promise<unknown> {
    assertLockCompatible(this.state, 'mutation');
    assertReturningCapability(this.contract, 'delete()');
    const annotationsMap = this.#collectAnnotationsFromMeta(configure, 'write', 'delete');
    return withMutationScope(this.ctx.runtime, async (scope) => {
      const scoped = this.#withRuntime(scope);
      const identityWhere = await scoped.#findFirstMatchingRowIdentityWhere();
      if (!identityWhere) {
        return null;
      }
      const narrowed = scoped.#clone({
        filters: [identityWhere],
        limit: undefined,
        offset: undefined,
      });
      const rows = await narrowed.#executeDeleteReturning(annotationsMap).toArray();
      return rows[0] ?? null;
    });
  }

  /**
   * Write terminal: delete every matching row and stream the deleted
   * rows. Requires a prior `.where(...)` filter. Throws `ORM.ARGUMENT_INVALID` on a collection with a limit, an offset, a cursor, `distinct` or `distinctOn`, which the statement cannot apply.
   *
   * The returned `AsyncIterableResult<Row>` is BOTH a thenable that
   * resolves to `Row[]` AND an async iterable that streams deleted
   * rows as they arrive. Use whichever fits; a result can only be
   * consumed once. Streaming is the default; some driver/plan
   * combinations may still buffer internally before yielding.
   *
   * ```typescript
   * // Thenable — collect the deleted rows into an array:
   * const deleted = await db.orm.Post.where({ archived: true }).deleteAll();
   *
   * // Async iterable — stream deleted rows as they arrive:
   * for await (const row of db.orm.Post.where({ archived: true }).deleteAll()) {
   *   console.log('removed', row.id);
   * }
   * ```
   *
   * Accepts an optional `configure` callback that receives a
   * `MetaBuilder<'write'>` for attaching typed annotations.
   */
  deleteAll<Self extends HasWhere>(
    this: Self,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): AsyncIterableResult<CollectionRowOf<Self & HasRow<CollectionRowOf<this>>>>;
  deleteAll(configure?: (meta: MetaBuilder<'write'>) => void): AsyncIterableResult<unknown> {
    assertBulkWriteIgnoresNothing(this.state, this.modelName, 'deleteAll');
    assertLockCompatible(this.state, 'mutation');
    return this.#deleteAllWithAnnotations(
      this.#collectAnnotationsFromMeta(configure, 'write', 'deleteAll'),
    );
  }

  #deleteAllWithAnnotations(
    annotationsMap: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> | undefined,
  ): AsyncIterableResult<Row> {
    assertReturningCapability(this.contract, 'deleteAll()');
    return this.#executeDeleteReturning(annotationsMap);
  }

  #executeDeleteReturning(
    annotationsMap: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> | undefined,
  ): AsyncIterableResult<Row> {
    if (this.state.includes.length > 0) {
      return this.#executeDeleteReturningWithIncludes(annotationsMap);
    }

    const { selectedForQuery: selectedForDelete, hiddenColumns } = this.#augmentMutationSelection();
    const compiled = mergeAnnotations(
      compileDeleteReturning(
        this.contract,
        this.namespaceId,
        this.modelName,
        this.tableName,
        this.state.filters,
        selectedForDelete,
      ),
      annotationsMap,
    );
    return dispatchMutationRows<Row>({
      context: this.ctx.context,
      runtime: this.ctx.runtime,
      compiled,
      tableName: this.tableName,
      modelName: this.modelName,
      namespaceId: this.namespaceId,
      variantName: this.state.variantName,
      includes: this.state.includes,
      selectedFields: this.state.selectedFields,
      hiddenColumns,
      mapRow: (mapped) =>
        blindCast<Row, 'mapped delete storage row matches the collection generic row'>(mapped),
    });
  }

  /**
   * Delete read-back with includes.
   *
   * A parent-anchored single-query include read can't observe a row
   * that has already been deleted, so this reads the rows together with
   * their relations BEFORE issuing the DELETE. The snapshot is fully
   * drained into a plain array with `.toArray()` while the rows still
   * exist; only then does the DELETE run. The yielded `for..of` walks
   * that in-memory array, not a live cursor, so nothing reads from the
   * deleted rows after the fact. Snapshot read and delete share one
   * `withMutationScope` so they are atomic; the returned relations
   * reflect the row's state at delete time.
   */
  #executeDeleteReturningWithIncludes(
    annotationsMap: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> | undefined,
  ): AsyncIterableResult<Row> {
    const collection = this;
    const generator = async function* (): AsyncGenerator<Row, void, unknown> {
      const snapshot = await withMutationScope(collection.ctx.runtime, async (scope) => {
        const rows = await dispatchCollectionRows<Row>({
          context: collection.ctx.context,
          runtime: scope,
          state: collection.state,
          tableName: collection.tableName,
          modelName: collection.modelName,
          namespaceId: collection.namespaceId,
        }).toArray();
        const deletePlan = mergeAnnotations(
          compileDeleteCount(
            collection.contract,
            collection.namespaceId,
            collection.tableName,
            collection.state.filters,
            collection.state.variantName,
            collection.modelName,
          ),
          annotationsMap,
        );
        await scope.execute(deletePlan);
        return rows;
      });
      for (const row of snapshot) {
        yield row;
      }
    };
    return new AsyncIterableResult(generator());
  }

  /**
   * Write terminal: delete every matching row without returning them,
   * resolving to the count of rows that were deleted. Requires a prior
   * `.where(...)` filter. Throws `ORM.ARGUMENT_INVALID` on a collection with a limit, an offset, a cursor, `distinct` or `distinctOn`, which the statement cannot apply.
   *
   * Prefer `deleteAll(...)` when you need the deleted rows; prefer
   * this when you only need the affected-row count.
   *
   * ```typescript
   * const removed = await db.orm.Post.where({ archived: true }).deleteAndCount();
   * ```
   */
  async deleteAndCount<Self extends HasWhere>(
    this: Self,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<number>;
  async deleteAndCount(configure?: (meta: MetaBuilder<'write'>) => void): Promise<number> {
    assertBulkWriteIgnoresNothing(this.state, this.modelName, 'deleteAndCount');
    assertLockCompatible(this.state, 'mutation');
    const annotationsMap = this.#collectAnnotationsFromMeta(configure, 'write', 'deleteAndCount');

    const compiled = mergeAnnotations(
      compileDeleteCount(
        this.contract,
        this.namespaceId,
        this.tableName,
        this.state.filters,
        this.state.variantName,
        this.modelName,
      ),
      annotationsMap,
    );
    const stats = await this.ctx.runtime.execute(compiled);
    return stats.affectedRows;
  }

  #buildUpsertConflictCriterion(
    createValues: Record<string, unknown>,
    conflictColumns: readonly string[],
  ): Record<string, unknown> {
    const criterion: Record<string, unknown> = {};

    for (const columnName of conflictColumns) {
      if (!(columnName in createValues)) {
        throw ormError(
          'ORM.ARGUMENT_INVALID',
          `upsert() for model "${this.modelName}" requires create value for conflict column "${columnName}"`,
          { meta: { method: 'upsert', model: this.modelName, column: columnName } },
        );
      }

      const fieldName = fieldOfColumn(
        getModelColumnFields(this.contract, this.namespaceId, this.modelName),
        this.modelName,
        columnName,
      );
      criterion[fieldName] = createValues[columnName];
    }

    return criterion;
  }

  /**
   * Shape the projection for a mutation's `RETURNING` clause.
   *
   * Without includes, the mutation returns the caller's projection
   * directly. With includes, it returns only the row identity columns
   * (PK / unique): those rows are reloaded through the read path
   * (`reloadMutationRowsByIdentities`), which re-selects the caller's
   * projection together with the relations, so the `RETURNING` clause
   * need only carry enough to key that read-back.
   */
  #augmentMutationSelection(): {
    selectedForQuery: readonly string[] | undefined;
    hiddenColumns: readonly string[];
  } {
    if (this.state.includes.length > 0) {
      const identityColumns = resolveRowIdentityColumns(
        this.contract,
        this.namespaceId,
        this.tableName,
      );
      if (identityColumns.length === 0) {
        throw ormError(
          'ORM.ROW_IDENTITY_MISSING',
          `Cannot load includes for the mutation result on model "${this.modelName}": table "${this.tableName}" has no primary key or unique constraint to key the include read-back on.`,
          { meta: { model: this.modelName, table: this.tableName } },
        );
      }
      return { selectedForQuery: identityColumns, hiddenColumns: [] };
    }
    return { selectedForQuery: this.state.selectedFields, hiddenColumns: [] };
  }

  async #findFirstMatchingRowIdentityWhere(): Promise<AnyExpression | null> {
    const identityColumns = resolveRowIdentityColumns(
      this.contract,
      this.namespaceId,
      this.tableName,
    );
    if (identityColumns.length === 0) {
      throw ormError(
        'ORM.ROW_IDENTITY_MISSING',
        `update()/delete() on model "${this.modelName}" requires the table to have a primary key or unique constraint`,
        { meta: { model: this.modelName, table: this.tableName } },
      );
    }
    checkLimitOffset('limit', this.state.limit);
    if (this.state.limit === 0) {
      return null;
    }
    const firstRow = await this.#clone({
      selectedFields: [...identityColumns],
      includes: [],
    }).first();
    if (!firstRow) {
      return null;
    }
    const criterion: Record<string, unknown> = {};
    for (const column of identityColumns) {
      const fieldName = fieldOfColumn(
        getModelColumnFields(this.contract, this.namespaceId, this.modelName),
        this.modelName,
        column,
      );
      const value = blindCast<
        Record<string, unknown>,
        'selected collection rows are model-field records used for identity lookup'
      >(firstRow)[fieldName];
      if (value === undefined) {
        throw new InternalError(
          `Missing identity field "${fieldName}" while resolving single-row scope for model "${this.modelName}"`,
        );
      }
      criterion[fieldName] = value;
    }
    return (
      shorthandToWhereExpr(
        this.ctx.context,
        this.namespaceId,
        this.modelName,
        blindCast<
          ShorthandWhereFilter<TContract, State['nsId'], ModelName>,
          'identity columns were resolved from this model before building the shorthand filter'
        >(criterion),
      ) ?? null
    );
  }

  async #reloadMutationRowByIdentity(criterion: Record<string, unknown>): Promise<Row | null> {
    return this.#reloadMutationRowByCriterion(criterion, 'row identity');
  }

  async #reloadMutationRowByCriterion(
    criterion: Record<string, unknown>,
    criterionLabel: string,
  ): Promise<Row | null> {
    const whereExpr = shorthandToWhereExpr(
      this.ctx.context,
      this.namespaceId,
      this.modelName,
      blindCast<
        ShorthandWhereFilter<TContract, State['nsId'], ModelName>,
        'mutation reload criterion contains resolved fields for this model'
      >(criterion),
    );
    if (!whereExpr) {
      throw new InternalError(
        `Failed to build ${criterionLabel} filter for mutation result on model "${this.modelName}"`,
      );
    }

    const resultState: CollectionState = {
      ...emptyState(),
      filters: [whereExpr],
      includes: this.state.includes,
      selectedFields: this.state.selectedFields,
      limit: 1,
    };

    const rows = await dispatchCollectionRows<Row>({
      context: this.ctx.context,
      runtime: this.ctx.runtime,
      state: resultState,
      tableName: this.tableName,
      modelName: this.modelName,
      namespaceId: this.namespaceId,
    });
    return rows[0] ?? null;
  }

  #assertIncludeRefinementMode(action: string): void {
    if (this.includeRefinementMode) {
      return;
    }

    throw ormError(
      'ORM.INCLUDE_INVALID',
      `${action} is only available inside include() refinement callbacks`,
      { meta: { action } },
    );
  }

  #lock(strength: LockStrength, options: LockWaitRequest | undefined): this {
    if (this.includeRefinementMode) {
      throw lockIncompatible(
        'includeRefinement',
        `${strength}() cannot be called inside an include() refinement callback`,
      );
    }
    assertLockCapability(this.contract, lockStrengthCapabilities[strength], strength);
    assertLockCapability(this.contract, lockOptionCapabilities.of, strength);
    const waitPolicy = lockWaitPolicyOf(strength, options);
    if (waitPolicy !== undefined) {
      assertLockCapability(this.contract, lockOptionCapabilities[waitPolicy], strength);
    }
    const clause = LockingClause.of(strength, {
      of: [this.tableName],
      ...ifDefined('waitPolicy', waitPolicy),
    });
    return this.#cloneSelf({ locking: [...(this.state.locking ?? []), clause] });
  }

  #clone<NextState extends CollectionTypeState = State>(
    overrides: Partial<CollectionState>,
  ): Collection<TContract, ModelName, Row, NextState> {
    return this.#createSelf<Row, NextState>({
      ...this.state,
      ...overrides,
    });
  }

  #cloneSelf<Flags = unknown>(overrides: Partial<CollectionState>): this & Flags {
    return blindCast<
      this & Flags,
      'the clone is built by this constructor, so it is an instance of the same class'
    >(this.#createSelf<Row, State>({ ...this.state, ...overrides }));
  }

  #withRuntime(runtime: RuntimeQueryable): CollectionBase<TContract, ModelName, Row, State> {
    const Ctor = blindCast<
      CollectionConstructor<TContract>,
      'runtime collection subclasses preserve the Collection constructor contract'
    >(this.constructor);
    return blindCast<
      CollectionBase<TContract, ModelName, Row, State>,
      'runtime collection construction erases model row and state generics'
    >(
      new Ctor({ ...this.ctx, runtime }, this.modelName, {
        tableName: this.tableName,
        namespaceId: this.namespaceId,
        state: this.state,
        registry: this.registry,
        includeRefinementMode: this.includeRefinementMode,
      }),
    );
  }

  #cloneWithRow<NextRow, NextState extends CollectionTypeState = State>(
    overrides: Partial<CollectionState>,
  ): Collection<TContract, ModelName, NextRow, NextState> {
    return this.#createSelf<NextRow, NextState>({
      ...this.state,
      ...overrides,
    });
  }

  #createSelf<NextRow, NextState extends CollectionTypeState>(
    state: CollectionState,
  ): Collection<TContract, ModelName, NextRow, NextState> {
    const Ctor = blindCast<
      CollectionConstructor<TContract>,
      'runtime collection subclasses preserve the Collection constructor contract'
    >(this.constructor);
    return blindCast<
      Collection<TContract, ModelName, NextRow, NextState>,
      'runtime collection cloning erases projected row and state generics'
    >(
      new Ctor(this.ctx, this.modelName, {
        tableName: this.tableName,
        namespaceId: this.namespaceId,
        state,
        registry: this.registry,
        includeRefinementMode: this.includeRefinementMode,
      }),
    );
  }

  #createCollection<
    ModelNameInner extends string,
    RowInner,
    StateInner extends CollectionTypeState,
  >(
    modelName: ModelNameInner,
    options: CollectionInit<TContract>,
  ): Collection<TContract, ModelNameInner, RowInner, StateInner> {
    const Ctor =
      this.registry.get(modelName) ??
      blindCast<
        CollectionConstructor<TContract>,
        'base Collection constructor is generic over the runtime contract'
      >(CollectionBase);
    return blindCast<
      Collection<TContract, ModelNameInner, RowInner, StateInner>,
      'runtime related collection construction erases model row and state generics'
    >(
      new Ctor(this.ctx, modelName, {
        tableName: options.tableName,
        namespaceId: options.namespaceId,
        state: options.state,
        registry: options.registry ?? this.registry,
        includeRefinementMode: options.includeRefinementMode ?? this.includeRefinementMode,
      }),
    );
  }

  #dispatch(): AsyncIterableResult<Row> {
    return dispatchCollectionRows<Row>({
      context: this.ctx.context,
      runtime: this.ctx.runtime,
      state: this.state,
      tableName: this.tableName,
      modelName: this.modelName,
      namespaceId: this.namespaceId,
    });
  }

  /**
   * Invokes the user-supplied configurator (if any) against a freshly
   * constructed read meta builder, and returns a clone whose
   * `state.annotations` carries the recorded map. Used by read
   * terminals that flow annotations through state (`all`, `first`).
   *
   * Returns the receiver unchanged when no configurator was supplied
   * or when the configurator did not call `meta.annotate(...)`. The
   * meta builder's `annotate` method enforces applicability at the
   * type level and at runtime, so terminal code does not need to
   * re-validate.
   */
  #withAnnotationsFromMeta(
    configure: ((meta: MetaBuilder<'read'>) => void) | undefined,
    terminalName: string,
  ): this {
    if (configure === undefined) {
      return this;
    }
    const meta = createMetaBuilder('read', terminalName);
    configure(meta);
    if (meta.annotations.size === 0) {
      return this;
    }
    const next = new Map(this.state.annotations);
    for (const [namespace, value] of meta.annotations) {
      next.set(namespace, value);
    }
    return blindCast<
      this,
      'annotation cloning preserves the concrete collection subclass runtime type'
    >(this.#clone({ annotations: next }));
  }

  /**
   * Invokes the user-supplied configurator (if any) against a freshly
   * constructed meta builder of the given operation kind, and returns
   * the recorded annotation map (or `undefined` when empty). Used by
   * terminals where annotations don't flow through `state` — the
   * compiled plan is post-wrapped via `mergeAnnotations` instead.
   * Read terminals `all` and `first` populate `state.annotations`
   * via `#withAnnotationsFromMeta` instead; `aggregate` uses this
   * post-wrap path because `compileAggregate` does not forward `state.annotations` into the plan.
   * The meta builder's `annotate` method enforces applicability at the
   * type level and at runtime.
   */
  #collectAnnotationsFromMeta<K extends OperationKind>(
    configure: ((meta: MetaBuilder<K>) => void) | undefined,
    kind: K,
    terminalName: string,
  ): ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> | undefined {
    if (configure === undefined) {
      return undefined;
    }
    const meta = createMetaBuilder(kind, terminalName);
    configure(meta);
    return meta.annotations.size === 0 ? undefined : meta.annotations;
  }
}

const collectionInstanceMemberNames = [
  'ctx',
  'contract',
  'modelName',
  'tableName',
  'namespaceId',
  'state',
  'registry',
  'includeRefinementMode',
] as const;

/**
 * Every member name the collection surface owns: the prototype's methods plus
 * the declared instance fields. A contributed aggregate operation may not
 * take one of these names — reducers install into the same flat namespace —
 * so ORM composition rejects any operation this set contains.
 */
export function reservedCollectionMemberNames(): ReadonlySet<string> {
  return new Set([
    ...Object.getOwnPropertyNames(CollectionBase.prototype),
    ...collectionInstanceMemberNames,
  ]);
}

/**
 * The public collection surface: the chainable builder and terminal methods
 * the class declares, plus one include-scalar reducer per operation the
 * contract's emitted aggregate map declares
 * ({@link AggregateIncludeReducers}). The reducer set derives from the map —
 * chaining preserves it, and a contributed operation surfaces without any
 * client change.
 */
export type Collection<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Row = SimplifyDeep<InferRootRow<TContract, ModelName>>,
  State extends CollectionTypeState = DefaultCollectionTypeState,
> = CollectionBase<TContract, ModelName, Row, State> &
  AggregateIncludeReducers<TContract, ModelName, State['nsId']>;

/**
 * The constructor face of {@link Collection}: constructing — or subclassing,
 * as custom collections registered via `orm({ collections })` do — yields the
 * intersection surface, whose reducer members the constructor installs from
 * the registry the execution context carries.
 */
interface CollectionSurfaceConstructor {
  new <
    TContract extends Contract<SqlStorage>,
    ModelName extends string,
    Row = SimplifyDeep<InferRootRow<TContract, ModelName>>,
    State extends CollectionTypeState = DefaultCollectionTypeState,
  >(
    ctx: CollectionContext<TContract>,
    modelName: ModelName,
    options: CollectionInit<TContract>,
  ): Collection<TContract, ModelName, Row, State>;
}

export const Collection = blindCast<
  CollectionSurfaceConstructor,
  'the constructor installs one reducer per aggregate operation the registry contributes'
>(CollectionBase);
