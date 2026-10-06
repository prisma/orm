/**
 * A `vector(3)[]` literal default applied through the migration runner against a database with the
 * extension installed. The runner verifies the schema after it applies a plan, so a default the
 * schema check reads back differently from the contract fails the run.
 */

import postgresAdapterDescriptor from '@internal/adapter-postgres/control';
import {
  type ColumnDefaultLiteralInputValue,
  type Contract,
  coreHash,
  profileHash,
} from '@internal/contract/types';
import postgresDriverDescriptor from '@internal/driver-postgres/control';
import sqlFamilyDescriptor, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import {
  APP_SPACE_ID,
  createControlStack,
  type MigrationOperationPolicy,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import { SqlStorage, type StorageColumnInput } from '@internal/sql-contract/types';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import postgresTargetDescriptor from '@internal/target-postgres/control';
import {
  PostgresDatabaseSchemaNode,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { applicationDomainOf, createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pgvectorDescriptor from '../../src/exports/control';

const controlStack = createControlStack({
  family: sqlFamilyDescriptor,
  target: postgresTargetDescriptor,
  adapter: postgresAdapterDescriptor,
  driver: postgresDriverDescriptor,
  extensions: [pgvectorDescriptor],
});
const familyInstance = sqlFamilyDescriptor.create(controlStack);
const controlAdapter = postgresAdapterDescriptor.create(controlStack);
const frameworkComponents = [
  postgresTargetDescriptor,
  postgresAdapterDescriptor,
  postgresDriverDescriptor,
  pgvectorDescriptor,
] as const;

const emptySchema = new PostgresDatabaseSchemaNode({
  namespaces: {},
  roles: [],
  existingSchemas: ['public'],
  pgVersion: 'unknown',
});

const embeddings: ColumnDefaultLiteralInputValue = [
  [1, 2, 3],
  [4, 5, 6],
];

function buildContract(withDefault: boolean): Contract<SqlStorage> {
  const column: StorageColumnInput = {
    dataType: 'pgvector/vector',
    codecId: 'pg/vector@1',
    typeParams: { length: 3 },
    nullable: true,
    many: { elementNullable: false },
    noCheck: ['elementNotNull'],
    ...(withDefault ? { default: { kind: 'literal', value: embeddings } } : {}),
  };
  const hash = withDefault ? 'vector-list-default' : 'vector-list-without-default';
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(hash),
    storage: new SqlStorage({
      storageHash: coreHash(hash),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              doc: {
                columns: {
                  id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                  embeddings: column,
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

const additiveAndWidening: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening'],
};

type ControlDriver = Awaited<ReturnType<typeof postgresDriverDescriptor.create>>;

describe('a vector(3)[] literal default', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let driver: ControlDriver | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) await database.close();
  }, timeouts.spinUpPpgDev);

  beforeEach(async () => {
    driver = await postgresDriverDescriptor.create(database.connectionString);
    await driver.query('drop schema if exists public cascade');
    await driver.query('drop schema if exists prisma_contract cascade');
    await driver.query('create schema public');
    await driver.query('CREATE EXTENSION IF NOT EXISTS vector');
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, timeouts.spinUpPpgDev);

  async function applyWithRunner(
    contract: Contract<SqlStorage>,
    schema: SqlSchemaIRNode,
    policy: MigrationOperationPolicy,
  ): Promise<readonly string[]> {
    const planResult = postgresTargetDescriptor.createPlanner(controlAdapter).plan({
      contract,
      schema,
      policy,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }
    const plan = planResult.plan;
    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const result = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan,
          migrationEdges: [
            buildFabricatedMigrationEdge({
              currentMarkerStorageHash: plan.origin?.storageHash,
              destinationStorageHash: plan.destination.storageHash,
              operationCount: plan.operations.length,
            }),
          ],
          driver: driver!,
          destinationContract: contract,
          policy,
          frameworkComponents,
        },
      ],
    });
    if (!result.ok) {
      throw new Error(`runner failed: ${JSON.stringify(result.failure, null, 2)}`);
    }
    return (await Promise.all(plan.operations)).map((operation) => operation.id);
  }

  async function storedDefault(): Promise<unknown> {
    await driver!.query('INSERT INTO "doc" ("id") VALUES (1)');
    const { rows } = await driver!.query<{ embeddings: unknown }>(
      'SELECT to_jsonb("embeddings"::text[]) AS "embeddings" FROM "doc"',
    );
    return rows[0]?.embeddings;
  }

  it('is created with its table, and the schema check after it passes', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    await applyWithRunner(buildContract(true), emptySchema, INIT_ADDITIVE_POLICY);

    expect(await storedDefault()).toEqual(['[1,2,3]', '[4,5,6]']);
  });

  it('is set on an existing column, and the schema check after it passes', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    await applyWithRunner(buildContract(false), emptySchema, INIT_ADDITIVE_POLICY);
    const contract = buildContract(true);

    const operationIds = await applyWithRunner(
      contract,
      await familyInstance.introspect({ driver: driver!, contract }),
      additiveAndWidening,
    );

    expect({ operationIds, stored: await storedDefault() }).toEqual({
      operationIds: ['setDefault.doc.embeddings'],
      stored: ['[1,2,3]', '[4,5,6]'],
    });
  });
});
