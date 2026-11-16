import { ParamRef, RawQueryAst } from '@internal/sql-relational-core/ast';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withTransaction } from '../src/sql-runtime';
import { deferred } from './closed-runtime-stub';
import {
  createSetup,
  doublingCodec,
  names,
  rawPlan,
  testContract,
} from './transaction-activity-fixtures';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('invalidates manual transaction access and commit while its owner disposes', async () => {
  const { runtime, events } = createSetup();
  const connection = await runtime.connection();
  const tx = await connection.transaction({ timeout: 10 });
  const aborted = vi.fn();
  tx.signal.addEventListener('abort', aborted);
  await vi.advanceTimersByTimeAsync(20);
  expect(aborted).toHaveBeenCalledTimes(1);
  await expect(tx.commit()).rejects.toBe(tx.signal.reason);
  await expect(tx.execute(rawPlan('late'))).rejects.toMatchObject({
    code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
  });
  await connection.destroy(tx.signal.reason);
  expect(
    names(events).filter((name) => ['commit', 'rollback', 'release', 'destroy'].includes(name)),
  ).toEqual(['destroy']);
  expect(names(events).filter((name) => name === 'finalized:transaction:rolled-back')).toHaveLength(
    1,
  );
  await runtime.close();
});

it('refuses dispatch after an asynchronous codec outlasts timeout destruction', async () => {
  const entered = deferred();
  const resume = deferred();
  vi.spyOn(doublingCodec, 'toWire').mockImplementation(async (value) => {
    entered.resolve();
    await resume.promise;
    return value;
  });
  const { runtime, driver } = createSetup();
  const plan = planFromAst(
    RawQueryAst.affectedCount([
      'update t set x = ',
      ParamRef.of(1, { codec: { codecId: doublingCodec.id } }),
    ]),
    testContract,
  );
  const run = withTransaction(runtime, async (tx) => tx.execute(plan), { timeout: 10 });
  const rejected = expect(run).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_TIMEOUT' });
  await entered.promise;
  await vi.advanceTimersByTimeAsync(10);
  await rejected;
  resume.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(driver.execute).not.toHaveBeenCalled();
  await runtime.close();
});
