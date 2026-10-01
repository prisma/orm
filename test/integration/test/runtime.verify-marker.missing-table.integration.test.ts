import postgresAdapter from '@internal/adapter-postgres/runtime';
import postgresDriver from '@internal/driver-postgres/runtime';
import pgvector from '@internal/extension-pgvector/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { PostgresRuntimeImpl } from '@internal/postgres/runtime';
import { sql } from '@internal/sql-builder/runtime';
import type { Log } from '@internal/sql-runtime';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { contract } from './sql-builder/fixtures/contract';
import type { Contract } from './sql-builder/fixtures/generated/contract';

const sqlContract = new PostgresContractSerializer().deserializeContract(contract) as Contract;

describe('runtime verify-marker: missing marker table', {
  timeout: timeouts.databaseOperation,
}, () => {
  let connectionString: string;
  const closeFns: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    const database = await createDevDatabase();
    connectionString = database.connectionString;
    closeFns.push(() => database.close());

    // Deliberately skip `prisma_contract.marker` — the scenario under test
    // is PN attaching to a database that has never had `db init` run.
    await withClient(connectionString, async (client) => {
      await client.query(`
          CREATE TABLE users (
            id int4 PRIMARY KEY,
            name text NOT NULL,
            email text NOT NULL,
            invited_by_id int4
          )
        `);
      await client.query(`
          INSERT INTO users (id, name, email, invited_by_id) VALUES
            (1, 'Alice', 'alice@example.com', NULL)
        `);
    });
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    for (const fn of closeFns) {
      try {
        await fn();
      } catch {
        // ignore cleanup errors
      }
    }
  });

  it('logs warn and proceeds when the marker table is absent', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Log;

    const stack = createSqlExecutionStack({
      target: postgresTarget,
      adapter: postgresAdapter,
      driver: postgresDriver,
      extensions: [pgvector],
    });
    const stackInstance = instantiateExecutionStack(stack);
    const context = createExecutionContext({ contract: sqlContract, stack });
    const driver = stackInstance.driver;
    if (!driver) {
      throw new Error('Driver missing from execution stack instance');
    }

    const client = new Client({ connectionString });
    await driver.connect({ kind: 'pgClient', client });

    const runtime = new PostgresRuntimeImpl({
      closeRefusal: undefined,
      context,
      adapter: stackInstance.adapter,
      driver,
      log,
    });
    const builder = sql({ context, rawCodecInferer: { inferCodec: () => 'pg/text' } });

    try {
      const rows = await runtime.query(builder.public.users.select('id').build()).toArray();

      expect(rows.map((r) => r.id)).toEqual([1]);
      expect(log.warn).toHaveBeenCalledOnce();
      expect(log.warn).toHaveBeenCalledWith({
        code: 'CONTRACT.MARKER_MISSING',
        scope: 'marker-verification',
        expected: {
          storageHash: sqlContract.storage.storageHash,
          profileHash: sqlContract.profileHash ?? null,
        },
        actual: null,
        message: 'Contract marker not found in database',
      });
    } finally {
      await runtime.close();
    }
  });
});
