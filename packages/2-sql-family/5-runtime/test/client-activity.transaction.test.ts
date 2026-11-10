import { describe, expect, it, vi } from 'vitest';
import { startActivityOn } from '../src/activity-handle';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import { settlementOf } from '../src/transaction-state';
import { testCall } from './client-activity-kinds';
import { createSetup, type HookEvent, names, rawPlan } from './transaction-activity-fixtures';

function eventOf(events: readonly HookEvent[], name: string): HookEvent | undefined {
  return events.find((candidate) => candidate.name === name);
}

const driverCalls = (events: readonly HookEvent[]) =>
  names(events).filter((name) =>
    ['begin', 'commit', 'rollback', 'release', 'destroy'].includes(name),
  );

function refusingTransactionStart(refusal: Error): SqlMiddleware {
  return {
    name: 'refusing-start',
    familyId: 'sql',
    async activityStarted(activity) {
      if (activity.kind === 'transaction') throw refusal;
    },
  };
}

describe('the transaction of an activity handle', () => {
  describe('opened on the runtime', () => {
    it('starts beneath the activity on a connection it releases after commit', async () => {
      const { runtime, events } = createSetup();
      const call = await startActivityOn(runtime, testCall);

      const transaction = await call.transaction?.();
      await transaction?.execute(rawPlan('update t set x = 1'));
      await transaction?.commit();
      await call.end({ outcome: 'succeeded' });

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

    it('releases the connection after a rollback', async () => {
      const { runtime, events } = createSetup();
      const call = await startActivityOn(runtime, testCall);

      const transaction = await call.transaction?.();
      await transaction?.rollback();
      await call.end({ outcome: 'failed' });

      expect(driverCalls(events)).toEqual(['begin', 'rollback', 'release']);
    });

    it('destroys the connection after a failed rollback', async () => {
      const { runtime, events } = createSetup({
        failures: { rollback: new Error('rollback failed') },
      });
      const call = await startActivityOn(runtime, testCall);

      const transaction = await call.transaction?.();
      await expect(transaction?.rollback()).rejects.toThrow('rollback failed');
      await call.end({ outcome: 'failed' });

      expect(driverCalls(events)).toEqual(['begin', 'rollback', 'destroy']);
    });

    it('keeps the connection after a failed commit until the rollback that follows', async () => {
      const { runtime, events } = createSetup({ failures: { commit: new Error('commit failed') } });
      const call = await startActivityOn(runtime, testCall);

      const transaction = await call.transaction?.();
      await expect(transaction?.commit()).rejects.toThrow('commit failed');
      const afterCommit = driverCalls(events);
      await transaction?.rollback();
      await call.end({ outcome: 'failed' });

      expect(afterCommit).toEqual(['begin', 'commit']);
      expect(driverCalls(events)).toEqual(['begin', 'commit', 'rollback', 'release']);
    });

    it('destroys the connection when BEGIN fails', async () => {
      const { runtime, events } = createSetup({ failures: { begin: new Error('begin failed') } });
      const call = await startActivityOn(runtime, testCall);

      await expect(call.transaction?.()).rejects.toThrow('begin failed');
      await call.end({ outcome: 'failed' });

      expect(driverCalls(events)).toEqual(['begin', 'destroy']);
    });

    it('releases the connection without destroying it when activityStarted refuses the transaction', async () => {
      const refused = new Error('started failed');
      const { runtime, events } = createSetup({ middleware: [refusingTransactionStart(refused)] });
      const call = await startActivityOn(runtime, testCall);

      await expect(call.transaction?.()).rejects.toBe(refused);
      await call.end({ outcome: 'failed' });

      expect(driverCalls(events)).toEqual(['release']);
    });

    it('rejects with the refusal when releasing the refused connection fails', async () => {
      const refused = new Error('started failed');
      const { runtime, events } = createSetup({
        failures: { release: new Error('release failed') },
        middleware: [refusingTransactionStart(refused)],
      });
      const call = await startActivityOn(runtime, testCall);

      await expect(call.transaction?.()).rejects.toBe(refused);
      await call.end({ outcome: 'failed' });

      expect(driverCalls(events)).toEqual(['release']);
    });

    it('rejects with the BEGIN error when destroying the connection fails', async () => {
      const beginFailure = new Error('begin failed');
      const { runtime, events } = createSetup({
        failures: { begin: beginFailure, destroy: new Error('destroy failed') },
      });
      const call = await startActivityOn(runtime, testCall);

      await expect(call.transaction?.()).rejects.toBe(beginFailure);
      await call.end({ outcome: 'failed' });

      expect(driverCalls(events)).toEqual(['begin', 'destroy']);
    });

    it('rejects with the rollback error when destroying the connection after it fails', async () => {
      const rollbackFailure = new Error('rollback failed');
      const { runtime, events } = createSetup({
        failures: { rollback: rollbackFailure, destroy: new Error('destroy failed') },
      });
      const call = await startActivityOn(runtime, testCall);

      const transaction = await call.transaction?.();
      await expect(transaction?.rollback()).rejects.toBe(rollbackFailure);
      await call.end({ outcome: 'failed' });

      expect(driverCalls(events)).toEqual(['begin', 'rollback', 'destroy']);
    });

    it('resolves commit and logs the error when releasing the connection fails after it', async () => {
      const error = vi.fn();
      const releaseFailure = new Error('release failed');
      const { runtime } = createSetup({
        failures: { release: releaseFailure },
        log: { info: vi.fn(), warn: vi.fn(), error },
      });
      const call = await startActivityOn(runtime, testCall);

      const transaction = await call.transaction?.();
      await expect(transaction?.commit()).resolves.toBeUndefined();
      await call.end({ outcome: 'succeeded' });

      expect(error).toHaveBeenCalledWith({
        event: 'runtime.connection.release.error',
        error: releaseFailure,
      });
    });

    it('resolves rollback and logs the error when releasing the connection fails after it', async () => {
      const error = vi.fn();
      const releaseFailure = new Error('release failed');
      const { runtime } = createSetup({
        failures: { release: releaseFailure },
        log: { info: vi.fn(), warn: vi.fn(), error },
      });
      const call = await startActivityOn(runtime, testCall);

      const transaction = await call.transaction?.();
      await expect(transaction?.rollback()).resolves.toBeUndefined();
      await call.end({ outcome: 'failed' });

      expect(error).toHaveBeenCalledWith({
        event: 'runtime.connection.release.error',
        error: releaseFailure,
      });
    });

    it('keeps the commit error and logs the release error when the database committed', async () => {
      const error = vi.fn();
      const releaseFailure = new Error('release failed');
      const hookFailure = new Error('activityEnded failed');
      const { runtime } = createSetup({
        failures: { release: releaseFailure },
        log: { info: vi.fn(), warn: vi.fn(), error },
        middleware: [
          {
            name: 'failing',
            familyId: 'sql',
            async activityEnded(activity) {
              if (activity.kind === 'transaction') throw hookFailure;
            },
          },
        ],
      });
      const call = await startActivityOn(runtime, testCall);

      const transaction = await call.transaction?.();
      await expect(transaction?.commit()).rejects.toBe(hookFailure);
      await call.end({ outcome: 'failed' });

      expect(error).toHaveBeenCalledWith({
        event: 'runtime.connection.release.error',
        error: releaseFailure,
      });
    });

    it('carries the settlement of the transaction it wraps', async () => {
      const { runtime } = createSetup();
      const call = await startActivityOn(runtime, testCall);

      const transaction = await call.transaction?.();
      await transaction?.commit();
      await call.end({ outcome: 'succeeded' });

      expect(transaction && settlementOf(transaction)?.committed).toBe(true);
    });
  });

  it('opened on a connection, begins on that connection and leaves it held', async () => {
    const { runtime, events } = createSetup();
    const connection = await runtime.connection();
    const call = await startActivityOn(connection, testCall);

    const transaction = await call.transaction?.();
    await transaction?.commit();
    await call.end({ outcome: 'succeeded' });
    const beforeRelease = driverCalls(events);
    await connection.release();

    expect(beforeRelease).toEqual(['begin', 'commit']);
  });

  it('rejects on an ended handle without taking a connection', async () => {
    const { runtime, events } = createSetup();
    const call = await startActivityOn(runtime, testCall);
    await call.end({ outcome: 'succeeded' });

    await expect(call.transaction?.()).rejects.toMatchObject({
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

  it('rejects a second transaction on a connection handle while the first is open', async () => {
    const { runtime, events } = createSetup();
    const connection = await runtime.connection();
    const call = await startActivityOn(connection, testCall);
    const first = await call.transaction?.();

    await expect(call.transaction?.()).rejects.toMatchObject({
      code: 'RUNTIME.TRANSACTION_ALREADY_OPEN',
    });
    expect(driverCalls(events)).toEqual(['begin']);
    await first?.commit();
    await call.end({ outcome: 'succeeded' });
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
