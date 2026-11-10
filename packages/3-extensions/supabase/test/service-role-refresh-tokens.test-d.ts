/**
 * Type-level: the `.supabase` secondary root's typed surface includes
 * `auth.refresh_tokens` (`.sql`) / `auth.RefreshTokens` (`.orm`) — a table
 * that comes from the introspection-generated complete contract rather than
 * the originally hand-declared set.
 *
 * Complements `examples/supabase/test/service-role-namespaces.test-d.ts`,
 * which only proves the `auth`/`storage` namespaces exist on `.supabase`
 * (and not on the primary root); this file proves a specific table inside
 * `auth` is actually typed. It uses the pack's own minimal test app
 * contract rather than an example app's — the `.supabase` secondary root's
 * shape comes from the pack's own emitted contract, not from the app
 * contract, so no example app is needed.
 */

import type { SupabaseDb } from '@internal/extension-supabase/runtime';
import { defineContract, field, model } from '@internal/postgres/contract-builder';
import { expectTypeOf, test } from 'vitest';
import supabasePack from '../src/exports/pack';

const pgUuid = { codecId: 'pg/uuid@1', dataType: 'pg/uuid', nullable: false } as const;

const Item = model('Item', {
  fields: {
    id: field.column(pgUuid).id(),
  },
}).sql({ table: 'item' });

const appContract = defineContract({
  extensions: { supabase: supabasePack },
  models: { Item },
});

type AppContract = typeof appContract;

const db = {} as SupabaseDb<AppContract>;

test('asServiceRole().supabase.sql.auth exposes refresh_tokens', () => {
  const internal = db.asServiceRole().supabase;
  expectTypeOf(internal.sql.auth).toHaveProperty('refresh_tokens');
});

test('asServiceRole().supabase.orm.auth exposes RefreshTokens', () => {
  const internal = db.asServiceRole().supabase;
  expectTypeOf(internal.orm.auth).toHaveProperty('RefreshTokens');
});
