/**
 * Type-test: a row-spec'd raw query publishes its declared columns as
 * `.returns`. Those refs are row-spec entries like any other, so an outer spec
 * inherits the inner declaration instead of restating its codec id.
 */

import type { ResultType } from '@internal/framework-components/runtime';
import { expectTypeOf, test } from 'vitest';
import type { Db, RawLane } from '../../src/exports/types';
import type { Contract } from '../fixtures/generated/contract';

declare const db: Db<Contract>;
declare const raw: RawLane<Contract>;

const users = db.public.users;

test('a contract-ref entry passes its resolved type through the refs record', () => {
  const inner = raw.sql`SELECT id, email FROM users`.returnsRow({
    id: users.columns.id,
    email: users.columns.email,
  });

  const outer = raw.sql`WITH inner AS (${inner}) SELECT email FROM inner`
    .returnsRow({ email: inner.returns.email })
    .build();

  expectTypeOf<ResultType<typeof outer>['email']>().toEqualTypeOf<string>();
});

test('an explicit codec id resolves through the codec map at the inner spec only', () => {
  const inner =
    raw.sql`SELECT user_id, count(*) AS post_count FROM posts GROUP BY user_id`.returnsRow({
      user_id: users.columns.id,
      post_count: 'pg/int8@1',
    });

  const outer = raw.sql`WITH counted AS (${inner}) SELECT user_id, post_count FROM counted`
    .returnsRow({
      user_id: inner.returns.user_id,
      post_count: inner.returns.post_count,
    })
    .build();
  type Row = ResultType<typeof outer>;

  expectTypeOf<Row['user_id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['post_count']>().toEqualTypeOf<bigint>();
});

test('a nullable entry stays nullable through a round trip', () => {
  const inner = raw.sql`SELECT invited_by_id FROM users`.returnsRow({
    invited_by_id: users.columns.invited_by_id,
  });

  const outer = raw.sql`WITH i AS (${inner}) SELECT invited_by_id FROM i`
    .returnsRow({ invited_by_id: inner.returns.invited_by_id })
    .build();

  expectTypeOf<ResultType<typeof outer>['invited_by_id']>().toEqualTypeOf<number | null>();
});

test('the refs record carries exactly the declared keys', () => {
  const inner = raw.sql`SELECT id, email FROM users`.returnsRow({
    id: users.columns.id,
    email: users.columns.email,
  });

  expectTypeOf<keyof typeof inner.returns>().toEqualTypeOf<'id' | 'email'>();
});

test('a key the spec never declared is not on the refs record', () => {
  const inner = raw.sql`SELECT id FROM users`.returnsRow({ id: users.columns.id });

  // @ts-expect-error — `email` is not a declared column of this statement
  inner.returns.email;
});

test('an affected-count query publishes no refs', () => {
  const bump = raw.sql`UPDATE users SET name = ${'Ada'}`.affectedCount();

  // @ts-expect-error — a statement that declares no columns has none to publish
  bump.returns;
});
