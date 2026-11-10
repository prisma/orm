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

interface Folded {
  readonly where: AnyExpression | undefined;
}

export function foldRule(contract: Contract<SqlStorage>): Rule {
  return (graph, node, inputs) => {
    if (!(node instanceof Update) || node.ast.where !== undefined) {
      return undefined;
    }
    const folded = foldedFind(graph, contract, node.ast.table, inputs);
    if (folded === undefined) {
      return undefined;
    }
    return graph.add(new Update(node.ast.withWhere(folded.where), node.owner), {
      ...inputs,
      filter: [],
    });
  };
}

function foldedFind(
  graph: Graph,
  contract: Contract<SqlStorage>,
  table: TableSource,
  inputs: InputEdges<Slots>,
): Folded | undefined {
  const [edge, ...others] = [inputs['filter'] ?? []].flat();
  if (!(edge instanceof FilterData) || others.length > 0) {
    return undefined;
  }
  const find = graph.nodeAt(edge.from);
  if (!(find instanceof Find)) {
    return undefined;
  }
  const read = conditionOnlyReadOf(find.ast);
  if (read === undefined || !sameTable(read, table) || !readsByKey(contract, table, edge.columns)) {
    return undefined;
  }
  const own = stateEdgeOf([inputs['state'] ?? []].flat(), table);
  const found = stateEdgeOf([graph.inputsOf(edge.from)['state'] ?? []].flat(), table);
  if (own === undefined || found === undefined || own.from !== found.from) {
    return undefined;
  }
  return { where: find.ast.where };
}
