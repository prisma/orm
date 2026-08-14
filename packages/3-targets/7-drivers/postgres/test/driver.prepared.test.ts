import { SqlQueryError } from '@internal/sql-errors';
import type { PreparedExecuteRequest } from '@internal/sql-relational-core/ast';
import { timeouts } from '@repo/test-utils';
import type { Client, Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoundDriverFromBinding, type PostgresBinding } from '../src/postgres-driver';
import { temporalTextTypes } from '../src/temporal-text-parsers';

interface MockQueryArg {
  readonly arg: unknown;
  readonly values: readonly unknown[] | undefined;
}

interface MockConfig {
  readonly handler?: (call: MockQueryArg, callIndex: number) => unknown | Error;
}

function makeMockClient(config: MockConfig = {}) {
  const handler = config.handler ?? (() => ({ rows: [] }));
  const calls: MockQueryArg[] = [];
  const client = {
    _connection: {},
    _ending: false,
    on: () => undefined,
    connect: vi.fn(async () => undefined),
    end: vi.fn(async () => undefined),
    query: vi.fn((arg: unknown, values?: unknown[]) => {
      const call: MockQueryArg = { arg, values };
      calls.push(call);
      const outcome = handler(call, calls.length - 1);
      if (outcome instanceof Error) {
        throw outcome;
      }
      return outcome ?? { rows: [] };
    }),
  };
  return { client, calls };
}

function makeSlot(initial?: unknown) {
  let value: unknown = initial;
  return {
    slot: {
      get: () => value,
      set: (v: unknown) => {
        value = v;
      },
    } satisfies PreparedExecuteRequest['preparedStatementHandle'],
    snapshot: () => value,
  };
}

async function consume<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const row of iterable) {
    out.push(row);
  }
  return out;
}

function makePgError(code: string, message = `simulated ${code}`): Error {
  return Object.assign(new Error(message), { code });
}

function makeDriver(binding: PostgresBinding, preparedStatements?: boolean, cursorDisabled = true) {
  // Disable cursor by default so the buffered path is exercised directly — most
  // mock clients don't implement pg-cursor's protocol.
  return createBoundDriverFromBinding(
    binding,
    { disabled: cursorDisabled },
    preparedStatements === undefined ? undefined : { preparedStatements },
  );
}

