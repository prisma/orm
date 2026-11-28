import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import {
  type AnyQueryAst,
  JoinAst,
  LiteralExpr,
  type LoweredStatement,
  ProjectionItem,
  RawExpr,
  type SelectAst,
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

/** The database's one row of settings: the policies, as the framework stores them. */
export const config = pgTable(
  { name: PRISMA_TABLE_NAMES.config, schema: PRISMA_TABLES_SCHEMA },
  { policies: jsonb() },
);

/**
 * The columns every release of Prisma 8 reads the Prisma space's own row through. A later release may add columns to `_prisma.signatures` and change the rest of Prisma's own tables, but never these, so each release recognises the row whatever release brought the database further.
 */
export const PRISMA_SPACE_SIGNATURE_COLUMNS = [
  signatures.space,
  signatures.core_hash,
  signatures.profile_hash,
  signatures.invariants,
] as const;

/** The alias under which {@link withPolicies} says whether `_prisma.config` has a row, which tells a missing row apart from policies stored as JSON `null`. */
export const CONFIG_ROW_ALIAS = 'config_row';

/** `query`, a read of `_prisma.signatures`, with the policies of `_prisma.config` beside each row, in the same statement, so a signature and the policies are read from the same state. */
export function withPolicies(query: SelectAst): SelectAst {
  return query
    .withProjection([
      ...query.projection,
      config.policies.toProjectionItem(),
      ProjectionItem.of(CONFIG_ROW_ALIAS, config.policies.isNotNull().ast),
    ])
    .withJoins([JoinAst.left(config.source, LiteralExpr.of(true))]);
}

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
