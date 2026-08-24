import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract as CompoundContract } from './_fixture/compound/generated/contract';
import compoundContractJson from './_fixture/compound/generated/contract.json' with {
  type: 'json',
};
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };
import type { Contract as NestedContract } from './_fixture/nested/generated/contract';
import nestedContractJson from './_fixture/nested/generated/contract.json' with { type: 'json' };
import type { Contract as SelfContract } from './_fixture/self/generated/contract';
import selfContractJson from './_fixture/self/generated/contract.json' with { type: 'json' };

function withManyCountRelation(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

function withCompoundCountRelation(fn: Parameters<typeof withPostgresPort<CompoundContract>>[1]) {
  return withPostgresPort<CompoundContract>({ contractJson: compoundContractJson }, fn);
}

function withNestedCountRelation(fn: Parameters<typeof withPostgresPort<NestedContract>>[1]) {
  return withPostgresPort<NestedContract>({ contractJson: nestedContractJson }, fn);
}

function withSelfCountRelation(fn: Parameters<typeof withPostgresPort<SelfContract>>[1]) {
  return withPostgresPort<SelfContract>({ contractJson: selfContractJson }, fn);
}

type PortDb = Parameters<Parameters<typeof withPostgresPort<Contract>>[1]>[0]['db'];

async function seedPostRelations(db: PortDb) {
  await db.public.Post.createAll([
    { id: 1, title: 'a' },
    { id: 2, title: 'b' },
  ]);
  await db.public.Comment.createAll([
    { id: 1, postId: 1 },
    { id: 2, postId: 2 },
    { id: 3, postId: 2 },
    { id: 4, postId: 2 },
  ]);
  await db.public.Category.createAll([
    { id: 1 },
    { id: 2 },
    { id: 3 },
    { id: 4 },
    { id: 5 },
    { id: 6 },
  ]);
  await db.public.PostCategory.createAll([
    { postId: 1, categoryId: 1 },
    { postId: 1, categoryId: 2 },
    { postId: 2, categoryId: 3 },
    { postId: 2, categoryId: 4 },
    { postId: 2, categoryId: 5 },
    { postId: 2, categoryId: 6 },
  ]);
}

async function seedFourRelations(db: PortDb) {
  await db.public.Post.create({ id: 1, title: 'a' });
  await db.public.Comment.createAll([
    { id: 1, postId: 1 },
    { id: 2, postId: 1 },
    { id: 3, postId: 1 },
    { id: 4, postId: 1 },
  ]);
  await db.public.Category.createAll([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
  await db.public.PostCategory.createAll([
    { postId: 1, categoryId: 1 },
    { postId: 1, categoryId: 2 },
    { postId: 1, categoryId: 3 },
    { postId: 1, categoryId: 4 },
  ]);
}

describe('ports/engines/queries/aggregation/many_count_relation', () => {
  it(
    'no_rel_records',
    () =>
      withManyCountRelation(async ({ db }) => {
        await db.public.Post.create({ id: 1, title: 'a' });

        const result = await db.public.Post.select('id')
          .include('comments', (comments) => comments.count())
          .include('categories', (categories) => categories.count())
          .all();

        expect(result).toEqual([{ id: 1, comments: 0, categories: 0 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'count_one2m_m2m',
    () =>
      withManyCountRelation(async ({ db }) => {
        await seedPostRelations(db);

        const result = await db.public.Post.select('id')
          .include('comments', (comments) => comments.count())
          .include('categories', (categories) => categories.count())
          .orderBy((post) => post.id.asc())
          .all();

        expect(result).toEqual([
          { id: 1, comments: 1, categories: 2 },
          { id: 2, comments: 3, categories: 4 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'count_with_cursor',
    () =>
      withManyCountRelation(async ({ db }) => {
        await seedFourRelations(db);

        const result = await db.public.Post.where({ id: 1 })
          .select('id')
          .include('comments', (comments) =>
            comments.combine({
              rows: comments
                .select('id')
                .cursor({ id: 1 } as never)
                .limit(1),
              count: comments.count(),
            }),
          )
          .include('categories', (categories) =>
            categories.combine({
              rows: categories
                .select('id')
                .cursor({ id: 1 } as never)
                .limit(1),
              count: categories.count(),
            }),
          )
          .all();

        expect(result).toEqual([
          {
            id: 1,
            comments: { rows: [{ id: 1 }], count: 4 },
            categories: { rows: [{ id: 1 }], count: 4 },
          },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'count_with_take',
    () =>
      withManyCountRelation(async ({ db }) => {
        await seedFourRelations(db);

        // The pinned upstream count_with_take row subqueries are unordered; preserve that query.
        const result = await db.public.Post.where({ id: 1 })
          .select('id')
          .include('comments', (comments) =>
            comments.combine({ rows: comments.select('id').limit(1), count: comments.count() }),
          )
          .include('categories', (categories) =>
            categories.combine({
              rows: categories.select('id').limit(1),
              count: categories.count(),
            }),
          )
          .all();

        expect(result).toEqual([
          {
            id: 1,
            comments: { rows: [{ id: 1 }], count: 4 },
            categories: { rows: [{ id: 1 }], count: 4 },
          },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'count_with_skip',
    () =>
      withManyCountRelation(async ({ db }) => {
        await seedFourRelations(db);

        // The pinned upstream count_with_skip row subqueries are unordered; preserve that query.
        const result = await db.public.Post.where({ id: 1 })
          .select('id')
          .include('comments', (comments) =>
            comments.combine({ rows: comments.select('id').offset(3), count: comments.count() }),
          )
          .include('categories', (categories) =>
            categories.combine({
              rows: categories.select('id').offset(3),
              count: categories.count(),
            }),
          )
          .all();

        expect(result).toEqual([
          {
            id: 1,
            comments: { rows: [{ id: 4 }], count: 4 },
            categories: { rows: [{ id: 4 }], count: 4 },
          },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'count_with_filters',
    () =>
      withManyCountRelation(async ({ db }) => {
        await seedFourRelations(db);

        const result = await db.public.Post.where({ id: 1 })
          .select('id')
          .include('comments', (comments) =>
            comments.combine({
              rows: comments.select('id').where({ id: 2 }),
              count: comments.count(),
            }),
          )
          .include('categories', (categories) =>
            categories.combine({
              rows: categories.select('id').where({ id: 2 }),
              count: categories.count(),
            }),
          )
          .all();

        expect(result).toEqual([
          {
            id: 1,
            comments: { rows: [{ id: 2 }], count: 4 },
            categories: { rows: [{ id: 2 }], count: 4 },
          },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'count_with_distinct',
    () =>
      withManyCountRelation(async ({ db }) => {
        await db.public.Post.createAll([
          { id: 1, title: 'a' },
          { id: 2, title: 'a' },
        ]);
        await db.public.Category.create({ id: 1 });
        await db.public.PostCategory.createAll([
          { postId: 1, categoryId: 1 },
          { postId: 2, categoryId: 1 },
        ]);

        // The pinned upstream count_with_distinct row subquery is unordered; preserve that query.
        const result = await db.public.Category.select('id')
          .include('posts', (posts) =>
            posts.combine({
              rows: posts.select('id').distinct('title'),
              count: posts.count(),
            }),
          )
          .all();

        expect(result).toEqual([{ id: 1, posts: { rows: [{ id: 1 }], count: 2 } }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'nested_count_one2m_m2m',
    () =>
      withNestedCountRelation(async ({ db }) => {
        await db.public.User.create({ id: 1, name: 'Bob' });
        await db.public.Post.create({ id: 1, title: 'Wooow!', userId: 1 });
        await db.public.Comment.create({ id: 1, body: 'Amazing', postId: 1 });
        await db.public.Tag.createAll([
          { id: 1, name: 'LALA' },
          { id: 2, name: 'LOLO' },
          { id: 3, name: 'A' },
          { id: 4, name: 'B' },
          { id: 5, name: 'C' },
        ]);
        await db.public.CommentTag.createAll([
          { commentId: 1, tagId: 1 },
          { commentId: 1, tagId: 2 },
        ]);
        await db.public.PostTag.createAll([
          { postId: 1, tagId: 3 },
          { postId: 1, tagId: 4 },
          { postId: 1, tagId: 5 },
        ]);

        const result = await db.public.User.select('name')
          .include('posts', (posts) =>
            posts.combine({
              rows: posts
                .select('title')
                .include('comments', (comments) =>
                  comments.combine({
                    rows: comments.select('body').include('tags', (tags) =>
                      tags.combine({
                        rows: tags.select('name').orderBy((tag) => tag.id.asc()),
                        count: tags.count(),
                      }),
                    ),
                    count: comments.count(),
                  }),
                )
                .include('tags', (tags) =>
                  tags.combine({
                    rows: tags.select('name').orderBy((tag) => tag.id.asc()),
                    count: tags.count(),
                  }),
                ),
              count: posts.count(),
            }),
          )
          .all();

        expect(result).toEqual([
          {
            name: 'Bob',
            posts: {
              rows: [
                {
                  title: 'Wooow!',
                  comments: {
                    rows: [
                      {
                        body: 'Amazing',
                        tags: {
                          rows: [{ name: 'LALA' }, { name: 'LOLO' }],
                          count: 2,
                        },
                      },
                    ],
                    count: 1,
                  },
                  tags: {
                    rows: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
                    count: 3,
                  },
                },
              ],
              count: 1,
            },
          },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'nested_count_same_field_on_many_levels',
    () =>
      withNestedCountRelation(async ({ db }) => {
        await db.public.User.create({ id: 1, name: 'Author' });
        await db.public.Post.createAll([
          { id: 1, title: 'good post', userId: 1 },
          { id: 2, title: 'boring post', userId: 1 },
        ]);
        await db.public.Comment.createAll([
          { id: 1, body: 'insightful!', postId: 1 },
          { id: 2, body: 'deep lore uncovered', postId: 1 },
        ]);

        const base = db.public.Post.select('id').orderBy((post) => post.id.asc());
        const countOnly = await base
          .include('comments', (comments) =>
            comments.combine({
              rows: comments
                .select('id')
                .include('post', (post) =>
                  post.select('id').include('comments', (nestedComments) => nestedComments.count()),
                ),
              count: comments.count(),
            }),
          )
          .all();
        expect(countOnly).toEqual([
          {
            id: 1,
            comments: {
              rows: [
                { id: 1, post: { id: 1, comments: 2 } },
                { id: 2, post: { id: 1, comments: 2 } },
              ],
              count: 2,
            },
          },
          { id: 2, comments: { rows: [], count: 0 } },
        ]);

        const nestedRows = await base
          .include('comments', (comments) =>
            comments.combine({
              rows: comments.select('id').include('post', (post) =>
                post.select('id').include('comments', (nestedComments) =>
                  nestedComments.combine({
                    rows: nestedComments.select('id').orderBy((comment) => comment.id.asc()),
                    count: nestedComments.count(),
                  }),
                ),
              ),
              count: comments.count(),
            }),
          )
          .all();
        expect(nestedRows).toEqual([
          {
            id: 1,
            comments: {
              rows: [
                {
                  id: 1,
                  post: { id: 1, comments: { rows: [{ id: 1 }, { id: 2 }], count: 2 } },
                },
                {
                  id: 2,
                  post: { id: 1, comments: { rows: [{ id: 1 }, { id: 2 }], count: 2 } },
                },
              ],
              count: 2,
            },
          },
          { id: 2, comments: { rows: [], count: 0 } },
        ]);

        const filteredNestedRows = await base
          .include('comments', (comments) =>
            comments.combine({
              rows: comments.select('id').include('post', (post) =>
                post.select('id').include('comments', (nestedComments) =>
                  nestedComments.combine({
                    rows: nestedComments.select('id').where({ id: 1 }),
                    count: nestedComments.count(),
                  }),
                ),
              ),
              count: comments.count(),
            }),
          )
          .all();
        expect(filteredNestedRows).toEqual([
          {
            id: 1,
            comments: {
              rows: [
                { id: 1, post: { id: 1, comments: { rows: [{ id: 1 }], count: 2 } } },
                { id: 2, post: { id: 1, comments: { rows: [{ id: 1 }], count: 2 } } },
              ],
              count: 2,
            },
          },
          { id: 2, comments: { rows: [], count: 0 } },
        ]);

        const filteredOuterRows = await base
          .include('comments', (comments) =>
            comments.combine({
              rows: comments
                .where({ id: 1 })
                .select('id')
                .include('post', (post) =>
                  post.select('id').include('comments', (nestedComments) =>
                    nestedComments.combine({
                      rows: nestedComments.select('id').orderBy((comment) => comment.id.asc()),
                      count: nestedComments.count(),
                    }),
                  ),
                ),
              count: comments.count(),
            }),
          )
          .all();
        expect(filteredOuterRows).toEqual([
          {
            id: 1,
            comments: {
              rows: [
                {
                  id: 1,
                  post: { id: 1, comments: { rows: [{ id: 1 }, { id: 2 }], count: 2 } },
                },
              ],
              count: 2,
            },
          },
          { id: 2, comments: { rows: [], count: 0 } },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'count_m_n_self_rel',
    () =>
      withSelfCountRelation(async ({ db }) => {
        await db.public.User.createAll([
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Justin' },
        ]);
        await db.public.UserFollow.createAll([
          { followerId: 2, followeeId: 1 },
          { followerId: 1, followeeId: 3 },
        ]);

        const result = await db.public.User.select('name')
          .include('following', (following) =>
            following.combine({
              rows: following.select('name'),
              count: following.count(),
            }),
          )
          .include('followers', (followers) =>
            followers.combine({
              rows: followers.select('name'),
              count: followers.count(),
            }),
          )
          .orderBy((user) => user.name.asc())
          .all();
        expect(result).toEqual([
          {
            name: 'Alice',
            following: { rows: [{ name: 'Justin' }], count: 1 },
            followers: { rows: [{ name: 'Bob' }], count: 1 },
          },
          {
            name: 'Bob',
            following: { rows: [{ name: 'Alice' }], count: 1 },
            followers: { rows: [], count: 0 },
          },
          {
            name: 'Justin',
            following: { rows: [], count: 0 },
            followers: { rows: [{ name: 'Alice' }], count: 1 },
          },
        ]);

        const alice = await db.public.User.where({ id: 1 })
          .select('name')
          .include('following', (following) =>
            following.combine({ rows: following.select('name'), count: following.count() }),
          )
          .include('followers', (followers) =>
            followers.combine({ rows: followers.select('name'), count: followers.count() }),
          )
          .first();
        expect(alice).toEqual({
          name: 'Alice',
          following: { rows: [{ name: 'Justin' }], count: 1 },
          followers: { rows: [{ name: 'Bob' }], count: 1 },
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'count_one2m_compound_ids',
    () =>
      withCompoundCountRelation(async ({ db }) => {
        await db.public.User.createAll([{ id: 1 }, { id: 2 }, { id: 3 }]);
        await db.public.Objective.create({ id: 1, name: 'Objective 1' });
        await db.public.UserToObjective.create({ userId: 1, objectiveId: 1 });
        await db.public.Vote.createAll([
          { userId: 2, objectiveId: 1, followerId: 1 },
          { userId: 3, objectiveId: 1, followerId: 1 },
        ]);

        const result = await db.public.UserToObjective.select('userId', 'objectiveId')
          .include('votes', (votes) => votes.count())
          .all();
        expect(result).toEqual([{ userId: 1, objectiveId: 1, votes: 2 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'count_one2m_dup_child_id',
    () =>
      withManyCountRelation(async ({ db }) => {
        await db.public.Post.create({ id: 1, title: 'hello' });
        await db.public.Comment.createAll([
          { id: 1, postId: 1 },
          { id: 2, postId: 1 },
        ]);

        const result = await db.public.Comment.select('id')
          .include('post', (post) =>
            post.select('id').include('comments', (comments) => comments.count()),
          )
          .orderBy((comment) => comment.id.asc())
          .all();

        expect(result).toEqual([
          { id: 1, post: { id: 1, comments: 2 } },
          { id: 2, post: { id: 1, comments: 2 } },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'regression_nullable_count_libsql',
    () =>
      withManyCountRelation(async ({ db }) => {
        await db.public.Post.createAll([
          { id: 1, title: 'Without comments' },
          { id: 2, title: 'With comments' },
        ]);
        await db.public.Comment.create({ id: 1, postId: 2 });

        const result = await db.public.Post.select('id')
          .include('comments', (comments) => comments.count())
          .orderBy((post) => post.id.asc())
          .all();

        expect(result).toEqual([
          { id: 1, comments: 0 },
          { id: 2, comments: 1 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );
});
