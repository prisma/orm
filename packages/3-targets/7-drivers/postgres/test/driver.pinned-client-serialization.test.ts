import type { PreparedExecuteRequest } from '@internal/sql-relational-core/ast';
import { timeouts } from '@repo/test-utils';
import type { Client, Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { createBoundDriverFromBinding } from '../src/postgres-driver';
import { queryRows } from './sql-queryable-test-utils';

interface ConcurrencyState {
  inFlight: number;
  maxInFlight: number;
  readonly started: string[];
  readonly completed: string[];
}

function createConcurrencyState(): ConcurrencyState {
  return { inFlight: 0, maxInFlight: 0, started: [], completed: [] };
}

function textOf(arg: unknown): string {
  if (typeof arg === 'string') {
    return arg;
  }
  if (typeof arg === 'object' && arg !== null && 'text' in arg) {
    return String((arg as { text: unknown }).text);
  }
  return '<unknown>';
}

function makeTrackedClient(state: ConcurrencyState) {
  return {
    connect: async () => undefined,
    on: () => undefined,
    end: async () => {
      state.completed.push('end');
    },
    query: async (arg: unknown, _values?: unknown[]) => {
      const text = textOf(arg);
      state.inFlight++;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      state.started.push(text);
      await new Promise((resolve) => setTimeout(resolve, 1));
      state.inFlight--;
      state.completed.push(text);
      return { rows: [{ echo: text }], rowCount: 1 };
    },
  };
}

function makeDirectDriver(state: ConcurrencyState) {
  const client = makeTrackedClient(state);
  return createBoundDriverFromBinding(
    { kind: 'pgClient', client: client as unknown as Client },
    { disabled: true },
  );
}

async function consume<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const row of iterable) {
    out.push(row);
  }
  return out;
}

function makeHandleSlot(): PreparedExecuteRequest['preparedStatementHandle'] {
  let value: unknown;
  return {
    get: () => value,
    set: (v: unknown) => {
      value = v;
    },
  };
}

