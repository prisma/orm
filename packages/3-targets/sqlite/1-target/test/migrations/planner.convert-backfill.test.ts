import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
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
import { sqliteContractToSchema } from '../../src/core/migrations/diff-database-schema';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import { sqliteCreateNamespace } from '../../src/core/sqlite-unbound-database';
import { sqliteTestComponents, sqliteTestTypes } from '../sqlite-test-types';
import { stubLowerer } from './rename-table-fixtures';

const unbound = asNamespaceId(UNBOUND_NAMESPACE_ID);
const MIGRATION_PLAN: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};
const DB_UPDATE: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const columnTypes = {
  integer: { dataType: 'sqlite/integer', codecId: 'sqlite/integer@1', nullable: false },
  text: { dataType: 'sqlite/text', codecId: 'sqlite/text@1', nullable: false },
  'text=q': {
    dataType: 'sqlite/text',
    codecId: 'sqlite/text@1',
    nullable: false,
    default: { kind: 'literal', value: 'q' },
  },
  'text?': { dataType: 'sqlite/text', codecId: 'sqlite/text@1', nullable: true },
  datetime: { dataType: 'sqlite/text', codecId: 'sqlite/datetime@1', nullable: false },
  role: {
    dataType: 'sqlite/text',
    codecId: 'sqlite/text@1',
    nullable: false,
    valueSet: {
      plane: 'storage',
      namespaceId: UNBOUND_NAMESPACE_ID,
      entityKind: 'valueSet',
      entityName: 'Role',
    },
  },
} as const;

type Columns = Readonly<Record<string, keyof typeof columnTypes>>;

