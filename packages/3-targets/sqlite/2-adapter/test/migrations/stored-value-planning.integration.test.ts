/**
 * The SQLite planner rewrites the stored values of an enum whose members change: a removed value
 * is set to NULL, a renamed one is replaced, before the table is rebuilt with its new check, and
 * the runner leaves no row holding the old value.
 */
import { asNamespaceId, type Contract } from '@internal/contract/types';
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
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import { sqliteDataTypes } from '@internal/target-sqlite/data-types';
import sqlitePack from '@internal/target-sqlite/pack';
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { textColumn } from '../../src/exports/column-types';
import {
  controlAdapter,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  sqliteTargetDescriptor,
  synthEdges,
  type TestDatabase,
} from './fixtures/runner-fixtures';

const sqliteTypeLookups = {
  codecLookup: createSqliteBuiltinCodecLookup(),
  dataTypeLookup: createDataTypeLookup(sqliteDataTypes),
};

const FULL_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

function roleContract(
  members: Readonly<Record<string, string>>,
  options: { readonly required?: boolean } = {},
): Contract<SqlStorage> {
  const [first, ...rest] = Object.entries(members);
  if (first === undefined) throw new Error('a role needs a member');
  const Role = enumType(
    'Role',
    { codecId: 'sqlite/text@1' },
    member(first[0], first[1]),
    ...rest.map(([name, value]) => member(name, value)),
  );
  return buildBoundContract(
    sqlFamilyPack,
    sqlitePack,
    { ...sqliteTypeLookups, enums: { Role }, createNamespace: sqliteCreateNamespace },
    ({ field: f, model: m }) => ({
      models: {
        User: m('User', {
          fields: {
            id: f.column(textColumn).id(),
            role: options.required === true ? f.namedType(Role) : f.namedType(Role).optional(),
          },
        }),
      },
    }),
  ) as Contract<SqlStorage>;
}

function rankContract(members: Readonly<Record<string, number>>): Contract<SqlStorage> {
  const [first, ...rest] = Object.entries(members);
  if (first === undefined) throw new Error('a rank needs a member');
  const Rank = enumType(
    'Rank',
    { codecId: 'sqlite/integer@1' },
    member(first[0], first[1]),
    ...rest.map(([name, value]) => member(name, value)),
  );
  return buildBoundContract(
    sqlFamilyPack,
    sqlitePack,
    { ...sqliteTypeLookups, enums: { Rank }, createNamespace: sqliteCreateNamespace },
    ({ field: f, model: m }) => ({
      models: {
        User: m('User', {
          fields: { id: f.column(textColumn).id(), rank: f.namedType(Rank).optional() },
        }),
      },
    }),
  ) as Contract<SqlStorage>;
}

