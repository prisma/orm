import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { expectTypeOf, test } from 'vitest';
import type { Db } from '../../src/exports/types';
import type { Contract } from '../fixtures/generated/contract';

declare const db: Db<Contract>;

test('a column name three joined tables have is reached only through a table', () => {
  const joined = db.public.users
    .innerJoin(db.public.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
    .innerJoin(db.public.profiles, (f, fns) => fns.eq(f.users.id, f.profiles.user_id));

  // @ts-expect-error users, posts and profiles all have id
  joined.select((f) => ({ id: f.id }));
  // @ts-expect-error nor by name
  joined.select('id');

  expectTypeOf(
    joined.select((f) => ({ id: f.profiles.id, email: f.email, bio: f.bio })).build(),
  ).toEqualTypeOf<SqlQueryPlan<{ id: number; email: string; bio: string }>>();
});

test('the fix ORM.COLUMN_AMBIGUOUS suggests for select type-checks', () => {
  const joined = db.public.users
    .innerJoin(db.public.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
    .innerJoin(db.public.profiles, (f, fns) => fns.eq(f.users.id, f.profiles.user_id));

  expectTypeOf(joined.select('id', (f) => f.users.id).build()).toEqualTypeOf<
    SqlQueryPlan<{ id: number }>
  >();
  expectTypeOf(
    joined
      .select('email')
      .orderBy((f) => f.users.id)
      .build(),
  ).toEqualTypeOf<SqlQueryPlan<{ email: string }>>();
});

test('a column name shared with the nullable side of an outer join is reached only through a table', () => {
  const joined = db.public.users
    .innerJoin(db.public.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
    .outerLeftJoin(db.public.profiles, (f, fns) => fns.eq(f.users.id, f.profiles.user_id));

  // @ts-expect-error users, posts and profiles all have id
  joined.select((f) => ({ id: f.id }));

  expectTypeOf(
    joined.select((f) => ({ id: f.profiles.id, bio: f.bio, title: f.title })).build(),
  ).toEqualTypeOf<SqlQueryPlan<{ id: number | null; bio: string | null; title: string }>>();
});

test('a column name shared by aliased copies of a table is reached only through an alias', () => {
  const joined = db.public.users
    .as('u1')
    .innerJoin(db.public.users.as('u2'), (f, fns) => fns.eq(f.u1.id, f.u2.id))
    .innerJoin(db.public.users.as('u3'), (f, fns) => fns.eq(f.u1.id, f.u3.id));

  // @ts-expect-error all three aliases have email
  joined.select((f) => ({ email: f.email }));

  expectTypeOf(joined.select((f) => ({ email: f.u3.email })).build()).toEqualTypeOf<
    SqlQueryPlan<{ email: string }>
  >();
});

test('inside a lateral subquery, a column name the parent tables also have is reached only through a table', () => {
  db.public.users
    .innerJoin(db.public.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
    .lateralJoin('profile', (lateral) =>
      lateral
        .from(db.public.profiles)
        .select('bio')
        .where((f, fns) => {
          // @ts-expect-error users, posts and profiles all have id
          f.id;
          expectTypeOf(f.bio).not.toBeAny();
          expectTypeOf(f.profiles.id).not.toBeAny();
          return fns.eq(f.profiles.user_id, f.users.id);
        }),
    );
});
