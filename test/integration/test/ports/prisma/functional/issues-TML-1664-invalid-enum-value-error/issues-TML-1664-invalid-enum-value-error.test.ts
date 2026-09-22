import postgresAdapterControl from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresDriverControl from '@internal/driver-postgres/control';
import sqlFamilyControl, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import postgres from '@internal/postgres/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import { SqlQueryError } from '@internal/sql-errors';
import postgresTargetControl from '@internal/target-postgres/control';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { Contract as PortContract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/TML-1664-invalid-enum-value-error
// (postgres only).
//
// Subject: inserting an enum value that exists in the schema but was removed from
// the database native PG ENUM surfaces a structured error (Prisma P2007 →
// Prisma 8: SqlQueryError with sqlState '22P02').
//
// Setup: after schema push (which creates native PG ENUM "Status" with 3 values),
// ALTER the DB enum to remove 'PENDING' via a rename-and-drop pattern, then
// attempt to create a User with status 'PENDING'. PostgreSQL rejects with
// SQLSTATE 22P02 (invalid_text_representation).
//
// The test uses withDevDatabase + withClient for DDL (ALTER TYPE) because
// the standard withPostgresPort harness does not expose a raw DDL channel.
// Prisma 8 PSL uses native_enum (pg.enum()) for a real PostgreSQL ENUM type.
//
// Disposition:
//   'returns SqlQueryError(22P02) when inserting an enum value absent from the database enum'
//   → passing (SqlQueryError with sqlState '22P02')

const serializer = new PostgresContractSerializer();
const controlStack = createControlStack({
  family: sqlFamilyControl,
  target: postgresTargetControl,
  adapter: postgresAdapterControl,
  driver: postgresDriverControl,
  extensions: [],
});
const controlFamily = sqlFamilyControl.create(controlStack);
const controlAdapter = postgresAdapterControl.create(controlStack);
const frameworkComponents = [
  postgresTargetControl,
  postgresAdapterControl,
  postgresDriverControl,
] as const;

async function pushContract(connectionString: string): Promise<void> {
  const contract = controlFamily.deserializeContract(contractJson) as Contract<SqlStorage>;
  const driver = await postgresDriverControl.create(connectionString);
  try {
    const schema = await controlFamily.introspect({ driver, contract });
    const planner = postgresTargetControl.createPlanner(controlAdapter);
    const planResult = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') {
      throw new Error(`Contract push planning failed: ${JSON.stringify(planResult)}`);
    }
    const plan = planResult.plan;
    const runner = postgresTargetControl.createRunner(controlFamily);
    const executeResult = await runner.execute({
      driver,
      perSpaceOptions: [
        {
          space: plan.spaceId ?? APP_SPACE_ID,
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
          frameworkComponents,
        },
      ],
    });
    if (!executeResult.ok) {
      throw new Error(`Contract push apply failed: ${JSON.stringify(executeResult.failure)}`);
    }
  } finally {
    await driver.close();
  }
}

describe('ports/prisma/functional/issues-TML-1664-invalid-enum-value-error', () => {
  it(
    'returns SqlQueryError(22P02) when inserting an enum value absent from the database enum',
    () =>
      withDevDatabase(async ({ connectionString }) => {
        await pushContract(connectionString);

        await withClient(connectionString, async (client) => {
          await client.query(`
            ALTER TABLE "user" ALTER COLUMN "status" DROP DEFAULT;
            CREATE TYPE "Status_new" AS ENUM ('ACTIVE', 'INACTIVE');
            ALTER TABLE "user"
              ALTER COLUMN "status" TYPE "Status_new"
              USING "status"::text::"Status_new";
            DROP TYPE "Status";
            ALTER TYPE "Status_new" RENAME TO "Status";
          `);
        });

        const base = serializer.deserializeContract(
          JSON.parse(JSON.stringify(contractJson)),
        ) as PortContract;
        const contract = {
          ...base,
          capabilities: { ...base.capabilities, returning: { enabled: true } },
        } as PortContract;

        const db = postgres<PortContract>({ contract, url: connectionString, verifyMarker: false });
        const runtime = await db.connect();
        try {
          const error = await db.orm.public.User.create({
            id: '1',
            status: 'PENDING',
          }).catch((e) => e);

          expect(SqlQueryError.is(error)).toBe(true);
          expect(error).toMatchObject({ sqlState: '22P02' });
          expect(error.message).toContain('invalid input value for enum');
        } finally {
          await runtime.close();
        }
      }),
    timeouts.spinUpPpgDev,
  );
});
