import type { Contract } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import { DEFAULT_NAMESPACE_ID } from '../namespace-ids';
import { isPostgresSchema } from '../postgres-schema';

/**
 * Given the contract's storage and a namespace id, returns the live Postgres
 * DDL schema name that namespace maps to. A named Postgres namespace dispatches
 * to its `ddlSchemaName(storage)`; the unbound sentinel resolves to
 * `DEFAULT_NAMESPACE_ID` (the search-path default for offline planning); a
 * bare object payload (used by some tests) falls back to the namespace id
 * itself.
 */
export function resolveDdlSchemaForNamespaceStorage(
  storage: SqlStorage,
  namespaceId: string,
): string {
  if (namespaceId === UNBOUND_NAMESPACE_ID) {
    return DEFAULT_NAMESPACE_ID;
  }
  const namespace = storage.namespaces[namespaceId];
  if (namespace && isPostgresSchema(namespace)) {
    return namespace.ddlSchemaName(storage);
  }
  return namespaceId;
}

/**
 * The schema name a planned call carries for a namespace: the unbound sentinel stays as it is, so the call renders without a schema, and a named namespace resolves to its DDL schema.
 */
export function emissionSchemaForNamespace(
  contract: Contract<SqlStorage>,
  namespaceId: string,
): string {
  return namespaceId === UNBOUND_NAMESPACE_ID
    ? UNBOUND_NAMESPACE_ID
    : resolveDdlSchemaForNamespaceStorage(contract.storage, namespaceId);
}
