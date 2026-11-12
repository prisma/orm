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

test('a to-many relation in update input accepts where, updateAll and deleteAll with every filter form', () => {
  const input: UserUpdate = {
    posts: (posts) => {
      expectTypeOf(posts.where({ views: 1 }).updateAll({ views: 2 })).toEqualTypeOf<
        RelationMutationUpdateAll<Contract, 'Post'>
      >();
      expectTypeOf(posts.deleteAll()).toEqualTypeOf<RelationMutationDeleteAll>();
      return [
        posts.where({ title: 'Draft' }).updateAll({ views: 1 }),
        posts
          .where({ title: 'Draft' })
          .where((post) => post.views.gt(10))
          .where(viewsAreSeven)
          .deleteAll(),
        posts.updateAll({ title: 'Published' }),
        posts.deleteAll(),
      ];
    },
    tags: (tags) => tags.where((tag) => tag.name.eq('Go')).updateAll({ name: 'Golang' }),
  };

  expectTypeOf(input).toExtend<UserUpdate>();
});

test('where, updateAll and deleteAll reject other fields, other operations, the parent link, create input and to-one relations', () => {
  const update: UserUpdate = {
    posts: (posts) => [
      // @ts-expect-error
      posts.where({ email: 'a@test.com' }).deleteAll(),
      // @ts-expect-error
      posts.where({ title: 'Draft' }).connect({ id: 2 }),
      // @ts-expect-error
      posts.updateAll({ views: 'many' }),
      // @ts-expect-error
      posts.updateAll({ userId: 2 }),
    ],
    // @ts-expect-error
    profile: (profile) => profile.deleteAll(),
  };
  const returnsWhere: UserUpdate = {
    // @ts-expect-error
    posts: (posts) => posts.where({ title: 'Draft' }),
  };
  const create: UserCreate = {
    name: 'Alice',
    email: 'alice@test.com',
    // @ts-expect-error
    posts: (posts) => posts.updateAll({ views: 1 }),
  };
  const toOne: PostUpdate = {
    // @ts-expect-error
    author: (author) => author.where({ id: 1 }).deleteAll(),
  };

  expectTypeOf([update, returnsWhere, create, toOne]).toExtend<readonly unknown[]>();
});
