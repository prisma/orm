/**
 * The Postgres planner rewrites the stored values of an enum whose members change: a removed value
 * is set to NULL and a renamed one is replaced, between the drop of the old check and the creation
 * of the new one, and the runner leaves no row holding the old value.
 */
import { asNamespaceId } from '@internal/contract/types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDriver,
  createTestDatabase,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';
import {
  rankContract,
  renameRole,
  roleContract,
  storedValueHarness,
  teamContract,
} from './fixtures/stored-value-contracts';

describe('Postgres planner, stored enum values', { concurrent: false }, () => {
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

  const { plan, apply, start, roles, operationKinds } = storedValueHarness(() => driver);

  it('removes a stored value between the check drop and the check creation, and asks about it as the enum value', {
    timeout: testTimeout,
  }, async () => {
    const from = roleContract({ USER: 'user', GUEST: 'guest' });
    const to = roleContract({ USER: 'user' });
    await start(from);

    const result = await plan(from, to);

    expect(await operationKinds(result)).toEqual([
      'dropCheckConstraint',
      'removeStoredValue',
      'checkConstraint',
    ]);
    expect(result.kind === 'success' && result.dataLoss).toEqual([
      {
        operationIndex: 1,
        subject: {
          kind: 'enumValue',
          namespaceId: asNamespaceId('public'),
          enum: 'Role',
          member: 'GUEST',
        },
        loss: 'drop',
        label: 'Remove value "guest" from column "role" of "User"',
      },
    ]);
    await apply(result, to);
    expect(await roles()).toEqual([
      { id: '1', role: null },
      { id: '2', role: 'user' },
      { id: '3', role: null },
    ]);
    expect(await operationKinds(await plan(to, to))).toEqual([]);
  });

  it('replaces a renamed stored value, and the rename accounts for the replacement', {
    timeout: testTimeout,
  }, async () => {
    const from = roleContract({ USER: 'user', GUEST: 'guest' });
    const to = roleContract({ USER: 'user', VISITOR: 'visitor' });
    await start(from);
    const statement = renameRole('GUEST', 'VISITOR');

    const result = await plan(from, to, [statement]);

    expect(await operationKinds(result)).toEqual([
      'dropCheckConstraint',
      'replaceStoredValue',
      'checkConstraint',
    ]);
    expect(result.kind === 'success' && result.appliedStatements).toEqual([
      { statement, operationIndexes: [1] },
    ]);
    expect(result.kind === 'success' && result.dataLoss).toEqual([]);
    await apply(result, to);
    expect(await roles()).toEqual([
      { id: '1', role: 'visitor' },
      { id: '2', role: 'user' },
      { id: '3', role: null },
    ]);
  });

  it('plans nothing for a member renamed with its stored value kept', {
    timeout: testTimeout,
  }, async () => {
    const from = roleContract({ USER: 'user', GUEST: 'guest' });
    const to = roleContract({ USER: 'user', VISITOR: 'guest' });
    await start(from);
    const statement = renameRole('GUEST', 'VISITOR');

    const result = await plan(from, to, [statement]);

    expect(await operationKinds(result)).toEqual([]);
    expect(result.kind === 'success' && result.appliedStatements).toEqual([
      { statement, operationIndexes: [] },
    ]);
  });

  it('shifts stored values along when renames move each into the one the next leaves', {
    timeout: testTimeout,
  }, async () => {
    const from = roleContract({ USER: 'user', GUEST: 'guest' });
    const to = roleContract({ MEMBER: 'guest', VISITOR: 'visitor' });
    await start(from);

    const result = await plan(from, to, [
      renameRole('USER', 'MEMBER'),
      renameRole('GUEST', 'VISITOR'),
    ]);
    await apply(result, to);

    expect(await roles()).toEqual([
      { id: '1', role: 'visitor' },
      { id: '2', role: 'guest' },
      { id: '3', role: null },
    ]);
  });

  it('removes a stored value from a required column when no row holds it, and fails at apply, naming how to keep them, when rows do', {
    timeout: testTimeout,
  }, async () => {
    const from = roleContract({ USER: 'user', GUEST: 'guest' }, { required: true });
    const to = roleContract({ USER: 'user' }, { required: true });
    await apply(await plan(null, from), from);
    await driver.query(`insert into "User" (id, role) values ('1', 'guest'), ('2', 'user')`);

    const result = await plan(from, to);
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    expect(result.dataLoss.map(({ subject }) => subject)).toEqual([
      { kind: 'enumValue', namespaceId: asNamespaceId('public'), enum: 'Role', member: 'GUEST' },
    ]);
    const failed = await apply(result, to).then(
      () => '',
      (error: Error) => error.message,
    );
    expect(failed).toContain(
      '[MIGRATION.PRECHECK_FAILED] 1 row of "User" holds "guest" in column "role", which takes no NULL, so the value cannot be removed.',
    );
    expect(failed).toContain('"rowsHoldingValue": [');
    expect(failed).toContain('"member": "GUEST"');
    expect(failed).toContain('"keepDataEdit": {');
    expect(failed).toContain('"rows": 1');
    expect(await roles()).toEqual([
      { id: '1', role: 'guest' },
      { id: '2', role: 'user' },
    ]);

    await driver.query(`delete from "User" where role = 'guest'`);
    await apply(await plan(from, to), to);
    expect(await operationKinds(await plan(to, to))).toEqual([]);
  });

  it('removes a stored value from every table the enum types, list columns too, and asks one question', {
    timeout: testTimeout,
  }, async () => {
    const from = teamContract({ USER: 'user', GUEST: 'guest' }, { legacy: true });
    const to = teamContract({ USER: 'user' }, { legacy: false });
    await apply(await plan(null, from), from);
    await driver.query(`insert into "User" (id, role) values ('1', 'guest'), ('2', 'user')`);
    await driver.query(
      `insert into "Team" (id, roles) values ('1', '{guest,user}'), ('2', '{user}')`,
    );

    const result = await plan(from, to);
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));

    expect(
      result.dataLoss.map(({ subject }) =>
        subject.kind === 'enumValue' ? `${subject.enum}.${subject.member}` : subject.kind,
      ),
    ).toEqual(['model', 'Role.GUEST', 'Role.GUEST']);
    await apply(result, to);
    expect(await roles()).toEqual([
      { id: '1', role: null },
      { id: '2', role: 'user' },
    ]);
    expect((await driver.query('select id, roles from "Team" order by id')).rows).toEqual([
      { id: '1', roles: '{user}' },
      { id: '2', roles: '{user}' },
    ]);
    expect(await operationKinds(await plan(to, to))).toEqual([]);
  });

  it('removes and replaces a numeric stored value, written through the column codec', {
    timeout: testTimeout,
  }, async () => {
    const from = rankContract({ LOW: 1, MID: 2, HIGH: 3 });
    const to = rankContract({ MID: 2, TOP: 30 });
    await apply(await plan(null, from), from);
    await driver.query(`insert into "User" (id, rank) values ('1', 1), ('2', 2), ('3', 3)`);

    const result = await plan(from, to, [
      {
        kind: 'rename',
        entity: 'enumValue',
        from: { namespaceId: asNamespaceId('public'), enum: 'Rank', member: 'HIGH' },
        to: { namespaceId: asNamespaceId('public'), enum: 'Rank', member: 'TOP' },
      },
    ]);
    await apply(result, to);

    expect((await driver.query('select id, rank from "User" order by id')).rows).toEqual([
      { id: '1', rank: null },
      { id: '2', rank: 2 },
      { id: '3', rank: 30 },
    ]);
  });

  it('removes a stored value from a column the same change makes optional', {
    timeout: testTimeout,
  }, async () => {
    const from = roleContract({ USER: 'user', GUEST: 'guest' }, { required: true });
    const to = roleContract({ USER: 'user' });
    await apply(await plan(null, from), from);
    await driver.query(`insert into "User" (id, role) values ('1', 'guest'), ('2', 'user')`);

    await apply(await plan(from, to), to);

    expect(await roles()).toEqual([
      { id: '1', role: null },
      { id: '2', role: 'user' },
    ]);
  });
});
