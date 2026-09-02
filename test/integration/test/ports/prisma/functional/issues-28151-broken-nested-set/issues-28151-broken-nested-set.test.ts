import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/28151-broken-nested-set
// (allProviders; postgres matrix entry).
//
// Subject: nested `set` on a 1:N relation in an `update` replaces the relation's
// current membership — all three specified post ids end up linked to the user.
//
// prisma-next's RelationMutator (update context) exposes `create`, `connect`, and
// `disconnect` but does NOT have a `set` method. The faithful call
// `posts: (p) => p.set([...])` is a type error; at runtime `p.set` is undefined
// and the mutation throws. Marked it.fails.

function withIssue28151(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/issues-28151-broken-nested-set', () => {
  it.fails(
    'nested set should result in all expected linked rows',
    () =>
      withIssue28151(async ({ db }) => {
        const post1Id = 'post-1-aaaaaa';
        const post2Id = 'post-2-bbbbbb';
        const post3Id = 'post-3-cccccc';

        const user = await db.public.User.create({
          posts: (p) => p.create([{ id: post1Id }, { id: post2Id }]),
        });

        await db.public.Post.create({ id: post3Id });

        // set() is not part of prisma-next's RelationMutator — type error + runtime failure.
        await db.public.User.where({ id: user.id }).update({
          posts: (p) =>
            // @ts-expect-error — set() is absent from RelationMutator in prisma-next
            p.set([{ id: post1Id }, { id: post2Id }, { id: post3Id }]),
        });

        const userWithPosts = await db.public.User.include('posts', (p) => p.select('id'))
          .select('id')
          .first({ id: user.id });

        expect(userWithPosts?.posts).toEqual(
          expect.arrayContaining([{ id: post1Id }, { id: post2Id }, { id: post3Id }]),
        );
      }),
    timeouts.spinUpPpgDev,
  );
});
