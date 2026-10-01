import { describe, expectTypeOf, test } from 'vitest';
import { createChainingOrm } from './collection-chaining-fixture';

declare const search: string | undefined;

const { db, plain } = createChainingOrm();
const Post = db.Post;

describe('writes need a filter', () => {
  test('refused on the class root', () => {
    // @ts-expect-error update needs a where
    Post.update({ title: 'x' });
    // @ts-expect-error updateAll needs a where
    Post.updateAll({ title: 'x' });
    // @ts-expect-error updateAndCount needs a where
    Post.updateAndCount({ title: 'x' });
    // @ts-expect-error delete needs a where
    Post.delete();
    // @ts-expect-error deleteAll needs a where
    Post.deleteAll();
    // @ts-expect-error deleteAndCount needs a where
    Post.deleteAndCount();
  });

  test('refused after a class method that only orders', () => {
    // @ts-expect-error update needs a where
    Post.recent().update({ title: 'x' });
    // @ts-expect-error deleteAll needs a where
    Post.recent().limit(1).deleteAll();
  });

  test('allowed after a class method that filters', () => {
    const posts = Post.published();
    expectTypeOf(posts.update({ title: 'x' })).not.toBeAny();
    expectTypeOf(posts.updateAll({ title: 'x' })).not.toBeAny();
    expectTypeOf(posts.updateAndCount({ title: 'x' })).not.toBeAny();
    expectTypeOf(posts.delete()).not.toBeAny();
    expectTypeOf(posts.deleteAll()).not.toBeAny();
    expectTypeOf(posts.deleteAndCount()).not.toBeAny();
  });

  test('allowed after a filter followed by limit, include or select', () => {
    expectTypeOf(Post.published().limit(1).delete()).not.toBeAny();
    expectTypeOf(Post.published().include('author').deleteAll()).not.toBeAny();
    expectTypeOf(Post.published().select('id').update({ title: 'x' })).not.toBeAny();
  });

  test('the plain collection keeps its guards', () => {
    // @ts-expect-error update needs a where
    plain.Post.update({ title: 'x' });
    // @ts-expect-error delete needs a where
    plain.Post.delete();
    expectTypeOf(plain.Post.where((p) => p.id.eq(1)).update({ title: 'x' })).not.toBeAny();
    expectTypeOf(plain.Post.where((p) => p.id.eq(1)).delete()).not.toBeAny();
    expectTypeOf(plain.Post.where((p) => p.id.eq(1)).prepared).not.toBeAny();
  });
});

describe('the select fallback overload', () => {
  test('on a union of differently flagged collections, refuses writes', () => {
    const posts = search ? Post.published() : Post.recent();
    // @ts-expect-error the fallback overload returns the root state, which has no filter
    posts.select('id').update({ title: 'x' });
  });

  test('on a union, drops included relations from the row type', async () => {
    const posts = search ? Post.published().include('author') : Post.recent().include('author');
    expectTypeOf(await posts.select('id').first()).toEqualTypeOf<{ id: number } | null>();
  });
});

describe('cursor needs an order', () => {
  test('refused until an order is set', () => {
    // @ts-expect-error cursor needs an orderBy
    Post.cursor({ id: 1 });
    // @ts-expect-error cursor needs an orderBy
    Post.published().cursor({ id: 1 });
    // @ts-expect-error cursor needs an orderBy
    plain.Post.cursor({ id: 1 });
  });

  test('allowed after an order', () => {
    expectTypeOf(Post.recent().cursor({ id: 1 })).not.toBeAny();
    expectTypeOf(
      Post.orderBy((p) => p.id.asc())
        .cursor({ id: 1 })
        .published(),
    ).not.toBeAny();
    expectTypeOf(plain.Post.orderBy((p) => p.id.asc()).cursor({ id: 1 })).not.toBeAny();
  });
});

describe('TML-3397: a ternary between a filtered and an unfiltered collection refuses deleteAll', () => {
  test('filtered branch first', () => {
    const posts = search ? plain.Post.where((p) => p.title.eq(search)) : plain.Post;
    // @ts-expect-error the collection may have no filter
    posts.deleteAll();
  });

  test('unfiltered branch first', () => {
    const posts = search ? plain.Post : plain.Post.where((p) => p.title.eq('x'));
    // @ts-expect-error the collection may have no filter
    posts.deleteAll();
  });

  test('on a custom class', () => {
    const posts = search ? Post.published() : Post;
    // @ts-expect-error the collection may have no filter
    posts.deleteAll();
  });
});
