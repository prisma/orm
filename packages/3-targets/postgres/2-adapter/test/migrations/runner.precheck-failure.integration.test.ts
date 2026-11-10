/**
 * Replaying migrations on a database with no marker that is already ahead of them: migration A adds `x int4`, migration B changes it to `int8`, and the database already has `x int8`. A's postcheck asks for `int4`, so the runner runs A, whose precheck finds the column already there. The failure names the operation and the check, and gives no explanation of its own, so the CLI can explain it and point to `db sign`.
 */
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { SqlStorage } from '@internal/sql-contract/types';
import { col } from '@internal/sql-relational-core/contract-free';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { AddColumnCall, AlterColumnTypeCall } from '@internal/target-postgres/op-factory-call';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createDriver,
  createMigrationPlan,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

const itemWithBigintX: Contract<SqlStorage> = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: profileHash('item-x-int8'),
  storage: new SqlStorage({
    storageHash: coreHash('item-x-int8'),
    namespaces: {
      public: postgresCreateNamespace({
        id: 'public',
        entries: {
          table: {
            item: {
              columns: {
                id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                x: { dataType: 'pg/int8', codecId: 'pg/int8@1', nullable: true },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      }),
    },
  }),
  roots: {},
  domain: applicationDomainOf({ models: {} }),
  capabilities: {},
  extensions: {},
  meta: {},
};

describe('PostgresMigrationRunner - replay on a database already ahead', {
  concurrent: false,
}, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    await database?.close();
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    await driver?.close();
    driver = undefined;
  }, testTimeout);

  it('fails at the precheck of the first migration, naming the operation and the check', {
    timeout: testTimeout,
  }, async () => {
    const live = driver!;
    await live.query('CREATE TABLE public.item (id int4 PRIMARY KEY, x int8)');
    const operations = [
      await new AddColumnCall('public', 'item', col('x', 'int4'), postgresDataTypes).toOp(
        controlAdapter,
      ),
      await new AlterColumnTypeCall({
        schemaName: 'public',
        tableName: 'item',
        columnName: 'x',
        type: 'int8',
        dataTypes: postgresDataTypes,
        ownsAutoincrementSequence: false,
      }).toOp(controlAdapter),
    ];
    const plan = createMigrationPlan<PostgresPlanTargetDetails>({
      targetId: 'postgres',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(itemWithBigintX),
      operations,
      providedInvariants: [],
    });

    const result = await postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver: live,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan,
          migrationEdges: synthEdges(plan),
          driver: live,
          destinationContract: itemWithBigintX,
          policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
          frameworkComponents,
        },
      ],
    });

    expect(
      result.ok ? undefined : { code: result.failure.code, meta: result.failure.meta },
    ).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      meta: {
        databaseUnchanged: true,
        failingSpace: APP_SPACE_ID,
        failedCheck: {
          operationId: 'column.public.item.x',
          phase: 'precheck',
          description: 'ensure column "x" is missing',
          expectation: { expects: 'absent', object: 'column "x" on "item"' },
        },
      },
    });
    expect(result.ok ? undefined : result.failure.why).toBe(
      'Before operation column.public.item.x runs, it checks: ensure column "x" is missing. That check failed: the database already has column "x" on "item". The failed apply changed nothing.',
    );
  });
});
