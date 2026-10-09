import { describe, expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import type {
  CollectionRowOf,
  CollectionTypeStateOf,
  Filtered,
  Ordered,
  QueryFragment,
} from '../src/collection-types';
import { createChainingOrm, type PostCollection } from './collection-chaining-fixture';
import type { TestContract } from './helpers';

const { db, plain } = createChainingOrm();
const Post = db.Post;

const plainWithAuthor = plain.Post.include('author');
type AuthorRow = CollectionRowOf<typeof plainWithAuthor>;
const plainWithAuthorComments = plainWithAuthor.include('comments');
type AuthorCommentsRow = CollectionRowOf<typeof plainWithAuthorComments>;

type PostRow = {
  id: number;
  title: string;
  userId: number;
  embedding: number[] | null;
  views: number;
};

describe('class methods keep the class', () => {
  test('after a class method', () => {
    const posts = Post.published().recent();
    expectTypeOf(posts).not.toBeAny();
    expectTypeOf(posts).toEqualTypeOf<Filtered<Ordered<PostCollection>>>();
  });

  test('after where', () => {
    expectTypeOf(Post.where((p) => p.views.gt(1)).published()).toEqualTypeOf<
      Filtered<PostCollection>
    >();
  });

  test('after orderBy', () => {
    expectTypeOf(Post.orderBy((p) => p.id.asc()).published()).toEqualTypeOf<
      Filtered<Ordered<PostCollection>>
    >();
  });

  test('after limit, offset and distinct', () => {
    const posts = Post.limit(10).offset(1).distinct('title').published();
    expectTypeOf(posts).toEqualTypeOf<Filtered<PostCollection>>();
  });

  test('after include, with the widened row', async () => {
    const posts = Post.include('author').published();
    expectTypeOf(posts).toExtend<PostCollection>();
    expectTypeOf(await posts.first()).toEqualTypeOf<AuthorRow | null>();
    expectTypeOf(await posts.firstOrThrow()).toEqualTypeOf<AuthorRow>();
    expectTypeOf(await posts.all()).toEqualTypeOf<AuthorRow[]>();
    expectTypeOf<keyof AuthorRow>().toEqualTypeOf<keyof PostRow | 'author'>();
  });

  test('after cursor and distinctOn', () => {
    expectTypeOf(Post.recent().cursor({ id: 1 }).distinctOn('title').published()).toEqualTypeOf<
      Filtered<Ordered<PostCollection>>
    >();
  });

  test('inside with', () => {
    expectTypeOf(Post.with((posts) => posts.published()).recent()).toEqualTypeOf<
      Filtered<Ordered<PostCollection>>
    >();
  });

  test('a repeated fact does not grow the type', () => {
    const posts = Post.published().recent().limit(10).published();
    expectTypeOf(posts.recent().published()).toEqualTypeOf(posts);
  });

  test('firstOrThrow returns the row of first without null for a registered class', async () => {
    const posts = Post.published().recent();
    expectTypeOf(await posts.firstOrThrow()).toEqualTypeOf<PostRow>();
    expectTypeOf(await posts.firstOrThrow((p) => p.id.eq(1))).toEqualTypeOf<
      NonNullable<Awaited<ReturnType<typeof posts.first>>>
    >();
    expectTypeOf(await posts.firstOrThrow(undefined, () => {})).toEqualTypeOf<PostRow>();
    // @ts-expect-error firstOrThrow rejects unknown fields
    posts.firstOrThrow({ missing: 1 });
  });
});

describe('include', () => {
  test('chained includes widen the row twice and keep the class', async () => {
    const posts = Post.include('author').published().include('comments');
    expectTypeOf(posts).toExtend<Filtered<PostCollection>>();
    expectTypeOf(await posts.first()).toEqualTypeOf<AuthorCommentsRow | null>();
    expectTypeOf(await posts.firstOrThrow({ id: 1 })).toEqualTypeOf<AuthorCommentsRow>();
    expectTypeOf<keyof AuthorCommentsRow>().toEqualTypeOf<keyof PostRow | 'author' | 'comments'>();
  });

  test('after where, keeps the fact and returns the widened row from writes', async () => {
    const posts = Post.published().include('author');
    expectTypeOf(posts).toExtend<Filtered<PostCollection>>();
    expectTypeOf(await posts.update({ title: 'x' })).toEqualTypeOf<AuthorRow | null>();
    expectTypeOf(await posts.delete()).toEqualTypeOf<AuthorRow | null>();
  });

  test('inside a refinement, include then orderBy keeps the nested row', async () => {
    const users = db.User.include('posts', (posts) =>
      posts.include('comments').orderBy((p) => p.id.asc()),
    );
    const user = await users.first();
    expectTypeOf<keyof NonNullable<typeof user>['posts'][number]>().toEqualTypeOf<
      keyof PostRow | 'comments'
    >();
  });

  test('the refinement collection is not the registered class', () => {
    // @ts-expect-error published is a PostCollection method; the refinement gets the shared Collection
    db.User.include('posts', (posts) => posts.published());
  });

  test('the plain collection rows are unchanged', async () => {
    expectTypeOf(await plain.Post.first()).toEqualTypeOf<PostRow | null>();
    expectTypeOf(await plain.Post.firstOrThrow()).toEqualTypeOf<PostRow>();
  });
});

describe('select and variant leave the class', () => {
  test('select after include keeps the included relation', async () => {
    const posts = Post.include('author').published().select('id');
    expectTypeOf(await posts.first()).toEqualTypeOf<{
      id: number;
      author: AuthorRow['author'];
    } | null>();
    expectTypeOf(await posts.firstOrThrow()).toEqualTypeOf<{
      id: number;
      author: AuthorRow['author'];
    }>();
  });

  test('select keeps the facts', () => {
    expectTypeOf(Post.published().select('id').update({ title: 'x' })).not.toBeAny();
  });

  test('select drops the class methods', () => {
    // @ts-expect-error published does not exist on the shared Collection returned by select
    Post.published().select('id', 'title').published();
  });
});

describe('with', () => {
  const published: QueryFragment<PostCollection, Filtered<PostCollection>> = (posts) =>
    posts.published();

  test('returns what the fragment returns', () => {
    expectTypeOf(Post.with(published)).toEqualTypeOf<Filtered<PostCollection>>();
    expectTypeOf(Post.with(published)).toEqualTypeOf(Post.published());
  });

  test('a fragment written against the shared Collection type applies to the class and returns the shared type', () => {
    const titled = (posts: Collection<TestContract, 'Post'>) => posts.where({ title: 'x' });
    expectTypeOf(Post.with(titled)).toEqualTypeOf<Filtered<Collection<TestContract, 'Post'>>>();
  });

  test('a fragment for another class is refused', () => {
    const named = (users: ReturnType<typeof createChainingOrm>['db']['User']) => users.named('x');
    // @ts-expect-error the fragment takes a UserCollection, the receiver is a PostCollection
    Post.with(named);
  });
});

describe('fragment is a member of every collection', () => {
  test('a class cannot declare fragment with another signature', () => {
    class ShadowingPostCollection extends Collection<TestContract, 'Post'> {
      // @ts-expect-error fragment is a member of every collection
      override fragment(title: string) {
        return this.where({ title });
      }
    }
    expectTypeOf<ShadowingPostCollection>().not.toBeAny();
  });
});

describe('state and row are read from the facts', () => {
  test('CollectionTypeStateOf reads the established flags', () => {
    expectTypeOf<CollectionTypeStateOf<PostCollection>['hasWhere']>().toEqualTypeOf<boolean>();
    expectTypeOf<
      CollectionTypeStateOf<ReturnType<PostCollection['published']>>['hasWhere']
    >().toEqualTypeOf<true>();
  });

  test('CollectionRowOf reads the model row', () => {
    expectTypeOf<CollectionRowOf<PostCollection>>().toEqualTypeOf<PostRow>();
  });
});

describe('assignability', () => {
  test('a filtered class instance is a Collection of the model', () => {
    const take = (posts: Collection<TestContract, 'Post'>) => posts;
    take(Post.published());
    take(Post.published().recent().limit(1));
  });

  test('a filtered class instance is the class', () => {
    const take = (posts: PostCollection) => posts;
    take(Post.published().recent());
  });

  test('a plain collection is not the class', () => {
    const take = (posts: PostCollection) => posts;
    // @ts-expect-error the plain collection lacks the class methods
    take(plain.Post);
  });

  test('a collection that may have no filter is not a filtered one', () => {
    const take = (posts: Filtered<PostCollection>) => posts;
    // @ts-expect-error hasWhere is boolean on the root, take needs true
    take(Post);
  });
});
