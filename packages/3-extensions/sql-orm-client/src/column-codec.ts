import type { Contract } from '@internal/contract/types';
import type { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { storageTableForContract } from './storage-resolution';

export function resolveColumn(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  columnName: string,
): { readonly codecId: string; readonly nullable: boolean } | undefined {
  let table: StorageTable;
  try {
    table = storageTableForContract(contract, namespaceId, tableName);
  } catch {
    return undefined;
  }
  const column = table.columns[columnName];
  if (!column) return undefined;
  return { codecId: column.codecId, nullable: column.nullable };
}

export function codecTraits(context: ExecutionContext, codecId: string): readonly string[] {
  return context.codecDescriptors.descriptorFor(codecId)?.traits ?? [];
}

export function hasTrait(context: ExecutionContext, codecId: string, trait: string): boolean {
  return codecTraits(context, codecId).includes(trait);
}
