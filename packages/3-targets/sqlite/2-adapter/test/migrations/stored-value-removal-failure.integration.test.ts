/**
 * When rows of required columns still hold a stored enum value a plan removes, the runner fails at
 * the first removal's check and reports every required column of the migration that holds the
 * value, the failed one first.
 */
import type { Contract } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import sqlFamilyPack from '@internal/family-sql/pack';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
  planOriginOf,
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

function rolesContract(members: Readonly<Record<string, string>>): Contract<SqlStorage> {
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
        User: m('User', { fields: { id: f.column(textColumn).id(), role: f.namedType(Role) } }),
        Member: m('Member', { fields: { id: f.column(textColumn).id(), role: f.namedType(Role) } }),
        Visitor: m('Visitor', {
          fields: { id: f.column(textColumn).id(), role: f.namedType(Role).optional() },
        }),
      },
    }),
  ) as Contract<SqlStorage>;
}

describe('SQLite runner, rows that hold a removed stored value', {
  timeout: timeouts.databaseOperation,
}, () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  afterEach(() => {
    testDb?.cleanup();
  });

  async function plan(from: Contract<SqlStorage> | null, to: Contract<SqlStorage>) {
    const schema =
      from === null
        ? emptySchema
        : await familyInstance.introspect({ driver: testDb.driver, contract: from });
    const result = await sqliteTargetDescriptor.createPlanner(controlAdapter).plan({
      contract: to,
      schema,
      policy: from === null ? INIT_ADDITIVE_POLICY : FULL_POLICY,
      fromContract: from,
      origin: from === null ? null : planOriginOf(from),
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    return result;
  }

  function run(result: Awaited<ReturnType<typeof plan>>, contract: Contract<SqlStorage>) {
    const { driver } = testDb;
    return sqliteTargetDescriptor.createRunner(familyInstance).execute({
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
  }

  it('lists every required column that holds the value, the failed one first, and leaves out an optional one', async () => {
    const from = rolesContract({ USER: 'user', GUEST: 'guest' });
    const to = rolesContract({ USER: 'user' });
    const created = await run(await plan(null, from), from);
    if (!created.ok) throw new Error(created.failure.message);
    const { driver } = testDb;
    await driver.query(`INSERT INTO "User" (id, role) VALUES ('1', 'guest'), ('2', 'user')`);
    await driver.query(`INSERT INTO "Member" (id, role) VALUES ('1', 'guest'), ('2', 'guest')`);
    await driver.query(`INSERT INTO "Visitor" (id, role) VALUES ('1', 'guest')`);

    const executed = await run(await plan(from, to), to);
    if (executed.ok) throw new Error('expected the removal to fail');

    const guest = { enum: 'Role', member: 'GUEST' };
    expect({
      message: executed.failure.message,
      reported: executed.failure.meta.rowsHoldingValue?.map(
        ({ keepDataEdit: _edit, operationIndex: _index, ...entry }) => entry,
      ),
      kept: executed.failure.meta.rowsHoldingValue?.map(({ keepDataEdit }) => keepDataEdit?.remove),
    }).toEqual({
      message:
        '1 row of "User" holds "guest" in column "role", which takes no NULL, so the value cannot be removed.',
      reported: [
        { enumValue: guest, value: 'guest', rows: 1 },
        { enumValue: guest, value: 'guest', rows: 2 },
      ],
      kept: [
        'this.removeStoredValue({ table: "User", column: "role", value: "guest", codecRef: { codecId: "sqlite/text@1" }, enumValue: { enum: "Role", member: "GUEST" } })',
        'this.removeStoredValue({ table: "Member", column: "role", value: "guest", codecRef: { codecId: "sqlite/text@1" }, enumValue: { enum: "Role", member: "GUEST" } })',
      ],
    });
  });
});
