import type { Contract } from '@internal/contract/types';
import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  InsertAst,
  ParamRef,
  type ProjectionItem,
} from '@internal/sql-relational-core/ast';
import type { DescribeCollectionRowsOptions } from '../../src/collection-dispatch';
import { createCollectionTables } from '../../src/collection-tables';
import { Delete } from '../../src/mutation-graph/delete';
import type { ColumnPair, NodeId, StorageRow } from '../../src/mutation-graph/edge';
import { Find } from '../../src/mutation-graph/find';
import { Graph } from '../../src/mutation-graph/graph';
import type { Run, StatementAst } from '../../src/mutation-graph/node';
import { StatementNode } from '../../src/mutation-graph/statement-node';
import { Update } from '../../src/mutation-graph/update';
import { deleteAst, projectTableColumns, updateAst } from '../../src/query-plan-mutations';
import { collectionSelectAst, collectionSelectWithIncludesAst } from '../../src/query-plan-select';
import type { AliasedTable } from '../../src/table-scope';
import {
  type CollectionContext,
  type CollectionState,
  emptyState,
  type RuntimeQueryable,
} from '../../src/types';
import { getTestContext } from '../helpers';

const { contract, aggregateDescriptors } = getTestContext();
const usersTables = createCollectionTables(contract, 'public', 'User');
const postsTables = createCollectionTables(contract, 'public', 'Post');
const tablesOf = { users: usersTables, posts: postsTables };

export const nameIsAda = BinaryExpr.eq(ColumnRef.of('users', 'name'), ParamRef.of('Ada'));

export function findUsers(where: readonly AnyExpression[] = [], columns = ['id']): Find {
  return new Find(
    collectionSelectAst(contract, 'User', {
      ...emptyState(usersTables),
      filters: where,
      selectedFields: columns,
    }),
  );
}

export function findUsersWith(state: Partial<CollectionState>): Find {
  return new Find(
    collectionSelectWithIncludesAst(contract, aggregateDescriptors, 'User', {
      ...emptyState(usersTables),
      ...state,
    }),
  );
}

export function updateUsers(
  set: Record<string, unknown>,
  where?: AnyExpression,
  returning: readonly string[] = [],
): Update {
  const ast = updateAst(contract, usersTables, set, where);
  return new Update(ast.withReturning(projectTableColumns(contract, usersTables.root, returning)));
}

export function updatePosts(
  set: Record<string, unknown>,
  where?: AnyExpression,
  returning: readonly string[] = [],
): Update {
  const ast = updateAst(contract, postsTables, set, where);
  return new Update(ast.withReturning(projectTableColumns(contract, postsTables.root, returning)));
}

export function deleteUsers(where?: AnyExpression, returning: readonly string[] = []): Delete {
  const ast = deleteAst(contract, usersTables, where);
  return new Delete(ast.withReturning(projectTableColumns(contract, usersTables.root, returning)));
}

export function deletePosts(where?: AnyExpression, returning: readonly string[] = []): Delete {
  const ast = deleteAst(contract, postsTables, where);
  return new Delete(ast.withReturning(projectTableColumns(contract, postsTables.root, returning)));
}

export function insertInto(
  table: 'users' | 'posts',
  rows: readonly Record<string, unknown>[],
  returning: readonly string[] = [],
): InsertAst {
  const target = tablesOf[table].root;
  const params = rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([column, value]) => [column, ParamRef.of(value, { name: column })]),
    ),
  );
  return InsertAst.into(target.tableSource(contract))
    .withRows(params)
    .withReturning(projectTableColumns(contract, target, returning));
}

export function aliasedTable(table: 'users' | 'posts'): AliasedTable {
  return tablesOf[table].root;
}

export function columnsOf(
  table: 'users' | 'posts',
  columns: readonly string[],
): ReadonlyArray<ProjectionItem> {
  return projectTableColumns(contract, tablesOf[table].root, columns);
}

export function columnPairs(
  sourceTable: 'users' | 'posts',
  targetTable: 'users' | 'posts',
  names: readonly (readonly [string, string])[],
): ColumnPair[] {
  const source = tablesOf[sourceTable].root;
  const target = tablesOf[targetTable].root;
  return names.map(([sourceColumn, targetColumn]) => {
    const [sourceItem] = projectTableColumns(contract, source, [sourceColumn]);
    const [targetItem] = projectTableColumns(contract, target, [targetColumn]);
    if (sourceItem === undefined || targetItem === undefined) {
      throw new Error('a column pair needs both columns');
    }
    return [sourceItem, targetItem];
  });
}

export function rowsOfUsers(state: Partial<CollectionState> = {}): DescribeCollectionRowsOptions {
  return {
    context: getTestContext(),
    state: { ...emptyState(usersTables), ...state },
    modelName: 'User',
    namespaceId: 'public',
  };
}

export function rowsOfPosts(): DescribeCollectionRowsOptions {
  return {
    context: getTestContext(),
    state: emptyState(postsTables),
    modelName: 'Post',
    namespaceId: 'public',
  };
}

export function contextOf(runtime: RuntimeQueryable): CollectionContext<Contract<SqlStorage>> {
  return { runtime, context: getTestContext() };
}

export interface RecordingRun extends Run {
  readonly queried: StatementAst[];
  readonly executed: StatementAst[];
}

export function recordingRun(
  rows: readonly StorageRow[] = [],
  affectedRows = 0,
  insertId?: string,
): RecordingRun {
  const queried: StatementAst[] = [];
  const executed: StatementAst[] = [];
  return {
    queried,
    executed,
    query(ast) {
      queried.push(ast);
      const generator = async function* (): AsyncGenerator<StorageRow, void, unknown> {
        yield* rows;
      };
      return new AsyncIterableResult(generator());
    },
    async execute(ast) {
      executed.push(ast);
      return insertId === undefined ? { affectedRows } : { affectedRows, insertId };
    },
  };
}

export function positions(): [NodeId, NodeId, NodeId] {
  const graph = new Graph();
  return [
    graph.add(findUsers(), { filter: [] }),
    graph.add(findUsers(), { filter: [] }),
    graph.add(findUsers(), { filter: [] }),
  ];
}

export function returnedAt(graph: Graph, index: number): string[] {
  const [, node] = graph.nodes()[index] ?? [];
  return (node instanceof StatementNode ? node.returns : []).map((column) => column.alias);
}
