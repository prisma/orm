import type { Contract } from '@internal/contract/types';
import {
  type AnnotationValue,
  AsyncIterableResult,
  type OperationKind,
} from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  ListExpression,
  OrExpr,
  ParamRef,
} from '@internal/sql-relational-core/ast';
import { codecRefForStorageColumn } from '@internal/sql-relational-core/codec-descriptor-registry';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import type { RuntimeScope } from '@internal/sql-relational-core/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { dispatchCollectionRows } from '../collection-dispatch';
import { dispatchMutationRows, mutationReturningColumns } from '../collection-mutation-dispatch';
import { withMutationScope } from '../mutation-executor';
import { mergeAnnotations } from '../query-plan-meta';
import {
  compileDeleteCount,
  compileDeleteReturning,
  compileUpdateCount,
  compileUpdateReturning,
} from '../query-plan-mutations';
import { queryPlanRows } from '../query-plan-rows';
import { compileSelect } from '../query-plan-select';
import { type CollectionState, emptyState, type RuntimeQueryable } from '../types';
import { type ColumnPair, IntoWhere } from './edges';
import type { Graph, GraphResult, ResultForm } from './graph';
import { Delete, Find, type Node, type TableIdentity, Update } from './nodes';

export interface RunOptions {
  readonly context: ExecutionContext<Contract<SqlStorage>>;
  readonly runtime: RuntimeQueryable;
  readonly annotations: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> | undefined;
}

type StorageRow = Record<string, unknown>;
type Plan = SqlQueryPlan<StorageRow>;
type KnownNode = Find | Update | Delete;

interface Outcome<Row> {
  readonly rows: readonly Row[];
  readonly count: number;
}

export function runForRows<Row>(graph: Graph, options: RunOptions): AsyncIterableResult<Row> {
  const result = resultOfForm(graph, 'rows');
  const [onlyNode] = graph.nodes;
  if (graph.nodes.length === 1 && onlyNode !== undefined && onlyNode === result.node) {
    return resultRows<Row>(knownNode(onlyNode), [], result, options.runtime, options);
  }
  const generator = async function* (): AsyncGenerator<Row, void, unknown> {
    const outcome = await runAllNodes<Row>(graph, result, options);
    yield* outcome.rows;
  };
  return new AsyncIterableResult(generator());
}

export async function runForFirstRow<Row>(graph: Graph, options: RunOptions): Promise<Row | null> {
  const result = resultOfForm(graph, 'first row');
  const outcome = await runAllNodes<Row>(graph, result, options);
  return outcome.rows[0] ?? null;
}

export async function runForCount(graph: Graph, options: RunOptions): Promise<number> {
  const result = resultOfForm(graph, 'count');
  const outcome = await runAllNodes(graph, result, options);
  return outcome.count;
}

function resultOfForm(graph: Graph, form: ResultForm): GraphResult {
  const result = graph.result;
  if (result === undefined) {
    throw new InternalError('Cannot run a graph that has no result');
  }
  if (result.form !== form) {
    throw new InternalError(`The graph's result is ${result.form}, not ${form}`);
  }
  return result;
}

function runAllNodes<Row>(
  graph: Graph,
  result: GraphResult,
  options: RunOptions,
): Promise<Outcome<Row>> {
  if (graph.nodes.length > 1) {
    return withMutationScope(options.runtime, (scope) =>
      runNodesInOrder<Row>(graph, result, scope, options),
    );
  }
  return runNodesInOrder<Row>(graph, result, options.runtime, options);
}

async function runNodesInOrder<Row>(
  graph: Graph,
  result: GraphResult,
  scope: RuntimeScope,
  options: RunOptions,
): Promise<Outcome<Row>> {
  const collected = new Map<Node, readonly StorageRow[]>();
  let rows: readonly Row[] = [];
  let count = 0;

  for (const node of graph.nodes.map(knownNode)) {
    const edgeWhere = whereFromSources(graph, node, collected, options);
    if (edgeWhere === undefined) {
      collected.set(node, []);
      continue;
    }

    if (node === result.node && result.form !== 'count') {
      rows = await resultRows<Row>(node, edgeWhere, result, scope, options).toArray();
      continue;
    }
    if (node === result.node) {
      const stats = await scope.execute(countPlan(node, edgeWhere, options));
      count = stats.affectedRows;
      continue;
    }

    const columns = columnsReadFrom(graph, node);
    if (node instanceof Find || columns.length > 0) {
      const plan = rowsPlan(node, edgeWhere, columns, options);
      collected.set(node, await queryPlanRows(scope, plan).toArray());
      continue;
    }
    await scope.execute(countPlan(node, edgeWhere, options));
  }

  return { rows, count };
}

function knownNode(node: Node): KnownNode {
  if (node instanceof Find || node instanceof Update || node instanceof Delete) {
    return node;
  }
  throw new InternalError(`Cannot run a node of class ${node.constructor.name}`);
}

function columnsReadFrom(graph: Graph, node: Node): readonly string[] {
  const columns = new Set<string>();
  for (const edge of graph.usersOf(node)) {
    if (edge instanceof IntoWhere) {
      for (const [sourceColumn] of edge.columns) {
        columns.add(sourceColumn);
      }
    }
  }
  return [...columns];
}

