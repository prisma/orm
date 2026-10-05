/**
 * Every `contract-prisma7` fixture that interprets to a contract is checked
 * against the database Prisma 7.10.0 builds for it: the fixture's
 * `migration.sql` is applied to an empty database, the schema is interpreted
 * through the Postgres binding, and `db verify` reports nothing in lenient
 * mode. In strict mode it reports exactly the tables, columns, and foreign
 * keys Prisma 7 still creates for `@ignore` and `@@ignore` constructs.
 * `db verify` does not compare constraint names, so each primary key and
 * foreign key is also checked to have the name the migration planner would
 * use for it: the contract's, or the one the planner derives.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
import { withClient } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { runSchemaVerify, timeouts, useDevDatabase } from '../family.schema-verify.helpers';

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/2-sql/2-authoring/contract-prisma7/test/fixtures',
);

const successFixtures = readdirSync(fixturesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => existsSync(join(fixturesDir, name, 'expected-contract.json')))
  .sort();

const strictExtras: Record<string, readonly (readonly string[])[]> = {
  ignore: [
    ['database', 'public', 'LegacyThing'],
    ['database', 'public', 'LegacyThing', 'column:id'],
    ['database', 'public', 'LegacyThing', 'column:userId'],
    ['database', 'public', 'LegacyThing', 'foreign-key:userId->public.User(id)'],
    ['database', 'public', 'LegacyThing', 'primary-key'],
    ['database', 'public', 'User', 'column:legacy'],
  ],
  'ignored-relation-back-relations': [
    ['database', 'public', 'Post', 'foreign-key:authorId->public.User(id)'],
    ['database', 'public', 'Profile', 'foreign-key:userId->public.User(id)'],
    ['database', 'public', 'User', 'foreign-key:managerId->public.User(id)'],
    ['database', 'public', '_TagToUser'],
    ['database', 'public', '_TagToUser', 'column:A'],
    ['database', 'public', '_TagToUser', 'column:B'],
    ['database', 'public', '_TagToUser', 'foreign-key:A->public.Tag(id)'],
    ['database', 'public', '_TagToUser', 'foreign-key:B->public.User(id)'],
    ['database', 'public', '_TagToUser', 'index:_TagToUser_B_index'],
    ['database', 'public', '_TagToUser', 'primary-key'],
  ],
  'native-type-model-ignored': [
    ['database', 'public', 'Account'],
    ['database', 'public', 'Account', 'column:balance'],
    ['database', 'public', 'Account', 'column:currency'],
    ['database', 'public', 'Account', 'column:currency', 'default'],
    ['database', 'public', 'Account', 'column:email'],
    ['database', 'public', 'Account', 'column:id'],
    ['database', 'public', 'Account', 'column:nickname'],
    ['database', 'public', 'Account', 'column:region'],
    ['database', 'public', 'Account', 'index:Account_email_key'],
    ['database', 'public', 'Account', 'index:Account_region_idx'],
    ['database', 'public', 'Account', 'primary-key'],
    ['database', 'public', 'Post', 'column:authorEmail'],
    ['database', 'public', 'Post', 'foreign-key:authorEmail->public.Account(email)'],
  ],
  'relations-ignored': [
    ['database', 'public', 'Post', 'column:legacyOwnerId'],
    ['database', 'public', 'Post', 'foreign-key:legacyOwnerId->public.User(id)'],
    ['database', 'public', 'Thing'],
    ['database', 'public', 'Thing', 'column:id'],
    ['database', 'public', 'Thing', 'column:userId'],
    ['database', 'public', 'Thing', 'foreign-key:userId->public.User(id)'],
    ['database', 'public', 'Thing', 'primary-key'],
  ],
  'unsupported-type-model-ignored': [
    ['database', 'public', 'Post'],
    ['database', 'public', 'Post', 'column:authorId'],
    ['database', 'public', 'Post', 'column:id'],
    ['database', 'public', 'Post', 'column:search'],
    ['database', 'public', 'Post', 'foreign-key:authorId->public.User(id)'],
    ['database', 'public', 'Post', 'primary-key'],
  ],
};

interface SerializedConstraint {
  readonly name?: string;
}

interface SerializedTable {
  readonly primaryKey?: SerializedConstraint & { readonly columns: readonly string[] };
  readonly foreignKeys?: readonly (SerializedConstraint & {
    readonly source: { readonly columns: readonly string[] };
  })[];
}

interface SerializedStorage {
  readonly storage: {
    readonly namespaces: Record<
      string,
      { readonly entries: { readonly table?: Record<string, SerializedTable> } }
    >;
  };
}

function constraintKey(schema: string, table: string, kind: 'p' | 'f', columns: readonly string[]) {
  return `${schema}.${table} ${kind === 'p' ? 'primary key' : 'foreign key'} (${columns.join(', ')})`;
}

/** The name the planner gives each primary key and foreign key of the contract: the stated one, or the one it derives, as Postgres stores it. */
function plannedConstraintNames(serialized: unknown): Record<string, string> {
  const { defaultConstraintNames } = prisma7PostgresBinding;
  const names: Record<string, string> = {};
  for (const [schema, namespace] of Object.entries(
    (serialized as SerializedStorage).storage.namespaces,
  )) {
    for (const [table, entry] of Object.entries(namespace.entries.table ?? {})) {
      if (entry.primaryKey !== undefined) {
        names[constraintKey(schema, table, 'p', entry.primaryKey.columns)] =
          entry.primaryKey.name ?? defaultConstraintNames.primaryKey(table);
      }
      for (const foreignKey of entry.foreignKeys ?? []) {
        names[constraintKey(schema, table, 'f', foreignKey.source.columns)] =
          foreignKey.name ?? defaultConstraintNames.foreignKey(table, foreignKey.source.columns);
      }
    }
  }
  return names;
}

