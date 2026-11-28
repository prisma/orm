import { describe, expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import type { CollectionRowOf } from '../src/collection-types';
import { orm } from '../src/orm';
import { createMockRuntime, getTestContext, type TestContract } from './helpers';

class UserCollection extends Collection<TestContract, 'User'> {
  named(name: string) {
    return this.where({ name });
  }
}

const db = orm({
  runtime: createMockRuntime(),
  context: getTestContext(),
  collections: { User: UserCollection },
}).public;

const longChain = db.User.include('posts')
  .include('profile')
  .include('tags')
  .include('roles')
  .include('invitedBy')
  .include('invitedUsers')
  .include('posts')
  .include('profile')
  .include('tags')
  .include('roles')
  .include('invitedBy')
  .include('invitedUsers')
  .include('posts')
  .include('profile')
  .include('tags')
  .include('roles');

const shortChain = db.User.include('posts')
  .include('profile')
  .include('tags')
  .include('roles')
  .include('invitedBy')
  .include('invitedUsers');

describe('a chain of sixteen includes', () => {
  test('has the same row as the chain that includes each relation once', async () => {
    expectTypeOf(await longChain.all().toArray()).toEqualTypeOf<
      CollectionRowOf<typeof shortChain>[]
    >();
  });

  test('keeps the collection class', () => {
    expectTypeOf(longChain).toExtend<UserCollection>();
    expectTypeOf(longChain.named('Ada')).toExtend<UserCollection>();
  });
});
