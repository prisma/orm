import type {
  AnyExpression,
  DeleteAst,
  InsertAst,
  LimitOffsetValue,
  SelectAst,
  UpdateAst,
} from '@internal/sql-relational-core/ast';
import { Delete } from '../../src/mutation-graph/delete';
import type { Edge, NodeId } from '../../src/mutation-graph/edge';
import { FilterData } from '../../src/mutation-graph/filter-data';
import { Find } from '../../src/mutation-graph/find';
import { FindByKeys } from '../../src/mutation-graph/find-by-keys';
import type { Graph } from '../../src/mutation-graph/graph';
import { Insert } from '../../src/mutation-graph/insert';
import { InsertChunked } from '../../src/mutation-graph/insert-chunked';
import { InsertReportingKeys } from '../../src/mutation-graph/insert-reporting-keys';
import type { Node } from '../../src/mutation-graph/node';
import { Rows } from '../../src/mutation-graph/rows';
import { Update } from '../../src/mutation-graph/update';
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

function printInsert(ast: InsertAst): string {
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
  return `${find} by (${keys}) for ${node.missing.operation}`;
}

function printInsertReportingKeys(node: InsertReportingKeys): string {
  const statements = node.asts.map(printInsert).join('; ');
  const generated = node.generated === undefined ? '' : `, generated ${node.generated.column}`;
  return `InsertReportingKeys ${statements} keys ${JSON.stringify(node.keys)}${generated}`;
}

function printNode(node: Node): string {
  if (node instanceof FindByKeys) {
    return printFindByKeys(node);
  }
  if (node instanceof InsertReportingKeys) {
    return printInsertReportingKeys(node);
  }
  if (node instanceof Find) {
    return printFind(node.ast);
  }
  if (node instanceof Update) {
    return printUpdate(node.ast);
  }
  if (node instanceof Insert) {
    return printInsert(node.ast);
  }
  if (node instanceof InsertChunked) {
    const count = node.asts.length;
    return `InsertChunked ${node.asts[0]?.table.name} (${count} ${count === 1 ? 'statement' : 'statements'})`;
  }
  return node instanceof Delete ? printDelete(node.ast) : node.constructor.name;
}

function printEdge(names: NodeNames, edge: Edge<unknown>): string {
  if (edge instanceof Rows) {
    return `Rows ${names.get(edge.from)}`;
  }
  const pairs = edge.columns.map(([source, target]) => `${source.alias}->${target.alias}`);
  const changed =
    edge instanceof FilterData && Object.keys(edge.changed).length > 0
      ? ` with ${JSON.stringify(edge.changed)}`
      : '';
  return `${edge.constructor.name} ${names.get(edge.from)} (${pairs.join(', ')})${changed}`;
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

export function printGraph(graph: Graph): string {
  const nodes = graph.nodes();
  const names: NodeNames = new Map(nodes.map(([id], index) => [id, `n${index + 1}`]));
  const lines = nodes.map(([id, node]) => {
    const inputs = Object.values(graph.inputsOf(id)).flat();
    return `${names.get(id)} ${printNode(node)}${printInputs(names, inputs)}`;
  });
  lines.push(printResult(names, graph));
  return lines.join('\n');
}
