import { contractFromJson } from '@internal/postgres/static';
import { createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type SupabaseDb, supabase } from '../src/exports/runtime';
import type { Contract } from './fixtures/example-app/contract';
import contractJson from './fixtures/example-app/contract.json' with { type: 'json' };
import { fixtureJwt } from './fixtures/example-app/db';
import { setUpSupabaseMockSchema } from './fixtures/supabase-reference/set-up-mock-schema';

const contract = contractFromJson<Contract>(contractJson);

async function grantDevDatabaseSchema(connectionString: string): Promise<void> {
  await withClient(connectionString, async (client) => {
    await client.query('GRANT USAGE ON SCHEMA auth TO service_role');
    await client.query('GRANT SELECT ON TABLE auth.users TO service_role');
    await client.query(
      'GRANT USAGE ON SCHEMA _prisma_dev_wal TO anon, authenticated, service_role',
    );
    await client.query(
      'GRANT ALL ON ALL TABLES IN SCHEMA _prisma_dev_wal TO anon, authenticated, service_role',
    );
    await client.query(
      'GRANT ALL ON ALL SEQUENCES IN SCHEMA _prisma_dev_wal TO anon, authenticated, service_role',
    );
    await client.query(
      'GRANT EXECUTE ON FUNCTION _prisma_dev_wal.capture_event() TO anon, authenticated, service_role',
    );
  });
}

function signJwt(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(fixtureJwt));
}

async function seedAuthUsers(connectionString: string, count: number): Promise<string[]> {
  const ids = Array.from({ length: count }, () => crypto.randomUUID()).sort();
  await withClient(connectionString, async (client) => {
    for (const [index, id] of ids.entries()) {
      await client.query(
        'INSERT INTO auth.users (id, email, created_at, updated_at) VALUES ($1, $2, now(), now())',
        [id, `user-${index}@example.com`],
      );
    }
  });
  return ids;
}

describe('a Supabase client with cursor set, against a real Postgres', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let db: SupabaseDb<Contract>;

  beforeEach(async () => {
    database = await createDevDatabase();
    await withClient(database.connectionString, setUpSupabaseMockSchema);
    await grantDevDatabaseSchema(database.connectionString);
    db = await supabase({
      contract,
      url: database.connectionString,
      jwtSecret: fixtureJwt,
      verifyMarker: false,
      cursor: { batchSize: 4 },
    });
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    await db?.close();
    await database?.close();
  }, timeouts.spinUpPpgDev);

  async function signedInUser() {
    return db.asUser(await signJwt({ sub: crypto.randomUUID(), role: 'authenticated' }));
  }

  it(
    'streams every row, in order, across several batches, under the bound role',
    async () => {
      const user = await signedInUser();
      const plan = user.raw.sql`SELECT n, current_user AS role FROM generate_series(1, 25) AS n`
        .returnsRow({ n: 'pg/int4@1', role: 'pg/text@1' })
        .build();

      const rows: Array<{ readonly n: number; readonly role: string }> = [];
      for await (const row of user.query(plan)) {
        rows.push(row);
      }

      expect(rows).toEqual(
        Array.from({ length: 25 }, (_, index) => ({ n: index + 1, role: 'authenticated' })),
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'hands over the rows of the batches before the one that fails',
    async () => {
      const user = await signedInUser();
      const plan = user.raw.sql`SELECT n, 1 / (n - 10) AS d FROM generate_series(1, 25) AS n`
        .returnsRow({ n: 'pg/int4@1', d: 'pg/int4@1' })
        .build();

      const seen: number[] = [];
      const reading = (async () => {
        for await (const row of user.query(plan)) seen.push(row.n);
      })();

      await expect(reading).rejects.toThrow(/division by zero/);
      expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'streams inside a role transaction on the connection the transaction holds',
    async () => {
      const user = await signedInUser();

      const { buffered, streamed } = await user.transaction(async (tx) => {
        const session = tx.raw.sql`SELECT pg_backend_pid() AS pid, current_user AS role`
          .returnsRow({ pid: 'pg/int4@1', role: 'pg/text@1' })
          .build();
        const [buffered] = await tx.query(session);
        const series = tx.raw
          .sql`SELECT n, pg_backend_pid() AS pid, current_user AS role FROM generate_series(1, 10) AS n`
          .returnsRow({ n: 'pg/int4@1', pid: 'pg/int4@1', role: 'pg/text@1' })
          .build();
        const streamed: Array<{ readonly pid: number; readonly role: string }> = [];
        for await (const { pid, role } of tx.query(series)) {
          streamed.push({ pid, role });
        }
        return { buffered, streamed };
      });

      expect(streamed).toEqual(
        Array.from({ length: 10 }, () => ({ pid: buffered?.pid, role: 'authenticated' })),
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'resets the session after a stream left early, so the next role sees its own role',
    async () => {
      const user = await signedInUser();
      const series = user.raw.sql`SELECT n FROM generate_series(1, 25) AS n`
        .returnsRow({ n: 'pg/int4@1' })
        .build();
      const seen: number[] = [];
      for await (const { n } of user.query(series)) {
        seen.push(n);
        if (seen.length === 3) break;
      }

      const anon = db.asAnon();
      const roles = await anon.query(
        anon.raw.sql`SELECT current_user AS role`.returnsRow({ role: 'pg/text@1' }).build(),
      );

      expect({ seen, roles }).toEqual({ seen: [1, 2, 3], roles: [{ role: 'anon' }] });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'streams a read of the Supabase contract through the shared driver',
    async () => {
      const ids = await seedAuthUsers(database.connectionString, 10);
      const internal = db.asServiceRole().supabase;

      const rows: string[] = [];
      for await (const { id } of internal.query(
        internal.sql.auth.users.select('id').orderBy('id').build(),
      )) {
        rows.push(id);
      }

      expect(rows).toEqual(ids);
    },
    timeouts.spinUpPpgDev,
  );
});
