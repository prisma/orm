import type { SqlMiddleware } from '@internal/sql-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Contract } from './fixtures/generated/contract';
import fixtureContractJson from './fixtures/generated/contract.json' with { type: 'json' };

const recorded = vi.hoisted(() => ({
  statements: [] as string[],
}));

vi.mock('pg', () => {
  const query = vi.fn(async (request: string | { readonly text: string }) => {
    recorded.statements.push(typeof request === 'string' ? request : request.text);
    return { rows: [{ id: 1 }], rowCount: 1 };
  });
  class Pool {
    on = vi.fn().mockReturnThis();
    connect = vi.fn(async () => ({ query, release: vi.fn(), on: vi.fn(), off: vi.fn() }));
    end = vi.fn().mockResolvedValue(undefined);
    totalCount = 0;
    idleCount = 0;
    waitingCount = 0;
  }
  class Client {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue(undefined);
    query = query;
    end = vi.fn().mockResolvedValue(undefined);
    release = vi.fn();
  }
  return { Pool, Client };
});

import postgres from '../src/exports/runtime';
import postgresServerless from '../src/exports/serverless';
import { contractFromJson } from '../src/exports/static';

const contract = contractFromJson<Contract>(fixtureContractJson);
const url = 'postgres://localhost:5432/db';

const selectIds = 'SELECT "id" AS "id" FROM "public"."posts"';
const resetViews = 'UPDATE posts SET views = 0';

function recordMode(): { readonly middleware: SqlMiddleware; readonly modes: string[] } {
  const modes: string[] = [];
  return {
    modes,
    middleware: {
      name: 'record-mode',
      familyId: 'sql',
      async beforeEncode(_plan, ctx) {
        modes.push(ctx.mode);
      },
    },
  };
}

afterEach(() => {
  recorded.statements.length = 0;
});

describe('query and execute on a postgres client', () => {
  it('run a plan outside a transaction', async () => {
    const db = postgres({ contract, url, verifyMarker: false });

    const rows = await db.query(db.sql.public.posts.select('id').build()).toArray();
    const stats = await db.execute(db.raw.sql`UPDATE posts SET views = 0`.affectedCount().build());
    await db.close();

    expect(rows).toEqual([{ id: 1 }]);
    expect(stats).toEqual({ affectedRows: 1 });
    expect(recorded.statements).toEqual([selectIds, resetViews]);
  });
});

describe('query and execute on a serverless connection', () => {
  it('run a plan outside a transaction', async () => {
    const serverless = postgresServerless({ contract, verifyMarker: false });
    await using db = await serverless.connect({ url });
    recorded.statements.length = 0;

    await db.query(db.sql.public.posts.select('id').build()).toArray();
    await db.execute(db.raw.sql`UPDATE posts SET views = 0`.affectedCount().build());

    expect(recorded.statements).toEqual([selectIds, resetViews]);
  });
});

describe('the mode option', () => {
  it('reaches middleware on a postgres client', async () => {
    const { middleware, modes } = recordMode();
    const db = postgres({ contract, url, verifyMarker: false, middleware: [middleware] });
    const permissive = postgres({
      contract,
      url,
      verifyMarker: false,
      middleware: [middleware],
      mode: 'permissive',
    });

    await db.query(db.sql.public.posts.select('id').build()).toArray();
    await permissive.query(permissive.sql.public.posts.select('id').build()).toArray();
    await db.close();
    await permissive.close();

    expect(modes).toEqual(['strict', 'permissive']);
  });

  it('reaches middleware on a serverless connection', async () => {
    const { middleware, modes } = recordMode();
    const serverless = postgresServerless({
      contract,
      verifyMarker: false,
      middleware: [middleware],
      mode: 'permissive',
    });
    await using db = await serverless.connect({ url });

    await db.query(db.sql.public.posts.select('id').build()).toArray();

    expect(modes).toEqual(['permissive']);
  });
});
