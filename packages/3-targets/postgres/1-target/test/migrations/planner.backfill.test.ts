import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
  planOriginOf,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { postgresTypeComponents } from '../postgres-type-lookups';

const stubLowerer: ExecuteRequestLowerer = {
  lower: () => ({ sql: 'stub', params: [] }),
  renderColumnDefault: async () => '',
  lowerToExecuteRequest: async () => ({ sql: 'stub', params: [] }),
};

const MIGRATION_PLAN: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};
const DB_UPDATE: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const columnTypes = {
  int4: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
  text: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
  'text?': { dataType: 'pg/text', codecId: 'pg/text@1', nullable: true },
  role: {
    dataType: 'pg/text',
    codecId: 'pg/text@1',
    nullable: false,
    valueSet: {
      plane: 'storage',
      namespaceId: 'public',
      entityKind: 'valueSet',
      entityName: 'Role',
    },
  },
} as const;

type Columns = Readonly<Record<string, keyof typeof columnTypes>>;

function contract(
  seed: string,
  columns: Columns,
  uniques: readonly (readonly string[])[] = [],
  table = 'User',
): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(seed),
    storage: new SqlStorage({
      storageHash: coreHash(seed),
      namespaces: {
        public: new PostgresSchema({
          id: 'public',
          entries: {
            table: {
              [table]: new StorageTable({
                columns: Object.fromEntries(
                  Object.entries(columns).map(([column, type]) => [column, columnTypes[type]]),
                ),
                primaryKey: { columns: ['id'] },
                foreignKeys: [],
                uniques: uniques.map((columnsOf) => ({ columns: [...columnsOf] })),
                indexes: [],
              }),
            },
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({
      models: {
        User: {
          fields: Object.fromEntries(
            Object.entries(columns).map(([column, type]) => [
              column,
              {
                nullable: type.endsWith('?'),
                type: { kind: 'scalar', codecId: columnTypes[type].codecId },
              },
            ]),
          ),
          relations: {},
          storage: {
            table,
            namespaceId: 'public',
            fields: Object.fromEntries(Object.keys(columns).map((column) => [column, { column }])),
          },
        },
      },
    }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

const backfill = (field: string): ResolvedMigrationStatement => ({
  kind: 'backfill',
  entity: 'field',
  field: { namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID), model: 'User', field },
});

function plan(
  from: Contract<SqlStorage>,
  to: Contract<SqlStorage>,
  options: {
    readonly policy?: MigrationOperationPolicy;
    readonly statements?: readonly ResolvedMigrationStatement[];
  } = {},
) {
  const policy = options.policy ?? MIGRATION_PLAN;
  const fromContract = policy === MIGRATION_PLAN ? from : null;
  const result = createPostgresMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: postgresContractToSchema(from, postgresTypeComponents),
    policy,
    fromContract,
    origin: planOriginOf(fromContract),
    statements: options.statements ?? [],
    frameworkComponents: postgresTypeComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  return result;
}

async function planned(...args: Parameters<typeof plan>) {
  const settled = await Promise.allSettled(plan(...args).plan.operations);
  return settled.map((entry) =>
    entry.status === 'fulfilled'
      ? `${entry.value.label} (${entry.value.operationClass}): ${entry.value.execute.map(({ description }) => description).join('; ')}`
      : 'placeholder',
  );
}

const before = contract('before', { id: 'int4', nickname: 'text?' });
const withName = contract('with-name', { id: 'int4', nickname: 'text?', name: 'text' });
const nicknameRequired = contract('nickname-required', { id: 'int4', nickname: 'text' });

const temporaryDefault =
  'Add column name to User (additive): add column "name"; drop temporary default from column "name"';

describe('Postgres planner, a required field without a value in existing rows', () => {
  it('adds a new required field with a temporary default, under migration plan and db update', async () => {
    expect([
      await planned(before, withName),
      await planned(before, withName, { policy: DB_UPDATE }),
    ]).toEqual([[temporaryDefault], [temporaryDefault]]);
  });

  it('names each new required field that takes a temporary value, with the value', () => {
    expect(plan(before, withName).temporaryValues).toEqual([
      {
        operationIndex: 0,
        subject: {
          kind: 'field',
          namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
          model: 'User',
          field: 'name',
        },
        value: "''",
      },
    ]);
    expect(plan(before, withName, { statements: [backfill('name')] }).temporaryValues).toEqual([]);
  });

  it('adds a new required field with a backfill slot for --backfill', async () => {
    expect(await planned(before, withName, { statements: [backfill('name')] })).toEqual([
      'Add column "name" to "User" (additive): add column "name"',
      'placeholder',
      'Set NOT NULL on "User"."name" (widening): set NOT NULL on "name"',
    ]);
  });

  it('adds a new required unique field to an empty table only, since one temporary value would repeat', async () => {
    const unique = contract('unique', { id: 'int4', nickname: 'text?', name: 'text' }, [['name']]);
    expect((await planned(before, unique))[0]).toBe(
      'Add column name to User (additive): add column "name"',
    );
  });

  it('adds a new required field whose values come from a value set to an empty table only, since no one value stands for every member', async () => {
    const withRole = contract('role', { id: 'int4', nickname: 'text?', role: 'role' });
    expect(
      [await planned(before, withRole), await planned(before, withRole, { policy: DB_UPDATE })].map(
        (operations) => operations.find((operation) => operation.includes('"role"')),
      ),
    ).toEqual([
      'Add column role to User (additive): add column "role"',
      'Add column role to User (additive): add column "role"',
    ]);
  });

  it('makes an optional field required with SET NOT NULL, under migration plan and db update', async () => {
    const setNotNull = 'Set NOT NULL on "User"."nickname" (widening): set NOT NULL on "nickname"';
    expect([
      await planned(before, nicknameRequired),
      await planned(before, nicknameRequired, { policy: DB_UPDATE }),
    ]).toEqual([[setNotNull], [setNotNull]]);
  });

  it('fills an optional field made required with a backfill slot for --backfill', async () => {
    expect(await planned(before, nicknameRequired, { statements: [backfill('nickname')] })).toEqual(
      ['placeholder', 'Set NOT NULL on "User"."nickname" (widening): set NOT NULL on "nickname"'],
    );
  });
});

describe('the backfill slots', () => {
  it('are named by the field the statement names, whatever its table is called', async () => {
    const hex = (letter: string) => letter.repeat(64);
    const from = contract(hex('a'), { id: 'int4', nickname: 'text?' }, [], 'users');
    const to = contract(hex('b'), { id: 'int4', nickname: 'text', name: 'text' }, [], 'users');
    const result = createPostgresMigrationPlanner(stubLowerer).plan({
      contract: to,
      schema: postgresContractToSchema(from, postgresTypeComponents),
      policy: MIGRATION_PLAN,
      fromContract: from,
      origin: planOriginOf(from),
      statements: [backfill('name'), backfill('nickname')],
      frameworkComponents: postgresTypeComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    const slots = [
      ...result.plan
        .renderTypeScript((specifier) => specifier)
        .matchAll(/placeholder\("([^"]+)"\)/g),
    ].map((match) => match[1]);

    expect(slots.sort()).toEqual(
      ['User.name:check', 'User.name:run', 'User.nickname:check', 'User.nickname:run'].sort(),
    );
  });

  it('name the column each backfill step fills', async () => {
    const hex = (letter: string) => letter.repeat(64);
    const from = contract(hex('a'), { id: 'int4', nickname: 'text?' }, [], 'users');
    const to = contract(hex('b'), { id: 'int4', nickname: 'text', name: 'text' }, [], 'users');
    const result = createPostgresMigrationPlanner(stubLowerer).plan({
      contract: to,
      schema: postgresContractToSchema(from, postgresTypeComponents),
      policy: MIGRATION_PLAN,
      fromContract: from,
      origin: planOriginOf(from),
      statements: [backfill('name'), backfill('nickname')],
      frameworkComponents: postgresTypeComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    const source = result.plan.renderTypeScript((specifier) => specifier);

    expect(
      [...source.matchAll(/backfillsColumn: \{[^}]+\}/g)].map((match) => match[0]).sort(),
    ).toEqual(
      [
        'backfillsColumn: { schema: "public", table: "users", column: "name" }',
        'backfillsColumn: { schema: "public", table: "users", column: "nickname" }',
      ].sort(),
    );
  });
});
