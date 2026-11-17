/**
 * A `setDefault` that changes an existing default runs, whatever its operation class: it carries no postcheck, so the runner never finds it already applied.
 */
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import { col, lit } from '@internal/sql-relational-core/contract-free';
import { SetDefaultCall } from '@internal/target-postgres/op-factory-call';
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

const ticketClosedByDefault: Contract<SqlStorage> = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: profileHash('test'),
  storage: new SqlStorage({
    storageHash: coreHash('ticket-closed-by-default'),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
        id: UNBOUND_NAMESPACE_ID,
        entries: {
          table: {
            ticket: {
              columns: {
                id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                status: {
                  dataType: 'pg/text',
                  codecId: 'pg/text@1',
                  nullable: false,
                  default: { kind: 'literal', value: 'closed' },
                },
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

describe('PostgresMigrationRunner - setDefault on an existing default', {
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

  it.each(['additive', 'widening'] as const)(
    'runs a %s setDefault that changes an existing default',
    async (operationClass) => {
      await driver!.query(
        `create table "ticket" (id int4 primary key, status text not null default 'open')`,
      );
      const changeToClosed = await new SetDefaultCall(
        UNBOUND_NAMESPACE_ID,
        'ticket',
        col('status', 'text', { default: lit('closed'), codecRef: { codecId: 'pg/text@1' } }),
        operationClass,
      ).toOp(controlAdapter);
      const plan = createMigrationPlan<PostgresPlanTargetDetails>({
        targetId: 'postgres',
        spaceId: APP_SPACE_ID,
        origin: null,
        destination: toPlanContractInfo(ticketClosedByDefault),
        operations: [changeToClosed],
        providedInvariants: [],
      });

      const result = await postgresTargetDescriptor.createRunner(familyInstance).execute({
        driver: driver!,
        perSpaceOptions: [
          {
            space: APP_SPACE_ID,
            plan,
            migrationEdges: synthEdges(plan),
            driver: driver!,
            destinationContract: ticketClosedByDefault,
            policy: { allowedOperationClasses: ['additive', 'widening'] },
            frameworkComponents,
          },
        ],
      });
      const columnDefault = await driver!.query<{ column_default: string | null }>(
        `select column_default from information_schema.columns where table_name = 'ticket' and column_name = 'status'`,
      );

      expect({
        executed: result.ok ? result.value.perSpaceResults[0]?.value : result.failure,
        columnDefault: columnDefault.rows[0]?.column_default,
      }).toMatchObject({
        executed: { operationsPlanned: 1, operationsExecuted: 1 },
        columnDefault: expect.stringContaining('closed'),
      });
    },
    testTimeout,
  );
});
