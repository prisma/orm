import { defineAnnotation } from '@internal/framework-components/runtime';
import { BinaryExpr, ColumnRef, OrderByItem, ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it, vi } from 'vitest';
import { After, type ColumnPair, FilterData } from '../../src/mutation-graph/edges';
import type { Graph } from '../../src/mutation-graph/graph';
import { Find } from '../../src/mutation-graph/nodes';
import { printExpression } from '../../src/mutation-graph/print-expression';
import { runForCount, runForFirstRow, runForRows } from '../../src/mutation-graph/run-graph';
import { createCollectionFor } from '../collection-fixtures';
import { createMockRuntime, type MockExecution, type MockRuntime } from '../helpers';
import {
  deletePosts,
  deleteUsers,
  findUsers,
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

function findThenUpdatePost(columns: readonly ColumnPair[]): Graph {
  const graph = graphOfPosts('first row');
  const find = findUsers(
    [nameIsAda],
    columns.map(([sourceColumn]) => sourceColumn),
  );
  const update = updatePosts({ title: 'New' });
  graph.add(find);
  graph.setResult(graph.add(update, new FilterData(find, update, columns)));
  return graph;
}

function findThenDeleteUsers(): Graph {
  const graph = graphOfUsers('rows');
  const find = findUsers([nameIsAda], ['id', 'name']);
  const del = deleteUsers(nameIsAda);
  graph.add(find);
  graph.add(del, new After(find, del));
  graph.setResult(find);
  return graph;
}

describe('running a graph', () => {
  describe('with one node', () => {
    it('returns the rows of an Update, mapped to fields', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 1, name: 'Ada', invited_by_id: 2 }]]);
      const graph = graphOfUsers('rows');
      graph.setResult(graph.add(updateUsers({ name: 'Ada' }, nameIsAda)));

      const rows = await runForRows(graph, runtime, undefined);

      expect(rows).toEqual([{ id: 1, name: 'Ada', invitedById: 2 }]);
      expect(statements(runtime)).toEqual(['query update']);
    });

    it('returns every column of the model when the caller selected nothing', async () => {
      const runtime = createMockRuntime();
      const graph = graphOfUsers('rows');
      graph.setResult(graph.add(deleteUsers(nameIsAda)));

      await runForRows(graph, runtime, undefined);

      expect(returnedColumns(runtime.executions[0]!)).toEqual([
        'address',
        'email',
        'id',
        'invited_by_id',
        'name',
      ]);
    });

    it('returns the selection of the caller from the write', async () => {
      const runtime = createMockRuntime();
      const graph = graphOfUsers('rows', { selectedFields: ['id', 'email'] });
      graph.setResult(graph.add(deleteUsers(nameIsAda)));

      await runForRows(graph, runtime, undefined);

      expect(returnedColumns(runtime.executions[0]!)).toEqual(['id', 'email']);
    });

    it('returns the affected row count of a count result without returning rows', async () => {
      const runtime = createMockRuntime();
      runtime.setNextStats([{ affectedRows: 3 }]);
      const graph = graphOfUsers('count');
      graph.setResult(graph.add(deleteUsers(nameIsAda)));

      expect(await runForCount(graph, runtime, undefined)).toBe(3);
      expect(statements(runtime)).toEqual(['execute delete']);
      expect(returnedColumns(runtime.executions[0]!)).toEqual([]);
    });

    it('returns the first row of a first row result', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 1 }, { id: 2 }]]);
      const graph = graphOfUsers('first row');
      graph.setResult(graph.add(findUsers()));

      expect(await runForFirstRow(graph, runtime, undefined)).toEqual({ id: 1 });
    });

    it('does not open a transaction', async () => {
      const transactional = withTransaction(createMockRuntime());
      const graph = graphOfUsers('rows');
      graph.setResult(graph.add(deleteUsers()));

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
      graph.add(findUsers([nameIsAda]));

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

    it('returns from the Find the columns its statement was built with', async () => {
      const runtime = createMockRuntime();

      await runForRows(findThenDeleteUsers(), runtime, undefined);

      expect(returnedColumns(runtime.executions[0]!)).toEqual(['id', 'name']);
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
    it('skips the target and gives null when the source has no row', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[]]);

      const row = await runForFirstRow(findThenUpdatePost([['id', 'user_id']]), runtime, undefined);

      expect(row).toBeNull();
      expect(statements(runtime)).toEqual(['query select']);
    });

    it('gives zero for a count result that was skipped', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[]]);
      const graph = graphOfPosts('count');
      const find = findUsers([nameIsAda]);
      const del = deletePosts();
      graph.add(find);
      graph.setResult(graph.add(del, new FilterData(find, del, [['id', 'user_id']])));

      expect(await runForCount(graph, runtime, undefined)).toBe(0);
      expect(statements(runtime)).toEqual(['query select']);
    });

    it('skips a node whose source was skipped', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[]]);
      const graph = graphOfPosts('count');
      const find = findUsers([nameIsAda]);
      const update = updatePosts({ title: 'New' });
      const del = deletePosts();
      graph.add(find);
      graph.add(update, new FilterData(find, update, [['id', 'user_id']]));
      graph.setResult(graph.add(del, new FilterData(update, del, [['id', 'id']])));

      expect(await runForCount(graph, runtime, undefined)).toBe(0);
      expect(statements(runtime)).toEqual(['query select']);
    });

    it('adds target = value to the where of the target for a source with one row', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 7 }], [{ id: 70, title: 'New' }]]);

      const row = await runForFirstRow(findThenUpdatePost([['id', 'user_id']]), runtime, undefined);

      expect(row).toEqual({ id: 70, title: 'New' });
      expect(statements(runtime)).toEqual(['query select', 'query update']);
      expect(whereText(runtime.executions[1]!, 'posts')).toBe('user_id = 7');
    });

    it('keeps the where of the target next to the condition of the edge', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 7 }], []]);
      const graph = graphOfPosts('count');
      const find = findUsers([nameIsAda]);
      const del = deletePosts(BinaryExpr.eq(ColumnRef.of('posts', 'title'), ParamRef.of('Old')));
      graph.add(find);
      graph.setResult(graph.add(del, new FilterData(find, del, [['id', 'user_id']])));

      await runForCount(graph, runtime, undefined);

      expect(whereText(runtime.executions[1]!, 'posts')).toBe("(title = 'Old' and user_id = 7)");
    });

    it('adds target in (values) for a source with several rows', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 7 }, { id: 8 }], []]);

      await runForFirstRow(findThenUpdatePost([['id', 'user_id']]), runtime, undefined);

      expect(whereText(runtime.executions[1]!, 'posts')).toBe('user_id in (7, 8)');
    });

    it('compares every column pair for a source with one row', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 7, name: 'Ada' }], []]);
      const graph = findThenUpdatePost([
        ['id', 'user_id'],
        ['name', 'title'],
      ]);

      await runForFirstRow(graph, runtime, undefined);

      expect(whereText(runtime.executions[1]!, 'posts')).toBe("(user_id = 7 and title = 'Ada')");
    });

    it('compares every column pair of every row for a source with several rows', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([
        [
          { id: 7, name: 'Ada' },
          { id: 8, name: 'Grace' },
        ],
        [],
      ]);
      const graph = findThenUpdatePost([
        ['id', 'user_id'],
        ['name', 'title'],
      ]);

      await runForFirstRow(graph, runtime, undefined);

      expect(whereText(runtime.executions[1]!, 'posts')).toBe(
        "((user_id = 7 and title = 'Ada') or (user_id = 8 and title = 'Grace'))",
      );
    });

    it('makes an Update that another node reads from return the columns it is read for', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 7 }], []]);
      const graph = graphOfPosts('rows');
      const update = updateUsers({ name: 'Ada' }, nameIsAda);
      const del = deletePosts();
      graph.add(update);
      graph.setResult(graph.add(del, new FilterData(update, del, [['id', 'user_id']])));

      await runForRows(graph, runtime, undefined);

      expect(statements(runtime)).toEqual(['query update', 'query delete']);
      expect(returnedColumns(runtime.executions[0]!)).toEqual(['id']);
    });
  });

  describe('with a node that reads from the result node', () => {
    it('uses the rows of a Find result for the edge and returns them mapped', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 7, invited_by_id: 2 }]]);
      const graph = graphOfUsers('first row');
      const find = findUsers([nameIsAda], ['id', 'invited_by_id']);
      const del = deleteUsers();
      graph.add(find);
      graph.add(del, new FilterData(find, del, [['id', 'id']]));
      graph.setResult(find);

      const row = await runForFirstRow(graph, runtime, undefined);

      expect(row).toEqual({ id: 7, invitedById: 2 });
      expect(statements(runtime)).toEqual(['query select', 'execute delete']);
      expect(whereText(runtime.executions[1]!, 'users')).toBe('id = 7');
    });

    it('returns the columns the edge reads next to the selection and leaves them out of the rows', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ name: 'Ada', id: 7 }]]);
      const graph = graphOfUsers('rows', { selectedFields: ['name'] });
      const update = updateUsers({ name: 'Ada' }, nameIsAda);
      const del = deletePosts();
      graph.add(update);
      graph.add(del, new FilterData(update, del, [['id', 'user_id']]));
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
      const update = updateUsers({ name: 'Ada' }, nameIsAda);
      const del = deletePosts();
      graph.add(update);
      graph.add(del, new FilterData(update, del, [['id', 'user_id']]));
      graph.setResult(update);

      expect(await runForCount(graph, runtime, undefined)).toBe(2);
      expect(statements(runtime)).toEqual(['query update', 'execute delete']);
    });
  });

  describe('with includes', () => {
    it('returns identity columns from a write and loads the rows with their includes', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 1 }], [{ id: 1, name: 'Ada', posts: [] }]]);
      const graph = graphOfUsers('rows', { includes: userIncludes() });
      graph.setResult(graph.add(updateUsers({ name: 'Ada' }, nameIsAda)));

      const rows = await runForRows(graph, runtime, auditAnnotations);

      expect(rows).toEqual([{ id: 1, name: 'Ada', posts: [] }]);
      expect(statements(runtime)).toEqual(['query update', 'query select']);
      expect(returnedColumns(runtime.executions[0]!)).toEqual(['id']);
      expect(runtime.executions.map((execution) => auditAnnotation.read(execution.plan))).toEqual([
        { actor: 'system' },
        { actor: 'system' },
      ]);
    });

    it('loads the rows of a Find result with their includes before the next node runs', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 1 }], [{ id: 1, name: 'Ada', posts: [] }]]);
      const graph = graphOfUsers('rows', { includes: userIncludes() });
      const find = findUsers([nameIsAda]);
      const del = deleteUsers(nameIsAda);
      graph.add(find);
      graph.add(del, new After(find, del));
      graph.setResult(find);

      const rows = await runForRows(graph, runtime, undefined);

      expect(rows).toEqual([{ id: 1, name: 'Ada', posts: [] }]);
      expect(statements(runtime)).toEqual(['query select', 'query select', 'execute delete']);
      expect(whereText(runtime.executions[1]!, 'users')).toBe('id in (1)');
    });

    it('orders the load by the order of the Find', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 1 }], []]);
      const orderBy = [OrderByItem.desc(ColumnRef.of('users', 'name'))];
      const graph = graphOfUsers('rows', { includes: userIncludes() });
      graph.setResult(graph.add(new Find(findUsers([nameIsAda]).ast.withOrderBy(orderBy))));

      await runForRows(graph, runtime, undefined);

      expect(astOf(runtime.executions[1]!)).toMatchObject({ kind: 'select', orderBy });
    });
  });
});
