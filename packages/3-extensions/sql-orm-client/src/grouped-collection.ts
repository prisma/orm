import type { Contract } from '@internal/contract/types';
import type {
  AnnotationValue,
  MetaBuilder,
  OperationKind,
} from '@internal/framework-components/runtime';
import { createMetaBuilder } from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  AggregateExpr,
  type AnyExpression,
  BinaryExpr,
  type BinaryOp,
  ColumnRef,
  isAggregateFn,
  LiteralExpr,
  type OrderByItem,
} from '@internal/sql-relational-core/ast';
import type { SqlAggregateDescriptorRegistry } from '@internal/sql-relational-core/query-lane-context';
import { blindCast } from '@internal/utils/casts';
import type { SimplifyDeep } from '@internal/utils/simplify-deep';
import { createAggregateBuilder, isAggregateSelector } from './aggregate-builder';
import { aggregateOperationNames } from './aggregate-operations';
import { getFieldToColumnMap } from './collection-contract';
import { mapStorageRowToModelFields } from './collection-runtime';
import { createModelAccessor } from './model-accessor';
import { ormError } from './orm-errors';
import { compileGroupedAggregate, mergeAnnotations } from './query-plan';
import { queryPlanRows } from './query-plan-rows';
import type {
  AggregateBuilder,
  AggregateResult,
  AggregateSpec,
  CollectionContext,
  CollectionState,
  DefaultModelRow,
  GroupPagingState,
  HavingBuilder,
  HavingComparisonMethods,
  ModelAccessor,
} from './types';
import { combineWhereExprs } from './where-utils';

interface GroupedCollectionInit {
  readonly tableName: string;
  readonly namespaceId: string;
  readonly preGroupState: CollectionState;
  readonly groupByFields: readonly string[];
  readonly groupByColumns: readonly string[];
  readonly havingFilters: readonly AnyExpression[];
  readonly postGroup: GroupPagingState;
}

type GroupByFieldName<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = keyof DefaultModelRow<TContract, ModelName, NsId> & string;

export class GroupedCollection<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  GroupFields extends readonly GroupByFieldName<TContract, ModelName, NsId>[],
  NsId extends string = never,
  HasOrderBy extends boolean = false,
