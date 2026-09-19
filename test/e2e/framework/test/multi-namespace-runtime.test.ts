/**
 * Multi-namespace Postgres contract queryable end-to-end (PGlite).
 *
 * Proves runtime SQL qualification routes DML to the schema named on each
 * model's namespace coordinate (auth vs public), not only the default namespace.
 */

import { instantiateExecutionStack } from '@prisma/orm-postgres/components/execution';
import {
  asNamespaceId,
  type Contract,
  coreHash,
  profileHash,
} from '@prisma/orm-postgres/contract/types';
import { SqlStorage, StorageTable } from '@prisma/orm-postgres/family-contract/types';
import postgres from '@prisma/orm-postgres/runtime';
import { PostgresContractSerializer } from '@prisma/orm-postgres/target/runtime';
import { PostgresSchema } from '@prisma/orm-postgres/target/types';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { createControlClientForTests, withE2eMigrationsDir } from './utils';

const postgresContractSerializer = new PostgresContractSerializer();

function buildMultiNamespaceRuntimeContract(): Contract<SqlStorage> {
  const userTable = {
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
    },
    primaryKey: { columns: ['id'] as const },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  const noteTable = {
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      body: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      author_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
    },
    primaryKey: { columns: ['id'] as const },
    uniques: [],
    indexes: [],
    foreignKeys: [
      {
        source: {
          namespaceId: asNamespaceId('public'),
          tableName: 'note',
          columns: ['author_id'],
        },
        target: {
          namespaceId: asNamespaceId('auth'),
          tableName: 'user',
          columns: ['id'],
        },
        constraint: true,
        index: false,
      },
    ],
  };

  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('multi-ns-runtime-e2e'),
    storage: new SqlStorage({
      storageHash: coreHash('multi-ns-runtime-e2e'),
      namespaces: {
        auth: new PostgresSchema({
          id: 'auth',
          entries: {
            table: { user: new StorageTable(userTable) },
          },
        }),
        public: new PostgresSchema({
          id: 'public',
          entries: {
            table: { note: new StorageTable(noteTable) },
          },
        }),
      },
    }),
    roots: {
      user: { model: 'User', namespace: asNamespaceId('auth') },
      note: { model: 'Note', namespace: asNamespaceId('public') },
    },
    domain: {
      namespaces: {
        auth: {
          models: {
            User: {
              fields: {
                id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
                name: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
              },
              relations: {},
              storage: {
                namespaceId: 'auth',
                table: 'user',
                fields: { id: { column: 'id' }, name: { column: 'name' } },
              },
            },
          },
        },
        public: {
          models: {
            Note: {
              fields: {
                id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
                body: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
                authorId: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
              },
              relations: {
                author: {
                  cardinality: 'N:1',
                  nullable: false,
                  on: { localFields: ['authorId'], targetFields: ['id'] },
                  to: { model: 'User', namespace: 'auth' },
                },
              },
              storage: {
                namespaceId: 'public',
                table: 'note',
                fields: {
                  id: { column: 'id' },
                  body: { column: 'body' },
                  authorId: { column: 'author_id' },
                },
              },
            },
          },
        },
      },
    },
    capabilities: {},
    extensions: {},
    meta: {},
  } as unknown as Contract<SqlStorage>;
}

describe('multi-namespace runtime', () => {
  it(
    'applies auth + public schemas and queries each namespace with qualified SQL',
    async () => {
      const contract = buildMultiNamespaceRuntimeContract();
      const contractJson = postgresContractSerializer.serializeContract(contract);

      await withDevDatabase(async ({ connectionString }) => {
        const controlClient = createControlClientForTests(connectionString);
        try {
          await withE2eMigrationsDir(async (migrationsDir) => {
            const init = await controlClient.dbInit({
              contract: contractJson,
              mode: 'apply',
              migrationsDir,
            });
            if (!init.ok) {
              throw new Error(`dbInit failed: ${init.failure.summary}`);
            }
          });
        } finally {
          await controlClient.close();
        }

        const pool = new Pool({ connectionString });
        try {
          const client = postgres({ contract, pg: pool });
          const runtime = await client.connect();
          const adapter = instantiateExecutionStack(client.stack).adapter;
          const db = client.sql;

          // Seed with qualified DDL targets (migration already created auth + public tables).
          await pool.query('INSERT INTO "auth"."user" (id, name) VALUES ($1, $2)', [1, 'Ada']);
          await pool.query(
            'INSERT INTO "public"."note" (id, body, author_id) VALUES ($1, $2, $3)',
            [10, 'hello', 1],
          );

          const userSelect = db['auth']!['user']!.select('id', 'name').build();
          const userSql = adapter.lower(userSelect.ast, {
            contract: client.contract,
            params: userSelect.params,
          }).sql;
          expect(userSql).toContain('FROM "auth"."user"');

          const noteSelect = db['public']!['note']!.select('id', 'body').build();
          const noteSql = adapter.lower(noteSelect.ast, {
            contract: client.contract,
            params: noteSelect.params,
          }).sql;
          expect(noteSql).toContain('FROM "public"."note"');

          expect([...(await runtime.query(userSelect))]).toEqual([{ id: 1, name: 'Ada' }]);
          expect([...(await runtime.query(noteSelect))]).toEqual([{ id: 10, body: 'hello' }]);
        } finally {
          await pool.end();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );
});
