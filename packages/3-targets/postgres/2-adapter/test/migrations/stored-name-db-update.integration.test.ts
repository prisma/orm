/**
 * `db update` plans from the live database. A table or column whose model or field keeps its name
 * and whose stored name changes is renamed when the database has the old name, taken as renamed
 * when it has only the new one, left to the storage diff when it has neither, and refused when it
 * has both.
 */
import { asNamespaceId } from '@internal/contract/types';
import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDriver,
  createTestDatabase,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';
import { dbUpdateHarness, userContract } from './fixtures/stored-name-db-update';

const publicId = asNamespaceId('public');
const origin = userContract('users', { email: 'email', name: 'name' });

describe('Postgres db update, a stored name that changes', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    await database?.close();
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    await driver?.close();
  }, testTimeout);

  const { plan, success, labelsOf, apply, start: startWith, rows } = dbUpdateHarness(() => driver);
  const start = () => startWith(origin);

  describe('a table', () => {
    const to = userContract('app_users', { email: 'email', name: 'name' });

    it('renames it when the database has the old name only', {
      timeout: testTimeout,
    }, async () => {
      await start();

      const result = await plan(origin, to);

      expect(await labelsOf(result)).toEqual([
        'Rename table "users" to "app_users"',
        'Rename primary key "users_pkey" to "app_users_pkey" on "app_users"',
      ]);
      await apply(result, to);
      expect(await rows('select id, email, name from "app_users" order by id')).toEqual([
        { id: '1', email: 'a@example.com', name: 'Ada' },
        { id: '2', email: 'b@example.com', name: 'Bo' },
      ]);
    });

    it('plans no rename when the database has the new name only', {
      timeout: testTimeout,
    }, async () => {
      await start();
      await driver.query('alter table "users" rename to "app_users"');

      const result = await plan(origin, to);

      expect(await labelsOf(result)).toEqual([
        'Rename primary key "users_pkey" to "app_users_pkey" on "app_users"',
      ]);
      expect(success(result).dataLoss).toEqual([]);
      await apply(result, to);
      expect(await rows('select id, email, name from "app_users" order by id')).toEqual([
        { id: '1', email: 'a@example.com', name: 'Ada' },
        { id: '2', email: 'b@example.com', name: 'Bo' },
      ]);
    });

    it('creates it when the database has neither name', { timeout: testTimeout }, async () => {
      await start();
      await driver.query('drop table "users"');

      const result = await plan(origin, to);

      expect(await labelsOf(result)).toEqual(['Create table "app_users"']);
      await apply(result, to);
      expect(await rows('select id from "app_users"')).toEqual([]);
    });

    it('refuses when the database has both names', { timeout: testTimeout }, async () => {
      await start();
      await driver.query('create table "app_users" (id text primary key)');

      const result = await plan(origin, to);

      expect(result.kind === 'failure' && result.conflicts).toEqual([
        {
          kind: 'unsupportedOperation',
          summary: 'Cannot rename table "users" to "app_users": the database has both tables',
          why: 'The table of model "public.User" changes from "users" to "app_users", and the database has both table "users" and table "app_users". The rename may have been half done by hand, or something created table "app_users" before db update ran: then move any rows of table "app_users" into table "users" and drop table "app_users", and run again. Or table "users" was renamed to "app_users" by hand and the name "users" used again for another table: then rename or drop table "users", and run again.',
          location: { namespaceId: 'public', entityKind: 'table', entityName: 'users' },
        },
      ]);
    });

    it('renames the column of a field whose @map changes on a table renamed by hand', {
      timeout: testTimeout,
    }, async () => {
      const mapped = userContract('app_users', { email: 'email_address', name: 'name' });
      await start();
      await driver.query('alter table "users" rename to "app_users"');

      const result = await plan(origin, mapped);

      expect(await labelsOf(result)).toEqual([
        'Rename column "app_users"."email" to "email_address"',
        'Rename primary key "users_pkey" to "app_users_pkey" on "app_users"',
      ]);
      await apply(result, mapped);
      expect(await rows('select id, email_address from "app_users" order by id')).toEqual([
        { id: '1', email_address: 'a@example.com' },
        { id: '2', email_address: 'b@example.com' },
      ]);
    });

    it('asks about a removed field of a table renamed by hand by its origin field', {
      timeout: testTimeout,
    }, async () => {
      const removed = userContract('app_users', { email: 'email' });
      await start();
      await driver.query('alter table "users" rename to "app_users"');

      const result = await plan(origin, removed);

      expect(await labelsOf(result)).toEqual([
        'Rename primary key "users_pkey" to "app_users_pkey" on "app_users"',
        'Drop column "name" from "app_users"',
      ]);
      expect(success(result).dataLoss.map(({ subject }) => subject)).toEqual([
        { kind: 'field', namespaceId: publicId, model: 'User', field: 'name' },
      ]);
      await apply(result, removed);
      expect(await rows('select id, email from "app_users" order by id')).toEqual([
        { id: '1', email: 'a@example.com' },
        { id: '2', email: 'b@example.com' },
      ]);
    });

    it('plans a field rename statement on a table renamed by hand', {
      timeout: testTimeout,
    }, async () => {
      const renamed = userContract('app_users', { email: 'email', fullName: 'full_name' });
      const statement: ResolvedMigrationStatement = {
        kind: 'rename',
        entity: 'field',
        from: { namespaceId: publicId, model: 'User', field: 'name' },
        to: { namespaceId: publicId, model: 'User', field: 'fullName' },
      };
      await start();
      await driver.query('alter table "users" rename to "app_users"');

      const result = await plan(origin, renamed, [statement]);

      expect(await labelsOf(result)).toEqual([
        'Rename column "app_users"."name" to "full_name"',
        'Rename primary key "users_pkey" to "app_users_pkey" on "app_users"',
      ]);
      expect(success(result).appliedStatements).toEqual([{ statement, operationIndexes: [0] }]);
      await apply(result, renamed);
      expect(await rows('select id, full_name from "app_users" order by id')).toEqual([
        { id: '1', full_name: 'Ada' },
        { id: '2', full_name: 'Bo' },
      ]);
    });
  });

  describe('a column', () => {
    const to = userContract('users', { email: 'email_address', name: 'name' });

    it('renames it when the table has the old name only', { timeout: testTimeout }, async () => {
      await start();

      const result = await plan(origin, to);

      expect(await labelsOf(result)).toEqual(['Rename column "users"."email" to "email_address"']);
      await apply(result, to);
      expect(await rows('select id, email_address from "users" order by id')).toEqual([
        { id: '1', email_address: 'a@example.com' },
        { id: '2', email_address: 'b@example.com' },
      ]);
    });

    it('plans no rename when the table has the new name only', {
      timeout: testTimeout,
    }, async () => {
      await start();
      await driver.query('alter table "users" rename column "email" to "email_address"');

      const result = await plan(origin, to);

      expect(await labelsOf(result)).toEqual([]);
      await apply(result, to);
      expect(await rows('select id, email_address from "users" order by id')).toEqual([
        { id: '1', email_address: 'a@example.com' },
        { id: '2', email_address: 'b@example.com' },
      ]);
    });

    it('adds it when the table has neither name', { timeout: testTimeout }, async () => {
      await start();
      await driver.query('alter table "users" drop column "email"');

      const result = await plan(origin, to);

      expect(await labelsOf(result)).toEqual(['Add column email_address to users']);
    });

    it('refuses when the table has both names', { timeout: testTimeout }, async () => {
      await start();
      await driver.query('alter table "users" add column "email_address" text');

      const result = await plan(origin, to);

      expect(result.kind === 'failure' && result.conflicts).toEqual([
        {
          kind: 'unsupportedOperation',
          summary:
            'Cannot rename column "users"."email" to "email_address": the database has both columns',
          why: 'The column of field "public.User.email" changes from "email" to "email_address", and table "users" in the database has both column "email" and column "email_address". The rename may have been half done by hand, or something created column "email_address" before db update ran: then move any values of column "email_address" into column "email" and drop column "email_address", and run again. Or column "email" was renamed to "email_address" by hand and the name "email" used again for another column: then rename or drop column "email", and run again.',
          location: {
            namespaceId: 'public',
            entityKind: 'table',
            entityName: 'users',
            column: 'email',
          },
        },
      ]);
    });
  });
});
