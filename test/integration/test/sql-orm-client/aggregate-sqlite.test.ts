import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { integerColumn, textColumn } from '@internal/adapter-sqlite/column-types';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { type AggregateSpec, Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import { defineContract, field, model } from '@internal/sqlite/contract-builder';
import { SqliteRuntimeImpl } from '@internal/sqlite/runtime';
import sqliteTarget from '@internal/target-sqlite/runtime';
import { InternalError } from '@internal/utils/internal-error';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

const Post = model('Post', {
  fields: {
    id: field.column(integerColumn).id(),
    title: field.column(textColumn),
    userId: field.column(integerColumn).column('user_id'),
    views: field.column(integerColumn),
  },
}).sql({ table: 'agg_posts' });

const contract = defineContract({ models: { Post } });
const namespaceId = UNBOUND_NAMESPACE_ID;

async function createRuntime(path: string) {
  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
  });
  const context = createExecutionContext({ contract, stack });
  const instance = instantiateExecutionStack(stack);
  const adapter = instance.adapter;
  const driver = instance.driver;
  if (adapter === undefined || driver === undefined) {
    throw new InternalError('SQLite execution stack is missing its adapter or driver');
  }
  await driver.connect({ kind: 'path', path });
  return {
    context,
    runtime: new SqliteRuntimeImpl({ context, adapter, driver }),
  };
}

const seedRows = [
  { id: 10, title: 'a', userId: 1, views: 10 },
  { id: 11, title: 'b', userId: 1, views: 20 },
  { id: 12, title: 'c', userId: 2, views: 30 },
  { id: 13, title: 'd', userId: 2, views: 40 },
  { id: 14, title: 'e', userId: 3, views: 50 },
];

