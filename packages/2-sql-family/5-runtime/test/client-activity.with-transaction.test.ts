import { RawQueryAst } from '@internal/sql-relational-core/ast';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import { planFromAst, type SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import { type ActivityHandle, startActivityOn } from '../src/activity-handle';
import { withTransaction } from '../src/sql-runtime';
import { testCall } from './client-activity-kinds';
import {
  createSetup,
  type HookEvent,
  meta,
  rawPlan,
  type Setup,
  testContract,
} from './transaction-activity-fixtures';
import { stubAst } from './utils';

const transactionClosed = expect.objectContaining({ code: 'RUNTIME.TRANSACTION_CLOSED' });

async function escapedHandle(setup: Setup): Promise<ActivityHandle<'test-call'>> {
  return withTransaction(setup.runtime, (tx) => startActivityOn(tx, testCall));
}

function startedEvents(events: readonly HookEvent[], name: string) {
  return events.filter((event) => event.name === name).map((event) => event.ctx);
}

function queryPlan(): SqlQueryPlan {
  return { ast: stubAst(), params: [], meta };
}

function driverCalls({ driver }: Setup) {
  return [vi.mocked(driver.query).mock.calls.length, vi.mocked(driver.execute).mock.calls.length];
}

describe('a handle started on the context of withTransaction, inside the callback', () => {
  it('runs prepared statements beneath its activity', async () => {
    const { runtime, events } = createSetup();
    const rows = await runtime.prepare({}, () => queryPlan());
    const affectedCount: SqlQueryPlan<AffectedCount> = planFromAst(
      RawQueryAst.affectedCount(['update t set x = 1']),
      testContract,
    );
    const update = await runtime.prepare({}, () => affectedCount);

    await withTransaction(runtime, async (tx) => {
      const call = await startActivityOn(tx, testCall);
      await rows.query(call, {}).toArray();
      await update.execute(call, {});
      await call.end({ outcome: 'succeeded' });
    });

    const [callCtx] = startedEvents(events, 'started:test-call');
    expect(startedEvents(events, 'started:statement').map((ctx) => ctx?.parent)).toEqual([
      callCtx,
      callCtx,
    ]);
  });

  it('starts a nested activity beneath its activity, with statements beneath the nested one', async () => {
    const { runtime, events } = createSetup();

    await withTransaction(runtime, async (tx) => {
      const outer = await startActivityOn(tx, testCall);
      const inner = await outer.startActivity(testCall);
      await inner.execute(rawPlan('update t set x = 1'));
      await inner.end({ outcome: 'succeeded' });
      await outer.end({ outcome: 'succeeded' });
    });

    const [outerCtx, innerCtx] = startedEvents(events, 'started:test-call');
    expect({
      inner: innerCtx?.parent,
      statements: startedEvents(events, 'started:statement').map((ctx) => ctx?.parent),
    }).toEqual({ inner: outerCtx, statements: [innerCtx] });
  });
});

describe('a handle started on the context of withTransaction, after the callback', () => {
  it('rejects a new read without reaching the driver', async () => {
    const setup = createSetup();
    const call = await escapedHandle(setup);
    const before = driverCalls(setup);

    await expect(call.query(rawPlan('select 1')).toArray()).rejects.toMatchObject(
      transactionClosed,
    );
    expect(driverCalls(setup)).toEqual(before);
  });

  it('rejects execute without reaching the driver', async () => {
    const setup = createSetup();
    const call = await escapedHandle(setup);
    const before = driverCalls(setup);

    await expect(call.execute(rawPlan('update t set x = 1'))).rejects.toMatchObject({
      code: 'RUNTIME.TRANSACTION_CLOSED',
    });
    expect(driverCalls(setup)).toEqual(before);
  });

  it('rejects a partly read iterator on resume', async () => {
    const setup = createSetup();
    const iterator = await withTransaction(setup.runtime, async (tx) => {
      const call = await startActivityOn(tx, testCall);
      const rows = call.query(rawPlan('select id from t'))[Symbol.asyncIterator]();
      await rows.next();
      return rows;
    });

    await expect(iterator.next()).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_CLOSED' });
  });

  it('rejects prepared statements without reaching the driver', async () => {
    const setup = createSetup();
    const rows = await setup.runtime.prepare({}, () => queryPlan());
    const affectedCount: SqlQueryPlan<AffectedCount> = planFromAst(
      RawQueryAst.affectedCount(['update t set x = 1']),
      testContract,
    );
    const update = await setup.runtime.prepare({}, () => affectedCount);
    const call = await escapedHandle(setup);
    const before = driverCalls(setup);

    await expect(rows.query(call, {}).toArray()).rejects.toMatchObject(transactionClosed);
    await expect(update.execute(call, {})).rejects.toMatchObject(transactionClosed);
    expect(driverCalls(setup)).toEqual(before);
  });

  it('refuses a nested activity, and guards a nested handle that escaped', async () => {
    const setup = createSetup();
    const { outer, inner } = await withTransaction(setup.runtime, async (tx) => {
      const outer = await startActivityOn(tx, testCall);
      return { outer, inner: await outer.startActivity(testCall) };
    });

    await expect(outer.startActivity(testCall)).rejects.toMatchObject({
      code: 'RUNTIME.TRANSACTION_CLOSED',
    });
    await expect(startActivityOn(outer, testCall)).rejects.toMatchObject({
      code: 'RUNTIME.TRANSACTION_CLOSED',
    });
    await expect(inner.query(rawPlan('select 1')).toArray()).rejects.toMatchObject(
      transactionClosed,
    );
  });

  it('still hashes plans and ends', async () => {
    const setup = createSetup();
    const call = await escapedHandle(setup);

    await expect(call.planContentHash(rawPlan('select 1'))).resolves.toEqual(expect.any(String));
    await expect(call.end({ outcome: 'succeeded' })).resolves.toBeUndefined();
  });
});
