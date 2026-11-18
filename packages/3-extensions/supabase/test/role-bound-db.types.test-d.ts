/**
 * Type-level invariant: RoleBoundDb must not expose a connection() method.
 *
 * The security guarantee is facade-encapsulation — SupabaseRuntimeImpl inherits
 * a public connection() from SqlRuntimeBase, but the role-bound Db surface must
 * never surface it. This test locks the compile-time side of that invariant.
 */

import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { SqlStatementStats } from '@internal/sql-relational-core/ast';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { expectTypeOf, test } from 'vitest';
import type * as runtimeEntry from '../src/exports/runtime';
import type { RoleBoundDb, SupabaseInternalDb } from '../src/runtime/supabase';
import type { RoleSession, SupabaseRuntime } from '../src/runtime/supabase-runtime';

type Row = { readonly id: string };
declare const plan: SqlQueryPlan<Row>;
declare const roleBoundDb: RoleBoundDb<never>;
declare const internalDb: SupabaseInternalDb;
declare const session: RoleSession;
declare const runtime: SupabaseRuntime;

test('RoleBoundDb has no connection property', () => {
  expectTypeOf<RoleBoundDb<never>>().not.toHaveProperty('connection');
});

test('role-bound public roots expose row query and statistics execute', () => {
  expectTypeOf(roleBoundDb.query(plan)).toEqualTypeOf<AsyncIterableResult<Row>>();
  expectTypeOf(roleBoundDb.execute(plan)).toEqualTypeOf<Promise<SqlStatementStats>>();
  expectTypeOf(internalDb.query(plan)).toEqualTypeOf<AsyncIterableResult<Row>>();
  expectTypeOf(internalDb.execute(plan)).toEqualTypeOf<Promise<SqlStatementStats>>();
});

test('a role scope exposes row query, statistics execute and its session', () => {
  const role = runtime.forRole({ role: 'anon' });
  expectTypeOf(role.query(plan)).toEqualTypeOf<AsyncIterableResult<Row>>();
  expectTypeOf(role.execute(plan)).toEqualTypeOf<Promise<SqlStatementStats>>();
  expectTypeOf(role.connection()).toEqualTypeOf<Promise<RoleSession>>();
});

test('a Supabase runtime has no method that takes a role binding per call', () => {
  expectTypeOf<
    Extract<
      keyof SupabaseRuntime,
      'queryWithRole' | 'executeWithRole' | 'preparedQueryWithRole' | 'preparedExecuteWithRole'
    >
  >().toBeNever();
});

test('role session and transaction expose row query and statistics execute', async () => {
  expectTypeOf(session.query(plan)).toEqualTypeOf<AsyncIterableResult<Row>>();
  expectTypeOf(session.execute(plan)).toEqualTypeOf<Promise<SqlStatementStats>>();

  const transaction = await session.transaction();
  expectTypeOf(transaction.query(plan)).toEqualTypeOf<AsyncIterableResult<Row>>();
  expectTypeOf(transaction.execute(plan)).toEqualTypeOf<Promise<SqlStatementStats>>();
});

test('the role-bound and internal clients do not expose startActivity or planContentHash', () => {
  expectTypeOf<RoleBoundDb<never>>().not.toHaveProperty('startActivity');
  expectTypeOf<RoleBoundDb<never>>().not.toHaveProperty('planContentHash');
  expectTypeOf<SupabaseInternalDb>().not.toHaveProperty('startActivity');
  expectTypeOf<SupabaseInternalDb>().not.toHaveProperty('planContentHash');
});

test('forRole is the only published way to get a role scope', () => {
  expectTypeOf<typeof runtimeEntry>().not.toHaveProperty('roleScope');
  expectTypeOf<typeof runtimeEntry.SupabaseRuntimeImpl>().not.toHaveProperty('roleScope');
});
