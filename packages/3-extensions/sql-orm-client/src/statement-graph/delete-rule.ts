import type { AnyExpression, TableSource } from '@internal/sql-relational-core/ast';
import { Delete } from './delete';
import { Find } from './find';
import type { Graph } from './graph';
import type { InputEdges, Slots } from './node';
import { type FindAt, foldsIntoCondition, readsTableAsFound, stateEdgeOf } from './rule-patterns';
import type { Rule } from './rules';

/**
 * `deleteAll()` returning rows reads the rows before deleting them, because on a database without `RETURNING` they cannot be read afterwards.
 *
 * With `RETURNING` the delete reports the rows it removed, so it takes the place of that read and the call is a single statement.
 */
export const deleteRule: Rule = (graph, node, inputs) => {
  if (
    !(node instanceof Delete) ||
    node.returns.length > 0 ||
    [inputs['filter'] ?? [], inputs['link'] ?? []].flat().length > 0
  ) {
    return undefined;
  }
  const { table, where } = node.ast;
  const read = findOfSameCondition(graph, inputs, table, where);
  if (
    read === undefined ||
    graph.readersOf(read.id).length > 0 ||
    !readsTableAsFound(graph, inputs, read, table)
  ) {
    return undefined;
  }
  return { node: node.withReturning(read.find.returns), inputs, standsFor: read.id };
};

function findOfSameCondition(
  graph: Graph,
  inputs: InputEdges<Slots>,
  table: TableSource,
  where: AnyExpression | undefined,
): FindAt | undefined {
  const state = stateEdgeOf([inputs['state'] ?? []].flat(), table);
  if (state === undefined) {
    return undefined;
  }
  return graph
    .readersOf(state.from)
    .flatMap(({ reader }): FindAt[] => {
      const find = graph.nodeAt(reader);
      return find instanceof Find && foldsIntoCondition(graph, { id: reader, find }, where)
        ? [{ id: reader, find }]
        : [];
    })
    .at(-1);
}
