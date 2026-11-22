import { contractFromJson } from '@internal/postgres/static';
import { createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { supabase } from '../src/exports/runtime';
import { grantDevDatabaseSchema } from './fixtures/dev-database-grants';
import type { Contract } from './fixtures/example-app/contract';
import contractJson from './fixtures/example-app/contract.json' with { type: 'json' };
import { fixtureJwt } from './fixtures/example-app/db';
import { setUpSupabaseMockSchema } from './fixtures/supabase-reference/set-up-mock-schema';

const contract = contractFromJson<Contract>(contractJson);

function signUserJwt(): Promise<string> {
  return new SignJWT({ sub: crypto.randomUUID(), role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(fixtureJwt));
}

describe('a Supabase client on a pool of one connection, with the contract marker check on', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let pool: pg.Pool;
  let db: Awaited<ReturnType<typeof supabase<Contract>>> | undefined;

  beforeEach(async () => {
    database = await createDevDatabase();
    await withClient(database.connectionString, setUpSupabaseMockSchema);
    await withClient(database.connectionString, grantDevDatabaseSchema);
    pool = new pg.Pool({
      connectionString: database.connectionString,
      max: 1,
      connectionTimeoutMillis: timeouts.poolConnectionWait,
    });
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    await db?.close();
    db = undefined;
    await pool?.end();
    await database?.close();
  }, timeouts.spinUpPpgDev);

  async function currentUserQuery(): Promise<() => Promise<string | undefined>> {
    db = await supabase({ contract, pg: pool, jwtSecret: fixtureJwt });
    const user = await db.asUser(await signUserJwt());
    return async () => {
      const rows = await user.query(
        user.raw.sql`SELECT current_user AS role`.returnsRow({ role: 'pg/text@1' }).build(),
      );
      return rows[0]?.role;
    };
  }

  it(
    'runs a first role-bound query',
    async () => {
      const currentUser = await currentUserQuery();

      expect(await currentUser()).toBe('authenticated');
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'runs first role-bound queries sent together',
    async () => {
      const currentUser = await currentUserQuery();

      const results = await Promise.allSettled([currentUser(), currentUser(), currentUser()]);

      expect(results).toEqual([
        { status: 'fulfilled', value: 'authenticated' },
        { status: 'fulfilled', value: 'authenticated' },
        { status: 'fulfilled', value: 'authenticated' },
      ]);
    },
    timeouts.spinUpPpgDev,
  );
});
