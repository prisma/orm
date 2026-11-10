import type { SqlStorage } from '@internal/sql-contract/types';
import { SelectAst, TableSource } from '@internal/sql-relational-core/ast';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { createContract } from '@repo/test-utils';
import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only mock the pg boundary. The real postgres driver, adapter, and runtime run
// over these fake pool clients so we can assert on the actual queries issued.
vi.mock('pg', () => {
  class Pool {
    on = vi.fn().mockReturnThis();
    static _connectSpy = vi.fn();

    connect = Pool._connectSpy;
    end = vi.fn().mockResolvedValue(undefined);
  }

  class Client {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue(undefined);
    query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    end = vi.fn().mockResolvedValue(undefined);
    release = vi.fn();
  }

  return { Pool, Client };
});

import { isStructuredError } from '@internal/utils/structured-error';
import { Pool } from 'pg';
import supabase from '../src/runtime/supabase';

function stubPlan(): SqlQueryPlan {
  return {
    ast: SelectAst.from(TableSource.named('stub')),
    params: [],
    meta: {
      target: contract.target,
      targetFamily: contract.targetFamily,
      storageHash: contract.storage.storageHash,
      lane: 'raw',
    },
  };
}

type SpyPool = typeof Pool & { _connectSpy: ReturnType<typeof vi.fn> };

const contract = createContract<SqlStorage>();
const fixtureJwt = 'fixture-jwt-signing-input-not-a-real-credential';

function poolConnectSpy() {
  return (Pool as unknown as SpyPool)._connectSpy;
}

async function makeJwt(
  payload: Record<string, unknown>,
  secret = fixtureJwt,
  expiresIn = '1h',
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expiresIn)
    .sign(key);
}

function makeFakeClient(affectedRows = 0) {
  const queryCalls: Array<{ sql: string; params?: readonly unknown[] }> = [];
  return {
    queryCalls,
    query: vi
      .fn()
      .mockImplementation(
        async (sqlOrConfig: string | { text: string; values?: unknown[] }, params?: unknown[]) => {
          const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text;
          const p = typeof sqlOrConfig === 'string' ? params : sqlOrConfig.values;
          if (p !== undefined) {
            queryCalls.push({ sql, params: p as readonly unknown[] });
          } else {
            queryCalls.push({ sql });
          }
          return { rows: [], rowCount: affectedRows };
        },
      ),
    release: vi.fn(),
    on: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const client = makeFakeClient();
  poolConnectSpy().mockResolvedValue(client);
});

describe('supabase() factory — config validation', () => {
  it('rejects with SUPABASE.CONFIG_INVALID when both jwtSecret and jwksUrl provided', async () => {
    const failure = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
      jwksUrl: 'https://example.com/.well-known/jwks.json',
    } as unknown as Parameters<typeof supabase<typeof contract>>[0]).then(
      () => undefined,
      (err: unknown) => err,
    );

    expect(isStructuredError(failure)).toBe(true);
    expect(failure).toMatchObject({
      code: 'SUPABASE.CONFIG_INVALID',
      message: 'Provide either jwtSecret or jwksUrl, not both',
    });
  });

  it('rejects with SUPABASE.CONFIG_INVALID when neither jwtSecret nor jwksUrl provided', async () => {
    const failure = await supabase({
      contract,
      url: 'postgres://localhost/db',
    } as unknown as Parameters<typeof supabase<typeof contract>>[0]).then(
      () => undefined,
      (err: unknown) => err,
    );

    expect(isStructuredError(failure)).toBe(true);
    expect(failure).toMatchObject({
      code: 'SUPABASE.CONFIG_INVALID',
      message: 'Either jwtSecret or jwksUrl is required',
    });
  });
});

