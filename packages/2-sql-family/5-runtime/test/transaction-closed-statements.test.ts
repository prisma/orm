import { RawQueryAst, type SqlDriver } from '@internal/sql-relational-core/ast';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startActivityOn } from '../src/activity-handle';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import {
  type RuntimeTransaction,
  type TransactionContext,
  withTransaction,
} from '../src/sql-runtime';
import { testCall } from './client-activity-kinds';
import { deferred } from './closed-runtime-stub';
import {
  createSetup,
  names,
  rawPlan,
  type Setup,
  testContract,
} from './transaction-activity-fixtures';

afterEach(() => {
  vi.restoreAllMocks();
});

function settled(promise: PromiseLike<unknown>): Promise<unknown> {
  return Promise.resolve(promise).then(
    () => 'sent',
    (error: unknown) => error,
  );
}

function sentSql(driver: SqlDriver): string[] {
  return [
    ...vi.mocked(driver.execute).mock.calls.map(([request]) => request.sql),
    ...vi.mocked(driver.query).mock.calls.map(([request]) => request.sql),
  ];
}

function holdInMiddleware(sql: string) {
  const entered = deferred();
  const resume = deferred();
  const middleware: SqlMiddleware = {
    name: 'held-encoding',
    familyId: 'sql',
    async beforeEncode(plan) {
      if (!plan.sql.includes(sql)) return;
      entered.resolve();
      await resume.promise;
    },
  };
  return { middleware, entered, resume };
}

async function holdRollback(setup: Setup) {
  const called = deferred();
  const resume = deferred();
  const connection = await setup.driver.acquireConnection();
  const begin = vi.mocked(connection.beginTransaction).getMockImplementation();
  if (begin === undefined) throw new Error('Missing BEGIN fixture');
  vi.mocked(connection.beginTransaction).mockImplementation(async (options) => {
    const transaction = await begin(options);
    vi.mocked(transaction.rollback).mockImplementation(async () => {
      called.resolve();
      await resume.promise;
    });
    return transaction;
  });
  return { called, resume };
}

const transactionClosed = { code: 'RUNTIME.TRANSACTION_CLOSED' };

describe('withTransaction when the callback throws', () => {
  it('refuses a statement started while the ROLLBACK is pending', async () => {
    const setup = createSetup();
    const rollback = await holdRollback(setup);
    const failure = new Error('callback failed');
    let transaction: TransactionContext | undefined;

    const run = settled(
      withTransaction(setup.runtime, async (tx) => {
        transaction = tx;
        throw failure;
      }),
    );
    await rollback.called.promise;
    const late = settled(transaction?.execute(rawPlan('insert late')) ?? Promise.resolve());
    rollback.resume.resolve();

    expect(await run).toBe(failure);
    expect(await late).toMatchObject(transactionClosed);
    expect(sentSql(setup.driver)).not.toContain('insert late');
  });

  it('refuses a statement still in middleware when the callback throws', async () => {
    const held = holdInMiddleware('insert held');
    const setup = createSetup({ middleware: [held.middleware] });
    const failure = new Error('callback failed');
    let pending: Promise<unknown> = Promise.resolve();

    const run = settled(
      withTransaction(setup.runtime, async (tx) => {
        pending = settled(tx.execute(rawPlan('insert held')));
        await held.entered.promise;
        throw failure;
      }),
    );
    expect(await run).toBe(failure);
    held.resume.resolve();

    expect(await pending).toMatchObject(transactionClosed);
    expect(sentSql(setup.driver)).not.toContain('insert held');
    expect(names(setup.events)).toContain('rollback');
  });

  it('keeps TRANSACTION_CLOSED when closing the source stream also fails', async () => {
    const setup = createSetup();
    let index = 0;
    vi.mocked(setup.driver.query).mockImplementation(() => ({
      [Symbol.asyncIterator]: () => ({
        next: async () =>
          index < 2 ? { done: false, value: { id: ++index } } : { done: true, value: undefined },
        return: async () => {
          throw new Error('close failed');
        },
      }),
    }));
    const failure = new Error('callback failed');
    let reader: AsyncIterator<unknown> | undefined;

    const run = settled(
      withTransaction(setup.runtime, async (tx) => {
        reader = tx.query(rawPlan('select id from t'))[Symbol.asyncIterator]();
        await reader.next();
        throw failure;
      }),
    );

    expect(await run).toBe(failure);
    expect(await settled(reader?.next() ?? Promise.resolve())).toMatchObject(transactionClosed);
    expect(index).toBe(1);
  });

  it('does not hand over a row that arrives after the transaction closed, nor read past it', async () => {
    const setup = createSetup();
    const secondRow = deferred();
    let reads = 0;
    vi.mocked(setup.driver.query).mockImplementation(() => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          reads += 1;
          if (reads === 2) await secondRow.promise;
          return { done: false, value: { id: reads } };
        },
      }),
    }));
    const failure = new Error('callback failed');
    let pending: Promise<unknown> = Promise.resolve();

    const run = settled(
      withTransaction(setup.runtime, async (tx) => {
        const reader = tx.query(rawPlan('select id from t'))[Symbol.asyncIterator]();
        await reader.next();
        pending = settled(reader.next());
        throw failure;
      }),
    );

    expect(await run).toBe(failure);
    secondRow.resolve();
    expect(await pending).toMatchObject(transactionClosed);
    expect(reads).toBe(2);
  });
});

