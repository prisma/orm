import { startClientActivity } from '@internal/framework-components/runtime';
import { describe, expect, it } from 'vitest';
import { startActivityOn } from '../src/activity-handle';
import { withTransaction } from '../src/sql-runtime';
import { testCall } from './client-activity-kinds';
import { createSetup, type HookEvent, names, rawPlan } from './transaction-activity-fixtures';

function eventOf(events: readonly HookEvent[], name: string): HookEvent | undefined {
  return events.find((candidate) => candidate.name === name);
}

const driverCalls = (events: readonly HookEvent[]) =>
  names(events).filter((name) =>
    ['begin', 'commit', 'rollback', 'release', 'destroy'].includes(name),
  );

describe('the transaction of an activity handle', () => {
  describe('opened on the runtime', () => {
    it('runs the callback beneath the activity, commits and releases the connection', async () => {
      const { runtime, events } = createSetup();
      const call = await startActivityOn(runtime, testCall);

      const result = await call.transaction?.(async (tx) => {
        await tx.execute(rawPlan('update t set x = 1'));
        return 'done';
      });
      await call.end({ outcome: 'succeeded' });

      expect(result).toBe('done');
      expect(eventOf(events, 'started:transaction')?.ctx?.parent).toBe(
        eventOf(events, 'started:test-call')?.ctx,
      );
      expect(driverCalls(events)).toEqual(['begin', 'commit', 'release']);
      expect(names(events).filter((name) => name.startsWith('finalized:'))).toEqual([
        'finalized:statement:committed',
        'finalized:transaction:committed',
        'finalized:test-call:committed',
      ]);
    });

    it('rolls back, releases the connection and rethrows when the callback throws', async () => {
      const { runtime, events } = createSetup();
      const call = await startActivityOn(runtime, testCall);
      const failure = new Error('callback failed');

      await expect(
        call.transaction?.(async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      await call.end({ outcome: 'failed' });

      expect(driverCalls(events)).toEqual(['begin', 'rollback', 'release']);
    });
  });

  it('of withTransaction starts beneath the parent it is given', async () => {
    const { runtime, events } = createSetup();
    await runtime.execute(rawPlan('select 1'));
    const context = eventOf(events, 'started:statement')?.ctx;
    if (context === undefined) throw new Error('no statement context');
    const parent = await startClientActivity(testCall, {
      middleware: [],
      context,
      parent: undefined,
      holdFinishedChildren: false,
    });

    await withTransaction(runtime, async () => undefined, undefined, parent);
    await parent.end({ outcome: 'succeeded' });

    expect(eventOf(events, 'started:transaction')?.ctx?.parent).toBe(parent.ctx);
  });

  describe('opened on a connection', () => {
    it('never releases the connection, after a commit, a rollback or a refused start', async () => {
      let transactionStarts = 0;
      const { runtime, events } = createSetup({
        middleware: [
          {
            name: 'refuse-third',
            familyId: 'sql',
            async activityStarted(activity) {
              if (activity.kind === 'transaction' && ++transactionStarts === 3) {
                throw new Error('refused');
              }
            },
          },
        ],
      });
      const connection = await runtime.connection();
      const call = await startActivityOn(connection, testCall);

      await call.transaction?.(async () => undefined);
      await call.transaction?.(async () => Promise.reject(new Error('failed'))).catch(() => {});
      await call.transaction?.(async () => undefined).catch(() => {});
      await call.end({ outcome: 'succeeded' });
      const beforeRelease = driverCalls(events);
      await connection.release();

      expect(beforeRelease).toEqual(['begin', 'commit', 'begin', 'rollback']);
    });

    it('begins on that connection and leaves it held after commit and after rollback', async () => {
      const { runtime, events } = createSetup();
      const connection = await runtime.connection();
      const call = await startActivityOn(connection, testCall);

      await call.transaction?.(async (tx) => tx.execute(rawPlan('update t set x = 1')));
      await expect(
        call.transaction?.(async () => {
          throw new Error('callback failed');
        }),
      ).rejects.toThrow('callback failed');
      await call.end({ outcome: 'failed' });
      const beforeRelease = driverCalls(events);
      await connection.release();

      expect(beforeRelease).toEqual(['begin', 'commit', 'begin', 'rollback']);
    });

    it('destroys the connection after a failed rollback', async () => {
      const { runtime, events } = createSetup({
        failures: { rollback: new Error('rollback failed') },
      });
      const connection = await runtime.connection();
      const call = await startActivityOn(connection, testCall);

      await expect(
        call.transaction?.(async () => {
          throw new Error('callback failed');
        }),
      ).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_ROLLBACK_FAILED' });
      await call.end({ outcome: 'failed' });

      expect(driverCalls(events)).toEqual(['begin', 'rollback', 'destroy']);
    });

    it('rejects a second transaction while the first is starting, and begins a new one after the first settles', async () => {
      let releaseStart: () => void = () => {};
      const startHeld = new Promise<void>((resolve) => {
        releaseStart = resolve;
      });
      let transactionStarts = 0;
      const { runtime, events } = createSetup({
        middleware: [
          {
            name: 'slow-start',
            familyId: 'sql',
            async activityStarted(activity) {
              if (activity.kind === 'transaction' && ++transactionStarts === 1) await startHeld;
            },
          },
        ],
      });
      const connection = await runtime.connection();
      const call = await startActivityOn(connection, testCall);

      const first = call.transaction?.(async (tx) => tx.execute(rawPlan('update t set x = 1')));
      await expect(call.transaction?.(async () => undefined)).rejects.toMatchObject({
        code: 'RUNTIME.TRANSACTION_ALREADY_OPEN',
      });
      const beforeStart = driverCalls(events);
      releaseStart();
      await first;
      await call.transaction?.(async () => undefined);
      await call.end({ outcome: 'succeeded' });
      const beforeRelease = driverCalls(events);
      await connection.release();

      expect({ beforeStart, beforeRelease }).toEqual({
        beforeStart: [],
        beforeRelease: ['begin', 'commit', 'begin', 'commit'],
      });
    });

    it('begins a new transaction after a refused start', async () => {
      const refusal = new Error('started failed');
      let transactionStarts = 0;
      const { runtime, events } = createSetup({
        middleware: [
          {
            name: 'refuse-first',
            familyId: 'sql',
            async activityStarted(activity) {
              if (activity.kind === 'transaction' && ++transactionStarts === 1) throw refusal;
            },
          },
        ],
      });
      const connection = await runtime.connection();
      const call = await startActivityOn(connection, testCall);

      await expect(call.transaction?.(async () => undefined)).rejects.toBe(refusal);
      await call.transaction?.(async () => undefined);
      await call.end({ outcome: 'succeeded' });
      const beforeRelease = driverCalls(events);
      await connection.release();

      expect(beforeRelease).toEqual(['begin', 'commit']);
    });

    it('rejects a second transaction while the first is open, leaving the connection held', async () => {
      const { runtime, events } = createSetup();
      const connection = await runtime.connection();
      const call = await startActivityOn(connection, testCall);

      await call.transaction?.(async () => {
        await expect(call.transaction?.(async () => undefined)).rejects.toMatchObject({
          code: 'RUNTIME.TRANSACTION_ALREADY_OPEN',
        });
      });
      await call.end({ outcome: 'succeeded' });
      const beforeRelease = driverCalls(events);
      await connection.release();

      expect(beforeRelease).toEqual(['begin', 'commit']);
    });
  });

  it('rejects on an ended handle without taking a connection', async () => {
    const { runtime, events } = createSetup();
    const call = await startActivityOn(runtime, testCall);
    await call.end({ outcome: 'succeeded' });

    await expect(call.transaction?.(async () => undefined)).rejects.toMatchObject({
      code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
    });
    expect(driverCalls(events)).toEqual([]);
  });

  it('is absent on a handle opened on a connection whose transaction is open', async () => {
    const { runtime } = createSetup();
    const connection = await runtime.connection();
    const transaction = await connection.transaction();

    const call = await startActivityOn(connection, testCall);

    expect('transaction' in call).toBe(false);
    await call.end({ outcome: 'succeeded' });
    await transaction.commit();
    await connection.release();
  });

  it('is absent on a handle opened under a transaction, and on the handles nested in it', async () => {
    const { runtime } = createSetup();
    const connection = await runtime.connection();
    const transaction = await connection.transaction();

    const call = await startActivityOn(transaction, testCall);
    const nested = await call.startActivity(testCall);

    expect(['transaction' in call, 'transaction' in nested]).toEqual([false, false]);
    await nested.end({ outcome: 'succeeded' });
    await call.end({ outcome: 'succeeded' });
    await transaction.commit();
    await connection.release();
  });
});