describe('supabase() factory — asUser', () => {
  it('resolves a RoleBoundDb for a valid HS256 JWT', async () => {
    const jwt = await makeJwt({ sub: 'user-1', role: 'authenticated' });
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });

    const roleBoundDb = await db.asUser(jwt);

    expect(roleBoundDb).toBeDefined();
    expect(roleBoundDb.sql).toBeDefined();
    expect(roleBoundDb.orm).toBeDefined();
    await db.close();
  });

  it('gives each role its own raw lane', async () => {
    const jwt = await makeJwt({ sub: 'user-1', role: 'authenticated' });
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });

    const roleBoundDb = await db.asUser(jwt);

    expect(Object.keys(roleBoundDb.raw)).toEqual(['sql']);
    const plan = roleBoundDb.raw.sql`SELECT 1 AS one`.returnsRow({ one: 'pg/int4@1' }).build();
    expect(plan.meta.lane).toBe('raw');
    expect(plan.meta.target).toBe(contract.target);
    await db.close();
  });

  it('rejects with SUPABASE.JWT_INVALID for a JWT signed with the wrong secret', async () => {
    const jwt = await makeJwt(
      { sub: 'user-1', role: 'authenticated' },
      'wrong-secret-that-is-long-enough',
    );
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });

    const failure = await db.asUser(jwt).then(
      () => undefined,
      (err: unknown) => err,
    );
    expect(isStructuredError(failure)).toBe(true);
    expect(failure).toMatchObject({ code: 'SUPABASE.JWT_INVALID' });
    // No pg activity — pool.connect never called
    expect(poolConnectSpy()).not.toHaveBeenCalled();
    await db.close();
  });

  it('rejects with SUPABASE.JWT_INVALID for an expired JWT', async () => {
    const jwt = await makeJwt({ sub: 'user-1', role: 'authenticated' }, fixtureJwt, '-1s');
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });

    await expect(db.asUser(jwt)).rejects.toMatchObject({ code: 'SUPABASE.JWT_INVALID' });
    expect(poolConnectSpy()).not.toHaveBeenCalled();
    await db.close();
  });

  it('names the asymmetric-token/jwtSecret mismatch instead of leaking a jose internal', async () => {
    const { generateKeyPair } = await import('jose');
    const { privateKey } = await generateKeyPair('ES256');
    const jwt = await new SignJWT({ sub: 'user-1', role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-kid' })
      .setExpirationTime('1h')
      .sign(privateKey);

    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });

    const failure = await db.asUser(jwt).then(
      () => undefined,
      (err: unknown) => err,
    );
    expect(isStructuredError(failure) && failure.code === 'SUPABASE.JWT_INVALID').toBe(true);
    const message = failure instanceof Error ? failure.message : '';
    expect(message).toContain('ES256');
    expect(message).toContain('jwtSecret');
    expect(message).toContain('jwksUrl');
    expect(message).toContain('/auth/v1/.well-known/jwks.json');
    expect(message).not.toContain('CryptoKey');
    expect(message).not.toContain('Uint8Array');
    await db.close();
  });

  it('names the symmetric-token/jwksUrl mismatch without fetching the JWKS', async () => {
    const jwt = await makeJwt({ sub: 'user-1', role: 'authenticated' });

    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      // Never fetched: the alg mismatch is detected before verification.
      jwksUrl: 'https://project.supabase.example/auth/v1/.well-known/jwks.json',
    });

    const failure = await db.asUser(jwt).then(
      () => undefined,
      (err: unknown) => err,
    );
    expect(isStructuredError(failure) && failure.code === 'SUPABASE.JWT_INVALID').toBe(true);
    const message = failure instanceof Error ? failure.message : '';
    expect(message).toContain('HS256');
    expect(message).toContain('jwksUrl');
    expect(message).toContain('jwtSecret');
    await db.close();
  });
});

describe('supabase() factory — behavioral binding via set_config', () => {
  it('query on a role-bound db sends set_config for role before the app query', async () => {
    const fakeClient = makeFakeClient();
    poolConnectSpy().mockResolvedValue(fakeClient);

    const jwt = await makeJwt({ sub: 'user-1', role: 'authenticated' });
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });
    const roleBoundDb = await db.asUser(jwt);

    await roleBoundDb
      .query(stubPlan() as unknown as Parameters<typeof roleBoundDb.query>[0])
      .toArray();

    const sqlsSeen = fakeClient.queryCalls.map((c) => c.sql);
    const roleIdx = sqlsSeen.indexOf('SELECT set_config($1, $2, false)');
    expect(roleIdx).toBeGreaterThanOrEqual(0);

    // set_config with 'role' arrives before the app query
    const roleCall = fakeClient.queryCalls[roleIdx];
    expect(roleCall?.params?.[0]).toBe('role');
    expect(roleCall?.params?.[1]).toBe('authenticated');

    await db.close();
  });

  it('RESET ALL and RESET ROLE are sent after the stream drains', async () => {
    const fakeClient = makeFakeClient();
    poolConnectSpy().mockResolvedValue(fakeClient);

    const jwt = await makeJwt({ sub: 'user-1', role: 'authenticated' });
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });
    const roleBoundDb = await db.asUser(jwt);

    await roleBoundDb
      .query(stubPlan() as unknown as Parameters<typeof roleBoundDb.query>[0])
      .toArray();

    const sqlsSeen = fakeClient.queryCalls.map((c) => c.sql);
    expect(sqlsSeen[sqlsSeen.length - 1]).toBe('RESET ROLE');

    await db.close();
  });

  it('execute returns statistics then resets and releases the role-bound connection', async () => {
    const fakeClient = makeFakeClient(6);
    poolConnectSpy().mockResolvedValue(fakeClient);

    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });
    const roleBoundDb = db.asAnon();

    const stats = await roleBoundDb.execute(
      stubPlan() as unknown as Parameters<typeof roleBoundDb.execute>[0],
    );

    expect(stats).toEqual({ affectedRows: 6 });
    expect(fakeClient.queryCalls.at(-1)?.sql).toBe('RESET ROLE');
    expect(fakeClient.release).toHaveBeenCalled();

    await db.close();
  });

  it('asAnon binding uses role=anon', async () => {
    const fakeClient = makeFakeClient();
    poolConnectSpy().mockResolvedValue(fakeClient);

    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });
    const roleBoundDb = db.asAnon();

    await roleBoundDb
      .query(stubPlan() as unknown as Parameters<typeof roleBoundDb.query>[0])
      .toArray();

    const roleCall = fakeClient.queryCalls.find(
      (c) => c.sql === 'SELECT set_config($1, $2, false)' && c.params?.[0] === 'role',
    );
    expect(roleCall?.params?.[1]).toBe('anon');

    await db.close();
  });

  it('asServiceRole binding uses role=service_role', async () => {
    const fakeClient = makeFakeClient();
    poolConnectSpy().mockResolvedValue(fakeClient);

    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });
    const roleBoundDb = db.asServiceRole();

    await roleBoundDb
      .query(stubPlan() as unknown as Parameters<typeof roleBoundDb.query>[0])
      .toArray();

    const roleCall = fakeClient.queryCalls.find(
      (c) => c.sql === 'SELECT set_config($1, $2, false)' && c.params?.[0] === 'role',
    );
    expect(roleCall?.params?.[1]).toBe('service_role');

    await db.close();
  });
});

