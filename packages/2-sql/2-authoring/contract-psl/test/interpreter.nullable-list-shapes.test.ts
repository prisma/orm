import { entityAt } from '@internal/framework-components/ir';
import type { StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import type { InterpretPslDocumentToSqlContractInput } from '../src/interpreter';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  modelsOf,
  postgresScalarAuthoringTypes,
  postgresScalarTypeDescriptors,
  postgresTarget,
  valueObjectsOf,
} from './fixtures';

describe('interpretPslDocumentToSqlContract value objects and list fields', () => {
  const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();
  const interpretPostgresSchema = (
    schema: string,
    input: Omit<
      InterpretPslDocumentToSqlContractInput,
      | 'documents'
      | 'sources'
      | 'symbolTable'
      | 'binder'
      | 'target'
      | 'scalarColumnDescriptors'
      | 'composedExtensionContracts'
      | 'createNamespace'
      | 'capabilities'
      | 'dataTypeLookup'
    > &
      Partial<Pick<InterpretPslDocumentToSqlContractInput, 'composedExtensionContracts'>>,
  ) =>
    interpretSqlContract(schema, {
      target: postgresTarget,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      authoringContributions: {
        type: postgresScalarAuthoringTypes,
        valueObjectStorageType: 'Jsonb',
      },
      composedExtensionContracts: new Map(),
      createNamespace: createTestSqlNamespace,
      dataTypeLookup: fixtureDataTypeSupport.lookup,
      capabilities: { sql: { scalarList: true } },
      ...input,
    });

  it('preserves list and element nullability for scalar list fields inside composite types', () => {
    const result = interpretPostgresSchema(
      `type Address {
  requiredElements String[]
  nullableElementValues String?[]
  nullableList String[]?
  nullableElementValuesAndList String?[]?
}

model User {
  id Int @id
  home Address?
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(valueObjectsOf(result.value)).toEqual({
      Address: {
        fields: {
          requiredElements: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
            many: { elementNullable: false },
          },
          nullableElementValues: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
            many: { elementNullable: true },
          },
          nullableList: {
            nullable: true,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
            many: { elementNullable: false },
          },
          nullableElementValuesAndList: {
            nullable: true,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
            many: { elementNullable: true },
          },
        },
      },
    });
  });

  it('lowers the scalar-list nullability matrix to exact domain and storage shapes', () => {
    const result = interpretPostgresSchema(
      `model User {
  id Int @id
  requiredElements String[]
  nullableElementValues String?[]
  nullableList String[]?
  nullableElementValuesAndList String?[]?
  }`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const model = modelsOf(result.value)['User'];
    const table = entityAt<StorageTable>(result.value.storage, {
      namespaceId: 'public',
      entityKind: 'table',
      entityName: 'User',
    });

    expect({
      domain: {
        requiredElements: model?.fields['requiredElements'],
        nullableElementValues: model?.fields['nullableElementValues'],
        nullableList: model?.fields['nullableList'],
        nullableElementValuesAndList: model?.fields['nullableElementValuesAndList'],
      },
      storage: {
        requiredElements: table?.columns['requiredElements'],
        nullableElementValues: table?.columns['nullableElementValues'],
        nullableList: table?.columns['nullableList'],
        nullableElementValuesAndList: table?.columns['nullableElementValuesAndList'],
      },
    }).toEqual({
      domain: {
        requiredElements: {
          nullable: false,
          type: { kind: 'scalar', codecId: 'pg/text@1' },
          many: { elementNullable: false },
        },
        nullableElementValues: {
          nullable: false,
          type: { kind: 'scalar', codecId: 'pg/text@1' },
          many: { elementNullable: true },
        },
        nullableList: {
          nullable: true,
          type: { kind: 'scalar', codecId: 'pg/text@1' },
          many: { elementNullable: false },
        },
        nullableElementValuesAndList: {
          nullable: true,
          type: { kind: 'scalar', codecId: 'pg/text@1' },
          many: { elementNullable: true },
        },
      },
      storage: {
        requiredElements: {
          nativeType: 'text',
          codecId: 'pg/text@1',
          many: { elementNullable: false },
          nullable: false,
        },
        nullableElementValues: {
          nativeType: 'text',
          codecId: 'pg/text@1',
          many: { elementNullable: true },
          nullable: false,
        },
        nullableList: {
          nativeType: 'text',
          codecId: 'pg/text@1',
          many: { elementNullable: false },
          nullable: true,
        },
        nullableElementValuesAndList: {
          nativeType: 'text',
          codecId: 'pg/text@1',
          many: { elementNullable: true },
          nullable: true,
        },
      },
    });
  });

  it('lowers nullable value object list elements to domain metadata without storage list metadata', () => {
    const result = interpretPostgresSchema(
      `type Address {
  street String
  city String
}

model User {
  id Int @id
  addresses Address?[]
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const model = modelsOf(result.value)['User'];
    const table = entityAt<StorageTable>(result.value.storage, {
      namespaceId: 'public',
      entityKind: 'table',
      entityName: 'User',
    });
    const addressesColumn = table?.columns['addresses'];

    expect(model?.fields['addresses']).toEqual({
      nullable: false,
      type: { kind: 'valueObject', name: 'Address' },
      many: { elementNullable: true },
    });
    expect(addressesColumn).toEqual({
      nativeType: 'jsonb',
      codecId: 'pg/jsonb@1',
      nullable: false,
      many: false,
    });
    expect(addressesColumn?.many).toBe(false);
    expect(Object.hasOwn(addressesColumn ?? {}, 'elementNullable')).toBe(false);
    expect(Object.hasOwn(addressesColumn ?? {}, 'noCheck')).toBe(false);
  });
});
