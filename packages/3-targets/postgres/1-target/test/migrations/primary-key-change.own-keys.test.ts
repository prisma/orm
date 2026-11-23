import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { SqlStorage, StorageTable, type StorageTableInput } from '@internal/sql-contract/types';
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
const int4 = { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false } as const;
const ref = (table: string, columns: readonly string[]) => ({
  namespaceId: asNamespaceId('public'),
  tableName: table,
  columns: [...columns],
});

function contractOf(tables: Record<string, StorageTableInput>, seed: string): Contract<SqlStorage> {
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
            table: Object.fromEntries(
              Object.entries(tables).map(([name, spec]) => [name, new StorageTable(spec)]),
            ),
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

const user = (primaryKey: readonly string[]): StorageTableInput => ({
  columns: { id: int4, email: int4 },
  primaryKey: { columns: [...primaryKey] },
  uniques: [{ columns: ['id'] }],
  indexes: [],
  foreignKeys: [],
});
const referencing: StorageTableInput = {
  columns: { id: int4, userId: int4 },
  primaryKey: { columns: ['id'] },
  uniques: [],
  indexes: [],
  foreignKeys: [
    { source: ref('constructor', ['userId']), target: ref('user', ['id']), name: 'ctor_user_fkey' },
  ],
};

describe('a primary key change referenced from a table named constructor', () => {
  it('says the contract does not declare that table, when it does not', () => {
    const before = contractOf({ user: user(['id']), constructor: referencing }, 'before');
    const after = contractOf({ user: user(['id', 'email']) }, 'after');
    const result = createPostgresMigrationPlanner(stubLowerer).plan({
      contract: after,
      schema: postgresContractToSchema(before, postgresTypeComponents),
      policy: { allowedOperationClasses: ['additive'] },
      fromContract: before,
      origin: null,
      statements: [],
      frameworkComponents: postgresTypeComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    expect(result.kind === 'failure' ? result.conflicts.map(({ summary }) => summary) : []).toEqual(
      [
        'Primary key "user_pkey" on "public"."user" cannot change while foreign key "ctor_user_fkey" on "public"."constructor" references it, and the contract does not declare "public"."constructor".',
      ],
    );
  });
});
