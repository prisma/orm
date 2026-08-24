import { describe, expect, it } from 'vitest';
import {
  createPostsCollection,
  createUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { seedPosts, seedUsers } from './runtime-helpers';

describe('integration/aggregate', () => {
  it(
    'aggregate() computes count() with where() in one query',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Alice', email: 'alice2@example.com' },
          { id: 3, name: 'Bob', email: 'bob@example.com' },
        ]);

        runtime.resetExecutions();
        const stats = await users.where({ name: 'Alice' }).aggregate((aggregate) => ({
          count: aggregate.count(),
        }));

        expect(stats).toEqual({ count: 2 });
        expect(runtime.executions).toHaveLength(1);
        expect(runtime.executions[0]?.sql.toLowerCase()).toContain('count(*)');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'aggregate() supports multiple numeric aggregations with filters',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 10, title: 'Low', userId: 1, views: 10 },
          { id: 11, title: 'Mid', userId: 1, views: 20 },
          { id: 12, title: 'High', userId: 2, views: 30 },
        ]);

        const numericField = 'views' as never;
        const stats = await posts
          .where((post) => post.views.gte(20))
          .aggregate((aggregate) => ({
            count: aggregate.count(),
            total: aggregate.sum(numericField),
            avg: aggregate.avg(numericField),
            min: aggregate.min(numericField),
            max: aggregate.max(numericField),
          }));

        // Each value is the target's declared result codec speaking: the bare
        // `count`, `sum` and `avg` answer as JS numbers, and `min`/`max` keep
        // the column's own int4.
        expect(stats).toEqual({
          count: 2,
          total: 50,
          avg: 25,
          min: 20,
          max: 30,
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'aggregate() returns null for sum/avg/min/max on empty result sets',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [{ id: 10, title: 'Only', userId: 1, views: 10 }]);

        const numericField = 'views' as never;
        const stats = await posts
          .where((post) => post.views.gt(999))
          .aggregate((aggregate) => ({
            count: aggregate.count(),
            total: aggregate.sum(numericField),
            avg: aggregate.avg(numericField),
            min: aggregate.min(numericField),
            max: aggregate.max(numericField),
          }));

        expect(stats).toEqual({
          count: 0,
          total: null,
          avg: null,
          min: null,
          max: null,
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  // The value-level proof that an aggregate past 2^53 throws rather than
  // rounds needs a column whose total exceeds a double's integers; this
  // fixture's widest numeric column is int4, so the boundary itself is pinned
  // against the integer-representation fixture instead.
  it(
    'reads a widened sum and an include count as the numbers they now are',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedPosts(runtime, [
          { id: 10, title: 'a', userId: 1, views: 2000000000 },
          { id: 11, title: 'b', userId: 1, views: 2000000000 },
        ]);

        const numericField = 'views' as never;
        const stats = await posts.aggregate((aggregate) => ({
          count: aggregate.count(),
          total: aggregate.sum(numericField),
        }));

        // The sum exceeds int4, and the number the bare operation answers with
        // carries it exactly — the guard is what makes that safe to rely on.
        expect(stats).toEqual({ count: 2, total: 4000000000 });

        const rows = await users
          .select('id')
          .include('posts', (related) => related.count())
          .all();

        // An include count reads through the same codec: a JSON number again,
        // and safely, since the guard runs after the parse.
        expect(rows).toEqual([{ id: 1, posts: 2 }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // Row-scope proof: the row set an aggregate reduces over is what the chain
  // describes, not every matching row. Every case below seeds values where the
  // paginated answer and the unpaginated answer differ, so a wrap that silently
  // stopped applying would flip these back to the unpaginated numbers.
  describe('row-scoped aggregate values', () => {
    it(
      'limit() after orderBy() sums only the top n rows',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const posts = createPostsCollection(runtime);
          await seedPosts(runtime, [
            { id: 10, title: 'a', userId: 1, views: 10 },
            { id: 11, title: 'b', userId: 1, views: 20 },
            { id: 12, title: 'c', userId: 1, views: 30 },
            { id: 13, title: 'd', userId: 1, views: 40 },
            { id: 14, title: 'e', userId: 1, views: 50 },
          ]);
          const numericField = 'views' as never;

          const top2 = await posts
            .orderBy((post) => post.views.desc())
            .limit(2)
            .aggregate((aggregate) => ({ total: aggregate.sum(numericField) }));

          // Sum of the top 2 by views (50 + 40): the unpaginated sum over all
          // five rows is 150, so a dropped wrap would answer 150 here instead.
          expect(top2).toEqual({ total: 90 });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'offset() without limit() sums all-but-the-first-n rows',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const posts = createPostsCollection(runtime);
          await seedPosts(runtime, [
            { id: 10, title: 'a', userId: 1, views: 10 },
            { id: 11, title: 'b', userId: 1, views: 20 },
            { id: 12, title: 'c', userId: 1, views: 30 },
            { id: 13, title: 'd', userId: 1, views: 40 },
            { id: 14, title: 'e', userId: 1, views: 50 },
          ]);
          const numericField = 'views' as never;

          const stats = await posts
            .orderBy((post) => post.id.asc())
            .offset(2)
            .aggregate((aggregate) => ({ total: aggregate.sum(numericField) }));

          // Skips the first two rows by id (views 10, 20), leaving 30+40+50.
          expect(stats).toEqual({ total: 120 });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'where() filters inside the row scope pagination reduces over',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const posts = createPostsCollection(runtime);
          await seedPosts(runtime, [
            { id: 10, title: 'a', userId: 1, views: 10 },
            { id: 11, title: 'b', userId: 1, views: 20 },
            { id: 12, title: 'c', userId: 1, views: 30 },
            { id: 13, title: 'd', userId: 1, views: 40 },
            { id: 14, title: 'e', userId: 1, views: 50 },
          ]);
          const numericField = 'views' as never;

          const stats = await posts
            .where((post) => post.views.gte(20))
            .orderBy((post) => post.views.desc())
            .limit(2)
            .aggregate((aggregate) => ({ total: aggregate.sum(numericField) }));

          // Matching rows are 20/30/40/50 (sum 140); the top 2 of those by
          // views is 50+40. Dropping either the filter or the wrap changes
          // this number.
          expect(stats).toEqual({ total: 90 });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'distinct() reduces the aggregate to one row per distinct key',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const posts = createPostsCollection(runtime);
          await seedPosts(runtime, [
            { id: 10, title: 'a', userId: 1, views: 10 },
            { id: 11, title: 'a2', userId: 1, views: 15 },
            { id: 12, title: 'b', userId: 2, views: 20 },
            { id: 13, title: 'b2', userId: 2, views: 25 },
            { id: 14, title: 'c', userId: 3, views: 30 },
          ]);

          const stats = await posts
            .orderBy((post) => post.id.asc())
            .distinct('userId')
            .aggregate((aggregate) => ({ count: aggregate.count() }));

          // Three distinct userId groups out of five rows — the unpaginated
          // count is 5.
          expect(stats).toEqual({ count: 3 });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'distinctOn() sums the first row per key by orderBy precedence',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const posts = createPostsCollection(runtime);
          await seedPosts(runtime, [
            { id: 10, title: 'a', userId: 1, views: 10 },
            { id: 11, title: 'a2', userId: 1, views: 15 },
            { id: 12, title: 'b', userId: 2, views: 20 },
            { id: 13, title: 'b2', userId: 2, views: 25 },
            { id: 14, title: 'c', userId: 3, views: 30 },
          ]);
          const numericField = 'views' as never;

          const stats = await posts
            .orderBy([(post) => post.userId.asc(), (post) => post.views.desc()])
            .distinctOn('userId')
            .aggregate((aggregate) => ({ total: aggregate.sum(numericField) }));

          // One row per userId, the highest-views row within each group
          // (orderBy leads with userId, then views desc): 15 + 25 + 30. The
          // unpaginated sum over all five rows is 100.
          expect(stats).toEqual({ total: 70 });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'binds two distinct WHERE parameters correctly across the derived-table boundary',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const posts = createPostsCollection(runtime);
          await seedPosts(runtime, [
            { id: 10, title: 'a', userId: 1, views: 10 },
            { id: 11, title: 'b', userId: 1, views: 20 },
            { id: 12, title: 'c', userId: 1, views: 30 },
            { id: 13, title: 'd', userId: 1, views: 40 },
            { id: 14, title: 'e', userId: 1, views: 50 },
          ]);
          const numericField = 'views' as never;

          runtime.resetExecutions();
          const stats = await posts
            .where((post) => post.views.gte(20))
            .where((post) => post.views.lte(40))
            .orderBy((post) => post.views.desc())
            .limit(2)
            .aggregate((aggregate) => ({ total: aggregate.sum(numericField) }));

          // Matching rows are 20/30/40 (sum 90); the top 2 of those is 40+30.
          // If the two ParamRef instances backing 20 and 40 desynced, this
          // would either error or silently answer with the wrong rows.
          expect(stats).toEqual({ total: 70 });
          expect(runtime.executions).toHaveLength(1);
          expect(runtime.executions[0]?.params).toEqual([
            { kind: 'literal', value: 20 },
            { kind: 'literal', value: 40 },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
