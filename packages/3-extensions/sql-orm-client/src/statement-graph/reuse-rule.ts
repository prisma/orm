import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { FilterData } from './filter-data';
import { Find } from './find';
import {
  conditionOnlyReadOf,
  readsByKey,
  readsTableAsFound,
  rowsOfTableReadOf,
} from './rule-patterns';
import type { Rule } from './rules';

/**
 * An `update()` that sets none of the record's own fields reads the record back after its nested writes, because a nested write can change the record's table.
 *
 * When no statement between the two writes that table, the `Find` of the record already reads the row the read-back would read, so it selects the read-back's columns and the read-back is not sent. This needs no `RETURNING`, so it applies on every database.
 */
export function reuseRule(contract: Contract<SqlStorage>): Rule {
  return (graph, node, inputs) => {
    if (!(node instanceof Find)) {
      return undefined;
    }
    const table = node.ast.where === undefined ? conditionOnlyReadOf(node.ast) : undefined;
    const { state, ...data } = inputs;
    const [edge, ...others] = Object.values(data).flatMap((slot) => [slot ?? []].flat());
    if (
      table === undefined ||
      others.length > 0 ||
      !(edge instanceof FilterData) ||
      !readsByKey(contract, table, edge.columns)
    ) {
      return undefined;
    }
    const source = graph.nodeAt(edge.from);
    if (
      !(source instanceof Find) ||
      rowsOfTableReadOf(source.ast) === undefined ||
      !readsTableAsFound(graph, inputs, { id: edge.from, find: source }, table)
    ) {
      return undefined;
    }
    graph.replace(edge.from, source.withReturning(node.returns));
    return edge.from;
  };
}