async function databaseConstraintNames(
  connectionString: string,
  keys: readonly string[],
): Promise<Record<string, string | undefined>> {
  const rows = await withClient(connectionString, async (client) => {
    const result = await client.query<{
      schema: string;
      table: string;
      kind: 'p' | 'f';
      name: string;
      columns: string[];
    }>(
      `SELECT n.nspname AS schema, t.relname AS table, c.contype AS kind, c.conname AS name,
         ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, position)
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
               ORDER BY k.position) AS columns
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE c.contype IN ('p', 'f')`,
    );
    return result.rows;
  });
  const found = new Map(
    rows.map((row) => [constraintKey(row.schema, row.table, row.kind, row.columns), row.name]),
  );
  return Object.fromEntries(keys.map((key) => [key, found.get(key)]));
}

function schemaPathOf(fixture: string): string {
  const directory = join(fixturesDir, fixture, 'schema');
  return existsSync(directory) ? directory : join(fixturesDir, fixture, 'schema.prisma');
}

async function interpret(fixture: string): Promise<Contract<SqlStorage>> {
  const schemaPath = schemaPathOf(fixture);
  const stack = createControlStack({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [],
  });
  const loaded = await prisma7Contract(schemaPath, { binding: prisma7PostgresBinding }).source.load(
    {
      composedExtensions: [],
      composedExtensionContracts: stack.extensionContracts,
      authoringContributions: stack.authoringContributions,
      codecLookup: stack.codecLookup,
      dataTypeLookup: stack.dataTypeLookup,
      controlMutationDefaults: stack.controlMutationDefaults,
      resolvedInputs: [schemaPath],
      capabilities: stack.capabilities,
    },
  );
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.failure.diagnostics));
  return loaded.value as Contract<SqlStorage>;
}

const resetDatabase = `
DO $$
DECLARE name text;
BEGIN
  FOR name IN
    SELECT nspname FROM pg_namespace
    WHERE nspname NOT LIKE 'pg\\_%'
      AND nspname NOT LIKE '\\_prisma\\_dev%'
      AND nspname <> 'information_schema'
  LOOP
    EXECUTE format('DROP SCHEMA %I CASCADE', name);
  END LOOP;
  CREATE SCHEMA public;
END $$;
`;

describe('Prisma 7 contract source fixtures against the database Prisma 7 built', () => {
  const { getConnectionString } = useDevDatabase();

  it('finds success fixtures, and pins strict extras only for them', () => {
    expect(successFixtures.length).toBeGreaterThan(0);
    expect(Object.keys(strictExtras).filter((name) => !successFixtures.includes(name))).toEqual([]);
  });

  for (const fixture of successFixtures) {
    it(
      `${fixture} verifies with zero lenient findings and only its ignored constructs as strict extras`,
      async () => {
        const migrationPath = join(fixturesDir, fixture, 'migration.sql');
        expect(existsSync(migrationPath), `${fixture} has no migration.sql`).toBe(true);
        await withClient(getConnectionString(), async (client) => {
          await client.query(resetDatabase);
          await client.query(readFileSync(migrationPath, 'utf8'));
        });
        const serialized = new PostgresContractSerializer().serializeContract(
          await interpret(fixture),
        );

        const lenient = await runSchemaVerify(getConnectionString(), serialized);
        expect(lenient.schema.issues).toEqual([]);

        const strict = await runSchemaVerify(getConnectionString(), serialized, { strict: true });
        expect(strict.schema.issues.map((issue) => issue.path).sort()).toEqual(
          strictExtras[fixture] ?? [],
        );

        const planned = plannedConstraintNames(serialized);
        expect(Object.keys(planned).length).toBeGreaterThan(0);
        expect(await databaseConstraintNames(getConnectionString(), Object.keys(planned))).toEqual(
          planned,
        );
      },
      timeouts.spinUpPpgDev,
    );
  }
});
