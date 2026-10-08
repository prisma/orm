import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  type BinaryOp,
  ColumnRef,
  DerivedTableSource,
  EqColJoinOn,
  JoinAst,
  type JoinOnExpr,
  LiteralExpr,
  OrderByItem,
  OrExpr,
  ProjectionItem,
  SelectAst,
  type TableSource,
  WindowFuncExpr,
} from '@internal/sql-relational-core/ast';
import { codecRefForStorageColumn } from '@internal/sql-relational-core/codec-descriptor-registry';
import { assertDefined } from '@internal/utils/assertions';
import { InternalError } from '@internal/utils/internal-error';
import {
  type PolymorphismInfo,
  resolvePolymorphismInfo,
  resolvePrimaryKeyColumns,
} from './collection-contract';
import {
  type CollectionTables,
  requireVariantTable,
  variantColumnLabel,
} from './collection-tables';
import { assertCursorCompatibleOrder } from './order-by-guards';
import { ormError } from './orm-errors';
import { resolveTableColumns } from './query-plan-meta';
import type { AliasedTable } from './table-scope';
import type { CollectionState } from './types';
import { paramRefForStorageColumn } from './where-binding';
import { combineWhereExprs } from './where-utils';

type CursorOrderEntry = {
  readonly column: string;
  readonly direction: 'asc' | 'desc';
  readonly value: unknown;
};

function createBoundaryExpr(
  contract: Contract<SqlStorage>,
  table: AliasedTable,
  entry: CursorOrderEntry,
): AnyExpression {
  const comparator: BinaryOp = entry.direction === 'asc' ? 'gt' : 'lt';
  return new BinaryExpr(
    comparator,
    table.column(entry.column),
    paramRefForStorageColumn(contract, table.storage, entry.column, entry.value),
  );
}

function buildLexicographicCursorWhere(
  contract: Contract<SqlStorage>,
  table: AliasedTable,
  entries: readonly CursorOrderEntry[],
): AnyExpression {
  const branches = entries.map((entry, index): AnyExpression => {
    const branchExprs: AnyExpression[] = [];

    for (const prefixEntry of entries.slice(0, index)) {
      branchExprs.push(
        BinaryExpr.eq(
          table.column(prefixEntry.column),
          paramRefForStorageColumn(contract, table.storage, prefixEntry.column, prefixEntry.value),
        ),
      );
    }

    branchExprs.push(createBoundaryExpr(contract, table, entry));
    if (branchExprs.length === 1) {
      const branch = branchExprs[0];
      assertDefined(branch, 'cursor branch contains its boundary expression');
      return branch;
    }

    return AndExpr.of(branchExprs);
  });

  if (branches.length === 1) {
    const branch = branches[0];
    assertDefined(branch, 'cursor expression contains its single branch');
    return branch;
  }

  return OrExpr.of(branches);
}

function buildCursorWhere(
  contract: Contract<SqlStorage>,
  table: AliasedTable,
  orderBy: readonly OrderByItem[] | undefined,
  cursor: Readonly<Record<string, unknown>> | undefined,
): AnyExpression | undefined {
  if (!cursor || !orderBy || orderBy.length === 0) {
    return undefined;
  }

  assertCursorCompatibleOrder(orderBy);
  const entries: CursorOrderEntry[] = [];
  for (const order of orderBy) {
    if (order.expr.kind !== 'column-ref') {
      throw new InternalError('assertCursorCompatibleOrder admits only column orders');
    }
    const column = order.expr.column;
    const value = cursor[column];
    if (value === undefined) {
      throw ormError(
        'ORM.CURSOR_VALUE_MISSING',
        `Missing cursor value for orderBy column "${column}"`,
        {
          meta: { column },
        },
      );
    }
    entries.push({
      column,
      direction: order.dir,
      value,
    });
  }

  const firstEntry = entries[0];
  if (entries.length === 1 && firstEntry !== undefined) {
    return createBoundaryExpr(contract, table, firstEntry);
  }

  return buildLexicographicCursorWhere(contract, table, entries);
}

function buildStateWhere(
  contract: Contract<SqlStorage>,
  state: CollectionState,
): AnyExpression | undefined {
  const cursorWhere = buildCursorWhere(contract, state.tables.root, state.orderBy, state.cursor);
  return combineWhereExprs(cursorWhere ? [...state.filters, cursorWhere] : state.filters);
}