describe('pinned-client serialization', { timeout: timeouts.databaseOperation }, () => {
  it('runs concurrent query() calls on a direct driver one at a time in FIFO order', async () => {
    const state = createConcurrencyState();
    const driver = makeDirectDriver(state);

    await Promise.all([
      queryRows(driver, 'select 1'),
      queryRows(driver, 'select 2'),
      queryRows(driver, 'select 3'),
    ]);

    expect(state.maxInFlight).toBe(1);
    expect(state.started).toEqual(['select 1', 'select 2', 'select 3']);
    expect(state.completed).toEqual(['select 1', 'select 2', 'select 3']);
  });

  it('serializes mixed query/explain overlap on a direct driver', async () => {
    const state = createConcurrencyState();
    const driver = makeDirectDriver(state);
    const explain = driver.explain;
    if (explain === undefined) {
      throw new Error('driver.explain is not implemented');
    }

    await Promise.all([
      consume(driver.query({ sql: 'select a' })),
      consume(
        driver.query({ sql: 'select b', params: [], preparedStatementHandle: makeHandleSlot() }),
      ),
      explain.call(driver, { sql: 'select c' }),
      queryRows(driver, 'select d'),
    ]);

    expect(state.maxInFlight).toBe(1);
    expect(state.started).toHaveLength(4);
  });

  it('serializes overlapping queries on a pinned connection', async () => {
    const state = createConcurrencyState();
    const driver = makeDirectDriver(state);
    const connection = await driver.acquireConnection();

    await Promise.all([queryRows(connection, 'select 1'), queryRows(connection, 'select 2')]);
    await connection.release();

    expect(state.maxInFlight).toBe(1);
    expect(state.started).toEqual(['select 1', 'select 2']);
  });

  it('serializes overlapping queries on a transaction handle, boundaries included', async () => {
    const state = createConcurrencyState();
    const driver = makeDirectDriver(state);
    const connection = await driver.acquireConnection();
    const transaction = await connection.beginTransaction();

    await Promise.all([
      queryRows(transaction, 'select 1'),
      queryRows(transaction, 'select 2'),
      consume(transaction.query({ sql: 'select 3' })),
    ]);
    await transaction.commit();
    await connection.release();

    expect(state.maxInFlight).toBe(1);
    expect(state.started).toEqual(['BEGIN', 'select 1', 'select 2', 'select 3', 'COMMIT']);
    expect(state.completed).toEqual(['BEGIN', 'select 1', 'select 2', 'select 3', 'COMMIT']);
  });

  it('serializes driver-level and pinned-connection statements sharing one physical client', async () => {
    const state = createConcurrencyState();
    const driver = makeDirectDriver(state);
    const connection = await driver.acquireConnection();

    await Promise.all([queryRows(connection, 'select lease'), queryRows(driver, 'select driver')]);
    await connection.release();

    expect(state.maxInFlight).toBe(1);
  });

  it('completes a nested query awaited inside buffered stream iteration on a pinned connection', async () => {
    const state = createConcurrencyState();
    const driver = makeDirectDriver(state);
    const connection = await driver.acquireConnection();

    const nested: unknown[] = [];
    for await (const row of connection.query<{ echo: string }>({ sql: 'select outer' })) {
      expect(row).toEqual({ echo: 'select outer' });
      const inner = await queryRows<{ echo: string }>(connection, 'select inner');
      nested.push(inner[0]);
    }
    await connection.release();

    expect(nested).toEqual([{ echo: 'select inner' }]);
    expect(state.completed).toEqual(['select outer', 'select inner']);
  });

  it('completes a nested query awaited inside buffered stream iteration on a transaction', async () => {
    const state = createConcurrencyState();
    const driver = makeDirectDriver(state);
    const connection = await driver.acquireConnection();
    const transaction = await connection.beginTransaction();

    const nested: unknown[] = [];
    for await (const row of transaction.query<{ echo: string }>({ sql: 'select outer' })) {
      expect(row).toEqual({ echo: 'select outer' });
      const inner = await queryRows<{ echo: string }>(transaction, 'select inner');
      nested.push(inner[0]);
    }
    await transaction.commit();
    await connection.release();

    expect(nested).toEqual([{ echo: 'select inner' }]);
    expect(state.completed).toEqual(['BEGIN', 'select outer', 'select inner', 'COMMIT']);
  });

  it('runs a follow-up query after a partially iterated buffered stream is abandoned', async () => {
    const state = createConcurrencyState();
    const driver = makeDirectDriver(state);

    const iterator = driver
      .query<{ echo: string }>({ sql: 'select abandoned' })
      [Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).toBe(false);

    const after = await queryRows<{ echo: string }>(driver, 'select after');
    expect(after).toEqual([{ echo: 'select after' }]);
  });

  it('commits a transaction while a buffered stream on it is still open', async () => {
    const state = createConcurrencyState();
    const driver = makeDirectDriver(state);
    const connection = await driver.acquireConnection();
    const transaction = await connection.beginTransaction();

    const iterator = transaction
      .query<{ echo: string }>({ sql: 'select open-stream' })
      [Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).toBe(false);

    await transaction.commit();
    await connection.release();
    expect(state.completed).toEqual(['BEGIN', 'select open-stream', 'COMMIT']);
  });

  it('close() on a direct driver ends the client only after the statement in flight finishes', async () => {
    const state = createConcurrencyState();
    const driver = makeDirectDriver(state);

    const rows = queryRows(driver, 'select in-flight');
    await expect.poll(() => state.started).toEqual(['select in-flight']);
    await driver.close();
    await rows;

    expect(state.completed).toEqual(['select in-flight', 'end']);
  });

  it('destroy() on a direct driver connection ends the client without waiting for the statement in flight', async () => {
    const calls: string[] = [];
    let finishQuery: () => void = () => {};
    const queryGate = new Promise<void>((resolve) => {
      finishQuery = resolve;
    });
    const client = {
      connect: async () => undefined,
      on: () => undefined,
      end: async () => {
        calls.push('end');
      },
      query: async () => {
        calls.push('query');
        await queryGate;
        return { rows: [], rowCount: 0 };
      },
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: client as unknown as Client },
      { disabled: true },
    );

    const rows = queryRows(driver, 'select in-flight');
    await expect.poll(() => calls).toEqual(['query']);
    const connection = await driver.acquireConnection();
    const destroyed = connection.destroy(new Error('indeterminate state'));
    const outcome = await Promise.race([
      destroyed.then(() => 'destroyed'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 50)),
    ]);

    expect(outcome).toBe('destroyed');
    expect(calls).toEqual(['query', 'end']);
    finishQuery();
    await Promise.all([destroyed, rows]);
  });

  it('does not serialize pool-level queries across distinct pool clients', async () => {
    const state = createConcurrencyState();
    const pool = {
      connect: async () => ({
        ...makeTrackedClient(state),
        release: () => undefined,
      }),
      end: async () => undefined,
      on: () => undefined,
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgPool', pool: pool as unknown as Pool },
      { disabled: true },
    );

    await Promise.all([queryRows(driver, 'select 1'), queryRows(driver, 'select 2')]);

    expect(state.maxInFlight).toBe(2);
  });
});
