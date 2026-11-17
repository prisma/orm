/**
 * The Postgres planner rewrites the stored values of an enum whose members change: a removed value
 * is set to NULL, a renamed one, or one whose member keeps its name, is replaced, between the drop
 * of the old check and the creation of the new one, and the runner leaves no row holding the old
 * value.
 */
import type { Contract } from '@internal/contract/types';
import { asNamespaceId } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import sqlFamilyPack from '@internal/family-sql/pack';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
  planOriginOf,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { buildBoundContract, enumType, member } from '@internal/sql-contract-ts/contract-builder';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
} from './fixtures/runner-fixtures';

const postgresTypeLookups = {
  codecLookup: createPostgresBuiltinCodecLookup(),
  dataTypeLookup: createDataTypeLookup(postgresDataTypes),
};

const FULL_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

function roleContract(
  members: Readonly<Record<string, string>>,
  options: { readonly required?: boolean; readonly default?: string } = {},
): Contract<SqlStorage> {
  const [first, ...rest] = Object.entries(members);
  if (first === undefined) throw new Error('a role needs a member');
  const Role = enumType(
    'Role',
    { codecId: 'pg/text@1' },
    member(first[0], first[1]),
    ...rest.map(([name, value]) => member(name, value)),
  );
  return buildBoundContract(
    sqlFamilyPack,
    postgresPack,
    { ...postgresTypeLookups, enums: { Role }, createNamespace: postgresCreateNamespace },
    ({ field: f, model: m, type }) => ({
      models: {
        User: m('User', {
          fields: {
            id: f.column(type.String()).id(),
            role: withDefault(
              options.required === true ? f.namedType(Role) : f.namedType(Role).optional(),
              options.default,
            ),
          },
        }),
      },
    }),
  ) as Contract<SqlStorage>;
}

function withDefault<TField extends { default(value: string): TField }>(
  field: TField,
  value: string | undefined,
): TField {
  return value === undefined ? field : field.default(value);
}

function teamContract(
  members: Readonly<Record<string, string>>,
  options: { readonly legacy: boolean },
): Contract<SqlStorage> {
  const [first, ...rest] = Object.entries(members);
  if (first === undefined) throw new Error('a role needs a member');
  const Role = enumType(
    'Role',
    { codecId: 'pg/text@1' },
    member(first[0], first[1]),
    ...rest.map(([name, value]) => member(name, value)),
  );
  return buildBoundContract(
    sqlFamilyPack,
    postgresPack,
    { ...postgresTypeLookups, enums: { Role }, createNamespace: postgresCreateNamespace },
    ({ field: f, model: m, type }) => ({
      models: {
        User: m('User', {
          fields: { id: f.column(type.String()).id(), role: f.namedType(Role).optional() },
        }),
        Team: m('Team', {
          fields: { id: f.column(type.String()).id(), roles: f.namedType(Role).many() },
        }),
        ...(options.legacy
          ? {
              Legacy: m('Legacy', {
                fields: { id: f.column(type.String()).id(), role: f.namedType(Role).optional() },
              }),
            }
          : {}),
      },
    }),
  ) as Contract<SqlStorage>;
}

function rankContract(members: Readonly<Record<string, number>>): Contract<SqlStorage> {
  const [first, ...rest] = Object.entries(members);
  if (first === undefined) throw new Error('a rank needs a member');
  const Rank = enumType(
    'Rank',
    { codecId: 'pg/int4@1' },
    member(first[0], first[1]),
    ...rest.map(([name, value]) => member(name, value)),
  );
  return buildBoundContract(
    sqlFamilyPack,
    postgresPack,
    { ...postgresTypeLookups, enums: { Rank }, createNamespace: postgresCreateNamespace },
    ({ field: f, model: m, type }) => ({
      models: {
        User: m('User', {
          fields: { id: f.column(type.String()).id(), rank: f.namedType(Rank).optional() },
        }),
      },
    }),
  ) as Contract<SqlStorage>;
}

function renameRole(from: string, to: string): ResolvedMigrationStatement {
  return {
    kind: 'rename',
    entity: 'enumValue',
    from: { namespaceId: asNamespaceId('public'), enum: 'Role', member: from },
    to: { namespaceId: asNamespaceId('public'), enum: 'Role', member: to },
  };
}

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

  const planner = () => postgresTargetDescriptor.createPlanner(controlAdapter);

  async function plan(
    from: Contract<SqlStorage> | null,
    to: Contract<SqlStorage>,
    statements: readonly ResolvedMigrationStatement[] = [],
  ) {
    const schema =
      from === null ? emptySchema : await familyInstance.introspect({ driver, contract: from });
    return planner().plan({
      contract: to,
      schema,
      policy: from === null ? INIT_ADDITIVE_POLICY : FULL_POLICY,
      fromContract: from,
      origin: from === null ? null : planOriginOf(from),
      statements,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
  }

  async function apply(result: Awaited<ReturnType<typeof plan>>, contract: Contract<SqlStorage>) {
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    const executed = await postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: result.plan,
          migrationEdges: synthEdges(result.plan),
          driver,
          destinationContract: contract,
          policy: FULL_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!executed.ok) throw new Error(formatRunnerFailure(executed.failure));
  }

  async function start(contract: Contract<SqlStorage>): Promise<void> {
    await apply(await plan(null, contract), contract);
    await driver.query(
      `insert into "User" (id, role) values ('1', 'guest'), ('2', 'user'), ('3', null)`,
    );
  }

  async function roles(): Promise<unknown[]> {
    return (await driver.query('select id, role from "User" order by id')).rows;
  }

  async function operationKinds(
    result: Awaited<ReturnType<typeof plan>>,
  ): Promise<readonly string[]> {
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    const operations = await Promise.all(result.plan.operations);
    return operations.map((operation) => operation.id.split('.')[0] ?? '');
  }

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
        why: 'The plan rewrites a changed stored value in every row that holds it, one value after another, and no order of the rewrites moves values in a cycle. Write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the values in each column the enum types through a value no member stores, "user" to "prisma_swap", then "guest" to "user", then "prisma_swap" to "guest", each with this.replaceStoredValue({ table, column, from, to }) yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
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
        why: 'A changed stored value is rewritten in every row that holds it, so the rows of "Role.USER" would hold "guest" as the rows of "Role.GUEST" do, and their data would merge. To keep their data apart, give "Role.USER" a stored value no member of the origin enum stores, and plan again. To merge their data on purpose, write this change as a hand-written migration: run prisma migration new, and in the operations of the migration.ts it writes, rewrite "user" to "guest" in each column the enum types, with this.replaceStoredValue({ table, column, from, to }) yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
      },
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

    await apply(await plan(from, to), to);

    expect((await driver.query('select id, rank from "User" order by id')).rows).toEqual([
      { id: '1', rank: 10 },
      { id: '2', rank: 2 },
      { id: '3', rank: null },
    ]);
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
