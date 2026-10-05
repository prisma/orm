import type { Contract } from '@internal/contract/types';
import type { SqlStorage, StorageColumn } from '@internal/sql-contract/types';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { resolveTableForContract } from './storage-resolution';

export function resolveColumn(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  columnName: string,
): StorageColumn | undefined {
  return resolveTableForContract(contract, namespaceId, tableName)?.table.columns[columnName];
}

export function codecTraits(context: ExecutionContext, codecId: string): readonly string[] {
  return context.codecDescriptors.descriptorFor(codecId)?.traits ?? [];
}

export function hasTrait(context: ExecutionContext, codecId: string, trait: string): boolean {
  return codecTraits(context, codecId).includes(trait);
}
