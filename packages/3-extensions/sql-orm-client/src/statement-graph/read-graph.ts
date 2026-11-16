import type { Contract } from '@internal/contract/types';
import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { ActivitySource } from '@internal/sql-runtime';
import { isToOneCardinality } from '../collection-contract';
import {
  type CollectionQuery,
  type DescribeCollectionRowsOptions,
  describeCollectionQuery,
} from '../collection-dispatch';
import { selectIncludeStrategy } from '../include-strategy';
import { buildOrmQueryPlan, deriveParamsFromAst } from '../query-plan-meta';
import { collectionSelectAst } from '../query-plan-select';
import type { CollectionState, IncludeExpr, IncludeScalar } from '../types';
import { requireIdentityColumnsForIncludes } from './collection-graphs';
import { Graph } from './graph';
import { addIncludeSteps } from './include-steps';
import { type Builder, findRows } from './model-statements';
import { queryGraph } from './run-graph';
import { StatementNode } from './statement-node';

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
    hashInput: async (source) => ({
      statements: await statementHashes(graphOf(), options.context.contract, source),
      selection: options.state.selectedFields,
      includes: includeTree(options.state.includes),
    }),
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
  b.graph.setResult(addIncludeSteps(b, parent, state.tables, state.includes));
  return b.graph;
}

async function statementHashes(
  graph: Graph,
  contract: Contract<SqlStorage>,
  source: ActivitySource,
): Promise<readonly string[]> {
  const statements = graph
    .nodes()
    .flatMap(([, node]) => (node instanceof StatementNode ? node.statements : []));
  return Promise.all(
    statements.map((ast) =>
      source.planContentHash(buildOrmQueryPlan(contract, ast, deriveParamsFromAst(ast).params)),
    ),
  );
}

/** What a read's result depends on that no statement shows: the statements also send the columns that identify rows, a `limit(0)` include sends none, and `combine()` branch names exist only in the result. */
function includeTree(includes: readonly IncludeExpr[]): readonly unknown[] {
  return includes.map((include) => ({
    relation: include.relationName,
    cardinality: isToOneCardinality(include.cardinality) ? 'one' : 'many',
    ...includeKind(include),
  }));
}

function includeKind(include: IncludeExpr): Record<string, unknown> {
  if (include.combine !== undefined) {
    return {
      kind: 'combine',
      branches: Object.entries(include.combine).map(([name, branch]) => ({
        name,
        ...(branch.kind === 'rows' ? rowsKind(branch.state) : scalarKind(branch.selector)),
      })),
    };
  }
  return include.scalar === undefined ? rowsKind(include.nested) : scalarKind(include.scalar);
}

function rowsKind(state: CollectionState): Record<string, unknown> {
  return { kind: 'rows', selection: state.selectedFields, includes: includeTree(state.includes) };
}

function scalarKind(scalar: IncludeScalar<unknown>): Record<string, unknown> {
  return { kind: 'scalar', fn: scalar.fn, column: scalar.column };
}
