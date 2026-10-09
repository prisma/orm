import type { Contract } from '@internal/contract/types';
import {
  type ResolvedStorageTable,
  resolveStorageTable,
} from '@internal/sql-contract/resolve-storage-table';
import type { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { type CodecRef, TableSource } from '@internal/sql-relational-core/ast';
import { codecRefForStorageColumn } from '@internal/sql-relational-core/codec-descriptor-registry';
import { ormError } from './orm-errors';

export type { ResolvedStorageTable };

export function resolveTableForContract(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
): ResolvedStorageTable | undefined {
  return resolveStorageTable(contract.storage, tableName, namespaceId);
}

export function requireStorageTableForContract(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
): ResolvedStorageTable {
  const resolved = resolveTableForContract(contract, namespaceId, tableName);
  if (resolved === undefined) {
    throw ormError('ORM.TABLE_UNKNOWN', `Unknown table "${tableName}"`, {
      meta: { namespaceId, tableName },
    });
  }
  return resolved;
}

export function storageTableForContract(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
): StorageTable {
  return requireStorageTableForContract(contract, namespaceId, tableName).table;
}

export function domainModelNamesInNamespace(
  contract: Contract<SqlStorage>,
  namespaceId: string,
): string[] {
  const namespace = contract.domain.namespaces[namespaceId];
  return namespace ? Object.keys(namespace.models) : [];
}

export function domainModelTableInNamespace(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
): string | undefined {
  const model = contract.domain.namespaces[namespaceId]?.models[modelName];
  const table = model?.storage['table'];
  return typeof table === 'string' ? table : undefined;
}

export function tableSourceForContract(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  alias?: string,
): TableSource {
  const resolved = requireStorageTableForContract(contract, namespaceId, tableName);
  const effectiveAlias = alias !== undefined && alias !== tableName ? alias : undefined;
  return TableSource.named(tableName, effectiveAlias, resolved.namespaceId);
}

export function codecRefForTableSource(
  contract: Contract<SqlStorage>,
  table: TableSource,
  column: string,
): CodecRef | undefined {
  const resolved = resolveStorageTable(contract.storage, table.name, table.namespaceId);
  return (
    resolved && codecRefForStorageColumn(contract.storage, resolved.namespaceId, table.name, column)
  );
}