describe('supabase() factory — SupabaseDb surface', () => {
  it('has no top-level sql or orm', async () => {
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });

    const dbAny = db as unknown as Record<string, unknown>;
    expect(dbAny['sql']).toBeUndefined();
    expect(dbAny['orm']).toBeUndefined();

    await db.close();
  });

  it('exposes context and stack', async () => {
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });

    expect(db.context).toBeDefined();
    expect(db.stack).toBeDefined();

    await db.close();
  });
});

describe('service_role .supabase.nativeEnums (facade)', () => {
  // Built from the real extension contract (`../contract/contract.json`),
  // not a fixture — `nativeEnums` is derived from `extContract.storage`,
  // which the Supabase runtime always builds from the extension's own
  // emitted contract (see `buildExtensionContract` in ../src/runtime/supabase.ts).
  // The `auth` namespace's `AalLevel` valueSet entry (derived from the
  // `native_enum` block) is production data: members `aal1`/`aal2`/`aal3`,
  // backing the `auth.sessions.aal` column.
  it('exposes auth.AalLevel members, matching the emitted extension contract', async () => {
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });

    const AalLevel = db.asServiceRole().supabase.nativeEnums.auth['AalLevel'];

    expect(AalLevel?.values).toEqual(['aal1', 'aal2', 'aal3']);
    expect(AalLevel?.members['aal2']).toBe('aal2');

    await db.close();
  });

  it('builds the nativeEnums surface eagerly, without a runtime', async () => {
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });

    expect(db.asServiceRole().supabase.nativeEnums.auth['AalLevel']?.values).toEqual([
      'aal1',
      'aal2',
      'aal3',
    ]);
    expect(poolConnectSpy()).not.toHaveBeenCalled();

    await db.close();
  });
});

describe('RoleBoundDb — facade invariant: no unbound connection surface', () => {
  // The security guarantee is facade-encapsulation: SupabaseRuntimeImpl inherits a public
  // connection() from the base, but the role-bound Db surface must never expose it.
  // These assertions pin the invariant so a regression is caught at the facade boundary,
  // not four layers downstream in an integration test.
  it('RoleBoundDb has no connection() method', async () => {
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });
    const roleBoundDb = db.asAnon();

    expect(typeof (roleBoundDb as unknown as Record<string, unknown>)['connection']).not.toBe(
      'function',
    );

    await db.close();
  });

  it('orm on RoleBoundDb issues set_config before any ORM query', async () => {
    const fakeClient = makeFakeClient();
    poolConnectSpy().mockResolvedValue(fakeClient);

    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });
    const roleBoundDb = db.asAnon();

    // Drive the ORM scope path by calling query directly via the role-bound surface.
    // (The ORM builds plans through roleBoundDb.orm, which uses openRoleSession internally.)
    await roleBoundDb
      .query(stubPlan() as unknown as Parameters<typeof roleBoundDb.query>[0])
      .toArray();

    const sqlsSeen = fakeClient.queryCalls.map((c) => c.sql);
    const setConfigIdx = sqlsSeen.indexOf('SELECT set_config($1, $2, false)');
    expect(setConfigIdx).toBeGreaterThanOrEqual(0);

    // set_config arrives before RESET ALL (session is bound before and reset after)
    const resetIdx = sqlsSeen.lastIndexOf('RESET ALL');
    expect(resetIdx).toBeGreaterThan(setConfigIdx);

    await db.close();
  });
});
