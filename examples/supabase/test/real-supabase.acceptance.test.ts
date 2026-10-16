/**
 * Real-Supabase acceptance test — the real-connection variant of the
 * extension package's hermetic `rls-role-binding.integration.test.ts`.
 * Runs the same RLS role-binding flows against a live Supabase Postgres
 * instead of PGlite.
 *
 * Skipped (green) unless both `DATABASE_URL` (a direct, service_role-capable
 * connection to a real Supabase project) and `SUPABASE_JWT_SECRET` (the
 * project's JWT secret) are set. The GoTrue/JWKS test additionally needs
 * `SUPABASE_URL` and `SUPABASE_ANON_KEY`. CI runs the whole suite against a
 * stock `supabase start` (ci.yml `supabase-acceptance` job, which exports
 * all four from `supabase status`); see `examples/supabase/README.md` for
 * running it locally.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import supabasePack from '@prisma/orm-extension-supabase/pack';
import { supabase } from '@prisma/orm-extension-supabase/runtime';
import { createPostgresControlClient } from '@prisma/orm-postgres/control';
import type { SqlMiddleware } from '@prisma/orm-postgres/family-runtime';
import { emitContractSpaceArtifacts } from '@prisma/orm-postgres/migration-tools/spaces';
import { isStructuredError } from '@prisma/orm-postgres/utils/structured-error';
import { timeouts, withClient } from '@repo/test-utils';
import { SignJWT } from 'jose';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import contractJson from '../src/contract.json' with { type: 'json' };
import { contract, createDb } from '../src/prisma/db';

function requireEnv(name: 'DATABASE_URL' | 'SUPABASE_JWT_SECRET'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set — describe.skipIf should have skipped this suite`);
  }
  return value;
}

function acceptanceEmail(userId: string): string {
  return `acceptance-${userId}@example.com`;
}

async function cleanupUsers(connectionString: string, userIds: readonly string[]): Promise<void> {
  await withClient(connectionString, async (pg) => {
    await pg.query('DELETE FROM public.profile WHERE "userId" = ANY($1::uuid[])', [userIds]);
    await pg.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [userIds]);
  });
}

async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
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

  const client = createPostgresControlClient({ extensions: [supabasePack] });

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

describe.skipIf(!process.env['DATABASE_URL'] || !process.env['SUPABASE_JWT_SECRET'])(
  'RLS — role-bound Supabase runtime acceptance (real Supabase)',
  () => {
    let connectionString: string;
    let jwtSecret: string;
    let migrationsDir: string;

    beforeEach(async () => {
      connectionString = requireEnv('DATABASE_URL');
      jwtSecret = requireEnv('SUPABASE_JWT_SECRET');
      migrationsDir = await mkdtemp(join(tmpdir(), 'supabase-rls-acceptance-'));
    }, timeouts.spinUpPpgDev);

    afterEach(async () => {
      if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true });
    }, timeouts.spinUpPpgDev);

    it(
      'asUser returns only owner row; asAnon returns all (public-read policy); asServiceRole returns all; set_config invisible to middleware',
      async () => {
        await runDbInit(connectionString, migrationsDir);
        // No manual grants: tables dbInit creates in public inherit the
        // platform roles' access via Supabase's default privileges; RLS is
        // what scopes the rows.

        const userAId = crypto.randomUUID();
        const userBId = crypto.randomUUID();
        const profileAId = crypto.randomUUID();
        const profileBId = crypto.randomUUID();
        const now = new Date().toISOString();

        try {
          await withClient(connectionString, async (pg) => {
            await pg.query(
              'INSERT INTO auth.users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $3), ($4, $5, $3, $3)',
              [userAId, acceptanceEmail(userAId), now, userBId, acceptanceEmail(userBId)],
            );
            await pg.query(
              'INSERT INTO public.profile (id, username, "userId") VALUES ($1, $2, $3), ($4, $5, $6)',
              [profileAId, 'alice', userAId, profileBId, 'bob', userBId],
            );
          });

          const recorder = recordingMiddleware();
          const db = await createDb(connectionString, { middleware: [recorder.middleware] });

          try {
            const jwtA = await signJwt({ sub: userAId, role: 'authenticated' }, jwtSecret);
            const userADb = await db.asUser(jwtA);
            const userARows = await userADb.orm.public.Profile.select('id', 'username', 'userId')
              .all()
              .toArray();

            expect(userARows).toEqual([{ id: profileAId, username: 'alice', userId: userAId }]);

            const anonRows = await db
              .asAnon()
              .orm.public.Profile.select('id', 'username', 'userId')
              .all()
              .toArray();

            const sortedAnonRows = [...anonRows].sort((a, b) =>
              a.username.localeCompare(b.username),
            );
            expect(sortedAnonRows).toEqual([
              { id: profileAId, username: 'alice', userId: userAId },
              { id: profileBId, username: 'bob', userId: userBId },
            ]);

            const serviceRows = await db
              .asServiceRole()
              .orm.public.Profile.select('id', 'username', 'userId')
              .all()
              .toArray();

            const sortedServiceRows = [...serviceRows].sort((a, b) =>
              a.username.localeCompare(b.username),
            );
            expect(sortedServiceRows).toEqual([
              { id: profileAId, username: 'alice', userId: userAId },
              { id: profileBId, username: 'bob', userId: userBId },
            ]);

            const setConfigInMiddleware = recorder.sqls.some((s) => s.includes('set_config'));
            expect(
              setConfigInMiddleware,
              'set_config must not appear in middleware-visible SQL',
            ).toBe(false);
            expect(
              recorder.sqls.length,
              'middleware must have captured ORM queries',
            ).toBeGreaterThan(0);
          } finally {
            await db.close();
          }
        } finally {
          await cleanupUsers(connectionString, [userAId, userBId]);
        }
      },
      timeouts.spinUpPpgDev * 4,
    );

    it(
      'asServiceRole ORM create succeeds; asUser ORM update scoped to own row; update against other row affects 0; withCheck rejects reassignment to another owner',
      async () => {
        await runDbInit(connectionString, migrationsDir);
        // No manual grants: tables dbInit creates in public inherit the
        // platform roles' access via Supabase's default privileges; RLS is
        // what scopes the rows.

        const userAId = crypto.randomUUID();
        const userBId = crypto.randomUUID();
        const now = new Date().toISOString();

        try {
          await withClient(connectionString, async (pg) => {
            await pg.query(
              'INSERT INTO auth.users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $3), ($4, $5, $3, $3)',
              [userAId, acceptanceEmail(userAId), now, userBId, acceptanceEmail(userBId)],
            );
          });

          const db = await createDb(connectionString);

          try {
            const created = await db.asServiceRole().orm.public.Profile.createAndCount([
              { userId: userAId, username: 'alice' },
              { userId: userBId, username: 'bob' },
            ]);
            expect(created).toBe(2);

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

            const jwtA = await signJwt({ sub: userAId, role: 'authenticated' }, jwtSecret);
            const userADb = await db.asUser(jwtA);
            const updatedCount = await userADb.orm.public.Profile.where({
              userId: userAId,
            }).updateAndCount({ username: 'alice-updated' });
            expect(updatedCount).toBe(1);

            const crossUpdatedCount = await userADb.orm.public.Profile.where({
              userId: userBId,
            }).updateAndCount({ username: 'should-not-change' });
            expect(crossUpdatedCount).toBe(0);

            const bobRows = await db
              .asServiceRole()
              .orm.public.Profile.select('username', 'userId')
              .where({ userId: userBId })
              .all()
              .toArray();
            expect(bobRows).toEqual([{ username: 'bob', userId: userBId }]);

            await expect(
              userADb.orm.public.Profile.where({ userId: userAId }).updateAndCount({
                userId: userBId,
              }),
            ).rejects.toThrow(/row-level security/);
          } finally {
            await db.close();
          }
        } finally {
          await cleanupUsers(connectionString, [userAId, userBId]);
        }
      },
      timeouts.spinUpPpgDev * 4,
    );

    it(
      'asUser rejects an expired JWT with SUPABASE.JWT_INVALID',
      async () => {
        await runDbInit(connectionString, migrationsDir);

        const db = await createDb(connectionString);

        try {
          const expiredJwt = await signJwt(
            { sub: crypto.randomUUID(), role: 'authenticated' },
            jwtSecret,
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

    // The project's REAL signing config: GoTrue issues the token (ES256 with
    // a kid on a current stack) and the client verifies it through the
    // project's published JWKS endpoint — no self-minted keys anywhere. This
    // is the configuration a new Supabase project has out of the box; it is
    // what the hermetic ES256 test in rls-role-binding.integration.test.ts
    // simulates. Needs `SUPABASE_URL` + `SUPABASE_ANON_KEY` on top of the
    // suite's env (the CI job exports all four from `supabase status`).
    it.skipIf(!process.env['SUPABASE_URL'] || !process.env['SUPABASE_ANON_KEY'])(
      'asUser accepts a GoTrue-issued token verified via the project JWKS endpoint; RLS scopes the read',
      async () => {
        const supabaseUrl = process.env['SUPABASE_URL'];
        const anonKey = process.env['SUPABASE_ANON_KEY'];
        if (!supabaseUrl || !anonKey) {
          throw new Error(
            'SUPABASE_URL/SUPABASE_ANON_KEY must be set — skipIf should have skipped',
          );
        }

        await runDbInit(connectionString, migrationsDir);

        // A real user, created by the real auth server. Stock local config
        // auto-confirms email signups and returns a session directly.
        const email = `acceptance-${crypto.randomUUID()}@example.com`;
        const signupResponse = await fetch(`${supabaseUrl}/auth/v1/signup`, {
          method: 'POST',
          headers: { apikey: anonKey, 'content-type': 'application/json' },
          body: JSON.stringify({ email, password: `pw-${crypto.randomUUID()}` }),
        });
        const signupBody = (await signupResponse.json()) as {
          access_token?: string;
          user?: { id?: string };
        };
        if (!signupResponse.ok || !signupBody.access_token || !signupBody.user?.id) {
          throw new Error(
            `GoTrue signup failed (${signupResponse.status}): ${JSON.stringify(signupBody)}`,
          );
        }
        const accessToken = signupBody.access_token;
        const userAId = signupBody.user.id;

        const userBId = crypto.randomUUID();
        const profileAId = crypto.randomUUID();
        const profileBId = crypto.randomUUID();
        const now = new Date().toISOString();

        try {
          await withClient(connectionString, async (pg) => {
            await pg.query(
              'INSERT INTO auth.users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $3)',
              [userBId, acceptanceEmail(userBId), now],
            );
            await pg.query(
              'INSERT INTO public.profile (id, username, "userId") VALUES ($1, $2, $3), ($4, $5, $6)',
              [profileAId, 'alice', userAId, profileBId, 'bob', userBId],
            );
          });

          const db = await supabase({
            contract,
            url: connectionString,
            jwksUrl: `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
          });

          try {
            const userADb = await db.asUser(accessToken);
            const rows = await userADb.orm.public.Profile.select('id', 'username', 'userId')
              .all()
              .toArray();
            expect(rows).toEqual([{ id: profileAId, username: 'alice', userId: userAId }]);
          } finally {
            await db.close();
          }
        } finally {
          await cleanupUsers(connectionString, [userAId, userBId]);
        }
      },
      timeouts.spinUpPpgDev * 4,
    );
  },
);
