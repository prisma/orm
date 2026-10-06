import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import { describe, expectTypeOf, test } from 'vitest';
import type { CollectionRowOf, Filtered } from '../src/collection-types';
import { createChainingOrm, type PostCollection } from './collection-chaining-fixture';

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

describe('the row a write returns', () => {
  type Row = CollectionRowOf<PostCollection>;
  type PostRow = {
    id: number;
    title: string;
    userId: number;
    embedding: number[] | null;
    views: number;
  };

  test('ReturnType of a write that needs a filter is the row', () => {
    expectTypeOf<Row>().toEqualTypeOf<PostRow>();
    expectTypeOf<Awaited<ReturnType<PostCollection['update']>>>().toEqualTypeOf<Row | null>();
    expectTypeOf<Awaited<ReturnType<PostCollection['delete']>>>().toEqualTypeOf<Row | null>();
    expectTypeOf<ReturnType<PostCollection['updateAll']>>().toEqualTypeOf<
      AsyncIterableResult<Row>
    >();
    expectTypeOf<ReturnType<PostCollection['deleteAll']>>().toEqualTypeOf<
      AsyncIterableResult<Row>
    >();
  });

  test('ReturnType of a write on a filtered collection is the row', () => {
    const posts = Post.published();
    expectTypeOf<Awaited<ReturnType<typeof posts.update>>>().toEqualTypeOf<Row | null>();
    expectTypeOf<Awaited<ReturnType<typeof posts.delete>>>().toEqualTypeOf<Row | null>();
    expectTypeOf<ReturnType<typeof posts.updateAll>>().toEqualTypeOf<AsyncIterableResult<Row>>();
    expectTypeOf<ReturnType<typeof posts.deleteAll>>().toEqualTypeOf<AsyncIterableResult<Row>>();
  });

  test('ReturnType of a write that needs no filter is the row', () => {
    expectTypeOf<Awaited<ReturnType<PostCollection['create']>>>().toEqualTypeOf<Row>();
    expectTypeOf<Awaited<ReturnType<PostCollection['upsert']>>>().toEqualTypeOf<Row>();
    expectTypeOf<ReturnType<PostCollection['createAll']>>().toEqualTypeOf<
      AsyncIterableResult<Row>
    >();
  });

  test('ReturnType of a write that counts is a number', () => {
    expectTypeOf<Awaited<ReturnType<PostCollection['updateAndCount']>>>().toEqualTypeOf<number>();
    expectTypeOf<Awaited<ReturnType<PostCollection['deleteAndCount']>>>().toEqualTypeOf<number>();
  });

  test('after include, a write returns the included relation', async () => {
    const posts = Post.published().include('author');
    type AuthorRow = CollectionRowOf<typeof posts>;
    expectTypeOf<keyof AuthorRow>().toEqualTypeOf<keyof PostRow | 'author'>();
    expectTypeOf(await posts.update({ title: 'x' })).toEqualTypeOf<AuthorRow | null>();
    expectTypeOf(await posts.delete()).toEqualTypeOf<AuthorRow | null>();
    expectTypeOf(await posts.updateAll({ title: 'x' }).toArray()).toEqualTypeOf<AuthorRow[]>();
    expectTypeOf(await posts.deleteAll().toArray()).toEqualTypeOf<AuthorRow[]>();
    expectTypeOf(
      await posts.create({ id: 1, title: 'x', userId: 1, views: 0 }),
    ).toEqualTypeOf<AuthorRow>();
    expectTypeOf(
      await posts.createAll([{ id: 1, title: 'x', userId: 1, views: 0 }]).toArray(),
    ).toEqualTypeOf<AuthorRow[]>();
    expectTypeOf(
      await posts.upsert({ create: { id: 1, title: 'x', userId: 1, views: 0 }, update: {} }),
    ).toEqualTypeOf<AuthorRow>();
  });

  test('after include, ReturnType of a write includes the relation', () => {
    const posts = Post.published().include('author');
    type AuthorRow = CollectionRowOf<typeof posts>;
    expectTypeOf<Awaited<ReturnType<typeof posts.update>>>().toEqualTypeOf<AuthorRow | null>();
    expectTypeOf<Awaited<ReturnType<typeof posts.delete>>>().toEqualTypeOf<AuthorRow | null>();
    expectTypeOf<ReturnType<typeof posts.updateAll>>().toEqualTypeOf<
      AsyncIterableResult<AuthorRow>
    >();
    expectTypeOf<ReturnType<typeof posts.deleteAll>>().toEqualTypeOf<
      AsyncIterableResult<AuthorRow>
    >();
  });

  test('after select, a write returns the selected fields', async () => {
    const posts = Post.published().select('id');
    expectTypeOf(await posts.update({ title: 'x' })).toEqualTypeOf<{ id: number } | null>();
    expectTypeOf(await posts.deleteAll().toArray()).toEqualTypeOf<{ id: number }[]>();
  });

  test('after include and select, a write returns the selected fields and the relation', async () => {
    const posts = Post.published().include('author').select('id');
    type Selected = CollectionRowOf<typeof posts>;
    expectTypeOf<keyof Selected>().toEqualTypeOf<'id' | 'author'>();
    expectTypeOf(await posts.update({ title: 'x' })).toEqualTypeOf<Selected | null>();
    expectTypeOf(await posts.deleteAll().toArray()).toEqualTypeOf<Selected[]>();
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

describe('an Omit of a collection type keeps its methods', () => {
  type PostWithoutPublished = Omit<PostCollection, 'published'>;
  type FilteredPostWithoutPublished = Omit<Filtered<PostCollection>, 'published'>;
  type Row = CollectionRowOf<PostCollection>;

  test('writes after where', async () => {
    const posts = {} as PostWithoutPublished;
    expectTypeOf(await posts.where({ id: 1 }).deleteAll().toArray()).toEqualTypeOf<Row[]>();
    expectTypeOf(await posts.where({ id: 1 }).updateAll({ title: 'x' }).toArray()).toEqualTypeOf<
      Row[]
    >();
    expectTypeOf(await posts.where({ id: 1 }).update({ title: 'x' })).toEqualTypeOf<Row | null>();
    expectTypeOf(await posts.where({ id: 1 }).delete()).toEqualTypeOf<Row | null>();
  });

  test('writes on an Omit of a filtered collection', async () => {
    const posts = {} as FilteredPostWithoutPublished;
    expectTypeOf(await posts.deleteAll().toArray()).toEqualTypeOf<Row[]>();
    expectTypeOf(await posts.updateAll({ title: 'x' }).toArray()).toEqualTypeOf<Row[]>();
  });

  test('reads', async () => {
    const posts = {} as PostWithoutPublished;
    expectTypeOf(await posts.all().toArray()).toEqualTypeOf<Row[]>();
    expectTypeOf(await posts.first()).toEqualTypeOf<Row | null>();
  });

  test('writes stay refused without a filter', () => {
    const posts = {} as PostWithoutPublished;
    // @ts-expect-error deleteAll needs a where
    posts.deleteAll();
    // @ts-expect-error updateAll needs a where
    posts.updateAll({ title: 'x' });
  });
});
