import postgresAdapter from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresControlDriver from '@internal/driver-postgres/control';
import sql, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import type { SqlStorage } from '@internal/sql-contract/types';
import postgres from '@internal/target-postgres/control';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  authorSqlContractFromPsl,
  findStorageColumn,
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
const planner = postgres.createPlanner(postgresAdapter.create(controlStack));

async function applyContract(
  driver: Awaited<ReturnType<typeof postgresControlDriver.create>>,
  contract: Contract<SqlStorage>,
) {
  const planResult = planner.plan({
    contract,
    schema: await familyInstance.introspect({ driver }),
    policy: INIT_ADDITIVE_POLICY,
    fromContract: null,
    frameworkComponents: postgresFrameworkComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (planResult.kind !== 'success') {
    throw new Error(`planner failed: ${JSON.stringify(planResult)}`);
  }
  return postgres.createRunner(familyInstance).execute({
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
}

describe('a Uuid default written in upper case or in braces', () => {
  it(
    'applies, then verifies against the database with no issue and plans no change',
    async () => {
      const authored = await authorSqlContractFromPsl(`
model Token {
  id     Int  @id
  upper  Uuid @default("A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11")
  braced Uuid @default("{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}")
}
`);
      const contract = authored.contract!;
      const database = await createDevDatabase();
      const driver = await postgresControlDriver.create(database.connectionString);
      try {
        const applied = await applyContract(driver, contract);
        const schema = await familyInstance.introspect({ driver, contract });
        const verified = familyInstance.verifySchema({
          contract,
          schema,
          strict: false,
          frameworkComponents: postgresFrameworkComponents,
        });
        const replanned = planner.plan({
          contract,
          schema,
          policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
          fromContract: contract,
          frameworkComponents: postgresFrameworkComponents,
          spaceId: APP_SPACE_ID,
          snapshotsImportPath: '../../snapshots',
        });

        expect({
          defaults: ['upper', 'braced'].map(
            (name) => findStorageColumn(contract, name)?.['default'],
          ),
          applied: applied.ok ? true : applied.failure,
          issues: verified.schema.issues,
          replannedOperations:
            replanned.kind === 'success'
              ? (await Promise.all(replanned.plan.operations)).map((op) => op.id)
              : replanned,
        }).toEqual({
          defaults: [
            { kind: 'literal', value: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
            { kind: 'literal', value: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
          ],
          applied: true,
          issues: [],
          replannedOperations: [],
        });
      } finally {
        await driver.close();
        await database.close();
      }
    },
    timeouts.spinUpPpgDev,
  );
});
