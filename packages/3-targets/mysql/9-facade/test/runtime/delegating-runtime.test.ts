import type { RuntimeQueryable } from '@internal/sql-orm-client';
import { RawQueryAst } from '@internal/sql-relational-core/ast';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { startActivityOn } from '@internal/sql-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import mysql from '../../src/exports/runtime';
import { contractFromJson } from '../../src/exports/static';
import { MysqlRuntimeImpl } from '../../src/runtime/mysql-runtime';
import type { Contract } from '../fixtures/generated/contract.d';
import contractJson from '../fixtures/generated/contract.json' with { type: 'json' };

declare module '@internal/framework-components/runtime' {
  interface ClientActivityRegistry {
    'closed-mysql-client-call': { result: unknown };
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

const contract = contractFromJson<Contract>(contractJson);
const unreachable = 'mysql://root@127.0.0.1:1/none';
const notConnected = { code: 'DRIVER.NOT_CONNECTED' };
const testCall = { kind: 'closed-mysql-client-call', contentHash: async () => 'call' } as const;

const rowsPlan = () => planFromAst(RawQueryAst.rows(['select 1 as one'], {}), contract);
const countPlan = () => planFromAst(RawQueryAst.affectedCount(['select 1']), contract);

function client() {
  ormRuntimes.length = 0;
  const db = mysql({ contract, url: unreachable });
  return { db, ormRuntime: ormRuntimes.at(-1) as RuntimeQueryable };
}

function callWithoutThrowing(member: () => PromiseLike<unknown>): Promise<unknown> {
  let result: PromiseLike<unknown> | undefined;
  expect(() => {
    result = member();
  }).not.toThrow();
  return Promise.resolve(result);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a mysql() client's runtime for the ORM", () => {
  it('passes execution options to the runtime it delegates to', async () => {
    const query = vi.spyOn(MysqlRuntimeImpl.prototype, 'query').mockReturnValue(null as never);
    const execute = vi
      .spyOn(MysqlRuntimeImpl.prototype, 'execute')
      .mockResolvedValue({ affectedRows: 0 });
    const { db, ormRuntime } = client();
    const options = { signal: new AbortController().signal, scope: 'runtime' } as const;
    const rows = rowsPlan();
    const count = countPlan();

    ormRuntime.query(rows, options);
    await ormRuntime.execute(count, options);
    await db.close();

    expect({ query: query.mock.calls, execute: execute.mock.calls }).toEqual({
      query: [[rows, options]],
      execute: [[count, options]],
    });
  });
});

describe('a closed mysql() client', () => {
  type Client = ReturnType<typeof client>;

  it.each([
    ['query', ({ db }: Client) => db.query(rowsPlan())],
    ['execute', ({ db }: Client) => db.execute(countPlan())],
    ['prepare', ({ db }: Client) => db.prepare({}, () => rowsPlan())],
    ['transaction', ({ db }: Client) => db.transaction(async () => undefined)],
    ['an ORM statement', ({ ormRuntime }: Client) => ormRuntime.query(rowsPlan())],
    ['an ORM activity', ({ ormRuntime }: Client) => startActivityOn(ormRuntime, testCall)],
  ] as const)('rejects %s instead of throwing at the call', async (_member, call) => {
    const opened = client();
    await opened.db.close();

    await expect(callWithoutThrowing(() => call(opened))).rejects.toMatchObject(notConnected);
  });
});
