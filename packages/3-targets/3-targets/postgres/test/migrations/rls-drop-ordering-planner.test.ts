/**
 * Where the planner puts RLS policy drops relative to structural DDL. Postgres refuses to drop a
 * column or change its type while a policy uses it, to drop a table that a policy on another table
 * uses, and to drop or rebuild a type that a policy uses. So when a plan contains such a statement,
 * its policy drops run just before it. Otherwise the plan keeps its usual order: structural DDL,
 * then index and check-constraint renames, then policy calls.
 *
 * The planner does not parse policy bodies, so the `using` text below only documents the dependency
 * each scenario is about.
 */

import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { CodecControlHooks } from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { APP_SPACE_ID, type MigrationOperationClass } from '@internal/framework-components/control';
import {
  indexInputFromSerialized,
  SqlStorage,
  StorageTable,
  type StorageTypeInstance,
} from '@internal/sql-contract/types';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { PostgresRlsEnablement } from '../../src/core/postgres-rls-enablement';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresNativeEnumSchemaNode } from '../../src/core/schema-ir/postgres-native-enum-schema-node';
import { PostgresPolicySchemaNode } from '../../src/core/schema-ir/postgres-policy-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';

const stubLowerer: ExecuteRequestLowerer = {
  lower: () => ({ sql: 'stub', params: [] }),
  lowerToExecuteRequest: async () => ({ sql: 'stub', params: [] }),
};

interface WireIndex {
  readonly prefix: string;
  readonly hash: string;
  readonly columns: readonly string[];
}

interface TableShape {
  readonly columns: Readonly<Record<string, string>>;
  readonly indexes?: readonly WireIndex[];
}

type Tables = Readonly<Record<string, TableShape>>;

const PROFILES: TableShape = { columns: { id: 'int4', user_id: 'int4' } };

function policyOn(tableName: string, name: string, using: string): PostgresRlsPolicy {
  return new PostgresRlsPolicy({
    naming: parseNaming(name, name.replace(/_[0-9a-f]{8}$/, '')),
    tableName,
    namespaceId: 'public',
    operation: 'select',
    roles: ['authenticated'],
    using,
    withCheck: undefined,
    permissive: true,
  });
}