> {
  readonly ctx: CollectionContext<TContract>;
  private readonly contract: TContract;
  readonly modelName: ModelName;
  readonly tableName: string;
  readonly namespaceId: string;
  readonly preGroupState: CollectionState;
  readonly groupByFields: readonly string[];
  readonly groupByColumns: readonly string[];
  readonly havingFilters: readonly AnyExpression[];
  readonly postGroup: GroupPagingState;

  constructor(
    ctx: CollectionContext<TContract>,
    modelName: ModelName,
    options: GroupedCollectionInit,
  ) {
    this.ctx = ctx;
    this.contract = ctx.context.contract;
    this.modelName = modelName;
    this.tableName = options.tableName;
    this.namespaceId = options.namespaceId;
    this.preGroupState = options.preGroupState;
    this.groupByFields = options.groupByFields;
    this.groupByColumns = options.groupByColumns;
    this.havingFilters = options.havingFilters;
    this.postGroup = options.postGroup;
  }

  #clone<NextHasOrderBy extends boolean = HasOrderBy>(
    overrides: Partial<GroupedCollectionInit>,
  ): GroupedCollection<TContract, ModelName, GroupFields, NsId, NextHasOrderBy> {
    return blindCast<
      GroupedCollection<TContract, ModelName, GroupFields, NsId, NextHasOrderBy>,
      'the constructor installed the reducer members the surface type declares; NextHasOrderBy is a phantom type param the constructor cannot infer'
    >(
      new GroupedCollection(this.ctx, this.modelName, {
        tableName: this.tableName,
        namespaceId: this.namespaceId,
        preGroupState: this.preGroupState,
        groupByFields: this.groupByFields,
        groupByColumns: this.groupByColumns,
        havingFilters: this.havingFilters,
        postGroup: this.postGroup,
        ...overrides,
      }),
    );
  }

  having(
    predicate: (having: HavingBuilder<TContract, ModelName, NsId>) => AnyExpression,
  ): GroupedCollection<TContract, ModelName, GroupFields, NsId, HasOrderBy> {
    const havingExpr = predicate(
      createHavingBuilder<TContract, ModelName, NsId>(
        this.contract,
        this.ctx.context.aggregateDescriptors,
        this.namespaceId,
        this.modelName,
        this.tableName,
      ),
    );
    return this.#clone({ havingFilters: [...this.havingFilters, havingExpr] });
  }

  /**
   * Append an `ORDER BY` clause on the grouped rows themselves — orders by
   * group key. Ordering by an aggregate alias needs a builder surface over
   * the aliases and isn't supported here. Unlocks post-group `take(...)` /
   * `skip(...)`, which page a group order that would otherwise be undefined.
   */
  orderBy(
    selection:
      | ((
          model: Pick<ModelAccessor<TContract, ModelName, NsId>, GroupFields[number]>,
        ) => OrderByItem)
      | readonly [
          (
            model: Pick<ModelAccessor<TContract, ModelName, NsId>, GroupFields[number]>,
          ) => OrderByItem,
          ...ReadonlyArray<
            (
              model: Pick<ModelAccessor<TContract, ModelName, NsId>, GroupFields[number]>,
            ) => OrderByItem
          >,
        ],
  ): GroupedCollection<TContract, ModelName, GroupFields, NsId, true> {
    const selectors = Array.isArray(selection) ? selection : [selection];
    if (selectors.length === 0) {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        `orderBy() for model "${this.modelName}" requires at least one selector`,
        { meta: { method: 'orderBy', model: this.modelName } },
      );
    }
    const accessor = createModelAccessor<TContract, ModelName>(
      this.ctx.context,
      this.namespaceId,
      this.modelName,
    );
    const nextOrders = selectors.map((selector) => selector(accessor));
    return this.#clone<true>({
      postGroup: { ...this.postGroup, orderBy: [...this.postGroup.orderBy, ...nextOrders] },
    });
  }

  /**
   * Apply `LIMIT n` to the grouped rows. Replaces any previous post-group
   * limit. Requires a prior `orderBy(...)` — a database may return groups in
   * any order, so "the first n groups" is undefined without one.
   */
  take(
    n: HasOrderBy extends true ? number : never,
  ): GroupedCollection<TContract, ModelName, GroupFields, NsId, HasOrderBy> {
    return this.#clone({ postGroup: { ...this.postGroup, limit: n } });
  }

  /**
   * Apply `OFFSET n` to the grouped rows. Replaces any previous post-group
   * offset. Requires a prior `orderBy(...)`, same as `take(...)` — Prisma
   * pairs `skip`/`take` with `orderBy` on `groupBy` for the same reason.
   */
  skip(
    n: HasOrderBy extends true ? number : never,
  ): GroupedCollection<TContract, ModelName, GroupFields, NsId, HasOrderBy> {
    return this.#clone({ postGroup: { ...this.postGroup, offset: n } });
  }

  /**
   * Read terminal: run a grouped aggregate query.
   *
   * Accepts an optional `configure` callback that receives a
   * `MetaBuilder<'read'>` for attaching typed annotations.
   * Annotations are merged into the compiled plan's `meta.annotations`.
   */
  async aggregate<Spec extends AggregateSpec>(
    fn: (aggregate: AggregateBuilder<TContract, ModelName, NsId>) => Spec,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Promise<
    Array<
      SimplifyDeep<
        Pick<DefaultModelRow<TContract, ModelName, NsId>, GroupFields[number]> &
          AggregateResult<Spec>
      >
    >
  > {
    const aggregateSpec = fn(
      createAggregateBuilder<TContract, ModelName, NsId>(
        this.contract,
        this.ctx.context.aggregateDescriptors,
        this.namespaceId,
        this.modelName,
      ),
    );
    const aggregateEntries = Object.entries(aggregateSpec);
    if (aggregateEntries.length === 0) {
      throw ormError(
        'ORM.AGGREGATE_SELECTOR_MISSING',
        'groupBy().aggregate() requires at least one aggregation selector',
        { meta: { method: 'groupBy.aggregate', model: this.modelName } },
      );
    }

    for (const [alias, selector] of aggregateEntries) {
      if (!isAggregateSelector(selector)) {
        throw ormError(
          'ORM.AGGREGATE_SELECTOR_INVALID',
          `groupBy().aggregate() selector "${alias}" is invalid`,
          { meta: { method: 'groupBy.aggregate', model: this.modelName, alias } },
        );
      }
    }

    let annotationsMap: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> | undefined;
    if (configure !== undefined) {
      const meta = createMetaBuilder('read', 'groupBy.aggregate');
      configure(meta);
      if (meta.annotations.size > 0) {
        annotationsMap = meta.annotations;
      }
    }

    const compiled = mergeAnnotations(
      compileGroupedAggregate(
        this.contract,
        this.ctx.context.aggregateDescriptors,
        this.namespaceId,
        this.tableName,
        this.preGroupState,
        this.groupByColumns,
        aggregateSpec,
        combineWhereExprs(this.havingFilters),
        this.modelName,
        this.postGroup,
      ),
      annotationsMap,
    );
    const rows = await queryPlanRows<Record<string, unknown>>(this.ctx.runtime, compiled).toArray();

    return rows.map((row) => {
      const mapped = mapStorageRowToModelFields(
        this.contract,
        this.namespaceId,
        this.modelName,
        row,
      );
      for (const [alias] of aggregateEntries) {
        mapped[alias] = row[alias];
      }
      return mapped;
    }) as Array<
      SimplifyDeep<
        Pick<DefaultModelRow<TContract, ModelName, NsId>, GroupFields[number]> &
          AggregateResult<Spec>
      >
    >;
  }
}

