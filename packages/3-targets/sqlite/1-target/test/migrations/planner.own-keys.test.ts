import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import { sqliteCreateNamespace } from '../../src/core/sqlite-unbound-database';
import { introspectedColumn, sqliteTestComponents } from '../sqlite-test-types';

const stubLowerer: ExecuteRequestLowerer = {
  lower: () => {
    throw new Error('lower() called on stubLowerer — planner must use lowerToExecuteRequest()');
  },
  renderColumnDefault: async () => '',
  lowerToExecuteRequest: async () => ({ sql: '', params: [] }),
};

const DESTRUCTIVE_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

interface ContractOptions {
  readonly extraColumn?: string;
  readonly indexedColumn?: string;
}

function contractWithTable(
  tableName: string,
  { extraColumn, indexedColumn }: ContractOptions = {},
): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash('table-name-case-guard-test'),
    storage: new SqlStorage({
      storageHash: coreHash('table-name-case-guard-test'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              [tableName]: {
                columns: {
                  id: { dataType: 'sqlite/integer', codecId: 'sqlite/integer@1', nullable: false },
                  email: { dataType: 'sqlite/text', codecId: 'sqlite/text@1', nullable: false },
                  ...(extraColumn === undefined
                    ? {}
                    : {
                        [extraColumn]: {
                          dataType: 'sqlite/text',
                          codecId: 'sqlite/text@1',
                          nullable: true,
                        },
                      }),
                },
                primaryKey: { columns: ['id'], name: `${tableName}_pkey` },
                uniques: [],
                indexes:
                  indexedColumn === undefined
                    ? []
                    : [{ columns: [indexedColumn], name: `${tableName}_${indexedColumn}_idx` }],
                foreignKeys: [],
              },
            },
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function liveSchema(tableNames: readonly string[]): SqlSchemaIR {
  return new SqlSchemaIR({
    tables: Object.fromEntries(
      tableNames.map((tableName) => [
        tableName,
        {
          name: tableName,
          columns: {
            id: introspectedColumn({ name: 'id', typeText: 'integer', nullable: false }),
            email: introspectedColumn({ name: 'email', typeText: 'text', nullable: false }),
          },
          primaryKey: { columns: ['id'], name: `${tableName}_pkey` },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      ]),
    ),
  });
}

function planFromLive(
  previousTables: readonly string[],
  nextTable: string,
  options: ContractOptions = {},
) {
  const planner = createSqliteMigrationPlanner(stubLowerer);
  return () =>
    planner.plan({
      contract: contractWithTable(nextTable, options),
      schema: liveSchema(previousTables),
      policy: DESTRUCTIVE_POLICY,
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents: sqliteTestComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
}

async function planIds(
  previousTables: readonly string[],
  nextTable: string,
  options: ContractOptions = {},
): Promise<readonly string[]> {
  const result = planFromLive(previousTables, nextTable, options)();
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  return (await Promise.all(result.plan.operations)).map((op) => op.id);
}

describe('SQLite planner with names every object has as a property', () => {
  it('creates an indexed table named constructor the database does not have', async () => {
    expect(
      [...(await planIds(['users'], 'constructor', { indexedColumn: 'email' }))].sort(),
    ).toEqual(['dropTable.users', 'index.constructor.constructor_email_idx', 'table.constructor']);
  });

  it('adds a column named constructor before the index that covers it', async () => {
    expect(
      await planIds(['users'], 'users', {
        extraColumn: 'constructor',
        indexedColumn: 'constructor',
      }),
    ).toEqual(['column.users.constructor', 'index.users.users_constructor_idx']);
  });
});
