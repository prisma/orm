import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract as BaseContract } from './_fixture/base/generated/contract';
import baseContractJson from './_fixture/base/generated/contract.json' with { type: 'json' };
import type { Contract as NestedContract } from './_fixture/nested/generated/contract';
import nestedContractJson from './_fixture/nested/generated/contract.json' with { type: 'json' };

type BaseContext = Parameters<Parameters<typeof withPostgresPort<BaseContract>>[1]>[0];

async function seedPost(
  { db }: BaseContext,
  input: { id: number; title: string; commentIds: number[]; categoryIds: number[] },
) {
  await db.public.Post.create({ id: input.id, title: input.title });
  for (const id of input.commentIds) {
    await db.public.Comment.create({ id, postId: input.id });
  }
  for (const id of input.categoryIds) {
    await db.public.Category.create({ id });
    await db.public.PostCategory.create({ postId: input.id, categoryId: id });
  }
}

describe('ports/engines/queries/aggregation/uniq-count-relation', () => {
  it(
    'returns zero for empty relations',
    () =>
      withPostgresPort<BaseContract>({ contractJson: baseContractJson }, async (ctx) => {
        await seedPost(ctx, { id: 1, title: 'a', commentIds: [], categoryIds: [] });

        const post = await ctx.db.public.Post.select('id')
          .include('comments', (comments) => comments.count())
          .include('categories', (categories) => categories.count())
          .first({ id: 1 });

        expect(post).toEqual({ id: 1, comments: 0, categories: 0 });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'counts one-to-many and many-to-many relations',
    () =>
      withPostgresPort<BaseContract>({ contractJson: baseContractJson }, async (ctx) => {
        await seedPost(ctx, { id: 1, title: 'a', commentIds: [1], categoryIds: [1, 2] });
        await seedPost(ctx, {
          id: 2,
          title: 'b',
          commentIds: [2, 3, 4],
          categoryIds: [3, 4, 5, 6],
        });

        const post = await ctx.db.public.Post.select('id')
          .include('comments', (comments) => comments.count())
          .include('categories', (categories) => categories.count())
          .first({ id: 1 });

        expect(post).toEqual({ id: 1, comments: 1, categories: 2 });
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'relation counts remain unpaginated when nested rows use a cursor',
    () =>
      withPostgresPort<BaseContract>({ contractJson: baseContractJson }, async (ctx) => {
        await seedPost(ctx, {
          id: 1,
          title: 'a',
          commentIds: [1, 2, 3, 4],
          categoryIds: [1, 2, 3, 4],
        });

        const post = await ctx.db.public.Post.select('id')
          .include('comments', (comments) =>
            comments.combine({
              rows: comments
                .select('id')
                .orderBy((comment) => comment.id.asc())
                .cursor({ id: 1 })
                .limit(1),
              total: comments.count(),
            }),
          )
          .include('categories', (categories) =>
            categories.combine({
              rows: categories
                .select('id')
                .orderBy((category) => category.id.asc())
                .cursor({ id: 1 })
                .limit(1),
              total: categories.count(),
            }),
          )
          .first({ id: 1 });

        expect(post).toEqual({
          id: 1,
          comments: { rows: [{ id: 1 }], total: 4 },
          categories: { rows: [{ id: 1 }], total: 4 },
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'relation counts remain unpaginated when nested rows use limit',
    () =>
      withPostgresPort<BaseContract>({ contractJson: baseContractJson }, async (ctx) => {
        await seedPost(ctx, {
          id: 1,
          title: 'a',
          commentIds: [1, 2, 3, 4],
          categoryIds: [1, 2, 3, 4],
        });

        const post = await ctx.db.public.Post.select('id')
          .include('comments', (comments) =>
            comments.combine({
              rows: comments
                .select('id')
                .orderBy((comment) => comment.id.asc())
                .limit(1),
              total: comments.count(),
            }),
          )
          .include('categories', (categories) =>
            categories.combine({
              rows: categories
                .select('id')
                .orderBy((category) => category.id.asc())
                .limit(1),
              total: categories.count(),
            }),
          )
          .first({ id: 1 });

        expect(post).toEqual({
          id: 1,
          comments: { rows: [{ id: 1 }], total: 4 },
          categories: { rows: [{ id: 1 }], total: 4 },
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'relation counts remain unpaginated when nested rows use offset',
    () =>
      withPostgresPort<BaseContract>({ contractJson: baseContractJson }, async (ctx) => {
        await seedPost(ctx, {
          id: 1,
          title: 'a',
          commentIds: [1, 2, 3, 4],
          categoryIds: [1, 2, 3, 4],
        });

        const post = await ctx.db.public.Post.select('id')
          .include('comments', (comments) =>
            comments.combine({
              rows: comments
                .select('id')
                .orderBy((comment) => comment.id.asc())
                .offset(2),
              total: comments.count(),
            }),
          )
          .include('categories', (categories) =>
            categories.combine({
              rows: categories
                .select('id')
                .orderBy((category) => category.id.asc())
                .offset(2),
              total: categories.count(),
            }),
          )
          .first({ id: 1 });

        expect(post).toEqual({
          id: 1,
          comments: { rows: [{ id: 3 }, { id: 4 }], total: 4 },
          categories: { rows: [{ id: 3 }, { id: 4 }], total: 4 },
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'relation counts remain unfiltered when nested rows use where',
    () =>
      withPostgresPort<BaseContract>({ contractJson: baseContractJson }, async (ctx) => {
        await seedPost(ctx, {
          id: 1,
          title: 'a',
          commentIds: [1, 2, 3, 4],
          categoryIds: [1, 2, 3, 4],
        });

        const post = await ctx.db.public.Post.select('id')
          .include('comments', (comments) =>
            comments.combine({
              rows: comments.select('id').where({ id: 2 }),
              total: comments.count(),
            }),
          )
          .include('categories', (categories) =>
            categories.combine({
              rows: categories.select('id').where({ id: 2 }),
              total: categories.count(),
            }),
          )
          .first({ id: 1 });

        expect(post).toEqual({
          id: 1,
          comments: { rows: [{ id: 2 }], total: 4 },
          categories: { rows: [{ id: 2 }], total: 4 },
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'relation counts remain undeduplicated when nested rows use distinct',
    () =>
      withPostgresPort<BaseContract>({ contractJson: baseContractJson }, async ({ db }) => {
        await db.public.Category.create({ id: 1 });
        await db.public.Post.create({ id: 1, title: 'a' });
        await db.public.Post.create({ id: 2, title: 'a' });
        await db.public.PostCategory.create({ postId: 1, categoryId: 1 });
        await db.public.PostCategory.create({ postId: 2, categoryId: 1 });

        const category = await db.public.Category.select('id')
          .include('posts', (posts) =>
            posts.combine({
              rows: posts
                .select('id')
                .orderBy([(post) => post.title.asc(), (post) => post.id.asc()])
                .distinctOn('title'),
              total: posts.count(),
            }),
          )
          .first({ id: 1 });

        expect(category).toEqual({ id: 1, posts: { rows: [{ id: 1 }], total: 2 } });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'counts nested one-to-many and many-to-many relations',
    () =>
      withPostgresPort<NestedContract>({ contractJson: nestedContractJson }, async ({ db }) => {
        await db.public.User.create({ id: 1, name: 'Bob' });
        await db.public.Post.create({ id: 1, title: 'Wooow!', userId: 1 });
        await db.public.Comment.create({ id: 1, body: 'Amazing', postId: 1 });
        await db.public.Tag.create({ id: 1, name: 'LALA' });
        await db.public.Tag.create({ id: 2, name: 'LOLO' });
        await db.public.Tag.create({ id: 3, name: 'A' });
        await db.public.Tag.create({ id: 4, name: 'B' });
        await db.public.Tag.create({ id: 5, name: 'C' });
        await db.public.CommentTag.create({ commentId: 1, tagId: 1 });
        await db.public.CommentTag.create({ commentId: 1, tagId: 2 });
        await db.public.PostTag.create({ postId: 1, tagId: 3 });
        await db.public.PostTag.create({ postId: 1, tagId: 4 });
        await db.public.PostTag.create({ postId: 1, tagId: 5 });

        const user = await db.public.User.select('name')
          .include('posts', (posts) =>
            posts.combine({
              rows: posts
                .select('title')
                .orderBy((post) => post.id.asc())
                .include('comments', (comments) =>
                  comments.combine({
                    rows: comments
                      .select('body')
                      .orderBy((comment) => comment.id.asc())
                      .include('tags', (tags) =>
                        tags.combine({
                          rows: tags.select('name').orderBy((tag) => tag.id.asc()),
                          total: tags.count(),
                        }),
                      ),
                    total: comments.count(),
                  }),
                )
                .include('tags', (tags) =>
                  tags.combine({
                    rows: tags.select('name').orderBy((tag) => tag.id.asc()),
                    total: tags.count(),
                  }),
                ),
              total: posts.count(),
            }),
          )
          .first({ id: 1 });

        expect(user).toEqual({
          name: 'Bob',
          posts: {
            rows: [
              {
                title: 'Wooow!',
                comments: {
                  rows: [
                    {
                      body: 'Amazing',
                      tags: { rows: [{ name: 'LALA' }, { name: 'LOLO' }], total: 2 },
                    },
                  ],
                  total: 1,
                },
                tags: { rows: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], total: 3 },
              },
            ],
            total: 1,
          },
        });
      }),
    timeouts.spinUpPpgDev,
  );
});
