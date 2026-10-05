import { describe, expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import type { CollectionRowOf } from '../src/collection-types';
import { createChainingOrm } from './collection-chaining-fixture';
import type { Contract as PolyContract } from './fixtures/polymorphism/generated/contract';
import type { TestContract } from './helpers';

const { db, plain } = createChainingOrm();

const summary = db.Post.scope((posts) => posts.select('id', 'title').include('author'));
type PostSummary = CollectionRowOf<ReturnType<typeof summary>>;

const inline = plain.Post.select('id', 'title').include('author');

declare const posts: Collection<TestContract, 'Post'>;

class SummaryPostCollection extends Collection<TestContract, 'Post'> {
  summaries() {
    return this.apply(summary);
  }

  publishedSummaries() {
    return this.where((p) => p.views.gte(100)).apply(summary);
  }
}

declare const tasks: Collection<PolyContract, 'Task'>;
const taskTitles = tasks.scope((t) => t.select('id', 'title'));

describe('collection.scope', () => {
  test('names the row of the body', () => {
    expectTypeOf<PostSummary>().not.toBeAny();
    expectTypeOf<PostSummary>().toEqualTypeOf<CollectionRowOf<typeof inline>>();
    expectTypeOf<keyof PostSummary>().toEqualTypeOf<'id' | 'title' | 'author'>();
  });

  test('types the body against the plain collection of the model, also on a custom class', () => {
    plain.Post.scope((p) => expectTypeOf(p).toEqualTypeOf<Collection<TestContract, 'Post'>>());
    db.Post.scope((p) => expectTypeOf(p).toEqualTypeOf<Collection<TestContract, 'Post'>>());
    // @ts-expect-error published is a method of PostCollection, not of the plain Post collection
    db.Post.scope((p) => p.published());
  });

  test('returns the body result for a collection of the model', () => {
    expectTypeOf(plain.Post.apply(summary)).toEqualTypeOf<ReturnType<typeof summary>>();
    expectTypeOf(db.Post.apply(summary)).toEqualTypeOf<ReturnType<typeof summary>>();
    expectTypeOf(posts.apply(summary)).toEqualTypeOf<ReturnType<typeof summary>>();
  });

  test('accepts a filtered, ordered or included collection', () => {
    expectTypeOf(db.Post.where({ title: 'x' }).apply(summary)).toEqualTypeOf<
      ReturnType<typeof summary>
    >();
    expectTypeOf(
      db.Post.orderBy((p) => p.id.asc())
        .limit(5)
        .apply(summary),
    ).toEqualTypeOf<ReturnType<typeof summary>>();
    expectTypeOf(db.Post.include('comments').published().apply(summary)).toEqualTypeOf<
      ReturnType<typeof summary>
    >();
  });

  test('accepts an include refinement', async () => {
    const users = db.User.include('posts', (userPosts) => userPosts.apply(summary));
    const user = await users.first();
    expectTypeOf(user!.posts).toEqualTypeOf<PostSummary[]>();
    db.User.include('posts', (userPosts) => userPosts.where({ title: 'x' }).apply(summary));
  });

  test('accepts this in a custom class', () => {
    expectTypeOf<ReturnType<SummaryPostCollection['summaries']>>().toEqualTypeOf<
      ReturnType<typeof summary>
    >();
    expectTypeOf<ReturnType<SummaryPostCollection['publishedSummaries']>>().toEqualTypeOf<
      ReturnType<typeof summary>
    >();
  });

  test('the result has the default state when the body changes the row', () => {
    // @ts-expect-error update needs a where; the scope does not record the earlier one
    db.Post.where({ title: 'x' }).apply(summary).update({ title: 'y' });
    // @ts-expect-error cursor needs an orderBy; the scope does not record the earlier one
    db.Post.orderBy((p) => p.id.asc())
      .apply(summary)
      .cursor({ id: 1 });
  });

  test('refuses a collection of another model', () => {
    // @ts-expect-error a User collection is not a Post collection
    db.User.apply(summary);
  });

  test('refuses a collection whose rows were narrowed by select', () => {
    // @ts-expect-error the rows no longer have every Post field
    db.Post.select('id').apply(summary);
    // @ts-expect-error the rows no longer have every Post field
    db.User.include('posts', (userPosts) => userPosts.select('id').apply(summary));
  });

  test('refuses a collection narrowed to a variant', () => {
    expectTypeOf(tasks.apply(taskTitles)).toEqualTypeOf<ReturnType<typeof taskTitles>>();
    // @ts-expect-error the collection is narrowed to the Bug variant
    tasks.variant('Bug').apply(taskTitles);
  });
});
