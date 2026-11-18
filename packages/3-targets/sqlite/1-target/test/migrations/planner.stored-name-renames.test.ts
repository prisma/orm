import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import {
  APP_SPACE_ID,
  type ControlStack,
  planOriginOf,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf, workspaceMigrationModule } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { sqliteContractToSchema } from '../../src/core/migrations/diff-database-schema';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import { SqliteMigration } from '../../src/core/migrations/sqlite-migration';
import { SqliteContractSerializer } from '../../src/core/sqlite-contract-serializer';
import { sqliteCreateNamespace } from '../../src/core/sqlite-unbound-database';
import { sqliteTestComponents, sqliteTestTypes } from '../sqlite-test-types';
import { stubLowerer } from './rename-table-fixtures';

const ALL_CLASSES = { allowedOperationClasses: ['additive', 'widening', 'destructive'] as const };
const NS = asNamespaceId(UNBOUND_NAMESPACE_ID);

const stack = {
  adapter: {
    ...sqliteTestComponents[0],
    create: () => stubLowerer as unknown as SqlControlAdapter<'sqlite'>,
  },
  target: { kind: 'target', familyId: 'sql', targetId: 'sqlite' },
  extensions: [],
} as unknown as ControlStack<'sql', 'sqlite'>;

interface ColumnSpec {
  readonly column: string;
  readonly nullable?: boolean;
}

interface ModelSpec {
  readonly table: string;
  readonly fields?: Readonly<Record<string, ColumnSpec>>;
}

