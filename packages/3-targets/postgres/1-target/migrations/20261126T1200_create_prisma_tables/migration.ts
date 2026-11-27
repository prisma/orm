#!/usr/bin/env -S node
/**
 * The first migration of the `_prisma` contract space: Prisma's own tables in the `_prisma` schema.
 *
 * Written by hand, because the planner cannot produce a conditional rename or column checks. Every step is skipped when its result already holds, so it also brings up to date a database a release candidate set up, whose tables are in the schema `prisma_contract`. Each table's columns are checked, in the old schema before the rename and in `_prisma` after it, so a database whose tables are in another form, such as one from before the release candidates, stops here unchanged.
 *
 * Its names are written out here, not taken from the target's shared constants, so a later change to those cannot change this migration.
 *
 * Re-emit `ops.json` and `migration.json` after editing, from `packages/3-targets/postgres/2-adapter`: `pnpm exec tsx ../1-target/migrations/20261126T1200_create_prisma_tables/migration.ts --config prisma-tables.config.ts`.
 */
import { Migration, MigrationCLI, rawSql } from '../../src/exports/migration';

const SCHEMA = '_prisma';
const RELEASE_CANDIDATE_SCHEMA = 'prisma_contract';

type TableName = 'marker' | 'ledger' | 'contract';

function qualified(table: TableName, schema: string = SCHEMA): string {
  return `"${schema}"."${table}"`;
}

function displayed(table: TableName, schema: string = SCHEMA): string {
  return `${schema}.${table}`;
}
interface ExpectedColumn {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
}

const tables: ReadonlyArray<{
  readonly name: TableName;
  readonly create: string;
  readonly columns: readonly ExpectedColumn[];
}> = [
  {
    name: 'marker',
    create: `CREATE TABLE IF NOT EXISTS ${qualified('marker')} (
  "space" text DEFAULT 'app' NOT NULL PRIMARY KEY,
  "core_hash" text NOT NULL,
  "profile_hash" text NOT NULL,
  "contract_json" jsonb,
  "canonical_version" int,
  "updated_at" timestamptz DEFAULT (now()) NOT NULL,
  "app_tag" text,
  "meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "invariants" text[] DEFAULT '{}'::text[] NOT NULL
)`,
    columns: [
      { name: 'space', type: 'text', notNull: true },
      { name: 'core_hash', type: 'text', notNull: true },
      { name: 'profile_hash', type: 'text', notNull: true },
      { name: 'contract_json', type: 'jsonb', notNull: false },
      { name: 'canonical_version', type: 'integer', notNull: false },
      { name: 'updated_at', type: 'timestamp with time zone', notNull: true },
      { name: 'app_tag', type: 'text', notNull: false },
      { name: 'meta', type: 'jsonb', notNull: true },
      { name: 'invariants', type: 'text[]', notNull: true },
    ],
  },
  {
    name: 'ledger',
    create: `CREATE TABLE IF NOT EXISTS ${qualified('ledger')} (
  "id" bigserial PRIMARY KEY,
  "created_at" timestamptz DEFAULT (now()) NOT NULL,
  "space" text NOT NULL,
  "migration_name" text NOT NULL,
  "migration_hash" text NOT NULL,
  "origin_core_hash" text,
  "origin_profile_hash" text,
  "destination_core_hash" text NOT NULL,
  "destination_profile_hash" text,
  "operations" jsonb NOT NULL
)`,
    columns: [
      { name: 'id', type: 'bigint', notNull: true },
      { name: 'created_at', type: 'timestamp with time zone', notNull: true },
      { name: 'space', type: 'text', notNull: true },
      { name: 'migration_name', type: 'text', notNull: true },
      { name: 'migration_hash', type: 'text', notNull: true },
      { name: 'origin_core_hash', type: 'text', notNull: false },
      { name: 'origin_profile_hash', type: 'text', notNull: false },
      { name: 'destination_core_hash', type: 'text', notNull: true },
      { name: 'destination_profile_hash', type: 'text', notNull: false },
      { name: 'operations', type: 'jsonb', notNull: true },
    ],
  },
  {
    name: 'contract',
    create: `CREATE TABLE IF NOT EXISTS ${qualified('contract')} (
  "core_hash" text NOT NULL PRIMARY KEY,
  "created_at" timestamptz DEFAULT (now()) NOT NULL,
  "contract_json" jsonb NOT NULL
)`,
    columns: [
      { name: 'core_hash', type: 'text', notNull: true },
      { name: 'created_at', type: 'timestamp with time zone', notNull: true },
      { name: 'contract_json', type: 'jsonb', notNull: true },
    ],
  },
];

const schemaExists = 'SELECT to_regnamespace($1) IS NOT NULL AS "result"';
const schemaAbsent = 'SELECT to_regnamespace($1) IS NULL AS "result"';
const schemaAbsentOrHoldsNoRelation = `SELECT to_regnamespace($1) IS NULL
  OR NOT EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = to_regnamespace($1)) AS "result"`;
const tableExists = 'SELECT to_regclass($1) IS NOT NULL AS "result"';
/** Reads only the catalogues, which need no privilege on the schema, so a role that cannot use the schema still gets this check's answer. */
const absentOrColumnHasForm = `WITH "table" AS (
  SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1 AND c.relname = $2
)
SELECT NOT EXISTS (SELECT 1 FROM "table") OR EXISTS (
  SELECT 1 FROM pg_attribute a JOIN "table" t ON a.attrelid = t.oid
  WHERE a.attname = $3 AND NOT a.attisdropped
    AND format_type(a.atttypid, a.atttypmod) = $4 AND a.attnotnull = $5
) AS "result"`;
/** `ALTER SCHEMA … RENAME` needs the privileges of the schema's owner and CREATE on the database; a superuser has both. */
const hasOwnerPrivileges = `SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
  OR pg_has_role(current_user, nspowner, 'USAGE') AS "result"
FROM pg_namespace WHERE nspname = $1`;
const mayCreateInDatabase = `SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
  OR has_database_privilege(current_database(), 'CREATE') AS "result"`;

