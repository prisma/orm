import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { Delete } from './delete';
import { foldsIntoCondition, keyEdgeFromFind, readsTableAsFound } from './rule-patterns';
import type { Rule } from './rules';
import { Update } from './update';

export function foldRule(contract: Contract<SqlStorage>): Rule {
  return (graph, node, inputs) => {
    if (!(node instanceof Update || node instanceof Delete)) {
      return undefined;
    }
    const { table, where } = node.ast;
    const read = keyEdgeFromFind(graph, contract, table, inputs);
    if (
      read === undefined ||
      !foldsIntoCondition(read, where) ||
      !readsTableAsFound(graph, inputs, read, table)
    ) {
      return undefined;
    }
    return { node, inputs: { ...inputs, filter: [] }, standsFor: [] };
  };
}