async function withPostsRuntime(
  fn: (runtime: SqliteRuntimeImpl, posts: Collection<typeof contract, 'Post'>) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'pn-aggregate-sqlite-'));
  const path = join(directory, 'test.db');
  const database = new DatabaseSync(path);
  database.exec(`
    create table agg_posts (
      id integer primary key,
      title text not null,
      user_id integer not null,
      views integer not null
    );
  `);
  for (const row of seedRows) {
    database.exec(
      `insert into agg_posts (id, title, user_id, views) values (${row.id}, '${row.title}', ${row.userId}, ${row.views});`,
    );
  }
  database.close();

  const { context, runtime } = await createRuntime(path);
  try {
    const posts = new Collection({ runtime, context }, 'Post', { namespaceId });
    await fn(runtime, posts);
  } finally {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

// Row-scope proof: the row set an aggregate reduces over is what the chain
// describes, not every matching row. Every case seeds values where the
// paginated answer and the unpaginated answer differ, so a wrap that
// silently stopped applying — or a ParamRef that desynced across the
// derived-table boundary — would flip these numbers or error.
//
// `distinctOn` is out of scope here: it is gated on `postgres.distinctOn`,
// which this contract does not declare, so the ORM refuses the call before
// it ever reaches the renderer.
// The contract is authored in this file, so its static aggregate map is
// unknown and the typed builder surface (`.sum()`, `.count()`) is empty —
// dispatch dynamically, mirroring `sqlite-include-canonical-json.test.ts`.
function dynamicAggregate(
  aggregate: unknown,
): Record<string, (field?: string) => AggregateSpec[string]> {
  return aggregate as Record<string, (field?: string) => AggregateSpec[string]>;
}

describe('integration/aggregate (sqlite)', { timeout: timeouts.databaseOperation }, () => {
  it('take() after orderBy() sums only the top n rows', async () => {
    await withPostsRuntime(async (_runtime, posts) => {
      const top2 = await posts
        .orderBy((post) => post.views.desc())
        .take(2)
        .aggregate((aggregate) => ({ total: dynamicAggregate(aggregate)['sum']!('views') }));

      // Sum of the top 2 by views (50 + 40); the unpaginated sum over all
      // five rows is 150.
      expect(top2).toEqual({ total: 90 });
    });
  });

  it('where() filters inside the row scope pagination reduces over', async () => {
    await withPostsRuntime(async (_runtime, posts) => {
      const stats = await posts
        .where((post) => post.views.gte(20))
        .orderBy((post) => post.views.desc())
        .take(2)
        .aggregate((aggregate) => ({ total: dynamicAggregate(aggregate)['sum']!('views') }));

      // Matching rows are 20/30/40/50 (sum 140); the top 2 of those is
      // 50 + 40.
      expect(stats).toEqual({ total: 90 });
    });
  });

  it('distinct() reduces the aggregate to one row per distinct key', async () => {
    await withPostsRuntime(async (_runtime, posts) => {
      const stats = await posts
        .orderBy((post) => post.id.asc())
        .distinct('userId')
        .aggregate((aggregate) => ({ count: dynamicAggregate(aggregate)['count']!() }));

      // Three distinct userId groups (1, 2, 3) out of five rows, against an
      // unpaginated count of 5.
      expect(stats).toEqual({ count: 3 });
    });
  });

  it('binds two distinct WHERE parameters correctly across the derived-table boundary', async () => {
    await withPostsRuntime(async (_runtime, posts) => {
      const stats = await posts
        .where((post) => post.views.gte(20))
        .where((post) => post.views.lte(40))
        .orderBy((post) => post.views.desc())
        .take(2)
        .aggregate((aggregate) => ({ total: dynamicAggregate(aggregate)['sum']!('views') }));

      // Matching rows are 20/30/40 (sum 90); the top 2 of those is 40 + 30.
      // The SQLite renderer emits one `?` per ParamRef occurrence without
      // deduping by identity — if the same ParamRef instance backing 20 or
      // 40 reached SQL twice, every subsequent binding would shift and this
      // would either error or answer with the wrong rows.
      expect(stats).toEqual({ total: 70 });
    });
  });

  it('skip() without take() reduces over all-but-the-first-n', async () => {
    await withPostsRuntime(async (_runtime, posts) => {
      const stats = await posts
        .orderBy((post) => post.id.asc())
        .skip(2)
        .aggregate((aggregate) => ({ total: dynamicAggregate(aggregate)['sum']!('views') }));

      // Ordered by id asc, skip(2) drops the 10/20 rows and reduces over
      // 30 + 40 + 50; the unpaginated sum over all five rows is 150.
      // SQLite's grammar has no standalone OFFSET clause, so this case
      // used to fail with `near "OFFSET": syntax error`; the renderer now
      // emits `LIMIT -1 OFFSET n` (SQLite's idiom for an unbounded limit)
      // when an offset is present with no limit.
      expect(stats).toEqual({ total: 120 });
    });
  });

  describe('groupBy', () => {
    it('take() before groupBy() scopes which rows get grouped', async () => {
      await withPostsRuntime(async (_runtime, posts) => {
        const grouped = await posts
          .orderBy((post) => post.views.desc())
          .take(3)
          .groupBy('userId')
          .aggregate((aggregate) => ({
            count: dynamicAggregate(aggregate)['count']!(),
            total: dynamicAggregate(aggregate)['sum']!('views'),
          }));

        const sorted = [...grouped].sort((a, b) => Number(a.userId) - Number(b.userId));
        // Scoped to the top 3 by views (50/40/30), user 1's two rows (10/20)
        // are both excluded — user 1 disappears from the grouped result
        // entirely. Unscoped, all three users would appear, user 1 as
        // { count: 2, total: 30 }.
        expect(sorted).toEqual([
          { userId: 2, count: 2, total: 70 },
          { userId: 3, count: 1, total: 50 },
        ]);
      });
    });

    it('orderBy()/take() after groupBy() pages the groups themselves', async () => {
      await withPostsRuntime(async (_runtime, posts) => {
        const grouped = await posts
          .groupBy('userId')
          .orderBy((group) => group.userId.desc())
          .take(2)
          .aggregate((aggregate) => ({ count: dynamicAggregate(aggregate)['count']!() }));

        // Three distinct groups exist (userId 1, 2, 3); post-group take(2)
        // returns only the top 2 by userId desc — if take() were dropped,
        // all 3 groups would come back instead.
        expect(grouped).toEqual([
          { userId: 3, count: 1 },
          { userId: 2, count: 2 },
        ]);
      });
    });

    it('post-group skip() without take() emits OFFSET with no LIMIT', async () => {
      await withPostsRuntime(async (_runtime, posts) => {
        const grouped = await posts
          .groupBy('userId')
          .orderBy((group) => group.userId.asc())
          .skip(1)
          .aggregate((aggregate) => ({ count: dynamicAggregate(aggregate)['count']!() }));

        // Three distinct groups exist (userId 1, 2, 3); skip(1) with no take()
        // drops the first group by userId and returns all-but-the-first —
        // the same "SQLite has no standalone OFFSET" renderer path root-level
        // skip() already exercises above, now pinned for the grouped select.
        expect(grouped).toEqual([
          { userId: 2, count: 2 },
          { userId: 3, count: 1 },
        ]);
      });
    });

    it('pre-group and post-group pagination both apply, in the same chain', async () => {
      await withPostsRuntime(async (_runtime, posts) => {
        const grouped = await posts
          .orderBy((post) => post.views.desc())
          .take(4)
          .groupBy('userId')
          .orderBy((group) => group.userId.asc())
          .take(2)
          .aggregate((aggregate) => ({
            count: dynamicAggregate(aggregate)['count']!(),
            total: dynamicAggregate(aggregate)['sum']!('views'),
          }));

        // Pre-group take(4) drops user 1's lowest row (views 10), leaving
        // user 1 with one row (views 20) instead of two — if that scoping
        // didn't apply, user 1 would read { count: 2, total: 30 }.
        // Post-group take(2) then keeps only the lowest 2 of the 3 userIds
        // that remain — if that didn't apply, user 3 ({ count: 1, total: 50
        // }) would appear as a third row.
        expect(grouped).toEqual([
          { userId: 1, count: 1, total: 20 },
          { userId: 2, count: 2, total: 70 },
        ]);
      });
    });
  });
});