function nullability(column: ExpectedColumn): string {
  return column.notNull ? 'NOT NULL' : 'nullable';
}

function checkColumns(
  table: (typeof tables)[number],
  schema: string,
  id: string,
  origin: string,
  otherForm: string,
) {
  return rawSql({
    id,
    label: `Checked the columns of table ${displayed(table.name, schema)}`,
    operationClass: 'additive',
    target: { id: 'postgres', details: { schema, objectType: 'table', name: table.name } },
    precheck: table.columns.map((column) => ({
      description: `Table ${qualified(table.name, schema)}${origin} must have column "${column.name}" of type ${column.type}, ${nullability(column)}. ${otherForm}`,
      sql: absentOrColumnHasForm,
      params: [schema, table.name, column.name, column.type, column.notNull],
    })),
    execute: [],
    postcheck: [],
  });
}

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: '5807887e31e02b4ff9bd120ad0ac274610400ae9d7819564d209b835b763a177',
    };
  }

  override get operations() {
    return [
      ...tables.map((table) =>
        checkColumns(
          table,
          RELEASE_CANDIDATE_SCHEMA,
          `_prisma.check-release-candidate-columns.${table.name}`,
          ', which the release candidates of Prisma 8 created,',
          'Prisma brings up to date only the tables the release candidates of Prisma 8 created, and leaves a table in another form, such as one from before the release candidates, as it is.',
        ),
      ),
      rawSql({
        id: '_prisma.rename-release-candidate-schema',
        label: `Renamed schema ${RELEASE_CANDIDATE_SCHEMA} to ${SCHEMA}`,
        operationClass: 'widening',
        target: { id: 'postgres' },
        precheck: [
          {
            description: `Schema "${SCHEMA}" must hold no tables or other relations while schema "${RELEASE_CANDIDATE_SCHEMA}" exists. This release keeps Prisma's own tables in "${SCHEMA}", and "${RELEASE_CANDIDATE_SCHEMA}" holds the tables a release candidate of Prisma 8 created, so Prisma does not choose between them. Follow the upgrade instructions before dropping either schema.`,
            sql: schemaAbsentOrHoldsNoRelation,
            params: [SCHEMA],
          },
          {
            description: `The role that runs this command must have the privileges of the role that owns schema "${RELEASE_CANDIDATE_SCHEMA}", because renaming a schema needs them. Find the owner with SELECT nspowner::regrole FROM pg_namespace WHERE nspname = '${RELEASE_CANDIDATE_SCHEMA}'. Then run the command once as that role, or give the schema to the migrating role with ALTER SCHEMA "${RELEASE_CANDIDATE_SCHEMA}" OWNER TO <migrating role>.`,
            sql: hasOwnerPrivileges,
            params: [RELEASE_CANDIDATE_SCHEMA],
          },
          {
            description: `The role that runs this command must have the CREATE privilege on the database, because renaming schema "${RELEASE_CANDIDATE_SCHEMA}" needs it. Grant it with GRANT CREATE ON DATABASE <database> TO <migrating role>, or run the command once as a role that has it.`,
            sql: mayCreateInDatabase,
            params: [],
          },
        ],
        execute: [
          {
            description: `drop schema "${SCHEMA}" if it exists, which the database refuses when anything is in it`,
            sql: `DROP SCHEMA IF EXISTS "${SCHEMA}"`,
          },
          {
            description: `rename schema "${RELEASE_CANDIDATE_SCHEMA}" to "${SCHEMA}"`,
            sql: `ALTER SCHEMA "${RELEASE_CANDIDATE_SCHEMA}" RENAME TO "${SCHEMA}"`,
          },
        ],
        postcheck: [
          {
            description: `Schema "${RELEASE_CANDIDATE_SCHEMA}" must no longer exist once it is renamed to "${SCHEMA}".`,
            sql: schemaAbsent,
            params: [RELEASE_CANDIDATE_SCHEMA],
          },
        ],
      }),
      rawSql({
        id: '_prisma.create-schema',
        label: `Created schema ${SCHEMA}`,
        operationClass: 'additive',
        target: { id: 'postgres' },
        precheck: [],
        execute: [
          {
            description: `create schema "${SCHEMA}"`,
            sql: `CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`,
          },
        ],
        postcheck: [
          {
            description: `Schema "${SCHEMA}" must exist.`,
            sql: schemaExists,
            params: [SCHEMA],
          },
        ],
      }),
      ...tables.map((table) =>
        rawSql({
          id: `_prisma.create-table.${table.name}`,
          label: `Created table ${displayed(table.name)}`,
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: { schema: SCHEMA, objectType: 'table', name: table.name },
          },
          precheck: [],
          execute: [{ description: `create table ${qualified(table.name)}`, sql: table.create }],
          postcheck: [
            {
              description: `Table ${qualified(table.name)} must exist.`,
              sql: tableExists,
              params: [qualified(table.name)],
            },
          ],
        }),
      ),
      ...tables.map((table) =>
        checkColumns(
          table,
          SCHEMA,
          `_prisma.check-columns.${table.name}`,
          '',
          'This release of Prisma reads and writes this table only in the form it creates.',
        ),
      ),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
