import {
  asNamespaceId,
  type Contract,
  type JsonValue,
  profileHash,
  type StorageHashBase,
} from '@internal/contract/types';
import type { ResolvedEnumValueRenameStatement } from '@internal/framework-components/control';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import type { planEnumValueRewrites } from '../src/core/migrations/enum-value-planning';
import type { SchemaTables } from '../src/core/migrations/schema-tables';
import { TEXT_CODEC_ID, testCodecLookup, textCodec } from './enum-entity-fixtures';

interface EnumColumn {
  readonly model: string;
  readonly table: string;
  readonly field?: string;
  readonly column?: string;
  readonly nullable?: boolean;
  readonly many?: boolean;
}

export function contractWith(options: {
  readonly members: Readonly<Record<string, JsonValue>>;
  readonly columns: readonly EnumColumn[];
  readonly namespace?: string;
  readonly codecId?: string;
}): Contract<SqlStorage> {
  const namespaceId = options.namespace ?? 'app';
  const valueSet = {
    plane: 'domain' as const,
    namespaceId,
    entityKind: 'enum' as const,
    entityName: 'Status',
  };
  const tables = [...new Set(options.columns.map(({ table }) => table))];
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [namespaceId]: createTestSqlNamespace({
          id: namespaceId,
          entries: {
            table: Object.fromEntries(
              tables.map((table) => [
                table,
                new StorageTable({
                  columns: Object.fromEntries(
                    options.columns
                      .filter((column) => column.table === table)
                      .map((column) => [
                        column.column ?? 'status',
                        {
                          dataType: 'test/text',
                          codecId: 'test/text@1',
                          nullable: column.nullable ?? true,
                          ...(column.many === true ? { many: { elementNullable: false } } : {}),
                        },
                      ]),
                  ),
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                }),
              ]),
            ),
          },
        }),
      },
    }),
    domain: {
      namespaces: {
        [namespaceId]: {
          enum: {
            Status: {
              codecId: options.codecId ?? 'test/text@1',
              members: Object.entries(options.members).map(([name, value]) => ({ name, value })),
            },
          },
          models: Object.fromEntries(
            options.columns.map((column) => [
              column.model,
              {
                fields: {
                  [column.field ?? 'status']: {
                    nullable: column.nullable ?? true,
                    type: { kind: 'scalar', codecId: 'test/text@1' },
                    valueSet,
                    ...(column.many === true ? { many: { elementNullable: false } } : {}),
                  },
                },
                relations: {},
                storage: {
                  table: column.table,
                  namespaceId,
                  fields: { [column.field ?? 'status']: { column: column.column ?? 'status' } },
                },
              },
            ]),
          ),
        },
      },
    },
    roots: {},
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

export function tablesOf(qualifiedColumns: readonly string[]): SchemaTables {
  const has = (key: string) => qualifiedColumns.includes(key);
  return {
    hasTable: (namespaceId, table) =>
      qualifiedColumns.some((key) => key.startsWith(`${namespaceId}.${table}.`)),
    hasColumn: (namespaceId, table, column) => has(`${namespaceId}.${table}.${column}`),
    tablesNamed: () => [],
    columnsNamed: () => [],
    namespacesWithTable: () => [],
    hasNamespace: () => true,
  };
}

export function rename(
  from: string,
  to: string,
  namespace = 'app',
): ResolvedEnumValueRenameStatement {
  return {
    kind: 'rename',
    entity: 'enumValue',
    from: { namespaceId: asNamespaceId(namespace), enum: 'Status', member: from },
    to: { namespaceId: asNamespaceId(namespace), enum: 'Status', member: to },
  };
}

export const noCodecs = { descriptorFor: () => undefined };
export const BIGINT_CODEC_ID = 'test/bigint@1';
export const bigintCodecs = {
  descriptorFor: (id: string) => {
    const descriptor = testCodecLookup.descriptorFor(TEXT_CODEC_ID);
    if (descriptor === undefined || id !== BIGINT_CODEC_ID) return undefined;
    return {
      ...descriptor,
      codecId: id,
      factory: () => () => ({
        ...textCodec,
        fromDataTypeValue: (value: { readonly value: JsonValue }) => BigInt(String(value.value)),
      }),
    };
  },
};

export const ARCHIVED = { namespaceId: asNamespaceId('app'), enum: 'Status', member: 'ARCHIVED' };
export const codecRef = { codecId: 'test/text@1' };
export const taskColumn = { model: 'Task', table: 'task' };

export function rewrites(result: ReturnType<typeof planEnumValueRewrites>) {
  if (!result.ok) throw new Error(`expected rewrites, got: ${result.failure.summary}`);
  return result.value;
}

export function refusal(result: ReturnType<typeof planEnumValueRewrites>) {
  if (result.ok) throw new Error('expected a refusal');
  return result.failure;
}
