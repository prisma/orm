import type { Contract } from '@internal/contract/types';
import type {
  AnnotationValue,
  MetaBuilder,
  OperationKind,
} from '@internal/framework-components/runtime';
import { AsyncIterableResult, createMetaBuilder } from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  isWhereExpr,
  LiteralExpr,
  type OrderByItem,
  type ToWhereExpr,
  type WhereArg,
} from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import type { SimplifyDeep } from '@internal/utils/simplify-deep';
import type { Simplify } from '@internal/utils/types';
import { createAggregateBuilder, isAggregateSelector } from './aggregate-builder';
import { resolveAggregate } from './aggregate-codecs';
import { emptyAggregateResult } from './aggregate-empty-result';
import { aggregateOperationNames } from './aggregate-operations';
import { mapCursorValuesToColumns, mapFieldsToColumns } from './collection-column-mapping';
import {
  assertDistinctOnCapability,
  assertReturningCapability,
  getColumnToFieldMap,
  getFieldToColumnMap,
  isToOneCardinality,
  modelOf,
  type PolymorphismInfo,
  type PolymorphismVariantInfo,
  resolveFieldToColumn,
  resolveIncludeRelation,
  resolveModelTableName,
  resolvePolymorphismInfo,
  resolvePrimaryKeyColumn,
  resolveRowIdentityColumns,
  resolveUpsertConflictColumns,
} from './collection-contract';
import { dispatchCollectionRows } from './collection-dispatch';
import type {
  CollectionConstructor,
  CollectionInit,
  IncludedRelationsForRow,
  IncludeRefinementCollection,
  IncludeRefinementResult,
  IncludeRefinementValue,
  IsToManyRelation,
  RowSelection,
  // biome-ignore lint/correctness/noUnusedImports: used in `declare` property
  RowType,
  WithOrderByState,
  WithVariantState,
  WithWhereState,
} from './collection-internal-types';
import {
  dispatchMutationRows,
  dispatchSplitMutationRows,
  executeMutationReturningSingleRow,
} from './collection-mutation-dispatch';
import { mapModelDataToStorageRow, mapPolymorphicRow } from './collection-runtime';
import { shorthandToWhereExpr } from './filters';
import { GroupedCollection } from './grouped-collection';
import {
  createIncludeCombine,
  createIncludeScalar,
  isCollectionStateCarrier,
  isIncludeCombine,
  isIncludeScalar,
} from './include-descriptors';
import { createModelAccessor } from './model-accessor';
import {
  buildPrimaryKeyFilterFromRow,
  executeNestedCreateMutation,
  executeNestedUpdateMutation,
  hasNestedMutationCallbacks,
  withMutationScope,
} from './mutation-executor';
import { ormError } from './orm-errors';
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
  compileUpsertReturningMany,
  compileUpsertReturningManySplit,
  mergeAnnotations,
  type UpsertConflictResolution,
} from './query-plan';
import { queryPlanRows } from './query-plan-rows';
import {
  type AggregateBuilder,
  type AggregateIncludeReducers,
  type AggregateResult,
  type AggregateSelector,
  type AggregateSpec,
  type CollectionContext,
  type CollectionState,
  type CollectionTypeState,
  type DefaultCollectionTypeState,
  type DefaultModelRow,
  emptyGroupPagingState,
  emptyState,
  type IncludeCombine,
  type IncludeCombineBranch,
  type IncludeExpr,
  type IncludeRelationOwner,
  type IncludeScalar,
  type InferRootRow,
  type MutationCreateInput,
  type MutationCreateInputWithRelations,
  type MutationUpdateInput,
  type RelatedModelName,
  type RelationTargetNamespace,
  type ResolvedCreateInput,
  type RuntimeQueryable,
  type ShorthandWhereFilter,
  type UniqueConstraintCriterion,
  type UpsertAllOptions,
  type VariantAwareIncludeRelationNames,
  type VariantAwareModelAccessor,
  type VariantModelRow,
  type VariantNames,
} from './types';
import { normalizeWhereArg } from './where-interop';

function applyCreateDefaults(
  ctx: CollectionContext<Contract<SqlStorage>>,
  namespaceId: string,
  tableName: string,
  rows: Record<string, unknown>[],
): void {
  // Per-operation cache for generators with `stability: 'query'` (e.g.
  // `timestampNow` for `temporal.updatedAt()`): one generated value
  // shared across every row in this insert. Per-field generators
  // (e.g. `cuid`) ignore the cache and vary per row.
  const defaultValueCache = rows.length > 1 ? new Map<string, unknown>() : undefined;
  for (const row of rows) {
    const applied = ctx.context.applyMutationDefaults({
      op: 'create',
      table: tableName,
      namespace: namespaceId,
      values: row,
      ...(defaultValueCache ? { defaultValueCache } : {}),
    });
    for (const def of applied) {
      row[def.column] = def.value;
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
    table: tableName,
    namespace: namespaceId,
    values,
  });
  for (const def of applied) {
    values[def.column] = def.value;
  }
}

