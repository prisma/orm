import { entityAt } from '@internal/framework-components/ir';
import type { StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import {
  type InterpretPslDocumentToSqlContractInput,
  interpretPslDocumentToSqlContract as interpretPslDocumentToSqlContractInternal,
} from '../src/interpreter';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  modelsOf,
  postgresScalarAuthoringTypes,
  postgresScalarTypeDescriptors,
  postgresTarget,
  sqliteScalarAuthoringTypes,
  sqliteScalarColumnDescriptors,
  sqliteTarget,
  symbolTableInputFromParseArgs,
  valueObjectsOf,
} from './fixtures';

describe('interpretPslDocumentToSqlContract value objects and list fields', () => {
  const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();
  const interpretPslDocumentToSqlContract = (
    input: Omit<
      InterpretPslDocumentToSqlContractInput,
      | 'target'
      | 'scalarColumnDescriptors'
      | 'composedExtensionContracts'
      | 'createNamespace'
      | 'capabilities'
      | 'dataTypeLookup'
    > &
      Partial<Pick<InterpretPslDocumentToSqlContractInput, 'composedExtensionContracts'>>,
  ) =>
    interpretPslDocumentToSqlContractInternal({
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

  it('emits composite types as valueObjects', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `type Address {
  street String
  city String
  zip String?
}

model User {
  id Int @id
  name String
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(valueObjectsOf(result.value)).toEqual({
      Address: {
        fields: {
          street: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
          city: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
          zip: { nullable: true, type: { kind: 'scalar', codecId: 'pg/text@1' } },
        },
      },
    });
  });

  it('preserves list and element nullability for scalar list fields inside composite types', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `type Address {
  requiredElements String[]
  nullableElementValues String?[]
  nullableList String[]?
  nullableElementValuesAndList String?[]?
}

model User {
  id Int @id
  home Address?
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(valueObjectsOf(result.value)).toEqual({
      Address: {
        fields: {
          requiredElements: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
            many: true,
          },
          nullableElementValues: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
            many: true,
            elementNullable: true,
          },
          nullableList: {
            nullable: true,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
            many: true,
          },
          nullableElementValuesAndList: {
            nullable: true,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
            many: true,
            elementNullable: true,
          },
        },
      },
    });
  });

  it('emits value object field references with valueObject domain type and JSONB storage', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `type Address {
  street String
  city String
}

model User {
  id Int @id
  homeAddress Address?
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(modelsOf(result.value)).toMatchObject({
      User: {
        fields: {
          homeAddress: {
            nullable: true,
            type: { kind: 'valueObject', name: 'Address' },
          },
        },
      },
    });

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              User: {
                columns: {
                  homeAddress: {
                    nativeType: 'jsonb',
                    codecId: 'pg/jsonb@1',
                    nullable: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('lowers the scalar-list nullability matrix to exact domain and storage shapes', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
  requiredElements String[]
  nullableElementValues String?[]
  nullableList String[]?
  nullableElementValuesAndList String?[]?
  }`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const model = modelsOf(result.value)['User'];
    const table = entityAt<StorageTable>(result.value.storage, {
      namespaceId: 'public',
      entityKind: 'table',
      entityName: 'user',
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
          many: true,
        },
        nullableElementValues: {
          nullable: false,
          type: { kind: 'scalar', codecId: 'pg/text@1' },
          many: true,
          elementNullable: true,
        },
        nullableList: {
          nullable: true,
          type: { kind: 'scalar', codecId: 'pg/text@1' },
          many: true,
        },
        nullableElementValuesAndList: {
          nullable: true,
          type: { kind: 'scalar', codecId: 'pg/text@1' },
          many: true,
          elementNullable: true,
        },
      },
      storage: {
        requiredElements: {
          nativeType: 'text',
          codecId: 'pg/text@1',
          many: true,
          nullable: false,
        },
        nullableElementValues: {
          nativeType: 'text',
          codecId: 'pg/text@1',
          many: true,
          elementNullable: true,
          nullable: false,
        },
        nullableList: {
          nativeType: 'text',
          codecId: 'pg/text@1',
          many: true,
          nullable: true,
        },
        nullableElementValuesAndList: {
          nativeType: 'text',
          codecId: 'pg/text@1',
          many: true,
          elementNullable: true,
          nullable: true,
        },
      },
    });
  });

  it('lowers nullable value object list elements to domain metadata without storage list metadata', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `type Address {
  street String
  city String
}

model User {
  id Int @id
  addresses Address?[]
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const model = modelsOf(result.value)['User'];
    const table = entityAt<StorageTable>(result.value.storage, {
      namespaceId: 'public',
      entityKind: 'table',
      entityName: 'user',
    });
    const addressesColumn = table?.columns['addresses'];

    expect(model?.fields['addresses']).toEqual({
      nullable: false,
      type: { kind: 'valueObject', name: 'Address' },
      many: true,
      elementNullable: true,
    });
    expect(addressesColumn).toEqual({
      nativeType: 'jsonb',
      codecId: 'pg/jsonb@1',
      nullable: false,
    });
    expect(Object.hasOwn(addressesColumn ?? {}, 'many')).toBe(false);
    expect(Object.hasOwn(addressesColumn ?? {}, 'elementNullable')).toBe(false);
    expect(Object.hasOwn(addressesColumn ?? {}, 'noCheck')).toBe(false);
  });

  it('emits value object list fields with many: true and valueObject domain type', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `type Address {
  street String
  city String
}

model User {
  id Int @id
  addresses Address[]
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(modelsOf(result.value)).toMatchObject({
      User: {
        fields: {
          addresses: {
            nullable: false,
            type: { kind: 'valueObject', name: 'Address' },
            many: true,
          },
        },
      },
    });

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              User: {
                columns: {
                  addresses: {
                    nativeType: 'jsonb',
                    codecId: 'pg/jsonb@1',
                    nullable: false,
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('emits nested value object references within composite types', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `type Address {
  street String
  city String
}

type ShippingInfo {
  address Address
  notes String
}

model Order {
  id Int @id
  ship ShippingInfo
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(valueObjectsOf(result.value)).toEqual({
      Address: {
        fields: {
          street: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
          city: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
        },
      },
      ShippingInfo: {
        fields: {
          address: { nullable: false, type: { kind: 'valueObject', name: 'Address' } },
          notes: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
        },
      },
    });
  });

  it('omits valueObjects from contract when no composite types exist', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
  name String
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(valueObjectsOf(result.value)).toBeUndefined();
  });

  it('stores value object fields in the storage type the sqlite target declares', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `type Address {
  street String
  city String
}

model User {
  id Int @id
  homeAddress Address?
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractInternal({
      target: sqliteTarget,
      scalarColumnDescriptors: sqliteScalarColumnDescriptors,
      authoringContributions: {
        type: sqliteScalarAuthoringTypes,
        valueObjectStorageType: 'Json',
      },
      composedExtensionContracts: new Map(),
      createNamespace: createTestSqlNamespace,
      dataTypeLookup: fixtureDataTypeSupport.lookup,
      capabilities: { sql: {} },
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(modelsOf(result.value)).toMatchObject({
      User: {
        fields: {
          homeAddress: {
            nullable: true,
            type: { kind: 'valueObject', name: 'Address' },
          },
        },
      },
    });

    const namespaces = result.value.storage.namespaces;
    const [namespace] = Object.values(namespaces);
    expect(namespace).toMatchObject({
      entries: {
        table: {
          User: {
            columns: {
              homeAddress: {
                codecId: 'sqlite/json@1',
                nativeType: 'text',
                nullable: true,
              },
            },
          },
        },
      },
    });
  });

  it('skips value object fields when the target declares no value-object storage type', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `type Address {
  street String
  city String
}

model User {
  id Int @id
  homeAddress Address?
}`,
      sourceId: 'schema.prisma',
    });

    // The scalar map still contains Jsonb/Json entries; the family layer
    // must not fall back to hardcoded type names.
    const result = interpretPslDocumentToSqlContract({
      ...document,
      authoringContributions: { type: postgresScalarAuthoringTypes },
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(modelsOf(result.value)['User']?.fields).not.toHaveProperty('homeAddress');
    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              User: {
                columns: expect.not.objectContaining({ homeAddress: expect.anything() }),
              },
            },
          },
        },
      },
    });
  });
});
