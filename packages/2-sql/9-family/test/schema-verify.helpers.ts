/**
 * Shared test helpers for schema verification tests.
 */

import {
  asNamespaceId,
  type ColumnDefault,
  type Contract,
  type ControlPolicy,
  profileHash,
  type StorageHashBase,
} from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  indexInputFromSerialized,
  type ReferentialAction,
  type SerializedIndex,
  SqlStorage,
  StorageTable,
  type StorageTableInput,
} from '@internal/sql-contract/types';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import type { SqlIndexIRInput, SqlReferentialAction } from '@internal/sql-schema-ir/types';
import { SqlSchemaIR, SqlTableIR } from '@internal/sql-schema-ir/types';
import { ifDefined } from '@internal/utils/defined';
import { applicationDomainOf } from '@repo/test-utils';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';

/**
 * Creates a minimal valid contract for testing.
 */
export function createTestContract(
  tables: Record<string, StorageTable>,
  extensions: Record<string, unknown> = {},
  storageTypes?: Record<string, import('@internal/sql-contract/types').SqlStorageTypeEntry>,
  contractOverrides?: {
    defaultControlPolicy?: ControlPolicy;
  },
): Contract<SqlStorage> {
  const namespace = createTestSqlNamespace({
    id: UNBOUND_NAMESPACE_ID,
    entries: { table: tables },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    roots: {},
    profileHash: profileHash('test'),
    ...ifDefined('defaultControlPolicy', contractOverrides?.defaultControlPolicy),
    storage: new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: namespace,
      },
      ...ifDefined('types', storageTypes),
    }),
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    meta: {},
    extensions,
  };
}

/**
 * Creates a minimal valid SqlSchemaIR for testing.
 */
export function createTestSchemaIR(tables: Record<string, SqlTableIR>): SqlSchemaIR {
  return new SqlSchemaIR({ tables });
}

/**
 * Creates a minimal contract table for testing.
 */
const NO_INFERRED_CODEC = new Set(['pg/date', 'pg/timestamp', 'pg/timestamptz', 'pg/time']);

function codecIdFor(
  name: string,
  col: { readonly dataType: string; readonly codecId?: string },
): string {
  if (col.codecId !== undefined) return col.codecId;
  if (NO_INFERRED_CODEC.has(col.dataType)) {
    throw new Error(
      `Test column "${name}" is a ${col.dataType} and must name its codecId explicitly: ` +
        `${col.dataType}-temporal@1 for a Temporal value, ${col.dataType}-string@1 for the server's text.`,
    );
  }
  return `${col.dataType}@1`;
}

export function createContractTable(
  columns: Record<
    string,
    {
      dataType: string;
      codecId?: string;
      nullable: boolean;
      default?: ColumnDefault;
      typeParams?: Record<string, unknown>;
    }
  >,
  options?: {
    primaryKey?: { columns: readonly string[]; name?: string };
    foreignKeys?: ReadonlyArray<{
      source: { namespaceId: string; tableName: string; columns: readonly string[] };
      target: { namespaceId: string; tableName: string; columns: readonly string[] };
      name?: string;
      onDelete?: ReferentialAction;
      onUpdate?: ReferentialAction;
    }>;
    uniques?: ReadonlyArray<{ columns: readonly string[]; name?: string }>;
    indexes?: readonly SerializedIndex[];
    control?: ControlPolicy;
  },
): StorageTable {
  const input = {
    columns: Object.fromEntries(
      Object.entries(columns).map(([name, col]) => [
        name,
        {
          dataType: col.dataType,
          codecId: codecIdFor(name, col),
          nullable: col.nullable,
          ...ifDefined('default', col.default),
          ...ifDefined('typeParams', col.typeParams),
        },
      ]),
    ),
    foreignKeys: (options?.foreignKeys ?? []).map((fk) => ({
      ...fk,
      source: { ...fk.source, namespaceId: asNamespaceId(fk.source.namespaceId) },
      target: { ...fk.target, namespaceId: asNamespaceId(fk.target.namespaceId) },
    })),
    uniques: options?.uniques ?? [],
    indexes: (options?.indexes ?? []).map(indexInputFromSerialized),
    ...ifDefined('primaryKey', options?.primaryKey),
    ...ifDefined('control', options?.control),
  } satisfies StorageTableInput;
  return new StorageTable(input);
}

/**
 * Creates a minimal schema table for testing.
 * Note: default is now a raw string (e.g., "now()", "'hello'::text") matching SqlColumnIR.
 */
export function createSchemaTable(
  name: string,
  columns: Record<string, { nativeType: string; nullable: boolean; default?: string }>,
  options?: {
    primaryKey?: { columns: readonly string[]; name?: string };
    foreignKeys?: ReadonlyArray<{
      columns: readonly string[];
      referencedTable: string;
      referencedColumns: readonly string[];
      referencedSchema?: string;
      name?: string;
      onDelete?: SqlReferentialAction;
      onUpdate?: SqlReferentialAction;
    }>;
    uniques?: ReadonlyArray<{ columns: readonly string[]; name?: string }>;
    indexes?: ReadonlyArray<{
      name: string;
      prefix?: string;
      columns?: readonly string[];
      expression?: string;
      where?: string;
      unique: boolean;
      partial?: boolean;
      type?: string;
      options?: Record<string, unknown>;
    }>;
  },
): SqlTableIR {
  return new SqlTableIR({
    name,
    columns: Object.fromEntries(
      Object.entries(columns).map(([colName, col]) => [
        colName,
        {
          name: colName,
          nativeType: col.nativeType,
          nullable: col.nullable,
          ...ifDefined('default', col.default),
        },
      ]),
    ),
    foreignKeys: options?.foreignKeys ?? [],
    uniques: options?.uniques ?? [],
    indexes: (options?.indexes ?? []).map(
      (idx) =>
        ({
          naming: parseNaming(idx.name, idx.prefix),
          columns: idx.columns,
          expression: idx.expression,
          where: idx.where,
          unique: idx.unique,
          partial: idx.partial ?? false,
          type: idx.type,
          options: idx.options,
          annotations: undefined,
          dependsOn: undefined,
        }) as SqlIndexIRInput,
    ),
    ...ifDefined('primaryKey', options?.primaryKey),
  });
}