/**
 * The onUpdate defaults a batched upsert must bind as literals: those for
 * columns the conflict update does not already assign. Columns already in
 * `assignedColumns` are left alone — they are written from the proposed row,
 * which carries its own create-branch default for the same column.
 *
 * An empty `assignedColumns` means nothing is being updated, and an empty
 * update payload skips onUpdate defaults by design (ADR 158) — so the probe
 * stays empty and no default is generated.
 */
function collectUpdateDefaults(
  ctx: CollectionContext<Contract<SqlStorage>>,
  namespaceId: string,
  tableName: string,
  assignedColumns: readonly string[],
): Record<string, unknown> {
  const probe: Record<string, unknown> = Object.fromEntries(
    assignedColumns.map((column) => [column, null]),
  );
  const applied = ctx.context.applyMutationDefaults({
    op: 'update',
    table: tableName,
    namespace: namespaceId,
    values: probe,
  });
  return Object.fromEntries(applied.map((def) => [def.column, def.value]));
}

type WhereDirectInput = WhereArg;

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

type MtiVariantInfo = Simplify<PolymorphismVariantInfo & { readonly strategy: 'mti' }>;

function isMtiVariantInfo(variant: PolymorphismVariantInfo | undefined): variant is MtiVariantInfo {
  return variant?.strategy === 'mti';
}

interface MtiCreateContext {
  polyInfo: PolymorphismInfo;
  variant: MtiVariantInfo;
  baseFieldToColumn: Record<string, string>;
  variantFieldToColumn: Record<string, string>;
  pkColumn: string;
}

class CollectionImpl<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Row = SimplifyDeep<InferRootRow<TContract, ModelName>>,
  State extends CollectionTypeState = DefaultCollectionTypeState,
