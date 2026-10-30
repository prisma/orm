import { contractFromJson } from '@internal/postgres/static';
import { createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { supabase } from '../src/exports/runtime';
import type { Contract } from './fixtures/example-app/contract';
import contractJson from './fixtures/example-app/contract.json' with { type: 'json' };
import { fixtureJwt } from './fixtures/example-app/db';
import { setUpSupabaseMockSchema } from './fixtures/supabase-reference/set-up-mock-schema';

const contract = contractFromJson<Contract>(contractJson);

async function grantDevDatabaseSchema(connectionString: string): Promise<void> {
  await withClient(connectionString, async (client) => {
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

describe('a streaming read through a Supabase role-bound client with cursor set', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;

  beforeEach(async () => {
    database = await createDevDatabase();
    await withClient(database.connectionString, setUpSupabaseMockSchema);
    await grantDevDatabaseSchema(database.connectionString);
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    await database?.close();
  }, timeouts.spinUpPpgDev);

  it(
    'returns every row, in order, across several batches',
    async () => {
      const db = await supabase({
        contract,
        url: database.connectionString,
        jwtSecret: fixtureJwt,
        verifyMarker: false,
        cursor: { batchSize: 4 },
      });

      try {
        const user = await db.asUser(
          await signJwt({ sub: crypto.randomUUID(), role: 'authenticated' }),
        );
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
      } finally {
        await db.close();
      }
    },
    timeouts.spinUpPpgDev,
  );
});
