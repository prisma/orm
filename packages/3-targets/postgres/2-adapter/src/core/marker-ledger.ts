import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import {
  type AnyQueryAst,
  type LoweredStatement,
  RawExpr,
} from '@internal/sql-relational-core/ast';
import { PG_TIMESTAMPTZ_STRING_CODEC_ID } from '@internal/target-postgres/codec-ids';
import {
  int8,
  jsonb,
  PRISMA_TABLE_NAMES,
  PRISMA_TABLES_SCHEMA,
  type PrismaTableName,
  pgTable,
  type RELEASE_CANDIDATE_MARKER_TABLE,
  text,
  textArray,
  timestamptz,
} from '@internal/target-postgres/contract-free';
import { encodeControlQueryParams } from './control-codecs';

/** One row per contract space: the hashes of the contract it was signed with, its invariants, and when it was signed. */
export const signatures = pgTable(
  { name: PRISMA_TABLE_NAMES.signatures, schema: PRISMA_TABLES_SCHEMA },
  {
    space: text(),
    core_hash: text(),
    profile_hash: text(),
    invariants: textArray(),
    signed_at: timestamptz(),
  },
);

/**
 * Writeable subset of the `_prisma.ledger` table. Omits the
 * DB-generated `id` (bigserial) and `created_at` (default `now()`) so the
 * insert path doesn't have to pass them.
 */
export const ledger = pgTable(
  { name: PRISMA_TABLE_NAMES.ledger, schema: PRISMA_TABLES_SCHEMA },
  {
    space: text(),
    migration_name: text(),
    migration_hash: text(),
    origin_core_hash: text({ nullable: true }),
    destination_core_hash: text(),
    operations: jsonb(),
  },
);

/**
 * Content-addressed contract store: one row per distinct contract, keyed
 * by its storage hash. The ledger's `origin_core_hash` /
 * `destination_core_hash` resolve here by hash equality, so both
 * endpoints of every edge are direct lookups and a contract revisited by
 * a rollback cycle is stored exactly once (upsert DO NOTHING).
 */
export const ledgerContract = pgTable(
  { name: PRISMA_TABLE_NAMES.contract, schema: PRISMA_TABLES_SCHEMA },
  {
    core_hash: text(),
    contract_json: jsonb(),
  },
);

/**
 * Read-side handle covering every column of `_prisma.ledger`,
 * including the DB-generated `id` (for ORDER BY) and `created_at`.
 */
export const ledgerReadShape = pgTable(
  { name: PRISMA_TABLE_NAMES.ledger, schema: PRISMA_TABLES_SCHEMA },
  {
    id: int8(),
    space: text(),
    migration_name: text(),
    migration_hash: text(),
    origin_core_hash: text({ nullable: true }),
    origin_profile_hash: text({ nullable: true }),
    destination_core_hash: text(),
    destination_profile_hash: text({ nullable: true }),
    operations: jsonb(),
    created_at: timestamptz(),
  },
);

export const infoSchemaTables = pgTable(
  { name: 'tables', schema: 'information_schema' },
  { table_schema: text(), table_name: text() },
);

export const infoSchemaColumns = pgTable(
  { name: 'columns', schema: 'information_schema' },
  { table_schema: text(), table_name: text(), column_name: text() },
);

export const NOW = new RawExpr({
  parts: ['now()'],
  returns: { codecId: PG_TIMESTAMPTZ_STRING_CODEC_ID, nullable: false },
});

type Lower = (query: AnyQueryAst) => LoweredStatement;

type MarkerDriver = {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: ReadonlyArray<Row> }>;
};

export function mergeInvariants(
  current: readonly string[],
  incoming: readonly string[],
): readonly string[] {
  return [...new Set([...current, ...incoming])].sort();
}

export async function execute(
  lower: Lower,
  driver: MarkerDriver,
  query: AnyQueryAst,
): Promise<readonly Record<string, unknown>[]> {
  const lowered = lower(query);
  const encoded = await encodeControlQueryParams(lowered, query);
  const result = await driver.query(lowered.sql, encoded);
  return result.rows;
}

export type PostgresMarkerDriver = MarkerDriver;
export type PostgresMarkerLower = Lower;
export type PostgresMarkerWriteDriver = SqlControlDriverInstance<'postgres'>;

/** Whether one of Prisma's own tables exists in `schema`. Reads `information_schema.tables`, so a database without the schema answers no instead of raising "relation does not exist". */
export async function prismaTableExists(
  lower: Lower,
  driver: MarkerDriver,
  table: PrismaTableName | typeof RELEASE_CANDIDATE_MARKER_TABLE,
  schema: string = PRISMA_TABLES_SCHEMA,
): Promise<boolean> {
  const probe = infoSchemaTables
    .select(infoSchemaTables.table_schema)
    .where(infoSchemaTables.table_schema.eq(schema).and(infoSchemaTables.table_name.eq(table)))
    .build();
  return (await execute(lower, driver, probe)).length > 0;
}

/** Whether one of Prisma's own tables in `schema` has every column in `columns`, by name. */
export async function prismaTableHasColumns(
  lower: Lower,
  driver: MarkerDriver,
  table: PrismaTableName,
  columns: readonly string[],
  schema: string = PRISMA_TABLES_SCHEMA,
): Promise<boolean> {
  const probe = infoSchemaColumns
    .select(infoSchemaColumns.column_name)
    .where(infoSchemaColumns.table_schema.eq(schema).and(infoSchemaColumns.table_name.eq(table)))
    .build();
  const present = new Set((await execute(lower, driver, probe)).map((row) => row['column_name']));
  return columns.every((column) => present.has(column));
}
