import type {
  Contract,
  ContractField,
  ContractValueObjectField,
  ControlPolicy,
} from '@internal/contract/types';
import { asNamespaceId, profileHash, type StorageHashBase } from '@internal/contract/types';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import type { SchemaTables } from '../src/core/migrations/schema-tables';

export type MemberSpec =
  | 'scalar'
  | { readonly valueObject: string; readonly many?: boolean }
  | { readonly field: ContractValueObjectField };

export interface ColumnSpec {
  readonly model: string;
  readonly table: string;
  readonly field: string;
  readonly column?: string;
  readonly valueObject: string;
  readonly many?: boolean;
  readonly shape?: 'dictionary' | 'union';
  readonly control?: ControlPolicy;
}

export function valueObjectRef(name: string, namespaceId: string) {
  return { plane: 'storage', namespaceId, entityKind: 'valueObject', entityName: name } as const;
}

export const textType = { kind: 'scalar', codecId: 'test/text@1' } as const;

function memberOf(spec: MemberSpec, namespaceId: string): ContractValueObjectField {
  if (spec === 'scalar') return { nullable: false, type: textType };
  if ('field' in spec) return spec.field;
  return {
    nullable: false,
    type: { kind: 'valueObject', ...valueObjectRef(spec.valueObject, namespaceId) },
    ...(spec.many === true ? { many: { elementNullable: false } } : {}),
  };
}

function fieldOf(spec: ColumnSpec, namespaceId: string): ContractField {
  const reference = {
    kind: 'valueObject',
    ...valueObjectRef(spec.valueObject, namespaceId),
  } as const;
  if (spec.shape === 'union') {
    return { nullable: true, type: { kind: 'union', members: [textType, reference] } };
  }
  return {
    nullable: true,
    type: reference,
    ...(spec.many === true ? { many: { elementNullable: false } } : {}),
    ...(spec.shape === 'dictionary' ? { dict: true } : {}),
  };
}

export function contractWith(options: {
  readonly valueObjects: Readonly<Record<string, Readonly<Record<string, MemberSpec>>>>;
  readonly columns: readonly ColumnSpec[];
  readonly namespace?: string;
}): Contract<SqlStorage> {
  const namespaceId = options.namespace ?? 'app';
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
            valueObject: Object.fromEntries(
              Object.entries(options.valueObjects).map(([name, members]) => [
                name,
                {
                  fields: Object.fromEntries(
                    Object.entries(members).map(([member, spec]) => [
                      member,
                      memberOf(spec, namespaceId),
                    ]),
                  ),
                },
              ]),
            ),
            table: Object.fromEntries(
              tables.map((table) => {
                const columns = options.columns.filter((column) => column.table === table);
                const control = columns.find((column) => column.control !== undefined)?.control;
                return [
                  table,
                  new StorageTable({
                    columns: Object.fromEntries(
                      columns.map((column) => [
                        column.column ?? column.field,
                        { dataType: 'test/json', codecId: 'test/json@1', nullable: true },
                      ]),
                    ),
                    uniques: [],
                    indexes: [],
                    foreignKeys: [],
                    ...(control === undefined ? {} : { control }),
                  }),
                ];
              }),
            ),
          },
        }),
      },
    }),
    domain: {
      namespaces: {
        [namespaceId]: {
          models: Object.fromEntries(
            [...new Set(options.columns.map(({ model }) => model))].map((model) => {
              const columns = options.columns.filter((column) => column.model === model);
              const [first] = columns;
              return [
                model,
                {
                  fields: Object.fromEntries(
                    columns.map((column) => [column.field, fieldOf(column, namespaceId)]),
                  ),
                  relations: {},
                  storage: {
                    table: first?.table,
                    namespaceId,
                    fields: Object.fromEntries(
                      columns.map((column) => [
                        column.field,
                        { column: column.column ?? column.field },
                      ]),
                    ),
                  },
                },
              ];
            }),
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

export function allTables(): SchemaTables {
  return {
    hasTable: () => true,
    hasColumn: () => true,
    tablesNamed: () => [],
    columnsNamed: () => [],
    namespacesWithTable: () => [],
    hasNamespace: () => true,
  };
}

export function tablesOf(qualifiedColumns: readonly string[]): SchemaTables {
  return {
    ...allTables(),
    hasColumn: (namespaceId, table, column) =>
      qualifiedColumns.includes(`${namespaceId}.${table}.${column}`),
  };
}

export function field(valueObject: string, name: string, namespace = 'app') {
  return { namespaceId: asNamespaceId(namespace), valueObject, field: name };
}
