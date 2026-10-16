import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDriver,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

/** A contract whose `timestamptz` default is `stored`, on a column whose codec holds a `Temporal.Instant`. */
const contractWith = (stored: string): Contract<SqlStorage> => ({
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
                id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                at: {
                  dataType: 'pg/timestamptz',
                  codecId: 'pg/timestamptz-temporal@1',
                  nullable: false,
                  default: { kind: 'literal', value: stored },
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
});

describe('a default db verify reads with the column codec', {
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

  const issuesOf = async (contract: Contract<SqlStorage>) => {
    const schema = await familyInstance.introspect({ driver: driver!, contract });
    return familyInstance
      .verifySchema({ contract, schema, strict: true, frameworkComponents })
      .schema.issues.map((issue) => ({
        path: issue.path.join('/'),
        explanation: issue.explanation,
      }));
  };

  it('matches the value the database reports in its own spelling', {
    timeout: testTimeout,
  }, async () => {
    expect(await issuesOf(contractWith('2024-01-01T00:00:00Z'))).toEqual([]);
  });

  it('reports a database default the codec cannot read, with the codec message', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(`ALTER TABLE "event" ALTER COLUMN "at" SET DEFAULT 'infinity'`);
    expect(await issuesOf(contractWith('2024-01-01T00:00:00Z'))).toEqual([
      {
        path: 'database/public/event/column:at/default',
        explanation: expect.stringMatching(
          /^The column codec pg\/timestamptz-temporal@1 cannot read the default the database reports, 'infinity'::timestamp with time zone: /,
        ),
      },
    ]);
  });

  it('refuses a contract default its data type does not hold before it reads the database', {
    timeout: testTimeout,
  }, async () => {
    const contract = contractWith('2024-01-01 00:00:00');
    const schema = await familyInstance.introspect({ driver: driver!, contract });
    expect(() =>
      familyInstance.verifySchema({ contract, schema, strict: true, frameworkComponents }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.VALIDATION_FAILED',
        message: expect.stringContaining(
          'Table "event", column "at": the default "2024-01-01 00:00:00"',
        ),
      }),
    );
  });
});
