/**
 * RLS-through-ORM acceptance test — role-bound Supabase runtime proven in the walking skeleton.
 *
 * Proves that the `supabase()` factory correctly enforces Postgres RLS via role bindings.
 * All policies are authored in `contract.prisma` and applied by `dbInit` — none are
 * hand-authored in this test.
 *
 *   1. `asUser(jwt)` with a valid HS256 JWT for user A returns exactly user A's profile row
 *      through the ORM, filtered by the `profile_owner_read` RLS policy.
 *   2. `asAnon()` returns every row — the `profile_public_read` anon policy (using = true).
 *   3. `asServiceRole()` returns both profiles — BYPASSRLS skips all policies.
 *   4. The recording middleware captures only typed ORM queries, never `set_config` calls
 *      (proving `set_config` runs below the user middleware chain).
 *   5. An expired JWT → a structured error with code `SUPABASE.JWT_INVALID`.
 *   6. `profile_owner_write`'s WITH CHECK rejects reassigning a row to another owner.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgresAdapter from '@internal/adapter-postgres/control';
import { createControlClient } from '@internal/cli/control-api';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { emitContractSpaceArtifacts } from '@internal/migration-tools/spaces';
import { contractFromJson } from '@internal/postgres/static';
import type { SqlMiddleware } from '@internal/sql-runtime';
import postgres from '@internal/target-postgres/control';
import { isStructuredError } from '@internal/utils/structured-error';
import { createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import supabasePack from '../src/exports/pack';
import { supabase } from '../src/exports/runtime';
import type { Contract } from './fixtures/example-app/contract';
import contractJson from './fixtures/example-app/contract.json' with { type: 'json' };
import { createDb, fixtureJwt } from './fixtures/example-app/db';
import { setUpSupabaseMockSchema } from './fixtures/supabase-reference/set-up-mock-schema';

async function signJwt(
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

function recordingMiddleware(): { middleware: SqlMiddleware; sqls: string[] } {
  const sqls: string[] = [];
  const middleware: SqlMiddleware = {
    name: 'rls-recorder',
    familyId: 'sql',
    async beforeEncode(plan) {
      sqls.push(plan.sql);
    },
  };
  return { middleware, sqls };
}

async function runDbInit(connectionString: string, migrationsDir: string): Promise<void> {
  const space = supabasePack.contractSpace;
  if (!space) throw new Error('supabasePack must declare a contractSpace');

  await emitContractSpaceArtifacts(migrationsDir, 'supabase', {
    contract: space.contractJson,
    contractDts: '// supabase extension contract space\n',
    headRef: { hash: space.headRef.hash, invariants: [...space.headRef.invariants] },
  });

  const client = createControlClient({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [supabasePack],
  });

  try {
    await client.connect(connectionString);
    const result = await client.dbInit({ contract: contractJson, mode: 'apply', migrationsDir });
    if (!result.ok) {
      throw new Error(`dbInit apply failed: ${result.failure.summary}`);
    }
  } finally {
    await client.close();
  }
}

async function applyGrantsFixture(connectionString: string): Promise<void> {
  await withClient(connectionString, async (pg) => {
    // No public.profile grants: the restored fixture carries real Supabase's
    // default privileges for the postgres role, so tables dbInit creates in
    // public already grant the platform roles — RLS scopes the rows.

    // PGlite uses a single connection, so the @prisma/dev WAL drain query
    // (DELETE FROM "_prisma_dev_wal"."events" RETURNING ...) can fire while one
    // of our role-bound transactions is active. Each role therefore needs full
    // rights on the WAL schema — not just INSERT for the capture trigger, but
    // also DELETE for the drain, EXECUTE for the capture function, and USAGE on
    // the sequence.
    await pg.query('GRANT USAGE ON SCHEMA _prisma_dev_wal TO anon, authenticated, service_role');
    await pg.query(
      'GRANT ALL ON ALL TABLES IN SCHEMA _prisma_dev_wal TO anon, authenticated, service_role',
    );
    await pg.query(
      'GRANT ALL ON ALL SEQUENCES IN SCHEMA _prisma_dev_wal TO anon, authenticated, service_role',
    );
    await pg.query(
      'GRANT EXECUTE ON FUNCTION _prisma_dev_wal.capture_event() TO anon, authenticated, service_role',
    );
  });
}

describe('RLS — role-bound Supabase runtime acceptance', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let migrationsDir: string;

  beforeEach(async () => {
    database = await createDevDatabase();
    migrationsDir = await mkdtemp(join(tmpdir(), 'supabase-rls-migrations-'));
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    if (database) await database.close();
    if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true });
  }, timeouts.spinUpPpgDev);

  it(
    'asUser returns only owner row; asAnon returns all (public-read policy); asServiceRole returns all; set_config invisible to middleware',
    async () => {
      const { connectionString } = database;

      // Seed external schema shim (auth.users etc.) + apply public.profile DDL.
      await withClient(connectionString, async (pg) => {
        await setUpSupabaseMockSchema(pg);
      });
      await runDbInit(connectionString, migrationsDir);
      await applyGrantsFixture(connectionString);

      // Seed two auth users + two profiles via raw SQL (service_role write path proven later).
      const userAId = crypto.randomUUID();
      const userBId = crypto.randomUUID();
      const profileAId = crypto.randomUUID();
      const profileBId = crypto.randomUUID();
      const now = new Date().toISOString();

      await withClient(connectionString, async (pg) => {
        await pg.query(
          'INSERT INTO auth.users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $3), ($4, $5, $3, $3)',
          [userAId, 'user-a@example.com', now, userBId, 'user-b@example.com'],
        );
        // Use quoted "userId" — the contract maps userId field to the "userId" column.
        await pg.query(
          'INSERT INTO public.profile (id, username, "userId") VALUES ($1, $2, $3), ($4, $5, $6)',
          [profileAId, 'alice', userAId, profileBId, 'bob', userBId],
        );
      });

      const recorder = recordingMiddleware();

      const db = await createDb(connectionString, { middleware: [recorder.middleware] });

      try {
        // --- asUser: sees only user A's profile ---
        const jwtA = await signJwt({ sub: userAId, role: 'authenticated' });
        const userADb = await db.asUser(jwtA);
        const userARows = await userADb.orm.public.Profile.select('id', 'username', 'userId')
          .all()
          .toArray();

        expect(userARows).toEqual([{ id: profileAId, username: 'alice', userId: userAId }]);

        // --- asAnon: public-read policy (using = true) → every row ---
        const anonRows = await db
          .asAnon()
          .orm.public.Profile.select('id', 'username', 'userId')
          .all()
          .toArray();

        const sortedAnonRows = [...anonRows].sort((a, b) => a.username.localeCompare(b.username));
        expect(sortedAnonRows).toEqual([
          { id: profileAId, username: 'alice', userId: userAId },
          { id: profileBId, username: 'bob', userId: userBId },
        ]);

        // --- asServiceRole: BYPASSRLS → both rows ---
        const serviceRows = await db
          .asServiceRole()
          .orm.public.Profile.select('id', 'username', 'userId')
          .all()
          .toArray();

        // Sort by username for deterministic assertion.
        const sortedServiceRows = [...serviceRows].sort((a, b) =>
          a.username.localeCompare(b.username),
        );
        expect(sortedServiceRows).toEqual([
          { id: profileAId, username: 'alice', userId: userAId },
          { id: profileBId, username: 'bob', userId: userBId },
        ]);

        // --- set_config invisible to middleware ---
        const setConfigInMiddleware = recorder.sqls.some((s) => s.includes('set_config'));
        expect(setConfigInMiddleware, 'set_config must not appear in middleware-visible SQL').toBe(
          false,
        );
        // Middleware must have seen at least one SELECT (the ORM queries above).
        expect(recorder.sqls.length, 'middleware must have captured ORM queries').toBeGreaterThan(
          0,
        );
      } finally {
        await db.close();
      }
    },
    timeouts.spinUpPpgDev * 4,
  );

  it(
    'asServiceRole ORM create succeeds; asUser ORM update scoped to own row; update against other row affects 0; withCheck rejects reassignment to another owner',
    async () => {
      const { connectionString } = database;

      await withClient(connectionString, async (pg) => {
        await setUpSupabaseMockSchema(pg);
      });
      await runDbInit(connectionString, migrationsDir);
      await applyGrantsFixture(connectionString);

      const userAId = crypto.randomUUID();
      const userBId = crypto.randomUUID();
      const now = new Date().toISOString();

      await withClient(connectionString, async (pg) => {
        await pg.query(
          'INSERT INTO auth.users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $3), ($4, $5, $3, $3)',
          [userAId, 'user-a@example.com', now, userBId, 'user-b@example.com'],
        );
      });

      const db = await createDb(connectionString);

      try {
        // service_role can INSERT (BYPASSRLS)
        const created = await db.asServiceRole().orm.public.Profile.createAndCount([
          { userId: userAId, username: 'alice' },
          { userId: userBId, username: 'bob' },
        ]);
        expect(created).toBe(2);

        // Verify rows exist
        const allRows = await db
          .asServiceRole()
          .orm.public.Profile.select('username', 'userId')
          .all()
          .toArray();
        const sorted = [...allRows].sort((a, b) => a.username.localeCompare(b.username));
        expect(sorted).toEqual([
          { username: 'alice', userId: userAId },
          { username: 'bob', userId: userBId },
        ]);

        // asUser(A) can update their own row
        const jwtA = await signJwt({ sub: userAId, role: 'authenticated' });
        const userADb = await db.asUser(jwtA);
        const updatedCount = await userADb.orm.public.Profile.where({
          userId: userAId,
        }).updateAndCount({ username: 'alice-updated' });
        expect(updatedCount).toBe(1);

        // asUser(A) update targeting user B's row affects 0 rows (RLS filters it out)
        const crossUpdatedCount = await userADb.orm.public.Profile.where({
          userId: userBId,
        }).updateAndCount({ username: 'should-not-change' });
        expect(crossUpdatedCount).toBe(0);

        // Confirm B's username is still 'bob'
        const bobRows = await db
          .asServiceRole()
          .orm.public.Profile.select('username', 'userId')
          .where({ userId: userBId })
          .all()
          .toArray();
        expect(bobRows).toEqual([{ username: 'bob', userId: userBId }]);

        // profile_owner_write WITH CHECK rejects reassigning the row to another owner
        await expect(
          userADb.orm.public.Profile.where({ userId: userAId }).updateAndCount({ userId: userBId }),
        ).rejects.toThrow(/row-level security/);
      } finally {
        await db.close();
      }
    },
    timeouts.spinUpPpgDev * 4,
  );

  it(
    'asUser rejects an expired JWT with SUPABASE.JWT_INVALID',
    async () => {
      const { connectionString } = database;

      await withClient(connectionString, async (pg) => {
        await setUpSupabaseMockSchema(pg);
      });
      await runDbInit(connectionString, migrationsDir);

      const db = await createDb(connectionString);

      try {
        const expiredJwt = await signJwt(
          { sub: crypto.randomUUID(), role: 'authenticated' },
          fixtureJwt,
          '-1s',
        );
        await expect(db.asUser(expiredJwt)).rejects.toSatisfy(
          (e: unknown) => isStructuredError(e) && e.code === 'SUPABASE.JWT_INVALID',
        );
      } finally {
        await db.close();
      }
    },
    timeouts.spinUpPpgDev * 4,
  );

  it(
    'asUser verifies an ES256 token via a JWKS endpoint (current Supabase default) and RLS scopes the read',
    async () => {
      const { connectionString } = database;

      await withClient(connectionString, async (pg) => {
        await setUpSupabaseMockSchema(pg);
      });
      await runDbInit(connectionString, migrationsDir);
      await applyGrantsFixture(connectionString);

      const userAId = crypto.randomUUID();
      const userBId = crypto.randomUUID();
      const profileAId = crypto.randomUUID();
      const profileBId = crypto.randomUUID();
      const now = new Date().toISOString();

      await withClient(connectionString, async (pg) => {
        await pg.query(
          'INSERT INTO auth.users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $3), ($4, $5, $3, $3)',
          [userAId, 'user-a@example.com', now, userBId, 'user-b@example.com'],
        );
        await pg.query(
          'INSERT INTO public.profile (id, username, "userId") VALUES ($1, $2, $3), ($4, $5, $6)',
          [profileAId, 'alice', userAId, profileBId, 'bob', userBId],
        );
      });

      // Current Supabase projects sign ES256 with keys published at
      // /auth/v1/.well-known/jwks.json — mirror that with an in-test keypair
      // and a local JWKS endpoint the client fetches at first verification.
      const { generateKeyPair, exportJWK } = await import('jose');
      const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
      const kid = crypto.randomUUID();
      const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' }] };
      const jwksServer = createServer((_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(jwks));
      });
      await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
      const { port } = jwksServer.address() as AddressInfo;
      const jwksUrl = `http://127.0.0.1:${port}/auth/v1/.well-known/jwks.json`;

      try {
        const db = await supabase({
          contract: contractFromJson<Contract>(contractJson),
          url: connectionString,
          jwksUrl,
        });
        try {
          const jwtA = await new SignJWT({ sub: userAId, role: 'authenticated' })
            .setProtectedHeader({ alg: 'ES256', kid })
            .setExpirationTime('1h')
            .sign(privateKey);

          const userADb = await db.asUser(jwtA);
          const rows = await userADb.orm.public.Profile.select('id', 'username', 'userId')
            .all()
            .toArray();
          expect(rows).toEqual([{ id: profileAId, username: 'alice', userId: userAId }]);
        } finally {
          await db.close();
        }
      } finally {
        // Outer finally so the listening JWKS server is closed even when
        // client creation itself rejects — a leaked server hangs the worker.
        await new Promise<void>((resolve, reject) =>
          jwksServer.close((err) => (err ? reject(err) : resolve())),
        );
      }
    },
    timeouts.spinUpPpgDev * 4,
  );
});