describe('postgres prepared statements', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  }, timeouts.spinUpPpgDev);

  describe('preparedStatements: false', () => {
    it('issues anonymous queries and leaves the handle slot unset', async () => {
      const { client, calls } = makeMockClient({
        handler: () => ({ rows: [{ id: 1 }] }),
      });
      const driver = makeDriver({ kind: 'pgClient', client: client as unknown as Client }, false);
      cleanups.push(() => driver.close());

      const { slot, snapshot } = makeSlot();
      const sql = 'select id from t where x = $1';
      await consume(driver.query({ sql, params: [42], preparedStatementHandle: slot }));
      await consume(driver.query({ sql, params: [99], preparedStatementHandle: slot }));

      expect(snapshot()).toBeUndefined();
      expect(calls).toHaveLength(2);
      expect(calls[0]?.arg).toMatchObject({ name: undefined, text: sql, values: [42] });
      expect(calls[1]?.arg).toMatchObject({ name: undefined, text: sql, values: [99] });
    });

    it('does not trigger the 26000 retry path', async () => {
      let invocations = 0;
      const { client } = makeMockClient({
        handler: () => {
          invocations += 1;
          return makePgError('26000', 'unexpected on anonymous query');
        },
      });
      const driver = makeDriver({ kind: 'pgClient', client: client as unknown as Client }, false);
      cleanups.push(() => driver.close());

      const { slot } = makeSlot();
      await expect(
        consume(driver.query({ sql: 'select 1', params: [], preparedStatementHandle: slot })),
      ).rejects.toBeInstanceOf(SqlQueryError);
      expect(invocations).toBe(1);
    });
  });

  it('maps pg rowCount to affectedRows', async () => {
    const { client, calls } = makeMockClient({
      handler: () => ({ rows: [], rowCount: 3 }),
    });
    const driver = makeDriver({ kind: 'pgClient', client: client as unknown as Client });
    cleanups.push(() => driver.close());

    await expect(driver.execute({ sql: 'update t set x = $1', params: [42] })).resolves.toEqual({
      affectedRows: 3,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.arg).toEqual({
      text: 'update t set x = $1',
      values: [42],
    });
  });

  it('streams every prepared row and closes the source when the consumer returns early', async () => {
    let cursorCloseCalls = 0;
    const { client } = makeMockClient({
      handler: ({ arg }) => {
        if (typeof arg === 'object' && arg !== null && 'read' in arg) {
          let readCalls = 0;
          return {
            read: (
              _size: number,
              callback: (error: Error | null, rows: { id: number }[]) => void,
            ) => {
              callback(null, readCalls++ === 0 ? [{ id: 1 }, { id: 2 }] : []);
            },
            close: (callback: (error: Error | null) => void) => {
              cursorCloseCalls += 1;
              callback(null);
            },
          };
        }
        return { rows: [{ id: 1 }, { id: 2 }] };
      },
    });
    const driver = makeDriver(
      { kind: 'pgClient', client: client as unknown as Client },
      undefined,
      false,
    );
    cleanups.push(() => driver.close());

    const { slot } = makeSlot();
    const request = { sql: 'select id from t', params: [], preparedStatementHandle: slot };
    await expect(consume(driver.query<{ id: number }>(request))).resolves.toEqual([
      { id: 1 },
      { id: 2 },
    ]);
    expect(cursorCloseCalls).toBe(1);

    for await (const row of driver.query<{ id: number }>(request)) {
      expect(row).toEqual({ id: 1 });
      break;
    }
    expect(cursorCloseCalls).toBe(2);
  });

  it('returns no rows when a prepared query has an empty result', async () => {
    const { client, calls } = makeMockClient();
    const driver = makeDriver({ kind: 'pgClient', client: client as unknown as Client });
    cleanups.push(() => driver.close());

    const { slot, snapshot } = makeSlot();
    await expect(
      consume(driver.query({ sql: 'select id from t', params: [], preparedStatementHandle: slot })),
    ).resolves.toEqual([]);

    expect(snapshot()).toBe('pn_1');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.arg).toEqual({
      name: 'pn_1',
      text: 'select id from t',
      values: [],
      types: temporalTextTypes,
    });
  });

  it('uses and reuses a prepared name for execute requests with a handle', async () => {
    const { client, calls } = makeMockClient({
      handler: () => ({ rows: [], rowCount: 1 }),
    });
    const driver = makeDriver({ kind: 'pgClient', client: client as unknown as Client });
    cleanups.push(() => driver.close());

    const { slot, snapshot } = makeSlot();
    const sql = 'update t set x = $1';
    await driver.execute({ sql, params: [42], preparedStatementHandle: slot });
    await driver.execute({ sql, params: [99], preparedStatementHandle: slot });

    expect(snapshot()).toBe('pn_1');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.arg).toEqual({ name: 'pn_1', text: sql, values: [42] });
    expect(calls[1]?.arg).toEqual({ name: 'pn_1', text: sql, values: [99] });
  });

  it('does not retry non-stale prepared failures', async () => {
    const failure = new Error('ordinary prepared failure');
    const { client, calls } = makeMockClient({ handler: () => failure });
    const driver = makeDriver({ kind: 'pgClient', client: client as unknown as Client });
    cleanups.push(() => driver.close());

    const { slot, snapshot } = makeSlot();
    await expect(
      driver.execute({ sql: 'update t set x = 1', preparedStatementHandle: slot }),
    ).rejects.toBe(failure);

    expect(calls).toHaveLength(1);
    expect(snapshot()).toBe('pn_1');
  });

  it('keeps bound direct and pool connect operations as no-ops', async () => {
    const { client } = makeMockClient();
    const directBinding: PostgresBinding = {
      kind: 'pgClient',
      client: client as unknown as Client,
    };
    const directDriver = makeDriver(directBinding);
    cleanups.push(() => directDriver.close());

    const pool = {
      connect: vi.fn(),
      on: () => undefined,
      end: vi.fn(async () => undefined),
    };
    const poolBinding: PostgresBinding = {
      kind: 'pgPool',
      pool: pool as unknown as Pool,
    };
    const poolDriver = makeDriver(poolBinding);
    cleanups.push(() => poolDriver.close());

    await directDriver.connect(directBinding);
    await poolDriver.connect(poolBinding);

    expect(client.connect).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  describe('stale-handle retry', () => {
    it('retries execute with a fresh name and surfaces DRIVER.PREPARE_FAILED if retry fails', async () => {
      const retryError = makePgError('26000', 'statement gone after re-prepare');
      const { client, calls } = makeMockClient({
        handler: (_call, callIndex) =>
          callIndex === 0 ? makePgError('26000', 'statement gone') : retryError,
      });
      const driver = makeDriver({ kind: 'pgClient', client: client as unknown as Client });
      cleanups.push(() => driver.close());

      const { slot, snapshot } = makeSlot();
      const rejection = await driver
        .execute({ sql: 'update t set x = $1', params: [42], preparedStatementHandle: slot })
        .then(
          () => undefined,
          (error: unknown) => error,
        );

      expect(calls).toHaveLength(2);
      expect(calls[0]?.arg).toMatchObject({ name: 'pn_1' });
      expect(calls[1]?.arg).toMatchObject({ name: 'pn_2' });
      expect(snapshot()).toBe('pn_2');

      const envelope = rejection as Error & {
        code?: unknown;
        category?: unknown;
        severity?: unknown;
        details?: Record<string, unknown>;
      };
      expect(envelope.code).toBe('DRIVER.PREPARE_FAILED');
      expect(envelope.category).toBe('DRIVER');
      expect(envelope.severity).toBe('error');
      expect(envelope.details).toEqual({ handle: 'pn_2' });

      const cause = envelope.cause as SqlQueryError;
      expect(cause).toBeInstanceOf(SqlQueryError);
      expect(cause.sqlState).toBe('26000');
      expect(cause.cause).toBe(retryError);
    });

    it('surfaces DRIVER.PREPARE_FAILED with the originating error as cause when the retry fails', async () => {
      const retryError = makePgError('26000', 'statement gone after re-prepare');
      const { client, calls } = makeMockClient({
        handler: (_call, callIndex) =>
          callIndex === 0 ? makePgError('26000', 'statement gone') : retryError,
      });
      const driver = makeDriver({ kind: 'pgClient', client: client as unknown as Client });
      cleanups.push(() => driver.close());

      const { slot, snapshot } = makeSlot();
      const rejection = await consume(
        driver.query({ sql: 'select 1', params: [], preparedStatementHandle: slot }),
      ).then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(calls).toHaveLength(2);
      const envelope = rejection as Error & {
        code?: unknown;
        category?: unknown;
        severity?: unknown;
        details?: Record<string, unknown>;
      };
      expect(envelope.code).toBe('DRIVER.PREPARE_FAILED');
      expect(envelope.category).toBe('DRIVER');
      expect(envelope.severity).toBe('error');
      expect(envelope.details).toEqual({ handle: snapshot() });

      const cause = envelope.cause as SqlQueryError;
      expect(cause).toBeInstanceOf(SqlQueryError);
      expect(cause.sqlState).toBe('26000');
      expect(cause.cause).toBe(retryError);
    });
  });
});
