import { coreHash, profileHash } from '@internal/contract/types';
import { SqlStorage } from '@internal/sql-contract/types';
import { namingOfLiveName } from '@internal/sql-schema-ir/naming';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { contractToPostgresDatabaseSchemaNode } from '../../src/core/migrations/contract-to-postgres-database-schema-node';
import { PostgresRlsEnablement } from '../../src/core/postgres-rls-enablement';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { type PostgresContract, PostgresSchema } from '../../src/core/postgres-schema';
import { postgresTypeLookups } from '../postgres-type-lookups';

describe('contractToPostgresDatabaseSchemaNode, a policy on a missing table named constructor', () => {
  it('is refused as a policy on a table the namespace does not have', () => {
    const contract: PostgresContract = {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('policy-on-constructor'),
      storage: new SqlStorage({
        storageHash: coreHash('policy-on-constructor'),
        namespaces: {
          public: new PostgresSchema({
            id: 'public',
            entries: {
              table: {},
              policy: {
                own_rows: new PostgresRlsPolicy({
                  naming: namingOfLiveName('own_rows'),
                  tableName: 'constructor',
                  namespaceId: 'public',
                  operation: 'select',
                  roles: ['authenticated'],
                  using: 'true',
                  permissive: true,
                  withCheck: undefined,
                }),
              },
              rls: {
                constructor: new PostgresRlsEnablement({
                  tableName: 'constructor',
                  namespaceId: 'public',
                }),
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
    expect(() =>
      contractToPostgresDatabaseSchemaNode(contract, {
        annotationNamespace: 'pg',
        dataTypeLookup: postgresTypeLookups.dataTypeLookup,
        codecLookup: postgresTypeLookups.codecLookup,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.POLICY_INVALID',
        meta: expect.objectContaining({ tableName: 'constructor', reason: 'table-missing' }),
      }),
    );
  });
});
