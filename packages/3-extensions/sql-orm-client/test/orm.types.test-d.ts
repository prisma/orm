import { test } from 'vitest';
import { Collection } from '../src/collection';
import { orm } from '../src/orm';
import { createMockRuntime, getTestContext, type TestContract } from './helpers';

class UserCollection extends Collection<TestContract, 'User'> {
  named(name: string) {
    return this.where((user) => user.name.eq(name));
  }
}

class PostCollection extends Collection<TestContract, 'Post'> {
  published() {
    return this.where((post) => post.views.gte(100));
  }
}

const runtime = createMockRuntime();
const context = getTestContext();

const db = orm({
  runtime,
  context,
  collections: { User: UserCollection, Post: PostCollection },
});

test('custom collections and trait-gated operations compile', () => {
  db.public.User.named('Alice');
  db.public.Post.published();

  orm({
    runtime,
    context,
    collections: {
      // @ts-expect-error collections values must be classes, not instances
      User: new UserCollection({ runtime, context }, 'User', { namespaceId: 'public' }),
    },
  });

  db.public.User.where((user) => user.name.eq('x'));
  db.public.User.where((user) => user.name.like('x%'));
  db.public.User.where((user) => user.name.gt('a'));
  db.public.User.orderBy((user) => user.name.asc());

  db.public.Post.where((post) => post.views.eq(1));
  db.public.Post.where((post) => post.views.gt(5));
  db.public.Post.orderBy((post) => post.views.asc());

  db.public.User.where((user) => user.name.isNull());
  db.public.Post.where((post) => post.views.isNotNull());

  // @ts-expect-error int4 has no textual trait → like() not available
  db.public.Post.where((post) => post.views.like('%'));
  // @ts-expect-error int4 has no textual trait → ilike extension op not available
  db.public.Post.where((post) => post.views.ilike('%'));

  db.public.Post.aggregate((agg) => ({
    // @ts-expect-error text field is not numeric
    total: agg.sum('title'),
  }));
});
