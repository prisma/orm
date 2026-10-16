import { RawQueryAst } from '@internal/sql-relational-core/ast';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import { activitySource, findActivitySource, startActivityOn } from '../src/activity-handle';
import { withTransaction } from '../src/sql-runtime';
import { testCall } from './client-activity-kinds';
import {
  createSetup,
  type HookEvent,
  meta,
  names,
  rawPlan,
  testContract,
} from './transaction-activity-fixtures';
import { stubAst } from './utils';

function queryPlan(): SqlQueryPlan {
  return { ast: stubAst(), params: [], meta };
}

function lifecycle(events: readonly HookEvent[]) {
  return events
    .filter((event) => /^(started|ended|finalized):/.test(event.name))
    .map((event) => event.name);
}

function eventOf(events: readonly HookEvent[], name: string): HookEvent | undefined {
  return events.find((candidate) => candidate.name === name);
}

describe('startActivity', () => {
  it('on the runtime, starts a client activity whose statements are its children with scope runtime', async () => {
    const { runtime, events } = createSetup();

    const call = await startActivityOn(runtime, testCall);
    await call.execute(rawPlan('update t set x = 1'));
    await call.query(rawPlan('select 1')).toArray();
    await call.end({ outcome: 'succeeded' });

    const callCtx = eventOf(events, 'started:test-call')?.ctx;
    const statementCtx = eventOf(events, 'started:statement')?.ctx;
    expect({
      activity: call.activity,
      callScope: callCtx?.scope,
      statementParent: statementCtx?.parent,
      statementScope: statementCtx?.scope,
    }).toEqual({
      activity: {
        id: expect.any(String),
        kind: 'test-call',
        contentHash: expect.any(Function),
        annotations: new Map(),
      },
      callScope: 'runtime',
      statementParent: callCtx,
      statementScope: 'runtime',
    });
    expect(lifecycle(events)).toEqual([
      'started:test-call',
      'started:statement',
      'ended:statement:succeeded',
      'finalized:statement:committed',
      'started:statement',
      'ended:statement:succeeded',
      'finalized:statement:committed',
      'ended:test-call:succeeded',
      'finalized:test-call:committed',
    ]);
  });

  it('on a connection, gives the activity and its statements scope connection', async () => {
    const { runtime, events } = createSetup();
    const connection = await runtime.connection();

    const call = await startActivityOn(connection, testCall);
    await call.execute(rawPlan('update t set x = 1'));
    await call.end({ outcome: 'succeeded' });
    await connection.release();

    expect([
      eventOf(events, 'started:test-call')?.ctx?.scope,
      eventOf(events, 'started:statement')?.ctx?.scope,
    ]).toEqual(['connection', 'connection']);
  });

  it('on a transaction, starts the activity beneath it, and the transaction finalizes both', async () => {
    const { runtime, events } = createSetup();
    const connection = await runtime.connection();
    const transaction = await connection.transaction();

    const call = await startActivityOn(transaction, testCall);
    await call.execute(rawPlan('update t set x = 1'));
    await call.end({ outcome: 'succeeded' });
    await transaction.commit();
    await connection.release();

    const callCtx = eventOf(events, 'started:test-call')?.ctx;
    expect({
      parent: callCtx?.parent,
      inTransaction: callCtx?.inTransaction(),
      scope: eventOf(events, 'started:statement')?.ctx?.scope,
      hasTransaction: 'transaction' in call,
    }).toEqual({
      parent: eventOf(events, 'started:transaction')?.ctx,
      inTransaction: true,
      scope: 'transaction',
      hasTransaction: false,
    });
    expect(lifecycle(events).filter((name) => name.startsWith('finalized:'))).toEqual([
      'finalized:statement:committed',
      'finalized:test-call:committed',
      'finalized:transaction:committed',
    ]);
  });

  it('on the context of withTransaction, through its activity source', async () => {
    const { runtime, events } = createSetup();

    await withTransaction(runtime, async (tx) => {
      const call = await startActivityOn(tx, testCall);
      await call.execute(rawPlan('update t set x = 1'));
      await call.end({ outcome: 'succeeded' });
      expect('transaction' in call).toBe(false);
    });

    expect(eventOf(events, 'started:test-call')?.ctx?.parent).toBe(
      eventOf(events, 'started:transaction')?.ctx,
    );
    expect(eventOf(events, 'started:statement')?.ctx?.parent).toBe(
      eventOf(events, 'started:test-call')?.ctx,
    );
  });

  it('rejects on a transaction whose commit has been called', async () => {
    const { runtime } = createSetup();
    const connection = await runtime.connection();
    const transaction = await connection.transaction();
    await transaction.commit();

    await expect(startActivityOn(transaction, testCall)).rejects.toMatchObject({
      code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
    });
    await connection.release();
  });

  it('rejects a statement on an activity inside a transaction once commit is called', async () => {
    let releaseCommit = (): void => undefined;
    const commitHeldUntil = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const { runtime } = createSetup({ failures: { commitHeldUntil } });
    const connection = await runtime.connection();
    const transaction = await connection.transaction();
    const call = await startActivityOn(transaction, testCall);

    const committing = transaction.commit();
    await expect(call.execute(rawPlan('update t set x = 1'))).rejects.toMatchObject({
      code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
    });
    releaseCommit();
    await committing;
    await connection.release();
  });

  it('nests activities to any depth', async () => {
    const { runtime, events } = createSetup();

    const outer = await startActivityOn(runtime, testCall);
    const inner = await outer.startActivity(testCall);
    await inner.execute(rawPlan('update t set x = 1'));
    await inner.end({ outcome: 'succeeded' });
    await outer.end({ outcome: 'succeeded' });

    const [outerStart, innerStart] = events.filter((event) => event.name === 'started:test-call');
    expect([innerStart?.ctx?.parent, eventOf(events, 'started:statement')?.ctx?.parent]).toEqual([
      outerStart?.ctx,
      innerStart?.ctx,
    ]);
  });

  it('runs prepared statements on a handle as its children', async () => {
    const { runtime, events } = createSetup();
    const prepared = await runtime.prepare({}, () => queryPlan());

    const call = await startActivityOn(runtime, testCall);
    await prepared.query(call, {}).toArray();
    await call.end({ outcome: 'succeeded' });

    expect(eventOf(events, 'started:statement')?.ctx?.parent).toBe(
      eventOf(events, 'started:test-call')?.ctx,
    );
  });

  it('rejects the end of an activity with a statement still open', async () => {
    const { runtime } = createSetup();
    const call = await startActivityOn(runtime, testCall);
    const iterator = call.query(rawPlan('select 1'))[Symbol.asyncIterator]();
    await iterator.next();

    await expect(call.end({ outcome: 'succeeded' })).rejects.toMatchObject({
      code: 'RUNTIME.ACTIVITY_CHILDREN_OPEN',
    });
    await iterator.return?.();
  });

  it.each(['statement', 'transaction'])('rejects the reserved kind %s', async (kind) => {
    const { runtime, events } = createSetup();

    await expect(
      startActivityOn(runtime, { kind: kind as 'test-call', contentHash: async () => 'hash' }),
    ).rejects.toMatchObject({ code: 'RUNTIME.ACTIVITY_KIND_RESERVED' });
    expect(events).toEqual([]);
  });

  it('rejects a statement on a connection handle once a transaction is open on the connection', async () => {
    const { runtime, events } = createSetup();
    const connection = await runtime.connection();
    const call = await startActivityOn(connection, testCall);
    const transaction = await connection.transaction();

    await expect(call.execute(rawPlan('update t set x = 1'))).rejects.toMatchObject({
      code: 'RUNTIME.ACTIVITY_OUTSIDE_TRANSACTION',
      details: { kind: 'test-call' },
    });
    expect(names(events)).not.toContain('started:statement');
    await transaction.commit();
    await call.end({ outcome: 'succeeded' });
    await connection.release();
  });

  it('runs a prepared execute on a handle as its child', async () => {
    const { runtime, events } = createSetup();
    const affectedCount: SqlQueryPlan<AffectedCount> = planFromAst(
      RawQueryAst.affectedCount(['update t set x = 1']),
      testContract,
    );
    const prepared = await runtime.prepare({}, () => affectedCount);

    const call = await startActivityOn(runtime, testCall);
    await expect(prepared.execute(call, {})).resolves.toEqual({ affectedRows: 1 });
    await call.end({ outcome: 'succeeded' });

    expect(eventOf(events, 'started:statement')?.ctx?.parent).toBe(
      eventOf(events, 'started:test-call')?.ctx,
    );
  });

  it('rejects statements and activities on an ended handle before they reach the driver', async () => {
    const { runtime, events } = createSetup();
    const call = await startActivityOn(runtime, testCall);
    await call.end({ outcome: 'succeeded' });
    const before = names(events);

    await expect(call.execute(rawPlan('update t set x = 1'))).rejects.toMatchObject({
      code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
    });
    await expect(call.query(rawPlan('select 1')).toArray()).rejects.toMatchObject({
      code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
    });
    await expect(call.startActivity(testCall)).rejects.toMatchObject({
      code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
    });
    expect(names(events)).toEqual(before);
  });

  it('starts no statement for rows returned before the first read, even after the handle ended', async () => {
    const { runtime, events } = createSetup();
    const call = await startActivityOn(runtime, testCall);
    const rows = call.query(rawPlan('select 1'))[Symbol.asyncIterator]();

    await call.end({ outcome: 'succeeded' });
    const returned = await rows.return?.();
    const next = await rows.next();

    expect({ returned, next, lifecycle: lifecycle(events) }).toEqual({
      returned: { done: true, value: undefined },
      next: { done: true, value: undefined },
      lifecycle: [
        'started:test-call',
        'ended:test-call:succeeded',
        'finalized:test-call:committed',
      ],
    });
  });

  it('ends the handle and keeps close() from waiting when ending the activity fails', async () => {
    const { runtime } = createSetup();
    const call = await startActivityOn(runtime, testCall);
    const pending = call.query(rawPlan('select 1'))[Symbol.asyncIterator]();
    await pending.next();

    await expect(call.end({ outcome: 'succeeded' })).rejects.toMatchObject({
      code: 'RUNTIME.ACTIVITY_CHILDREN_OPEN',
    });
    await pending.return?.();

    await expect(runtime.close()).resolves.toBeUndefined();
  });

  it('keeps every member of a handle in a copy that spreads it', async () => {
    const { runtime, events } = createSetup();
    const call = await startActivityOn(runtime, testCall);
    const copy = { ...call };

    await copy.query(rawPlan('select 1')).toArray();
    const nested = await copy.startActivity(testCall);
    await nested.end({ outcome: 'succeeded' });
    await copy.end({ outcome: 'succeeded' });

    expect({
      intercepted: copy.intercepted,
      source: findActivitySource(copy) !== undefined,
      transaction: typeof copy.transaction,
      lifecycle: lifecycle(events).filter((name) => name.startsWith('ended:')),
    }).toEqual({
      intercepted: undefined,
      source: true,
      transaction: 'function',
      lifecycle: [
        'ended:statement:succeeded',
        'ended:test-call:succeeded',
        'ended:test-call:succeeded',
      ],
    });
  });

  it('finds the activity source of a queryable, and none on a plain one', async () => {
    const { runtime } = createSetup();
    const plain = { query: runtime.query.bind(runtime), execute: runtime.execute.bind(runtime) };

    expect([findActivitySource(runtime) !== undefined, findActivitySource(plain)]).toEqual([
      true,
      undefined,
    ]);
  });

  it('finds the activity source of a handle through its activitySource member', async () => {
    const { runtime } = createSetup();
    const call = await startActivityOn(runtime, testCall);

    expect(findActivitySource(call)).toBe(call[activitySource]);
    await call.end({ outcome: 'succeeded' });
  });

  it('does not treat plain startActivity and planContentHash members as an activity source', async () => {
    const { runtime } = createSetup();
    const call = await startActivityOn(runtime, testCall);
    const lookalike = {
      query: call.query.bind(call),
      execute: call.execute.bind(call),
      startActivity: call.startActivity.bind(call),
      planContentHash: call.planContentHash.bind(call),
    };

    expect(findActivitySource(lookalike)).toBeUndefined();
    await call.end({ outcome: 'succeeded' });
  });

  describe('close', () => {
    it('warns once when it waits only for open activity handles', async () => {
      const warn = vi.fn();
      const { runtime } = createSetup({ log: { info: vi.fn(), warn, error: vi.fn() } });
      const call = await startActivityOn(runtime, testCall);

      const closing = runtime.close();
      await new Promise((resolve) => setTimeout(resolve, 20));
      await call.end({ outcome: 'succeeded' });
      await closing;

      expect(warn.mock.calls).toEqual([
        [{ event: 'runtime.close.waiting-for-activities', openActivities: 1 }],
      ]);
    });

    it('waits for an open activity on the runtime to end', async () => {
      const { runtime, events } = createSetup();
      const call = await startActivityOn(runtime, testCall);

      let closed = false;
      const closing = runtime.close().then(() => {
        closed = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const closedWhileOpen = closed;
      await call.execute(rawPlan('update t set x = 1'));
      await call.end({ outcome: 'succeeded' });
      await closing;

      expect({ closedWhileOpen, closed }).toEqual({ closedWhileOpen: false, closed: true });
      expect(names(events)).toContain('ended:test-call:succeeded');
    });

    it("with 'at-once' refusal, still runs the statements and the transaction of an activity started before close()", async () => {
      const { runtime, events } = createSetup({ closeRefusal: 'at-once' });
      const call = await startActivityOn(runtime, testCall);

      const closing = runtime.close();
      const refused = runtime.execute(rawPlan('update t set x = 0'));
      await call.execute(rawPlan('update t set x = 1'));
      const rows = await call.query(rawPlan('select 1')).toArray();
      const transaction = await call.transaction?.();
      await transaction?.execute(rawPlan('update t set x = 2'));
      await transaction?.commit();
      await call.end({ outcome: 'succeeded' });
      await closing;

      await expect(refused).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
      expect({
        rows: rows.length,
        ended: names(events).includes('ended:test-call:succeeded'),
      }).toEqual({ rows: 2, ended: true });
      await expect(startActivityOn(runtime, testCall)).rejects.toMatchObject({
        code: 'DRIVER.NOT_CONNECTED',
      });
    });

    it("with 'at-once' refusal, admits a nested activity started on an activity open before close()", async () => {
      const { runtime, events } = createSetup({ closeRefusal: 'at-once' });
      const call = await startActivityOn(runtime, testCall);

      const closing = runtime.close();
      const nested = await startActivityOn(call, testCall);
      await nested.execute(rawPlan('update t set x = 1'));
      await nested.end({ outcome: 'succeeded' });
      await call.end({ outcome: 'succeeded' });
      await closing;

      expect(names(events).filter((name) => name.startsWith('ended:'))).toEqual([
        'ended:statement:succeeded',
        'ended:test-call:succeeded',
        'ended:test-call:succeeded',
      ]);
    });

    it('refuses to start an activity on a closed runtime', async () => {
      const { runtime } = createSetup();
      await runtime.close();

      await expect(startActivityOn(runtime, testCall)).rejects.toMatchObject({
        code: 'DRIVER.NOT_CONNECTED',
      });
    });
  });
});
