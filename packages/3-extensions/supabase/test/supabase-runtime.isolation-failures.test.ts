import { startActivityOn, withTransaction } from '@internal/sql-runtime';
import { describe, expect, it, vi } from 'vitest';
import { createTestSetup } from './supabase-runtime-fixtures';

const testCall = { kind: 'test-call', contentHash: async () => 'test' } as const;

describe.each(['callback', 'activity'] as const)(
  'role isolation %s ownership failures',
  (route) => {
    it.each(['setup', 'begin', 'refusal', 'reset'] as const)(
      'preserves %s error ownership and settlement',
      async (point) => {
        const failure = new Error(`${point} failed`);
        const events: string[] = [];
        const { runtime, driver } = createTestSetup({
          middleware: [
            {
              name: 'record-and-refuse',
              async activityStarted(activity) {
                if (point === 'refusal' && activity.kind === 'transaction') throw failure;
              },
              async activityEnded(activity, result) {
                if (activity.kind === 'transaction') {
                  events.push(`ended:${result.outcome}`);
                  if (point === 'begin' || point === 'refusal') throw new Error('end hook failed');
                }
              },
              async activityFinalized(activity, result) {
                if (activity.kind === 'transaction') events.push(`finalized:${result.outcome}`);
              },
            },
          ],
        });
        const connection = driver.connection;
        if (point === 'setup') connection.execute.mockRejectedValueOnce(failure);
        if (point === 'begin') connection.beginTransactionSpy.mockRejectedValueOnce(failure);
        if (point !== 'refusal')
          connection.destroy.mockRejectedValueOnce(new Error('destroy failed'));
        const callback = vi.fn(async () => {
          if (point === 'reset') connection.execute.mockRejectedValueOnce(failure);
          return 42;
        });
        const activity =
          route === 'activity'
            ? await startActivityOn(runtime.forRole({ role: 'anon' }), testCall)
            : undefined;
        const run = async () => {
          if (activity) {
            const tx = await activity.transaction?.(undefined);
            if (!tx) throw new Error('Expected transaction');
            const result = await callback();
            await tx.commit();
            return result;
          }
          return withTransaction(runtime.forRole({ role: 'anon' }), callback, {
            isolationLevel: 'Serializable',
          });
        };
        try {
          if (point === 'reset') await expect(run()).resolves.toBe(42);
          else await expect(run()).rejects.toBe(failure);
          expect(callback).toHaveBeenCalledTimes(point === 'reset' ? 1 : 0);
          expect(connection.beginTransactionSpy.mock.calls).toEqual(
            point === 'setup' || point === 'refusal'
              ? []
              : [[route === 'activity' ? undefined : { isolationLevel: 'Serializable' }]],
          );
          expect(connection.release).toHaveBeenCalledTimes(point === 'refusal' ? 1 : 0);
          expect(connection.destroy).toHaveBeenCalledTimes(point === 'refusal' ? 0 : 1);
          if (point !== 'refusal') expect(connection.destroy).toHaveBeenCalledWith(failure);
          expect(events).toEqual(
            point === 'setup'
              ? []
              : point === 'reset'
                ? ['ended:succeeded', 'finalized:committed']
                : ['ended:failed', 'finalized:rolled-back'],
          );
        } finally {
          await activity?.end({ outcome: point === 'reset' ? 'succeeded' : 'failed' });
          await runtime.close();
        }
      },
    );

    it('destroys after an uncertain rollback and preserves callback error causality', async () => {
      const { runtime, driver } = createTestSetup();
      const failure = new Error('callback failed');
      const rollback = new Error('rollback failed');
      driver.connection.transaction.rollback.mockRejectedValueOnce(rollback);
      const activity =
        route === 'activity'
          ? await startActivityOn(runtime.forRole({ role: 'anon' }), testCall)
          : undefined;
      try {
        if (activity) {
          const tx = await activity.transaction?.(undefined);
          await expect(tx?.rollback()).rejects.toBe(rollback);
        } else {
          await expect(
            withTransaction(
              runtime.forRole({ role: 'anon' }),
              async () => {
                throw failure;
              },
              { isolationLevel: 'Serializable' },
            ),
          ).rejects.toMatchObject({
            code: 'RUNTIME.TRANSACTION_ROLLBACK_FAILED',
            cause: failure,
            details: { rollbackError: rollback },
          });
        }
        expect(driver.connection.release).not.toHaveBeenCalled();
        expect(driver.connection.destroy).toHaveBeenCalledTimes(1);
      } finally {
        await activity?.end({ outcome: 'failed' });
        await runtime.close();
      }
    });
  },
);
