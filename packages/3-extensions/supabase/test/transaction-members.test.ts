import type { PostgresTransactionOptions } from '@internal/postgres/runtime';
import { contractFromJson } from '@internal/postgres/static';
import { Collection } from '@internal/sql-orm-client';
import { startActivityOn } from '@internal/sql-runtime';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as roleRuntime from '../src/runtime/supabase-runtime';

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

describe.each(['anon', 'service_role'] as const)('isolation options under %s', (role) => {
  it.each([
    [undefined, undefined, 'BEGIN'],
    [{}, {}, 'BEGIN'],
    [{ isolationLevel: undefined }, { isolationLevel: undefined }, 'BEGIN'],
    [{ isolationLevel: 'RepeatableRead' }, undefined, 'BEGIN ISOLATION LEVEL REPEATABLE READ'],
    [{ isolationLevel: 'RepeatableRead' }, {}, 'BEGIN ISOLATION LEVEL REPEATABLE READ'],
    [
      { isolationLevel: 'RepeatableRead' },
      { isolationLevel: undefined },
      'BEGIN ISOLATION LEVEL REPEATABLE READ',
    ],
    [
      { isolationLevel: 'RepeatableRead' },
      { isolationLevel: 'Serializable' },
      'BEGIN ISOLATION LEVEL SERIALIZABLE',
    ],
    [undefined, { isolationLevel: 'ReadUncommitted' }, 'BEGIN ISOLATION LEVEL READ UNCOMMITTED'],
    [undefined, { isolationLevel: 'ReadCommitted' }, 'BEGIN ISOLATION LEVEL READ COMMITTED'],
  ] as const)('resolves global %j and local %j', async (global, local, begin) => {
    await using db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      verifyMarker: false,
      jwtSecret: 'test-secret',
      transactionOptions: global,
    });
    const bound = role === 'anon' ? db.asAnon() : db.asServiceRole();
    expect(
      await bound.transaction(async (tx) => tx.orm.public.Profile.select('id').all(), local),
    ).toEqual([]);
    expect(recorded.statements).toEqual(
      underRole(role, [
        [begin],
        ['SELECT "profile"."id" AS "id" FROM "public"."profile"', []],
        ['COMMIT'],
      ]),
    );
  });

  it.each([
    null,
    1,
    'Serializable',
    { isolationLevel: null },
    { isolationLevel: false },
    { isolationLevel: 'unknown' },
    { isolationLevel: 'Serializable; SELECT 1' },
    { unknown: true },
  ])('rejects %j before role acquisition', async (value) => {
    await expect(
      supabase({
        contract,
        jwtSecret: 'test-secret',
        transactionOptions: value as PostgresTransactionOptions,
      }),
    ).rejects.toMatchObject({ code: 'RUNTIME.ARGUMENT_INVALID' });
    await using db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: 'test-secret',
      verifyMarker: false,
    });
    const bound = role === 'anon' ? db.asAnon() : db.asServiceRole();
    const callback = vi.fn(async () => 42);
    await expect(async () =>
      bound.transaction(callback, value as PostgresTransactionOptions),
    ).rejects.toMatchObject({ code: 'RUNTIME.ARGUMENT_INVALID' });
    expect(recorded.connections).toBe(0);
    expect(recorded.statements).toEqual([]);
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('isolation across Supabase roots and user roles', () => {
  it('applies selected isolation after JWT role setup on the same connection', async () => {
    const secret = 'test-secret';
    const claims = { role: 'authenticated', sub: 'user-1' };
    const jwt = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode(secret));
    await using db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: secret,
      verifyMarker: false,
      transactionOptions: { isolationLevel: 'Serializable' },
    });
    const user = await db.asUser(jwt);
    expect(await user.transaction(async () => 42, { isolationLevel: 'ReadCommitted' })).toBe(42);
    const connection = recorded.statements[0]?.connection;
    expect(recorded.statements).toEqual([
      { connection, text: 'SELECT set_config($1, $2, false)', values: ['role', 'authenticated'] },
      {
        connection,
        text: 'SELECT set_config($1, $2, false)',
        values: ['request.jwt.claims', JSON.stringify(claims)],
      },
      { connection, text: 'BEGIN ISOLATION LEVEL READ COMMITTED' },
      { connection, text: 'COMMIT' },
      { connection, text: 'RESET ALL', values: [] },
      { connection, text: 'RESET ROLE', values: [] },
    ]);
  });

  it('keeps implicit activity starts on both actual root scopes free of callback defaults', async () => {
    const original = roleRuntime.roleScope;
    const scopes: ReturnType<typeof original>[] = [];
    const capture = vi.spyOn(roleRuntime, 'roleScope').mockImplementation((...args) => {
      const scope = original(...args);
      scopes.push(scope);
      return scope;
    });
    try {
      await using db = await supabase({
        contract,
        url: 'postgres://localhost/db',
        jwtSecret: 'test-secret',
        verifyMarker: false,
        transactionOptions: { isolationLevel: 'Serializable' },
      });
      const service = db.asServiceRole();
      expect('transaction' in service.supabase).toBe(false);
      expect(scopes).toHaveLength(2);
      for (const scope of scopes) {
        recorded.statements.length = 0;
        const activity = await startActivityOn(scope, {
          kind: 'test-call',
          contentHash: async () => 'test',
        });
        const tx = await activity.transaction?.(undefined);
        if (!tx) throw new Error('Expected transaction');
        await tx.commit();
        await activity.end({ outcome: 'succeeded' });
        expect(recorded.statements).toEqual(underRole('service_role', [['BEGIN'], ['COMMIT']]));
      }
    } finally {
      capture.mockRestore();
    }
  });
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
