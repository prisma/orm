import { expectTypeOf, test } from 'vitest';
import type { MutationCreateInput, MutationUpdateInput } from '../src/types';
import type { Contract } from './fixtures/generated/contract';

type UserCreate = MutationCreateInput<Contract, 'User'>;
type UserUpdate = MutationUpdateInput<Contract, 'User'>;
type PostUpdate = MutationUpdateInput<Contract, 'Post'>;

test('a relation callback accepts an array of operations, readonly or empty, and at most one on a to-one relation', () => {
  const update: UserUpdate = {
    posts: (posts) => [posts.create({ id: 1, title: 'New', views: 0 }), posts.disconnect()],
    tags: () => [],
    profile: (profile) => [profile.disconnect()] as const,
  };
  const create: UserCreate = {
    name: 'Alice',
    email: 'alice@test.com',
    posts: (posts) => [posts.connect({ id: 2 })] as const,
  };
  const post: PostUpdate = { author: (author) => [author.connect({ id: 1 })] };

  expectTypeOf([update, create, post]).toExtend<readonly unknown[]>();
});

test('a nested array, an element that is not an operation, a disconnect in create and two operations on a to-one relation are type errors', () => {
  const nested: UserUpdate = {
    // @ts-expect-error
    posts: (posts) => [posts.connect({ id: 2 }), [posts.disconnect()]],
  };
  const notAnOperation: UserUpdate = {
    // @ts-expect-error
    posts: (posts) => [posts.connect({ id: 2 }), { id: 3 }],
  };
  const disconnectInCreate: UserCreate = {
    name: 'Alice',
    email: 'alice@test.com',
    posts: (posts) => [
      posts.connect({ id: 2 }),
      // @ts-expect-error
      posts.disconnect([{ id: 3 }]),
    ],
  };
  const twoOnToOne: PostUpdate = {
    // @ts-expect-error
    author: (author) => [author.connect({ id: 1 }), author.connect({ id: 2 })],
  };

  expectTypeOf([nested, notAnOperation, disconnectInCreate, twoOnToOne]).toExtend<
    readonly unknown[]
  >();
});
