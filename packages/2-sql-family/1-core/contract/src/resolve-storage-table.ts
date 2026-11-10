import { entityAt } from '@internal/framework-components/ir';
import { contractError } from './contract-errors';
import type { SqlStorage } from './ir/sql-storage';
import type { StorageTable } from './ir/storage-table';

export interface ResolvedStorageTable {
  readonly namespaceId: string;
  readonly table: StorageTable;
}

/**
 * Resolve a bare storage table name to its namespace coordinate and table IR.
 *
 * When `namespaceId` is supplied, the table is resolved strictly within that
 * namespace (no scan). When omitted, a bare name unique across namespaces
 * resolves to its sole namespace; a bare name declared in more than one
 * namespace throws a fail-fast diagnostic naming the candidate namespaces
 * rather than silently selecting the first match.
 */
export function resolveStorageTable(
  storage: SqlStorage,
  tableName: string,
  namespaceId?: string,
): ResolvedStorageTable | undefined {
  if (namespaceId !== undefined) {
    const table = entityAt<StorageTable>(storage, {
      namespaceId,
      entityKind: 'table',
      entityName: tableName,
    });
    return table === undefined ? undefined : { namespaceId, table };
  }

  const matches: ResolvedStorageTable[] = [];
  for (const candidateNamespaceId of Object.keys(storage.namespaces)) {
    const table = entityAt<StorageTable>(storage, {
      namespaceId: candidateNamespaceId,
      entityKind: 'table',
      entityName: tableName,
    });
    if (table !== undefined) {
      matches.push({ namespaceId: candidateNamespaceId, table });
    }
  }

  if (matches.length > 1) {
    const candidates = matches
      .map((match) => match.namespaceId)
      .sort()
      .join(', ');
    throw contractError(
      'CONTRACT.TABLE_AMBIGUOUS',
      `Storage table "${tableName}" is ambiguous across namespaces [${candidates}]; qualify it with a namespace coordinate.`,
      { meta: { tableName, candidates: matches.map((match) => match.namespaceId).sort() } },
    );
  }

  return matches[0];
}
