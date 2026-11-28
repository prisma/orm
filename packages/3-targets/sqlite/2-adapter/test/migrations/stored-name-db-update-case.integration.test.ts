/**
 * SQLite takes two table or column names that differ only in the case of ASCII letters for one.
 * `db update` takes a table or column the database has under such a name as the one the contract
 * names.
 */
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './fixtures/runner-fixtures';
import { dbUpdateHarness, userContract } from './fixtures/stored-name-db-update';

describe('SQLite db update, a stored name that changes only in case', {
  timeout: timeouts.databaseOperation,
}, () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  afterEach(() => {
    testDb?.cleanup();
  });

  const { query, plan, success, labelsOf, apply, start, rows } = dbUpdateHarness(() => testDb);

  const USERS = [
    { id: '1', email: 'a@example.com', name: 'Ada' },
    { id: '2', email: 'b@example.com', name: 'Bo' },
  ];

  it('plans nothing for a table whose name the database already changed in case', async () => {
    const from = userContract('Users', { email: 'email', name: 'name' });
    const to = userContract('users', { email: 'email', name: 'name' });
    await start(from, 'Users');
    await query('alter table "Users" rename to "users_tmp"');
    await query('alter table "users_tmp" rename to "users"');

    const result = await plan(from, to);

    expect(await labelsOf(result)).toEqual([]);
    expect(success(result).dataLoss).toEqual([]);
    await apply(result, to);
    expect(await rows('select id, email, name from "users" order by id')).toEqual(USERS);
    expect(await labelsOf(await plan(to, to))).toEqual([]);
  });

  it('plans nothing for a column whose name the database already changed in case', async () => {
    const from = userContract('users', { email: 'Email', name: 'name' });
    const to = userContract('users', { email: 'email', name: 'name' });
    await start(from);
    await query('alter table "users" rename column "Email" to "email_tmp"');
    await query('alter table "users" rename column "email_tmp" to "email"');

    const result = await plan(from, to);

    expect(await labelsOf(result)).toEqual([]);
    expect(success(result).dataLoss).toEqual([]);
    await apply(result, to);
    expect(await rows('select id, email, name from "users" order by id')).toEqual(USERS);
    expect(await labelsOf(await plan(to, to))).toEqual([]);
  });

  it('gives a table renamed by hand under another case the name the contract has', async () => {
    const from = userContract('users', { email: 'email', name: 'name' });
    const to = userContract('app_users', { email: 'email', name: 'name' });
    await start(from);
    await query('alter table "users" rename to "APP_USERS"');

    const result = await plan(from, to);

    expect(await labelsOf(result)).toEqual(['Rename table APP_USERS to app_users']);
    expect(success(result).dataLoss).toEqual([]);
    await apply(result, to);
    expect(await rows('select id, email, name from "app_users" order by id')).toEqual(USERS);
    expect(await labelsOf(await plan(to, to))).toEqual([]);
  });

  it('gives a column renamed by hand under another case the name the contract has', async () => {
    const from = userContract('users', { email: 'email', name: 'name' });
    const to = userContract('users', { email: 'email_address', name: 'name' });
    await start(from);
    await query('alter table "users" rename column "email" to "EMAIL_ADDRESS"');

    const result = await plan(from, to);

    expect(await labelsOf(result)).toEqual([
      'Rename column EMAIL_ADDRESS on users to email_address',
    ]);
    expect(success(result).dataLoss).toEqual([]);
    await apply(result, to);
    expect(await rows('select id, email_address, name from "users" order by id')).toEqual(
      USERS.map(({ email, ...user }) => ({ ...user, email_address: email })),
    );
    expect(await labelsOf(await plan(to, to))).toEqual([]);
  });
});
