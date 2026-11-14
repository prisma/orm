import type { ContractMarkerRecord } from '@internal/contract/types';
import { withMarkerReadErrorHandling } from '@internal/errors/execution';
import { parseContractMarkerRow } from '@internal/family-sql/verify';
import type { MarkerReadResult } from '@internal/sql-relational-core/ast';
import { decodeMysqlDatetime } from '@internal/target-mysql/codecs';
import { MARKER_TABLE_NAME } from '@internal/target-mysql/control-tables';
import { quoteIdentifier } from '@internal/target-mysql/sql-utils';
import { structuredError } from '@internal/utils/structured-error';

/** What reading the marker needs of a connection: one statement at a time, its rows returned whole. */
export interface MarkerQuery {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }>;
}

const MARKER_COLUMNS =
  'space, core_hash, profile_hash, contract_json, canonical_version, updated_at, app_tag, meta, invariants';

/** Whether the connection's database has the table `name`. */
export async function tableExists(driver: MarkerQuery, name: string): Promise<boolean> {
  const { rows } = await driver.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [name],
  );
  return rows.length > 0;
}

export function parseJsonColumn(column: string, text: unknown): unknown {
  if (typeof text !== 'string') return text;
  try {
    return JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw structuredError(
      'CONTRACT.MARKER_ROW_CORRUPT',
      `Invalid contract marker row: ${column} is not valid JSON: ${detail}`,
      { meta: { detail }, cause: error },
    );
  }
}

/** A marker row as MySQL's text arrives, in the shape the family's marker parser reads. */
export function decodeMysqlMarkerRow(row: Readonly<Record<string, unknown>>): ContractMarkerRecord {
  const canonicalVersion = row['canonical_version'];
  const updatedAt = row['updated_at'];
  return parseContractMarkerRow({
    ...row,
    canonical_version:
      typeof canonicalVersion === 'string' ? Number(canonicalVersion) : canonicalVersion,
    updated_at: typeof updatedAt === 'string' ? decodeMysqlDatetime(updatedAt) : updatedAt,
    invariants: parseJsonColumn('invariants', row['invariants']),
  });
}

export async function readMarkerRows(
  driver: MarkerQuery,
  space: string | undefined,
): Promise<readonly Readonly<Record<string, unknown>>[] | undefined> {
  if (!(await tableExists(driver, MARKER_TABLE_NAME))) return undefined;
  const select = `SELECT ${MARKER_COLUMNS} FROM ${quoteIdentifier(MARKER_TABLE_NAME)}`;
  const { rows } =
    space === undefined
      ? await driver.query(select)
      : await driver.query(`${select} WHERE space = ?`, [space]);
  return rows;
}

/** The marker of `space`, or whether the marker table or the space's row is missing. */
export async function readMarkerResult(
  driver: MarkerQuery,
  space: string,
): Promise<MarkerReadResult> {
  return withMarkerReadErrorHandling(
    async () => {
      const rows = await readMarkerRows(driver, space);
      if (rows === undefined) return { kind: 'no-table' };
      const [row] = rows;
      return row === undefined
        ? { kind: 'absent' }
        : { kind: 'present', record: decodeMysqlMarkerRow(row) };
    },
    { space, markerLocation: MARKER_TABLE_NAME },
  );
}
