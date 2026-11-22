import { type Contract, type ControlPolicy, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import { introspectedColumn, postgresTypeComponents } from '../postgres-type-lookups';

const stubLowerer: ExecuteRequestLowerer = {
  lower(_ast, _ctx) {
    return { sql: 'stub', params: [] };
  },
  renderColumnDefault: async () => '',
  async lowerToExecuteRequest(_ast, _ctx) {
    return { sql: 'stub', params: [] };
  },
};

const DESTRUCTIVE_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

interface ContractOptions {
  readonly namespaceId?: string;
  readonly extraColumn?: string;
  readonly control?: ControlPolicy;
  readonly extraTables?: readonly string[];
}

function storageTable(
  extraColumn: string | undefined,
  control: ControlPolicy | undefined,
  tableName: string,
) {
  return new StorageTable({
    columns: {
      id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
      email: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
      ...(extraColumn === undefined
        ? {}
        : { [extraColumn]: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: true } }),
    },
    primaryKey: { columns: ['id'], name: `${tableName}_pkey` },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    ...(control === undefined ? {} : { control }),
  });
}

function contractWithTable(
  tableName: string,
  {
    namespaceId = UNBOUND_NAMESPACE_ID,
    extraColumn,
    control,
    extraTables = [],
  }: ContractOptions = {},
): Contract<SqlStorage> {
  const schema = postgresCreateNamespace({
    id: namespaceId,
    entries: {
      table: {
        [tableName]: storageTable(extraColumn, control, tableName),
        ...Object.fromEntries(
          extraTables.map((name) => [name, storageTable(undefined, undefined, name)]),
        ),
      },
      policy: {},
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('table-name-case-guard-test'),
    storage: new SqlStorage({
      storageHash: coreHash('table-name-case-guard-test'),
      namespaces: { [namespaceId]: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function liveTable(tableName: string): PostgresTableSchemaNode {
  return new PostgresTableSchemaNode({
    name: tableName,
    columns: {
      id: introspectedColumn({ name: 'id', typeText: 'int4', nullable: false }),
      email: introspectedColumn({ name: 'email', typeText: 'text', nullable: false }),
    },
    primaryKey: { columns: ['id'], name: `${tableName}_pkey` },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    policies: [],
    rlsEnabled: false,
  });
}

function liveSchema(
  tableNames: readonly string[],
  schemaName = 'public',
): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    extensions: undefined,
    namespaces: {
      [schemaName]: new PostgresNamespaceSchemaNode({
        schemaName,
        tables: Object.fromEntries(tableNames.map((name) => [name, liveTable(name)])),
      }),
    },
    roles: [],
    existingSchemas: [schemaName],
    pgVersion: 'unknown',
  });
}

function planFromLive(
  previousTables: readonly string[],
  nextTable: string,
  options: ContractOptions & { readonly schemaName?: string } = {},
) {
  const planner = createPostgresMigrationPlanner(stubLowerer);
  return () =>
    planner.plan({
      contract: contractWithTable(nextTable, options),
      schema: liveSchema(previousTables, options.schemaName),
      policy: DESTRUCTIVE_POLICY,
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents: postgresTypeComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
}

async function planIds(
  previousTables: readonly string[],
  nextTable: string,
  options: ContractOptions & { readonly schemaName?: string } = {},
): Promise<readonly string[]> {
  const result = planFromLive(previousTables, nextTable, options)();
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  return (await Promise.all(result.plan.operations)).map((op) => op.id);
}

describe('Postgres planner with names every object has as a property', () => {
  it('creates a table named constructor the database does not have', async () => {
    expect([...(await planIds(['users'], 'constructor'))].sort()).toEqual([
      'dropTable.users',
      'table.constructor',
    ]);
  });

  it('drops a table named toString the contract does not have', async () => {
    expect([...(await planIds(['toString'], 'users'))].sort()).toEqual([
      'dropTable.toString',
      'table.users',
    ]);
  });

  it('adds a column named constructor the table does not have', async () => {
    expect(await planIds(['users'], 'users', { extraColumn: 'constructor' })).toEqual([
      expect.stringContaining('constructor'),
    ]);
  });

  it('creates the tables of a schema named constructor the database does not have', async () => {
    expect(
      await planIds([], 'users', { namespaceId: 'constructor', schemaName: 'public' }),
    ).toEqual(expect.arrayContaining(['table.users']));
  });
});
