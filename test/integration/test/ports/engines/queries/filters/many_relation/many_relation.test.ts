import { and } from '@internal/sql-orm-client';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract as Contract25103 } from './_fixture/25103/generated/contract';
import contract25103Json from './_fixture/25103/generated/contract.json' with { type: 'json' };
import type { Contract as L2ToOneContract } from './_fixture/l2-to-one/generated/contract';
import l2ToOneContractJson from './_fixture/l2-to-one/generated/contract.json' with {
  type: 'json',
};

describe('ports/engines/queries/filters/many_relation', () => {
  it(
    'l2_m_1_rel_all',
    () =>
      withPostgresPort<L2ToOneContract>({ contractJson: l2ToOneContractJson }, async ({ db }) => {
        await db.public.Blog.createAll([
          { id: 1, name: 'blog1' },
          { id: 2, name: 'blog2' },
          { id: 3, name: 'blog3' },
          { id: 4, name: 'blog4' },
        ]);
        await db.public.Post.createAll([
          { id: 1, blog_id: 1 },
          { id: 2, blog_id: 1 },
          { id: 3, blog_id: 1 },
          { id: 4, blog_id: 2 },
          { id: 5, blog_id: 2 },
          { id: 6, blog_id: 3 },
          { id: 7, blog_id: 3 },
        ]);
        await db.public.Comment.createAll([
          { id: 1, popularity: 10, postId: 1 },
          { id: 2, popularity: 50, postId: 2 },
          { id: 3, popularity: 100, postId: 3 },
          { id: 4, popularity: 1000, postId: 4 },
          { id: 5, popularity: 1000, postId: 5 },
        ]);
        const query = db.public.Blog.orderBy((blog) => blog.name.asc()).select('name');
        expect(
          await query
            .where((b) => b.posts.some((p) => p.comment.some((c) => c.popularity.lt(1000))))
            .all(),
        ).toEqual([{ name: 'blog1' }]);
        expect(
          await query
            .where((b) => b.posts.some((p) => p.comment.none((c) => c.popularity.gt(100))))
            .all(),
        ).toEqual([{ name: 'blog1' }, { name: 'blog3' }]);
        expect(
          await query
            .where((b) => b.posts.none((p) => p.comment.some((c) => c.popularity.lt(1000))))
            .all(),
        ).toEqual([{ name: 'blog2' }, { name: 'blog3' }, { name: 'blog4' }]);
        expect(
          await query
            .where((b) => b.posts.none((p) => p.comment.none((c) => c.popularity.gt(100))))
            .all(),
        ).toEqual([{ name: 'blog2' }, { name: 'blog4' }]);
        expect(
          await query
            .where((b) => b.posts.every((p) => p.comment.some((c) => c.popularity.gte(1000))))
            .all(),
        ).toEqual([{ name: 'blog2' }, { name: 'blog4' }]);
        expect(
          await query
            .where((b) => b.posts.every((p) => p.comment.none((c) => c.popularity.gte(1000))))
            .all(),
        ).toEqual([{ name: 'blog1' }, { name: 'blog3' }, { name: 'blog4' }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'prisma_25103',
    () =>
      withPostgresPort<Contract25103>({ contractJson: contract25103Json }, async ({ db }) => {
        await db.public.Audience.createAll([
          { id: 'audience1', deletedAt: null },
          { id: 'audience2', deletedAt: null },
        ]);
        const created = await db.public.Contact.select('id')
          .include('identities', (identities) =>
            identities
              .orderBy((identity) => identity.id.asc())
              .select('id')
              .include('subscriptions', (subscriptions) =>
                subscriptions
                  .orderBy((subscription) => subscription.id.asc())
                  .select('id', 'audienceId'),
              ),
          )
          .create({
            id: 'contact1',
            identities: (identities) =>
              identities.create([
                {
                  id: 'identity1',
                  subscriptions: (subscriptions) =>
                    subscriptions.create([
                      {
                        id: 'subscription1',
                        audienceId: 'audience1',
                        optedOutAt: null,
                      },
                      {
                        id: 'subscription2',
                        audienceId: 'audience2',
                        optedOutAt: null,
                      },
                    ]),
                },
              ]),
          });
        expect(created).toEqual({
          id: 'contact1',
          identities: [
            {
              id: 'identity1',
              subscriptions: [
                { id: 'subscription1', audienceId: 'audience1' },
                { id: 'subscription2', audienceId: 'audience2' },
              ],
            },
          ],
        });

        const result = await db.public.Contact.orderBy((c) => c.id.asc())
          .select('id')
          .include('identities', (identities) =>
            identities
              .orderBy((i) => i.id.asc())
              .select('id')
              .include('subscriptions', (subscriptions) =>
                subscriptions
                  .where((s) =>
                    and(
                      s.optedOutAt.isNull(),
                      s.audience.some((a) => a.deletedAt.isNull()),
                    ),
                  )
                  .orderBy((s) => s.id.asc())
                  .select('id', 'identityId')
                  .include('audience', (audience) => audience.select('id', 'deletedAt')),
              ),
          )
          .all();
        expect(result).toEqual([
          {
            id: 'contact1',
            identities: [
              {
                id: 'identity1',
                subscriptions: [
                  {
                    id: 'subscription1',
                    identityId: 'identity1',
                    audience: { id: 'audience1', deletedAt: null },
                  },
                  {
                    id: 'subscription2',
                    identityId: 'identity1',
                    audience: { id: 'audience2', deletedAt: null },
                  },
                ],
              },
            ],
          },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );
});
