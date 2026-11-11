import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { TableSource } from '@internal/sql-relational-core/ast';
import { Delete } from './delete';
import type { Edge, NodeId } from './edge';
import { FilterData } from './filter-data';
import { Find } from './find';
import { FindByKeys } from './find-by-keys';
import type { Graph } from './graph';
import { Insert } from './insert';
import { InsertChunked } from './insert-chunked';
import type { Node } from './node';
import { Rows } from './rows';
import { conditionOnlyReadOf, readsByKey, sameTable, stateEdgeOf } from './rule-patterns';
import type { Rule } from './rules';
import { Update } from './update';

type Write = Insert | InsertChunked | Update | Delete;

export function readBackRule(contract: Contract<SqlStorage>): Rule {
  return (graph, node, inputs) => {
    if (!(node instanceof Find || node instanceof FindByKeys)) {
      return undefined;
    }
    const table = node.ast.where === undefined ? conditionOnlyReadOf(node.ast) : undefined;
    const { state, ...data } = inputs;
    const [edge, ...others] = Object.values(data).flatMap((slot) => [slot ?? []].flat());
    if (
      table === undefined ||
      others.length > 0 ||
      !(edge instanceof FilterData || edge instanceof Rows) ||
      !readsStateWrittenBy(graph, [state ?? []].flat(), table, edge.from)
    ) {
      return undefined;
    }
    const write = graph.nodeAt(edge.from);
    if (!isWriteTo(write, table) || !readsByKey(contract, table, edge.columns)) {
      return undefined;
    }
    graph.replace(edge.from, write.withReturning(node.returns));
    return edge.from;
  };
}

function readsStateWrittenBy(
  graph: Graph,
  state: readonly Edge<unknown>[],
  table: TableSource,
  write: NodeId,
): boolean {
  const read = stateEdgeOf(state, table);
  return (
    read !== undefined &&
    [graph.inputsOf(read.from)['write'] ?? []].flat().some((edge) => edge.from === write)
  );
}

function isWriteTo(node: Node | undefined, table: TableSource): node is Write {
  return (
    (node instanceof Insert ||
      node instanceof InsertChunked ||
      node instanceof Update ||
      node instanceof Delete) &&
    node.statements.every((ast) => ast.kind !== 'select' && sameTable(ast.table, table))
  );
}
