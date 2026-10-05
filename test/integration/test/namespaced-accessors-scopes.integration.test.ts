import { field } from '@internal/postgres/contract-builder';
import postgres from '@internal/postgres/runtime';
import type { CollectionRowOf } from '@internal/sql-orm-client';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { Client } from 'pg';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Contract } from './namespaced-accessors/fixtures/generated/contract';
import contractJson from './namespaced-accessors/fixtures/generated/contract.json' with {
  type: 'json',
};

describe('scopes on a contract with the same model name in two namespaces', () => {
  it(
    'type and run a scope against the namespace of the collection it is applied to',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const client = new Client({ connectionString });
        await client.connect();
        const db = postgres<Contract>({ contractJson });
        try {
          await client.query('create schema if not exists auth');
          await client.query(
            'create table "public"."users" (id int4 primary key, email text not null)',
          );
          await client.query(
            'create table "auth"."users" (id int4 primary key, token text not null)',
          );
          await client.query(`insert into "public"."users" values (1, 'pub@x.io')`);
          await client.query(`insert into "auth"."users" values (1, 'tok-1'), (2, 'tok-2')`);
          await db.connect({ pg: client });
          const { orm } = db;

          const tokens = orm.auth.User.scope((users) =>
            users.where((u) => u.token.like('tok-%')).orderBy((u) => u.id.asc()),
          );
          expectTypeOf<keyof CollectionRowOf<ReturnType<typeof tokens>>>().toEqualTypeOf<
            'id' | 'token'
          >();
          expect(await orm.auth.User.apply(tokens).all()).toEqual([
            { id: 1, token: 'tok-1' },
            { id: 2, token: 'tok-2' },
          ]);
          const _wrongNamespace = () => {
            // @ts-expect-error public.User has no token, so its rows are not the rows of auth.User
            orm.public.User.apply(tokens);
          };
          void _wrongNamespace;

          const withToken = (token: string) =>
            orm.scope({ token: field.text() }, (rows) => rows.where((r) => r.token.eq(token)));
          expect(await orm.auth.User.apply(withToken('tok-2')).all()).toEqual([
            { id: 2, token: 'tok-2' },
          ]);
          const _noTokenInPublic = () => {
            // @ts-expect-error public.User has no token field
            orm.public.User.apply(withToken('tok-2'));
          };
          void _noTokenInPublic;
          expect(() =>
            (orm.public.User.apply as (scope: unknown) => unknown)(withToken('tok-2')),
          ).toThrow(expect.objectContaining({ code: 'ORM.FIELD_UNKNOWN' }));
        } finally {
          await db.close();
          await client.end();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );
});
