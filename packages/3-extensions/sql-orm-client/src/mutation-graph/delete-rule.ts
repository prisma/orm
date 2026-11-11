import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { Delete } from './delete';
import type { NodeId } from './edge';
import { Find } from './find';
import type { Graph } from './graph';
import type { InputEdges, Slots } from './node';
import { keyEdgeFromFind, oneTableReadOf, readsSameState, sameTable } from './rule-patterns';
import type { Rule } from './rules';

export function deleteRule(contract: Contract<SqlStorage>): Rule {
  return (graph, node, inputs) => {
    if (!(node instanceof Delete)) {
      return undefined;
    }
    const { table } = node.ast;
    const read =
      keyEdgeFromFind(graph, contract, table, inputs) ?? findOfCondition(graph, node, inputs);
    if (read === undefined) {
      return undefined;
    }
    const readTable = oneTableReadOf(read.find.ast);
    if (
      readTable === undefined ||
      !sameTable(readTable, table) ||
      graph.readersOf(read.id).length > 0 ||
      !readsSameState(graph, inputs, read.id, table)
    ) {
      return undefined;
    }
    const id = graph.add(node.withReturning(read.find.returns), inputs);
    graph.forward(read.id, id);
    return id;
  };
}

function findOfCondition(
  graph: Graph,
  node: Delete,
  inputs: InputEdges<Slots>,
): { readonly id: NodeId; readonly find: Find } | undefined {
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
