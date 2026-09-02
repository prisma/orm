import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/methods/createMany
// (postgres matrix entry).
//
// Upstream tests nested `posts.createMany(...)` inside a `user.create(...)`.
// prisma-next's nested-mutation API uses `posts => posts.create([...])`.
// The count check uses createAndCount() for the bulk-create test.

describe('ports/prisma/functional/methods-createMany', () => {
  it(
    'creates many records',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const count = await db.public.User.createAndCount([
          { email: 'user1@example.com' },
          { email: 'user2@example.com' },
          { email: 'user3@example.com' },
          { email: 'user4@example.com' },
        ]);
        expect(count).toEqual(4);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'should create a single record with a single nested create',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const email = 'user-nested-single@example.com';
        const name = 'Alice';
        const title = 'My First Post';

        const res = await db.public.User.include('posts').create({
          email,
          name,
          posts: (posts) => posts.create([{ title }]),
        });

        expect(res.email).toEqual(email);
        expect(res.name).toEqual(name);
        expect(res.posts.length).toEqual(1);
        expect(res.posts[0]?.['title']).toEqual(title);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'should create a single record with many nested creates',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const email = 'user-nested-many@example.com';
        const name = 'Bob';
        const titles = ['Post 1', 'Post 2', 'Post 3', 'Post 4'];

        const res = await db.public.User.include('posts').create({
          email,
          name,
          posts: (posts) => posts.create(titles.map((title) => ({ title }))),
        });

        expect(res.email).toEqual(email);
        expect(res.name).toEqual(name);
        expect(res.posts.length).toEqual(4);

        for (const title of titles) {
          const post = res.posts.find((p) => p['title'] === title);
          expect(post).toBeTruthy();
        }
      }),
    timeouts.spinUpPpgDev,
  );
});
