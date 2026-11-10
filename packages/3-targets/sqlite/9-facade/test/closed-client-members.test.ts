import type { Contract } from '@internal/contract/types';
import { coreHash } from '@internal/contract/types';
import { SqlStorage } from '@internal/sql-contract/types';
import type { RuntimeQueryable } from '@internal/sql-orm-client';
import { RawQueryAst } from '@internal/sql-relational-core/ast';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { startActivityOn } from '@internal/sql-runtime';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';
import { createContract } from '@repo/test-utils';
import { describe, expect, it, vi } from 'vitest';

declare module '@internal/framework-components/runtime' {
  interface ClientActivityRegistry {
    'closed-client-call': { result: unknown };
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

const contract: Contract<SqlStorage> = createContract<SqlStorage>({
  target: 'sqlite',
  storage: new SqlStorage({
    storageHash: coreHash('sqlite-closed-client-members'),
    namespaces: {
      __unbound__: sqliteCreateNamespace({ id: '__unbound__', entries: { table: {} } }),
    },
  }),
});

const notConnected = { code: 'DRIVER.NOT_CONNECTED' };
const testCall = { kind: 'closed-client-call', contentHash: async () => 'call' } as const;

const rowsPlan = () => planFromAst(RawQueryAst.rows(['select 1 as one'], {}), contract);
const countPlan = () => planFromAst(RawQueryAst.affectedCount(['select 1']), contract);

function callWithoutThrowing(member: () => PromiseLike<unknown>): Promise<unknown> {
  let result: PromiseLike<unknown> | undefined;
  expect(() => {
    result = member();
  }).not.toThrow();
  return Promise.resolve(result);
}

async function closedClient(usedBeforeClose: boolean) {
  ormRuntimes.length = 0;
  const db = sqlite({ contract, path: ':memory:' });
  if (usedBeforeClose) await db.query(rowsPlan()).toArray();
  const ormRuntime = ormRuntimes.at(-1) as RuntimeQueryable;
  await db.close();
  return { db, ormRuntime };
}

type Closed = Awaited<ReturnType<typeof closedClient>>;

describe.each([
  ['never used', false],
  ['used', true],
] as const)('a closed sqlite() client it was %s before close()', (_name, usedBeforeClose) => {
  it.each([
    ['query', ({ db }: Closed) => db.query(rowsPlan())],
    ['execute', ({ db }: Closed) => db.execute(countPlan())],
    ['prepare', ({ db }: Closed) => db.prepare({}, () => rowsPlan())],
    ['transaction', ({ db }: Closed) => db.transaction(async () => undefined)],
    ['an ORM statement', ({ ormRuntime }: Closed) => ormRuntime.query(rowsPlan())],
    ['an ORM activity', ({ ormRuntime }: Closed) => startActivityOn(ormRuntime, testCall)],
  ] as const)('%s rejects instead of throwing at the call', async (_member, call) => {
    const closed = await closedClient(usedBeforeClose);

    await expect(callWithoutThrowing(() => call(closed))).rejects.toMatchObject(notConnected);
  });
});

describe('the moment a sqlite() client looks up its runtime', () => {
  it('is the call, so a result created before close() and read after it fails with the driver error', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.query(rowsPlan()).toArray();
    const rows = db.query(rowsPlan());
    await db.close();

    await expect(rows.toArray()).rejects.toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
      message:
        'SQLite driver not connected. Call connect(binding) before acquireConnection or execute.',
    });
  });
});

describe('tx.prepare on a sqlite() transaction still open after close()', () => {
  it('rejects instead of throwing at the call', async () => {
    const db = sqlite({ contract, path: ':memory:' });

    const outcome = await db.transaction(async (tx) => {
      const closing = db.close();
      const result = await callWithoutThrowing(() => tx.prepare({}, () => rowsPlan())).catch(
        (error: unknown) => error,
      );
      return { result, closing };
    });
    await outcome.closing;

    expect(outcome.result).toMatchObject(notConnected);
  });
});
