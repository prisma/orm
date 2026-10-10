import { defineAnnotation } from '@internal/framework-components/runtime';
import { describe, expect, it, vi } from 'vitest';
import { filterData } from '../../src/mutation-graph/filter-data';
import type { Graph } from '../../src/mutation-graph/graph';
import { printExpression } from '../../src/mutation-graph/print-expression';
import { runForCount, runForFirstRow, runForRows } from '../../src/mutation-graph/run-graph';
import { createCollectionFor } from '../collection-fixtures';
import { createMockRuntime, type MockExecution, type MockRuntime } from '../helpers';
import {
  columnPairs,
  deletePosts,
  deleteUsers,
  findUsers,
  findUsersWith,
  graphOfPosts,
  graphOfUsers,
  nameIsAda,
  updatePosts,
  updateUsers,
} from './statements';

const auditAnnotation = defineAnnotation<{ actor: string }>()({
  namespace: 'audit',
  applicableTo: ['write'],
});
const audit = auditAnnotation({ actor: 'system' });
const auditAnnotations = new Map([[audit.namespace, audit]]);

function userIncludes() {
  return createCollectionFor('User').collection.include('posts').state.includes;
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
const idToUserId = columnPairs('users', 'posts', [['id', 'user_id']]);
const idAndName = columnPairs('users', 'posts', [
  ['id', 'user_id'],
  ['name', 'title'],
]);

function findThenUpdatePost(columns = idToUserId): Graph {
  const graph = graphOfPosts('first row');
  const find = graph.add(findUsers([nameIsAda]), { filter: [] });
  const update = updatePosts({ title: 'New' }, undefined, ['id', 'title']);
  graph.setResult(graph.add(update, { filter: [filterData(find, columns)] }));
  return graph;
}

function findThenDeleteUsers(): Graph {
  const graph = graphOfUsers('rows', { selectedFields: ['id', 'name'] });
  const find = graph.add(findUsers([nameIsAda], ['id', 'name']), { filter: [] });
  graph.after(find, graph.add(deleteUsers(nameIsAda), { filter: [] }));
  graph.setResult(find);
  return graph;
}

describe('running a graph', () => {
  describe('with one node', () => {
    it('returns the rows of an Update, mapped to fields', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 1, name: 'Ada', invited_by_id: 2 }]]);
      const graph = graphOfUsers('rows');
      const update = updateUsers({ name: 'Ada' }, nameIsAda, allUserColumns);
      graph.setResult(graph.add(update, { filter: [] }));

      const rows = await runForRows(graph, runtime, undefined);

      expect(rows).toEqual([{ id: 1, name: 'Ada', invitedById: 2 }]);
      expect(statements(runtime)).toEqual(['query update']);
    });

    it('returns from the write the columns its statement was built with', async () => {
      const runtime = createMockRuntime();
      const graph = graphOfUsers('rows', { selectedFields: ['id', 'email'] });
      graph.setResult(graph.add(deleteUsers(nameIsAda, ['id', 'email']), { filter: [] }));

      await runForRows(graph, runtime, undefined);

      expect(returnedColumns(runtime.executions[0]!)).toEqual(['id', 'email']);
    });

    it('returns the affected row count of a count result without returning rows', async () => {
      const runtime = createMockRuntime();
      runtime.setNextStats([{ affectedRows: 3 }]);
      const graph = graphOfUsers('count');
      graph.setResult(graph.add(deleteUsers(nameIsAda), { filter: [] }));

      expect(await runForCount(graph, runtime, undefined)).toBe(3);
      expect(statements(runtime)).toEqual(['execute delete']);
    });

    it('returns the first row of a first row result', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 1 }, { id: 2 }]]);
      const graph = graphOfUsers('first row', { selectedFields: ['id'] });
      graph.setResult(graph.add(findUsers(), { filter: [] }));

      expect(await runForFirstRow(graph, runtime, undefined)).toEqual({ id: 1 });
    });

    it('executes nothing until the rows are asked for when includes will be loaded', async () => {
      const runtime = createMockRuntime();
      const graph = graphOfUsers('rows', { includes: userIncludes() });
      graph.setResult(graph.add(updateUsers({ name: 'Ada' }, nameIsAda, ['id']), { filter: [] }));

      runForRows(graph, runtime, undefined);
      await Promise.resolve();

      expect(runtime.executions).toEqual([]);
    });

    it('does not open a transaction', async () => {
      const transactional = withTransaction(createMockRuntime());
      const graph = graphOfUsers('rows');
      graph.setResult(graph.add(deleteUsers(undefined, allUserColumns), { filter: [] }));

      await runForRows(graph, transactional.runtime, undefined);

      expect(transactional.open).not.toHaveBeenCalled();
    });
  });

  describe('with an empty result', () => {
    it('gives no rows, null and zero, and executes nothing when the graph has no node', async () => {
      const runtime = createMockRuntime();

      expect(await runForRows(graphOfUsers('rows'), runtime, undefined)).toEqual([]);
      expect(await runForFirstRow(graphOfUsers('first row'), runtime, undefined)).toBeNull();
      expect(await runForCount(graphOfUsers('count'), runtime, undefined)).toBe(0);
      expect(runtime.executions).toEqual([]);
    });

    it('still executes the nodes of the graph', async () => {
      const runtime = createMockRuntime();
      const graph = graphOfUsers('first row');
      graph.add(findUsers([nameIsAda]), { filter: [] });

      expect(await runForFirstRow(graph, runtime, undefined)).toBeNull();
      expect(statements(runtime)).toEqual(['query select']);
    });

    it('gives the empty result for a result that names an empty position', async () => {
      const runtime = createMockRuntime();
      const graph = graphOfUsers('first row');
      const find = graph.add(findUsers([nameIsAda]), { filter: [] });
      graph.setResult(graph.add(updateUsers({}), { filter: [filterData(find, idToUserId)] }));

      expect(await runForFirstRow(graph, runtime, undefined)).toBeNull();
      expect(statements(runtime)).toEqual(['query select']);
    });
  });

  describe('with a Find and a Delete after it', () => {
    it('reads the rows, then deletes with the count form, and returns the rows read', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 1, name: 'Ada' }]]);

      const rows = await runForRows(findThenDeleteUsers(), runtime, undefined);

      expect(rows).toEqual([{ id: 1, name: 'Ada' }]);
      expect(statements(runtime)).toEqual(['query select', 'execute delete']);
    });

    it('executes nothing until the rows are asked for', async () => {
      const runtime = createMockRuntime();

      runForRows(findThenDeleteUsers(), runtime, undefined);
      await Promise.resolve();

      expect(runtime.executions).toEqual([]);
    });

    it('runs in one transaction that it commits', async () => {
      const transactional = withTransaction(createMockRuntime());

      await runForRows(findThenDeleteUsers(), transactional.runtime, undefined);

      expect(transactional.open).toHaveBeenCalledTimes(1);
      expect(transactional.commit).toHaveBeenCalledTimes(1);
      expect(transactional.rollback).not.toHaveBeenCalled();
    });

    it('rolls the transaction back when a statement fails', async () => {
      const transactional = withTransaction(createMockRuntime());
      transactional.runtime.execute = async () => {
        throw new Error('delete failed');
      };

      await expect(
        runForRows(findThenDeleteUsers(), transactional.runtime, undefined),
      ).rejects.toThrow('delete failed');
      expect(transactional.rollback).toHaveBeenCalledTimes(1);
      expect(transactional.commit).not.toHaveBeenCalled();
    });

    it('puts the annotations of the caller on every statement', async () => {
      const runtime = createMockRuntime();

      await runForRows(findThenDeleteUsers(), runtime, auditAnnotations);

      expect(runtime.executions.map((execution) => auditAnnotation.read(execution.plan))).toEqual([
        { actor: 'system' },
        { actor: 'system' },
      ]);
    });
  });

  describe('with a FilterData edge', () => {
    it('gives the target one condition per row of the source', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 7 }, { id: 8 }], [{ id: 70, title: 'New' }]]);

      const row = await runForFirstRow(findThenUpdatePost(), runtime, undefined);

      expect(row).toEqual({ id: 70, title: 'New' });
      expect(statements(runtime)).toEqual(['query select', 'query update']);
      expect(whereText(runtime.executions[1]!, 'posts')).toBe('(user_id = 7 or user_id = 8)');
    });

    it('gives the target every column pair of the edge', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 7, name: 'Ada' }], []]);

      await runForFirstRow(findThenUpdatePost(idAndName), runtime, undefined);

      expect(returnedColumns(runtime.executions[0]!)).toEqual(['id', 'name']);
      expect(whereText(runtime.executions[1]!, 'posts')).toBe("(user_id = 7 and title = 'Ada')");
    });

    it('does not run the target when the source has no row, and gives null', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[]]);

      expect(await runForFirstRow(findThenUpdatePost(), runtime, undefined)).toBeNull();
      expect(statements(runtime)).toEqual(['query select']);
    });

    it('gives zero for a count result whose source has no row', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[]]);
      const graph = graphOfPosts('count');
      const find = graph.add(findUsers([nameIsAda]), { filter: [] });
      graph.setResult(graph.add(deletePosts(), { filter: [filterData(find, idToUserId)] }));

      expect(await runForCount(graph, runtime, undefined)).toBe(0);
      expect(statements(runtime)).toEqual(['query select']);
    });

    it('does not run a node whose source did not run', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[]]);
      const graph = graphOfPosts('count');
      const find = graph.add(findUsers([nameIsAda]), { filter: [] });
      const update = graph.add(updatePosts({ title: 'New' }), {
        filter: [filterData(find, idToUserId)],
      });
      const sameId = columnPairs('posts', 'posts', [['id', 'id']]);
      graph.setResult(graph.add(deletePosts(), { filter: [filterData(update, sameId)] }));

      expect(await runForCount(graph, runtime, undefined)).toBe(0);
      expect(statements(runtime)).toEqual(['query select']);
    });

    it('reads the rows of a write that returns columns for an edge', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 7 }], []]);
      const graph = graphOfPosts('rows');
      const update = graph.add(updateUsers({ name: 'Ada' }, nameIsAda), { filter: [] });
      graph.setResult(
        graph.add(deletePosts(undefined, ['id']), { filter: [filterData(update, idToUserId)] }),
      );

      await runForRows(graph, runtime, undefined);

      expect(statements(runtime)).toEqual(['query update', 'query delete']);
      expect(returnedColumns(runtime.executions[0]!)).toEqual(['id']);
      expect(whereText(runtime.executions[1]!, 'posts')).toBe('user_id = 7');
    });
  });

  describe('with a node that reads from the result node', () => {
    it('uses the rows of a Find result for the edge and returns them mapped', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 7, invited_by_id: 2 }]]);
      const graph = graphOfUsers('first row', { selectedFields: ['id', 'invited_by_id'] });
      const find = graph.add(findUsers([nameIsAda], ['id', 'invited_by_id']), { filter: [] });
      const sameId = columnPairs('users', 'users', [['id', 'id']]);
      graph.add(deleteUsers(), { filter: [filterData(find, sameId)] });
      graph.setResult(find);

      const row = await runForFirstRow(graph, runtime, undefined);

      expect(row).toEqual({ id: 7, invitedById: 2 });
      expect(statements(runtime)).toEqual(['query select', 'execute delete']);
      expect(whereText(runtime.executions[1]!, 'users')).toBe('id = 7');
    });

    it('leaves a column that was returned only for the edge out of the rows', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ name: 'Ada', id: 7 }]]);
      const graph = graphOfUsers('rows', { selectedFields: ['name'] });
      const update = graph.add(updateUsers({ name: 'Ada' }, nameIsAda, ['name']), { filter: [] });
      graph.add(deletePosts(), { filter: [filterData(update, idToUserId)] });
      graph.setResult(update);

      const rows = await runForRows(graph, runtime, undefined);

      expect(returnedColumns(runtime.executions[0]!)).toEqual(['name', 'id']);
      expect(rows).toEqual([{ name: 'Ada' }]);
      expect(whereText(runtime.executions[1]!, 'posts')).toBe('user_id = 7');
    });

    it('counts the rows of a count result that returns rows for an edge', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 7 }, { id: 8 }]]);
      const graph = graphOfUsers('count');
      const update = graph.add(updateUsers({ name: 'Ada' }, nameIsAda), { filter: [] });
      graph.add(deletePosts(), { filter: [filterData(update, idToUserId)] });
      graph.setResult(update);

      expect(await runForCount(graph, runtime, undefined)).toBe(2);
      expect(statements(runtime)).toEqual(['query update', 'execute delete']);
    });
  });

  describe('with includes', () => {
    it('loads the rows of a write with their includes by identity', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 1 }], [{ id: 1, name: 'Ada', posts: [] }]]);
      const graph = graphOfUsers('rows', { includes: userIncludes() });
      graph.setResult(graph.add(updateUsers({ name: 'Ada' }, nameIsAda, ['id']), { filter: [] }));

      const rows = await runForRows(graph, runtime, auditAnnotations);

      expect(rows).toEqual([{ id: 1, name: 'Ada', posts: [] }]);
      expect(statements(runtime)).toEqual(['query update', 'query select']);
      expect(runtime.executions.map((execution) => auditAnnotation.read(execution.plan))).toEqual([
        { actor: 'system' },
        { actor: 'system' },
      ]);
    });

    it('reads a Find result with its includes in one statement and shapes it with the read code', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 1, name: 'Ada', posts: [] }]]);
      const state = { includes: userIncludes(), selectedFields: ['id', 'name'] };
      const graph = graphOfUsers('rows', state);
      const find = graph.add(findUsersWith({ ...state, filters: [nameIsAda] }), { filter: [] });
      graph.after(find, graph.add(deleteUsers(nameIsAda), { filter: [] }));
      graph.setResult(find);

      const rows = await runForRows(graph, runtime, auditAnnotations);

      expect(rows).toEqual([{ id: 1, name: 'Ada', posts: [] }]);
      expect(statements(runtime)).toEqual(['query select', 'execute delete']);
      expect(returnedColumns(runtime.executions[0]!)).toEqual(['id', 'name', 'posts']);
      expect(runtime.executions.map((execution) => auditAnnotation.read(execution.plan))).toEqual([
        { actor: 'system' },
        { actor: 'system' },
      ]);
    });

    it('leaves a column a Find result returns only for an edge out of the rows', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ name: 'Ada', posts: [], id: 1 }]]);
      const state = { includes: userIncludes(), selectedFields: ['name'] };
      const graph = graphOfUsers('first row', state);
      const find = graph.add(findUsersWith({ ...state, filters: [nameIsAda] }), { filter: [] });
      const sameId = columnPairs('users', 'users', [['id', 'id']]);
      graph.add(deleteUsers(), { filter: [filterData(find, sameId)] });
      graph.setResult(find);

      const row = await runForFirstRow(graph, runtime, undefined);

      expect(row).toEqual({ name: 'Ada', posts: [] });
      expect(returnedColumns(runtime.executions[0]!)).toEqual(['name', 'posts', 'id']);
      expect(whereText(runtime.executions[1]!, 'users')).toBe('id = 1');
    });
  });
});
