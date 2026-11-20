import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { expectTypeOf, test } from 'vitest';
import { db } from './preamble';

test('inner join', () => {
  const inner = db.public.users
    .innerJoin(db.public.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
    .select('name', 'embedding')
    .build();

  expectTypeOf(inner).toEqualTypeOf<SqlQueryPlan<{ name: string; embedding: number[] | null }>>();
});

test('conflicting column names are not available at top level', () => {
  db.public.users
    .innerJoin(db.public.posts, (f, fns) => fns.eq(f.users.id, f.user_id))
    // @ts-expect-error conflicting column 'id' evicted from top-level scope; must use namespace
    .select((f) => ({ id: f.id, title: f.posts.title }))
    .build();
});

test('a column name three joined tables have is not available at top level', () => {
  const joined = db.public.users
    .innerJoin(db.public.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
    .innerJoin(db.public.profiles, (f, fns) => fns.eq(f.users.id, f.profiles.user_id));

  // @ts-expect-error users, posts and profiles all have id; name the table
  joined.select((f) => ({ id: f.id }));

  expectTypeOf(joined.select((f) => ({ id: f.profiles.id, bio: f.bio })).build()).toEqualTypeOf<
    SqlQueryPlan<{ id: number; bio: string }>
  >();
});

test('outer left join makes right side nullable', () => {
  const left = db.public.users
    .outerLeftJoin(db.public.posts, (f, fns) => fns.eq(f.users.id, f.user_id))
    .select('name', 'title')
    .build();

  expectTypeOf(left).toEqualTypeOf<SqlQueryPlan<{ name: string; title: string | null }>>();
});

test('outer right join makes left side nullable', () => {
  const right = db.public.users
    .outerRightJoin(db.public.posts, (f, fns) => fns.eq(f.users.id, f.user_id))
    .select('name', 'title')
    .build();

  expectTypeOf(right).toEqualTypeOf<SqlQueryPlan<{ name: string | null; title: string }>>();
});

test('outer full join makes both sides nullable', () => {
  const full = db.public.users
    .outerFullJoin(db.public.posts, (f, fns) => fns.eq(f.users.id, f.user_id))
    .select('name', 'title')
    .build();

  expectTypeOf(full).toEqualTypeOf<SqlQueryPlan<{ name: string | null; title: string | null }>>();
});

test('field name conflict resolved via namespaces', () => {
  const fieldNameConflict = db.public.users
    .innerJoin(db.public.posts, (f, fns) => fns.eq(f.users.id, f.user_id))
    .select('name', 'title')
    .where((f, fns) => fns.eq(f.users.id, f.posts.id))
    .build();

  expectTypeOf(fieldNameConflict).toEqualTypeOf<SqlQueryPlan<{ name: string; title: string }>>();
});

test('join on a subquery', () => {
  const subquery = db.public.users
    .innerJoin(
      db.public.posts.select((f) => ({ title: f.title, authorId: f.user_id })).as('myPosts'),
      (f, fns) => fns.eq(f.users.id, f.myPosts.authorId),
    )
    .select((f) => ({
      userName: f.users.name,
      postTitle: f.myPosts.title,
    }))
    .build();

  expectTypeOf(subquery).toEqualTypeOf<SqlQueryPlan<{ userName: string; postTitle: string }>>();
});

test('as() rebinds scope for direct method access', () => {
  const aliased = db.public.users
    .as('u')
    .select((f) => ({ id: f.u.id, name: f.u.name }))
    .build();

  expectTypeOf(aliased).toEqualTypeOf<SqlQueryPlan<{ id: number; name: string }>>();
});

test('self-join via alias', () => {
  const selfJoin = db.public.users
    .innerJoin(db.public.users.as('inviter'), (f, fns) =>
      fns.eq(f.users.invited_by_id, f.inviter.id),
    )
    .select((f) => ({
      userName: f.users.name,
      inviterName: f.inviter.name,
    }))
    .build();

  expectTypeOf(selfJoin).toEqualTypeOf<SqlQueryPlan<{ userName: string; inviterName: string }>>();
});
