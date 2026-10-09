import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID, issueOutcome } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { normalizeSqlBody, parseNaming } from '@internal/sql-schema-ir/naming';
import { computeContentHash } from '@internal/target-postgres/rls-canonicalize';
import {
  PostgresRlsEnablement,
  PostgresRlsPolicy,
  PostgresSchema,
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

const TABLE_NAME = 'profiles';
const POLICY_USING = '(id = user_id)';
const POLICY_PREFIX = 'read_own_profiles';
const POLICY_HASH = computeContentHash({
  using: normalizeSqlBody(POLICY_USING),
  roles: ['public'],
  operation: 'select',
  permissive: true,
});

const policy = new PostgresRlsPolicy({
  naming: parseNaming(`${POLICY_PREFIX}_${POLICY_HASH}`, POLICY_PREFIX),
  tableName: TABLE_NAME,
  namespaceId: 'public',
  operation: 'select',
  roles: ['public'],
  using: POLICY_USING,
  withCheck: undefined,
  permissive: true,
});

function buildContractWithPolicy(): Contract<SqlStorage> {
  const schema = new PostgresSchema({
    id: UNBOUND_NAMESPACE_ID,
    entries: {
      table: {
        [TABLE_NAME]: new StorageTable({
          columns: {
            id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            user_id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      policy: { [policy.name]: policy },
      rls: {
        [TABLE_NAME]: new PostgresRlsEnablement({
          tableName: TABLE_NAME,
          namespaceId: UNBOUND_NAMESPACE_ID,
        }),
      },
    },
  });

  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('rls-verify-test'),
    storage: new SqlStorage({
      storageHash: coreHash('rls-verify-test'),
      namespaces: { [UNBOUND_NAMESPACE_ID]: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

describe('RLS verify extension issues', { concurrent: false }, () => {
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

  async function applyContract(
    d: PostgresControlDriver,
    contractInput: Contract<SqlStorage>,
  ): Promise<void> {
    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const planResult = planner.plan({
      contract: contractInput,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success')
      throw new Error(
        `Planner failed: ${planResult.kind}\n${JSON.stringify(planResult.conflicts, null, 2)}`,
      );
    const executeResult = await runner.execute({
      driver: d,
      perSpaceOptions: [
        {
          space: planResult.plan.spaceId ?? APP_SPACE_ID,
          plan: planResult.plan,
          migrationEdges: synthEdges(planResult.plan),
          driver: d,
          destinationContract: contractInput,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!executeResult.ok) {
      throw new Error(`Runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }
  }

  it('no RLS policy issues when the declared policy exists in the database', {
    timeout: testTimeout,
  }, async () => {
    const contract = buildContractWithPolicy();
    await applyContract(driver!, contract);

    const schema = await familyInstance.introspect({ driver: driver!, contract });
    const result = familyInstance.verifySchema({
      contract,
      schema,
      strict: false,
      frameworkComponents,
    });

    expect(result.schema.issues).toEqual([]);
  });

  it('emits a missing SchemaDiffIssue when policy is declared but absent in the database', {
    timeout: testTimeout,
  }, async () => {
    const contract = buildContractWithPolicy();

    // Apply only the table (no policy) by using a contract without any entries.policy.
    const noPolicySchema = new PostgresSchema({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: {
          [TABLE_NAME]: new StorageTable({
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              user_id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
          }),
        },
        policy: {},
      },
    });
    const noPolicyContract: Contract<SqlStorage> = {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('rls-verify-no-policy'),
      storage: new SqlStorage({
        storageHash: coreHash('rls-verify-no-policy'),
        namespaces: { [UNBOUND_NAMESPACE_ID]: noPolicySchema },
      }),
      roots: {},
      domain: applicationDomainOf({ models: {} }),
      capabilities: {},
      extensions: {},
      meta: {},
    };
    await applyContract(driver!, noPolicyContract);

    // Verify against the policy contract — policy is absent in the DB.
    const schema = await familyInstance.introspect({ driver: driver!, contract });
    const result = familyInstance.verifySchema({
      contract,
      schema,
      strict: false,
      frameworkComponents,
    });

    const rlsIssues = result.schema.issues.filter((i) => issueOutcome(i) === 'not-found');
    expect(rlsIssues).toHaveLength(1);
    expect(rlsIssues[0]?.expected).toMatchObject({ name: policy.name });
  });

  it('verify result is ok:false when a declared policy is absent from the database', {
    timeout: testTimeout,
  }, async () => {
    const contract = buildContractWithPolicy();

    const noPolicySchema = new PostgresSchema({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: {
          [TABLE_NAME]: new StorageTable({
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              user_id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
          }),
        },
        policy: {},
      },
    });
    const noPolicyContract: Contract<SqlStorage> = {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('rls-verify-no-policy-2'),
      storage: new SqlStorage({
        storageHash: coreHash('rls-verify-no-policy-2'),
        namespaces: { [UNBOUND_NAMESPACE_ID]: noPolicySchema },
      }),
      roots: {},
      domain: applicationDomainOf({ models: {} }),
      capabilities: {},
      extensions: {},
      meta: {},
    };
    await applyContract(driver!, noPolicyContract);

    const schema = await familyInstance.introspect({ driver: driver!, contract });
    const result = familyInstance.verifySchema({
      contract,
      schema,
      strict: false,
      frameworkComponents,
    });

    expect(result.ok).toBe(false);
    const rlsIssues = result.schema.issues.filter((i) => issueOutcome(i) === 'not-found');
    expect(rlsIssues[0]?.path.join('/')).toContain(policy.name);
  });
});
