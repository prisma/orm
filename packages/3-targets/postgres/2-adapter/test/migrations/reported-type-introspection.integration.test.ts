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

/**
 * Every text below is what `format_type` returned for the column's element type on the database
 * this suite runs against, with the schema removed where the last test says so.
 */
describe('introspection reports each column type as the database reports it', {
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
    await driver.query('drop schema if exists extensions cascade');
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.query('drop schema if exists extensions cascade');
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  async function reportedTypesOf(tableName: string) {
    const schema = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(schema);
    const columns = schema.namespaces['public']?.tables[tableName]?.columns ?? {};
    return Object.fromEntries(
      Object.entries(columns).map(([name, column]) => [
        name,
        { many: column.many ?? false, reportedType: column.reportedType },
      ]),
    );
  }

  const catalogType = (text: string, name: string) => ({
    text,
    kind: undefined,
    schema: 'pg_catalog',
    name,
  });

  it('reports base types, parameterised types and lists by their element type', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(
      `CREATE TABLE t (
           id integer,
           price numeric(10,2),
           prices numeric(10,2)[],
           stamps timestamptz(3)[],
           shifted numeric(10,-2),
           positions int2vector
         )`,
    );

    expect(await reportedTypesOf('t')).toEqual({
      id: { many: false, reportedType: catalogType('integer', 'int4') },
      price: { many: false, reportedType: catalogType('numeric(10,2)', 'numeric') },
      prices: { many: true, reportedType: catalogType('numeric(10,2)', 'numeric') },
      stamps: {
        many: true,
        reportedType: catalogType('timestamp(3) with time zone', 'timestamptz'),
      },
      shifted: { many: false, reportedType: catalogType('numeric(10,-2)', 'numeric') },
      positions: { many: false, reportedType: catalogType('int2vector', 'int2vector') },
    });
  });

  it('reports the kind of an enum, an enum list and a domain', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(`CREATE TYPE mood AS ENUM ('calm', 'busy')`);
    await driver!.query('CREATE DOMAIN positive AS integer CHECK (VALUE > 0)');
    await driver!.query('CREATE TABLE t (mood mood, moods mood[], amount positive)');

    expect(await reportedTypesOf('t')).toEqual({
      mood: {
        many: false,
        reportedType: { text: 'mood', kind: 'enum', schema: 'public', name: 'mood' },
      },
      moods: {
        many: true,
        reportedType: { text: 'mood', kind: 'enum', schema: 'public', name: 'mood' },
      },
      amount: {
        many: false,
        reportedType: { text: 'positive', kind: 'domain', schema: 'public', name: 'positive' },
      },
    });
  });

  it('removes the schema from a base type installed in a schema off the search path, as Supabase installs vector', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE SCHEMA extensions');
    await driver!.query('CREATE EXTENSION vector SCHEMA extensions');
    await driver!.query('CREATE TYPE extensions.pair AS (a integer, b integer)');
    await driver!.query(
      'CREATE TABLE t (embedding extensions.vector(3), embeddings extensions.vector(3)[], pair extensions.pair)',
    );

    const extensionType = {
      text: 'vector(3)',
      kind: undefined,
      schema: 'extensions',
      name: 'vector',
    };
    expect(await reportedTypesOf('t')).toEqual({
      embedding: { many: false, reportedType: extensionType },
      embeddings: { many: true, reportedType: extensionType },
      pair: {
        many: false,
        reportedType: {
          text: 'extensions.pair',
          kind: 'composite',
          schema: 'extensions',
          name: 'pair',
        },
      },
    });
  });
});
