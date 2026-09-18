import { describe, expect, it } from 'vitest';
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
          .where((p) => p.title.fullTextMatches('alice'))
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

        const results = await createPostsCollection(runtime)
          .select('id', 'title')
          .where((p) => p.title.fullTextMatches('alice'))
          .orderBy((p) => p.title.fullTextRank('alice').desc())
          .all();

        expect(results).toEqual([
          { id: 2, title: 'alice met alice and alice again' },
          { id: 1, title: 'alice wrote the report' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
