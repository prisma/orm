import { ParamRef, RawQueryAst } from '@internal/sql-relational-core/ast';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import { planFromAst, type SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withTransaction } from '../src/sql-runtime';
import { deferred } from './closed-runtime-stub';
import {
  createSetup,
  doublingCodec,
  failingDecodePlan,
  names,
  rawPlan,
  testContract,
} from './transaction-activity-fixtures';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each(['execute', 'prepared'] as const)(
  'rechecks admitted %s results without taking manual cleanup ownership',
  async (operation) => {
    for (const outcome of ['timer', 'monotonic', 'success', 'rejection'] as const) {
      const { runtime, driver, events } = createSetup();
      const entered = deferred();
      const resume = deferred();
      const failure = new Error('driver failed');
      vi.mocked(driver.execute).mockImplementation(async () => {
        entered.resolve();
        await resume.promise;
        if (outcome === 'rejection') throw failure;
        return { affectedRows: 1 };
      });
      const connection = await runtime.connection();
      const tx = await connection.transaction({ timeout: 10 });
      const aborted = vi.fn();
      tx.signal.addEventListener('abort', aborted);
      const plan: SqlQueryPlan<AffectedCount> = planFromAst(
        RawQueryAst.affectedCount(['update t set x = 1']),
        testContract,
      );
      const prepared = await runtime.prepare({}, () => plan);
      const pending = operation === 'execute' ? tx.execute(plan) : prepared.execute(tx, {});
      const result = pending.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await entered.promise;
      if (outcome === 'monotonic') vi.spyOn(performance, 'now').mockReturnValue(100000);
      else if (outcome !== 'success') await vi.advanceTimersByTimeAsync(10);
      resume.resolve();
      expect(await result).toEqual(
        outcome === 'success'
          ? { value: { affectedRows: 1 } }
          : { error: outcome === 'rejection' ? failure : tx.signal.reason },
      );
      expect(aborted).toHaveBeenCalledTimes(outcome === 'success' ? 0 : 1);
      expect(names(events)).not.toContain('rollback');
      expect(names(events)).not.toContain('release');
      await tx.rollback();
      await connection.release();
      await runtime.close();
      vi.restoreAllMocks();
    }
  },
);

it('arms after BEGIN, aborts once, and refuses work and commit after expiry', async () => {
  const { runtime, driver, events } = createSetup();
  const connection = await runtime.connection();
  const aborted = vi.fn();
  const entered = deferred();
  const resume = deferred();
  const driverConnection = await driver.acquireConnection();
  const begin = vi.mocked(driverConnection.beginTransaction).getMockImplementation();
  if (begin === undefined) throw new Error('Missing BEGIN fixture');
  const beginSpy = vi
    .spyOn(driverConnection, 'beginTransaction')
    .mockImplementation(async (options) => {
      entered.resolve();
      await resume.promise;
      return begin(options);
    });
  const starting = connection.transaction({ timeout: 10 });
  await entered.promise;
  await vi.advanceTimersByTimeAsync(100);
  expect(vi.getTimerCount()).toBe(0);
  resume.resolve();
  const tx = await starting;
  expect(beginSpy).toHaveBeenCalledExactlyOnceWith({});
  expect(tx.signal.aborted).toBe(false);
  tx.signal.addEventListener('abort', aborted);
  await vi.advanceTimersByTimeAsync(10);
  const failure = tx.signal.reason;
  expect(failure).toMatchObject({ code: 'RUNTIME.TRANSACTION_TIMEOUT', details: { timeout: 10 } });
  await vi.advanceTimersByTimeAsync(100);
  expect(aborted).toHaveBeenCalledTimes(1);
  await expect(tx.execute(rawPlan('update t set x = 1'))).rejects.toMatchObject({
    code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
  });
  await expect(tx.commit()).rejects.toBe(failure);
  await Promise.all([tx.rollback(), tx.rollback()]);
  await expect(tx.execute(rawPlan('update t set x = 2'))).rejects.toMatchObject({
    code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
  });
  expect(names(events).filter((name) => name === 'rollback')).toHaveLength(1);
  expect(names(events)).not.toContain('commit');
  expect(driver.execute).not.toHaveBeenCalled();
  expect(names(events).filter((name) => name === 'finalized:transaction:rolled-back')).toHaveLength(
    1,
  );
  await connection.release();
  await runtime.close();
});

