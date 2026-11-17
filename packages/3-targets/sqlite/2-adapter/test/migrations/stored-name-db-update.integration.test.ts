/**
 * `db update` plans from the live database. A table or column whose model or field keeps its name
 * and whose stored name changes is renamed when the database has the old name, taken as renamed
 * when it has only the new one, left to the storage diff when it has neither, and refused when it
 * has both.
 */
import { asNamespaceId } from '@internal/contract/types';
import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './fixtures/runner-fixtures';
import { dbUpdateHarness, userContract } from './fixtures/stored-name-db-update';

const app = asNamespaceId(UNBOUND_NAMESPACE_ID);
const origin = userContract('users', { email: 'email', name: 'name' });

describe('SQLite db update, a stored name that changes', {
  timeout: timeouts.databaseOperation,
}, () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  afterEach(() => {
    testDb?.cleanup();
  });

  const {
    query,
    plan,
    success,
    labelsOf,
    apply,
    start: startWith,
    rows,
  } = dbUpdateHarness(() => testDb);
  const start = () => startWith(origin);

  describe('a table', () => {
    const to = userContract('app_users', { email: 'email', name: 'name' });

    it('renames it when the database has the old name only', async () => {
      await start();

      const result = await plan(origin, to);

      expect(await labelsOf(result)).toEqual(['Rename table users to app_users']);
      await apply(result, to);
      expect(await rows('select id, email, name from "app_users" order by id')).toEqual([
        { id: '1', email: 'a@example.com', name: 'Ada' },
        { id: '2', email: 'b@example.com', name: 'Bo' },
      ]);
    });

    it('plans no rename when the database has the new name only', async () => {
      await start();
      await query('alter table "users" rename to "app_users"');

      const result = await plan(origin, to);

      expect(await labelsOf(result)).toEqual([]);
      expect(success(result).dataLoss).toEqual([]);
      await apply(result, to);
      expect(await rows('select id, email, name from "app_users" order by id')).toEqual([
        { id: '1', email: 'a@example.com', name: 'Ada' },
        { id: '2', email: 'b@example.com', name: 'Bo' },
      ]);
    });

    it('creates it when the database has neither name', async () => {
      await start();
      await query('drop table "users"');

      const result = await plan(origin, to);

      expect(await labelsOf(result)).toEqual(['Create table app_users']);
      await apply(result, to);
      expect(await rows('select id from "app_users"')).toEqual([]);
    });

    it('refuses when the database has both names', async () => {
      await start();
      await query('CREATE TABLE "app_users" (id TEXT PRIMARY KEY)');

      const result = await plan(origin, to);

      expect(result.kind === 'failure' && result.conflicts).toEqual([
        {
          kind: 'unsupportedOperation',
          summary: 'Cannot rename table "users" to "app_users": the database has both tables',
          why: 'The table of model "User" changes from "users" to "app_users", and the database has both table "users" and table "app_users". The rename may have been half done by hand, or something created table "app_users" before db update ran: then move the rows of table "app_users" into table "users", or drop table "app_users", and run again. Or table "users" was renamed to "app_users" by hand and the name "users" used again for another table: then rename or drop table "users", and run again.',
          location: { namespaceId: UNBOUND_NAMESPACE_ID, entityKind: 'table', entityName: 'users' },
        },
      ]);
    });

    it('renames the column of a field whose @map changes on a table renamed by hand', async () => {
      const mapped = userContract('app_users', { email: 'email_address', name: 'name' });
      await start();
      await query('alter table "users" rename to "app_users"');

      const result = await plan(origin, mapped);

      expect(await labelsOf(result)).toEqual(['Rename column email on app_users to email_address']);
      await apply(result, mapped);
      expect(await rows('select id, email_address from "app_users" order by id')).toEqual([
        { id: '1', email_address: 'a@example.com' },
        { id: '2', email_address: 'b@example.com' },
      ]);
    });

    it('asks about a removed field of a table renamed by hand by its origin field', async () => {
      const removed = userContract('app_users', { email: 'email' });
      await start();
      await query('alter table "users" rename to "app_users"');

      const result = await plan(origin, removed);

      expect(await labelsOf(result)).toEqual(['Drop column "name" from "app_users"']);
      expect(success(result).dataLoss.map(({ subject }) => subject)).toEqual([
        { kind: 'field', namespaceId: app, model: 'User', field: 'name' },
      ]);
      await apply(result, removed);
      expect(await rows('select id, email from "app_users" order by id')).toEqual([
        { id: '1', email: 'a@example.com' },
        { id: '2', email: 'b@example.com' },
      ]);
    });

    it('plans a field rename statement on a table renamed by hand', async () => {
      const renamed = userContract('app_users', { email: 'email', fullName: 'full_name' });
      const statement: ResolvedMigrationStatement = {
        kind: 'rename',
        entity: 'field',
        from: { namespaceId: app, model: 'User', field: 'name' },
        to: { namespaceId: app, model: 'User', field: 'fullName' },
      };
      await start();
      await query('alter table "users" rename to "app_users"');

      const result = await plan(origin, renamed, [statement]);

      expect(await labelsOf(result)).toEqual(['Rename column name on app_users to full_name']);
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

    it('renames it when the table has the old name only', async () => {
      await start();

      const result = await plan(origin, to);

      expect(await labelsOf(result)).toEqual(['Rename column email on users to email_address']);
      await apply(result, to);
      expect(await rows('select id, email_address from "users" order by id')).toEqual([
        { id: '1', email_address: 'a@example.com' },
        { id: '2', email_address: 'b@example.com' },
      ]);
    });

    it('plans no rename when the table has the new name only', async () => {
      await start();
      await query('alter table "users" rename column "email" to "email_address"');

      const result = await plan(origin, to);

      expect(await labelsOf(result)).toEqual([]);
      await apply(result, to);
      expect(await rows('select id, email_address from "users" order by id')).toEqual([
        { id: '1', email_address: 'a@example.com' },
        { id: '2', email_address: 'b@example.com' },
      ]);
    });

    it('adds it when the table has neither name', async () => {
      await start();
      await query('alter table "users" drop column "email"');

      const result = await plan(origin, to);

      expect(await labelsOf(result)).toEqual(['Recreate table users']);
    });

    it('refuses when the table has both names', async () => {
      await start();
      await query('alter table "users" add column "email_address" text');

      const result = await plan(origin, to);

      expect(result.kind === 'failure' && result.conflicts).toEqual([
        {
          kind: 'unsupportedOperation',
          summary:
            'Cannot rename column "users"."email" to "email_address": the database has both columns',
          why: 'The column of field "User.email" changes from "email" to "email_address", and table "users" in the database has both column "email" and column "email_address". The rename may have been half done by hand, or something created column "email_address" before db update ran: then move the values of column "email_address" into column "email", or drop column "email_address", and run again. Or column "email" was renamed to "email_address" by hand and the name "email" used again for another column: then rename or drop column "email", and run again.',
          location: {
            namespaceId: UNBOUND_NAMESPACE_ID,
            entityKind: 'table',
            entityName: 'users',
            column: 'email',
          },
        },
      ]);
    });
  });
  describe('an old name used again after a rename by hand', () => {
    it('plans nothing for the table once the table that reused its old name is dropped', async () => {
      const to = userContract('app_users', { email: 'email', name: 'name' });
      await start();
      await query('alter table "users" rename to "app_users"');
      await query('CREATE TABLE "users" (id TEXT PRIMARY KEY)');
      expect((await plan(origin, to)).kind).toBe('failure');

      await query('drop table "users"');
      const result = await plan(origin, to);

      expect(await labelsOf(result)).toEqual([]);
      await apply(result, to);
      expect(await rows('select id, email, name from "app_users" order by id')).toEqual([
        { id: '1', email: 'a@example.com', name: 'Ada' },
        { id: '2', email: 'b@example.com', name: 'Bo' },
      ]);
    });

    it('plans nothing for the column once the column that reused its old name is dropped', async () => {
      const to = userContract('users', { email: 'email_address', name: 'name' });
      await start();
      await query('alter table "users" rename column "email" to "email_address"');
      await query('alter table "users" add column "email" text');
      expect((await plan(origin, to)).kind).toBe('failure');

      await query('alter table "users" drop column "email"');
      const result = await plan(origin, to);

      expect(await labelsOf(result)).toEqual([]);
      await apply(result, to);
      expect(await rows('select id, email_address from "users" order by id')).toEqual([
        { id: '1', email_address: 'a@example.com' },
        { id: '2', email_address: 'b@example.com' },
      ]);
    });
  });
});