function whereFromSources(
  graph: Graph,
  node: KnownNode,
  collected: ReadonlyMap<Node, readonly StorageRow[]>,
  options: RunOptions,
): readonly AnyExpression[] | undefined {
  const where: AnyExpression[] = [];
  for (const edge of graph.inputsOf(node)) {
    if (!(edge instanceof IntoWhere)) {
      continue;
    }
    const sourceRows = collected.get(edge.from);
    if (sourceRows === undefined) {
      throw new InternalError('A node cannot read from the result node');
    }
    if (sourceRows.length === 0) {
      return undefined;
    }
    where.push(...whereFromRows(node.table, edge.columns, sourceRows, options));
  }
  return where;
}

function whereFromRows(
  table: TableIdentity,
  pairs: readonly ColumnPair[],
  sourceRows: readonly StorageRow[],
  options: RunOptions,
): readonly AnyExpression[] {
  const [firstRow] = sourceRows;
  if (sourceRows.length === 1 && firstRow !== undefined) {
    return rowEquals(table, pairs, firstRow, options);
  }
  const [firstPair] = pairs;
  if (pairs.length === 1 && firstPair !== undefined) {
    const values = sourceRows.map((row) => sourceValue(table, firstPair, row, options));
    return [BinaryExpr.in(ColumnRef.of(table.tableName, firstPair[1]), ListExpression.of(values))];
  }
  return [OrExpr.of(sourceRows.map((row) => AndExpr.of(rowEquals(table, pairs, row, options))))];
}

function rowEquals(
  table: TableIdentity,
  pairs: readonly ColumnPair[],
  row: StorageRow,
  options: RunOptions,
): readonly AnyExpression[] {
  return pairs.map((pair) =>
    BinaryExpr.eq(ColumnRef.of(table.tableName, pair[1]), sourceValue(table, pair, row, options)),
  );
}

function sourceValue(
  table: TableIdentity,
  [sourceColumn, targetColumn]: ColumnPair,
  row: StorageRow,
  options: RunOptions,
): ParamRef {
  const codec = codecRefForStorageColumn(
    options.context.contract.storage,
    table.namespaceId,
    table.tableName,
    targetColumn,
  );
  return ParamRef.of(row[sourceColumn], { name: targetColumn, ...ifDefined('codec', codec) });
}

function resultRows<Row>(
  node: KnownNode,
  edgeWhere: readonly AnyExpression[],
  result: GraphResult,
  scope: RuntimeScope,
  options: RunOptions,
): AsyncIterableResult<Row> {
  const { namespaceId, tableName, modelName, variantName } = node.table;
  if (node instanceof Find) {
    return dispatchCollectionRows<Row>({
      context: options.context,
      runtime: scope,
      state: findState(node, edgeWhere, result.selectedFields, result.includes, options),
      tableName,
      modelName,
      namespaceId,
    });
  }
  const columns = mutationReturningColumns(
    options.context.contract,
    namespaceId,
    modelName,
    tableName,
    result.selectedFields,
    result.includes,
  );
  return dispatchMutationRows<Row>({
    context: options.context,
    runtime: scope,
    compiled: rowsPlan(node, edgeWhere, columns, options),
    tableName,
    modelName,
    namespaceId,
    variantName,
    includes: result.includes,
    selectedFields: result.selectedFields,
    hiddenColumns: [],
    annotations: options.annotations,
    mapRow: (mapped) =>
      blindCast<Row, 'the mapped row of the result node is the row the caller selected'>(mapped),
  });
}

function findState(
  find: Find,
  edgeWhere: readonly AnyExpression[],
  selectedFields: readonly string[] | undefined,
  includes: GraphResult['includes'],
  options: RunOptions,
): CollectionState {
  return {
    ...emptyState(),
    ...find.read,
    filters: [...find.where, ...edgeWhere],
    selectedFields,
    includes,
    variantName: find.table.variantName,
    annotations: options.annotations ?? new Map(),
  };
}

function rowsPlan(
  node: KnownNode,
  edgeWhere: readonly AnyExpression[],
  columns: readonly string[] | undefined,
  options: RunOptions,
): Plan {
  const { contract } = options.context;
  const { namespaceId, tableName, modelName } = node.table;
  const where = [...node.where, ...edgeWhere];
  if (node instanceof Find) {
    const selectedFields = columns !== undefined && columns.length > 0 ? columns : undefined;
    const state = findState(node, edgeWhere, selectedFields, [], options);
    return compileSelect(contract, namespaceId, modelName, tableName, state);
  }
  if (node instanceof Update) {
    return mergeAnnotations(
      compileUpdateReturning(contract, namespaceId, modelName, tableName, node.set, where, columns),
      options.annotations,
    );
  }
  return mergeAnnotations(
    compileDeleteReturning(contract, namespaceId, modelName, tableName, where, columns),
    options.annotations,
  );
}

function countPlan(
  node: KnownNode,
  edgeWhere: readonly AnyExpression[],
  options: RunOptions,
): Plan {
  const { contract } = options.context;
  const { namespaceId, tableName, modelName, variantName } = node.table;
  const where = [...node.where, ...edgeWhere];
  if (node instanceof Find) {
    throw new InternalError('A Find cannot be the count result');
  }
  if (node instanceof Update) {
    return mergeAnnotations(
      compileUpdateCount(contract, namespaceId, tableName, node.set, where, variantName, modelName),
      options.annotations,
    );
  }
  return mergeAnnotations(
    compileDeleteCount(contract, namespaceId, tableName, where, variantName, modelName),
    options.annotations,
  );
}
