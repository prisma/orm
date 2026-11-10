import pgvector from '@internal/extension-pgvector/runtime';
import { cacheAnnotation, createCacheMiddleware } from '@internal/middleware-cache';
import postgres from '@internal/postgres/runtime';
import { orm } from '@internal/sql-orm-client';
import { type SqlMiddleware, withTransaction } from '@internal/sql-runtime';
import { timeouts } from '@repo/test-utils';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { useMiddlewareCacheDatabase } from './middleware-cache-database';

function statementsFromDriver(sent: string[]): SqlMiddleware {
  return {
    name: 'statements-from-driver',
    familyId: 'sql',
    async activityEnded(activity, result) {
      if (
        activity.kind === 'statement' &&
        result.kind === 'statement' &&
        result.source === 'driver'
      ) {
        sent.push('statement');
      }
    },
  };
}

describe('integration: middleware-cache caches ORM calls against real Postgres', {
  timeout: timeouts.databaseOperation,
}, () => {
  const database = useMiddlewareCacheDatabase();

  function setup() {
    const sent: string[] = [];
    const cache = createCacheMiddleware();
    const runtime = database.buildRuntime([cache, statementsFromDriver(sent)]);
    const db = orm({ runtime, context: database.context }).public;
    return { sent, runtime, db };
  }

  it('serves a repeated annotated ORM read from the cache without sending a statement', async () => {
    const { sent, db } = setup();
    const read = () =>
      db.User.select('id', 'name')
        .orderBy((user) => user.id.asc())
        .first(undefined, (meta) => meta.annotate(cacheAnnotation({})));

    const first = await read();
    const statementsAfterFirst = sent.length;
    const second = await read();

    expect({
      first,
      same: second,
      statementsAfterFirst,
      statementsAfterSecond: sent.length,
    }).toEqual({
      first: expect.objectContaining({ id: expect.any(Number) }),
      same: first,
      statementsAfterFirst: 1,
      statementsAfterSecond: 1,
    });
  });

  it('serves a streaming ORM read under its annotation key', async () => {
    const { sent, db } = setup();
    const read = () =>
      db.User.select('id')
        .orderBy((user) => user.id.asc())
        .all((meta) => meta.annotate(cacheAnnotation({ key: 'user-ids' })));

    const first = await read();
    const second = await read();

    expect({ same: second, statements: sent.length }).toEqual({ same: first, statements: 1 });
  });

  it('neither serves nor stores an annotated ORM read inside a transaction', async () => {
    const { sent, runtime } = setup();
    const read = (queryable: Parameters<typeof orm>[0]['runtime']) =>
      orm({ runtime: queryable, context: database.context })
        .public.User.select('id')
        .orderBy((user) => user.id.asc())
        .all((meta) => meta.annotate(cacheAnnotation({ key: 'in-transaction' })));

    await withTransaction(runtime, async (tx) => {
      await read(tx);
      await read(tx);
    });
    const statementsInTransaction = sent.length;
    await read(runtime);

    expect({ statementsInTransaction, statementsAfter: sent.length }).toEqual({
      statementsInTransaction: 2,
      statementsAfter: 3,
    });
  });

  it("neither serves nor stores an annotated ORM read inside the facade's db.transaction(fn)", async () => {
    const sent: string[] = [];
    const client = new Client({ connectionString: database.connectionString });
    await client.connect();
    const db = postgres({
      contract: database.contract,
      pg: client,
      verifyMarker: false,
      extensions: [pgvector],
      middleware: [createCacheMiddleware(), statementsFromDriver(sent)],
    });
    const read = (users: typeof db.orm.public.User) =>
      users
        .select('id')
        .orderBy((user) => user.id.asc())
        .all((meta) => meta.annotate(cacheAnnotation({ key: 'facade-transaction' })));
    try {
      await db.transaction(async (tx) => {
        await read(tx.orm.public.User);
        await read(tx.orm.public.User);
      });
      const statementsInTransaction = sent.length;
      await read(db.orm.public.User);

      expect({ statementsInTransaction, statementsAfter: sent.length }).toEqual({
        statementsInTransaction: 2,
        statementsAfter: 3,
      });
    } finally {
      await db.close();
      await client.end();
    }
  });
});
