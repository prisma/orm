import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { Delete } from './delete';
import { foldsIntoCondition, keyEdgeFromFind, readsTableAsFound } from './rule-patterns';
import type { Rule } from './rules';

export function deleteRule(contract: Contract<SqlStorage>): Rule {
  return (graph, node, inputs) => {
    if (!(node instanceof Delete)) {
      return undefined;
    }
    const { table, where } = node.ast;
    const read = keyEdgeFromFind(graph, contract, table, inputs);
    if (
      read === undefined ||
      graph.readersOf(read.id).length > 0 ||
      !readsTableAsFound(graph, inputs, read, table)
    ) {
      return undefined;
    }
    return {
      node: node.withReturning(read.find.returns),
      inputs: foldsIntoCondition(read, where) ? { ...inputs, filter: [] } : inputs,
      standsFor: [read.id],
    };
  };
}
