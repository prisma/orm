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

const post = { id: 1, title: 'A', views: 0 };
const bo = { id: 2, name: 'Bo', email: 'bo@example.com' };
const crash = { title: 'Crash', severity: 'high' } as const;

test('a create row with options refuses a callback on a relation whose foreign key is on the row', () => {
  const skip: UserUpdate = {
    posts: (posts) =>
      // @ts-expect-error
      posts.create({ ...post, author: (a) => a.connect({ id: 1 }) }, { onConflict: 'skip' }),
  };
  const connect: UserUpdate = {
    invitedUsers: (users) =>
      // @ts-expect-error
      users.create([{ ...bo, invitedBy: (i) => i.connect({ id: 1 }) }], { onConflict: 'connect' }),
  };
  const variant: PolyUpdate<'Project'> = {
    tasks: (tasks) => {
      const bugs = tasks.variant('bug');
      return bugs.create(
        // @ts-expect-error
        { ...crash, assignee: (a) => a.connect({ id: 1 }) },
        { onConflict: 'skip' },
      );
    },
  };

  expectTypeOf([skip, connect, variant]).toExtend<readonly unknown[]>();
});

test('a create row without options takes the same callbacks on relations whose foreign key is on the row', () => {
  const skip: UserUpdate = {
    posts: (posts) => posts.create({ ...post, author: (a) => a.connect({ id: 1 }) }),
  };
  const connect: UserUpdate = {
    invitedUsers: (users) => users.create([{ ...bo, invitedBy: (i) => i.connect({ id: 1 }) }]),
  };
  const variant: PolyUpdate<'Project'> = {
    tasks: (tasks) => {
      const bugs = tasks.variant('bug');
      return bugs.create({ ...crash, assignee: (a) => a.connect({ id: 1 }) });
    },
  };

  expectTypeOf([skip, connect, variant]).toExtend<readonly unknown[]>();
});

test('a create row with options takes callbacks on relations keyed on the other side, and options that may be undefined', () => {
  const maybe = undefined as { readonly onConflict: 'skip' } | undefined;
  const withOptions: UserUpdate = {
    invitedUsers: (users) =>
      users.create(
        {
          ...bo,
          posts: (posts) => posts.create(post),
          profile: (profile) => profile.create({ id: 1, bio: 'Hi' }),
          tags: (tags) => tags.connect({ id: 'a' }),
        },
        { onConflict: 'connect' },
      ),
  };
  const withMaybeOptions: UserUpdate = {
    posts: (posts) => posts.create([post], maybe),
  };
  const variantWithOptions: PolyUpdate<'Project'> = {
    tasks: (tasks) =>
      tasks
        .variant('bug')
        .create(
          { ...crash, comments: (comments) => comments.create({ body: 'Seen' }) },
          { onConflict: 'skip' },
        ),
  };

  expectTypeOf([withOptions, withMaybeOptions, variantWithOptions]).toExtend<readonly unknown[]>();
});
