import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageColumnInput } from '@internal/sql-contract/types';
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
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
} from './fixtures/runner-fixtures';

const table = 'Blobs';

function sqlDefault(expression: string, many = false): StorageColumnInput {
  return {
    dataType: 'pg/bytea',
    codecId: 'pg/bytea@1',
    nullable: true,
    ...(many ? { many: { elementNullable: false }, noCheck: ['elementNotNull'] } : {}),
    default: { kind: 'function', expression },
  };
}

function contractOf(columns: Record<string, StorageColumnInput>): Contract<SqlStorage> {
  const hash = Object.keys(columns).join('-');
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
              [table]: {
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

describe('raw SQL bytea defaults, read as PostgreSQL bytea input', { concurrent: false }, () => {
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

  it('creates escape-format defaults, and the schema check after it passes', {
    timeout: testTimeout,
  }, async () => {
    const contract = contractOf({
      word: sqlDefault("'hello'::bytea"),
      escaped: sqlDefault("'a\\\\b\\001\\377'::bytea"),
      words: sqlDefault("ARRAY['hello'::bytea, '\\x6869'::bytea]", true),
    });
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
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }

    const result = await postgresTargetDescriptor.createRunner(familyInstance).execute({
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
    if (!result.ok) throw new Error(`runner failed:\n${formatRunnerFailure(result.failure)}`);

    await driver!.query(`INSERT INTO "${table}" ("id") VALUES (1)`);
    const { rows } = await driver!.query(
      `SELECT encode("word", 'hex') AS "word", encode("escaped", 'hex') AS "escaped",
              to_jsonb(ARRAY(SELECT encode(element, 'hex') FROM unnest("words") AS element)) AS "words"
         FROM "${table}"`,
    );
    expect(rows).toEqual([
      { word: '68656c6c6f', escaped: '615c6201ff', words: ['68656c6c6f', '6869'] },
    ]);
  });

  it('does not read base64 text in raw SQL as the bytes it encodes', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(
      `CREATE TABLE "${table}" (
         "id" int4 PRIMARY KEY,
         "blob" bytea DEFAULT '\\x68656c6c6f',
         "blobs" bytea[] DEFAULT ARRAY['\\x68656c6c6f'::bytea]
       )`,
    );
    const contract = contractOf({
      blob: sqlDefault("'aGVsbG8='::bytea"),
      blobs: sqlDefault("ARRAY['aGVsbG8='::bytea]", true),
    });

    const result = familyInstance.verifySchema({
      contract,
      schema: await familyInstance.introspect({ driver: driver!, contract }),
      strict: true,
      frameworkComponents,
    });

    expect(result.schema.issues.map((issue) => issue.path.join('/'))).toEqual([
      'database/public/Blobs/column:blob/default',
      'database/public/Blobs/column:blobs/default',
    ]);
  });
});
