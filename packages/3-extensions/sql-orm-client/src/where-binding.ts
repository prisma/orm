import type { Contract } from '@internal/contract/types';
import { resolveStorageTable } from '@internal/sql-contract/resolve-storage-table';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  AndExpr,
  type AnyExpression,
  type AnyFromSource,
  BinaryExpr,
  type ColumnRef,
  DerivedTableSource,
  ExistsExpr,
  type ExpressionRewriter,
  JoinAst,
  ListExpression,
  NotExpr,
  NullCheckExpr,
  OrderByItem,
  OrExpr,
  ParamRef,
  type ProjectionExpr,
  ProjectionItem,
  SelectAst,
} from '@internal/sql-relational-core/ast';
import { codecRefForStorageColumn } from '@internal/sql-relational-core/codec-descriptor-registry';
import { ormError } from './orm-errors';

function namespaceCoordinateForSource(source: AnyFromSource): string | undefined {
  return source.kind === 'table-source' ? source.namespaceId : undefined;
}

export function bindWhereExpr(
  contract: Contract<SqlStorage>,
  expr: AnyExpression,
  namespaceId?: string,
): AnyExpression {
  return bindWhereExprNode(contract, expr, namespaceId);
}

function bindWhereExprNode(
  contract: Contract<SqlStorage>,
  expr: AnyExpression,
  namespaceId?: string,
): AnyExpression {
  return expr.accept<AnyExpression>({
    columnRef(expr) {
      return bindExpression(contract, expr);
    },
    identifierRef(expr) {
      return expr;
    },
    subquery(expr) {
      return bindExpression(contract, expr);
    },
    operation(expr) {
      return bindExpression(contract, expr);
    },
    aggregate(expr) {
      return bindExpression(contract, expr);
    },
    windowFunc(expr) {
      return bindExpression(contract, expr);
    },
    functionCall(expr) {
      return bindExpression(contract, expr);
    },
    cast(expr) {
      return bindExpression(contract, expr);
    },
    case(expr) {
      return bindExpression(contract, expr);
    },
    jsonObject(expr) {
      return bindExpression(contract, expr);
    },
    jsonArrayAgg(expr) {
      return bindExpression(contract, expr);
    },
    literal(expr) {
      return expr;
    },
    param(expr) {
      return expr;
    },
    preparedParam(expr) {
      return expr;
    },
    list(expr) {
      return bindExpression(contract, expr);
    },
    binary(expr) {
      const left = bindExpression(contract, expr.left);
      const bindingColumn = left.kind === 'column-ref' ? left : undefined;

      return new BinaryExpr(
        expr.op,
        left,
        bindComparable(contract, expr.right, bindingColumn, namespaceId),
      );
    },
    and(expr) {
      return AndExpr.of(expr.exprs.map((part) => bindWhereExprNode(contract, part, namespaceId)));
    },
    or(expr) {
      return OrExpr.of(expr.exprs.map((part) => bindWhereExprNode(contract, part, namespaceId)));
    },
    exists(expr) {
      return expr.notExists
        ? ExistsExpr.notExists(bindSelectAst(contract, expr.subquery))
        : ExistsExpr.exists(bindSelectAst(contract, expr.subquery));
    },
    nullCheck(expr) {
      return expr.isNull
        ? NullCheckExpr.isNull(bindExpression(contract, expr.expr))
        : NullCheckExpr.isNotNull(bindExpression(contract, expr.expr));
    },
    not(expr) {
      return new NotExpr(bindWhereExprNode(contract, expr.expr, namespaceId));
    },
    rawExpr(expr) {
      return expr;
    },
  });
}

function bindComparable(
  contract: Contract<SqlStorage>,
  comparable: AnyExpression,
  bindingColumn: ColumnRef | undefined,
  namespaceId?: string,
): AnyExpression {
  if (comparable.kind === 'param-ref' || bindingColumn === undefined) {
    return comparable.kind === 'param-ref'
      ? comparable
      : comparable.kind === 'literal' || comparable.kind === 'list'
        ? comparable
        : bindExpression(contract, comparable);
  }

  if (comparable.kind === 'literal') {
    return createParamRef(contract, bindingColumn, comparable.value, namespaceId);
  }

  if (comparable.kind === 'list') {
    return ListExpression.of(
      comparable.values.map((value) =>
        value.kind === 'literal'
          ? createParamRef(contract, bindingColumn, value.value, namespaceId)
          : value,
      ),
    );
  }

  return bindExpression(contract, comparable);
}

