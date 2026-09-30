import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { createPostgresMigrationPlanner } from '@internal/target-postgres/planner';
import {
  PostgresDatabaseSchemaNode,
  PostgresNamespaceSchemaNode,
  PostgresTableSchemaNode,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../../src/core/control-adapter';

const RECONCILIATION_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const WIDENING_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening'],
};

describe('PostgresMigrationPlanner - reconciliation planning', () => {
  const planner = createPostgresMigrationPlanner(
    new PostgresControlAdapter(createPostgresBuiltinCodecLookup()),
  );

  it('plans destructive drop for extra column when policy allows destructive', async () => {
    const contract = createContract({
      user: {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const schema = new PostgresDatabaseSchemaNode({
      namespaces: {
        public: new PostgresNamespaceSchemaNode({
          schemaName: 'public',
          tables: {
            user: new PostgresTableSchemaNode({
              name: 'user',
              columns: {
                id: { name: 'id', nativeType: 'uuid', nullable: false },
                email: { name: 'email', nativeType: 'text', nullable: false },
                legacyEmail: { name: 'legacyEmail', nativeType: 'text', nullable: true },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              foreignKeys: [],
              indexes: [],
              policies: [],
              rlsEnabled: false,
            }),
          },
        }),
      },
      pgVersion: '',
      roles: [],
      existingSchemas: [],
    });

    const result = planner.plan({
      contract,
      schema,
      policy: RECONCILIATION_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`expected planner success, got: ${JSON.stringify(result)}`);
    }
    expect(await Promise.all(result.plan.operations)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'dropColumn.user.legacyEmail',
          operationClass: 'destructive',
        }),
      ]),
    );
  });

  it('plans widening operation for nullability relaxation when policy allows widening', async () => {
    const contract = createContract({
      user: {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          email: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const schema = new PostgresDatabaseSchemaNode({
      namespaces: {
        public: new PostgresNamespaceSchemaNode({
          schemaName: 'public',
          tables: {
            user: new PostgresTableSchemaNode({
              name: 'user',
              columns: {
                id: { name: 'id', nativeType: 'uuid', nullable: false },
                email: { name: 'email', nativeType: 'text', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              foreignKeys: [],
              indexes: [],
              policies: [],
              rlsEnabled: false,
            }),
          },
        }),
      },
      pgVersion: '',
      roles: [],
      existingSchemas: [],
    });

    const result = planner.plan({
      contract,
      schema,
      policy: WIDENING_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`expected planner success, got: ${JSON.stringify(result)}`);
    }
    expect(await Promise.all(result.plan.operations)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'alterNullability.dropNotNull.user.email',
          operationClass: 'widening',
        }),
      ]),
    );
  });

  it('returns conflict when destructive operation is required but policy forbids it', () => {
    const contract = createContract({
      user: {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const schema = new PostgresDatabaseSchemaNode({
      namespaces: {
        public: new PostgresNamespaceSchemaNode({
          schemaName: 'public',
          tables: {
            user: new PostgresTableSchemaNode({
              name: 'user',
              columns: {
                id: { name: 'id', nativeType: 'uuid', nullable: false },
                legacyEmail: { name: 'legacyEmail', nativeType: 'text', nullable: true },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              foreignKeys: [],
              indexes: [],
              policies: [],
              rlsEnabled: false,
            }),
          },
        }),
      },
      pgVersion: '',
      roles: [],
      existingSchemas: [],
    });

    const result = planner.plan({
      contract,
      schema,
      policy: WIDENING_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result).toMatchObject({
      kind: 'failure',
      conflicts: [expect.objectContaining({ kind: 'missingButNonAdditive' })],
    });
  });
});

function createContract(
  tables: Record<string, import('@internal/sql-contract/types').StorageTableInput>,
): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: coreHash('reconciliation-contract'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: tables },
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
