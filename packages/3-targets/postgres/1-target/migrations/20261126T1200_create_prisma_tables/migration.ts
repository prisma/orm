#!/usr/bin/env -S node
/**
 * The first migration of the `_prisma` contract space: Prisma's own tables in the `_prisma` schema.
 *
 * Written by hand, because the planner cannot produce a conditional rename, column checks or moving rows. Every step is skipped when its result already holds, so it also brings up to date a database a release candidate set up, whose tables are in the schema `prisma_contract`: it renames that schema to `_prisma`, then moves the rows of the release candidates' `marker` table into `signatures` and `config` and drops it. Each table's columns are checked, in the old schema before the rename and in `_prisma` after it, so a database whose tables are in another form, such as one from before the release candidates, stops here unchanged.
 *
 * Its names are written out here, not taken from the target's shared constants, so a later change to those cannot change this migration.
 *
 * Re-emit `ops.json` and `migration.json` after editing, from `packages/3-targets/postgres/2-adapter`: `pnpm exec tsx ../1-target/migrations/20261126T1200_create_prisma_tables/migration.ts --config prisma-tables.config.ts`.
 */
import { Migration, MigrationCLI, rawSql } from '../../src/exports/migration';

const SCHEMA = '_prisma';
const RELEASE_CANDIDATE_SCHEMA = 'prisma_contract';
const APPLICATION_SPACE = 'app';

type TableName = 'signatures' | 'config' | 'ledger' | 'contract';
type ReleaseCandidateTableName = 'marker' | 'ledger' | 'contract';

function qualified(table: TableName | ReleaseCandidateTableName, schema: string = SCHEMA): string {
  return `"${schema}"."${table}"`;
}

interface ExpectedColumn {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
}

interface TableForm<Name extends string> {
  readonly name: Name;
  readonly columns: readonly ExpectedColumn[];
}

const ledgerColumns: readonly ExpectedColumn[] = [
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
];

const contractColumns: readonly ExpectedColumn[] = [
  { name: 'core_hash', type: 'text', notNull: true },
  { name: 'created_at', type: 'timestamp with time zone', notNull: true },
  { name: 'contract_json', type: 'jsonb', notNull: true },
];

const releaseCandidateMarker: TableForm<'marker'> = {
  name: 'marker',
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
};

/** The tables the release candidates of Prisma 8 created in `prisma_contract`. */
const releaseCandidateTables: readonly TableForm<ReleaseCandidateTableName>[] = [
  releaseCandidateMarker,
  { name: 'ledger', columns: ledgerColumns },
  { name: 'contract', columns: contractColumns },
];

