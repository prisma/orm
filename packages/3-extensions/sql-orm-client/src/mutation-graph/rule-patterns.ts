import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SelectAst, TableSource } from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { resolveUniqueKeyColumnSets } from '../collection-contract';
import type { ColumnMapping, Edge } from './edge';
import { StateEdge } from './state';

export function stateEdgeOf(
  edges: readonly Edge<unknown>[],
  table: TableSource,
): StateEdge | undefined {
  return edges.find(
    (edge): edge is StateEdge =>
      edge instanceof StateEdge &&
      edge.table.tableName === table.name &&
      edge.table.namespaceId === table.namespaceId,
  );
}

export function conditionOnlyReadOf(ast: SelectAst): TableSource | undefined {
  const { from } = ast;
  const clauses = [
    ast.joins,
    ast.orderBy,
    ast.distinct,
    ast.distinctOn,
    ast.groupBy,
    ast.having,
    ast.limit,
    ast.offset,
    ast.locking,
  ];
  return from?.kind === 'table-source' &&
    clauses.every((clause) => clause === undefined) &&
    ast.projection.every((item) => item.expr.kind === 'column-ref')
    ? from
    : undefined;
}

export function sameTable(a: TableSource, b: TableSource): boolean {
  return a.name === b.name && a.namespaceId === b.namespaceId;
}

export function readsByKey(
  contract: Contract<SqlStorage>,
  table: TableSource,
  columns: readonly ColumnMapping[],
): boolean {
  const read = new Set(
    columns.flatMap(([source, target]) =>
      source.alias === target.alias &&
      source.expr.kind === 'column-ref' &&
      target.expr.kind === 'column-ref' &&
      source.expr.column === target.expr.column
        ? [target.expr.column]
        : [],
    ),
  );
  if (read.size !== columns.length) {
    return false;
  }
  const namespaceId = blindCast<
    string,
    'The ORM builds every table source with tableSourceForContract, which sets the namespace'
  >(table.namespaceId);
  return resolveUniqueKeyColumnSets(contract, namespaceId, table.name).some((key) =>
    key.every((column) => read.has(column)),
  );
}
