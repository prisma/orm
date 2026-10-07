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
  OrExpr,
  ParamRef,
  type ProjectionExpr,
  ProjectionItem,
  SelectAst,
} from '@internal/sql-relational-core/ast';
import { codecRefForStorageColumn } from '@internal/sql-relational-core/codec-descriptor-registry';
import { ormError } from './orm-errors';
import type { TableStorageCoordinate } from './table-scope';

export type TableReferences = ReadonlyMap<string, TableStorageCoordinate>;

interface TableSourceCoordinate {
  readonly namespaceId: string | undefined;
  readonly tableName: string;
}

type ReferencesInScope = ReadonlyMap<string, TableSourceCoordinate>;

export function bindWhereExpr(
  contract: Contract<SqlStorage>,
  expr: AnyExpression,
  references: TableReferences,
): AnyExpression {
  return bindWhereExprInScope(contract, expr, references);
}

function bindWhereExprInScope(
  contract: Contract<SqlStorage>,
  expr: AnyExpression,
  references: ReferencesInScope,
): AnyExpression {
  return expr.accept<AnyExpression>({
    columnRef(expr) {
      return bindExpression(contract, expr, references);
    },
    identifierRef(expr) {
      return expr;
    },
    subquery(expr) {
      return bindExpression(contract, expr, references);
    },
    operation(expr) {
      return bindExpression(contract, expr, references);
    },
    aggregate(expr) {
      return bindExpression(contract, expr, references);
    },
    windowFunc(expr) {
      return bindExpression(contract, expr, references);
    },
    functionCall(expr) {
      return bindExpression(contract, expr, references);
    },
    cast(expr) {
      return bindExpression(contract, expr, references);
    },
    case(expr) {
      return bindExpression(contract, expr, references);
    },
    jsonObject(expr) {
      return bindExpression(contract, expr, references);
    },
    jsonArrayAgg(expr) {
      return bindExpression(contract, expr, references);
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
      return bindExpression(contract, expr, references);
    },
    binary(expr) {
      const left = bindExpression(contract, expr.left, references);
      const bindingColumn = left.kind === 'column-ref' ? left : undefined;

      return new BinaryExpr(
        expr.op,
        left,
        bindComparable(contract, expr.right, bindingColumn, references),
      );
    },
    and(expr) {
      return AndExpr.of(expr.exprs.map((part) => bindWhereExprInScope(contract, part, references)));
    },
    or(expr) {
      return OrExpr.of(expr.exprs.map((part) => bindWhereExprInScope(contract, part, references)));
    },
    exists(expr) {
      return expr.notExists
        ? ExistsExpr.notExists(bindSelectAst(contract, expr.subquery, references))
        : ExistsExpr.exists(bindSelectAst(contract, expr.subquery, references));
    },
    nullCheck(expr) {
      return expr.isNull
        ? NullCheckExpr.isNull(bindExpression(contract, expr.expr, references))
        : NullCheckExpr.isNotNull(bindExpression(contract, expr.expr, references));
    },
    not(expr) {
      return new NotExpr(bindWhereExprInScope(contract, expr.expr, references));
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
  references: ReferencesInScope,
): AnyExpression {
  if (comparable.kind === 'param-ref' || bindingColumn === undefined) {
    return comparable.kind === 'param-ref'
      ? comparable
      : comparable.kind === 'literal' || comparable.kind === 'list'
        ? comparable
        : bindExpression(contract, comparable, references);
  }

  if (comparable.kind === 'literal') {
    return paramRefForReference(contract, bindingColumn, comparable.value, references);
  }

  if (comparable.kind === 'list') {
    return ListExpression.of(
      comparable.values.map((value) =>
        value.kind === 'literal'
          ? paramRefForReference(contract, bindingColumn, value.value, references)
          : value,
      ),
    );
  }

  return bindExpression(contract, comparable, references);
}

function unknownColumn(reference: string, column: string): Error {
  return ormError('ORM.COLUMN_UNKNOWN', `Unknown column "${column}" in table "${reference}"`, {
    meta: { tableName: reference, column },
  });
}

function paramRefForReference(
  contract: Contract<SqlStorage>,
  columnRef: ColumnRef,
  value: unknown,
  references: ReferencesInScope,
): ParamRef {
  const coordinate = references.get(columnRef.table);
  if (coordinate === undefined) {
    throw unknownColumn(columnRef.table, columnRef.column);
  }
  return paramRefForTable(contract, coordinate, columnRef.table, columnRef.column, value);
}

function paramRefForTable(
  contract: Contract<SqlStorage>,
  coordinate: TableSourceCoordinate,
  reference: string,
  column: string,
  value: unknown,
): ParamRef {
  const resolved = resolveStorageTable(
    contract.storage,
    coordinate.tableName,
    coordinate.namespaceId,
  );
  if (resolved === undefined || !resolved.table.columns[column]) {
    throw unknownColumn(reference, column);
  }
  const codec = codecRefForStorageColumn(
    contract.storage,
    resolved.namespaceId,
    coordinate.tableName,
    column,
  );
  return ParamRef.of(value, codec ? { codec } : undefined);
}

export function paramRefForStorageColumn(
  contract: Contract<SqlStorage>,
  storage: TableStorageCoordinate,
  column: string,
  value: unknown,
): ParamRef {
  return paramRefForTable(contract, storage, storage.tableName, column, value);
}

function bindExpression(
  contract: Contract<SqlStorage>,
  expr: AnyExpression,
  references: ReferencesInScope,
): AnyExpression {
  const binder: ExpressionRewriter = {
    select: (ast) => bindSelectAst(contract, ast, references),
  };
  return expr.rewrite(binder);
}

function bindProjectionExpr(
  contract: Contract<SqlStorage>,
  expr: ProjectionExpr,
  references: ReferencesInScope,
): ProjectionExpr {
  return expr.kind === 'literal' ? expr : bindExpression(contract, expr, references);
}

function bindJoin(
  contract: Contract<SqlStorage>,
  join: JoinAst,
  references: ReferencesInScope,
): JoinAst {
  return new JoinAst(
    join.joinType,
    bindFromSource(contract, join.source, references),
    join.on.kind === 'eq-col-join-on'
      ? join.on
      : bindWhereExprInScope(contract, join.on, references),
    join.lateral,
  );
}

function bindFromSource(
  contract: Contract<SqlStorage>,
  source: AnyFromSource,
  references: ReferencesInScope,
): AnyFromSource {
  if (source.kind === 'derived-table-source') {
    return DerivedTableSource.as(source.alias, bindSelectAst(contract, source.query, references));
  }
  return source;
}

function referencesWithSources(
  outer: ReferencesInScope,
  sources: readonly AnyFromSource[],
): ReferencesInScope {
  const references = new Map(outer);
  for (const source of sources) {
    if (source.kind === 'table-source') {
      references.set(source.alias ?? source.name, {
        namespaceId: source.namespaceId,
        tableName: source.name,
      });
    }
  }
  return references;
}

function bindSelectAst(
  contract: Contract<SqlStorage>,
  ast: SelectAst,
  outer: ReferencesInScope,
): SelectAst {
  const references = referencesWithSources(outer, [
    ...(ast.from !== undefined ? [ast.from] : []),
    ...(ast.joins ?? []).map((join) => join.source),
  ]);
  return new SelectAst({
    ...(ast.from !== undefined ? { from: bindFromSource(contract, ast.from, outer) } : {}),
    joins: ast.joins?.map((join) => bindJoin(contract, join, references)),
    projection: ast.projection.map(
      (projection) =>
        new ProjectionItem(
          projection.alias,
          bindProjectionExpr(contract, projection.expr, references),
          projection.codec,
        ),
    ),
    where: ast.where ? bindWhereExprInScope(contract, ast.where, references) : undefined,
    orderBy: ast.orderBy?.map((orderItem) =>
      orderItem.withExpr(bindExpression(contract, orderItem.expr, references)),
    ),
    distinct: ast.distinct,
    distinctOn: ast.distinctOn?.map((expr) => bindExpression(contract, expr, references)),
    groupBy: ast.groupBy?.map((expr) => bindExpression(contract, expr, references)),
    having: ast.having ? bindWhereExprInScope(contract, ast.having, references) : undefined,
    limit: ast.limit,
    offset: ast.offset,
    locking: ast.locking,
    selectAllIntent: ast.selectAllIntent,
  });
}
