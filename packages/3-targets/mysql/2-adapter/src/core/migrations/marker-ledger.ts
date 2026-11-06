import type { LedgerEntryRecord } from '@internal/contract/types';
import { ledgerOriginFromStored } from '@internal/migration-tools/ledger-origin';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { decodeMysqlDatetime } from '@internal/target-mysql/codecs';
import { LEDGER_TABLE_NAME, MARKER_TABLE_NAME } from '@internal/target-mysql/control-tables';
import { quoteIdentifier } from '@internal/target-mysql/sql-utils';
import { parseJsonColumn, tableExists } from '../marker-read';

type Driver = SqlControlDriverInstance<'mysql'>;

const LEDGER_COLUMNS =
  'space, migration_name, migration_hash, origin_core_hash, destination_core_hash, operations, created_at';

function operationCount(operations: unknown): number {
  const parsed = typeof operations === 'string' ? parseOperations(operations) : operations;
  return Array.isArray(parsed) ? parsed.length : 0;
}

function parseOperations(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function text(row: Readonly<Record<string, unknown>>, column: string): string {
  const value = row[column];
  return typeof value === 'string' ? value : String(value);
}

/** The ledger's entries for `space`, or for every space, in the order they were applied. */
export async function readLedgerEntries(
  driver: Driver,
  space: string | undefined,
): Promise<readonly LedgerEntryRecord[]> {
  if (!(await tableExists(driver, LEDGER_TABLE_NAME))) return [];
  const select = `SELECT ${LEDGER_COLUMNS} FROM ${quoteIdentifier(LEDGER_TABLE_NAME)}`;
  const { rows } =
    space === undefined
      ? await driver.query(`${select} ORDER BY id`)
      : await driver.query(`${select} WHERE space = ? ORDER BY id`, [space]);
  return rows.map((row) => {
    const origin = row['origin_core_hash'];
    return {
      space: text(row, 'space'),
      migrationName: text(row, 'migration_name'),
      migrationHash: text(row, 'migration_hash'),
      from: ledgerOriginFromStored(typeof origin === 'string' ? origin : null),
      to: text(row, 'destination_core_hash'),
      appliedAt: decodeMysqlDatetime(text(row, 'created_at')),
      operationCount: operationCount(row['operations']),
    };
  });
}

export interface MarkerDestination {
  readonly storageHash: string;
  readonly profileHash: string;
  readonly invariants?: readonly string[];
}

const MARKER_INSERT = `INSERT INTO ${quoteIdentifier(MARKER_TABLE_NAME)} (space, core_hash, profile_hash, contract_json, canonical_version, updated_at, app_tag, meta, invariants) VALUES (?, ?, ?, NULL, NULL, CURRENT_TIMESTAMP(3), NULL, '{}', ?)`;

function markerInsertParams(space: string, destination: MarkerDestination): readonly unknown[] {
  return [
    space,
    destination.storageHash,
    destination.profileHash,
    JSON.stringify(destination.invariants ?? []),
  ];
}

/** Inserts the marker row of `space`; fails when the space already has one. */
export async function insertMarkerRow(
  driver: Driver,
  space: string,
  destination: MarkerDestination,
): Promise<void> {
  await driver.query(MARKER_INSERT, markerInsertParams(space, destination));
}

/** Writes the marker row of `space`, replacing the row the space already has. */
export async function upsertMarkerRow(
  driver: Driver,
  space: string,
  destination: MarkerDestination,
): Promise<void> {
  await driver.query(
    `${MARKER_INSERT} AS incoming ON DUPLICATE KEY UPDATE core_hash = incoming.core_hash, profile_hash = incoming.profile_hash, contract_json = incoming.contract_json, canonical_version = incoming.canonical_version, updated_at = CURRENT_TIMESTAMP(3), app_tag = incoming.app_tag, meta = incoming.meta, invariants = incoming.invariants`,
    markerInsertParams(space, destination),
  );
}

function invariantsOf(text: unknown): readonly string[] {
  const parsed = parseJsonColumn('invariants', text);
  return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
}

/**
 * Advances the marker row of `space` from `expectedFrom` to `destination`, and says whether it did. MySQL has no `RETURNING`, so the row is read and locked with `FOR UPDATE` first, inside the transaction the caller holds, and written only when it still holds `expectedFrom`. Supplied invariants are merged with the stored ones.
 */
export async function compareAndSwapMarkerRow(
  driver: Driver,
  space: string,
  expectedFrom: string,
  destination: MarkerDestination,
): Promise<boolean> {
  const { rows } = await driver.query(
    `SELECT core_hash, invariants FROM ${quoteIdentifier(MARKER_TABLE_NAME)} WHERE space = ? FOR UPDATE`,
    [space],
  );
  const [row] = rows;
  if (row === undefined || row['core_hash'] !== expectedFrom) return false;
  const invariants =
    destination.invariants === undefined
      ? undefined
      : [...new Set([...invariantsOf(row['invariants']), ...destination.invariants])].sort();
  await driver.query(
    `UPDATE ${quoteIdentifier(MARKER_TABLE_NAME)} SET core_hash = ?, profile_hash = ?, updated_at = CURRENT_TIMESTAMP(3)${invariants === undefined ? '' : ', invariants = ?'} WHERE space = ? AND core_hash = ?`,
    [
      destination.storageHash,
      destination.profileHash,
      ...(invariants === undefined ? [] : [JSON.stringify(invariants)]),
      space,
      expectedFrom,
    ],
  );
  return true;
}

/** Appends a ledger entry for `space`. */
export async function insertLedgerRow(
  driver: Driver,
  space: string,
  entry: {
    readonly from: string;
    readonly to: string;
    readonly migrationName: string;
    readonly migrationHash: string;
    readonly operations: readonly unknown[];
  },
): Promise<void> {
  await driver.query(
    `INSERT INTO ${quoteIdentifier(LEDGER_TABLE_NAME)} (space, migration_name, migration_hash, origin_core_hash, destination_core_hash, operations) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      space,
      entry.migrationName,
      entry.migrationHash,
      entry.from,
      entry.to,
      JSON.stringify(entry.operations),
    ],
  );
}
