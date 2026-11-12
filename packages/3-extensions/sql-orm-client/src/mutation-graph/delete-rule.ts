import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { AnyExpression, TableSource } from '@internal/sql-relational-core/ast';
import { Delete } from './delete';
import { Find } from './find';
import type { Graph } from './graph';
import type { InputEdges, Slots } from './node';
import {
  type FindAt,
  foldsIntoCondition,
  keyEdgeFromFind,
  readsTableAsFound,
  stateEdgeOf,
} from './rule-patterns';
import type { Rule } from './rules';

export function deleteRule(contract: Contract<SqlStorage>): Rule {
  return (graph, node, inputs) => {
    if (!(node instanceof Delete) || node.returns.length > 0) {
      return undefined;
    }
    const { table, where } = node.ast;
    const read =
      keyEdgeFromFind(graph, contract, table, inputs) ??
      findOfSameCondition(graph, inputs, table, where);
    if (
      read === undefined ||
      graph.readersOf(read.id).length > 0 ||
      !readsTableAsFound(graph, inputs, read, table)
    ) {
      return undefined;
    }
    return { node: node.withReturning(read.find.returns), inputs, standsFor: [read.id] };
  };
}

function findOfSameCondition(
  graph: Graph,
  inputs: InputEdges<Slots>,
  table: TableSource,
  where: AnyExpression | undefined,
): FindAt | undefined {
  const state = stateEdgeOf([inputs['state'] ?? []].flat(), table);
  if (state === undefined || [inputs['filter'] ?? []].flat().length > 0) {
    return undefined;
  }
  return graph
    .readersOf(state.from)
    .flatMap(({ reader }): FindAt[] => {
      const find = graph.nodeAt(reader);
      return find instanceof Find && foldsIntoCondition({ id: reader, find }, where)
        ? [{ id: reader, find }]
        : [];
    })
    .at(-1);
}
