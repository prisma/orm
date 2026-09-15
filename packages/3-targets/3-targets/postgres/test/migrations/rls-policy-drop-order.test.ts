/**
 * Reproduction for https://github.com/prisma/orm/issues/30226: when one
 * contract change drops a column AND an RLS policy whose `using` expression
 * references that column, the planner must emit the policy drop before the
 * column drop — Postgres refuses `DROP COLUMN` while a policy depends on
 * it (2BP01).
 */

import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { namingOfLiveName, parseNaming } from '@internal/sql-schema-ir/naming';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { PostgresRlsEnablement } from '../../src/core/postgres-rls-enablement';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresPolicySchemaNode } from '../../src/core/schema-ir/postgres-policy-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';

const stubLowerer: ExecuteRequestLowerer = {
  lower(_ast, _ctx) {
    return { sql: 'DROP POLICY stub', params: [] };
  },
  async lowerToExecuteRequest(_ast, _ctx) {
    return { sql: 'DROP POLICY stub', params: [] };
  },
};

const TABLE = 'note';
const POLICY_NAME = 'note_public_read_443ba5fa';
const USING = 'published = true';

function buildContract(
  columns: Record<string, { nativeType: string; codecId: string; nullable: boolean }>,
  withPolicy: boolean,
): Contract<SqlStorage> {
  const policy = new PostgresRlsPolicy({
    naming: namingOfLiveName(POLICY_NAME),
    tableName: TABLE,
    namespaceId: 'public',
    operation: 'select',
    roles: ['anon', 'authenticated'],
    using: USING,
    permissive: true,
    withCheck: undefined,
  });
  const schema = new PostgresSchema({
    id: 'public',
    entries: {
      table: {
        [TABLE]: new StorageTable({
          columns,
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      ...(withPolicy ? { policy: { [POLICY_NAME]: policy } } : {}),
      rls: {
        [TABLE]: new PostgresRlsEnablement({ tableName: TABLE, namespaceId: 'public' }),
      },
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('rls-policy-drop-order'),
    storage: new SqlStorage({
      storageHash: coreHash('rls-policy-drop-order'),
      namespaces: { public: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

/** Live schema: the old world, with the column and the policy still present. */
function liveSchema(): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          [TABLE]: new PostgresTableSchemaNode({
            name: TABLE,
            columns: {
              id: { name: 'id', nativeType: 'uuid', nullable: false },
              title: { name: 'title', nativeType: 'text', nullable: false },
              published: { name: 'published', nativeType: 'bool', nullable: false },
            },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: [
              new PostgresPolicySchemaNode({
                naming: parseNaming(POLICY_NAME, undefined),
                tableName: TABLE,
                namespaceId: 'public',
                operation: 'select',
                roles: ['anon', 'authenticated'],
                using: USING,
                withCheck: undefined,
                permissive: true,
                dependsOn: undefined,
              }),
            ],
            rlsEnabled: true,
          }),
        },
      }),
    },
    roles: [],
    existingSchemas: ['public'],
    pgVersion: 'unknown',
  });
}

const FULL_COLUMNS = {
  id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
  title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
  published: { nativeType: 'bool', codecId: 'pg/bool@1', nullable: false },
};
const TRIMMED_COLUMNS = {
  id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
  title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
};

const DB_UPDATE_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

describe('RLS policy drop vs column drop ordering (prisma/orm#30226)', () => {
  it('drops the policy before the column it references', async () => {
    const planner = createPostgresMigrationPlanner(stubLowerer);
    const result = planner.plan({
      contract: buildContract(TRIMMED_COLUMNS, false),
      fromContract: buildContract(FULL_COLUMNS, true),
      schema: liveSchema(),
      policy: DB_UPDATE_POLICY,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    const ops = await Promise.all(result.plan.operations);
    const opIds = ops.map((op) => op.id);
    const dropPolicyIdx = opIds.findIndex(
      (id) => id.startsWith('rlsPolicy.') && id.endsWith('.drop'),
    );
    const dropColumnIdx = opIds.findIndex((id) => id.startsWith('dropColumn.'));

    expect(dropPolicyIdx).toBeGreaterThanOrEqual(0);
    expect(dropColumnIdx).toBeGreaterThanOrEqual(0);
    expect(dropPolicyIdx).toBeLessThan(dropColumnIdx);
  });
});
