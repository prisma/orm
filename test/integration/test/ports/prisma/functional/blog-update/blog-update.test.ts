import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/blog-update
// (postgres matrix entry).
//
// Test dispositions:
//   "should create a user and update that field on that user"  → ported
//   "should create a user and post and connect them together"  → ported
//   "should create a user and post and disconnect them"        → ported
//   "should create a user with posts and a profile and update itself and
//    nested connections setting fields to null"                → non-ported
//      Reason: the update uses `profile: { update: {...} }` and
//      `posts: { updateMany: {...} }` nested patterns. The prisma-next ORM
//      `update()` supports `connect`/`disconnect`/`create` nested relation
//      mutations but does not expose nested `update` or `updateMany` on
//      relations — there is no matching public API surface.

function withBlogUpdate(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/blog-update', () => {
  it(
    'should create a user and update that field on that user',
    () =>
      withBlogUpdate(async ({ db }) => {
        const email = 'alice@example.com';
        const name = 'Alice';
        const newEmail = 'alice2@example.com';

        await db.public.User.create({ email, name });

        const user = await db.public.User.first({ email });
        expect(user).not.toBeNull();

        const response = await db.public.User.select('email')
          .where({ id: user!.id })
          .update({ email: newEmail });

        expect(response).not.toBeNull();
        expect(response!.email).toEqual(newEmail);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'should create a user and post and connect them together',
    () =>
      withBlogUpdate(async ({ db }) => {
        const email = 'bob@example.com';
        const name = 'Bob';
        const title = 'hello-world';
        const published = true;

        const user = await db.public.User.select('id', 'email', 'name').create({ email, name });

        const post = await db.public.Post.select('id', 'title', 'published').create({
          title,
          published,
        });

        const response = await db.public.User.select('id', 'name', 'email')
          .include('posts', (posts) => posts.select('id', 'title', 'published'))
          .where({ id: user.id })
          .update({ posts: (p) => p.connect([{ id: post.id }]) });

        expect(response).not.toBeNull();
        expect(response).toMatchObject({
          id: user.id,
          name: user.name,
          email: user.email,
          posts: [{ id: post.id, title: post.title, published: post.published }],
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'should create a user and post and disconnect them',
    () =>
      withBlogUpdate(async ({ db }) => {
        const email = 'carol@example.com';
        const name = 'Carol';
        const title = 'goodbye-world';
        const published = true;

        const user = await db.public.User.select('id', 'email', 'name').create({
          email,
          name,
          posts: (p) => p.create([{ title, published }]),
        });

        const userWithPosts = await db.public.User.select('id', 'email', 'name')
          .include('posts', (posts) => posts.select('id', 'title', 'published'))
          .first({ id: user.id });

        expect(userWithPosts).not.toBeNull();
        expect(userWithPosts!.posts).toHaveLength(1);

        const postId = userWithPosts!.posts[0]!.id;

        const response = await db.public.User.select('id', 'name', 'email')
          .include('posts', (posts) => posts.select('id', 'title', 'published'))
          .where({ id: user.id })
          .update({ posts: (p) => p.disconnect([{ id: postId }]) });

        expect(response).not.toBeNull();
        expect(response!.posts).toEqual([]);
      }),
    timeouts.spinUpPpgDev,
  );
});
