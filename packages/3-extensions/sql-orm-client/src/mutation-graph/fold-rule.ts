import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { conditionOnlyReadOf, keyEdgeFromFind, readsTableAsFound } from './rule-patterns';
import type { Rule } from './rules';
import { Update } from './update';

export function foldRule(contract: Contract<SqlStorage>): Rule {
  return (graph, node, inputs) => {
    if (!(node instanceof Update)) {
      return undefined;
    }
    const { table, where } = node.ast;
    const read = keyEdgeFromFind(graph, contract, table, inputs);
    if (
      read === undefined ||
      read.find.ast.where !== where ||
      !readsTableAsFound(graph, inputs, read, table, conditionOnlyReadOf)
    ) {
      return undefined;
    }
    return { node, inputs: { ...inputs, filter: [] }, standsFor: [] };
  };
}
