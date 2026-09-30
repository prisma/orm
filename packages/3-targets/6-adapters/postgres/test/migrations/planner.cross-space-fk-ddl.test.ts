/**
 * Planner emits correct REFERENCES DDL for cross-space FKs.
 *
 * The live path is issue-planner → AddForeignKeyCall → addForeignKey() →
 * renderForeignKeySql() which reads fk.references.schema (the target
 * namespace) and is correct.
 *
 * These tests pin the correct path's output for both qualified (named target
 * namespace) and unqualified (__unbound__ target namespace) cross-space FKs,
 * and add a local-FK regression guard.
 */
import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY, type SqlMigrationPlanOperation } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { createPostgresMigrationPlanner } from '@internal/target-postgres/planner';
import {
  PostgresDatabaseSchemaNode,
  PostgresNamespaceSchemaNode,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../../src/core/control-adapter';

const testAdapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());

const emptySchema = new PostgresDatabaseSchemaNode({
  namespaces: {
    public: new PostgresNamespaceSchemaNode({
      schemaName: 'public',
      tables: {},
    }),
  },
  pgVersion: '',
  roles: [],
  existingSchemas: [],
});

/**
 * Build a contract with a Profile table in the unbound (public) namespace
 * that has a FK to a target in the given namespace and table.
 */
function buildCrossSpaceFkContract(targetNamespaceId: string): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('cross-space-fk-ddl'),
    storage: new SqlStorage({
      storageHash: coreHash('cross-space-fk-ddl'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              profile: {
                columns: {
                  id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                  user_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [
                  {
                    source: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'profile',
                      columns: ['user_id'],
                    },
                    target: {
                      namespaceId: asNamespaceId(targetNamespaceId),
                      tableName: 'users',
                      columns: ['id'],
                      spaceId: 'supabase',
                    },
                    constraint: true,
                    index: false,
                  },
                ],
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

/**
 * Build a contract with a local (same-namespace) FK from post.user_id → user.id.
 * Used as a regression guard — local-FK DDL must be unchanged.
 */
function buildLocalFkContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('local-fk-regression'),
    storage: new SqlStorage({
      storageHash: coreHash('local-fk-regression'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              user: {
                columns: {
                  id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
              post: {
                columns: {
                  id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                  user_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [
                  {
                    source: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'post',
                      columns: ['user_id'],
                    },
                    target: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'user',
                      columns: ['id'],
                    },
                    constraint: true,
                    index: false,
                  },
                ],
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

async function planAndGetFkExecuteSql(contract: Contract<SqlStorage>): Promise<string> {
  const planner = createPostgresMigrationPlanner(testAdapter);
  const result = planner.plan({
    contract,
    schema: emptySchema,
    policy: INIT_ADDITIVE_POLICY,
    fromContract: null,
    frameworkComponents: [],
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });

  expect(result.kind).toBe('success');
  if (result.kind !== 'success') throw new Error('Expected success');

  const ops = (await Promise.all(result.plan.operations)) as SqlMigrationPlanOperation<unknown>[];
  const fkOp = ops.find((op) => op.id.startsWith('foreignKey.'));
  expect(fkOp).toBeDefined();

  return fkOp!.execute[0]!.sql;
}

describe('PostgresMigrationPlanner — cross-space FK REFERENCES DDL (AC3)', () => {
  it('emits qualified REFERENCES "auth"."users"("id") for a named target namespace', async () => {
    const sql = await planAndGetFkExecuteSql(buildCrossSpaceFkContract('auth'));
    expect(sql).toContain('REFERENCES "auth"."users" ("id")');
  });

  it('emits unqualified REFERENCES "users"("id") for an __unbound__ target namespace', async () => {
    const sql = await planAndGetFkExecuteSql(buildCrossSpaceFkContract(UNBOUND_NAMESPACE_ID));
    expect(sql).toContain('REFERENCES "users" ("id")');
    expect(sql).not.toContain('"__unbound__"');
  });

  it('regression: local same-namespace FK emits correct unqualified REFERENCES', async () => {
    const sql = await planAndGetFkExecuteSql(buildLocalFkContract());
    expect(sql).toContain('ALTER TABLE "post"');
    expect(sql).toContain('FOREIGN KEY ("user_id")');
    expect(sql).toContain('REFERENCES "user" ("id")');
    expect(sql).not.toContain('"__unbound__"');
  });
});
