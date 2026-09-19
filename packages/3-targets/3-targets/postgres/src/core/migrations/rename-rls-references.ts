import type { ResolvedTableRename } from '@internal/family-sql/control';
import type { SqlNamespaceEntries } from '@internal/sql-contract/types';
import { namingOf } from '@internal/sql-schema-ir/naming';
import { PostgresRlsEnablement } from '../postgres-rls-enablement';
import { PostgresRlsPolicy } from '../postgres-rls-policy';

function renamedMarker(marker: unknown, rename: ResolvedTableRename): unknown {
  if (!(marker instanceof PostgresRlsEnablement) || marker.tableName !== rename.from) return marker;
  return new PostgresRlsEnablement({ tableName: rename.to, namespaceId: marker.namespaceId });
}

function renamedPolicy(policy: unknown, rename: ResolvedTableRename): unknown {
  if (!(policy instanceof PostgresRlsPolicy) || policy.tableName !== rename.from) return policy;
  return new PostgresRlsPolicy({
    naming: namingOf(policy.name, policy.prefix),
    tableName: rename.to,
    namespaceId: policy.namespaceId,
    operation: policy.operation,
    roles: policy.roles,
    using: policy.using,
    withCheck: policy.withCheck,
    permissive: policy.permissive,
  });
}

/**
 * Moves the RLS marker and the policies of a renamed table onto its new name. The marker is keyed by table name; policies are keyed by their own name and only their `tableName` changes. Policy names do not derive from the table name, so none is renamed.
 */
export function renameRlsReferences(
  entries: SqlNamespaceEntries,
  rename: ResolvedTableRename,
): SqlNamespaceEntries {
  const markers = entries['rls'];
  const policies = entries['policy'];
  return {
    ...entries,
    ...(markers === undefined
      ? {}
      : {
          rls: Object.fromEntries(
            Object.entries(markers).map(([tableName, marker]) => [
              tableName === rename.from ? rename.to : tableName,
              renamedMarker(marker, rename),
            ]),
          ),
        }),
    ...(policies === undefined
      ? {}
      : {
          policy: Object.fromEntries(
            Object.entries(policies).map(([name, policy]) => [name, renamedPolicy(policy, rename)]),
          ),
        }),
  };
}
