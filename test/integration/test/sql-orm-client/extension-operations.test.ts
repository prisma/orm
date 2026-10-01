import { postgresRawCodecInferer } from '@internal/adapter-postgres/adapter';
import { sql } from '@internal/sql-builder/runtime';
import { toTsquery, tsquery, websearchToTsquery } from '@internal/target-postgres/full-text';
import { describe, expect, it } from 'vitest';
import { getTestContext } from './helpers';
import { createPostsCollection, timeouts, withCollectionRuntime } from './integration-helpers';
import { seedPosts, seedUsers } from './runtime-helpers';

describe('integration/extension-operations', () => {
  it(
    'filters posts by cosineSimilarity in where()',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@test.com' }]);
        await seedPosts(runtime, [
          { id: 1, title: 'Close', userId: 1, views: 10, embedding: [1, 0, 0] },
          { id: 2, title: 'Far', userId: 1, views: 20, embedding: [0, 1, 0] },
          { id: 3, title: 'Medium', userId: 1, views: 30, embedding: [0.7, 0.7, 0] },
        ]);

        const posts = createPostsCollection(runtime);
        const searchVec = [1, 0, 0];

        // -1 = opposite, 0 = orthogonal, 1 = identical. Filter for high similarity.
        const results = await posts
          .where((p) => p.embedding.cosineSimilarity(searchVec).gt(0.5))
          .orderBy((p) => p.id.asc())
          .all();

        expect(results.map((r) => r.title)).toEqual(['Close', 'Medium']);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orders posts by cosineSimilarity in orderBy()',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@test.com' }]);
        await seedPosts(runtime, [
          { id: 1, title: 'Far', userId: 1, views: 10, embedding: [0, 1, 0] },
          { id: 2, title: 'Close', userId: 1, views: 20, embedding: [1, 0, 0] },
          { id: 3, title: 'Medium', userId: 1, views: 30, embedding: [0.7, 0.7, 0] },
        ]);

        const posts = createPostsCollection(runtime);
        const searchVec = [1, 0, 0];

        // Order by similarity descending = closest first
        const results = await posts
          .orderBy((p) => p.embedding.cosineSimilarity(searchVec).desc())
          .all();

        expect(results.map((r) => r.title)).toEqual(['Close', 'Medium', 'Far']);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'combines cosineSimilarity in where() and orderBy()',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@test.com' }]);
        await seedPosts(runtime, [
          { id: 1, title: 'Close', userId: 1, views: 10, embedding: [1, 0, 0] },
          { id: 2, title: 'Far', userId: 1, views: 20, embedding: [0, 1, 0] },
          { id: 3, title: 'Medium', userId: 1, views: 30, embedding: [0.7, 0.7, 0] },
          { id: 4, title: 'No embedding', userId: 1, views: 40, embedding: null },
        ]);

        const posts = createPostsCollection(runtime);
        const searchVec = [1, 0, 0];

        // Filter for similar (> 0.5) and order by similarity asc (least similar of the matches first)
        const results = await posts
          .where((p) => p.embedding.cosineSimilarity(searchVec).gt(0.5))
          .orderBy((p) => p.embedding.cosineSimilarity(searchVec).asc())
          .all();

        expect(results.map((r) => r.title)).toEqual(['Medium', 'Close']);
      });
    },
    timeouts.spinUpPpgDev,
  );
});

