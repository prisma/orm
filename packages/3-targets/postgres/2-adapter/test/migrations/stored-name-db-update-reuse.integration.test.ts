/**
 * `db update` after a table or column was renamed by hand and its old name used again: for a new
 * model the contract adds, or for another object the contract does not have.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDriver,
  createTestDatabase,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';
import { contractOf, dbUpdateHarness, userContract } from './fixtures/stored-name-db-update';

const origin = userContract('users', { email: 'email', name: 'name' });
const USERS = [
  { id: '1', email: 'a@example.com', name: 'Ada' },
  { id: '2', email: 'b@example.com', name: 'Bo' },
];

describe('Postgres db update, an old name used again after a rename by hand', {
  concurrent: false,
}, () => {
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

  const { plan, labelsOf, apply, start, rows } = dbUpdateHarness(() => driver);

  it('renames the constraints of a table renamed by hand before a new model takes its old name', {
    timeout: testTimeout,
  }, async () => {
    const to = contractOf({
      User: { table: 'app_users', fields: { email: 'email', name: 'name' } },
      Legacy: { table: 'users', fields: {} },
    });
    await start(origin);
    await driver.query('alter table "users" rename to "app_users"');

    const result = await plan(origin, to);

    expect(await labelsOf(result)).toEqual([
      'Rename primary key "users_pkey" to "app_users_pkey" on "app_users"',
      'Create table "users"',
    ]);
    await apply(result, to);
    expect(await rows('select id, email, name from "app_users" order by id')).toEqual(USERS);
    expect(await rows('select id from "users"')).toEqual([]);
    expect(await labelsOf(await plan(to, to))).toEqual([]);
  });

  it('renames the constraints of a table renamed by hand after a drop frees their new names', {
    timeout: testTimeout,
  }, async () => {
    const to = userContract('app_users', { email: 'email', name: 'name' });
    await start(origin);
    await driver.query('alter table "users" rename to "app_users"');
    await driver.query('create table "stale" (id text)');
    await driver.query('create index "app_users_pkey" on "stale" (id)');

    const result = await plan(origin, to);

    expect(await labelsOf(result)).toEqual([
      'Drop table "stale"',
      'Rename primary key "users_pkey" to "app_users_pkey" on "app_users"',
    ]);
    await apply(result, to);
    expect(await rows('select id, email, name from "app_users" order by id')).toEqual(USERS);
    expect(await labelsOf(await plan(to, to))).toEqual([]);
  });

  describe('for an object the contract does not have', () => {
    it('refuses a table, naming the reuse, and plans nothing once the reused table is dropped', {
      timeout: testTimeout,
    }, async () => {
      const to = userContract('app_users', { email: 'email', name: 'name' });
      await start(origin);
      await driver.query('alter table "users" rename to "app_users"');
      await driver.query('create table "users" (id text primary key)');

      const refused = await plan(origin, to);

      expect(refused.kind === 'failure' && refused.conflicts).toEqual([
        {
          kind: 'unsupportedOperation',
          summary: 'Cannot rename table "users" to "app_users": the database has both tables',
          why: 'The table of model "public.User" changes from "users" to "app_users", and the database has both table "users" and table "app_users". One of two things happened, and each has its own fix. If the rename was half done by hand, or something created table "app_users" before db update ran, table "users" holds the rows of model "public.User": move into table "users" the rows of table "app_users" that it does not already hold, and where both tables hold a row with the same key, keep the version you want in table "users"; then drop table "app_users", and run again. If table "users" was renamed to "app_users" by hand and the name "users" then used for another table, table "app_users" holds the rows of model "public.User": drop table "users", and run again; to keep the rows of that other table, first move them into a table the contract has, since db update drops every table the contract does not have.',
          location: { namespaceId: 'public', entityKind: 'table', entityName: 'users' },
        },
      ]);

      await driver.query('drop table "users"');
      const result = await plan(origin, to);

      expect(await labelsOf(result)).toEqual([
        'Rename primary key "users_pkey" to "app_users_pkey" on "app_users"',
      ]);
      await apply(result, to);
      expect(await rows('select id, email, name from "app_users" order by id')).toEqual(USERS);
    });

    it('refuses a column, naming the reuse, and plans nothing once the reused column is dropped', {
      timeout: testTimeout,
    }, async () => {
      const to = userContract('users', { email: 'email_address', name: 'name' });
      await start(origin);
      await driver.query('alter table "users" rename column "email" to "email_address"');
      await driver.query('alter table "users" add column "email" text');

      const refused = await plan(origin, to);

      expect(refused.kind === 'failure' && refused.conflicts).toEqual([
        {
          kind: 'unsupportedOperation',
          summary:
            'Cannot rename column "users"."email" to "email_address": the database has both columns',
          why: 'The column of field "public.User.email" changes from "email" to "email_address", and table "users" in the database has both column "email" and column "email_address". One of two things happened, and each has its own fix. If the rename was half done by hand, or something created column "email_address" before db update ran, column "email" holds the values of field "public.User.email": copy into column "email" the value of column "email_address" in each row where column "email_address" holds one and column "email" holds none, and where both hold a value, keep the one you want in column "email"; then drop column "email_address", and run again. If column "email" was renamed to "email_address" by hand and the name "email" then used for another column, column "email_address" holds the values of field "public.User.email": drop column "email", and run again; to keep the values of that other column, first move them into a column the contract has, since db update drops every column the contract does not have.',
          location: {
            namespaceId: 'public',
            entityKind: 'table',
            entityName: 'users',
            column: 'email',
          },
        },
      ]);

      await driver.query('alter table "users" drop column "email"');
      const result = await plan(origin, to);

      expect(await labelsOf(result)).toEqual([]);
      await apply(result, to);
      expect(await rows('select id, email_address, name from "users" order by id')).toEqual(
        USERS.map(({ email, ...user }) => ({ ...user, email_address: email })),
      );
    });
  });
});
