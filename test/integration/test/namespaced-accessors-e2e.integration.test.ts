/**
 * Explicit namespaced accessors queryable end-to-end (PGlite).
 *
 * Exercises the genuine hard case for namespaced resolution: the SAME bare
 * table name (`users`) is declared in BOTH the `public` and `auth` namespaces
 * with DIFFERENT columns (public has `email`, auth has `token`), the SAME bare
 * model name (`User`) lives in both, and `public.Profile` carries a
 * cross-namespace foreign key to `auth.User`.
 *
 * The fixture type-checks against a committed per-namespace `contract.d.ts` and
 * is driven against a real database through the `postgres<Contract>` facade.
 *
 * The distinct per-namespace columns are the discriminator at BOTH levels: a
 * mis-qualified query would read the wrong table's columns or fail outright,
 * and the per-namespace surface is type-checked directly — `db.sql.public.users`
 * exposes `email` (not `token`) and `db.sql.auth.users` exposes `token` (not
 * `email`). Access is via the explicit coordinate accessors only
 * (`sql.<ns>.<table>` / `orm.<ns>.<Model>`).
 */

import { instantiateExecutionStack } from '@internal/framework-components/execution';
import postgres from '@internal/postgres/runtime';
import { contractFromJson } from '@internal/postgres/static';
import type { ForeignKey, SqlStorage } from '@internal/sql-contract/types';
import type { Runtime } from '@internal/sql-runtime';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { contract } from './namespaced-accessors/fixtures/contract';
import type { Contract } from './namespaced-accessors/fixtures/generated/contract';
import contractJson from './namespaced-accessors/fixtures/generated/contract.json' with {
  type: 'json',
};

const serializer = new PostgresContractSerializer();

type Row = Record<string, unknown>;

async function rows(result: AsyncIterable<Row>): Promise<Row[]> {
  const out: Row[] = [];
  for await (const row of result) {
    out.push(row);
  }
  return out;
}

