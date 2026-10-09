import { defineAnnotation } from '@internal/framework-components/runtime';
import { BinaryExpr, ColumnRef, ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it, vi } from 'vitest';
import { After, IntoWhere } from '../../src/mutation-graph/edges';
import { Graph, type ResultForm } from '../../src/mutation-graph/graph';
import { Delete, Find, type Node, Update } from '../../src/mutation-graph/nodes';
import { printExpression } from '../../src/mutation-graph/print-expression';
import {
  type RunOptions,
  runForCount,
  runForFirstRow,
  runForRows,
} from '../../src/mutation-graph/run-graph';
import {
  createMockRuntime,
  getTestContext,
  type MockExecution,
  type MockRuntime,
} from '../helpers';
import { postsTable, usersTable } from './tables';

const auditAnnotation = defineAnnotation<{ actor: string }>()({
  namespace: 'audit',
  applicableTo: ['write'],
});

const nameIsAda = BinaryExpr.eq(ColumnRef.of('users', 'name'), ParamRef.of('Ada'));

function optionsFor(runtime: MockRuntime): RunOptions {
  return { context: getTestContext(), runtime, annotations: undefined };
}

function setResult(graph: Graph, node: Node | undefined, form: ResultForm): void {
  graph.setResult({ node, form, selectedFields: undefined, includes: [] });
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

function findThenUpdate(columns: readonly (readonly [string, string])[]) {
  const graph = new Graph();
  const find = new Find(usersTable, [nameIsAda]);
  const update = new Update(postsTable, { title: 'New' }, []);
  graph.add(find);
  graph.add(update, new IntoWhere(find, update, columns));
  setResult(graph, update, 'first row');
  return graph;
}

describe('running a graph', () => {
  describe('with one node', () => {
    it('returns the rows of an Update, mapped to fields', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 1, name: 'Ada', invited_by_id: 2 }]]);
      const graph = new Graph();
      setResult(graph, graph.add(new Update(usersTable, { name: 'Ada' }, [nameIsAda])), 'rows');

      const rows = await runForRows(graph, optionsFor(runtime));

      expect(rows).toEqual([{ id: 1, name: 'Ada', invitedById: 2 }]);
      expect(statements(runtime)).toEqual(['query update']);
    });

    it('returns the selection of the caller from the write', async () => {
      const runtime = createMockRuntime();
      const graph = new Graph();
      const del = graph.add(new Delete(usersTable, [nameIsAda]));
      graph.setResult({ node: del, form: 'rows', selectedFields: ['id', 'email'], includes: [] });

      await runForRows(graph, optionsFor(runtime));

      expect(returnedColumns(runtime.executions[0]!)).toEqual(['id', 'email']);
    });

    it('returns the affected row count of a count result without returning rows', async () => {
      const runtime = createMockRuntime();
      runtime.setNextStats([{ affectedRows: 3 }]);
      const graph = new Graph();
      setResult(graph, graph.add(new Delete(usersTable, [nameIsAda])), 'count');

      expect(await runForCount(graph, optionsFor(runtime))).toBe(3);
      expect(statements(runtime)).toEqual(['execute delete']);
    });

    it('returns the first row of a first row result', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 1 }, { id: 2 }]]);
      const graph = new Graph();
      setResult(graph, graph.add(new Find(usersTable, [])), 'first row');

      expect(await runForFirstRow(graph, optionsFor(runtime))).toEqual({ id: 1 });
    });

    it('does not open a transaction', async () => {
      const transactional = withTransaction(createMockRuntime());
      const graph = new Graph();
      setResult(graph, graph.add(new Delete(usersTable, [])), 'rows');

      await runForRows(graph, optionsFor(transactional.runtime));

      expect(transactional.open).not.toHaveBeenCalled();
    });
  });

  describe('with an empty result', () => {
    it('gives no rows, null and zero, and executes nothing when the graph has no node', async () => {
      const runtime = createMockRuntime();
      const rows = new Graph();
      setResult(rows, undefined, 'rows');
      const firstRow = new Graph();
      setResult(firstRow, undefined, 'first row');
      const count = new Graph();
      setResult(count, undefined, 'count');

      expect(await runForRows(rows, optionsFor(runtime))).toEqual([]);
      expect(await runForFirstRow(firstRow, optionsFor(runtime))).toBeNull();
      expect(await runForCount(count, optionsFor(runtime))).toBe(0);
      expect(runtime.executions).toEqual([]);
    });

    it('still executes the nodes of the graph', async () => {
      const runtime = createMockRuntime();
      const graph = new Graph();
      graph.add(new Find(usersTable, [nameIsAda]));
      setResult(graph, undefined, 'first row');

      expect(await runForFirstRow(graph, optionsFor(runtime))).toBeNull();
      expect(statements(runtime)).toEqual(['query select']);
    });
  });

  describe('with a Find and a Delete after it', () => {
    function findThenDelete() {
      const graph = new Graph();
      const find = new Find(usersTable, [nameIsAda]);
      const del = new Delete(usersTable, [nameIsAda]);
      graph.add(find);
      graph.add(del, new After(find, del));
      setResult(graph, find, 'rows');
      return graph;
    }

    it('reads the rows, then deletes with the count form, and returns the rows read', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 1, name: 'Ada' }]]);

      const rows = await runForRows(findThenDelete(), optionsFor(runtime));

      expect(rows).toEqual([{ id: 1, name: 'Ada' }]);
      expect(statements(runtime)).toEqual(['query select', 'execute delete']);
    });

    it('executes nothing until the rows are asked for', async () => {
      const runtime = createMockRuntime();

      runForRows(findThenDelete(), optionsFor(runtime));
      await Promise.resolve();

      expect(runtime.executions).toEqual([]);
    });

    it('runs in one transaction that it commits', async () => {
      const transactional = withTransaction(createMockRuntime());

      await runForRows(findThenDelete(), optionsFor(transactional.runtime));

      expect(transactional.open).toHaveBeenCalledTimes(1);
      expect(transactional.commit).toHaveBeenCalledTimes(1);
      expect(transactional.rollback).not.toHaveBeenCalled();
    });

    it('rolls the transaction back when a statement fails', async () => {
      const transactional = withTransaction(createMockRuntime());
      transactional.runtime.execute = async () => {
        throw new Error('delete failed');
      };

      await expect(runForRows(findThenDelete(), optionsFor(transactional.runtime))).rejects.toThrow(
        'delete failed',
      );
      expect(transactional.rollback).toHaveBeenCalledTimes(1);
      expect(transactional.commit).not.toHaveBeenCalled();
    });

    it('puts the annotations of the caller on every statement', async () => {
      const runtime = createMockRuntime();
      const annotation = auditAnnotation({ actor: 'system' });

      await runForRows(findThenDelete(), {
        ...optionsFor(runtime),
        annotations: new Map([[annotation.namespace, annotation]]),
      });

      expect(runtime.executions.map((execution) => auditAnnotation.read(execution.plan))).toEqual([
        { actor: 'system' },
        { actor: 'system' },
      ]);
    });
  });

  describe('with an IntoWhere edge', () => {
    it('makes the source return the source columns of the edge', async () => {
      const runtime = createMockRuntime();

      await runForFirstRow(findThenUpdate([['id', 'user_id']]), optionsFor(runtime));

      expect(returnedColumns(runtime.executions[0]!)).toEqual(['id']);
    });

    it('skips the target and gives null when the source has no row', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[]]);

      const row = await runForFirstRow(findThenUpdate([['id', 'user_id']]), optionsFor(runtime));

      expect(row).toBeNull();
      expect(statements(runtime)).toEqual(['query select']);
    });

    it('gives zero for a count result that was skipped', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[]]);
      const graph = new Graph();
      const find = new Find(usersTable, [nameIsAda]);
      const del = new Delete(postsTable, []);
      graph.add(find);
      graph.add(del, new IntoWhere(find, del, [['id', 'user_id']]));
      setResult(graph, del, 'count');

      expect(await runForCount(graph, optionsFor(runtime))).toBe(0);
      expect(statements(runtime)).toEqual(['query select']);
    });

    it('skips a node whose source was skipped', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[]]);
      const graph = new Graph();
      const find = new Find(usersTable, [nameIsAda]);
      const update = new Update(postsTable, { title: 'New' }, []);
      const del = new Delete(postsTable, []);
      graph.add(find);
      graph.add(update, new IntoWhere(find, update, [['id', 'user_id']]));
      graph.add(del, new IntoWhere(update, del, [['id', 'id']]));
      setResult(graph, del, 'count');

      expect(await runForCount(graph, optionsFor(runtime))).toBe(0);
      expect(statements(runtime)).toEqual(['query select']);
    });

    it('adds target = value to the where of the target for a source with one row', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 7 }], [{ id: 70, title: 'New' }]]);

      const row = await runForFirstRow(findThenUpdate([['id', 'user_id']]), optionsFor(runtime));

      expect(row).toEqual({ id: 70, title: 'New' });
      expect(statements(runtime)).toEqual(['query select', 'query update']);
      expect(whereText(runtime.executions[1]!, 'posts')).toBe('user_id = 7');
    });

    it('keeps the where of the target next to the condition of the edge', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 7 }], []]);
      const graph = new Graph();
      const find = new Find(usersTable, [nameIsAda]);
      const del = new Delete(postsTable, [
        BinaryExpr.eq(ColumnRef.of('posts', 'title'), ParamRef.of('Old')),
      ]);
      graph.add(find);
      graph.add(del, new IntoWhere(find, del, [['id', 'user_id']]));
      setResult(graph, del, 'count');

      await runForCount(graph, optionsFor(runtime));

      expect(whereText(runtime.executions[1]!, 'posts')).toBe("(title = 'Old' and user_id = 7)");
    });

    it('adds target in (values) for a source with several rows', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 7 }, { id: 8 }], []]);

      await runForFirstRow(findThenUpdate([['id', 'user_id']]), optionsFor(runtime));

      expect(whereText(runtime.executions[1]!, 'posts')).toBe('user_id in (7, 8)');
    });

    it('compares every column pair for a source with one row', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 7, name: 'Ada' }], []]);
      const graph = findThenUpdate([
        ['id', 'user_id'],
        ['name', 'title'],
      ]);

      await runForFirstRow(graph, optionsFor(runtime));

      expect(returnedColumns(runtime.executions[0]!)).toEqual(['id', 'name']);
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
      const graph = findThenUpdate([
        ['id', 'user_id'],
        ['name', 'title'],
      ]);

      await runForFirstRow(graph, optionsFor(runtime));

      expect(whereText(runtime.executions[1]!, 'posts')).toBe(
        "((user_id = 7 and title = 'Ada') or (user_id = 8 and title = 'Grace'))",
      );
    });

    it('makes an Update that another node reads from return the columns it is read for', async () => {
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 7 }], []]);
      const graph = new Graph();
      const update = new Update(usersTable, { name: 'Ada' }, [nameIsAda]);
      const del = new Delete(postsTable, []);
      graph.add(update);
      graph.add(del, new IntoWhere(update, del, [['id', 'user_id']]));
      setResult(graph, del, 'rows');

      await runForRows(graph, optionsFor(runtime));

      expect(statements(runtime)).toEqual(['query update', 'query delete']);
      expect(returnedColumns(runtime.executions[0]!)).toEqual(['id']);
    });
  });

  describe('refusals', () => {
    it('refuses a graph with no result', async () => {
      await expect(runForCount(new Graph(), optionsFor(createMockRuntime()))).rejects.toThrow(
        'has no result',
      );
    });

    it('refuses a result of another form', () => {
      const graph = new Graph();
      setResult(graph, graph.add(new Delete(usersTable, [])), 'count');

      expect(() => runForRows(graph, optionsFor(createMockRuntime()))).toThrow(
        'result is count, not rows',
      );
    });

    it('refuses a node that reads from the result node', async () => {
      const runtime = createMockRuntime();
      const graph = new Graph();
      const update = new Update(usersTable, { name: 'Ada' }, []);
      const del = new Delete(postsTable, []);
      graph.add(update);
      graph.add(del, new IntoWhere(update, del, [['id', 'user_id']]));
      setResult(graph, update, 'rows');

      await expect(runForRows(graph, optionsFor(runtime))).rejects.toThrow(
        'cannot read from the result node',
      );
    });
  });
});
