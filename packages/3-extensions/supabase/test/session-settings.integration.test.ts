import { contractFromJson } from '@internal/postgres/static';
import { createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import pg from 'pg';
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

describe('the session settings of a Supabase client on a pool the application supplies', () => {
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
    'hold again for the next role scope after the RESET ALL that ends one, whatever the session went back to',
    async () => {
      const pool = new pg.Pool({ connectionString: database.connectionString, max: 1 });
      const db = await supabase({ contract, pg: pool, jwtSecret: fixtureJwt, verifyMarker: false });
      const service = db.asServiceRole();
      const dateStyle = async () => {
        const rows = await service.query(
          service.raw.sql`SELECT current_setting('DateStyle') AS style`
            .returnsRow({ style: 'pg/text@1' })
            .build(),
        );
        return rows[0]?.style;
      };

      try {
        await pool.query("SET DateStyle TO 'German, DMY'");
        const first = await dateStyle();
        await pool.query("SET DateStyle TO 'German, DMY'");
        const second = await dateStyle();

        expect({ first, second }).toEqual({
          first: expect.stringMatching(/^ISO/),
          second: expect.stringMatching(/^ISO/),
        });
      } finally {
        await db.close();
        await pool.end();
      }
    },
    timeouts.spinUpPpgDev,
  );
});
