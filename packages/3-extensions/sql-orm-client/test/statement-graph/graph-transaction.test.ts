import { describe, expect, it, vi } from 'vitest';
import type { Graph } from '../../src/statement-graph/graph';
import { executeGraph, queryGraph } from '../../src/statement-graph/run-graph';
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
});
