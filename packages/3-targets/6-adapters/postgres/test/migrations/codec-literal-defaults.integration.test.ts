import {
  asNamespaceId,
  type ColumnDefaultLiteralInputValue,
  type Contract,
  coreHash,
  profileHash,
} from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
} from '@internal/framework-components/control';
import { SqlStorage, type StorageColumnInput } from '@internal/sql-contract/types';
import { col, lit } from '@internal/sql-relational-core/contract-free';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { PostgresCreateTable } from '@internal/target-postgres/ddl';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../../src/core/control-adapter';
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

interface DefaultCase {
  readonly column: string;
  readonly nativeType: string;
  readonly codecId: string;
  readonly many: boolean;
  readonly literal: ColumnDefaultLiteralInputValue;
}

const cases: readonly DefaultCase[] = [
  { column: 'byte', nativeType: 'bytea', codecId: 'pg/bytea@1', many: false, literal: 'aGVsbG8=' },
  {
    column: 'bytes',
    nativeType: 'bytea',
    codecId: 'pg/bytea@1',
    many: true,
    literal: ['aGVsbG8='],
  },
  {
    column: 'documents',
    nativeType: 'jsonb',
    codecId: 'pg/jsonb@1',
    many: true,
    literal: [{ a: 1 }, 'x'],
  },
  {
    column: 'span',
    nativeType: 'interval',
    codecId: 'pg/interval@1',
    many: false,
    literal: 'P1DT2H',
  },
  {
    column: 'spans',
    nativeType: 'interval',
    codecId: 'pg/interval@1',
    many: true,
    literal: ['P1DT2H', 'PT-0.5S'],
  },
];

const table = 'Defaults';

function createTable(): PostgresCreateTable {
  return new PostgresCreateTable({
    table,
    columns: [
      col('id', 'int4', { notNull: true, primaryKey: true }),
      ...cases.map((defaultCase) =>
        col(defaultCase.column, `${defaultCase.nativeType}${defaultCase.many ? '[]' : ''}`, {
          default: lit(defaultCase.literal),
          codecRef: { codecId: defaultCase.codecId, ...(defaultCase.many ? { many: true } : {}) },
        }),
      ),
    ],
  });
}

function buildContract(withDefaults: boolean): Contract<SqlStorage> {
  const columns = Object.fromEntries(
    cases.map((defaultCase): [string, StorageColumnInput] => [
      defaultCase.column,
      {
        nativeType: defaultCase.nativeType,
        codecId: defaultCase.codecId,
        nullable: true,
        ...(defaultCase.many
          ? { many: { elementNullable: false }, noCheck: ['elementNotNull'] }
          : {}),
        ...(withDefaults ? { default: { kind: 'literal', value: defaultCase.literal } } : {}),
      },
    ]),
  );
  const hash = withDefaults ? 'codec-literal-defaults' : 'columns-without-defaults';
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(hash),
    storage: new SqlStorage({
      storageHash: coreHash(hash),
      namespaces: {
        public: postgresCreateNamespace({
          id: asNamespaceId('public'),
          entries: {
            table: {
              [table]: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
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

const additiveAndWidening: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening'],
};

function plan(
  contract: Contract<SqlStorage>,
  schema: SqlSchemaIRNode,
  policy: MigrationOperationPolicy,
) {
  const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
  const planResult = planner.plan({
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
  return planResult.plan;
}

type PlannedMigration = ReturnType<typeof plan>;

interface StoredRow {
  readonly byte: unknown;
  readonly bytes: unknown;
  readonly documents: unknown;
  readonly span: unknown;
  readonly spans: unknown;
}

const storedDefaults: StoredRow = {
  byte: 'hello',
  bytes: ['hello'],
  documents: [{ a: 1 }, 'x'],
  span: 'P1DT2H',
  spans: ['P1DT2H', 'PT-0.5S'],
};

describe('literal defaults rendered through the column codec', { concurrent: false }, () => {
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

  async function insertedRow(): Promise<readonly StoredRow[]> {
    await driver!.query(`INSERT INTO "${table}" ("id") VALUES (1)`);
    await driver!.query(`SET IntervalStyle = 'iso_8601'`);
    const { rows } = await driver!.query<StoredRow>(
      `SELECT convert_from("byte", 'UTF8') AS "byte",
              (SELECT jsonb_agg(convert_from(element, 'UTF8')) FROM unnest("bytes") AS element) AS "bytes",
              to_jsonb("documents") AS "documents",
              to_jsonb("span") AS "span",
              to_jsonb("spans") AS "spans"
         FROM "${table}"`,
    );
    return rows;
  }

  async function applyWithRunner(
    contract: Contract<SqlStorage>,
    migration: PlannedMigration,
    policy: MigrationOperationPolicy,
  ): Promise<void> {
    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const executeResult = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: migration,
          migrationEdges: synthEdges(migration),
          driver: driver!,
          destinationContract: contract,
          policy,
          frameworkComponents,
        },
      ],
    });
    if (!executeResult.ok) {
      throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }
  }

  /**
   * Runs each operation's statements without the runner, because the runner verifies the schema
   * afterwards and schema verification does not read a bytea literal default back yet.
   */
  async function executeStatements(migration: PlannedMigration): Promise<readonly string[]> {
    const operations = await Promise.all(migration.operations);
    for (const operation of operations) {
      for (const statement of operation.execute) {
        await driver!.query(statement.sql, statement.params ?? []);
      }
    }
    return operations.map((operation) => operation.id);
  }

  it('stores the codec values of defaults written by CREATE TABLE', {
    timeout: testTimeout,
  }, async () => {
    const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
    const ddl = await adapter.lowerToExecuteRequest(createTable());
    await driver!.query(ddl.sql);

    expect(await insertedRow()).toEqual([storedDefaults]);
  });

  it('stores the codec values of defaults a migration sets on existing columns', {
    timeout: testTimeout,
  }, async () => {
    const withoutDefaults = buildContract(false);
    await applyWithRunner(
      withoutDefaults,
      plan(withoutDefaults, emptySchema, INIT_ADDITIVE_POLICY),
      INIT_ADDITIVE_POLICY,
    );
    const contract = buildContract(true);

    const operationIds = await executeStatements(
      plan(
        contract,
        await familyInstance.introspect({ driver: driver!, contract }),
        additiveAndWidening,
      ),
    );

    expect({ operationIds, rows: await insertedRow() }).toEqual({
      operationIds: cases.map((defaultCase) => `setDefault.${table}.${defaultCase.column}`),
      rows: [storedDefaults],
    });
  });
});
