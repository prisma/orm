/**
 * A primary key or foreign key whose name both contracts state, and which is
 * otherwise unchanged, is renamed when the stated name changes: `db verify`
 * does not compare names, so without the rename the database would keep the
 * old name while the contract states the new one.
 */
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { APP_SPACE_ID, type MigrationOperationClass } from '@internal/framework-components/control';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import { PostgresSchema } from '../../src/core/postgres-schema';

const stubLowerer: ExecuteRequestLowerer = {
  lower: () => ({ sql: 'stub', params: [] }),
  renderColumnDefault: async () => '',
  lowerToExecuteRequest: async () => ({ sql: 'stub', params: [] }),
};

const ALL_CLASSES: readonly MigrationOperationClass[] = ['additive', 'widening', 'destructive'];

interface Names {
  readonly primaryKey?: string;
  readonly foreignKey?: string;
  readonly primaryKeyColumns?: readonly string[];
}

function buildContract(names: Names): Contract<SqlStorage> {
  const hash = `stated-names-${JSON.stringify(names)}`;
  const schema = new PostgresSchema({
    id: 'public',
    entries: {
      table: {
        author: new StorageTable({
          columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
        post: new StorageTable({
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            slug: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            author_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          },
          primaryKey: {
            columns: names.primaryKeyColumns ?? ['id'],
            ...(names.primaryKey === undefined ? {} : { name: names.primaryKey }),
          },
          foreignKeys: [
            {
              source: { namespaceId: 'public', tableName: 'post', columns: ['author_id'] },
              target: { namespaceId: 'public', tableName: 'author', columns: ['id'] },
              ...(names.foreignKey === undefined ? {} : { name: names.foreignKey }),
            },
          ],
          uniques: [],
          indexes: [],
        }),
      },
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(hash),
    storage: new SqlStorage({ storageHash: coreHash(hash), namespaces: { public: schema } }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

async function plannedOperations(
  from: Contract<SqlStorage>,
  to: Contract<SqlStorage>,
  allowed: readonly MigrationOperationClass[] = ALL_CLASSES,
) {
  const result = createPostgresMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: postgresContractToSchema(from, []),
    policy: { allowedOperationClasses: [...allowed] },
    fromContract: from,
    frameworkComponents: [],
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error(JSON.stringify(result));
  const operations = await Promise.all(result.plan.operations);
  return operations.map((operation) => ({ id: operation.id, label: operation.label }));
}

describe('a stated constraint name that changes', () => {
  it('renames the primary key once', async () => {
    expect(
      await plannedOperations(
        buildContract({ primaryKey: 'post_primary' }),
        buildContract({ primaryKey: 'post_key' }),
      ),
    ).toEqual([
      {
        id: 'primaryKey.public.post.post_primary.rename',
        label: 'Rename primary key "post_primary" to "post_key" on "post"',
      },
    ]);
  });

  it('renames the foreign key once', async () => {
    expect(
      await plannedOperations(
        buildContract({ foreignKey: 'post_author_link' }),
        buildContract({ foreignKey: 'post_written_by' }),
      ),
    ).toEqual([
      {
        id: 'foreignKey.public.post.post_author_link.rename',
        label: 'Rename foreign key "post_author_link" to "post_written_by" on "post"',
      },
    ]);
  });

  it('plans nothing when the stated names stay the same', async () => {
    const contract = buildContract({ primaryKey: 'post_primary', foreignKey: 'post_author_link' });
    expect(await plannedOperations(contract, contract)).toEqual([]);
  });

  it('plans nothing when only the end contract states a name, which the database already has', async () => {
    expect(
      await plannedOperations(buildContract({}), buildContract({ primaryKey: 'post_primary' })),
    ).toEqual([]);
  });

  it('plans no rename without the widening allowance', async () => {
    expect(
      await plannedOperations(
        buildContract({ primaryKey: 'post_primary' }),
        buildContract({ primaryKey: 'post_key' }),
        ['additive'],
      ),
    ).toEqual([]);
  });

  it('leaves a primary key whose columns change to the conflict it reports today', () => {
    const result = createPostgresMigrationPlanner(stubLowerer).plan({
      contract: buildContract({ primaryKey: 'post_key', primaryKeyColumns: ['id', 'slug'] }),
      schema: postgresContractToSchema(buildContract({ primaryKey: 'post_primary' }), []),
      policy: { allowedOperationClasses: [...ALL_CLASSES] },
      fromContract: buildContract({ primaryKey: 'post_primary' }),
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result).toMatchObject({
      kind: 'failure',
      conflicts: [{ kind: 'indexIncompatible', summary: 'database/public/post/primary-key' }],
    });
  });
});
