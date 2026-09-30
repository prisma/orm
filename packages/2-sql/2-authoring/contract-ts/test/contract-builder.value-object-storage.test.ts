import type {
  CodecLookupWithDescriptors,
  ColumnTypeDescriptor,
} from '@internal/framework-components/codec';
import type { TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { buildSqlContractFromDefinition } from '../src/contract-builder';
import type { ContractDefinition } from '../src/contract-definition';
import { unboundTables } from './unbound-tables';
import { withDescriptors } from './with-descriptors';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const int4 = { codecId: 'pg/int4@1', nativeType: 'int4' } as const;
const jsonb = { codecId: 'pg/jsonb@1', nativeType: 'jsonb' } as const;
const idField = { fieldName: 'id', columnName: 'id', descriptor: int4, nullable: false } as const;

function userWithAddresses(descriptor: ColumnTypeDescriptor): ContractDefinition {
  return {
    warnings: undefined,
    target: postgresTargetPack,
    createNamespace: createTestSqlNamespace,
    models: [
      {
        modelName: 'User',
        tableName: 'user',
        fields: [
          idField,
          {
            fieldName: 'home',
            columnName: 'home_address',
            valueObjectName: 'Address',
            descriptor,
            nullable: true,
          },
          {
            fieldName: 'addresses',
            columnName: 'addresses',
            valueObjectName: 'Address',
            descriptor,
            nullable: false,
            many: true,
          },
        ],
        id: { columns: ['id'] },
      },
    ],
    valueObjects: [
      {
        name: 'Address',
        fields: [{ fieldName: 'street', descriptor: { codecId: 'pg/text@1' }, nullable: false }],
      },
    ],
  };
}

describe('value-object fields are stored in one column of the descriptor they carry', () => {
  it('stores a single and a list value-object field in a column of that descriptor', () => {
    const contract = buildSqlContractFromDefinition(
      userWithAddresses({ codecId: 'sqlite/json@1', nativeType: 'text' }),
    );

    expect(unboundTables(contract.storage)['user']?.columns).toEqual({
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      home_address: { nativeType: 'text', codecId: 'sqlite/json@1', nullable: true },
      addresses: { nativeType: 'text', codecId: 'sqlite/json@1', nullable: false },
    });
  });

  it('maps a value-object field to its column in the storage bridge', () => {
    const contract = buildSqlContractFromDefinition(userWithAddresses(jsonb));

    expect(contract.domain.namespaces['public']?.models['User']?.storage['fields']).toEqual({
      id: { column: 'id' },
      home: { column: 'home_address' },
      addresses: { column: 'addresses' },
    });
  });

  it('encodes a literal default on a value-object field through the codec of its column', () => {
    const isMoneyValue = (value: unknown): value is { amount: number; currency: string } =>
      typeof value === 'object' &&
      value !== null &&
      'amount' in value &&
      typeof value.amount === 'number' &&
      'currency' in value &&
      typeof value.currency === 'string';

    const codecLookup: CodecLookupWithDescriptors = withDescriptors({
      get: (id) => {
        if (id !== 'pg/jsonb@1') {
          return undefined;
        }

        return {
          id,
          encode: async (value: unknown) => value,
          decode: async (wire: unknown) => wire,
          encodeJson: (value: unknown) => {
            if (!isMoneyValue(value)) {
              throw new Error('Expected a Money value');
            }

            return {
              amount: value.amount.toString(),
              currency: value.currency,
            };
          },
          decodeJson: (json: unknown) => json,
        };
      },
      targetTypesFor: (id) => (id === 'pg/jsonb@1' ? ['jsonb'] : undefined),
      renderOutputTypeFor: () => undefined,
    });

    const contract = buildSqlContractFromDefinition(
      {
        warnings: undefined,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        models: [
          {
            modelName: 'Invoice',
            tableName: 'invoice',
            fields: [
              idField,
              {
                fieldName: 'total',
                columnName: 'total',
                valueObjectName: 'Money',
                descriptor: jsonb,
                nullable: false,
                default: { kind: 'literal', value: { amount: 12, currency: 'EUR' } },
              },
            ],
            id: { columns: ['id'] },
          },
        ],
        valueObjects: [
          {
            name: 'Money',
            fields: [
              { fieldName: 'amount', descriptor: { codecId: 'pg/int8@1' }, nullable: false },
              { fieldName: 'currency', descriptor: { codecId: 'pg/text@1' }, nullable: false },
            ],
          },
        ],
      },
      codecLookup,
    );

    expect(unboundTables(contract.storage)['invoice']?.columns['total']?.default).toEqual({
      kind: 'literal',
      value: { amount: '12', currency: 'EUR' },
    });
  });
});
