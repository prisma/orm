/**
 * When rows of required columns still hold a stored enum value a plan removes, the runner fails at
 * the first removal's check and reports every required column of the migration that holds the
 * value, the failed one first.
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

function rolesContract(members: Readonly<Record<string, string>>): Contract<SqlStorage> {
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
        User: m('User', { fields: { id: f.column(type.String()).id(), role: f.namedType(Role) } }),
        Member: m('Member', {
          fields: { id: f.column(type.String()).id(), role: f.namedType(Role) },
        }),
        Visitor: m('Visitor', {
          fields: { id: f.column(type.String()).id(), role: f.namedType(Role).optional() },
        }),
      },
    }),
  ) as Contract<SqlStorage>;
}

describe('Postgres runner, rows that hold a removed stored value', { concurrent: false }, () => {
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

  async function plan(from: Contract<SqlStorage> | null, to: Contract<SqlStorage>) {
    const schema =
      from === null ? emptySchema : await familyInstance.introspect({ driver, contract: from });
    const result = await postgresTargetDescriptor.createPlanner(controlAdapter).plan({
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
    return postgresTargetDescriptor.createRunner(familyInstance).execute({
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

  it('lists every required column that holds the value, the failed one first, and leaves out an optional one', {
    timeout: testTimeout,
  }, async () => {
    const from = rolesContract({ USER: 'user', GUEST: 'guest' });
    const to = rolesContract({ USER: 'user' });
    const created = await run(await plan(null, from), from);
    if (!created.ok) throw new Error(created.failure.message);
    await driver.query(`insert into "User" (id, role) values ('1', 'guest'), ('2', 'user')`);
    await driver.query(`insert into "Member" (id, role) values ('1', 'guest'), ('2', 'guest')`);
    await driver.query(`insert into "Visitor" (id, role) values ('1', 'guest')`);

    const executed = await run(await plan(from, to), to);
    if (executed.ok) throw new Error('expected the removal to fail');

    const guest = { namespaceId: asNamespaceId('public'), enum: 'Role', member: 'GUEST' };
    const reported = executed.failure.meta.rowsHoldingValue?.map(
      ({ keepDataEdit: _edit, operationIndex: _index, ...entry }) => entry,
    );
    expect({
      message: executed.failure.message,
      reported,
      kept: executed.failure.meta.rowsHoldingValue?.map(({ keepDataEdit }) => keepDataEdit?.remove),
    }).toEqual({
      message:
        '1 row of "User" holds "guest" in column "role", which takes no NULL, so the value cannot be removed.',
      reported: [
        { enumValue: guest, value: 'guest', rows: 1 },
        { enumValue: guest, value: 'guest', rows: 2 },
      ],
      kept: [
        'this.removeStoredValue({ schema: "public", table: "User", column: "role", value: "guest", codecRef: { codecId: "pg/text@1" }, enumValue: { namespaceId: "public", enum: "Role", member: "GUEST" } })',
        'this.removeStoredValue({ schema: "public", table: "Member", column: "role", value: "guest", codecRef: { codecId: "pg/text@1" }, enumValue: { namespaceId: "public", enum: "Role", member: "GUEST" } })',
      ],
    });
  });
});