describe('withTransaction when the callback returns', () => {
  it('refuses a statement still in middleware when the COMMIT is sent', async () => {
    const held = holdInMiddleware('insert held');
    const setup = createSetup({ middleware: [held.middleware] });
    let pending: Promise<unknown> = Promise.resolve();

    const run = withTransaction(setup.runtime, async (tx) => {
      pending = settled(tx.execute(rawPlan('insert held')));
      await held.entered.promise;
      return 42;
    });
    await expect(run).resolves.toBe(42);
    held.resume.resolve();

    expect(await pending).toMatchObject(transactionClosed);
    expect(sentSql(setup.driver)).not.toContain('insert held');
  });
});

describe('a transaction from connection.transaction()', () => {
  it.each(['commit', 'rollback'] as const)(
    'refuses a statement sent after %s() is called',
    async (end) => {
      const setup = createSetup();
      const connection = await setup.runtime.connection();
      const transaction = await connection.transaction();
      await transaction[end]();

      await expect(transaction.execute(rawPlan('update late'))).rejects.toMatchObject({
        code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
      });
      await expect(transaction.query(rawPlan('select late')).toArray()).rejects.toMatchObject({
        code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
      });
      expect(sentSql(setup.driver)).toEqual([]);
      await connection.release();
    },
  );

  it.each(['commit', 'rollback'] as const)(
    'refuses a statement sent on its connection and still in middleware when %s() is called',
    async (end) => {
      const held = holdInMiddleware('update held');
      const setup = createSetup({ middleware: [held.middleware] });
      const connection = await setup.runtime.connection();
      const transaction = await connection.transaction();
      const pending = settled(connection.execute(rawPlan('update held')));
      await held.entered.promise;

      await transaction[end]();
      held.resume.resolve();

      expect(await pending).toMatchObject(transactionClosed);
      expect(sentSql(setup.driver)).toEqual([]);
      await connection.release();
    },
  );

  it.each(['commit', 'rollback'] as const)(
    'refuses a statement still in middleware when %s() is called',
    async (end) => {
      const held = holdInMiddleware('update held');
      const setup = createSetup({ middleware: [held.middleware] });
      const connection = await setup.runtime.connection();
      const transaction = await connection.transaction();
      const pending = settled(transaction.execute(rawPlan('update held')));
      await held.entered.promise;

      await transaction[end]();
      held.resume.resolve();

      expect(await pending).toMatchObject(transactionClosed);
      expect(sentSql(setup.driver)).toEqual([]);
      await connection.release();
    },
  );
});

