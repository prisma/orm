import postgresAdapter from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresControlDriver from '@internal/driver-postgres/control';
import sql, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import type { SqlStorage } from '@internal/sql-contract/types';
import postgres from '@internal/target-postgres/control';
import { createDevDatabase, type DevDatabase, timeouts, withClient } from '@repo/test-utils';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authorSqlContractFromPsl,
  postgresFrameworkComponents,
} from '../scalar-lists/psl-list-authoring';

const controlStack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresControlDriver,
  extensions: [],
});
const familyInstance = sql.create(controlStack);

const WRITTEN = "now() - interval '1 day'";
const STORED = "(now() - '1 day'::interval)";
const EXPLANATION = `The database reads this default back as sql\`${STORED}\`; the contract declares sql\`${WRITTEN}\`. The database may store a default expression in its own form, so the two can mean the same. If they do, write the default as sql\`${STORED}\`.`;

async function contractWithDefault(expression: string): Promise<Contract<SqlStorage>> {
  const authored = await authorSqlContractFromPsl(`model Event {
  id Int      @id
  at TimestamptzTemporal @default(sql\`${expression}\`)
}`);
  expect(authored.diagnostics).toEqual([]);
  if (authored.contract === undefined) throw new Error('authoring produced no contract');
  return authored.contract;
}

async function apply(connectionString: string, contract: Contract<SqlStorage>) {
  const driver = await postgresControlDriver.create(connectionString);
  try {
    const schema = await familyInstance.introspect({ driver });
    const planResult = postgres.createPlanner(postgresAdapter.create(controlStack)).plan({
      contract,
      schema,
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
    return await postgres.createRunner(familyInstance).execute({
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

async function verify(connectionString: string, contract: Contract<SqlStorage>) {
  const driver = await postgresControlDriver.create(connectionString);
  try {
    const schema = await familyInstance.introspect({ driver, contract });
    return familyInstance.verifySchema({
      contract,
      schema,
      strict: true,
      frameworkComponents: postgresFrameworkComponents,
    });
  } finally {
    await driver.close();
  }
}

describe('a raw SQL default the database stores in its own form', { concurrent: false }, () => {
  let database: DevDatabase | undefined;

  function connectionString(): string {
    if (!database) throw new Error('database not initialised');
    return database.connectionString;
  }

  beforeAll(async () => {
    database = await createDevDatabase();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) await database.close();
  }, timeouts.spinUpPpgDev);

  beforeEach(async () => {
    await withClient(connectionString(), async (client) => {
      await client.query('DROP SCHEMA IF EXISTS public CASCADE');
      await client.query('CREATE SCHEMA public');
      await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
    });
  }, timeouts.spinUpPpgDev);

  it(
    'fails the check after apply with the stored form and what to write',
    async () => {
      const result = await apply(connectionString(), await contractWithDefault(WRITTEN));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.code).toBe('MIGRATION.SCHEMA_VERIFY_FAILED');
      const issues = result.failure.meta.schemaIssues;
      expect(
        issues?.map((issue) => ({
          path: issue.path.join('/'),
          explanation: issue.explanation,
        })),
      ).toEqual([
        {
          path: 'database/public/Event/column:at/default',
          explanation: { text: EXPLANATION, cause: 'possibly-equivalent' },
        },
      ]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reports the stored form when verifying a database that holds it',
    async () => {
      const applied = await apply(connectionString(), await contractWithDefault(STORED));
      expect(applied.ok).toBe(true);

      const result = await verify(connectionString(), await contractWithDefault(WRITTEN));

      expect(
        result.schema.issues.map((issue) => ({
          path: issue.path.join('/'),
          explanation: issue.explanation,
        })),
      ).toEqual([
        {
          path: 'database/public/Event/column:at/default',
          explanation: { text: EXPLANATION, cause: 'possibly-equivalent' },
        },
      ]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'applies and verifies clean once the contract declares the stored form',
    async () => {
      const contract = await contractWithDefault(STORED);

      const applied = await apply(connectionString(), contract);

      expect(applied.ok).toBe(true);
      expect((await verify(connectionString(), contract)).schema.issues).toEqual([]);
    },
    timeouts.spinUpPpgDev,
  );
});
