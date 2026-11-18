import { describe, expect, it, vi } from 'vitest';
import type {
  ActivityEndedResult,
  QueryInterceptResult,
  RuntimeMiddleware,
} from '../src/execution/runtime-middleware';
import {
  collect,
  contextFields,
  executeStatementWith,
  type MockExec,
  queryStatement,
  yieldRows,
} from './statement-fixtures';

function onQuery(
  name: string,
  calls: string[],
  result: QueryInterceptResult | undefined,
): RuntimeMiddleware<MockExec> {
  return {
    name,
    intercept: {
      async onQuery() {
        calls.push(name);
        return result;
      },
    },
  };
}

function endedRecorder(results: ActivityEndedResult[]): RuntimeMiddleware<MockExec> {
  return {
    name: 'ended-recorder',
    async activityEnded(_activity, result) {
      results.push(result);
    },
  };
}

describe('intercept.onQuery', () => {
  it('uses the first handler that returns rows; later handlers do not run', async () => {
    const calls: string[] = [];
    const driver = vi.fn(() => yieldRows([{ id: 'driver' }]));

    const rows = await collect(
      queryStatement(
        [
          onQuery('passthrough', calls, undefined),
          onQuery('winner', calls, { rows: [{ id: 'a' }, { id: 'b' }] }),
          onQuery('loser', calls, { rows: [{ id: 'never' }] }),
        ],
        driver,
      ),
    );

    expect({ rows, calls }).toEqual({
      rows: [{ id: 'a' }, { id: 'b' }],
      calls: ['passthrough', 'winner'],
    });
    expect(driver).not.toHaveBeenCalled();
  });

  it('reports the intercepted row count with source middleware, and skips onRow', async () => {
    const results: ActivityEndedResult[] = [];
    const onRow = vi.fn(async () => {});
    const interceptor: RuntimeMiddleware<MockExec> = {
      ...onQuery('cache', [], { rows: [{ id: 1 }, { id: 2 }, { id: 3 }] }),
      onRow,
    };

    await collect(queryStatement([interceptor, endedRecorder(results)], () => yieldRows([])));

    expect(results).toMatchObject([
      { outcome: 'succeeded', returns: 'rows', rowCount: 3, source: 'middleware' },
    ]);
    expect(onRow).not.toHaveBeenCalled();
  });

  it('runs the driver with source driver when every handler passes through', async () => {
    const calls: string[] = [];
    const results: ActivityEndedResult[] = [];
    const driver = vi.fn(() => {
      calls.push('driver');
      return yieldRows([{ id: 1 }]);
    });

    const rows = await collect(
      queryStatement(
        [onQuery('A', calls, undefined), onQuery('B', calls, undefined), endedRecorder(results)],
        driver,
      ),
    );

    expect({ rows, calls }).toEqual({ rows: [{ id: 1 }], calls: ['A', 'B', 'driver'] });
    expect(results).toMatchObject([{ source: 'driver', rowCount: 1 }]);
  });

  it('emits a debug event naming the winning middleware', async () => {
    const debug = vi.fn();
    const context = contextFields({
      log: { info: () => {}, warn: () => {}, error: () => {}, debug },
    });

    await collect(
      queryStatement([onQuery('cache', [], { rows: [{ id: 1 }] })], () => yieldRows([]), {
        context,
      }),
    );

    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith({
      event: 'middleware.intercept.onQuery',
      middleware: 'cache',
    });
  });

  it('accepts arrays, sync iterables and async iterables as the rows', async () => {
    function* syncRows() {
      yield { id: 'sync' };
    }
    async function* asyncRows() {
      yield { id: 'async' };
    }

    const read = await Promise.all(
      [[{ id: 'array' }], syncRows(), asyncRows()].map((rows) =>
        collect(queryStatement([onQuery('cache', [], { rows })], () => yieldRows([]))),
      ),
    );

    expect(read).toEqual([[{ id: 'array' }], [{ id: 'sync' }], [{ id: 'async' }]]);
  });

  it('fails the statement with source middleware when the intercepted rows throw', async () => {
    const results: ActivityEndedResult[] = [];
    const boom = new Error('rows failed');
    async function* badRows() {
      yield { id: 1 };
      throw boom;
    }

    await expect(
      collect(
        queryStatement([onQuery('bad', [], { rows: badRows() }), endedRecorder(results)], () =>
          yieldRows([]),
        ),
      ),
    ).rejects.toBe(boom);

    expect(results).toMatchObject([{ outcome: 'failed', source: 'middleware', rowCount: 1 }]);
  });

  it('is not consulted by an execute', async () => {
    const driver = vi.fn(async () => ({ affectedRows: 1 }));

    await expect(
      executeStatementWith([onQuery('cache', [], { rows: [{ affectedRows: 100 }] })], driver),
    ).resolves.toEqual({ affectedRows: 1 });
    expect(driver).toHaveBeenCalledTimes(1);
  });
});

describe('intercept.onExecute', () => {
  function onExecute(name: string, calls: string[], affectedRows: number | undefined) {
    const middleware: RuntimeMiddleware<MockExec> = {
      name,
      intercept: {
        async onExecute() {
          calls.push(name);
          return affectedRows === undefined ? undefined : { stats: { affectedRows } };
        },
      },
    };
    return middleware;
  }

  it('uses the first handler that returns statistics and reports them with source middleware', async () => {
    const calls: string[] = [];
    const results: ActivityEndedResult[] = [];
    const driver = vi.fn(async () => ({ affectedRows: 99 }));

    const stats = await executeStatementWith(
      [
        onExecute('passthrough', calls, undefined),
        onExecute('winner', calls, 7),
        onExecute('tail', calls, 8),
        endedRecorder(results),
      ],
      driver,
    );

    expect({ stats, calls }).toEqual({
      stats: { affectedRows: 7 },
      calls: ['passthrough', 'winner'],
    });
    expect(driver).not.toHaveBeenCalled();
    expect(results).toMatchObject([
      { outcome: 'succeeded', returns: 'stats', stats: { affectedRows: 7 }, source: 'middleware' },
    ]);
  });

  it('is not consulted by a query', async () => {
    const calls: string[] = [];

    await expect(
      collect(queryStatement([onExecute('stats', calls, 1)], () => yieldRows([{ id: 1 }]))),
    ).resolves.toEqual([{ id: 1 }]);
    expect(calls).toEqual([]);
  });

  it('fails the statement with source middleware when a handler throws', async () => {
    const results: ActivityEndedResult[] = [];
    const boom = new Error('onExecute failed');
    const driver = vi.fn(async () => ({ affectedRows: 1 }));
    const failing: RuntimeMiddleware<MockExec> = {
      name: 'failing',
      intercept: {
        async onExecute() {
          throw boom;
        },
      },
    };

    await expect(executeStatementWith([failing, endedRecorder(results)], driver)).rejects.toBe(
      boom,
    );

    expect(driver).not.toHaveBeenCalled();
    expect(results).toEqual([
      {
        kind: 'statement',
        outcome: 'failed',
        returns: 'stats',
        latencyMs: expect.any(Number),
        source: 'middleware',
      },
    ]);
  });
});