const tables: ReadonlyArray<TableForm<TableName> & { readonly create: string }> = [
  {
    name: 'signatures',
    create: `CREATE TABLE IF NOT EXISTS ${qualified('signatures')} (
  "space" text NOT NULL PRIMARY KEY,
  "core_hash" text NOT NULL,
  "profile_hash" text NOT NULL,
  "invariants" text[] DEFAULT '{}'::text[] NOT NULL,
  "signed_at" timestamptz DEFAULT (now()) NOT NULL
)`,
    columns: [
      { name: 'space', type: 'text', notNull: true },
      { name: 'core_hash', type: 'text', notNull: true },
      { name: 'profile_hash', type: 'text', notNull: true },
      { name: 'invariants', type: 'text[]', notNull: true },
      { name: 'signed_at', type: 'timestamp with time zone', notNull: true },
    ],
  },
  {
    name: 'config',
    create: `CREATE TABLE IF NOT EXISTS ${qualified('config')} (
  "id" boolean DEFAULT true NOT NULL PRIMARY KEY,
  "policies" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "config_single_row" CHECK ("id")
)`,
    columns: [
      { name: 'id', type: 'boolean', notNull: true },
      { name: 'policies', type: 'jsonb', notNull: true },
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
    columns: ledgerColumns,
  },
  {
    name: 'contract',
    create: `CREATE TABLE IF NOT EXISTS ${qualified('contract')} (
  "core_hash" text NOT NULL PRIMARY KEY,
  "created_at" timestamptz DEFAULT (now()) NOT NULL,
  "contract_json" jsonb NOT NULL
)`,
    columns: contractColumns,
  },
];

const schemaExists = 'SELECT to_regnamespace($1) IS NOT NULL AS "result"';
const schemaAbsent = 'SELECT to_regnamespace($1) IS NULL AS "result"';
/** `DROP SCHEMA` without `CASCADE` refuses exactly when an object depends normally on the schema, which every object in it does. */
const schemaAbsentOrEmpty = `SELECT to_regnamespace($1) IS NULL OR NOT EXISTS (
  SELECT 1 FROM pg_depend
  WHERE refclassid = 'pg_namespace'::regclass AND refobjid = to_regnamespace($1) AND deptype = 'n'
) AS "result"`;
const tableExists = 'SELECT to_regclass($1) IS NOT NULL AS "result"';
const tableAbsent = 'SELECT to_regclass($1) IS NULL AS "result"';
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
/** `ALTER SCHEMA … RENAME` and `DROP SCHEMA` need the privileges of the schema's owner, and `ALTER TABLE` those of the table's owner; a superuser has them. A schema or table that does not exist passes. */
const isSuperuser = '(SELECT rolsuper FROM pg_roles WHERE rolname = current_user)';
const absentOrHasSchemaOwnerPrivileges = `SELECT ${isSuperuser} OR NOT EXISTS (
  SELECT 1 FROM pg_namespace
  WHERE nspname = $1 AND NOT pg_has_role(current_user, nspowner, 'USAGE')
) AS "result"`;
const absentOrHasTableOwnerPrivileges = `SELECT ${isSuperuser} OR NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1 AND c.relname = $2 AND NOT pg_has_role(current_user, c.relowner, 'USAGE')
) AS "result"`;
/** `DROP TABLE` without `CASCADE` refuses exactly when an object outside the table depends normally on it, on its row type or on the array type of its rows. Reads only the catalogues, like the checks of ownership. */
const absentOrNothingDependsOnTable = `WITH "table" AS (
  SELECT c.oid, c.reltype, t.typarray
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_type t ON t.oid = c.reltype
  WHERE n.nspname = $1 AND c.relname = $2
)
SELECT NOT EXISTS (
  SELECT 1 FROM pg_depend d JOIN "table" t
    ON (d.refclassid = 'pg_class'::regclass AND d.refobjid = t.oid)
    OR (d.refclassid = 'pg_type'::regclass AND d.refobjid IN (t.reltype, t.typarray))
  WHERE d.deptype = 'n' AND NOT (d.classid = 'pg_class'::regclass AND d.objid = t.oid)
) AS "result"`;
/** Row-level security filters a read without an error, so a copy would move only the rows it shows and the drop would lose the rest. A superuser or a role with BYPASSRLS is not filtered, nor is the table's owner unless the table forces it. */
function rowSecurityHidesNoRow(schema: string, table: string): string {
  return `${isSuperuser}
  OR (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user)
  OR NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${schema} AND c.relname = ${table} AND c.relrowsecurity
      AND (c.relforcerowsecurity OR NOT pg_has_role(current_user, c.relowner, 'USAGE'))
  )`;
}
const absentOrRowSecurityHidesNoRow = `SELECT ${rowSecurityHidesNoRow('$1', '$2')} AS "result"`;
const mayCreateInDatabase = `SELECT ${isSuperuser}
  OR has_database_privilege(current_database(), 'CREATE') AS "result"`;

const ownerPrivilegesReason: Record<ReleaseCandidateTableName, string> = {
  marker: `this migration drops it once its rows are moved into ${qualified('signatures')} and ${qualified('config')}, and dropping a table needs those privileges`,
  ledger:
    "a later migration of Prisma's own tables may add a column to it, and that needs those privileges",
  contract:
    "a later migration of Prisma's own tables may add a column to it, and that needs those privileges",
};

const giveToMigratingRole = `Give the schema and its tables to the migrating role with ALTER SCHEMA "${RELEASE_CANDIDATE_SCHEMA}" OWNER TO <migrating role>, then ${releaseCandidateTables
  .map(
    (table) =>
      `ALTER TABLE ${qualified(table.name, RELEASE_CANDIDATE_SCHEMA)} OWNER TO <migrating role>`,
  )
  .join(', ')}.`;

function nullability(column: ExpectedColumn): string {
  return column.notNull ? 'NOT NULL' : 'nullable';
}

function checkColumns(
  table: TableForm<TableName | ReleaseCandidateTableName>,
  schema: string,
  id: string,
  origin: string,
  otherForm: string,
) {
  return rawSql({
    id,
    label: `Check the columns of table ${qualified(table.name, schema)}`,
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

function rowSecurityHidesNoMarkerRow(schema: string, whatTheRoleCanDo: string) {
  return {
    description: `Row-level security must not hide any row of table ${qualified('marker', schema)} from the role that runs this command, because this migration copies its rows into ${qualified('signatures')} and ${qualified('config')} and then drops it, so a row it cannot read would be lost. ${whatTheRoleCanDo}`,
    sql: absentOrRowSecurityHidesNoRow,
    params: [schema, 'marker'],
  };
}

function raiseUnlessRowSecurityHidesNoMarkerRow(check: { readonly description: string }): string {
  return `DO $$
BEGIN
  IF NOT (${rowSecurityHidesNoRow(`'${SCHEMA}'`, "'marker'")}) THEN
    RAISE EXCEPTION '%', '${check.description.replaceAll("'", "''")}';
  END IF;
END
$$`;
}

const turnOffForcedRowSecurity = (schema: string) =>
  `ALTER TABLE ${qualified('marker', schema)} NO FORCE ROW LEVEL SECURITY`;

const moveMarkerRowSecurityCheck = rowSecurityHidesNoMarkerRow(
  SCHEMA,
  `A role that owns the table can turn off forced row-level security on it with ${turnOffForcedRowSecurity(SCHEMA)}, then run the command. A role that does not own the table can do neither that nor the drop, so run the command as the table's owner, or as a role that bypasses row-level security and also owns the table.`,
);

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: '3e3fe1bcd6f092d5ff575bf3bfe9b2fe5020a50a9c25071879df08299c689ce7',
    };
  }

  override get operations() {
    return [
      ...releaseCandidateTables.map((table) =>
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
        label: `Rename schema "${RELEASE_CANDIDATE_SCHEMA}" to "${SCHEMA}"`,
        operationClass: 'widening',
        target: { id: 'postgres' },
        precheck: [
          {
            description: `Schema "${SCHEMA}" must be empty while schema "${RELEASE_CANDIDATE_SCHEMA}" exists. This release keeps Prisma's own tables in "${SCHEMA}", and "${RELEASE_CANDIDATE_SCHEMA}" holds the tables a release candidate of Prisma 8 created, so Prisma drops an empty "${SCHEMA}" and renames "${RELEASE_CANDIDATE_SCHEMA}" to it, and does not choose between them when "${SCHEMA}" holds anything. Follow the upgrade instructions before dropping either schema.`,
            sql: schemaAbsentOrEmpty,
            params: [SCHEMA],
          },
          {
            description: `The role that runs this command must have the privileges of the role that owns schema "${SCHEMA}", because Prisma drops the empty "${SCHEMA}" before it renames schema "${RELEASE_CANDIDATE_SCHEMA}" to "${SCHEMA}", and dropping a schema needs them. Give the empty schema to the migrating role with ALTER SCHEMA "${SCHEMA}" OWNER TO <migrating role>, or drop it with DROP SCHEMA "${SCHEMA}".`,
            sql: absentOrHasSchemaOwnerPrivileges,
            params: [SCHEMA],
          },
          {
            description: `The role that runs this command must have the privileges of the role that owns schema "${RELEASE_CANDIDATE_SCHEMA}", because renaming a schema needs them. Find the owners of the schema and its tables with SELECT nspowner::regrole FROM pg_namespace WHERE nspname = '${RELEASE_CANDIDATE_SCHEMA}' and SELECT relname, relowner::regrole FROM pg_class WHERE relnamespace = to_regnamespace('${RELEASE_CANDIDATE_SCHEMA}') AND relkind = 'r'. ${giveToMigratingRole}`,
            sql: absentOrHasSchemaOwnerPrivileges,
            params: [RELEASE_CANDIDATE_SCHEMA],
          },
          ...releaseCandidateTables.map((table) => ({
            description: `The role that runs this command must have the privileges of the role that owns table ${qualified(table.name, RELEASE_CANDIDATE_SCHEMA)}, because ${ownerPrivilegesReason[table.name]}. ${giveToMigratingRole}`,
            sql: absentOrHasTableOwnerPrivileges,
            params: [RELEASE_CANDIDATE_SCHEMA, table.name],
          })),
          {
            description: `No object outside table ${qualified('marker', RELEASE_CANDIDATE_SCHEMA)} may depend on it, because this migration drops it once its rows are moved into ${qualified('signatures')} and ${qualified('config')}, and PostgreSQL does not drop a table another object depends on. Drop each such object, such as a view over the table, then create them again over ${qualified('signatures')} once the command has run.`,
            sql: absentOrNothingDependsOnTable,
            params: [RELEASE_CANDIDATE_SCHEMA, 'marker'],
            meta: { tableDependents: { schema: RELEASE_CANDIDATE_SCHEMA, table: 'marker' } },
          },
          rowSecurityHidesNoMarkerRow(
            RELEASE_CANDIDATE_SCHEMA,
            `The role owns the table, as the checks before this one require, so it can turn off forced row-level security on it with ${turnOffForcedRowSecurity(RELEASE_CANDIDATE_SCHEMA)}. Or run the command once as a role that bypasses row-level security and also owns the schema and its tables.`,
          ),
          {
            description: `The role that runs this command must have the CREATE privilege on the database, because renaming schema "${RELEASE_CANDIDATE_SCHEMA}" needs it. Grant it with GRANT CREATE ON DATABASE <database> TO <migrating role>, or run the command once as a role that has it and also owns the schema and its tables.`,
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
            description: `Schema "${SCHEMA}" must exist.`,
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
              description: `Table ${qualified(table.name)} must exist.`,
              sql: tableExists,
              params: [qualified(table.name)],
            },
          ],
        }),
      ),
      checkColumns(
        releaseCandidateMarker,
        SCHEMA,
        '_prisma.check-columns.marker',
        '',
        'Prisma moves the rows of this table only in the form the release candidates of Prisma 8 created it in, and leaves a table in another form as it is.',
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
      rawSql({
        id: '_prisma.move-marker',
        label: `Move table ${qualified('marker')} into ${qualified('signatures')} and ${qualified('config')}`,
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: { schema: SCHEMA, objectType: 'table', name: 'marker' },
        },
        precheck: [moveMarkerRowSecurityCheck],
        execute: [
          {
            description: `lock table ${qualified('marker')} in SHARE mode until the command commits, so that neither its row-level security nor its rows can change before it is dropped`,
            sql: `LOCK TABLE ${qualified('marker')} IN SHARE MODE`,
          },
          {
            description: `check again, under the lock, that row-level security hides no row of ${qualified('marker')}, since its owner may have turned it on after the check before this step`,
            sql: raiseUnlessRowSecurityHidesNoMarkerRow(moveMarkerRowSecurityCheck),
          },
          {
            description: `copy each row of ${qualified('marker')} into ${qualified('signatures')}, with its hashes, its invariants and when it was written`,
            sql: `INSERT INTO ${qualified('signatures')} ("space", "core_hash", "profile_hash", "invariants", "signed_at")
SELECT "space", "core_hash", "profile_hash", "invariants", "updated_at" FROM ${qualified('marker')}`,
          },
          {
            description: `copy the policies recorded on the application's row of ${qualified('marker')}, when it records them, into ${qualified('config')}`,
            sql: `INSERT INTO ${qualified('config')} ("policies")
SELECT "meta" -> 'policies' FROM ${qualified('marker')}
WHERE "space" = '${APPLICATION_SPACE}' AND "meta" -> 'policies' IS NOT NULL`,
          },
          {
            description: `drop table ${qualified('marker')}`,
            sql: `DROP TABLE ${qualified('marker')}`,
          },
        ],
        postcheck: [
          {
            description: `Table ${qualified('marker')} must no longer exist once its rows are moved into ${qualified('signatures')} and ${qualified('config')}.`,
            sql: tableAbsent,
            params: [qualified('marker')],
          },
        ],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
