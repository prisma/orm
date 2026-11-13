import { expectTypeOf, test } from 'vitest';
import type { MutationUpdateInput } from '../src/types';
import type { Contract } from './fixtures/generated/contract';

type UserUpdate = MutationUpdateInput<Contract, 'User'>;

test('create on a one-to-many relation takes onConflict skip and conflictOn fields of the related model, and a to-one or many-to-many create takes the same rows without options', () => {
  const update: UserUpdate = {
    profile: (profile) => profile.create({ id: 1, bio: 'Hi' }),
    tags: (tags) => tags.create({ id: 'a', name: 'Go' }),
    posts: (posts) => [
      posts.create({ id: 1, title: 'A', views: 0 }, { onConflict: 'skip' }),
      posts.create([{ id: 2, title: 'B', views: 0 }], {
        onConflict: 'skip',
        conflictOn: ['title'],
      }),
    ],
  };

  expectTypeOf(update).toExtend<UserUpdate>();
});

test('create options reject connect, a conflictOn entry that is not a field, and to-one and many-to-many relations', () => {
  const update: UserUpdate = {
    posts: (posts) => [
      // @ts-expect-error
      posts.create({ id: 1, title: 'A', views: 0 }, { onConflict: 'connect' }),
      // @ts-expect-error
      posts.create([{ id: 1, title: 'A', views: 0 }], {
        onConflict: 'skip',
        conflictOn: ['email'],
      }),
    ],
    // @ts-expect-error
    profile: (profile) => profile.create({ id: 1, bio: 'Hi' }, { onConflict: 'skip' }),
    // @ts-expect-error
    tags: (tags) => tags.create({ id: 'a', name: 'Go' }, { onConflict: 'skip' }),
  };

  expectTypeOf(update).toExtend<UserUpdate>();
});
