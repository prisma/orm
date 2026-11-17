import { describe, expect, it } from 'vitest';
import { includeStrategies } from './helpers';
import {
  createUsersCollection,
  expectPerRelationStatements,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { seedComments, seedPosts, seedUsers } from './runtime-helpers';

describe.each(includeStrategies)('identity columns the caller did not select (%s)', (strategy) => {
  it(
    'are read to match nested rows and removed from every level, with and without paging',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'A1', userId: 1, views: 3 },
          { id: 11, title: 'A2', userId: 1, views: 2 },
          { id: 12, title: 'B1', userId: 2, views: 1 },
        ]);
        await seedComments(runtime, [
          { id: 100, body: 'on A1', postId: 10 },
          { id: 101, body: 'on A2', postId: 11 },
          { id: 102, body: 'on B1', postId: 12 },
        ]);
        const users = createUsersCollection(runtime, strategy);

        runtime.resetExecutions();
        const rows = await users
          .select('name')
          .orderBy((user) => user.id.asc())
          .include('posts', (posts) =>
            posts
              .select('title')
              .orderBy((post) => post.views.desc())
              .limit(1)
              .include('comments', (comments) => comments.select('body')),
          )
          .all();
        expectPerRelationStatements(runtime, strategy, 3);

        expect(rows).toEqual([
          { name: 'Alice', posts: [{ title: 'A1', comments: [{ body: 'on A1' }] }] },
          { name: 'Bob', posts: [{ title: 'B1', comments: [{ body: 'on B1' }] }] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
