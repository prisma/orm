import { RawQueryAst } from '@internal/sql-relational-core/ast';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import { planFromAst } from '@internal/sql-relational-core/plan';
import type { SqlMiddleware } from '@internal/sql-runtime';
import { withTransaction } from '@internal/sql-runtime';
import { describe, expect, it } from 'vitest';
import { createTestSetup, stubPlan, testContract } from './supabase-runtime-fixtures';

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

function createRecordingSetup() {
  const events: string[] = [];
  const recorder: SqlMiddleware = {
    name: 'recorder',
    familyId: 'sql',
    async afterQuery() {
      events.push('afterQuery');
    },
    async afterExecute() {
      events.push('afterExecute');
    },
    async afterTransaction(_plan, result) {
      events.push(`afterTransaction:${result.outcome}`);
    },
  };
  const setup = createTestSetup({ middleware: [recorder] });
  const transaction = setup.driver.connection.transaction;
  transaction.commit.mockImplementation(async () => {
    events.push('commit');
  });
  transaction.rollback.mockImplementation(async () => {
    events.push('rollback');
  });
  return { ...setup, events };
}

describe('role session transaction afterTransaction stage', () => {
  it('fires committed once for each query, after the commit', async () => {
    const { runtime, events } = createRecordingSetup();
    const session = await runtime.openRoleSession({ role: 'authenticated' });
    const tx = await session.transaction();

    await tx.query(stubPlan()).toArray();
    await tx.execute(stubPlan());
    await tx.commit();
    await session.release();

    expect(events).toEqual([
      'afterQuery',
      'afterExecute',
      'commit',
      'afterTransaction:committed',
      'afterTransaction:committed',
    ]);
  });

  it('fires rolled-back once, after the rollback', async () => {
    const { runtime, events } = createRecordingSetup();
    const session = await runtime.openRoleSession({ role: 'authenticated' });
    const tx = await session.transaction();

    await tx.execute(stubPlan());
    await tx.rollback();
    await session.release();

    expect(events).toEqual(['afterExecute', 'rollback', 'afterTransaction:rolled-back']);
  });

  it('fires rolled-back after withTransaction over a role session rolls back', async () => {
    const { runtime, events } = createRecordingSetup();

    await expect(
      withTransaction(
        { connection: () => runtime.openRoleSession({ role: 'anon' }) },
        async (tx) => {
          await tx.execute(stubPlan());
          throw new Error('callback failed');
        },
      ),
    ).rejects.toThrow('callback failed');

    expect(events).toEqual(['afterExecute', 'rollback', 'afterTransaction:rolled-back']);
  });

  it.each([
    { end: 'commit', outcome: 'committed' },
    { end: 'rollback', outcome: 'rolled-back' },
  ] as const)(
    'fires $outcome after the $end for a query sent on the session while its transaction is open',
    async ({ end, outcome }) => {
      const { runtime, events } = createRecordingSetup();
      const session = await runtime.openRoleSession({ role: 'authenticated' });
      const tx = await session.transaction();

      await session.execute(stubPlan());
      await tx[end]();
      await session.release();

      expect(events).toEqual(['afterExecute', end, `afterTransaction:${outcome}`]);
    },
  );

  it('fires committed for a prepared query and a prepared execute once the commit resolves', async () => {
    const { runtime, events } = createRecordingSetup();
    const { ast, meta } = stubPlan();
    const rows = await runtime.prepare({}, () => ({ ast, params: [], meta }));
    const count = await runtime.prepare({}, () =>
      planFromAst<AffectedCount>(RawQueryAst.affectedCount(['update t set x = 1']), testContract),
    );
    const session = await runtime.openRoleSession({ role: 'authenticated' });
    const tx = await session.transaction();

    await rows.query(tx, {}).toArray();
    await count.execute(tx, {});
    await tx.commit();
    await session.release();

    expect(events).toEqual([
      'afterQuery',
      'afterExecute',
      'commit',
      'afterTransaction:committed',
      'afterTransaction:committed',
    ]);
  });
});

describe('role session transaction end and close()', () => {
  it.each(['commit', 'rollback'] as const)('close() waits for a pending %s', async (end) => {
    const { runtime, driver } = createTestSetup();
    let settle = (): void => undefined;
    driver.connection.transaction[end].mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    const session = await runtime.openRoleSession({ role: 'authenticated' });
    const tx = await session.transaction();

    const ending = tx[end]();
    let closed = false;
    const closing = runtime.close().then(() => {
      closed = true;
    });
    await nextTurn();
    await nextTurn();
    expect({ closed, driverClosed: driver.close.mock.calls.length }).toEqual({
      closed: false,
      driverClosed: 0,
    });

    settle();
    await ending;
    await closing;
    expect(closed).toBe(true);
    await session.release();
  });
});
