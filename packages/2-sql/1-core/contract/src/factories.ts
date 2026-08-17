import { asNamespaceId, type ScalarFieldType } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import {
  ForeignKey,
  type ForeignKeyOptions,
  Index,
  PrimaryKey,
  type SqlModelFieldStorage,
  type SqlModelStorage,
  StorageColumn,
  type StorageColumnInput,
  StorageTable,
  UniqueConstraint,
} from './types';

type ColumnMultiplicityOptions =
  | { readonly many: true; readonly elementNullable: true }
  | { readonly many?: boolean; readonly elementNullable?: never };

export function col(
  nativeType: string,
  codecId: string,
  nullable = false,
  opts?: ColumnMultiplicityOptions,
): StorageColumn {
  if (opts?.elementNullable === true) {
    return new StorageColumn({
      nativeType,
      codecId,
      nullable,
      many: opts.many,
      elementNullable: true,
    });
  }

  return new StorageColumn({
    nativeType,
    codecId,
    nullable,
    ...(opts?.many !== undefined && { many: opts.many }),
  });
}

export function pk(...columns: readonly string[]): PrimaryKey {
  return new PrimaryKey({ columns });
}

export function unique(...columns: readonly string[]): UniqueConstraint {
  return new UniqueConstraint({ columns });
}

export function index(
  name: string,
  columns: readonly string[],
  opts?: {
    readonly prefix?: string;
    readonly unique?: boolean;
    readonly type?: string;
    readonly options?: Record<string, unknown>;
  },
): Index {
  return new Index({
    naming: parseNaming(name, opts?.prefix),
    columns,
    where: undefined,
    unique: opts?.unique ?? false,
    type: opts?.type,
    options: opts?.options,
  });
}

export function fk(
  srcTableName: string,
  srcColumns: readonly string[],
  targetTableName: string,
  targetColumns: readonly string[],
  opts?: ForeignKeyOptions & { namespaceId?: string },
): ForeignKey {
  const namespaceId = asNamespaceId(opts?.namespaceId ?? UNBOUND_NAMESPACE_ID);
  return new ForeignKey({
    source: { namespaceId, tableName: srcTableName, columns: srcColumns },
    target: { namespaceId, tableName: targetTableName, columns: targetColumns },
    ...(opts?.name !== undefined && { name: opts.name }),
    ...(opts?.onDelete !== undefined && { onDelete: opts.onDelete }),
    ...(opts?.onUpdate !== undefined && { onUpdate: opts.onUpdate }),
  });
}

export function table(
  columns: Record<string, StorageColumn | StorageColumnInput>,
  opts?: {
    pk?: PrimaryKey;
    uniques?: readonly UniqueConstraint[];
    indexes?: readonly Index[];
    fks?: readonly ForeignKey[];
  },
): StorageTable {
  return new StorageTable({
    columns,
    ...(opts?.pk !== undefined && { primaryKey: opts.pk }),
    uniques: opts?.uniques ?? [],
    indexes: opts?.indexes ?? [],
    foreignKeys: opts?.fks ?? [],
  });
}

export function model(
  tableName: string,
  fields: Record<string, SqlModelFieldStorage>,
  relations: Record<string, unknown> = {},
  namespaceId: string = UNBOUND_NAMESPACE_ID,
): {
  storage: SqlModelStorage;
  fields: Record<string, { readonly nullable: boolean; readonly type: ScalarFieldType }>;
  relations: Record<string, unknown>;
} {
  const storage: SqlModelStorage = { table: tableName, namespaceId, fields };
  const domainFields = Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [
      name,
      {
        nullable: field.nullable ?? false,
        type: { kind: 'scalar' as const, codecId: field.codecId ?? 'core/unknown@1' },
      },
    ]),
  ) as Record<string, { nullable: boolean; type: ScalarFieldType }>;
  return {
    storage,
    fields: domainFields,
    relations,
  };
}
