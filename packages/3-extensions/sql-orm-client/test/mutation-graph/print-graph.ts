import type {
  AnyExpression,
  DeleteAst,
  LimitOffsetValue,
  SelectAst,
  UpdateAst,
} from '@internal/sql-relational-core/ast';
import { After } from '../../src/mutation-graph/after';
import type { Edge, NodeId } from '../../src/mutation-graph/edge';
import type { Graph } from '../../src/mutation-graph/graph';
import type { StatementAst } from '../../src/mutation-graph/node';
import { printExpression } from './print-expression';

type NodeNames = ReadonlyMap<NodeId, string>;

function printWhere(where: AnyExpression | undefined, tableName: string): string {
  if (where === undefined) {
    return '';
  }
  const parts = where.kind === 'and' && where.exprs.length > 0 ? where.exprs : [where];
  return ` where ${parts.map((expr) => printExpression(expr, tableName)).join(' and ')}`;
}

function printLimitOffset(value: LimitOffsetValue, tableName: string): string {
  return typeof value === 'number' ? String(value) : printExpression(value, tableName);
}

function sourceName(ast: SelectAst): string {
  const source = ast.from;
  return source?.kind === 'table-source' ? source.name : (source?.alias ?? '');
}

function printFind(ast: SelectAst): string {
  const tableName = sourceName(ast);
  const parts = [`Find ${tableName}${printWhere(ast.where, tableName)}`];
  if (ast.orderBy !== undefined) {
    const items = ast.orderBy.map((item) => {
      const nulls = item.nulls === undefined ? '' : ` nulls ${item.nulls}`;
      return `${printExpression(item.expr, tableName)} ${item.dir}${nulls}`;
    });
    parts.push(`order by ${items.join(', ')}`);
  }
  if (ast.limit !== undefined) {
    parts.push(`limit ${printLimitOffset(ast.limit, tableName)}`);
  }
  if (ast.offset !== undefined) {
    parts.push(`offset ${printLimitOffset(ast.offset, tableName)}`);
  }
  if (ast.distinctOn !== undefined) {
    const columns = ast.distinctOn.map((expr) => printExpression(expr, tableName));
    parts.push(`distinct on (${columns.join(', ')})`);
  }
  return parts.join(' ');
}

function printUpdate(ast: UpdateAst): string {
  const tableName = ast.table.name;
  const assignments = Object.entries(ast.set).map(
    ([column, value]) => `${column} = ${printExpression(value, tableName)}`,
  );
  const set = assignments.length === 0 ? 'nothing' : assignments.join(', ');
  return `Update ${tableName} set ${set}${printWhere(ast.where, tableName)}`;
}

function printDelete(ast: DeleteAst): string {
  return `Delete ${ast.table.name}${printWhere(ast.where, ast.table.name)}`;
}

function printStatement(ast: StatementAst): string {
  if (ast.kind === 'select') {
    return printFind(ast);
  }
  if (ast.kind === 'update') {
    return printUpdate(ast);
  }
  return printDelete(ast);
}

function printEdge(names: NodeNames, edge: Edge<unknown> | After): string {
  if (edge instanceof After) {
    return `After ${names.get(edge.from)}`;
  }
  const pairs = edge.columns.map(([source, target]) => `${source.alias}->${target.alias}`);
  return `${edge.constructor.name} ${names.get(edge.from)} (${pairs.join(', ')})`;
}

function printInputs(names: NodeNames, inputs: readonly (Edge<unknown> | After)[]): string {
  if (inputs.length === 0) {
    return '';
  }
  return ` <- ${inputs.map((edge) => printEdge(names, edge)).join(', ')}`;
}

function printResult(names: NodeNames, graph: Graph): string {
  const { node, form } = graph.result;
  const name = node === undefined ? undefined : names.get(node);
  return name === undefined ? 'result: none' : `result: ${name} ${form}`;
}

export function printGraph(graph: Graph): string {
  const nodes = graph.nodes();
  const names: NodeNames = new Map(nodes.map(([id], index) => [id, `n${index + 1}`]));
  const lines = nodes.map(
    ([id, node]) =>
      `${names.get(id)} ${printStatement(node.ast)}${printInputs(names, graph.edgesInto(id))}`,
  );
  lines.push(printResult(names, graph));
  return lines.join('\n');
}
