import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

const REFUSAL =
  'The contract holds this default in a form its data type does not store: pg/timestamptz needs a UTC offset, but "2024-01-01 00:00:00" has none. Add Z for UTC or an offset such as +02:00, as in "2024-01-01T12:34:56Z". Re-emit the contract, then try again.';

/**
 * A contract an earlier version emitted, which stored a `timestamptz` default as it was written,
 * without an offset. The canonical form of `pg/timestamptz` now refuses that text.
 */
const contract: Contract<SqlStorage> = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: profileHash('refused-date-time-default'),
  storage: new SqlStorage({
    storageHash: coreHash('refused-date-time-default'),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
        id: UNBOUND_NAMESPACE_ID,
        entries: {
          table: {
            event: {
              columns: {
                id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                at: {
                  nativeType: 'timestamptz',
                  codecId: 'pg/timestamptz-temporal@1',
                  nullable: false,
                  default: { kind: 'literal', value: '2024-01-01 00:00:00' },
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

describe('a contract default the canonical form of its data type refuses', {
  concurrent: false,
}, () => {
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
    await driver.query(
      `CREATE TABLE "event" ("id" INTEGER NOT NULL, "at" TIMESTAMPTZ NOT NULL DEFAULT '2024-01-01 00:00:00+00', CONSTRAINT "event_pkey" PRIMARY KEY ("id"))`,
    );
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  it('drifts with the refusal and a hint to re-emit', { timeout: testTimeout }, async () => {
    const schema = await familyInstance.introspect({ driver: driver!, contract });
    const result = familyInstance.verifySchema({
      contract,
      schema,
      strict: true,
      frameworkComponents,
    });
    expect(
      result.schema.issues.map((issue) => ({
        path: issue.path.join('/'),
        explanation: issue.explanation,
      })),
    ).toEqual([{ path: 'database/public/event/column:at/default', explanation: REFUSAL }]);
  });

  it('names the refusal when the database has no default', { timeout: testTimeout }, async () => {
    await driver!.query('ALTER TABLE "event" ALTER COLUMN "at" DROP DEFAULT');
    const schema = await familyInstance.introspect({ driver: driver!, contract });
    const result = familyInstance.verifySchema({
      contract,
      schema,
      strict: true,
      frameworkComponents,
    });
    expect(
      result.schema.issues.map((issue) => ({
        path: issue.path.join('/'),
        explanation: issue.explanation,
      })),
    ).toEqual([{ path: 'database/public/event/column:at/default', explanation: REFUSAL }]);
  });

  it('is not written by the planner', { timeout: testTimeout }, async () => {
    const schema = await familyInstance.introspect({ driver: driver!, contract });
    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    expect(() =>
      planner.plan({
        contract,
        schema,
        policy: { allowedOperationClasses: ['additive', 'widening'] },
        fromContract: null,
        frameworkComponents,
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: '../../snapshots',
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message: `Column "at": ${REFUSAL}`,
      }),
    );
  });
});
