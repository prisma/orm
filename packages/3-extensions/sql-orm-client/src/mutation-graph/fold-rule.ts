import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { AnyExpression, TableSource } from '@internal/sql-relational-core/ast';
import { FilterData } from './filter-data';
import { Find } from './find';
import type { Graph } from './graph';
import type { InputEdges, Slots } from './node';
import { conditionOnlyReadOf, readsByKey, sameTable, stateEdgeOf } from './rule-patterns';
import type { Rule } from './rules';
import { Update } from './update';

export function foldRule(contract: Contract<SqlStorage>): Rule {
  return (graph, node, inputs) => {
    if (
      !(node instanceof Update) ||
      !filteredByFindOfCondition(graph, contract, node.ast.table, node.ast.where, inputs)
    ) {
      return undefined;
    }
    return graph.add(node, { ...inputs, filter: [] });
  };
}

function filteredByFindOfCondition(
  graph: Graph,
  contract: Contract<SqlStorage>,
  table: TableSource,
  where: AnyExpression | undefined,
  inputs: InputEdges<Slots>,
): boolean {
  const [edge, ...others] = [inputs['filter'] ?? []].flat();
  if (!(edge instanceof FilterData) || others.length > 0) {
    return false;
  }
  const find = graph.nodeAt(edge.from);
  if (!(find instanceof Find) || find.ast.where !== where) {
    return false;
  }
  const read = conditionOnlyReadOf(find.ast);
  if (read === undefined || !sameTable(read, table) || !readsByKey(contract, table, edge.columns)) {
    return false;
  }
  const own = stateEdgeOf([inputs['state'] ?? []].flat(), table);
  const found = stateEdgeOf([graph.inputsOf(edge.from)['state'] ?? []].flat(), table);
  if (own === undefined || found === undefined || own.from !== found.from) {
    return false;
  }
  return true;
}
