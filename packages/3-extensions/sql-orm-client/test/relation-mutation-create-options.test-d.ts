import { expectTypeOf, test } from 'vitest';
import type { MutationUpdateInput } from '../src/types';
import type { Contract } from './fixtures/generated/contract';
import type { Contract as PolyContract } from './fixtures/polymorphism/generated/contract';

type UserUpdate = MutationUpdateInput<Contract, 'User'>;
type PolyUpdate<ModelName extends string> = MutationUpdateInput<PolyContract, ModelName>;

test('create takes onConflict skip or connect on a one-to-many relation and connect on a to-one or many-to-many relation, with conflictOn fields of the related model', () => {
  const update: UserUpdate = {
    posts: (posts) => [
      posts.create({ id: 1, title: 'A', views: 0 }, { onConflict: 'skip' }),
      posts.create([{ id: 2, title: 'B', views: 0 }], {
        onConflict: 'connect',
        conflictOn: ['title'],
      }),
    ],
    profile: (profile) => profile.create({ id: 1, bio: 'Hi' }, { onConflict: 'connect' }),
    tags: (tags) => tags.create({ id: 'a', name: 'Go' }, { onConflict: 'connect' }),
  };

  expectTypeOf(update).toExtend<UserUpdate>();
});

test('create options reject a conflictOn entry that is not a field, and skip on to-one and many-to-many relations', () => {
  const update: UserUpdate = {
    posts: (posts) =>
      // @ts-expect-error
      posts.create([{ id: 1, title: 'A', views: 0 }], {
        onConflict: 'skip',
        conflictOn: ['email'],
      }),
    // @ts-expect-error
    profile: (profile) => profile.create({ id: 1, bio: 'Hi' }, { onConflict: 'skip' }),
    // @ts-expect-error
    tags: (tags) => tags.create({ id: 'a', name: 'Go' }, { onConflict: 'skip' }),
  };

  expectTypeOf(update).toExtend<UserUpdate>();
});

test('create through variant() takes skip on a one-to-many relation and connect on a to-one relation', () => {
  const oneToMany: PolyUpdate<'Project'> = {
    tasks: (tasks) =>
      tasks.variant('bug').create({ title: 'Crash', severity: 'high' }, { onConflict: 'skip' }),
  };
  const toOne: PolyUpdate<'TaskComment'> = {
    task: (task) =>
      task.variant('bug').create({ title: 'Crash', severity: 'low' }, { onConflict: 'connect' }),
  };
  const lowCrash = { title: 'Crash', severity: 'low' } as const;
  const toOneWithSkip: PolyUpdate<'TaskComment'> = {
    // @ts-expect-error
    task: (task) => task.variant('bug').create(lowCrash, { onConflict: 'skip' }),
  };

  expectTypeOf([oneToMany, toOne, toOneWithSkip]).toExtend<readonly unknown[]>();
});

test('a create row with options refuses a callback on a relation whose foreign key is on the row', () => {
  const post = { id: 1, title: 'A', views: 0 };
  const skip: UserUpdate = {
    posts: (posts) =>
      // @ts-expect-error
      posts.create({ ...post, author: () => [] }, { onConflict: 'skip' }),
  };
  const connect: UserUpdate = {
    invitedUsers: (users) =>
      // @ts-expect-error
      users.create([{ id: 2, name: 'Bo', email: 'bo@example.com', invitedBy: () => [] }], {
        onConflict: 'connect',
      }),
  };
  const variant: PolyUpdate<'Project'> = {
    tasks: (tasks) => {
      const bugs = tasks.variant('bug');
      // @ts-expect-error
      return bugs.create(
        { title: 'Crash', severity: 'high', assignee: () => [] },
        { onConflict: 'skip' },
      );
    },
  };

  expectTypeOf([skip, connect, variant]).toExtend<readonly unknown[]>();
});

test('a create row with options takes callbacks on relations keyed on the other side, and a row without options takes every callback', () => {
  const withOptions: UserUpdate = {
    invitedUsers: (users) =>
      users.create(
        {
          id: 2,
          name: 'Bo',
          email: 'bo@example.com',
          posts: (posts) => posts.create({ id: 1, title: 'A', views: 0 }),
          profile: (profile) => profile.create({ id: 1, bio: 'Hi' }),
          tags: (tags) => tags.connect({ id: 'a' }),
        },
        { onConflict: 'connect' },
      ),
  };
  const withoutOptions: UserUpdate = {
    posts: (posts) =>
      posts.create({ id: 1, title: 'A', views: 0, author: (author) => author.connect({ id: 1 }) }),
  };
  const variantWithOptions: PolyUpdate<'Project'> = {
    tasks: (tasks) =>
      tasks.variant('bug').create(
        {
          title: 'Crash',
          severity: 'high',
          comments: (comments) => comments.create({ body: 'Seen' }),
        },
        { onConflict: 'skip' },
      ),
  };
  const variantWithoutOptions: PolyUpdate<'Project'> = {
    tasks: (tasks) =>
      tasks.variant('bug').create({
        title: 'Crash',
        severity: 'high',
        assignee: (assignee) => assignee.connect({ id: 1 }),
      }),
  };

  expectTypeOf([withOptions, withoutOptions, variantWithOptions, variantWithoutOptions]).toExtend<
    readonly unknown[]
  >();
});
