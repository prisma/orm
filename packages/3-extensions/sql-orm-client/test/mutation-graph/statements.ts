import { AsyncIterableResult } from '@internal/framework-components/runtime';
import {
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  ParamRef,
} from '@internal/sql-relational-core/ast';
import { Delete } from '../../src/mutation-graph/delete';
import type { ColumnPair, NodeId, StorageRow } from '../../src/mutation-graph/edge';
import { Find } from '../../src/mutation-graph/find';
import { Graph, type ResultForm } from '../../src/mutation-graph/graph';
import type { Run, StatementAst } from '../../src/mutation-graph/node';
import { Update } from '../../src/mutation-graph/update';
import { deleteAst, projectTableColumns, updateAst } from '../../src/query-plan-mutations';
import { collectionSelectAst, collectionSelectWithIncludesAst } from '../../src/query-plan-select';
import { tableSourceForContract } from '../../src/storage-resolution';
import { type CollectionState, emptyState } from '../../src/types';
import { getTestContext } from '../helpers';

const { contract, aggregateDescriptors } = getTestContext();

export const nameIsAda = BinaryExpr.eq(ColumnRef.of('users', 'name'), ParamRef.of('Ada'));

export function findUsers(where: readonly AnyExpression[] = [], columns = ['id']): Find {
  return new Find(
    collectionSelectAst(contract, 'public', 'User', 'users', {
      ...emptyState(),
      filters: where,
      selectedFields: columns,
    }),
  );
}

export function findUsersWith(state: Partial<CollectionState>): Find {
  return new Find(
    collectionSelectWithIncludesAst(contract, aggregateDescriptors, 'public', 'User', 'users', {
      ...emptyState(),
      ...state,
    }),
  );
}

export function updateUsers(
  set: Record<string, unknown>,
  where?: AnyExpression,
  returning: readonly string[] = [],
): Update {
  const ast = updateAst(contract, 'public', 'users', set, where);
  return new Update(ast.withReturning(projectTableColumns(contract, ast.table, returning)));
}

export function updatePosts(
  set: Record<string, unknown>,
  where?: AnyExpression,
  returning: readonly string[] = [],
): Update {
  const ast = updateAst(contract, 'public', 'posts', set, where);
  return new Update(ast.withReturning(projectTableColumns(contract, ast.table, returning)));
}

export function deleteUsers(where?: AnyExpression, returning: readonly string[] = []): Delete {
  const ast = deleteAst(contract, 'public', 'users', where);
  return new Delete(ast.withReturning(projectTableColumns(contract, ast.table, returning)));
}

export function deletePosts(where?: AnyExpression, returning: readonly string[] = []): Delete {
  const ast = deleteAst(contract, 'public', 'posts', where);
  return new Delete(ast.withReturning(projectTableColumns(contract, ast.table, returning)));
}

export function columnPairs(
  sourceTable: 'users' | 'posts',
  targetTable: 'users' | 'posts',
  names: readonly (readonly [string, string])[],
): ColumnPair[] {
  const source = tableSourceForContract(contract, 'public', sourceTable);
  const target = tableSourceForContract(contract, 'public', targetTable);
  return names.map(([sourceColumn, targetColumn]) => {
    const [sourceItem] = projectTableColumns(contract, source, [sourceColumn]);
    const [targetItem] = projectTableColumns(contract, target, [targetColumn]);
    if (sourceItem === undefined || targetItem === undefined) {
      throw new Error('a column pair needs both columns');
    }
    return [sourceItem, targetItem];
  });
}

export function graphOfUsers(
  form: ResultForm = 'rows',
  state: Partial<CollectionState> = {},
): Graph {
  return new Graph(form, {
    context: getTestContext(),
    state: { ...emptyState(), ...state },
    tableName: 'users',
    modelName: 'User',
    namespaceId: 'public',
  });
}

export function graphOfPosts(form: ResultForm = 'rows'): Graph {
  return new Graph(form, {
    context: getTestContext(),
    state: emptyState(),
    tableName: 'posts',
    modelName: 'Post',
    namespaceId: 'public',
  });
}

export interface RecordingRun extends Run {
  readonly queried: StatementAst[];
  readonly executed: StatementAst[];
}

export function recordingRun(rows: readonly StorageRow[] = [], affectedRows = 0): RecordingRun {
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
      return affectedRows;
    },
  };
}

export function positions(): [NodeId, NodeId, NodeId] {
  const graph = graphOfUsers();
  return [
    graph.add(findUsers(), { filter: [] }),
    graph.add(findUsers(), { filter: [] }),
    graph.add(findUsers(), { filter: [] }),
  ];
}

export function returnedAt(graph: Graph, index: number): string[] {
  const [, node] = graph.nodes()[index] ?? [];
  return (node?.returns ?? []).map((column) => column.alias);
}