/**
 * The having metric methods, one per operation the registry contributes —
 * the runtime mirror of the contract's emitted aggregate map, which is what
 * types the surface as {@link HavingBuilder}. HAVING compares the value
 * inside the database, so only an operation's plain `AggregateExpr` form is
 * sound here: an operation outside the SQL aggregate alphabet exists only in
 * its descriptor-lowered form — a rendering for the driver boundary — and is
 * refused. The typed surface already excludes it; the runtime refusal covers
 * dynamic invocation.
 */
function createHavingBuilder<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
>(
  contract: TContract,
  aggregates: SqlAggregateDescriptorRegistry,
  namespaceId: string,
  modelName: ModelName,
  tableName: string,
): HavingBuilder<TContract, ModelName, NsId> {
  const fieldToColumn = getFieldToColumnMap(contract, namespaceId, modelName);
  const builder: Record<string, (field?: string) => HavingComparisonMethods<number | null>> = {};
  for (const operation of aggregateOperationNames(aggregates)) {
    builder[operation] = (field?: string) => {
      if (!isAggregateFn(operation)) {
        throw ormError(
          'ORM.AGGREGATE_PROJECTION_ONLY',
          `Aggregate operation '${operation}' is projection-only: it has no plain SQL form for HAVING, ORDER BY, or comparison positions.`,
          {
            why: "An operation outside the SQL aggregate alphabet reaches SQL only through its descriptor's lowering hook — a rendering for the driver boundary. HAVING and ORDER BY compare the value inside the database, where that rendering would change SQL semantics.",
            fix: `Project '${operation}' in a select and filter or order on the projected value, or use an operation from the SQL aggregate alphabet.`,
            meta: { operation },
          },
        );
      }
      const metric = new AggregateExpr(
        operation,
        field === undefined ? undefined : ColumnRef.of(tableName, fieldToColumn[field] ?? field),
      );
      return createHavingComparisonMethods(metric);
    };
  }
  return blindCast<
    HavingBuilder<TContract, ModelName, NsId>,
    "the registry's operations are the contract's emitted aggregate map, whose mapped type enforces each method's arity and comparand"
  >(builder);
}

function createHavingComparisonMethods<T extends number | null>(
  metric: AggregateExpr,
): HavingComparisonMethods<T> {
  const buildBinaryExpr = (op: BinaryOp, value: unknown): AnyExpression =>
    new BinaryExpr(op, metric, LiteralExpr.of(value));

  return {
    eq(value) {
      return buildBinaryExpr('eq', value);
    },
    neq(value) {
      return buildBinaryExpr('neq', value);
    },
    gt(value) {
      return buildBinaryExpr('gt', value);
    },
    lt(value) {
      return buildBinaryExpr('lt', value);
    },
    gte(value) {
      return buildBinaryExpr('gte', value);
    },
    lte(value) {
      return buildBinaryExpr('lte', value);
    },
  };
}
