import { expectTypeOf, test } from 'vitest';
import type {
  MutationCreateInput,
  MutationUpdateInput,
  RelationMutationCreate,
} from '../src/types';
import type { Contract } from './fixtures/generated/contract';

type UserCreate = MutationCreateInput<Contract, 'User'>;
type UserUpdate = MutationUpdateInput<Contract, 'User'>;
type PostUpdate = MutationUpdateInput<Contract, 'Post'>;

test('create on a one-to-many relation takes onConflict skip with and without conflictOn, for one row and for an array of rows', () => {
  const update: UserUpdate = {
    posts: (posts) => {
      expectTypeOf(
        posts.create({ id: 1, title: 'A', views: 0 }, { onConflict: 'skip' }),
      ).toEqualTypeOf<RelationMutationCreate<Contract, 'Post'>>();
      return [
        posts.create({ id: 1, title: 'A', views: 0 }, { onConflict: 'skip' }),
        posts.create([{ id: 2, title: 'B', views: 0 }], {
          onConflict: 'skip',
          conflictOn: ['id', 'title'],
        }),
      ];
    },
  };
  const create: UserCreate = {
    name: 'Alice',
    email: 'alice@test.com',
    posts: (posts) =>
      posts.create([{ id: 1, title: 'A', views: 0 }], { onConflict: 'skip', conflictOn: ['id'] }),
  };

  expectTypeOf([update, create]).toExtend<readonly unknown[]>();
});

test('create options reject connect, an unknown onConflict value and a conflictOn entry that is not a field of the related model', () => {
  const update: UserUpdate = {
    posts: (posts) => [
      // @ts-expect-error
      posts.create({ id: 1, title: 'A', views: 0 }, { onConflict: 'connect' }),
      // @ts-expect-error
      posts.create({ id: 1, title: 'A', views: 0 }, { onConflict: 'replace' }),
      // @ts-expect-error
      posts.create([{ id: 1, title: 'A', views: 0 }], {
        onConflict: 'skip',
        conflictOn: ['email'],
      }),
      // @ts-expect-error
      posts.create([{ id: 1, title: 'A', views: 0 }], {
        onConflict: 'skip',
        conflictOn: ['author'],
      }),
    ],
  };

  expectTypeOf(update).toExtend<UserUpdate>();
});

test('create on a to-one or many-to-many relation of an emitted contract takes no options', () => {
  const user: UserUpdate = {
    // @ts-expect-error
    profile: (profile) => profile.create({ id: 1, bio: 'Hi' }, { onConflict: 'skip' }),
    // @ts-expect-error
    tags: (tags) => tags.create({ id: 'a', name: 'Go' }, { onConflict: 'skip' }),
  };
  const alice = { name: 'Alice', email: 'alice@test.com' };
  const post: PostUpdate = {
    // @ts-expect-error
    author: (author) => author.create(alice, { onConflict: 'skip' }),
  };
  const withoutOptions: UserUpdate = {
    profile: (profile) => profile.create({ id: 1, bio: 'Hi' }),
    tags: (tags) => tags.create([{ id: 'a', name: 'Go' }]),
  };

  expectTypeOf([user, post, withoutOptions]).toExtend<readonly unknown[]>();
});
