import { validateSqlContractFully } from '@internal/sql-contract/validators';
import type { SqlMiddleware } from '@internal/sql-runtime';
import { findActivitySource, startActivityOn } from '@internal/sql-runtime';
import { describe, expect, it, vi } from 'vitest';
import type { Contract } from './fixtures/generated/contract';
import fixtureContractJson from './fixtures/generated/contract.json' with { type: 'json' };

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

vi.mock('pg', () => {
  class Pool {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      removeListener: vi.fn(),
    });
    end = vi.fn().mockResolvedValue(undefined);
    totalCount = 0;
    idleCount = 0;
    waitingCount = 0;
  }
  class Client {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue(undefined);
    query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    end = vi.fn().mockResolvedValue(undefined);
  }
  return { Pool, Client };
});

import postgres from '../src/runtime/postgres';

const fixtureContract = validateSqlContractFully<Contract>(fixtureContractJson);

function tracer(started: Array<{ kind: string; parentKind: string | undefined }>): SqlMiddleware {
  const kindKey = Symbol('kind');
  return {
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
}

describe('the ORM objects a postgres client builds', () => {
  it('start activities on the client runtime, and inside db.transaction beneath the transaction', async () => {
    const started: Array<{ kind: string; parentKind: string | undefined }> = [];
    ormRuntimes.length = 0;
    const db = postgres<Contract>({
      contractJson: fixtureContract,
      url: 'postgres://localhost:5432/db',
      verifyMarker: false,
      middleware: [tracer(started)],
    });
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

  it('run each ORM terminal as an orm-call whose statements are its children, beneath the transaction inside db.transaction', async () => {
    const started: Array<{ kind: string; parentKind: string | undefined }> = [];
    const db = postgres<Contract>({
      contractJson: fixtureContract,
      url: 'postgres://localhost:5432/db',
      verifyMarker: false,
      middleware: [tracer(started)],
    });

    await db.orm.public.User.first({ id: 1 });
    await db.transaction(async (tx) => {
      await tx.orm.public.User.all();
    });
    await db.close();

    expect(started).toEqual([
      { kind: 'orm-call', parentKind: undefined },
      { kind: 'statement', parentKind: 'orm-call' },
      { kind: 'transaction', parentKind: undefined },
      { kind: 'orm-call', parentKind: 'transaction' },
      { kind: 'statement', parentKind: 'orm-call' },
    ]);
  });

  it('hash an ORM read only when middleware asks for its content hash, and once however often it asks', async () => {
    const hashesSeen: string[] = [];
    const asker: SqlMiddleware = {
      name: 'asker',
      familyId: 'sql',
      async activityStarted(activity) {
        if (activity.kind === 'orm-call') {
          hashesSeen.push(await activity.contentHash(), await activity.contentHash());
        }
      },
    };
    const quiet = postgres<Contract>({
      contractJson: fixtureContract,
      url: 'postgres://localhost:5432/db',
      verifyMarker: false,
    });
    const asking = postgres<Contract>({
      contractJson: fixtureContract,
      url: 'postgres://localhost:5432/db',
      verifyMarker: false,
      middleware: [asker],
    });
    const quietHash = vi.spyOn(findActivitySource(quiet.runtime())!, 'planContentHash');
    const askingHash = vi.spyOn(findActivitySource(asking.runtime())!, 'planContentHash');

    await quiet.orm.public.User.first({ id: 1 });
    await asking.orm.public.User.first({ id: 1 });
    await quiet.close();
    await asking.close();

    expect({
      quiet: quietHash.mock.calls.length,
      asking: askingHash.mock.calls.length,
      sameHashTwice: hashesSeen.length === 2 && hashesSeen[0] === hashesSeen[1],
    }).toEqual({ quiet: 0, asking: 1, sameHashTwice: true });
  });

  it('db.runtime() carries an activity source, so orm({ runtime: db.runtime() }) can start activities', async () => {
    const db = postgres<Contract>({
      contractJson: fixtureContract,
      url: 'postgres://localhost:5432/db',
      verifyMarker: false,
    });

    expect(findActivitySource(db.runtime())).toBeDefined();
    await db.close();
  });
});
