import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import {
  PostgresDatabaseSchemaNode,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
} from './fixtures/runner-fixtures';

/** What `Bit`, `Bit(8)`, `VarBit`, `VarBit(16)`, `IntervalParts` and `IntervalParts(3)` emit. */
const COLUMNS = {
  bit: { dataType: 'pg/bit', codecId: 'pg/bit@1' },
  bit8: { dataType: 'pg/bit', codecId: 'pg/bit@1', typeParams: { length: 8 } },
  varbit: { dataType: 'pg/varbit', codecId: 'pg/varbit@1' },
  varbit16: { dataType: 'pg/varbit', codecId: 'pg/varbit@1', typeParams: { length: 16 } },
  interval: { dataType: 'pg/interval', codecId: 'pg/interval@1' },
  interval3: { dataType: 'pg/interval', codecId: 'pg/interval@1', typeParams: { precision: 3 } },
} as const;

function buildContract(): Contract<SqlStorage> {
  const columns = Object.fromEntries(
    Object.entries(COLUMNS).flatMap(([name, column]) => [
      [name, { ...column, nullable: true }],
      [`${name}List`, { ...column, nullable: true, many: { elementNullable: true } }],
    ]),
  );
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('bit-interval-columns'),
    storage: new SqlStorage({
      storageHash: coreHash('bit-interval-columns'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              sample: {
                columns: {
                  id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                  ...columns,
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
}

describe('Bit, VarBit and IntervalParts columns', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) await database.close();
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  it('a planned migration creates each column, and introspection reports its type', {
    timeout: testTimeout,
  }, async () => {
    const contract = buildContract();
    const planResult = postgresTargetDescriptor.createPlanner(controlAdapter).plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') throw new Error('planner failed');

    const runResult = await postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planResult.plan,
          migrationEdges: synthEdges(planResult.plan),
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!runResult.ok) {
      throw new Error(`runner failed:\n${formatRunnerFailure(runResult.failure)}`);
    }

    const schema = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(schema);
    const introspected = schema.namespaces['public']?.tables['sample']?.columns ?? {};
    const reported = Object.fromEntries(
      Object.entries(introspected)
        .filter(([name]) => name !== 'id')
        .map(([name, column]) => [
          name,
          `${column.reportedType?.text}${column.many === true ? '[]' : ''}`,
        ]),
    );

    expect(reported).toEqual({
      bit: 'bit(1)',
      bitList: 'bit(1)[]',
      bit8: 'bit(8)',
      bit8List: 'bit(8)[]',
      varbit: 'bit varying',
      varbitList: 'bit varying[]',
      varbit16: 'bit varying(16)',
      varbit16List: 'bit varying(16)[]',
      interval: 'interval',
      intervalList: 'interval[]',
      interval3: 'interval(3)',
      interval3List: 'interval(3)[]',
    });
  });
});
