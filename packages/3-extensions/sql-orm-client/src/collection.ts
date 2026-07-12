import type { Contract } from '@prisma-next/contract/types';
import type {
  AnnotationValue,
  MetaBuilder,
  OperationKind,
} from '@prisma-next/framework-components/runtime';
import { AsyncIterableResult, createMetaBuilder } from '@prisma-next/framework-components/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  isWhereExpr,
  LiteralExpr,
  type OrderByItem,
  type ToWhereExpr,
  type WhereArg,
} from '@prisma-next/sql-relational-core/ast';
import type { ScopeField } from '@prisma-next/sql-relational-core/expression';
import { ifDefined } from '@prisma-next/utils/defined';
import type { SimplifyDeep } from '@prisma-next/utils/simplify-deep';
import { createAggregateBuilder, isAggregateSelector } from './aggregate-builder';
import { normalizeAggregateResult } from './collection-aggregate-result';
import { mapCursorValuesToColumns, mapFieldsToColumns } from './collection-column-mapping';
import {
  assertReturningCapability,
  getColumnToFieldMap,
  getFieldToColumnMap,
  isToOneCardinality,
  modelOf,
  type PolymorphismInfo,
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
import { executeQueryPlan } from './execute-query-plan';
import { shorthandToWhereExpr } from './filters';
import { GroupedCollection } from './grouped-collection';
import {
  createIncludeCombine,
  createIncludeScalar,
  isCollectionStateCarrier,
  isIncludeCombine,
  isIncludeScalar,
} from './include-descriptors';
import {
  INTERNAL_TO_TEMP_TABLE_QUERY_SOURCE,
  type InternalTempTableQuerySource,
} from './internal-temp-table-source';
import { createModelAccessor } from './model-accessor';
import {
  buildPrimaryKeyFilterFromRow,
  executeNestedCreateMutation,
  executeNestedUpdateMutation,
  hasNestedMutationCallbacks,
  withMutationScope,
} from './mutation-executor';
import {
  compileAggregate,
  compileDeleteCount,
  compileDeleteReturning,
  compileInsertCount,
  compileInsertCountSplit,
  compileInsertReturning,
  compileInsertReturningSplit,
  compileSelect,
  compileUpdateCount,
  compileUpdateReturning,
  compileUpsertReturning,
  mergeAnnotations,
} from './query-plan';
import { storageTableForContract } from './storage-resolution';
import {
  type AggregateBuilder,
  type AggregateResult,
  type AggregateSpec,
  type CollectionContext,
  type CollectionState,
  type CollectionTypeState,
  type DefaultCollectionTypeState,
  type DefaultModelRow,
  emptyState,
  type IncludeCombine,
  type IncludeCombineBranch,
  type IncludeExpr,
  type IncludeScalar,
  type InferRootRow,
  type MutationCreateInput,
  type MutationCreateInputWithRelations,
  type MutationUpdateInput,
  type NumericFieldNames,
  type RelatedModelName,
  type RelationNames,
  type RelationTargetNamespace,
  type ResolvedCreateInput,
  type RuntimeQueryable,
  type ShorthandWhereFilter,
  type UniqueConstraintCriterion,
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

type WhereDirectInput = WhereArg;

function isToWhereExprInput(value: unknown): value is ToWhereExpr {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toWhereExpr' in value &&
    typeof (value as { toWhereExpr?: unknown }).toWhereExpr === 'function'
  );
}

function isWhereDirectInput(value: unknown): value is WhereDirectInput {
  return (
    (isWhereExpr(value) && typeof (value as { accept?: unknown }).accept === 'function') ||
    isToWhereExprInput(value)
  );
}

interface MtiCreateContext {
  polyInfo: PolymorphismInfo;
  variant: { modelName: string; value: string; table: string; strategy: 'mti' };
  baseFieldToColumn: Record<string, string>;
  variantFieldToColumn: Record<string, string>;
  pkColumn: string;
}

export class Collection<
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
      return this as Collection<TContract, ModelName, Row, WithWhereState<State>>;
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
    const model = modelOf(this.contract, this.namespaceId, this.modelName) as
      | Record<string, unknown>
      | undefined;
    const discriminator = model?.['discriminator'] as { field: string } | undefined;
    const variants = model?.['variants'] as Record<string, { value: string }> | undefined;

    if (!discriminator || !variants) {
      return this as unknown as Collection<
        TContract,
        ModelName,
        VariantModelRow<TContract, ModelName, V>,
        ReturnState
      >;
    }

    const variantEntry = variants[variantName];
    if (!variantEntry) {
      return this as unknown as Collection<
        TContract,
        ModelName,
        VariantModelRow<TContract, ModelName, V>,
        ReturnState
      >;
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
      variantName: variantName as string,
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
    RelName extends RelationNames<TContract, ModelName, State['nsId']>,
    RelatedName extends RelatedModelName<TContract, ModelName, RelName, State['nsId']> &
      string = RelatedModelName<TContract, ModelName, RelName, State['nsId']> & string,
    TargetNs extends string = RelationTargetNamespace<TContract, ModelName, RelName, State['nsId']>,
    IsToMany extends boolean = IsToManyRelation<TContract, ModelName, RelName, State['nsId']>,
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
          ModelName,
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
      relationName as string,
    );

    let nestedState = emptyState();
    let scalarSelector: IncludeScalar<unknown> | undefined;
    let combineBranches: Readonly<Record<string, IncludeCombineBranch>> | undefined;

    if (refineFn) {
      const nestedCollection = this.#createCollection<
        RelatedName,
        SimplifyDeep<InferRootRow<TContract, RelatedName, TargetNs>>,
        DefaultCollectionTypeState
      >(relation.relatedModelName as RelatedName, {
        tableName: relation.relatedTableName,
        namespaceId: relation.relatedNamespaceId,
        state: emptyState(),
        includeRefinementMode: true,
      });
      const refined = refineFn(
        nestedCollection as unknown as IncludeRefinementCollection<
          TContract,
          RelatedName,
          SimplifyDeep<InferRootRow<TContract, RelatedName, TargetNs>>,
          DefaultCollectionTypeState,
          IsToMany
        >,
      );

      if (isIncludeScalar(refined)) {
        if (isToOneCardinality(relation.cardinality)) {
          throw new Error(
            `include('${relationName as string}') scalar aggregations are only supported for to-many relations`,
          );
        }
        scalarSelector = refined;
        nestedState = refined.state;
      } else if (isIncludeCombine(refined)) {
        if (isToOneCardinality(relation.cardinality)) {
          throw new Error(
            `include('${relationName as string}') combine() is only supported for to-many relations`,
          );
        }
        combineBranches = refined.branches;
      } else if (isCollectionStateCarrier(refined)) {
        nestedState = refined.state;
      } else {
        throw new Error(
          `include('${relationName as string}') refinement must return a collection, include scalar selector, or combine() descriptor`,
        );
      }
    }

    const includeExpr: IncludeExpr = {
      relationName: relationName as string,
      relatedModelName: relation.relatedModelName,
      relatedNamespaceId: relation.relatedNamespaceId,
      relatedTableName: relation.relatedTableName,
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
            ModelName,
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

  [INTERNAL_TO_TEMP_TABLE_QUERY_SOURCE](): InternalTempTableQuerySource<
    Record<string, ScopeField>
  > {
    if (this.state.includes.length > 0) {
      throw new Error('tempTable().as(...) does not support include(...) projections.');
    }

    const compiled = compileSelect(
      this.contract,
      this.namespaceId,
      this.tableName,
      this.state,
      this.modelName,
    );

    if (compiled.ast.kind !== 'select') {
      throw new Error('tempTable().as(...) expected a SELECT AST.');
    }
    const ast = compiled.ast;

    const table = storageTableForContract(this.contract, this.namespaceId, this.tableName);
    const selectedColumns = this.state.selectedFields ?? Object.keys(table.columns);
    const rowFields: Record<string, ScopeField> = {};

    for (const column of selectedColumns) {
      const columnSpec = table.columns[column];
      if (!columnSpec) {
        throw new Error(
          `tempTable().as(...): unknown selected column "${column}" for table "${this.tableName}".`,
        );
      }
      rowFields[column] = {
        codecId: columnSpec.codecId,
        nullable: columnSpec.nullable,
      };
    }

    return {
      buildAst: () => ast,
      getRowFields: () => rowFields,
    };
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
      keyof DefaultModelRow<TContract, ModelName> & string,
      ...(keyof DefaultModelRow<TContract, ModelName> & string)[],
    ],
  >(...fields: Fields): GroupedCollection<TContract, ModelName, Fields> {
    const groupByColumns = mapFieldsToColumns(
      this.contract,
      this.namespaceId,
      this.modelName,
      fields,
    );

    return new GroupedCollection(this.ctx, this.modelName, {
      tableName: this.tableName,
      namespaceId: this.namespaceId,
      baseFilters: this.state.filters,
      groupByFields: [...fields],
      groupByColumns,
      havingFilters: [],
    });
  }

  /**
   * Scalar reducer — reduces a to-many relation to the number of
   * related rows. Use inside an `include(...)` refinement callback as
   * `include(..., (rel) => rel.count())`; throws if called elsewhere.
   * The parent row's relation field becomes that count instead of an
   * array.
   *
   * ```typescript
   * const users = await db.orm.User.include('posts', (posts) => posts.count()).all();
   * // each user row: { ...user, posts: number }
   * ```
   */
  count(): IncludeScalar<number> {
    this.#assertIncludeRefinementMode('count()');
    return createIncludeScalar<number>('count', this.state);
  }

  /**
   * Scalar reducer — reduces a to-many relation to the sum of `field`
   * across related rows. Returns `null` when there are no related
   * rows. Use inside an `include(...)` refinement callback; throws if
   * called elsewhere.
   *
   * ```typescript
   * const users = await db.orm.User.include('posts', (posts) => posts.sum('views')).all();
   * // each user row: { ...user, posts: number | null }
   * ```
   */
  sum<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): IncludeScalar<number | null> {
    this.#assertIncludeRefinementMode('sum()');
    const columnName = resolveFieldToColumn(
      this.contract,
      this.namespaceId,
      this.modelName,
      field as string,
    );
    return createIncludeScalar<number | null>('sum', this.state, columnName);
  }

  /**
   * Scalar reducer — reduces a to-many relation to the average of
   * `field` across related rows. Returns `null` when there are no
   * related rows. Use inside an `include(...)` refinement callback;
   * throws if called elsewhere.
   *
   * ```typescript
   * const users = await db.orm.User.include('posts', (posts) => posts.avg('views')).all();
   * // each user row: { ...user, posts: number | null }
   * ```
   */
  avg<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): IncludeScalar<number | null> {
    this.#assertIncludeRefinementMode('avg()');
    const columnName = resolveFieldToColumn(
      this.contract,
      this.namespaceId,
      this.modelName,
      field as string,
    );
    return createIncludeScalar<number | null>('avg', this.state, columnName);
  }

  /**
   * Scalar reducer — reduces a to-many relation to the minimum value
   * of `field` across related rows. Returns `null` when there are no
   * related rows. Use inside an `include(...)` refinement callback;
   * throws if called elsewhere.
   *
   * ```typescript
   * const users = await db.orm.User.include('posts', (posts) => posts.min('views')).all();
   * ```
   */
  min<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): IncludeScalar<number | null> {
    this.#assertIncludeRefinementMode('min()');
    const columnName = resolveFieldToColumn(
      this.contract,
      this.namespaceId,
      this.modelName,
      field as string,
    );
    return createIncludeScalar<number | null>('min', this.state, columnName);
  }

  /**
   * Scalar reducer — reduces a to-many relation to the maximum value
   * of `field` across related rows. Returns `null` when there are no
   * related rows. Use inside an `include(...)` refinement callback;
   * throws if called elsewhere.
   *
   * ```typescript
   * const users = await db.orm.User.include('posts', (posts) => posts.max('views')).all();
   * ```
   */
  max<FieldName extends NumericFieldNames<TContract, ModelName>>(
    field: FieldName,
  ): IncludeScalar<number | null> {
    this.#assertIncludeRefinementMode('max()');
    const columnName = resolveFieldToColumn(
      this.contract,
      this.namespaceId,
      this.modelName,
      field as string,
    );
    return createIncludeScalar<number | null>('max', this.state, columnName);
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
      Collection<TContract, ModelName, unknown, CollectionTypeState> | IncludeScalar<unknown>
    >,
  >(
    spec: Spec,
  ): IncludeCombine<{
    [K in keyof Spec]: Spec[K] extends IncludeScalar<infer ScalarResult>
      ? ScalarResult
      : Spec[K] extends Collection<TContract, ModelName, infer BranchRow, CollectionTypeState>
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

      throw new Error(`include().combine() branch "${name}" is invalid`);
    }

    return createIncludeCombine(branches) as IncludeCombine<{
      [K in keyof Spec]: Spec[K] extends IncludeScalar<infer ScalarResult>
        ? ScalarResult
        : Spec[K] extends Collection<TContract, ModelName, infer BranchRow, CollectionTypeState>
          ? BranchRow[]
          : never;
    }>;
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
      cursorValues as Readonly<Record<string, unknown>>,
    );

    if (Object.keys(mappedCursor).length === 0) {
      return this;
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
    ...fields: State['hasOrderBy'] extends true ? Fields : never
  ): Collection<TContract, ModelName, Row, State> {
    const distinctOnFields = mapFieldsToColumns(
      this.contract,
      this.namespaceId,
      this.modelName,
      fields as readonly string[],
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
    fn: (aggregate: AggregateBuilder<TContract, ModelName>) => Spec,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Promise<AggregateResult<Spec>> {
    const aggregateSpec = fn(
      createAggregateBuilder(this.contract, this.namespaceId, this.modelName),
    );
    const entries = Object.entries(aggregateSpec);
    if (entries.length === 0) {
      throw new Error('aggregate() requires at least one aggregation selector');
    }

    for (const [alias, selector] of entries) {
      if (!isAggregateSelector(selector)) {
        throw new Error(`aggregate() selector "${alias}" is invalid`);
      }
    }

    const annotationsMap = this.#collectAnnotationsFromMeta(configure, 'read', 'aggregate');

    const compiled = mergeAnnotations(
      compileAggregate(
        this.contract,
        this.namespaceId,
        this.tableName,
        this.state.filters,
        aggregateSpec,
      ),
      annotationsMap,
    );
    const rows = await executeQueryPlan<Record<string, unknown>>(
      this.ctx.runtime,
      compiled,
    ).toArray();
    return normalizeAggregateResult(aggregateSpec, rows[0] ?? {});
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
        data as Record<string, unknown>,
      )
    ) {
      const createdRow = await executeNestedCreateMutation({
        context: this.ctx.context,
        runtime: this.ctx.runtime,
        namespaceId: this.namespaceId,
        modelName: this.modelName,
        data: data as MutationCreateInput<Contract<SqlStorage>, string>,
      });

      const pkCriterion = buildPrimaryKeyFilterFromRow(
        this.contract,
        this.namespaceId,
        this.modelName,
        createdRow,
      );
      const reloaded = await this.#reloadMutationRowByPrimaryKey(pkCriterion);
      if (!reloaded) {
        throw new Error(`create() for model "${this.modelName}" did not return a row`);
      }
      return reloaded;
    }

    const rows = await this.#createAllWithAnnotations(
      [data as ResolvedCreateInput<TContract, ModelName, State['variantName'], State['nsId']>],
      annotationsMap,
    );
    const created = rows[0];
    if (created) {
      return created;
    }

    throw new Error(`create() for model "${this.modelName}" did not return a row`);
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

    const rows = data as readonly Record<string, unknown>[];
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
        contract: this.contract,
        runtime: this.ctx.runtime,
        plans,
        tableName: this.tableName,
        modelName: this.modelName,
        namespaceId: this.namespaceId,
        includes: this.state.includes,
        selectedFields: this.state.selectedFields,
        hiddenColumns,
        mapRow: (mapped) => mapped as Row,
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
      contract: this.contract,
      runtime: this.ctx.runtime,
      compiled,
      tableName: this.tableName,
      modelName: this.modelName,
      namespaceId: this.namespaceId,
      includes: this.state.includes,
      selectedFields: this.state.selectedFields,
      hiddenColumns,
      mapRow: (mapped) => mapped as Row,
    });
  }

  #assertNotMtiVariant(method: string): void {
    const mtiCtx = this.#resolveMtiCreateContext();
    if (mtiCtx) {
      throw new Error(
        `${method} is not supported for MTI variant "${this.state.variantName}" on model "${this.modelName}". Use createAll() instead.`,
      );
    }
  }

  #resolveMtiCreateContext(): MtiCreateContext | null {
    const variantName = this.state.variantName;
    if (!variantName) return null;

    const polyInfo = resolvePolymorphismInfo(this.contract, this.namespaceId, this.modelName);
    if (!polyInfo) return null;

    const variant = polyInfo.variants.get(variantName);
    if (!variant || variant.strategy !== 'mti') return null;

    const baseFieldToColumn = getFieldToColumnMap(this.contract, this.namespaceId, this.modelName);
    const variantFieldToColumn = getFieldToColumnMap(
      this.contract,
      this.namespaceId,
      variant.modelName,
    );
    const pkColumn = resolvePrimaryKeyColumn(this.contract, this.namespaceId, this.tableName);

    return {
      polyInfo,
      variant: variant as typeof variant & { strategy: 'mti' },
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
        for (const [fieldName, value] of Object.entries(row as Record<string, unknown>)) {
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
          const baseResult = await executeQueryPlan<Record<string, unknown>>(
            scope,
            baseCompiled,
          ).toArray();
          const baseCreated = baseResult[0];
          if (!baseCreated) {
            throw new Error(`MTI base INSERT for model "${modelName}" did not return a row`);
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
          const variantResult = await executeQueryPlan<Record<string, unknown>>(
            scope,
            variantCompiled,
          ).toArray();
          const variantCreated = variantResult[0];
          if (!variantCreated) {
            throw new Error(
              `MTI variant INSERT for model "${modelName}" into "${variant.table}" did not return a row`,
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

        yield merged as Row;
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
      for (const [fieldName, value] of Object.entries(row as Record<string, unknown>)) {
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
   * const inserted = await db.orm.User.createCount([
   *   { email: 'a@example.com' },
   *   { email: 'b@example.com' },
   * ]);
   * // inserted === 2
   * ```
   *
   * Not supported on MTI variants — use `createAll(...)` instead.
   */
  async createCount(
    data: readonly ResolvedCreateInput<TContract, ModelName, State['variantName']>[],
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<number> {
    if (data.length === 0) {
      return 0;
    }

    this.#assertNotMtiVariant('createCount()');
    const annotationsMap = this.#collectAnnotationsFromMeta(configure, 'write', 'createCount');

    const rows = data as readonly Record<string, unknown>[];
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
        await executeQueryPlan<Record<string, unknown>>(this.ctx.runtime, plan).toArray();
      }
      return data.length;
    }

    const compiled = mergeAnnotations(
      compileInsertCount(this.contract, this.namespaceId, this.tableName, mappedRows),
      annotationsMap,
    );
    await executeQueryPlan<Record<string, unknown>>(this.ctx.runtime, compiled).toArray();
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

    const mappedCreateRows = this.#mapCreateRows([input.create as Record<string, unknown>]);
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
      input.conflictOn as Record<string, unknown> | undefined,
    );
    if (conflictColumns.length === 0) {
      throw new Error(`upsert() for model "${this.modelName}" requires conflict columns`);
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
      contract: this.contract,
      runtime: this.ctx.runtime,
      compiled,
      tableName: this.tableName,
      modelName: this.modelName,
      namespaceId: this.namespaceId,
      includes: this.state.includes,
      selectedFields: this.state.selectedFields,
      hiddenColumns,
      mapRow: (mapped) => mapped as Row,
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

    throw new Error(`upsert() for model "${this.modelName}" did not return a row`);
  }

  /**
   * Write terminal: update matching rows and return the first one (or
   * `null` when no row matched). Requires a prior `.where(...)` —
   * calling `update(...)` on an unfiltered collection is a type error.
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
        data as Record<string, unknown>,
      )
    ) {
      const updatedRow = await executeNestedUpdateMutation({
        context: this.ctx.context,
        runtime: this.ctx.runtime,
        namespaceId: this.namespaceId,
        modelName: this.modelName,
        filters: this.state.filters,
        data: data as MutationUpdateInput<Contract<SqlStorage>, string>,
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
        data as State['hasWhere'] extends true
          ? Partial<DefaultModelRow<TContract, ModelName, State['nsId']>>
          : never,
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
      contract: this.contract,
      runtime: this.ctx.runtime,
      compiled,
      tableName: this.tableName,
      modelName: this.modelName,
      namespaceId: this.namespaceId,
      includes: this.state.includes,
      selectedFields: this.state.selectedFields,
      hiddenColumns,
      mapRow: (mapped) => mapped as Row,
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
   *   .updateCount({ published: true });
   * ```
   */
  async updateCount(
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

    // Annotations attach to the write, not the matching read.
    const annotationsMap = this.#collectAnnotationsFromMeta(configure, 'write', 'updateCount');

    const primaryKeyColumn = resolvePrimaryKeyColumn(
      this.contract,
      this.namespaceId,
      this.tableName,
    );
    const countState: CollectionState = {
      ...emptyState(),
      filters: this.state.filters,
      selectedFields: [primaryKeyColumn],
    };
    const countCompiled = compileSelect(
      this.contract,
      this.namespaceId,
      this.tableName,
      countState,
      undefined,
    );
    const matchingRows = await executeQueryPlan<Record<string, unknown>>(
      this.ctx.runtime,
      countCompiled,
    ).toArray();

    const compiled = mergeAnnotations(
      compileUpdateCount(
        this.contract,
        this.namespaceId,
        this.tableName,
        mappedData,
        this.state.filters,
      ),
      annotationsMap,
    );
    await executeQueryPlan<Record<string, unknown>>(this.ctx.runtime, compiled).toArray();

    return matchingRows.length;
  }

  /**
   * Write terminal: delete matching rows and return the first deleted
   * row (or `null` when no row matched). Requires a prior `.where(...)`
   * — calling `delete()` on an unfiltered collection is a type error.
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
    return (this as Collection<TContract, ModelName, Row, State>).#deleteAllWithAnnotations(
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
      contract: this.contract,
      runtime: this.ctx.runtime,
      compiled,
      tableName: this.tableName,
      modelName: this.modelName,
      namespaceId: this.namespaceId,
      includes: this.state.includes,
      selectedFields: this.state.selectedFields,
      hiddenColumns,
      mapRow: (mapped) => mapped as Row,
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
          contract: collection.contract,
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
          ),
          annotationsMap,
        );
        await executeQueryPlan<Record<string, unknown>>(scope, deletePlan).toArray();
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
   * const removed = await db.orm.Post.where({ archived: true }).deleteCount();
   * ```
   */
  async deleteCount(
    this: State['hasWhere'] extends true ? Collection<TContract, ModelName, Row, State> : never,
    configure?: (meta: MetaBuilder<'write'>) => void,
  ): Promise<number> {
    // Annotations attach to the write, not the matching read.
    const annotationsMap = this.#collectAnnotationsFromMeta(configure, 'write', 'deleteCount');

    const primaryKeyColumn = resolvePrimaryKeyColumn(
      this.contract,
      this.namespaceId,
      this.tableName,
    );
    const countState: CollectionState = {
      ...emptyState(),
      filters: this.state.filters,
      selectedFields: [primaryKeyColumn],
    };
    const countCompiled = compileSelect(
      this.contract,
      this.namespaceId,
      this.tableName,
      countState,
      undefined,
    );
    const matchingRows = await executeQueryPlan<Record<string, unknown>>(
      this.ctx.runtime,
      countCompiled,
    ).toArray();

    const compiled = mergeAnnotations(
      compileDeleteCount(this.contract, this.namespaceId, this.tableName, this.state.filters),
      annotationsMap,
    );
    await executeQueryPlan<Record<string, unknown>>(this.ctx.runtime, compiled).toArray();

    return matchingRows.length;
  }

  #buildUpsertConflictCriterion(
    createValues: Record<string, unknown>,
    conflictColumns: readonly string[],
  ): Record<string, unknown> {
    const columnToField = getColumnToFieldMap(this.contract, this.namespaceId, this.modelName);
    const criterion: Record<string, unknown> = {};

    for (const columnName of conflictColumns) {
      if (!(columnName in createValues)) {
        throw new Error(
          `upsert() for model "${this.modelName}" requires create value for conflict column "${columnName}"`,
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
        throw new Error(
          `Cannot load includes for the mutation result on model "${this.modelName}": table "${this.tableName}" has no primary key or unique constraint to key the include read-back on.`,
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
      throw new Error(
        `update()/delete() on model "${this.modelName}" requires the table to have a primary key or unique constraint`,
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
      const value = (firstRow as Record<string, unknown>)[fieldName];
      if (value === undefined) {
        throw new Error(
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
        criterion as ShorthandWhereFilter<TContract, ModelName>,
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
      criterion as ShorthandWhereFilter<TContract, ModelName>,
    );
    if (!whereExpr) {
      throw new Error(
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
      contract: this.contract,
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

    throw new Error(`${action} is only available inside include() refinement callbacks`);
  }

  #clone<NextState extends CollectionTypeState = State>(
    overrides: Partial<CollectionState>,
  ): Collection<TContract, ModelName, Row, NextState> {
    return this.#createSelf<Row, NextState>({
      ...this.state,
      ...overrides,
    });
  }

  #withRuntime(runtime: RuntimeQueryable): Collection<TContract, ModelName, Row, State> {
    const Ctor = this.constructor as CollectionConstructor<TContract>;
    return new Ctor({ ...this.ctx, runtime }, this.modelName, {
      tableName: this.tableName,
      namespaceId: this.namespaceId,
      state: this.state,
      registry: this.registry,
      includeRefinementMode: this.includeRefinementMode,
    }) as unknown as Collection<TContract, ModelName, Row, State>;
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
    const Ctor = this.constructor as CollectionConstructor<TContract>;
    return new Ctor(this.ctx, this.modelName, {
      tableName: this.tableName,
      namespaceId: this.namespaceId,
      state,
      registry: this.registry,
      includeRefinementMode: this.includeRefinementMode,
    }) as unknown as Collection<TContract, ModelName, NextRow, NextState>;
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
      (this.registry.get(modelName) as CollectionConstructor<TContract> | undefined) ??
      (Collection as unknown as CollectionConstructor<TContract>);
    return new Ctor(this.ctx, modelName, {
      tableName: options.tableName,
      namespaceId: options.namespaceId,
      state: options.state,
      registry:
        options.registry ??
        (this.registry as ReadonlyMap<string, CollectionConstructor<TContract>>),
      includeRefinementMode: options.includeRefinementMode ?? this.includeRefinementMode,
    }) as unknown as Collection<TContract, ModelNameInner, RowInner, StateInner>;
  }

  #dispatch(): AsyncIterableResult<Row> {
    return dispatchCollectionRows<Row>({
      contract: this.contract,
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
    return this.#clone({ annotations: next }) as this;
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
