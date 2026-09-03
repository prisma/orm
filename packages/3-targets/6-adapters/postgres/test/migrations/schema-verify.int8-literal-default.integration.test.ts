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

const PAST_SAFE_INTEGER_TEXT = '9007199254740993';

function moneyContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('int8-literal-default'),
    storage: new SqlStorage({
      storageHash: coreHash('int8-literal-default'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              ps: {
                columns: {
                  id: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                  v: {
                    nativeType: 'int8',
                    codecId: 'pg/int8number@1',
                    nullable: false,
                    default: { kind: 'literal', value: 0 },
                  },
                  w: {
                    nativeType: 'int4',
                    codecId: 'pg/int4@1',
                    nullable: false,
                    default: { kind: 'literal', value: 0 },
                  },
                  bigIntSmall: {
                    nativeType: 'int8',
                    codecId: 'pg/int8@1',
                    nullable: false,
                    default: { kind: 'literal', value: '0' },
                  },
                  bigIntPastSafeInteger: {
                    nativeType: 'int8',
                    codecId: 'pg/int8@1',
                    nullable: false,
                    default: { kind: 'literal', value: PAST_SAFE_INTEGER_TEXT },
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
}

describe('Schema verification after runner - int8 literal default (issue #30174)', {
  concurrent: false,
}, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
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

  it('applies and verifies literal defaults on int8 (BigIntNumber, BigInt) and int4 columns', {
    timeout: testTimeout,
  }, async () => {
    const contract = moneyContract();
    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);

    const planResult = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') {
      throw new Error(`Planner failed: ${planResult.kind}`);
    }

    const executeResult = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: planResult.plan.spaceId ?? APP_SPACE_ID,
          plan: planResult.plan,
          migrationEdges: synthEdges(planResult.plan),
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });

    if (!executeResult.ok) {
      throw new Error(
        `db migrate failed on its own post-apply verification:\n${formatRunnerFailure(executeResult.failure)}`,
      );
    }

    const schema = await familyInstance.introspect({ driver: driver!, contract });
    const verifyResult = familyInstance.verifySchema({
      contract,
      schema,
      strict: false,
      frameworkComponents,
    });

    expect(verifyResult.ok).toBe(true);
    expect(verifyResult.schema.issues).toHaveLength(0);

    PostgresDatabaseSchemaNode.assert(schema);
    const column = schema.namespaces['public']?.tables['ps']?.columns['bigIntPastSafeInteger'];
    expect(column?.resolvedDefault).toEqual({ kind: 'literal', value: PAST_SAFE_INTEGER_TEXT });
  });
});
