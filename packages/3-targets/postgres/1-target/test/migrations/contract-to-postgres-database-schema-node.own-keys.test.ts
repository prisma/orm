import { coreHash, profileHash } from '@internal/contract/types';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { namingOfLiveName } from '@internal/sql-schema-ir/naming';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { contractToPostgresDatabaseSchemaNode } from '../../src/core/migrations/contract-to-postgres-database-schema-node';
import { PostgresRlsEnablement } from '../../src/core/postgres-rls-enablement';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { type PostgresContract, PostgresSchema } from '../../src/core/postgres-schema';
import { postgresTypeLookups } from '../postgres-type-lookups';

function contractWithPolicyOn(
  tableName: string,
  tables: Record<string, StorageTable>,
): PostgresContract {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('policy-on-table'),
    storage: new SqlStorage({
      storageHash: coreHash('policy-on-table'),
      namespaces: {
        public: new PostgresSchema({
          id: 'public',
          entries: {
            table: tables,
            policy: {
              own_rows: new PostgresRlsPolicy({
                naming: namingOfLiveName('own_rows'),
                tableName,
                namespaceId: 'public',
                operation: 'select',
                roles: ['authenticated'],
                using: 'true',
                permissive: true,
                withCheck: undefined,
              }),
            },
            rls: Object.fromEntries([
              [tableName, new PostgresRlsEnablement({ tableName, namespaceId: 'public' })],
            ]),
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

const options = {
  annotationNamespace: 'pg',
  dataTypeLookup: postgresTypeLookups.dataTypeLookup,
  codecLookup: postgresTypeLookups.codecLookup,
};

describe('contractToPostgresDatabaseSchemaNode, a policy on a table named like a property every object has', () => {
  it('is refused as a policy on a table the namespace does not have, for a missing table named constructor', () => {
    expect(() =>
      contractToPostgresDatabaseSchemaNode(contractWithPolicyOn('constructor', {}), options),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.POLICY_INVALID',
        meta: expect.objectContaining({ tableName: 'constructor', reason: 'table-missing' }),
      }),
    );
  });

  it('is accepted for a declared table named __proto__', () => {
    const table = new StorageTable({
      columns: { id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false } },
      primaryKey: { columns: ['id'] },
      foreignKeys: [],
      uniques: [],
      indexes: [],
    });
    const database = contractToPostgresDatabaseSchemaNode(
      contractWithPolicyOn('__proto__', Object.fromEntries([['__proto__', table]])),
      options,
    );
    const tables = database.namespaces['public']?.tables ?? {};
    expect(
      Object.entries(tables).map(([name, node]) => ({
        name,
        rlsEnabled: node.rlsEnabled,
        policies: node.policies.length,
      })),
    ).toEqual([{ name: '__proto__', rlsEnabled: true, policies: 1 }]);
  });
});
