/**
 * Rewriting a quoted string as a `sql` literal can make its stored text canonical. The next
 * `migration plan` compares the previous contract with the new one; this pins what it plans when
 * that is the only change.
 */

import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { APP_SPACE_ID, planOriginOf } from '@internal/framework-components/control';
import type { SerializedIndex } from '@internal/sql-contract/types';
import {
  CheckConstraint,
  indexInputFromSerialized,
  SqlStorage,
  StorageTable,
} from '@internal/sql-contract/types';
import type { SqlObjectNaming } from '@internal/sql-schema-ir/naming';
import {
  computeCheckContentHash,
  computeIndexContentHash,
  formatWireName,
} from '@internal/sql-schema-ir/naming';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { contractToPostgresDatabaseSchemaNode } from '../../src/core/migrations/contract-to-postgres-database-schema-node';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { PostgresRlsEnablement } from '../../src/core/postgres-rls-enablement';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { type PostgresContract, PostgresSchema } from '../../src/core/postgres-schema';
import { computeContentHash } from '../../src/core/rls/canonicalize';
import { postgresRenderDefault } from '../../src/exports/control';
import { postgresTypeComponents, postgresTypeLookups } from '../postgres-type-lookups';

const TABLE = 'posts';
const WRITTEN = '\n  owner_id = 1\n    AND id > 0\n';
const CANONICAL = 'owner_id = 1\n  AND id > 0';

const stubLowerer: ExecuteRequestLowerer = {
  lower: () => ({ sql: 'stub', params: [] }),
  lowerToExecuteRequest: async () => ({ sql: 'stub', params: [] }),
  renderColumnDefault: async () => '',
};

type Naming = 'wire' | 'exact';
type SqlObject = 'index' | 'check' | 'policy';
const EVERY_OBJECT: readonly SqlObject[] = ['index', 'check', 'policy'];

function naming(kind: Naming, prefix: string, hash: string): SqlObjectNaming {
  return kind === 'wire' ? { kind, prefix, hash } : { kind, name: `${prefix}_adopted` };
}

function contractWith(
  text: string,
  kind: Naming,
  objects: readonly SqlObject[] = EVERY_OBJECT,
): PostgresContract {
  const indexHash = computeIndexContentHash({ columns: ['owner_id'], where: text, unique: false });
  const index = indexInputFromSerialized({
    ...(kind === 'wire'
      ? { name: formatWireName('posts_owner_idx', indexHash), prefix: 'posts_owner_idx' }
      : { name: 'posts_owner_idx_adopted' }),
    columns: ['owner_id'],
    where: text,
    unique: false,
  } as SerializedIndex);
  const check = new CheckConstraint({
    naming: naming(kind, 'posts_owner_check', computeCheckContentHash(text)),
    expression: text,
  });
  const policyHash = computeContentHash({
    using: text,
    roles: ['app_user'],
    operation: 'select',
    permissive: true,
  });
  const policy = new PostgresRlsPolicy({
    naming: naming(kind, 'posts_owner_read', policyHash),
    tableName: TABLE,
    namespaceId: 'public',
    operation: 'select',
    roles: ['app_user'],
    using: text,
    withCheck: undefined,
    permissive: true,
  });
  const schema = new PostgresSchema({
    id: 'public',
    entries: {
      table: {
        [TABLE]: new StorageTable({
          columns: {
            id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            owner_id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: objects.includes('index') ? [index] : [],
          checks: objects.includes('check') ? [check] : [],
        }),
      },
      policy: objects.includes('policy') ? { [policy.name]: policy } : {},
      rls: { [TABLE]: new PostgresRlsEnablement({ tableName: TABLE, namespaceId: 'public' }) },
    },
  });
  const contract: Contract<SqlStorage> = {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sql-text-canonical-planner'),
    storage: new SqlStorage({
      storageHash: coreHash('sql-text-canonical-planner'),
      namespaces: { public: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
  return contract as PostgresContract;
}

function plan(kind: Naming, objects: readonly SqlObject[] = EVERY_OBJECT) {
  const from = contractWith(WRITTEN, kind, objects);
  const to = contractWith(CANONICAL, kind, objects);
  return createPostgresMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: contractToPostgresDatabaseSchemaNode(from, {
      annotationNamespace: 'pg',
      renderDefault: postgresRenderDefault,
      codecLookup: postgresTypeLookups.codecLookup,
      dataTypeLookup: postgresTypeLookups.dataTypeLookup,
    }),
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    fromContract: from,
    origin: planOriginOf(from),
    statements: [],
    frameworkComponents: postgresTypeComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
}

function objectNames(contract: PostgresContract) {
  const entries = contract.storage.namespaces['public']?.entries;
  const table = entries?.table?.[TABLE];
  return {
    index: table?.indexes.map((index) => index.name),
    check: table?.checks?.map((check) => check.name),
    policy: Object.keys(entries?.['policy'] ?? {}),
  };
}

describe('a stored text that becomes canonical', () => {
  it('keeps the wire name of an index, a check and a policy', () => {
    expect(objectNames(contractWith(WRITTEN, 'wire'))).toEqual(
      objectNames(contractWith(CANONICAL, 'wire')),
    );
  });

  it('plans no operations for a wire-named index, check and policy', async () => {
    const result = plan('wire');
    if (result.kind !== 'success') throw new Error(`planning failed: ${JSON.stringify(result)}`);
    expect(await Promise.all(result.plan.operations)).toEqual([]);
  });

  it('stops with a conflict for an exact-named index and check', () => {
    expect(plan('exact', ['index', 'check'])).toEqual({
      kind: 'failure',
      conflicts: [
        expect.objectContaining({
          kind: 'unsupportedOperation',
          summary: 'database/public/posts/check:posts_owner_check_adopted',
          why: 'Use `migration new` to author a custom migration for this change.',
        }),
        expect.objectContaining({
          kind: 'indexIncompatible',
          summary: 'database/public/posts/index:posts_owner_idx_adopted',
          why: 'Use `migration new` to author a custom migration for this change.',
        }),
      ],
    });
  });

  it('drops and creates again an exact-named policy', async () => {
    const result = plan('exact', ['policy']);
    if (result.kind !== 'success') throw new Error(`planning failed: ${JSON.stringify(result)}`);
    expect(await Promise.all(result.plan.operations)).toEqual([
      expect.objectContaining({
        id: 'rlsPolicy.public.posts.posts_owner_read_adopted.drop',
        label: 'Drop RLS policy "posts_owner_read_adopted" on "posts"',
        operationClass: 'widening',
      }),
      expect.objectContaining({
        id: 'rlsPolicy.public.posts.posts_owner_read_adopted',
        label: 'Create RLS policy "posts_owner_read_adopted" on "posts"',
        operationClass: 'additive',
      }),
    ]);
  });
});
