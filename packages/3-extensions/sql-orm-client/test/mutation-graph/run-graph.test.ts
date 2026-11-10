import { describe, expect, it, vi } from 'vitest';
import type { Graph } from '../../src/mutation-graph/graph';
import { executeGraph, queryGraph } from '../../src/mutation-graph/run-graph';
import { createCollectionFor } from '../collection-fixtures';
import { createMockRuntime, type MockExecution, type MockRuntime } from '../helpers';
import { printExpression } from './print-expression';
import {
  addFiltered,
  columnMappings,
  contextOf,
  deletePosts,
  deleteUsers,
  findUsers,
  findUsersWith,
  nameIsAda,
  newGraph,
  rowsOfPosts,
  rowsOfUsers,
  updatePosts,
  updateUsers,
} from './statements';

function usersWithPosts() {
  const { includes, tables } = createCollectionFor('User').collection.include('posts').state;
  return { includes, tables };
}

async function firstRowOf(...args: Parameters<typeof queryGraph>): Promise<unknown> {
  const rows = await queryGraph(...args).toArray();
  return rows[0] ?? null;
}

async function affectedBy(...args: Parameters<typeof executeGraph>): Promise<number> {
  const stats = await executeGraph(...args);
  return stats.affectedRows;
}

function astOf(execution: MockExecution) {
  if (!('ast' in execution.plan)) {
    throw new Error('the executed plan has no ast');
  }
  return execution.plan.ast;
}

function statements(runtime: MockRuntime): string[] {
  return runtime.executions.map((execution) => `${execution.operation} ${astOf(execution).kind}`);
}

function whereText(execution: MockExecution, tableName: string): string {
  const ast = astOf(execution);
  if (ast.kind === 'insert' || ast.kind === 'raw-query' || ast.where === undefined) {
    throw new Error('the executed statement has no where');
  }
  return printExpression(ast.where, tableName);
}

function returnedColumns(execution: MockExecution): string[] {
  const ast = astOf(execution);
  if (ast.kind === 'select') {
    return ast.projection.map((item) => item.alias);
  }
  if (ast.kind === 'update' || ast.kind === 'delete') {
    return (ast.returning ?? []).map((item) => item.alias);
  }
  throw new Error('the executed statement returns no columns');
}

function withTransaction(runtime: MockRuntime) {
  const commit = vi.fn(async () => undefined);
  const rollback = vi.fn(async () => undefined);
  const open = vi.fn(async () => ({
    query: runtime.query.bind(runtime),
    execute: runtime.execute.bind(runtime),
    commit,
    rollback,
  }));
  return { runtime: Object.assign(runtime, { transaction: open }), open, commit, rollback };
}

const allUserColumns = ['address', 'email', 'id', 'invited_by_id', 'name'];
const idToUserId = columnMappings('users', 'posts', [['id', 'user_id']]);
const idAndName = columnMappings('users', 'posts', [
  ['id', 'user_id'],
  ['name', 'title'],
]);

function findThenUpdatePost(columns = idToUserId): Graph {
  const graph = newGraph();
  const find = graph.add(findUsers([nameIsAda]));
  const update = updatePosts({ title: 'New' }, undefined, ['id', 'title']);
  graph.setResult(addFiltered(graph, update, [find, columns]));
  return graph;
}

function findThenDeleteUsers(): Graph {
  const graph = newGraph();
  const find = graph.add(findUsers([nameIsAda], ['id', 'name']));
  graph.add(deleteUsers(nameIsAda));
  graph.setResult(find);
  return graph;
}

