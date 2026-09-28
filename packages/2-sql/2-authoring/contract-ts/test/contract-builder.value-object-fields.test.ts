import type { TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { buildSqlContractFromDefinition } from '../src/contract-builder';
import { enumType, member } from '../src/enum-type';
import { unboundTables } from './unbound-tables';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const int4 = { codecId: 'pg/int4@1', nativeType: 'int4' } as const;
const text = { codecId: 'pg/text@1', nativeType: 'text' } as const;
const numeric = {
  codecId: 'pg/numeric@1',
  nativeType: 'numeric',
  typeParams: { precision: 65, scale: 30 },
} as const;
const idField = { fieldName: 'id', columnName: 'id', descriptor: int4, nullable: false } as const;

describe('value-object fields in contract definition builder', () => {
  it('stores a value-object field of a model in a column of the descriptor it carries', () => {
    const contract = buildSqlContractFromDefinition({
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
              columnName: 'home',
              valueObjectName: 'Address',
              descriptor: { codecId: 'sqlite/json@1', nativeType: 'text' },
              nullable: true,
            },
            {
              fieldName: 'addresses',
              columnName: 'addresses',
              valueObjectName: 'Address',
              descriptor: { codecId: 'sqlite/json@1', nativeType: 'text' },
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
            { fieldName: 'street', columnName: 'street', descriptor: text, nullable: false },
          ],
        },
      ],
    });

    expect(unboundTables(contract.storage)['user']?.columns).toEqual({
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      home: { nativeType: 'text', codecId: 'sqlite/json@1', nullable: true },
      addresses: { nativeType: 'text', codecId: 'sqlite/json@1', nullable: false },
    });
  });

  it('builds value-object members like model fields, keeping many, type parameters and the domain valueSet of an enum', () => {
    const Country = enumType('Country', text, member('DE', 'DE'), member('FR', 'FR'));
    const scalarFields = [
      { fieldName: 'amount', columnName: 'amount', descriptor: numeric, nullable: false },
      {
        fieldName: 'history',
        columnName: 'history',
        descriptor: numeric,
        nullable: false,
        many: true,
      },
      {
        fieldName: 'country',
        columnName: 'country',
        descriptor: text,
        nullable: false,
        enumTypeHandle: Country,
      },
      {
        fieldName: 'countries',
        columnName: 'countries',
        descriptor: text,
        nullable: true,
        many: true,
        enumTypeHandle: Country,
      },
    ] as const;
    const contract = buildSqlContractFromDefinition({
      warnings: undefined,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      enums: { Country },
      models: [
        {
          modelName: 'Order',
          tableName: 'order',
          fields: [
            idField,
            ...scalarFields,
            {
              fieldName: 'shipping',
              columnName: 'shipping',
              valueObjectName: 'Shipping',
              descriptor: { codecId: 'pg/jsonb@1', nativeType: 'jsonb' },
              nullable: false,
            },
          ],
          id: { columns: ['id'] },
        },
      ],
      valueObjects: [
        {
          name: 'Shipping',
          fields: [
            ...scalarFields,
            { fieldName: 'stops', valueObjectName: 'Stop', nullable: false, many: true },
          ],
        },
        {
          name: 'Stop',
          fields: [{ fieldName: 'city', columnName: 'city', descriptor: text, nullable: false }],
        },
      ],
    });

    const namespace = contract.domain.namespaces['public'];
    const {
      id: _id,
      shipping: _shipping,
      ...modelFields
    } = namespace?.models['Order']?.fields ?? {};
    const { stops, ...memberFields } = namespace?.valueObjects?.['Shipping']?.fields ?? {};
    expect({ memberFields, stops }).toEqual({
      memberFields: modelFields,
      stops: { type: { kind: 'valueObject', name: 'Stop' }, nullable: false, many: true },
    });
    expect(memberFields).toEqual({
      amount: {
        type: { kind: 'scalar', codecId: 'pg/numeric@1', typeParams: { precision: 65, scale: 30 } },
        nullable: false,
      },
      history: {
        type: { kind: 'scalar', codecId: 'pg/numeric@1', typeParams: { precision: 65, scale: 30 } },
        nullable: false,
        many: true,
      },
      country: {
        type: { kind: 'scalar', codecId: 'pg/text@1' },
        nullable: false,
        valueSet: {
          plane: 'domain',
          entityKind: 'enum',
          namespaceId: 'public',
          entityName: 'Country',
        },
      },
      countries: {
        type: { kind: 'scalar', codecId: 'pg/text@1' },
        nullable: true,
        many: true,
        valueSet: {
          plane: 'domain',
          entityKind: 'enum',
          namespaceId: 'public',
          entityName: 'Country',
        },
      },
    });
  });
});