/**
 * Wrap a base SELECT in a `ROW_NUMBER() OVER (PARTITION BY … ORDER BY …) = 1`
 * filter, implementing Prisma-style `.distinct(cols)` semantics: one
 * representative row per `(distinctColumnRefs)` group is kept; the rest
 * are dropped.
 *
 * Picking which row survives in each partition is governed by
 * `rankingOrderBy`. When the caller's `orderBy` doesn't fully order rows
 * within a partition (e.g. user wrote `.distinct('title')` with no
 * `orderBy`, or ties in their ordering), the choice is
 * implementation-defined — matching Prisma's documented nested-distinct
 * behaviour. Callers that want determinism should pass an `orderBy` that
 * is total within each partition.
 *
 * The wrapper forwards every column of `base.projection` through the
 * derived alias, so the wrapper's projection is byte-identical in alias
 * names — making this transparent to any outer query (`json_agg`,
 * correlated subquery, top-level SELECT) that consumes the SELECT.
 */
function wrapWithRowNumberDedup(options: {
  readonly base: SelectAst;
  readonly distinctColumnRefs: ReadonlyArray<AnyExpression>;
  readonly rankingOrderBy: ReadonlyArray<OrderByItem>;
  readonly rankedAlias: string;
}): SelectAst {
  const { base, distinctColumnRefs, rankingOrderBy, rankedAlias } = options;
  const rnAlias = '__prisma_distinct_rn';
  // SQLite requires an ORDER BY inside the window spec for ranking
  // functions; Postgres allows omitting it but the result is
  // unspecified. Default to ordering by the partition columns so the
  // emitted SQL is portable AND deterministic-modulo-distinct-cols
  // (which is the natural choice when the caller didn't specify).
  const effectiveOrderBy =
    rankingOrderBy.length > 0
      ? rankingOrderBy
      : distinctColumnRefs.map((expr) => OrderByItem.asc(expr));

  const inner = base.withProjection([
    ...base.projection,
    ProjectionItem.of(
      rnAlias,
      WindowFuncExpr.rowNumber({
        partitionBy: distinctColumnRefs,
        orderBy: effectiveOrderBy,
      }),
    ),
  ]);

  return SelectAst.from(DerivedTableSource.as(rankedAlias, inner))
    .withProjection(
      base.projection.map((item) =>
        ProjectionItem.of(item.alias, ColumnRef.of(rankedAlias, item.alias), item.codec),
      ),
    )
    .withWhere(BinaryExpr.eq(ColumnRef.of(rankedAlias, rnAlias), LiteralExpr.of(1)));
}

/**
 * FROM source + WHERE for `state.distinct`: wraps in a `ROW_NUMBER`-ranked
 * derived table aliased back to the root alias, so callers need no rewriting.
 */
function buildDedupedTableSource(
  contract: Contract<SqlStorage>,
  state: CollectionState,
  where: AnyExpression | undefined,
  wrapProjection: ReadonlyArray<ProjectionItem>,
  joins?: ReadonlyArray<JoinAst>,
): {
  readonly source: TableSource | DerivedTableSource;
  readonly where: AnyExpression | undefined;
} {
  const { root } = state.tables;
  if (!hasEntries(state.distinct)) {
    return { source: root.tableSource(contract), where };
  }

  const distinctColumnRefs = state.distinct.map((column) => root.column(column));
  const rankingOrderBy = hasEntries(state.orderBy)
    ? state.orderBy
    : distinctColumnRefs.map((expr) => OrderByItem.asc(expr));

  let inner = SelectAst.from(root.tableSource(contract)).withProjection([
    ...wrapProjection,
    ProjectionItem.of(
      '__prisma_distinct_rn',
      WindowFuncExpr.rowNumber({ partitionBy: distinctColumnRefs, orderBy: rankingOrderBy }),
    ),
  ]);
  if (joins && joins.length > 0) {
    inner = inner.withJoins(joins);
  }
  if (where) {
    inner = inner.withWhere(where);
  }

  return {
    source: DerivedTableSource.as(root.alias, inner),
    where: BinaryExpr.eq(root.column('__prisma_distinct_rn'), LiteralExpr.of(1)),
  };
}

function buildPrimaryKeyJoinOn(
  left: AliasedTable,
  right: AliasedTable,
  primaryKeyColumns: readonly string[],
): JoinOnExpr {
  const [firstColumn] = primaryKeyColumns;
  if (primaryKeyColumns.length === 1 && firstColumn !== undefined) {
    return EqColJoinOn.of(left.column(firstColumn), right.column(firstColumn));
  }
  return AndExpr.of(
    primaryKeyColumns.map((column) => BinaryExpr.eq(left.column(column), right.column(column))),
  );
}