/** One model per entry, each in its table with an `id` primary key and a text column per field. */
function contractOf(
  seed: string,
  models: Readonly<Record<string, ModelSpec>>,
): Contract<SqlStorage> {
  const fieldsOf = (spec: ModelSpec): Readonly<Record<string, ColumnSpec>> => ({
    id: { column: 'id' },
    ...spec.fields,
  });
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
            table: Object.fromEntries(
              Object.values(models).map((spec) => [
                spec.table,
                new StorageTable({
                  columns: Object.fromEntries(
                    Object.values(fieldsOf(spec)).map(({ column, nullable = false }) => [
                      column,
                      { dataType: 'sqlite/text', codecId: 'sqlite/text@1', nullable },
                    ]),
                  ),
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                }),
              ]),
            ),
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({
      models: Object.fromEntries(
        Object.entries(models).map(([model, spec]) => [
          model,
          {
            fields: Object.fromEntries(
              Object.entries(fieldsOf(spec)).map(([field, { nullable = false }]) => [
                field,
                { nullable, type: { kind: 'scalar', codecId: 'sqlite/text@1' } },
              ]),
            ),
            relations: {},
            storage: {
              table: spec.table,
              namespaceId: UNBOUND_NAMESPACE_ID,
              fields: Object.fromEntries(
                Object.entries(fieldsOf(spec)).map(([field, { column }]) => [field, { column }]),
              ),
            },
          },
        ]),
      ),
    }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function plan(from: Contract<SqlStorage>, to: Contract<SqlStorage>) {
  return createSqliteMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: sqliteContractToSchema(from, sqliteTestTypes),
    policy: ALL_CLASSES,
    fromContract: from,
    origin: planOriginOf(from),
    statements: [],
    frameworkComponents: sqliteTestComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
}

function success(result: ReturnType<typeof plan>) {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  return result;
}

async function labelsOf(result: ReturnType<typeof plan>): Promise<readonly string[]> {
  return (await Promise.all(success(result).plan.operations)).map((op) => op.label);
}

const email = { column: 'email' };

describe('SQLite planner, a table or column whose model or field keeps its name', () => {
  it('renames the table, with no statement applied and nothing to ask', async () => {
    const result = plan(
      contractOf('from', { User: { table: 'users', fields: { email } } }),
      contractOf('to', { User: { table: 'app_users', fields: { email } } }),
    );
    expect(await labelsOf(result)).toEqual(['Rename table users to app_users']);
    expect(success(result).appliedStatements).toEqual([]);
    expect(success(result).dataLoss).toEqual([]);
  });

  it('renames the column of a field whose @map changes', async () => {
    const result = plan(
      contractOf('from', { User: { table: 'users', fields: { email } } }),
      contractOf('to', {
        User: { table: 'users', fields: { email: { column: 'email_address' } } },
      }),
    );
    expect(await labelsOf(result)).toEqual(['Rename column email on users to email_address']);
  });

  it('renames a table and a column whose names change only in case', async () => {
    const result = plan(
      contractOf('from', { User: { table: 'user', fields: { email } } }),
      contractOf('to', { User: { table: 'User', fields: { email: { column: 'Email' } } } }),
    );
    expect(await labelsOf(result)).toEqual([
      'Rename table user to User',
      'Rename column email on User to Email',
    ]);
  });

  it('changes the nullability of a renamed column in place of a drop and add', async () => {
    const result = plan(
      contractOf('from', { User: { table: 'users', fields: { email } } }),
      contractOf('to', {
        User: {
          table: 'app_users',
          fields: { email: { column: 'email_address', nullable: true } },
        },
      }),
    );
    expect(await labelsOf(result)).toEqual([
      'Rename table users to app_users',
      'Rename column email on app_users to email_address',
      'Recreate table app_users',
    ]);
    expect(success(result).dataLoss).toEqual([]);
  });

  it('asks about a column dropped from a renamed table by the field of the origin model', async () => {
    const result = plan(
      contractOf('from', { User: { table: 'users', fields: { email, name: { column: 'name' } } } }),
      contractOf('to', { User: { table: 'app_users', fields: { email } } }),
    );
    expect(success(result).dataLoss.map(({ subject }) => subject)).toEqual([
      { kind: 'field', namespaceId: NS, model: 'User', field: 'name' },
    ]);
  });

  it('refuses a table name that another table holds in another case, naming no statement', () => {
    const result = plan(
      contractOf('from', { User: { table: 'users' }, Account: { table: 'Accounts' } }),
      contractOf('to', { User: { table: 'accounts' } }),
    );
    expect(result.kind === 'failure' && result.conflicts).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot rename table "users" to "accounts": the schema being planned from already has a table "accounts", as "Accounts"',
        why: 'The table of model "User" changes from "users" to "accounts", and the schema being planned from already has table "Accounts", the table of model "Account". Without the rename the plan would read the rows of table "Accounts" as rows of model "User". Make the change in two plans: first remove model "Account", or keep it and change its table to a name nothing uses, such as "prisma_swap_Accounts", and plan and apply that; then make this change and plan again.',
        location: { namespaceId: NS, entityKind: 'table', entityName: 'users' },
      },
    ]);
  });

  it('refuses a column name that another column holds in another case, naming no statement', () => {
    const result = plan(
      contractOf('from', {
        User: { table: 'users', fields: { email, old: { column: 'Address' } } },
      }),
      contractOf('to', { User: { table: 'users', fields: { email: { column: 'address' } } } }),
    );
    expect(result.kind === 'failure' && result.conflicts).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot rename column "users"."email" to "address": the schema being planned from already has a column "address" on table "users", as "Address"',
        why: 'The column of field "User.email" changes from "email" to "address", and the schema being planned from already has column "Address" on table "users", the column of field "User.old". Without the rename the plan would read the values of column "Address" as values of field "User.email". Make the change in two plans: first remove field "User.old", or keep it and change its column to a name nothing uses, such as "prisma_swap_Address", and plan and apply that; then make this change and plan again.',
        location: { namespaceId: NS, entityKind: 'table', entityName: 'users', column: 'email' },
      },
    ]);
  });

  it('renames no table when two tables move to names that differ only in case', async () => {
    expect(
      await labelsOf(
        plan(
          contractOf('from', { User: { table: 'users' }, Member: { table: 'members' } }),
          contractOf('to', { User: { table: 'people' }, Member: { table: 'People' } }),
        ),
      ),
    ).toEqual([
      'Create table People',
      'Create table people',
      'Drop table "members"',
      'Drop table "users"',
    ]);
  });

  it('renames no column when two columns move to names that differ only in case', async () => {
    expect(
      await labelsOf(
        plan(
          contractOf('from', {
            User: { table: 'users', fields: { a: { column: 'x' }, b: { column: 'y' } } },
          }),
          contractOf('to', {
            User: { table: 'users', fields: { a: { column: 'z' }, b: { column: 'Z' } } },
          }),
        ),
      ),
    ).toEqual([
      'Recreate table users',
      'Drop column "x" from "users"',
      'Drop column "y" from "users"',
    ]);
  });

  it('emits the same operations as the facade calls it renders, run against the same contracts', async () => {
    const from = contractOf('a'.repeat(64), { User: { table: 'users', fields: { email } } });
    const to = contractOf('b'.repeat(64), {
      User: { table: 'app_users', fields: { email: { column: 'email_address' } } },
    });
    const result = success(plan(from, to));
    const rendered = result.plan.renderTypeScript(workspaceMigrationModule.sqlite);
    expect(rendered).toContain('...this.renameTable({ table: "users", to: "app_users" })');
    expect(rendered).toContain(
      '...this.renameColumn({ table: "app_users", column: "email", to: "email_address" })',
    );
    const serializer = new SqliteContractSerializer();
    const startJson = serializer.serializeContract(from) as never;
    const endJson = serializer.serializeContract(to) as never;
    class HandWritten extends SqliteMigration {
      override readonly startContractJson = startJson;
      override readonly endContractJson = endJson;
      override get operations() {
        return [
          ...this.renameTable({ table: 'users', to: 'app_users' }),
          ...this.renameColumn({ table: 'app_users', column: 'email', to: 'email_address' }),
        ];
      }
    }
    expect(await Promise.all(new HandWritten(stack).operations)).toEqual(
      await Promise.all(result.plan.operations),
    );
  });
});
