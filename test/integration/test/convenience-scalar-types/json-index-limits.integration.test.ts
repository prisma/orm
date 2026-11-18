import postgresAdapter from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import type { SqlStorage } from '@internal/sql-contract/types';
import postgres from '@internal/target-postgres/control';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  authorSqlContractFromPsl,
  postgresFrameworkComponents,
} from '../scalar-lists/psl-list-authoring';

const controlStack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
});

async function contractFrom(schema: string): Promise<Contract<SqlStorage>> {
  const authored = await authorSqlContractFromPsl(schema);
  expect(authored.diagnostics).toEqual([]);
  if (authored.contract === undefined) throw new Error('authoring produced no contract');
  return authored.contract;
}

async function apply(connectionString: string, contract: Contract<SqlStorage>) {
  const familyInstance = sql.create(controlStack);
  const driver = await postgresDriver.create(connectionString);
  try {
    const planResult = postgres.createPlanner(postgresAdapter.create(controlStack)).plan({
      contract,
      schema: await familyInstance.introspect({ driver }),
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents: postgresFrameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult)}`);
    }
    const { plan } = planResult;
    return await postgres.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan,
          migrationEdges: [
            buildFabricatedMigrationEdge({
              currentMarkerStorageHash: plan.origin?.storageHash,
              destinationStorageHash: plan.destination.storageHash,
              operationCount: plan.operations.length,
            }),
          ],
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents: postgresFrameworkComponents,
        },
      ],
    });
  } finally {
    await driver.close();
  }
}

const schemas = {
  unique: (type: string) => `model Event {\n  id      Int @id\n  payload ${type} @unique\n}`,
  index: (type: string) =>
    `model Event {\n  id      Int @id\n  payload ${type}\n\n  @@index([payload])\n}`,
};

describe('a PostgreSQL json column refuses a unique constraint and an index, and a jsonb column takes both', () => {
  it.each(Object.entries(schemas))(
    'Json with %s fails at apply with the operator-class error, and Json(storage: jsonb) applies',
    async (_name, schemaFor) => {
      const plainJson = await contractFrom(schemaFor('Json'));
      const jsonb = await contractFrom(schemaFor('Json(storage: jsonb)'));

      await withDevDatabase(async ({ connectionString }) => {
        const result = await apply(connectionString, plainJson);
        expect(result.ok).toBe(false);
        expect(JSON.stringify(result)).toContain(
          'data type json has no default operator class for access method \\"btree\\"',
        );
      });

      await withDevDatabase(async ({ connectionString }) => {
        const result = await apply(connectionString, jsonb);
        expect(result.ok).toBe(true);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
