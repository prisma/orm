import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SelectAst, TableSource } from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { resolveUniqueKeyColumnSets } from '../collection-contract';
import type { ColumnMapping, Edge, NodeId } from './edge';
import { FilterData } from './filter-data';
import { Find } from './find';
import type { Graph } from './graph';
import type { InputEdges, Slots } from './node';
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

export interface KeyEdgeFromFind {
  readonly id: NodeId;
  readonly find: Find;
}

export function keyEdgeFromFind(
  graph: Graph,
  contract: Contract<SqlStorage>,
  table: TableSource,
  inputs: InputEdges<Slots>,
): KeyEdgeFromFind | undefined {
  const [edge, ...others] = [inputs['filter'] ?? []].flat();
  if (!(edge instanceof FilterData) || others.length > 0) {
    return undefined;
  }
  const find = graph.nodeAt(edge.from);
  return find instanceof Find && readsByKey(contract, table, edge.columns)
    ? { id: edge.from, find }
    : undefined;
}

export function readsSameState(
  graph: Graph,
  inputs: InputEdges<Slots>,
  find: NodeId,
  table: TableSource,
): boolean {
  const own = stateEdgeOf([inputs['state'] ?? []].flat(), table);
  const found = stateEdgeOf([graph.inputsOf(find)['state'] ?? []].flat(), table);
  return own !== undefined && own.from === found?.from;
}

export function oneTableReadOf(ast: SelectAst): TableSource | undefined {
  const { from } = ast;
  return from?.kind === 'table-source' &&
    ast.joins === undefined &&
    ast.projection.every((item) => item.expr.kind === 'column-ref')
    ? from
    : undefined;
}

export function conditionOnlyReadOf(ast: SelectAst): TableSource | undefined {
  const from = oneTableReadOf(ast);
  const clauses = [
    ast.orderBy,
    ast.distinct,
    ast.distinctOn,
    ast.groupBy,
    ast.having,
    ast.limit,
    ast.offset,
    ast.locking,
  ];
  return clauses.every((clause) => clause === undefined) ? from : undefined;
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
