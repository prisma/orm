import { expectTypeOf, test } from 'vitest';
import type {
  MutationCreateInput,
  MutationUpdateInput,
  RelationMutationDelete,
  RelationMutationUpdate,
} from '../src/types';
import type { Contract } from './fixtures/generated/contract';

type UserCreate = MutationCreateInput<Contract, 'User'>;
type UserUpdate = MutationUpdateInput<Contract, 'User'>;
type PostUpdate = MutationUpdateInput<Contract, 'Post'>;

test('a to-many relation updates or deletes one row after where()', () => {
  const update: UserUpdate = {
    posts: (posts) => {
      expectTypeOf(posts.where({ id: 1 }).update({ title: 'New' })).toEqualTypeOf<
        RelationMutationUpdate<Contract, 'Post', 'public'>
      >();
      expectTypeOf(posts.where({ id: 1 }).delete()).toEqualTypeOf<RelationMutationDelete>();
      return [
        posts.where({ id: 1 }).update({ title: 'New' }),
        posts
          .where({ id: 2 })
          .where((post) => post.views.gt(1))
          .delete(),
      ];
    },
  };

  expectTypeOf(update).toExtend<UserUpdate>();
});

test('a to-many relation refuses update() and delete() without where() and data that sets the parent link', () => {
  const bareUpdate: UserUpdate = {
    // @ts-expect-error
    posts: (posts) => posts.update({ title: 'New' }),
  };
  const bareDelete: UserUpdate = {
    // @ts-expect-error
    posts: (posts) => posts.delete(),
  };
  const parentLink: UserUpdate = {
    // @ts-expect-error
    posts: (posts) => posts.where({ id: 1 }).update({ userId: 2 }),
  };

  expectTypeOf([bareUpdate, bareDelete, parentLink]).toExtend<readonly unknown[]>();
});

test('a to-one relation updates or deletes the linked row, bare or after where()', () => {
  const update: UserUpdate = {
    profile: (profile) => profile.update({ bio: 'New' }),
  };
  const narrowed: UserUpdate = {
    profile: (profile) => profile.where({ bio: 'Old' }).where({ id: 1 }).delete(),
  };

  expectTypeOf([update, narrowed]).toExtend<readonly unknown[]>();
});

test('update() and delete() are type errors on a relation the parent holds the key for and through a junction', () => {
  const parentHolds: PostUpdate = {
    // @ts-expect-error
    author: (author) => author.update({ name: 'Ada L.' }),
  };
  const deleted: PostUpdate = {
    // @ts-expect-error
    author: (author) => author.delete(),
  };
  const junction: UserUpdate = {
    // @ts-expect-error
    tags: (tags) => tags.where({ name: 'SQL' }).delete(),
  };

  expectTypeOf([parentHolds, deleted, junction]).toExtend<readonly unknown[]>();
});

test('a to-one relation has no updateAll() or deleteAll(), bare or after where()', () => {
  const bare: UserUpdate = {
    // @ts-expect-error
    profile: (profile) => profile.updateAll({ bio: 'New' }),
  };
  const narrowed: UserUpdate = {
    // @ts-expect-error
    profile: (profile) => profile.where({ bio: 'Old' }).deleteAll(),
  };

  expectTypeOf([bare, narrowed]).toExtend<readonly unknown[]>();
});

test('update() and delete() are type errors in create()', () => {
  const toOne: UserCreate = {
    name: 'Alice',
    email: 'alice@example.com',
    // @ts-expect-error
    profile: (profile) => profile.update({ bio: 'New' }),
  };
  const toMany: UserCreate = {
    name: 'Alice',
    email: 'alice@example.com',
    // @ts-expect-error
    posts: (posts) => posts.where({ id: 1 }).delete(),
  };

  expectTypeOf([toOne, toMany]).toExtend<readonly unknown[]>();
});
