import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { AnyExpression, TableSource } from '@internal/sql-relational-core/ast';
import type { Graph } from './graph';
import type { InputEdges, Slots } from './node';
import { conditionOnlyReadOf, keyEdgeFromFind, readsSameState, sameTable } from './rule-patterns';
import type { Rule } from './rules';
import { Update } from './update';

export function foldRule(contract: Contract<SqlStorage>): Rule {
  return (graph, node, inputs) => {
    if (
      !(node instanceof Update) ||
      !filteredByFindOfCondition(graph, contract, node.ast.table, node.ast.where, inputs)
    ) {
      return undefined;
    }
    return { node, inputs: { ...inputs, filter: [] }, standsFor: [] };
  };
}

function filteredByFindOfCondition(
  graph: Graph,
  contract: Contract<SqlStorage>,
  table: TableSource,
  where: AnyExpression | undefined,
  inputs: InputEdges<Slots>,
): boolean {
  const keyEdge = keyEdgeFromFind(graph, contract, table, inputs);
  if (keyEdge === undefined || keyEdge.find.ast.where !== where) {
    return false;
  }
  const read = conditionOnlyReadOf(keyEdge.find.ast);
  return (
    read !== undefined && sameTable(read, table) && readsSameState(graph, inputs, keyEdge.id, table)
  );
}
