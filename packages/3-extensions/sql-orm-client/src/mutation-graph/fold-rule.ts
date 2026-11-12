import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { Delete } from './delete';
import { foldsIntoCondition, keyEdgeFromFind, readsTableAsFound } from './rule-patterns';
import type { Rule } from './rules';
import { Update } from './update';

/**
 * `updateAll()` and `deleteAll()` returning rows first find the rows matching the caller's condition and then limit the write to their keys, so that on a database without `RETURNING` the write changes exactly the rows the call reports.
 *
 * With `RETURNING` the write reports the rows it changed itself, so the keys are not needed: the write runs on the caller's condition alone.
 */
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
    return { node, inputs: { ...inputs, filter: [] }, standsFor: undefined };
  };
}
