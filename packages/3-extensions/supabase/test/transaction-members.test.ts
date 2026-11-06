import { contractFromJson } from '@internal/postgres/static';
import { Collection } from '@internal/sql-orm-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const recorded = vi.hoisted(() => ({
  statements: [] as Array<{
    readonly connection: number;
    readonly text: string;
    readonly values?: readonly unknown[];
  }>,
  connections: 0,
}));

vi.mock('pg', () => {
  function recordingQuery(connection: number) {
    return vi.fn(
      async (
        request: string | { readonly text: string; readonly values?: unknown[] },
        values?: unknown[],
      ) => {
        const text = typeof request === 'string' ? request : request.text;
        const params = typeof request === 'string' ? values : request.values;
        recorded.statements.push(
          params === undefined ? { connection, text } : { connection, text, values: params },
        );
        return { rows: [], rowCount: 0 };
      },
    );
  }
  class Pool {
    on = vi.fn().mockReturnThis();
    connect = vi.fn(async () => ({
      query: recordingQuery(++recorded.connections),
      release: vi.fn(),
      on: vi.fn(),
    }));
    end = vi.fn().mockResolvedValue(undefined);
  }
  class Client {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue(undefined);
    query = recordingQuery(++recorded.connections);
    end = vi.fn().mockResolvedValue(undefined);
    release = vi.fn();
  }
  return { Pool, Client };
});

import supabase from '../src/runtime/supabase';
import type { Contract } from './fixtures/example-app/contract';
import contractJson from './fixtures/example-app/contract.json' with { type: 'json' };

class ProfileCollection extends Collection<Contract, 'Profile'> {
  named(username: string) {
    return this.where({ username });
  }
}

const contract = contractFromJson<Contract>(contractJson);

function underRole(
  role: string,
  statements: ReadonlyArray<readonly [string, readonly unknown[]] | readonly [string]>,
) {
  const connection = recorded.statements[0]?.connection;
  return [
    { connection, text: 'SELECT set_config($1, $2, false)', values: ['role', role] },
    { connection, text: 'SELECT set_config($1, $2, false)', values: ['request.jwt.claims', '{}'] },
    ...statements.map(([text, values]) =>
      values === undefined ? { connection, text } : { connection, text, values },
    ),
    { connection, text: 'RESET ALL', values: [] },
    { connection, text: 'RESET ROLE', values: [] },
  ];
}

const selectByName = 'SELECT "id" AS "id" FROM "public"."profile" WHERE "username" = $1';

afterEach(() => {
  recorded.statements.length = 0;
  recorded.connections = 0;
});

describe('a transaction on a supabase role-bound client', () => {
  it('offers sql, raw, prepare and orm, and runs every statement inside the transaction under the role', async () => {
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      verifyMarker: false,
      jwtSecret: 'fixture-jwt-signing-input-not-a-real-credential',
      collections: { Profile: ProfileCollection },
    });

    await db.asAnon().transaction(async (tx) => {
      await tx.query(tx.sql.public.profile.select('id').build());
      await tx.execute(tx.raw.sql`UPDATE profile SET username = username`.affectedCount().build());
      const byName = await tx.prepare({ username: 'pg/text@1' }, (params) =>
        tx.sql.public.profile
          .select('id')
          .where((f, fns) => fns.eq(f.username, params.username))
          .build(),
      );
      await byName.query(tx, { username: 'ada' });
      await tx.orm.public.Profile.named('ada').all();
    });
    await db.close();

    expect(recorded.statements).toEqual(
      underRole('anon', [
        ['BEGIN'],
        ['SELECT "id" AS "id" FROM "public"."profile"', []],
        ['UPDATE profile SET username = username', []],
        [selectByName, ['ada']],
        [
          'SELECT "profile"."id" AS "id", "profile"."userId" AS "userId", "profile"."username" AS "username" FROM "public"."profile" WHERE "profile"."username" = $1',
          ['ada'],
        ],
        ['COMMIT'],
      ]),
    );
  });

  it('prepares a statement on a role-bound client that runs under its role', async () => {
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      verifyMarker: false,
      jwtSecret: 'fixture-jwt-signing-input-not-a-real-credential',
    });
    const anon = db.asAnon();

    const byName = await anon.prepare({ username: 'pg/text@1' }, (params) =>
      anon.sql.public.profile
        .select('id')
        .where((f, fns) => fns.eq(f.username, params.username))
        .build(),
    );
    await byName.query(anon, { username: 'ada' });
    await db.close();

    expect(recorded.statements).toEqual(underRole('anon', [[selectByName, ['ada']]]));
  });

  it('runs a statement prepared on the service role client under the service role', async () => {
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      verifyMarker: false,
      jwtSecret: 'fixture-jwt-signing-input-not-a-real-credential',
    });
    const serviceRole = db.asServiceRole();

    const byName = await serviceRole.prepare({ username: 'pg/text@1' }, (params) =>
      serviceRole.sql.public.profile
        .select('id')
        .where((f, fns) => fns.eq(f.username, params.username))
        .build(),
    );
    await byName.query(serviceRole, { username: 'ada' });
    await db.close();

    expect(recorded.statements).toEqual(underRole('service_role', [[selectByName, ['ada']]]));
  });

  it('runs a prepared ORM read on a role-bound client, its service role copy and a transaction under the role', async () => {
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      verifyMarker: false,
      jwtSecret: 'fixture-jwt-signing-input-not-a-real-credential',
    });
    const selectIds = 'SELECT "profile"."id" AS "id" FROM "public"."profile"';
    const runs: Array<Array<{ readonly connection: number; readonly text: string }>> = [];
    const run = async (body: () => PromiseLike<unknown>) => {
      recorded.statements.length = 0;
      await body();
      runs.push(recorded.statements.map(({ connection, text }) => ({ connection, text })));
    };

    const anon = db.asAnon();
    const serviceRole = db.asServiceRole();
    const anonIds = await anon.prepare({}, () =>
      anon.orm.public.Profile.select('id').prepared.all(),
    );
    const serviceIds = await serviceRole.prepare({}, () =>
      serviceRole.orm.public.Profile.select('id').prepared.all(),
    );
    await run(() => anonIds.query(anon, {}));
    await run(() => serviceIds.query(serviceRole, {}));
    await run(() => anon.transaction(async (tx) => anonIds.query(tx, {})));
    await db.close();

    const framed =
      (middle: readonly string[]) =>
      (statements: ReadonlyArray<{ readonly connection: number }>) => {
        const connection = statements[0]?.connection;
        return [
          'SELECT set_config($1, $2, false)',
          'SELECT set_config($1, $2, false)',
          ...middle,
          'RESET ALL',
          'RESET ROLE',
        ].map((text) => ({ connection, text }));
      };
    expect(runs).toEqual([
      framed([selectIds])(runs[0] ?? []),
      framed([selectIds])(runs[1] ?? []),
      framed(['BEGIN', selectIds, 'COMMIT'])(runs[2] ?? []),
    ]);
  });
});
