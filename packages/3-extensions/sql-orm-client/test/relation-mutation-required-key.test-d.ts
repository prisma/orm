import { expectTypeOf, test } from 'vitest';
import type { MutationUpdateInput } from '../src/types';
import type { Contract } from './fixtures/generated/contract';

type UserUpdate = MutationUpdateInput<Contract, 'User'>;
type PostUpdate = MutationUpdateInput<Contract, 'Post'>;

test('disconnect is a type error on a relation whose foreign key is required', () => {
  const toOneParentHolds: PostUpdate = {
    // @ts-expect-error
    author: (author) => author.disconnect(),
  };
  const toMany: UserUpdate = {
    // @ts-expect-error
    posts: (posts) => posts.disconnect(),
  };
  const toManyWithCriteria: UserUpdate = {
    // @ts-expect-error
    posts: (posts) => posts.disconnect([{ id: 1 }]),
  };
  const toOneChildHolds: UserUpdate = {
    // @ts-expect-error
    profile: (profile) => profile.disconnect(),
  };

  expectTypeOf([toOneParentHolds, toMany, toManyWithCriteria, toOneChildHolds]).toExtend<
    readonly unknown[]
  >();
});

test('disconnect stays available on an optional foreign key and through a junction', () => {
  const update: UserUpdate = {
    invitedBy: (inviter) => inviter.disconnect(),
    invitedUsers: (invited) => [invited.disconnect(), invited.disconnect([{ id: 2 }])],
    tags: (tags) => tags.disconnect([{ id: 't1' }]),
  };

  expectTypeOf(update).toExtend<UserUpdate>();
});
