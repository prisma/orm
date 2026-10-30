import type { Contract } from '@internal/contract/types';
import type {
  AnnotationValue,
  MetaBuilder,
  OperationKind,
} from '@internal/framework-components/runtime';
import { AsyncIterableResult, createMetaBuilder } from '@internal/framework-components/runtime';
import type { ExtractCodecTypes, SqlStorage } from '@internal/sql-contract/types';
import {
  BinaryExpr,
  isWhereExpr,
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
import type { CollectionMethodReceiver } from '@internal/sql-relational-core/collection-methods';
import { type TraitExpression, toExpr } from '@internal/sql-relational-core/expression';
import type { Preparable, SqlQueryPlan } from '@internal/sql-relational-core/plan';
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
  addressedModel,
  assertDistinctOnCapability,
  assertInsertConflictSkipCapability,
  assertLockCapability,
  assertReturningCapability,
  columnOfCallerField,
  getModelAndVariantFieldColumns,
  getModelFieldColumns,
  getOwnFieldColumns,
  hasCompleteUniqueKey,
  isToOneCardinality,
  type PolymorphismInfo,
  type PolymorphismVariantInfo,
  resolveIncludeRelation,
  resolveInsertConflictColumns,
  resolveModelTableName,
  resolvePolymorphismInfo,
  resolveUpsertConflictColumns,
} from './collection-contract';
import {
  consumeFirstRow,
  describeCollectionFirst,
  describeCollectionFirstOrThrow,
  describeCollectionQuery,
  describeCollectionRows,
  dispatchCollectionRows,
  runQuery,
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
  type ContributedCollectionMethods,
  collectionMethodTable,
  createCollectionMethods,
} from './collection-methods';
import { assertModelFieldNames, mapModelDataToStorageRow } from './collection-runtime';
import {
  type CollectionTables,
  createCollectionTables,
  createIncludeTables,
  requireVariantTable,
  tableAliases,
  withScopeCopy,
} from './collection-tables';
import type {
  CollectionRowOf,
  CollectionTypeStateOf,
  Filtered,
  HasNoUniqueFilter,
  HasNoVariant,
  HasOrderBy,
  HasRow,
  HasTypeState,
  HasUniqueFilter,
  HasWhere,
  Including,
  ModelFragmentReceiver,
  Ordered,
  QueryFragment,
  // biome-ignore lint/correctness/noUnusedImports: used in `declare` properties
  RowType,
  TypeState,
  UniquelyFiltered,
  WithoutUniqueFilter,
} from './collection-types';
import { shorthandToWhereExpr, whereArgOf } from './filters';
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
import { createModelAccessor, createModelCallbackTools } from './model-accessor';
import {
  buildRowIdentityFilterFromRow,
  executeNestedCreateMutation,
  executeNestedUpdateMutation,
  hasNestedMutationCallbacks,
} from './mutation-executor';
import {
  createAllGraph,
  createAllVariantGraph,
  deleteAllGraph,
  deleteFirstGraph,
  updateAllGraph,
  updateFirstGraph,
  upsertGraph,
  type VariantCreateRow,
} from './mutation-graph/collection-graphs';
import { Graph } from './mutation-graph/graph';
import { executeGraph, queryGraph } from './mutation-graph/run-graph';
import { assertCursorCompatibleOrder, assertDistinctOnCompatibleOrder } from './order-by-guards';
import {
  asPreparedOrmCall,
  modelHashInput,
  type OrmCall,
  ormResults,
  planHashInput,
  preparedRowsCall,
  preparedValueCall,
  runOrmCall,
  streamOrmCall,
} from './orm-call';
import { ormError } from './orm-errors';
import type { PreparedCollection } from './prepared-collection';
import { compileAggregate, type InsertConflictSkip } from './query-plan';
import type { AliasedTable } from './table-scope';
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
  type IncludeRelationOwnerNamespace,
  type IncludeRelationValue,
  type IncludeScalar,
  type InferRootRow,
  type ModelCallbackTools,
  type MutationCreateInput,
  type MutationCreateInputWithRelations,
  type MutationUpdateInput,
  type RelatedModelName,
  type RelationTargetNamespace,
  type ResolvedCreateInput,
  type ResolvedScalarCreateInput,
  type RuntimeQueryable,
  type ScalarUpdateInput,
  type ShorthandWhereFilter,
  type UniqueConstraintCriterion,
  type VariantAwareIncludeRelationNames,
  type VariantAwareModelAccessor,
  type VariantModelRow,
  type WhereCallbackResult,
  type WithNsId,
} from './types';
import { paramRefForStorageColumn } from './where-binding';
import { normalizeWhereArg } from './where-interop';
import { assertBulkWriteIgnoresNothing, assertRelationUpdateIgnoresNothing } from './write-guards';

type Annotations = ReadonlyMap<string, AnnotationValue<unknown, OperationKind>>;

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

type OrderBySelector<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  VariantName extends string | undefined,
  NsId extends string,
> = (
  model: VariantAwareModelAccessor<TContract, ModelName, VariantName, NsId>,
  tools: ModelCallbackTools<TContract, ModelName, NsId>,
) => OrderByItem;

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
  NsId extends string = never,
> {
  readonly onConflict: 'skip';
  readonly conflictOn?: readonly (keyof DefaultModelRow<TContract, ModelName, NsId> & string)[];
}