describe('explicit namespaced accessors end-to-end (PGlite)', () => {
  it('emits the multi-namespace contract.json with same bare table name + cross-namespace FK', () => {
    const serialized = serializer.serializeContract(contract);
    const roundTripped = serializer.deserializeContract(serialized);
    const storage = roundTripped.storage as SqlStorage;

    // Same bare table name `users` in BOTH namespaces, with DIFFERENT columns.
    const publicNs = storage.namespaces['public'];
    const authNs = storage.namespaces['auth'];
    const publicUsers = publicNs !== undefined ? publicNs.entries.table?.['users'] : undefined;
    const authUsers = authNs !== undefined ? authNs.entries.table?.['users'] : undefined;
    expect(publicUsers).toBeDefined();
    expect(authUsers).toBeDefined();
    expect(Object.keys(publicUsers!.columns).sort()).toEqual(['email', 'id']);
    expect(Object.keys(authUsers!.columns).sort()).toEqual(['id', 'token']);

    // Cross-namespace FK: public.profile.user_id -> auth.users.id.
    const profileTable = publicNs !== undefined ? publicNs.entries.table?.['profile'] : undefined;
    expect(profileTable).toBeDefined();
    const fks: readonly ForeignKey[] = profileTable!.foreignKeys ?? [];
    expect(fks).toHaveLength(1);
    expect(fks[0]).toMatchObject({
      target: { namespaceId: 'auth', tableName: 'users', columns: ['id'] },
    });

    // Domain carries the `User` model in BOTH namespaces (same bare model name),
    // and the cross-namespace relation coordinate on Profile.user.
    const domain = roundTripped.domain.namespaces as Record<
      string,
      {
        models: Record<
          string,
          { relations?: Record<string, { to: { model: string; namespace: string } }> }
        >;
      }
    >;
    expect(domain['public']?.models['User']).toBeDefined();
    expect(domain['auth']?.models['User']).toBeDefined();
    expect(domain['public']?.models['Profile']?.relations?.['user']?.to).toEqual({
      model: 'User',
      namespace: 'auth',
    });
  });

  it(
    'drives sql + orm CRUD on both namespaces and the cross-namespace relation through the facade',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const client = new Client({ connectionString });
        await client.connect();
        const db = postgres({ contract: contractFromJson<Contract>(contractJson) });
        try {
          await client.query('create schema if not exists auth');
          await client.query(
            'create table "public"."users" (id int4 primary key, email text not null)',
          );
          await client.query(
            'create table "auth"."users" (id int4 primary key, token text not null)',
          );
          await client.query(
            'create table "public"."profile" (id int4 primary key, user_id int4 not null references "auth"."users"(id))',
          );

          const runtime: Runtime = await db.connect({ pg: client });
          const sql = db.sql;
          const orm = db.orm;

          // Per-namespace isolation is enforced at the type level: a column or
          // field belongs to exactly one namespace's `users` / `User`, so the
          // other namespace's name is a compile error. Dead code — type-checked,
          // never executed.
          const _perNamespaceIsolation = () => {
            // @ts-expect-error `token` is an auth.users column, not public.users
            sql.public.users.select('token');
            // @ts-expect-error `email` is a public.users column, not auth.users
            sql.auth.users.select('email');
            // @ts-expect-error `token` is an auth.User field, not public.User
            void orm.public.User.create({ id: 0, token: 'x' });
            // @ts-expect-error `email` is a public.User field, not auth.User
            void orm.auth.User.create({ id: 0, email: 'x' });
          };
          void _perNamespaceIsolation;

          const adapter = instantiateExecutionStack(db.stack).adapter;

          const publicSelectPlan = sql.public.users.select('id', 'email').build();
          const authSelectPlan = sql.auth.users.select('id', 'token').build();
          expect(
            adapter.lower(publicSelectPlan.ast, {
              contract: db.context.contract,
              params: publicSelectPlan.params,
            }).sql,
          ).toContain('"public"."users"');
          expect(
            adapter.lower(authSelectPlan.ast, {
              contract: db.context.contract,
              params: authSelectPlan.params,
            }).sql,
          ).toContain('"auth"."users"');

          await runtime.execute(sql.public.users.insert([{ id: 1, email: 'pub@x.io' }]).build());
          await runtime.execute(sql.auth.users.insert([{ id: 1, token: 'tok-1' }]).build());

          // Distinct columns prove qualification: public.users has `email`,
          // auth.users has `token`.
          expect(await rows(runtime.query(sql.public.users.select('id', 'email').build()))).toEqual(
            [{ id: 1, email: 'pub@x.io' }],
          );
          expect(await rows(runtime.query(sql.auth.users.select('id', 'token').build()))).toEqual([
            { id: 1, token: 'tok-1' },
          ]);

          await runtime.execute(
            sql.public.users
              .update({ email: 'pub2@x.io' })
              .where((f, fns) => fns.eq(f.id, 1))
              .build(),
          );
          await runtime.execute(
            sql.auth.users
              .update({ token: 'tok-2' })
              .where((f, fns) => fns.eq(f.id, 1))
              .build(),
          );
          expect(
            (await client.query('select email from "public"."users" where id = 1')).rows[0],
          ).toEqual({ email: 'pub2@x.io' });
          expect(
            (await client.query('select token from "auth"."users" where id = 1')).rows[0],
          ).toEqual({ token: 'tok-2' });

          await runtime.execute(
            sql.public.users
              .delete()
              .where((f, fns) => fns.eq(f.id, 1))
              .build(),
          );
          await runtime.execute(
            sql.auth.users
              .delete()
              .where((f, fns) => fns.eq(f.id, 1))
              .build(),
          );
          expect((await client.query('select * from "public"."users"')).rows).toHaveLength(0);
          expect((await client.query('select * from "auth"."users"')).rows).toHaveLength(0);

          expect(await orm.public.User.create({ id: 10, email: 'alice@x.io' })).toEqual({
            id: 10,
            email: 'alice@x.io',
          });
          expect(await orm.auth.User.create({ id: 20, token: 'auth-tok' })).toEqual({
            id: 20,
            token: 'auth-tok',
          });

          expect(await orm.public.User.where({ id: 10 }).first()).toEqual({
            id: 10,
            email: 'alice@x.io',
          });
          expect(await orm.auth.User.where({ id: 20 }).first()).toEqual({
            id: 20,
            token: 'auth-tok',
          });

          await orm.public.User.where({ id: 10 }).updateAndCount({ email: 'alice2@x.io' });
          await orm.auth.User.where({ id: 20 }).updateAndCount({ token: 'auth-tok-2' });
          expect((await orm.public.User.where({ id: 10 }).first())?.email).toBe('alice2@x.io');
          expect((await orm.auth.User.where({ id: 20 }).first())?.token).toBe('auth-tok-2');

          await orm.public.Profile.create({ id: 100, userId: 20 });
          const withUser = await orm.public.Profile.where({ id: 100 }).include('user').first();
          // The included `user` is the auth.User row (distinct `token` column).
          expect(withUser).toMatchObject({
            id: 100,
            userId: 20,
            user: { id: 20, token: 'auth-tok-2' },
          });

          await orm.public.User.where({ id: 10 }).deleteAndCount();
          expect(await orm.public.User.where({ id: 10 }).first()).toBeNull();
        } finally {
          await db.close();
          await client.end();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );
});
