import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import { orm } from '../src/orm';
import type { TestContract } from './helpers';
import { createMockRuntime, getTestContext } from './helpers';

class UserCollection extends Collection<TestContract, 'User'> {
  named(name: string) {
    return this.where((user) => user.name.eq(name));
  }
}

class PostCollection extends Collection<TestContract, 'Post'> {
  popular() {
    return this.where((p) => p.views.gt(1000));
  }
}

class CommentCollection extends Collection<TestContract, 'Comment'> {
  withBody(body: string) {
    return this.where((comment) => comment.body.eq(body));
  }
}

function expectPostCollection(value: unknown): asserts value is PostCollection {
  expect(value).toBeInstanceOf(PostCollection);
}

function expectCommentCollection(value: unknown): asserts value is CommentCollection {
  expect(value).toBeInstanceOf(CommentCollection);
}

describe('orm()', () => {
  const context = getTestContext();

  it('returns custom collections by key', () => {
    const runtime = createMockRuntime();
    const db = orm({
      runtime,
      context,
      collections: { Post: PostCollection },
    });
    expect(db.public.Post).toBeInstanceOf(PostCollection);
  });

  it('creates default collections for model names', async () => {
    const runtime = createMockRuntime();
    const db = orm({ runtime, context });
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);
    const results = await db.public.User.all();
    expect(results).toHaveLength(1);
  });

  it('refuses an invalid limit or offset before any query runs', async () => {
    const runtime = createMockRuntime();
    const db = orm({ runtime, context });

    await expect(async () => db.public.User.limit(Number.NaN).all()).rejects.toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: `limit must be an integer from 0 to ${Number.MAX_SAFE_INTEGER}, got NaN`,
        meta: { argument: 'limit' },
      }),
    );
    await expect(async () => db.public.User.offset(1.5).all()).rejects.toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: `offset must be an integer from 0 to ${Number.MAX_SAFE_INTEGER}, got 1.5`,
        meta: { argument: 'offset' },
      }),
    );
    expect(runtime.executions).toEqual([]);
  });

  it('returns undefined for symbol-based property lookups on the proxy', () => {
    const runtime = createMockRuntime();
    const db = orm({ runtime, context });
    expect((db as Record<PropertyKey, unknown>)[Symbol.toStringTag]).toBeUndefined();
  });

  it('caches lazily created collections', () => {
    const runtime = createMockRuntime();
    const db = orm({ runtime, context });
    const first = db.public.User;
    const second = db.public.User;
    expect(first).toBe(second);
  });

  it('returns undefined for an unknown model name on a namespace facet', () => {
    const runtime = createMockRuntime();
    const db = orm({ runtime, context });
    expect((db.public as Record<string, unknown>)['unknown']).toBeUndefined();
  });

  it('custom collection overrides default for same key', () => {
    const runtime = createMockRuntime();
    const db = orm({
      runtime,
      context,
      collections: { Post: PostCollection },
    });

    expect(db.public.Post).toBeInstanceOf(PostCollection);
  });

  it('resolves User to custom collection instance', () => {
    const runtime = createMockRuntime();
    const db = orm({
      runtime,
      context,
      collections: { User: UserCollection },
    });

    expect(db.public.User).toBeInstanceOf(UserCollection);
  });

  it('instantiates custom collections lazily and caches by model', () => {
    const runtime = createMockRuntime();
    let constructions = 0;
    class LazyPostCollection extends Collection<TestContract, 'Post'> {
      readonly instanceMarker = ++constructions;
    }

    const db = orm({
      runtime,
      context,
      collections: { Post: LazyPostCollection },
    });

    expect(constructions).toBe(0);
    void db.public.User;
    expect(constructions).toBe(0);
    const postsFirst = db.public.Post;
    expect(constructions).toBe(1);
    const postsSecond = db.public.Post;
    expect(postsSecond).toBe(postsFirst);
    expect(constructions).toBe(1);
  });

  it('ignores undefined custom collection entries and falls back to default collection', () => {
    const runtime = createMockRuntime();
    const db = orm({
      runtime,
      context,
      collections: { Post: undefined as unknown as typeof PostCollection },
    });

    expect(db.public.Post).toBeInstanceOf(Collection);
    expect(db.public.Post).not.toBeInstanceOf(PostCollection);
  });

  it('throws when a custom collection key cannot resolve to a model', () => {
    const runtime = createMockRuntime();

    expect(() =>
      orm({
        runtime,
        context,
        collections: { unknownCollection: PostCollection },
      }),
    ).toThrow(/No model found for custom collection 'unknownCollection'/);
  });

  it('throws when custom collection values are instances instead of classes', () => {
    const runtime = createMockRuntime();
    const postCollectionInstance = new PostCollection({ runtime, context }, 'Post', {
      namespaceId: 'public',
    });

    expect(() =>
      orm({
        runtime,
        context,
        collections: {
          Post: postCollectionInstance as unknown as typeof PostCollection,
        },
      }),
    ).toThrow(/must be a Collection class/);
  });

  it('throws when custom collection values do not extend Collection', () => {
    const runtime = createMockRuntime();
    class NotACollection {
      noop() {
        return undefined;
      }
    }

    expect(() =>
      orm({
        runtime,
        context,
        collections: {
          Post: NotACollection as unknown as typeof PostCollection,
        },
      }),
    ).toThrow(/must be a Collection class/);
  });

  it('throws when custom collection values are functions without Collection prototypes', () => {
    const runtime = createMockRuntime();

    expect(() =>
      orm({
        runtime,
        context,
        collections: {
          Post: (() => ({ ok: true })) as unknown as typeof PostCollection,
        },
      }),
    ).toThrow(/must be a Collection class/);
  });

  it('exposes models through the namespace facet on the client', () => {
    const runtime = createMockRuntime();
    const db = orm({ runtime, context });
    expect(db.public.User).toBeDefined();
    type DbClient = typeof db;
    // @ts-expect-error an unknown key is absent from the typed client
    type _UnknownCollection = DbClient['unknown'];
  });

  it('uses registered collection classes in include refinements', {
    timeout: timeouts.typeScriptCompilation,
  }, () => {
    const runtime = createMockRuntime();
    const db = orm({
      runtime,
      context,
      collections: { Post: PostCollection },
    });

    const withPosts = db.public.User.include('posts', (posts) => {
      expectPostCollection(posts);
      return posts.popular();
    });

    const include = withPosts.state.includes[0]!;
    expect(include.nested.filters).toHaveLength(1);
  });

  it('propagates registered collection classes through nested include refinements', () => {
    const runtime = createMockRuntime();
    const db = orm({
      runtime,
      context,
      collections: {
        Post: PostCollection,
        Comment: CommentCollection,
      },
    });

    const withNested = db.public.User.include('posts', (posts) => {
      expectPostCollection(posts);
      return posts.include('comments', (comments) => {
        expectCommentCollection(comments);
        return comments.withBody('approved');
      });
    });

    const postInclude = withNested.state.includes[0]!;
    const commentInclude = postInclude.nested.includes[0]!;
    expect(commentInclude.nested.filters).toHaveLength(1);
  });
});
