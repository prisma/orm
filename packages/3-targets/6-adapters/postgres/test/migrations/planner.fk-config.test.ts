import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import {
  contractToPostgresDatabaseSchemaNode,
  createPostgresMigrationPlanner,
} from '@internal/target-postgres/planner';
import {
  type PostgresContract,
  PostgresDatabaseSchemaNode,
  PostgresNamespaceSchemaNode,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../../src/core/control-adapter';

// FK1: `constraint`/`index` are authoring-time booleans materialized once at
// `contract emit` (`buildSqlContractFromDefinition`) — a persisted contract
// never carries them. These fixtures build a contract directly (bypassing
// authoring), so each case constructs the *already-materialized* shape a
// real emitted contract would have: a dropped constraint means no
// `foreignKeys[]` entry at all, and a backing index (if any) is its own
// named `indexes[]` entry, independent of whether the FK entry exists.
function createFkTestContract(fkConfig: {
  includeFk: boolean;
  includeIndex: boolean;
}): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: coreHash('contract'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
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
              post: {
                columns: {
                  id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                  userId: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                  title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: fkConfig.includeIndex
                  ? [{ columns: ['userId'], name: 'post_userId_idx' }]
                  : [],
                foreignKeys: fkConfig.includeFk
                  ? [
                      {
                        source: {
                          namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                          tableName: 'post',
                          columns: ['userId'],
                        },
                        target: {
                          namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                          tableName: 'user',
                          columns: ['id'],
                        },
                      },
                    ]
                  : [],
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

const MIGRATION_PLAN_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
} as const;

describe('PostgresMigrationPlanner - materialized FK/index combinations', () => {
  const planner = createPostgresMigrationPlanner(
    new PostgresControlAdapter(createPostgresBuiltinCodecLookup()),
  );

  it('plans both the FK constraint and its backing index when both are present in the contract', async () => {
    const contract = createFkTestContract({ includeFk: true, includeIndex: true });
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

    const operationIds = (await Promise.all(result.plan.operations)).map((op) => op.id);
    expect(operationIds).toContain('foreignKey.post.post_userId_fkey');
    expect(operationIds).toContain('index.post.post_userId_idx');
  });

  it('plans the FK constraint alone when the contract carries no backing index', async () => {
    const contract = createFkTestContract({ includeFk: true, includeIndex: false });
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

    const operationIds = (await Promise.all(result.plan.operations)).map((op) => op.id);
    expect(operationIds).toContain('foreignKey.post.post_userId_fkey');
    expect(operationIds).not.toContain('index.post.post_userId_idx');
  });

  it('plans the backing index alone when the contract carries no FK constraint entry', async () => {
    const contract = createFkTestContract({ includeFk: false, includeIndex: true });
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

    const operationIds = (await Promise.all(result.plan.operations)).map((op) => op.id);
    expect(operationIds).not.toContain('foreignKey.post.post_userId_fkey');
    expect(operationIds).toContain('index.post.post_userId_idx');
  });

  it('plans neither when the contract carries no FK constraint entry and no index', async () => {
    const contract = createFkTestContract({ includeFk: false, includeIndex: false });
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

    const operationIds = (await Promise.all(result.plan.operations)).map((op) => op.id);
    expect(operationIds).not.toContain('foreignKey.post.post_userId_fkey');
    expect(operationIds).not.toContain('index.post.post_userId_idx');
  });

  it('does not plan a destructive drop for a constraintless FK in offline from-contract schema', async () => {
    const fromContract = createWorkflowStateContract({
      storageHash: coreHash('from'),
      includeStateColumn: false,
    });
    const contract = createWorkflowStateContract({
      storageHash: coreHash('to'),
      includeStateColumn: true,
    });
    const schema = contractToPostgresDatabaseSchemaNode(fromContract, {
      annotationNamespace: 'pg',
    });

    const result = planner.plan({
      contract,
      schema,
      policy: MIGRATION_PLAN_POLICY,
      fromContract,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('Expected success');

    const ops = await Promise.all(result.plan.operations);
    const operationIds = ops.map((op) => op.id);
    expect(operationIds).toContain('column.__unbound__.workflow_states.state');
    expect(operationIds).not.toContain('dropConstraint.workflow_states.fk(workflow_id)');
    expect(ops).not.toContainEqual(
      expect.objectContaining({
        operationClass: 'destructive',
        label: expect.stringContaining('fk(workflow_id)'),
      }),
    );
  });
});

function createWorkflowStateContract(options: {
  storageHash: ReturnType<typeof coreHash>;
  includeStateColumn: boolean;
}): PostgresContract {
  const workflowStateColumns = {
    workflow_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
    team_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
    ...(options.includeStateColumn
      ? { state: { nativeType: 'jsonb', codecId: 'pg/json@1', nullable: true } }
      : {}),
  };

  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: options.storageHash,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              teams: {
                columns: {
                  id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
              workflows: {
                columns: {
                  id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                  team_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                },
                primaryKey: { columns: ['id', 'team_id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [
                  {
                    source: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'workflows',
                      columns: ['team_id'],
                    },
                    target: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'teams',
                      columns: ['id'],
                    },
                  },
                ],
              },
              workflow_states: {
                columns: workflowStateColumns,
                uniques: [],
                // FK1: the first FK below is `constraint: false` — logical
                // relation only, no physical constraint — so it contributes
                // no `foreignKeys[]` entry, just its `index: true` backing
                // index, declared here directly.
                indexes: [{ columns: ['workflow_id'], name: 'workflow_states_workflow_id_idx' }],
                foreignKeys: [
                  {
                    source: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'workflow_states',
                      columns: ['workflow_id', 'team_id'],
                    },
                    target: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'workflows',
                      columns: ['id', 'team_id'],
                    },
                    name: 'workflow_states_workflow_team_id_fkey',
                    onDelete: 'cascade',
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
