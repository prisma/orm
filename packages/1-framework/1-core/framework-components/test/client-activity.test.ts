import { describe, expect, it, vi } from 'vitest';
import { startClientActivity } from '../src/execution/client-activity';
import type {
  Activity,
  ActivityContext,
  ActivityEndedResult,
  ClientActivityKind,
  RuntimeMiddleware,
} from '../src/execution/runtime-middleware';
import { gate, openTransaction, startCall, tick } from './client-activity-fixtures';
import {
  contextFields,
  executeStatementWith,
  type MockExec,
  queryStatement,
  recorder,
  yieldRows,
} from './statement-fixtures';

function interceptor(
  name: string,
  events: string[],
  result: { readonly result: unknown } | undefined,
): RuntimeMiddleware<MockExec> {
  return {
    name,
    intercept: {
      async onActivity(activity) {
        events.push(`${name}:onActivity:${activity.kind}`);
        return result;
      },
    },
  };
}

function isLifecycleEvent(event: string): boolean {
  return /:(started|ended|finalized):/.test(event);
}

function endedResults(results: ActivityEndedResult[]): RuntimeMiddleware<MockExec> {
  return {
    name: 'ended-results',
    async activityEnded(_activity, result) {
      results.push(result);
    },
  };
}

describe('client activity', () => {
  it('starts with the kind, content hash and annotations the client gave, and its own context', async () => {
    const started: Array<{ activity: Activity; ctx: ActivityContext }> = [];
    const observer: RuntimeMiddleware<MockExec> = {
      name: 'observer',
      async activityStarted(activity, ctx) {
        started.push({ activity, ctx });
      },
    };

    const call = await startCall([observer]);

    expect(started).toEqual([{ activity: call.activity, ctx: call.ctx }]);
    expect(call.activity).toEqual({
      id: expect.any(String),
      kind: 'test-call',
      contentHash: expect.any(Function),
      annotations: new Map(),
    });
    expect(await call.activity.contentHash()).toBe('call-hash');
    expect({ parent: call.ctx.parent, intercepted: call.intercepted }).toEqual({
      parent: undefined,
      intercepted: undefined,
    });
  });

  it('computes the content hash once, on the first call, and only when asked', async () => {
    const computeContentHash = vi.fn(async () => 'lazy-hash');
    const hashes: string[] = [];
    const asker: RuntimeMiddleware<MockExec> = {
      name: 'asker',
      async activityStarted(activity) {
        if (activity.kind === 'statement' || activity.kind === 'transaction') return;
        hashes.push(await activity.contentHash(), await activity.contentHash());
      },
    };
    const options = {
      context: contextFields(),
      parent: undefined,
      holdFinishedChildren: true,
    } as const;

    const unasked = await startClientActivity(
      { kind: 'test-call', contentHash: computeContentHash },
      { ...options, middleware: [] },
    );
    const callsWhenUnasked = computeContentHash.mock.calls.length;
    await startClientActivity(
      { kind: 'test-call', contentHash: computeContentHash },
      { ...options, middleware: [asker] },
    );

    expect({ callsWhenUnasked, calls: computeContentHash.mock.calls.length, hashes }).toEqual({
      callsWhenUnasked: 0,
      calls: 1,
      hashes: ['lazy-hash', 'lazy-hash'],
    });
    await unasked.end({ outcome: 'succeeded' });
  });

  it.each(['statement', 'transaction', 'report'])(
    'rejects the kind %s, which has no hyphen, and runs no hook',
    async (kind) => {
      const events: string[] = [];

      await expect(
        startCall([recorder('A', events)], { kind: kind as ClientActivityKind }),
      ).rejects.toMatchObject({ code: 'RUNTIME.ACTIVITY_KIND_RESERVED', details: { kind } });
      expect(events).toEqual([]);
    },
  );

  describe('outside a transaction', () => {
    it.each([
      { outcome: 'succeeded', finalized: 'committed' },
      { outcome: 'failed', finalized: 'unknown' },
      { outcome: 'stopped', finalized: 'unknown' },
    ] as const)(
      'is finalized $finalized right after it ends $outcome',
      async ({ outcome, finalized }) => {
        const events: string[] = [];
        const call = await startCall([recorder('A', events)]);

        await call.end({ outcome });

        expect(events).toEqual([
          'A:started:test-call',
          `A:ended:test-call:${outcome}`,
          `A:finalized:test-call:${finalized}`,
        ]);
      },
    );

    it('is the parent of its statements, which are finalized when they end', async () => {
      const events: string[] = [];
      const parents: Array<ActivityContext | undefined> = [];
      const middleware: RuntimeMiddleware<MockExec>[] = [
        recorder('A', events),
        {
          name: 'parents',
          async activityStarted(activity, ctx) {
            if (activity.kind === 'statement') parents.push(ctx.parent);
          },
        },
      ];
      const call = await startCall(middleware);

      await executeStatementWith(middleware, async () => ({ affectedRows: 1 }), { parent: call });
      const beforeEnd = events.filter(isLifecycleEvent);
      await call.end({ outcome: 'succeeded' });

      expect(parents).toEqual([call.ctx]);
      expect(beforeEnd).toEqual([
        'A:started:test-call',
        'A:started:statement',
        'A:ended:statement:succeeded',
        'A:finalized:statement:committed',
      ]);
      expect(events.filter(isLifecycleEvent).slice(beforeEnd.length)).toEqual([
        'A:ended:test-call:succeeded',
        'A:finalized:test-call:committed',
      ]);
    });

    it('is the parent of a transaction, whose context is not in a transaction', async () => {
      const call = await startCall([]);
      const transaction = await openTransaction([], { parent: call });

      expect({
        parent: transaction.ctx.parent,
        inTransaction: transaction.ctx.inTransaction(),
      }).toEqual({ parent: call.ctx, inTransaction: false });
    });
  });

  describe('intercept.onActivity', () => {
    it('runs after activityStarted in registration order, and the first result wins', async () => {
      const events: string[] = [];
      const middleware = [
        recorder('A', events),
        interceptor('miss', events, undefined),
        interceptor('hit', events, { result: [{ id: 1 }] }),
        interceptor('later', events, { result: [{ id: 2 }] }),
      ];

      const call = await startCall(middleware);
      await call.end({ outcome: 'succeeded' });

      expect(events).toEqual([
        'A:started:test-call',
        'miss:onActivity:test-call',
        'hit:onActivity:test-call',
        'A:ended:test-call:succeeded',
        'A:finalized:test-call:committed',
      ]);
      expect(call.intercepted).toEqual({ result: [{ id: 1 }] });
    });

    it('logs a debug event naming the middleware that supplied the result', async () => {
      const debug = vi.fn();

      await startClientActivity(
        { kind: 'test-call', contentHash: async () => 'call-hash' },
        {
          middleware: [interceptor('hit', [], { result: [] })],
          context: contextFields({
            log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug },
          }),
          parent: undefined,
          holdFinishedChildren: true,
        },
      );

      expect(debug).toHaveBeenCalledWith({
        event: 'middleware.intercept.onActivity',
        middleware: 'hit',
      });
    });

    it('ends with the intercepted result and source middleware when the client passes no result', async () => {
      const results: ActivityEndedResult[] = [];
      const call = await startCall([
        interceptor('hit', [], { result: [{ id: 1 }] }),
        endedResults(results),
      ]);

      await call.end({ outcome: 'succeeded' });

      expect(results).toEqual([
        { kind: 'test-call', outcome: 'succeeded', source: 'middleware', result: [{ id: 1 }] },
      ]);
    });

    it('ends with the client result and source client when the client passes one', async () => {
      const results: ActivityEndedResult[] = [];
      const call = await startCall([
        interceptor('hit', [], { result: [{ id: 1 }] }),
        endedResults(results),
      ]);

      await call.end({ outcome: 'succeeded', result: [{ id: 3 }] });

      expect(results).toEqual([
        { kind: 'test-call', outcome: 'succeeded', source: 'client', result: [{ id: 3 }] },
      ]);
    });

    it('ends failed, is finalized and rejects the start with the error a handler throws', async () => {
      const events: string[] = [];
      const results: ActivityEndedResult[] = [];
      const thrown = new Error('onActivity failed');
      const later = vi.fn(async () => undefined);

      await expect(
        startCall([
          recorder('A', events),
          endedResults(results),
          {
            name: 'failing',
            intercept: {
              async onActivity() {
                throw thrown;
              },
            },
          },
          { name: 'later', intercept: { onActivity: later } },
        ]),
      ).rejects.toBe(thrown);

      expect(events).toEqual([
        'A:started:test-call',
        'A:ended:test-call:failed',
        'A:finalized:test-call:unknown',
      ]);
      expect(results).toEqual([{ kind: 'test-call', outcome: 'failed', source: 'middleware' }]);
      expect(later).not.toHaveBeenCalled();
    });

    it('lets statements run on an intercepted activity', async () => {
      const call = await startCall([interceptor('hit', [], { result: [] })]);

      await expect(
        executeStatementWith([], async () => ({ affectedRows: 1 }), { parent: call }),
      ).resolves.toEqual({ affectedRows: 1 });
    });
  });

  it('ends failed, finalizes unknown and rejects when activityStarted throws', async () => {
    const events: string[] = [];
    const refused = new Error('started failed');

    await expect(
      startCall([
        recorder('A', events),
        {
          name: 'refusing',
          async activityStarted() {
            throw refused;
          },
        },
        recorder('B', events),
        interceptor('hit', events, { result: [] }),
      ]),
    ).rejects.toBe(refused);
    expect(events).toEqual([
      'A:started:test-call',
      'A:ended:test-call:failed',
      'A:finalized:test-call:unknown',
    ]);
  });

  describe('ending with an open child', () => {
    it('ends failed, is finalized and rejects with the number of open children', async () => {
      const events: string[] = [];
      const middleware = [recorder('A', events)];
      const call = await startCall(middleware);
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

      await expect(call.end({ outcome: 'succeeded' })).rejects.toMatchObject({
        code: 'RUNTIME.ACTIVITY_CHILDREN_OPEN',
        message: "The 'test-call' activity ended while 1 activity beneath it had not ended",
        details: { kind: 'test-call', openChildren: 1 },
      });
      statementGate.release();
      await running;

      expect(events.filter(isLifecycleEvent)).toEqual([
        'A:started:test-call',
        'A:started:statement',
        'A:ended:test-call:failed',
        'A:finalized:test-call:unknown',
        'A:ended:statement:succeeded',
        'A:finalized:statement:committed',
      ]);
    });

    it('names the open children in the plural when there are several', async () => {
      const call = await startCall([]);
      call.adopt({ finalize: async () => {} });
      call.adopt({ finalize: async () => {} });

      await expect(call.end({ outcome: 'succeeded' })).rejects.toMatchObject({
        message: "The 'test-call' activity ended while 2 activities beneath it had not ended",
      });
    });

    it('does not count a child that has ended', async () => {
      const call = await startCall([]);
      for await (const _row of queryStatement([], () => yieldRows([{}, {}]), { parent: call })) {
        break;
      }

      await expect(call.end({ outcome: 'succeeded' })).resolves.toBeUndefined();
    });
  });

  describe('work beneath an ended activity', () => {
    it('rejects a statement at entry, running no hook', async () => {
      const events: string[] = [];
      const call = await startCall([]);
      await call.end({ outcome: 'succeeded' });

      await expect(
        executeStatementWith([recorder('A', events)], async () => ({ affectedRows: 1 }), {
          parent: call,
        }),
      ).rejects.toMatchObject({
        code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
        details: { parentKind: 'test-call' },
      });
      expect(events).toEqual([]);
    });

    it('rejects a streamed statement on its first read, running no hook', async () => {
      const events: string[] = [];
      const call = await startCall([]);
      await call.end({ outcome: 'succeeded' });

      const iterator = queryStatement([recorder('A', events)], () => yieldRows([{}]), {
        parent: call,
      })[Symbol.asyncIterator]();

      await expect(iterator.next()).rejects.toMatchObject({
        code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
      });
      expect(events).toEqual([]);
    });

    it('rejects a nested activity and a transaction', async () => {
      const call = await startCall([]);
      await call.end({ outcome: 'succeeded' });

      await expect(startCall([], { parent: call })).rejects.toMatchObject({
        code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
      });
      await expect(openTransaction([], { parent: call })).rejects.toMatchObject({
        code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
      });
    });

    it('rejects a statement beneath a transaction that has ended', async () => {
      const transaction = await openTransaction([]);
      await transaction.end({ by: 'commit', outcome: 'succeeded' });

      await expect(
        executeStatementWith([], async () => ({ affectedRows: 1 }), { parent: transaction }),
      ).rejects.toMatchObject({
        code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
        details: { parentKind: 'transaction' },
      });
    });

    it('reports through assertAcceptsChildren whether children may still start', async () => {
      const transaction = await openTransaction([]);
      const call = await startCall([], { parent: transaction });
      const ended = await startCall([]);
      await ended.end({ outcome: 'succeeded' });

      expect(() => call.assertAcceptsChildren()).not.toThrow();
      expect([call.acceptsChildren(), transaction.acceptsChildren()]).toEqual([true, true]);
      transaction.stopAcceptingChildren();
      expect([
        call.acceptsChildren(),
        transaction.acceptsChildren(),
        ended.acceptsChildren(),
      ]).toEqual([false, false, false]);
      expect(() => call.assertAcceptsChildren()).toThrow(
        expect.objectContaining({ code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN' }),
      );
      expect(() => ended.assertAcceptsChildren()).toThrow(
        expect.objectContaining({ code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN' }),
      );
    });

    it('rejects a second end', async () => {
      const events: string[] = [];
      const call = await startCall([recorder('A', events)]);
      await call.end({ outcome: 'succeeded' });

      await expect(call.end({ outcome: 'failed' })).rejects.toMatchObject({
        code: 'RUNTIME.ACTIVITY_ALREADY_ENDED',
      });
      expect(events).toEqual([
        'A:started:test-call',
        'A:ended:test-call:succeeded',
        'A:finalized:test-call:committed',
      ]);
    });
  });

  it('rethrows an activityEnded error after a success, once it is finalized', async () => {
    const events: string[] = [];
    const endedError = new Error('ended failed');
    const call = await startCall([
      {
        name: 'failing',
        async activityEnded() {
          throw endedError;
        },
      },
      recorder('A', events),
    ]);

    await expect(call.end({ outcome: 'succeeded' })).rejects.toBe(endedError);
    expect(events).toEqual([
      'A:started:test-call',
      'A:ended:test-call:succeeded',
      'A:finalized:test-call:committed',
    ]);
  });
});