function createParamRef(
  contract: Contract<SqlStorage>,
  columnRef: ColumnRef,
  value: unknown,
  namespaceId?: string,
): ParamRef {
  // `resolveStorageTable` resolves the column's owning namespace directly when
  // the coordinate is supplied, and otherwise by scanning storage — failing
  // fast when a bare table name is ambiguous across namespaces rather than
  // silently first-matching.
  const resolved = resolveStorageTable(contract.storage, columnRef.table, namespaceId);
  if (resolved === undefined || !resolved.table.columns[columnRef.column]) {
    throw ormError(
      'ORM.COLUMN_UNKNOWN',
      `Unknown column "${columnRef.column}" in table "${columnRef.table}"`,
      { meta: { tableName: columnRef.table, column: columnRef.column } },
    );
  }
  const codec = codecRefForStorageColumn(
    contract.storage,
    resolved.namespaceId,
    columnRef.table,
    columnRef.column,
  );
  return ParamRef.of(value, codec ? { codec } : undefined);
}

function createExpressionBinder(contract: Contract<SqlStorage>): ExpressionRewriter {
  return {
    select: (ast) => bindSelectAst(contract, ast),
  };
}

function bindExpression(contract: Contract<SqlStorage>, expr: AnyExpression): AnyExpression {
  return expr.rewrite(createExpressionBinder(contract));
}

function bindProjectionExpr(contract: Contract<SqlStorage>, expr: ProjectionExpr): ProjectionExpr {
  return expr.kind === 'literal' ? expr : bindExpression(contract, expr);
}

function bindOrderByItem(contract: Contract<SqlStorage>, orderItem: OrderByItem): OrderByItem {
  return new OrderByItem(bindExpression(contract, orderItem.expr), orderItem.dir, orderItem.nulls);
}

function bindJoin(contract: Contract<SqlStorage>, join: JoinAst): JoinAst {
  const namespaceId = namespaceCoordinateForSource(join.source);
  return new JoinAst(
    join.joinType,
    bindFromSource(contract, join.source),
    join.on.kind === 'eq-col-join-on' ? join.on : bindWhereExprNode(contract, join.on, namespaceId),
    join.lateral,
  );
}

function bindFromSource(contract: Contract<SqlStorage>, source: AnyFromSource): AnyFromSource {
  if (source.kind === 'table-source') {
    return source;
  }
  if (source.kind === 'derived-table-source') {
    return DerivedTableSource.as(source.alias, bindSelectAst(contract, source.query));
  }

  return source;
}

function bindSelectAst(contract: Contract<SqlStorage>, ast: SelectAst): SelectAst {
  const namespaceId = ast.from !== undefined ? namespaceCoordinateForSource(ast.from) : undefined;
  return new SelectAst({
    ...(ast.from !== undefined ? { from: bindFromSource(contract, ast.from) } : {}),
    joins: ast.joins?.map((join) => bindJoin(contract, join)),
    projection: ast.projection.map(
      (projection) =>
        new ProjectionItem(
          projection.alias,
          bindProjectionExpr(contract, projection.expr),
          projection.codec,
        ),
    ),
    where: ast.where ? bindWhereExprNode(contract, ast.where, namespaceId) : undefined,
    orderBy: ast.orderBy?.map((orderItem) => bindOrderByItem(contract, orderItem)),
    distinct: ast.distinct,
    distinctOn: ast.distinctOn?.map((expr) => bindExpression(contract, expr)),
    groupBy: ast.groupBy?.map((expr) => bindExpression(contract, expr)),
    having: ast.having ? bindWhereExprNode(contract, ast.having, namespaceId) : undefined,
    limit: ast.limit,
    offset: ast.offset,
    selectAllIntent: ast.selectAllIntent,
  });
}
