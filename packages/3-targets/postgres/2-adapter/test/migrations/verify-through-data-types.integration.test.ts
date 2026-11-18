/**
 * `db verify` compares each column by the data type that claims the type the database reports and its parameters in normal form, so a column created with any spelling of the contract's type verifies clean, and a changed column is named with the type the database reports.
 */
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { issueOutcome, type SchemaDiffIssue } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageColumnInput } from '@internal/sql-contract/types';
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

const id: StorageColumnInput = { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false };

const columns: Readonly<Record<string, StorageColumnInput>> = {
  id,
  name: {
    dataType: 'pg/varchar',
    codecId: 'pg/varchar@1',
    nullable: true,
    typeParams: { length: 20 },
  },
  created: {
    dataType: 'pg/timestamptz',
    codecId: 'pg/timestamptz-string@1',
    nullable: true,
    typeParams: { precision: 3 },
  },
  amount: {
    dataType: 'pg/numeric',
    codecId: 'pg/numeric@1',
    nullable: true,
    typeParams: { precision: 10 },
  },
  code: { dataType: 'pg/char', codecId: 'pg/char@1', nullable: true },
  tags: {
    dataType: 'pg/text',
    codecId: 'pg/text@1',
    nullable: true,
    many: { elementNullable: true },
  },
  status: {
    dataType: 'pg/enum',
    codecId: 'pg/enum@1',
    nullable: true,
    typeParams: { typeName: 'app.status' },
  },
};

function contractIn(
  namespaceId: string,
  tableColumns: Readonly<Record<string, StorageColumnInput>>,
): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('verify-through-data-types'),
    storage: new SqlStorage({
      storageHash: coreHash('verify-through-data-types'),
      namespaces: {
        [namespaceId]: postgresCreateNamespace({
          id: namespaceId,
          entries: {
            table: {
              t: {
                columns: tableColumns,
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

function describeIssue(issue: SchemaDiffIssue) {
  return {
    outcome: issueOutcome(issue),
    path: issue.path.join('/'),
    explanation: issue.explanation?.text,
  };
}

describe('db verify through data types', { concurrent: false }, () => {
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
    await driver.query('drop schema if exists app cascade');
    await driver.query('create schema app');
    await driver.query("create type app.status as enum ('on', 'off')");
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  async function createTable() {
    await driver!.query(`create table public.t (
      id integer primary key,
      name character varying(20),
      created timestamp(3) with time zone,
      amount numeric(10,0),
      code character(1),
      tags text[],
      status app.status
    )`);
  }

  async function verify(contract: Contract<SqlStorage>) {
    const result = familyInstance.verifySchema({
      contract,
      schema: await familyInstance.introspect({ driver: driver!, contract }),
      strict: false,
      frameworkComponents,
    });
    return result.schema.issues.map(describeIssue);
  }

  it('is clean for each column created with another spelling of its type', {
    timeout: testTimeout,
  }, async () => {
    await createTable();
    expect(await verify(contractIn('public', columns))).toEqual([]);
  });

  it('is clean for an enum outside public whether or not its schema is on the search path', {
    timeout: testTimeout,
  }, async () => {
    await createTable();
    await driver!.query('set search_path to public, app');
    const onPath = await verify(contractIn('public', columns));
    await driver!.query('set search_path to public');
    const offPath = await verify(contractIn('public', columns));
    expect({ onPath, offPath }).toEqual({ onPath: [], offPath: [] });
  });

  it('names a column whose type was changed by raw SQL, with the type the database reports', {
    timeout: testTimeout,
  }, async () => {
    await createTable();
    await driver!.query('alter table public.t alter column name type text');
    await driver!.query('alter table public.t alter column tags type integer[] using null');
    expect(await verify(contractIn('public', columns))).toEqual([
      {
        outcome: 'not-equal',
        path: 'database/public/t/column:name',
        explanation:
          'The contract column is "character varying(20)" and the database column is "text".',
      },
      {
        outcome: 'not-equal',
        path: 'database/public/t/column:tags',
        explanation: 'The contract column is "text[]" and the database column is "integer[]".',
      },
    ]);
  });

  it('names a column whose type no data type in the stack declares', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('create table public.t (id integer primary key, spot point)');
    const contract = contractIn('public', {
      id,
      spot: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: true },
    });
    expect(await verify(contract)).toEqual([
      {
        outcome: 'not-equal',
        path: 'database/public/t/column:spot',
        explanation:
          'The database column is "point", which no data type in the configured stack declares.',
      },
    ]);
  });

  it('is clean for an enum in public, an enum with a quoted name, and a list of each', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query("create type public.mood as enum ('happy', 'sad')");
    await driver!.query(`create type public."Order Status" as enum ('open', 'shipped')`);
    await driver!.query(`create table public.t (
      id integer primary key,
      mood mood,
      moods mood[],
      order_status "Order Status",
      order_statuses "Order Status"[]
    )`);
    const enumColumn = (typeName: string, many: boolean): StorageColumnInput => ({
      dataType: 'pg/enum',
      codecId: 'pg/enum@1',
      nullable: true,
      typeParams: { typeName },
      ...(many ? { many: { elementNullable: true } } : {}),
    });
    const contract = contractIn('public', {
      id,
      mood: enumColumn('mood', false),
      moods: enumColumn('mood', true),
      order_status: enumColumn('Order Status', false),
      order_statuses: enumColumn('Order Status', true),
    });
    expect(await verify(contract)).toEqual([]);

    await driver!.query('alter table public.t alter column moods type "Order Status"[] using null');
    expect(await verify(contract)).toEqual([
      {
        outcome: 'not-equal',
        path: 'database/public/t/column:moods',
        explanation: 'The contract column is "mood[]" and the database column is "Order Status[]".',
      },
    ]);
  });

  it('does not match an enum outside public to a column of the unbound namespace, a known limit', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('create table public.t (id integer primary key, status app.status)');
    await driver!.query('set search_path to public, app');
    const contract = contractIn(UNBOUND_NAMESPACE_ID, {
      id,
      status: {
        dataType: 'pg/enum',
        codecId: 'pg/enum@1',
        nullable: true,
        typeParams: { typeName: 'status' },
      },
    });
    expect(await verify(contract)).toEqual([
      {
        outcome: 'not-equal',
        path: 'database/public/t/column:status',
        explanation: 'The contract column is "status" and the database column is "app.status".',
      },
    ]);
  });
});
