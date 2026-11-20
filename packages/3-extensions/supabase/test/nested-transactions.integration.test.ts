import { contractFromJson } from '@internal/postgres/static';
import { createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type SupabaseTransactionContext, supabase } from '../src/exports/runtime';
import type { Contract } from './fixtures/example-app/contract';
import contractJson from './fixtures/example-app/contract.json' with { type: 'json' };
import { fixtureJwt } from './fixtures/example-app/db';
import { setUpSupabaseMockSchema } from './fixtures/supabase-reference/set-up-mock-schema';

const contract = contractFromJson<Contract>(contractJson);

async function setUpNestedRows(connectionString: string): Promise<void> {
  await withClient(connectionString, async (client) => {
    await setUpSupabaseMockSchema(client);
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
    await client.query(
      'CREATE TABLE public.nested_rows (name TEXT NOT NULL, role TEXT NOT NULL DEFAULT current_user)',
    );
    await client.query('GRANT ALL ON public.nested_rows TO authenticated');
  });
}

type Tx = SupabaseTransactionContext<Contract>;

const insert = (tx: Tx, name: string) =>
  tx.execute(
    tx.raw.sql`INSERT INTO public.nested_rows (name) VALUES (${name})`.affectedCount().build(),
  );

describe('tx.transaction on a role-bound Supabase client', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;

  beforeEach(async () => {
    database = await createDevDatabase();
    await setUpNestedRows(database.connectionString);
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    await database?.close();
  }, timeouts.spinUpPpgDev);

  it(
    'passes the facade context to the nested callback, commits the work around the nested transaction that threw, and runs every statement under the bound role',
    async () => {
      const pool = new pg.Pool({ connectionString: database.connectionString, max: 1 });
      const db = await supabase({ contract, pg: pool, jwtSecret: fixtureJwt });
      try {
        const jwt = await new SignJWT({ sub: crypto.randomUUID(), role: 'authenticated' })
          .setProtectedHeader({ alg: 'HS256' })
          .setExpirationTime('1h')
          .sign(new TextEncoder().encode(fixtureJwt));
        const user = await db.asUser(jwt);
        let insideRole: string | undefined;

        await user.transaction(async (tx) => {
          await insert(tx, 'A');
          await tx
            .transaction(async (inner) => {
              await insert(inner, 'B');
              const rows = await inner.query(
                inner.raw.sql`SELECT current_user AS role`
                  .returnsRow({ role: 'pg/text@1' })
                  .build(),
              );
              insideRole = rows[0]?.role;
              throw new Error('nope');
            })
            .catch(() => undefined);
          await insert(tx, 'C');
        });

        const committed = await pool.query(
          'SELECT name, role FROM public.nested_rows ORDER BY name',
        );
        expect({ insideRole, committed: committed.rows }).toEqual({
          insideRole: 'authenticated',
          committed: [
            { name: 'A', role: 'authenticated' },
            { name: 'C', role: 'authenticated' },
          ],
        });
      } finally {
        await db.close();
        await pool.end();
      }
    },
    timeouts.spinUpPpgDev,
  );
});
