import { ParamRef, RawQueryAst } from '@internal/sql-relational-core/ast';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { expect, it, vi } from 'vitest';
import { withTransaction } from '../src/sql-runtime';
import type { TransactionLifetimeControl } from '../src/transaction-lifetime';
import { deferred } from './closed-runtime-stub';
import {
  createSetup,
  doublingCodec,
  failingDecodePlan,
  names,
  rawPlan,
  testContract,
} from './transaction-activity-fixtures';

it('notifies after BEGIN and refuses work and commit after invalidation', async () => {
  const { runtime, driver, events } = createSetup();
  const connection = await runtime.connection();
  let control: TransactionLifetimeControl | undefined;
  const started = vi.fn((value: TransactionLifetimeControl) => {
    expect(names(events)).toContain('begin');
    control = value;
  });
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
  const starting = connection.transaction(undefined, { started });
  await entered.promise;
  expect(started).not.toHaveBeenCalled();
  resume.resolve();
  const tx = await starting;
  expect(beginSpy).toHaveBeenCalledExactlyOnceWith(undefined);
  const failure = new Error('expired');
  expect(control?.invalidate(failure)).toBe(true);
  expect(control?.invalidate(new Error('late'))).toBe(false);
  await expect(tx.execute(rawPlan('update t set x = 1'))).rejects.toMatchObject({
    code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
  });
  await expect(tx.commit()).rejects.toBe(failure);
  await Promise.all([tx.rollback(), tx.rollback()]);
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
    let control: TransactionLifetimeControl | undefined;
    const tx = await connection.transaction(undefined, {
      started(value) {
        control = value;
      },
    });
    const prepared = await runtime.prepare({}, () => failingDecodePlan());
    const pending =
      operation === 'execute' || operation === 'intercept'
        ? tx.execute(rawPlan('update t set x = 1'))
        : operation === 'query'
          ? tx.query(rawPlan('select id from t')).toArray()
          : prepared.query(tx, {}).toArray();
    const failure = new Error('expired');
    const rejected = expect(pending).rejects.toBe(failure);
    await entered.promise;
    control?.invalidate(failure);
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
  let control: TransactionLifetimeControl | undefined;
  const tx = await connection.transaction(undefined, {
    started(value) {
      control = value;
    },
  });
  try {
    const plan = planFromAst(
      RawQueryAst.affectedCount([
        'update t set x = ',
        ParamRef.of(1, { codec: { codecId: doublingCodec.id } }),
      ]),
      testContract,
    );
    const pending = tx.execute(plan);
    const failure = new Error('expired');
    const rejected = expect(pending).rejects.toBe(failure);
    await entered.promise;
    control?.invalidate(failure);
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

it('preserves callback cleanup ownership after invalidation and failed rollback', async () => {
  const rollbackError = new Error('rollback failed');
  const failure = new Error('expired');
  const { runtime, events } = createSetup({ failures: { rollback: rollbackError } });
  let control: TransactionLifetimeControl | undefined;
  await expect(
    withTransaction(
      runtime,
      async () => {
        expect(control?.invalidate(failure)).toBe(true);
        throw failure;
      },
      undefined,
      {
        started(value) {
          control = value;
        },
      },
    ),
  ).rejects.toMatchObject({
    code: 'RUNTIME.TRANSACTION_ROLLBACK_FAILED',
    cause: failure,
    details: { rollbackError },
  });
  expect(
    names(events).filter((name) => name === 'rollback' || name === 'destroy' || name === 'release'),
  ).toEqual(['rollback', 'destroy']);
  expect(names(events).filter((name) => name === 'finalized:transaction:rolled-back')).toHaveLength(
    1,
  );
  await runtime.close();
});

it('does not notify when BEGIN fails', async () => {
  const failure = new Error('begin failed');
  const { runtime } = createSetup({ failures: { begin: failure } });
  const connection = await runtime.connection();
  const started = vi.fn();
  await expect(connection.transaction(undefined, { started })).rejects.toBe(failure);
  expect(started).not.toHaveBeenCalled();
  await connection.destroy(failure);
  await runtime.close();
});

it('rolls back if the post-BEGIN observer fails', async () => {
  const { runtime, events } = createSetup();
  const connection = await runtime.connection();
  const error = new Error('observer failed');
  await expect(
    connection.transaction(undefined, {
      started() {
        throw error;
      },
    }),
  ).rejects.toBe(error);
  expect(names(events).filter((name) => name === 'rollback')).toHaveLength(1);
  expect(names(events)).toContain('finalized:transaction:rolled-back');
  await connection.release();
  await runtime.close();
});

it('cannot invalidate once commit is admitted', async () => {
  const settled = deferred();
  const { runtime, events } = createSetup({ failures: { commitHeldUntil: settled.promise } });
  const connection = await runtime.connection();
  let control: TransactionLifetimeControl | undefined;
  const tx = await connection.transaction(undefined, {
    started(value) {
      control = value;
    },
  });
  const committing = tx.commit();
  expect(control?.invalidate(new Error('too late'))).toBe(false);
  settled.resolve();
  await committing;
  expect(names(events)).toContain('finalized:transaction:committed');
  await connection.release();
  await runtime.close();
});