function contract(
  seed: string,
  columns: Columns,
  uniques: readonly string[] = [],
  indexes: readonly string[] = [],
): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash(seed),
    storage: new SqlStorage({
      storageHash: coreHash(seed),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              User: new StorageTable({
                columns: Object.fromEntries(
                  Object.entries(columns).map(([column, type]) => [column, columnTypes[type]]),
                ),
                primaryKey: { columns: ['id'] },
                uniques: uniques.map((column) => ({ columns: [column] })),
                indexes: indexes.map((column) => ({
                  naming: { kind: 'exact' as const, name: `User_${column}_idx` },
                  columns: [column],
                  where: undefined,
                  unique: false,
                  type: undefined,
                  options: undefined,
                })),
                foreignKeys: [],
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
            table: 'User',
            namespaceId: UNBOUND_NAMESPACE_ID,
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

const statement = (kind: 'convert' | 'backfill', field: string): ResolvedMigrationStatement => ({
  kind,
  entity: 'field',
  field: { namespaceId: unbound, model: 'User', field },
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
  const result = createSqliteMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: sqliteContractToSchema(from, sqliteTestTypes),
    policy,
    fromContract,
    origin: planOriginOf(fromContract),
    statements: options.statements ?? [],
    frameworkComponents: sqliteTestComponents,
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
      ? `${entry.value.label} (${entry.value.operationClass})`
      : 'placeholder',
  );
}

function rendered(...args: Parameters<typeof plan>): string {
  return plan(...args).plan.renderTypeScript((specifier) => specifier);
}

const hex = (letter: string) => letter.repeat(64);
const textAge = contract(hex('a'), { id: 'integer', age: 'text', nickname: 'text?' });
const intAge = contract(hex('b'), { id: 'integer', age: 'integer', nickname: 'text?' });
const withName = contract(hex('c'), {
  id: 'integer',
  age: 'text',
  nickname: 'text?',
  name: 'text',
});
const nicknameRequired = contract(hex('d'), { id: 'integer', age: 'text', nickname: 'text' });

describe('SQLite planner, a type change', () => {
  it('rebuilds the table as a destructive change, a data loss, without a statement', async () => {
    const result = plan(textAge, intAge);
    expect(await planned(textAge, intAge)).toEqual(['Recreate table User (destructive)']);
    expect(result.dataLoss.map(({ loss }) => loss)).toEqual(['typeChange']);
  });

  it('checks after the copy that every value of the retyped column took the new type', async () => {
    const [op] = await Promise.all(plan(textAge, intAge).plan.operations);
    expect(op?.postcheck.filter((step) => step.meta !== undefined)).toEqual([
      {
        description: 'verify every value of "age" on "User" is stored as INTEGER',
        sql: `SELECT NOT EXISTS (SELECT 1 FROM "User" WHERE typeof("age") NOT IN ('null', 'integer'))`,
        meta: { convertedColumn: { table: 'User', column: 'age', by: 'cast' } },
      },
    ]);
    expect(rendered(textAge, intAge)).toContain('retypedColumns: ["age"]');
  });

  it('checks no values of a column it does not retype', () => {
    expect(rendered(textAge, withName)).not.toContain('retypedColumns');
  });

  it('lists a --convert column as retyped and writes no check of its own: its copy expression gets one', () => {
    const convert = { statements: [statement('convert', 'age')] };
    expect(rendered(textAge, intAge, convert)).toContain('retypedColumns: ["age"]');
    expect(rendered(textAge, intAge, convert)).not.toMatch(/convertedColumn|verify every value/);
  });

  it('copies the column through a conversion slot for --convert, a data change that loses nothing', async () => {
    const result = plan(textAge, intAge, { statements: [statement('convert', 'age')] });
    expect(await planned(textAge, intAge, { statements: [statement('convert', 'age')] })).toEqual([
      'placeholder',
    ]);
    expect(result.dataLoss).toEqual([]);
    expect(rendered(textAge, intAge, { statements: [statement('convert', 'age')] })).toContain(
      'copyExpressions: { "age": placeholder("User.age:convert") }',
    );
  });
});

describe('SQLite planner, --backfill on a field with a default', () => {
  const statementFor = (field: string) => [statement('backfill', field)];
  const conflictsOf = (to: Contract<SqlStorage>, field: string) =>
    createSqliteMigrationPlanner(stubLowerer).plan({
      contract: to,
      schema: sqliteContractToSchema(textAge, sqliteTestTypes),
      policy: MIGRATION_PLAN,
      fromContract: textAge,
      origin: planOriginOf(textAge),
      statements: statementFor(field),
      frameworkComponents: sqliteTestComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

  it('refuses a new field whose default already fills the existing rows', () => {
    const withDefault = contract(hex('6'), {
      id: 'integer',
      age: 'text',
      nickname: 'text?',
      tag: 'text=q',
    });
    expect(conflictsOf(withDefault, 'tag')).toMatchObject({
      kind: 'failure',
      conflicts: [
        {
          kind: 'statementRefused',
          summary: 'backfill field "User.tag": the field is new and has a default',
          location: { entityName: 'User', column: 'tag' },
        },
      ],
    });
  });

  it('keeps a backfill of an optional field made required that has a default', () => {
    const nicknameDefaulted = contract(hex('5'), {
      id: 'integer',
      age: 'text',
      nickname: 'text=q',
    });
    expect(conflictsOf(nicknameDefaulted, 'nickname').kind).toBe('success');
  });
});

describe('SQLite planner, a new required indexed column', () => {
  it('leaves the index to the rebuild that adds the column', async () => {
    const indexed = contract(
      hex('7'),
      { id: 'integer', age: 'text', nickname: 'text?', name: 'text' },
      [],
      ['name'],
    );
    expect([
      await planned(textAge, indexed),
      await planned(textAge, indexed, { policy: DB_UPDATE }),
      await planned(textAge, indexed, { statements: [statement('backfill', 'name')] }),
    ]).toEqual([
      ['Recreate table User (additive)'],
      ['Recreate table User (additive)'],
      ['Add column name on User (additive)', 'placeholder', 'Recreate table User (widening)'],
    ]);
  });

  it('leaves an optional column and its index to a rebuild of the table for another reason', async () => {
    const relaxedWithIndexedBody = contract(
      hex('3'),
      { id: 'integer', age: 'text?', nickname: 'text?', body: 'text?' },
      [],
      ['body'],
    );
    expect(await planned(textAge, relaxedWithIndexedBody)).toEqual([
      'Recreate table User (widening)',
    ]);
  });

  it('keeps a separate index on an existing column of a table it rebuilds for another reason', async () => {
    const relaxedAndIndexed = contract(
      hex('4'),
      { id: 'integer', age: 'text?', nickname: 'text?' },
      [],
      ['nickname'],
    );
    expect(await planned(textAge, relaxedAndIndexed)).toEqual([
      'Create index User_nickname_idx on User (additive)',
      'Recreate table User (widening)',
    ]);
  });
});

describe('SQLite planner, the columns a rebuild makes required', () => {
  it('marks a column made required and a new required column with no value, and no column that gets a value', async () => {
    const unique = contract(
      hex('f'),
      { id: 'integer', age: 'text', nickname: 'text?', name: 'text' },
      ['name'],
    );
    const marks = async (to: Contract<SqlStorage>) =>
      (await Promise.all(plan(textAge, to).plan.operations)).flatMap((op) =>
        op.postcheck.flatMap((step) => {
          const meta = step.meta?.['requiredColumn'];
          return meta === undefined ? [] : [meta];
        }),
      );
    expect([await marks(nicknameRequired), await marks(unique), await marks(withName)]).toEqual([
      [{ table: 'User', column: 'nickname', reason: 'nullValues' }],
      [{ table: 'User', column: 'name', reason: 'newField' }],
      [],
    ]);
    expect(rendered(textAge, unique)).toContain(
      'requiredColumn: { column: "name", reason: "newField" }',
    );
  });

  it('marks a column a backfill step fills, so a failure names the step', async () => {
    const marks = async (to: Contract<SqlStorage>, field: string) =>
      (
        await Promise.allSettled(
          plan(textAge, to, { statements: [statement('backfill', field)] }).plan.operations,
        )
      ).flatMap((entry) =>
        entry.status === 'fulfilled'
          ? entry.value.postcheck.flatMap((step) => {
              const meta = step.meta?.['requiredColumn'];
              return meta === undefined ? [] : [meta];
            })
          : [],
      );
    expect([await marks(withName, 'name'), await marks(nicknameRequired, 'nickname')]).toEqual([
      [{ table: 'User', column: 'name', reason: 'backfillMissedRows' }],
      [{ table: 'User', column: 'nickname', reason: 'backfillMissedRows' }],
    ]);
  });
});

describe('SQLite planner, a type change the copy makes without losing a value', () => {
  it('rebuilds the table as a widening and asks nothing for an integer field made text', async () => {
    expect(await planned(intAge, textAge)).toEqual(['Recreate table User (widening)']);
    expect(plan(intAge, textAge).dataLoss).toEqual([]);
  });
});

describe('SQLite planner, the data-loss entries of a plan with an unfilled slot', () => {
  it('name each loss by the label of the call that loses it', () => {
    const noNickname = contract(hex('8'), { id: 'integer', age: 'integer' });
    expect(
      plan(textAge, noNickname, { statements: [statement('convert', 'age')] }).dataLoss.map(
        ({ label, loss }) => ({ label, loss }),
      ),
    ).toEqual([{ label: 'Recreate table User', loss: 'drop' }]);
  });
});

describe('SQLite planner, a required field without a value in existing rows', () => {
  it('rebuilds with a temporary value for a new required field, under migration plan and db update', async () => {
    expect([
      await planned(textAge, withName),
      await planned(textAge, withName, { policy: DB_UPDATE }),
    ]).toEqual([['Recreate table User (additive)'], ['Recreate table User (additive)']]);
    expect(rendered(textAge, withName)).toContain('temporaryValues: { "name": sql`\'\'` }');
    expect(rendered(textAge, withName)).not.toMatch(/copyExpressions|retypedColumns/);
  });

  it('checks no type change of a column a temporary value fills, and marks no conversion on its copy', async () => {
    const [op] = await Promise.all(plan(textAge, withName).plan.operations);
    expect(
      [...(op?.postcheck ?? []), ...(op?.execute ?? [])].filter(
        (step) =>
          step.meta !== undefined &&
          ('convertedColumn' in step.meta || 'conversionCopy' in step.meta),
      ),
    ).toEqual([]);
  });

  it('names each new required field that takes a temporary value, with the value', () => {
    expect(plan(textAge, withName).temporaryValues).toEqual([
      {
        operationIndex: 0,
        subject: {
          kind: 'field',
          namespaceId: unbound,
          model: 'User',
          field: 'name',
        },
        value: "''",
      },
    ]);
    expect(
      plan(textAge, withName, { statements: [statement('backfill', 'name')] }).temporaryValues,
    ).toEqual([]);
  });

  it('fills a new required datetime field with the instant the codec writes for the epoch', () => {
    const withStamp = contract(hex('e'), {
      id: 'integer',
      age: 'text',
      nickname: 'text?',
      stamp: 'datetime',
    });
    expect(rendered(textAge, withStamp)).toContain(
      'temporaryValues: { "stamp": sql`\'1970-01-01T00:00:00.000Z\'` }',
    );
  });

  it('rebuilds with a new required unique field and no temporary value, since one value would repeat', async () => {
    const unique = contract(
      hex('f'),
      { id: 'integer', age: 'text', nickname: 'text?', name: 'text' },
      ['name'],
    );
    expect(await planned(textAge, unique)).toEqual(['Recreate table User (widening)']);
    expect(rendered(textAge, unique)).not.toContain('temporaryValues');
  });

  it('rebuilds with a new required field whose values come from a value set and no temporary value, since no one value stands for every member', async () => {
    const withRole = contract(hex('9'), {
      id: 'integer',
      age: 'text',
      nickname: 'text?',
      role: 'role',
    });
    expect([
      await planned(textAge, withRole),
      await planned(textAge, withRole, { policy: DB_UPDATE }),
    ]).toEqual([['Recreate table User (additive)'], ['Recreate table User (additive)']]);
    expect(rendered(textAge, withRole)).not.toContain('temporaryValues');
  });

  it('adds a new required field nullable, fills it through a slot, then tightens it for --backfill', async () => {
    const statements = [statement('backfill', 'name')];
    expect(await planned(textAge, withName, { statements })).toEqual([
      'Add column name on User (additive)',
      'placeholder',
      'Recreate table User (widening)',
    ]);
    expect(rendered(textAge, withName, { statements })).toContain('placeholder("User.name:run")');
  });

  it('tightens an optional field made required, with a slot first for --backfill', async () => {
    expect([
      await planned(textAge, nicknameRequired),
      await planned(textAge, nicknameRequired, { policy: DB_UPDATE }),
      await planned(textAge, nicknameRequired, { statements: [statement('backfill', 'nickname')] }),
    ]).toEqual([
      ['Recreate table User (widening)'],
      ['Recreate table User (widening)'],
      ['placeholder', 'Recreate table User (widening)'],
    ]);
  });
});
