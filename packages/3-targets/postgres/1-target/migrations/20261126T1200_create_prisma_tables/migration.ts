#!/usr/bin/env -S node
/**
 * The first migration of the `_prisma` contract space: Prisma's own tables in the `_prisma` schema.
 *
 * Written by hand, because the planner cannot produce a conditional rename or column checks. Every step is skipped when its result already holds, so it also brings up to date a database a release candidate set up, whose tables are in the schema `prisma_contract`. Each table's columns are checked, in the old schema before the rename and in `_prisma` after it, so a database whose tables are in another form, such as one from before the release candidates, stops here unchanged.
 *
 * Re-emit `ops.json` and `migration.json` after editing, from `packages/3-targets/postgres/2-adapter`: `pnpm exec tsx ../1-target/migrations/20261126T1200_create_prisma_tables/migration.ts --config prisma-tables.config.ts`.
 */
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { Migration, MigrationCLI, rawSql } from '../../src/exports/migration';

const SCHEMA = '_prisma';
const RELEASE_CANDIDATE_SCHEMA = 'prisma_contract';
/** Written out, not imported: a check's text is part of the migration's hash, which must not change once released. */
const UPGRADE_INSTRUCTIONS_URL =
  'https://github.com/prisma/orm/tree/main/skills/prisma-8/upgrading/app';

interface ExpectedColumn {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
}

const tables: ReadonlyArray<{
  readonly name: string;
  readonly create: string;
  readonly columns: readonly ExpectedColumn[];
}> = [
  {
    name: 'marker',
    create: `CREATE TABLE IF NOT EXISTS "_prisma"."marker" (
  "space" text DEFAULT '${APP_SPACE_ID}' NOT NULL PRIMARY KEY,
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
    create: `CREATE TABLE IF NOT EXISTS "_prisma"."ledger" (
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
    create: `CREATE TABLE IF NOT EXISTS "_prisma"."contract" (
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
/** `ALTER SCHEMA … RENAME` needs the privileges of the schema's owner and CREATE on the database. */
const mayRenameSchema = `SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
  OR (pg_has_role(current_user, nspowner, 'USAGE')
    AND has_database_privilege(current_database(), 'CREATE')) AS "result"
FROM pg_namespace WHERE nspname = $1`;

function qualified(table: string, schema: string = SCHEMA): string {
  return `"${schema}"."${table}"`;
}

function nullability(column: ExpectedColumn): string {
  return column.notNull ? 'NOT NULL' : 'nullable';
}

function checkColumns(table: (typeof tables)[number], schema: string, id: string, origin: string) {
  return rawSql({
    id,
    label: `Check the columns of table ${qualified(table.name, schema)}`,
    operationClass: 'additive',
    target: { id: 'postgres', details: { schema, objectType: 'table', name: table.name } },
    precheck: table.columns.map((column) => ({
      description: `ensure table ${qualified(table.name, schema)}${origin} has column "${column.name}" ${column.type} ${nullability(column)}: it has no such column, or the column has another type or nullability. Prisma cannot bring a table of another form up to date: the upgrade instructions at ${UPGRADE_INSTRUCTIONS_URL} say what to do`,
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
        ),
      ),
      rawSql({
        id: '_prisma.rename-release-candidate-schema',
        label: `Rename schema "${RELEASE_CANDIDATE_SCHEMA}" to "${SCHEMA}"`,
        operationClass: 'widening',
        target: { id: 'postgres' },
        precheck: [
          {
            description: `ensure schemas "${RELEASE_CANDIDATE_SCHEMA}" and "${SCHEMA}" do not both exist: Prisma keeps its tables in one of them, and cannot tell which holds the tables to keep`,
            sql: schemaAbsent,
            params: [SCHEMA],
          },
          {
            description: `ensure the current role may rename schema "${RELEASE_CANDIDATE_SCHEMA}": renaming a schema needs the privileges of the role that owns it and the CREATE privilege on the database. Run the command as the role that owns "${RELEASE_CANDIDATE_SCHEMA}" (SELECT nspowner::regrole FROM pg_namespace WHERE nspname = '${RELEASE_CANDIDATE_SCHEMA}' names it), or give the schema to the role that runs it with ALTER SCHEMA "${RELEASE_CANDIDATE_SCHEMA}" OWNER TO <role>`,
            sql: mayRenameSchema,
            params: [RELEASE_CANDIDATE_SCHEMA],
          },
        ],
        execute: [
          {
            description: `rename schema "${RELEASE_CANDIDATE_SCHEMA}" to "${SCHEMA}"`,
            sql: `ALTER SCHEMA "${RELEASE_CANDIDATE_SCHEMA}" RENAME TO "${SCHEMA}"`,
          },
        ],
        postcheck: [
          {
            description: `verify schema "${RELEASE_CANDIDATE_SCHEMA}" does not exist`,
            sql: schemaAbsent,
            params: [RELEASE_CANDIDATE_SCHEMA],
          },
        ],
      }),
      rawSql({
        id: '_prisma.create-schema',
        label: `Create schema "${SCHEMA}"`,
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
            description: `verify schema "${SCHEMA}" exists`,
            sql: schemaExists,
            params: [SCHEMA],
          },
        ],
      }),
      ...tables.map((table) =>
        rawSql({
          id: `_prisma.create-table.${table.name}`,
          label: `Create table ${qualified(table.name)}`,
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: { schema: SCHEMA, objectType: 'table', name: table.name },
          },
          precheck: [],
          execute: [{ description: `create table ${qualified(table.name)}`, sql: table.create }],
          postcheck: [
            {
              description: `verify table ${qualified(table.name)} exists`,
              sql: tableExists,
              params: [qualified(table.name)],
            },
          ],
        }),
      ),
      ...tables.map((table) =>
        checkColumns(table, SCHEMA, `_prisma.check-columns.${table.name}`, ''),
      ),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
