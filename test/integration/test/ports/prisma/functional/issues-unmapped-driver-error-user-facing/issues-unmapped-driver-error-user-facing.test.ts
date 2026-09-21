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

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/unmapped-driver-error-user-facing
// (postgres only).
//
// Subject: an unmapped Postgres error (SQLSTATE 42P10 — "no unique or exclusion
// constraint matching the ON CONFLICT specification") surfaced from an upsert
// becomes a user-facing structured error (Prisma P2039 → Prisma 8:
// SqlQueryError with sqlState '42P10').
//
// Setup: after schema push, drop the unique index on `email` to simulate
// schema drift (the contract still declares `@unique`, the DB does not have
// the constraint). A subsequent upsert targeting `email` fails with 42P10.
//
// In Prisma 8 the unique index name is managed (content-hashed prefix),
// so we discover the actual index name at runtime from pg_indexes rather than
// hard-coding "User_email_key" as upstream does.
//
// Disposition:
//   'returns P2039 with the original DB code and message for unmapped Postgres errors'
//   → passing (SqlQueryError with sqlState '42P10')

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

describe('ports/prisma/functional/issues-unmapped-driver-error-user-facing', () => {
  it(
    'returns SqlQueryError(42P10) for an upsert when the unique constraint backing it was dropped',
    () =>
      withDevDatabase(async ({ connectionString }) => {
        await pushContract(connectionString);

        await withClient(connectionString, async (client) => {
          // Prisma 8 emits @unique as an ALTER TABLE ... ADD CONSTRAINT (backed index),
          // so we must DROP the constraint rather than DROP INDEX directly.
          const result = await client.query<{ conname: string }>(
            `SELECT conname FROM pg_constraint
             WHERE conrelid = 'public."user"'::regclass AND contype = 'u' LIMIT 1`,
          );
          const constraintName = result.rows[0]?.conname;
          if (!constraintName) {
            throw new Error('Could not find unique constraint on email column');
          }
          await client.query(`ALTER TABLE "user" DROP CONSTRAINT "${constraintName}"`);
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
          const error = await db.orm.public.User.upsert({
            create: { id: 'u1', email: 'alice@example.com', name: 'Alice' },
            update: { name: 'Alice' },
            conflictOn: { email: 'alice@example.com' },
          }).catch((e) => e);

          expect(SqlQueryError.is(error)).toBe(true);
          expect(error).toMatchObject({ sqlState: '42P10' });
          expect(error.message).toContain(
            'there is no unique or exclusion constraint matching the ON CONFLICT specification',
          );
        } finally {
          await runtime.close();
        }
      }),
    timeouts.spinUpPpgDev,
  );
});
