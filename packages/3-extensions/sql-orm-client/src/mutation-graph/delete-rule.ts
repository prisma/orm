import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { Delete } from './delete';
import { Find } from './find';
import type { Graph } from './graph';
import type { InputEdges, Slots } from './node';
import { type FindAt, keyEdgeFromFind, oneTableReadOf, readsTableAsFound } from './rule-patterns';
import type { Rule } from './rules';

export function deleteRule(contract: Contract<SqlStorage>): Rule {
  return (graph, node, inputs) => {
    if (!(node instanceof Delete)) {
      return undefined;
    }
    const { table } = node.ast;
    const read =
      keyEdgeFromFind(graph, contract, table, inputs) ?? findOfCondition(graph, node, inputs);
    if (
      read === undefined ||
      graph.readersOf(read.id).length > 0 ||
      !readsTableAsFound(graph, inputs, read, table, oneTableReadOf)
    ) {
      return undefined;
    }
    return { node: node.withReturning(read.find.returns), inputs, standsFor: [read.id] };
  };
}

function findOfCondition(
  graph: Graph,
  node: Delete,
  inputs: InputEdges<Slots>,
): FindAt | undefined {
  const { where } = node.ast;
  if (where === undefined || [inputs['filter'] ?? []].flat().length > 0) {
    return undefined;
  }
  const found = [...graph.nodes()]
    .reverse()
    .find(([, other]) => other instanceof Find && other.ast.where === where);
  const [id, find] = found ?? [];
  return id !== undefined && find instanceof Find ? { id, find } : undefined;
}
