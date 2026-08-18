import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/23902
// (allProviders; postgres matrix entry). Repro of #4004.
//
// Subject: creating a user with `posts: { connect: { id: post.id } }` on a simple
// one-to-many relation (with @@index on the FK column) does not throw.
// The upstream test verifies both the post shape and the user shape.

function withIssue23902(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/issues-23902', () => {
  it(
    'should not throw error when creating user with connected post via optional FK relation with @@index',
    () =>
      withIssue23902(async ({ db }) => {
        const post = await db.public.Post.create({
          title: 'Hello World',
        });

        expect(post).toMatchObject({
          authorId: null,
          content: null,
          createdAt: expect.any(Temporal.Instant),
          id: expect.any(String),
          published: false,
          title: 'Hello World',
          updatedAt: expect.any(Temporal.Instant),
          viewCount: 0,
        });

        const user = await db.public.User.create({
          email: 'test@example.com',
          name: 'Test',
          posts: (p) => p.connect([{ id: post.id }]),
        });

        expect(user).toMatchObject({
          email: 'test@example.com',
          id: expect.any(String),
          name: 'Test',
        });
      }),
    timeouts.spinUpPpgDev,
  );
});
