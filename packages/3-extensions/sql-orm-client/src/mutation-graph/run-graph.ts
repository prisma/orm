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
  type DeleteAst,
  ListExpression,
  OrExpr,
  ParamRef,
  type TableSource,
  type UpdateAst,
} from '@internal/sql-relational-core/ast';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { getColumnsReadOnTable } from '../collection-contract';
import { mapMutationRows, mutationReturningColumns } from '../collection-mutation-dispatch';
import { withMutationScope } from '../mutation-executor';
import { buildOrmQueryPlan, deriveParamsFromAst, mergeAnnotations } from '../query-plan-meta';
import { projectTableColumns } from '../query-plan-mutations';
import { queryPlanRows } from '../query-plan-rows';
import { codecRefForTableSource } from '../storage-resolution';
import type { RuntimeQueryable } from '../types';
import { combineWhereExprs } from '../where-utils';
import { type ColumnPair, FilterData, type NodeId } from './edges';
import type { Graph } from './graph';
import type { Node, StatementAst } from './nodes';

type Annotations = ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> | undefined;
type StorageRow = Record<string, unknown>;
type CollectedRows = readonly (readonly StorageRow[])[];

interface Outcome<Row> {
  readonly rows: readonly Row[];
  readonly count: number;
}

export function runForRows<Row>(
  graph: Graph,
  runtime: RuntimeQueryable,
  annotations: Annotations,
): AsyncIterableResult<Row> {
  const [only, ...others] = graph.nodes();
  if (only !== undefined && others.length === 0 && only[0] === graph.result.node) {
    const plan = planOf(graph, statementOf(graph, only[0], only[1], []), annotations);
    const storageRows = () => queryPlanRows(runtime, plan);
    return resultRows<Row>(graph, only[0], only[1], storageRows, runtime, annotations);
  }
  const generator = async function* (): AsyncGenerator<Row, void, unknown> {
    const outcome = await runAllNodes<Row>(graph, runtime, annotations);
    yield* outcome.rows;
  };
  return new AsyncIterableResult(generator());
}

export async function runForFirstRow<Row>(
  graph: Graph,
  runtime: RuntimeQueryable,
  annotations: Annotations,
): Promise<Row | null> {
  const outcome = await runAllNodes<Row>(graph, runtime, annotations);
  return outcome.rows[0] ?? null;
}

export async function runForCount(
  graph: Graph,
  runtime: RuntimeQueryable,
  annotations: Annotations,
): Promise<number> {
  const outcome = await runAllNodes(graph, runtime, annotations);
  return outcome.count;
}

function runAllNodes<Row>(
  graph: Graph,
  runtime: RuntimeQueryable,
  annotations: Annotations,
): Promise<Outcome<Row>> {
  if (graph.nodes().length > 1) {
    return withMutationScope(runtime, (scope) => runNodesInOrder<Row>(graph, scope, annotations));
  }
  return runNodesInOrder<Row>(graph, runtime, annotations);
}

async function runNodesInOrder<Row>(
  graph: Graph,
  scope: RuntimeQueryable,
  annotations: Annotations,
): Promise<Outcome<Row>> {
  const collected: (readonly StorageRow[])[] = [];
  let rows: readonly Row[] = [];
  let count = 0;

  for (const [id, node] of graph.nodes()) {
    const isResult = id === graph.result.node;
    if (sourcesOf(graph, id).some((edge) => rowsOf(collected, edge.from).length === 0)) {
      collected[id] = [];
      continue;
    }

    const ast = statementOf(graph, id, node, collected);
    const plan = planOf(graph, ast, annotations);
    if (ast.kind !== 'select' && ast.returning === undefined) {
      const stats = await scope.execute(plan);
      count = isResult ? stats.affectedRows : count;
      continue;
    }

    const storageRows = await queryPlanRows(scope, plan).toArray();
    collected[id] = storageRows;
    if (isResult) {
      count = storageRows.length;
    }
    if (isResult && graph.result.form !== 'count') {
      const loaded = () => rowsResult(storageRows);
      rows = await resultRows<Row>(graph, id, node, loaded, scope, annotations).toArray();
    }
  }

  return { rows, count };
}

function statementOf(graph: Graph, id: NodeId, node: Node, collected: CollectedRows): StatementAst {
  const ast = node.ast;
  if (ast.kind === 'select') {
    return ast;
  }
  const { contract } = graph.result.collection.context;
  const conditions = sourcesOf(graph, id).flatMap((edge) =>
    conditionsFromRows(contract, ast.table, edge.columns, rowsOf(collected, edge.from)),
  );
  const columns = [...resultColumns(graph, id), ...columnsReadFrom(graph, id)];
  return withConditions(ast, conditions).withReturning(
    projectTableColumns(contract, ast.table, [...new Set(columns)]),
  );
}

