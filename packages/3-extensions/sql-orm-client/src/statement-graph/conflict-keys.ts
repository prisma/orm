import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { resolveUniqueKeyColumnSets } from '../collection-contract';
import { storageTableForContract } from '../storage-resolution';
import type { NestedCreateConflictAction } from '../types';

export type ConflictKeys = readonly (readonly string[])[];

export function conflictKeysOf(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  onConflict: NestedCreateConflictAction,
  conflictColumns: readonly string[],
): ConflictKeys {
  if (conflictColumns.length > 0) {
    return [conflictColumns];
  }
  if (onConflict === 'skip') {
    return resolveUniqueKeyColumnSets(contract, namespaceId, tableName);
  }
  const primaryKey = storageTableForContract(contract, namespaceId, tableName).primaryKey?.columns;
  return primaryKey === undefined || primaryKey.length === 0 ? [] : [primaryKey];
}

export function rowThatCannotConflict(
  rows: readonly Readonly<Record<string, unknown>>[],
  keys: ConflictKeys,
  parentLinkColumns: ReadonlySet<string>,
): number | undefined {
  const index = rows.findIndex(
    (row) =>
      !keys.some((key) =>
        key.every(
          (column) =>
            parentLinkColumns.has(column) || (row[column] !== undefined && row[column] !== null),
        ),
      ),
  );
  return index === -1 ? undefined : index;
}
