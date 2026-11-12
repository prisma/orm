import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { Delete } from './delete';
import { foldsIntoCondition, keyEdgeFromFind, readsTableAsFound } from './rule-patterns';
import type { Rule } from './rules';
import { Update } from './update';

/**
 * Looks for an `Update` or `Delete` filtered by key from a `Find` that selects rows by the same condition as the write, with no other write to the table between them.
 *
 * Drops the key filter, so the write runs on its condition alone and the `Find` is no longer needed: `updateAll()` becomes one `UPDATE … RETURNING`.
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
