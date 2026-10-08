import type { Contract } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import { notOk, ok, type Result } from '@internal/utils/result';
import type { StructuredError } from '@internal/utils/structured-error';
import { sqlFamilyError } from '../errors';
import type { SchemaTables } from './schema-tables';

export const TABLE_RENAME_UNMATCHED_CODE = 'MIGRATION.TABLE_RENAME_UNMATCHED';

/**
 * A table rename as a `renameTable` call or a guard's advice states it: `namespaceId` is
 * `undefined` when the namespace is left to the contracts.
 */
export interface TableRenameRequest {
  readonly namespaceId: string | undefined;
  readonly from: string;
  readonly to: string;
}

/** A table rename in a known namespace. */
export interface TableRename {
  readonly namespaceId: string;
  readonly from: string;
  readonly to: string;
}

function tableLabel(namespaceId: string | undefined, tableName: string): string {
  return namespaceId === undefined || namespaceId === UNBOUND_NAMESPACE_ID
    ? tableName
    : `${namespaceId}.${tableName}`;
}

function declares(contract: Contract<SqlStorage>, namespaceId: string, tableName: string): boolean {
  return Object.hasOwn(contract.storage.namespaces[namespaceId]?.entries.table ?? {}, tableName);
}

/**
 * Refuses a `renameTable` call that does not match the migration's contracts, with
 * `MIGRATION.TABLE_RENAME_UNMATCHED`.
 */
export function unmatchedTableRename(rename: TableRenameRequest, reason: string): StructuredError {
  return sqlFamilyError(
    TABLE_RENAME_UNMATCHED_CODE,
    `renameTable "${tableLabel(rename.namespaceId, rename.from)}" to "${rename.to}" does not match the migration's contracts: ${reason}.`,
    {
      why: "renameTable must name a table as the migration's earlier rename operations leave it, and a new name that the end contract has and that no earlier rename operation has already produced. Order the renameTable calls in the sequence the renames happen, make the rename its own schema change, and check the spelling, the table and the namespace.",
      meta: { from: rename.from, to: rename.to },
    },
  );
}

/** Why a table rename does not match the schema it renames in and the end contract. */
export type TableRenameMismatch =
  | { readonly kind: 'tableMissing' }
  | { readonly kind: 'tableInManyNamespaces'; readonly namespaceIds: readonly string[] }
  | { readonly kind: 'nameTaken'; readonly namespaceId: string; readonly taken: string }
  | { readonly kind: 'notInEndContract'; readonly namespaceId: string };

/**
 * Checks a table rename: the table must exist in `previous` (in exactly one namespace when the
 * namespace is not given), and the new name must exist in the end contract and not in `previous`.
 */
export function checkTableRename(
  previous: SchemaTables,
  endContract: Contract<SqlStorage>,
  rename: TableRenameRequest,
): Result<TableRename, TableRenameMismatch> {
  const namespaceIds =
    rename.namespaceId === undefined
      ? previous.namespacesWithTable(rename.from)
      : previous.hasTable(rename.namespaceId, rename.from)
        ? [rename.namespaceId]
        : [];
  const [namespaceId, ...others] = namespaceIds;
  if (namespaceId === undefined) return notOk({ kind: 'tableMissing' });
  if (others.length > 0) return notOk({ kind: 'tableInManyNamespaces', namespaceIds });
  const [taken] = previous
    .tablesNamed(namespaceId, rename.to)
    .filter((table) => table !== rename.from);
  if (taken !== undefined) return notOk({ kind: 'nameTaken', namespaceId, taken });
  if (!declares(endContract, namespaceId, rename.to)) {
    return notOk({ kind: 'notInEndContract', namespaceId });
  }
  return ok({ namespaceId, from: rename.from, to: rename.to });
}

/** The reason `MIGRATION.TABLE_RENAME_UNMATCHED` gives for a mismatch. */
export function tableRenameMismatchReason(
  rename: TableRenameRequest,
  mismatch: TableRenameMismatch,
): string {
  switch (mismatch.kind) {
    case 'tableMissing':
      return `table "${tableLabel(rename.namespaceId, rename.from)}" does not exist at this point of the migration`;
    case 'tableInManyNamespaces':
      return `table "${rename.from}" is declared in more than one namespace (${mismatch.namespaceIds.join(', ')}); name its namespace`;
    case 'nameTaken':
      return `table "${tableLabel(mismatch.namespaceId, rename.to)}" already exists at this point of the migration${mismatch.taken === rename.to ? '' : ` as "${mismatch.taken}"`}`;
    case 'notInEndContract':
      return `table "${tableLabel(mismatch.namespaceId, rename.to)}" does not exist in the end contract`;
  }
}

/**
 * Resolves a table a migration renames with {@link checkTableRename}, refusing a mismatch with
 * `MIGRATION.TABLE_RENAME_UNMATCHED`.
 */
export function resolveTableRenameAgainst(
  previous: SchemaTables,
  endContract: Contract<SqlStorage>,
  rename: TableRenameRequest,
): Result<TableRename, StructuredError> {
  const checked = checkTableRename(previous, endContract, rename);
  if (!checked.ok) {
    return notOk(unmatchedTableRename(rename, tableRenameMismatchReason(rename, checked.failure)));
  }
  return ok(checked.value);
}