describe('a statement on a raw transaction, still in middleware when the transaction ends', () => {
  const ends = ['commit', 'rollback'] as const;

  it.each(ends)(
    'refuses one sent through an activity handle on the transaction at %s()',
    async (end) => {
      const held = holdInMiddleware('update held');
      const setup = createSetup({ middleware: [held.middleware] });
      const connection = await setup.runtime.connection();
      const transaction = await connection.transaction();
      const call = await startActivityOn(transaction, testCall);
      const pending = settled(call.execute(rawPlan('update held')));
      await held.entered.promise;

      await transaction[end]();
      held.resume.resolve();

      expect(await pending).toMatchObject(transactionClosed);
      expect(sentSql(setup.driver)).toEqual([]);
      await connection.release();
    },
  );

  it.each(ends)(
    'refuses one sent through an activity handle on its connection at %s()',
    async (end) => {
      const held = holdInMiddleware('update held');
      const setup = createSetup({ middleware: [held.middleware] });
      const connection = await setup.runtime.connection();
      const transaction = await connection.transaction();
      const call = await startActivityOn(connection, testCall);
      const pending = settled(call.execute(rawPlan('update held')));
      await held.entered.promise;

      await transaction[end]();
      held.resume.resolve();

      expect(await pending).toMatchObject(transactionClosed);
      expect(sentSql(setup.driver)).toEqual([]);
      await connection.release();
    },
  );

  it.each(ends)('refuses a query() stream at %s()', async (end) => {
    const held = holdInMiddleware('select held');
    const setup = createSetup({ middleware: [held.middleware] });
    const connection = await setup.runtime.connection();
    const transaction = await connection.transaction();
    const pending = settled(transaction.query(rawPlan('select held')).toArray());
    await held.entered.promise;

    await transaction[end]();
    held.resume.resolve();

    expect(await pending).toMatchObject(transactionClosed);
    expect(sentSql(setup.driver)).toEqual([]);
    await connection.release();
  });

  it.each(ends)('refuses a prepared statement at %s()', async (end) => {
    const held = holdInMiddleware('update prepared');
    const setup = createSetup({ middleware: [held.middleware] });
    const prepared = await setup.runtime.prepare({}, () =>
      planFromAst(RawQueryAst.affectedCount(['update prepared']), testContract),
    );
    const connection = await setup.runtime.connection();
    const transaction = await connection.transaction();
    const pending = settled(prepared.execute(transaction, {}));
    await held.entered.promise;

    await transaction[end]();
    held.resume.resolve();

    expect(await pending).toMatchObject(transactionClosed);
    expect(sentSql(setup.driver)).toEqual([]);
    await connection.release();
  });
});

describe('the runtime first statement, held in middleware while its transaction closes', () => {
  const sends = {
    execute: (transaction: RuntimeTransaction) => transaction.execute(rawPlan('update held')),
    query: (transaction: RuntimeTransaction) => transaction.query(rawPlan('update held')).toArray(),
  };

  it.each([
    ['commit', 'execute'],
    ['commit', 'query'],
    ['rollback', 'execute'],
    ['rollback', 'query'],
  ] as const)('sends nothing to the driver after %s() for %s()', async (end, send) => {
    const held = holdInMiddleware('update held');
    const readMarker = vi.fn(async () => ({ kind: 'absent' as const }));
    const setup = createSetup({ middleware: [held.middleware], readMarker });
    const connection = await setup.runtime.connection();
    const transaction = await connection.transaction();
    const pending = settled(sends[send](transaction));
    await held.entered.promise;

    await transaction[end]();
    held.resume.resolve();

    expect(await pending).toMatchObject(transactionClosed);
    expect(readMarker).not.toHaveBeenCalled();
    expect(sentSql(setup.driver)).toEqual([]);
    await connection.release();
  });
});
