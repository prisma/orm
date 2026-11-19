/**
 * Integration test demonstrating the programmatic control client.
 *
 * This test shows how to use createControlClient for database operations
 * instead of manual SQL and the stampMarker script.
 */

import { PostgresContractSerializer } from '@prisma/orm-postgres/target/runtime';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../src/prisma/contract.d';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };
import { createTestControlClient, initTestDatabase } from './utils/control-client';

// Use the emitted JSON contract which has the real computed hashes
const contract = new PostgresContractSerializer().deserializeContract<Contract>(contractJson);

describe('control client integration', () => {
  it(
    'initializes database schema from contract',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        // Use control client to initialize the database
        await initTestDatabase({ connection: connectionString, contract: contract });

        // Verify tables were created by querying the database
        const pool = new Pool({ connectionString });
        try {
          const result = await pool.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
          `);
          const tableNames = result.rows.map((r) => r.table_name);

          expect(tableNames).toContain('user');
          expect(tableNames).toContain('post');
        } finally {
          await pool.end();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'verifies database marker after sign',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        // Initialize and sign database
        await initTestDatabase({ connection: connectionString, contract: contract });

        // Create a new client to verify
        const client = createTestControlClient({ connection: connectionString });
        try {
          const verifyResult = await client.verify({ contract: contract });

          expect(verifyResult).toMatchObject({
            ok: true,
            contract: { storageHash: expect.anything() },
          });
        } finally {
          await client.close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'schema verify passes after dbInit',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract: contract });

        const client = createTestControlClient({ connection: connectionString });
        try {
          const schemaResult = await client.schemaVerify({ contract: contract });

          expect(schemaResult.ok).toBe(true);
        } finally {
          await client.close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'introspects database schema',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract: contract });

        const client = createTestControlClient({ connection: connectionString });
        try {
          const schema = await client.introspect();

          // Schema should be an object with tables
          expect(schema).toBeDefined();
          expect(typeof schema).toBe('object');
        } finally {
          await client.close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );
});
