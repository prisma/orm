import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { SqlExecutionPlan, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as queryPlan from '../src/query-plan';
import { createCollectionFor } from './collection-fixtures';

function setup(rows: Record<string, unknown>[], failure?: Error) {
  const { collection, runtime } = createCollectionFor('Post');
  const events: string[] = [];
  runtime.query = <Row>(plan: (SqlExecutionPlan | SqlQueryPlan) & { readonly _row?: Row }) => {
    events.push('query');
    runtime.executions.push({ operation: 'query', plan, rows });
    return new AsyncIterableResult(
      (async function* () {
        try {
          for (const row of rows) {
            events.push('row');
            yield row as Row;
          }
          if (failure) throw failure;
        } finally {
          events.push('source closed');
        }
      })(),
    );
  };
  Object.assign(runtime, {
    async connection() {
      events.push('acquire');
      return {
        query: runtime.query.bind(runtime),
        execute: runtime.execute.bind(runtime),
        async release() {
          events.push('release');
        },
      };
    },
  });
  return { collection, runtime, events };
}

afterEach(() => vi.restoreAllMocks());

describe('ordinary row lifecycle', () => {
  it('streams plain mapped rows and closes the source on cancellation', async () => {
    const { collection, events } = setup([{ user_id: 1 }, { user_id: 2 }]);
    const result = collection.select('userId').all();
    expect(events).toEqual(['query']);
    for await (const row of result) {
      expect(row).toEqual({ userId: 1 });
      expect(events).toEqual(['query', 'row']);
      break;
    }
    expect(events).toEqual(['query', 'row', 'source closed']);
  });

  it('acquires lazily, buffers includes and releases on cancellation', async () => {
    const { collection, events } = setup([
      { user_id: 1, author: [{ name: 'Alice' }] },
      { user_id: 2, author: [] },
    ]);
    const result = collection
      .select('userId')
      .include('author', (user) => user.select('name'))
      .all();
    expect(events).toEqual([]);
    for await (const row of result) {
      expect(row).toEqual({ userId: 1, author: { name: 'Alice' } });
      expect(events).toEqual(['acquire', 'query', 'row', 'row', 'source closed']);
      break;
    }
    expect(events).toEqual(['acquire', 'query', 'row', 'row', 'source closed', 'release']);
  });

  it('first drains the ordinary result and releases its include scope', async () => {
    const { collection, events } = setup([{ user_id: 1, author: [] }]);
    expect(
      await collection
        .select('userId')
        .include('author', (user) => user.select('name'))
        .first(),
    ).toEqual({
      userId: 1,
      author: null,
    });
    expect(events).toEqual(['acquire', 'query', 'row', 'source closed', 'release']);
  });

  it('releases after include source failure without yielding buffered parents', async () => {
    const failure = new Error('source failed');
    const { collection, events } = setup([{ user_id: 1, author: [] }], failure);
    const observed: unknown[] = [];
    await expect(
      (async () => {
        for await (const row of collection
          .select('userId')
          .include('author', (user) => user.select('name'))
          .all())
          observed.push(row);
      })(),
    ).rejects.toBe(failure);
    expect(observed).toEqual([]);
    expect(events).toEqual(['acquire', 'query', 'row', 'source closed', 'release']);
  });

  it('releases after include decoding failure without yielding buffered parents', async () => {
    const { collection, events } = setup([
      { user_id: 1, author: [] },
      { user_id: 2, author: [42] },
    ]);
    const observed: unknown[] = [];
    await expect(
      (async () => {
        for await (const row of collection
          .select('userId')
          .include('author', (user) => user.select('name'))
          .all())
          observed.push(row);
      })(),
    ).rejects.toThrow('Include row envelope');
    expect(observed).toEqual([]);
    expect(events).toEqual(['acquire', 'query', 'row', 'row', 'source closed', 'release']);
  });

  it('compiles includes only after acquisition and releases on compilation failure', async () => {
    const { collection, events } = setup([]);
    const failure = new Error('compile failed');
    vi.spyOn(queryPlan, 'compileSelectWithIncludes').mockImplementationOnce(() => {
      throw failure;
    });
    const result = collection
      .select('userId')
      .include('author', (user) => user.select('name'))
      .all();
    expect(events).toEqual([]);
    await expect(result.toArray()).rejects.toBe(failure);
    expect(events).toEqual(['acquire', 'release']);
  });

  it('mutation read-back preserves projection and releases when taking its first row', async () => {
    const { collection, runtime, events } = setup([{ user_id: 1, author: [{ name: 'Alice' }] }]);
    const scopeQuery = runtime.query;
    runtime.query = <Row>(_plan: (SqlExecutionPlan | SqlQueryPlan) & { readonly _row?: Row }) => {
      events.push('mutation');
      runtime.query = scopeQuery;
      return new AsyncIterableResult(
        (async function* () {
          yield { id: 10 } as Row;
        })(),
      );
    };
    const result = await collection
      .select('userId')
      .include('author', (user) => user.select('name'))
      .create({
        id: 10,
        title: 'Post',
        userId: 1,
        views: 0,
      });
    expect(result).toEqual({ userId: 1, author: { name: 'Alice' } });
    expect(events).toEqual(['mutation', 'acquire', 'query', 'row', 'source closed', 'release']);
  });
});
