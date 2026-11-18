/**
 * The Postgres planner replaces the stored value of an enum member that keeps its name, in every
 * row that holds it, with no question, and refuses changes that move values in a cycle or merge
 * the data of two members, with routes that work when followed.
 */
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

describe('Postgres planner, stored values of members that keep their names', {
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

  const { plan, apply, start, roles, operationKinds } = storedValueHarness(() => driver);

  it('replaces the stored value of a member that keeps its name between the check drop and creation, and asks nothing', {
    timeout: testTimeout,
  }, async () => {
    const from = roleContract({ USER: 'user', GUEST: 'guest' });
    const to = roleContract({ USER: 'user', GUEST: 'visitor' });
    await start(from);

    const result = await plan(from, to);

    expect(await operationKinds(result)).toEqual([
      'dropCheckConstraint',
      'replaceStoredValue',
      'checkConstraint',
    ]);
    expect(result.kind === 'success' && result.dataLoss).toEqual([]);
    expect(result.kind === 'success' && result.appliedStatements).toEqual([]);
    await apply(result, to);
    expect(await roles()).toEqual([
      { id: '1', role: 'visitor' },
      { id: '2', role: 'user' },
      { id: '3', role: null },
    ]);
    expect(await operationKinds(await plan(to, to))).toEqual([]);
  });

  it('replaces the stored values of a chain of members that keep their names, the last value first', {
    timeout: testTimeout,
  }, async () => {
    const from = roleContract({ USER: 'user', GUEST: 'guest' });
    const to = roleContract({ USER: 'guest', GUEST: 'visitor' });
    await start(from);

    const result = await plan(from, to);

    expect(await operationKinds(result)).toEqual([
      'dropCheckConstraint',
      'replaceStoredValue',
      'replaceStoredValue',
      'checkConstraint',
    ]);
    await apply(result, to);
    expect(await roles()).toEqual([
      { id: '1', role: 'visitor' },
      { id: '2', role: 'guest' },
      { id: '3', role: null },
    ]);
  });

  it('replaces a value a member frees and a new member takes, and no row holds the new member', {
    timeout: testTimeout,
  }, async () => {
    const from = roleContract({ USER: 'user', GUEST: 'guest' });
    const to = roleContract({ USER: 'user', GUEST: 'visitor', NEWBIE: 'guest' });
    await start(from);

    const result = await plan(from, to);
    expect(await operationKinds(result)).toEqual([
      'dropCheckConstraint',
      'replaceStoredValue',
      'checkConstraint',
    ]);
    await apply(result, to);

    expect(await roles()).toEqual([
      { id: '1', role: 'visitor' },
      { id: '2', role: 'user' },
      { id: '3', role: null },
    ]);
  });

  it('replaces the column default along with the value when the default is the old stored value', {
    timeout: testTimeout,
  }, async () => {
    const from = roleContract({ USER: 'user', GUEST: 'guest' }, { default: 'guest' });
    const to = roleContract({ USER: 'user', GUEST: 'visitor' }, { default: 'visitor' });
    await start(from);

    const result = await plan(from, to);
    expect(await operationKinds(result)).toEqual([
      'dropCheckConstraint',
      'setDefault',
      'replaceStoredValue',
      'checkConstraint',
    ]);
    await apply(result, to);
    await driver.query(`insert into "User" (id) values ('4')`);

    expect(await roles()).toEqual([
      { id: '1', role: 'visitor' },
      { id: '2', role: 'user' },
      { id: '3', role: null },
      { id: '4', role: 'visitor' },
    ]);
    expect(await operationKinds(await plan(to, to))).toEqual([]);
  });

  it('refuses members that keep their names and swap stored values, and leaves the rows as they are', {
    timeout: testTimeout,
  }, async () => {
    const from = roleContract({ USER: 'user', GUEST: 'guest' });
    const to = roleContract({ USER: 'guest', GUEST: 'user' });
    await start(from);

    const result = await plan(from, to);

    expect(result.kind === 'failure' && result.conflicts).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot change the stored values of enum "Role": enum values "Role.USER" and "Role.GUEST" move stored values in a cycle, "user" to "guest" and "guest" to "user", and a rewrite of one would overwrite the other before it is read',
        why: 'The plan rewrites a changed stored value in every row that holds it, one value after another, and no order of the rewrites moves values in a cycle. Make the change in two plans: first give "Role.USER" a stored value no member stores, such as "prisma_swap", and give "Role.GUEST" the stored value "user", and plan and apply that; then give "Role.USER" the stored value "guest", and plan again.',
      },
    ]);
  });

  it('refuses a member that keeps its name and takes the stored value of a removed member', {
    timeout: testTimeout,
  }, async () => {
    const from = roleContract({ USER: 'user', GUEST: 'guest' });
    const to = roleContract({ USER: 'guest' });
    await start(from);

    const result = await plan(from, to);

    expect(result.kind === 'failure' && result.conflicts).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot change the stored value of enum value "Role.USER" from "user" to "guest": the origin enum stores "guest" as enum value "Role.GUEST"',
        why: 'A changed stored value is rewritten in every row that holds it, so the rows of "Role.USER" would hold "guest" as the rows of "Role.GUEST" do, and their data would merge. Make the change in two plans: first remove enum value "Role.GUEST", and plan and apply that; then give "Role.USER" the stored value "guest", and plan again. The first plan asks about the rows that hold "guest". If you answer it with --delete Role.GUEST, a column that takes no NULL cannot keep those rows: before that plan applies, delete them in the database, or set them to "user" there to merge their data with the data of "Role.USER" on purpose.',
      },
    ]);
  });

  it('replaces the stored value of a member that keeps its name in every table the enum types, list columns too', {
    timeout: testTimeout,
  }, async () => {
    const from = teamContract({ USER: 'user', GUEST: 'guest' }, { legacy: false });
    const to = teamContract({ USER: 'user', GUEST: 'visitor' }, { legacy: false });
    await apply(await plan(null, from), from);
    await driver.query(`insert into "User" (id, role) values ('1', 'guest'), ('2', 'user')`);
    await driver.query(
      `insert into "Team" (id, roles) values ('1', '{guest,user}'), ('2', '{user}')`,
    );

    const result = await plan(from, to);
    expect(result.kind === 'success' && result.dataLoss).toEqual([]);
    await apply(result, to);

    expect(await roles()).toEqual([
      { id: '1', role: 'visitor' },
      { id: '2', role: 'user' },
    ]);
    expect((await driver.query('select id, roles from "Team" order by id')).rows).toEqual([
      { id: '1', roles: '{visitor,user}' },
      { id: '2', roles: '{user}' },
    ]);
    expect(await operationKinds(await plan(to, to))).toEqual([]);
  });

  it('replaces a numeric stored value of a member that keeps its name, written through the column codec', {
    timeout: testTimeout,
  }, async () => {
    const from = rankContract({ LOW: 1, MID: 2 });
    const to = rankContract({ LOW: 10, MID: 2 });
    await apply(await plan(null, from), from);
    await driver.query(`insert into "User" (id, rank) values ('1', 1), ('2', 2), ('3', null)`);

    const result = await plan(from, to);
    expect(await operationKinds(result)).toEqual([
      'dropCheckConstraint',
      'replaceStoredValue',
      'checkConstraint',
    ]);
    await apply(result, to);

    expect((await driver.query('select id, rank from "User" order by id')).rows).toEqual([
      { id: '1', rank: 10 },
      { id: '2', rank: 2 },
      { id: '3', rank: null },
    ]);
  });

  it('swaps stored values by the route of the refusal, through a value no member stores in two plans', {
    timeout: testTimeout,
  }, async () => {
    const from = roleContract({ USER: 'user', GUEST: 'guest' });
    const between = roleContract({ USER: 'prisma_swap', GUEST: 'user' });
    const to = roleContract({ USER: 'guest', GUEST: 'user' });
    await start(from);

    const first = await plan(from, between);
    expect(await operationKinds(first)).toEqual([
      'dropCheckConstraint',
      'replaceStoredValue',
      'replaceStoredValue',
      'checkConstraint',
    ]);
    await apply(first, between);
    const second = await plan(between, to);
    expect(await operationKinds(second)).toEqual([
      'dropCheckConstraint',
      'replaceStoredValue',
      'checkConstraint',
    ]);
    await apply(second, to);

    expect(await roles()).toEqual([
      { id: '1', role: 'user' },
      { id: '2', role: 'guest' },
      { id: '3', role: null },
    ]);
    expect(await operationKinds(await plan(to, to))).toEqual([]);
  });

  it('gives a member the stored value of a removed member by the route of the refusal, in two plans', {
    timeout: testTimeout,
  }, async () => {
    const from = roleContract({ USER: 'user', GUEST: 'guest' });
    const between = roleContract({ USER: 'user' });
    const to = roleContract({ USER: 'guest' });
    await start(from);

    const first = await plan(from, between);
    expect(await operationKinds(first)).toEqual([
      'dropCheckConstraint',
      'removeStoredValue',
      'checkConstraint',
    ]);
    await apply(first, between);
    const second = await plan(between, to);
    expect(await operationKinds(second)).toEqual([
      'dropCheckConstraint',
      'replaceStoredValue',
      'checkConstraint',
    ]);
    await apply(second, to);

    expect(await roles()).toEqual([
      { id: '1', role: null },
      { id: '2', role: 'guest' },
      { id: '3', role: null },
    ]);
  });

  it('refuses a rename statement in a cycle with a member that keeps its name, and its route works', {
    timeout: testTimeout,
  }, async () => {
    const from = roleContract({ USER: 'user', GUEST: 'guest' });
    const between = roleContract({ USER: 'prisma_swap', VISITOR: 'user' });
    const to = roleContract({ USER: 'guest', VISITOR: 'user' });
    const statement = renameRole('GUEST', 'VISITOR');
    await start(from);

    const refused = await plan(from, to, [statement]);
    expect(refused.kind === 'failure' && refused.conflicts).toEqual([
      {
        kind: 'statementRefused',
        summary:
          'Cannot rename enum value "Role.GUEST" to "Role.VISITOR": the renames move stored values in a cycle, "user" to "guest" and "guest" to "user", and a rewrite of one would overwrite the other before it is read',
        why: 'The plan rewrites a changed stored value in every row that holds it, one value after another, and no order of the rewrites moves values in a cycle. Make the change in two plans: first give "Role.USER" a stored value no member stores, such as "prisma_swap", and give "Role.VISITOR" the stored value "user", and plan and apply that with the same statements; then give "Role.USER" the stored value "guest", and plan again without them.',
        refusedStatement: statement,
      },
    ]);

    const first = await plan(from, between, [statement]);
    expect(await operationKinds(first)).toEqual([
      'dropCheckConstraint',
      'replaceStoredValue',
      'replaceStoredValue',
      'checkConstraint',
    ]);
    await apply(first, between);
    const second = await plan(between, to);
    expect(await operationKinds(second)).toEqual([
      'dropCheckConstraint',
      'replaceStoredValue',
      'checkConstraint',
    ]);
    await apply(second, to);

    expect(await roles()).toEqual([
      { id: '1', role: 'user' },
      { id: '2', role: 'guest' },
      { id: '3', role: null },
    ]);
  });
});