describe('integration/full-text-search operations', () => {
  const seedSearchablePosts = async (runtime: Parameters<typeof seedPosts>[0]) => {
    await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@test.com' }]);
    await seedPosts(runtime, [
      { id: 1, title: 'alice wrote the report', userId: 1, views: 10, embedding: null },
      { id: 2, title: 'alice met alice and alice again', userId: 1, views: 20, embedding: null },
      { id: 3, title: 'bob wrote the report', userId: 1, views: 30, embedding: null },
    ]);
  };

  it(
    'filters posts by fullTextMatches in where()',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seedSearchablePosts(runtime);

        const results = await createPostsCollection(runtime)
          .select('id', 'title')
          .where((p) => p.title.fullTextMatches(websearchToTsquery('alice')))
          .orderBy((p) => p.id.asc())
          .all();

        expect(results).toEqual([
          { id: 1, title: 'alice wrote the report' },
          { id: 2, title: 'alice met alice and alice again' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orders posts by fullTextRank in orderBy()',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seedSearchablePosts(runtime);

        const query = websearchToTsquery('alice');
        const results = await createPostsCollection(runtime)
          .select('id', 'title')
          .where((p) => p.title.fullTextMatches(query))
          .orderBy((p) => p.title.fullTextRank(query).desc())
          .all();

        expect(results).toEqual([
          { id: 2, title: 'alice met alice and alice again' },
          { id: 1, title: 'alice wrote the report' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a tsquery read back from a query binds as the query and matches the same rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seedSearchablePosts(runtime);
        const builder = sql({
          context: getTestContext(),
          rawCodecInferer: postgresRawCodecInferer,
        });

        const { query } = await runtime
          .query(
            builder.public.posts
              .select('query', (_f, fns) => fns.websearchToTsquery('Alice reports'))
              .limit(1)
              .build(),
          )
          .firstOrThrow();
        const viaParser = await createPostsCollection(runtime)
          .select('id', 'title')
          .where((p) => p.title.fullTextMatches(websearchToTsquery('Alice reports')))
          .orderBy((p) => p.id.asc())
          .all();
        const viaReadBack = await createPostsCollection(runtime)
          .select('id', 'title')
          .where((p) => p.title.fullTextMatches(query))
          .orderBy((p) => p.id.asc())
          .all();

        expect(query).toBe("'alic' & 'report'");
        expect(viaParser).toEqual([{ id: 1, title: 'alice wrote the report' }]);
        expect(viaReadBack).toEqual(viaParser);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'toTsquery takes operator syntax and normalizes its words',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seedSearchablePosts(runtime);

        const results = await createPostsCollection(runtime)
          .select('id', 'title')
          .where((p) => p.title.fullTextMatches(toTsquery('Alice & !bob')))
          .orderBy((p) => p.id.asc())
          .all();

        expect(results).toEqual([
          { id: 1, title: 'alice wrote the report' },
          { id: 2, title: 'alice met alice and alice again' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'the tsquery tag runs typed terms as one normalized prefix term each, without error',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seedSearchablePosts(runtime);
        const idsMatchingPrefix = async (term: string) =>
          (
            await createPostsCollection(runtime)
              .select('id')
              .where((p) => p.title.fullTextMatches(tsquery`${term}:*`))
              .orderBy((p) => p.id.asc())
              .all()
          ).map((post) => post.id);

        const results: Record<string, number[]> = {};
        for (const term of [
          'Rep',
          'new y',
          "zebra's",
          'a&',
          're:port',
          "x' | 'secret",
          '',
          'the',
        ]) {
          results[term] = await idsMatchingPrefix(term);
        }

        expect(results).toEqual({
          Rep: [1, 3],
          'new y': [],
          "zebra's": [],
          'a&': [],
          're:port': [],
          "x' | 'secret": [],
          '': [],
          the: [],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    "the tsquery tag keeps the application's operators when the value carries its own",
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seedSearchablePosts(runtime);
        const idsFor = async (term: string) =>
          (
            await createPostsCollection(runtime)
              .select('id')
              .where((p) => p.title.fullTextMatches(tsquery`${term}:* & 'report'`))
              .all()
          ).map((post) => post.id);

        expect(await idsFor('bob')).toEqual([3]);
        expect(await idsFor("bob' | 'alice")).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'toTsquery on malformed text fails at execution with the Postgres error',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seedSearchablePosts(runtime);

        await expect(
          createPostsCollection(runtime)
            .select('id')
            .where((p) => p.title.fullTextMatches(toTsquery('alice &')))
            .all(),
        ).rejects.toThrow(/tsquery/);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
