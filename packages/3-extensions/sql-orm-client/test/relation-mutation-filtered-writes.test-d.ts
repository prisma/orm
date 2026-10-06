import { BinaryExpr, ColumnRef, LiteralExpr } from '@internal/sql-relational-core/ast';
import { expectTypeOf, test } from 'vitest';
import type {
  MutationCreateInput,
  MutationUpdateInput,
  RelationMutationDeleteAll,
  RelationMutationUpdateAll,
} from '../src/types';
import type { Contract } from './fixtures/generated/contract';

type UserCreate = MutationCreateInput<Contract, 'User'>;
type UserUpdate = MutationUpdateInput<Contract, 'User'>;
type PostUpdate = MutationUpdateInput<Contract, 'Post'>;

const viewsAreSeven = BinaryExpr.eq(ColumnRef.of('posts', 'views'), LiteralExpr.of(7));

test('a one-to-many relation in update input accepts the four call shapes', () => {
  const input: UserUpdate = {
    posts: (posts) => [
      posts.where({ title: 'Draft' }).updateAll({ views: 1 }),
      posts.where({ title: 'Draft' }).deleteAll(),
      posts.updateAll({ title: 'Published' }),
      posts.deleteAll(),
    ],
  };

  expectTypeOf(input).toExtend<UserUpdate>();
});

test('updateAll and deleteAll return their own descriptors', () => {
  const input: UserUpdate = {
    posts: (posts) => {
      expectTypeOf(posts.where({ views: 1 }).updateAll({ views: 2 })).toEqualTypeOf<
        RelationMutationUpdateAll<Contract, 'Post'>
      >();
      expectTypeOf(posts.deleteAll()).toEqualTypeOf<RelationMutationDeleteAll<Contract, 'Post'>>();
      return [];
    },
  };

  expectTypeOf(input).toExtend<UserUpdate>();
});

test('where accepts a shorthand object, a callback over the related model and a direct expression', () => {
  const input: UserUpdate = {
    posts: (posts) => [
      posts.where({ title: 'Draft', views: 3 }).deleteAll(),
      posts.where((post) => post.views.gt(10)).deleteAll(),
      posts.where(viewsAreSeven).deleteAll(),
    ],
  };

  expectTypeOf(input).toExtend<UserUpdate>();
});

test('where calls chain and mix filter forms', () => {
  const input: UserUpdate = {
    posts: (posts) =>
      posts
        .where({ title: 'Draft' })
        .where((post) => post.views.gt(10))
        .where(viewsAreSeven)
        .updateAll({ views: 0 }),
  };

  expectTypeOf(input).toExtend<UserUpdate>();
});

test('updateAll and deleteAll combine with the other operations in one array', () => {
  const input: UserUpdate = {
    posts: (posts) => [
      posts.create({ id: 1, title: 'New', views: 0 }),
      posts.where({ title: 'New' }).updateAll({ views: 1 }),
      posts.connect({ id: 2 }),
      posts.where({ views: 0 }).deleteAll(),
      posts.disconnect(),
    ],
  };

  expectTypeOf(input).toExtend<UserUpdate>();
});

test('a where filter on a field the related model does not have is a type error', () => {
  const input: UserUpdate = {
    posts: (posts) => [
      // @ts-expect-error
      posts.where({ email: 'a@test.com' }).deleteAll(),
      // @ts-expect-error
      posts.where((post) => post.email.eq('a@test.com')).deleteAll(),
    ],
  };

  expectTypeOf(input).toExtend<UserUpdate>();
});

test('the mutator returned by where has no create, connect or disconnect', () => {
  const input: UserUpdate = {
    posts: (posts) => [
      // @ts-expect-error
      posts.where({ title: 'Draft' }).create({ id: 1, title: 'New', views: 0 }),
      // @ts-expect-error
      posts.where({ title: 'Draft' }).connect({ id: 2 }),
      // @ts-expect-error
      posts.where({ title: 'Draft' }).disconnect(),
    ],
  };

  expectTypeOf(input).toExtend<UserUpdate>();
});

test('a where returned without updateAll or deleteAll is a type error', () => {
  const input: UserUpdate = {
    // @ts-expect-error
    posts: (posts) => posts.where({ title: 'Draft' }),
  };

  expectTypeOf(input).toExtend<UserUpdate>();
});

test('updateAll data takes scalar fields of the related model only', () => {
  const input: UserUpdate = {
    posts: (posts) => [
      // @ts-expect-error
      posts.updateAll({ comments: (comments) => comments.disconnect() }),
      // @ts-expect-error
      posts.updateAll({ email: 'a@test.com' }),
      // @ts-expect-error
      posts.updateAll({ views: 'many' }),
    ],
  };

  expectTypeOf(input).toExtend<UserUpdate>();
});

test('updateAll data cannot set the field linking the child to the parent', () => {
  const input: UserUpdate = {
    posts: (posts) => [
      // @ts-expect-error
      posts.updateAll({ userId: 2 }),
      // @ts-expect-error
      posts.where({ title: 'Draft' }).updateAll({ views: 1, userId: 2 }),
    ],
    invitedUsers: (invited) => [
      // @ts-expect-error
      invited.updateAll({ invitedById: 2 }),
      invited.updateAll({ name: 'Renamed' }),
    ],
  };

  expectTypeOf(input).toExtend<UserUpdate>();
});

test('where, updateAll and deleteAll are type errors in create input', () => {
  const input: UserCreate = {
    name: 'Alice',
    email: 'alice@test.com',
    posts: (posts) => [
      // @ts-expect-error
      posts.where({ title: 'Draft' }).deleteAll(),
      // @ts-expect-error
      posts.updateAll({ views: 1 }),
      // @ts-expect-error
      posts.deleteAll(),
    ],
  };

  expectTypeOf(input).toExtend<UserCreate>();
});

test('where, updateAll and deleteAll are type errors on a to-one relation the parent owns', () => {
  const input: PostUpdate = {
    author: (author) => [
      // @ts-expect-error
      author.where({ id: 1 }).deleteAll(),
      // @ts-expect-error
      author.updateAll({ name: 'Bob' }),
      // @ts-expect-error
      author.deleteAll(),
    ],
  };

  expectTypeOf(input).toExtend<PostUpdate>();
});

test('where, updateAll and deleteAll are type errors on a to-one relation the child owns', () => {
  const input: UserUpdate = {
    profile: (profile) => [
      // @ts-expect-error
      profile.where({ id: 1 }).deleteAll(),
      // @ts-expect-error
      profile.updateAll({ bio: 'New' }),
      // @ts-expect-error
      profile.deleteAll(),
    ],
  };

  expectTypeOf(input).toExtend<UserUpdate>();
});

test('a many-to-many relation in update input accepts where, updateAll and deleteAll', () => {
  const input: UserUpdate = {
    tags: (tags) => [
      tags.where({ name: 'Rust' }).updateAll({ name: 'Rust 2' }),
      tags.where((tag) => tag.name.eq('Go')).deleteAll(),
    ],
  };

  expectTypeOf(input).toExtend<UserUpdate>();
});
