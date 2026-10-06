import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import { createPostgresMigrationPlanner } from '@internal/target-postgres/planner';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
import {
  PostgresDatabaseSchemaNode,
  PostgresNamespaceSchemaNode,
  PostgresTableSchemaNode,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import pgvectorDescriptor from '../../src/exports/control';
import { createComposedPostgresControlAdapter } from '../helpers/composed-adapter';

const policy: MigrationOperationPolicy = { allowedOperationClasses: ['additive', 'widening'] };

function contractWithEmbeddingDefault(value: number[]): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('vector-default'),
    storage: new SqlStorage({
      storageHash: coreHash('vector-default'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              doc: {
                columns: {
                  id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                  embedding: {
                    nativeType: 'vector',
                    codecId: 'pg/vector@1',
                    nullable: true,
                    typeParams: { length: 3 },
                    default: { kind: 'literal', value },
                  },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
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

const liveSchema = new PostgresDatabaseSchemaNode({
  namespaces: {
    public: new PostgresNamespaceSchemaNode({
      schemaName: 'public',
      tables: {
        doc: new PostgresTableSchemaNode({
          name: 'doc',
          columns: {
            id: { name: 'id', nativeType: 'uuid', nullable: false },
            embedding: { name: 'embedding', nativeType: 'vector(3)', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          foreignKeys: [],
          indexes: [],
          rlsEnabled: false,
        }),
      },
    }),
  },
  roles: [],
  existingSchemas: [],
  pgVersion: '',
});

async function setDefaultStatement(value: number[]): Promise<string | undefined> {
  const planner = createPostgresMigrationPlanner(
    createComposedPostgresControlAdapter({ extensions: [pgvectorDescriptor] }),
  );
  const result = planner.plan({
    contract: contractWithEmbeddingDefault(value),
    schema: liveSchema,
    policy,
    fromContract: null,
    frameworkComponents: [pgvectorDescriptor],
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
  const operations = (await Promise.all(
    result.plan.operations,
  )) as SqlMigrationPlanOperation<PostgresPlanTargetDetails>[];
  const setDefault = operations.find((operation) => operation.id === 'setDefault.doc.embedding');
  return setDefault?.execute[0]?.sql;
}

describe('a vector default a migration sets on an existing column', () => {
  it('is written through the pgvector codec of the stack', async () => {
    expect(await setDefaultStatement([1, 2, 3])).toBe(
      `ALTER TABLE "doc" ALTER COLUMN "embedding" SET DEFAULT '[1,2,3]'::vector(3)`,
    );
  });

  it('is refused by the codec when its length is not the length the column declares', async () => {
    await expect(setDefaultStatement([1, 2])).rejects.toThrow(
      'Column "doc"."embedding" has a default its codec pg/vector@1 refuses: pg/vector@1 JSON value must be an array of 3 finite numbers',
    );
  });
});
