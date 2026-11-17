import { describe, expect, it } from 'vitest';
import { includeStrategies } from './helpers';
import {
  createUsersCollection,
  expectPerRelationStatements,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { type PgIntegrationRuntime, seedPosts, seedUsers } from './runtime-helpers';

async function seedAuthorsAndPosts(runtime: PgIntegrationRuntime): Promise<void> {
  await seedUsers(runtime, [
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', email: 'bob@example.com' },
  ]);
  await seedPosts(runtime, [
    { id: 10, title: 'A', userId: 1, views: 5 },
    { id: 11, title: 'A', userId: 1, views: 9 },
    { id: 12, title: 'B', userId: 1, views: 1 },
    { id: 13, title: 'A', userId: 2, views: 2 },
  ]);
}

describe.each(includeStrategies)('distinctOn() in an include (%s)', (strategy) => {
  it(
    'keeps the first row of each group of each parent, in the order the caller gave',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seedAuthorsAndPosts(runtime);
        const users = createUsersCollection(runtime, strategy);

        runtime.resetExecutions();
        const rows = await users
          .select('name')
          .orderBy((user) => user.id.asc())
          .include('posts', (posts) =>
            posts
              .select('title', 'views')
              .orderBy([(post) => post.title.asc(), (post) => post.views.desc()])
              .distinctOn('title'),
          )
          .all();
        expectPerRelationStatements(runtime, strategy, 2);

        expect(rows).toEqual([
          {
            name: 'Alice',
            posts: [
              { title: 'A', views: 9 },
              { title: 'B', views: 1 },
            ],
          },
          { name: 'Bob', posts: [{ title: 'A', views: 2 }] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'pages the rows distinctOn() kept, in the order the caller gave',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seedAuthorsAndPosts(runtime);
        const users = createUsersCollection(runtime, strategy);
        const firstAndRest = (page: 'first' | 'rest') =>
          users
            .select('name')
            .orderBy((user) => user.id.asc())
            .include('posts', (posts) => {
              const kept = posts
                .select('title', 'views')
                .orderBy([(post) => post.title.asc(), (post) => post.views.desc()])
                .distinctOn('title');
              return page === 'first' ? kept.limit(1) : kept.offset(1);
            })
            .all();

        expect({ first: await firstAndRest('first'), rest: await firstAndRest('rest') }).toEqual({
          first: [
            { name: 'Alice', posts: [{ title: 'A', views: 9 }] },
            { name: 'Bob', posts: [{ title: 'A', views: 2 }] },
          ],
          rest: [
            { name: 'Alice', posts: [{ title: 'B', views: 1 }] },
            { name: 'Bob', posts: [] },
          ],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'aggregates the rows distinctOn() kept, in the order the caller gave',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seedAuthorsAndPosts(runtime);
        const users = createUsersCollection(runtime, strategy);
        const sumOfKept = (paged: boolean) =>
          users
            .select('name')
            .orderBy((user) => user.id.asc())
            .include('posts', (posts) => {
              const kept = posts
                .orderBy([(post) => post.title.asc(), (post) => post.views.desc()])
                .distinctOn('title');
              return (paged ? kept.limit(1) : kept).sum('views');
            })
            .all();

        expect({ all: await sumOfKept(false), paged: await sumOfKept(true) }).toEqual({
          all: [
            { name: 'Alice', posts: 10 },
            { name: 'Bob', posts: 2 },
          ],
          paged: [
            { name: 'Alice', posts: 9 },
            { name: 'Bob', posts: 2 },
          ],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
