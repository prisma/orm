import postgresAdapterDescriptor, {
  createPostgresBuiltinCodecLookup,
} from '@internal/adapter-postgres/control';
import { coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import postgresTargetDescriptor from '@internal/target-postgres/control';
import {
  createPostgresBuiltinDataTypeLookup,
  postgresDataTypes,
} from '@internal/target-postgres/data-types';
import { createPostgresMigrationPlanner } from '@internal/target-postgres/planner';
import {
  PostgresDatabaseSchemaNode,
  PostgresNamespaceSchemaNode,
  PostgresTableSchemaNode,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { introspectedColumn } from '../../../2-sql-family/1-core/contract/test/introspected-column';
import { createTestPostgresControlAdapter } from '../../../3-targets/postgres/2-adapter/test/helpers/test-control-adapter';
import citextExtensionDescriptor from '../src/exports/control';

async function planAddingNotNullEmailToPopulatedUserTable() {
  const planner = createPostgresMigrationPlanner(
    createTestPostgresControlAdapter(
      createPostgresBuiltinCodecLookup(),
      createPostgresBuiltinDataTypeLookup(),
    ),
  );
  const contract = {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              user: {
                columns: {
                  id: { many: false, dataType: 'pg/uuid', codecId: 'pg/uuid@1', nullable: false },
                  email: {
                    many: false,
                    dataType: 'citext/citext',
                    codecId: 'pg/citext@1',
                    nullable: false,
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
      storageHash: coreHash('contract'),
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  } as const;
  const schema = new PostgresDatabaseSchemaNode({
    extensions: undefined,
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          user: new PostgresTableSchemaNode({
            name: 'user',
            columns: {
              id: introspectedColumn(
                { name: 'id', typeText: 'uuid', nullable: false },
                postgresDataTypes,
              ),
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
  const result = planner.plan({
    contract,
    schema,
    policy: INIT_ADDITIVE_POLICY,
    fromContract: null,
    origin: null,
    statements: [],
    frameworkComponents: [
      postgresTargetDescriptor,
      postgresAdapterDescriptor,
      citextExtensionDescriptor,
    ],
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error('expected planner success');
  const operations = await Promise.all(result.plan.operations);
  const addEmail = operations.find((operation) => operation.id === 'column.user.email');
  if (addEmail === undefined) throw new Error('expected an operation adding user.email');
  return addEmail;
}

describe('adding a NOT NULL citext column with no default to an existing table', () => {
  it('fills existing rows with an empty string, as for text', async () => {
    const addEmail = await planAddingNotNullEmailToPopulatedUserTable();

    expect({
      precheck: addEmail.precheck.map((check) => check.sql),
      execute: addEmail.execute.map((step) => step.sql),
    }).toEqual({
      precheck: [
        'SELECT NOT EXISTS (SELECT 1 AS "one" FROM "information_schema"."columns" WHERE ("table_schema" = current_schema() AND "table_name" = $1 AND "column_name" = $2)) AS "result"',
      ],
      execute: [
        `ALTER TABLE "user" ADD COLUMN "email" citext DEFAULT ('') NOT NULL`,
        'ALTER TABLE "user" ALTER COLUMN "email" DROP DEFAULT',
      ],
    });
  });
});
