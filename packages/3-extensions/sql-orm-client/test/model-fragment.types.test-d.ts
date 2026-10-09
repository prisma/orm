import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import type { CollectionRowOf, Filtered } from '../src/collection-types';
import { createChainingOrm } from './collection-chaining-fixture';
import type { Contract as PolyContract } from './fixtures/polymorphism/generated/contract';
import type { TestContract } from './helpers';

const { db, plain } = createChainingOrm();

const summary = db.Post.fragment((posts) => posts.select('id', 'title').include('author'));
type PostSummary = CollectionRowOf<ReturnType<typeof summary>>;

const inline = plain.Post.select('id', 'title').include('author');

declare const posts: Collection<TestContract, 'Post'>;

class SummaryPostCollection extends Collection<TestContract, 'Post'> {
  summaries() {
    return this.with(summary);
  }

  publishedSummaries() {
    return this.where((p) => p.views.gte(100)).with(summary);
  }
}

declare const tasks: Collection<PolyContract, 'Task'>;
declare const vehicles: Collection<Contract<SqlStorage>, 'Vehicle', Record<string, unknown>>;
const taskTitles = tasks.fragment((t) => t.select('id', 'title'));

describe('collection.fragment', () => {
  test('names the row of the body', () => {
    expectTypeOf<PostSummary>().not.toBeAny();
    expectTypeOf<PostSummary>().toEqualTypeOf<CollectionRowOf<typeof inline>>();
    expectTypeOf<keyof PostSummary>().toEqualTypeOf<'id' | 'title' | 'author'>();
  });

  test('types the body against the plain collection of the model, also on a custom class', () => {
    plain.Post.fragment((p) => expectTypeOf(p).toEqualTypeOf(plain.Post));
    db.Post.fragment((p) => expectTypeOf(p).toEqualTypeOf<Collection<TestContract, 'Post'>>());
    // @ts-expect-error published is a method of PostCollection, not of the plain Post collection
    db.Post.fragment((p) => p.published());
  });

  test('returns the body result for a collection of the model', () => {
    expectTypeOf(plain.Post.with(summary)).toEqualTypeOf<ReturnType<typeof summary>>();
    expectTypeOf(db.Post.with(summary)).toEqualTypeOf<ReturnType<typeof summary>>();
    expectTypeOf(posts.with(summary)).toEqualTypeOf<ReturnType<typeof summary>>();
  });

  test('accepts a filtered, ordered or included collection', () => {
    expectTypeOf(db.Post.where({ title: 'x' }).with(summary)).toEqualTypeOf<
      ReturnType<typeof summary>
    >();
    expectTypeOf(
      db.Post.orderBy((p) => p.id.asc())
        .limit(5)
        .with(summary),
    ).toEqualTypeOf<ReturnType<typeof summary>>();
    expectTypeOf(db.Post.include('comments').published().with(summary)).toEqualTypeOf<
      ReturnType<typeof summary>
    >();
  });

  test('accepts an include refinement', async () => {
    const users = db.User.include('posts', (userPosts) => userPosts.with(summary));
    const user = await users.first();
    expectTypeOf(user!.posts).toEqualTypeOf<PostSummary[]>();
    db.User.include('posts', (userPosts) => userPosts.where({ title: 'x' }).with(summary));
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
    // @ts-expect-error update needs a where; the fragment does not record the earlier one
    db.Post.where({ title: 'x' }).with(summary).update({ title: 'y' });
    // @ts-expect-error cursor needs an orderBy; the fragment does not record the earlier one
    db.Post.orderBy((p) => p.id.asc())
      .with(summary)
      .cursor({ id: 1 });
  });

  test('refuses a collection of another model', () => {
    // @ts-expect-error a User collection is not a Post collection
    db.User.with(summary);
  });

  test('refuses a collection whose rows were narrowed by select', () => {
    // @ts-expect-error the rows no longer have every Post field
    db.Post.select('id').with(summary);
    // @ts-expect-error the rows no longer have every Post field
    db.User.include('posts', (userPosts) => userPosts.select('id').with(summary));
  });

  test('refuses a collection narrowed to a variant', () => {
    expectTypeOf(tasks.with(taskTitles)).toEqualTypeOf<ReturnType<typeof taskTitles>>();
    // @ts-expect-error the collection is narrowed to the Bug variant
    tasks.variant('bug').with(taskTitles);
  });

  test('does not make a collection of one model unassignable to a collection of any model', () => {
    const takesAnyModel = (collection: Collection<Contract<SqlStorage>, string>) => collection;
    takesAnyModel(vehicles);
  });

  test('types its result against the plain collection, also when the body keeps the row', () => {
    const published = db.Post.fragment((posts) => posts.where((p) => p.views.gte(100)));
    expectTypeOf(db.Post.with(published)).toEqualTypeOf<
      Filtered<Collection<TestContract, 'Post'>>
    >();
    // @ts-expect-error the class's own methods are not carried through a fragment for one model
    db.Post.with(published).published();
  });

  test('is defined from a root collection, a custom class or a concrete Collection type', () => {
    expectTypeOf(plain.Post.fragment((p) => p)).toBeFunction();
    expectTypeOf(db.Post.fragment((p) => p)).toBeFunction();
    expectTypeOf(posts.fragment((p) => p)).toBeFunction();
    expectTypeOf(vehicles.fragment((v) => v)).toBeFunction();
  });

  test('compiles for a type that does not record the chain, which the run-time check refuses', () => {
    const maybeFiltered = Math.random() > 0.5 ? db.Post.where({ title: 'x' }) : db.Post;
    expectTypeOf(maybeFiltered.fragment((p) => p)).toBeFunction();
    const limited: Collection<TestContract, 'Post'> = db.Post.limit(1);
    expectTypeOf(limited.fragment((p) => p)).toBeFunction();
    expectTypeOf(db.Post.limit(1).fragment((p) => p)).toBeFunction();
  });

  test('refuses a collection with a filter, an order or an include', () => {
    // @ts-expect-error the fragment is built from the model alone; the where would be ignored
    db.Post.where({ title: 'x' }).fragment((p) => p);
    // @ts-expect-error the fragment is built from the model alone; the where would be ignored
    db.Post.published().fragment((p) => p);
    // @ts-expect-error the fragment is built from the model alone; the orderBy would be ignored
    db.Post.orderBy((p) => p.id.asc()).fragment((p) => p);
    // @ts-expect-error the fragment is built from the model alone; the include would be ignored
    db.Post.include('author').fragment((p) => p);
  });

  test('refuses this in a custom class, which may carry a filter or an order', () => {
    class TitlePostCollection extends Collection<TestContract, 'Post'> {
      titles() {
        // @ts-expect-error this may be a chained collection, whose calls the fragment would ignore
        return this.fragment((p) => p.select('id', 'title'));
      }
    }
    expectTypeOf<TitlePostCollection>().toHaveProperty('titles');
  });

  test('refuses a collection typed by a type parameter, which may carry a filter or an order', () => {
    function titles<C extends Collection<TestContract, 'Post'>>(collection: C) {
      // @ts-expect-error C may be a chained collection, whose calls the fragment would ignore
      return collection.fragment((p) => p.select('id', 'title'));
    }
    expectTypeOf(titles).toBeFunction();
  });
});
