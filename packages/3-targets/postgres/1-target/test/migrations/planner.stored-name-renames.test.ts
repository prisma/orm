import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import {
  APP_SPACE_ID,
  type ControlStack,
  planOriginOf,
  type ResolvedFieldRenameStatement,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf, workspaceMigrationModule } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import type { PostgresPlanTargetDetails } from '../../src/core/migrations/planner-target-details';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import { PostgresMigration } from '../../src/core/migrations/postgres-migration';
import { PostgresContractSerializer } from '../../src/core/postgres-contract-serializer';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';
import { postgresTypeComponents } from '../postgres-type-lookups';
import { stubLowerer } from './rename-table-fixtures';

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;
type ContractJson = { readonly storage: { readonly storageHash: string } };

const ALL_CLASSES = { allowedOperationClasses: ['additive', 'widening', 'destructive'] as const };
const NS = asNamespaceId(UNBOUND_NAMESPACE_ID);

const stack = {
  adapter: {
    ...postgresTypeComponents[0],
    create: () => stubLowerer as unknown as SqlControlAdapter<'postgres'>,
  },
  target: { kind: 'target', familyId: 'sql', targetId: 'postgres' },
  extensions: [],
} as unknown as ControlStack<'sql', 'postgres'>;

interface ColumnSpec {
  readonly column: string;
  readonly type?: 'int4' | 'int8';
  readonly nullable?: boolean;
}

/** Model `User` in `table`, with an `id` primary key and a field per entry of `fields`. */
function userContract(
  seed: string,
  table: string,
  fields: Readonly<Record<string, ColumnSpec>>,
): Contract<SqlStorage> {
  const all: Readonly<Record<string, ColumnSpec>> = { id: { column: 'id' }, ...fields };
  const storageColumn = ({ type = 'int4', nullable = false }: ColumnSpec) => ({
    dataType: `pg/${type}`,
    codecId: `pg/${type}@1`,
    nullable,
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(seed),
    storage: new SqlStorage({
      storageHash: coreHash(seed),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              [table]: new StorageTable({
                columns: Object.fromEntries(
                  Object.values(all).map((spec) => [spec.column, storageColumn(spec)]),
                ),
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
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
            Object.entries(all).map(([field, { type = 'int4', nullable = false }]) => [
              field,
              { nullable, type: { kind: 'scalar', codecId: `pg/${type}@1` } },
            ]),
          ),
          relations: {},
          storage: {
            table,
            namespaceId: UNBOUND_NAMESPACE_ID,
            fields: Object.fromEntries(
              Object.entries(all).map(([field, { column }]) => [field, { column }]),
            ),
          },
        },
      },
    }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function plan(
  from: Contract<SqlStorage>,
  to: Contract<SqlStorage>,
  statements: readonly ResolvedMigrationStatement[] = [],
) {
  const result = createPostgresMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: postgresContractToSchema(from, postgresTypeComponents),
    policy: ALL_CLASSES,
    fromContract: from,
    origin: planOriginOf(from),
    statements,
    frameworkComponents: postgresTypeComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  return result;
}

async function labelsOf(result: ReturnType<typeof plan>): Promise<readonly string[]> {
  return (await Promise.all(result.plan.operations)).map((op) => op.label);
}

function jsonOf(contract: Contract<SqlStorage>): ContractJson {
  return new PostgresContractSerializer().serializeContract(contract) as unknown as ContractJson;
}

const email = { column: 'email' };

describe('Postgres planner, a table or column whose model or field keeps its name', () => {
  it('renames the table and its primary key, with no statement applied and nothing to ask', async () => {
    const result = plan(
      userContract('from', 'users', { email }),
      userContract('to', 'app_users', { email }),
    );
    expect(await labelsOf(result)).toEqual([
      'Rename table "users" to "app_users"',
      'Rename primary key "users_pkey" to "app_users_pkey" on "app_users"',
    ]);
    expect(result.appliedStatements).toEqual([]);
    expect(result.dataLoss).toEqual([]);
  });

  it('renames the column of a field whose @map changes', async () => {
    const result = plan(
      userContract('from', 'users', { email }),
      userContract('to', 'users', { email: { column: 'email_address' } }),
    );
    expect(await labelsOf(result)).toEqual(['Rename column "users"."email" to "email_address"']);
    expect(result.dataLoss).toEqual([]);
  });

  it('alters the type and nullability of a renamed column in place of a drop and add', async () => {
    const result = plan(
      userContract('from', 'users', { age: { column: 'age' } }),
      userContract('to', 'app_users', {
        age: { column: 'age_years', type: 'int8', nullable: true },
      }),
    );
    expect(await labelsOf(result)).toEqual([
      'Rename table "users" to "app_users"',
      'Rename primary key "users_pkey" to "app_users_pkey" on "app_users"',
      'Rename column "app_users"."age" to "age_years"',
      'Alter type of "app_users"."age_years" to int8',
      'Drop NOT NULL on "app_users"."age_years"',
    ]);
  });

  it('asks about a column dropped from a renamed table by the field of the origin model', async () => {
    const result = plan(
      userContract('from', 'users', { email, name: { column: 'name' } }),
      userContract('to', 'app_users', { email }),
    );
    expect(await labelsOf(result)).toEqual([
      'Rename table "users" to "app_users"',
      'Rename primary key "users_pkey" to "app_users_pkey" on "app_users"',
      'Drop column "name" from "app_users"',
    ]);
    expect(result.dataLoss.map(({ subject }) => subject)).toEqual([
      { kind: 'field', namespaceId: NS, model: 'User', field: 'name' },
    ]);
  });

  it('renames the table before a field statement renames a column on it', async () => {
    const statement: ResolvedFieldRenameStatement = {
      kind: 'rename',
      entity: 'field',
      from: { namespaceId: NS, model: 'User', field: 'name' },
      to: { namespaceId: NS, model: 'User', field: 'fullName' },
    };
    const result = plan(
      userContract('from', 'users', { name: { column: 'name' } }),
      userContract('to', 'app_users', { fullName: { column: 'full_name' } }),
      [statement],
    );
    expect(await labelsOf(result)).toEqual([
      'Rename table "users" to "app_users"',
      'Rename primary key "users_pkey" to "app_users_pkey" on "app_users"',
      'Rename column "app_users"."name" to "full_name"',
    ]);
    expect(result.appliedStatements).toEqual([{ statement, operationIndexes: [2] }]);
  });

  it('emits the same operations as the facade calls it renders, run against the same contracts', async () => {
    const from = userContract('a'.repeat(64), 'users', { email });
    const to = userContract('b'.repeat(64), 'app_users', { email: { column: 'email_address' } });
    const result = plan(from, to);
    const rendered = result.plan.renderTypeScript(workspaceMigrationModule.postgres);
    expect(rendered).toContain('...this.renameTable({ table: "users", to: "app_users" })');
    expect(rendered).toContain(
      '...this.renameColumn({ table: "app_users", column: "email", to: "email_address" })',
    );

    const startJson = jsonOf(from);
    const endJson = jsonOf(to);
    class HandWritten extends PostgresMigration {
      override readonly startContractJson = startJson;
      override readonly endContractJson = endJson;
      override get operations(): readonly Promise<Op>[] {
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
