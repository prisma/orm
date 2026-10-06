/**
 * Boolean reloption round trip (F02): an index authored with a JS boolean
 * option value renders, applies, and verifies clean — the canonical form is
 * the catalog reprint spelling (`on`/`off`), shared by the DDL renderer,
 * the option equality, and the wire-name hash — and a live index created
 * with either boolean spelling compares equal to the authored value.
 */
import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { SqlStorage } from '@internal/sql-contract/types';
import { computeIndexContentHash } from '@internal/sql-schema-ir/naming';
import postgresTargetDescriptor from '@internal/target-postgres/control';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
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
  resetDatabase,
  synthEdges,
  testTimeout,
} from './fixtures/runner-fixtures';

const WIRE_NAME = `doc_tags_gin_${computeIndexContentHash({
  columns: ['tags'],
  unique: false,
  type: 'gin',
  options: { fastupdate: false },
})}`;

function buildContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('index-boolean-options'),
    storage: new SqlStorage({
      storageHash: coreHash('index-boolean-options'),
      namespaces: {
        public: postgresCreateNamespace({
          id: asNamespaceId('public'),
          entries: {
            table: {
              doc: {
                columns: {
                  id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                  tags: { dataType: 'pg/jsonb', codecId: 'pg/jsonb@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [
                  {
                    name: WIRE_NAME,
                    prefix: 'doc_tags_gin',
                    columns: ['tags'],
                    unique: false,
                    type: 'gin',
                    options: { fastupdate: false },
                  },
                ],
                foreignKeys: [],
              },
            },
          },
        }),
      },
    }),
    domain: applicationDomainOf({ models: {} }),
    roots: {},
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

describe('boolean reloption round trip', { concurrent: false }, () => {
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

  it('author { fastupdate: false } → migrate → verify clean', {
    timeout: testTimeout,
  }, async () => {
    const contract = buildContract();
    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const executeResult = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: result.plan.spaceId ?? APP_SPACE_ID,
          plan: result.plan,
          migrationEdges: synthEdges(result.plan),
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!executeResult.ok) {
      throw new Error(`Runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }

    const verifyResult = familyInstance.verifySchema({
      contract,
      schema: await familyInstance.introspect({ driver: driver!, contract }),
      strict: true,
      frameworkComponents,
    });
    expect(verifyResult.schema.issues).toEqual([]);
    expect(verifyResult.ok).toBe(true);
  });

  it('a live index created with the other boolean spelling still verifies clean', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE TABLE doc (id int PRIMARY KEY, tags jsonb NOT NULL)');
    await driver!.query(
      `CREATE INDEX "${WIRE_NAME}" ON doc USING gin (tags) WITH (fastupdate = false)`,
    );

    const contract = buildContract();
    const verifyResult = familyInstance.verifySchema({
      contract,
      schema: await familyInstance.introspect({ driver: driver!, contract }),
      strict: true,
      frameworkComponents,
    });
    expect(verifyResult.schema.issues).toEqual([]);
    expect(verifyResult.ok).toBe(true);
  });
});
