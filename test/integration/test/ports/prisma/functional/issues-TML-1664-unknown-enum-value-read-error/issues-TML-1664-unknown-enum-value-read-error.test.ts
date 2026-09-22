import postgresAdapterControl from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresDriverControl from '@internal/driver-postgres/control';
import sqlFamilyControl, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import postgres from '@internal/postgres/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import postgresTargetControl from '@internal/target-postgres/control';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { Contract as PortContract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/TML-1664-unknown-enum-value-read-error
// (postgres only).
//
// Subject: reading a row whose enum column contains a value the schema does not
// know about surfaces a structured error (Prisma P2023 → Prisma 8:
// RUNTIME.DECODE_FAILED or a SqlQueryError).
//
// Setup: after schema push (native PG ENUM "Status"), ALTER TYPE Status ADD VALUE
// 'UNKNOWN_TO_PRISMA', then INSERT a row with that value via raw SQL. Then read via ORM.
//
// In Prisma 8, the pg/enum@1 codec is a text passthrough — decode() returns
// the wire string verbatim without validation against the known member set.
// So 'UNKNOWN_TO_PRISMA' is returned as-is rather than rejected at decode time.
// The TypeScript type for status is `'ACTIVE' | 'INACTIVE'` so the type does not
// include the unknown value, but at runtime the codec passes the raw string through.
//
// This is a gap relative to Prisma's P2023 behaviour. The test is marked
// it.fails: the faithful assertion (expects a structured error) does not
// hold; Prisma 8 returns the row with the raw unknown string.
//
// Disposition:
//   'returns a structured error when reading an enum value unknown to the schema'
//   → it.fails (no RUNTIME.DECODE_FAILED for pg/enum@1 codec; row returned as-is)

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

describe('ports/prisma/functional/issues-TML-1664-unknown-enum-value-read-error', () => {
  it.fails(
    'returns a structured error when reading an enum value unknown to the schema',
    () =>
      withDevDatabase(async ({ connectionString }) => {
        await pushContract(connectionString);

        await withClient(connectionString, async (client) => {
          await client.query(`ALTER TYPE "Status" ADD VALUE 'UNKNOWN_TO_PRISMA'`);
          await client.query(
            `INSERT INTO "user" ("id", "status") VALUES ('1', 'UNKNOWN_TO_PRISMA')`,
          );
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
          let caughtError: unknown;
          try {
            await db.orm.public.User.all();
          } catch (e) {
            caughtError = e;
          }

          expect(caughtError).toBeInstanceOf(Error);
          expect((caughtError as Error).message).toContain(
            "Value 'UNKNOWN_TO_PRISMA' not found in enum 'Status'",
          );
        } finally {
          await runtime.close();
        }
      }),
    timeouts.spinUpPpgDev,
  );
});
