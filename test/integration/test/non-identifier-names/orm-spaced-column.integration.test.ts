/**
 * Strongly-typed ORM round-trip over a `@map`ped column whose physical name is
 * not a bare TypeScript identifier (https://github.com/prisma/prisma-next/issues/981).
 *
 * The test consumes the precise emitted contract fixture (not a widened
 * `Contract<SqlStorage>`), so the generated `contract.d.ts` has to typecheck
 * for this file to compile at all — the quoted property keys are load-bearing
 * here, not merely asserted about. On top of that it migrates the contract onto
 * a real Postgres database and round-trips a row, proving the emitted types
 * also drive correct SQL against the space-containing column and table.
 */
import postgresAdapter from '@internal/adapter-postgres/control';
import postgresRuntimeAdapter from '@internal/adapter-postgres/runtime';
import type { Contract as FrameworkContract } from '@internal/contract/types';
import postgresControlDriver from '@internal/driver-postgres/control';
import sql, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import type { SqlStorage } from '@internal/sql-contract/types';
import { orm } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgres from '@internal/target-postgres/control';
import postgresRuntimeTarget, {
  PostgresContractSerializer,
} from '@internal/target-postgres/runtime';
import { createDevDatabase, type DevDatabase, timeouts, withClient } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import type { Contract } from '../sql-orm-client/fixtures/non-identifier-names/generated/contract';
import contractJson from '../sql-orm-client/fixtures/non-identifier-names/generated/contract.json' with {
  type: 'json',
};
import { createTestRuntimeFromClient } from '../utils';

const controlStack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresControlDriver,
  extensions: [],
});
const familyInstance = sql.create(controlStack);
const frameworkComponents = [postgres, postgresAdapter] as const;

const contract = new PostgresContractSerializer().deserializeContract(contractJson) as Contract;

async function migrateContract(connectionString: string): Promise<void> {
  const driver = await postgresControlDriver.create(connectionString);
  try {
    const schema = await familyInstance.introspect({ driver });
    const planner = postgres.createPlanner(postgresAdapter.create(controlStack));
    const planResult = planner.plan({
      contract: contract as FrameworkContract<SqlStorage>,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult)}`);
    }

    const runner = postgres.createRunner(familyInstance);
    const runResult = await runner.execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planResult.plan,
          migrationEdges: [
            buildFabricatedMigrationEdge({
              currentMarkerStorageHash: planResult.plan.origin?.storageHash,
              destinationStorageHash: planResult.plan.destination.storageHash,
              operationCount: planResult.plan.operations.length,
            }),
          ],
          driver,
          destinationContract: contract as FrameworkContract<SqlStorage>,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!runResult.ok) {
      throw new Error(`runner failed: ${JSON.stringify(runResult.failure)}`);
    }
  } finally {
    await driver.close();
  }
}

describe('ORM round-trip over a space-containing column name', { concurrent: false }, () => {
  let database: DevDatabase | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) await database.close();
  }, timeouts.spinUpPpgDev);

  it(
    'writes and reads a @map("has space") column through the typed ORM',
    async () => {
      if (!database) throw new Error('database not initialised');

      await withClient(database.connectionString, async (client) => {
        await client.query('DROP SCHEMA IF EXISTS public CASCADE');
        await client.query('CREATE SCHEMA public');
        await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
      });
      await migrateContract(database.connectionString);

      await withClient(database.connectionString, async (client) => {
        const runtime = await createTestRuntimeFromClient(
          contract as FrameworkContract<SqlStorage>,
          client,
          { verifyMarker: false },
        );

        const context = createExecutionContext<Contract>({
          contract,
          stack: createSqlExecutionStack({
            target: postgresRuntimeTarget,
            adapter: postgresRuntimeAdapter,
            extensions: [],
          }),
        });
        const db = orm({ runtime, context });

        await db.public.DataRow.create({ id: 1, spacedValue: 'written through the ORM' });
        await db.public.DataRow.create({ id: 2, spacedValue: null });

        const rows = await db.public.DataRow.select('id', 'spacedValue').all();

        expect(rows).toEqual([
          { id: 1, spacedValue: 'written through the ORM' },
          { id: 2, spacedValue: null },
        ]);

        type Row = (typeof rows)[number];
        expectTypeOf<Row['spacedValue']>().toEqualTypeOf<string | null>();

        // The physical names really are the space-containing ones — the round
        // trip above would pass just as well against unmapped columns.
        const physical = await client.query(`SELECT "has space" FROM "data rows" WHERE id = 1`);
        expect(physical.rows).toEqual([{ 'has space': 'written through the ORM' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
