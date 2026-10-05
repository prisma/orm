import { describe, expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import type { CollectionRowOf } from '../src/collection-types';
import { modelStep } from '../src/query-fragments';
import type { CollectionModelName } from '../src/types';
import { createChainingOrm } from './collection-chaining-fixture';
import type { Contract as PolyContract } from './fixtures/polymorphism/generated/contract';
import type { TestContract } from './helpers';

const { db, plain } = createChainingOrm();

const summary = modelStep<TestContract, 'Post'>()((posts) =>
  posts.select('id', 'title').include('author'),
);
type PostSummary = CollectionRowOf<ReturnType<typeof summary>>;

declare const posts: Collection<TestContract, 'Post'>;
const inline = posts.select('id', 'title').include('author');

class SummaryPostCollection extends Collection<TestContract, 'Post'> {
  summaries() {
    return this.apply(summary);
  }

  publishedSummaries() {
    return this.where((p) => p.views.gte(100)).apply(summary);
  }
}

declare const tasks: Collection<PolyContract, 'Task'>;
const taskTitles = modelStep<PolyContract, 'Task'>()((t) => t.select('id', 'title'));

describe('modelStep', () => {
  test('names the row of the body', () => {
    expectTypeOf<PostSummary>().not.toBeAny();
    expectTypeOf<PostSummary>().toEqualTypeOf<CollectionRowOf<typeof inline>>();
    expectTypeOf<keyof PostSummary>().toEqualTypeOf<'id' | 'title' | 'author'>();
  });

  test('returns the body result for a collection of the model', () => {
    expectTypeOf(plain.Post.apply(summary)).toEqualTypeOf<ReturnType<typeof summary>>();
    expectTypeOf(db.Post.apply(summary)).toEqualTypeOf<ReturnType<typeof summary>>();
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

  test('the result has the default state', () => {
    // @ts-expect-error update needs a where; the step does not record the earlier one
    db.Post.where({ title: 'x' }).apply(summary).update({ title: 'y' });
    // @ts-expect-error cursor needs an orderBy; the step does not record the earlier one
    db.Post.orderBy((p) => p.id.asc())
      .apply(summary)
      .cursor({ id: 1 });
  });

  test('takes one model name of the contract', () => {
    // @ts-expect-error Pots is not a model of the contract
    modelStep<TestContract, 'Pots'>();
    // @ts-expect-error a step is defined for one model, not a union of models
    modelStep<TestContract, 'Post' | 'Article'>();
  });

  test('does not take a generic model name', () => {
    function stepFor<M extends CollectionModelName<TestContract>>() {
      // @ts-expect-error TypeScript cannot tell whether a type parameter is one name or a union
      return modelStep<TestContract, M>();
    }
    expectTypeOf(stepFor).toBeFunction();
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
