import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import {
  type AnyQueryAst,
  type LoweredStatement,
  RawExpr,
} from '@internal/sql-relational-core/ast';
import { PG_TIMESTAMPTZ_STRING_CODEC_ID } from '@internal/target-postgres/codec-ids';
import {
  int4,
  int8,
  jsonb,
  pgTable,
  text,
  textArray,
  timestamptz,
} from '@internal/target-postgres/contract-free';
import { encodeControlQueryParams } from './control-codecs';

export const marker = pgTable(
  { name: 'marker', schema: 'prisma_contract' },
  {
    space: text(),
    core_hash: text(),
    profile_hash: text(),
    contract_json: jsonb({ nullable: true }),
    canonical_version: int4({ nullable: true }),
    updated_at: timestamptz(),
    app_tag: text({ nullable: true }),
    meta: jsonb({ nullable: true }),
    invariants: textArray(),
  },
);

/**
 * Writeable subset of the `prisma_contract.ledger` table. Omits the
 * DB-generated `id` (bigserial) and `created_at` (default `now()`) so the
 * insert path doesn't have to pass them.
 */
export const ledger = pgTable(
  { name: 'ledger', schema: 'prisma_contract' },
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
  { name: 'contract', schema: 'prisma_contract' },
  {
    core_hash: text(),
    contract_json: jsonb(),
  },
);

/**
 * Read-side handle covering every column of `prisma_contract.ledger`,
 * including the DB-generated `id` (for ORDER BY) and `created_at`.
 */
export const ledgerReadShape = pgTable(
  { name: 'ledger', schema: 'prisma_contract' },
  {
    id: int8(),
    space: text(),
    migration_name: text(),
    migration_hash: text(),
    origin_core_hash: text({ nullable: true }),
    destination_core_hash: text(),
    operations: jsonb(),
    created_at: timestamptz(),
  },
);

export const infoSchemaTables = pgTable(
  { name: 'tables', schema: 'information_schema' },
  { table_schema: text(), table_name: text() },
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
