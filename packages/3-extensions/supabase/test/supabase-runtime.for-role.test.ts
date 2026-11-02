import type { SqlExecuteRequest } from '@internal/sql-relational-core/ast';
import { RawQueryAst } from '@internal/sql-relational-core/ast';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import { planFromAst, type SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { activitySource, withTransaction } from '@internal/sql-runtime';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseRoleBinding, SupabaseRuntimeImpl } from '../src/runtime/supabase-runtime';
import { createTestSetup, stubPlan, testContract } from './supabase-runtime-fixtures';

declare module '@internal/framework-components/runtime' {
  interface ClientActivityRegistry {
    'for-role-call': { result: unknown };
  }
}

type RoleScope = ReturnType<SupabaseRuntimeImpl['forRole']>;

const binding: SupabaseRoleBinding = { role: 'authenticated', claims: { sub: 'user-1' } };
const closedError = { code: 'DRIVER.NOT_CONNECTED', message: 'Runtime is closed' };
const testCall = { kind: 'for-role-call', contentHash: async () => 'call-hash' } as const;

const roleSql = ['SELECT set_config($1, $2, false)', 'SELECT set_config($1, $2, false)'] as const;

function nextTurn(): Promise<void> {
  return new Promise((settle) => setTimeout(settle, 0));
}

function bumpPlan(): SqlQueryPlan<AffectedCount> {
  return planFromAst(RawQueryAst.affectedCount(['update "users" set seen = now()']), testContract);
}

describe('forRole(binding)', () => {
  it('runs prepared statements on a role session it releases', async () => {
    const { runtime, driver } = createTestSetup({ affectedRows: 2 });
    const role = runtime.forRole(binding);
    const selectOne = await runtime.prepare({}, () => stubPlan());
    const bump = await runtime.prepare({}, () => bumpPlan());

    const rows = await selectOne.query(role, {}).toArray();
    const stats = await bump.execute(role, {});

    expect({
      rows,
      stats,
      connectionSql: driver.connection.executeCalls.map((call) => call.sql),
      released: driver.connection.release.mock.calls.length,
      driverQueried: driver.query.mock.calls.length + driver.execute.mock.calls.length,
    }).toEqual({
      rows: [{ id: 1 }],
      stats: { affectedRows: 2 },
      connectionSql: [
        ...roleSql,
        'RESET ALL',
        'RESET ROLE',
        ...roleSql,
        expect.any(String),
        'RESET ALL',
        'RESET ROLE',
      ],
      released: 2,
      driverQueried: 0,
    });
  });

  it('runs a transaction on a role session it releases after the commit', async () => {
    const { runtime, driver } = createTestSetup();

    await withTransaction(runtime.forRole(binding), (tx) => tx.execute(stubPlan()));

    expect({
      connectionSql: driver.connection.executeCalls.map((call) => call.sql),
      transactionSql: driver.connection.transaction.executeCalls.map((call) => call.sql),
      committed: driver.connection.transaction.commit.mock.calls.length,
      released: driver.connection.release.mock.calls.length,
    }).toEqual({
      connectionSql: [...roleSql, 'RESET ALL', 'RESET ROLE'],
      transactionSql: ['select 1'],
      committed: 1,
      released: 1,
    });
  });

  it('gives its role session from connection()', async () => {
    const { runtime, driver } = createTestSetup();

    const session = await runtime.forRole(binding).connection();
    await session.execute(stubPlan());
    await session.release();

    expect(driver.connection.executeCalls.map((call) => call.sql)).toEqual([
      ...roleSql,
      'select 1',
      'RESET ALL',
      'RESET ROLE',
    ]);
  });
});

