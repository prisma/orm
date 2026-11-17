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

export type TableAliases = ReadonlyMap<string, TableStorageCoordinate>;

interface TableSourceCoordinate {
  readonly namespaceId: string | undefined;
  readonly tableName: string;
}

type AliasesInScope = ReadonlyMap<string, TableSourceCoordinate>;

export function bindWhereExpr(
  contract: Contract<SqlStorage>,
  expr: AnyExpression,
  aliases: TableAliases,
): AnyExpression {
  return bindWhereExprInScope(contract, expr, aliases);
}

function bindWhereExprInScope(
  contract: Contract<SqlStorage>,
  expr: AnyExpression,
  aliases: AliasesInScope,
): AnyExpression {
  return expr.accept<AnyExpression>({
    columnRef(expr) {
      return bindExpression(contract, expr, aliases);
    },
    identifierRef(expr) {
      return expr;
    },
    subquery(expr) {
      return bindExpression(contract, expr, aliases);
    },
    operation(expr) {
      return bindExpression(contract, expr, aliases);
    },
    aggregate(expr) {
      return bindExpression(contract, expr, aliases);
    },
    windowFunc(expr) {
      return bindExpression(contract, expr, aliases);
    },
    functionCall(expr) {
      return bindExpression(contract, expr, aliases);
    },
    cast(expr) {
      return bindExpression(contract, expr, aliases);
    },
    case(expr) {
      return bindExpression(contract, expr, aliases);
    },
    jsonObject(expr) {
      return bindExpression(contract, expr, aliases);
    },
    jsonArrayAgg(expr) {
      return bindExpression(contract, expr, aliases);
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
      return bindExpression(contract, expr, aliases);
    },
    binary(expr) {
      const left = bindExpression(contract, expr.left, aliases);
      const bindingColumn = left.kind === 'column-ref' ? left : undefined;

      return new BinaryExpr(
        expr.op,
        left,
        bindComparable(contract, expr.right, bindingColumn, aliases),
      );
    },
    and(expr) {
      return AndExpr.of(expr.exprs.map((part) => bindWhereExprInScope(contract, part, aliases)));
    },
    or(expr) {
      return OrExpr.of(expr.exprs.map((part) => bindWhereExprInScope(contract, part, aliases)));
    },
    exists(expr) {
      return expr.notExists
        ? ExistsExpr.notExists(bindSelectAst(contract, expr.subquery, aliases))
        : ExistsExpr.exists(bindSelectAst(contract, expr.subquery, aliases));
    },
    nullCheck(expr) {
      return expr.isNull
        ? NullCheckExpr.isNull(bindExpression(contract, expr.expr, aliases))
        : NullCheckExpr.isNotNull(bindExpression(contract, expr.expr, aliases));
    },
    not(expr) {
      return new NotExpr(bindWhereExprInScope(contract, expr.expr, aliases));
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
  aliases: AliasesInScope,
): AnyExpression {
  if (comparable.kind === 'param-ref' || bindingColumn === undefined) {
    return comparable.kind === 'param-ref'
      ? comparable
      : comparable.kind === 'literal' || comparable.kind === 'list'
        ? comparable
        : bindExpression(contract, comparable, aliases);
  }

  if (comparable.kind === 'literal') {
    return paramRefForAlias(contract, bindingColumn, comparable.value, aliases);
  }

  if (comparable.kind === 'list') {
    return ListExpression.of(
      comparable.values.map((value) =>
        value.kind === 'literal'
          ? paramRefForAlias(contract, bindingColumn, value.value, aliases)
          : value,
      ),
    );
  }

  return bindExpression(contract, comparable, aliases);
}

function unknownColumn(alias: string, column: string): Error {
  return ormError('ORM.COLUMN_UNKNOWN', `Unknown column "${column}" in table "${alias}"`, {
    meta: { tableName: alias, column },
  });
}

function paramRefForAlias(
  contract: Contract<SqlStorage>,
  columnRef: ColumnRef,
  value: unknown,
  aliases: AliasesInScope,
): ParamRef {
  const coordinate = aliases.get(columnRef.table);
  if (coordinate === undefined) {
    throw unknownColumn(columnRef.table, columnRef.column);
  }
  return paramRefForTable(contract, coordinate, columnRef.table, columnRef.column, value);
}

function paramRefForTable(
  contract: Contract<SqlStorage>,
  coordinate: TableSourceCoordinate,
  alias: string,
  column: string,
  value: unknown,
): ParamRef {
  const resolved = resolveStorageTable(
    contract.storage,
    coordinate.tableName,
    coordinate.namespaceId,
  );
  if (resolved === undefined || !resolved.table.columns[column]) {
    throw unknownColumn(alias, column);
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
  aliases: AliasesInScope,
): AnyExpression {
  const binder: ExpressionRewriter = {
    select: (ast) => bindSelectAst(contract, ast, aliases),
  };
  return expr.rewrite(binder);
}

function bindProjectionExpr(
  contract: Contract<SqlStorage>,
  expr: ProjectionExpr,
  aliases: AliasesInScope,
): ProjectionExpr {
  return expr.kind === 'literal' ? expr : bindExpression(contract, expr, aliases);
}

function bindJoin(contract: Contract<SqlStorage>, join: JoinAst, aliases: AliasesInScope): JoinAst {
  return new JoinAst(
    join.joinType,
    bindFromSource(contract, join.source, aliases),
    join.on.kind === 'eq-col-join-on' ? join.on : bindWhereExprInScope(contract, join.on, aliases),
    join.lateral,
  );
}

function bindFromSource(
  contract: Contract<SqlStorage>,
  source: AnyFromSource,
  aliases: AliasesInScope,
): AnyFromSource {
  if (source.kind === 'derived-table-source') {
    return DerivedTableSource.as(source.alias, bindSelectAst(contract, source.query, aliases));
  }
  return source;
}

function aliasesWithSources(
  outer: AliasesInScope,
  sources: readonly AnyFromSource[],
): AliasesInScope {
  const aliases = new Map(outer);
  for (const source of sources) {
    if (source.kind === 'table-source') {
      aliases.set(source.alias ?? source.name, {
        namespaceId: source.namespaceId,
        tableName: source.name,
      });
    }
  }
  return aliases;
}

function bindSelectAst(
  contract: Contract<SqlStorage>,
  ast: SelectAst,
  outer: AliasesInScope,
): SelectAst {
  const aliases = aliasesWithSources(outer, [
    ...(ast.from !== undefined ? [ast.from] : []),
    ...(ast.joins ?? []).map((join) => join.source),
  ]);
  return new SelectAst({
    ...(ast.from !== undefined ? { from: bindFromSource(contract, ast.from, outer) } : {}),
    joins: ast.joins?.map((join) => bindJoin(contract, join, aliases)),
    projection: ast.projection.map(
      (projection) =>
        new ProjectionItem(
          projection.alias,
          bindProjectionExpr(contract, projection.expr, aliases),
          projection.codec,
        ),
    ),
    where: ast.where ? bindWhereExprInScope(contract, ast.where, aliases) : undefined,
    orderBy: ast.orderBy?.map((orderItem) =>
      orderItem.withExpr(bindExpression(contract, orderItem.expr, aliases)),
    ),
    distinct: ast.distinct,
    distinctOn: ast.distinctOn?.map((expr) => bindExpression(contract, expr, aliases)),
    groupBy: ast.groupBy?.map((expr) => bindExpression(contract, expr, aliases)),
    having: ast.having ? bindWhereExprInScope(contract, ast.having, aliases) : undefined,
    limit: ast.limit,
    offset: ast.offset,
    locking: ast.locking,
    selectAllIntent: ast.selectAllIntent,
  });
}