describe('SQLite planner, stored enum values', { timeout: timeouts.databaseOperation }, () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  afterEach(() => {
    testDb?.cleanup();
  });

  async function plan(
    from: Contract<SqlStorage> | null,
    to: Contract<SqlStorage>,
    statements: readonly ResolvedMigrationStatement[] = [],
  ) {
    const schema =
      from === null
        ? emptySchema
        : await familyInstance.introspect({ driver: testDb.driver, contract: from });
    return sqliteTargetDescriptor.createPlanner(controlAdapter).plan({
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
    const { driver } = testDb;
    const executed = await sqliteTargetDescriptor.createRunner(familyInstance).execute({
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

  async function operationKinds(result: Awaited<ReturnType<typeof plan>>) {
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    const operations = await Promise.all(result.plan.operations);
    return operations.map((operation) => operation.id.split('.')[0] ?? '');
  }

  async function start(contract: Contract<SqlStorage>): Promise<void> {
    await apply(await plan(null, contract), contract);
    await testDb.driver.query(
      `INSERT INTO "User" (id, role) VALUES ('1', 'guest'), ('2', 'user'), ('3', NULL)`,
    );
  }

  async function roles(): Promise<unknown[]> {
    return (await testDb.driver.query('SELECT id, role FROM "User" ORDER BY id')).rows;
  }

  it('removes a stored value before the table is rebuilt, and asks about it as the enum value', async () => {
    const from = roleContract({ USER: 'user', GUEST: 'guest' });
    const to = roleContract({ USER: 'user' });
    await start(from);

    const result = await plan(from, to);

    expect((await operationKinds(result))[0]).toBe('removeStoredValue');
    expect(result.kind === 'success' && result.dataLoss.map(({ subject }) => subject)).toEqual([
      {
        kind: 'enumValue',
        namespaceId: asNamespaceId('__unbound__'),
        enum: 'Role',
        member: 'GUEST',
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

  it('replaces a renamed stored value, and the rename accounts for the replacement', async () => {
    const from = roleContract({ USER: 'user', GUEST: 'guest' });
    const to = roleContract({ USER: 'user', VISITOR: 'visitor' });
    await start(from);
    const statement: ResolvedMigrationStatement = {
      kind: 'rename',
      entity: 'enumValue',
      from: { namespaceId: asNamespaceId('__unbound__'), enum: 'Role', member: 'GUEST' },
      to: { namespaceId: asNamespaceId('__unbound__'), enum: 'Role', member: 'VISITOR' },
    };

    const result = await plan(from, to, [statement]);

    expect((await operationKinds(result))[0]).toBe('replaceStoredValue');
    expect(result.kind === 'success' && result.appliedStatements).toEqual([
      { statement, operationIndexes: [0] },
    ]);
    await apply(result, to);
    expect(await roles()).toEqual([
      { id: '1', role: 'visitor' },
      { id: '2', role: 'user' },
      { id: '3', role: null },
    ]);
  });

  it('removes a stored value from a required column when no row holds it, and fails at apply, naming how to keep them, when rows do', async () => {
    const from = roleContract({ USER: 'user', GUEST: 'guest' }, { required: true });
    const to = roleContract({ USER: 'user' }, { required: true });
    await apply(await plan(null, from), from);
    await testDb.driver.query(`INSERT INTO "User" (id, role) VALUES ('1', 'guest'), ('2', 'user')`);

    const result = await plan(from, to);
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    expect(result.dataLoss.map(({ subject }) => subject)).toEqual([
      {
        kind: 'enumValue',
        namespaceId: asNamespaceId('__unbound__'),
        enum: 'Role',
        member: 'GUEST',
      },
    ]);
    const failed = await apply(result, to).then(
      () => '',
      (error: Error) => error.message,
    );
    expect(failed).toContain(
      '[MIGRATION.PRECHECK_FAILED] 1 row of "User" holds "guest" in column "role", which takes no NULL, so the value cannot be removed.',
    );
    expect(failed).toContain('"rowsHoldingValue": [');
    expect(failed).toContain(
      '"enumValue": {\n        "enum": "Role",\n        "member": "GUEST"\n      }',
    );
    expect(failed).toContain('"keepDataEdit": {');
    expect(failed).toContain('"rows": 1');
    expect(await roles()).toEqual([
      { id: '1', role: 'guest' },
      { id: '2', role: 'user' },
    ]);

    await testDb.driver.query(`DELETE FROM "User" WHERE role = 'guest'`);
    await apply(await plan(from, to), to);
    expect(await operationKinds(await plan(to, to))).toEqual([]);
  });

  it('writes a numeric stored value as the column codec stores it, so the rows that hold it match', async () => {
    const from = rankContract({ LOW: 1, HIGH: 3 });
    const to = rankContract({ HIGH: 3 });
    await apply(await plan(null, from), from);
    await testDb.driver.query(`INSERT INTO "User" (id, rank) VALUES ('1', 1), ('2', 3)`);
    const stored = from.domain.namespaces['__unbound__']?.enum?.['Rank']?.members[0]?.value;

    const result = await plan(from, to);
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    const [removal] = await Promise.all(result.plan.operations);

    expect({ stored, params: removal?.execute[0]?.params }).toEqual({ stored: '1', params: [1] });
    await apply(result, to);
    expect((await testDb.driver.query('SELECT id, rank FROM "User" ORDER BY id')).rows).toEqual([
      { id: '1', rank: null },
      { id: '2', rank: 3 },
    ]);
  });

  it('removes a stored value from a column the same change makes optional', async () => {
    const from = roleContract({ USER: 'user', GUEST: 'guest' }, { required: true });
    const to = roleContract({ USER: 'user' });
    await apply(await plan(null, from), from);
    await testDb.driver.query(`INSERT INTO "User" (id, role) VALUES ('1', 'guest'), ('2', 'user')`);

    await apply(await plan(from, to), to);

    expect(await roles()).toEqual([
      { id: '1', role: null },
      { id: '2', role: 'user' },
    ]);
  });
});
