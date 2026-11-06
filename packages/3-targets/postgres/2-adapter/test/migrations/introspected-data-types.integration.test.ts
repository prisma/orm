/**
 * Introspection gives each column the data type that claims the type the database reports, with its parameters in normal form, and no data type when nothing in the stack claims it.
 */
import { PostgresDatabaseSchemaNode } from '@internal/target-postgres/types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDriver,
  createTestDatabase,
  familyInstance,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

describe('introspected column data types', { concurrent: false }, () => {
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
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  it('resolves each reported type through the stack data types', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('create schema app');
    await driver!.query("create type mood as enum ('happy', 'sad')");
    await driver!.query("create type app.status as enum ('on', 'off')");
    await driver!.query('create domain positive as integer check (value > 0)');
    await driver!.query(`create table t (
        id integer primary key,
        name character varying(20),
        short_name varchar,
        amount numeric(10),
        price decimal(10, 2),
        created timestamp(3) with time zone,
        tags text[],
        mood mood,
        status app.status,
        moods mood[],
        count positive,
        pair int4range
      )`);

    const schema = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(schema);
    const columns = schema.namespaces['public']!.tables['t']!.columns;

    expect(
      Object.fromEntries(
        Object.entries(columns).map(([name, column]) => [
          name,
          {
            storedType: column.storedType?.id,
            storedTypeParams: column.storedTypeParams,
            many: column.many ?? false,
          },
        ]),
      ),
    ).toEqual({
      id: { storedType: 'pg/int4', storedTypeParams: {}, many: false },
      name: {
        storedType: 'pg/varchar',
        storedTypeParams: { length: 20 },
        many: false,
      },
      short_name: { storedType: 'pg/varchar', storedTypeParams: {}, many: false },
      amount: {
        storedType: 'pg/numeric',
        storedTypeParams: { precision: 10, scale: 0 },
        many: false,
      },
      price: {
        storedType: 'pg/numeric',
        storedTypeParams: { precision: 10, scale: 2 },
        many: false,
      },
      created: {
        storedType: 'pg/timestamptz',
        storedTypeParams: { precision: 3 },
        many: false,
      },
      tags: { storedType: 'pg/text', storedTypeParams: {}, many: true },
      mood: {
        storedType: 'pg/enum',
        storedTypeParams: { typeName: 'mood' },
        many: false,
      },
      status: {
        storedType: 'pg/enum',
        storedTypeParams: { typeName: 'app.status' },
        many: false,
      },
      moods: {
        storedType: 'pg/enum',
        storedTypeParams: { typeName: 'mood' },
        many: true,
      },
      count: { storedType: undefined, storedTypeParams: undefined, many: false },
      pair: { storedType: undefined, storedTypeParams: undefined, many: false },
    });
  });
});
