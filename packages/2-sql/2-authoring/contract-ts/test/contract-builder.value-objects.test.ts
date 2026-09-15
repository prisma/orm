import type { ContractField, ContractValueObject } from '@internal/contract/types';
import type { CodecLookup } from '@internal/framework-components/codec';
import type { TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { buildSqlContractFromDefinition } from '../src/contract-builder';
import { modelsOf, valueObjectsOf } from './contract-test-helpers';
import { unboundTables } from './unbound-tables';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

describe('value objects in contract definition builder', () => {
  it('encodes value-object literal defaults through codecLookup during storage lowering', () => {
    const isMoneyValue = (value: unknown): value is { amount: number; currency: string } =>
      typeof value === 'object' &&
      value !== null &&
      'amount' in value &&
      typeof value.amount === 'number' &&
      'currency' in value &&
      typeof value.currency === 'string';

    const codecLookup: CodecLookup = {
      get: (id) => {
        if (id !== 'pg/jsonb@1') {
          return undefined;
        }

        return {
          id,
          encode: async (value: unknown) => value,
          decode: (wire: unknown) => wire,
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
    };

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
              {
                fieldName: 'id',
                columnName: 'id',
                descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
                nullable: false,
              },
              {
                fieldName: 'total',
                columnName: 'total',
                valueObjectName: 'Money',
                nullable: false,
                default: {
                  kind: 'literal',
                  value: {
                    amount: 12,
                    currency: 'EUR',
                  },
                },
              },
            ],
            id: { columns: ['id'] },
          },
        ],
        valueObjects: [
          {
            name: 'Money',
            fields: [
              {
                fieldName: 'amount',
                columnName: 'amount',
                descriptor: { codecId: 'pg/int8@1', nativeType: 'int8' },
                nullable: false,
              },
              {
                fieldName: 'currency',
                columnName: 'currency',
                descriptor: { codecId: 'pg/text@1', nativeType: 'text' },
                nullable: false,
              },
            ],
          },
        ],
      },
      codecLookup,
    );

    expect(unboundTables(contract.storage)['invoice']?.columns['total']?.default).toEqual({
      kind: 'literal',
      value: {
        amount: '12',
        currency: 'EUR',
      },
    });
  });

  it('emits valueObjects section with scalar fields', () => {
    const contract = buildSqlContractFromDefinition({
      warnings: undefined,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: [
        {
          modelName: 'User',
          tableName: 'user',
          fields: [
            {
              fieldName: 'id',
              columnName: 'id',
              descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
              nullable: false,
            },
          ],
          id: { columns: ['id'] },
        },
      ],
      valueObjects: [
        {
          name: 'Address',
          fields: [
            {
              fieldName: 'street',
              columnName: 'street',
              descriptor: { codecId: 'pg/text@1', nativeType: 'text' },
              nullable: false,
            },
            {
              fieldName: 'city',
              columnName: 'city',
              descriptor: { codecId: 'pg/text@1', nativeType: 'text' },
              nullable: false,
            },
          ],
        },
      ],
    });

    const valueObjects = valueObjectsOf(contract) as
      | Record<string, ContractValueObject>
      | undefined;

    expect(valueObjects).toBeDefined();
    expect(valueObjects?.['Address']).toEqual({
      fields: {
        street: {
          type: { kind: 'scalar', codecId: 'pg/text@1' },
          nullable: false,
        },
        city: {
          type: { kind: 'scalar', codecId: 'pg/text@1' },
          nullable: false,
        },
      },
    });
  });

  it('emits valueObject domain type for model fields referencing a value object', () => {
    const contract = buildSqlContractFromDefinition({
      warnings: undefined,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: [
        {
          modelName: 'User',
          tableName: 'user',
          fields: [
            {
              fieldName: 'id',
              columnName: 'id',
              descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
              nullable: false,
            },
            {
              fieldName: 'homeAddress',
              columnName: 'home_address',
              valueObjectName: 'Address',
              nullable: true,
            },
          ],
          id: { columns: ['id'] },
        },
      ],
      valueObjects: [
        {
          name: 'Address',
          fields: [
            {
              fieldName: 'street',
              columnName: 'street',
              descriptor: { codecId: 'pg/text@1', nativeType: 'text' },
              nullable: false,
            },
            {
              fieldName: 'city',
              columnName: 'city',
              descriptor: { codecId: 'pg/text@1', nativeType: 'text' },
              nullable: false,
            },
          ],
        },
      ],
    });

    const userModel = modelsOf(contract) as Record<
      string,
      { readonly fields: Record<string, ContractField> } | undefined
    >;

    expect(userModel['User']?.fields['homeAddress']).toEqual({
      type: { kind: 'valueObject', name: 'Address' },
      nullable: true,
    });
  });

  it('maps value object fields to JSONB storage columns', () => {
    const contract = buildSqlContractFromDefinition({
      warnings: undefined,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: [
        {
          modelName: 'User',
          tableName: 'user',
          fields: [
            {
              fieldName: 'id',
              columnName: 'id',
              descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
              nullable: false,
            },
            {
              fieldName: 'homeAddress',
              columnName: 'home_address',
              valueObjectName: 'Address',
              nullable: true,
            },
          ],
          id: { columns: ['id'] },
        },
      ],
      valueObjects: [
        {
          name: 'Address',
          fields: [
            {
              fieldName: 'street',
              columnName: 'street',
              descriptor: { codecId: 'pg/text@1', nativeType: 'text' },
              nullable: false,
            },
          ],
        },
      ],
    });

    const tables = unboundTables(contract.storage);
    expect(tables['user']?.columns['home_address']).toMatchObject({
      nativeType: 'jsonb',
      codecId: 'pg/jsonb@1',
      nullable: true,
    });
  });

  it('emits many: true for value object list fields', () => {
    const contract = buildSqlContractFromDefinition({
      warnings: undefined,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: [
        {
          modelName: 'User',
          tableName: 'user',
          fields: [
            {
              fieldName: 'id',
              columnName: 'id',
              descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
              nullable: false,
            },
            {
              fieldName: 'addresses',
              columnName: 'addresses',
              valueObjectName: 'Address',
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
          fields: [
            {
              fieldName: 'street',
              columnName: 'street',
              descriptor: { codecId: 'pg/text@1', nativeType: 'text' },
              nullable: false,
            },
          ],
        },
      ],
    });

    const userModel = modelsOf(contract) as Record<
      string,
      { readonly fields: Record<string, ContractField> } | undefined
    >;

    expect(userModel['User']?.fields['addresses']).toEqual({
      type: { kind: 'valueObject', name: 'Address' },
      nullable: false,
      many: true,
    });
  });

  it('emits nested value-object references inside a parent value object', () => {
    const contract = buildSqlContractFromDefinition({
      warnings: undefined,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: [
        {
          modelName: 'Company',
          tableName: 'company',
          fields: [
            {
              fieldName: 'id',
              columnName: 'id',
              descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
              nullable: false,
            },
            {
              fieldName: 'address',
              columnName: 'address',
              valueObjectName: 'CompanyAddress',
              nullable: false,
            },
          ],
          id: { columns: ['id'] },
        },
      ],
      valueObjects: [
        {
          name: 'GeoLocation',
          fields: [
            {
              fieldName: 'lat',
              columnName: 'lat',
              descriptor: { codecId: 'pg/float8@1', nativeType: 'float8' },
              nullable: false,
            },
            {
              fieldName: 'lng',
              columnName: 'lng',
              descriptor: { codecId: 'pg/float8@1', nativeType: 'float8' },
              nullable: false,
            },
          ],
        },
        {
          name: 'CompanyAddress',
          fields: [
            {
              fieldName: 'street',
              columnName: 'street',
              descriptor: { codecId: 'pg/text@1', nativeType: 'text' },
              nullable: false,
            },
            {
              fieldName: 'location',
              columnName: 'location',
              valueObjectName: 'GeoLocation',
              nullable: true,
            },
          ],
        },
      ],
    });

    const valueObjects = valueObjectsOf(contract) as
      | Record<string, ContractValueObject>
      | undefined;

    expect(valueObjects?.['CompanyAddress']?.fields['location']).toEqual({
      type: { kind: 'valueObject', name: 'GeoLocation' },
      nullable: true,
    });
    expect(valueObjects?.['CompanyAddress']?.fields['street']).toEqual({
      type: { kind: 'scalar', codecId: 'pg/text@1' },
      nullable: false,
    });
    expect(valueObjects?.['GeoLocation']?.fields['lat']).toEqual({
      type: { kind: 'scalar', codecId: 'pg/float8@1' },
      nullable: false,
    });
  });

  it('omits valueObjects from contract when none are defined', () => {
    const contract = buildSqlContractFromDefinition({
      warnings: undefined,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: [
        {
          modelName: 'User',
          tableName: 'user',
          fields: [
            {
              fieldName: 'id',
              columnName: 'id',
              descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
              nullable: false,
            },
          ],
          id: { columns: ['id'] },
        },
      ],
    });

    expect(valueObjectsOf(contract)).toBeUndefined();
  });

  it('maps value object field to correct storage bridge entry', () => {
    const contract = buildSqlContractFromDefinition({
      warnings: undefined,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: [
        {
          modelName: 'User',
          tableName: 'user',
          fields: [
            {
              fieldName: 'id',
              columnName: 'id',
              descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
              nullable: false,
            },
            {
              fieldName: 'homeAddress',
              columnName: 'home_address',
              valueObjectName: 'Address',
              nullable: true,
            },
          ],
          id: { columns: ['id'] },
        },
      ],
      valueObjects: [
        {
          name: 'Address',
          fields: [
            {
              fieldName: 'street',
              columnName: 'street',
              descriptor: { codecId: 'pg/text@1', nativeType: 'text' },
              nullable: false,
            },
          ],
        },
      ],
    });

    const userModel = modelsOf(contract) as unknown as Record<
      string,
      | {
          readonly storage: { readonly fields: Record<string, { readonly column: string }> };
        }
      | undefined
    >;

    expect(userModel['User']?.storage.fields['homeAddress']).toEqual({
      column: 'home_address',
    });
  });
});
