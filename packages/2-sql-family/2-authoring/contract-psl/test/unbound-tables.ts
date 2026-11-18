import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage, StorageTable } from '@internal/sql-contract/types';

export function unboundTables(storage: SqlStorage): Readonly<Record<string, StorageTable>> {
  const unboundNs = storage.namespaces[UNBOUND_NAMESPACE_ID];
  const unbound = unboundNs !== undefined ? (unboundNs.entries.table ?? {}) : undefined;
  if (unbound !== undefined && Object.keys(unbound).length > 0) {
    return unbound;
  }
  const publicNs = storage.namespaces['public'];
  return publicNs !== undefined ? (publicNs.entries.table ?? {}) : {};
}
