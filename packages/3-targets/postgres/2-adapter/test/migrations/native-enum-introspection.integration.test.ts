/**
 * Postgres native-enum introspection reads each enum type's ordered member
 * values (`pg_enum.enumsortorder`), not just its name.
 *
 * Declaration order must survive — Postgres does not return enum members
 * alphabetically, and a column typed by the enum resolves to a value union
 * ordered the way the type was declared.
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

describe('Postgres native-enum introspection — ordered member values', {
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
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  it('reports declaration order, not alphabetical order, for a single enum type', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(`CREATE TYPE status AS ENUM ('draft', 'review', 'done')`);

    const result = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(result);
    const ns = result.namespaces['public']!;

    expect(ns.nativeEnums.map((e) => ({ typeName: e.typeName, members: e.members }))).toEqual([
      { typeName: 'status', members: ['draft', 'review', 'done'] },
    ]);
  });

  it('reports ordered values for each of multiple enum types', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(`CREATE TYPE status AS ENUM ('draft', 'review', 'done')`);
    await driver!.query(`CREATE TYPE priority AS ENUM ('low', 'high', 'medium')`);

    const result = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(result);
    const ns = result.namespaces['public']!;

    expect(ns.nativeEnums.map((e) => ({ typeName: e.typeName, members: e.members }))).toEqual([
      { typeName: 'priority', members: ['low', 'high', 'medium'] },
      { typeName: 'status', members: ['draft', 'review', 'done'] },
    ]);
  });

  it('reports an empty list when no native enum types exist', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE TABLE doc (id int PRIMARY KEY)');

    const result = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(result);
    const ns = result.namespaces['public']!;

    expect(ns.nativeEnums).toEqual([]);
  });
});
