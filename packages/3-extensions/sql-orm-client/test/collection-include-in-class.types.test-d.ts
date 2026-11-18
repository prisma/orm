import { describe, expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import type { CollectionRowOf } from '../src/collection-types';
import { orm } from '../src/orm';
import { createMockRuntime, getTestContext, type TestContract } from './helpers';

const newUser = { id: 1, name: 'Ada', email: 'ada@example.com' };

class AuthorCollection extends Collection<TestContract, 'User'> {
  named(name: string) {
    return this.where({ name });
  }

  withPosts() {
    return this.include('posts');
  }

  allWithPosts() {
    return this.include('posts').all();
  }

  firstWithPosts() {
    return this.include('posts').first();
  }

  firstMatchingWithPosts(name: string) {
    return this.include('posts').first({ name });
  }

  createWithPosts() {
    return this.include('posts').create(newUser);
  }

  createAllWithPosts() {
    return this.include('posts').createAll([newUser]);
  }

  upsertWithPosts() {
    return this.include('posts').upsert({ create: newUser, update: { name: 'Ada' } });
  }

  updateWithPosts(name: string) {
    return this.named(name).include('posts').update({ email: 'ada@example.org' });
  }

  updateAllWithPosts(name: string) {
    return this.named(name).include('posts').updateAll({ email: 'ada@example.org' });
  }

  deleteWithPosts(name: string) {
    return this.named(name).include('posts').delete();
  }

  deleteAllWithPosts(name: string) {
    return this.named(name).include('posts').deleteAll();
  }
}

const db = orm({
  runtime: createMockRuntime(),
  context: getTestContext(),
  collections: { User: AuthorCollection },
}).public;
const Authors = db.User;
const outside = Authors.include('posts');
type AuthorWithPosts = CollectionRowOf<typeof outside>;

describe('a class method that includes a relation and then reads rows', () => {
  test('the expected row has the relation', () => {
    expectTypeOf<'posts'>().toExtend<keyof AuthorWithPosts>();
  });

  test('all', async () => {
    expectTypeOf(await Authors.allWithPosts().toArray()).toEqualTypeOf<AuthorWithPosts[]>();
  });

  test('first', async () => {
    expectTypeOf(await Authors.firstWithPosts()).toEqualTypeOf<AuthorWithPosts | null>();
  });

  test('first with a filter', async () => {
    expectTypeOf(
      await Authors.firstMatchingWithPosts('Ada'),
    ).toEqualTypeOf<AuthorWithPosts | null>();
  });

  test('create', async () => {
    expectTypeOf(await Authors.createWithPosts()).toEqualTypeOf<AuthorWithPosts>();
  });

  test('createAll', async () => {
    expectTypeOf(await Authors.createAllWithPosts().toArray()).toEqualTypeOf<AuthorWithPosts[]>();
  });

  test('upsert', async () => {
    expectTypeOf(await Authors.upsertWithPosts()).toEqualTypeOf<AuthorWithPosts>();
  });

  test('update', async () => {
    expectTypeOf(await Authors.updateWithPosts('Ada')).toEqualTypeOf<AuthorWithPosts | null>();
  });

  test('updateAll', async () => {
    expectTypeOf(await Authors.updateAllWithPosts('Ada').toArray()).toEqualTypeOf<
      AuthorWithPosts[]
    >();
  });

  test('delete', async () => {
    expectTypeOf(await Authors.deleteWithPosts('Ada')).toEqualTypeOf<AuthorWithPosts | null>();
  });

  test('deleteAll', async () => {
    expectTypeOf(await Authors.deleteAllWithPosts('Ada').toArray()).toEqualTypeOf<
      AuthorWithPosts[]
    >();
  });
});

describe('a class method that returns an included chain', () => {
  test('the caller reads rows with the relation', async () => {
    expectTypeOf(await Authors.withPosts().first()).toEqualTypeOf<AuthorWithPosts | null>();
    expectTypeOf(await Authors.withPosts().named('Ada').all().toArray()).toEqualTypeOf<
      AuthorWithPosts[]
    >();
  });
});
