import { describe, expect, it, vi } from 'vitest';
import type { ActivityParent } from '../src/execution/activity-lifecycle';
import type { RuntimeMiddleware } from '../src/execution/runtime-middleware';
import { gate, openTransaction, startCall, tick } from './client-activity-fixtures';
import { executeStatementWith, type MockExec, recorder } from './statement-fixtures';

function finalizedLog(events: string[]): RuntimeMiddleware<MockExec> {
  return {
    name: 'finalized',
    async activityFinalized(activity, result) {
      const label = activity.kind === 'statement' ? (activity.plan as MockExec).id : activity.kind;
      events.push(`${label}:${result.outcome}`);
    },
  };
}

function statement(
  middleware: ReadonlyArray<RuntimeMiddleware<MockExec>>,
  id: string,
  parent: ActivityParent,
  fails = false,
) {
  return executeStatementWith(
    middleware,
    async () => {
      if (fails) throw new Error(`${id} failed`);
      return { affectedRows: 1 };
    },
    { parent, plan: { id, meta: { target: 'mock', storageHash: 'test', lane: 'raw-sql' } } },
  );
}

describe('finalization beneath client activities', () => {
  it('finalizes the whole subtree in post-order when the transaction ends', async () => {
    const events: string[] = [];
    const middleware = [finalizedLog(events)];
    const transaction = await openTransaction(middleware);

    await statement(middleware, 's1', transaction);
    const outer = await startCall(middleware, { parent: transaction });
    await statement(middleware, 's2', outer);
    const inner = await startCall(middleware, { kind: 'test-count', parent: outer });
    await statement(middleware, 's3', inner);
    await inner.end({ outcome: 'succeeded' });
    await outer.end({ outcome: 'succeeded' });
    await statement(middleware, 's4', transaction);
    const beforeEnd = [...events];
    await transaction.end({ by: 'commit', outcome: 'succeeded' });

    expect(beforeEnd).toEqual([]);
    expect(events).toEqual([
      's1:committed',
      's2:committed',
      's3:committed',
      'test-count:committed',
      'test-call:committed',
      's4:committed',
      'transaction:committed',
    ]);
  });

  it('gives a client activity inside a transaction a context that is in a transaction', async () => {
    const transaction = await openTransaction([]);
    const call = await startCall([], { parent: transaction });
    const nested = await startCall([], { parent: call });

    expect([call.ctx.inTransaction(), nested.ctx.inTransaction()]).toEqual([true, true]);
  });

  describe('which activities make a resolved commit unknown', () => {
    it('is a statement that failed beneath client activities, forwarded to the transaction', async () => {
      const events: string[] = [];
      const middleware = [finalizedLog(events)];
      const transaction = await openTransaction(middleware);
      const outer = await startCall(middleware, { parent: transaction });
      const inner = await startCall(middleware, { kind: 'test-count', parent: outer });

      await expect(statement(middleware, 's1', inner, true)).rejects.toThrow('s1 failed');
      await inner.end({ outcome: 'succeeded' });
      await outer.end({ outcome: 'succeeded' });
      await transaction.end({ by: 'commit', outcome: 'succeeded' });

      expect(events).toEqual([
        's1:unknown',
        'test-count:unknown',
        'test-call:unknown',
        'transaction:unknown',
      ]);
    });

    it('is not a client activity that failed with no failed statement beneath it', async () => {
      const events: string[] = [];
      const middleware = [finalizedLog(events)];
      const transaction = await openTransaction(middleware);
      const call = await startCall(middleware, { parent: transaction });

      await statement(middleware, 's1', call);
      await call.end({ outcome: 'failed' });
      await transaction.end({ by: 'commit', outcome: 'succeeded' });

      expect(events).toEqual(['s1:committed', 'test-call:committed', 'transaction:committed']);
    });
  });

  describe('a client activity outside a transaction', () => {
    it('is finalized unknown when a nested activity was finalized unknown', async () => {
      const events: string[] = [];
      const middleware = [finalizedLog(events)];
      const outer = await startCall(middleware);
      const inner = await startCall(middleware, { kind: 'test-count', parent: outer });

      await expect(statement(middleware, 's1', inner, true)).rejects.toThrow('s1 failed');
      await inner.end({ outcome: 'succeeded' });
      await outer.end({ outcome: 'succeeded' });

      expect(events).toEqual(['s1:unknown', 'test-count:unknown', 'test-call:unknown']);
    });

    it('is finalized unknown when its transaction was finalized unknown', async () => {
      const events: string[] = [];
      const middleware = [finalizedLog(events)];
      const call = await startCall(middleware);
      const transaction = await openTransaction(middleware, { parent: call });

      await statement(middleware, 's1', transaction);
      await transaction.end({ by: 'commit', outcome: 'failed' });
      const eventsAfterTransaction = [...events];
      await call.end({ outcome: 'succeeded' });

      expect(eventsAfterTransaction).toEqual(['s1:unknown', 'transaction:unknown']);
      expect(events.at(-1)).toBe('test-call:unknown');
    });

    it('is finalized unknown when its transaction rolled back', async () => {
      const events: string[] = [];
      const middleware = [finalizedLog(events)];
      const call = await startCall(middleware);
      const transaction = await openTransaction(middleware, { parent: call });

      await transaction.end({ by: 'rollback', outcome: 'succeeded', commitAttempted: false });
      await call.end({ outcome: 'succeeded' });

      expect(events).toEqual(['transaction:rolled-back', 'test-call:unknown']);
    });
  });

  describe('with no finished children held', () => {
    it('holds nothing at any depth', async () => {
      const transaction = await openTransaction([], { holdFinishedChildren: false });
      const call = await startCall([], { parent: transaction, holdFinishedChildren: false });
      const finalize = vi.fn(async () => {});

      const slot = call.adopt({ finalize });
      await slot.ended({ outcome: 'committed' });
      await call.end({ outcome: 'succeeded' });
      await transaction.end({ by: 'commit', outcome: 'succeeded' });

      expect(finalize).not.toHaveBeenCalled();
    });

    it('still forwards a failed statement to the transaction', async () => {
      const events: string[] = [];
      const observer = finalizedLog(events);
      const transaction = await openTransaction([observer], { holdFinishedChildren: false });
      const call = await startCall([], { parent: transaction, holdFinishedChildren: false });

      await expect(statement([], 's1', call, true)).rejects.toThrow('s1 failed');
      await call.end({ outcome: 'succeeded' });
      await transaction.end({ by: 'commit', outcome: 'succeeded' });

      expect(events).toEqual(['transaction:unknown']);
    });

    it('still counts open children', async () => {
      const transaction = await openTransaction([], { holdFinishedChildren: false });
      const call = await startCall([], { parent: transaction, holdFinishedChildren: false });
      call.adopt({ finalize: async () => {} });

      await expect(call.end({ outcome: 'succeeded' })).rejects.toMatchObject({
        code: 'RUNTIME.ACTIVITY_CHILDREN_OPEN',
      });
    });
  });

  describe('a subtree still open when its transaction ends', () => {
    it('is finalized when it ends, with the outcome the transaction recorded', async () => {
      const events: string[] = [];
      const middleware = [recorder('A', events)];
      const transaction = await openTransaction(middleware);
      const call = await startCall(middleware, { parent: transaction });
      const statementGate = gate();
      const running = executeStatementWith(
        middleware,
        async () => {
          await statementGate.wait;
          return { affectedRows: 1 };
        },
        { parent: call },
      );
      await tick();

      await transaction.end({ by: 'rollback', outcome: 'succeeded', commitAttempted: false });
      statementGate.release();
      await running;
      const beforeCallEnds = [...events];
      await call.end({ outcome: 'succeeded' });

      expect(beforeCallEnds.filter((event) => event.includes(':finalized:'))).toEqual([
        'A:finalized:transaction:rolled-back',
      ]);
      expect(events.slice(beforeCallEnds.length)).toEqual([
        'A:ended:test-call:succeeded',
        'A:finalized:statement:rolled-back',
        'A:finalized:test-call:rolled-back',
      ]);
    });

    it('finalizes a child still open at its end when that child ends', async () => {
      const events: string[] = [];
      const middleware = [finalizedLog(events)];
      const transaction = await openTransaction(middleware);
      const call = await startCall(middleware, { parent: transaction });
      const statementGate = gate();
      const running = executeStatementWith(
        middleware,
        async () => {
          await statementGate.wait;
          return { affectedRows: 1 };
        },
        { parent: call },
      );
      await tick();

      await transaction.end({ by: 'commit', outcome: 'succeeded' });
      await expect(call.end({ outcome: 'succeeded' })).rejects.toMatchObject({
        code: 'RUNTIME.ACTIVITY_CHILDREN_OPEN',
      });
      statementGate.release();
      await running;

      expect(events).toEqual(['transaction:committed', 'test-call:committed', 'exec-1:committed']);
    });

    it('refuses new work beneath its client activities', async () => {
      const transaction = await openTransaction([]);
      const call = await startCall([], { parent: transaction });
      const nested = await startCall([], { parent: call });
      await transaction.end({ by: 'commit', outcome: 'succeeded' });

      await expect(
        executeStatementWith([], async () => ({ affectedRows: 1 }), { parent: nested }),
      ).rejects.toMatchObject({
        code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
        details: { parentKind: 'test-call' },
      });
      await expect(startCall([], { parent: call })).rejects.toMatchObject({
        code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
      });
    });
  });

  it('refuses new work once the transaction stops accepting children, before the transaction ends', async () => {
    const transaction = await openTransaction([]);
    const call = await startCall([], { parent: transaction });

    transaction.stopAcceptingChildren();

    await expect(
      executeStatementWith([], async () => ({ affectedRows: 1 }), { parent: call }),
    ).rejects.toMatchObject({ code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN' });
    await expect(
      executeStatementWith([], async () => ({ affectedRows: 1 }), { parent: transaction }),
    ).rejects.toMatchObject({ code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN' });
  });
});