> implements RowSelection<Row>
{
  declare readonly [RowType]: Row;
  /** @internal */
  readonly ctx: CollectionContext<TContract>;
  /** @internal */
  private readonly contract: TContract;
  /** @internal */
  readonly modelName: ModelName;
  /** @internal */
  readonly tableName: string;
  /** @internal */
  readonly namespaceId: string;
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
   * it decides what the skip means. A `CollectionImpl` member is rejected at
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
        : resolveFieldToColumn(this.contract, this.namespaceId, this.modelName, field);
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
  where(
    fn: (
      model: VariantAwareModelAccessor<TContract, ModelName, State['variantName'], State['nsId']>,
    ) => WhereDirectInput,
  ): Collection<TContract, ModelName, Row, WithWhereState<State>>;
  where(input: WhereDirectInput): Collection<TContract, ModelName, Row, WithWhereState<State>>;
  where(
    fn: (
      model: VariantAwareModelAccessor<TContract, ModelName, State['variantName'], State['nsId']>,
    ) => WhereArg,
  ): Collection<TContract, ModelName, Row, WithWhereState<State>>;
  where(
    filters: ShorthandWhereFilter<TContract, ModelName, State['nsId']>,
  ): Collection<TContract, ModelName, Row, WithWhereState<State>>;
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
      | ((
          model: VariantAwareModelAccessor<
            TContract,
            ModelName,
            State['variantName'],
            State['nsId']
          >,
        ) => WhereArg)
      | ShorthandWhereFilter<TContract, ModelName, State['nsId']>,
  ): Collection<TContract, ModelName, Row, WithWhereState<State>> {
    const whereArg =
      typeof input === 'function'
        ? input(
            createModelAccessor<TContract, ModelName, State['variantName']>(
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
        Collection<TContract, ModelName, Row, WithWhereState<State>>,
        'where() records its static state even when normalization produces no filter'
      >(this);
    }

    return this.#clone<WithWhereState<State>>({
      filters: [...this.state.filters, filter],
    });
  }

  /**
   * Narrow a polymorphic model to a specific variant. The returned
   * collection has the variant's row shape and a discriminator filter
   * is automatically applied. Chaining `.variant(...)` again replaces
   * the previous variant filter.
   *
   * ```typescript
   * // Read only admin users (STI):
   * const admins = await db.orm.User.variant('Admin').all();
   *
   * // Iterate the rows:
   * for await (const admin of db.orm.User.variant('Admin').all()) {
   *   console.log(admin.role);
   * }
   *
   * // Insert under a variant — discriminator is injected automatically:
   * await db.orm.User.variant('Admin').create({ name: 'Ada', role: 'super' });
   * ```
   */
  variant<V extends VariantNames<TContract, ModelName>>(
    variantName: V,
  ): Collection<
    TContract,
    ModelName,
    VariantModelRow<TContract, ModelName, V>,
    WithVariantState<WithWhereState<State>, V>
  > {
    type ReturnState = WithVariantState<WithWhereState<State>, V>;
    const model = modelOf(this.contract, this.namespaceId, this.modelName);
    const discriminator = model?.discriminator;
    const variants = model?.variants;

    if (!discriminator || !variants) {
      return blindCast<
        Collection<TContract, ModelName, VariantModelRow<TContract, ModelName, V>, ReturnState>,
        'variant() preserves its declared static narrowing when runtime polymorphism metadata is absent'
      >(this);
    }

    const variantEntry = variants[variantName];
    if (!variantEntry) {
      return blindCast<
        Collection<TContract, ModelName, VariantModelRow<TContract, ModelName, V>, ReturnState>,
        'variant() preserves its declared static narrowing when runtime metadata lacks the selected variant'
      >(this);
    }

    const columnName = resolveFieldToColumn(
      this.contract,
      this.namespaceId,
      this.modelName,
      discriminator.field,
    );
    const filter = BinaryExpr.eq(
      ColumnRef.of(this.tableName, columnName),
      LiteralExpr.of(variantEntry.value),
    );

    const filtersWithoutPreviousVariant = this.state.variantName
      ? this.state.filters.filter(
          (f) =>
            !(
              f instanceof BinaryExpr &&
              f.left instanceof ColumnRef &&
              f.left.column === columnName &&
              f.left.table === this.tableName
            ),
        )
      : this.state.filters;

    return this.#cloneWithRow<VariantModelRow<TContract, ModelName, V>, ReturnState>({
      filters: [...filtersWithoutPreviousVariant, filter],
      variantName,
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
   *   posts.where({ published: true }).orderBy((p) => p.createdAt.desc()).take(5),
   * ).all();
   *
   * // Reduce a to-many relation to a scalar value:
   * const withCounts = await db.orm.User.include('posts', (posts) => posts.count()).all();
   *
   * // Multiple sub-views via combine():
   * const overview = await db.orm.User.include('posts', (posts) =>
   *   posts.combine({ recent: posts.take(3), total: posts.count() }),
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
    State
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
      targetColumn: relation.targetColumn,
      localColumn: relation.localColumn,
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
      State
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
    const selectedFields = mapFieldsToColumns(
      this.contract,
      this.namespaceId,
      this.modelName,
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
  orderBy(
    selection:
      | ((
          model: VariantAwareModelAccessor<TContract, ModelName, State['variantName']>,
        ) => OrderByItem)
      | ReadonlyArray<
          (
            model: VariantAwareModelAccessor<TContract, ModelName, State['variantName']>,
          ) => OrderByItem
        >,
  ): Collection<TContract, ModelName, Row, WithOrderByState<State>> {
    const accessor = createModelAccessor<TContract, ModelName, State['variantName']>(
      this.ctx.context,
      this.namespaceId,
      this.modelName,
      this.state.variantName,
    );
    const selectors = Array.isArray(selection) ? selection : [selection];
    const nextOrders = selectors.map((selector) => selector(accessor));
    const existing = this.state.orderBy ?? [];
    return this.#clone<WithOrderByState<State>>({
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
   *     recent: posts.where({ published: true }).take(3),
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
      CollectionImpl<TContract, ModelName, unknown, CollectionTypeState> | IncludeScalar<unknown>
    >,
  >(
    spec: Spec,
  ): IncludeCombine<{
    [K in keyof Spec]: Spec[K] extends IncludeScalar<infer ScalarResult>
      ? ScalarResult
      : Spec[K] extends CollectionImpl<TContract, ModelName, infer BranchRow, CollectionTypeState>
        ? BranchRow[]
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
        : Spec[K] extends CollectionImpl<TContract, ModelName, infer BranchRow, CollectionTypeState>
          ? BranchRow[]
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
   *   .take(20)
   *   .all();
   *
   * const last = page1[page1.length - 1]!;
   * const page2 = await db.orm.Post
   *   .orderBy((p) => p.createdAt.desc())
   *   .cursor({ createdAt: last.createdAt })
   *   .take(20)
   *   .all();
   * ```
   */
  cursor(
    cursorValues: State['hasOrderBy'] extends true
      ? Partial<Record<keyof DefaultModelRow<TContract, ModelName> & string, unknown>>
      : never,
  ): Collection<TContract, ModelName, Row, State> {
    const mappedCursor = mapCursorValuesToColumns(
      this.contract,
      this.namespaceId,
      this.modelName,
      cursorValues,
    );

    if (Object.keys(mappedCursor).length === 0) {
      return blindCast<
        Collection<TContract, ModelName, Row, State>,
        'the constructor installed the reducer members the surface type declares'
      >(this);
    }

    return this.#clone({
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
  >(...fields: Fields): Collection<TContract, ModelName, Row, State> {
    const distinctFields = mapFieldsToColumns(
      this.contract,
      this.namespaceId,
      this.modelName,
      fields,
    );

    return this.#clone({
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
  >(
    ...fields: TContract['capabilities'] extends { postgres: { distinctOn: true } }
      ? State['hasOrderBy'] extends true
        ? Fields
        : never
      : never
  ): Collection<TContract, ModelName, Row, State> {
    assertDistinctOnCapability(this.contract, 'distinctOn');
    const distinctOnFields = mapFieldsToColumns(
      this.contract,
      this.namespaceId,
      this.modelName,
      fields,
    );

    return this.#clone({
      distinct: undefined,
      distinctOn: distinctOnFields,
    });
  }

  /**
   * Apply `LIMIT n`. Replaces any previous limit set on this collection.
   *
   * ```typescript
   * const firstTen = await db.orm.User.orderBy((u) => u.id.asc()).take(10).all();
   * ```
   */
  take(n: number): Collection<TContract, ModelName, Row, State> {
    return this.#clone({ limit: n });
  }

  /**
   * Apply `OFFSET n`. Replaces any previous offset set on this collection.
   *
   * ```typescript
   * const page2 = await db.orm.User
   *   .orderBy((u) => u.id.asc())
   *   .skip(10)
   *   .take(10)
   *   .all();
   * ```
   */
  skip(n: number): Collection<TContract, ModelName, Row, State> {
    return this.#clone({ offset: n });
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
   * Streaming is the default and the expected execution model. The
   * only scenarios that fall back to buffering internally before
   * yielding are drivers that cannot expose a cursor to the
   * underlying database, and — for queries with `include(...)` —
   * targets whose SQL dialect supports neither lateral joins nor
   * correlated subqueries (so child rows cannot be stitched in a
   * single streaming query). These are implementation details below
   * the public API; the iteration shape itself is genuinely
   * streaming whenever the driver and plan allow it.
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
   * await db.orm.User.all((meta) => meta.annotate(cacheAnnotation({ ttl: 60 })));
   * ```
   */
  all(configure?: (meta: MetaBuilder<'read'>) => void): AsyncIterableResult<Row> {
    return this.#withAnnotationsFromMeta(configure, 'all').#dispatch();
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
   *   meta.annotate(cacheAnnotation({ ttl: 60 })),
   * );
   * ```
   */
  async first(): Promise<Row | null>;
  async first(
    filter: undefined,
    configure: (meta: MetaBuilder<'read'>) => void,
  ): Promise<Row | null>;
  async first(
    filter: (
      model: VariantAwareModelAccessor<TContract, ModelName, State['variantName'], State['nsId']>,
    ) => WhereArg,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Promise<Row | null>;
  async first(
    filter: ShorthandWhereFilter<TContract, ModelName, State['nsId']>,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Promise<Row | null>;
  async first(
    filter?:
      | ((
          model: VariantAwareModelAccessor<
            TContract,
            ModelName,
            State['variantName'],
            State['nsId']
          >,
        ) => WhereArg)
      | ShorthandWhereFilter<TContract, ModelName, State['nsId']>,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Promise<Row | null> {
    const scoped =
      filter === undefined
        ? this
        : typeof filter === 'function'
          ? this.where(filter)
          : this.where(filter);
    const limited = scoped.take(1).#withAnnotationsFromMeta(configure, 'first');
    const rows = await limited.#dispatch().toArray();
    return rows[0] ?? null;
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
    const rows = await queryPlanRows<Record<string, unknown>>(this.ctx.runtime, compiled).toArray();
    // Values arrive decoded: the projection carries each aggregate's resolved
    // output codec, so the runtime's decode pass has already turned the wire
    // value into the application one. An absent alias means an empty input
    // set, whose answer reads off the operation's declared row.
    const row = rows[0] ?? {};
    const result: Record<string, unknown> = {};
    for (const [alias, selector] of entries) {
      result[alias] = row[alias] ?? this.#emptyAggregateValue(selector);
    }
    return blindCast<
      AggregateResult<Spec>,
      "aliases are the aggregateSpec's own keys; values decoded by the projection codecs the same spec resolved"
    >(result);
  }

  /**
   * Write terminal: insert one row and return it (with any configured
   * `select(...)` / `include(...)` projections applied to the returned
   * shape).
   *
   * Related rows can be created or linked through relation callbacks
   * on parent/child-owned relations (one-to-one or one-to-many).
   * The callback receives a mutator exposing `create(...)` and
   * `connect(...)`; `disconnect(...)` is only supported in nested
   * `update(...)` mutations. Many-to-many relations are not yet
   * supported as nested-mutation targets.
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
   * `withMutationScope`. In that path, annotations apply to the
   * logical `create()` call but do not currently flow into each
   * constituent SQL statement issued for the related rows.
   */
  async create(
    data: ResolvedCreateInput<TContract, ModelName, State['variantName'], State['nsId']>,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<Row>;
  async create(
    data: MutationCreateInputWithRelations<TContract, ModelName, State['nsId']>,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<Row>;
  async create(
    data:
      | ResolvedCreateInput<TContract, ModelName, State['variantName'], State['nsId']>
      | MutationCreateInputWithRelations<TContract, ModelName, State['nsId']>,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<Row> {
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

      const pkCriterion = buildPrimaryKeyFilterFromRow(
        this.contract,
        this.namespaceId,
        this.modelName,
        createdRow,
      );
      const reloaded = await this.#reloadMutationRowByPrimaryKey(pkCriterion);
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
          ResolvedCreateInput<TContract, ModelName, State['variantName'], State['nsId']>,
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
   * ```
   *
   * Accepts an optional `configure` callback that receives a
   * `MetaBuilder<'write'>` for attaching typed annotations to the
   * compiled insert plan.
   */
  createAll(
    data: readonly ResolvedCreateInput<TContract, ModelName, State['variantName'], State['nsId']>[],
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): AsyncIterableResult<Row> {
    return this.#createAllWithAnnotations(
      data,
      this.#collectAnnotationsFromMeta(configure, 'write', 'createAll'),
    );
  }

  #createAllWithAnnotations(
    data: readonly ResolvedCreateInput<TContract, ModelName, State['variantName'], State['nsId']>[],
    annotationsMap: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> | undefined,
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
        this.tableName,
        mappedRows,
        selectedForInsert,
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
        this.tableName,
        mappedRows,
        selectedForInsert,
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

  #assertNotMtiVariant(method: string): void {
    const mtiCtx = this.#resolveMtiCreateContext();
    if (mtiCtx) {
      throw ormError(
        'ORM.OPERATION_UNSUPPORTED',
        `${method} is not supported for MTI variant "${this.state.variantName}" on model "${this.modelName}". Use createAll() instead.`,
        {
          meta: {
            method,
            model: this.modelName,
            variant: this.state.variantName,
            reason: 'mti-variant',
          },
        },
      );
    }
  }

  #resolveMtiCreateContext(): MtiCreateContext | null {
    const variantName = this.state.variantName;
    if (!variantName) return null;

    const polyInfo = resolvePolymorphismInfo(this.contract, this.namespaceId, this.modelName);
    if (!polyInfo) return null;

    const variant = polyInfo.variants.get(variantName);
    if (!isMtiVariantInfo(variant)) return null;

    const baseFieldToColumn = getFieldToColumnMap(this.contract, this.namespaceId, this.modelName);
    const variantFieldToColumn = getFieldToColumnMap(
      this.contract,
      this.namespaceId,
      variant.modelName,
    );
    const pkColumn = resolvePrimaryKeyColumn(this.contract, this.namespaceId, this.tableName);

    return {
      polyInfo,
      variant,
      baseFieldToColumn,
      variantFieldToColumn,
      pkColumn,
    };
  }

  #executeMtiCreate(
    data: readonly Record<string, unknown>[],
    mtiCtx: MtiCreateContext,
  ): AsyncIterableResult<Row> {
    const { polyInfo, variant, baseFieldToColumn, variantFieldToColumn, pkColumn } = mtiCtx;
    const contract = this.contract;
    const collectionCtx = this.ctx;
    const runtime = collectionCtx.runtime;
    const tableName = this.tableName;
    const modelName = this.modelName;
    const namespaceId = this.namespaceId;

    const baseFieldColumns = new Set(Object.values(baseFieldToColumn));
    const variantFieldColumns = new Set(Object.values(variantFieldToColumn));
    const mergedFieldToColumn = { ...baseFieldToColumn, ...variantFieldToColumn };

    const generator = async function* (): AsyncGenerator<Row, void, unknown> {
      for (const row of data) {
        const allMapped: Record<string, unknown> = {};
        for (const [fieldName, value] of Object.entries(row)) {
          if (value === undefined) continue;
          const columnName = mergedFieldToColumn[fieldName] ?? fieldName;
          allMapped[columnName] = value;
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
          applyCreateDefaults(collectionCtx, namespaceId, tableName, [baseRow]);
          const baseCompiled = compileInsertReturning(
            contract,
            namespaceId,
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

          const pkValue = baseCreated[pkColumn];
          variantRow[pkColumn] = pkValue;
          applyCreateDefaults(collectionCtx, namespaceId, variant.table, [variantRow]);
          const variantCompiled = compileInsertReturning(
            contract,
            namespaceId,
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
            if (col === pkColumn) continue;
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

    const baseFieldToColumn = getFieldToColumnMap(this.contract, this.namespaceId, this.modelName);
    const variantFieldToColumn = getFieldToColumnMap(
      this.contract,
      this.namespaceId,
      variant.modelName,
    );
    const mergedFieldToColumn = { ...baseFieldToColumn, ...variantFieldToColumn };

    return data.map((row) => {
      const mapped: Record<string, unknown> = {};
      for (const [fieldName, value] of Object.entries(row)) {
        if (value === undefined) continue;
        const columnName = mergedFieldToColumn[fieldName] ?? fieldName;
        mapped[columnName] = value;
      }
      mapped[polyInfo.discriminatorColumn] = variant.value;
      return mapped;
    });
  }

  /**
   * Write terminal: insert many rows without materializing the
   * inserted rows, returning the number of inserted records.
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
   * ```
   *
   * Not supported on MTI variants — use `createAll(...)` instead.
   */
  async createAndCount(
    data: readonly ResolvedCreateInput<TContract, ModelName, State['variantName']>[],
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<number> {
    if (data.length === 0) {
      return 0;
    }

    this.#assertNotMtiVariant('createAndCount()');
    const annotationsMap = this.#collectAnnotationsFromMeta(configure, 'write', 'createAndCount');

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
      ).map((plan) => mergeAnnotations(plan, annotationsMap));
      for (const plan of plans) {
        await this.ctx.runtime.execute(plan);
      }
      return data.length;
    }

    const compiled = mergeAnnotations(
      compileInsertCount(this.contract, this.namespaceId, this.tableName, mappedRows),
      annotationsMap,
    );
    await this.ctx.runtime.execute(compiled);
    return data.length;
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
  async upsert(
    input: {
      create: ResolvedCreateInput<TContract, ModelName, State['variantName']>;
      update: Partial<DefaultModelRow<TContract, ModelName>>;
      conflictOn?: UniqueConstraintCriterion<TContract, ModelName>;
    },
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<Row> {
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
   * Write terminal: insert many rows, updating the ones that conflict, and
   * stream the resulting rows. One statement for the whole batch, so the
   * cost is one round-trip rather than one per row.
   *
   * Each conflicting row is updated with its own proposed values — the
   * update is not a single literal payload shared by the batch. `update`
   * selects which fields that overwrite covers; it defaults to every field
   * the caller supplied except the conflict target and the primary key.
   * Fields that only an `onCreate` default fills (a generated id, a
   * `createdAt`) stay out of it, so a conflicting row keeps its own.
   *
   * ```typescript
   * // Insert-or-refresh a batch keyed on the primary key:
   * const rows = await db.orm.User.upsertAll([
   *   { id: 1, name: 'Alice', email: 'alice@example.com' },
   *   { id: 2, name: 'Bob', email: 'bob@example.com' },
   * ]);
   *
   * // Key on a unique constraint, and overwrite only `name`:
   * await db.orm.User.upsertAll(users, {
   *   conflictOn: ['email'],
   *   update: ['name'],
   * });
   *
   * // Insert-if-absent — `update: []` leaves conflicting rows untouched.
   * // Those rows are skipped by the statement, so they are absent from
   * // the result; reloading them would cost a second statement.
   * await db.orm.User.upsertAll(users, { update: [] });
   * ```
   *
   * Accepts an optional `configure` callback that receives a
   * `MetaBuilder<'write'>` for attaching typed annotations.
   *
   * Not supported on MTI variants.
   */
  upsertAll(
    data: readonly ResolvedCreateInput<TContract, ModelName, State['variantName'], State['nsId']>[],
    options?: UpsertAllOptions<TContract, ModelName>,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): AsyncIterableResult<Row> {
    if (data.length === 0) {
      const generator = async function* (): AsyncGenerator<Row, void, unknown> {};
      return new AsyncIterableResult(generator());
    }

    assertReturningCapability(this.contract, 'upsertAll()');
    this.#assertNotMtiVariant('upsertAll()');
    const annotationsMap = this.#collectAnnotationsFromMeta(configure, 'write', 'upsertAll');

    const mappedRows = this.#mapCreateRows(
      blindCast<
        readonly Record<string, unknown>[],
        'resolved upsert inputs are model-field records for storage mapping'
      >(data),
    );
    // Read before `applyCreateDefaults` mutates the rows: only what the caller
    // actually supplied may drive the implicit update set. An onCreate default
    // (`created_at`, a generated id) belongs to the insert branch alone — taking
    // it from `excluded` would stamp an existing row with the new row's value.
    const providedColumns = [...new Set(mappedRows.flatMap((row) => Object.keys(row)))];
    applyCreateDefaults(this.ctx, this.namespaceId, this.tableName, mappedRows);

    const conflict = this.#resolveBatchedConflict(providedColumns, options);
    const { selectedForQuery: selectedForUpsert, hiddenColumns } = this.#augmentMutationSelection();

    const dispatch = {
      context: this.ctx.context,
      runtime: this.ctx.runtime,
      tableName: this.tableName,
      modelName: this.modelName,
      namespaceId: this.namespaceId,
      variantName: this.state.variantName,
      includes: this.state.includes,
      selectedFields: this.state.selectedFields,
      hiddenColumns,
      mapRow: (mapped: Record<string, unknown>) =>
        blindCast<Row, 'mapped mutation storage row matches the collection generic row'>(mapped),
    };

    if (this.contract.capabilities?.['sql']?.['defaultInInsert'] !== true) {
      const plans = compileUpsertReturningManySplit(
        this.contract,
        this.namespaceId,
        this.tableName,
        mappedRows,
        conflict,
        selectedForUpsert,
      ).map((plan) => mergeAnnotations(plan, annotationsMap));
      return dispatchSplitMutationRows<Row>({ ...dispatch, plans });
    }

    return dispatchMutationRows<Row>({
      ...dispatch,
      compiled: mergeAnnotations(
        compileUpsertReturningMany(
          this.contract,
          this.namespaceId,
          this.tableName,
          mappedRows,
          conflict,
          selectedForUpsert,
        ),
        annotationsMap,
      ),
    });
  }

  #resolveBatchedConflict(
    providedColumns: readonly string[],
    options: UpsertAllOptions<TContract, ModelName> | undefined,
  ): UpsertConflictResolution {
    const primaryKeyColumns = resolveUpsertConflictColumns(
      this.contract,
      this.namespaceId,
      this.modelName,
      undefined,
    );
    const columns = options?.conflictOn?.length
      ? mapFieldsToColumns(this.contract, this.namespaceId, this.modelName, options.conflictOn)
      : primaryKeyColumns;
    if (columns.length === 0) {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        `upsertAll() for model "${this.modelName}" requires conflict columns`,
        { meta: { method: 'upsertAll', model: this.modelName } },
      );
    }

    // An explicit list is honoured verbatim — naming the conflict column is
    // legal and meaningful (under a case-insensitive collation the stored
    // value and the proposed one can genuinely differ), so it is the caller's
    // call, not something to silently drop.
    if (options?.update) {
      const updateColumns = mapFieldsToColumns(
        this.contract,
        this.namespaceId,
        this.modelName,
        options.update,
      );
      return {
        columns,
        updateColumns,
        updateDefaults: collectUpdateDefaults(
          this.ctx,
          this.namespaceId,
          this.tableName,
          updateColumns,
        ),
      };
    }

    // The primary key is held back along with the conflict target — when the
    // two differ, overwriting it would reassign the identity of a row the
    // caller only meant to refresh.
    const withheld = new Set([...columns, ...primaryKeyColumns]);
    const updateColumns = providedColumns.filter((column) => !withheld.has(column));

    return {
      columns,
      updateColumns,
      updateDefaults: collectUpdateDefaults(
        this.ctx,
        this.namespaceId,
        this.tableName,
        updateColumns,
      ),
    };
  }

  /**
   * Write terminal: update a single matching row — the first one the
   * filter matches — and return it (or `null` when no row matched).
   * Requires a prior `.where(...)` — calling `update(...)` on an
   * unfiltered collection is a type error.
   *
   * Related rows can be created or relinked through relation
   * callbacks on parent/child-owned relations (one-to-one or
   * one-to-many). The callback receives a mutator exposing
   * `create(...)`, `connect(...)`, and `disconnect(...)`. Nested
   * updates against existing related rows, and many-to-many relations
   * as nested-mutation targets, are not supported through this API.
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
   * `withMutationScope`. In that path, annotations apply to the logical
   * `update()` call but do not currently flow into each constituent SQL
   * statement issued for the related rows.
   */
  async update(
    data: State['hasWhere'] extends true
      ? MutationUpdateInput<TContract, ModelName, State['nsId']>
      : never,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<Row | null> {
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

      const pkCriterion = buildPrimaryKeyFilterFromRow(
        this.contract,
        this.namespaceId,
        this.modelName,
        updatedRow,
      );
      return this.#reloadMutationRowByPrimaryKey(pkCriterion);
    }

    return withMutationScope(this.ctx.runtime, async (scope) => {
      const scoped = this.#withRuntime(scope);
      const identityWhere = await scoped.#findFirstMatchingRowIdentityWhere();
      if (!identityWhere) {
        return null;
      }
      const narrowed = scoped.#clone({ filters: [identityWhere] });
      const rows = await narrowed.#updateAllWithAnnotations(
        blindCast<
          State['hasWhere'] extends true
            ? Partial<DefaultModelRow<TContract, ModelName, State['nsId']>>
            : never,
          'absence of nested callbacks selects the scalar update input'
        >(data),
        annotationsMap,
      );
      return rows[0] ?? null;
    });
  }

  /**
   * Write terminal: update every matching row and stream the updated
   * rows. Requires a prior `.where(...)` filter.
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
  updateAll(
    data: State['hasWhere'] extends true
      ? Partial<DefaultModelRow<TContract, ModelName, State['nsId']>>
      : never,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): AsyncIterableResult<Row> {
    return this.#updateAllWithAnnotations(
      data,
      this.#collectAnnotationsFromMeta(configure, 'write', 'updateAll'),
    );
  }

  #updateAllWithAnnotations(
    data: State['hasWhere'] extends true
      ? Partial<DefaultModelRow<TContract, ModelName, State['nsId']>>
      : never,
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
   * `.where(...)` filter.
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
  async updateAndCount(
    data: State['hasWhere'] extends true
      ? Partial<DefaultModelRow<TContract, ModelName, State['nsId']>>
      : never,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<number> {
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
   * unfiltered collection is a type error.
   *
   * ```typescript
   * const deleted = await db.orm.User.where({ id: 1 }).delete();
   * if (deleted) console.log('deleted', deleted.email);
   * ```
   *
   * Accepts an optional `configure` callback that receives a
   * `MetaBuilder<'write'>` for attaching typed annotations.
   */
  async delete(
    this: State['hasWhere'] extends true ? Collection<TContract, ModelName, Row, State> : never,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<Row | null> {
    assertReturningCapability(this.contract, 'delete()');
    const annotationsMap = this.#collectAnnotationsFromMeta(configure, 'write', 'delete');
    return withMutationScope(this.ctx.runtime, async (scope) => {
      const scoped = this.#withRuntime(scope);
      const identityWhere = await scoped.#findFirstMatchingRowIdentityWhere();
      if (!identityWhere) {
        return null;
      }
      const narrowed = scoped.#clone({ filters: [identityWhere] });
      const rows = await narrowed.#executeDeleteReturning(annotationsMap).toArray();
      return rows[0] ?? null;
    });
  }

  /**
   * Write terminal: delete every matching row and stream the deleted
   * rows. Requires a prior `.where(...)` filter.
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
  deleteAll(
    this: State['hasWhere'] extends true ? Collection<TContract, ModelName, Row, State> : never,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): AsyncIterableResult<Row> {
    return blindCast<
      Collection<TContract, ModelName, Row, State>,
      'deleteAll() conditional this parameter is a filtered collection at runtime'
    >(this).#deleteAllWithAnnotations(
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
   * `.where(...)` filter.
   *
   * Prefer `deleteAll(...)` when you need the deleted rows; prefer
   * this when you only need the affected-row count.
   *
   * ```typescript
   * const removed = await db.orm.Post.where({ archived: true }).deleteAndCount();
   * ```
   */
  async deleteAndCount(
    this: State['hasWhere'] extends true ? Collection<TContract, ModelName, Row, State> : never,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<number> {
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
    const columnToField = getColumnToFieldMap(this.contract, this.namespaceId, this.modelName);
    const criterion: Record<string, unknown> = {};

    for (const columnName of conflictColumns) {
      if (!(columnName in createValues)) {
        throw ormError(
          'ORM.ARGUMENT_INVALID',
          `upsert() for model "${this.modelName}" requires create value for conflict column "${columnName}"`,
          { meta: { method: 'upsert', model: this.modelName, column: columnName } },
        );
      }

      const fieldName = columnToField[columnName] ?? columnName;
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
    const firstRow = await this.#clone({
      selectedFields: [...identityColumns],
      includes: [],
    }).first();
    if (!firstRow) {
      return null;
    }
    const columnToField = getColumnToFieldMap(this.contract, this.namespaceId, this.modelName);
    const criterion: Record<string, unknown> = {};
    for (const column of identityColumns) {
      const fieldName = columnToField[column] ?? column;
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
          ShorthandWhereFilter<TContract, ModelName>,
          'identity columns were resolved from this model before building the shorthand filter'
        >(criterion),
      ) ?? null
    );
  }

  async #reloadMutationRowByPrimaryKey(criterion: Record<string, unknown>): Promise<Row | null> {
    return this.#reloadMutationRowByCriterion(criterion, 'primary key');
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
        ShorthandWhereFilter<TContract, ModelName>,
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

  /**
   * The value an aggregate alias reads as when the result set has no row to
   * read at all. Resolution mirrors planning — the same registry, operation,
   * and column — so the answer derives from the operation's declared row
   * rather than its name.
   */
  #emptyAggregateValue(selector: AggregateSelector<unknown>): unknown {
    const resolved = resolveAggregate({
      aggregates: this.ctx.context.aggregateDescriptors,
      contract: this.contract,
      namespaceId: this.namespaceId,
      tableName: this.tableName,
      fn: selector.fn,
      column: selector.column,
    });
    return emptyAggregateResult(
      resolved,
      this.ctx.context.contractCodecs.forCodecRef(resolved.codec),
    );
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

  #clone<NextState extends CollectionTypeState = State>(
    overrides: Partial<CollectionState>,
  ): Collection<TContract, ModelName, Row, NextState> {
    return this.#createSelf<Row, NextState>({
      ...this.state,
      ...overrides,
    });
  }

  #withRuntime(runtime: RuntimeQueryable): CollectionImpl<TContract, ModelName, Row, State> {
    const Ctor = blindCast<
      CollectionConstructor<TContract>,
      'runtime collection subclasses preserve the Collection constructor contract'
    >(this.constructor);
    return blindCast<
      CollectionImpl<TContract, ModelName, Row, State>,
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
      >(CollectionImpl);
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
   * post-wrap path because its compile function doesn't take `state`.
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
    ...Object.getOwnPropertyNames(CollectionImpl.prototype),
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
> = CollectionImpl<TContract, ModelName, Row, State> &
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
>(CollectionImpl);

/**
 * The class behind {@link Collection}, for package-internal prototype-chain
 * checks (`instanceof`) and default construction. The public constructor
 * surface carries a single construct signature returning the intersection,
 * which heritage clauses require; the raw class keeps the `Function` shape
 * those checks need.
 */
export const CollectionBase = CollectionImpl;
