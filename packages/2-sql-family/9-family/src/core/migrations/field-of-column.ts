import { asNamespaceId, type ContractWithDomain } from '@internal/contract/types';
import type { MigrationSubject } from '@internal/framework-components/control';
import { isSqlModelStorage } from './statement-planning';

/**
 * The field of `contract` that stores `column` of `table`, or undefined when no field stores it or
 * tables of two storage namespaces share the table's name.
 */
export function fieldOfColumn(
  contract: ContractWithDomain,
  table: string,
  column: string,
): MigrationSubject | undefined {
  const fields = Object.entries(contract.domain.namespaces).flatMap(([namespaceId, namespace]) =>
    Object.entries(namespace.models).flatMap(([model, definition]) => {
      const { storage } = definition;
      if (!isSqlModelStorage(storage) || storage.table !== table) return [];
      const field = Object.entries(storage.fields).find(([, stored]) => stored.column === column);
      if (field === undefined) return [];
      return [
        {
          storageNamespace: storage.namespaceId,
          isRoot: definition.base === undefined,
          subject: {
            kind: 'field' as const,
            namespaceId: asNamespaceId(namespaceId),
            model,
            field: field[0],
          },
        },
      ];
    }),
  );
  if (new Set(fields.map(({ storageNamespace }) => storageNamespace)).size !== 1) return undefined;
  return (fields.find(({ isRoot }) => isRoot) ?? fields[0])?.subject;
}
