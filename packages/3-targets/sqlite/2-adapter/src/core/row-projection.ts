import {
  type AnyExpression,
  type AnyFromSource,
  ColumnRef,
  type ExpressionRewriter,
  type OrderByItem,
  type ProjectionExpr,
  ProjectionItem,
  type SelectAst,
} from '@internal/sql-relational-core/ast';
import type { SqliteCodecDescriptorRegistry } from '@internal/target-sqlite/codec-descriptor';
import type { SqliteContract } from './types';

export function rowProjection(
  item: ProjectionItem,
  expression: ProjectionExpr,
  codecs: SqliteCodecDescriptorRegistry,
): ProjectionExpr {
  if (item.codec === undefined) return expression;
  return codecs.descriptorFor(item.codec.codecId)?.projectRow?.(expression) ?? expression;
}

export function withRowProjections(
  ast: SelectAst,
  contract: SqliteContract | undefined,
  codecs: SqliteCodecDescriptorRegistry,
): SelectAst {
  const projected = new Map<ProjectionItem, ProjectionExpr>();
  for (const item of ast.projection) {
    const expression = rowProjection(item, item.expr, codecs);
    if (expression !== item.expr) projected.set(item, expression);
  }
  if (projected.size === 0) return ast;

  const orderBy = ast.orderBy ?? [];
  const namesExpressionsRead = identifierNamesIn([
    ast.where,
    ast.having,
    ...(ast.groupBy ?? []),
    ...(ast.distinctOn ?? []),
    ...orderBy.map((order) => order.expr).filter((expr) => expr.kind !== 'identifier-ref'),
    ...(ast.joins ?? []).map((join) => (join.on.kind === 'eq-col-join-on' ? undefined : join.on)),
    typeof ast.limit === 'object' ? ast.limit : undefined,
    typeof ast.offset === 'object' ? ast.offset : undefined,
  ]);
  for (const item of [...projected.keys()]) {
    if (namesExpressionsRead.has(item.alias.toLowerCase()) && !repeatsItsColumnName(item)) {
      projected.delete(item);
    }
  }

  const orderedItem = (order: OrderByItem): ProjectionItem | undefined => {
    if (order.expr.kind !== 'identifier-ref') return undefined;
    const name = order.expr.name.toLowerCase();
    return ast.projection.find((item) => item.alias.toLowerCase() === name);
  };
  const orderExpressions = new Map<ProjectionItem, AnyExpression>();
  for (const order of orderBy) {
    const item = orderedItem(order);
    if (item === undefined || !projected.has(item)) continue;
    const expression =
      item.expr.kind === 'identifier-ref'
        ? columnOfItsSource(item.expr.name, ast, contract)
        : item.expr;
    if (expression === undefined) {
      projected.delete(item);
    } else {
      orderExpressions.set(item, expression);
    }
  }

  return ast
    .withProjection(
      ast.projection.map((item) => {
        const expression = projected.get(item);
        return expression === undefined
          ? item
          : ProjectionItem.of(item.alias, expression, item.codec);
      }),
    )
    .withOrderBy(
      orderBy.map((order) => {
        const item = orderedItem(order);
        const expression = item === undefined ? undefined : orderExpressions.get(item);
        return expression === undefined ? order : order.withExpr(expression);
      }),
    );
}

function repeatsItsColumnName(item: ProjectionItem): boolean {
  return (
    item.expr.kind === 'identifier-ref' && item.expr.name.toLowerCase() === item.alias.toLowerCase()
  );
}

function identifierNamesIn(
  expressions: ReadonlyArray<AnyExpression | undefined>,
): ReadonlySet<string> {
  const names = new Set<string>();
  const collector: ExpressionRewriter = {
    identifierRef: (ref) => {
      names.add(ref.name.toLowerCase());
      return ref;
    },
  };
  for (const expression of expressions) {
    expression?.rewrite(collector);
  }
  return names;
}

function columnOfItsSource(
  column: string,
  ast: SelectAst,
  contract: SqliteContract | undefined,
): ColumnRef | undefined {
  const sources = [ast.from, ...(ast.joins ?? []).map((join) => join.source)].filter(
    (source) => source !== undefined,
  );
  const [only] = sources;
  if (sources.length === 1 && only !== undefined) {
    const name = nameOf(only);
    return name === undefined ? undefined : ColumnRef.of(name, column);
  }
  const owners = sources.filter((source) => sourceHasColumn(source, column, contract));
  const [owner] = owners;
  if (owners.length !== 1 || owner === undefined) return undefined;
  if (sources.some((source) => source.kind === 'function-source')) return undefined;
  const name = nameOf(owner);
  return name === undefined ? undefined : ColumnRef.of(name, column);
}

function nameOf(source: AnyFromSource): string | undefined {
  switch (source.kind) {
    case 'table-source':
      return source.alias ?? source.name;
    case 'derived-table-source':
      return source.alias;
    case 'function-source':
      return undefined;
  }
}

function sourceHasColumn(
  source: AnyFromSource,
  column: string,
  contract: SqliteContract | undefined,
): boolean {
  switch (source.kind) {
    case 'table-source': {
      if (contract === undefined) return false;
      const namespaces =
        source.namespaceId === undefined
          ? Object.values(contract.storage.namespaces)
          : [contract.storage.namespaces[source.namespaceId]];
      return namespaces.some(
        (namespace) => namespace?.entries.table?.[source.name]?.columns[column] !== undefined,
      );
    }
    case 'derived-table-source':
      return source.query.projection.some((item) => item.alias === column);
    case 'function-source':
      return false;
  }
}
