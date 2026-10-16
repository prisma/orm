import { AsyncIterableResult, defineAnnotation } from '@internal/framework-components/runtime';
import { describe, expect, it } from 'vitest';
import {
  modelHashInput,
  type OrmCall,
  ormResults,
  runOrmCall,
  streamOrmCall,
} from '../src/orm-call';
import { createMockRuntime } from './helpers';
import { createActivityRuntime, ormCallHash } from './orm-call-fixtures';

const cache = defineAnnotation<{ ttl: number }>()({ namespace: 'cache', applicableTo: ['read'] });
const annotated = new Map([['cache', cache({ ttl: 60 })]]);

function rowsCall(
  annotations: OrmCall<unknown>['annotations'] = annotated,
): OrmCall<{ id: number }[]> {
  return {
    method: 'all',
    annotations,
    hashInput: modelHashInput('public', 'User'),
    accepts: ormResults.rows,
  };
}

function valueCall(): OrmCall<number> {
  return {
    method: 'count',
    annotations: undefined,
    hashInput: modelHashInput('public', 'User'),
    accepts: ormResults.count,
  };
}

function stream<Row>(rows: readonly Row[], failure?: Error): AsyncIterableResult<Row> {
  return new AsyncIterableResult(
    (async function* () {
      yield* rows;
      if (failure) throw failure;
    })(),
  );
}

