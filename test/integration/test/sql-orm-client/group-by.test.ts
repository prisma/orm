import { AggregateExpr, BinaryExpr, LiteralExpr } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { isSelectAst } from './helpers';
import { createPostsCollection, timeouts, withCollectionRuntime } from './integration-helpers';
import { seedPosts } from './runtime-helpers';

describe('integration/groupBy', () => {
  it(
    'groupBy().aggregate() returns grouped counts',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 10, title: 'A', userId: 1, views: 10 },
          { id: 11, title: 'B', userId: 1, views: 20 },
          { id: 12, title: 'C', userId: 2, views: 30 },
        ]);

        runtime.resetExecutions();
        const grouped = await posts.groupBy('userId').aggregate((aggregate) => ({
          count: aggregate.count(),
        }));

        const sorted = [...grouped].sort(
          (left, right) => Number(left.userId) - Number(right.userId),
        );
        expect(sorted).toEqual([
          { userId: 1, count: 2 },
          { userId: 2, count: 1 },
        ]);
        expect(runtime.executions).toHaveLength(1);
        expect(runtime.executions[0]?.sql.toLowerCase()).toContain('group by');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'take() before groupBy() scopes the rows that get grouped',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 10, title: 'A', userId: 1, views: 10 },
          { id: 11, title: 'B', userId: 1, views: 20 },
          { id: 12, title: 'C', userId: 1, views: 30 },
        ]);

        // If the derived table the row-scope wrap builds didn't project
        // `user_id` (the group key), GROUP BY would resolve against a column
        // absent from its own FROM and the query would error outright,
        // failing this test loudly rather than passing on the wrong count.
        const grouped = await posts
          .orderBy((post) => post.views.desc())
          .take(2)
          .groupBy('userId')
          .aggregate((aggregate) => ({ count: aggregate.count() }));

        // Only the top 2 by views (30, 20) are grouped; the count would be 3
        // if take() were silently dropped instead of scoping the input rows.
        expect(grouped).toEqual([{ userId: 1, count: 2 }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'take() before groupBy() scopes the rows a having() predicate then evaluates',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 10, title: 'A', userId: 1, views: 10 },
          { id: 11, title: 'B', userId: 1, views: 20 },
          { id: 12, title: 'C', userId: 1, views: 30 },
          { id: 13, title: 'D', userId: 2, views: 100 },
        ]);

        // orderBy/take before groupBy keep only the top 2 rows by views
        // (100 from user 2, 30 from user 1) before grouping — having() then
        // evaluates aggregates over that scoped set, not every row.
        const grouped = await posts
          .orderBy((post) => post.views.desc())
          .take(2)
          .groupBy('userId')
          .having((having) => having.sum('views' as never).gt(15))
          .aggregate((aggregate) => ({
            count: aggregate.count(),
            total: aggregate.sum('views' as never),
          }));

        const sorted = [...grouped].sort(
          (left, right) => Number(left.userId) - Number(right.userId),
        );
        expect(sorted).toEqual([
          { userId: 1, count: 1, total: 30 },
          { userId: 2, count: 1, total: 100 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'having() filters groups before post-group orderBy()/take() pages the survivors',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 10, title: 'A', userId: 1, views: 10 },
          { id: 11, title: 'B', userId: 1, views: 20 },
          { id: 12, title: 'C', userId: 2, views: 5 },
          { id: 13, title: 'D', userId: 3, views: 5 },
          { id: 14, title: 'E', userId: 3, views: 5 },
          { id: 15, title: 'F', userId: 3, views: 5 },
          { id: 16, title: 'G', userId: 4, views: 5 },
        ]);

        runtime.resetExecutions();
        // having(count >= 2) drops users 2 and 4 (one post each), leaving
        // users 1 and 3. Post-group orderBy(desc).take(1) then picks the
        // higher userId among the *survivors* — proving having() ran
        // before the post-group page, not after.
        const grouped = await posts
          .groupBy('userId')
          .having((having) => having.count().gte(2))
          .orderBy((group) => group.userId.desc())
          .take(1)
          .aggregate((aggregate) => ({ count: aggregate.count() }));

        expect(grouped).toEqual([{ userId: 3, count: 3 }]);
        expect(runtime.executions).toHaveLength(1);

        const sql = runtime.executions[0]?.sql.toLowerCase() ?? '';
        const groupByIdx = sql.indexOf('group by');
        const havingIdx = sql.indexOf('having');
        const orderByIdx = sql.indexOf('order by');
        const limitIdx = sql.indexOf('limit');
        expect(groupByIdx).toBeGreaterThan(-1);
        expect(havingIdx).toBeGreaterThan(groupByIdx);
        expect(orderByIdx).toBeGreaterThan(havingIdx);
        expect(limitIdx).toBeGreaterThan(orderByIdx);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orderBy()/take() after groupBy() pages the groups themselves',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 10, title: 'A', userId: 1, views: 10 },
          { id: 11, title: 'B', userId: 2, views: 10 },
          { id: 12, title: 'C', userId: 3, views: 10 },
          { id: 13, title: 'D', userId: 4, views: 10 },
        ]);

        runtime.resetExecutions();
        // Four distinct groups exist (no having() to shrink that set first);
        // post-group orderBy(desc).take(2) must return only the top 2 by
        // userId — proving take() pages the grouped rows themselves rather
        // than being silently dropped, which would return all 4.
        const grouped = await posts
          .groupBy('userId')
          .orderBy((group) => group.userId.desc())
          .take(2)
          .aggregate((aggregate) => ({ count: aggregate.count() }));

        expect(grouped).toEqual([
          { userId: 4, count: 1 },
          { userId: 3, count: 1 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'having() filters grouped rows by aggregate predicates',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 10, title: 'A', userId: 1, views: 10 },
          { id: 11, title: 'B', userId: 1, views: 20 },
          { id: 12, title: 'C', userId: 2, views: 30 },
        ]);

        runtime.resetExecutions();
        const grouped = await posts
          .groupBy('userId')
          .having((having) => having.count().gt(1))
          .aggregate((aggregate) => ({
            count: aggregate.count(),
          }));

        expect(grouped).toEqual([{ userId: 1, count: 2 }]);
        expect(runtime.executions).toHaveLength(1);
        const ast = runtime.executions[0]?.ast;
        expect(isSelectAst(ast)).toBe(true);
        if (!isSelectAst(ast)) {
          throw new Error('Expected grouped query to emit a select AST plan');
        }
        expect(ast.having).toEqual(BinaryExpr.gt(AggregateExpr.count(), LiteralExpr.of(1)));
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'groupBy() preserves where() filters and supports numeric aggregations',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 10, title: 'A', userId: 1, views: 10 },
          { id: 11, title: 'B', userId: 1, views: 20 },
          { id: 12, title: 'C', userId: 2, views: 30 },
        ]);

        const numericField = 'views' as never;
        const grouped = await posts
          .where((post) => post.views.gte(20))
          .groupBy('userId')
          .aggregate((aggregate) => ({
            totalViews: aggregate.sum(numericField),
            avgViews: aggregate.avg(numericField),
          }));

        const sorted = [...grouped].sort(
          (left, right) => Number(left.userId) - Number(right.userId),
        );
        expect(sorted).toEqual([
          // The bare operations answer in the JS types a caller expects: the
          // sum of integers as a number, the mean as a number too.
          { userId: 1, totalViews: 20, avgViews: 20 },
          { userId: 2, totalViews: 30, avgViews: 30 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
