/**
 * Type-test: the raw lane, authored from the client the way a caller reaches
 * it. Each spec entry goes through `db.raw.sql`, and the contract resolves
 * what every declared column decodes to.
 */

import type { ResultType } from '@internal/framework-components/runtime';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { expectTypeOf, test } from 'vitest';
import type { PostgresClient } from '../src/runtime/postgres';
import type { Contract } from './fixtures/generated/contract';

declare const db: PostgresClient<Contract>;

test('a row spec resolves each column through the contract codec map', () => {
  const users = db.sql.public.users;

  const plan = db.raw.sql`
    SELECT u.id, u.email, count(p.id) AS post_count
    FROM users u JOIN posts p ON p.user_id = u.id
    WHERE u.invited_by_id = ${1}
    GROUP BY u.id, u.email
  `
    .returnsRow({
      id: users.columns.id,
      email: users.columns.email,
      post_count: 'pg/int8@1',
    })
    .build();
  type Row = ResultType<typeof plan>;

  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['email']>().toEqualTypeOf<string>();
  expectTypeOf<Row['post_count']>().toEqualTypeOf<bigint>();
  expectTypeOf<keyof Row>().toEqualTypeOf<'id' | 'email' | 'post_count'>();
});

test('the affected-count terminator builds the branded row', () => {
  const plan = db.raw.sql`UPDATE users SET name = ${'Ada'} WHERE id = ${1}`.affectedCount().build();

  expectTypeOf(plan).toEqualTypeOf<SqlQueryPlan<AffectedCount>>();
});

test('an unknown codec id is rejected at the lane', () => {
  // @ts-expect-error — 'pg/nope@1' is not a key of the contract's codec map
  db.raw.sql`SELECT 1 AS one`.returnsRow({ one: 'pg/nope@1' });
});

test('an outer spec inherits an inner declaration through .returns', () => {
  const users = db.sql.public.users;
  const posts = db.sql.public.posts;
  const minPosts = 3;

  const authorsWithPosts = db.raw.sql`
    SELECT p.user_id AS user_id, count(*) AS post_count
    FROM posts p
    GROUP BY p.user_id
    HAVING count(*) >= ${minPosts}
  `.returnsRow({
    user_id: posts.columns.user_id,
    post_count: 'pg/int8@1',
  });

  const plan = db.raw.sql`
    WITH active AS (${authorsWithPosts})
    SELECT u.email, active.post_count
    FROM active
    JOIN users u ON u.id = active.user_id
  `
    .returnsRow({
      email: users.columns.email,
      post_count: authorsWithPosts.returns.post_count,
    })
    .build();
  type Row = ResultType<typeof plan>;

  expectTypeOf<Row['email']>().toEqualTypeOf<string>();
  expectTypeOf<Row['post_count']>().toEqualTypeOf<bigint>();
});
