import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155
// packages/client/tests/functional/issues/29010-bigint-precision-relation-joins
// (postgres matrix entry; mysql/cockroachdb/postgres — we port postgres).
//
// Subject: BigInt ids that exceed Number.MAX_SAFE_INTEGER keep precision when
// returned via relation-join (include) queries. Upstream pins
// `relationLoadStrategy: 'join'`; prisma-next has no strategy selector, and
// `.include()` is its relation-join read, so the subject ports onto `.include()`.
//
// prisma-next pg/int8@1 carries `bigint` application values, so the upstream
// BigInt ids and their assertions port across directly. Both tests were
// `it.fails` while int8 read back through the include path as an imprecise
// float64; lossless JSON projection (#29844) closed that gap.
//
// Dispositions:
//   'preserves BigInt precision in relationJoins queries'        → PORTED (passing)
//   'preserves BigInt precision in nested relationJoins queries' → PORTED (passing)

// BigInt IDs that exceed Number.MAX_SAFE_INTEGER (2^53 - 1 = 9007199254740991).
const USER_ID = BigInt('312590077454712834');
const POST_ID = BigInt('412590077454712834');

function withBigIntRelationJoins(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.User.create({ id: USER_ID, name: 'Alice' });
    await ctx.db.public.Post.create({ id: POST_ID, title: 'Hello World', authorId: USER_ID });
    await fn(ctx);
  });
}

describe('ports/prisma/functional/issues-29010-bigint-precision-relation-joins', () => {
  it(
    'preserves BigInt precision in relationJoins queries',
    () =>
      withBigIntRelationJoins(async ({ db }) => {
        const user = await db.public.User.where({ id: USER_ID }).include('posts').first();

        expect(user).not.toBeNull();
        expect(user!.id).toBe(USER_ID);
        expect(user!.posts).toHaveLength(1);
        expect(user!.posts[0]!['id']).toBe(POST_ID);
        expect(user!.posts[0]!['authorId']).toBe(USER_ID);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'preserves BigInt precision in nested relationJoins queries',
    () =>
      withBigIntRelationJoins(async ({ db }) => {
        const post = await db.public.Post.where({ id: POST_ID })
          .include('author', (author) => author.include('posts'))
          .first();

        expect(post).not.toBeNull();
        expect(post!.id).toBe(POST_ID);
        expect(post!.authorId).toBe(USER_ID);
        expect(post!.author['id']).toBe(USER_ID);
        expect(post!.author.posts).toHaveLength(1);
        expect(post!.author.posts[0]!['id']).toBe(POST_ID);
      }),
    timeouts.spinUpPpgDev,
  );
});
