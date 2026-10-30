import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import { SqlStorage } from '@internal/sql-contract/types';
import type { SqlMiddleware } from '@internal/sql-runtime';
import { startActivityOn } from '@internal/sql-runtime';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it, vi } from 'vitest';

declare module '@internal/framework-components/runtime' {
  interface ClientActivityRegistry {
    'facade-call': { result: unknown };
  }
}

const ormRuntimes = vi.hoisted(() => [] as unknown[]);

vi.mock('@internal/sql-orm-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@internal/sql-orm-client')>();
  return {
    ...actual,
    orm: (options: Parameters<typeof actual.orm>[0]) => {
      ormRuntimes.push(options.runtime);
      return actual.orm(options);
    },
  };
});

import sqlite from '../src/runtime/sqlite';

const contract: Contract<SqlStorage> = {
  target: 'sqlite',
  targetFamily: 'sql',
  profileHash: profileHash('sqlite-orm-activity-source'),
  domain: applicationDomainOf({ models: {} }),
  roots: {},
  storage: new SqlStorage({
    storageHash: coreHash('sqlite-orm-activity-source'),
    namespaces: {
      __unbound__: sqliteCreateNamespace({ id: '__unbound__', entries: { table: {} } }),
    },
  }),
  extensions: {},
  capabilities: {},
  meta: {},
};

describe('the ORM objects a sqlite client builds', () => {
  it('start activities on the client runtime, and inside db.transaction beneath the transaction', async () => {
    const started: Array<{ kind: string; parentKind: string | undefined }> = [];
    const kindKey = Symbol('kind');
    const tracer: SqlMiddleware = {
      name: 'tracer',
      familyId: 'sql',
      async activityStarted(activity, ctx) {
        ctx.state(kindKey)['kind'] = activity.kind;
        const parentKind = ctx.parent?.state(kindKey)['kind'];
        started.push({
          kind: activity.kind,
          parentKind: typeof parentKind === 'string' ? parentKind : undefined,
        });
      },
    };
    ormRuntimes.length = 0;
    const db = sqlite({ contract, path: ':memory:', middleware: [tracer] });
    await db.connect({ path: ':memory:' });
    const [dbOrmRuntime] = ormRuntimes;

    const call = await startActivityOn(dbOrmRuntime as never, {
      kind: 'facade-call',
      contentHash: async () => 'h',
    });
    await call.end({ outcome: 'succeeded' });
    await db.transaction(async () => {
      const txCall = await startActivityOn(ormRuntimes.at(-1) as never, {
        kind: 'facade-call',
        contentHash: async () => 'h',
      });
      await txCall.end({ outcome: 'succeeded' });
    });
    await db.close();

    expect(started).toEqual([
      { kind: 'facade-call', parentKind: undefined },
      { kind: 'transaction', parentKind: undefined },
      { kind: 'facade-call', parentKind: 'transaction' },
    ]);
  });
});
