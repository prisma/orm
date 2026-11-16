import type { Contract } from '@internal/contract/types';
import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { ActivitySource } from '@internal/sql-runtime';
import { resolveRowIdentityColumns } from '../collection-contract';
import {
  type CollectionQuery,
  type DescribeCollectionRowsOptions,
  describeCollectionQuery,
  readsNoRows,
  relatedReadsOf,
} from '../collection-dispatch';
import type { CollectionTables } from '../collection-tables';
import { selectIncludeStrategy } from '../include-strategy';
import { projectTableColumn } from '../mutation-statements';
import { buildOrmQueryPlan, deriveParamsFromAst } from '../query-plan-meta';
import { collectionSelectAst, relatedRowsSelect } from '../query-plan-select';
import type { IncludeExpr } from '../types';
import { requireIdentityColumnsForIncludes } from './collection-graphs';
import type { ColumnMapping, NodeId } from './edge';
import { FindRelated, RELATED_KEY_LIMITS } from './find-related';
import { Graph } from './graph';
import { type Builder, findRows } from './model-statements';
import { type Nest, NestJoin } from './nest-join';
import { Rows } from './rows';
import { queryGraph } from './run-graph';
import { StatementNode } from './statement-node';
import { WholeRows } from './whole-rows';

export function describeCollectionRead<Row>(
  options: DescribeCollectionRowsOptions,
): CollectionQuery<Row> {
  const { context, state } = options;
  return state.includes.length > 0 && selectIncludeStrategy(context.contract) === 'query'
    ? describeGraphRead<Row>(options)
    : describeCollectionQuery<Row>(options);
}

export function describeGraphRead<Row>(
  options: DescribeCollectionRowsOptions,
): CollectionQuery<Row> {
  let graph: Graph | undefined;
  const graphOf = () => {
    graph ??= readGraph(options);
    return graph;
  };
  return {
    hashInput: (source) => graphHashInput(graphOf(), options.context.contract, source),
    rows: (scope) => {
      const generator = async function* (): AsyncGenerator<Row, void, unknown> {
        yield* queryGraph<Row>(graphOf(), { runtime: scope, context: options.context }, options);
      };
      return new AsyncIterableResult(generator());
    },
  };
}

export function readGraph(options: DescribeCollectionRowsOptions): Graph {
  requireIdentityColumnsForIncludes(options);
  const { context, modelName, state } = options;
  const b: Builder = { graph: new Graph(context.contract), context };
  const parent = findRows(
    b,
    collectionSelectAst(context.contract, modelName, { ...state, includes: [] }),
    { filter: [], requires: [] },
  );
  b.graph.setResult(addIncludes(b, parent, state.tables, state.includes));
  return b.graph;
}

function addIncludes(
  b: Builder,
  parent: NodeId,
  parentTables: CollectionTables,
  includes: readonly IncludeExpr[],
): NodeId {
  const reads = includes.flatMap(relatedReadsOf).filter((read) => !readsNoRows(read));
  if (reads.length === 0) {
    return parent;
  }
  const { graph, context } = b;
  const { contract } = context;
  const { root } = parentTables;
  const identity = resolveRowIdentityColumns(
    contract,
    root.storage.namespaceId,
    root.storage.tableName,
  );
  const keyColumns = identity.map((column): ColumnMapping => {
    const item = projectTableColumn(contract, root, column);
    return [item, item];
  });
  const children = reads.map(({ key, include }) => {
    const { ast, parentKeys } = relatedRowsSelect(
      contract,
      context.aggregateDescriptors,
      parentTables,
      include,
    );
    const found = new FindRelated(ast, keyColumns, RELATED_KEY_LIMITS);
    const read = graph.add(found, {
      keys: new Rows(parent, keyColumns),
      state: graph.stateEdgesFor(found),
    });
    const nest: Nest = { name: key, parentKey: identity, childKey: parentKeys };
    const rows =
      include.scalar === undefined
        ? addIncludes(b, read, include.nested.tables, include.nested.includes)
        : read;
    return { rows, nest };
  });
  return graph.add(new NestJoin(children.map(({ nest }) => nest)), {
    left: new WholeRows(parent),
    children: children.map(({ rows }) => new WholeRows(rows)),
  });
}

async function graphHashInput(
  graph: Graph,
  contract: Contract<SqlStorage>,
  source: ActivitySource,
): Promise<unknown> {
  const statements = graph
    .nodes()
    .flatMap(([, node]) => (node instanceof StatementNode ? node.statements : []));
  return {
    statements: await Promise.all(
      statements.map((ast) =>
        source.planContentHash(buildOrmQueryPlan(contract, ast, deriveParamsFromAst(ast).params)),
      ),
    ),
  };
}
