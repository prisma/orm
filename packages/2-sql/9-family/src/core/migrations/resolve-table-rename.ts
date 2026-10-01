import type { Contract } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import { notOk, ok, type Result } from '@internal/utils/result';
import type { StructuredError } from '@internal/utils/structured-error';
import { sqlFamilyError } from '../errors';
import type { SchemaTables } from './schema-tables';

export const TABLE_RENAME_UNMATCHED_CODE = 'MIGRATION.TABLE_RENAME_UNMATCHED';

/**
 * A table a migration renames: `namespaceId` is `undefined` when the migration leaves the namespace
 * to the contracts.
 */
export interface TableRename {
  readonly namespaceId: string | undefined;
  readonly from: string;
  readonly to: string;
}

/** A rename after its table was found, with the namespace that declares it. */
export interface ResolvedTableRename {
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
export function unmatchedTableRename(rename: TableRename, reason: string): StructuredError {
  return sqlFamilyError(
    TABLE_RENAME_UNMATCHED_CODE,
    `renameTable "${tableLabel(rename.namespaceId, rename.from)}" to "${rename.to}" does not match the migration's contracts: ${reason}.`,
    {
      why: "renameTable must name a table as the migration's earlier rename operations leave it, and a new name that the end contract has and that no earlier rename operation has already produced. Order the renameTable calls in the sequence the renames happen, make the rename its own schema change, and check the spelling, the table and the namespace.",
      meta: { from: rename.from, to: rename.to },
    },
  );
}

/**
 * Resolves a table a migration renames: the table must exist in `previous` (in exactly one
 * namespace when the namespace is not given), and the new name must exist in the end contract and
 * not in `previous`; otherwise the rename is refused with `MIGRATION.TABLE_RENAME_UNMATCHED`.
 */
export function resolveTableRenameAgainst(
  previous: SchemaTables,
  endContract: Contract<SqlStorage>,
  rename: TableRename,
): Result<ResolvedTableRename, StructuredError> {
  const namespaceIds =
    rename.namespaceId === undefined
      ? previous.namespacesWithTable(rename.from)
      : previous.hasTable(rename.namespaceId, rename.from)
        ? [rename.namespaceId]
        : [];
  const [namespaceId, ...others] = namespaceIds;
  if (namespaceId === undefined) {
    return notOk(
      unmatchedTableRename(
        rename,
        `table "${tableLabel(rename.namespaceId, rename.from)}" does not exist at this point of the migration`,
      ),
    );
  }
  if (others.length > 0) {
    return notOk(
      unmatchedTableRename(
        rename,
        `table "${rename.from}" is declared in more than one namespace (${namespaceIds.join(', ')}); name its namespace`,
      ),
    );
  }
  if (previous.hasTable(namespaceId, rename.to)) {
    return notOk(
      unmatchedTableRename(
        rename,
        `table "${tableLabel(namespaceId, rename.to)}" already exists at this point of the migration`,
      ),
    );
  }
  if (!declares(endContract, namespaceId, rename.to)) {
    return notOk(
      unmatchedTableRename(
        rename,
        `table "${tableLabel(namespaceId, rename.to)}" does not exist in the end contract`,
      ),
    );
  }
  return ok({ namespaceId, from: rename.from, to: rename.to });
}