describe('forRole(binding) after close()', () => {
  it.each([
    ['query', (role: RoleScope) => role.query(stubPlan()).toArray()],
    ['execute', (role: RoleScope) => role.execute(stubPlan())],
    ['connection', (role: RoleScope) => role.connection()],
    ['a transaction', (role: RoleScope) => withTransaction(role, async () => undefined)],
    ['an activity', (role: RoleScope) => role[activitySource].startActivity(testCall)],
  ] as const)('refuses %s without opening a session', async (_name, run) => {
    const { runtime, driver } = createTestSetup();
    const role = runtime.forRole(binding);
    await runtime.close();

    await expect(run(role)).rejects.toMatchObject(closedError);
    expect(driver.acquireConnectionSpy).not.toHaveBeenCalled();
  });

  it('lets an activity started before close() open its role sessions, and close() waits for it', async () => {
    const { runtime, driver } = createTestSetup();
    const call = await runtime.forRole(binding)[activitySource].startActivity(testCall);

    let closed = false;
    const closing = runtime.close().then(() => {
      closed = true;
    });
    await nextTurn();
    await call.execute(stubPlan());
    const transaction = await call.transaction?.();
    await transaction?.commit();
    const closedBeforeEnd = closed;
    await call.end({ outcome: 'succeeded' });
    await closing;

    expect({
      closedBeforeEnd,
      sessions: driver.acquireConnectionSpy.mock.calls.length,
      released: driver.connection.release.mock.calls.length,
      driverClosed: driver.close.mock.calls.length,
    }).toEqual({ closedBeforeEnd: false, sessions: 2, released: 2, driverClosed: 1 });
  });

  it.each(['commit', 'rollback'] as const)(
    'makes close() wait for an open role transaction until its %s, then resets and releases the session',
    async (end) => {
      const { runtime, driver } = createTestSetup();
      const { inside, finish, transaction } = openTransaction(runtime.forRole(binding), end);
      await inside;

      let closed = false;
      const closing = runtime.close().then(() => {
        closed = true;
      });
      await nextTurn();
      await nextTurn();
      const closedWhileOpen = closed;
      finish();
      await transaction.catch(() => undefined);
      await closing;

      expect({
        closedWhileOpen,
        transactionSql: driver.connection.transaction.executeCalls.map((call) => call.sql),
        lastConnectionSql: driver.connection.executeCalls.at(-1)?.sql,
        released: driver.connection.release.mock.calls.length,
        destroyed: driver.connection.destroy.mock.calls.length,
        driverClosed: driver.close.mock.calls.length,
      }).toEqual({
        closedWhileOpen: false,
        transactionSql: ['select 1'],
        lastConnectionSql: 'RESET ROLE',
        released: 1,
        destroyed: 0,
        driverClosed: 1,
      });
    },
  );

  it('destroys a session released after close() when its reset fails', async () => {
    const { runtime, driver } = createTestSetup();
    const execute = driver.connection.execute;
    driver.connection.execute = vi.fn().mockImplementation(async (request: SqlExecuteRequest) => {
      if (request.sql === 'RESET ALL') throw new Error('reset failed');
      return await execute(request);
    });
    const { inside, finish, transaction } = openTransaction(runtime.forRole(binding), 'commit');
    await inside;

    const closing = runtime.close();
    await nextTurn();
    finish();
    await transaction;
    await closing;

    expect({
      released: driver.connection.release.mock.calls.length,
      destroyed: driver.connection.destroy.mock.calls.length,
    }).toEqual({ released: 0, destroyed: 1 });
  });

  it('does not wait for a role session held idle', async () => {
    const { runtime, driver } = createTestSetup();
    await runtime.forRole(binding).connection();

    await runtime.close();

    expect(driver.close).toHaveBeenCalledOnce();
  });

  it('does not wait for a role-bound stream that was read in part and dropped', async () => {
    const { runtime, driver } = createTestSetup();
    const rows = runtime.forRole(binding).query(stubPlan())[Symbol.asyncIterator]();
    await rows.next();

    await runtime.close();

    expect(driver.close).toHaveBeenCalledOnce();
  });
});

// Runs a role transaction that executes one statement once `finish()` is called, then ends with `end`.
function openTransaction(role: RoleScope, end: 'commit' | 'rollback') {
  let enter: () => void = () => undefined;
  let finish: () => void = () => undefined;
  const inside = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const transaction = withTransaction(role, async (tx) => {
    enter();
    await finished;
    await tx.execute(stubPlan());
    if (end === 'rollback') throw new Error('roll back');
  });
  return { inside, finish, transaction };
}
