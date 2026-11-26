#!/usr/bin/env -S node
/**
 * The first migration of the `_prisma` contract space: Prisma's own tables in the `_prisma` schema.
 *
 * Written by hand, because the planner cannot produce a conditional rename or column checks. Every step is skipped when its result already holds, so it also brings up to date a database a release candidate set up, whose tables are in the schema `prisma_contract`. Each table's columns are checked, so a database from before the release candidates, whose tables are in an older form, stops here unchanged.
 *
 * Re-emit `ops.json` and `migration.json` after editing: `node migration.ts --config <a config for the Postgres target>`.
 */
import { Migration, MigrationCLI, rawSql } from '../../src/exports/migration';

const SCHEMA = '_prisma';
const RELEASE_CANDIDATE_SCHEMA = 'prisma_contract';

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
const columnHasForm = `SELECT EXISTS (
  SELECT 1 FROM pg_attribute
  WHERE attrelid = to_regclass($1) AND attname = $2 AND NOT attisdropped
    AND format_type(atttypid, atttypmod) = $3 AND attnotnull = $4
) AS "result"`;

function qualified(table: string): string {
  return `"${SCHEMA}"."${table}"`;
}

function nullability(column: ExpectedColumn): string {
  return column.notNull ? 'NOT NULL' : 'nullable';
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
        rawSql({
          id: `_prisma.check-columns.${table.name}`,
          label: `Check the columns of table ${qualified(table.name)}`,
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: { schema: SCHEMA, objectType: 'table', name: table.name },
          },
          precheck: table.columns.map((column) => ({
            description: `ensure table ${qualified(table.name)} has column "${column.name}" ${column.type} ${nullability(column)}. A table without it was written by a Prisma release before the release candidates of Prisma 8, and is not brought up to date: the upgrade instructions of Prisma 8 say what to do`,
            sql: columnHasForm,
            params: [qualified(table.name), column.name, column.type, column.notNull],
          })),
          execute: [],
          postcheck: [],
        }),
      ),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
