import { SelectAst, TableSource } from '@internal/sql-relational-core/ast';
import type { SqlMiddleware, SqlMiddlewareContext } from '@internal/sql-runtime';
import { startActivityOn } from '@internal/sql-runtime';
import { describe, expect, it } from 'vitest';
import { createTestSetup, stubPlan } from './supabase-runtime-fixtures';

declare module '@internal/framework-components/runtime' {
  interface ClientActivityRegistry {
    'test-call': { result: unknown };
  }
}

const binding = { role: 'authenticated', claims: { sub: 'user-1' } } as const;
const testCall = { kind: 'test-call', contentHash: async () => 'call-hash' } as const;

function createRecordingSetup() {
  const started: Array<{ readonly kind: string; readonly ctx: SqlMiddlewareContext }> = [];
  const recorder: SqlMiddleware = {
    name: 'recorder',
    familyId: 'sql',
    async activityStarted(activity, ctx) {
      started.push({ kind: activity.kind, ctx });
    },
  };
  return { ...createTestSetup({ middleware: [recorder] }), started };
}

const sqlOf = (calls: ReadonlyArray<{ readonly sql: string }>) => calls.map((call) => call.sql);

describe('a role-bound activity handle', () => {
  it('sends each statement on a role session, as a child of the activity', async () => {
    const { runtime, driver, started } = createRecordingSetup();

    const call = await runtime.roleActivitySource(binding).startActivity(testCall);
    await call.execute(stubPlan());
    await call.end({ outcome: 'succeeded' });

    const [callStart, statementStart] = started;
    expect({
      kinds: started.map((entry) => entry.kind),
      parent: statementStart?.ctx.parent,
      scopes: started.map((entry) => entry.ctx.scope),
      connectionSql: sqlOf(driver.connection.executeCalls),
      released: driver.connection.release.mock.calls.length,
    }).toEqual({
      kinds: ['test-call', 'statement'],
      parent: callStart?.ctx,
      scopes: ['connection', 'connection'],
      connectionSql: [
        'SELECT set_config($1, $2, false)',
        'SELECT set_config($1, $2, false)',
        'select 1',
        'RESET ALL',
      ],
      released: 1,
    });
  });

  it('begins its transaction on a role session it releases after the commit', async () => {
    const { runtime, driver, started } = createRecordingSetup();

    const call = await runtime.roleActivitySource(binding).startActivity(testCall);
    const transaction = await call.transaction?.();
    await transaction?.execute(stubPlan());
    await transaction?.commit();
    await call.end({ outcome: 'succeeded' });

    expect({
      transactionParent: started.find((entry) => entry.kind === 'transaction')?.ctx.parent,
      connectionSql: sqlOf(driver.connection.executeCalls),
      transactionSql: sqlOf(driver.connection.transaction.executeCalls),
      commits: driver.connection.transaction.commit.mock.calls.length,
      released: driver.connection.release.mock.calls.length,
    }).toEqual({
      transactionParent: started.find((entry) => entry.kind === 'test-call')?.ctx,
      connectionSql: [
        'SELECT set_config($1, $2, false)',
        'SELECT set_config($1, $2, false)',
        'RESET ALL',
      ],
      transactionSql: ['select 1'],
      commits: 1,
      released: 1,
    });
  });

  it('starts an activity on a role session as a connection activity', async () => {
    const { runtime, started } = createRecordingSetup();
    const session = await runtime.openRoleSession(binding);

    const call = await startActivityOn(session, testCall);
    await call.execute(stubPlan());
    await call.end({ outcome: 'succeeded' });
    await session.release();

    expect(started.map((entry) => [entry.kind, entry.ctx.scope])).toEqual([
      ['test-call', 'connection'],
      ['statement', 'connection'],
    ]);
  });
});

describe('the planContentHash of a role activity source', () => {
  it('hashes at the scope role-bound statements run at', async () => {
    const scopes: string[] = [];
    const { runtime } = createTestSetup({
      middleware: [
        {
          name: 'scopes',
          familyId: 'sql',
          async beforeCompile(_draft, ctx) {
            scopes.push(ctx.scope);
            return undefined;
          },
        },
      ],
    });

    await runtime.roleActivitySource(binding).planContentHash({
      ast: SelectAst.from(TableSource.named('users')),
      params: [],
      meta: stubPlan().meta,
    });

    expect(scopes).toEqual(['connection']);
  });
});

describe('an ended role-bound activity handle', () => {
  it('rejects statements before it opens a role session', async () => {
    const { runtime, driver } = createRecordingSetup();
    const call = await runtime.roleActivitySource(binding).startActivity(testCall);
    await call.end({ outcome: 'succeeded' });

    await expect(call.execute(stubPlan())).rejects.toMatchObject({
      code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
    });
    await expect(call.query(stubPlan()).toArray()).rejects.toMatchObject({
      code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
    });
    await expect(call.transaction?.()).rejects.toMatchObject({
      code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
    });

    expect(driver.acquireConnectionSpy).not.toHaveBeenCalled();
  });
});
