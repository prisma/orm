import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresCodecLookup,
  postgresScalarAuthoringTypes,
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
  testEnumEntityContributions,
  testEnumPslBlockDescriptor,
} from './fixtures';

const pslBlockDescriptors = { enum: testEnumPslBlockDescriptor };

function interpretPostgres(schema: string) {
  const document = symbolTableInputFromParseArgs({
    schema,
    sourceId: 'schema.prisma',
  });
  return interpretPslDocumentToSqlContract({
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    authoringContributions: {
      type: postgresScalarAuthoringTypes,
      entityTypes: testEnumEntityContributions,
      pslBlockDescriptors,
      dataTypes: fixtureDataTypeSupport.entries,
      valueObjectStorageType: 'Jsonb',
    },
    dataTypeLookup: fixtureDataTypeSupport.lookup,
    codecLookup: postgresCodecLookup,
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    capabilities: { sql: { scalarList: true } },
    ...document,
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
  });
}

const countryEnum = `enum Country {
  @@type("pg/text@1")
  DE = "DE"
  FR = "FR"
}
`;

describe('interpretPslDocumentToSqlContract value objects in the domain', () => {
  it('gives an enum-typed composite member the domain valueSet a model field of that enum has, single and list', () => {
    const result = interpretPostgres(`${countryEnum}
type Address {
  country   Country
  countries Country[]
}

model User {
  id      Int     @id
  country Country
  home    Address
}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const namespace = result.value.domain.namespaces['public'];
    const modelField = namespace?.models['User']?.fields['country'];
    expect(modelField).toEqual({
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/text@1' },
      valueSet: {
        plane: 'domain',
        entityKind: 'enum',
        namespaceId: 'public',
        entityName: 'Country',
      },
    });
    expect(namespace?.valueObjects?.['Address']?.fields).toEqual({
      country: modelField,
      countries: { ...modelField, many: true },
    });
  });

  it('lowers composite types to value objects, keeping optional, list and nested value-object members', () => {
    const result = interpretPostgres(`type Address {
  street String
  zip    String?
  tags   String[]
}

type ShippingInfo {
  address Address
  notes   String
}

model Order {
  id   Int          @id
  ship ShippingInfo
}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = { kind: 'scalar', codecId: 'pg/text@1' };
    expect(result.value.domain.namespaces['public']?.valueObjects).toEqual({
      Address: {
        fields: {
          street: { nullable: false, type: text },
          zip: { nullable: true, type: text },
          tags: { nullable: false, type: text, many: true },
        },
      },
      ShippingInfo: {
        fields: {
          address: { nullable: false, type: { kind: 'valueObject', name: 'Address' } },
          notes: { nullable: false, type: text },
        },
      },
    });
  });

  it('omits valueObjects from the contract when no composite types exist', () => {
    const result = interpretPostgres(`model User {
  id Int @id
}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.domain.namespaces['public']?.valueObjects).toBeUndefined();
  });
});
