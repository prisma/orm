import type { SqlMiddleware } from '@internal/sql-runtime';
import { withTransaction } from '@internal/sql-runtime';
import { describe, expect, it } from 'vitest';
import { createTestSetup, stubPlan } from './supabase-runtime-fixtures';

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
});