function withConditions(
  ast: UpdateAst | DeleteAst,
  conditions: readonly AnyExpression[],
): UpdateAst | DeleteAst {
  if (conditions.length === 0) {
    return ast;
  }
  const existing = ast.where === undefined ? [] : [ast.where];
  return ast.withWhere(combineWhereExprs([...existing, ...conditions]));
}

function planOf(
  graph: Graph,
  ast: StatementAst,
  annotations: Annotations,
): SqlQueryPlan<StorageRow> {
  const { contract } = graph.result.collection.context;
  const { params } = deriveParamsFromAst(ast);
  return mergeAnnotations(buildOrmQueryPlan<StorageRow>(contract, ast, params), annotations);
}

function sourcesOf(graph: Graph, id: NodeId): readonly FilterData[] {
  return graph.edgesInto(id).filter((edge) => edge instanceof FilterData);
}

function rowsOf(collected: CollectedRows, id: NodeId): readonly StorageRow[] {
  return collected[id] ?? [];
}

function columnsReadFrom(graph: Graph, id: NodeId): readonly string[] {
  return graph
    .edgesOutOf(id)
    .filter((edge) => edge instanceof FilterData)
    .flatMap((edge) => edge.columns.map(([sourceColumn]) => sourceColumn));
}

function resultColumns(graph: Graph, id: NodeId): readonly string[] {
  const { form, collection } = graph.result;
  if (id !== graph.result.node || form === 'count') {
    return [];
  }
  const { context, namespaceId, modelName, tableName, state } = collection;
  return (
    mutationReturningColumns(
      context.contract,
      namespaceId,
      modelName,
      tableName,
      state.selectedFields,
      state.includes,
    ) ?? getColumnsReadOnTable(context.contract, namespaceId, modelName, tableName)
  );
}

function conditionsFromRows(
  contract: Contract<SqlStorage>,
  table: TableSource,
  pairs: readonly ColumnPair[],
  sourceRows: readonly StorageRow[],
): readonly AnyExpression[] {
  const target = ([, targetColumn]: ColumnPair) => ColumnRef.of(table.name, targetColumn);
  const value = (row: StorageRow, [sourceColumn, targetColumn]: ColumnPair) =>
    ParamRef.of(row[sourceColumn], {
      name: targetColumn,
      ...ifDefined('codec', codecRefForTableSource(contract, table, targetColumn)),
    });
  const equalsRow = (row: StorageRow) =>
    pairs.map((pair) => BinaryExpr.eq(target(pair), value(row, pair)));

  const [firstRow, ...otherRows] = sourceRows;
  if (firstRow !== undefined && otherRows.length === 0) {
    return equalsRow(firstRow);
  }
  const [firstPair, ...otherPairs] = pairs;
  if (firstPair !== undefined && otherPairs.length === 0) {
    const values = sourceRows.map((row) => value(row, firstPair));
    return [BinaryExpr.in(target(firstPair), ListExpression.of(values))];
  }
  return [OrExpr.of(sourceRows.map((row) => AndExpr.of(equalsRow(row))))];
}

function resultRows<Row>(
  graph: Graph,
  id: NodeId,
  node: Node,
  storageRows: () => AsyncIterableResult<StorageRow>,
  runtime: RuntimeQueryable,
  annotations: Annotations,
): AsyncIterableResult<Row> {
  const { context, namespaceId, tableName, modelName, state } = graph.result.collection;
  const selected = resultColumns(graph, id);
  return mapMutationRows<Row>(storageRows, {
    context,
    runtime,
    tableName,
    modelName,
    namespaceId,
    variantName: state.variantName,
    includes: state.includes,
    selectedFields: state.selectedFields,
    hiddenColumns: columnsReadFrom(graph, id).filter((column) => !selected.includes(column)),
    annotations,
    orderBy: node.ast.kind === 'select' ? node.ast.orderBy : undefined,
    mapRow: (mapped) =>
      blindCast<Row, 'the mapped row of the result node is the row the caller selected'>(mapped),
  });
}

function rowsResult(rows: readonly StorageRow[]): AsyncIterableResult<StorageRow> {
  const generator = async function* (): AsyncGenerator<StorageRow, void, unknown> {
    yield* rows;
  };
  return new AsyncIterableResult(generator());
}
