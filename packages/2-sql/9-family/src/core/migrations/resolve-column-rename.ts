import type { Contract } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import { notOk, ok, type Result } from '@internal/utils/result';
import type { StructuredError } from '@internal/utils/structured-error';
import { sqlFamilyError } from '../errors';
import type { SchemaTables } from './schema-tables';

export const COLUMN_RENAME_UNMATCHED_CODE = 'MIGRATION.COLUMN_RENAME_UNMATCHED';

/**
 * A column rename as a `renameColumn` call states it: `namespaceId` is `undefined` when the
 * namespace is left to the contracts.
 */
export interface ColumnRenameRequest {
  readonly namespaceId: string | undefined;
  readonly table: string;
  readonly from: string;
  readonly to: string;
}

/** A column rename on a table in a known namespace. */
export interface ColumnRename {
  readonly namespaceId: string;
  readonly table: string;
  readonly from: string;
  readonly to: string;
}

function tableLabel(namespaceId: string | undefined, table: string): string {
  return namespaceId === undefined || namespaceId === UNBOUND_NAMESPACE_ID
    ? table
    : `${namespaceId}.${table}`;
}

function columnLabel(namespaceId: string | undefined, table: string, column: string): string {
  return `"${tableLabel(namespaceId, table)}"."${column}"`;
}

function declaresColumn(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  table: string,
  column: string,
): boolean {
  const columns = contract.storage.namespaces[namespaceId]?.entries.table?.[table]?.columns;
  return columns !== undefined && Object.hasOwn(columns, column);
}

/**
 * Refuses a `renameColumn` call that does not match the migration's contracts, with
 * `MIGRATION.COLUMN_RENAME_UNMATCHED`.
 */
export function unmatchedColumnRename(
  rename: ColumnRenameRequest,
  reason: string,
): StructuredError {
  return sqlFamilyError(
    COLUMN_RENAME_UNMATCHED_CODE,
    `renameColumn ${columnLabel(rename.namespaceId, rename.table, rename.from)} to "${rename.to}" does not match the migration's contracts: ${reason}.`,
    {
      why: "renameColumn must name a table and a column as the migration's earlier rename operations leave them, and a new column name that the end contract has on that table and that the table does not have yet. Order the rename calls in the sequence the renames happen, and check the names of the table, the column and the namespace.",
      meta: { table: rename.table, from: rename.from, to: rename.to },
    },
  );
}

/** Why a column rename does not match the schema it renames in and the end contract. */
export type ColumnRenameMismatch =
  | { readonly kind: 'tableMissing' }
  | { readonly kind: 'tableInManyNamespaces'; readonly namespaceIds: readonly string[] }
  | { readonly kind: 'columnMissing'; readonly namespaceId: string }
  | { readonly kind: 'nameTaken'; readonly namespaceId: string; readonly taken: string }
  | { readonly kind: 'notInEndContract'; readonly namespaceId: string };

/**
 * Checks a column rename: the table must exist in `previous` (in exactly one namespace when the
 * namespace is not given) with the old column and without the new one, and the end contract must
 * have the new column on that table.
 */
export function checkColumnRename(
  previous: SchemaTables,
  endContract: Contract<SqlStorage>,
  rename: ColumnRenameRequest,
): Result<ColumnRename, ColumnRenameMismatch> {
  const namespaceIds =
    rename.namespaceId === undefined
      ? previous.namespacesWithTable(rename.table)
      : previous.hasTable(rename.namespaceId, rename.table)
        ? [rename.namespaceId]
        : [];
  const [namespaceId, ...others] = namespaceIds;
  if (namespaceId === undefined) return notOk({ kind: 'tableMissing' });
  if (others.length > 0) return notOk({ kind: 'tableInManyNamespaces', namespaceIds });
  if (!previous.hasColumn(namespaceId, rename.table, rename.from)) {
    return notOk({ kind: 'columnMissing', namespaceId });
  }
  const [taken] = previous
    .columnsNamed(namespaceId, rename.table, rename.to)
    .filter((column) => column !== rename.from);
  if (taken !== undefined) return notOk({ kind: 'nameTaken', namespaceId, taken });
  if (!declaresColumn(endContract, namespaceId, rename.table, rename.to)) {
    return notOk({ kind: 'notInEndContract', namespaceId });
  }
  return ok({ namespaceId, table: rename.table, from: rename.from, to: rename.to });
}

/** The reason `MIGRATION.COLUMN_RENAME_UNMATCHED` gives for a mismatch. */
export function columnRenameMismatchReason(
  rename: ColumnRenameRequest,
  mismatch: ColumnRenameMismatch,
): string {
  switch (mismatch.kind) {
    case 'tableMissing':
      return `table "${tableLabel(rename.namespaceId, rename.table)}" does not exist at this point of the migration`;
    case 'tableInManyNamespaces':
      return `table "${rename.table}" is declared in more than one namespace (${mismatch.namespaceIds.join(', ')}); name its namespace`;
    case 'columnMissing':
      return `column ${columnLabel(mismatch.namespaceId, rename.table, rename.from)} does not exist at this point of the migration`;
    case 'nameTaken':
      return `column ${columnLabel(mismatch.namespaceId, rename.table, rename.to)} already exists at this point of the migration${mismatch.taken === rename.to ? '' : ` as "${mismatch.taken}"`}`;
    case 'notInEndContract':
      return `column ${columnLabel(mismatch.namespaceId, rename.table, rename.to)} does not exist in the end contract`;
  }
}

/**
 * Resolves a column a migration renames with {@link checkColumnRename}, refusing a mismatch with
 * `MIGRATION.COLUMN_RENAME_UNMATCHED`.
 */
export function resolveColumnRenameAgainst(
  previous: SchemaTables,
  endContract: Contract<SqlStorage>,
  rename: ColumnRenameRequest,
): Result<ColumnRename, StructuredError> {
  const checked = checkColumnRename(previous, endContract, rename);
  if (!checked.ok) {
    return notOk(
      unmatchedColumnRename(rename, columnRenameMismatchReason(rename, checked.failure)),
    );
  }
  return ok(checked.value);
}
