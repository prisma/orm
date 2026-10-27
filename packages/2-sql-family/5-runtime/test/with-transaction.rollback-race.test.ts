import { describe, expect, it, vi } from 'vitest';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import { withTransaction } from '../src/sql-runtime';
import { createSetup, rawPlan, type Setup } from './transaction-activity-fixtures';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function driverTransactionOf(setup: Setup) {
  const acquireConnection = vi.mocked(setup.driver.acquireConnection);
  await vi.waitFor(() => expect(acquireConnection).toHaveBeenCalled());
  const connection = (await acquireConnection.mock.results[0]!.value) as {
    beginTransaction: ReturnType<typeof vi.fn>;
  };
  await vi.waitFor(() => expect(connection.beginTransaction).toHaveBeenCalled());
  return (await connection.beginTransaction.mock.results[0]!.value) as {
    execute: ReturnType<typeof vi.fn>;
    rollback: ReturnType<typeof vi.fn>;
  };
}

/** The order (vitest's invocationCallOrder) of each driver `execute` call whose SQL contains `fragment`. */
function executeOrdersOf(transaction: { execute: ReturnType<typeof vi.fn> }, fragment: string) {
  return transaction.execute.mock.calls.flatMap((call, index) =>
    String((call[0] as { sql?: unknown }).sql).includes(fragment)
      ? [transaction.execute.mock.invocationCallOrder[index]!]
      : [],
  );
}

describe('withTransaction when the callback throws while other statements are pending', () => {
  it('refuses a statement issued while the ROLLBACK is pending, so it cannot run after the ROLLBACK', async () => {
    const rollbackHeld = deferred();
    const setup = createSetup({ failures: { rollbackHeldUntil: rollbackHeld.promise } });
    const failure = new Error('callback failed');
    let tx: Parameters<Parameters<typeof withTransaction>[1]>[0] | undefined;

    const run = withTransaction(setup.runtime, async (context) => {
      tx = context;
      throw failure;
    }).catch((error: unknown) => error);
    const transaction = await driverTransactionOf(setup);
    await vi.waitFor(() => expect(transaction.rollback).toHaveBeenCalled());

    // e.g. a sibling of Promise.all whose turn comes after the first sibling rejected
    const late = tx!.execute(rawPlan('insert late'));
    rollbackHeld.resolve();

    expect(await run).toBe(failure);
    await expect(late).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_CLOSED' });
    expect(executeOrdersOf(transaction, 'insert late')).toEqual([]);
  });

  it('does not send a statement that was still in the pipeline after the ROLLBACK', async () => {
    const entered = deferred();
    const gate = deferred();
    const slowEncode: SqlMiddleware = {
      name: 'slow-encode',
      familyId: 'sql',
      async beforeEncode(plan) {
        if (plan.sql.includes('in flight')) {
          entered.resolve();
          await gate.promise;
        }
      },
    };
    const setup = createSetup({ middleware: [slowEncode] });
    const failure = new Error('callback failed');
    let inFlight: Promise<unknown> | undefined;

    const run = withTransaction(setup.runtime, async (tx) => {
      // a sibling of Promise.all that is still on its way to the driver when another sibling fails
      inFlight = tx.execute(rawPlan('insert in flight')).catch((error: unknown) => error);
      await entered.promise;
      // Let the statement continue only after the callback has thrown and withTransaction has moved on to the ROLLBACK.
      setTimeout(() => gate.resolve(), 10);
      throw failure;
    }).catch((error: unknown) => error);
    const transaction = await driverTransactionOf(setup);

    expect(await run).toBe(failure);
    await inFlight;
    const rollbackOrder = transaction.rollback.mock.invocationCallOrder[0]!;
    // Sent before the ROLLBACK (inside the transaction, so rolled back) or not at all; never after it.
    for (const order of executeOrdersOf(transaction, 'in flight')) {
      expect(order).toBeLessThan(rollbackOrder);
    }
  });

  it('keeps TRANSACTION_CLOSED when closing the source stream also fails', async () => {
    const setup = createSetup();
    // A driver stream whose close fails (e.g. a cursor that cannot be closed).
    let index = 0;
    vi.mocked(setup.driver.query).mockImplementation(() => {
      return {
        [Symbol.asyncIterator]() {
          return {
            next: async () =>
              index < 2
                ? { done: false, value: { id: ++index } }
                : { done: true, value: undefined },
            return: async () => {
              throw new Error('close failed');
            },
          };
        },
      } as never;
    });
    const failure = new Error('callback failed');
    let reader: AsyncIterator<unknown> | undefined;

    const run = withTransaction(setup.runtime, async (tx) => {
      reader = tx.query(rawPlan('select id from t'))[Symbol.asyncIterator]();
      await reader.next();
      throw failure;
    }).catch((error: unknown) => error);

    expect(await run).toBe(failure);
    // Reading on after the transaction closed reports the closed transaction, not the close failure.
    await expect(reader!.next()).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_CLOSED' });
    // ...without reading another row from the closed transaction first.
    expect(index).toBe(1);
  });

  it('does not hand over a row that arrives after the transaction closed, nor read past it', async () => {
    const setup = createSetup();
    const secondRow = deferred();
    let reads = 0;
    vi.mocked(setup.driver.query).mockImplementation(() => {
      return {
        [Symbol.asyncIterator]() {
          return {
            next: async () => {
              reads += 1;
              if (reads === 2) {
                await secondRow.promise;
              }
              return { done: false, value: { id: reads } };
            },
          };
        },
      } as never;
    });
    const failure = new Error('callback failed');
    let pending: Promise<unknown> | undefined;

    const run = withTransaction(setup.runtime, async (tx) => {
      const reader = tx.query(rawPlan('select id from t'))[Symbol.asyncIterator]();
      await reader.next();
      // a sibling of Promise.all still waiting for its next row when another sibling fails
      pending = reader.next().catch((error: unknown) => error);
      throw failure;
    }).catch((error: unknown) => error);

    expect(await run).toBe(failure);
    secondRow.resolve();
    expect(await pending).toMatchObject({ code: 'RUNTIME.TRANSACTION_CLOSED' });
    expect(reads).toBe(2);
  });
});
