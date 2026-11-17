/**
 * Integration test: introspection of native Postgres array columns.
 *
 * Creates array columns directly via raw DDL (no migration planner), runs
 * introspection, and asserts the produced `SqlColumnIR` carries
 * `many: true` with the element codec's native type.
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

describe('array column introspection', { concurrent: false }, () => {
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

  it('text[] column → typeText:text + many:true', { timeout: testTimeout }, async () => {
    await driver!.query('CREATE TABLE arr_test (id int4 PRIMARY KEY, tags text[] NOT NULL)');

    const result = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(result);
    const col = result.namespaces['public']!.tables['arr_test']?.columns['tags'];
    expect(col).toMatchObject({ typeText: 'text', many: true, nullable: false });
  });

  it('int4[] column → typeText:integer + many:true', { timeout: testTimeout }, async () => {
    await driver!.query('CREATE TABLE arr_test (id int4 PRIMARY KEY, scores integer[] NOT NULL)');

    const result = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(result);
    const col = result.namespaces['public']!.tables['arr_test']?.columns['scores'];
    expect(col).toMatchObject({ typeText: 'integer', many: true });
  });

  it('nullable text[] column → many:true + nullable:true', { timeout: testTimeout }, async () => {
    await driver!.query('CREATE TABLE arr_test (id int4 PRIMARY KEY, labels text[])');

    const result = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(result);
    const col = result.namespaces['public']!.tables['arr_test']?.columns['labels'];
    expect(col).toMatchObject({ many: true, nullable: true });
  });

  it('scalar text column carries no many property', { timeout: testTimeout }, async () => {
    await driver!.query('CREATE TABLE arr_test (id int4 PRIMARY KEY, name text NOT NULL)');

    const result = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(result);
    const col = result.namespaces['public']!.tables['arr_test']?.columns['name'];
    expect(col).toBeDefined();
    expect(col?.many).toBeUndefined();
    expect(col?.typeText).toBe('text');
  });
});
