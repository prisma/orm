/**
 * The Prisma 7 contract source's relations verify against the database Prisma
 * 7.10.0 built (`fixtures/prisma7-source/supported/migration.sql`): every foreign
 * key, every implicit junction table with its columns, primary key, and
 * `_B_index`, with zero findings; the serialized contract is asserted
 * positively so the test cannot pass on an empty contract.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prisma7Contract } from '@internal/sql-contract-prisma7/provider';
import postgres from '@internal/target-postgres/control';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { blindCast } from '@internal/utils/casts';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { runSchemaVerify } from '../family.schema-verify.helpers';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/prisma7-source');
const migrationSql = readFileSync(join(fixturesDir, 'supported/migration.sql'), 'utf8');
const schemaPath = join(fixturesDir, 'relations/schema.prisma');

function sourceContext() {
  const stack = createControlStack({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [],
  });
  return {
    composedExtensions: [],
    composedExtensionContracts: stack.extensionContracts,
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    dataTypeLookup: stack.dataTypeLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    resolvedInputs: [schemaPath],
    capabilities: stack.capabilities,
  };
}

interface SerializedForeignKey {
  readonly source: { readonly tableName: string; readonly columns: readonly string[] };
  readonly target: { readonly tableName: string; readonly columns: readonly string[] };
  readonly onDelete?: string;
  readonly onUpdate?: string;
}

function foreignKeysOf(serialized: Record<string, unknown>, table: string): SerializedForeignKey[] {
  const tables = blindCast<
    Record<string, { readonly foreignKeys: readonly SerializedForeignKey[] }>,
    'serialized Postgres contract: storage.namespaces.public.entries.table'
  >(
    (
      (serialized['storage'] as Record<string, unknown>)['namespaces'] as Record<
        string,
        { entries: { table: Record<string, unknown> } }
      >
    )['public']?.entries.table,
  );
  return [...(tables[table]?.foreignKeys ?? [])];
}

function relationsOf(serialized: Record<string, unknown>, model: string): Record<string, unknown> {
  const models = (
    (serialized['domain'] as Record<string, unknown>)['namespaces'] as Record<
      string,
      { models: Record<string, { relations: Record<string, unknown> }> }
    >
  )['public']?.models;
  return models?.[model]?.relations ?? {};
}

function foreignKey(
  columns: readonly string[],
  targetTable: string,
  targetColumns: readonly string[],
  onDelete: string,
  onUpdate: string,
) {
  return expect.objectContaining({
    source: expect.objectContaining({ columns }),
    target: expect.objectContaining({ tableName: targetTable, columns: targetColumns }),
    onDelete,
    onUpdate,
  });
}

function manyToMany(through: string, parentColumn: string, childColumn: string) {
  return expect.objectContaining({
    cardinality: 'N:M',
    through: expect.objectContaining({
      table: through,
      parentColumns: [parentColumn],
      childColumns: [childColumn],
    }),
  });
}

describe('Prisma 7 relations against the database Prisma 7 built', () => {
  it(
    'verifies every foreign key and implicit junction table with zero findings',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, (client) => client.query(migrationSql));

        const config = prisma7Contract(schemaPath, { binding: prisma7PostgresBinding });
        const loaded = await config.source.load(sourceContext());
        expect(loaded.ok).toBe(true);
        if (!loaded.ok) return;

        const serialized = new PostgresContractSerializer().serializeContract(
          loaded.value as Contract<SqlStorage>,
        );

        expect(foreignKeysOf(serialized, 'Post')).toEqual([
          foreignKey(['authorId'], 'User', ['id'], 'restrict', 'cascade'),
          foreignKey(['editorId'], 'User', ['id'], 'setNull', 'cascade'),
        ]);
        expect(foreignKeysOf(serialized, 'Profile')).toEqual([
          foreignKey(['userId'], 'User', ['id'], 'restrict', 'cascade'),
        ]);
        expect(foreignKeysOf(serialized, 'Settings')).toEqual([
          foreignKey(['userId'], 'User', ['id'], 'setNull', 'cascade'),
        ]);
        expect(foreignKeysOf(serialized, '_PostToTag')).toEqual([
          foreignKey(['A'], 'Post', ['id'], 'cascade', 'cascade'),
          foreignKey(['B'], 'Tag', ['id'], 'cascade', 'cascade'),
        ]);
        expect(foreignKeysOf(serialized, '_Favorites')).toEqual([
          foreignKey(['A'], 'Post', ['id'], 'cascade', 'cascade'),
          foreignKey(['B'], 'User', ['id'], 'cascade', 'cascade'),
        ]);
        expect(foreignKeysOf(serialized, '_Follows')).toEqual([
          foreignKey(['A'], 'User', ['id'], 'cascade', 'cascade'),
          foreignKey(['B'], 'User', ['id'], 'cascade', 'cascade'),
        ]);
        expect(relationsOf(serialized, 'Post')).toMatchObject({
          tags: manyToMany('_PostToTag', 'A', 'B'),
          fans: manyToMany('_Favorites', 'A', 'B'),
        });
        expect(relationsOf(serialized, 'Tag')).toMatchObject({
          posts: manyToMany('_PostToTag', 'B', 'A'),
        });
        expect(relationsOf(serialized, 'User')).toMatchObject({
          favorites: manyToMany('_Favorites', 'B', 'A'),
          followers: manyToMany('_Follows', 'A', 'B'),
          following: manyToMany('_Follows', 'B', 'A'),
        });

        const result = await runSchemaVerify(connectionString, serialized);
        // Every foreign key, foreign key column, junction table, primary key,
        // index, and unique index verified clean; nothing else is declared.
        expect(result.schema.issues.map((issue) => issue.path)).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
