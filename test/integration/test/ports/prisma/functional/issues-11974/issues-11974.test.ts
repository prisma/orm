import { and } from '@internal/sql-orm-client';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/11974
// (postgres matrix entry only; optOut excludes MongoDB — implicit M2M not
// supported there).
//
// Upstream uses implicit many-to-many with two named relations ("upVotes",
// "downVotes") between Comment and User. Prisma-next PSL requires explicit
// junction models; we author UpVote and DownVote with composite @@id on the
// FK pair, which produces the same N:M relation with a `through` descriptor.
//
// Upstream test 1: findMany with _count: { select: { upVotedUsers, downVotedUsers } }
//   → include('upVotedUsers', rel => rel.count())
//     .include('downVotedUsers', rel => rel.count())
//   Assertion: [{ id: '1', upVotedUsers: 1, downVotedUsers: 1 }] (counts decode as number)
//
// Upstream test 2: aggregate with where: { AND: [downVotedUsers.every, upVotedUsers.every] }, _count: true
//   → where((c) => and(c.downVotedUsers.every(...), c.upVotedUsers.every(...)))
//     .aggregate((agg) => ({ _count: agg.count() }))
//   Assertion: { _count: 1 }

function withIssue11974(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/issues-11974', () => {
  it(
    'should not throw an error when counting two relation fields using find',
    () =>
      withIssue11974(async ({ db }) => {
        await db.public.Comment.create({ id: '1' });
        await db.public.User.create({ uid: '2' });
        await db.public.User.create({ uid: '3' });
        await db.public.DownVote.create({ commentId: '1', userId: '2' });
        await db.public.UpVote.create({ commentId: '1', userId: '3' });

        const response = await db.public.Comment.include('upVotedUsers', (rel) => rel.count())
          .include('downVotedUsers', (rel) => rel.count())
          .select('id')
          .all();

        expect(response).toMatchObject([{ id: '1', upVotedUsers: 1, downVotedUsers: 1 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'should not throw an error when aggregating two relation fields using aggregate',
    () =>
      withIssue11974(async ({ db }) => {
        await db.public.Comment.create({ id: '1' });
        await db.public.User.create({ uid: '2' });
        await db.public.User.create({ uid: '3' });
        await db.public.DownVote.create({ commentId: '1', userId: '2' });
        await db.public.UpVote.create({ commentId: '1', userId: '3' });

        const response = await db.public.Comment.where((c) =>
          and(
            c.downVotedUsers.every((u) => u.uid.eq('2')),
            c.upVotedUsers.every((u) => u.uid.eq('3')),
          ),
        ).aggregate((agg) => ({ _count: agg.count() }));

        expect(response).toMatchObject({ _count: 1 });
      }),
    timeouts.spinUpPpgDev,
  );
});
