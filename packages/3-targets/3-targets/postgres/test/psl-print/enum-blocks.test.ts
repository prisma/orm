import type { ApplicationDomainNamespace, Contract } from '@internal/contract/types';
import { asNamespaceId } from '@internal/contract/types';
import type { PslExtensionBlock } from '@internal/framework-components/psl-ast';
import { namespacePslExtensionBlocks } from '@internal/framework-components/psl-ast';
import type { SqlStorage } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { PostgresContractSerializer } from '../../src/core/postgres-contract-serializer';
import { buildPostgresPslContract } from '../../src/core/psl-print/psl-contract';
import { testPrintContext } from './print-context';
import { type ColumnShape, domainFieldOf, INT_COLUMN, table } from './print-support';

describe('native enum blocks', () => {
  function blockText(block: PslExtensionBlock): string {
    const members = Object.entries(block.parameters).map(([name, value]) =>
      value.kind === 'value' ? `${name} = ${value.raw}` : name,
    );
    const attributes = block.blockAttributes.map(
      (attribute) => `@@${attribute.name}(${attribute.args.map((arg) => arg.value).join(', ')})`,
    );
    return [`${block.keyword} ${block.name}`, ...members, ...attributes].join(' ');
  }

  function enumBlocks(input: {
    readonly nativeEnums: Record<string, { readonly typeName: string; readonly members: string[] }>;
    readonly valueSets: Record<string, { readonly values: string[] }>;
    readonly columns?: Record<string, ColumnShape>;
    readonly fields?: Record<string, { readonly column: string }>;
  }): readonly string[] {
    const fields = input.fields ?? { id: { column: 'id' } };
    const columns: Record<string, ColumnShape> = input.columns ?? { id: INT_COLUMN };
    const domainNamespace: ApplicationDomainNamespace = {
      models: {
        Widget: {
          storage: { table: 'Widget', namespaceId: 'public', fields },
          fields: Object.fromEntries(
            Object.entries(fields).map(([name, { column }]) => [
              name,
              domainFieldOf(columns[column]),
            ]),
          ),
          relations: {},
        },
      },
    };
    const json = createSqlContract({
      roots: { Widget: { namespace: asNamespaceId('public'), model: 'Widget' } },
      namespaces: { public: domainNamespace },
      storage: {
        namespaces: {
          public: {
            id: 'public',
            entries: {
              table: {
                Widget: table({ columns, primaryKey: { columns: ['id'] } }),
              },
              native_enum: Object.fromEntries(
                Object.entries(input.nativeEnums).map(([name, value]) => [
                  name,
                  { kind: 'postgres-enum', ...value },
                ]),
              ),
              valueSet: Object.fromEntries(
                Object.entries(input.valueSets).map(([name, value]) => [
                  name,
                  { kind: 'valueSet', ...value },
                ]),
              ),
            },
          },
        },
      },
    });
    const contract = new PostgresContractSerializer().deserializeContract(json);
    const ast = buildPostgresPslContract(
      blindCast<Contract<SqlStorage>, 'the Postgres serializer yields a SQL contract'>(contract),
      testPrintContext(),
    );
    return ast.namespaces
      .flatMap((namespace) => namespacePslExtensionBlocks(namespace))
      .map(blockText);
  }

  it('names a mapped enum no column refers to after its value set, not its type', () => {
    expect(
      enumBlocks({
        nativeEnums: { user_role: { typeName: 'user_role', members: ['user', 'ADMIN'] } },
        valueSets: { Role: { values: ['user', 'ADMIN'] } },
      }),
    ).toEqual(['native_enum Role user = "user" ADMIN = "ADMIN" @@map("user_role")']);
  });

  it('leaves an unmapped enum no column refers to named after its type', () => {
    expect(
      enumBlocks({
        nativeEnums: { Unused: { typeName: 'Unused', members: ['A', 'B'] } },
        valueSets: { Unused: { values: ['A', 'B'] } },
      }),
    ).toEqual(['native_enum Unused A = "A" B = "B"']);
  });

  it('names a mapped enum a column refers to after the value set the column names', () => {
    expect(
      enumBlocks({
        nativeEnums: { user_role: { typeName: 'user_role', members: ['user', 'ADMIN'] } },
        valueSets: { Role: { values: ['user', 'ADMIN'] } },
        columns: {
          id: INT_COLUMN,
          role: {
            nativeType: 'user_role',
            codecId: 'pg/enum@1',
            nullable: false,
            valueSet: {
              plane: 'storage',
              namespaceId: 'public',
              entityKind: 'valueSet',
              entityName: 'Role',
            },
          },
        },
        fields: { id: { column: 'id' }, role: { column: 'role' } },
      }),
    ).toEqual(['native_enum Role user = "user" ADMIN = "ADMIN" @@map("user_role")']);
  });

  it('gives two unreferenced enums with the same members one value set each', () => {
    expect(
      enumBlocks({
        nativeEnums: {
          user_role: { typeName: 'user_role', members: ['A', 'B'] },
          other_role: { typeName: 'other_role', members: ['A', 'B'] },
        },
        valueSets: { Role: { values: ['A', 'B'] }, OtherRole: { values: ['A', 'B'] } },
      }),
    ).toEqual([
      'native_enum Role A = "A" B = "B" @@map("user_role")',
      'native_enum OtherRole A = "A" B = "B" @@map("other_role")',
    ]);
  });

  it('writes a type name PSL cannot read as an identifier under @@map, named after its value set', () => {
    expect(
      enumBlocks({
        nativeEnums: { 'order status': { typeName: 'order status', members: ['A'] } },
        valueSets: { OrderStatus: { values: ['A'] } },
      }),
    ).toEqual(['native_enum OrderStatus A = "A" @@map("order status")']);
  });

  it('names each unreferenced enum after the value set that holds its members', () => {
    expect(
      enumBlocks({
        nativeEnums: {
          'order status': { typeName: 'order status', members: ['A'] },
          order_status: { typeName: 'order_status', members: ['B'] },
        },
        valueSets: { OrderStatus: { values: ['B'] }, LegacyOrderStatus: { values: ['A'] } },
      }),
    ).toEqual([
      'native_enum LegacyOrderStatus A = "A" @@map("order status")',
      'native_enum OrderStatus B = "B" @@map("order_status")',
    ]);
  });
});
