import type { Contract as ContractBase } from '@internal/contract/types';
import { expectTypeOf, test } from 'vitest';
import { PostgresContractView } from '../src/core/postgres-contract-view';
import type { Contract } from './fixtures/namespaced-contract.d';

/**
 * Emit-then-consume type tests against a REAL emitted multi-schema Postgres
 * contract (`test/fixtures/namespaced-contract.d.ts`). The fixture declares the
 * SAME bare table `users` in BOTH `public` (column `email`) and `auth` (column
 * `token`) — the discriminator that proves per-schema qualification. Schemas are
 * reached ONLY via `view.namespace.<id>` (mirroring `db.enums.<ns>`); there is no
 * root schema-name promotion.
 */

type CV = PostgresContractView<Contract>;

test('the view is assignable to Contract (superset)', () => {
  expectTypeOf<CV>().toMatchTypeOf<ContractBase>();
});

test('from() and fromJson() both return the view type', () => {
  expectTypeOf(PostgresContractView.from<Contract>).returns.toEqualTypeOf<CV>();
  expectTypeOf(PostgresContractView.fromJson<Contract>).returns.toEqualTypeOf<CV>();
});

test('view.namespace.<id> reaches each schema with its own table columns', () => {
  expectTypeOf<
    CV['namespace']['public']['table']['users']['columns']['email']['codecId']
  >().toEqualTypeOf<'pg/text@1'>();
  expectTypeOf<
    CV['namespace']['auth']['table']['users']['columns']['token']['codecId']
  >().toEqualTypeOf<'pg/text@1'>();
});

test('cross-schema column access is a compile error', () => {
  const view = null as unknown as CV;
  // @ts-expect-error public.users has no `token` column (that is auth.users)
  view.namespace.public.table.users.columns.token;
  // @ts-expect-error auth.users has no `email` column (that is public.users)
  view.namespace.auth.table.users.columns.email;
});

test('a non-existent schema key is a compile error', () => {
  const view = null as unknown as CV;
  // @ts-expect-error 'marketing' is not an emitted schema
  view.namespace.marketing;
});

test('a non-existent table name in a schema is a compile error', () => {
  const view = null as unknown as CV;
  // @ts-expect-error 'orders' is not a table in the public schema
  view.namespace.public.table.orders;
});

test('schema names are NOT promoted to the contract root (no collision)', () => {
  // `public` is a schema, reached via `.namespace.public`, never a root key.
  type RootHasPublic = 'public' extends keyof CV ? true : false;
  expectTypeOf<RootHasPublic>().toEqualTypeOf<false>();
});

test('the cross-schema foreign key on public.profile is reachable', () => {
  expectTypeOf<
    CV['namespace']['public']['table']['profile']['foreignKeys'][0]['target']['namespaceId']
  >().toEqualTypeOf<'auth' & import('@internal/contract/types').NamespaceId>();
});

test('valueSet slot is present per schema (none emitted, so empty maps)', () => {
  expectTypeOf<CV['namespace']['public']['valueSet']>().toEqualTypeOf<Record<string, never>>();
  expectTypeOf<CV['namespace']['auth']['valueSet']>().toEqualTypeOf<Record<string, never>>();
});

test('view.namespace.<ns>.entries excludes the built-in table and valueSet keys', () => {
  type PublicEntries = CV['namespace']['public']['entries'];
  type HasTable = 'table' extends keyof PublicEntries ? true : false;
  type HasValueSet = 'valueSet' extends keyof PublicEntries ? true : false;
  expectTypeOf<HasTable>().toEqualTypeOf<false>();
  expectTypeOf<HasValueSet>().toEqualTypeOf<false>();
});
