import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { withTransaction } from '@internal/sql-runtime';
import { describe, expect, it } from 'vitest';
import { setupIntegrationTest, timeouts } from './setup';

describe('integration: Postgres accepts each row-locking clause the builder renders', {
  timeout: timeouts.databaseOperation,
}, () => {
  const { db, runtime, lower } = setupIntegrationTest();

  const inTransaction = <Row>(plan: SqlQueryPlan<Row>) =>
    withTransaction(runtime(), async (tx) => await tx.query(plan));

  const alice = () =>
    db()
      .public.users.select('id', 'name')
      .where((f, fns) => fns.eq(f.id, 1));
  const aliceSql = 'SELECT "id" AS "id", "name" AS "name" FROM "public"."users" WHERE "id" = $1';

  const lockedByThisTransaction = () =>
    db()
      .public.users.select('locked', (_f, fns) =>
        fns.raw`xmax::text = (pg_current_xact_id()::text::bigint % 4294967296)::text`.returns(
          'pg/bool@1',
        ),
      )
      .where((f, fns) => fns.eq(f.id, 1))
      .build();

  it.each([
    ['forUpdate', 'FOR UPDATE'],
    ['forNoKeyUpdate', 'FOR NO KEY UPDATE'],
    ['forShare', 'FOR SHARE'],
    ['forKeyShare', 'FOR KEY SHARE'],
  ] as const)('%s renders %s and Postgres returns the row', async (method, keyword) => {
    const plan = alice()[method]().build();

    expect(lower(plan).sql).toBe(`${aliceSql} ${keyword}`);
    expect(await inTransaction(plan)).toEqual([{ id: 1, name: 'Alice' }]);
  });

  it('skipLocked renders SKIP LOCKED and Postgres returns the row', async () => {
    const plan = alice().forUpdate({ skipLocked: true }).build();

    expect(lower(plan).sql).toBe(`${aliceSql} FOR UPDATE SKIP LOCKED`);
    expect(await inTransaction(plan)).toEqual([{ id: 1, name: 'Alice' }]);
  });

  it('nowait renders NOWAIT and Postgres returns the row', async () => {
    const plan = alice().forUpdate({ nowait: true }).build();

    expect(lower(plan).sql).toBe(`${aliceSql} FOR UPDATE NOWAIT`);
    expect(await inTransaction(plan)).toEqual([{ id: 1, name: 'Alice' }]);
  });

  it('of on the only table renders OF and Postgres returns the row', async () => {
    const plan = alice()
      .forUpdate({ of: ['users'] })
      .build();

    expect(lower(plan).sql).toBe(`${aliceSql} FOR UPDATE OF "users"`);
    expect(await inTransaction(plan)).toEqual([{ id: 1, name: 'Alice' }]);
  });

  it('of an alias on a joined select renders OF the alias and Postgres returns the joined row', async () => {
    const d = db();
    const plan = d.public.users
      .as('u')
      .innerJoin(d.public.posts, (f, fns) => fns.eq(f.u.id, f.posts.user_id))
      .select('name', 'title')
      .where((f, fns) => fns.eq(f.u.id, 2))
      .forUpdate({ of: ['u'] })
      .build();

    expect(lower(plan).sql).toBe(
      'SELECT "name" AS "name", "title" AS "title" FROM "public"."users" AS "u" INNER JOIN "public"."posts" ON "u"."id" = "posts"."user_id" WHERE "u"."id" = $1 FOR UPDATE OF "u"',
    );
    expect(await inTransaction(plan)).toEqual([{ name: 'Bob', title: 'Bobs Post' }]);
  });

  it('the work-queue shape renders LIMIT 1 FOR UPDATE SKIP LOCKED and Postgres returns one row', async () => {
    const plan = db()
      .public.posts.select('id', 'title')
      .where((f, fns) => fns.gt(f.views, 40))
      .orderBy('views')
      .limit(1)
      .forUpdate({ skipLocked: true })
      .build();

    expect(lower(plan).sql).toBe(
      'SELECT "id" AS "id", "title" AS "title" FROM "public"."posts" WHERE "views" > $1 ORDER BY "views" ASC LIMIT 1 FOR UPDATE SKIP LOCKED',
    );
    expect(await inTransaction(plan)).toEqual([{ id: 2, title: 'Second Post' }]);
  });

  it('the transaction holds the row lock after a forUpdate select', async () => {
    const locked = await withTransaction(runtime(), async (tx) => {
      await tx.query(alice().forUpdate().build());
      return await tx.query(lockedByThisTransaction());
    });

    expect(locked).toEqual([{ locked: true }]);
  });

  it('the transaction holds no row lock after a plain select', async () => {
    const locked = await withTransaction(runtime(), async (tx) => {
      await tx.query(alice().build());
      return await tx.query(lockedByThisTransaction());
    });

    expect(locked).toEqual([{ locked: false }]);
  });
});
