import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  contract,
  createDriver,
  createMigrationPlan,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  synthEdges,
  testTimeout,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';
import { releaseCandidatePrismaTables } from './fixtures/release-candidate-prisma-tables';

const INIT_ADDITIVE_POLICY = { allowedOperationClasses: ['additive'] as const };

describe("PostgresMigrationRunner on a database without Prisma's own tables", {
  concurrent: false,
}, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver;

  beforeAll(async () => {
    database = await createTestDatabase();
    driver = await createDriver(database.connectionString);
  }, testTimeout);

  afterAll(async () => {
    await driver.close();
    await database.close();
  }, testTimeout);

  beforeEach(async () => {
    await driver.query('drop schema if exists prisma_contract cascade');
    await driver.query('drop schema if exists _prisma cascade');
    await driver.query('drop table if exists public.ran');
  }, testTimeout);

  async function runAppPlan() {
    const plan = createMigrationPlan<PostgresPlanTargetDetails>({
      targetId: 'postgres',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [
        {
          id: 'table.ran',
          label: 'Create table ran',
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: { schema: 'public', objectType: 'table', name: 'ran' },
          },
          precheck: [],
          execute: [{ description: 'create table ran', sql: 'CREATE TABLE public.ran (id int)' }],
          postcheck: [],
        },
      ],
      providedInvariants: [],
    });
    return postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan,
          migrationEdges: synthEdges(plan),
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });
  }

  async function ranTableExists(): Promise<boolean> {
    const result = await driver.query<{ exists: boolean }>(
      "select to_regclass('public.ran') is not null as exists",
    );
    return result.rows[0]?.exists ?? false;
  }

  it('fails before any operation when the tables were never created', {
    timeout: testTimeout,
  }, async () => {
    const result = await runAppPlan();

    const failure = result.assertNotOk();
    expect({
      code: failure.code,
      message: failure.message,
      failingSpace: failure.meta.failingSpace,
      ran: await ranTableExists(),
    }).toEqual({
      code: 'MIGRATION.PRISMA_TABLES_MISSING',
      message: expect.stringContaining('_prisma.marker'),
      failingSpace: APP_SPACE_ID,
      ran: false,
    });
  });

  it('fails before any operation on a database a release candidate set up', {
    timeout: testTimeout,
  }, async () => {
    for (const statement of releaseCandidatePrismaTables) await driver.query(statement);

    const result = await runAppPlan();

    expect({ code: result.assertNotOk().code, ran: await ranTableExists() }).toEqual({
      code: 'MIGRATION.PRISMA_TABLES_MISSING',
      ran: false,
    });
  });
});
