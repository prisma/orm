import type { AnyExpression, LimitOffsetValue } from '@internal/sql-relational-core/ast';
import { InternalError } from '@internal/utils/internal-error';
import { After, type Edge, IntoWhere } from './edges';
import type { Graph } from './graph';
import { Delete, Find, type Node, type TableIdentity, Update } from './nodes';
import { printExpression, printValue } from './print-expression';

type NodeNames = ReadonlyMap<Node, string>;

function nameOf(names: NodeNames, node: Node): string {
  const name = names.get(node);
  if (name === undefined) {
    throw new InternalError('Cannot print a node that is not in the graph');
  }
  return name;
}

function printTable(table: TableIdentity): string {
  return table.variantName === undefined
    ? table.tableName
    : `${table.tableName} variant ${table.variantName}`;
}

function printWhere(table: TableIdentity, where: readonly AnyExpression[]): string {
  if (where.length === 0) {
    return '';
  }
  return ` where ${where.map((expr) => printExpression(expr, table.tableName)).join(' and ')}`;
}

function printAssignments(values: Readonly<Record<string, unknown>>): string {
  return Object.entries(values)
    .map(([column, value]) => `${column} = ${printValue(value)}`)
    .join(', ');
}

function printLimitOffset(value: LimitOffsetValue, tableName: string): string {
  return typeof value === 'number' ? String(value) : printExpression(value, tableName);
}

function printRead(find: Find): string {
  const { orderBy, limit, offset, cursor, distinct, distinctOn } = find.read;
  const tableName = find.table.tableName;
  const parts: string[] = [];
  if (orderBy !== undefined) {
    const items = orderBy.map((item) => {
      const nulls = item.nulls === undefined ? '' : ` nulls ${item.nulls}`;
      return `${printExpression(item.expr, tableName)} ${item.dir}${nulls}`;
    });
    parts.push(` order by ${items.join(', ')}`);
  }
  if (limit !== undefined) {
    parts.push(` limit ${printLimitOffset(limit, tableName)}`);
  }
  if (offset !== undefined) {
    parts.push(` offset ${printLimitOffset(offset, tableName)}`);
  }
  if (cursor !== undefined) {
    parts.push(` cursor (${printAssignments(cursor)})`);
  }
  if (distinct !== undefined) {
    parts.push(` distinct (${distinct.join(', ')})`);
  }
  if (distinctOn !== undefined) {
    parts.push(` distinct on (${distinctOn.join(', ')})`);
  }
  return parts.join('');
}

function printNode(node: Node): string {
  if (node instanceof Find) {
    return `Find ${printTable(node.table)}${printWhere(node.table, node.where)}${printRead(node)}`;
  }
  if (node instanceof Update) {
    const set = Object.keys(node.set).length === 0 ? 'nothing' : printAssignments(node.set);
    return `Update ${printTable(node.table)} set ${set}${printWhere(node.table, node.where)}`;
  }
  if (node instanceof Delete) {
    return `Delete ${printTable(node.table)}${printWhere(node.table, node.where)}`;
  }
  throw new InternalError(`Cannot print a node of class ${node.constructor.name}`);
}

function printEdge(names: NodeNames, edge: Edge): string {
  if (edge instanceof After) {
    return `After ${nameOf(names, edge.from)}`;
  }
  if (edge instanceof IntoWhere) {
    const pairs = edge.columns.map(([source, target]) => `${source}->${target}`);
    return `IntoWhere ${nameOf(names, edge.from)} (${pairs.join(', ')})`;
  }
  throw new InternalError(`Cannot print an edge of class ${edge.constructor.name}`);
}

function printInputs(names: NodeNames, inputs: readonly Edge[]): string {
  if (inputs.length === 0) {
    return '';
  }
  return ` <- ${inputs.map((edge) => printEdge(names, edge)).join(', ')}`;
}

function printResult(names: NodeNames, graph: Graph): string {
  const result = graph.result;
  if (result === undefined) {
    return 'result: not set';
  }
  if (result.node === undefined) {
    return 'result: none';
  }
  return `result: ${nameOf(names, result.node)} ${result.form}`;
}

export function printGraph(graph: Graph): string {
  const names: NodeNames = new Map(graph.nodes.map((node, index) => [node, `n${index + 1}`]));
  const lines = graph.nodes.map(
    (node) =>
      `${nameOf(names, node)} ${printNode(node)}${printInputs(names, graph.inputsOf(node))}`,
  );
  lines.push(printResult(names, graph));
  return lines.join('\n');
}
