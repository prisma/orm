import {
  type AnnotationValue,
  AsyncIterableResult,
  type OperationKind,
} from '@internal/framework-components/runtime';
import { blindCast } from '@internal/utils/casts';
import { getColumnsReadOnTable } from '../collection-contract';
import { consumeCollectionRows } from '../collection-dispatch';
import { mapMutationRows } from '../collection-mutation-dispatch';
import { mapResultRows, stripHiddenMappedFields } from '../collection-runtime';
import { withMutationScope } from '../mutation-executor';
import { buildOrmQueryPlan, deriveParamsFromAst, mergeAnnotations } from '../query-plan-meta';
import { queryPlanRows } from '../query-plan-rows';
import type { RuntimeQueryable } from '../types';
import type { NodeId, StorageRow } from './edge';
import type { Graph } from './graph';
import type { Executed, Node, OutputsOf, Run, Slots, StatementAst } from './node';

type Annotations = ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> | undefined;
type Collected = readonly (readonly StorageRow[] | number)[];

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
    const [id, node] = only;
    const run = runOn(graph, runtime, annotations);
    const storageRows = () => rowStream(node.execute(inputsOf(graph, id, []), run));
    return callerRows<Row>(graph, id, node, storageRows, runtime, annotations);
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
  const run = runOn(graph, scope, annotations);
  const collected: (readonly StorageRow[] | number)[] = [];
  let rows: readonly Row[] = [];
  let count = 0;

  for (const [id, node] of graph.nodes()) {
    const executed = await node.execute(inputsOf(graph, id, collected), run);
    collected[id] = executed;
    if (id !== graph.result.node) {
      continue;
    }
    const storageRows = rowsOf(executed);
    count = typeof executed === 'number' ? executed : storageRows.length;
    if (graph.result.form !== 'count') {
      const stream = () => streamOf(storageRows);
      rows = await callerRows<Row>(graph, id, node, stream, scope, annotations).toArray();
    }
  }

  return { rows, count };
}

function inputsOf(graph: Graph, id: NodeId, collected: Collected): OutputsOf<Slots> {
  const outputs: Record<string, readonly (readonly unknown[])[] | null> = {};
  const slots = graph.inputsOf(id);
  for (const slot in slots) {
    const edges = slots[slot] ?? [];
    outputs[slot] =
      edges.length === 0
        ? null
        : edges.map((edge) => rowsOf(collected[edge.from]).map((row) => edge.output(row)));
  }
  return outputs;
}

function runOn(graph: Graph, scope: RuntimeQueryable, annotations: Annotations): Run {
  const { contract } = graph.result.collection.context;
  const planOf = (ast: StatementAst) =>
    mergeAnnotations(
      buildOrmQueryPlan<StorageRow>(contract, ast, deriveParamsFromAst(ast).params),
      annotations,
    );
  return {
    query: (ast) => queryPlanRows(scope, planOf(ast)),
    execute: async (ast) => (await scope.execute(planOf(ast))).affectedRows,
  };
}

function callerRows<Row>(
  graph: Graph,
  id: NodeId,
  node: Node,
  storageRows: () => AsyncIterableResult<StorageRow>,
  runtime: RuntimeQueryable,
  annotations: Annotations,
): AsyncIterableResult<Row> {
  const { collection } = graph.result;
  const { context, namespaceId, tableName, modelName, state } = collection;
  const { contract } = context;
  const selected =
    state.selectedFields ?? getColumnsReadOnTable(contract, namespaceId, modelName, tableName);
  const hiddenColumns = graph
    .edgesOutOf(id)
    .flatMap((edge) => edge.columns.map(([source]) => source.alias))
    .filter((column) => !selected.includes(column));

  if (node.rowsAre === 'read') {
    return mapResultRows(consumeCollectionRows<StorageRow>(collection, storageRows()), (row) => {
      stripHiddenMappedFields(contract, namespaceId, modelName, row, hiddenColumns);
      return blindCast<Row, 'the row the read code shaped is the row the caller selected'>(row);
    });
  }
  return mapMutationRows<Row>(storageRows, {
    context,
    runtime,
    tableName,
    modelName,
    namespaceId,
    variantName: state.variantName,
    includes: state.includes,
    selectedFields: state.selectedFields,
    hiddenColumns,
    annotations,
    mapRow: (mapped) =>
      blindCast<Row, 'the mapped row of the result node is the row the caller selected'>(mapped),
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