describe('runOrmCall', () => {
  it('rejects on a queryable without an activity source, running nothing', async () => {
    const bare = { query: createMockRuntime().query, execute: createMockRuntime().execute };
    let ran = false;

    await expect(
      runOrmCall(bare, valueCall(), async () => {
        ran = true;
        return 3;
      }),
    ).rejects.toMatchObject({ code: 'ORM.ACTIVITY_SOURCE_MISSING', meta: { method: 'count' } });
    expect(ran).toBe(false);
  });

  it('starts an orm-call, runs on its handle and ends it with the result', async () => {
    const { runtime, calls } = createActivityRuntime();
    let ranOnHandle = false;

    const result = await runOrmCall(runtime, valueCall(), async (queryable) => {
      ranOnHandle = queryable !== runtime;
      return 3;
    });

    expect({ result, ranOnHandle, calls }).toEqual({
      result: 3,
      ranOnHandle: true,
      calls: [
        {
          activity: {
            id: 'call-1',
            kind: 'orm-call',
            contentHash: expect.any(Function),
            annotations: new Map(),
          },
          statements: [],
          transactions: [],
          ended: { outcome: 'succeeded', result: 3 },
        },
      ],
    });
    expect(await calls[0]!.activity.contentHash()).toBe(
      await ormCallHash('count', { namespace: 'public', model: 'User' }),
    );
  });

  it('ends the call failed with no result when the terminal throws', async () => {
    const { runtime, calls } = createActivityRuntime();
    const failure = new Error('statement failed');

    await expect(
      runOrmCall(runtime, valueCall(), async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(calls.map(({ ended }) => ended)).toEqual([{ outcome: 'failed' }]);
  });

  it('rejects with the error that failed the call, with the end error as its cause, when ending it also rejects', async () => {
    const endError = new Error('children open');
    const { runtime, calls } = createActivityRuntime({ endRejects: endError });
    const failure = new Error('statement failed');

    await expect(
      runOrmCall(runtime, valueCall(), async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect({ cause: failure.cause, ended: calls.map(({ ended }) => ended) }).toEqual({
      cause: endError,
      ended: [{ outcome: 'failed' }],
    });
  });

  it('keeps the cause the failing error already has when ending the call also rejects', async () => {
    const { runtime } = createActivityRuntime({ endRejects: new Error('children open') });
    const original = new Error('connection reset');
    const failure = new Error('statement failed', { cause: original });

    await expect(
      runOrmCall(runtime, valueCall(), async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(failure.cause).toBe(original);
  });

  it('rejects an invalid intercepted result with its own error when ending the call also rejects', async () => {
    const endError = new Error('hook failed');
    const { runtime } = createActivityRuntime({
      intercept: () => ({ result: 'seven' }),
      endRejects: endError,
    });

    await expect(runOrmCall(runtime, valueCall(), async () => 3)).rejects.toMatchObject({
      code: 'ORM.INTERCEPTED_RESULT_INVALID',
      cause: endError,
    });
  });

  it('returns an intercepted result without running and ends the call with no result', async () => {
    const { runtime, calls } = createActivityRuntime({ intercept: () => ({ result: 7 }) });
    let ran = false;

    const result = await runOrmCall(runtime, valueCall(), async () => {
      ran = true;
      return 3;
    });

    expect({ result, ran, ended: calls.map(({ ended }) => ended) }).toEqual({
      result: 7,
      ran: false,
      ended: [{ outcome: 'succeeded' }],
    });
  });

  it('rejects an intercepted result of the wrong shape and ends the call failed', async () => {
    const { runtime, calls } = createActivityRuntime({ intercept: () => ({ result: 'seven' }) });

    await expect(runOrmCall(runtime, valueCall(), async () => 3)).rejects.toMatchObject({
      code: 'ORM.INTERCEPTED_RESULT_INVALID',
      meta: { method: 'count' },
    });
    expect(calls.map(({ ended }) => ended)).toEqual([{ outcome: 'failed' }]);
  });
});

describe('streamOrmCall', () => {
  it('throws on a queryable without an activity source', () => {
    const bare = { query: createMockRuntime().query, execute: createMockRuntime().execute };

    expect(() => streamOrmCall(bare, rowsCall(), () => stream([{ id: 1 }]))).toThrow(
      expect.objectContaining({ code: 'ORM.ACTIVITY_SOURCE_MISSING' }),
    );
  });

  it('ends an annotated call succeeded with the rows the caller read', async () => {
    const { runtime, calls } = createActivityRuntime();

    const rows = await streamOrmCall(runtime, rowsCall(), () => stream([{ id: 1 }, { id: 2 }]));

    expect({ rows, calls: calls.map(({ activity, ended }) => ({ activity, ended })) }).toEqual({
      rows: [{ id: 1 }, { id: 2 }],
      calls: [
        {
          activity: expect.objectContaining({ kind: 'orm-call', annotations: annotated }),
          ended: { outcome: 'succeeded', result: [{ id: 1 }, { id: 2 }] },
        },
      ],
    });
  });

  it('does not hold the rows of an unannotated call', async () => {
    const { runtime, calls } = createActivityRuntime();

    await streamOrmCall(runtime, rowsCall(new Map()), () => stream([{ id: 1 }]));

    expect(calls.map(({ ended }) => ended)).toEqual([{ outcome: 'succeeded' }]);
  });

  it('ends the call stopped when the caller stops reading early', async () => {
    const { runtime, calls } = createActivityRuntime();

    for await (const _row of streamOrmCall(runtime, rowsCall(), () =>
      stream([{ id: 1 }, { id: 2 }]),
    )) {
      break;
    }

    expect(calls.map(({ ended }) => ended)).toEqual([{ outcome: 'stopped' }]);
  });

  it('ends the call failed when the stream fails', async () => {
    const { runtime, calls } = createActivityRuntime();
    const failure = new Error('stream failed');

    await expect(
      streamOrmCall(runtime, rowsCall(), () => stream([{ id: 1 }], failure)).toArray(),
    ).rejects.toBe(failure);
    expect(calls.map(({ ended }) => ended)).toEqual([{ outcome: 'failed' }]);
  });

  it('rejects with the stream error when ending the failed call also rejects', async () => {
    const { runtime, calls } = createActivityRuntime({ endRejects: new Error('children open') });
    const failure = new Error('stream failed');

    await expect(
      streamOrmCall(runtime, rowsCall(), () => stream([{ id: 1 }], failure)).toArray(),
    ).rejects.toBe(failure);
    expect(calls.map(({ ended }) => ended)).toEqual([{ outcome: 'failed' }]);
  });

  it('streams intercepted rows without running and ends the call with no result', async () => {
    const { runtime, calls } = createActivityRuntime({
      intercept: () => ({ result: [{ id: 9 }] }),
    });
    let ran = false;

    const rows = await streamOrmCall(runtime, rowsCall(), () => {
      ran = true;
      return stream([{ id: 1 }]);
    });

    expect({ rows, ran, ended: calls.map(({ ended }) => ended) }).toEqual({
      rows: [{ id: 9 }],
      ran: false,
      ended: [{ outcome: 'succeeded' }],
    });
  });

  describe('with overlapping calls on its iterator', () => {
    const rowsOf = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ id: index + 1 }));
    const iterate = (runtime: Parameters<typeof streamOrmCall>[0], count: number) =>
      streamOrmCall(runtime, rowsCall(), () => stream(rowsOf(count)))[
        Symbol.asyncIterator
      ]() as AsyncGenerator<{ id: number }, void, unknown>;
    const endedOf = (calls: { ended: unknown }[]) => calls.map(({ ended }) => ended);

    it('gives each of two next() calls made before the first row its own row', async () => {
      const { runtime, calls } = createActivityRuntime();
      const rows = iterate(runtime, 2);

      const results = await Promise.all([rows.next(), rows.next(), rows.next()]);

      expect({ results, ended: endedOf(calls) }).toEqual({
        results: [
          { done: false, value: { id: 1 } },
          { done: false, value: { id: 2 } },
          { done: true, value: undefined },
        ],
        ended: [{ outcome: 'succeeded', result: [{ id: 1 }, { id: 2 }] }],
      });
    });

    it('ends the call stopped once when return() comes while the call is starting', async () => {
      const { runtime, calls } = createActivityRuntime();
      const rows = iterate(runtime, 2);

      const results = await Promise.allSettled([rows.next(), rows.return()]);

      expect({ results, ended: endedOf(calls) }).toEqual({
        results: [
          { status: 'fulfilled', value: { done: false, value: { id: 1 } } },
          { status: 'fulfilled', value: { done: true, value: undefined } },
        ],
        ended: [{ outcome: 'stopped' }],
      });
    });

    it('ends the call stopped once when return() comes while a next() is pending', async () => {
      const { runtime, calls } = createActivityRuntime();
      const rows = iterate(runtime, 3);
      await rows.next();

      const results = await Promise.allSettled([rows.next(), rows.return()]);

      expect({ results, ended: endedOf(calls) }).toEqual({
        results: [
          { status: 'fulfilled', value: { done: false, value: { id: 2 } } },
          { status: 'fulfilled', value: { done: true, value: undefined } },
        ],
        ended: [{ outcome: 'stopped' }],
      });
    });

    it('ends the call once when two next() calls overlap at the end of the stream', async () => {
      const { runtime, calls } = createActivityRuntime();
      const rows = iterate(runtime, 1);
      await rows.next();

      const results = await Promise.allSettled([rows.next(), rows.next()]);

      expect({ results, ended: endedOf(calls) }).toEqual({
        results: [
          { status: 'fulfilled', value: { done: true, value: undefined } },
          { status: 'fulfilled', value: { done: true, value: undefined } },
        ],
        ended: [{ outcome: 'succeeded', result: [{ id: 1 }] }],
      });
    });

    it('ends the call once when next() and return() overlap at the end of the stream', async () => {
      const { runtime, calls } = createActivityRuntime();
      const rows = iterate(runtime, 1);
      await rows.next();

      const results = await Promise.allSettled([rows.next(), rows.return()]);

      expect({ results, ended: endedOf(calls) }).toEqual({
        results: [
          { status: 'fulfilled', value: { done: true, value: undefined } },
          { status: 'fulfilled', value: { done: true, value: undefined } },
        ],
        ended: [{ outcome: 'succeeded', result: [{ id: 1 }] }],
      });
    });

    it('starts no call when return() or throw() comes before the first next()', async () => {
      const { runtime, calls } = createActivityRuntime();
      const failure = new Error('stop');

      const returned = await iterate(runtime, 1).return();
      const thrown = iterate(runtime, 1).throw(failure);

      await expect(thrown).rejects.toBe(failure);
      expect({ returned, calls: calls.length }).toEqual({
        returned: { done: true, value: undefined },
        calls: 0,
      });
    });

    it('ends the call failed when an error is thrown into it mid-stream', async () => {
      const { runtime, calls } = createActivityRuntime();
      const rows = iterate(runtime, 3);
      const failure = new Error('caller failed');
      await rows.next();

      await expect(rows.throw(failure)).rejects.toBe(failure);
      expect(endedOf(calls)).toEqual([{ outcome: 'failed' }]);
    });
  });

  it('rejects intercepted rows that are not an array', async () => {
    const { runtime, calls } = createActivityRuntime({ intercept: () => ({ result: { id: 9 } }) });

    await expect(
      streamOrmCall(runtime, rowsCall(), () => stream([{ id: 1 }])).toArray(),
    ).rejects.toMatchObject({ code: 'ORM.INTERCEPTED_RESULT_INVALID' });
    expect(calls.map(({ ended }) => ended)).toEqual([{ outcome: 'failed' }]);
  });
});
