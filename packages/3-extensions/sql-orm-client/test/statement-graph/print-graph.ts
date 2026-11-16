import type {
  AnyExpression,
  DeleteAst,
  LimitOffsetValue,
  SelectAst,
  UpdateAst,
} from '@internal/sql-relational-core/ast';
import { Delete } from '../../src/statement-graph/delete';
import {
  type ColumnMapping,
  DataEdge,
  type Edge,
  type NodeId,
} from '../../src/statement-graph/edge';
import { Find } from '../../src/statement-graph/find';
import { FindByKeys } from '../../src/statement-graph/find-by-keys';
import type { Graph } from '../../src/statement-graph/graph';
import { Insert } from '../../src/statement-graph/insert';
import { JunctionFilterData } from '../../src/statement-graph/junction-filter-data';
import type { Node } from '../../src/statement-graph/node';
import { Requires } from '../../src/statement-graph/requires';
import { Rows } from '../../src/statement-graph/rows';
import { State, StateEdge } from '../../src/statement-graph/state';
import { Update } from '../../src/statement-graph/update';
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

function printInsert({ asts }: Insert): string {
  const [ast, ...others] = asts;
  if (ast === undefined) {
    return 'Insert nothing';
  }
  if (others.length > 0) {
    return `Insert ${ast.table.name} (${asts.length} statements)`;
  }
  const rows = ast.rows.length === 1 ? '' : ` ${ast.rows.length} rows`;
  const conflict = ast.onConflict;
  if (conflict === undefined) {
    return `Insert ${ast.table.name}${rows}`;
  }
  const columns =
    conflict.columns.length === 0
      ? ''
      : ` (${conflict.columns.map((column) => column.column).join(', ')})`;
  const action = conflict.action.kind === 'do-nothing' ? 'do nothing' : 'do update';
  return `Insert ${ast.table.name}${rows} on conflict${columns} ${action}`;
}

function printFindByKeys(node: FindByKeys): string {
  const keys = node.keyColumns.map(([, target]) => target.alias).join(', ');
  const find = printFind(node.ast).replace('Find', 'FindByKeys');
  return `${find} by (${keys}) for ${node.owner.operation}`;
}

function printNode(node: Node): string {
  if (node instanceof FindByKeys) {
    return printFindByKeys(node);
  }
  if (node instanceof Find) {
    return printFind(node.ast);
  }
  if (node instanceof Update) {
    return printUpdate(node.ast);
  }
  if (node instanceof Insert) {
    return printInsert(node);
  }
  if (node instanceof State) {
    return `State ${node.table.tableName}`;
  }
  return node instanceof Delete ? printDelete(node.ast) : node.constructor.name;
}

function printMappings(columns: readonly ColumnMapping[]): string {
  return columns.map(([source, target]) => `${source.alias}->${target.alias}`).join(', ');
}

function printEdge(names: NodeNames, edge: Edge<unknown>): string {
  if (edge instanceof Rows) {
    return `Rows ${names.get(edge.from)}`;
  }
  if (edge instanceof Requires) {
    return `Requires ${names.get(edge.from)}`;
  }
  if (!(edge instanceof DataEdge)) {
    return `state ${names.get(edge.from)}`;
  }
  const through =
    edge instanceof JunctionFilterData
      ? `; ${edge.junction.name} ${printMappings(edge.targets)}`
      : '';
  return `${edge.constructor.name} ${names.get(edge.from)} (${printMappings(edge.columns)}${through})`;
}

function printInputs(names: NodeNames, inputs: readonly Edge<unknown>[]): string {
  if (inputs.length === 0) {
    return '';
  }
  return ` <- ${inputs.map((edge) => printEdge(names, edge)).join(', ')}`;
}

function printResult(names: NodeNames, graph: Graph): string {
  const name = graph.result === undefined ? undefined : names.get(graph.result);
  return `result: ${name ?? 'none'}`;
}

export interface PrintOptions {
  readonly state: boolean;
}

export function printGraph(graph: Graph, options: PrintOptions = { state: false }): string {
  const nodes = graph.entries().filter(({ node }) => options.state || !(node instanceof State));
  const names: NodeNames = new Map(nodes.map(({ id }, index) => [id, `n${index + 1}`]));
  const lines = nodes.map(({ id, node, inputs: slots }) => {
    const inputs = Object.keys(node.slots)
      .flatMap((name) => [slots[name] ?? []].flat())
      .filter((edge) => options.state || !(edge instanceof StateEdge));
    return `${names.get(id)} ${printNode(node)}${printInputs(names, inputs)}`;
  });
  lines.push(printResult(names, graph));
  return lines.join('\n');
}