function splitCreateArguments<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string,
>(
  optionsOrConfigure:
    | CreateConflictOptions<TContract, ModelName, NsId>
    | WriteConfigure
    | undefined,
  configure: WriteConfigure | undefined,
): {
  options: CreateConflictOptions<TContract, ModelName, NsId> | undefined;
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
  #using: ReturnType<typeof createCollectionMethods> | undefined;

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
    this.state =
      options.state ??
      emptyState(
        createCollectionTables(this.contract, options.namespaceId, modelName, this.tableName),
      );
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
      model: VariantAwareModelAccessor<TContract, ModelName, State['variantValue'], State['nsId']>,
      tools: ModelCallbackTools<TContract, ModelName, State['nsId']>,
    ) => WhereCallbackResult,
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
            State['variantValue'],
            State['nsId']
          >,
          tools: ModelCallbackTools<TContract, ModelName, State['nsId']>,
        ) => WhereCallbackResult)
      | ShorthandWhereFilter<TContract, State['nsId'], ModelName>,
  ): Filtered<this> {
    const tables = withScopeCopy(this.state.tables);
    const whereArg =
      typeof input === 'function'
        ? whereArgOf(
            input(
              createModelAccessor<TContract, ModelName, State['variantValue'], State['nsId']>(
                this.ctx.context,
                this.namespaceId,
                this.modelName,
                tables,
                this.state.variantValue,
              ),
              this.#callbackTools(tables),
            ),
          )
        : isWhereDirectInput(input)
          ? input
          : shorthandToWhereExpr(
              this.ctx.context,
              this.namespaceId,
              this.modelName,
              input,
              tables.root,
            );
    const filter = normalizeWhereArg(whereArg, {
      contract: this.contract,
      tables: tableAliases(tables),
    });

    if (!filter) {
      return blindCast<
        Filtered<this>,
        'where() records its static state even when normalization produces no filter'
      >(this);
    }

    return this.#cloneSelf<HasWhere>({
      tables,
      filters: [...this.state.filters, filter],
    });
  }

  /**
   * The collection methods packages contribute for this model. Each contribution reads the model and names its methods. Each method returns this collection with the method's filter and order added.
   */
  get using(): ContributedCollectionMethods<TContract, ModelName, State['nsId'], this> {
    this.#using ??= createCollectionMethods(
      blindCast<CollectionMethodReceiver, 'a collection has where and orderBy'>(this),
      collectionMethodTable(this.ctx.context, this.namespaceId, this.modelName),
    );
    return blindCast<
      ContributedCollectionMethods<TContract, ModelName, State['nsId'], this>,
      'the run time offers the methods each contribution gives this model, as the type does for the registry'
    >(this.#using);
  }

  whereUnique<Self>(
    this: Self,
    criterion: UniqueConstraintCriterion<TContract, ModelName, State['nsId']>,
  ): UniquelyFiltered<Self>;
  whereUnique(
    criterion: UniqueConstraintCriterion<TContract, ModelName, State['nsId']>,
  ): UniquelyFiltered<this> {
    if (this.includeRefinementMode) {
      throw ormError(
        'ORM.INCLUDE_INVALID',
        'whereUnique() is not available inside include() refinement callbacks',
        { meta: { action: 'whereUnique()' } },
      );
    }
    if (!hasCompleteUniqueKey(this.contract, this.namespaceId, this.modelName, criterion)) {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        `whereUnique() for model "${this.modelName}" needs a value for every field of the primary key or of one unique constraint`,
        { meta: { method: 'whereUnique', argument: 'criterion', model: this.modelName } },
      );
    }
    const tables = withScopeCopy(this.state.tables);
    const filter = normalizeWhereArg(
      shorthandToWhereExpr(
        this.ctx.context,
        this.namespaceId,
        this.modelName,
        criterion,
        tables.root,
      ),
      { contract: this.contract, tables: tableAliases(tables) },
    );

    return this.#cloneSelf<HasWhere & HasUniqueFilter>(
      filter ? { tables, filters: [...this.state.filters, filter] } : {},
    );
  }

  #callbackTools(
    tables: CollectionTables,
  ): ModelCallbackTools<TContract, ModelName, State['nsId']> {
    return createModelCallbackTools<TContract, ModelName, State['nsId']>(
      this.ctx.context,
      this.modelName,
      tables,
    );
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
    V extends DiscriminatorValues<TContract, ModelName, S['nsId']>,
    S extends CollectionTypeState = State,
  >(
    this: HasTypeState<S> & HasNoVariant,
    value: V,
  ): Collection<
    TContract,
    ModelName,
    VariantModelRow<TContract, ModelName, V, S['nsId']>,
    WithVariantState<WithWhereState<S>, V>
  >;
  variant<V extends DiscriminatorValues<TContract, ModelName, State['nsId']>>(
    this: HasNoVariant,
    value: V,
  ): Collection<
    TContract,
    ModelName,
    VariantModelRow<TContract, ModelName, V, State['nsId']>,
    WithVariantState<WithWhereState<State>, V>
  >;
  variant<V extends DiscriminatorValues<TContract, ModelName, State['nsId']>>(
    value: V,
  ): Collection<
    TContract,
    ModelName,
    VariantModelRow<TContract, ModelName, V, State['nsId']>,
    WithVariantState<WithWhereState<State>, V>
  > {
    const polyInfo = resolvePolymorphismInfo(this.contract, this.namespaceId, this.modelName);
    const selectedVariantValue = this.state.variantValue;

    if (selectedVariantValue !== undefined) {
      throw ormError(
        'ORM.OPERATION_UNSUPPORTED',
        `variant("${value}") cannot be called on model "${this.modelName}" because variant("${selectedVariantValue}") is already selected; call variant() on the base collection instead`,
        {
          meta: {
            method: 'variant',
            model: this.modelName,
            variant: polyInfo?.variants.get(selectedVariantValue)?.modelName,
            selectedValue: selectedVariantValue,
            reason: 'variant-already-selected',
          },
        },
      );
    }

    const variantInfo = polyInfo?.variants.get(value);

    if (!polyInfo || !variantInfo) {
      const declaredValues = [...(polyInfo?.variants.keys() ?? [])];
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
      this.state.tables.root.column(columnName),
      paramRefForStorageColumn(
        this.contract,
        this.state.tables.root.storage,
        columnName,
        variantInfo.value,
      ),
    );

    return this.#cloneWithRow<
      VariantModelRow<TContract, ModelName, V, State['nsId']>,
      WithVariantState<WithWhereState<State>, V>
    >({
      filters: [...this.state.filters, filter],
      variantValue: variantInfo.value,
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
      State['variantValue'],
      State['nsId']
    >,
    RelationOwner extends string = IncludeRelationOwner<
      TContract,
      ModelName,
      State['variantValue'],
      RelName,
      State['nsId']
    > &
      string,
    OwnerNs extends string = IncludeRelationOwnerNamespace<
      TContract,
      ModelName,
      State['variantValue'],
      RelName,
      State['nsId']
    >,
    RelatedName extends RelatedModelName<TContract, RelationOwner, RelName, OwnerNs> &
      string = RelatedModelName<TContract, RelationOwner, RelName, OwnerNs> & string,
    TargetNs extends string = RelationTargetNamespace<TContract, RelationOwner, RelName, OwnerNs>,
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
        OwnerNs
      >;
    }
  >;
  include<
    RelName extends VariantAwareIncludeRelationNames<
      TContract,
      ModelName,
      State['variantValue'],
      State['nsId']
    >,
    RelationOwner extends string = IncludeRelationOwner<
      TContract,
      ModelName,
      State['variantValue'],
      RelName,
      State['nsId']
    > &
      string,
    OwnerNs extends string = IncludeRelationOwnerNamespace<
      TContract,
      ModelName,
      State['variantValue'],
      RelName,
      State['nsId']
    >,
    RelatedName extends RelatedModelName<TContract, RelationOwner, RelName, OwnerNs> &
      string = RelatedModelName<TContract, RelationOwner, RelName, OwnerNs> & string,
    TargetNs extends string = RelationTargetNamespace<TContract, RelationOwner, RelName, OwnerNs>,
    IsToMany extends boolean = IsToManyRelation<TContract, RelationOwner, RelName, OwnerNs>,
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
        OwnerNs
      >;
    }
  >;
  include<
    RelName extends VariantAwareIncludeRelationNames<
      TContract,
      ModelName,
      State['variantValue'],
      State['nsId']
    >,
    RelationOwner extends string = IncludeRelationOwner<
      TContract,
      ModelName,
      State['variantValue'],
      RelName,
      State['nsId']
    > &
      string,
    OwnerNs extends string = IncludeRelationOwnerNamespace<
      TContract,
      ModelName,
      State['variantValue'],
      RelName,
      State['nsId']
    >,
    RelatedName extends RelatedModelName<TContract, RelationOwner, RelName, OwnerNs> &
      string = RelatedModelName<TContract, RelationOwner, RelName, OwnerNs> & string,
    TargetNs extends string = RelationTargetNamespace<TContract, RelationOwner, RelName, OwnerNs>,
    IsToMany extends boolean = IsToManyRelation<TContract, RelationOwner, RelName, OwnerNs>,
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
          OwnerNs
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
      this.state.variantValue,
    );

    const child = createIncludeTables(this.contract, this.state.tables, relation);
    let nestedState = emptyState(child.tables);
    let adoptedScope = child.tables.scope;
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
          state: nestedState,
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
        adoptedScope = refined.state.tables.scope;
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
        adoptedScope = refined.state.tables.scope;
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
      ...ifDefined('localVariantValue', relation.localVariantValue),
      targetColumns: relation.targetColumns,
      localColumns: relation.localColumns,
      cardinality: relation.cardinality,
      ...ifDefined('through', relation.through),
      ...ifDefined('junction', child.junction),
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
            OwnerNs
          >;
        }
      >,
      CollectionTypeStateOf<this>
    >({
      tables: { ...this.state.tables, scope: adoptedScope },
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
      keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string,
      ...(keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string)[],
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
      Pick<DefaultModelRow<TContract, ModelName, State['nsId']>, Fields[number]> &
        IncludedRelationsForRow<TContract, ModelName, R, State['nsId']>
    >,
    S
  >;
  select<
    Fields extends readonly [
      keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string,
      ...(keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string)[],
    ],
  >(
    ...fields: Fields
  ): Collection<
    TContract,
    ModelName,
    SimplifyDeep<
      Pick<DefaultModelRow<TContract, ModelName, State['nsId']>, Fields[number]> &
        IncludedRelationsForRow<TContract, ModelName, Row, State['nsId']>
    >,
    State
  >;
  select<
    Fields extends readonly [
      keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string,
      ...(keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string)[],
    ],
  >(
    ...fields: Fields
  ): Collection<
    TContract,
    ModelName,
    SimplifyDeep<
      Pick<DefaultModelRow<TContract, ModelName, State['nsId']>, Fields[number]> &
        IncludedRelationsForRow<TContract, ModelName, Row, State['nsId']>
    >,
    State
  > {
    const selectedFields = mapSelectedFieldsToColumns(
      this.contract,
      this.namespaceId,
      this.modelName,
      this.state.variantValue,
      fields,
    );

    return this.#cloneWithRow<
      SimplifyDeep<
        Pick<DefaultModelRow<TContract, ModelName, State['nsId']>, Fields[number]> &
          IncludedRelationsForRow<TContract, ModelName, Row, State['nsId']>
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
  orderBy<Self extends WithoutUniqueFilter<Self>>(
    this: Self,
    selection:
      | OrderBySelector<TContract, ModelName, State['variantValue'], State['nsId']>
      | ReadonlyArray<OrderBySelector<TContract, ModelName, State['variantValue'], State['nsId']>>,
  ): Ordered<Self>;
  orderBy<Self>(
    this: Self & HasNoUniqueFilter,
    selection:
      | OrderBySelector<TContract, ModelName, State['variantValue'], State['nsId']>
      | ReadonlyArray<OrderBySelector<TContract, ModelName, State['variantValue'], State['nsId']>>,
  ): Ordered<Self>;
  orderBy(
    selection:
      | OrderBySelector<TContract, ModelName, State['variantValue'], State['nsId']>
      | ReadonlyArray<OrderBySelector<TContract, ModelName, State['variantValue'], State['nsId']>>,
  ): Ordered<this> {
    const tables = withScopeCopy(this.state.tables);
    const accessor = createModelAccessor<
      TContract,
      ModelName,
      State['variantValue'],
      State['nsId']
    >(this.ctx.context, this.namespaceId, this.modelName, tables, this.state.variantValue);
    const tools = this.#callbackTools(tables);
    const selectors = Array.isArray(selection) ? selection : [selection];
    const nextOrders = selectors.map((selector) => selector(accessor, tools));
    const existing = this.state.orderBy ?? [];
    return this.#cloneSelf<HasOrderBy>({
      tables,
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
    Self = unknown,
  >(
    this: Self & HasNoUniqueFilter,
    ...fields: Fields
  ): GroupedCollection<TContract, ModelName, Fields, State['nsId']>;
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
  cursor<Self extends HasOrderBy & WithoutUniqueFilter<Self>>(
    this: Self,
    cursorValues: Partial<
      Record<keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string, unknown>
    >,
  ): Self;
  cursor<Self extends HasOrderBy>(
    this: Self & HasNoUniqueFilter,
    cursorValues: Partial<
      Record<keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string, unknown>
    >,
  ): Self;
  cursor(
    cursorValues: Partial<
      Record<keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string, unknown>
    >,
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
      keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string,
      ...(keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string)[],
    ],
    Self extends WithoutUniqueFilter<Self>,
  >(this: Self, ...fields: Fields): Self;
  distinct<
    Fields extends readonly [
      keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string,
      ...(keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string)[],
    ],
    Self,
  >(this: Self & HasNoUniqueFilter, ...fields: Fields): Self;
  distinct<
    Fields extends readonly [
      keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string,
      ...(keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string)[],
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
      keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string,
      ...(keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string)[],
    ],
    Self extends HasOrderBy & WithoutUniqueFilter<Self>,
  >(
    this: Self,
    ...fields: TContract['capabilities'] extends { postgres: { distinctOn: true } } ? Fields : never
  ): Self;
  distinctOn<
    Fields extends readonly [
      keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string,
      ...(keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string)[],
    ],
    Self extends HasOrderBy,
  >(
    this: Self & HasNoUniqueFilter,
    ...fields: TContract['capabilities'] extends { postgres: { distinctOn: true } } ? Fields : never
  ): Self;
  distinctOn<
    Fields extends readonly [
      keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string,
      ...(keyof DefaultModelRow<TContract, ModelName, State['nsId']> & string)[],
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
  limit<Self extends WithoutUniqueFilter<Self>>(
    this: Self,
    n: number | TraitExpression<readonly ['numeric'], false, ExtractCodecTypes<TContract>>,
  ): Self;
  limit<Self>(
    this: Self & HasNoUniqueFilter,
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
  offset<Self extends WithoutUniqueFilter<Self>>(
    this: Self,
    n: number | TraitExpression<readonly ['numeric'], false, ExtractCodecTypes<TContract>>,
  ): Self;
  offset<Self>(
    this: Self & HasNoUniqueFilter,
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
   * Accepts an optional `configure` callback that receives a `MetaBuilder<'read'>` so the caller can attach typed user annotations to the call. `meta.annotate(...)` enforces applicability at the type level and at runtime. Every terminal method runs as one `orm-call` activity that carries the annotations; the statements it sends carry none.
   *
   * ```typescript
   * await db.orm.User.all((meta) => meta.annotate(cacheAnnotation({ key: 'users' })));
   * ```
   */
  all<Self extends this>(
    this: Self & HasNoUniqueFilter,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): AsyncIterableResult<CollectionRowOf<Self>>;
  all<Self>(
    this: Self & HasNoUniqueFilter,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): AsyncIterableResult<CollectionRowOf<this>>;
  all(configure?: (meta: MetaBuilder<'read'>) => void): AsyncIterableResult<unknown> {
    const annotations = this.#collectAnnotationsFromMeta(configure, 'read', 'all');
    const query = describeCollectionQuery<Row>(this.#descriptionOptions());
    return streamOrmCall(
      this.ctx.runtime,
      this.#readCall('all', annotations, query.plan, ormResults.rows),
      query.rows,
    );
  }

  get prepared(): PreparedCollection<
    TContract,
    ModelName,
    CollectionRowOf<this>,
    CollectionTypeStateOf<this>
  > {
    const prepared: Omit<
      PreparedCollection<TContract, ModelName, Row, CollectionTypeStateOf<this>>,
      typeof TypeState
    > = {
      aggregate: (fn, configure) => this.#preparedAggregate(fn, configure),
      all: (configure) => {
        const annotations = this.#collectAnnotationsFromMeta(configure, 'read', 'all');
        const description = describeCollectionRows<Row>(this.#descriptionOptions());
        return asPreparedOrmCall(
          description,
          preparedRowsCall('all', annotations, description.consume),
        );
      },
      first: (filter, configure) => {
        const scoped = this.#forFirst(filter);
        const annotations = this.#collectAnnotationsFromMeta(configure, 'read', 'first');
        const description = describeCollectionFirst<Row>(scoped.#descriptionOptions());
        return asPreparedOrmCall(
          description,
          preparedValueCall('first', annotations, description.consume, ormResults.rowOrNull<Row>),
        );
      },
      firstOrThrow: (filter, configure) => {
        const scoped = this.#forFirst(filter);
        const annotations = this.#collectAnnotationsFromMeta(configure, 'read', 'firstOrThrow');
        const description = describeCollectionFirstOrThrow<Row>(scoped.#descriptionOptions());
        return asPreparedOrmCall(
          description,
          preparedValueCall('firstOrThrow', annotations, description.consume, ormResults.row<Row>),
        );
      },
    };
    return blindCast<
      PreparedCollection<TContract, ModelName, CollectionRowOf<this>, CollectionTypeStateOf<this>>,
      'the row this collection reads is the row its type carries'
    >(prepared);
  }

  #preparedAggregate<Spec extends AggregateSpec>(
    fn: (aggregate: AggregateBuilder<TContract, ModelName, State['nsId']>) => Spec,
    configure: ((meta: MetaBuilder<'read'>) => void) | undefined,
  ): Preparable<Record<string, unknown>, Promise<AggregateResult<Spec>>> {
    const description = this.#describeAggregate(fn);
    const annotations = this.#collectAnnotationsFromMeta(configure, 'read', 'aggregate');
    return asPreparedOrmCall(
      description,
      preparedValueCall(
        'aggregate',
        annotations,
        description.consume,
        ormResults.row<AggregateResult<Spec>>,
      ),
    );
  }

  #descriptionOptions() {
    return {
      context: this.ctx.context,
      state: this.state,
      modelName: this.modelName,
      namespaceId: this.namespaceId,
    };
  }

  #forFirst(
    filter: WhereInput<TContract, State['nsId'], ModelName, State['variantValue']> | undefined,
  ) {
    const scoped =
      filter === undefined
        ? this
        : typeof filter === 'function'
          ? this.where(filter)
          : this.where(filter);
    return scoped.limit(1);
  }

  #readCall<Result>(
    method: string,
    annotations: Annotations | undefined,
    plan: () => SqlQueryPlan,
    accepts: (value: unknown) => value is Result,
  ): OrmCall<Result> {
    return { method, annotations, hashInput: planHashInput(plan), accepts };
  }

  #writeCall<Result>(
    method: string,
    annotations: Annotations | undefined,
    accepts: (value: unknown) => value is Result,
  ): OrmCall<Result> {
    return {
      method,
      annotations,
      hashInput: modelHashInput(this.namespaceId, this.modelName),
      accepts,
    };
  }

  #on(queryable: RuntimeQueryable): CollectionContext<TContract> {
    return { ...this.ctx, runtime: queryable };
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
    filter?: WhereInput<TContract, State['nsId'], ModelName, State['variantValue']>,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Promise<CollectionRowOf<Self> | null>;
  async first(
    filter?: WhereInput<TContract, State['nsId'], ModelName, State['variantValue']>,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Promise<CollectionRowOf<this> | null>;
  async first(
    filter?: WhereInput<TContract, State['nsId'], ModelName, State['variantValue']>,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Promise<unknown> {
    const scoped = this.#forFirst(filter);
    const annotations = this.#collectAnnotationsFromMeta(configure, 'read', 'first');
    const query = describeCollectionQuery<Row>(scoped.#descriptionOptions());
    return runOrmCall(
      this.ctx.runtime,
      this.#readCall('first', annotations, query.plan, ormResults.rowOrNull<Row>),
      (queryable) => consumeFirstRow(query.rows(queryable)),
    );
  }

  async firstOrThrow<Self extends this>(
    this: Self,
    filter?: WhereInput<TContract, State['nsId'], ModelName, State['variantValue']>,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Promise<CollectionRowOf<Self>>;
  async firstOrThrow(
    filter?: WhereInput<TContract, State['nsId'], ModelName, State['variantValue']>,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Promise<CollectionRowOf<this>>;
  async firstOrThrow(
    filter?: WhereInput<TContract, State['nsId'], ModelName, State['variantValue']>,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Promise<unknown> {
    const scoped = this.#forFirst(filter);
    const annotations = this.#collectAnnotationsFromMeta(configure, 'read', 'firstOrThrow');
    const query = describeCollectionQuery<Row>(scoped.#descriptionOptions());
    return runOrmCall(
      this.ctx.runtime,
      this.#readCall('firstOrThrow', annotations, query.plan, ormResults.row<Row>),
      (queryable) => query.rows(queryable).firstOrThrow(),
    );
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
   * `MetaBuilder<'read'>` for attaching typed annotations to the call.
   */
  async aggregate<Spec extends AggregateSpec, Self = unknown>(
    this: Self & HasNoUniqueFilter,
    fn: (aggregate: AggregateBuilder<TContract, ModelName, State['nsId']>) => Spec,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Promise<AggregateResult<Spec>>;
  async aggregate<Spec extends AggregateSpec>(
    fn: (aggregate: AggregateBuilder<TContract, ModelName, State['nsId']>) => Spec,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Promise<AggregateResult<Spec>> {
    const description = this.#describeAggregate(fn);
    const annotations = this.#collectAnnotationsFromMeta(configure, 'read', 'aggregate');
    return runOrmCall(
      this.ctx.runtime,
      this.#readCall(
        'aggregate',
        annotations,
        () => description.plan,
        ormResults.row<AggregateResult<Spec>>,
      ),
      (queryable) => runQuery(queryable, description),
    );
  }

  #describeAggregate<Spec extends AggregateSpec>(
    fn: (aggregate: AggregateBuilder<TContract, ModelName, State['nsId']>) => Spec,
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

    const compiled = compileAggregate(
      this.contract,
      this.ctx.context.aggregateDescriptors,
      this.state,
      aggregateSpec,
      this.modelName,
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
          await Promise.all(
            results.map(async ({ alias, resolved, codec }) => {
              const value = Object.hasOwn(row, alias) ? row[alias] : undefined;
              return [alias, value ?? (await emptyAggregateResult(resolved, codec))];
            }),
          ),
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
   * Accepts an optional `configure` callback that receives a `MetaBuilder<'write'>` for attaching typed annotations to the call, including when the input contains relation callbacks and the call sends several statements and a read-back.
   */
  async create<Self extends this>(
    this: Self,
    data: ResolvedCreateInput<TContract, ModelName, State['variantValue'], State['nsId']>,
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
      | ResolvedCreateInput<TContract, ModelName, State['variantValue'], State['nsId']>
      | MutationCreateInputWithRelations<TContract, ModelName, State['nsId']>,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<unknown> {
    assertLockCompatible(this.state, 'mutation');
    assertReturningCapability(this.contract, 'create()');
    const annotations = this.#collectAnnotationsFromMeta(configure, 'write', 'create');
    return runOrmCall(
      this.ctx.runtime,
      this.#writeCall('create', annotations, ormResults.row<Row>),
      (queryable) => this.#create(queryable, data),
    );
  }

  async #create(
    queryable: RuntimeQueryable,
    data:
      | ResolvedCreateInput<TContract, ModelName, State['variantValue'], State['nsId']>
      | MutationCreateInputWithRelations<TContract, ModelName, State['nsId']>,
  ): Promise<Row> {
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
        runtime: queryable,
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
      const reloaded = await this.#reloadMutationRowByIdentity(queryable, identityCriterion);
      if (!reloaded) {
        throw ormError(
          'ORM.MUTATION_ROW_MISSING',
          `create() for model "${this.modelName}" did not return a row`,
          { meta: { operation: 'create', model: this.modelName } },
        );
      }
      return reloaded;
    }

    const rows = await this.#createAllRows([
      blindCast<
        ResolvedScalarCreateInput<TContract, ModelName, State['variantValue'], State['nsId']>,
        'absence of nested callbacks selects the scalar create overload input'
      >(data),
    ])(queryable);
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
   * call. It may be passed in second position when there are no options.
   */
  createAll<Self extends this>(
    this: Self,
    data: readonly ResolvedScalarCreateInput<
      TContract,
      ModelName,
      State['variantValue'],
      State['nsId']
    >[],
    optionsOrConfigure?:
      | CreateConflictOptions<TContract, ModelName, State['nsId']>
      | WriteConfigure,
    configure?: WriteConfigure,
  ): AsyncIterableResult<CollectionRowOf<Self>>;
  createAll(
    data: readonly ResolvedScalarCreateInput<
      TContract,
      ModelName,
      State['variantValue'],
      State['nsId']
    >[],
    optionsOrConfigure?:
      | CreateConflictOptions<TContract, ModelName, State['nsId']>
      | WriteConfigure,
    configure?: WriteConfigure,
  ): AsyncIterableResult<CollectionRowOf<this>>;
  createAll(
    data: readonly ResolvedScalarCreateInput<
      TContract,
      ModelName,
      State['variantValue'],
      State['nsId']
    >[],
    optionsOrConfigure?:
      | CreateConflictOptions<TContract, ModelName, State['nsId']>
      | WriteConfigure,
    configure?: WriteConfigure,
  ): AsyncIterableResult<unknown> {
    assertLockCompatible(this.state, 'mutation');
    const { options, configureCallback } = splitCreateArguments(optionsOrConfigure, configure);
    const conflictSkip = this.#resolveConflictSkip(options, 'createAll()');
    const annotations = this.#collectAnnotationsFromMeta(configureCallback, 'write', 'createAll');
    return streamOrmCall(
      this.ctx.runtime,
      this.#writeCall('createAll', annotations, ormResults.rows<Row>),
      this.#createAllRows(data, conflictSkip),
    );
  }

  #createAllRows(
    data: readonly ResolvedScalarCreateInput<
      TContract,
      ModelName,
      State['variantValue'],
      State['nsId']
    >[],
    conflictSkip?: InsertConflictSkip,
  ): (queryable: RuntimeQueryable) => AsyncIterableResult<Row> {
    if (data.length === 0) {
      const generator = async function* (): AsyncGenerator<Row, void, unknown> {};
      return () => new AsyncIterableResult(generator());
    }

    assertReturningCapability(this.contract, 'createAll()');

    const rows = blindCast<
      readonly Record<string, unknown>[],
      'resolved create inputs are model-field records for storage mapping'
    >(data);
    const mtiContext = this.#resolveMtiCreateContext();
    if (mtiContext) {
      const variantTable = requireVariantTable(this.state.tables, mtiContext.variant.value);
      const graph = createAllVariantGraph(
        this.#descriptionWithoutIncludes(),
        variantTable,
        mtiContext.variant.modelName,
        this.#variantCreateRows(rows, mtiContext, variantTable),
      );
      return (queryable) =>
        queryGraph(graph, this.#on(queryable), this.#descriptionWithoutIncludes());
    }

    const graph = createAllGraph(
      this.#descriptionOptions(),
      this.#createValues(rows),
      conflictSkip,
    );
    return (queryable) => queryGraph(graph, this.#on(queryable), this.#descriptionOptions());
  }

  #createValues(rows: readonly Record<string, unknown>[]): Record<string, unknown>[] {
    const mappedRows = this.#mapCreateRows(rows);
    applyCreateDefaults(this.ctx, this.namespaceId, this.tableName, mappedRows);
    return mappedRows;
  }

  #resolveConflictSkip(
    options: CreateConflictOptions<TContract, ModelName, State['nsId']> | undefined,
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
      `${method} is not supported for MTI variant "${this.#variantModelName()}" on model "${this.modelName}". Use createAll() instead.`,
    );
  }

  #assertConflictSkipNotOnMtiVariant(method: string): void {
    this.#refuseOnMtiVariant(
      method,
      `The onConflict option is not supported on variant "${this.#variantModelName()}" of model "${this.modelName}" because the variant is stored in its own table. Call createAll(rows) without the option; a duplicate row then makes the call fail.`,
    );
  }

  #refuseOnMtiVariant(method: string, message: string): void {
    if (!this.#resolveMtiCreateContext()) return;
    throw ormError('ORM.OPERATION_UNSUPPORTED', message, {
      meta: {
        method,
        model: this.modelName,
        variant: this.#variantModelName(),
        reason: 'mti-variant',
      },
    });
  }

  #variantModelName(): string {
    return addressedModel(
      this.contract,
      this.namespaceId,
      this.modelName,
      this.state.variantValue,
    )[1];
  }

  #resolveMtiCreateContext(): MtiCreateContext | null {
    const variantValue = this.state.variantValue;
    if (!variantValue) return null;

    const polyInfo = resolvePolymorphismInfo(this.contract, this.namespaceId, this.modelName);
    if (!polyInfo) return null;

    const variant = polyInfo.variants.get(variantValue);
    if (!isMtiVariantInfo(variant)) return null;

    const baseFieldToColumn = getModelFieldColumns(this.contract, this.namespaceId, this.modelName);
    const variantFieldToColumn = getOwnFieldColumns(
      this.contract,
      variant.namespaceId,
      variant.modelName,
    );

    return {
      polyInfo,
      variant,
      baseFieldToColumn,
      variantFieldToColumn,
      mergedFieldToColumn: getModelAndVariantFieldColumns(
        this.contract,
        this.namespaceId,
        this.modelName,
        variant.value,
      ),
    };
  }

  #variantCreateRows(
    data: readonly Record<string, unknown>[],
    mtiCtx: MtiCreateContext,
    variantTable: AliasedTable,
  ): VariantCreateRow[] {
    const { polyInfo, variant, baseFieldToColumn, variantFieldToColumn, mergedFieldToColumn } =
      mtiCtx;
    const baseFieldColumns = new Set(Object.values(baseFieldToColumn));
    const variantFieldColumns = new Set(Object.values(variantFieldToColumn));
    const defaultValueCache = new Map<string, unknown>();

    return data.map((row) => {
      const allMapped: Record<string, unknown> = {};
      for (const [fieldName, value] of Object.entries(row)) {
        if (value === undefined) continue;
        allMapped[
          columnOfCallerField(
            this.contract,
            this.namespaceId,
            mergedFieldToColumn,
            variant.modelName,
            fieldName,
          )
        ] = value;
      }
      allMapped[polyInfo.discriminatorColumn] = variant.value;

      const baseRow: Record<string, unknown> = {};
      const variantRow: Record<string, unknown> = {};
      for (const [column, value] of Object.entries(allMapped)) {
        if (baseFieldColumns.has(column) || column === polyInfo.discriminatorColumn) {
          baseRow[column] = value;
        }
        if (variantFieldColumns.has(column)) {
          variantRow[column] = value;
        }
      }

      applyCreateDefaults(this.ctx, this.namespaceId, this.tableName, [baseRow], defaultValueCache);
      applyCreateDefaults(
        this.ctx,
        variantTable.storage.namespaceId,
        variantTable.storage.tableName,
        [variantRow],
        defaultValueCache,
      );
      return { base: baseRow, variant: variantRow };
    });
  }

  #mapCreateRows(data: readonly Record<string, unknown>[]): Record<string, unknown>[] {
    const variantValue = this.state.variantValue;
    if (!variantValue) {
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

    const variant = polyInfo.variants.get(variantValue);
    if (!variant) {
      return data.map((row) =>
        mapModelDataToStorageRow(this.contract, this.namespaceId, this.modelName, row),
      );
    }

    const mergedFieldToColumn = getModelAndVariantFieldColumns(
      this.contract,
      this.namespaceId,
      this.modelName,
      variant.value,
    );

    return data.map((row) => {
      const mapped: Record<string, unknown> = {};
      for (const [fieldName, value] of Object.entries(row)) {
        if (value === undefined) continue;
        mapped[
          columnOfCallerField(
            this.contract,
            variant.namespaceId,
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
      State['variantValue'],
      State['nsId']
    >[],
    optionsOrConfigure?:
      | CreateConflictOptions<TContract, ModelName, State['nsId']>
      | WriteConfigure,
    configure?: WriteConfigure,
  ): Promise<number> {
    assertLockCompatible(this.state, 'mutation');
    const { options, configureCallback } = splitCreateArguments(optionsOrConfigure, configure);
    const conflictSkip = this.#resolveConflictSkip(options, 'createAndCount()');
    const annotations = this.#collectAnnotationsFromMeta(
      configureCallback,
      'write',
      'createAndCount',
    );
    const call = this.#writeCall('createAndCount', annotations, ormResults.count);

    if (data.length === 0) {
      return runOrmCall(this.ctx.runtime, call, async () => 0);
    }

    this.#assertNotMtiVariant('createAndCount()');

    const rows = blindCast<
      readonly Record<string, unknown>[],
      'resolved create-and-count inputs are model-field records for storage mapping'
    >(data);
    const graph = createAllGraph(
      this.#descriptionWithoutIncludes(),
      this.#createValues(rows),
      conflictSkip,
    );
    return this.#countCall(call, graph);
  }

  #countCall(call: OrmCall<number>, graph: Graph): Promise<number> {
    return runOrmCall(this.ctx.runtime, call, async (queryable) => {
      const stats = await executeGraph(graph, this.#on(queryable));
      return stats.affectedRows;
    });
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
   * // Conditional create: with `update: {}` the row is returned whether it
   * // was inserted or already existed. When it already exists, the conflict
   * // clause assigns the first conflict column its own value, which is an
   * // update: update triggers fire, the row is locked until the transaction
   * // ends, the caller needs UPDATE privilege on the table, and the call
   * // fails if that column is generated. `conflictOn` must reference the
   * // constraint that makes the row "already exist"; omit it only when the
   * // conflict is on the primary key.
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
      create: ResolvedScalarCreateInput<TContract, ModelName, State['variantValue'], State['nsId']>;
      update: ScalarUpdateInput<TContract, ModelName, State['nsId']>;
      conflictOn?: UniqueConstraintCriterion<TContract, ModelName, State['nsId']>;
    },
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<CollectionRowOf<Self>>;
  async upsert(
    input: {
      create: ResolvedScalarCreateInput<TContract, ModelName, State['variantValue'], State['nsId']>;
      update: ScalarUpdateInput<TContract, ModelName, State['nsId']>;
      conflictOn?: UniqueConstraintCriterion<TContract, ModelName, State['nsId']>;
    },
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<CollectionRowOf<this>>;
  async upsert(
    input: {
      create: ResolvedScalarCreateInput<TContract, ModelName, State['variantValue'], State['nsId']>;
      update: ScalarUpdateInput<TContract, ModelName, State['nsId']>;
      conflictOn?: UniqueConstraintCriterion<TContract, ModelName, State['nsId']>;
    },
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<unknown> {
    assertLockCompatible(this.state, 'mutation');
    assertReturningCapability(this.contract, 'upsert()');
    this.#assertNotMtiVariant('upsert()');
    const annotations = this.#collectAnnotationsFromMeta(configure, 'write', 'upsert');

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

    const graph = upsertGraph(
      this.#descriptionOptions(),
      createValues,
      updateValues,
      conflictColumns,
    );
    return runOrmCall(
      this.ctx.runtime,
      this.#writeCall('upsert', annotations, ormResults.row<Row>),
      async (queryable) => {
        const row = await consumeFirstRow(
          queryGraph<Row>(graph, this.#on(queryable), this.#descriptionOptions()),
        );
        if (row) {
          return row;
        }
        throw ormError(
          'ORM.MUTATION_ROW_MISSING',
          `upsert() for model "${this.modelName}" did not return a row`,
          { meta: { operation: 'upsert', model: this.modelName } },
        );
      },
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
   * `MetaBuilder<'write'>` for attaching typed annotations to the call, including when the input contains relation callbacks.
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
    const annotations = this.#collectAnnotationsFromMeta(configure, 'write', 'update');
    return runOrmCall(
      this.ctx.runtime,
      this.#writeCall('update', annotations, ormResults.rowOrNull<Row>),
      (queryable) => this.#update(queryable, data),
    );
  }

  async #update(
    queryable: RuntimeQueryable,
    data: MutationUpdateInput<TContract, ModelName, State['nsId']>,
  ): Promise<Row | null> {
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
        runtime: queryable,
        namespaceId: this.namespaceId,
        modelName: this.modelName,
        tables: this.state.tables,
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
      return this.#reloadMutationRowByIdentity(queryable, identityCriterion);
    }

    assertModelFieldNames(
      this.contract,
      this.namespaceId,
      this.modelName,
      blindCast<Record<string, unknown>, 'scalar update input is a model-field record'>(data),
    );
    const values = this.#updateValues(
      blindCast<
        ScalarUpdateInput<TContract, ModelName, State['nsId']>,
        'absence of nested callbacks selects the scalar update input'
      >(data),
    );
    const graph = updateFirstGraph(this.#descriptionOptions(), values);
    return consumeFirstRow(queryGraph<Row>(graph, this.#on(queryable), this.#descriptionOptions()));
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
    this: Self & HasNoUniqueFilter,
    data: ScalarUpdateInput<TContract, ModelName, State['nsId']>,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): AsyncIterableResult<CollectionRowOf<Self & HasRow<CollectionRowOf<this>>>>;
  updateAll(
    data: ScalarUpdateInput<TContract, ModelName, State['nsId']>,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): AsyncIterableResult<unknown> {
    assertBulkWriteIgnoresNothing(this.state, this.modelName, 'updateAll');
    assertLockCompatible(this.state, 'mutation');
    const annotations = this.#collectAnnotationsFromMeta(configure, 'write', 'updateAll');
    assertReturningCapability(this.contract, 'updateAll()');
    const graph = updateAllGraph(this.#descriptionOptions(), this.#updateValues(data));
    return this.#rowsCall('updateAll', annotations, graph);
  }

  #rowsCall(method: string, annotations: Annotations | undefined, graph: Graph) {
    return streamOrmCall(
      this.ctx.runtime,
      this.#writeCall(method, annotations, ormResults.rows<Row>),
      (queryable) => queryGraph<Row>(graph, this.#on(queryable), this.#descriptionOptions()),
    );
  }

  #firstRowCall(method: string, annotations: Annotations | undefined, graph: Graph) {
    return runOrmCall(
      this.ctx.runtime,
      this.#writeCall(method, annotations, ormResults.rowOrNull<Row>),
      (queryable) =>
        consumeFirstRow(queryGraph<Row>(graph, this.#on(queryable), this.#descriptionOptions())),
    );
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
    this: Self & HasNoUniqueFilter,
    data: ScalarUpdateInput<TContract, ModelName, State['nsId']>,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<number>;
  async updateAndCount(
    data: ScalarUpdateInput<TContract, ModelName, State['nsId']>,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<number> {
    assertBulkWriteIgnoresNothing(this.state, this.modelName, 'updateAndCount');
    assertLockCompatible(this.state, 'mutation');
    const values = this.#updateValues(data);
    const graph =
      Object.keys(values).length === 0
        ? new Graph()
        : updateAllGraph(this.#descriptionWithoutIncludes(), values);
    const annotations = this.#collectAnnotationsFromMeta(configure, 'write', 'updateAndCount');
    return this.#countCall(this.#writeCall('updateAndCount', annotations, ormResults.count), graph);
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
    const annotations = this.#collectAnnotationsFromMeta(configure, 'write', 'delete');
    const graph = deleteFirstGraph(this.#descriptionOptions());
    return this.#firstRowCall('delete', annotations, graph);
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
    this: Self & HasNoUniqueFilter,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): AsyncIterableResult<CollectionRowOf<Self & HasRow<CollectionRowOf<this>>>>;
  deleteAll(configure?: (meta: MetaBuilder<'write'>) => void): AsyncIterableResult<unknown> {
    assertBulkWriteIgnoresNothing(this.state, this.modelName, 'deleteAll');
    assertLockCompatible(this.state, 'mutation');
    const annotations = this.#collectAnnotationsFromMeta(configure, 'write', 'deleteAll');
    assertReturningCapability(this.contract, 'deleteAll()');
    const graph = deleteAllGraph(this.#descriptionOptions());
    return this.#rowsCall('deleteAll', annotations, graph);
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
    this: Self & HasNoUniqueFilter,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<number>;
  async deleteAndCount(configure?: (meta: MetaBuilder<'write'>) => void): Promise<number> {
    assertBulkWriteIgnoresNothing(this.state, this.modelName, 'deleteAndCount');
    assertLockCompatible(this.state, 'mutation');
    const annotations = this.#collectAnnotationsFromMeta(configure, 'write', 'deleteAndCount');
    const graph = deleteAllGraph(this.#descriptionWithoutIncludes());
    return this.#countCall(this.#writeCall('deleteAndCount', annotations, ormResults.count), graph);
  }

  #descriptionWithoutIncludes() {
    return { ...this.#descriptionOptions(), state: { ...this.state, includes: [] } };
  }

  #updateValues(
    data: ScalarUpdateInput<TContract, ModelName, State['nsId']>,
  ): Record<string, unknown> {
    const values = mapModelDataToStorageRow(this.contract, this.namespaceId, this.modelName, data);
    if (Object.keys(values).length > 0) {
      applyUpdateDefaults(this.ctx, this.namespaceId, this.tableName, values);
    }
    return values;
  }

  async #reloadMutationRowByIdentity(
    queryable: RuntimeQueryable,
    criterion: Record<string, unknown>,
  ): Promise<Row | null> {
    return this.#reloadMutationRowByCriterion(queryable, criterion, 'row identity');
  }

  async #reloadMutationRowByCriterion(
    queryable: RuntimeQueryable,
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
      this.state.tables.root,
    );
    if (!whereExpr) {
      throw new InternalError(
        `Failed to build ${criterionLabel} filter for mutation result on model "${this.modelName}"`,
      );
    }

    const resultState: CollectionState = {
      ...emptyState(this.state.tables),
      filters: [whereExpr],
      includes: this.state.includes,
      selectedFields: this.state.selectedFields,
      limit: 1,
    };

    const rows = await dispatchCollectionRows<Row>({
      context: this.ctx.context,
      runtime: queryable,
      state: resultState,
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
      of: [this.state.tables.root.alias],
      ...ifDefined('waitPolicy', waitPolicy),
    });
    return this.#cloneSelf({ locking: [...(this.state.locking ?? []), clause] });
  }

  #cloneSelf<Flags = unknown>(overrides: Partial<CollectionState>): this & Flags {
    return blindCast<
      this & Flags,
      'the clone is built by this constructor, so it is an instance of the same class'
    >(this.#createSelf<Row, State>({ ...this.state, ...overrides }));
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

  #collectAnnotationsFromMeta<K extends OperationKind>(
    configure: ((meta: MetaBuilder<K>) => void) | undefined,
    kind: K,
    terminalName: string,
  ): Annotations | undefined {
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