describe('running a graph', () => {
  describe('with one node', () => {
    it('returns the rows of an Update, mapped to fields', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 1, name: 'Ada', invited_by_id: 2 }]]);
      const graph = newGraph();
      const update = updateUsers({ name: 'Ada' }, nameIsAda, allUserColumns);
      graph.setResult(graph.add(update));

      const rows = await queryGraph(graph, contextOf(runtime), rowsOfUsers());

      expect(rows).toEqual([{ id: 1, name: 'Ada', invitedById: 2 }]);
      expect(statements(runtime)).toEqual(['query update']);
    });

    it('makes a write that is the result return the selection of the caller', async () => {
      const runtime = createMockRuntime();
      const graph = newGraph();
      graph.setResult(graph.add(deleteUsers(nameIsAda)));

      await queryGraph(graph, contextOf(runtime), rowsOfUsers({ selectedFields: ['id', 'email'] }));

      expect(statements(runtime)).toEqual(['query delete']);
      expect(returnedColumns(runtime.executions[0]!)).toEqual(['id', 'email']);
    });

    it('makes it return every column of the model when the caller selected nothing', async () => {
      const runtime = createMockRuntime();
      const graph = newGraph();
      graph.setResult(graph.add(deleteUsers(nameIsAda)));

      await queryGraph(graph, contextOf(runtime), rowsOfUsers());

      expect(returnedColumns(runtime.executions[0]!)).toEqual(allUserColumns);
    });

    it('makes a Find that is the result also return what the caller selected', async () => {
      const runtime = createMockRuntime();
      const graph = newGraph();
      graph.setResult(graph.add(findUsers([nameIsAda], ['id'])));

      await queryGraph(graph, contextOf(runtime), rowsOfUsers({ selectedFields: ['id', 'email'] }));

      expect(returnedColumns(runtime.executions[0]!)).toEqual(['id', 'email']);
    });

    it('returns the affected row count of a count result without returning rows', async () => {
      const runtime = createMockRuntime();
      runtime.setNextStats([{ affectedRows: 3 }]);
      const graph = newGraph();
      graph.setResult(graph.add(deleteUsers(nameIsAda)));

      expect(await executeGraph(graph, contextOf(runtime))).toEqual({ affectedRows: 3 });
      expect(statements(runtime)).toEqual(['execute delete']);
      expect(returnedColumns(runtime.executions[0]!)).toEqual([]);
    });

    it('returns the first row of a first row result', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 1 }, { id: 2 }]]);
      const graph = newGraph();
      graph.setResult(graph.add(findUsers()));

      expect(
        await firstRowOf(graph, contextOf(runtime), rowsOfUsers({ selectedFields: ['id'] })),
      ).toEqual({ id: 1 });
    });

    it('does not open a transaction', async () => {
      const transactional = withTransaction(createMockRuntime());
      const graph = newGraph();
      graph.setResult(graph.add(deleteUsers(undefined, allUserColumns)));

      await queryGraph(graph, contextOf(transactional.runtime), rowsOfUsers());

      expect(transactional.open).not.toHaveBeenCalled();
    });
  });

  describe('with an empty result', () => {
    it('gives no rows, null and zero, and executes nothing when the graph has no node', async () => {
      const runtime = createMockRuntime();

      expect(await queryGraph(newGraph(), contextOf(runtime), rowsOfUsers())).toEqual([]);
      expect(await firstRowOf(newGraph(), contextOf(runtime), rowsOfUsers())).toBeNull();
      expect(await affectedBy(newGraph(), contextOf(runtime))).toBe(0);
      expect(runtime.executions).toEqual([]);
    });

    it('still executes the nodes of the graph', async () => {
      const runtime = createMockRuntime();
      const graph = newGraph();
      graph.add(findUsers([nameIsAda]));

      expect(await firstRowOf(graph, contextOf(runtime), rowsOfUsers())).toBeNull();
      expect(statements(runtime)).toEqual(['query select']);
    });
  });

  describe('with a Find after an Update of the same table', () => {
    it('runs the Find, whose only input is the state the Update left', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 1, name: 'Ada' }]]);
      const graph = newGraph();
      graph.add(updateUsers({ name: 'Ada' }, nameIsAda));
      graph.setResult(graph.add(findUsers([nameIsAda], ['id', 'name'])));

      const rows = await queryGraph(
        graph,
        contextOf(runtime),
        rowsOfUsers({ selectedFields: ['id', 'name'] }),
      );

      expect(rows).toEqual([{ id: 1, name: 'Ada' }]);
      expect(statements(runtime)).toEqual(['execute update', 'query select']);
    });
  });

  describe('with a Find and a Delete after it', () => {
    it('reads the rows, then deletes with the count form, and returns the rows read', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 1, name: 'Ada' }]]);

      const rows = await queryGraph(
        findThenDeleteUsers(),
        contextOf(runtime),
        rowsOfUsers({ selectedFields: ['id', 'name'] }),
      );

      expect(rows).toEqual([{ id: 1, name: 'Ada' }]);
      expect(statements(runtime)).toEqual(['query select', 'execute delete']);
    });

    it('executes nothing until the rows are asked for', async () => {
      const runtime = createMockRuntime();

      queryGraph(
        findThenDeleteUsers(),
        contextOf(runtime),
        rowsOfUsers({ selectedFields: ['id', 'name'] }),
      );
      await Promise.resolve();

      expect(runtime.executions).toEqual([]);
    });

    it.each([undefined, { isolationLevel: 'ReadCommitted' }])(
      'runs in one transaction with policy %j that it commits',
      async (implicitTransactionOptions) => {
        const transactional = withTransaction(createMockRuntime());

        await queryGraph(
          findThenDeleteUsers(),
          { ...contextOf(transactional.runtime), implicitTransactionOptions },
          rowsOfUsers({ selectedFields: ['id', 'name'] }),
        );

        expect(transactional.open).toHaveBeenCalledExactlyOnceWith(implicitTransactionOptions);
        expect(transactional.commit).toHaveBeenCalledTimes(1);
        expect(transactional.rollback).not.toHaveBeenCalled();
      },
    );

    it('rolls the transaction back when a statement fails', async () => {
      const transactional = withTransaction(createMockRuntime());
      transactional.runtime.execute = async () => {
        throw new Error('delete failed');
      };

      await expect(
        queryGraph(
          findThenDeleteUsers(),
          contextOf(transactional.runtime),
          rowsOfUsers({ selectedFields: ['id', 'name'] }),
        ),
      ).rejects.toThrow('delete failed');
      expect(transactional.rollback).toHaveBeenCalledTimes(1);
      expect(transactional.commit).not.toHaveBeenCalled();
    });
  });

  describe('with a FilterData edge', () => {
    it('gives the target one condition per row of the source', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 7 }, { id: 8 }], [{ id: 70, title: 'New' }]]);

      const row = await firstRowOf(findThenUpdatePost(), contextOf(runtime), rowsOfPosts());

      expect(row).toEqual({ id: 70, title: 'New' });
      expect(statements(runtime)).toEqual(['query select', 'query update']);
      expect(whereText(runtime.executions[1]!, 'posts')).toBe('user_id in (7, 8)');
    });

    it('gives the target every column mapping of the edge', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 7, name: 'Ada' }], []]);

      await firstRowOf(findThenUpdatePost(idAndName), contextOf(runtime), rowsOfPosts());

      expect(returnedColumns(runtime.executions[0]!)).toEqual(['id', 'name']);
      expect(whereText(runtime.executions[1]!, 'posts')).toBe("(user_id = 7 and title = 'Ada')");
    });

    it('does not run the target when the source has no row, and gives null', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[]]);

      expect(await firstRowOf(findThenUpdatePost(), contextOf(runtime), rowsOfPosts())).toBeNull();
      expect(statements(runtime)).toEqual(['query select']);
    });

    it('gives zero for a count result whose source has no row', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[]]);
      const graph = newGraph();
      const find = graph.add(findUsers([nameIsAda]));
      graph.setResult(addFiltered(graph, deletePosts(), [find, idToUserId]));

      expect(await affectedBy(graph, contextOf(runtime))).toBe(0);
      expect(statements(runtime)).toEqual(['query select']);
    });

    it('does not run a node whose source did not run', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[]]);
      const graph = newGraph();
      const find = graph.add(findUsers([nameIsAda]));
      const update = addFiltered(graph, updatePosts({ title: 'New' }), [find, idToUserId]);
      const sameId = columnMappings('posts', 'posts', [['id', 'id']]);
      graph.setResult(addFiltered(graph, deletePosts(), [update, sameId]));

      expect(await affectedBy(graph, contextOf(runtime))).toBe(0);
      expect(statements(runtime)).toEqual(['query select']);
    });

    it('reads the rows of a write that returns columns for an edge', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 7 }], []]);
      const graph = newGraph();
      const update = graph.add(updateUsers({ name: 'Ada' }, nameIsAda));
      graph.setResult(addFiltered(graph, deletePosts(undefined, ['id']), [update, idToUserId]));

      await queryGraph(graph, contextOf(runtime), rowsOfPosts());

      expect(statements(runtime)).toEqual(['query update', 'query delete']);
      expect(returnedColumns(runtime.executions[0]!)).toEqual(['id']);
      expect(whereText(runtime.executions[1]!, 'posts')).toBe('user_id = 7');
    });
  });

  describe('with a node that reads from the result node', () => {
    it('uses the rows of a Find result for the edge and returns them mapped', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 7, invited_by_id: 2 }]]);
      const graph = newGraph();
      const find = graph.add(findUsers([nameIsAda], ['id', 'invited_by_id']));
      const sameId = columnMappings('users', 'users', [['id', 'id']]);
      addFiltered(graph, deleteUsers(), [find, sameId]);
      graph.setResult(find);

      const row = await firstRowOf(
        graph,
        contextOf(runtime),
        rowsOfUsers({ selectedFields: ['id', 'invited_by_id'] }),
      );

      expect(row).toEqual({ id: 7, invitedById: 2 });
      expect(statements(runtime)).toEqual(['query select', 'execute delete']);
      expect(whereText(runtime.executions[1]!, 'users')).toBe('id = 7');
    });

    it('leaves a column that was returned only for the edge out of the rows', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ name: 'Ada', id: 7 }]]);
      const graph = newGraph();
      const update = graph.add(updateUsers({ name: 'Ada' }, nameIsAda, ['name']));
      addFiltered(graph, deletePosts(), [update, idToUserId]);
      graph.setResult(update);

      const rows = await queryGraph(
        graph,
        contextOf(runtime),
        rowsOfUsers({ selectedFields: ['name'] }),
      );

      expect(returnedColumns(runtime.executions[0]!)).toEqual(['name', 'id']);
      expect(rows).toEqual([{ name: 'Ada' }]);
      expect(whereText(runtime.executions[1]!, 'posts')).toBe('user_id = 7');
    });

    it('counts the rows of a count result that returns rows for an edge', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 7 }, { id: 8 }]]);
      const graph = newGraph();
      const update = graph.add(updateUsers({ name: 'Ada' }, nameIsAda));
      addFiltered(graph, deletePosts(), [update, idToUserId]);
      graph.setResult(update);

      expect(await affectedBy(graph, contextOf(runtime))).toBe(2);
      expect(statements(runtime)).toEqual(['query update', 'execute delete']);
    });
  });

  describe('with includes', () => {
    it('reads the rows of a write with their includes in a Find node, one statement per node', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 1 }], [{ id: 1, name: 'Ada', posts: [] }]]);
      const state = { ...usersWithPosts(), selectedFields: ['id', 'name'] };
      const sameId = columnMappings('users', 'users', [['id', 'id']]);
      const graph = newGraph();
      const update = graph.add(updateUsers({ name: 'Ada' }, nameIsAda));
      graph.setResult(addFiltered(graph, findUsersWith(state), [update, sameId]));

      const rows = await queryGraph(graph, contextOf(runtime), rowsOfUsers(state));

      expect(rows).toEqual([{ id: 1, name: 'Ada', posts: [] }]);
      expect(statements(runtime)).toEqual(['query update', 'query select']);
      expect(returnedColumns(runtime.executions[0]!)).toEqual(['id']);
      expect(whereText(runtime.executions[1]!, 'users')).toBe('id = 1');
    });

    it('does not run the Find when the write changed no row', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[]]);
      const state = { ...usersWithPosts(), selectedFields: ['id', 'name'] };
      const sameId = columnMappings('users', 'users', [['id', 'id']]);
      const graph = newGraph();
      const update = graph.add(updateUsers({ name: 'Ada' }, nameIsAda));
      graph.setResult(addFiltered(graph, findUsersWith(state), [update, sameId]));

      expect(await queryGraph(graph, contextOf(runtime), rowsOfUsers(state))).toEqual([]);
      expect(statements(runtime)).toEqual(['query update']);
    });

    it('reads a Find result with its includes in one statement and shapes it with the read code', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 1, name: 'Ada', posts: [] }]]);
      const state = { ...usersWithPosts(), selectedFields: ['id', 'name'] };
      const graph = newGraph();
      const find = graph.add(findUsersWith({ ...state, filters: [nameIsAda] }));
      graph.add(deleteUsers(nameIsAda));
      graph.setResult(find);

      const rows = await queryGraph(graph, contextOf(runtime), rowsOfUsers(state));

      expect(rows).toEqual([{ id: 1, name: 'Ada', posts: [] }]);
      expect(statements(runtime)).toEqual(['query select', 'execute delete']);
      expect(returnedColumns(runtime.executions[0]!)).toEqual(['id', 'name', 'posts']);
    });

    it('leaves a column a Find result returns only for an edge out of the rows', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ name: 'Ada', posts: [], id: 1 }]]);
      const state = { ...usersWithPosts(), selectedFields: ['name'] };
      const graph = newGraph();
      const find = graph.add(findUsersWith({ ...state, filters: [nameIsAda] }));
      const sameId = columnMappings('users', 'users', [['id', 'id']]);
      addFiltered(graph, deleteUsers(), [find, sameId]);
      graph.setResult(find);

      const row = await firstRowOf(graph, contextOf(runtime), rowsOfUsers(state));

      expect(row).toEqual({ name: 'Ada', posts: [] });
      expect(returnedColumns(runtime.executions[0]!)).toEqual(['name', 'posts', 'id']);
      expect(whereText(runtime.executions[1]!, 'users')).toBe('id = 1');
    });
  });
});