function buildContract(
  tables: Tables,
  policies: readonly PostgresRlsPolicy[],
  types: Readonly<Record<string, StorageTypeInstance>> = {},
): Contract<SqlStorage> {
  const tableEntries: Record<string, StorageTable> = {};
  const rlsEntries: Record<string, PostgresRlsEnablement> = {};
  for (const [tableName, shape] of Object.entries(tables)) {
    tableEntries[tableName] = new StorageTable({
      columns: Object.fromEntries(
        Object.entries(shape.columns).map(([name, nativeType]) => [
          name,
          { nativeType, codecId: `pg/${nativeType}@1`, nullable: false },
        ]),
      ),
      primaryKey: { columns: ['id'] },
      foreignKeys: [],
      uniques: [],
      indexes: (shape.indexes ?? []).map((index) =>
        indexInputFromSerialized({
          name: `${index.prefix}_${index.hash}`,
          prefix: index.prefix,
          columns: index.columns,
          unique: false,
        }),
      ),
    });
    rlsEntries[tableName] = new PostgresRlsEnablement({ tableName, namespaceId: 'public' });
  }
  const policyEntries: Record<string, PostgresRlsPolicy> = {};
  for (const policy of policies) {
    policyEntries[policy.name] = policy;
  }
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('rls-drop-ordering-planner-test'),
    storage: new SqlStorage({
      storageHash: coreHash('rls-drop-ordering-planner-test'),
      types,
      namespaces: {
        public: new PostgresSchema({
          id: 'public',
          entries: { table: tableEntries, policy: policyEntries, rls: rlsEntries },
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

function livePolicy(policy: PostgresRlsPolicy): PostgresPolicySchemaNode {
  return new PostgresPolicySchemaNode({
    naming: parseNaming(policy.name, policy.prefix),
    tableName: policy.tableName,
    namespaceId: 'public',
    operation: policy.operation,
    roles: [...policy.roles],
    using: policy.using,
    withCheck: policy.withCheck,
    permissive: policy.permissive,
    dependsOn: undefined,
  });
}

function liveSchema(
  tables: Tables,
  policies: readonly PostgresRlsPolicy[],
  nativeEnums: readonly string[] = [],
): PostgresDatabaseSchemaNode {
  const tableNodes: Record<string, PostgresTableSchemaNode> = {};
  for (const [tableName, shape] of Object.entries(tables)) {
    tableNodes[tableName] = new PostgresTableSchemaNode({
      name: tableName,
      columns: Object.fromEntries(
        Object.entries(shape.columns).map(([name, nativeType]) => [
          name,
          { name, nativeType, nullable: false },
        ]),
      ),
      primaryKey: { columns: ['id'] },
      foreignKeys: [],
      uniques: [],
      indexes: (shape.indexes ?? []).map((index) => ({
        naming: parseNaming(`${index.prefix}_${index.hash}`, index.prefix),
        columns: index.columns,
        where: undefined,
        unique: false,
        partial: false,
        type: undefined,
        options: undefined,
        annotations: undefined,
        dependsOn: undefined,
      })),
      policies: policies.filter((policy) => policy.tableName === tableName).map(livePolicy),
      rlsEnabled: true,
    });
  }
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: tableNodes,
        nativeEnums: nativeEnums.map(
          (typeName) =>
            new PostgresNativeEnumSchemaNode({
              typeName,
              namespaceId: 'public',
              members: ['admin', 'member'],
            }),
        ),
      }),
    },
    roles: [],
    existingSchemas: ['public'],
    pgVersion: 'unknown',
  });
}

const APP_ROLE_CODEC_ID = 'app/role@1';

const APP_ROLE_TYPES: Readonly<Record<string, StorageTypeInstance>> = {
  app_role: {
    kind: 'codec-instance',
    codecId: APP_ROLE_CODEC_ID,
    nativeType: 'app_role',
    typeParams: { values: ['owner', 'member'] },
  },
};

interface CodecTypeOperation {
  readonly id: string;
  readonly operationClass: MigrationOperationClass;
  readonly sql: string;
}

function appRoleCodec(
  operation: CodecTypeOperation,
): TargetBoundComponentDescriptor<'sql', string> {
  const hooks: CodecControlHooks = {
    planTypeOperations: () => ({
      operations: [
        {
          id: operation.id,
          label: operation.id,
          operationClass: operation.operationClass,
          target: { id: 'postgres' },
          precheck: [],
          execute: [{ description: operation.id, sql: operation.sql }],
          postcheck: [],
        },
      ],
    }),
  };
  return {
    kind: 'adapter',
    id: 'app-role-codec',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.0-test',
    types: { codecTypes: { controlPlaneHooks: { [APP_ROLE_CODEC_ID]: hooks } } },
  };
}

interface PlanInputs {
  readonly fromContract?: Contract<SqlStorage> | null;
  readonly frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}

async function planOpIds(
  contract: Contract<SqlStorage>,
  schema: PostgresDatabaseSchemaNode,
  { fromContract = null, frameworkComponents = [] }: PlanInputs = {},
): Promise<readonly string[]> {
  const planner = createPostgresMigrationPlanner(stubLowerer);
  const result = planner.plan({
    contract,
    schema,
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    fromContract,
    frameworkComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') {
    throw new Error(`expected a plan, got ${JSON.stringify(result)}`);
  }
  const ops = await Promise.all(result.plan.operations);
  return ops.map((op) => op.id);
}

describe('policy drops run before structural DDL that the policy blocks', () => {
  it('drops a policy before dropping a column it uses', async () => {
    const readOwn = policyOn('profiles', 'p_read_11111111', '(auth.uid() = user_id)');
    const readPublished = policyOn('profiles', 'p_pub_22222222', '(published = true)');
    const contract = buildContract({ profiles: PROFILES }, [readOwn]);
    const schema = liveSchema(
      { profiles: { columns: { ...PROFILES.columns, published: 'bool' } } },
      [readOwn, readPublished],
    );

    expect(await planOpIds(contract, schema)).toEqual([
      'rlsPolicy.public.profiles.p_pub_22222222.drop',
      'dropColumn.profiles.published',
    ]);
  });

  it('drops a policy on another table before dropping a column the policy uses', async () => {
    const postsOfPublished = policyOn(
      'posts',
      'p_pub_22222222',
      '(exists (select 1 from profiles where profiles.published))',
    );
    const posts: TableShape = { columns: { id: 'int4', author_id: 'int4' } };
    const contract = buildContract({ profiles: PROFILES, posts }, []);
    const schema = liveSchema(
      { profiles: { columns: { ...PROFILES.columns, published: 'bool' } }, posts },
      [postsOfPublished],
    );

    expect(await planOpIds(contract, schema)).toEqual([
      'rlsPolicy.public.posts.p_pub_22222222.drop',
      'dropColumn.profiles.published',
    ]);
  });

  it('drops a policy before dropping another table the policy uses', async () => {
    const readTeams = policyOn('profiles', 'p_team_22222222', '(exists (select 1 from teams))');
    const contract = buildContract({ profiles: PROFILES }, []);
    const schema = liveSchema({ profiles: PROFILES, teams: { columns: { id: 'int4' } } }, [
      readTeams,
    ]);

    expect(await planOpIds(contract, schema)).toEqual([
      'rlsPolicy.public.profiles.p_team_22222222.drop',
      'dropTable.teams',
    ]);
  });

  describe('an edited policy that uses a column whose type changes', () => {
    const before = policyOn(
      'profiles',
      'p_read_11111111',
      "(user_id = current_setting('app.user_id')::int4)",
    );
    const after = policyOn(
      'profiles',
      'p_read_22222222',
      "(user_id = current_setting('app.user_id')::int8)",
    );
    const fromContract = buildContract({ profiles: PROFILES }, [before]);
    const contract = buildContract({ profiles: { columns: { id: 'int4', user_id: 'int8' } } }, [
      after,
    ]);
    const schema = liveSchema({ profiles: PROFILES }, [before]);
    const expected = [
      'rlsPolicy.public.profiles.p_read_11111111.drop',
      'alterType.profiles.user_id',
      'rlsPolicy.public.profiles.p_read_22222222',
    ];

    it('is dropped before the type change in a db update plan', async () => {
      expect(await planOpIds(contract, schema)).toEqual(expected);
    });

    it('is dropped before the type change in a migration plan', async () => {
      expect(await planOpIds(contract, schema, { fromContract })).toEqual(expected);
    });
  });

  it('drops a policy before dropping an enum type the policy casts to', async () => {
    const adminOnly = policyOn(
      'profiles',
      'p_admin_22222222',
      "(current_setting('app.role')::app_role = 'admin')",
    );
    const contract = buildContract({ profiles: PROFILES }, []);
    const schema = liveSchema({ profiles: PROFILES }, [adminOnly], ['app_role']);

    expect(await planOpIds(contract, schema)).toEqual([
      'rlsPolicy.public.profiles.p_admin_22222222.drop',
      'dropNativeEnumType.app_role',
    ]);
  });

  it('drops a policy before a codec operation that rebuilds a type the policy casts to', async () => {
    const before = policyOn(
      'profiles',
      'p_role_11111111',
      "(current_setting('app.role')::app_role = 'admin')",
    );
    const after = policyOn(
      'profiles',
      'p_role_22222222',
      "(current_setting('app.role')::app_role = 'owner')",
    );
    const contract = buildContract({ profiles: PROFILES }, [after], APP_ROLE_TYPES);
    const schema = liveSchema({ profiles: PROFILES }, [before]);
    const rebuild = appRoleCodec({
      id: 'type.app_role.rebuild',
      operationClass: 'destructive',
      sql: "DROP TYPE app_role; CREATE TYPE app_role AS ENUM ('owner', 'member')",
    });

    expect(await planOpIds(contract, schema, { frameworkComponents: [rebuild] })).toEqual([
      'rlsPolicy.public.profiles.p_role_11111111.drop',
      'type.app_role.rebuild',
      'rlsPolicy.public.profiles.p_role_22222222',
    ]);
  });
});

describe('plans without DDL that a policy blocks', () => {
  it('keeps index renames ahead of every policy call, drops included', async () => {
    const before = policyOn('profiles', 'p_read_11111111', '(auth.uid() = user_id)');
    const after = policyOn('profiles', 'p_read_22222222', '(auth.uid() = id)');
    const index = { hash: 'ab12cd34', columns: ['user_id'] };
    const contract = buildContract(
      {
        profiles: {
          ...PROFILES,
          indexes: [{ ...index, prefix: 'profiles_user_lookup' }],
        },
      },
      [after],
    );
    const schema = liveSchema(
      { profiles: { ...PROFILES, indexes: [{ ...index, prefix: 'profiles_user_idx' }] } },
      [before],
    );

    expect(await planOpIds(contract, schema)).toEqual([
      'index.public.profiles.profiles_user_idx_ab12cd34.rename',
      'rlsPolicy.public.profiles.p_read_22222222',
      'rlsPolicy.public.profiles.p_read_11111111.drop',
    ]);
  });

  it('keeps policy calls after an additive codec type operation', async () => {
    const before = policyOn(
      'profiles',
      'p_role_11111111',
      "(current_setting('app.role')::app_role = 'admin')",
    );
    const after = policyOn(
      'profiles',
      'p_role_22222222',
      "(current_setting('app.role')::app_role = 'owner')",
    );
    const contract = buildContract({ profiles: PROFILES }, [after], APP_ROLE_TYPES);
    const schema = liveSchema({ profiles: PROFILES }, [before]);
    const addValue = appRoleCodec({
      id: 'type.app_role.addValue',
      operationClass: 'additive',
      sql: "ALTER TYPE app_role ADD VALUE 'owner'",
    });

    expect(await planOpIds(contract, schema, { frameworkComponents: [addValue] })).toEqual([
      'type.app_role.addValue',
      'rlsPolicy.public.profiles.p_role_22222222',
      'rlsPolicy.public.profiles.p_role_11111111.drop',
    ]);
  });
});
