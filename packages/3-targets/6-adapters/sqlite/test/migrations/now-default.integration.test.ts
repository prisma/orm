import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import type { AnyCodecDescriptor, Codec } from '@internal/framework-components/codec';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageColumnInput } from '@internal/sql-contract/types';
import { SQLITE_DATETIME_CODEC_ID } from '@internal/target-sqlite/codec-ids';
import { sqliteCodecRegistry } from '@internal/target-sqlite/codecs';
import { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import { applicationDomainOf, timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  sqliteTargetDescriptor,
  synthEdges,
  type TestDatabase,
} from './fixtures/runner-fixtures';

const CODEC_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const nowDefault: StorageColumnInput = {
  dataType: 'sqlite/text',
  codecId: SQLITE_DATETIME_CODEC_ID,
  nullable: false,
  default: { kind: 'function', expression: 'now()' },
};

function contractOf(columns: Record<string, StorageColumnInput>): Contract<SqlStorage> {
  const hash = Object.keys(columns).join('-');
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash(hash),
    storage: new SqlStorage({
      storageHash: coreHash(hash),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              post: {
                columns: {
                  id: { dataType: 'sqlite/integer', codecId: 'sqlite/integer@1', nullable: false },
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

function datetimeCodec(): Codec {
  const descriptor = sqliteCodecRegistry.descriptorFor(SQLITE_DATETIME_CODEC_ID);
  if (!descriptor) throw new Error('no datetime codec descriptor');
  return (descriptor as AnyCodecDescriptor).factory(undefined as never)({ name: 'test' }) as Codec;
}

async function expectCodecText(text: string, before: number, after: number): Promise<void> {
  expect(text).toMatch(CODEC_TEXT);
  const codec = datetimeCodec();
  const decoded = (await codec.fromWire(text, {})) as Date;
  expect(decoded.getTime()).toBeGreaterThanOrEqual(before - 1000);
  expect(decoded.getTime()).toBeLessThanOrEqual(after + 1000);
  expect(await codec.toWire(decoded, {})).toBe(text);
}

describe('a SQLite now() default', { timeout: timeouts.databaseOperation }, () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  it('stores the text the datetime codec writes', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const contract = contractOf({ createdAt: nowDefault });
    const planResult = sqliteTargetDescriptor.createPlanner(controlAdapter).plan({
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
    if (planResult.kind !== 'success') throw new Error('expected planner success');

    const before = Date.now();
    const result = await sqliteTargetDescriptor.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planResult.plan,
          migrationEdges: synthEdges(planResult.plan),
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!result.ok) throw new Error(formatRunnerFailure(result.failure));

    await driver.query('INSERT INTO "post" ("id") VALUES (1)');
    const after = Date.now();

    const row = await driver.query<{ createdAt: string }>('SELECT "createdAt" FROM "post"');
    await expectCodecText(row.rows[0]!.createdAt, before, after);

    const marker = await driver.query<{ updated_at: string }>(
      'SELECT updated_at FROM _prisma_marker WHERE space = ?',
      [APP_SPACE_ID],
    );
    await expectCodecText(marker.rows[0]!.updated_at, before, after);

    const controlDefaults = await driver.query<{ name: string; dflt_value: string }>(
      `SELECT 'marker.updated_at' AS name, dflt_value FROM pragma_table_info('_prisma_marker') WHERE name = 'updated_at'
       UNION ALL
       SELECT 'ledger.created_at', dflt_value FROM pragma_table_info('_prisma_ledger') WHERE name = 'created_at'`,
    );
    expect(controlDefaults.rows).toEqual([
      { name: 'marker.updated_at', dflt_value: "strftime('%Y-%m-%dT%H:%M:%fZ','now')" },
      { name: 'ledger.created_at', dflt_value: "strftime('%Y-%m-%dT%H:%M:%fZ','now')" },
    ]);
  });

  it.each([["(datetime('now'))"], ['CURRENT_TIMESTAMP']])(
    'verifies clean and plans no change against a column created with DEFAULT %s',
    async (oldDefault) => {
      testDb = createTestDatabase();
      const { driver } = testDb;
      await driver.query(
        `CREATE TABLE "post" ("id" INTEGER NOT NULL PRIMARY KEY, "createdAt" TEXT NOT NULL DEFAULT ${oldDefault})`,
      );
      const contract = contractOf({ createdAt: nowDefault });
      const schema = await familyInstance.introspect({ driver, contract });

      const verify = familyInstance.verifySchema({
        contract,
        schema,
        strict: true,
        frameworkComponents,
      });
      expect(verify.schema.issues).toEqual([]);

      const planResult = sqliteTargetDescriptor.createPlanner(controlAdapter).plan({
        contract,
        schema,
        policy: INIT_ADDITIVE_POLICY,
        fromContract: null,
        origin: null,
        statements: [],
        frameworkComponents,
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: '../../snapshots',
      });
      if (planResult.kind !== 'success') throw new Error('expected planner success');
      expect(planResult.plan.operations).toEqual([]);
    },
  );
});
