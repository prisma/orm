import { Collection, orm } from '@internal/sql-orm-client';
import { describe, expect, it } from 'vitest';
import { getTestContext, includeStrategies, type TestContract } from './helpers';
import { timeouts, withCollectionRuntime } from './integration-helpers';
import { seedComments, seedPosts, seedUsers } from './runtime-helpers';

class PostCollection extends Collection<TestContract, 'Post'> {
  published() {
    return this.where((post) => post.views.gte(200));
  }
}

class CommentCollection extends Collection<TestContract, 'Comment'> {
  approved() {
    return this.where((comment) => comment.body.eq('approved'));
  }
}

function expectPostCollection(value: unknown): asserts value is PostCollection {
  expect(value).toBeInstanceOf(PostCollection);
}

function expectCommentCollection(value: unknown): asserts value is CommentCollection {
  expect(value).toBeInstanceOf(CommentCollection);
}

describe.each(includeStrategies)('integration/orm (%s)', (strategy) => {
  it(
    'uses registered collection methods inside include() refinements',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const db = orm({
          runtime,
          context: getTestContext(strategy),
          collections: { Post: PostCollection },
        });

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Draft', userId: 1, views: 50 },
          { id: 11, title: 'Published A', userId: 1, views: 250 },
          { id: 12, title: 'Published B', userId: 2, views: 300 },
        ]);

        const rows = await db.public.User.orderBy((user) => user.id.asc())
          .include('posts', (posts) => {
            expectPostCollection(posts);
            return posts.published().orderBy((post) => post.id.asc());
          })
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            posts: [{ id: 11, title: 'Published A', userId: 1, views: 250, embedding: null }],
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: null,
            address: null,
            posts: [{ id: 12, title: 'Published B', userId: 2, views: 300, embedding: null }],
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'propagates registered collection classes through nested include() refinements',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const db = orm({
          runtime,
          context: getTestContext(strategy),
          collections: { Post: PostCollection, Comment: CommentCollection },
        });

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Draft', userId: 1, views: 50 },
          { id: 11, title: 'Published A', userId: 1, views: 250 },
          { id: 12, title: 'Published B', userId: 2, views: 300 },
        ]);
        await seedComments(runtime, [
          { id: 100, body: 'approved', postId: 11 },
          { id: 101, body: 'pending', postId: 11 },
          { id: 102, body: 'approved', postId: 12 },
        ]);

        const rows = await db.public.User.orderBy((user) => user.id.asc())
          .include('posts', (posts) => {
            expectPostCollection(posts);
            return posts
              .published()
              .orderBy((post) => post.id.asc())
              .include('comments', (comments) => {
                expectCommentCollection(comments);
                return comments.approved().orderBy((comment) => comment.id.asc());
              });
          })
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            posts: [
              {
                id: 11,
                title: 'Published A',
                userId: 1,
                views: 250,
                embedding: null,
                comments: [{ id: 100, body: 'approved', postId: 11 }],
              },
            ],
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: null,
            address: null,
            posts: [
              {
                id: 12,
                title: 'Published B',
                userId: 2,
                views: 300,
                embedding: null,
                comments: [{ id: 102, body: 'approved', postId: 12 }],
              },
            ],
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
