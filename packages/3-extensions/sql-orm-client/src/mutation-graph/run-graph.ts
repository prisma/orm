import type { Contract } from '@internal/contract/types';
import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlStatementStats } from '@internal/sql-relational-core/ast';
import type { RuntimeScope } from '@internal/sql-relational-core/types';
import { blindCast } from '@internal/utils/casts';
import { getColumnsReadOnTable } from '../collection-contract';
import { consumeCollectionRows, type DescribeCollectionRowsOptions } from '../collection-dispatch';
import { mapResultRows, stripHiddenMappedFields } from '../collection-runtime';
import { withMutationScope } from '../mutation-executor';
import { buildOrmQueryPlan, deriveParamsFromAst } from '../query-plan-meta';
import { returningProjection } from '../query-plan-mutations';
import { queryPlanRows } from '../query-plan-rows';
import type { CollectionContext } from '../types';
import type { Edge, NodeId, StorageRow } from './edge';
import type { Graph } from './graph';
import type { Executed, OutputsOf, Run, Slots, StatementAst } from './node';
import { StatementNode } from './statement-node';

type Context = CollectionContext<Contract<SqlStorage>>;
type Collected = readonly (readonly StorageRow[] | number)[];

interface Outcome<Row> {
  readonly rows: readonly Row[];
  readonly count: number;
}

export function queryGraph<Row>(
  graph: Graph,
  ctx: Context,
  callerRows: DescribeCollectionRowsOptions,
): AsyncIterableResult<Row> {
  returnCallerColumns(graph, callerRows);
  const [only, ...others] = graph.nodes();
  // A graph with one node is one statement. It runs without a transaction and its rows are
  // handed to the caller as they arrive. A graph with several nodes runs inside the mutation
  // scope, whose transaction ends when its callback returns, so its result is collected there
  // and yielded afterwards.
  if (only !== undefined && others.length === 0 && only[0] === graph.result) {
    const [id, node] = only;
    const run = runOn(ctx, ctx.runtime);
    const storageRows = rowStream(node.execute(inputsOf(graph, id, []), run));
    return shapeRows<Row>(graph, id, storageRows, callerRows);
  }
  const generator = async function* (): AsyncGenerator<Row, void, unknown> {
    const outcome = await runAllNodes<Row>(graph, ctx, callerRows);
    yield* outcome.rows;
  };
  return new AsyncIterableResult(generator());
}

export async function executeGraph(graph: Graph, ctx: Context): Promise<SqlStatementStats> {
  const outcome = await runAllNodes(graph, ctx, undefined);
  return { affectedRows: outcome.count };
}

function returnCallerColumns(graph: Graph, callerRows: DescribeCollectionRowsOptions): void {
  const { context, modelName, state } = callerRows;
  const columns = returningProjection(
    context.contract,
    modelName,
    state.tables.root,
    state.selectedFields,
  );
  for (const [id, node] of graph.nodes()) {
    if (id === graph.result && node instanceof StatementNode) {
      graph.replace(id, node.withReturning(columns));
    }
  }
}

function runAllNodes<Row>(
  graph: Graph,
  ctx: Context,
  callerRows: DescribeCollectionRowsOptions | undefined,
): Promise<Outcome<Row>> {
  if (graph.nodes().length > 1) {
    return withMutationScope(ctx.runtime, (scope) =>
      runNodesInOrder<Row>(graph, ctx, scope, callerRows),
    );
  }
  return runNodesInOrder<Row>(graph, ctx, ctx.runtime, callerRows);
}

async function runNodesInOrder<Row>(
  graph: Graph,
  ctx: Context,
  scope: RuntimeScope,
  callerRows: DescribeCollectionRowsOptions | undefined,
): Promise<Outcome<Row>> {
  const run = runOn(ctx, scope);
  const collected: (readonly StorageRow[] | number)[] = [];
  let rows: readonly Row[] = [];
  let count = 0;

  for (const [id, node] of graph.nodes()) {
    const executed = await node.execute(inputsOf(graph, id, collected), run);
    collected[id] = executed;
    if (id !== graph.result) {
      continue;
    }
    const storageRows = rowsOf(executed);
    count = typeof executed === 'number' ? executed : storageRows.length;
    if (callerRows !== undefined) {
      rows = await shapeRows<Row>(graph, id, streamOf(storageRows), callerRows).toArray();
    }
  }

  return { rows, count };
}

function inputsOf(graph: Graph, id: NodeId, collected: Collected): OutputsOf<Slots> {
  const outputs: Record<string, OutputsOf<Slots>[string]> = {};
  const outputOf = (edge: Edge<unknown>) =>
    rowsOf(collected[edge.from]).map((row) => edge.output(row));
  for (const [name, slot] of Object.entries(graph.inputsOf(id))) {
    if (!Array.isArray(slot)) {
      outputs[name] = outputOf(slot);
    } else {
      outputs[name] = slot.length === 0 ? null : slot.map(outputOf);
    }
  }
  return outputs;
}

function runOn(ctx: Context, scope: RuntimeScope): Run {
  const { contract } = ctx.context;
  const planOf = (ast: StatementAst) =>
    buildOrmQueryPlan<StorageRow>(contract, ast, deriveParamsFromAst(ast).params);
  return {
    query: (ast) => queryPlanRows(scope, planOf(ast)),
    execute: async (ast) => (await scope.execute(planOf(ast))).affectedRows,
  };
}

function shapeRows<Row>(
  graph: Graph,
  id: NodeId,
  storageRows: AsyncIterableResult<StorageRow>,
  callerRows: DescribeCollectionRowsOptions,
): AsyncIterableResult<Row> {
  const { context, namespaceId, modelName, state } = callerRows;
  const { contract } = context;
  const { tableName } = state.tables.root.storage;
  const selected =
    state.selectedFields ?? getColumnsReadOnTable(contract, namespaceId, modelName, tableName);
  const hiddenColumns = graph
    .readersOf(id)
    .flatMap(({ edge }) => edge.columns.map(([source]) => source.alias))
    .filter((column) => !selected.includes(column));

  return mapResultRows(consumeCollectionRows<StorageRow>(callerRows, storageRows), (row) => {
    stripHiddenMappedFields(contract, namespaceId, modelName, row, hiddenColumns);
    return blindCast<Row, 'the row the read code shaped is the row the caller selected'>(row);
  });
}

function rowsOf(executed: readonly StorageRow[] | number | undefined): readonly StorageRow[] {
  return typeof executed === 'object' ? executed : [];
}

function rowStream(executed: Executed): AsyncIterableResult<StorageRow> {
  return executed instanceof AsyncIterableResult ? executed : streamOf([]);
}

function streamOf(rows: readonly StorageRow[]): AsyncIterableResult<StorageRow> {
  const generator = async function* (): AsyncGenerator<StorageRow, void, unknown> {
    yield* rows;
  };
  return new AsyncIterableResult(generator());
}