it.each(['execute', 'query', 'prepared', 'intercept'] as const)(
  'contains %s suspended in middleware and finalizes late children once',
  async (operation) => {
    const entered = deferred();
    const resume = deferred();
    const wait = async () => {
      entered.resolve();
      await resume.promise;
    };
    const { runtime, driver, events } = createSetup({
      middleware: [
        {
          name: 'suspended',
          ...(operation === 'intercept'
            ? {
                intercept: {
                  onExecute: async () => {
                    await wait();
                    return undefined;
                  },
                },
              }
            : { beforeEncode: wait }),
        },
      ],
    });
    const connection = await runtime.connection();
    const tx = await connection.transaction({ timeout: 10 });
    const prepared = await runtime.prepare({}, () => failingDecodePlan());
    const pending =
      operation === 'execute' || operation === 'intercept'
        ? tx.execute(rawPlan('update t set x = 1'))
        : operation === 'query'
          ? tx.query(rawPlan('select id from t')).toArray()
          : prepared.query(tx, {}).toArray();
    const rejected = expect(pending).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_TIMEOUT' });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(10);
    await tx.rollback();
    await connection.release();
    resume.resolve();
    await rejected;
    expect(driver.execute).not.toHaveBeenCalled();
    expect(driver.query).not.toHaveBeenCalled();
    expect(names(events).filter((name) => name === 'finalized:statement:rolled-back')).toHaveLength(
      1,
    );
    await runtime.close();
  },
);

it('contains an execution suspended in an asynchronous codec', async () => {
  const entered = deferred();
  const resume = deferred();
  const encode = vi.spyOn(doublingCodec, 'toWire').mockImplementation(async (value) => {
    entered.resolve();
    await resume.promise;
    return value;
  });
  const { runtime, driver } = createSetup();
  const connection = await runtime.connection();
  const tx = await connection.transaction({ timeout: 10 });
  try {
    const plan = planFromAst(
      RawQueryAst.affectedCount([
        'update t set x = ',
        ParamRef.of(1, { codec: { codecId: doublingCodec.id } }),
      ]),
      testContract,
    );
    const pending = tx.execute(plan);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_TIMEOUT' });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(10);
    await tx.rollback();
    resume.resolve();
    await rejected;
    expect(driver.execute).not.toHaveBeenCalled();
  } finally {
    encode.mockRestore();
    await connection.release();
    await runtime.close();
  }
});

it('preserves callback cleanup ownership after expiry and failed rollback', async () => {
  const rollbackError = new Error('rollback failed');
  const { runtime, events } = createSetup({ failures: { rollback: rollbackError } });
  const run = withTransaction(runtime, async () => new Promise<void>(() => {}), { timeout: 10 });
  const rejected = expect(run).rejects.toMatchObject({
    code: 'RUNTIME.TRANSACTION_ROLLBACK_FAILED',
    cause: { code: 'RUNTIME.TRANSACTION_TIMEOUT' },
    details: { rollbackError },
  });
  await vi.advanceTimersByTimeAsync(10);
  await rejected;
  expect(
    names(events).filter((name) => name === 'rollback' || name === 'destroy' || name === 'release'),
  ).toEqual(['rollback', 'destroy']);
  expect(names(events).filter((name) => name === 'finalized:transaction:rolled-back')).toHaveLength(
    1,
  );
  await runtime.close();
});

it('does not arm when BEGIN fails', async () => {
  const failure = new Error('begin failed');
  const { runtime } = createSetup({ failures: { begin: failure } });
  const connection = await runtime.connection();
  await expect(connection.transaction({ timeout: 10 })).rejects.toBe(failure);
  expect(vi.getTimerCount()).toBe(0);
  await connection.destroy(failure);
  await runtime.close();
});

it('rejects invalid runtime timeout before BEGIN', async () => {
  const { runtime, events } = createSetup();
  const connection = await runtime.connection();
  await expect(connection.transaction({ timeout: 0 })).rejects.toMatchObject({
    code: 'RUNTIME.INVALID_TRANSACTION_TIMEOUT',
  });
  expect(names(events)).not.toContain('begin');
  expect(vi.getTimerCount()).toBe(0);
  await connection.release();
  await runtime.close();
});

it('stops a manual deadline on rollback without reporting timeout', async () => {
  const { runtime } = createSetup();
  const connection = await runtime.connection();
  const tx = await connection.transaction({ timeout: 10 });
  await tx.rollback();
  await vi.advanceTimersByTimeAsync(100);
  expect(tx.signal.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  await connection.release();
  await runtime.close();
});

it('keeps an unconfigured manual transaction untimed', async () => {
  const { runtime } = createSetup();
  const connection = await runtime.connection();
  const tx = await connection.transaction();
  await vi.advanceTimersByTimeAsync(10000);
  expect(tx.signal.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  await tx.rollback();
  await connection.release();
  await runtime.close();
});

it('cannot invalidate once commit is admitted', async () => {
  const settled = deferred();
  const { runtime, events } = createSetup({ failures: { commitHeldUntil: settled.promise } });
  const connection = await runtime.connection();
  const tx = await connection.transaction({ timeout: 10 });
  const committing = tx.commit();
  await vi.advanceTimersByTimeAsync(100);
  expect(tx.signal.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  settled.resolve();
  await committing;
  expect(names(events)).toContain('finalized:transaction:committed');
  await connection.release();
  await runtime.close();
});
