import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import {
  type AnyQueryAst,
  type LoweredStatement,
  RawExpr,
} from '@internal/sql-relational-core/ast';
import { SQLITE_DATETIME_CODEC_ID } from '@internal/target-sqlite/codec-ids';
import { SQLITE_NOW_EXPRESSION } from '@internal/target-sqlite/codecs';
import {
  datetime,
  integer,
  jsonText,
  sqliteTable,
  text,
} from '@internal/target-sqlite/contract-free';
import { structuredError } from '@internal/utils/structured-error';
import { encodeControlQueryParams } from './control-codecs';

export const marker = sqliteTable('_prisma_marker', {
  space: text(),
  core_hash: text(),
  profile_hash: text(),
  contract_json: jsonText({ nullable: true }),
  canonical_version: integer({ nullable: true }),
  updated_at: datetime(),
  app_tag: text({ nullable: true }),
  meta: jsonText({ nullable: true }),
  invariants: jsonText(),
});

/**
 * Writeable subset of `_prisma_ledger`. Omits the DB-generated `id`
 * (`INTEGER PRIMARY KEY AUTOINCREMENT`) and `created_at` (default
 * `strftime(...)`).
 */
export const ledger = sqliteTable('_prisma_ledger', {
  space: text(),
  migration_name: text(),
  migration_hash: text(),
  origin_core_hash: text({ nullable: true }),
  destination_core_hash: text(),
  operations: jsonText(),
});

/**
 * Read-side handle covering every column of `_prisma_ledger`, including
 * the DB-generated `id` (for ORDER BY) and `created_at`.
 */
export const ledgerReadShape = sqliteTable('_prisma_ledger', {
  id: integer(),
  space: text(),
  migration_name: text(),
  migration_hash: text(),
  origin_core_hash: text({ nullable: true }),
  destination_core_hash: text(),
  operations: jsonText(),
  created_at: text(),
});

export const sqliteCatalog = sqliteTable('sqlite_master', { type: text(), name: text() });

export const NOW = new RawExpr({
  parts: [SQLITE_NOW_EXPRESSION],
  returns: { codecId: SQLITE_DATETIME_CODEC_ID, nullable: false },
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

export function decodeSqliteMarkerRow(row: unknown): unknown {
  if (typeof row !== 'object' || row === null || !('invariants' in row)) {
    return row;
  }
  const record = row as { invariants: unknown };
  if (typeof record.invariants !== 'string') return row;
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.invariants);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw structuredError(
      'CONTRACT.MARKER_ROW_CORRUPT',
      `Invalid contract marker row: invariants is not valid JSON: ${detail}`,
      { meta: { detail }, cause: err },
    );
  }
  return { ...record, invariants: parsed };
}

export type SqliteMarkerWriteDriver = SqlControlDriverInstance<'sqlite'>;
