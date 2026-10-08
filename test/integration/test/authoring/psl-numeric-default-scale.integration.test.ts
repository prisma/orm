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

function priceSchema(defaultValue: string): string {
  return `
model Price {
  id Int            @id
  n  Numeric(10, 2) @default(${defaultValue})
}
`;
}

async function applyContract(
  driver: Awaited<ReturnType<typeof postgresControlDriver.create>>,
  contract: Contract<SqlStorage>,
) {
  const planResult = planner.plan({
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
  const applied = await postgres.createRunner(familyInstance).execute({
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
  if (!applied.ok) throw new Error(`apply failed: ${JSON.stringify(applied.failure)}`);
}

describe('a numeric default on a column with a scale', () => {
  it('is stored with as many fraction digits as the scale, as PostgreSQL prints it', async () => {
    const authored = await authorSqlContractFromPsl(priceSchema('1.5'));

    expect({
      diagnostics: authored.diagnostics,
      default: findStorageColumn(authored.contract!, 'n')?.['default'],
    }).toEqual({ diagnostics: [], default: { kind: 'literal', value: '1.50' } });
  });

  it.each([
    ['a third fraction digit', '1.234'],
    ['more whole digits than the precision leaves', '123456789.5'],
  ])('is refused, not rounded, when it has %s', async (_why, written) => {
    const authored = await authorSqlContractFromPsl(priceSchema(written));

    expect(authored.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_DEFAULT_LITERAL',
        message: `Field "Price.n": pg/numeric JSON value must be a decimal string that numeric(10, 2) stores without rounding`,
      }),
    ]);
  });

  it(
    'is the text PostgreSQL prints for the column default and for a row that takes it',
    async () => {
      const authored = await authorSqlContractFromPsl(priceSchema('1.5'));
      const database = await createDevDatabase();
      const driver = await postgresControlDriver.create(database.connectionString);
      try {
        await applyContract(driver, authored.contract!);
        const reported = await driver.query<{ column_default: string }>(
          `SELECT column_default FROM information_schema.columns WHERE table_name = 'Price' AND column_name = 'n'`,
        );
        await driver.query(`INSERT INTO "Price" ("id") VALUES (1)`);
        const rows = await driver.query<{ n: string }>(`SELECT "n"::text AS n FROM "Price"`);

        expect({
          stored: findStorageColumn(authored.contract!, 'n')?.['default'],
          reported: reported.rows[0]?.column_default,
          row: rows.rows[0]?.n,
        }).toEqual({
          stored: { kind: 'literal', value: '1.50' },
          reported: '1.50::numeric(10,2)',
          row: '1.50',
        });
      } finally {
        await driver.close();
        await database.close();
      }
    },
    timeouts.spinUpPpgDev,
  );
});