function buildMtiJoins(
  contract: Contract<SqlStorage>,
  tables: CollectionTables,
  polyInfo: PolymorphismInfo,
  variantName: string | undefined,
  selectedColumnsByVariant: ReadonlyMap<string, ReadonlySet<string>> | undefined,
): { joins: JoinAst[]; projection: ProjectionItem[] } {
  const joins: JoinAst[] = [];
  const projection: ProjectionItem[] = [];

  const variantsToJoin = variantName
    ? polyInfo.mtiVariants.filter((v) => v.modelName === variantName)
    : polyInfo.mtiVariants;
  if (variantsToJoin.length === 0) {
    return { joins, projection };
  }
  const { root } = tables;
  const pkColumns = resolvePrimaryKeyColumns(
    contract,
    root.storage.namespaceId,
    root.storage.tableName,
  );

  for (const variant of variantsToJoin) {
    const variantTable = requireVariantTable(tables, variant.modelName);
    const joinOn = buildPrimaryKeyJoinOn(root, variantTable, pkColumns);
    joins.push(
      variantName
        ? JoinAst.inner(variantTable.tableSource(contract), joinOn)
        : JoinAst.left(variantTable.tableSource(contract), joinOn),
    );

    const { namespaceId, tableName } = variantTable.storage;
    const variantColumns = resolveTableColumns(contract, namespaceId, tableName);
    const selectedVariantColumns = selectedColumnsByVariant?.get(variant.modelName);
    for (const col of variantColumns) {
      if (pkColumns.includes(col)) continue;
      if (selectedColumnsByVariant !== undefined && selectedVariantColumns?.has(col) !== true) {
        continue;
      }
      projection.push(
        ProjectionItem.of(
          variantColumnLabel(variantTable, col),
          variantTable.column(col),
          codecRefForStorageColumn(contract.storage, namespaceId, tableName, col),
        ),
      );
    }
  }

  return { joins, projection };
}

function hasEntries<T>(value: ReadonlyArray<T> | undefined): value is ReadonlyArray<T> {
  return value !== undefined && value.length > 0;
}

/**
 * The rows an aggregate reduces over, one SELECT aliased to the root alias — an
 * aggregate has no outer level of its own, so where/joins/distinct/orderBy/
 * limit/offset all have to live in this one wrap.
 */
function buildAggregateInput(
  contract: Contract<SqlStorage>,
  state: CollectionState,
  modelName: string | undefined,
  projection: ReadonlyArray<ProjectionItem>,
): { readonly source: DerivedTableSource } {
  const { root } = state.tables;
  const polyInfo = modelName
    ? resolvePolymorphismInfo(contract, root.storage.namespaceId, modelName)
    : undefined;
  const variantJoins =
    polyInfo && polyInfo.mtiVariants.length > 0
      ? buildMtiJoins(contract, state.tables, polyInfo, state.variantName, undefined).joins
      : [];

  const where = buildStateWhere(contract, state);
  const hiddenOrders = hasEntries(state.distinct)
    ? projectExpressionOrders(root, state.orderBy)
    : undefined;
  const { source, where: effectiveWhere } = buildDedupedTableSource(
    contract,
    state,
    where,
    [...projection, ...(hiddenOrders?.projection ?? [])],
    variantJoins,
  );

  let inner = SelectAst.from(source).withProjection(projection);
  // Only the pass-through case needs joins applied here; the wrap already folded them in.
  if (!hasEntries(state.distinct) && variantJoins.length > 0) {
    inner = inner.withJoins(variantJoins);
  }
  if (effectiveWhere) {
    inner = inner.withWhere(effectiveWhere);
  }

  if (hasEntries(state.distinctOn)) {
    inner = inner.withDistinctOn(state.distinctOn.map((column) => root.column(column)));
  }
  const orderBy = hiddenOrders?.orderBy ?? state.orderBy;
  if (hasEntries(orderBy)) {
    inner = inner.withOrderBy(orderBy);
  }
  if (state.limit !== undefined) {
    inner = inner.withLimit(state.limit);
  }
  if (state.offset !== undefined) {
    inner = inner.withOffset(state.offset);
  }

  return { source: DerivedTableSource.as(root.alias, inner) };
}

/**
 * The dedup wrap exposes only its projection, so an order over an expression (a relation order, a count, an operation result) cannot be evaluated above it. Each such order is projected inside the wrap as a hidden `__order_N` column and the outer order reads that column.
 */
function projectExpressionOrders(
  root: AliasedTable,
  orderBy: readonly OrderByItem[] | undefined,
): { readonly projection: ProjectionItem[]; readonly orderBy: OrderByItem[] } {
  const projection: ProjectionItem[] = [];
  const outerOrderBy = (orderBy ?? []).map((item, index) => {
    if (item.expr.kind === 'column-ref') {
      return item;
    }
    const alias = `__order_${index}`;
    projection.push(ProjectionItem.of(alias, item.expr));
    return item.withExpr(root.column(alias));
  });
  return { projection, orderBy: outerOrderBy };
}

export {
  buildAggregateInput,
  buildDedupedTableSource,
  buildMtiJoins,
  buildPrimaryKeyJoinOn,
  buildStateWhere,
  wrapWithRowNumberDedup,
};
