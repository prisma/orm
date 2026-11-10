import { Collection } from '@internal/sql-orm-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Contract } from './fixtures/generated/contract';
import fixtureContractJson from './fixtures/generated/contract.json' with { type: 'json' };

const recorded = vi.hoisted(() => ({
  statements: [] as Array<{ readonly connection: number; readonly text: string }>,
  connections: 0,
}));

vi.mock('pg', () => {
  function recordingQuery(connection: number) {
    return vi.fn(async (request: string | { readonly text: string }) => {
      recorded.statements.push({
        connection,
        text: typeof request === 'string' ? request : request.text,
      });
      return { rows: [], rowCount: 0 };
    });
  }
  class Pool {
    on = vi.fn().mockReturnThis();
    connect = vi.fn(async () => ({
      query: recordingQuery(++recorded.connections),
      release: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    }));
    end = vi.fn().mockResolvedValue(undefined);
    totalCount = 0;
    idleCount = 0;
    waitingCount = 0;
  }
  class Client {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue(undefined);
    query = recordingQuery(++recorded.connections);
    end = vi.fn().mockResolvedValue(undefined);
    release = vi.fn();
  }
  return { Pool, Client };
});

import postgres, { type PostgresTransactionContext } from '../src/exports/runtime';
import postgresServerless from '../src/exports/serverless';
import { contractFromJson } from '../src/exports/static';

class PostCollection extends Collection<Contract, 'Post'> {
  titled(title: string) {
    return this.where({ title });
  }
}

const contract = contractFromJson<Contract>(fixtureContractJson);
const collections = { Post: PostCollection };
const url = 'postgres://localhost:5432/db';

const selectIds = 'SELECT "id" AS "id" FROM "public"."posts"';
const resetViews = 'UPDATE posts SET views = 0';
const selectById = 'SELECT "id" AS "id" FROM "public"."posts" WHERE "id" = $1';
const selectTitled =
  'SELECT "posts"."id" AS "id", "posts"."title" AS "title", "posts"."user_id" AS "user_id", "posts"."views" AS "views" FROM "public"."posts" WHERE "posts"."title" = $1';

async function useEveryMember(
  tx: PostgresTransactionContext<Contract, typeof collections>,
): Promise<void> {
  await tx.query(tx.sql.public.posts.select('id').build());
  await tx.execute(tx.raw.sql`UPDATE posts SET views = 0`.affectedCount().build());
  const byId = await tx.prepare({ id: 'pg/int4@1' }, (params) =>
    tx.sql.public.posts
      .select('id')
      .where((f, fns) => fns.eq(f.id, params.id))
      .build(),
  );
  await byId.query(tx, { id: 1 });
  await tx.orm.public.Post.titled('Hello').all();
}

const everyStatementInTheTransaction = [
  'BEGIN',
  selectIds,
  resetViews,
  selectById,
  selectTitled,
  'COMMIT',
];

function onOneConnection(texts: readonly string[]) {
  const connection = recorded.statements[0]?.connection;
  return texts.map((text) => ({ connection, text }));
}

afterEach(() => {
  recorded.statements.length = 0;
  recorded.connections = 0;
});

describe('a postgres transaction', () => {
  it('offers sql, raw, prepare and orm, and runs every statement inside the transaction', async () => {
    const db = postgres({ contract, url, verifyMarker: false, collections });

    await db.transaction(useEveryMember);
    await db.close();

    expect(recorded.statements).toEqual(onOneConnection(everyStatementInTheTransaction));
  });

  it("offers the client's toSql, sql and raw", async () => {
    const db = postgres({ contract, url, verifyMarker: false });

    const members = await db.transaction(async (tx) => ({
      toSql: tx.toSql,
      sql: tx.sql,
      raw: tx.raw,
    }));
    await db.close();

    expect(members.toSql).toBe(db.toSql);
    expect(members.sql).toBe(db.sql);
    expect(members.raw).toBe(db.raw);
  });

  it('runs a statement prepared on the client inside the transaction it is given', async () => {
    const db = postgres({ contract, url, verifyMarker: false });
    const byId = await db.prepare({ id: 'pg/int4@1' }, (params) =>
      db.sql.public.posts
        .select('id')
        .where((f, fns) => fns.eq(f.id, params.id))
        .build(),
    );

    await db.transaction(async (tx) => {
      await byId.query(tx, { id: 1 });
    });
    await db.close();

    expect(recorded.statements).toEqual(onOneConnection(['BEGIN', selectById, 'COMMIT']));
  });

  it('runs a prepared ORM read inside the transaction it is given', async () => {
    const db = postgres({ contract, url, verifyMarker: false });
    const ids = await db.prepare({}, () => db.orm.public.Post.select('id').prepared.all());

    await db.transaction(async (tx) => ids.query(tx, {}));
    await db.close();

    expect(recorded.statements).toEqual(
      onOneConnection(['BEGIN', 'SELECT "posts"."id" AS "id" FROM "public"."posts"', 'COMMIT']),
    );
  });

  it('refuses a prepared statement run on the transaction after it ends', async () => {
    const db = postgres({ contract, url, verifyMarker: false });
    const byId = await db.prepare({ id: 'pg/int4@1' }, (params) =>
      db.sql.public.posts
        .select('id')
        .where((f, fns) => fns.eq(f.id, params.id))
        .build(),
    );

    const ended = await db.transaction(async (tx) => tx);

    await expect(async () => byId.query(ended, { id: 1 })).rejects.toThrow(/transaction has ended/);
    await db.close();
  });
});

describe('a transaction on a serverless connection', () => {
  it('offers sql, raw, prepare and orm, and runs every statement inside the transaction', async () => {
    const serverless = postgresServerless({ contract, verifyMarker: false, collections });
    await using db = await serverless.connect({ url });
    recorded.statements.length = 0;

    await db.transaction(useEveryMember);

    expect(recorded.statements).toEqual(onOneConnection(everyStatementInTheTransaction));
  });
});
