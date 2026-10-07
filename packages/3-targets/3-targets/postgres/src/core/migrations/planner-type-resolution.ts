import type { StorageColumn, StorageTypeInstance } from '@internal/sql-contract/types';

export type ResolvedColumnTypeMetadata = Pick<StorageColumn, 'codecId' | 'typeParams'>;

export function resolveColumnTypeMetadata(
  column: Pick<StorageColumn, 'codecId' | 'typeParams' | 'typeRef'>,
  storageTypes: Readonly<Record<string, StorageTypeInstance>>,
): ResolvedColumnTypeMetadata {
  if (!column.typeRef) {
    return column;
  }

  const referencedType = storageTypes[column.typeRef];
  if (!referencedType) {
    return column;
  }

  return {
    codecId: referencedType.codecId,
    typeParams: referencedType.typeParams,
  };
}
