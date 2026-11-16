import { AsyncIterableResult } from '@internal/framework-components/runtime';
import { describe, expect, it, vi } from 'vitest';
import type { Graph } from '../../src/statement-graph/graph';
import { executeGraph, queryGraph } from '../../src/statement-graph/run-graph';
import { baseContract, createCollectionFor, withoutCapabilityKeys } from '../collection-fixtures';
import { createMockRuntime, type MockRuntime } from '../helpers';
import {
  addFiltered,
  columnMappings,
  contextOf,
  findUsers,
  nameIsAda,
  newGraph,
  rowsOfUsers,
  updateUsers,
} from './statements';

const sameIds = columnMappings('users', 'users', [['id', 'id']]);

function withTransaction(runtime: MockRuntime) {
  const open = vi.fn(async () => ({
    query: runtime.query.bind(runtime),
    execute: runtime.execute.bind(runtime),
    commit: async () => undefined,
    rollback: async () => undefined,
  }));
  return { runtime: Object.assign(runtime, { transaction: open }), open };
}

function twoReads(): Graph {
  const graph = newGraph();
  const first = graph.add(findUsers([nameIsAda]), {});
  graph.setResult(addFiltered(graph, findUsers(), [first, sameIds]));
  return graph;
}

function readThenWrite(): Graph {
  const graph = newGraph();
  const find = graph.add(findUsers([nameIsAda]), {});
  graph.setResult(addFiltered(graph, updateUsers({ name: 'Bea' }), [find, sameIds]));
  return graph;
}

describe('whether a graph writes', () => {
  it('reports no write for a graph of reads', () => {
    expect(twoReads().writesAnyTable).toBe(false);
  });

  it('reports a write for a graph with a write', () => {
    expect(readThenWrite().writesAnyTable).toBe(true);
  });
});

describe('the transaction a graph runs in', () => {
  it('opens none for a graph of several reads', async () => {
    const transactional = withTransaction(createMockRuntime());
    transactional.runtime.setNextResults([[{ id: 1 }], [{ id: 1 }]]);

    await queryGraph(twoReads(), contextOf(transactional.runtime), rowsOfUsers()).toArray();

    expect({
      opened: transactional.open.mock.calls.length,
      statements: transactional.runtime.executions.length,
    }).toEqual({ opened: 0, statements: 2 });
  });

  it('opens one for a graph of several statements that writes', async () => {
    const transactional = withTransaction(createMockRuntime());
    transactional.runtime.setNextResults([[{ id: 1 }]]);

    await executeGraph(readThenWrite(), contextOf(transactional.runtime));

    expect(transactional.open).toHaveBeenCalledTimes(1);
  });

  it('opens none for an update with includes that writes nothing, which only reads', async () => {
    const { collection, runtime } = createCollectionFor('User');
    const transactional = withTransaction(runtime);
    transactional.runtime.setNextResults([[{ id: 1 }], [{ id: 1, posts: '[]' }]]);
    const users = collection.include('posts').where({ id: 1 }) as unknown as {
      update(data: unknown): Promise<unknown>;
    };

    await users.update({
      posts: (posts: { connect(rows: unknown[]): unknown }) => posts.connect([]),
    });

    expect({
      opened: transactional.open.mock.calls.length,
      statements: transactional.runtime.executions.length,
    }).toEqual({ opened: 0, statements: 2 });
  });

  it('runs an update with includes read one query per relation inside the transaction of the write', async () => {
    const { collection, runtime } = createCollectionFor(
      'User',
      withoutCapabilityKeys(baseContract, [
        'outerReferencesInDerivedTables',
        'jsonAggWithoutTruncation',
      ]),
    );
    const throughTransaction: string[] = [];
    const commit = vi.fn(async () => undefined);
    Object.assign(runtime, {
      transaction: vi.fn(async () => ({
        query: (...args: Parameters<MockRuntime['query']>) => {
          throughTransaction.push('query');
          return runtime.query(...args);
        },
        execute: (...args: Parameters<MockRuntime['execute']>) => {
          throughTransaction.push('execute');
          return runtime.execute(...args);
        },
        commit,
        rollback: async () => undefined,
      })),
    });
    runtime.setNextResults([[{ id: 1 }], [{ id: 1, name: 'Bea' }], []]);
    const users = collection.include('posts').where({ name: 'Ada' }) as unknown as {
      update(data: unknown): Promise<unknown>;
    };

    await users.update({ name: 'Bea' });

    expect({
      statements: runtime.executions.length,
      throughTransaction: throughTransaction.length,
      committed: commit.mock.calls.length,
    }).toEqual({ statements: 3, throughTransaction: 3, committed: 1 });
  });

  it('rolls the write back when a statement of its includes fails', async () => {
    const { collection, runtime } = createCollectionFor(
      'User',
      withoutCapabilityKeys(baseContract, [
        'outerReferencesInDerivedTables',
        'jsonAggWithoutTruncation',
      ]),
    );
    const commit = vi.fn(async () => undefined);
    const rollback = vi.fn(async () => undefined);
    let statements = 0;
    const failingThird = <Row>(sent: () => AsyncIterableResult<Row>): AsyncIterableResult<Row> => {
      statements += 1;
      if (statements < 3) {
        return sent();
      }
      return new AsyncIterableResult(
        (async function* (): AsyncGenerator<Row, void, unknown> {
          yield* [];
          throw new Error('the include statement failed');
        })(),
      );
    };
    Object.assign(runtime, {
      transaction: vi.fn(async () => ({
        query: (...args: Parameters<MockRuntime['query']>) =>
          failingThird(() => runtime.query(...args)),
        execute: (...args: Parameters<MockRuntime['execute']>) => {
          statements += 1;
          return runtime.execute(...args);
        },
        commit,
        rollback,
      })),
    });
    runtime.setNextResults([[{ id: 1 }], [{ id: 1, name: 'Bea' }], []]);
    const users = collection.include('posts').where({ name: 'Ada' }) as unknown as {
      update(data: unknown): Promise<unknown>;
    };

    await expect(users.update({ name: 'Bea' })).rejects.toThrow('the include statement failed');
    expect({
      committed: commit.mock.calls.length,
      rolledBack: rollback.mock.calls.length,
    }).toEqual({ committed: 0, rolledBack: 1 });
  });
});
