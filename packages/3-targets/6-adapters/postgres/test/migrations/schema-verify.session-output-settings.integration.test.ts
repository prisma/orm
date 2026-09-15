import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import {
  PostgresDatabaseSchemaNode,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
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

const timestamptz = {
  nativeType: 'timestamptz',
  codecId: 'pg/timestamptz-temporal@1',
  nullable: false,
  typeParams: { precision: 6 },
} as const;

function stampsContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('session-output-settings'),
    storage: new SqlStorage({
      storageHash: coreHash('session-output-settings'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              Stamps: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  firstDay: {
                    ...timestamptz,
                    default: { kind: 'function', expression: "'0001-01-01 00:00:00+00'" },
                  },
                  recent: {
                    ...timestamptz,
                    default: { kind: 'literal', value: '2024-06-01T12:00:00Z' },
                  },
                  beforeYearOne: {
                    ...timestamptz,
                    default: { kind: 'function', expression: "'0001-12-31 23:30:00+00 BC'" },
                  },
                  span: {
                    nativeType: 'interval',
                    codecId: 'pg/interval@1',
                    nullable: false,
                    default: { kind: 'function', expression: "'1 day 02:00:00'::interval" },
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

interface OutputSettings {
  readonly timeZone: string;
  readonly dateStyle: string;
  readonly intervalStyle: string;
}

async function outputSettings(driver: PostgresControlDriver): Promise<OutputSettings | undefined> {
  const { rows } = await driver.query<OutputSettings>(
    `SELECT current_setting('TimeZone') AS "timeZone",
            current_setting('DateStyle') AS "dateStyle",
            current_setting('IntervalStyle') AS "intervalStyle"`,
  );
  return rows[0];
}

const callerSettings: OutputSettings = {
  timeZone: 'America/New_York',
  dateStyle: 'SQL, DMY',
  intervalStyle: 'sql_standard',
};

describe('introspection in a session with its own output settings', { concurrent: false }, () => {
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
      `CREATE TABLE "Stamps" (
        "id" INTEGER NOT NULL,
        "firstDay" TIMESTAMPTZ(6) NOT NULL DEFAULT '0001-01-01 00:00:00+00',
        "recent" TIMESTAMPTZ(6) NOT NULL DEFAULT '2024-06-01 12:00:00+00',
        "beforeYearOne" TIMESTAMPTZ(6) NOT NULL DEFAULT '0001-12-31 23:30:00+00 BC',
        "span" INTERVAL NOT NULL DEFAULT '1 day 02:00:00',
        CONSTRAINT "Stamps_pkey" PRIMARY KEY ("id")
      )`,
    );
    await driver.query("SET TIME ZONE 'America/New_York'");
    await driver.query("SET DateStyle = 'SQL, DMY'");
    await driver.query("SET IntervalStyle = 'sql_standard'");
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  it('reads defaults in UTC, ISO and postgres styles, and a contract holding that text verifies', {
    timeout: testTimeout,
  }, async () => {
    const contract = stampsContract();

    const schema = await familyInstance.introspect({ driver: driver!, contract });

    PostgresDatabaseSchemaNode.assert(schema);
    const columns = schema.namespaces['public']?.tables['Stamps']?.columns;
    expect({
      firstDay: columns?.['firstDay']?.default,
      recent: columns?.['recent']?.default,
      beforeYearOne: columns?.['beforeYearOne']?.default,
      span: columns?.['span']?.default,
    }).toEqual({
      firstDay: "'0001-01-01 00:00:00+00'::timestamp with time zone",
      recent: "'2024-06-01 12:00:00+00'::timestamp with time zone",
      beforeYearOne: "'0001-12-31 23:30:00+00 BC'::timestamp with time zone",
      span: "'1 day 02:00:00'::interval",
    });
    const result = familyInstance.verifySchema({
      contract,
      schema,
      strict: true,
      frameworkComponents,
    });
    expect(result.schema.issues.map((issue) => issue.path.join('/'))).toEqual([]);
  });

  it('leaves the settings the caller set on the session', {
    timeout: testTimeout,
  }, async () => {
    await familyInstance.introspect({ driver: driver!, contract: stampsContract() });

    expect(await outputSettings(driver!)).toEqual(callerSettings);
  });

  it('leaves the settings the caller set inside its transaction', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('BEGIN');
    await driver!.query("SET LOCAL TIME ZONE 'Asia/Kathmandu'");
    await driver!.query("SET LOCAL DateStyle = 'German, DMY'");
    await driver!.query("SET LOCAL IntervalStyle = 'iso_8601'");

    await familyInstance.introspect({ driver: driver!, contract: stampsContract() });

    const inTransaction = await outputSettings(driver!);
    await driver!.query('ROLLBACK');
    expect(inTransaction).toEqual({
      timeZone: 'Asia/Kathmandu',
      dateStyle: 'German, DMY',
      intervalStyle: 'iso_8601',
    });
  });

  it('leaves the session settings in place after the caller commits a transaction that set local ones', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('BEGIN');
    await driver!.query("SET LOCAL TIME ZONE 'Asia/Kathmandu'");
    await driver!.query("SET LOCAL DateStyle = 'German, DMY'");
    await driver!.query("SET LOCAL IntervalStyle = 'iso_8601'");

    await familyInstance.introspect({ driver: driver!, contract: stampsContract() });
    await driver!.query('COMMIT');

    expect(await outputSettings(driver!)).toEqual(callerSettings);
  });
});
