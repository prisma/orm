import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import {
  PostgresAlterPolicyRename,
  PostgresCreatePolicy,
  PostgresDisableRowLevelSecurity,
  PostgresDropPolicy,
} from '@internal/target-postgres/ddl';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../src/core/control-adapter';
import type { PostgresContract } from '../src/core/types';

const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
const ctx = { contract: {} as PostgresContract };

describe('PostgresControlAdapter.lowerToExecuteRequest — RLS DDL', () => {
  it('renders CREATE POLICY with quoted identifiers and verbatim predicate', async () => {
    const ast = new PostgresCreatePolicy({
      schema: 'public',
      table: 'profiles',
      name: 'p_read_ab12cd34',
      permissive: true,
      operation: 'select',
      roles: ['app_user'],
      using: '(auth.uid() = user_id)',
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: 'CREATE POLICY "p_read_ab12cd34" ON "public"."profiles" AS PERMISSIVE FOR SELECT TO app_user USING ((auth.uid() = user_id))',
      params: [],
    });
  });

  // FOR INSERT takes WITH CHECK only (no USING) — the new-row validation clause.
  it('renders FOR INSERT with WITH CHECK and no USING', async () => {
    const ast = new PostgresCreatePolicy({
      schema: 'public',
      table: 'profiles',
      name: 'p_ins_ab12cd34',
      permissive: true,
      operation: 'insert',
      roles: ['app_user'],
      withCheck: "(owner_id = current_setting('app.uid')::int)",
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: 'CREATE POLICY "p_ins_ab12cd34" ON "public"."profiles" AS PERMISSIVE FOR INSERT TO app_user WITH CHECK ((owner_id = current_setting(\'app.uid\')::int))',
      params: [],
    });
  });

  // FOR UPDATE takes both — USING selects rows, WITH CHECK validates the new
  // row. USING must precede WITH CHECK (Postgres clause order).
  it('renders FOR UPDATE with USING before WITH CHECK', async () => {
    const ast = new PostgresCreatePolicy({
      schema: 'public',
      table: 'profiles',
      name: 'p_upd_ab12cd34',
      permissive: true,
      operation: 'update',
      roles: ['app_user'],
      using: '(owner_id = 1)',
      withCheck: '(owner_id = 2)',
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: 'CREATE POLICY "p_upd_ab12cd34" ON "public"."profiles" AS PERMISSIVE FOR UPDATE TO app_user USING ((owner_id = 1)) WITH CHECK ((owner_id = 2))',
      params: [],
    });
  });

  // FOR DELETE takes USING only.
  it('renders FOR DELETE with USING and no WITH CHECK', async () => {
    const ast = new PostgresCreatePolicy({
      schema: 'public',
      table: 'profiles',
      name: 'p_del_ab12cd34',
      permissive: true,
      operation: 'delete',
      roles: ['app_user'],
      using: '(owner_id = 1)',
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: 'CREATE POLICY "p_del_ab12cd34" ON "public"."profiles" AS PERMISSIVE FOR DELETE TO app_user USING ((owner_id = 1))',
      params: [],
    });
  });

  // FOR ALL takes both, USING before WITH CHECK.
  it('renders FOR ALL with USING before WITH CHECK', async () => {
    const ast = new PostgresCreatePolicy({
      schema: 'public',
      table: 'profiles',
      name: 'p_all_ab12cd34',
      permissive: true,
      operation: 'all',
      roles: ['app_user'],
      using: '(owner_id = 1)',
      withCheck: '(owner_id = 2)',
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: 'CREATE POLICY "p_all_ab12cd34" ON "public"."profiles" AS PERMISSIVE FOR ALL TO app_user USING ((owner_id = 1)) WITH CHECK ((owner_id = 2))',
      params: [],
    });
  });

  // RESTRICTIVE + multiple roles render alongside WITH CHECK.
  it('renders AS RESTRICTIVE with multiple roles and WITH CHECK', async () => {
    const ast = new PostgresCreatePolicy({
      schema: 'public',
      table: 'profiles',
      name: 'p_ins_restrict_ab12cd34',
      permissive: false,
      operation: 'insert',
      roles: ['app_user', 'admin'],
      withCheck: '(owner_id = 1)',
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: 'CREATE POLICY "p_ins_restrict_ab12cd34" ON "public"."profiles" AS RESTRICTIVE FOR INSERT TO app_user, admin WITH CHECK ((owner_id = 1))',
      params: [],
    });
  });

  it('renders DROP POLICY with quoted identifiers', async () => {
    const ast = new PostgresDropPolicy({
      schema: 'public',
      table: 'profiles',
      name: 'p_read_ab12cd34',
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: 'DROP POLICY "p_read_ab12cd34" ON "public"."profiles"',
      params: [],
    });
  });

  it('renders ALTER TABLE … DISABLE ROW LEVEL SECURITY', async () => {
    const ast = new PostgresDisableRowLevelSecurity({ schema: 'public', table: 'profiles' });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: 'ALTER TABLE "public"."profiles" DISABLE ROW LEVEL SECURITY',
      params: [],
    });
  });

  it('renders ALTER POLICY … RENAME TO with all identifiers quoted', async () => {
    const ast = new PostgresAlterPolicyRename({
      schema: 'public',
      table: 'profiles',
      name: 'read_own_profiles_ab12cd34',
      newName: 'owner_read_profiles_ab12cd34',
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: 'ALTER POLICY "read_own_profiles_ab12cd34" ON "public"."profiles" RENAME TO "owner_read_profiles_ab12cd34"',
      params: [],
    });
  });
});
